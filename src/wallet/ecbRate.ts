/**
 * Official daily fiat cross rates: ECB reference rates via frankfurter.dev.
 * Decades of history, all 7 supported currencies, weekends snap to the
 * previous business day. A separate module because BOTH fxRate.ts (fiat
 * conversion) and historicalPrice.ts (BTC-price fallback) need it, and
 * importing either from the other would be a cycle.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { withTimeout } from './withTimeout';
import type { FiatCurrency } from './types';

// The official daily fiat cross rates — decades of history, all 7 supported
// currencies, weekends snap to the previous business day. Chosen over the
// BTC-price-ratio method because (a) it is the actual exchange rate, with no
// bitcoin intraday noise in it, and (b) it is a DIFFERENT host from
// mempool.space, whose REST endpoints demonstrably fail on a test phone while
// other hosts work (2026-08-25: the $30,000 entry read "could not be
// converted yet" on a phone whose Binance ticker and CoinGecko chart were
// both live). The BTC-ratio path remains as the fallback.

const FX_PREFIX = 'keel.fxrate.v1:';
const NEGATIVE_TTL_MS = 5 * 60_000;
const fxMem = new Map<string, { rate: number | null; at: number }>();

/** Local YYYY-MM-DD of the day containing `tsSecs`. */
export function isoDay(tsSecs: number): string {
  const d = new Date(tsSecs * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export async function ecbRate(
  from: FiatCurrency,
  to: FiatCurrency,
  tsSecs: number,
): Promise<number | null> {
  const day = isoDay(tsSecs);
  const key = `${FX_PREFIX}${from}:${to}:${day}`;
  // ECB publishes in the afternoon — a same-day request returns yesterday's
  // rate, so today is never persisted as if it were settled history.
  const cacheable = day < isoDay(Date.now() / 1000);

  const hit = fxMem.get(key);
  if (hit && (hit.rate != null ? cacheable : Date.now() - hit.at < NEGATIVE_TTL_MS)) {
    return hit.rate;
  }
  if (cacheable) {
    try {
      const stored = await AsyncStorage.getItem(key);
      if (stored != null) {
        const v = Number(stored);
        if (Number.isFinite(v) && v > 0) {
          fxMem.set(key, { rate: v, at: Date.now() });
          return v;
        }
      }
    } catch {
      // fall through to network
    }
  }
  let rate: number | null = null;
  try {
    const res = await withTimeout(
      fetch(`https://api.frankfurter.dev/v1/${day}?base=${from}&symbols=${to}`),
      15_000,
      'Exchange-rate lookup',
    );
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const v = data.rates?.[to];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) rate = v;
    }
  } catch {
    rate = null;
  }
  fxMem.set(key, { rate, at: Date.now() });
  if (rate != null && cacheable) {
    try {
      await AsyncStorage.setItem(key, String(rate));
    } catch {
      // cache is best-effort
    }
  }
  return rate;
}

