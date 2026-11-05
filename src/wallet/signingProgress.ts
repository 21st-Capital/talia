/**
 * How far a working copy is along the spending path it is on: what the
 * signing screen and Pending transactions say, and what a parked partial
 * records (the leaf hazard, decided 2026-10-17).
 *
 * The screens used to count raw signatures and call a path done when the
 * keys that signed it matched by fingerprint. A device holding keys on the
 * everyday path AND on a recovery path signs both, so on an everyday spend
 * (nSequence 0xFFFFFFFD, version 1) the recovery path looked complete: the
 * screen said "Enough signatures collected", Pending "ready to send", and
 * the second device was never asked, while the libraries (correctly) left
 * the input open because the transaction does not carry the recovery wait.
 * The rule is the libraries' own: a path counts only when the TRANSACTION
 * opens it (`pathOpenForTx`), and the count is the path's own signers.
 *
 * Pure: a descriptor and a PSBT in. Never throws; null when unreadable.
 */
import { parsePolicy, pathInPlay } from '../bitcoin/descriptor/policy';
import type { PathInPlay, PolicyPath } from '../bitcoin/descriptor/policy';
import { psbtInputsFinalized, psbtSignatureStatus } from '../bitcoin/psbt/parse';
import { txLocksOf } from '../bitcoin/psbt/timelockCheck';

export interface SigningProgress {
  /** Distinct keys of the path in play that signed (a finalized copy:
   *  at least what the path needs, since finalizing may drop the
   *  signatures it used). */
  signatures: number;
  /** What the path in play needs. */
  needed: number;
  /** Nothing more to sign: finalized, or the path is satisfied on every
   *  input and the transaction opens it. */
  complete: boolean;
  /** Fingerprints (lower case) of the path's keys still unsigned; empty
   *  once complete. */
  waitingFor: string[];
}

/** The path in play for this copy, or null when it cannot be read. */
export function pathInPlayOf(
  descriptor: string,
  psbtBase64: string,
  chosen?: PolicyPath | null,
): PathInPlay | null {
  try {
    const policy = parsePolicy(descriptor);
    return pathInPlay(policy, psbtSignatureStatus(psbtBase64), txLocksOf(psbtBase64), chosen);
  } catch {
    return null;
  }
}

/** The progress a path in play gives, `finalized` meaning the copy already
 *  carries a final witness on every input. */
export function progressOf(p: PathInPlay, finalized: boolean): SigningProgress {
  if (finalized) {
    return { signatures: Math.max(p.signers.length, p.needed), needed: p.needed, complete: true, waitingFor: [] };
  }
  const signed = new Set(p.signers);
  const waitingFor = p.satisfied
    ? []
    : [
        ...new Set(
          p.keys.flatMap((k) => {
            const fp = k.fingerprint?.toLowerCase();
            return fp && !signed.has(fp) ? [fp] : [];
          }),
        ),
      ];
  return { signatures: p.signers.length, needed: p.needed, complete: p.satisfied, waitingFor };
}

export function signingProgress(
  descriptor: string,
  psbtBase64: string,
  chosen?: PolicyPath | null,
): SigningProgress | null {
  const p = pathInPlayOf(descriptor, psbtBase64, chosen);
  return p ? progressOf(p, psbtInputsFinalized(psbtBase64)) : null;
}

/**
 * What Pending transactions says about a spend parked mid-ceremony: the
 * copy's own progress wherever the vault can read it, so a record parked
 * before this rule (or by any other count) can never read "ready to send"
 * while a key is still to sign; else the numbers stored when it was parked.
 */
export function parkedProgress(
  descriptor: string | null | undefined,
  record: { originalPsbt: string; signatures?: number; signaturesNeeded?: number },
): { signatures?: number; needed?: number; complete: boolean } {
  const live = descriptor ? signingProgress(descriptor, record.originalPsbt) : null;
  if (live) return { signatures: live.signatures, needed: live.needed, complete: live.complete };
  const { signatures, signaturesNeeded: needed } = record;
  return { signatures, needed, complete: signatures != null && needed != null && signatures >= needed };
}
