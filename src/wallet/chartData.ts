/**
 * Price series for the full-screen chart: Binance candles converted into the
 * user's currency, cached in memory per range and persisted as last-good so
 * the chart still draws offline. Best-effort everywhere: callers show a short
 * "unavailable" line on null, never a blank screen.
 *
 * Sources, in order:
 *   1. Binance klines (BTC/USDT), any range, converted at the ECB reference
 *      rate per day (frankfurter.dev, one open-ended range call per currency
 *      per day) or at the live ticker's ratio for the short ranges.
 *   2. CoinGecko market_chart in the user's currency (the home card's feed),
 *      for ranges inside its 365-day public limit, when Binance fails.
 *
 * The rules (aggregation, conversion, axes) live in chartSeries.ts, pure and
 * tested. This file only fetches and caches.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { withTimeout } from './withTimeout';
import { getBtcPrice } from './price';
import { ecbRate } from './ecbRate';
import { getPriceSeries } from './priceHistory';
import type { ChartRange as CoinGeckoRange } from './priceHistory';
import type { FiatCurrency } from './types';
import {
  CHART_RANGES,
  RANGE_SPEC,
  candlesFromPoints,
  candlesSince,
  convertCandles,
  localMidnight,
  parseKlines,
  rateLookup,
  utcDayKey,
} from './chartSeries';
import type { Candle, ChartRange } from './chartSeries';

export type ChartSource = 'binance' | 'coingecko';

export interface ChartSeries {
  candles: Candle[];
  source: ChartSource;
  currency: FiatCurrency;
  range: ChartRange;
  fetchedAt: number;
}

const STORE_PREFIX = 'talia.chart.v1:';
const mem = new Map<string, ChartSeries>();
const inflight = new Map<string, Promise<ChartSeries | null>>();

/** Warm every range so switching is instant. Fire-and-forget. */
export function prefetchChartSeries(currency: FiatCurrency): void {
  for (const r of CHART_RANGES) void getChartSeries(currency, r).catch(() => {});
}

/** A "today" series is only today while it is still today: at midnight the
 *  cached candles belong to yesterday and must not be drawn on the new
 *  day's axis (they would all land on its left edge). */
function todayOnly(series: ChartSeries): ChartSeries | null {
  if (series.range !== '1D') return series;
  const candles = candlesSince(series.candles, localMidnight(Date.now()));
  if (candles.length === 0) return null;
  return candles.length === series.candles.length ? series : { ...series, candles };
}

/** Whatever is in memory for this range, fresh or stale, without fetching.
 *  The screen draws it at once while the fresh series loads, so a range
 *  switch never blanks a chart it already had. */
export function peekChartSeries(currency: FiatCurrency, range: ChartRange): ChartSeries | null {
  const cached = mem.get(`${currency}:${range}`);
  return cached ? todayOnly(cached) : null;
}

