/**
 * Per-wallet transaction-history cache (AsyncStorage).
 *
 * The app must be usable the instant it opens: wallet screens render the last
 * known ledger from this cache immediately, while a background sync refreshes
 * it. Public data only (txids/amounts) — same sensitivity as the descriptor.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WalletTx } from '../bitcoin/engine/types';

const PREFIX = 'keel.txcache.v1:';
/** Deep enough that an account statement covers a vault's whole life: a
 *  vault that refreshes daily writes hundreds of transactions a year, and a
 *  statement built on a truncated history would print a wrong opening
 *  balance (decided 2026-08-28). Entries are small; 5000 is well under a
 *  megabyte per vault. */
const MAX_CACHED = 5000;

export async function saveTxCache(walletId: string, txs: WalletTx[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + walletId, JSON.stringify(txs.slice(0, MAX_CACHED)));
  } catch {
    // Cache is best-effort; never let it break a sync.
  }
}

export async function loadTxCache(walletId: string): Promise<WalletTx[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + walletId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WalletTx[]) : null;
  } catch {
    return null;
  }
}

export async function clearTxCache(walletId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + walletId);
  } catch {
    // best-effort
  }
}
