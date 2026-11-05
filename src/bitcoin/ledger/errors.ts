/**
 * Ledger/DMK errors → plain language (the rule: no jargon user-facing).
 *
 * The DMK stack surfaces failures three ways, all mapped here structurally
 * so this module never imports @ledgerhq (keeps it pure and unit-testable):
 *  - typed error objects discriminated on `_tag` (DeviceLockedError,
 *    PeerRemovedPairingError, BlePoweredOff, …),
 *  - APDU status words in `errorCode` ('6985' = declined on device,
 *    '5515' = locked, 'b008' = registration check failed, …),
 *  - ordinary Errors (our own gates throw already-readable messages).
 *
 * Order matters: _tag first (most specific), then errorCode, then any
 * readable message we produced ourselves, then a safe fallback.
 */

interface Errorish {
  _tag?: unknown;
  errorCode?: unknown;
  message?: unknown;
  originalError?: unknown;
}

const TAG_MESSAGES: Record<string, string> = {
  DeviceLockedError: 'The Ledger is locked. Enter its PIN and try again.',
  DeviceNotOnboardedError:
    'This Ledger has not been set up yet. Finish its own setup first, then try again.',
  PeerRemovedPairingError:
    'The phone remembers an old pairing this Ledger no longer has. In the iPhone’s Settings → Bluetooth, tap the Ledger and choose "Forget This Device", then try again.',
  PairingRefusedError: 'The pairing request was declined. Try again and accept the pairing on both screens.',
  BlePoweredOff: 'Bluetooth is off. Turn it on in Control Center and try again.',
  BlePermissionsNotGranted:
    'Talia is not allowed to use Bluetooth. Allow it in Settings → Talia → Bluetooth.',
  BleNotSupported: 'Bluetooth is not available on this phone.',
  NoDeviceModelFoundError: 'That device does not look like a Ledger Talia recognises.',
  DeviceDisconnectedWhileSendingError: 'The Ledger disconnected. Bring it close to the phone and reconnect.',
  DeviceDisconnectedBeforeSendingApdu: 'The Ledger disconnected. Bring it close to the phone and reconnect.',
};

/** Generic app-missing message — openBitcoinApp upgrades it with the
 *  network-specific install steps (see version.ts bitcoinAppMissingMessage). */
export const APP_MISSING_MESSAGE =
  'The app is not installed on this Ledger. Install it with Ledger Live and try again.';

/** What a "no" on the device reads as, once mapped. The signing ceremony
 *  tells a decline from every other failure by this exact sentence, so it is
 *  written once. */
export const DECLINED_ON_LEDGER = 'Declined on the Ledger.';

const CODE_MESSAGES: Record<string, string> = {
  '6985': DECLINED_ON_LEDGER,
  '5501': DECLINED_ON_LEDGER,
  '5515': 'The Ledger is locked. Enter its PIN and try again.',
  '5502': 'This Ledger has no PIN set. Finish its own setup first.',
  b008: 'The Ledger did not recognise this vault’s registration. Register the vault on this Ledger again.',
  '6a80': 'The Ledger rejected the request as malformed. This is a Talia bug. Please report it.',
  '670a': APP_MISSING_MESSAGE,
  '6807': APP_MISSING_MESSAGE,
};

/** True when the failure means "the person said no", not "something broke". */
export function isUserDeclined(e: unknown): boolean {
  const code = codeOf(e);
  return code === '6985' || code === '5501';
}

function codeOf(e: unknown): string | undefined {
  if (typeof e !== 'object' || e == null) return undefined;
  const code = (e as Errorish).errorCode;
  return typeof code === 'string' ? code.toLowerCase() : undefined;
}

/** One plain-language sentence for any failure out of the Ledger stack. */
export function ledgerErrorMessage(e: unknown): string {
  if (typeof e === 'object' && e != null) {
    const err = e as Errorish;
    if (typeof err._tag === 'string' && TAG_MESSAGES[err._tag]) {
      return TAG_MESSAGES[err._tag];
    }
    const code = codeOf(e);
    if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
    // Wrapped transport errors carry the useful object one level down.
    if (err.originalError != null && err.originalError !== e) {
      const inner = ledgerErrorMessage(err.originalError);
      if (inner !== FALLBACK) return inner;
    }
  }
  // Anything unrecognised — including foreign library messages that LOOK
  // readable — gets the one safe sentence. Talia's own gates throw plain
  // Errors that reach the screen directly and never pass through here.
  return FALLBACK;
}

const FALLBACK =
  'The Ledger connection failed. Make sure it is unlocked and nearby, then try again.';
