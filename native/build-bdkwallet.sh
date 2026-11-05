#!/bin/bash
# Builds the wallet library, bdk-ffi 3.1.1 from 21st Capital's PRIVATE fork
# https://github.com/21st-Capital/bdk-ffi-fork, branch talia-3 (BDK upgrade,
# decided 2026-10-15), into native/bdkwallet: the static libraries for the
# phone and the simulator, the Swift bindings and their C header, and the list
# of duplicate symbols the app's link may report. The old library beside it
# (native/bdkffi, branch talia) was removed with the old engine (decided
# 2026-11-04). The Rust crate is still called bdkffi, so cargo's output is
# libbdkffi.a; it is copied in as libbdkwallet-*.a.
#
#   native/build-bdkwallet.sh --fork <checkout> --branch talia-3 [--rollback <commit>]
#
# The fork checkout and its branch are named, never found: the script refuses
# a branch other than the one scripts/archive-provenance.js allowlists for
# bdkwallet (NATIVE_SOURCES), and native-sources.js check then refuses unless
# the checkout is exactly its HEAD commit, clean, reachable from that branch on
# the org repo (fetched first) and containing the commit the record names
# (none before the first build), and no cargo config or toolchain file sits
# above it. An OLDER commit of the branch is a rollback, named with
# --rollback <commit>, never the way past a refusal. Use a checkout of its
# own for the build (git worktree add --detach <path> 21c/talia-3): the
# fork's working copies may change under other builds.
#
# Before anything reaches the app it also refuses unless:
#   - bdk-ffi/Cargo.toml is bdk-ffi 3.1.1 with uniffi =0.31.2, the target the
#     plan froze;
#   - rustc under the build's own environment (env -i, cargo-env's allowlist)
#     is 1.97.1, the compiler the fork's rust-toolchain.toml names;
#   - electrum-client and bdk_wallet resolve to the fork's vendored, patched
#     copies (cargo metadata);
#   - every object in both libraries compiled by this build is for iOS 15.0,
#     none newer, and every other object is the Rust toolchain's own prebuilt
#     std/core/compiler_builtins, byte for byte (native-sources.js minos);
#   - the symbol-overlap gate (the fork's bdk-ffi/scripts/symbol-overlap-gate.py)
#     passes over every pair of the libraries the app links (this build, and
#     the PINNED bitboxffi), on the device AND the simulator
#     slices: every global symbol two of them define must be the same code.
#     The symbols it proves identical but which sit in different objects are
#     the only duplicates the link may report, each for its own pair of
#     libraries; they are written to native/bdkwallet/duplicate-symbols.txt
#     for native-sources.js link-check;
#   - the bindings generated from the device library and from the simulator
#     library are the same; their C struct types are then renamed with the
#     prefix BdkWallet (native-sources.js ffi-prefix), because Swift merges
#     imported C types of the same name across the whole app.
#
# The library is built with --lib (the fork's uniffi-bindgen tool is not built
# for the phone) and the profile release-smaller. The bindings are generated
# by the fork's OWN uniffi-bindgen, built for this Mac from the same commit
# and Cargo.lock, reading the metadata of the device library itself (library
# mode), into a folder outside the checkout, so the stray
# BitcoinDevKitFFI.modulemap it writes never dirties the fork; only
# BitcoinDevKit.swift and BitcoinDevKitFFI.h are copied, and the app keeps its
# own ffi/module.modulemap. The tool needs uniffi's "cli" and "cargo-metadata"
# features (the second makes it read uniffi.toml, the Swift module names, in
# library mode), which the bindgen run asks for by name (--features
# uniffi/cli,uniffi/cargo-metadata). In talia-3 of 2026-10-16 they are still normal
# dependency features, so the bindgen crates (uniffi_bindgen, clap, goblin,
# askama, cargo_metadata and others) are inside the static library too, and a
# few of their shared generic functions reach the app: record warns, and pin
# and the archive refuse such a library (NATIVE_SOURCES toolCrates). Once the
# fork gives both features to the tool alone ([[bin]] required-features, no
# default features on the library's uniffi), the library holds none of them and
# this script needs no change.
#
# Then it writes the record (node scripts/native-sources.js record bdkwallet
# <commit> <checkout> <work>, which refuses unless the checkout is still that
# commit, clean and on talia-3, and every file in the app is byte for byte
# this build's own output: the libraries in the checkout's target folder, the
# bindings in the work folder, the duplicate list made again from the gate's
# reports there; it is never run by hand): the commit, the digest of each
# library, of the generated files, the Xcode whose clang compiled the C code
# and the other libraries' files the gate judged. Test the build first (the simulator,
# then the phone: scripts/ios-device.sh takes a recorded build before it is
# pinned), then pin it (node scripts/native-sources.js pin bdkwallet, with
# bitboxffi when it was rebuilt too) and commit the record and
# the pins TOGETHER; scripts/ios-archive.sh refuses anything else. Never commit
# an unpinned record on a branch with an open pull request: the app's own
# record test is red until the pin, and a red CI emails the team.
#
# What the library's bytes depend on: the commit, its Cargo.lock, the Rust
# compiler its rust-toolchain.toml names, AND the Xcode installed here: the C
# code inside (secp256k1, ring) is compiled by Xcode's own clang against its
# iOS SDK, so a rebuild after an Xcode update gives other bytes (the record
# keeps the Xcode; verify warns when this Mac's differs).
set -euo pipefail
FORK_ARG=""
BRANCH=""
ROLLBACK=()
while [ $# -gt 0 ]; do
  case "$1" in
    --fork)
      [ $# -ge 2 ] && [ -n "$2" ] || { echo "✗ --fork needs the fork checkout to build from."; exit 64; }
      FORK_ARG="$2"
      shift 2
      ;;
    --branch)
      [ $# -ge 2 ] && [ -n "$2" ] || { echo "✗ --branch needs the branch the checkout is on (talia-3)."; exit 64; }
      BRANCH="$2"
      shift 2
      ;;
    --rollback)
      [ $# -ge 2 ] && [ -n "$2" ] || { echo "✗ --rollback needs the commit being built (the checkout's HEAD)."; exit 64; }
      ROLLBACK=(--rollback "$2")
      shift 2
      ;;
    *) echo "usage: native/build-bdkwallet.sh --fork <checkout> --branch talia-3 [--rollback <commit>]"; exit 64 ;;
  esac
