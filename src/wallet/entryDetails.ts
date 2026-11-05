/**
 * Everything one portfolio entry's page says about it (decided 2026-10-22: a
 * client "should be able to open each entry and see all the details", like a
 * transaction on a vault).
 *
 * Two questions live here:
 *
 *   · THE MONEY. An entry stores its TOTAL (`fiatAmount`, what every figure
 *     in the app reads), the fee inside it (`feeAmount`) and, when the client
 *     typed the price per bitcoin rather than the total, that price
 *     (`pricePerBtc`). The page shows the price AND the total whichever one
 *     was typed: `entryMoney` gives both, the price worked back from the
 *     total when it was not typed. The total is the truth: a stored price
 *     that does not reproduce it (a hand-edited file, an older app that
 *     changed the total and kept the price) is set aside and the price is
 *     worked back instead.
 *
 *   · THE ORIGIN. Where the entry came from: typed in, written by an
 *     exchange sync, or snapshotted from a vault. Read from the id, which
 *     each writer makes deterministic (`kraken-…`, `coinbase-…`, `vsnap-…`).
 *
 * Pure: no storage, no native, no clock.
 */
import type { ManualEntry } from './manualLedger';
import { coinsValueFromPrice, coinsValueFromTotal, entryTotalWithFee, fiatDecimals, pricePerBtcFromCoinsValue, roundFiat } from './manualEntryPricing';
import { fiatSymbol } from './price';
import type { ExchangeKind, FiatCurrency } from './types';
import { COINBASE_ENTRY_PREFIX, KRAKEN_ENTRY_PREFIX, SNAPSHOT_ENTRY_PREFIX, SNAPSHOT_VAULT_ID_CHARS } from './entryIds';

// ─── Origin ──────────────────────────────────────────────────────────────────

export type EntryOrigin =
  /** Typed into Talia (here, or on a phone it came from by sync, share,
   *  QR or backup file). */
  | { kind: 'typed' }
  /** Written by an exchange sync. */
  | { kind: 'exchange'; exchange: ExchangeKind }
  /** Snapshotted from a vault's history, by hand or by a linked vault.
   *  `vaultIdStart` is the start of that vault's id. */
  | { kind: 'vault'; vaultIdStart: string };

export function entryOrigin(entry: Pick<ManualEntry, 'id'>): EntryOrigin {
  const id = entry.id;
  if (id.startsWith(KRAKEN_ENTRY_PREFIX)) return { kind: 'exchange', exchange: 'kraken' };
  if (id.startsWith(COINBASE_ENTRY_PREFIX)) return { kind: 'exchange', exchange: 'coinbase' };
  if (id.startsWith(SNAPSHOT_ENTRY_PREFIX)) {
    return { kind: 'vault', vaultIdStart: id.slice(SNAPSHOT_ENTRY_PREFIX.length, SNAPSHOT_ENTRY_PREFIX.length + SNAPSHOT_VAULT_ID_CHARS) };
  }
  return { kind: 'typed' };
}

/**
 * The vault a snapshot entry came from, by name, when exactly ONE vault on
 * this phone matches the start of its id; undefined otherwise (the vault was
 * removed, or lives on another phone), and the page then says "a vault".
 */
export function originVaultName(
  origin: EntryOrigin,
  vaults: readonly { id: string; label: string; manual?: boolean }[],
): string | undefined {
  if (origin.kind !== 'vault' || origin.vaultIdStart === '') return undefined;
  const matches = vaults.filter((v) => !v.manual && v.id.slice(0, SNAPSHOT_VAULT_ID_CHARS) === origin.vaultIdStart);
  return matches.length === 1 ? matches[0].label : undefined;
}

/** The origin in the page's words. */
export function originWords(origin: EntryOrigin, vaultName?: string): string {
  switch (origin.kind) {
    case 'typed':
      return 'Typed in by hand';
    case 'exchange':
      return origin.exchange === 'kraken' ? 'Kraken sync' : 'Coinbase sync';
    case 'vault':
      return vaultName ? `From the vault ${vaultName}` : 'From a vault';
  }
}

// ─── Money ───────────────────────────────────────────────────────────────────

/**
 * The fee an entry carries, when it can be believed: more than zero, beside a
 * total it is inside of. A buy's fee cannot exceed its total. A sell's fee
 * was taken off what came back, so any fee beside a sell's total is inside
 * it, a total of exactly zero too (a fee that equalled the sale): the form
 * never keeps the fee of a sell the fee swallowed (total held at zero, the
 * fee larger than the sale). Anything else is ignored rather than trusted,
 * so no number appears that nobody entered.
 *
 * At the currency's own precision, like the total (decided 2026-10-22): an
 * entry saved with a finer fee ("150.5" yen) reads and reopens with the fee
 * its total was made with, so saving it unchanged keeps the total.
 */
