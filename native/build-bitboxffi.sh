#!/bin/bash
# Rebuild the bitbox-ffi static libraries and refresh the committed bindings.
# The crate is 21st Capital's PRIVATE repo https://github.com/21st-Capital/bitbox-ffi
# (branch main); its checkout lives at ../bitbox-ffi, or $BITBOX_FFI_DIR.
# Like native/build-bdkwallet.sh, the ~90MB .a files are NOT in git (see
# .gitignore); run this after checking out fresh or after changing the crate.
# Needs rustup with the iOS targets (rust-toolchain.toml in the crate pins
# them, so `cargo build` installs what it needs).
#
# Where the library came from (decided 2026-09-26): the build refuses
# unless the checkout is exactly its HEAD commit, that commit is on the org
# repo's main branch (fetched first; a change gets there through a
# reviewed pull request, and a commit only on another branch is refused) and
# contains the commit the record names, in the working tree and in the app's
# last commit (so a build never goes backwards by accident), and no cargo
# config or Rust toolchain file sits above the checkout. Building an OLDER
# commit of the branch is a rollback, a release decision and never the way
# past a refusal, and it is named:
#   native/build-bitboxffi.sh --rollback <commit>
# It still has to be on the branch. cargo runs with an allowlisted environment
# (scripts/native-sources.js cargo-env: no CARGO_TARGET_DIR,
# RUSTFLAGS, RUSTC_WRAPPER, CC, ...) into a target folder it is told, after
# the files the app takes are deleted, so nothing an earlier build left can be
# copied as this one's. If the checkout moved while cargo read it, nothing is
# copied into the app; otherwise the script writes the commit and the digest
# of each library it copied into native/native-libs.sha256 ("# source
# bitboxffi" and "# built bitboxffi" lines). Test them on the phone first:
# scripts/ios-device.sh takes a recorded build before it is pinned (and says
# so). Then pin them (node scripts/native-sources.js pin bitboxffi) and
# commit the record and the pins together: scripts/ios-archive.sh refuses
# anything else.
#
# What the library's bytes depend on: the commit, its Cargo.lock, the Rust
# compiler its rust-toolchain.toml names, AND the Xcode installed here. The
# C code inside (secp256k1) is compiled by Xcode's own clang against its iOS
# SDK, and every C object records that SDK's version, so a rebuild after an
# Xcode update gives other bytes (it prints the version).
set -euo pipefail
# The one option: --rollback <commit>, passed to the source check as it is.
ROLLBACK=()
while [ $# -gt 0 ]; do
  case "$1" in
    --rollback)
      [ $# -ge 2 ] && [ -n "$2" ] || { echo "✗ --rollback needs the commit being built (the checkout's HEAD)."; exit 64; }
      ROLLBACK=(--rollback "$2")
      shift 2
      ;;
    *) echo "usage: native/build-bitboxffi.sh [--rollback <commit>]"; exit 64 ;;
  esac
done
APP="$(cd "$(dirname "$0")/.." && pwd)"
CRATE_DIR="${BITBOX_FFI_DIR:-$APP/../bitbox-ffi}"
[ -d "$CRATE_DIR" ] || { echo "✗ No bitbox-ffi checkout at $CRATE_DIR (set BITBOX_FFI_DIR)."; exit 1; }
CRATE="$(cd "$CRATE_DIR" && pwd)"
OUT="$APP/native/bitboxffi"
SOURCES="$APP/scripts/native-sources.js"

COMMIT="$(node "$SOURCES" check bitboxffi "$CRATE" ${ROLLBACK[@]+"${ROLLBACK[@]}"})" || exit 1

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi
# The only environment cargo and the tools it drives get (see above).
CARGO_ENV=()
while IFS= read -r -d '' KV; do CARGO_ENV+=("$KV"); done < <(node "$SOURCES" cargo-env)
[ "${#CARGO_ENV[@]}" -gt 0 ] || { echo "✗ Could not prepare cargo's environment."; exit 1; }
clean_env() { env -i "${CARGO_ENV[@]}" "$@"; }

TARGET="$CRATE/target"
# Every file the app takes from this build is deleted first: a cargo run that
# wrote anywhere else then fails at cp instead of handing over an old file.
rm -f "$TARGET/aarch64-apple-ios/release/libbitboxffi.a" \
      "$TARGET/aarch64-apple-ios-sim/release/libbitboxffi.a" \
      "$CRATE/generated/bitbox.swift" \
      "$CRATE/generated/bitboxFFI.h"

cd "$CRATE"
# The Xcode cargo's C builds will use (xcode-select's: clean_env drops DEVELOPER_DIR).
echo "▸ C code compiled by: $(clean_env /usr/bin/xcodebuild -version 2>/dev/null | tr '\n' ' ')(the library's bytes depend on it)"
# --locked: the dependencies are the ones the commit's Cargo.lock names.
clean_env cargo build --locked --target-dir "$TARGET" --release --target aarch64-apple-ios
clean_env cargo build --locked --target-dir "$TARGET" --release --target aarch64-apple-ios-sim
clean_env cargo run --locked --target-dir "$TARGET" --release --bin uniffi-bindgen -- generate src/bitbox.udl --language swift --out-dir generated

# Still exactly that commit, after cargo read it? Only then into the app.
node "$SOURCES" recheck bitboxffi "$CRATE" "$COMMIT" > /dev/null || exit 1
mkdir -p "$OUT/lib"
mkdir -p "$OUT/ffi"
cp "$CRATE/generated/bitbox.swift" "$OUT/"
cp "$CRATE/generated/bitboxFFI.h" "$OUT/ffi/"
cp "$TARGET/aarch64-apple-ios/release/libbitboxffi.a" "$OUT/lib/libbitboxffi-ios.a"
cp "$TARGET/aarch64-apple-ios-sim/release/libbitboxffi.a" "$OUT/lib/libbitboxffi-sim.a"
node "$SOURCES" record bitboxffi "$COMMIT" "$CRATE"
echo "▸ Then rebuild bdkwallet (native/build-bdkwallet.sh): its symbol-overlap gate must judge this library before anything links the two (verify refuses until then)."
echo "bitbox-ffi refreshed into $OUT: test it on the phone (scripts/ios-device.sh takes this recorded build before it is pinned), then pin (node scripts/native-sources.js pin bitboxffi)"
