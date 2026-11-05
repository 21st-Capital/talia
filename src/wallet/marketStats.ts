/**
 * Bitcoin market figures for the Stats card under the full-screen chart:
 * market cap, rank, circulating and max supply, 24-hour trading volume. One
 * CoinGecko call in the user's currency, cached five minutes in memory and
 * kept as last-good on disk. Best-effort: null means "show the unavailable
 * line", never a crash.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { withTimeout } from './withTimeout';
import type { FiatCurrency } from './types';

export interface MarketStats {
  currency: FiatCurrency;
  marketCap: number;
  rank: number;
  circulatingSupply: number;
  maxSupply: number | null;
  volume24h: number;
  fetchedAt: number;
}

const STORE_PREFIX = 'talia.marketstats.v1:';
const TTL_MS = 5 * 60_000;
const mem = new Map<FiatCurrency, MarketStats>();

/** Pull the figures out of one CoinGecko `coins/markets` row. Exported for
 *  the unit test; tolerant of missing fields (max_supply is null for coins
 *  without a cap, and we still show the rest). */
export function parseMarketRow(row: unknown, currency: FiatCurrency, nowMs: number): MarketStats | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const marketCap = num(r.market_cap);
  const rank = num(r.market_cap_rank);
  const circulatingSupply = num(r.circulating_supply);
  const volume24h = num(r.total_volume);
  if (marketCap == null || rank == null || circulatingSupply == null || volume24h == null) return null;
  return {
    currency,
    marketCap,
    rank,
    circulatingSupply,
    maxSupply: num(r.max_supply),
    volume24h,
    fetchedAt: nowMs,
  };
}

export async function getMarketStats(currency: FiatCurrency): Promise<MarketStats | null> {
  const cached = mem.get(currency);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;

  try {
    const res = await withTimeout(
      fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency.toLowerCase()}&ids=bitcoin`),
      8_000,
      'Market stats',
    );
    if (res.ok) {
      const rows = (await res.json()) as unknown[];
      const stats = parseMarketRow(Array.isArray(rows) ? rows[0] : null, currency, Date.now());
      if (stats) {
        mem.set(currency, stats);
        void AsyncStorage.setItem(STORE_PREFIX + currency, JSON.stringify(stats)).catch(() => {});
        return stats;
      }
    }
  } catch {
    // fall through to the stored copy
  }
  if (cached) return cached;
  try {
    const stored = await AsyncStorage.getItem(STORE_PREFIX + currency);
    if (stored) {
      const s = JSON.parse(stored) as MarketStats;
      if (s && typeof s.marketCap === 'number') return s;
    }
  } catch {
    // nothing usable
  }
  return null;
}
