#!/usr/bin/env bash
#
# Build + install Talia to a connected iPhone WITHOUT the React Native CLI's
# bundler/CocoaPods step.
#
# Why: `react-native run-ios` runs `pod install` first, which fails wherever the
# Ruby on PATH cannot load CocoaPods' native gems (for example an x86_64
# Homebrew Ruby under Rosetta on an Apple silicon Mac: json won't compile and
# bigdecimal.bundle is the wrong arch). When the Pods are already installed and
# current, a JS/TS change needs no pod step, so this script drives Xcode
# directly. (For `pod install` itself, use an arm64-native Ruby; see the note
# at the bottom.)
#
# Usage:
#   TALIA_SIDE=1 scripts/ios-device.sh [UDID|name] Release   "Talia Test", the usual phone build
#   TALIA_SIDE=2 scripts/ios-device.sh [UDID|name] Release   a THIRD copy, "Talia Test 2"
#   npm run ios:device -- Release                            the default phone, Release
#
# The phone is never written into this repository (device ids are personal
# data; decided 2026-09-26). It is the first argument (a
# device id, or a name from .devices.local), else $TALIA_DEVICE_UDID, else the
# "default=" line of .devices.local: an untracked, gitignored file at the
# checkout root, or at the main checkout's root, which every worktree reads.
# One "name=udid" per line, "#" starts a comment.
#
# TALIA_SIDE is REQUIRED for a phone: without it this builds the App Store
# bundle id and replaces the public Talia on the device (decided 2026-09-25). The
# script refuses rather than let that happen.
#
# A Debug build loads JS from Metro — start it with `npx react-native start`.
# A Release build embeds the JS bundle (standalone, no Metro needed).
set -euo pipefail

# `scripts/ios-device.sh Release` means the default phone, in Release.
if [ "$#" -eq 1 ] && { [ "$1" = "Debug" ] || [ "$1" = "Release" ]; }; then
  set -- "" "$1"
fi
DEVICE_ARG="${1:-}"
CONFIG="${2:-Debug}"

# A phone build is ALWAYS the side copy (decided 2026-09-25): "Talia" is the
# name of the public App Store app, and a test build is always installed as
# "Talia Test", never over it.
#
# Without TALIA_SIDE this script builds the App Store bundle id, and installing
# that REPLACES the real Talia on the phone: the public app is gone until it is
# reinstalled from TestFlight, and its data with it. Nothing about a test build
# is worth that, so it is refused here rather than remembered. The only build
# that may carry the plain id is an ARCHIVE (scripts/ios-archive.sh), which
# goes to Apple and never to a phone directly.
if [ -z "${TALIA_SIDE:-}" ] && [ -z "${TALIA_MAIN_ID:-}" ]; then
  cat >&2 <<'REFUSED'
✗ Refusing to install over the App Store app.

  This would build com.twentyfirstcapital.keel, named "Talia", and replace the
  public app on the phone. Install the side copy instead:

      TALIA_SIDE=1 TALIA_FULL=1 scripts/ios-device.sh <udid> Release

  (TALIA_SIDE=2 is "Talia Test 2", a third copy beside it.)

  If you really do mean the App Store bundle id on a phone, say so:
  TALIA_MAIN_ID=1.
REFUSED
  exit 1
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DD="$ROOT/ios/build-device"

# Which phone (see the header): never a value written in this file.
DEVICE_FILES=("$ROOT/.devices.local")
MAIN_GIT="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ -n "$MAIN_GIT" ] && [ "$(basename "$MAIN_GIT")" = ".git" ] && [ "$(dirname "$MAIN_GIT")" != "$ROOT" ]; then
  DEVICE_FILES+=("$(dirname "$MAIN_GIT")/.devices.local")
fi

# Prints the id the first .devices.local that has a line "<name>=" gives it.
# A "#" anywhere starts a comment: "default=<id>   # test phone" gives <id>.
device_named() {
  local f line value
  for f in "${DEVICE_FILES[@]}"; do
    [ -f "$f" ] || continue
    line="$(grep -E "^[[:space:]]*$1[[:space:]]*=" "$f" | head -n 1 || true)"
    if [ -n "$line" ]; then
      value="${line#*=}"
      value="${value%%#*}"
      printf '%s' "$value" | tr -d "[:space:]\"'"
      return 0
    fi
  done
  return 1
}

UDID=""
if [ -z "$DEVICE_ARG" ]; then
  UDID="${TALIA_DEVICE_UDID:-}"
  [ -n "$UDID" ] || UDID="$(device_named default || true)"
