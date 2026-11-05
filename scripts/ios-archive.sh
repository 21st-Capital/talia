#!/usr/bin/env bash
# Archive Talia for a TestFlight / App Store upload, in one of two flavours.
#
#   scripts/ios-archive.sh "Talia Bitcoin Vault build 8"             watch-only
#   scripts/ios-archive.sh --signing "Talia Bitcoin Vault build 11"  signing
#   scripts/ios-archive.sh --check "<path to the .xcarchive>"        re-check one
#
# --signing (decided 2026-09-12: TestFlight gets the signing version, and "once we
# are confident, we make a completely new submission") sets TALIA_HWW=1 only:
# hardware signing and vault creation on, every payment surface off. Neither
# flavour is ever the full app: TALIA_FULL and TALIA_PURCHASES stay unset.
# The flags come from the ENVIRONMENT (babel-plugin-talia-flags.js), never
# from an edited file, so choosing a flavour never makes the checkout dirty.
#
# Why a script (2026-09-07): an archive made with a bare `xcodebuild archive`
# right after a TALIA_FULL=1 device build could carry the FULL app, because
# Metro caches transforms. Since 2026-09-12 metro.config.js keys Metro's cache
# on the flags, and Xcode's own bundle step resets the cache anyway.
#
# PROVENANCE (decided 2026-09-26, added 2026-09-30). A store binary must be traceable
# to a commit, and nothing uncommitted may slip into it:
#
#   1. The checkout must be CLEAN: every tracked file, read from disk and
#      hashed by the script itself, must rebuild the commit's tree (git status
#      is not trusted: skip-worktree, a local exclude or GIT_DIR can hide an
#      edit from it), no untracked file, and no ignored file outside the
#      places a checkout keeps local files (node_modules/, ios/Pods/, build
#      folders, ...). ios/.xcode.env.local, which Xcode sources as shell, may
#      only name node. Bump the build number and COMMIT it before archiving. Markdown alone
#      (a tracker or a note) is recorded but does not count: Metro never bundles it and
#      Xcode never copies it. The only way past this is
#      TALIA_ARCHIVE_ALLOW_DIRTY="<reason>"; the reason, the changed files and
#      the whole uncommitted diff are then kept in the archive.
#      The native libraries git cannot hold (the bdk-ffi fork, the BitBox
#      layer; built locally) must match the digests committed in
#      native/native-libs.sha256, with no override (decided 2026-10-05), and
#      the TaliaBdkWallet pod must link the fork's library in place and
#      nothing else (native/bdkwallet/TaliaBdkWallet.podspec), with no
#      override; so must every other library's pod. The same file
#      must name, per library, the 21st Capital repo and the full commit it
#      was built from and the digest of each file that build wrote
#      ("# source" and "# built" lines, written
#      by native/build-*.sh after building a clean, pushed commit; decided
#      2026-09-26): a missing or malformed line, one naming any other repo,
#      or pins that are not exactly the recorded build's files are refused
#      with no override (no network is used here), and the record goes into
#      the provenance record.
#      Xcode and the Metro re-bundle run under `env -i` with an allowlist
#      (archive-provenance.js build-env: HOME, PATH, USER, locale, TMPDIR,
#      the TALIA_* flags), so nothing else in this shell (XCODE_XCCONFIG_FILE,
#      PODFILE_DIR, EXTRA_PACKAGER_ARGS, ...) reaches the binary; the kept
#      values and the dropped names are recorded. Xcode is the one
#      xcode-select names, called as /usr/bin/xcodebuild: a DEVELOPER_DIR
#      naming another copy is refused, and none reaches the build.
#      native/*/lib may hold only the pinned libraries (they are on the
#      linker's search path); anything else there is refused, no override.
#      ios/.xcode.env.local (sourced as shell) must be absent, empty or one
#      exact line naming the node on PATH, and the only KeelWallet scheme is
#      the shared one (no personal scheme, no symlink Xcode would follow);
#      neither has an override. Xcode builds in a fresh derived-data folder,
#      so nothing compiled earlier is reused. node_modules and ios/Pods are
#      not judged (npm ci and pod install make them) but their digests are
#      recorded.
#   2. The commit is stamped into the app's Info.plist (TaliaSourceCommit,
#      a build setting, so no file is edited) and read back from the archive.
#   3. The flavour is proven from the ARCHIVED JavaScript itself, not from a
#      second bundle: Metro bundles this commit again in a private cache, that
#      plain JavaScript must be byte-identical to the one Xcode compiled, its
#      flags must read back as the flavour, and compiling Xcode's plain
#      JavaScript with the same hermesc must give, byte for byte, the
#      main.jsbundle inside the archive. (Until the old engine's removal,
#      decided 2026-11-04, the wallet engine was a constant per flavour and
#      was read back too; every flavour runs the one engine since.)
#   4. The checkout must not change while Xcode reads it.
#   5. Talia-Provenance/provenance.json goes into the archive (beside Products/,
#      not inside the app) with the commit, the flags, the JavaScript hashes,
#      the native libraries' source commits (nativeSources) and a SHA-256 of
#      the archive's contents; the same record, and every
#      refusal, is appended to ~/Library/Logs/Talia/archive-provenance.jsonl.
#
# Anything doubtful exits non-zero, and a refused archive is renamed so Xcode's
# Organizer no longer lists it and it cannot be uploaded by mistake.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROV="$ROOT/scripts/archive-provenance.js"

