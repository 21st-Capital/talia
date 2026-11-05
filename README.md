# Talia

Talia is 21st Capital's Bitcoin wallet for iPhone. It is descriptor-native and
watch-only: every vault is an
[output descriptor](https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki),
the phone holds public keys only, and every signature comes from a hardware
signing device. One app holds single-sig vaults, multisig vaults and Liana-style
vaults with timelocked recovery paths, all through one wallet engine:
[BDK](https://bitcoindevkit.org), in a fork of bdk-ffi 3.1.1 behind the app's own
Swift bridge.

This repository is the public copy of the app's source. Its history starts at
the first publication, and every App Store release adds one commit, made by
`scripts/public-export.sh` with `--onto` in a clone of this repository. See [CONTRIBUTING.md](CONTRIBUTING.md)
before you open an issue, and [SECURITY.md](SECURITY.md) to report a
vulnerability.

## What the app does

- **Adds vaults** from a descriptor or an extended public key, pasted, scanned
  or opened as a file: Liana (descriptor, plain wallet backup, and the encrypted
  `.bed` and `.bip138` backups), Sparrow (descriptor QR and its Electrum export,
  which brings the key names), Bitcoin Core, Electrum, BlueWallet, another Talia,
  or straight from a hardware device. A descriptor that carries private key
  material is refused (`src/bitcoin/descriptor/validate.ts`).
- **Builds vaults** (single-sig, multisig, and vaults with timelocked recovery
  and heir paths) from keys read off hardware devices
  (`src/bitcoin/descriptor/compose.ts`).
- **Syncs** each vault over Electrum, shows balances, history, coins and receive
  addresses, and checks a receive address on the device's own screen.
- **Sends** by building a PSBT that a hardware device signs. Talia never holds a
  private key.
- **Portfolios**: holdings kept by hand, optionally fed from a vault's history or
  from Kraken or Coinbase through a read-only API key that stays on the phone.
- **21st Capital's services**, for clients signed in with an emailed code:
  co-signing, the rescue key, the Estate Plan and heir invites, and an
  end-to-end encrypted sync of portfolios.

Two networks only: Bitcoin and Testnet4.

### Signing devices

Defined in one registry, `src/wallet/deviceKinds.ts`:

| Device | Connection | Vaults |
|---|---|---|
| Ledger Nano Gen5, Flex, Stax, Nano X | Bluetooth | single-sig and multisig, taproot miniscript included |
| BitBox02 Nova | Bluetooth | single-sig and multisig, taproot miniscript included |
| Foundation Passport | QR (BC-UR) | single-sig only |

How a device is picked, connected, shown a vault and asked to sign is written up
in [docs/hardware-signing.md](docs/hardware-signing.md). The screen rules are in
[docs/design-rules.md](docs/design-rules.md).

## Build flavours

One commit builds every flavour. The flags are environment variables read at
build time and inlined by `babel-plugin-talia-flags.js` (`src/config.ts` reads
them); an unset flag is off.

| Flag | What it gives |
|---|---|
| none | The App Store app: adding vaults, sync, receive, portfolios, the Estate Plan, heir invites and the rescue. No hardware signing surface and no vault building. |
| `TALIA_HWW=1` | Adds the hardware surface: pairing a Ledger or BitBox over Bluetooth, registering a vault on it, the address check, signing, and building vaults. This is the TestFlight app. |
| `TALIA_FULL=1` | Everything in `TALIA_HWW`, plus test-only tools such as timelocks counted in minutes instead of months. For development phones only; `scripts/ios-archive.sh` refuses an archive that carries it. |
| `TALIA_SIDE=1` or `2` | Read by `scripts/ios-device.sh` alone: installs a second copy beside the App Store app, with its own bundle id and name (`com.twentyfirstcapital.keel.test`, "Talia Test"; `2` gives `.test2`, "Talia Test 2"). The script refuses to build for a phone without it, unless `TALIA_MAIN_ID=1`. |

`TALIA_PURCHASES` is kept for the archive's checks only: no build sells anything
in the app. `TALIA_HARNESS` is the simulator harness below.

Metro caches transforms, so clear its cache when you change a flag
(`scripts/ios-device.sh` does it for you).

## Building the app

You need macOS with Xcode, Node 22.11 or later, Ruby with Bundler for CocoaPods,
and the two native libraries described in the next section.

```sh
npm ci                                   # also applies patches/ (patch-package)
cd ios && bundle install && bundle exec pod install && cd ..
```

Then either:

- **Simulator:** `scripts/ios-sim.sh <simulator udid> Release` builds for the
  arm64 simulator, signed to run locally (no Apple team needed), with the
  simulator copies of the native libraries.
- **Xcode:** open `ios/KeelWallet.xcworkspace` and run the `KeelWallet` scheme on
  a phone. The pods link the device libraries (`lib*-ios.a`); for the simulator
  use `scripts/ios-sim.sh`, which puts the simulator libraries in their place.
- **A phone:** `TALIA_SIDE=1 TALIA_FULL=1 scripts/ios-device.sh <device udid> Release`.

`scripts/ios-device.sh` and `scripts/ios-sim.sh` first check every native
library against its pin in `native/native-libs.sha256` and refuse one that
differs. Xcode on its own does not.

### Your own Apple team and bundle id

The Xcode project names 21st Capital's team and the bundle id
`com.twentyfirstcapital.keel`. To build onto your own phone, set your team and
a bundle id of your own on the `KeelWallet` target (Signing & Capabilities), or
pass them to `xcodebuild`:

```sh
xcodebuild -workspace ios/KeelWallet.xcworkspace -scheme KeelWallet \
  -configuration Release -destination 'generic/platform=iOS' \
  DEVELOPMENT_TEAM=<your team id> PRODUCT_BUNDLE_IDENTIFIER=<your.bundle.id> build
```

The app declares no entitlements, so any team can sign it. The home-screen name
is the `TALIA_DISPLAY_NAME` build setting ("Talia"). `scripts/ios-device.sh`
writes the side copy's bundle id itself (`SIDE_ID` in the script), so change
that too if you use the script with another team. `scripts/ios-archive.sh` is
21st Capital's release script: it refuses an archive that is not
`com.twentyfirstcapital.keel`.

### Developing the UI without a server

`USE_FAKE_ENGINE` in `src/wallet/engineProvider.ts` swaps the wallet engine for
an in-memory fake, so the screens run with no Electrum server. The iOS build
still links the native libraries through its pods, so they must be in place.

## Native libraries

Git does not hold the static libraries; `native/native-libs.sha256` pins every
file by SHA-256 together with the commit it was built from.

| Folder | Pod | Library | Built from |
|---|---|---|---|
| `native/bdkwallet` | `TaliaBdkWallet` | `lib/libbdkwallet-ios.a`, `lib/libbdkwallet-sim.a` | [talia-bdk-ffi](https://github.com/21st-Capital/talia-bdk-ffi), a fork of bdk-ffi 3.1.1 (branch `talia-3`) |
| `native/bitboxffi` | `BitBoxFFI` | `lib/libbitboxffi-ios.a`, `lib/libbitboxffi-sim.a` | [talia-bitbox-ffi](https://github.com/21st-Capital/talia-bitbox-ffi): bitbox-api 0.13 over uniffi |
| `native/taliapasteboard` | `TaliaPasteboard` | none (one Objective-C file) | this repository |

The Swift bindings the forks generate (`native/bdkwallet/BitcoinDevKit.swift`,
`native/bitboxffi/bitbox.swift` and their C headers) are committed; the
bdkwallet ones are pinned in `native/native-libs.sha256` as well.
`native/bdkwallet/bridge` and `native/bitboxffi/BitboxModule.swift` are the
app's own React Native modules over them.

`native/build-bdkwallet.sh` and `native/build-bitboxffi.sh` build a library from
a clean checkout of its fork and record the build; `node
scripts/native-sources.js pin <library>` pins a tested build, and `node
scripts/native-sources.js verify` checks what is on disk. In this copy that
tooling still names the forks' original repositories, which are private
(`NATIVE_SOURCES` in `scripts/archive-provenance.js`, `COPIES` in
`scripts/native-sources.js`), so the build scripts and `native-sources.js
restore` cannot run from a public clone yet. Until they name the public forks,
build each library as its fork's README describes and put the files where the
table says. Each fork's README also lists what a byte-for-byte rebuild needs
(the same toolchain, Xcode and Cargo home folder, and for the BitBox library the
same checkout path), without which your library will not match the pin and the
scripts above will refuse it.

## Services the app contacts

| What | Where | When |
|---|---|---|
| Chain data and broadcasts (Electrum) | A Bitcoin vault: the server saved in Settings, otherwise `electrum.blockstream.info`. Testnet4: built-in servers (`src/bitcoin/network.ts`) | Every sync and send. A Bitcoin vault talks to its one server and no other (`src/wallet/chainServers.ts`). |
| Block explorer (Esplora) | `blockstream.info`, `mempool.space` (Testnet4) | The transaction page's details: for a Bitcoin vault only while no server is chosen in Settings |
| Fee rates and recent blocks | `mempool.space`, then `blockstream.info` when it does not answer | Send and the fee sheet |
| Prices, charts and exchange rates | `mempool.space`, `api.coingecko.com`, `api.binance.com`, `stream.binance.com`, `api.frankfurter.dev` | The price displays; skipped with Settings' Bitcoin-only mode |
| 21st Capital's backend | `backend.21stcapital.com` | Only when signed in: plans, co-signing, the rescue, the Estate Plan, heir invites, portfolio sync (end-to-end encrypted) |
| 21st Capital's website | `21stcapital.com` | Links the client taps: support, booking, terms |
| Exchanges | `api.kraken.com`, `api.coinbase.com` | Only for a portfolio connected to one, with the client's read-only key |

Hardware devices are reached over Bluetooth or by QR on the phone itself; no
server is involved.

## Running the tests

From a git clone (several tests read git: the scans of tracked files, and the
checks of the native-source and archive tooling, which build throwaway
repositories):

```sh
npm ci
npx tsc --noEmit
npx jest
```

The tests are pure TypeScript and run in Node with no native module and no
network. CI runs the same on every push and pull request to `main`
(`.github/workflows/ci.yml`). The checks that read a private list of retired
21st Capital seeds skip that part in this copy and say so in their titles.

## For maintainers only

`scripts/tier-c/run.py` and `src/harness/` are the simulator harness: the
app's real Swift bridge and engine in the iOS simulator against regtest
`bitcoind` and electrs, compared with the library fork's own test runner. It
needs the fork's private equivalence harness, which the public forks do not
carry, so it cannot run from a public clone. A build with `TALIA_HARNESS=1`
boots into its runner, in the simulator only.

`scripts/ios-archive.sh` (App Store and TestFlight archives),
`scripts/archive-provenance.js` and `scripts/public-export.sh` are 21st
Capital's release tooling.

## Old names

Talia was first called Keel, then Tiam. Some names stay because installed apps
and Apple's records depend on them: the Xcode project, workspace, scheme and
target `KeelWallet`, the bundle id `com.twentyfirstcapital.keel`, storage keys
that begin with `keel.`, and the `tiam://` link scheme, which the app still reads
beside `talia://` (`src/services/deepLinks.ts`; no link signs anyone in).

## Layout

```
src/bitcoin/     descriptors, the wallet engine interface and its BDK engine, PSBTs, devices
src/wallet/      app state, vault storage and the rules the screens use (pure, tested)
src/services/    21st Capital's backend, exchanges and other I/O
src/crypto/      sealed backups, invites and sync envelopes
src/platform/    wrappers around native modules (camera, files, Bluetooth, biometrics)
src/ui/          screens, components, navigation and theme
native/          the native libraries' pods and the app's Swift bridges
scripts/         build, release and fixture tools
docs/            hardware signing and design rules
```

The UI never imports the wallet library: it depends on the `WalletEngine`
interface (`src/bitcoin/engine/types.ts`), and `src/bitcoin/engine/bdkWalletEngine.ts`
is the one part of the app that works through the native bridge. Besides it,
only the known-answer check run at launch (`src/bitcoin/engine/bdkWalletSmoke.ts`)
and the maintainers' simulator harness (`src/harness/`) call the bridge directly.

## Licence

Talia is licensed under the Apache License 2.0 ([LICENSE](LICENSE), with
[NOTICE](NOTICE)). The names and logos of Talia and 21st Capital are not
licensed: see [TRADEMARKS.md](TRADEMARKS.md). The fonts, the native libraries and
the npm packages the app ships with keep their own licences:
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
