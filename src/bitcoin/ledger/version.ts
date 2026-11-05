/**
 * The Bitcoin-app gate a Ledger must pass BEFORE anything is signed or
 * registered (decided 2026-08-25).
 *
 * Bitcoin app 2.1.2–2.2.0 returns WRONG tapleaf hashes — taproot signatures
 * look valid and are not. Every Talia multisig is taproot (tr(multi_a),
 * 2026-07-23 policy), so an old app is not a degraded experience, it is
 * silently broken signing. The signer kit performs NO version check of its
 * own (verified against the installed 1.3.3 — no minimum-version constant
 * anywhere), so this gate is ours and it is mandatory.
 *
 * The signer kit also auto-opens the MAINNET "Bitcoin" app unconditionally
 * (hardcoded; "Bitcoin Test" appears nowhere in the package). The device
 * link therefore opens the right app itself, checks it here, and calls every
 * signer method with `skipOpenApp: true` so the device stays in the app we
 * just verified.
 *
 * Pure: strings in, verdicts out. Unit-tested.
 */
import type { Network } from '../descriptor/types';

/** Oldest Bitcoin app with correct tapleaf hashes. */
export const MIN_BITCOIN_APP_VERSION = '2.2.1';

/** The device app that serves a given network. */
export function bitcoinAppFor(network: Network): string {
  return network === 'bitcoin' ? 'Bitcoin' : 'Bitcoin Test';
}

/**
 * True when `version` ≥ `min`, comparing numeric dot-parts. A prerelease
 * suffix is ignored ("2.2.1-rc" counts as 2.2.1) — never substring-scan a
 * version string.
 */
export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = min.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * What to tell the owner when the app for `network` is not on the Ledger.
 * The testnet app is HIDDEN in Ledger Live until Developer mode is on
 * (a phone test hit exactly this, 2026-08-26): say so, or the owner searches the
 * catalog and finds nothing.
 */
export function bitcoinAppMissingMessage(network: Network): string {
  const app = bitcoinAppFor(network);
  if (app === 'Bitcoin') {
    return 'The Bitcoin app is not installed on this Ledger. Install it with Ledger Live and try again.';
  }
  return (
    'The "Bitcoin Test" app is not installed on this Ledger. In Ledger Live, turn on Developer mode ' +
    '(Settings → Experimental features), then install "Bitcoin Test" from My Ledger. Keep the ' +
    'regular Bitcoin app installed too, because the Test app needs it.'
  );
}

/**
 * Why the app the device reports cannot be used for `network`, or null when
 * it can. Plain language — this is shown to the owner as-is.
 */
export function bitcoinAppBlocker(
  appName: string,
  appVersion: string,
  network: Network,
): string | null {
  const wanted = bitcoinAppFor(network);
  if (appName !== wanted) {
    return `The Ledger has "${appName}" open, but this vault needs the "${wanted}" app. Please open it on the Ledger. Install it with Ledger Live if it is missing.`;
  }
  if (!versionAtLeast(appVersion, MIN_BITCOIN_APP_VERSION)) {
    return `The Bitcoin app on this Ledger is version ${appVersion}, which has a known signing bug. Please update it to ${MIN_BITCOIN_APP_VERSION} or newer in Ledger Live before using it with Talia.`;
  }
  return null;
}
