/**
 * Per-wallet UTXO cache (AsyncStorage) — same instant-first philosophy as the
 * tx cache: the Coins screen paints the last known coin list immediately and
 * the live engine result replaces it moments later. The chain tip height is
 * stored alongside so cached timelock countdowns can age correctly (~1 block
 * per 10 minutes). Public data only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Utxo } from '../bitcoin/engine/types';

const PREFIX = 'keel.utxocache.v1:';
const MAX_CACHED = 500;

export interface UtxoCache {
  utxos: Utxo[];
  /** Chain tip at the time of caching, if known. */
  tipHeight?: number;
  /** Unix ms when cached. */
  at: number;
}

export async function saveUtxoCache(
  walletId: string,
  utxos: Utxo[],
  tipHeight: number | undefined,
): Promise<void> {
  try {
    const payload: UtxoCache = {
      utxos: utxos.slice(0, MAX_CACHED),
      tipHeight,
      at: Date.now(),
    };
    await AsyncStorage.setItem(PREFIX + walletId, JSON.stringify(payload));
  } catch {
    // Cache is best-effort; never let it break a sync.
  }
}

export async function loadUtxoCache(walletId: string): Promise<UtxoCache | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + walletId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UtxoCache;
    return Array.isArray(parsed?.utxos) ? parsed : null;
  } catch {
    return null;
  }
}

/** The cached tip aged forward: one block per ~10 minutes since caching. */
export function agedTipHeight(cache: UtxoCache): number | undefined {
  if (cache.tipHeight == null) return undefined;
  return cache.tipHeight + Math.floor((Date.now() - cache.at) / 600_000);
}

export async function clearUtxoCache(walletId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + walletId);
  } catch {
    // best-effort
  }
}
