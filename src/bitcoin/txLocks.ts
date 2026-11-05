/**
 * What consensus reads to judge a timelock (BIP-65, BIP-68, BIP-112), and
 * whether a transaction carries a given lock. The leaf hazard (decided
 * 2026-10-17; the library fork's comments call it D10): a spending path
 * with `older(N)` or `after(N)` counts as satisfied only when the TRANSACTION
 * satisfies it, never the coin's age. Pure; tested in
 * `psbt/__tests__/timelockCheck.test.ts`.
 */

/** What consensus reads to judge a timelock: BIP-65, BIP-68, BIP-112. */
export interface TxLocks {
  version: number;
  lockTime: number;
  /** nSequence of every input, in order. */
  sequences: number[];
}

export const SEQUENCE_FINAL = 0xffffffff;
const SEQUENCE_DISABLE = 0x80000000;
const SEQUENCE_TYPE_FLAG = 0x00400000;
const SEQUENCE_VALUE = 0x0000ffff;
const LOCKTIME_THRESHOLD = 500_000_000;

/**
 * Does input `i` carry `older(n)`, as OP_CHECKSEQUENCEVERIFY checks it?
 * Version 2 or more, the disable flag clear, the same unit (blocks or 512
 * seconds), and at least `n`.
 */
export function carriesOlder(tx: TxLocks, i: number, n: number): boolean {
  const seq = (tx.sequences[i] ?? SEQUENCE_FINAL) >>> 0;
  if (tx.version < 2) return false;
  if ((seq & SEQUENCE_DISABLE) !== 0) return false;
  if ((seq & SEQUENCE_TYPE_FLAG) !== (n & SEQUENCE_TYPE_FLAG)) return false;
  return (seq & SEQUENCE_VALUE) >= (n & SEQUENCE_VALUE);
}

/**
 * Does input `i` carry `after(n)`, as OP_CHECKLOCKTIMEVERIFY checks it?
 * nLockTime of the same kind (height or time) and at least `n`, and the
 * input's nSequence not final (a final one switches nLockTime off).
 */
export function carriesAfter(tx: TxLocks, i: number, n: number): boolean {
  const seq = (tx.sequences[i] ?? SEQUENCE_FINAL) >>> 0;
  if (seq === SEQUENCE_FINAL) return false;
  const lt = tx.lockTime >>> 0;
  if (lt < LOCKTIME_THRESHOLD !== n < LOCKTIME_THRESHOLD) return false;
  return lt >= n;
}