if [ "${1:-}" = "--check" ]; then
  exec node "$PROV" verify "${2:?path to the .xcarchive}"
fi

FLAVOUR="watch-only"
if [ "${1:-}" = "--signing" ]; then FLAVOUR="signing"; shift; fi
NAME="${1:?archive name, e.g. \"Talia Bitcoin Vault build 8\"}"
DAY="$(date +%Y-%m-%d)"
ARCHIVE="$HOME/Library/Developer/Xcode/Archives/$DAY/$NAME.xcarchive"
HERMESC="$ROOT/ios/Pods/hermes-engine/destroot/bin/hermesc"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
# A FRESH derived-data folder for every archive, never ios/build-device: an
# archive there reuses the object files, module caches and intermediates of
# earlier builds, and a file planted among them is linked as if this commit
# had compiled it. A store build compiles everything from the checkout. The
# folder is emptied before each archive and kept after it (the record names
# Xcode's plain JavaScript there); its path is the same every time, because
# hermesc writes the path of the file it compiles into the bytecode.
DERIVED="$HOME/Library/Developer/Talia/ArchiveDerivedData"
DEVICE_DERIVED="$ROOT/ios/build-device"

# The tier C harness (TALIA_HARNESS, BDK upgrade, decided 2026-10-15) is
# the simulator's scenario runner: an archive with it set is refused, never
# quietly cleared, and the archived JavaScript is proven not to hold it below.
if [ -n "${TALIA_HARNESS:-}" ]; then
  echo "✗ TALIA_HARNESS is set: the tier C runner never goes into an archive. Unset it."
  exit 1
fi
unset TALIA_FULL TALIA_HWW TALIA_PURCHASES TALIA_SIDE TALIA_HARNESS
# What config.ts's flag() switch must read back, arm by arm: TALIA_FULL,
# TALIA_HWW, then the default arm, TALIA_PURCHASES.
if [ "$FLAVOUR" = "signing" ]; then
  export TALIA_HWW=1
  EXPECT="false true false"
else
  EXPECT="false false false"
fi
echo "▸ Flavour: $FLAVOUR (TALIA_FULL=0 TALIA_HWW=${TALIA_HWW:-0} TALIA_PURCHASES=0)."

# A same-named archive from earlier today would let a FAILED archive look
# like a success below, so it is never overwritten.
if [ -e "$ARCHIVE" ]; then
  echo "✗ $ARCHIVE already exists. Pick a new name (e.g. the next build number)."
  exit 1
fi
[ -x "$HERMESC" ] || { echo "✗ hermesc not found at $HERMESC (run pod install)."; exit 1; }

refuse() {
  echo "$1"
  local where=""
  if [ -d "$ARCHIVE" ]; then
    where="${ARCHIVE%.xcarchive}.refused-$(date +%H%M%S)"
    mv "$ARCHIVE" "$where"
    echo "  The archive was moved out of the Organizer's list: $where"
  fi
  if [ -f "$SCRATCH/state.json" ]; then
    node "$PROV" refused --state "$SCRATCH/state.json" --reason "$1" --archive "$where" || true
  fi
  exit 1
}

