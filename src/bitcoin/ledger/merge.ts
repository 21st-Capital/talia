/**
 * Merge the signatures a Ledger yields back into the PSBT (decided
 * 2026-08-26).
 *
 * The Ledger's signPsbt does NOT return an updated PSBT — it returns bare
 * signatures, one per (input, key). Three shapes, told apart by the pubkey
 * field the device sends (verified against the installed signer kit's
 * decoder):
 *  - 64 bytes  = 32-byte x-only pubkey + 32-byte tapleaf hash → a taproot
 *    SCRIPT-path signature (our multi_a vaults) → PSBT `tapScriptSig`.
 *  - 32 bytes, no tapleaf hash → a taproot KEY-path signature (single-key
 *    tr vaults) → PSBT `tapKeySig`.
 *  - 33 bytes  = compressed pubkey → an ECDSA signature (wpkh single-sig)
 *    → PSBT `partialSig`.
 *
 * Output is a PSBT with signatures ADDED, not finalized — the engine's
 * `completePsbt` (BDK finalize + verified scure fallback) stays the one
 * finalization path, exactly as for the QR and file transports.
 *
 * Pure @scure/btc-signer assembly — no keys, no signing (the same
 * sanctioned exception as psbt/finalize.ts).
 */
import * as btc from '@scure/btc-signer';

import { decodeBase64, encodeBase64 } from '../psbt/export';

/** One signature off the device, as the platform layer hands it over. */
export interface LedgerSig {
  inputIndex: number;
  /** 32-byte x-only or 33-byte compressed pubkey (see module doc). */
  pubkey: Uint8Array;
  signature: Uint8Array;
  /** Present only for taproot script-path signatures. */
  tapleafHash?: Uint8Array;
}

/**
 * Returns the PSBT (base64) with every signature merged in. Throws a
 * plain-language Error when the PSBT cannot be parsed or a signature does
 * not fit any known shape — a wrong merge must never limp onward into
 * finalization.
 */
export function mergeLedgerSignatures(psbtBase64: string, sigs: readonly LedgerSig[]): string {
  const bytes = decodeBase64(psbtBase64);
  if (!bytes) throw new Error('The transaction could not be read back. Please try again.');
  const tx = btc.Transaction.fromPSBT(bytes, {
    allowUnknownOutputs: true,
    allowUnknownInputs: true,
    allowLegacyWitnessUtxo: true,
  });

  const bytesEq = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((v, i) => v === b[i]);

  // A slot that is already filled is SKIPPED, never overwritten — a re-run
  // against a half-signed working copy must not clobber an earlier round.
  // If nothing lands at all, say so instead of returning an unchanged PSBT
  // the ceremony would then misread as "no new signature" with no cause.
  let added = 0;
  for (const sig of sigs) {
    const input = tx.getInput(sig.inputIndex);
    if (sig.tapleafHash != null && sig.pubkey.length === 32) {
      const leaf = sig.tapleafHash;
      const taken = (input.tapScriptSig ?? []).some(
        ([k]) => bytesEq(k.pubKey, sig.pubkey) && bytesEq(k.leafHash, leaf),
      );
      if (taken) continue;
      tx.updateInput(
        sig.inputIndex,
        { tapScriptSig: [[{ pubKey: sig.pubkey, leafHash: leaf }, sig.signature]] },
        true,
      );
      added++;
    } else if (sig.pubkey.length === 32) {
      if (input.tapKeySig != null) continue;
      tx.updateInput(sig.inputIndex, { tapKeySig: sig.signature }, true);
      added++;
    } else if (sig.pubkey.length === 33) {
      const taken = (input.partialSig ?? []).some(([pk]) => bytesEq(pk, sig.pubkey));
      if (taken) continue;
      tx.updateInput(sig.inputIndex, { partialSig: [[sig.pubkey, sig.signature]] }, true);
      added++;
    } else {
      throw new Error('The Ledger returned a signature Talia does not recognise.');
    }
  }
  if (added === 0) {
    throw new Error('This Ledger already signed this transaction. There is nothing new to add.');
  }
  return encodeBase64(tx.toPSBT(0));
}