done
[ -n "$FORK_ARG" ] && [ -n "$BRANCH" ] || {
  echo "usage: native/build-bdkwallet.sh --fork <checkout> --branch talia-3 [--rollback <commit>]"
  exit 64
}
APP="$(cd "$(dirname "$0")/.." && pwd)"
SOURCES="$APP/scripts/native-sources.js"
ALLOWED="$(node -e 'process.stdout.write(require(process.argv[1]).NATIVE_SOURCES.bdkwallet.branch)' "$APP/scripts/archive-provenance.js")"
[ "$BRANCH" = "$ALLOWED" ] || {
  echo "✗ bdkwallet is built from the fork's $ALLOWED branch alone, not $BRANCH."
  exit 1
}
[ -d "$FORK_ARG" ] || { echo "✗ No bdk-ffi fork checkout at $FORK_ARG."; exit 1; }
FORK="$(cd "$FORK_ARG" && pwd)"

COMMIT="$(node "$SOURCES" check bdkwallet "$FORK" ${ROLLBACK[@]+"${ROLLBACK[@]}"})" || exit 1

# The frozen target (decided 2026-10-15): bdk-ffi 3.1.1 on uniffi 0.31.2.
MANIFEST="$FORK/bdk-ffi/Cargo.toml"
grep -qx 'version = "3.1.1"' "$MANIFEST" || { echo "✗ $MANIFEST is not bdk-ffi 3.1.1."; exit 1; }
grep -Eq '^uniffi = \{ version = "=0\.31\.2"' "$MANIFEST" || { echo "✗ $MANIFEST does not require uniffi =0.31.2."; exit 1; }