echo "▸ Recording the source (commit, uncommitted changes, flags)."
STAMP_COMMIT="$(node "$PROV" gate --out "$SCRATCH/state.json" --name "$NAME" --flavour "$FLAVOUR")" || exit 1
COMMIT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).source.commit)' "$SCRATCH/state.json")"
if [ "$STAMP_COMMIT" != "$COMMIT" ]; then
  echo "  ⚠ Archiving a DIRTY checkout on purpose: ${TALIA_ARCHIVE_ALLOW_DIRTY}"
  echo "    The diff and untracked files are kept in the archive's Talia-Provenance folder."
fi
echo "  $STAMP_COMMIT"
# The Xcode xcode-select names builds the archive, never one a variable picks:
# the gate refused a DEVELOPER_DIR naming any other, and from here on no
# /usr/bin shim (xcodebuild, otool, ...) sees one.
unset DEVELOPER_DIR TOOLCHAINS SDKROOT

# The only environment Xcode and Metro get (see 1. above).
node "$PROV" build-env > "$SCRATCH/build-env" || refuse "✗ Could not prepare the build environment."
BUILD_ENV=()
while IFS= read -r -d '' KV; do BUILD_ENV+=("$KV"); done < "$SCRATCH/build-env"
[ "${#BUILD_ENV[@]}" -gt 0 ] || refuse "✗ The build environment came out empty."

echo "▸ Clearing Metro's transform cache (a full-app build may have warmed it)."
rm -rf "${TMPDIR:-/tmp}"/metro-* "${TMPDIR:-/tmp}"/haste-map-* 2>/dev/null || true
# The device script's stamp: the next device build must know the flags moved.
mkdir -p "$DEVICE_DERIVED" && printf '%s' "|${TALIA_HWW:-}||" > "$DEVICE_DERIVED/.talia-flags"

echo "▸ Emptying the archive's own build folder (nothing compiled earlier is reused)."
rm -rf "$DERIVED"
mkdir -p "$DERIVED"

echo "▸ Archiving the $FLAVOUR flavour → $ARCHIVE"
mkdir -p "$(dirname "$ARCHIVE")"
touch "$SCRATCH/archive-start"
cd "$ROOT/ios"
# Named, never found with ls: another *.xcworkspace sorting first would be built.
if ! env -i "${BUILD_ENV[@]}" /usr/bin/xcodebuild -workspace KeelWallet.xcworkspace -scheme KeelWallet -configuration Release \
  -destination 'generic/platform=iOS' -allowProvisioningUpdates \
  -derivedDataPath "$DERIVED" -archivePath "$ARCHIVE" archive \
  TALIA_SOURCE_COMMIT="$STAMP_COMMIT" LD_WARN_DUPLICATE_LIBRARIES=YES > "$SCRATCH/xcodebuild.log" 2>&1; then
  grep -E "error:|ARCHIVE FAILED" "$SCRATCH/xcodebuild.log" | tail -20 || true
  refuse "✗ xcodebuild archive failed."
fi
grep -E "ARCHIVE SUCCEEDED" "$SCRATCH/xcodebuild.log" || true
cd "$ROOT"
# Xcode 27's ld only WARNS about a symbol two native libraries define and keeps
# the first copy it loaded: only the identical ones the symbol-overlap gate
# proved may appear (native-sources.js link-check).
# LD_WARN_DUPLICATE_LIBRARIES=YES above: with Xcode's default ld leaves out the
# line naming each duplicate symbol (decided 2026-10-17).
node "$ROOT/scripts/native-sources.js" link-check iphoneos "$SCRATCH/xcodebuild.log" \
  || refuse "✗ The archive's link reported a duplicate symbol the overlap gate did not prove identical."
[ -d "$ARCHIVE" ] || refuse "✗ No archive was produced."
APP="$ARCHIVE/Products/Applications/KeelWallet.app"
[ -f "$APP/main.jsbundle" ] || refuse "✗ The archive has no main.jsbundle."

