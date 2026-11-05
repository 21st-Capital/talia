/**
 * @format
 */

// FIRST: install TextDecoder/TextEncoder, which Hermes lacks and
// @scure/btc-signer needs to read a PSBT (see src/polyfills.ts).
import './src/polyfills';

import { AppRegistry, LogBox } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Benign dev-only noise: some deps import `@noble/hashes/crypto`, which isn't in
// that package's "exports" map, so Metro falls back to file-based resolution
// (works fine). Hide the warning so it doesn't nag during development.
LogBox.ignoreLogs([/not listed in the "exports"/, /@noble\/hashes/]);

// The tier C runner (BDK upgrade, decided 2026-10-15) replaces the app in
// a TALIA_HARNESS build, in the simulator only. The flag is inlined here by
// babel-plugin-talia-flags.js, so without it the condition is a constant and
// Metro drops the harness module from the bundle; ios-archive.sh refuses the
// flag and proves the harness absent from the archived JavaScript.
AppRegistry.registerComponent(appName, () =>
  process.env.TALIA_HARNESS === '1' ? require('./src/harness/TierCApp').TierCApp : App,
);
