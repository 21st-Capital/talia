/**
 * The engine's last line of defence for the watch-only App Store build
 * (decided 2026-09-26).
 *
 * It used to pass whenever `LEDGER_PREVIEW` was on, a hard-coded `true`, so
 * it could never fire in any build: the watch-only app shipped the whole
 * build/sign/broadcast engine behind UI gates alone. It now follows the
 * BUILD-TIME flags (`TALIA_HWW`, `TALIA_FULL`, via `HWW_ENABLED`), which are
 * off in every App Store archive (`scripts/ios-archive.sh` proves it) and on
 * in the TestFlight signing build and the full app, where spending is the
 * point.
 *
 * The one thing the watch-only build must still do is finish a RESCUE that
 * 21st Capital signed. That has its own narrow engine methods
 * (`buildRescuePsbt`, `broadcastRescue`), which check the transaction
 * against the vault instead of asking this gate.
 */
import { HWW_ENABLED, SIGNING_ENABLED } from '../../config';

export interface SpendFlags {
  SIGNING_ENABLED: boolean;
  HWW_ENABLED: boolean;
}

const BUILD_FLAGS: SpendFlags = { SIGNING_ENABLED, HWW_ENABLED };

/** True when this build may build, sign, bump or broadcast a spend. */
export function spendSurfaceOpen(flags: SpendFlags = BUILD_FLAGS): boolean {
  return flags.SIGNING_ENABLED || flags.HWW_ENABLED;
}

/** Throws the user-visible refusal when the spend surface is closed. */
export function assertSigningEnabled(what: string, flags: SpendFlags = BUILD_FLAGS): void {
  if (spendSurfaceOpen(flags)) return;
  throw new Error(
    `${what} is not available in this version of Talia. It watches your vaults and cannot spend.`,
  );
}