export async function getChartSeries(currency: FiatCurrency, range: ChartRange): Promise<ChartSeries | null> {
  const key = `${currency}:${range}`;
  const spec = RANGE_SPEC[range];
  const cached = peekChartSeries(currency, range);
  if (cached && Date.now() - cached.fetchedAt < spec.ttlMs) return cached;

  // One fetch per key at a time: the screen and the prefetch ask together.
  const running = inflight.get(key);
  if (running) return running;
  const task = (async (): Promise<ChartSeries | null> => {
    const fresh = (await fetchBinanceSeries(currency, range)) ?? (await fetchCoinGeckoSeries(currency, range));
    if (fresh) {
      mem.set(key, fresh);
      void AsyncStorage.setItem(STORE_PREFIX + key, JSON.stringify(fresh)).catch(() => {});
      return fresh;
    }
    if (cached) return cached; // stale beats nothing
    try {
      const stored = await AsyncStorage.getItem(STORE_PREFIX + key);
      if (stored) {
        const s = JSON.parse(stored) as ChartSeries;
        if (Array.isArray(s.candles) && s.candles.length > 0) {
          // A stored "today" is only today while it is still today.
          if (range === '1D') s.candles = candlesSince(s.candles, localMidnight(Date.now()));
          if (s.candles.length > 0) return s;
        }
      }
    } catch {
      // nothing usable
    }
    return null;
  })();
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

// ---------------------------------------------------------------- Binance

async function fetchBinanceSeries(currency: FiatCurrency, range: ChartRange): Promise<ChartSeries | null> {
  const spec = RANGE_SPEC[range];
  const usd = await fetchKlines(spec.interval, spec.limit, range === '1D' ? localMidnight(Date.now()) : undefined);
  if (!usd || usd.length === 0) return null;
  const rateAt = await fiatRateFn(currency, spec.perDayFx);
  if (!rateAt) return null;
  const candles = convertCandles(usd, rateAt);
  if (candles.length === 0) return null;
  return { candles, source: 'binance', currency, range, fetchedAt: Date.now() };
}

async function fetchKlines(interval: string, limit: number, startTime?: number): Promise<Candle[] | null> {
  try {
    const start = startTime != null ? `&startTime=${startTime}` : '';
    const res = await withTimeout(
      fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}${start}`),
      10_000,
      'Price history',
    );
    if (!res.ok) return null;
    const candles = parseKlines(await res.json());
    return candles.length > 0 ? candles : null;
  } catch {
    return null;
  }
}

/** The number the live ticker multiplies USD by: fiat spot / USD spot, both
 *  from one cached spot fetch. Null when no spot source answers. Shared
 *  across callers for ten seconds: the prefetch asks for seven ranges at
 *  once, and without this each one started its own spot lookups (fourteen
 *  calls in a burst, right at CoinGecko's public limit). */
let spotShared: { currency: FiatCurrency; at: number; promise: Promise<number | null> } | null = null;

function spotRatio(currency: FiatCurrency): Promise<number | null> {
  if (currency === 'USD') return Promise.resolve(1);
  if (spotShared && spotShared.currency === currency && Date.now() - spotShared.at < 10_000) {
    return spotShared.promise;
  }
  const promise = (async (): Promise<number | null> => {
    const fiat = await getBtcPrice(currency);
    const usd = await getBtcPrice('USD');
    if (fiat != null && usd != null && usd > 0 && fiat > 0) return fiat / usd;
    return null;
  })();
  spotShared = { currency, at: Date.now(), promise };
  return promise;
}

/**
 * USD → currency for a candle's time. Short ranges use one ratio (the live
 * ticker's, so the tail meets the ticking price); long ranges use the ECB
 * rate of each candle's own day, with the ticker's ratio for the days the
 * ECB has not published yet. Every leg has a fallback, because on a test phone
 * some hosts blackhole while others answer (see price.ts).
 */
async function fiatRateFn(currency: FiatCurrency, perDay: boolean): Promise<((tMs: number) => number | null) | null> {
  if (currency === 'USD') return () => 1;
  const spot = await spotRatio(currency);
  if (perDay) {
    const table = await ecbTable(currency);
    if (table) return rateLookup(table, spot);
  }
  if (spot != null) return () => spot;
  const ecbToday = await ecbRate('USD', currency, Date.now() / 1000);
  return ecbToday != null ? () => ecbToday : null;
}

// ---------------------------------------------------------------- ECB table

/** Binance's BTC/USDT history starts here; so does the rate table. */
const ECB_TABLE_START = '2017-08-14';
const ECB_STORE_PREFIX = 'talia.ecbtable.v1:';
const ecbMem = new Map<string, { day: string; table: Record<string, number> }>();
const ecbInflight = new Map<string, Promise<Record<string, number> | null>>();

/**
 * Every ECB USD→currency rate since 2017, one call, refreshed once per UTC
 * day (the ECB publishes once a day, in the afternoon). About 2,300 numbers;
 * cached in memory and on disk.
 */
async function ecbTable(currency: FiatCurrency): Promise<Record<string, number> | null> {
  const today = utcDayKey(Date.now());
  const hit = ecbMem.get(currency);
  if (hit && hit.day === today) return hit.table;
  const running = ecbInflight.get(currency);
  if (running) return running;
  const task = (async (): Promise<Record<string, number> | null> => {
    const storeKey = ECB_STORE_PREFIX + currency;
    let stored: { day: string; table: Record<string, number> } | null = null;
    try {
      const raw = await AsyncStorage.getItem(storeKey);
      if (raw) stored = JSON.parse(raw) as { day: string; table: Record<string, number> };
    } catch {
      stored = null;
    }
    if (stored && stored.day === today && stored.table && Object.keys(stored.table).length > 0) {
      ecbMem.set(currency, stored);
      return stored.table;
    }
    const fresh = await fetchEcbRange(currency);
    if (fresh) {
      const entry = { day: today, table: fresh };
      ecbMem.set(currency, entry);
      void AsyncStorage.setItem(storeKey, JSON.stringify(entry)).catch(() => {});
      return fresh;
    }
    // Yesterday's table still converts every day but the last one or two,
    // which rateLookup fills with the live ratio.
    if (stored?.table && Object.keys(stored.table).length > 0) return stored.table;
    return hit?.table ?? null;
  })();
  ecbInflight.set(currency, task);
  try {
    return await task;
  } finally {
    ecbInflight.delete(currency);
  }
}

async function fetchEcbRange(currency: FiatCurrency): Promise<Record<string, number> | null> {
  try {
    const res = await withTimeout(
      fetch(`https://api.frankfurter.dev/v1/${ECB_TABLE_START}..?base=USD&symbols=${currency}`),
      20_000,
      'Exchange-rate history',
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: Record<string, Record<string, number>> };
    const table: Record<string, number> = {};
    for (const [day, rates] of Object.entries(data.rates ?? {})) {
      const v = rates?.[currency];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) table[day] = v;
    }
    return Object.keys(table).length > 0 ? table : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- CoinGecko

const COINGECKO_RANGE: Partial<Record<ChartRange, CoinGeckoRange>> = {
  '1D': '1D',
  '1W': '7D',
  '1M': '1M',
  '6M': '6M',
  '1Y': '1Y',
};

async function fetchCoinGeckoSeries(currency: FiatCurrency, range: ChartRange): Promise<ChartSeries | null> {
  const cg = COINGECKO_RANGE[range];
  if (!cg) return null;
  const points = await getPriceSeries(currency, cg).catch(() => null);
  if (!points || points.length === 0) return null;
  let candles = candlesFromPoints(points);
  if (range === '1D') candles = candlesSince(candles, localMidnight(Date.now()));
  if (candles.length === 0) return null;
  return { candles, source: 'coingecko', currency, range, fetchedAt: Date.now() };
}