# shellcheck source=/dev/null
source "$HOME/.cargo/env"
# The only environment cargo and the tools it drives get (see above).
CARGO_ENV=()
while IFS= read -r -d '' KV; do CARGO_ENV+=("$KV"); done < <(node "$SOURCES" cargo-env)
[ "${#CARGO_ENV[@]}" -gt 0 ] || { echo "✗ Could not prepare cargo's environment."; exit 1; }
clean_env() { env -i "${CARGO_ENV[@]}" "$@"; }

cd "$FORK/bdk-ffi"
# The compiler that environment really runs, in this folder (rustup reads the
# fork's rust-toolchain.toml from here): 1.97.1, or nothing is built.
RUSTC_VV="$(clean_env rustc -vV)" || { echo "✗ rustc did not answer under the build's environment."; exit 1; }
grep -qx 'release: 1.97.1' <<< "$RUSTC_VV" || {
  echo "✗ The build's rustc is not 1.97.1:"
  echo "$RUSTC_VV"
  exit 1
}
SYSROOT="$(clean_env rustc --print sysroot)"
echo "▸ rustc $(grep '^release:' <<< "$RUSTC_VV" | cut -d' ' -f2) ($(grep '^commit-hash:' <<< "$RUSTC_VV" | cut -d' ' -f2)), sysroot $SYSROOT"

TARGET="$FORK/bdk-ffi/target"
# Bindings and checks go outside the checkout, into a folder of this run.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/build-bdkwallet.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bindings-ios" "$WORK/bindings-sim"
# Every file the app takes from this build is deleted first: a cargo run that
# wrote anywhere else then fails at cp instead of handing over an old file.
rm -f "$TARGET/aarch64-apple-ios/release-smaller/libbdkffi.a" \
      "$TARGET/aarch64-apple-ios-sim/release-smaller/libbdkffi.a" \
      "$TARGET/x86_64-apple-ios/release-smaller/libbdkffi.a" \
      "$TARGET/lipo-ios-sim/libbdkffi.a" \
      "$WORK/bindings-ios/BitcoinDevKit.swift" \
      "$WORK/bindings-ios/BitcoinDevKitFFI.h" \
      "$WORK/duplicate-symbols.txt"

# The Xcode cargo's C builds will use (xcode-select's: clean_env drops DEVELOPER_DIR).
echo "▸ C code compiled by: $(clean_env /usr/bin/xcodebuild -version 2>/dev/null | tr '\n' ' ')(the library's bytes depend on it)"
# --locked: the dependencies are the ones the commit's Cargo.lock names.
# --lib: the static library alone; the uniffi-bindgen tool is built for this Mac below.
clean_env cargo build --locked --target-dir "$TARGET" --package bdk-ffi --lib --profile release-smaller --target aarch64-apple-ios
clean_env cargo build --locked --target-dir "$TARGET" --package bdk-ffi --lib --profile release-smaller --target aarch64-apple-ios-sim
clean_env cargo build --locked --target-dir "$TARGET" --package bdk-ffi --lib --profile release-smaller --target x86_64-apple-ios
mkdir -p "$TARGET/lipo-ios-sim"
clean_env lipo "$TARGET/aarch64-apple-ios-sim/release-smaller/libbdkffi.a" \
     "$TARGET/x86_64-apple-ios/release-smaller/libbdkffi.a" \
     -create -output "$TARGET/lipo-ios-sim/libbdkffi.a"
