/**
 * Pure ordering for arrange mode. Extracted from WalletProvider so the one
 * rule that matters is testable: the Vaults tab and the Portfolio tab each
 * arrange ONLY their own wallets, and arranging one must never disturb the
 * other's order.
 */

/**
 * Re-order `wallets` by `ids`: ranked wallets first, in the given order, then
 * every wallet NOT in `ids` in its CURRENT relative order. The unranked rank
 * is explicit (offset + current index) rather than a shared sentinel, so the
 * result does not depend on the sort being stable.
 */
export function orderWalletsByIds<T extends { id: string }>(wallets: T[], ids: string[]): T[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  const offset = ids.length;
  return wallets
    .map((w, i) => ({ w, r: rank.has(w.id) ? rank.get(w.id)! : offset + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.w);
}
