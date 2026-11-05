/**
 * Persistence for per-coin cost records (see coinBasis.ts).
 *
 * Same posture as manualEntries.ts, for the same reason: these numbers exist
 * NOWHERE else — no chain, no backend can give back "what I paid". A failed
 * save THROWS so the screen can say the record was not kept, and reads drop
 * malformed entries instead of letting one poison every total.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CoinBasisRecord } from './coinBasis';

const PREFIX = 'keel.coincosts.v1:';

export async function loadCoinCosts(walletId: string): Promise<CoinBasisRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + walletId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

/** Replace the wallet's records. Throws when the write fails — see header. */
export async function saveCoinCosts(
  walletId: string,
  records: readonly CoinBasisRecord[],
): Promise<void> {
  await AsyncStorage.setItem(PREFIX + walletId, JSON.stringify(records));
}

export async function clearCoinCosts(walletId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + walletId);
  } catch {
    // Deleting a wallet must not fail on its cost records.
  }
}

function isRecord(v: unknown): v is CoinBasisRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<CoinBasisRecord>;
  return (
    typeof r.outpoint === 'string' &&
    r.outpoint.includes(':') &&
    typeof r.amountSats === 'number' &&
    typeof r.costFiat === 'number' &&
    typeof r.fiatCurrency === 'string' &&
    (r.source === 'user' || r.source === 'marketOnDate') &&
    typeof r.updatedAt === 'number'
  );
}
