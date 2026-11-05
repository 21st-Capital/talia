/**
 * Manual wallet: a hand-kept record of coins the app does NOT watch on-chain.
 *
 * Some holdings can't be followed with a descriptor — coins on an exchange, an
 * old hardware wallet nobody wants to expose, a share of a family stash. This
 * module is the arithmetic behind a wallet whose balance the OWNER types in:
 * buys add, sells subtract, and the running total is simply their difference.
 *
 * It knows nothing about the chain and never will. That is the whole point:
 * a manual wallet cannot update itself, so every change is an entry the user
 * made deliberately. The UI must say so plainly — a number that looks like a
 * synced balance but silently goes stale is worse than no number at all.
 *
 * Pure: no storage, no native, no clock. Fully unit-tested.
 */
import type { FiatCurrency } from './types';

export const SATS_PER_BTC = 100_000_000;

/** A buy adds coins to the wallet; a sell takes them away. */
export type ManualEntryKind = 'buy' | 'sell';

export interface ManualEntry {
  id: string;
  kind: ManualEntryKind;
  /** ALWAYS positive — `kind` carries the direction, never the sign. */
  amountSats: number;
  /** Unix ms of the day the user says it happened (not when they typed it). */
  date: number;
  /**
   * Optional TOTAL fiat paid (buy) or received (sell) for this entry — not a
   * per-coin price. Totals are what people have on a receipt; per-coin prices
   * are what they'd have to work out themselves.
   */
  fiatAmount?: number;
  /** Currency `fiatAmount` was entered in. Absent when no amount was given. */
  fiatCurrency?: FiatCurrency;
  /**
   * Fee paid on this trade, in `fiatCurrency`, ALREADY INSIDE `fiatAmount`
   * (added on a buy, taken off on a sell). Kept only so the entry reopens
   * with the fee showing and the true price per bitcoin derived (decided
   * 2026-09-07); every calculation reads `fiatAmount` and ignores this.
   * Absent on entries from before the field existed and on fee-less trades.
   */
  feeAmount?: number;
  /**
   * The price per bitcoin AS THE CLIENT TYPED IT, in `fiatCurrency`, kept
   * only when the price was the number typed (decided 2026-10-22: an entry
   * reopens the way it was entered, and the price shown is the one on the
   * receipt, not one worked back from a rounded total). Its presence is the
   * record of which number was typed; absent means the total was typed, or
   * the entry predates the field. `fiatAmount` stays the total every
   * calculation reads, so a price-typed entry stores the computed total too.
   * A price that does not reproduce the total is ignored (`entryMoney`).
   */
  pricePerBtc?: number;
  /**
   * Where the bitcoin was bought or sold (decided 2026-10-22): a key from
   * `wallet/entrySources.ts` (an exchange, 'p2p', or 'other').
   */
  source?: string;
  /** The name `source` was shown under when it was picked, or the name the
   *  client typed for 'other'. Kept beside the key so an app with a
   *  different list can still show it. */
  sourceName?: string;
  note?: string;
  /** Unix ms the entry was created (tiebreaker for same-day ordering). */
  createdAt: number;
  /** Unix ms of the last EDIT — per-entry last-writer-wins for sync.
   *  Entries from before this field existed read as their createdAt. */
  updatedAt?: number;
}

export interface ManualSummary {
  /** Buys minus sells. Can go negative — see `oversold`. */
  balanceSats: number;
  boughtSats: number;
  soldSats: number;
  /**
   * True when sells exceed buys. Not silently clamped: a negative balance
   * means the ledger disagrees with itself and the user needs to know which
   * entry is wrong, rather than seeing a tidy zero.
   */
  oversold: boolean;
  /** Total paid across buys that carry a price, in the summary currency
   *  (including entries converted from another currency via `fx`). */
  investedFiat: number;
  /** Sats covered by those priced buys (the denominator of the average). */
  pricedBuySats: number;
  /** Average price per WHOLE BTC over priced buys. Undefined when none. */
  avgBuyPriceFiat?: number;
  /**
   * Held sats the recorded prices can honestly speak for:
   * `min(balance, pricedBuySats)`. Every fiat figure about the holdings is
   * scoped to THIS, never to the whole balance — multiplying an average
   * taken over priced buys across sats it never covered is how a €5,000
   * entry once claimed a €305,000 cost in a phone test (2026-08-25).
   */
  coveredHeldSats: number;
  /** Held sats with no priced buy behind them: `balance − covered`. */
  uncoveredHeldSats: number;
  /**
   * Average-cost basis of the COVERED holdings: `avgBuyPrice × covered`.
   * Average cost (not FIFO) — the method a hand-kept ledger can actually
   * support, since entries may be added in any order and sells are not
   * matched to specific buys.
   */
  holdingsCostFiat?: number;
  /** Total received across sells that carry a price. */
  realizedProceedsFiat: number;
  pricedSellSats: number;
  /** Entries whose amount was converted from another currency at that
   *  day's rate — disclosed, since a conversion is not a receipt. */
  convertedEntries: number;
  /**
   * Entries priced in a DIFFERENT currency with NO conversion available
   * (offline, no rate for that day) — excluded from every fiat figure and
   * surfaced so the UI says the figures are partial.
   */
  unconvertedEntries: number;
}