echo "▸ Proving the archived JavaScript is this commit's, in the $FLAVOUR flavour."
# The plain JavaScript Xcode's bundle step wrote before hermesc compiled it.
XJS="$DERIVED/Build/Intermediates.noindex/ArchiveIntermediates/KeelWallet/BuildProductsPath/Release-iphoneos/main.jsbundle"
if [ ! -f "$XJS" ] || [ ! "$XJS" -nt "$SCRATCH/archive-start" ]; then
  XJS="$(find "$DERIVED/Build/Intermediates.noindex/ArchiveIntermediates" -name main.jsbundle \
    -newer "$SCRATCH/archive-start" -not -path '*.app/*' 2>/dev/null | head -1)"
fi
[ -n "$XJS" ] && [ -f "$XJS" ] || refuse "✗ Cannot find the plain JavaScript Xcode bundled for this archive."

# (a) Metro bundles this commit again, the way Xcode's bundle step does, in a
#     private cache no other build can have touched. Same bytes, or refuse.
mkdir -p "$SCRATCH/metro-tmp"
env -i "${BUILD_ENV[@]}" TMPDIR="$SCRATCH/metro-tmp" node "$ROOT/node_modules/react-native/scripts/bundle.js" bundle \
  --entry-file index.js --platform ios --dev false --reset-cache --minify false \
  --bundle-output "$SCRATCH/fresh.js" --assets-dest "$SCRATCH/assets" > "$SCRATCH/bundle.log" 2>&1 \
  || { tail -20 "$SCRATCH/bundle.log"; refuse "✗ Metro could not bundle the checkout."; }
PLAIN_SHA="$(shasum -a 256 "$XJS" | cut -d' ' -f1)"
FRESH_SHA="$(shasum -a 256 "$SCRATCH/fresh.js" | cut -d' ' -f1)"
[ "$PLAIN_SHA" = "$FRESH_SHA" ] || refuse "✗ The archived JavaScript ($PLAIN_SHA) is not what this checkout bundles to ($FRESH_SHA). Not safe to upload."
echo "  Plain JavaScript reproduced from the checkout: $PLAIN_SHA"

# (b) config.ts's flag() switch: case TALIA_FULL, case TALIA_HWW, default =
#     TALIA_PURCHASES. After inlining, the three arms must read $EXPECT, in order.
SWITCH="$(grep -A 7 "case 'TALIA_FULL':" "$XJS")"
ARMS="$(printf '%s' "$SWITCH" | grep -oE 'return (true|false);' | sed -E 's/return |;//g' | tr '\n' ' ' | sed 's/ $//')"
if [ "$ARMS" != "$EXPECT" ]; then
  printf '%s\n' "$SWITCH"
  refuse "✗ The flags inlined as \"$ARMS\" (TALIA_FULL, TALIA_HWW, TALIA_PURCHASES), not the $FLAVOUR app's \"$EXPECT\". Not safe to upload."
fi
echo "  TALIA_FULL, TALIA_HWW, TALIA_PURCHASES inline to: $ARMS (the $FLAVOUR app)."
# (b1) The tier C harness arm is absent: index.js's TALIA_HARNESS condition was
#      folded away with the runner it guards, whose marker must not be in the
#      archived JavaScript (src/harness/tierC.ts TIER_C_MARKER).
if grep -q "talia-tier-c-runner" "$XJS"; then
  refuse "✗ The archived JavaScript carries the tier C harness (TALIA_HARNESS). Not safe to upload."
fi
echo "  The tier C harness is absent from the archived JavaScript."

# (c) The archived main.jsbundle is Hermes bytecode, which cannot be read for
#     flags. Compiling Xcode's plain JavaScript IN PLACE (hermesc records the
#     file's path) with the same hermesc and options as react-native-xcode.sh
#     must give it back byte for byte.
"$HERMESC" -emit-binary -max-diagnostic-width=80 -O -out "$SCRATCH/recompiled.hbc" "$XJS" > /dev/null 2>&1 \
  || refuse "✗ hermesc could not compile the archived JavaScript."
