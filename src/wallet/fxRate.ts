/**
 * Cross-currency conversion for recorded fiat amounts (decided 2026-08-25: cost
 * basis "must work across ALL supported fiat currencies in the app").
 *
 * An entry keeps the currency it was recorded in — that is what the receipt
 * says. When the display currency differs, the amount is converted at the
 * exchange rate ON THE ENTRY'S DATE, derived from the same historical BTC
 * price feed the app already uses: mempool.space quotes BTC in every
 * supported fiat, so (BTC-in-target ÷ BTC-in-source) on a given day IS that
 * day's cross rate. Both legs are cached per day, so a conversion costs at
 * most two already-cached lookups.
 *
 * When a rate is unavailable (offline, ancient date), the caller gets null
 * and the entry is DISCLOSED as unconverted — never guessed, never silently
 * dropped from a figure that claims to be complete.
 */
import { getHistoricalPoint } from './historicalPrice';
import { ecbRate } from './ecbRate';
import type { FiatCurrency } from './types';

/** Pure cross-rate arithmetic, split out for tests: amount × (to ÷ from). */
export function crossConvert(amount: number, btcRateFrom: number, btcRateTo: number): number | null {
  if (!Number.isFinite(amount) || !Number.isFinite(btcRateFrom) || !Number.isFinite(btcRateTo)) {
    return null;
  }
  if (btcRateFrom <= 0 || btcRateTo <= 0) return null;
  const out = amount * (btcRateTo / btcRateFrom);
  return Number.isFinite(out) ? out : null;
}

/** Local NOON of the day containing `tsSecs` — one deterministic sample per
 *  day. Both legs of a conversion MUST query the same instant: BTC can move
 *  several percent intraday, and legs snapped to samples hours apart put
 *  that whole move into the "fiat" cross rate (2026-08-25 review). */
function dayAnchorSecs(tsSecs: number): number {
  const d = new Date(tsSecs * 1000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).getTime() / 1000;
}

/** `amount` of `from` in `to`, at the rate on the day containing `tsSecs`.
 *  ECB reference rate first; BTC-price ratio as the fallback; null when
 *  neither source can answer — disclosed by the caller, never guessed. */
export async function convertFiatOnDate(
  amount: number,
  from: FiatCurrency,
  to: FiatCurrency,
  tsSecs: number,
): Promise<number | null> {
  if (from === to) return Number.isFinite(amount) ? amount : null;
  if (!Number.isFinite(amount) || amount < 0) return null;

  const ecb = await ecbRate(from, to, tsSecs);
  if (ecb != null) {
    const out = amount * ecb;
    return Number.isFinite(out) ? out : null;
  }

  const anchor = dayAnchorSecs(tsSecs);
  const [src, dst] = await Promise.all([
    getHistoricalPoint(from, anchor),
    getHistoricalPoint(to, anchor),
  ]);
  if (src == null || dst == null) return null;
  return crossConvert(amount, src.rate, dst.rate);
}