elif [[ "$DEVICE_ARG" =~ ^[A-Za-z0-9_-]+$ ]] && FOUND="$(device_named "$DEVICE_ARG")" && [ -n "$FOUND" ]; then
  UDID="$FOUND"
elif [[ "$DEVICE_ARG" =~ ^[0-9A-Fa-f-]{24,}$ ]]; then
  UDID="$DEVICE_ARG"
else
  echo "✗ No device named \"$DEVICE_ARG\" in ${DEVICE_FILES[*]}." >&2
  exit 1
fi
if [ -z "$UDID" ]; then
  cat >&2 <<'NODEVICE'
✗ No phone given, and none is set up on this Mac.

  Device ids are never written into the repository. Give the phone one way:

      scripts/ios-device.sh <udid> Release
      TALIA_DEVICE_UDID=<udid> npm run ios:device -- Release
      a line "default=<udid>" in .devices.local (gitignored) at the root of
      this checkout, or of the main checkout, which every worktree reads

  `xcrun devicectl list devices` lists the connected phones and their ids.
NODEVICE
  exit 1
fi

# Every native library Xcode is about to link must be the one pinned in
# native/native-libs.sha256 (decided 2026-09-26): the checks
# scripts/ios-archive.sh applies with no override, run before every phone
# build too. A library missing from this checkout is built with
# native/build-*.sh, or copied from a checkout that has it; this proves it.
# --test-build: a library rebuilt by native/build-*.sh is tested on the phone
# BEFORE it is pinned, so it passes while its files are exactly the ones its
# recorded build wrote, and is named as not pinned (decided 2026-10-07). An
# archive takes only pinned, committed libraries.
node "$ROOT/scripts/native-sources.js" verify --test-build || exit 1

cd "$ROOT/ios"
WS="$(ls -d *.xcworkspace | head -1)"

# One branch builds both apps (decided 2026-09-05). Unset flags give the watch-only
# App Store build; TALIA_FULL=1 gives the signing one. The values are inlined
# at transform time by babel-plugin-talia-flags.js, and Metro caches its
# transforms, so the cache is cleared whenever a flag is set or changes.
# The tier C harness (TALIA_HARNESS, BDK upgrade, decided 2026-10-15) runs
# in the simulator only: a phone never gets the scenario runner.
if [ -n "${TALIA_HARNESS:-}" ]; then
  echo "✗ TALIA_HARNESS is the simulator's tier C runner; a phone build never carries it. Unset it."
  exit 1
fi
FLAGS="${TALIA_FULL:-}|${TALIA_HWW:-}|${TALIA_PURCHASES:-}|${TALIA_HARNESS:-}"
STAMP="$ROOT/ios/build-device/.talia-flags"
if [ "$FLAGS" != "|||" ]; then
  echo "▸ Build flags: TALIA_FULL=${TALIA_FULL:-0} TALIA_HWW=${TALIA_HWW:-0} TALIA_PURCHASES=${TALIA_PURCHASES:-0}"
