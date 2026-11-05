/**
 * BTC spot prices for display, in the user's chosen fiat currency.
 * Fetched from mempool.space (returns USD/EUR/GBP/CHF/CAD/AUD/JPY in one
 * call), cached in memory for 5 minutes, and always optional — every caller
 * must render fine when the price is unavailable.
 */
import { withTimeout } from './withTimeout';
import type { FiatCurrency } from './types';

type PriceMap = Partial<Record<FiatCurrency, number>>;

let cached: { prices: PriceMap; at: number } | null = null;
const TTL_MS = 10 * 1000; // live ticker cadence — mempool.space updates ~continuously

export const FIAT_CURRENCIES: FiatCurrency[] = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY'];

const FIAT_SYMBOL: Record<FiatCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CHF: 'CHF ',
  CAD: 'C$',
  AUD: 'A$',
  JPY: '¥',
};

/** After a mempool failure, skip it for a while: on networks where the host
 *  BLACKHOLES (found in a phone test), the fetch doesn't fail: it hangs to the 60s OS
 *  timeout, and "fallback after the hang" reads as no price at all. */
let mempoolDeadUntil = 0;

async function fetchMempoolSpot(): Promise<PriceMap | null> {
  if (Date.now() < mempoolDeadUntil) return null;
  try {
    const res = await withTimeout(fetch('https://mempool.space/api/v1/prices'), 6_000, 'Price');
    if (!res.ok) {
      mempoolDeadUntil = Date.now() + 5 * 60_000;
      return null;
    }
    const data = (await res.json()) as Record<string, unknown>;
    const prices: PriceMap = {};
    for (const c of FIAT_CURRENCIES) {
      const v = data[c];
      if (typeof v === 'number' && v > 0) prices[c] = v;
    }
    if (Object.keys(prices).length === 0) {
      mempoolDeadUntil = Date.now() + 5 * 60_000;
      return null;
    }
    return prices;
  } catch {
    mempoolDeadUntil = Date.now() + 5 * 60_000;
    return null;
  }
}

/** Fallback spot source: CoinGecko, one call for every supported currency.
 *  Added 2026-08-25: mempool.space REST fails outright on a test phone while
 *  CoinGecko works (the home chart proves it live). Without this, every
 *  getBtcPrice caller AND the live ticker's fiat ratio starved on that
 *  phone, which is what emptied the vault's value and P/L. */
async function fetchCoinGeckoSpot(): Promise<PriceMap | null> {
  try {
    const keys = FIAT_CURRENCIES.map((c) => c.toLowerCase()).join(',');
    const res = await withTimeout(
      fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${keys}`),
      8_000,
      'Price',
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { bitcoin?: Record<string, number> };
    const prices: PriceMap = {};
    for (const c of FIAT_CURRENCIES) {
      const v = data.bitcoin?.[c.toLowerCase()];
      if (typeof v === 'number' && v > 0) prices[c] = v;
    }
    return Object.keys(prices).length > 0 ? prices : null;
  } catch {
    return null;
  }
}

export async function getBtcPrice(currency: FiatCurrency): Promise<number | null> {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return cached.prices[currency] ?? null;
  }
  const prices = (await fetchMempoolSpot()) ?? (await fetchCoinGeckoSpot());
  if (prices) cached = { prices, at: Date.now() };
  return prices?.[currency] ?? cached?.prices[currency] ?? null;
}

/** Back-compat helper (USD). */
export async function getBtcUsdPrice(): Promise<number | null> {
  return getBtcPrice('USD');
}

/** Format sats in fiat at the given rate, e.g. "$150.97" / "€139.20". */
export function formatFiat(sats: number, rate: number, currency: FiatCurrency): string {
  const value = (Math.abs(sats) / 1e8) * rate;
  const digits = currency === 'JPY' ? 0 : 2;
  return `${FIAT_SYMBOL[currency]}${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** Back-compat helper (USD). */
export function formatUsd(sats: number, usdPerBtc: number): string {
  return formatFiat(sats, usdPerBtc, 'USD');
}

/** Currency symbol for UI amount displays. */
export function fiatSymbol(currency: FiatCurrency): string {
  switch (currency) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'CHF': return 'CHF ';
    case 'CAD': return 'C$';
    case 'AUD': return 'A$';
    case 'JPY': return '¥';
  }
}
