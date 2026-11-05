/**
 * Per-wallet address cache — the Addresses screen and the Receive QR must
 * paint INSTANTLY. Derivation and the used/unused boundary refresh in the
 * background (they queue behind syncs on the engine's serial native queue,
 * which is what made these screens take ~15s cold).
 *
 * Public data only (addresses), same sensitivity as the descriptor.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CachedAddress {
  address: string;
  index: number;
  /** Sats currently held (used addresses; from the UTXO set). */
  balanceSats?: number;
}

export interface AddressCache {
  /** First unused index at last refresh. */
  firstUnused: number;
  /** Next unused receive addresses (index ascending). */
  unused: CachedAddress[];
  /** Previously used receive addresses (index descending). */
  used: CachedAddress[];
  updatedAt: number;
}

/**
 * What Receive and Addresses say when they have no saved address and the sync
 * that would have told them failed (decided 2026-10-30): an engine that has
 * not synced answers an address already paid, so neither screen guesses.
 */
export const ADDRESSES_NOT_CHECKED = "Could not check this vault's addresses.";

/**
 * How long Receive and Addresses wait for their check before they show what is
 * saved. No unused address appears until the check has answered (decided
 * 2026-10-30 after a phone test: a saved address can have been paid since, and
 * it was on show for the seconds the check took), but a server that says
 * nothing must not leave a page on a spinner for the sync's whole 90 s.
 */
export const ADDRESS_CHECK_PATIENCE_MS = 15_000;

const PREFIX = 'keel.addrcache.v1:';

export async function saveAddrCache(walletId: string, cache: AddressCache): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + walletId, JSON.stringify(cache));
  } catch {
    // best-effort
  }
}

/**
 * Nothing the saved list calls used is offered as unused (decided 2026-10-30).
 * Builds before that date could save a pool from an engine that had not
 * synced, from index 0 up with the used list behind it, and a failed sync
 * would keep such a paid address on show. The list can only speak for what it
 * holds: a pool saved with an empty used list cannot be told from a new vault.
 */
function withoutUsed(cache: AddressCache): AddressCache {
  const lastUsed = Math.max(-1, ...(cache.used ?? []).map((a) => a.index));
  const unused = cache.unused.filter((a) => a.index > lastUsed);
  return unused.length === cache.unused.length ? cache : { ...cache, unused };
}

export async function loadAddrCache(walletId: string): Promise<AddressCache | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + walletId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AddressCache;
    return Array.isArray(parsed.unused) ? withoutUsed(parsed) : null;
  } catch {
    return null;
  }
}

export async function clearAddrCache(walletId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + walletId);
  } catch {
    // best-effort
  }
}