export function usableFee(
  entry: Pick<ManualEntry, 'kind' | 'fiatAmount' | 'feeAmount' | 'fiatCurrency'>,
): number | undefined {
  const { feeAmount: raw, fiatAmount: total } = entry;
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return undefined;
  if (total == null || !Number.isFinite(total)) return undefined;
  const fee = roundFiat(raw, entry.fiatCurrency);
  if (fee <= 0 || total < 0) return undefined;
  return entry.kind === 'buy' && fee > total ? undefined : fee;
}

export interface EntryMoney {
  /** The currency every figure below is in. */
  currency?: FiatCurrency;
  /** Paid (buy) or received (sell), fee included or taken off. */
  total?: number;
  /** The fee inside the total, when there was one. */
  fee?: number;
  /** What the coins came to before the fee. */
  coinsValue?: number;
  /** Per whole bitcoin: as typed, or worked back from the total. */
  pricePerBtc?: number;
  /** True when `pricePerBtc` is the price the client typed. */
  priceTyped: boolean;
}

/** Half the smallest unit the currency is written in: within this, two
 *  amounts are the same amount. */
function sameMoney(a: number, b: number, currency?: FiatCurrency): boolean {
  return Math.abs(a - b) < 0.5 * 10 ** -fiatDecimals(currency);
}

/**
 * The money side of an entry, whole: total, fee, the coins' value before the
 * fee, and the price per bitcoin. Nothing for an entry with no total.
 *
 * A typed price stands when it makes the stored TOTAL the way the entry form
 * makes it (`entryTotalWithFee` over the price's coin value and the fee):
 * the same sum, so a price the client typed is never set aside for a
 * rounding the form itself did.
 *
 * A sell that came to nothing, with no fee to explain it, has no price: it
 * is the sell a fee swallowed, whose coin value was not kept, and a price
 * of zero worked back from it is a number nobody typed (decided 2026-10-22).
 */
export function entryMoney(entry: ManualEntry): EntryMoney {
  const total = entry.fiatAmount;
  if (total == null || !Number.isFinite(total) || total < 0) return { priceTyped: false };
  const currency = entry.fiatCurrency;
  const fee = usableFee(entry);
  const typed = entry.pricePerBtc;
  if (typed != null && Number.isFinite(typed) && typed >= 0) {
    const typedCoins = coinsValueFromPrice(entry.amountSats, typed, currency);
    const made = typedCoins != null ? entryTotalWithFee(entry.kind, typedCoins, fee ?? 0, currency) : undefined;
    if (made != null && !made.clampedAtZero && sameMoney(made.total, total, currency)) {
      return { currency, total, fee, coinsValue: typedCoins, pricePerBtc: typed, priceTyped: true };
    }
  }
  const coinsValue = coinsValueFromTotal(entry.kind, total, fee ?? 0, currency);
  const unknown = entry.kind === 'sell' && total === 0 && fee == null;
  const worked = coinsValue != null && !unknown ? pricePerBtcFromCoinsValue(entry.amountSats, coinsValue) : undefined;
  return { currency, total, fee, coinsValue, pricePerBtc: worked, priceTyped: false };
}

/**
 * A typed price that can be kept beside a total, or undefined: finite, not
 * negative. The import guard for `pricePerBtc` (whether it agrees with the
 * total is decided where it is read, by `entryMoney`).
 */
export function usablePrice(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Thousands-separated, always at the given decimals (decided 2026-09-12: every
 *  amount carries its cents, "$27,786.00"; yen has none). */
export function formatMoney(n: number, decimals = 2): string {
  const [whole, frac] = n.toFixed(decimals).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

/** An amount of money in its own currency: "€19,875.00", "¥3,000,000". */
export function formatFiatValue(n: number, currency: FiatCurrency): string {
  return `${fiatSymbol(currency)}${formatMoney(n, fiatDecimals(currency))}`;
}

// ─── The note ────────────────────────────────────────────────────────────────

/**
 * The words Talia itself once wrote into notes with an em dash, before the
 * rule against them (2026-08-28), and the words it writes now. Entries made
 * in those days still carry the old ones on file: they are shown, exported
 * and reopened in the new words. A note the client wrote is never touched.
 */
const LEGACY_AUTO_NOTES: ReadonlyArray<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^From (.+) — added automatically\.$/, (m) => `From ${m[1]}. Added automatically.`],
  [/^Estimated at that day’s market price — edit if you know the real amount\.$/, () => 'Estimated at that day’s market price. Edit it if you know the real amount.'],
  [/^From the vault’s history — add what you paid if you know it\.$/, () => 'From the vault’s history. You can add what you paid if you know it.'],
];

/** An entry's note as the client reads it (see LEGACY_AUTO_NOTES). */
export function displayNote(note: string | undefined): string | undefined {
  if (!note) return note;
  for (const [pattern, words] of LEGACY_AUTO_NOTES) {
    const m = pattern.exec(note);
    if (m) return words(m);
  }
  return note;
}