fi
if [ ! -f "$STAMP" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$FLAGS" ]; then
  echo "▸ Build flags changed since the last build; clearing the Metro cache."
  rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/haste-map-* 2>/dev/null || true
fi
mkdir -p "$(dirname "$STAMP")" && printf '%s' "$FLAGS" > "$STAMP"

# A second copy BESIDE the TestFlight app (decided 2026-09-07, so a 1.0.1 fix can be
# tried without replacing the build under review): its own bundle id, so iOS
# installs it as a separate app with separate data and its own keychain, and
# its own home-screen name so the two icons can be told apart. The deep-link
# schemes (tiam://, talia://) are shared, so a sign-in link may open either
# copy; sign in with the emailed code instead.
SIDE_SETTINGS=()
SIDE_ID=""
SIDE_NAME=""
if [ -n "${TALIA_SIDE:-}" ]; then
  # TALIA_SIDE=2 is a THIRD copy (decided 2026-09-15: the build with Apple's own
  # tab bar, named "Talia Test 2"), so an alternative can be tried beside
  # "Talia Test" without replacing it. Its own bundle id again: separate app,
  # separate data, separate keychain.
  if [ "${TALIA_SIDE}" = "2" ]; then
    SIDE_ID="com.twentyfirstcapital.keel.test2"
    SIDE_NAME="Talia Test 2"
  else
    SIDE_ID="com.twentyfirstcapital.keel.test"
    SIDE_NAME="Talia Test"
  fi
  # CFBundleDisplayName in Info.plist reads $(TALIA_DISPLAY_NAME), a build
  # setting the project defaults to "Talia"; INFOPLIST_KEY_* cannot override a
  # key the plist spells out itself (the first attempt came out named "Talia").
  SIDE_SETTINGS=(PRODUCT_BUNDLE_IDENTIFIER="$SIDE_ID"
    TALIA_DISPLAY_NAME="$SIDE_NAME")
  echo "▸ Side-by-side copy: $SIDE_ID, named \"$SIDE_NAME\""
fi

APP="$DD/Build/Products/$CONFIG-iphoneos/KeelWallet.app"
# Start from no .app at all. Xcode only re-signs when the binary or plist
# changes: a build that changed nothing but the JavaScript left the old
# signature in place, sealing a main.jsbundle that was no longer there
# (found 2026-10-05). With no .app, every build is linked and signed afresh.
rm -rf "$APP"

echo "▸ Building $WS ($CONFIG) for device $UDID …"
# -allowProvisioningDeviceRegistration lets xcodebuild add THIS iPhone to the
# team's device list. Needed the first time a device meets a team: moving to the
# company team (2026-09-04) stopped every build with "Device isn't registered in
# your developer account", which Xcode.app does silently but xcodebuild will not
# do without being told.
# TALIA_ANY_IPHONE=1 builds for any iPhone instead of this one: xcodebuild
# refuses to START while it cannot prepare a phone it reaches only over Wi-Fi
# ("Timed out waiting for all destinations", 2026-10-15), but a phone already
# on the team's device list is in the profile anyway, and devicectl installs
# over Wi-Fi. Every check below runs the same.
DEST="id=$UDID"
[ -n "${TALIA_ANY_IPHONE:-}" ] && DEST="generic/platform=iOS"
# The build's output is kept for the link check below.
LINK_LOG="$DD/xcodebuild-$CONFIG.log"
mkdir -p "$DD"
xcodebuild -workspace "$WS" -scheme KeelWallet -configuration "$CONFIG" \
  -destination "$DEST" -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration -derivedDataPath "$DD" build LD_WARN_DUPLICATE_LIBRARIES=YES \
  ${SIDE_SETTINGS[@]+"${SIDE_SETTINGS[@]}"} 2>&1 | tee "$LINK_LOG"

# Xcode 27's ld only WARNS about a symbol two native libraries define, and the
# app then runs the first copy it loaded: anything but the identical symbols
# the overlap gate proved (native/bdkwallet/duplicate-symbols.txt) stops the
# install here. The build passes
# LD_WARN_DUPLICATE_LIBRARIES=YES: with Xcode's default ld leaves out the line
# naming each duplicate symbol (decided 2026-10-17).
node "$ROOT/scripts/native-sources.js" link-check iphoneos "$LINK_LOG" || exit 1

# The .app is finalized (Info.plist + code signature) a moment after the compile
# finishes; installing mid-finalization fails with "Failed to get the identifier".
for _ in $(seq 1 30); do
  [ -f "$APP/Info.plist" ] && [ -d "$APP/_CodeSignature" ] && break
  sleep 1
done

if [ -n "${TALIA_SIDE:-}" ]; then
  # Prove the overrides took before anything reaches the phone: a copy that
  # still carries the TestFlight bundle id would REPLACE the app under test.
  BUILT_ID="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"
  BUILT_NAME="$(/usr/libexec/PlistBuddy -c 'Print CFBundleDisplayName' "$APP/Info.plist")"
  if [ "$BUILT_ID" != "$SIDE_ID" ] || [ "$BUILT_NAME" != "$SIDE_NAME" ]; then
    echo "✗ Side-by-side build came out as $BUILT_ID / \"$BUILT_NAME\"; not installing." >&2
    exit 1
  fi
fi

# The signature must cover every file in the .app, the JavaScript included.
if ! codesign --verify --strict "$APP"; then
  echo "✗ The built app's signature does not cover its files; not installing." >&2
  exit 1
fi

echo "▸ Installing $APP …"
xcrun devicectl device install app --device "$UDID" "$APP"
if [ "$CONFIG" = "Debug" ]; then
  echo "✓ Installed. Debug build → run Metro:  npx react-native start"
else
  echo "✓ Installed ($CONFIG). Standalone — no Metro needed."
fi

# Proper fix for `react-native run-ios` itself: install an arm64-native Ruby
# (e.g. `brew install ruby` under an arm64 Homebrew at /opt/homebrew, or rbenv),
# `gem install cocoapods`, and put it ahead of /usr/local/bin on PATH.
