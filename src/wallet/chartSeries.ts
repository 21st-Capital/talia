/**
 * Pure rules for the full-screen price chart's data (decided 2026-09-11, the
 * Revolut-style redesign): Binance candles in, candles in the user's
 * currency out. No network and no storage here (chartData.ts does that), so
 * every rule is unit-tested.
 *
 * Why Binance and not CoinGecko for the chart itself: CoinGecko's public API
 * refuses anything older than 365 days (verified 2026-09-11), so the 5-year
 * and all-time ranges need a source with real history. Binance has BTC/USDT
 * candles back to August 2017, at any granularity, and is the SAME feed the
 * home ticker streams from, so the chart's tail and the live price agree.
 * Non-USD currencies convert at the ECB reference rate for the candle's own
 * day (long ranges) or at the ratio the live ticker uses (short ranges).
 */

export type ChartRange = '1D' | '1W' | '1M' | '6M' | '1Y' | '5Y' | 'ALL';
export const CHART_RANGES: ChartRange[] = ['1D', '1W', '1M', '6M', '1Y', '5Y', 'ALL'];

export type ChartMode = 'line' | 'candles';

export interface Candle {
  /** Open time, unix ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Where the x-axis starts and ends, unix ms. Today's chart runs from local
 *  midnight to the next one, so the line fills the day as it goes (the way
 *  Revolut draws "Today"); every other range spans its candles exactly. */
export interface TimeAxis {
  start: number;
  end: number;
}

export interface RangeSpec {
  /** Binance kline interval drawn as the line. */
  interval: BinanceInterval;
  /** How many klines the range needs. */
  limit: number;
  /** Candlestick width, in line klines: 6 x 5m = 30-minute candles. */
  group: number;
  /** Cache lifetime. */
  ttlMs: number;
  /** Convert every kline at its own day's ECB rate (long ranges), or the whole
   *  range at the ratio the live ticker uses (short ranges, where the fiat
   *  pair barely moves and a matching tail matters more). */
  perDayFx: boolean;
  /** Under the change figure: "Today", "Past week"... */
  periodLabel: string;
  /** CoinGecko `days` for the fallback line. Absent when the range exceeds
   *  the public API's 365-day limit. */
  coingeckoDays?: string;
}

export type BinanceInterval = '5m' | '1h' | '4h' | '1d' | '1w';

export const INTERVAL_MS: Record<BinanceInterval, number> = {
  '5m': 5 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

export const RANGE_SPEC: Record<ChartRange, RangeSpec> = {
  '1D': { interval: '5m', limit: 288, group: 6, ttlMs: 60_000, perDayFx: false, periodLabel: 'Today', coingeckoDays: '1' },
  '1W': { interval: '1h', limit: 168, group: 4, ttlMs: 5 * 60_000, perDayFx: false, periodLabel: 'Past week', coingeckoDays: '7' },
  '1M': { interval: '4h', limit: 180, group: 3, ttlMs: 15 * 60_000, perDayFx: true, periodLabel: 'Past month', coingeckoDays: '30' },
  '6M': { interval: '1d', limit: 180, group: 3, ttlMs: 15 * 60_000, perDayFx: true, periodLabel: 'Past 6 months', coingeckoDays: '180' },
  '1Y': { interval: '1d', limit: 365, group: 7, ttlMs: 15 * 60_000, perDayFx: true, periodLabel: 'Past year', coingeckoDays: '365' },
  '5Y': { interval: '1w', limit: 261, group: 4, ttlMs: 60 * 60_000, perDayFx: true, periodLabel: 'Past 5 years' },
  ALL: { interval: '1w', limit: 1000, group: 8, ttlMs: 60 * 60_000, perDayFx: true, periodLabel: 'All time' },
};

/** Milliseconds one candlestick covers for a range. */
export function candleSpanMs(range: ChartRange): number {
  const spec = RANGE_SPEC[range];
  return INTERVAL_MS[spec.interval] * spec.group;
}

/** Local midnight (unix ms) of the day containing `nowMs`. */
export function localMidnight(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The x-axis for a range: today runs midnight to midnight, the rest span
 *  their candles. `spanMs` (candle mode) pads the end so the last candle's
 *  body fits inside the axis. */
export function timeAxis(range: ChartRange, candles: Candle[], nowMs: number, spanMs = 0): TimeAxis {
  if (range === '1D') {
    const start = localMidnight(nowMs);
    return { start, end: start + 24 * 60 * 60_000 };
  }
  if (candles.length === 0) return { start: nowMs, end: nowMs };
  const start = candles[0].t;
  const end = candles[candles.length - 1].t + spanMs;
  return { start, end: end > start ? end : start + 1 };
}

/**
 * Binance kline rows are arrays of strings:
 * [openTime, open, high, low, close, volume, closeTime, ...]. Anything that
 * does not parse to a finite positive candle is dropped rather than drawn.
 */
export function parseKlines(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const t = Number(row[0]);
    const o = Number(row[1]);
    const h = Number(row[2]);
    const l = Number(row[3]);
    const c = Number(row[4]);
    if (![t, o, h, l, c].every((v) => Number.isFinite(v) && v > 0)) continue;
    if (h < l) continue;
    out.push({ t, o, h, l, c });
  }
  return out;
}

/**
 * Fold fine candles into wider ones: each output candle covers one `spanMs`
 * bucket counted from the FIRST candle, so today's 30-minute candles start
 * at local midnight (where the day's fetch starts), weekly klines fold into
 * whole Monday-to-Sunday weeks, and no candle is ever dated before the data
 * begins. The last output candle may be partial: it is "now".
 */
export function aggregateCandles(candles: Candle[], spanMs: number): Candle[] {
  if (spanMs <= 0 || candles.length === 0) return candles.slice();
  const t0 = candles[0].t;
  const out: Candle[] = [];
  let bucket = Number.NaN;
  for (const k of candles) {
    const b = Math.floor((k.t - t0) / spanMs);
    const last = out[out.length - 1];
    if (b === bucket && last) {
      last.h = Math.max(last.h, k.h);
      last.l = Math.min(last.l, k.l);
      last.c = k.c;
    } else {
      bucket = b;
      out.push({ t: t0 + b * spanMs, o: k.o, h: k.h, l: k.l, c: k.c });
    }
  }
  return out;
}

/** UTC day key (YYYY-MM-DD) of a unix-ms timestamp. ECB rates are dated by
 *  the publishing day, and Binance klines are UTC-aligned, so UTC is the
 *  consistent choice here (the ledger's local-day key is a different job). */
export function utcDayKey(tMs: number): string {
  const d = new Date(tMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * A rate-for-timestamp function over a day → rate table (the ECB series).
 * Weekends and holidays take the previous published day. Days AFTER the
 * table's last entry (today, and yesterday before the ECB publishes) take
 * `trailing` when given, which is the ratio the live ticker uses, so the
 * chart's tail meets the ticking price without a step; without it they take
 * the last published rate. Days before the table's first entry take the
 * first rate. An empty table yields null for everything.
 */
export function rateLookup(
  table: Record<string, number>,
  trailing: number | null = null,
): (tMs: number) => number | null {
  const days = Object.keys(table)
    .filter((d) => Number.isFinite(table[d]) && table[d] > 0)
    .sort();
  if (days.length === 0) {
    return () => (trailing != null && trailing > 0 ? trailing : null);
  }
  const lastDay = days[days.length - 1];
  return (tMs: number): number | null => {
    const key = utcDayKey(tMs);
    if (key > lastDay) return trailing != null && trailing > 0 ? trailing : table[lastDay];
    // Last day <= key (binary search on the sorted keys).
    let lo = 0;
    let hi = days.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (days[mid] <= key) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return table[days[found >= 0 ? found : 0]];
  };
}

/** Scale every candle by the rate for its own time. A candle whose rate is
 *  unknown is dropped, never shown in the wrong currency. */
export function convertCandles(candles: Candle[], rateAt: (tMs: number) => number | null): Candle[] {
  const out: Candle[] = [];
  for (const k of candles) {
    const r = rateAt(k.t);
    if (r == null || !Number.isFinite(r) || r <= 0) continue;
    out.push({ t: k.t, o: k.o * r, h: k.h * r, l: k.l * r, c: k.c * r });
  }
  return out;
}

/** The chart's last point follows the LIVE price: the line's tail moves with
 *  every tick instead of freezing on the last fetched close, and the current
 *  candle's high/low stretch to include it. */
export function withLiveClose(candles: Candle[], spot: number | null): Candle[] {
  if (spot == null || !Number.isFinite(spot) || spot <= 0 || candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  return [
    ...candles.slice(0, -1),
    { t: last.t, o: last.o, h: Math.max(last.h, spot), l: Math.min(last.l, spot), c: spot },
  ];
}

/** Close-only points (the CoinGecko fallback) become flat candles, so the
 *  rest of the chart never needs to know which source fed it. */
export function candlesFromPoints(points: Array<{ t: number; p: number }>): Candle[] {
  const out: Candle[] = [];
  for (const pt of points) {
    if (!Number.isFinite(pt.t) || !Number.isFinite(pt.p) || pt.p <= 0) continue;
    out.push({ t: pt.t, o: pt.p, h: pt.p, l: pt.p, c: pt.p });
  }
  return out;
}

/** Keep only candles at or after `startMs`. */
export function candlesSince(candles: Candle[], startMs: number): Candle[] {
  return candles.filter((k) => k.t >= startMs);
}

export interface SeriesSummary {
  /** Where the period started: the first candle's open. */
  open: number;
  /** The latest value: the last candle's close (which is the live price). */
  last: number;
  /** Extremes of what the chart DRAWS: closes for the line, wicks for candles. */
  high: number;
  low: number;
  changeAbs: number;
  changePct: number;
}

/** Figures for the header and the chart labels. Null on an empty series. */
export function summarize(candles: Candle[], mode: ChartMode): SeriesSummary | null {
  if (candles.length === 0) return null;
  const open = candles[0].o;
  const last = candles[candles.length - 1].c;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  for (const k of candles) {
    const hi = mode === 'candles' ? k.h : k.c;
    const lo = mode === 'candles' ? k.l : k.c;
    if (hi > high) high = hi;
    if (lo < low) low = lo;
  }
  const changeAbs = last - open;
  const changePct = open > 0 ? (changeAbs / open) * 100 : 0;
  return { open, last, high, low, changeAbs, changePct };
}

/** Change of one scrubbed point against the period's open. */
export function changeAt(open: number, value: number): { changeAbs: number; changePct: number } {
  const changeAbs = value - open;
  return { changeAbs, changePct: open > 0 ? (changeAbs / open) * 100 : 0 };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The time under the price while the finger is on the chart. Today shows the
 * clock, the week and month show day and clock, longer ranges show the date.
 * Local time, like every clock the user reads.
 */
export function formatScrubTime(tMs: number, range: ChartRange, nowMs: number = Date.now()): string {
  const d = new Date(tMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  switch (range) {
    case '1D': {
      const today = localMidnight(nowMs);
      if (tMs >= today) return `Today ${clock}`;
      if (tMs >= today - 24 * 60 * 60_000) return `Yesterday ${clock}`;
      return `${day}, ${clock}`;
    }
    case '1W':
    case '1M':
      return `${day}, ${clock}`;
    default:
      return `${day} ${d.getFullYear()}`;
  }
}
