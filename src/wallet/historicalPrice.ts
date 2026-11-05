/**
 * Historical BTC price at a transaction's date, in the user's fiat currency —
 * shown under ledger rows ("what was this worth when it happened").
 *
 * Prices come from mempool.space's historical-price endpoint and are cached
 * permanently per (currency, day) in AsyncStorage — history never changes, so
 * each day is fetched at most once, ever. Everything is best-effort: callers
 * render fine with no rate.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dayKey } from './history';
import { withTimeout } from './withTimeout';
import { ecbRate } from './ecbRate';
import type { FiatCurrency } from './types';

const PREFIX = 'keel.histprice.v1:';
/** Failures memoise with an expiry: one throttled lookup must not pin a day
 *  to "no rate" until app relaunch (found in the 2026-08-25 review). */
const NEGATIVE_TTL_MS = 5 * 60_000;
const mem = new Map<string, { rate: number | null; at: number }>();

export interface HistoricalPoint {
  rate: number;
  /** Unix seconds of the price point the API actually returned. The endpoint
   *  snaps to its nearest sample — a caller offering "the price on that day"
   *  must check the snap distance, not assume it. */
  atSecs?: number;
}

/** After one failure, skip mempool for a while — on networks where the host
 *  BLACKHOLES (a test phone) every lookup otherwise burns the full timeout,
 *  which is what turned a portfolio snapshot into "several minutes of
 *  nothing" (decided 2026-08-26). */
let mempoolDeadUntil = 0;

async function fetchMempool(currency: FiatCurrency, tsSecs: number): Promise<HistoricalPoint | null> {
  if (Date.now() < mempoolDeadUntil) return null;
  try {
    const res = await withTimeout(
      fetch(`https://mempool.space/api/v1/historical-price?currency=${currency}&timestamp=${tsSecs}`),
      6_000,
      'Price lookup',
    );
    if (!res.ok) {
      mempoolDeadUntil = Date.now() + 5 * 60_000;
      return null;
    }
    const data = (await res.json()) as { prices?: Array<Record<string, number>> };
    const point = data.prices?.[0];
    const rate = point?.[currency];
    if (typeof rate !== 'number' || rate <= 0) return null;
    return { rate, atSecs: typeof point?.time === 'number' ? point.time : undefined };
  } catch {
    mempoolDeadUntil = Date.now() + 5 * 60_000;
    return null;
  }
}

/** Fallback: that UTC day's BTCUSDT daily close from Binance (history to
 *  2017), crossed into `currency` by the ECB rate when it isn't USD. Added
 *  2026-08-25: mempool.space REST fails outright on a test device while
 *  Binance and frankfurter.dev work — without a second source, every
 *  historical figure on that phone read "unavailable". Day-level only, so
 *  no `atSecs`. */
async function fetchBinanceDay(currency: FiatCurrency, tsSecs: number): Promise<HistoricalPoint | null> {
  try {
    const d = new Date(tsSecs * 1000);
    const dayStartMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const res = await withTimeout(
      fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=${dayStartMs}&limit=1`),
      15_000,
      'Price lookup',
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Array<Array<unknown>>;
    const close = Number(data?.[0]?.[4]);
    if (!Number.isFinite(close) || close <= 0) return null;
    if (currency === 'USD') return { rate: close };
    const fx = await ecbRate('USD', currency, tsSecs);
    if (fx == null) return null;
    return { rate: close * fx };
  } catch {
    return null;
  }
}

/**
 * Noon of the (local) day holding `tsSecs`: the only time a price lookup
 * ever sends (decided 2026-09-26). The exact second of a vault's
 * transaction is its block's timestamp, which singles the transaction out
 * on-chain; the cache is per day (`dayKey`, local) anyway, so nothing is
 * lost. Noon, not midnight, keeps the same calendar date in UTC for the
 * day-level fallback in every time zone within twelve hours of it.
 */
export function dayNoonSecs(tsSecs: number): number {
  const d = new Date(tsSecs * 1000);
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 1000);
}

async function fetchPoint(currency: FiatCurrency, tsSecs: number): Promise<HistoricalPoint | null> {
  // Today's noon may not have happened yet: never ask about the future.
  const day = Math.min(dayNoonSecs(tsSecs), Math.floor(Date.now() / 3_600_000) * 3_600);
  return (await fetchMempool(currency, day)) ?? (await fetchBinanceDay(currency, day));
}

/** True when `tsSecs` falls on today or later — a rate for a day that is not
 *  over is not history, and must never be cached as if it were. */
function isTodayOrFuture(tsSecs: number): boolean {
  return dayKey(tsSecs) >= dayKey(Date.now() / 1000);
}

/** Rate + sample time for the day containing `tsSecs`. Cached per day, except
 *  for today (still moving) and failures (retried after a short TTL). */
export async function getHistoricalPoint(
  currency: FiatCurrency,
  tsSecs: number,
): Promise<HistoricalPoint | null> {
  const key = `${PREFIX}${currency}:${dayKey(tsSecs)}`;
  const cacheable = !isTodayOrFuture(tsSecs);

  const hit = mem.get(key);
  if (hit && (hit.rate != null ? cacheable : Date.now() - hit.at < NEGATIVE_TTL_MS)) {
    return hit.rate != null ? { rate: hit.rate } : null;
  }

  if (cacheable) {
    try {
      const stored = await AsyncStorage.getItem(key);
      if (stored != null) {
        const v = Number(stored);
        if (Number.isFinite(v) && v > 0) {
          mem.set(key, { rate: v, at: Date.now() });
          return { rate: v };
        }
      }
    } catch {
      // fall through to network
    }
  }

  const point = await fetchPoint(currency, tsSecs);
  mem.set(key, { rate: point?.rate ?? null, at: Date.now() });
  if (point != null && cacheable) {
    try {
      await AsyncStorage.setItem(key, String(point.rate));
    } catch {
      // cache is best-effort
    }
  }
  return point;
}

/** Rate for the day containing `tsSecs`, or null when unavailable. */
export async function getHistoricalRate(
  currency: FiatCurrency,
  tsSecs: number,
): Promise<number | null> {
  return (await getHistoricalPoint(currency, tsSecs))?.rate ?? null;
}
