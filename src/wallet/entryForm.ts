/**
 * The entry form's money, pure: what the form shows and stores for the
 * numbers typed into it, and what it opens on for an entry on file.
 *
 * One path for both directions (decided 2026-10-22), so an entry opened and
 * saved unchanged stores the same total, fee and price it was opened with,
 * and the entry's page (`entryMoney`) reads back exactly what the form
 * computed. The fee is kept at the currency's own precision, like the total
 * it sits inside: a fee typed finer than the currency ("150.5" yen) once
 * made a typed price and its stored total disagree by one unit, so the page
 * showed a price nobody typed and an unchanged save moved the total.
 *
 * Pure: no storage, no native, no clock.
 */
import { entryMoney } from './entryDetails';
import { coinsValueFromPrice, entryTotalWithFee, pricePerBtcFromCoinsValue, roundFiat } from './manualEntryPricing';
import type { EntryTotal } from './manualEntryPricing';
import type { ManualEntry, ManualEntryKind } from './manualLedger';
import type { FiatCurrency } from './types';

/** Which of the two linked money fields the client typed last. The other
 *  one is derived from it, so the pair can never disagree. */
export type MoneyAnchor = 'price' | 'coins';

export interface EntryFormMoneyInput {
  kind: ManualEntryKind;
  /** The amount field, read; null or undefined when unreadable. */
  amountSats: number | null | undefined;
  anchor: MoneyAnchor;
  /** The price field, read (null when empty or unreadable). Counts while
   *  `anchor` is 'price'. */
  price: number | null;
  /** The "paid / received for the coins" field, read. Counts while
   *  `anchor` is 'coins'. */
  coins: number | null;
  /** The fee field, read: 0 when empty, null when unreadable. */
  fee: number | null;
  currency?: FiatCurrency;
}

export interface EntryFormMoney {
  /** What the coins came to before the fee. */
  coinsValue?: number;
  /** Per whole bitcoin: as typed, or worked out from the coins' value. */
  pricePerBtc?: number;
  /** The fee at the currency's precision; null when unreadable. */
  fee: number | null;
  /** The total, before it is saved. */
  total?: EntryTotal;
  /** What the entry stores for all of the above. */
  stored: { fiatAmount?: number; feeAmount?: number; pricePerBtc?: number };
}

/**
 * The form's money for what is typed: the field not typed last is derived
 * from the one that was, the total from both plus the fee.
 *
 * The fee and the typed price are stored only beside a total they made: not
 * when the fee swallowed a sell (total held at zero), where the fee is NOT
 * inside the total and the total did not come from the price.
 */
export function entryFormMoney(input: EntryFormMoneyInput): EntryFormMoney {
  const { kind, amountSats, anchor, currency } = input;
  const fee = input.fee == null ? null : roundFiat(input.fee, currency);

  let coinsValue: number | undefined;
  let pricePerBtc: number | undefined;
  if (anchor === 'price') {
    pricePerBtc = input.price ?? undefined;
    coinsValue =
      amountSats != null && input.price != null ? coinsValueFromPrice(amountSats, input.price, currency) : undefined;
  } else {
    coinsValue = input.coins ?? undefined;
    pricePerBtc =
      amountSats != null && input.coins != null ? pricePerBtcFromCoinsValue(amountSats, input.coins) : undefined;
  }

  const total = coinsValue != null && fee != null ? entryTotalWithFee(kind, coinsValue, fee, currency) : undefined;
  const kept = total != null && !total.clampedAtZero;
  return {
    coinsValue,
    pricePerBtc,
    fee,
    total,
    stored: {
      fiatAmount: total?.total,
      feeAmount: kept && fee != null && fee > 0 ? fee : undefined,
      pricePerBtc: kept && anchor === 'price' && input.price != null ? input.price : undefined,
    },
  };
}

/** What the form's three money fields open on for an entry on file. */
export interface EntryFormOpening {
  anchor: MoneyAnchor;
  price: string;
  coins: string;
  fee: string;
}

/**
 * The money fields for an entry on file, read through the same `entryMoney`
 * its page shows: an entry whose price was typed reopens on that price, any
 * other on what the coins came to (the total with its fee taken back out).
 * A fee that contradicts its total is not shown (`usableFee`).
 */
export function entryFormOpening(entry: ManualEntry): EntryFormOpening {
  const m = entryMoney(entry);
  const fee = m.fee != null ? String(m.fee) : '';
  if (m.priceTyped && m.pricePerBtc != null) {
    return { anchor: 'price', price: plainNumber(m.pricePerBtc), coins: '', fee };
  }
  return { anchor: 'coins', price: '', coins: m.coinsValue != null ? String(m.coinsValue) : '', fee };
}

/** A number as text for a field: never exponent notation, no trailing zeros
 *  ("79500", "300.3"). */
export function plainNumber(n: number): string {
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(8).replace(/\.?0+$/, '') || '0';
}
