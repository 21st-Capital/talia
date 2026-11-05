/**
 * Relative-timelock extraction for Liana-style descriptors.
 *
 * Liana recovery paths gate a key behind `older(N)` (BIP-68 CSV): the
 * recovery key can spend a UTXO once N blocks have passed since THAT UTXO
 * confirmed. Self-spending ("refreshing") a coin resets its clock. A
 * descriptor may carry several recovery paths — the SMALLEST N is the first
 * one to become available and drives the countdown.
 *
 * String classification only, per the descriptor-layer rule — BDK remains
 * the authority on actual spend policies.
 */

const OLDER_RE = /older\((\d+)\)/g;

/** BIP-68: bit 22 marks a TIME-based relative lock (512-second units). */
const CSV_TYPE_FLAG = 1 << 22;
/** BIP-68: the low 16 bits carry the value; every other bit is ignored. */
const CSV_VALUE_MASK = 0xffff;
/** Seconds per BIP-68 time unit. */
const CSV_TIME_UNIT_S = 512;
/**
 * Blocks added to a time-based lock's estimate. The chain judges a time lock
 * by median-time-past, which trails the newest block by about an hour, so a
 * block-count estimate without this margin would call a path open early.
 */
const CSV_TIME_MARGIN_BLOCKS = 6;

/**
 * Read an `older(N)` value the way the network does (BIP-68), in ONE place
 * (decided 2026-09-26). A time-based value (bit 22) was
 * read as a block count, so older(4194560), about 36 hours, showed as about
 * 80 years and the heir release date went decades out.
 *
 * Returns the wait in BLOCKS: exact for a block lock, a conservative estimate
 * (10-minute blocks plus a median-time-past margin, rounded up) for a time
 * lock, flagged `time`. Null for a value miniscript does not allow (0, or the
 * disable flag, bit 31, which is outside older()'s range).
 */
export function csvLock(n: number): { blocks: number; time: boolean } | null {
  if (!Number.isInteger(n) || n < 1 || n >= 2 ** 31) return null;
  const value = n & CSV_VALUE_MASK;
  if ((n & CSV_TYPE_FLAG) !== 0) {
    return {
      blocks: Math.ceil((value * CSV_TIME_UNIT_S) / 600) + CSV_TIME_MARGIN_BLOCKS,
      time: true,
    };
  }
  return { blocks: value, time: false };
}

/**
 * The smallest `older(N)` in the descriptor, in blocks (a time-based lock as
 * csvLock's estimate) — or null when the
 * descriptor has no relative timelock (not a timelocked Liana wallet).
 */
export function minOlderBlocks(descriptor: string): number | null {
  let min: number | null = null;
  for (const m of descriptor.matchAll(OLDER_RE)) {
    const lock = csvLock(parseInt(m[1], 10));
    const n = lock?.blocks;
    if (n != null && n > 0 && (min === null || n < min)) min = n;
  }
  return min;
}