/** Buys minus sells, in sats. */
export function manualBalanceSats(entries: readonly ManualEntry[]): number {
  return entries.reduce(
    (sum, e) => sum + (e.kind === 'buy' ? e.amountSats : -e.amountSats),
    0,
  );
}

/**
 * Newest first, by the date the user gave; entries sharing a date fall back to
 * creation order so a list never reshuffles between renders.
 */
export function sortManualEntries(entries: readonly ManualEntry[]): ManualEntry[] {
  return [...entries].sort((a, b) => b.date - a.date || b.createdAt - a.createdAt);
}

/** An entry annotated with the portfolio's balance right after it. */
export interface ManualLedgerEntry extends ManualEntry {
  /** Buys minus sells up to and including this entry, in sats. */
  balanceAfter: number;
}

/**
 * The ledger newest first (`sortManualEntries` order), each entry carrying
 * the balance right after it happened: the portfolio's counterpart of
 * `history.ts withRunningBalance`, so the scroll-linked balance can show the
 * total AS OF the topmost visible entry (decided 2026-09-12: "match that").
 *
 * Walked from the present backwards, exactly as the vault ledger is: the
 * newest entry's balanceAfter is the whole ledger's balance, and each older
 * one is the next-newer one's minus that entry's signed amount. An oversold
 * ledger goes negative at the entry where it happened, never clamped.
 */
export function manualRunningBalance(entries: readonly ManualEntry[]): ManualLedgerEntry[] {
  let balance = manualBalanceSats(entries);
  return sortManualEntries(entries).map((e) => {
    const annotated: ManualLedgerEntry = { ...e, balanceAfter: balance };
    balance -= e.kind === 'buy' ? e.amountSats : -e.amountSats;
    return annotated;
  });
}

/**
 * Roll the ledger up, in `currency`.
 *
 * `fx` carries pre-computed conversions for entries recorded in ANOTHER
 * currency: entry id → the entry's fiat amount expressed in `currency` at
 * that day's rate (see wallet/fxRate.ts — the UI computes these because
 * conversion needs the async historical feed and this module stays pure).
 * An other-currency entry with no fx value is excluded and COUNTED in
 * `unconvertedEntries`, never guessed.
 */
export function manualSummary(
  entries: readonly ManualEntry[],
  currency: FiatCurrency,
  fx?: ReadonlyMap<string, number>,
): ManualSummary {
  let boughtSats = 0;
  let soldSats = 0;
  let investedFiat = 0;
  let pricedBuySats = 0;
  let realizedProceedsFiat = 0;
  let pricedSellSats = 0;
  let convertedEntries = 0;
  let unconvertedEntries = 0;

  for (const e of entries) {
    if (e.kind === 'buy') boughtSats += e.amountSats;
    else soldSats += e.amountSats;

    if (e.fiatAmount == null || !Number.isFinite(e.fiatAmount)) continue;
    let fiat: number;
    if (e.fiatCurrency === currency) {
      fiat = e.fiatAmount;
    } else {
      const converted = fx?.get(e.id);
      if (converted == null || !Number.isFinite(converted) || converted < 0) {
        unconvertedEntries += 1;
        continue;
      }
      fiat = converted;
      convertedEntries += 1;
    }
    if (e.kind === 'buy') {
      investedFiat += fiat;
      pricedBuySats += e.amountSats;
    } else {
      realizedProceedsFiat += fiat;
      pricedSellSats += e.amountSats;
    }
  }

  const balanceSats = boughtSats - soldSats;
  const heldSats = Math.max(0, balanceSats);
  // The prices can only speak for sats a priced buy actually covered — and
  // sells are assumed to consume PRICED sats FIRST. The flattering opposite
  // (sells eat unpriced sats first) let a fully-sold priced position
  // re-attach its cost to later unpriced buys: buy 1 priced, sell 1, buy 1
  // unpriced showed the old cost against a coin whose price was never
  // recorded (found in the 2026-08-25 adversarial review). When we cannot
  // know which sats were sold, claim less, never more.
  const coveredHeldSats = Math.min(heldSats, Math.max(0, pricedBuySats - soldSats));
  const avgBuyPriceFiat =
    pricedBuySats > 0 ? investedFiat / (pricedBuySats / SATS_PER_BTC) : undefined;

  return {
    balanceSats,
    boughtSats,
    soldSats,
    oversold: balanceSats < 0,
    investedFiat,
    pricedBuySats,
    avgBuyPriceFiat,
    coveredHeldSats,
    uncoveredHeldSats: heldSats - coveredHeldSats,
    // Scoped to the COVERED holdings — never extrapolated across sats the
    // recorded prices know nothing about.
    holdingsCostFiat:
      avgBuyPriceFiat != null && coveredHeldSats > 0
        ? avgBuyPriceFiat * (coveredHeldSats / SATS_PER_BTC)
        : undefined,
    realizedProceedsFiat,
    pricedSellSats,
    convertedEntries,
    unconvertedEntries,
  };
}

