/**
 * 30-day BTC price series for the home-screen chart.
 *
 * CoinGecko's public market_chart endpoint (no key, daily interval, ~31
 * points) — small payload, all our fiat currencies supported. Cached 15
 * minutes in memory and persisted as last-good in AsyncStorage so the chart
 * renders offline. Best-effort everywhere: callers hide the chart on null.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FiatCurrency } from './types';

export interface PricePoint {
  /** Unix ms. */
  t: number;
  p: number;
}

const STORE_PREFIX = 'keel.pricechart.v1:';
const TTL_MS = 15 * 60 * 1000;
const mem = new Map<string, { at: number; series: PricePoint[] }>();

export type ChartRange = 'LIVE' | '1D' | '7D' | '1M' | '3M' | '6M' | '1Y';

/** CoinGecko `days` per range; granularity is automatic (5min/hourly/daily).
 *  LIVE starts from the 1-day series and appends spot ticks client-side. */
const RANGE_DAYS: Record<ChartRange, string> = {
  LIVE: '1',
  '1D': '1',
  '7D': '7',
  '1M': '30',
  '3M': '90',
  '6M': '180',
  '1Y': '365',
};

/** All ranges, for prefetching. */
export const CHART_RANGES: ChartRange[] = ['LIVE', '1D', '7D', '1M', '3M', '6M', '1Y'];

/**
 * Warm the cache for every range in parallel so switching intervals on the
 * chart is instant instead of waiting on CoinGecko per tap.
 */
export function prefetchPriceSeries(currency: FiatCurrency): void {
  const seen = new Set<string>();
  for (const r of CHART_RANGES) {
    if (seen.has(RANGE_DAYS[r])) continue;
    seen.add(RANGE_DAYS[r]);
    void getPriceSeries(currency, r).catch(() => {});
  }
}

export async function getPriceSeries(
  currency: FiatCurrency,
  range: ChartRange = '1M',
): Promise<PricePoint[] | null> {
  // Key by the DAYS value, not the range name — LIVE and 1D share one fetch.
  const key = `${currency}:${RANGE_DAYS[range]}`;
  const cached = mem.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.series;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=${currency.toLowerCase()}&days=${RANGE_DAYS[range]}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { prices?: Array<[number, number]> };
      const series = (data.prices ?? [])
        .filter((x) => Array.isArray(x) && typeof x[1] === 'number')
        .map(([t, p]) => ({ t, p }));
      if (series.length >= 2) {
        mem.set(key, { at: Date.now(), series });
        void AsyncStorage.setItem(STORE_PREFIX + key, JSON.stringify(series)).catch(() => {});
        return series;
      }
    }
  } catch {
    // fall through to stored copy
  }

  try {
    const stored = await AsyncStorage.getItem(STORE_PREFIX + key);
    if (stored) {
      const series = JSON.parse(stored) as PricePoint[];
      if (Array.isArray(series) && series.length >= 2) return series;
    }
  } catch {
    // nothing usable
  }
  return cached?.series ?? null;
}

const changeMem = new Map<string, { at: number; pct: number }>();

/**
 * Rolling 24-hour price change in percent (CoinGecko simple/price). The chart
 * stays 30-day; only the header percentage uses this. Null on failure —
 * callers fall back to approximating from the daily series.
 */
export async function get24hChangePct(currency: FiatCurrency): Promise<number | null> {
  const key = currency.toLowerCase();
  const cached = changeMem.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.pct;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${key}&include_24hr_change=true`,
    );
    if (res.ok) {
      const data = (await res.json()) as Record<string, Record<string, number>>;
      const pct = data.bitcoin?.[`${key}_24h_change`];
      if (typeof pct === 'number' && Number.isFinite(pct)) {
        changeMem.set(key, { at: Date.now(), pct });
        return pct;
      }
    }
  } catch {
    // fall through
  }
  return cached?.pct ?? null;
}
