/**
 * 21st Capital's keys come LAST wherever a vault's keys are listed (decided
 * 2026-09-21: "In any form of a multisig setup, the 21st Capital key should
 * ALWAYS appear LAST and not second or first. The user's key should always
 * be prioritised to be used first.").
 *
 * A descriptor orders its keys by their bytes (sortedmulti, and the taproot
 * composer's canonical order), so the order on screen said nothing about
 * whose key it was: the Sign screen offered "Test ledger B, 21st Capital
 * co-signer, test bitbox". This is display order only; the descriptor itself
 * is never reordered (that would change the vault's addresses).
 *
 * A stable partition: the client's own keys keep their order, then ours keep
 * theirs.
 */
export function ownKeysFirst<T>(items: readonly T[], isProvider: (item: T) => boolean): T[] {
  const own: T[] = [];
  const ours: T[] = [];
  for (const item of items) (isProvider(item) ? ours : own).push(item);
  return [...own, ...ours];
}