/**
 * Unrealized gain/loss against a live rate, over the COVERED holdings only:
 * what the priced coins are worth now minus what they cost. Undefined unless
 * there is both a cost basis and covered coins — "up 100%" on coins with no
 * recorded price is a made-up number, and so is a loss computed against
 * coins the prices never covered.
 */
export function manualUnrealizedFiat(
  summary: ManualSummary,
  btcPriceFiat: number,
): number | undefined {
  if (summary.holdingsCostFiat == null || summary.coveredHeldSats <= 0) return undefined;
  if (!Number.isFinite(btcPriceFiat) || btcPriceFiat <= 0) return undefined;
  const valueNow = btcPriceFiat * (summary.coveredHeldSats / SATS_PER_BTC);
  const pnl = valueNow - summary.holdingsCostFiat;
  return Number.isFinite(pnl) ? pnl : undefined;
}

/**
 * Why a proposed entry cannot be added, or null when it is fine. Selling more
 * than the wallet holds is refused at entry time — that is a typo far more
 * often than it is a real event, and a negative balance is confusing enough
 * that it is worth stopping at the source.
 */
export function manualEntryError(
  entries: readonly ManualEntry[],
  proposed: Pick<ManualEntry, 'kind' | 'amountSats'>,
): string | null {
  if (!Number.isFinite(proposed.amountSats) || proposed.amountSats <= 0) {
    return 'Enter an amount greater than zero.';
  }
  if (!Number.isInteger(proposed.amountSats)) {
    return 'Amounts are whole satoshis. That is the smallest unit of bitcoin.';
  }
  if (proposed.kind === 'sell') {
    const held = manualBalanceSats(entries);
    if (proposed.amountSats > held) {
      return 'That is more than this portfolio holds. Check the amount, or add the missing buy first.';
    }
  }
  return null;
}

/**
 * Parse a typed amount into whole sats. Deliberately STRING-based for BTC:
 * `parseFloat('0.1') * 1e8` is 10000000.000000002, and rounding that happens
 * to work only until it doesn't. Splitting on the decimal point and padding
 * the fraction to 8 digits is exact for every value a user can type.
 *
 * Accepts a leading/trailing space, a comma as decimal separator (common
 * outside the US), and digit grouping spaces. Returns null when the text is
 * not a usable amount; the caller decides what to say about it.
 */
export function parseAmountToSats(text: string, unit: 'btc' | 'sats'): number | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.');
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;

  if (unit === 'sats') {
    // Sats are indivisible — a fractional sat is a typo, not a small amount.
    if (cleaned.includes('.')) return null;
    const n = Number(cleaned);
    return Number.isSafeInteger(n) ? n : null;
  }

  const [whole = '0', fraction = ''] = cleaned.split('.');
  if (fraction.length > 8) return null; // finer than a satoshi
  const sats = Number(`${whole || '0'}${fraction.padEnd(8, '0')}`);
  return Number.isSafeInteger(sats) ? sats : null;
}

/**
 * Parse a typed fiat amount (major units, two decimals at most). Returns null
 * for anything unusable so an unreadable price is never silently treated as
 * zero — which would drag an average cost basis down without a trace.
 */
export function parseFiatAmount(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(/,/g, '.');
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
