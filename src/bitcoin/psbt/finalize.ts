/**
 * Fallback PSBT finalizers on @scure/btc-signer (audited pure-JS; the same
 * library 21C's air-gapped co-signer signs with).
 *
 * BDK stays the PRIMARY path (engine `completePsbt`). This exists because BDK
 * 0.28 fails to assemble the witness for a sign-first co-sign spend — the
 * client's and 21C's taproot script-path signatures arrive in two divergent
 * PSBT copies (decided 2026-07-24).
 *
 * SAFETY: finalization only ASSEMBLES a witness from signatures already in the
 * PSBT — no keys, no signing. The one real risk in bypassing BDK's combine is
 * that BDK refuses to combine PSBTs whose unsigned transactions differ, which
 * is what stops a malicious server swapping the transaction under us. Every
 * entry point here re-enforces that check itself (`sameUnsignedTx`) before
 * touching the server's copy, and refuses outright when it fails.
 */
import * as btc from '@scure/btc-signer';
import { decodeBase64, encodeBase64, PSBT_MAGIC } from './export';
import { Reader, readMap } from './parse';

/** The PSBT's global unsigned-transaction bytes (global key type 0x00). */
function unsignedTxBytes(psbtBase64: string): Uint8Array | null {
  try {
    const bytes = decodeBase64(psbtBase64);
    if (!bytes || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) return null;
    const global = readMap(new Reader(bytes, PSBT_MAGIC.length));
    return global.find((e) => e.keyType === 0x00)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * True when both PSBTs describe the SAME transaction — identical inputs,
 * outputs and amounts. Guards every path that trusts the server's copy.
 */
export function sameUnsignedTx(a: string, b: string): boolean {
  const ta = unsignedTxBytes(a);
  const tb = unsignedTxBytes(b);
  if (!ta || !tb || ta.length !== tb.length) return false;
  for (let i = 0; i < ta.length; i++) if (ta[i] !== tb[i]) return false;
  return true;
}

/**
 * Try to finalize every input of `psbtBase64`. Returns the finalized PSBT
 * (base64), or null with the reason. Never throws.
 */
export function scureFinalizePsbt(psbtBase64: string): string | null {
  return tryFinalize(psbtBase64).psbtBase64;
}

function tryFinalize(psbtBase64: string): { psbtBase64: string | null; error?: string } {
  try {
    const bytes = decodeBase64(psbtBase64);
    if (!bytes) return { psbtBase64: null, error: 'not base64' };
    const tx = btc.Transaction.fromPSBT(bytes, {
      allowUnknownOutputs: true,
      allowUnknownInputs: true,
      allowLegacyWitnessUtxo: true,
    });
    tx.finalize();
    return { psbtBase64: encodeBase64(tx.toPSBT(0)) };
  } catch (e) {
    return { psbtBase64: null, error: (e as Error)?.message ?? String(e) };
  }
}

export interface CosignFinalizeResult {
  /** Finalized PSBT (base64), or null if every route failed. */
  psbtBase64: string | null;
  /** Which routes ran and what each said — surfaced to the user on failure. */
  attempts: string[];
  /**
   * The copies the finalized witness was built FROM. A finalized input
   * keeps only its witness (every signature and derivation entry is
   * dropped), so whoever judges whether the signatures satisfy a spending
   * path must read them here, never in the finalized copy.
   */
  sources: string[];
}

/**
 * Finalize a co-signed spend, trying each independent route in turn.
 *
 * `serverPsbt` is 21C's returned copy — the blind request plus their signature.
 * That copy is deliberately self-sufficient for a taproot script-path spend
 * (witness UTXO + internal key + our leaf script & control block + every script
 * signature), so route 3 can finalize it with no combine at all — which is what
 * rescues the case where combining is the thing that breaks.
 */
export function finalizeCosigned(
  originalPsbt: string,
  serverPsbt: string,
): CosignFinalizeResult {
  const attempts: string[] = [];

  if (!sameUnsignedTx(originalPsbt, serverPsbt)) {
    // Refuse rather than finalize: the returned copy is not the transaction the
    // user approved. (BDK's combine enforces the same rule.)
    attempts.push('refused: the returned transaction does not match the one you approved');
    return { psbtBase64: null, attempts, sources: [] };
  }

  // 1. scure's own combine (original carries the full metadata, server the sigs)
  try {
    const a = btc.Transaction.fromPSBT(decodeBase64(originalPsbt)!, {
      allowUnknownOutputs: true,
      allowUnknownInputs: true,
    });
    const b = btc.Transaction.fromPSBT(decodeBase64(serverPsbt)!, {
      allowUnknownOutputs: true,
      allowUnknownInputs: true,
    });
    a.combine(b);
    a.finalize();
    return { psbtBase64: encodeBase64(a.toPSBT(0)), attempts, sources: [originalPsbt, serverPsbt] };
  } catch (e) {
    attempts.push(`combine+finalize: ${(e as Error)?.message ?? e}`);
  }

  // 2. the server copy alone — self-sufficient for a script-path spend
  const solo = tryFinalize(serverPsbt);
  if (solo.psbtBase64) return { psbtBase64: solo.psbtBase64, attempts, sources: [serverPsbt] };
  attempts.push(`server-only: ${solo.error}`);

  // 3. the original alone (covers "the client's copy already had everything")
  const orig = tryFinalize(originalPsbt);
  if (orig.psbtBase64) return { psbtBase64: orig.psbtBase64, attempts, sources: [originalPsbt] };
  attempts.push(`original-only: ${orig.error}`);

  return { psbtBase64: null, attempts, sources: [] };
}
