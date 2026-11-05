/**
 * A vault saved on Signet moves to Testnet4 (decided 2026-10-18: "remove signet,
 * keep only bitcoin and testnet4").
 *
 * A vault was once built on Signet by mistake: the builder's test network
 * followed Settings → Network, which still offered Signet. A Testnet4 payment
 * to its address never showed, because a tb1 address reads the same on both
 * chains and the vault was watching the other one. Talia now offers Bitcoin
 * and Testnet4 only, so at start every stored vault on Signet becomes a
 * Testnet4 vault: the same descriptor, the same keys, the same addresses,
 * watched on Testnet4. What it remembered of Signet goes with it (the cached
 * balance and the cached timelock countdown here, the history, coin and
 * address caches in `loadWallets`), so the vault shows Testnet4's own coins
 * from its first sync. Pure, like `moveOffEsplora`: null when nothing moves
 * (nothing to write), and every other stored value is kept. `loadWallets`
 * (./storage) reads, clears the caches, then stores the result once.
 */
import type { WalletMeta } from './types';

/** What a vault remembered of the chain it watched: not true of Testnet4. */
const CHAIN_CACHE_FIELDS = [
  'cachedBalanceSats',
  'cachedBalanceAt',
  'cachedExpiryBlocks',
  'cachedExpiryAt',
] as const;

export interface MovedOffSignet {
  /** The whole list, in its order, with every Signet vault on Testnet4. */
  wallets: WalletMeta[];
  /** The ids of the vaults that moved, whose caches must be cleared. */
  moved: string[];
}

/**
 * The stored vault list with every Signet vault moved to Testnet4, or null
 * when none was on Signet. An entry that is not a vault is kept as it is.
 */
export function moveVaultsOffSignet(stored: readonly unknown[]): MovedOffSignet | null {
  const moved: string[] = [];
  const wallets = stored.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    const w = entry as Record<string, unknown>;
    if (w.network !== 'signet') return entry;
    const next: Record<string, unknown> = { ...w, network: 'testnet' };
    for (const field of CHAIN_CACHE_FIELDS) delete next[field];
    if (typeof w.id === 'string') moved.push(w.id);
    return next;
  });
  if (wallets.every((w, i) => w === stored[i])) return null;
  return { wallets: wallets as WalletMeta[], moved };
}
