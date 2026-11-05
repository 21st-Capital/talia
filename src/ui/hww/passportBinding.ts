/**
 * Linking a one-key vault to a Foundation Passport by QR: the "QR code"
 * method of the shared connect step (decided 2026-09-22: choose the method first,
 * then the device). Moved here from the vault page so every screen that
 * connects hardware offers it the same way.
 *
 * Connecting GATHERS what signing needs (decided 2026-09-08): a vault imported
 * from a bare xpub has no master fingerprint or path, so its transactions
 * name the xpub's own fingerprint and the Passport refuses them. The export
 * carries both; a match writes them into the descriptor.
 */
import type { BbqrScanResult } from '../components/BbqrScanner';
import { parseKeyInput } from '../components/KeyEntrySheet';
import { parseColdcardExport, parseKeyOrigins, stripChecksum } from '../../bitcoin/descriptor';
import { singleSigKeyId, withKeyOrigin } from '../../wallet';
import { deviceSuitsVault } from '../../wallet/deviceKinds';
import type { KeyDevice, WalletMeta } from '../../wallet/types';

export type PassportOutcome =
  | { kind: 'refused'; title: string; message?: string }
  /** The bare key learns its origin; the device binding follows its new id. */
  /** `keyId` is the key that was just bound: its fingerprint, or, for a
   *  vault imported as a bare xpub that stayed bare, the key itself. The
   *  keyDevices map is MERGED with what the vault already had, so its first
   *  entry is not necessarily this one (decided 2026-09-26). */
  | { kind: 'upgrade'; descriptor: string; keyDevices: Record<string, KeyDevice>; keyId: string }
  | { kind: 'bind'; keyDevices: Record<string, KeyDevice>; keyId: string };

export const PASSPORT_EXPORT_HINT = 'On the Passport: Manage Account, Connect Wallet, Sparrow, Single-sig, QR Code';

/**
 * Could this scan have come off a Passport? It speaks BC-UR, and only a
 * BC-UR payload binds one (decided 2026-09-18). A flat printed QR, another
 * app's plain xpub code or Talia's own export used to pass as "the device
 * showed its key". THE rule for every screen that records a Passport; the
 * owner's pick of the Passport is needed too, because Sparrow's descriptor
 * QR is a UR as well.
 */
export function isPassportScan(result: BbqrScanResult): boolean {
  return result.kind === 'text' && result.via === 'ur';
}

export function passportBinding(wallet: WalletMeta, result: BbqrScanResult): PassportOutcome {
  if (!isPassportScan(result) || result.kind !== 'text') {
    return {
      kind: 'refused',
      title: 'That did not come from a Passport',
      message: 'On the Passport: Manage Account, Connect Wallet, Sparrow, Single-sig, QR Code. It shows a moving code.',
    };
  }
  const vaultKey = parseKeyOrigins(stripChecksum(wallet.descriptor).body)[0];
  const keyId = singleSigKeyId(wallet);
  if (!vaultKey || !keyId) return { kind: 'refused', title: 'This vault has no key to connect' };
  // A Passport speaks standard scripts only (reported 2026-09-24: "The foundation
  // passport doesnt support taproot ministcript! it only supports standard
  // single and standard multisigs"). Talia composes taproot miniscript for
  // every layered vault and for every vault holding a 21st Capital key, so
  // binding one here would hand the owner a vault they cannot spend from,
  // and they would only find out at Send.
  if (!deviceSuitsVault('passport', wallet.descriptor)) {
    return {
      kind: 'refused',
      title: 'A Passport cannot sign this vault',
      message:
        'This vault uses a recovery path or a 21st Capital key, which a Passport cannot sign. Connect a Ledger or a BitBox instead.',
    };
  }
  let scanned: { xpub: string; fingerprint?: string; originPath?: string } | null = null;
  const parsed = parseKeyInput(result.text);
  if (parsed) {
    scanned = parsed.key;
  } else {
    const cc = parseColdcardExport(result.text);
    if (cc) {
      const acct = wallet.descriptor.trim().startsWith('tr(') ? cc.bip86 : cc.bip84;
      if (acct) scanned = { xpub: acct.xpub, fingerprint: cc.fingerprint, originPath: acct.originPath };
    }
  }
  if (!scanned) return { kind: 'refused', title: 'That is not a key export' };
  if (scanned.xpub !== vaultKey.xpub) {
    const theirs = scanned.fingerprint?.toUpperCase() ?? 'a different key';
    const ours = vaultKey.fingerprint?.toUpperCase();
    return {
      kind: 'refused',
      title: 'That Passport holds a different key',
      message: ours ? `It showed ${theirs}. This vault uses ${ours}.` : `It showed ${theirs}.`,
    };
  }
  const scannedFp = scanned.fingerprint?.toLowerCase();
  if (!vaultKey.fingerprint && scannedFp && scanned.originPath) {
    return {
      kind: 'upgrade',
      descriptor: withKeyOrigin(wallet.descriptor, vaultKey.xpub, scannedFp, scanned.originPath),
      keyDevices: { [scannedFp]: { kind: 'passport' } },
      keyId: scannedFp,
    };
  }
  return {
    kind: 'bind',
    keyDevices: { ...(wallet.keyDevices ?? {}), [keyId]: { kind: 'passport' } },
    keyId,
  };
}
