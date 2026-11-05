/**
 * Number formatting for the price screen: fiat values, signed changes, and
 * the compact "1.54T" style the Stats card uses. Pure and tested.
 */
import type { FiatCurrency } from './types';
import { fiatSymbol } from './price';

function fiatDigits(currency: FiatCurrency): number {
  return currency === 'JPY' ? 0 : 2;
}

/** "€66,465.09", "¥9,876,543". */
export function formatFiatValue(value: number, currency: FiatCurrency): string {
  const digits = fiatDigits(currency);
  return `${fiatSymbol(currency)}${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** True when `delta` still reads as a loss AFTER rounding to the currency's
 *  decimals: a change of −0.001 shows as +€0.00, not a red −€0.00. */
export function readsNegative(delta: number, currency: FiatCurrency): boolean {
  const unit = 10 ** -fiatDigits(currency);
  return delta <= -unit / 2;
}

/** "+€307.19" / "−€307.19" (a real minus sign, U+2212, like every amount in
 *  the app, so a leading ASCII hyphen can never be read as a list bullet). */
export function formatSignedFiat(delta: number, currency: FiatCurrency): string {
  const sign = readsNegative(delta, currency) ? '−' : '+';
  return `${sign}${formatFiatValue(Math.abs(delta), currency)}`;
}

/** "+0.46%" / "−0.46%"; a percentage that rounds to 0.00 reads as +0.00%. */
export function formatSignedPct(pct: number): string {
  const sign = pct <= -0.005 ? '−' : '+';
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

/** THE one way a change is written across the app (decided 2026-09-12: "use ()
 *  for all percentage numbers"): the signed amount, then the percentage in
 *  parentheses without a sign, two decimals: "+$23.99 (0.03%)",
 *  "−€112.84 (0.15%)". A null percentage leaves the amount alone. */
export function formatChange(delta: number, pct: number | null | undefined, currency: FiatCurrency): string {
  const amount = formatSignedFiat(delta, currency);
  if (pct == null || !Number.isFinite(pct)) return amount;
  return `${amount} (${Math.abs(pct).toFixed(2)}%)`;
}

/**
 * Compact figures for the Stats card: 1.54T, 29.33B, 20.08M, 21M. Two
 * decimals at most, trailing zeros dropped (so max supply reads "21M", not
 * "21.00M"). Below a million the plain grouped number is used.
 */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const units: Array<[string, number]> = [
    ['T', 1e12],
    ['B', 1e9],
    ['M', 1e6],
  ];
  for (const [suffix, size] of units) {
    if (abs >= size) {
      const scaled = abs / size;
      // Trailing zeros go only from the DECIMALS: "21.00" is 21, but "100"
      // must stay 100 (the first draft turned 100M into 1M).
      const fixed = scaled.toFixed(scaled >= 100 ? 0 : 2);
      const text = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
      return `${n < 0 ? '−' : ''}${text}${suffix}`;
    }
  }
  return `${n < 0 ? '−' : ''}${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/** "€1.33T" and friends. */
export function formatCompactFiat(n: number, currency: FiatCurrency): string {
  return `${fiatSymbol(currency)}${formatCompact(n)}`;
}
