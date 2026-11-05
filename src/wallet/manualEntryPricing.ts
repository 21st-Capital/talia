/**
 * The money side of one portfolio entry: a price per bitcoin, a fee, and the
 * TOTAL the entry stores.
 *
 * Why this exists (decided 2026-09-05): the entry screen used to ask only for the
 * total paid or received. Selling 0.25 BTC at 79,500 per bitcoin, a tester typed
 * 79,500 — the price, not the total — and the portfolio dutifully reported
 * $79,500 received, an implied $318,000 per bitcoin. Nothing miscalculated;
 * the label invited the wrong number, and the person who knows the app best
 * still fell in.
 *
 * The model that was asked for (2026-09-07), in the request's own example: 0.5 BTC for 50,000
 * is a price of 100,000, and a fee is simply ADDED to what was paid. So the
 * screen carries three numbers, each of which the user may be the one to know:
 *
 *   coins value = amount × price per bitcoin      (either one fills in the other)
 *   total       = coins value + fee   on a buy
 *   total       = coins value − fee   on a sell
 *
 * The stored shape does NOT change: `ManualEntry.fiatAmount` is still the
 * total, so manualLedger and every cost-basis figure behind it are untouched
 * and nothing migrates. Reopening an entry runs the arithmetic backwards.
 *
 * Pure: no storage, no native, no clock.
 */
import { SATS_PER_BTC } from './manualLedger';
import type { ManualEntryKind } from './manualLedger';
import type { FiatCurrency } from './types';

/** Decimals a currency is actually written in (yen has none). */
export function fiatDecimals(currency?: FiatCurrency): number {
  return currency === 'JPY' ? 0 : 2;
}

/** Round to a currency's own precision. `toFixed` rounds the decimal the user
 *  sees, where `Math.round(v * 100) / 100` rounds the binary approximation. */
function roundMoney(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

/** An amount at its currency's own precision: cents, or whole yen. A fee is
 *  kept this way, like the total it sits inside (decided 2026-10-22: a fee
 *  typed finer than the currency made the stored total and a typed price
 *  disagree by one unit). */
export function roundFiat(value: number, currency?: FiatCurrency): number {
  return roundMoney(value, fiatDecimals(currency));
}

export interface EntryTotal {
  /** Paid (buy) or received (sell), rounded to the currency's precision. */
  total: number;
  /**
   * True when a sell's fee was larger than the sale itself, so the total was
   * held at zero. Clamped rather than allowed negative: a negative "received"
   * would flow straight into realized proceeds and quietly corrupt every
   * profit figure. The screen says the fee is the larger number instead.
   */
  clampedAtZero: boolean;
}

/**
 * What the coins themselves came to, before any fee: amount × price per
 * bitcoin. Undefined when either number is unusable, so an unreadable figure
 * is never silently recorded as zero.
 */
export function coinsValueFromPrice(
  amountSats: number,
  pricePerBtc: number,
  currency?: FiatCurrency,
): number | undefined {
  if (!Number.isFinite(amountSats) || amountSats <= 0) return undefined;
  if (!Number.isFinite(pricePerBtc) || pricePerBtc < 0) return undefined;
  // btc first: (amountSats × price) would leave safe-integer range on large
  // amounts, while amountSats / SATS_PER_BTC never exceeds 21 million.
  const value = (amountSats / SATS_PER_BTC) * pricePerBtc;
  return Number.isFinite(value) ? roundMoney(value, fiatDecimals(currency)) : undefined;
}

/**
 * The reverse: the price per bitcoin behind a value the user typed, or behind
 * the total an older entry already carries.
 *
 * The result is the SHORTEST number of decimals that reproduces that value, so
 * reopening an entry and saving it unchanged cannot nudge the figure on file.
 */
export function pricePerBtcFromCoinsValue(
  amountSats: number,
  coinsValue: number,
): number | undefined {
  if (!Number.isFinite(amountSats) || amountSats <= 0) return undefined;
  if (!Number.isFinite(coinsValue) || coinsValue < 0) return undefined;

  const btc = amountSats / SATS_PER_BTC;
  const exact = coinsValue / btc;
  if (!Number.isFinite(exact)) return undefined;

  // Half of the smallest unit any supported currency shows: closer than this
  // and the value rounds back to exactly what was typed.
  const tolerance = 0.005;
  for (let decimals = 2; decimals <= 8; decimals += 1) {
    const candidate = roundMoney(exact, decimals);
    if (Math.abs(candidate * btc - coinsValue) < tolerance) return candidate;
  }
  return roundMoney(exact, 2);
}

/** The total the entry stores: a buy adds the fee to what the coins cost, a
 *  sell takes it off what came back. */
export function entryTotalWithFee(
  kind: ManualEntryKind,
  coinsValue: number,
  fee = 0,
  currency?: FiatCurrency,
): EntryTotal | undefined {
  if (!Number.isFinite(coinsValue) || coinsValue < 0) return undefined;
  if (!Number.isFinite(fee) || fee < 0) return undefined;
  const raw = kind === 'buy' ? coinsValue + fee : coinsValue - fee;
  if (!Number.isFinite(raw)) return undefined;
  return {
    total: roundMoney(Math.max(0, raw), fiatDecimals(currency)),
    clampedAtZero: raw < 0,
  };
}

/**
 * The other way round for an entry that reopens with its fee on file: what the
 * coins came to before the fee, so the price per bitcoin derived from it is the
 * price actually paid. A buy's total holds the fee, so it comes off; a sell's
 * total had it taken off, so it goes back on. Never below zero: a record
 * whose fee exceeds its buy total is damaged, and the screen shows a zero the
 * user can see and correct rather than a negative that hides.
 */
export function coinsValueFromTotal(
  kind: ManualEntryKind,
  total: number,
  fee = 0,
  currency?: FiatCurrency,
): number | undefined {
  if (!Number.isFinite(total) || total < 0) return undefined;
  if (!Number.isFinite(fee) || fee < 0) return undefined;
  const raw = kind === 'buy' ? total - fee : total + fee;
  return Number.isFinite(raw) ? roundMoney(Math.max(0, raw), fiatDecimals(currency)) : undefined;
}

export interface EntryTotalInput {
  kind: ManualEntryKind;
  /** Always positive, as everywhere else in the ledger. */
  amountSats: number;
  /** What one whole bitcoin cost, in the entry's currency. */
  pricePerBtc: number;
  /** Fee charged on the trade, in that same currency. Defaults to none. */
  fee?: number;
  /** Decides the rounding. Defaults to two decimals. */
  currency?: FiatCurrency;
}

/** Price per bitcoin and fee straight through to the stored total. */
export function entryTotalFromPrice(input: EntryTotalInput): EntryTotal | undefined {
  const { kind, amountSats, pricePerBtc, fee = 0, currency } = input;
  const coins = coinsValueFromPrice(amountSats, pricePerBtc, currency);
  if (coins == null) return undefined;
  return entryTotalWithFee(kind, coins, fee, currency);
}
