#!/usr/bin/env bash
#
# Build Talia for the iOS Simulator, signed to run locally, and check its
# link. Installs nothing and touches no phone.
#
#   scripts/ios-sim.sh <simulator udid> [Release|Debug] [--bundle]
#
# The pods name only each native library's DEVICE file (lib*-ios.a, linked in
# place), so a simulator build puts a folder of its own first on
# LIBRARY_SEARCH_PATHS holding a copy (cp -c) of every library's simulator
# file (lib*-sim.a) under the device file's name: bitboxffi and bdkwallet
# alike (NATIVE_SOURCES in scripts/archive-provenance.js). The copies
# are made from files `native-sources.js verify --test-build` has just proven
# to be the pinned ones (or the recorded build being tested), as a phone build
# does. The arm64 simulator only (ARCHS=arm64: the BitBox simulator library
# has no x86_64 slice).
#
# Signed "to run locally" (CODE_SIGN_IDENTITY=-: no identity, no profile), so
# the app carries its simulated entitlements: an unsigned build has no
# application identifier, the Keychain refuses it, and the app stops on "Talia
# cannot open its saved data right now" (found 2026-10-16).
#
# The link is then checked (native-sources.js link-check): Xcode 27's ld only
# WARNS about a duplicate symbol and keeps the first copy it loaded, so any
# duplicate outside the exact list the symbol-overlap gate proved identical
# (native/bdkwallet/duplicate-symbols.txt) fails the build here.
# LD_WARN_DUPLICATE_LIBRARIES=YES (also set in the KeelWallet target): with
# Xcode's default, -no_warn_duplicate_libraries, ld prints a duplicate's
# objects but not the line naming the symbol (decided 2026-10-17).
#
# --bundle (Debug): put the JavaScript into the app (FORCE_BUNDLING), so a
# Debug build starts without Metro. Make sure nothing else serves port 8081:
# a Debug app asks Metro there first.
#
# Its own build folder (ios/build-sim, gitignored) and its own TMPDIR for
# Metro's cache (one per checkout), so no other build's cache is reused. The flags are the
# caller's (TALIA_FULL=1 for the phone app's flavour), as in ios-device.sh.
set -euo pipefail

UDID="${1:-}"
CONFIG="${2:-Release}"
BUNDLE="${3:-}"
if [ -z "$UDID" ] || { [ "$CONFIG" != "Release" ] && [ "$CONFIG" != "Debug" ]; } || { [ -n "$BUNDLE" ] && [ "$BUNDLE" != "--bundle" ]; }; then
  echo "usage: scripts/ios-sim.sh <simulator udid> [Release|Debug] [--bundle]" >&2
  exit 64
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DD="$ROOT/ios/build-sim"
SOURCES="$ROOT/scripts/native-sources.js"

node "$SOURCES" verify --test-build || exit 1

# The simulator files, each under its device file's name, in a folder of this build.
SIMLIBS="$DD/talia-sim-libs"
rm -rf "$SIMLIBS"
mkdir -p "$SIMLIBS"
while IFS=$'\t' read -r SIM IOS; do
  cp -c "$ROOT/$SIM" "$SIMLIBS/$(basename "$IOS")"
done < <(node -e '
  const p = require(process.argv[1]);
  for (const lib of Object.keys(p.NATIVE_SOURCES)) {
    const sim = p.NATIVE_SOURCES[lib].files.find((f) => f.endsWith("-sim.a"));
    process.stdout.write(`${sim}\t${p.linkedLibOf(lib)}\n`);
  }' "$ROOT/scripts/archive-provenance.js")
echo "▸ Simulator libraries, linked under their device names:"
ls -1 "$SIMLIBS" | sed 's/^/    /'

# Metro's cache: this checkout's own, under the system's temporary folder (the
# compiler cannot use a TMPDIR inside the build folder: "couldNotFindTmpDir").
BUILD_TMP="${TMPDIR:-/tmp}/talia-ios-sim-$(printf '%s' "$ROOT" | shasum | cut -c1-12)"
mkdir -p "$BUILD_TMP"
LOG="$DD/xcodebuild-$CONFIG.log"
# No .app to start from, so the app is always linked afresh and the link check
# below always has a link to read (it refuses a log without one).
rm -rf "$DD/Build/Products/$CONFIG-iphonesimulator/KeelWallet.app"
FORCE=()
[ -n "$BUNDLE" ] && FORCE=(FORCE_BUNDLING=1)
echo "▸ Building KeelWallet.xcworkspace ($CONFIG, iphonesimulator, signed to run locally) → $DD"
cd "$ROOT/ios"
env ${FORCE[@]+"${FORCE[@]}"} TMPDIR="$BUILD_TMP/" xcodebuild -workspace KeelWallet.xcworkspace -scheme KeelWallet \
  -configuration "$CONFIG" -sdk iphonesimulator -destination "id=$UDID" -derivedDataPath "$DD" \
  CODE_SIGN_IDENTITY=- ARCHS=arm64 ONLY_ACTIVE_ARCH=YES LD_WARN_DUPLICATE_LIBRARIES=YES \
  "LIBRARY_SEARCH_PATHS=$SIMLIBS \$(inherited)" build > "$LOG" 2>&1 || {
  grep -E "error:|BUILD FAILED" "$LOG" | tail -20 || true
  echo "✗ xcodebuild failed; the log is $LOG" >&2
  exit 1
}
node "$SOURCES" link-check iphonesimulator "$LOG" || exit 1
APP="$DD/Build/Products/$CONFIG-iphonesimulator/KeelWallet.app"
echo "✓ Built $APP"
echo "  Install and start it: xcrun simctl install $UDID \"$APP\" && xcrun simctl launch $UDID com.twentyfirstcapital.keel"
