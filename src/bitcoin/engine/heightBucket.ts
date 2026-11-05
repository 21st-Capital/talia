/**
 * The words of the engine report's buckets for a `history.height`
 * difference of the shadow checks (decided 2026-10-28: fixed words only, six
 * of them joined by dots; no txid, height, time, hash or amount ever went
 * into one). In order: which engine placed the transaction higher; the gap
 * between the two heights in blocks; its confirmations when compared;
 * whether 0.28's place for it was no longer the chain's; whether the new
 * engine's block was still the server's; and today's engine's view against
 * the new engine's sync.
 *
 * The shadow checks that wrote them went with the old engine
 * (decided 2026-11-04). The words stay so a report written
 * during the shadow week is still read and checked
 * (wallet/engineReport.ts `isHeightBucket`); nothing writes a bucket now.
 */
export const HEIGHT_HIGHER = ['old', 'new', 'same', 'oldOnly', 'newOnly'] as const;
export const HEIGHT_GAP = ['gap0', 'gap1', 'gap2to6', 'gap7plus', 'gapNa'] as const;
export const HEIGHT_CONFS = ['conf0to5', 'conf6plus', 'confUnknown'] as const;
export const HEIGHT_REORG = ['reorgYes', 'reorgNo', 'reorgNa', 'reorgUnknown'] as const;
export const HEIGHT_NEW_BLOCK = ['newOnChain', 'newGone', 'newMovedSince', 'newNa', 'newUnknown'] as const;
export const HEIGHT_OLD_SYNC = ['oldOnce', 'oldBefore', 'oldAfter', 'oldDuring', 'oldUnknown'] as const;
/** The words of each of a bucket's six places, in order. */
/** The words of each of a bucket's six places, in order. */
export const HEIGHT_BUCKET_WORDS: ReadonlyArray<readonly string[]> = [
  HEIGHT_HIGHER,
  HEIGHT_GAP,
  HEIGHT_CONFS,
  HEIGHT_REORG,
  HEIGHT_NEW_BLOCK,
  HEIGHT_OLD_SYNC,
];

/** Is this a bucket the shadow checks could write: six places, each one of its words? */
export function isHeightBucket(key: string): boolean {
  const parts = key.split('.');
  return parts.length === HEIGHT_BUCKET_WORDS.length && parts.every((w, i) => HEIGHT_BUCKET_WORDS[i].includes(w));
}