HERMES_SHA="$(shasum -a 256 "$APP/main.jsbundle" | cut -d' ' -f1)"
RECOMPILED_SHA="$(shasum -a 256 "$SCRATCH/recompiled.hbc" | cut -d' ' -f1)"
[ "$HERMES_SHA" = "$RECOMPILED_SHA" ] || refuse "✗ The archived main.jsbundle ($HERMES_SHA) is not the compiled JavaScript ($RECOMPILED_SHA). Not safe to upload."
echo "  Archived main.jsbundle is exactly that JavaScript, compiled: $HERMES_SHA"

ID="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"
DISPLAY="$(/usr/libexec/PlistBuddy -c 'Print CFBundleDisplayName' "$APP/Info.plist")"
VER="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Info.plist")"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$APP/Info.plist")"
PLIST_COMMIT="$(/usr/libexec/PlistBuddy -c 'Print TaliaSourceCommit' "$APP/Info.plist" 2>/dev/null || true)"
TEAM="$(codesign -dvv "$APP" 2>&1 | grep TeamIdentifier | cut -d= -f2)"
if [ "$ID" != "com.twentyfirstcapital.keel" ] || [ "$DISPLAY" != "Talia" ]; then
  refuse "✗ Archive identity is $ID / $DISPLAY, not the App Store app. Not safe to upload."
fi
[ "$PLIST_COMMIT" = "$STAMP_COMMIT" ] || refuse "✗ The app's TaliaSourceCommit is \"$PLIST_COMMIT\", not \"$STAMP_COMMIT\". Not safe to upload."
echo "  Info.plist TaliaSourceCommit: $PLIST_COMMIT"
# No NFC (removed 2026-09-12). App Review demanded an NFC hardware demo because
# the app linked Apple's NFC framework, although nothing used it. Refuse an
# archive that links CoreNFC again or declares an NFC usage string.
EXE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleExecutable' "$APP/Info.plist")"
NFC_LINKED="$( { otool -L "$APP/$EXE"; for FW in "$APP"/Frameworks/*.framework; do [ -d "$FW" ] && otool -L "$FW/$(basename "$FW" .framework)"; done; } 2>/dev/null | grep -c CoreNFC || true)"
if [ "$NFC_LINKED" -ne 0 ] || /usr/libexec/PlistBuddy -c 'Print NFCReaderUsageDescription' "$APP/Info.plist" >/dev/null 2>&1; then
  refuse "✗ The app links Apple's NFC framework or asks for NFC. NFC was removed on 2026-09-12; something brought it back. Not safe to upload."
fi
echo "  No NFC framework linked, no NFC usage string."

echo "▸ Writing the provenance record into the archive and the local log."
ARCHIVE_SHA="$(node "$PROV" record --state "$SCRATCH/state.json" --archive "$ARCHIVE" \
  --name "$NAME" --flavour "$FLAVOUR" \
  --bundle-id "$ID" --display-name "$DISPLAY" --version "$VER" --build "$BUILD" --team "$TEAM" \
  --plist-commit "$PLIST_COMMIT" --plain-sha "$PLAIN_SHA" --hermes-sha "$HERMES_SHA" \
  --xcode-js "$XJS" --flags-read "$ARMS" --reproduced yes \
  --xcode "$(env -i "${BUILD_ENV[@]}" /usr/bin/xcodebuild -version 2>/dev/null | tr '\n' ' ' | sed 's/ $//')" \
  --hermesc-sha "$(shasum -a 256 "$HERMESC" | cut -d' ' -f1)")" \
  || refuse "✗ Provenance could not be recorded. Not safe to upload."

echo "✓ $NAME: $ID, \"$DISPLAY\", $VER ($BUILD), team $TEAM, $FLAVOUR flavour verified."
echo "  Source commit   $STAMP_COMMIT"
# The native libraries' repos and commits, as the gate recorded them.
node -e 'for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).nativeSources || [])
  console.log("  Native " + s.lib.padEnd(9) + s.repo + " @ " + s.commit)' "$SCRATCH/state.json" || true
echo "  JavaScript      $HERMES_SHA (Hermes), $PLAIN_SHA (plain)"
echo "  Archive SHA-256 $ARCHIVE_SHA"
echo "  Right before uploading, check it again:"
echo "    scripts/ios-archive.sh --check \"$ARCHIVE\""
echo "  Upload: Xcode → Window → Organizer → $NAME → Distribute App."