# The Swift bindings, from the device library's own metadata (and once more
# from the simulator library, which must give the same files).
clean_env cargo run --locked --target-dir "$TARGET" --features uniffi/cli,uniffi/cargo-metadata --bin uniffi-bindgen -- generate "$TARGET/aarch64-apple-ios/release-smaller/libbdkffi.a" --language swift --out-dir "$WORK/bindings-ios" --no-format
clean_env cargo run --locked --target-dir "$TARGET" --features uniffi/cli,uniffi/cargo-metadata --bin uniffi-bindgen -- generate "$TARGET/lipo-ios-sim/libbdkffi.a" --language swift --out-dir "$WORK/bindings-sim" --no-format
clean_env cargo metadata --locked --offline --format-version 1 --manifest-path "$MANIFEST" > "$WORK/metadata.json"

# Still exactly that commit, after cargo read it? Only then is it judged and copied.
node "$SOURCES" recheck bdkwallet "$FORK" "$COMMIT" > /dev/null || exit 1

for F in BitcoinDevKit.swift BitcoinDevKitFFI.h; do
  cmp -s "$WORK/bindings-ios/$F" "$WORK/bindings-sim/$F" || {
    echo "✗ $F generated from the simulator library differs from the device library's."
    exit 1
  }
done
# Swift names an imported C struct by its C name alone, in whichever module it
# comes from, and the linker keeps one copy of its type metadata for the whole
# app: uniffi 0.31's RustBuffer (64-bit lengths) met the old bindings' 32-bit
# RustBuffer and the new library freed a pointer it never allocated (a trial
# link, 2026-10-16). So every C struct the new bindings declare gets the
# prefix BdkWallet, in the header and the Swift alike (the C ABI does not
# change); archive-provenance.js refuses any C struct two libraries' headers
# declare differently.
node "$SOURCES" ffi-prefix BdkWallet "$WORK/bindings-ios/BitcoinDevKitFFI.h" "$WORK/bindings-ios/BitcoinDevKit.swift" || exit 1
node "$SOURCES" vendored "$WORK/metadata.json" "$FORK/bdk-ffi" electrum-client bdk_wallet || exit 1
node "$SOURCES" minos ios "$TARGET/aarch64-apple-ios/release-smaller/libbdkffi.a" "$SYSROOT" || exit 1
node "$SOURCES" minos sim "$TARGET/lipo-ios-sim/libbdkffi.a" "$SYSROOT" || exit 1
# The symbol-overlap gate over EVERY pair of libraries the app links, on both
# slices: this build against each pinned library, and the pinned libraries
# against each other (decided 2026-10-17: the old engine's bdkffi and bitboxffi
# defined four uniffi_core functions twice). Its DUPLICATE lines, tagged with their
# pair, are the only duplicates the link may report (native-sources.js
# link-check); the reports and the list go into this run's work folder.
clean_env node "$SOURCES" gate bdkwallet "$FORK" "$WORK" "$SYSROOT" || exit 1

mkdir -p "$APP/native/bdkwallet/lib" "$APP/native/bdkwallet/ffi"
cp "$TARGET/aarch64-apple-ios/release-smaller/libbdkffi.a" "$APP/native/bdkwallet/lib/libbdkwallet-ios.a"
cp "$TARGET/lipo-ios-sim/libbdkffi.a" "$APP/native/bdkwallet/lib/libbdkwallet-sim.a"
cp "$WORK/bindings-ios/BitcoinDevKit.swift" "$APP/native/bdkwallet/BitcoinDevKit.swift"
cp "$WORK/bindings-ios/BitcoinDevKitFFI.h" "$APP/native/bdkwallet/ffi/BitcoinDevKitFFI.h"
cp "$WORK/duplicate-symbols.txt" "$APP/native/bdkwallet/duplicate-symbols.txt"
node "$SOURCES" record bdkwallet "$COMMIT" "$FORK" "$WORK"
echo "bdkwallet fork artifacts refreshed (try them on the simulator first): test them on the phone (scripts/ios-device.sh takes this recorded build before it is pinned), then pin (node scripts/native-sources.js pin bdkwallet)"
