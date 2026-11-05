/**
 * Which of the client's OWN keys could still sign a spend.
 *
 * The product rule (decided 2026-09-18): Talia is self-custodial, so wherever a
 * screen offers to involve 21st Capital, it must first offer the client's own
 * remaining keys. A check found four places in Pending transactions that
 * forgot, and once a co-sign request was out the second key of a 2-of-3 was
 * nowhere on screen: the client could only wait for us or cancel.
 *
 * Pure: a wallet and a PSBT in, fingerprints out. Fail-safe by design — an
 * unreadable descriptor or PSBT returns an empty list, which only ever hides
 * an extra button, never invents one.
 */
import { psbtSignatureStatus, unsignedTxid } from '../bitcoin/psbt';
import { ownKeysOnThisPhone, primaryPathCustomerFingerprints } from './keyDevices';
import type { WalletMeta } from './types';

export function ownKeysLeftToSign(
  wallet: WalletMeta | null | undefined,
  psbtBase64: string | null | undefined,
  providerFps?: ReadonlySet<string>,
): string[] {
  if (!wallet || !psbtBase64) return [];
  try {
    // Unreadable bytes must yield NOTHING. psbtSignatureStatus answers
    // "nobody has signed" for a PSBT and for garbage alike, so without this
    // a corrupt record offered every key as still to sign, and the button
    // led to a screen that says it cannot read the transaction.
    if (!unsignedTxid(psbtBase64)) return [];
    // On an heir's phone the only key held here is the heir's own; the
    // owner's keys are never "another key" the heir could sign with.
    const mine = wallet.heirVault
      ? ownKeysOnThisPhone(wallet, providerFps)
      : primaryPathCustomerFingerprints(wallet, providerFps);
    if (mine.length === 0) return [];
    const signed = new Set(
      psbtSignatureStatus(psbtBase64).signedFingerprints.map((f) => f.toLowerCase()),
    );
    return mine.map((f) => f.toLowerCase()).filter((f) => !signed.has(f));
  } catch {
    return [];
  }
}
