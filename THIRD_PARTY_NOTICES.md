# Third-party notices

Talia's own code is licensed under the Apache License 2.0 (see [LICENSE](LICENSE)
and [NOTICE](NOTICE)). The app also ships, or is built from, the third-party
components below, each under its own licence.

## Fonts

| Font | Files | Licence |
|---|---|---|
| Bricolage Grotesque, Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) | `assets/fonts/BricolageGrotesque-*.ttf` | SIL Open Font License 1.1, [`assets/fonts/OFL-BricolageGrotesque.txt`](assets/fonts/OFL-BricolageGrotesque.txt) |
| Figtree, Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree) | `assets/fonts/Figtree-*.ttf` | SIL Open Font License 1.1, [`assets/fonts/OFL-Figtree.txt`](assets/fonts/OFL-Figtree.txt) |

## Native libraries

The two static libraries the app links are built from forks that 21st Capital
publishes with their full source (see the README's "Native libraries"):

- **[talia-bdk-ffi](https://github.com/21st-Capital/talia-bdk-ffi)**, a fork of
  [bitcoindevkit/bdk-ffi](https://github.com/bitcoindevkit/bdk-ffi) 3.1.1,
  licensed MIT OR Apache-2.0 as upstream is. It carries patched copies of
  `bdk_wallet`, `bdk_electrum` and `electrum-client`, which keep their
  authors' notices. Its library and the Swift bindings generated from it
  (`native/bdkwallet/BitcoinDevKit.swift`, `native/bdkwallet/ffi/BitcoinDevKitFFI.h`)
  are in the app.
- **[talia-bitbox-ffi](https://github.com/21st-Capital/talia-bitbox-ffi)**,
  licensed Apache-2.0. It carries bitbox-api 0.13.0, Copyright 2023-2025 Shift
  Crypto AG, Switzerland (Apache-2.0). Its library and the Swift bindings
  generated from it (`native/bitboxffi/bitbox.swift`,
  `native/bitboxffi/ffi/bitboxFFI.h`) are in the app.

Both libraries also contain Rust crates from crates.io, each under its own
licence, as their `Cargo.lock` files pin them. Among them is
[uniffi](https://github.com/mozilla/uniffi-rs) (0.31.2 in talia-bdk-ffi, 0.23.0
in talia-bitbox-ffi), licensed under the Mozilla Public License 2.0; its source
is at https://github.com/mozilla/uniffi-rs.

## CocoaPods

Two pods come from the CocoaPods trunk (`ios/Podfile.lock`); the others come
with the npm packages below (React Native's own pods, Hermes and the native
parts of the React Native libraries) or from this repository (`native/`).

| Pod | Version | Licence |
|---|---|---|
| MultiplatformBleAdapter | 0.2.0 | Apache-2.0 |
| ZXingObjC | 3.6.9 | Apache-2.0 |

## npm packages

The app's production dependencies as `package-lock.json` resolves them (every
package it marks neither `dev` nor `devOptional`), with each package's licence
as its own `package.json` states it. Development tools (the test runner, the
type checker, linters, most of Babel's plugins) are left out. The list still
holds React Native's build tooling (Metro, Babel's core, the command line
tools), which runs on the build machine and does not ship inside the app. Each package's licence
text and copyright notice is in its own folder under `node_modules/` after
`npm ci`.

418 packages:

| Licence | Packages |
|---|---|
| MIT | 345 |
| ISC | 26 |
| Apache-2.0 | 18 |
| BSD-3-Clause | 11 |
| BSD-2-Clause | 8 |
| 0BSD | 3 |
| (MIT AND BSD-3-Clause) | 1 |
| (MIT AND Zlib) | 1 |
| (MIT OR Apache-2.0) | 1 |
| (MIT OR CC0-1.0) | 1 |
| (Unlicense OR Apache-2.0) | 1 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |

### Direct dependencies

The packages `package.json` names (41):

| Package | Version | Licence |
|---|---|---|
| @keystonehq/bc-ur-registry | 0.8.0 | Apache-2.0 |
| @ledgerhq/device-management-kit | 1.8.0 | Apache-2.0 |
| @ledgerhq/device-signer-kit-bitcoin | 1.3.3 | Apache-2.0 |
| @ledgerhq/device-transport-kit-react-native-ble | 1.3.2 | Apache-2.0 |
| @ngraveio/bc-ur | 1.1.13 | MIT |
| @noble/ciphers | 1.3.0 | MIT |
| @noble/curves | 1.6.0 | MIT |
| @noble/hashes | 1.8.0 | MIT |
| @notifee/react-native | 9.1.8 | Apache-2.0 |
| @react-native-async-storage/async-storage | 2.2.0 | MIT |
| @react-native-clipboard/clipboard | 1.16.3 | MIT |
| @react-native-community/blur | 4.4.1 | MIT |
| @react-native-documents/picker | 12.0.1 | MIT |
| @react-native/new-app-screen | 0.86.0 | MIT |
| @react-navigation/bottom-tabs | 7.18.8 | MIT |
| @react-navigation/native | 7.3.8 | MIT |
| @react-navigation/native-stack | 7.17.10 | MIT |
| @scure/base | 1.2.6 | MIT |
| @scure/btc-signer | 1.8.1 | MIT |
| bitcoinjs-lib | 6.1.7 | MIT |
| buffer | 5.7.1 | MIT |
| pako | 3.0.1 | (MIT AND Zlib) |
| react | 19.2.3 | MIT |
| react-native | 0.86.0 | MIT |
| react-native-biometrics | 3.0.1 | MIT |
| react-native-ble-plx | 3.4.0 | MIT |
| react-native-camera-kit | 18.0.0 | MIT |
| react-native-fs | 2.20.0 | MIT |
| react-native-get-random-values | 1.11.0 | MIT |
| react-native-haptic-feedback | 3.0.0 | MIT |
| react-native-image-picker | 8.2.1 | MIT |
| react-native-keychain | 10.0.0 | MIT |
| react-native-mail | 6.1.1 | MIT |
| react-native-qrcode-svg | 6.3.21 | MIT |
| react-native-safe-area-context | 5.8.0 | MIT |
| react-native-screens | 4.26.0 | MIT |
| react-native-share | 12.3.1 | MIT |
| react-native-svg | 15.15.5 | MIT |
| react-native-webview | 14.0.1 | MIT |
| rn-qr-generator | 2.0.0 | MIT |
| rxjs | 7.8.2 | Apache-2.0 |

### Every package

| Package | Version | Licence |
|---|---|---|
| @babel/code-frame | 7.29.7 | MIT |
| @babel/compat-data | 7.29.7 | MIT |
| @babel/core | 7.29.7 | MIT |
| @babel/generator | 7.29.7 | MIT |
| @babel/helper-compilation-targets | 7.29.7 | MIT |
| @babel/helper-globals | 7.29.7 | MIT |
| @babel/helper-module-imports | 7.29.7 | MIT |
| @babel/helper-module-transforms | 7.29.7 | MIT |
| @babel/helper-string-parser | 7.29.7 | MIT |
| @babel/helper-validator-identifier | 7.29.7 | MIT |
| @babel/helper-validator-option | 7.29.7 | MIT |
| @babel/helpers | 7.29.7 | MIT |
| @babel/parser | 7.29.7 | MIT |
| @babel/runtime | 7.29.7 | MIT |
| @babel/template | 7.29.7 | MIT |
| @babel/traverse | 7.29.7 | MIT |
| @babel/types | 7.29.7 | MIT |
| @inversifyjs/common | 1.5.0 | MIT |
| @inversifyjs/container | 1.9.1 | MIT |
| @inversifyjs/core | 5.2.0 | MIT |
| @inversifyjs/prototype-utils | 0.1.0 | MIT |
| @inversifyjs/reflect-metadata-utils | 1.1.0 | MIT |
| @isaacs/ttlcache | 1.4.1 | ISC |
| @jest/schemas | 29.6.3 | MIT |
| @jest/types | 29.6.3 | MIT |
| @jridgewell/gen-mapping | 0.3.13 | MIT |
| @jridgewell/remapping | 2.3.5 | MIT |
| @jridgewell/resolve-uri | 3.1.2 | MIT |
| @jridgewell/source-map | 0.3.11 | MIT |
| @jridgewell/sourcemap-codec | 1.5.5 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @keystonehq/alias-sampling | 0.1.2 | MIT |
| @keystonehq/bc-ur-registry | 0.8.0 | Apache-2.0 |
| @ledgerhq/device-management-kit | 1.8.0 | Apache-2.0 |
| @ledgerhq/device-signer-kit-bitcoin | 1.3.3 | Apache-2.0 |
| @ledgerhq/device-transport-kit-react-native-ble | 1.3.2 | Apache-2.0 |
| @ledgerhq/signer-utils | 1.3.0 | Apache-2.0 |
| @ngraveio/bc-ur | 1.1.13 | MIT |
| @noble/ciphers | 1.3.0 | MIT |
| @noble/curves | 1.6.0 | MIT |
| @noble/curves | 1.9.7 | MIT |
| @noble/hashes | 1.5.0 | MIT |
| @noble/hashes | 1.8.0 | MIT |
| @notifee/react-native | 9.1.8 | Apache-2.0 |
| @react-native-async-storage/async-storage | 2.2.0 | MIT |
| @react-native-clipboard/clipboard | 1.16.3 | MIT |
| @react-native-community/blur | 4.4.1 | MIT |
| @react-native-documents/picker | 12.0.1 | MIT |
| @react-native/assets-registry | 0.86.0 | MIT |
| @react-native/codegen | 0.86.0 | MIT |
| @react-native/community-cli-plugin | 0.86.0 | MIT |
| @react-native/debugger-frontend | 0.86.0 | BSD-3-Clause |
| @react-native/debugger-shell | 0.86.0 | MIT |
| @react-native/dev-middleware | 0.86.0 | MIT |
| @react-native/gradle-plugin | 0.86.0 | MIT |
| @react-native/js-polyfills | 0.86.0 | MIT |
| @react-native/new-app-screen | 0.86.0 | MIT |
| @react-native/normalize-colors | 0.86.0 | MIT |
| @react-native/virtualized-lists | 0.86.0 | MIT |
| @react-navigation/bottom-tabs | 7.18.8 | MIT |
| @react-navigation/core | 7.21.5 | MIT |
| @react-navigation/elements | 2.9.30 | MIT |
| @react-navigation/native | 7.3.8 | MIT |
| @react-navigation/native-stack | 7.17.10 | MIT |
| @react-navigation/routers | 7.6.0 | MIT |
| @scure/base | 1.2.6 | MIT |
| @scure/btc-signer | 1.8.1 | MIT |
| @sentry/hub | 6.19.7 | BSD-3-Clause |
| @sentry/minimal | 6.19.7 | BSD-3-Clause |
| @sentry/types | 6.19.7 | BSD-3-Clause |
| @sentry/utils | 6.19.7 | BSD-3-Clause |
| @sinclair/typebox | 0.27.10 | MIT |
| @types/crypto-js | 4.2.2 | MIT |
| @types/istanbul-lib-coverage | 2.0.6 | MIT |
| @types/istanbul-lib-report | 3.0.3 | MIT |
| @types/istanbul-reports | 3.0.4 | MIT |
| @types/json-schema | 7.0.15 | MIT |
| @types/node | 26.1.1 | MIT |
| @types/yargs | 17.0.35 | MIT |
| @types/yargs-parser | 21.0.3 | MIT |
| abort-controller | 3.0.0 | MIT |
| accepts | 2.0.0 | MIT |
| acorn | 8.17.0 | MIT |
| agent-base | 7.1.4 | MIT |
| anser | 1.4.10 | MIT |
| ansi-regex | 5.0.1 | MIT |
| ansi-styles | 4.3.0 | MIT |
| ansi-styles | 5.2.0 | MIT |
| asap | 2.0.6 | MIT |
| assert | 2.1.0 | MIT |
| async-limiter | 1.0.1 | MIT |
| available-typed-arrays | 1.0.7 | MIT |
| babel-plugin-syntax-hermes-parser | 0.36.0 | MIT |
| base-64 | 0.1.0 | MIT |
| base-x | 3.0.11 | MIT |
| base-x | 4.0.1 | MIT |
| base64-js | 1.5.1 | MIT |
| baseline-browser-mapping | 2.10.42 | Apache-2.0 |
| bech32 | 2.0.0 | MIT |
| bignumber.js | 9.3.1 | MIT |
| bip174 | 2.1.1 | MIT |
| bitcoinjs-lib | 6.1.7 | MIT |
| boolbase | 1.0.0 | ISC |
| braces | 3.0.3 | MIT |
| browserslist | 4.28.5 | MIT |
| bs58 | 4.0.1 | MIT |
| bs58 | 5.0.0 | MIT |
| bs58check | 2.1.2 | MIT |
| bs58check | 3.0.1 | MIT |
| bser | 2.1.1 | Apache-2.0 |
| buffer | 5.7.1 | MIT |
| buffer-from | 1.1.2 | MIT |
| call-bind | 1.0.9 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| camelcase | 5.3.1 | MIT |
| camelcase | 6.3.0 | MIT |
| caniuse-lite | 1.0.30001803 | CC-BY-4.0 |
| cbor-sync | 1.0.4 | MIT |
| chalk | 4.1.2 | MIT |
| chrome-launcher | 0.15.2 | Apache-2.0 |
| chromium-edge-launcher | 0.3.0 | Apache-2.0 |
| ci-info | 2.0.0 | MIT |
| ci-info | 3.9.0 | MIT |
| cipher-base | 1.0.7 | MIT |
| cliui | 6.0.0 | ISC |
| cliui | 8.0.1 | ISC |
| color | 4.2.3 | MIT |
| color-convert | 2.0.1 | MIT |
| color-name | 1.1.4 | MIT |
| color-string | 1.9.1 | MIT |
| commander | 12.1.0 | MIT |
| commander | 2.20.3 | MIT |
| connect | 3.7.0 | MIT |
| convert-source-map | 2.0.0 | MIT |
| core-util-is | 1.0.2 | MIT |
| crc | 3.8.0 | MIT |
| create-hash | 1.2.0 | MIT |
| cross-spawn | 7.0.6 | MIT |
| crypto-js | 4.2.0 | MIT |
| css-select | 5.2.2 | BSD-2-Clause |
| css-tree | 1.1.3 | MIT |
| css-what | 6.2.2 | BSD-2-Clause |
| debug | 2.6.9 | MIT |
| debug | 4.4.3 | MIT |
| decamelize | 1.2.0 | MIT |
| decode-uri-component | 0.2.2 | MIT |
| define-data-property | 1.1.4 | MIT |
| define-properties | 1.2.1 | MIT |
| depd | 2.0.0 | MIT |
| destroy | 1.2.0 | MIT |
| dijkstrajs | 1.0.3 | MIT |
| dom-serializer | 2.0.0 | MIT |
| domelementtype | 2.3.0 | BSD-2-Clause |
| domhandler | 5.0.3 | BSD-2-Clause |
| domutils | 3.2.2 | BSD-2-Clause |
| dunder-proto | 1.0.1 | MIT |
| ee-first | 1.1.1 | MIT |
| electron-to-chromium | 1.5.389 | ISC |
| emoji-regex | 8.0.0 | MIT |
| encodeurl | 1.0.2 | MIT |
| encodeurl | 2.0.0 | MIT |
| entities | 4.5.0 | BSD-2-Clause |
| error-stack-parser | 2.1.4 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.2 | MIT |
| escalade | 3.2.0 | MIT |
| escape-html | 1.0.3 | MIT |
| escape-string-regexp | 4.0.0 | MIT |
| etag | 1.8.1 | MIT |
| event-target-shim | 5.0.1 | MIT |
| exponential-backoff | 3.1.3 | Apache-2.0 |
| fast-base64-decode | 1.0.0 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fb-dotslash | 0.5.8 | (MIT OR Apache-2.0) |
| fb-watchman | 2.0.2 | Apache-2.0 |
| fdir | 6.5.0 | MIT |
| fill-range | 7.1.1 | MIT |
| filter-obj | 1.1.0 | MIT |
| finalhandler | 1.1.2 | MIT |
| find-up | 4.1.0 | MIT |
| flow-enums-runtime | 0.0.6 | MIT |
| for-each | 0.3.5 | MIT |
| fresh | 0.5.2 | MIT |
| function-bind | 1.1.2 | MIT |
| generator-function | 2.0.1 | MIT |
| gensync | 1.0.0-beta.2 | MIT |
| get-caller-file | 2.0.5 | ISC |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| gopd | 1.2.0 | MIT |
| graceful-fs | 4.2.11 | ISC |
| has-flag | 4.0.0 | MIT |
| has-property-descriptors | 1.0.2 | MIT |
| has-symbols | 1.1.0 | MIT |
| has-tostringtag | 1.0.2 | MIT |
| hash-base | 3.1.2 | MIT |
| hasown | 2.0.4 | MIT |
| hermes-compiler | 250829098.0.14 | MIT |
| hermes-estree | 0.35.0 | MIT |
| hermes-estree | 0.36.0 | MIT |
| hermes-parser | 0.35.0 | MIT |
| hermes-parser | 0.36.0 | MIT |
| http-errors | 2.0.1 | MIT |
| https-proxy-agent | 7.0.6 | MIT |
| ieee754 | 1.2.1 | BSD-3-Clause |
| image-size | 1.2.1 | MIT |
| inherits | 2.0.4 | ISC |
| invariant | 2.2.4 | MIT |
| inversify | 7.5.1 | MIT |
| is-arguments | 1.2.0 | MIT |
| is-arrayish | 0.3.4 | MIT |
| is-callable | 1.2.7 | MIT |
| is-docker | 2.2.1 | MIT |
| is-fullwidth-code-point | 3.0.0 | MIT |
| is-generator-function | 1.1.2 | MIT |
| is-nan | 1.3.2 | MIT |
| is-number | 7.0.0 | MIT |
| is-plain-obj | 2.1.0 | MIT |
| is-regex | 1.2.1 | MIT |
| is-typed-array | 1.1.15 | MIT |
| is-wsl | 2.2.0 | MIT |
| isarray | 1.0.0 | MIT |
| isarray | 2.0.5 | MIT |
| isexe | 2.0.0 | ISC |
| isomorphic-ws | 5.0.0 | MIT |
| jest-get-type | 29.6.3 | MIT |
| jest-util | 29.7.0 | MIT |
| jest-validate | 29.7.0 | MIT |
| jest-worker | 29.7.0 | MIT |
| js-base64 | 3.9.3 | BSD-3-Clause |
| js-tokens | 4.0.0 | MIT |
| jsbi | 3.2.5 | Apache-2.0 |
| jsc-safe-url | 0.2.4 | 0BSD |
| jsesc | 3.1.0 | MIT |
| json5 | 2.2.3 | MIT |
| leven | 3.1.0 | MIT |
| lighthouse-logger | 1.4.2 | Apache-2.0 |
| locate-path | 5.0.0 | MIT |
| lodash.throttle | 4.1.1 | MIT |
| loose-envify | 1.4.0 | MIT |
| lru-cache | 5.1.1 | ISC |
| makeerror | 1.0.12 | BSD-3-Clause |
| marky | 1.3.0 | Apache-2.0 |
| math-intrinsics | 1.1.0 | MIT |
| md5.js | 1.3.5 | MIT |
| mdn-data | 2.0.14 | CC0-1.0 |
| memoize-one | 5.2.1 | MIT |
| merge-options | 3.0.4 | MIT |
| merge-stream | 2.0.0 | MIT |
| metro | 0.84.4 | MIT |
| metro-babel-transformer | 0.84.4 | MIT |
| metro-cache | 0.84.4 | MIT |
| metro-cache-key | 0.84.4 | MIT |
| metro-config | 0.84.4 | MIT |
| metro-core | 0.84.4 | MIT |
| metro-file-map | 0.84.4 | MIT |
| metro-minify-terser | 0.84.4 | MIT |
| metro-resolver | 0.84.4 | MIT |
| metro-runtime | 0.84.4 | MIT |
| metro-source-map | 0.84.4 | MIT |
| metro-symbolicate | 0.84.4 | MIT |
| metro-transform-plugins | 0.84.4 | MIT |
| metro-transform-worker | 0.84.4 | MIT |
| micro-packed | 0.7.3 | MIT |
| micromatch | 4.0.8 | MIT |
| mime | 1.6.0 | MIT |
| mime-db | 1.54.0 | MIT |
| mime-types | 3.0.2 | MIT |
| mkdirp | 1.0.4 | MIT |
| ms | 2.0.0 | MIT |
| ms | 2.1.3 | MIT |
| nanoid | 3.3.15 | MIT |
| negotiator | 1.0.0 | MIT |
| node-int64 | 0.4.0 | MIT |
| node-releases | 2.0.51 | MIT |
| nth-check | 2.1.1 | BSD-2-Clause |
| nullthrows | 1.1.1 | MIT |
| ob1 | 0.84.4 | MIT |
| object-assign | 4.1.1 | MIT |
| object-is | 1.1.6 | MIT |
| object-keys | 1.1.1 | MIT |
| object.assign | 4.1.7 | MIT |
| on-finished | 2.3.0 | MIT |
| on-finished | 2.4.1 | MIT |
| open | 7.4.2 | MIT |
| p-limit | 2.3.0 | MIT |
| p-locate | 4.1.0 | MIT |
| p-try | 2.2.0 | MIT |
| pako | 3.0.1 | (MIT AND Zlib) |
| parseurl | 1.3.3 | MIT |
| path-exists | 4.0.0 | MIT |
| path-key | 3.1.1 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 2.3.2 | MIT |
| picomatch | 4.0.5 | MIT |
| pngjs | 5.0.0 | MIT |
| possible-typed-array-names | 1.1.0 | MIT |
| pretty-format | 29.7.0 | MIT |
| process-nextick-args | 2.0.1 | MIT |
| promise | 8.3.0 | MIT |
| prop-types | 15.8.1 | MIT |
| purify-ts | 2.1.0 | ISC |
| qrcode | 1.5.4 | MIT |
| query-string | 7.1.3 | MIT |
| queue | 6.0.2 | MIT |
| range-parser | 1.2.1 | MIT |
| react | 19.2.3 | MIT |
| react-devtools-core | 6.1.5 | MIT |
| react-freeze | 1.0.4 | MIT |
| react-is | 16.13.1 | MIT |
| react-is | 18.3.1 | MIT |
| react-is | 19.2.7 | MIT |
| react-native | 0.86.0 | MIT |
| react-native-biometrics | 3.0.1 | MIT |
| react-native-ble-plx | 3.4.0 | MIT |
| react-native-camera-kit | 18.0.0 | MIT |
| react-native-fs | 2.20.0 | MIT |
| react-native-get-random-values | 1.11.0 | MIT |
| react-native-haptic-feedback | 3.0.0 | MIT |
| react-native-image-picker | 8.2.1 | MIT |
| react-native-keychain | 10.0.0 | MIT |
| react-native-mail | 6.1.1 | MIT |
| react-native-qrcode-svg | 6.3.21 | MIT |
| react-native-safe-area-context | 5.8.0 | MIT |
| react-native-screens | 4.26.0 | MIT |
| react-native-share | 12.3.1 | MIT |
| react-native-svg | 15.15.5 | MIT |
| react-native-webview | 14.0.1 | MIT |
| react-refresh | 0.14.2 | MIT |
| readable-stream | 2.3.8 | MIT |
| reflect-metadata | 0.2.2 | Apache-2.0 |
| regenerator-runtime | 0.13.11 | MIT |
| require-directory | 2.1.1 | MIT |
| require-main-filename | 2.0.0 | ISC |
| ripemd160 | 2.0.3 | MIT |
| rn-qr-generator | 2.0.0 | MIT |
| rxjs | 7.8.2 | Apache-2.0 |
| safe-buffer | 5.1.2 | MIT |
| safe-buffer | 5.2.1 | MIT |
| safe-regex-test | 1.1.0 | MIT |
| scheduler | 0.27.0 | MIT |
| semver | 6.3.1 | ISC |
| semver | 7.7.2 | ISC |
| semver | 7.8.5 | ISC |
| send | 0.19.2 | MIT |
| serialize-error | 2.1.0 | MIT |
| serve-static | 1.16.3 | MIT |
| set-blocking | 2.0.0 | ISC |
| set-function-length | 1.2.2 | MIT |
| setprototypeof | 1.2.0 | ISC |
| sf-symbols-typescript | 2.2.0 | MIT |
| sha.js | 2.4.12 | (MIT AND BSD-3-Clause) |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| shell-quote | 1.9.0 | MIT |
| simple-swizzle | 0.2.4 | MIT |
| source-map | 0.5.7 | BSD-3-Clause |
| source-map | 0.6.1 | BSD-3-Clause |
| source-map-support | 0.5.21 | MIT |
| split-on-first | 1.1.0 | MIT |
| stackframe | 1.3.4 | MIT |
| stacktrace-parser | 0.1.11 | MIT |
| standard-navigation | 0.0.7 | MIT |
| statuses | 1.5.0 | MIT |
| statuses | 2.0.2 | MIT |
| strict-uri-encode | 2.0.0 | MIT |
| string_decoder | 1.1.1 | MIT |
| string-width | 4.2.3 | MIT |
| strip-ansi | 6.0.1 | MIT |
| supports-color | 7.2.0 | MIT |
| supports-color | 8.1.1 | MIT |
| terser | 5.49.0 | BSD-2-Clause |
| text-encoding | 0.7.0 | (Unlicense OR Apache-2.0) |
| throat | 5.0.0 | MIT |
| tinyglobby | 0.2.17 | MIT |
| tmpl | 1.0.5 | BSD-3-Clause |
| to-buffer | 1.2.2 | MIT |
| to-regex-range | 5.0.1 | MIT |
| toidentifier | 1.0.1 | MIT |
| tslib | 1.14.1 | 0BSD |
| tslib | 2.8.1 | 0BSD |
| type-fest | 0.7.1 | (MIT OR CC0-1.0) |
| typed-array-buffer | 1.0.3 | MIT |
| typeforce | 1.18.0 | MIT |
| undici-types | 8.3.0 | MIT |
| unpipe | 1.0.0 | MIT |
| update-browserslist-db | 1.2.3 | MIT |
| use-latest-callback | 0.2.6 | MIT |
| use-sync-external-store | 1.6.0 | MIT |
| utf8 | 3.0.0 | MIT |
| util | 0.12.5 | MIT |
| util-deprecate | 1.0.2 | MIT |
| utils-merge | 1.0.1 | MIT |
| uuid | 11.0.3 | MIT |
| varuint-bitcoin | 1.1.2 | MIT |
| vlq | 1.0.1 | MIT |
| walker | 1.0.8 | Apache-2.0 |
| warn-once | 0.1.1 | MIT |
| whatwg-fetch | 3.6.20 | MIT |
| which | 2.0.2 | ISC |
| which-module | 2.0.1 | ISC |
| which-typed-array | 1.1.22 | MIT |
| wrap-ansi | 6.2.0 | MIT |
| wrap-ansi | 7.0.0 | MIT |
| ws | 6.2.4 | MIT |
| ws | 7.5.11 | MIT |
| ws | 8.21.3 | MIT |
| xstate | 5.19.2 | MIT |
| y18n | 4.0.3 | ISC |
| y18n | 5.0.8 | ISC |
| yallist | 3.1.1 | ISC |
| yaml | 2.9.0 | ISC |
| yargs | 15.4.1 | MIT |
| yargs | 17.7.3 | MIT |
| yargs-parser | 18.1.3 | ISC |
| yargs-parser | 21.1.1 | ISC |
