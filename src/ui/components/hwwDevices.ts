/**
 * What the "add a key" sheet says behind its "Another device" row: a key
 * that sits on hardware Talia cannot reach itself (an heir's own device, a
 * wallet never adopted, or an App Store build with the hardware surface
 * off). Every adopted device is picked by name instead (decided 2026-10-04,
 * device first: `DevicePicker` over the registry), so no brand is ever named
 * here.
 */

/** Which account we need; the menu path differs per device. */
export type KeyPurpose = 'single' | 'multisig';

export const OTHER_DEVICE_STEPS: Readonly<Record<KeyPurpose, readonly string[]>> = {
  single: [
    'We need the PUBLIC account key (an “xpub”). Never your seed words.',
    'In most wallets it sits under the account’s settings, named “xpub”, “account key”, or “export public key”.',
    'If your device offers several, pick the ordinary single-signature account.',
  ],
  multisig: [
    'We need the PUBLIC account key (an “xpub”) of the MULTI-key account this vault uses. Never your seed words.',
    'In most wallets it sits under the account’s settings, named “xpub”, “account key”, or “export public key”.',
    'If your device offers several, pick the multisig one (the path below), not the single-signature one.',
  ],
};

/**
 * Does this Coldcard-style export look like the SINGLE-SIG one (the wrong
 * menu item)? True when it carries the single-sig accounts but not the
 * multisig account — the exact mistake the guide warns about.
 */
export function isSingleSigOnlyExport(cc: {
  bip48_2?: unknown;
  bip84?: unknown;
  bip86?: unknown;
}): boolean {
  return !cc.bip48_2 && (!!cc.bip84 || !!cc.bip86);
}
