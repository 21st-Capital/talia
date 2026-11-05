/**
 * Kraken, the pure part: request signing and turning Kraken's trade and
 * ledger records into portfolio entries (decided 2026-09-07, for the client who
 * asked; Kraken first because its API is the cleanest of the three).
 *
 * The two rules for exchange sync:
 *   1. The API key lives ONLY on the client's phone (services/krakenSync.ts
 *      keeps it in the iOS Keychain). 21st Capital never holds it.
 *   2. A read-only key. The screen tells the client which three permissions
 *      to tick and that withdrawals and trading stay off.
 *
 * What lands in the portfolio: every trade where bitcoin is one side, and
 * every bitcoin deposit or withdrawal, as ordinary buy/sell entries with a
 * DETERMINISTIC id per Kraken record, so a re-sync (or two synced phones)
 * merges instead of duplicating, exactly like a vault snapshot. Trades
 * against a supported fiat currency are priced from the receipt (cost and
 * fee, the fee added on a buy and taken off on a sell, as the entry screen
 * does). Trades against a stablecoin are counted as US dollars and say so.
 * Anything else (a trade against ether, a deposit) has no receipt price and
 * is flagged for a market estimate, which the caller looks up and marks.
 *
 * Pure: no network, no storage, no clock. Fully unit-tested, including the
 * signature against Kraken's published vector.
 */
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';

import type { ExchangeEntryDraft } from './drafts';
import { entryTotalWithFee, fiatDecimals } from '../wallet/manualEntryPricing';
import { parseAmountToSats } from '../wallet/manualLedger';
import type { ManualEntry, ManualEntryKind } from '../wallet/manualLedger';
import type { FiatCurrency } from '../wallet/types';
import { KRAKEN_ENTRY_PREFIX, KRAKEN_LEDGER_NOTES } from '../wallet/entryIds';
import { sourceFieldsFor } from '../wallet/entrySources';

export const KRAKEN_API_ORIGIN = 'https://api.kraken.com';

/**
 * Kraken's API-Sign header: HMAC-SHA512 over (path ‖ SHA256(nonce ‖ post
 * data)) keyed with the base64-decoded private key, base64-encoded.
 */
export function krakenSignature(input: {
  path: string;
  nonce: string;
  postData: string;
  secretB64: string;
}): string {
  const inner = sha256(utf8ToBytes(input.nonce + input.postData));
  const message = concatBytes(utf8ToBytes(input.path), inner);
  const key = base64.decode(input.secretB64.trim());
  return base64.encode(hmac(sha512, key, message));
}

/** A Kraken private key is base64; anything else is a paste of the wrong
 *  thing (the public key, a password) and would fail confusingly later. */
export function looksLikeKrakenSecret(secret: string): boolean {
  const s = secret.trim();
  if (s.length < 40) return false;
  try {
    return base64.decode(s).length >= 32;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- QR codes */

/** Kraken's API keys are 56 characters; its private keys are 64 bytes, so
 *  88 characters of base64 ending in "==". Shape is enough to tell them
 *  apart, whichever code or field they arrive in. */
const B64_ALPHABET = /^[A-Za-z0-9+/=]+$/;

function classifyToken(token: string): 'key' | 'secret' | null {
  const t = token.trim();
  if (!B64_ALPHABET.test(t)) return null;
  if (t.length === 88 && t.endsWith('==') && looksLikeKrakenSecret(t)) return 'secret';
  if (t.length === 56 && !t.includes('=')) return 'key';
  // Unusual lengths: a decodable long string is a secret, a shorter one a key.
  if (t.length >= 80 && looksLikeKrakenSecret(t)) return 'secret';
  if (t.length >= 40 && t.length < 80) return 'key';
  return null;
}

export interface KrakenQrContents {
  key?: string;
  secret?: string;
}

const KEY_NAMES = /^(api[_-]?key|key|public[_-]?key|apikey|public)$/i;
const SECRET_NAMES = /^(api[_-]?secret|secret|private[_-]?key|privatekey|private|api[_-]?private[_-]?key)$/i;

function collectNamed(pairs: Array<[string, string]>, out: KrakenQrContents): void {
  for (const [name, value] of pairs) {
    const v = value.trim();
    if (!v) continue;
    if (KEY_NAMES.test(name) && !out.key) out.key = v;
    else if (SECRET_NAMES.test(name) && !out.secret) out.secret = v;
  }
  // Names nobody recognised: fall back on the values' shapes.
  for (const [, value] of pairs) {
    const kind = classifyToken(value);
    if (kind === 'key' && !out.key) out.key = value.trim();
    if (kind === 'secret' && !out.secret) out.secret = value.trim();
  }
}

/**
 * Whatever Kraken put in a QR code, to the key and/or secret inside it: one
 * code per value, one code with both, JSON, a URL with query parameters, or
 * two lines. Anything not recognised yields neither.
 */
export function parseKrakenQr(text: string): KrakenQrContents {
  const out: KrakenQrContents = {};
  const raw = text.trim();
  if (!raw) return out;

  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const pairs = Object.entries(obj).filter((e): e is [string, string] => typeof e[1] === 'string');
      collectNamed(pairs, out);
      if (out.key || out.secret) return out;
    } catch {
      // not JSON after all; fall through
    }
  }

  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw.includes('=') && raw.includes('&') ? raw : '';
  if (query && /^[^=&\s]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(query)) {
    const pairs: Array<[string, string]> = query.split('&').map((kv) => {
      const i = kv.indexOf('=');
      return [decodeURIComponent(kv.slice(0, i)), decodeURIComponent(kv.slice(i + 1))];
    });
    collectNamed(pairs, out);
    if (out.key || out.secret) return out;
  }

  for (const token of raw.split(/[\s,;]+/)) {
    const kind = classifyToken(token);
    if (kind === 'key' && !out.key) out.key = token.trim();
    if (kind === 'secret' && !out.secret) out.secret = token.trim();
  }
  return out;
}

/* ------------------------------------------------------------------ pairs */

const FIAT: Record<string, FiatCurrency> = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  CHF: 'CHF',
  CAD: 'CAD',
  AUD: 'AUD',
  JPY: 'JPY',
};
/** Dollar stablecoins Kraken lists bitcoin against. Counted as US dollars,
 *  and the entry's note says so; the difference is well under a cent. */
const USD_STABLE = new Set(['USDT', 'USDC', 'DAI', 'PYUSD', 'USDG', 'RLUSD', 'TUSD', 'USDS']);

/** Kraken prefixes its older assets: XXBT, XETH, ZUSD, ZEUR. */
function normalizeAsset(a: string): string {
  const s = a.toUpperCase();
  if (s.length === 4 && (s[0] === 'X' || s[0] === 'Z')) return s.slice(1);
  return s;
}

export interface KrakenPair {
  /** Which side bitcoin is on. */
  btcSide: 'base' | 'quote';
  /** The OTHER asset, normalized (USD, EUR, USDT, ETH …). */
  other: string;
  /** Set when `other` is a supported fiat, or a dollar stablecoin. */
  fiat?: FiatCurrency;
  stablecoin: boolean;
}

/** Split a Kraken pair name around bitcoin. Null when bitcoin is not in it. */
export function parseKrakenPair(pair: string): KrakenPair | null {
  const p = pair.toUpperCase();
  let btcSide: 'base' | 'quote';
  let rest: string;
  if (p.startsWith('XXBT') && p.length > 4) {
    btcSide = 'base';
    rest = p.slice(4);
  } else if (p.startsWith('XBT') && p.length > 3) {
    btcSide = 'base';
    rest = p.slice(3);
  } else if (p.endsWith('XXBT') && p.length > 4) {
    btcSide = 'quote';
    rest = p.slice(0, -4);
  } else if (p.endsWith('XBT') && p.length > 3) {
    btcSide = 'quote';
    rest = p.slice(0, -3);
  } else {
    return null;
  }
  const other = normalizeAsset(rest);
  if (other === 'XBT' || other === '') return null;
  const stablecoin = USD_STABLE.has(other);
  const fiat = FIAT[other] ?? (stablecoin ? 'USD' : undefined);
  return { btcSide, other, fiat, stablecoin };
}

/* ---------------------------------------------------------------- records */

/** One row of Kraken's TradesHistory `trades` map, keyed by its trade id. */
export interface KrakenTrade {
  txid: string;
  pair: string;
  /** Unix seconds, fractional. */
  time: number;
  type: 'buy' | 'sell';
  /** Decimal strings, as Kraken sends them. `cost` and `fee` are in the
   *  QUOTE asset; `vol` in the BASE asset. */
  price: string;
  cost: string;
  fee: string;
  vol: string;
}

/** One row of Kraken's Ledgers `ledger` map, keyed by its ledger id. */
export interface KrakenLedgerRow {
  id: string;
  refid: string;
  time: number;
  type: string;
  asset: string;
  /** Signed decimal string in `asset`; withdrawals are negative. */
  amount: string;
  /** Unsigned decimal string in `asset`, charged on top of `amount`. */
  fee: string;
}

/** A portfolio entry as Kraken describes it, before the caller adds any
 *  market estimate the record itself cannot supply. */
export type KrakenEntryDraft = ExchangeEntryDraft;

export { KRAKEN_ENTRY_PREFIX };

/** Deterministic entry id for a Kraken record: the same trade or ledger row
 *  always maps to the same entry, on every phone, every sync. */
export function krakenEntryId(recordId: string): string {
  return `${KRAKEN_ENTRY_PREFIX}${recordId}`;
}

export function isKrakenEntry(e: Pick<ManualEntry, 'id'>): boolean {
  return e.id.startsWith(KRAKEN_ENTRY_PREFIX);
}

const ESTIMATE_NOTE = 'Price estimated at that day’s market rate.';

/** Every TRADE this sync writes names Kraken as its source (decided
 *  2026-10-22), from the one list of sources. A deposit or a withdrawal
 *  does not: those coins were bought, or are kept, somewhere else. */
const KRAKEN_SOURCE = sourceFieldsFor('kraken') ?? {};

/** Fee to money, rounded like the entry screen; zero and junk become none. */
function moneyOrZero(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A trade with bitcoin on the BASE side (XBT/USD, XBT/USDT, XBT/ETH…): the
 * volume IS the bitcoin amount; cost and fee are in the other asset.
 */
function tradeBtcBase(t: KrakenTrade, pair: KrakenPair, now: number): KrakenEntryDraft | null {
  const amountSats = parseAmountToSats(t.vol, 'btc');
  if (amountSats == null || amountSats <= 0) return null;
  const kind: ManualEntryKind = t.type;
  const base: ManualEntry = {
    id: krakenEntryId(t.txid),
    kind,
    amountSats,
    date: Math.round(t.time * 1000),
    createdAt: now,
    ...KRAKEN_SOURCE,
  };
  if (pair.fiat) {
    const fee = moneyOrZero(t.fee);
    const cost = Number(t.cost);
    const total =
      Number.isFinite(cost) && cost >= 0 ? entryTotalWithFee(kind, cost, fee, pair.fiat) : undefined;
    return {
      tsSecs: t.time,
      needsEstimate: false,
      entry: {
        ...base,
        fiatAmount: total?.total,
        fiatCurrency: total ? pair.fiat : undefined,
        feeAmount: total && !total.clampedAtZero && fee > 0 ? roundTo(fee, fiatDecimals(pair.fiat)) : undefined,
        note: pair.stablecoin
          ? `Kraken trade, paid in ${pair.other}, counted as US dollars.`
          : 'Kraken trade.',
      },
    };
  }
  return {
    tsSecs: t.time,
    needsEstimate: true,
    entry: { ...base, note: `Kraken trade against ${pair.other}. ${ESTIMATE_NOTE}` },
  };
}

/**
 * A trade with bitcoin on the QUOTE side (ETH/XBT): buying ether SPENDS
 * bitcoin (cost plus the fee, both in bitcoin), selling ether brings bitcoin
 * in (cost minus the fee). There is no fiat receipt, so it is estimated.
 */
function tradeBtcQuote(t: KrakenTrade, pair: KrakenPair, now: number): KrakenEntryDraft | null {
  const costSats = parseAmountToSats(t.cost, 'btc');
  const feeSats = parseAmountToSats(t.fee, 'btc') ?? 0;
  if (costSats == null || costSats <= 0) return null;
  const kind: ManualEntryKind = t.type === 'buy' ? 'sell' : 'buy';
  const amountSats = kind === 'sell' ? costSats + feeSats : Math.max(0, costSats - feeSats);
  if (amountSats <= 0) return null;
  return {
    tsSecs: t.time,
    needsEstimate: true,
    entry: {
      id: krakenEntryId(t.txid),
      kind,
      amountSats,
      date: Math.round(t.time * 1000),
      createdAt: now,
      ...KRAKEN_SOURCE,
      note: `Kraken trade, bitcoin for ${pair.other}. ${ESTIMATE_NOTE}`,
    },
  };
}

/** Trades to entry drafts, oldest first. Trades without bitcoin are skipped. */
export function krakenTradesToEntries(trades: readonly KrakenTrade[], now: number): KrakenEntryDraft[] {
  const out: KrakenEntryDraft[] = [];
  for (const t of trades) {
    if (t.type !== 'buy' && t.type !== 'sell') continue;
    if (!Number.isFinite(t.time) || t.time <= 0) continue;
    const pair = parseKrakenPair(t.pair);
    if (!pair) continue;
    const draft = pair.btcSide === 'base' ? tradeBtcBase(t, pair, now) : tradeBtcQuote(t, pair, now);
    if (draft) out.push(draft);
  }
  return out.sort((a, b) => a.entry.date - b.entry.date);
}

/**
 * Bitcoin deposits and withdrawals to entry drafts. A deposit credits the
 * amount less the fee; a withdrawal takes the amount AND the fee, which is
 * what actually left. Every other ledger type (trades are covered by
 * TradesHistory; staking, transfers and adjustments are not buys or sells)
 * is skipped.
 */
export function krakenLedgerToEntries(rows: readonly KrakenLedgerRow[], now: number): KrakenEntryDraft[] {
  const out: KrakenEntryDraft[] = [];
  for (const r of rows) {
    if (normalizeAsset(r.asset) !== 'XBT') continue;
    if (r.type !== 'deposit' && r.type !== 'withdrawal') continue;
    if (!Number.isFinite(r.time) || r.time <= 0) continue;
    const gross = parseAmountToSats(r.amount.replace(/^-/, ''), 'btc');
    const fee = parseAmountToSats(r.fee.replace(/^-/, ''), 'btc') ?? 0;
    if (gross == null) continue;
    const kind: ManualEntryKind = r.type === 'deposit' ? 'buy' : 'sell';
    const amountSats = kind === 'buy' ? gross - fee : gross + fee;
    if (amountSats <= 0) continue;
    out.push({
      tsSecs: r.time,
      needsEstimate: true,
      entry: {
        id: krakenEntryId(r.id),
        kind,
        amountSats,
        date: Math.round(r.time * 1000),
        createdAt: now,
        note: `${kind === 'buy' ? KRAKEN_LEDGER_NOTES.deposit : KRAKEN_LEDGER_NOTES.withdrawal} ${ESTIMATE_NOTE}`,
      },
    });
  }
  return out.sort((a, b) => a.entry.date - b.entry.date);
}

export { freshDrafts as freshKrakenDrafts } from './drafts';

/** Kraken's `result.error` list to one plain-language sentence. Kraken's
 *  codes are stable; its wording is not for clients. */
export function krakenErrorMessage(errors: readonly string[]): string {
  const joined = errors.join(' ');
  if (/EAPI:Invalid key/i.test(joined)) return 'Kraken did not accept this API key.';
  if (/EAPI:Invalid signature/i.test(joined)) return 'Kraken did not accept this private key.';
  if (/EAPI:Invalid nonce/i.test(joined)) return 'Kraken rejected the request order. Please try again.';
  if (/Permission denied/i.test(joined)) {
    return 'This key is not allowed to read your history. On Kraken, give it Query Funds, Query Ledger Entries and Query Closed Orders & Trades.';
  }
  if (/Rate limit/i.test(joined)) return 'Kraken asked Talia to slow down. Please try again in a minute.';
  if (/EService:Unavailable|EService:Busy/i.test(joined)) return 'Kraken is busy right now. Please try again shortly.';
  if (/Temporary lockout/i.test(joined)) return 'Kraken has locked this key for a while after too many failed attempts.';
  return 'Kraken returned an error. Please try again later.';
}

/**
 * Is this key limited to reading (decided 2026-09-26)?
 * Talia only ever reads, so a key that can also trade or withdraw is a live
 * handle on the client's exchange funds kept on the phone for nothing. The
 * app asks Kraken two questions that move nothing: WithdrawInfo (needs the
 * Withdraw permission) and AddOrder with validate=true (needs Create orders;
 * Kraken validates and never trades). Each answer, read here:
 *   'denied'  Kraken said Permission denied: the key cannot do it.
 *   'allowed' anything else Kraken itself decided (a result, an unknown
 *             withdrawal key, too little money, a bad argument): it got past
 *             the permission check, so the key CAN do it.
 *   'unknown' the question was never really asked (slow down, a bad nonce,
 *             a key or signature Kraken refused, Kraken busy).
 */
export type KrakenPermissionVerdict = 'denied' | 'allowed' | 'unknown';

export function krakenPermissionVerdict(errors: readonly string[] | undefined): KrakenPermissionVerdict {
  const list = errors ?? [];
  if (list.length === 0) return 'allowed';
  const joined = list.join(' ');
  if (/Permission denied/i.test(joined)) return 'denied';
  if (/^EAPI:|EService:|Rate limit|Temporary lockout|Invalid nonce|Invalid key|Invalid signature/i.test(joined)) {
    return 'unknown';
  }
  return 'allowed';
}

/**
 * The questions, in order. Decided 2026-09-30: Kraken's WithdrawInfo needs
 * Query Funds AND Withdraw, so a key with Withdraw but WITHOUT Query Funds
 * is told "Permission denied" there and would pass as unable to withdraw.
 * So Balance (Query Funds alone) is asked first, and a 'denied' from
 * WithdrawInfo counts only once Balance has answered. The guide asks for
 * Query Funds anyway; a key without it cannot be shown to be read only and
 * is refused (`krakenReadOnlyVerdict`).
 */
export type KrakenProbeRole = 'queryFunds' | 'withdraw' | 'trade';

export const KRAKEN_PERMISSION_PROBES: readonly {
  role: KrakenProbeRole;
  path: string;
  params: Record<string, string>;
}[] = [
  // Reads the balances, nothing more. Its success is what makes the next
  // answer mean something.
  { role: 'queryFunds', path: '/0/private/Balance', params: {} },
  // An amount far below any minimum and a withdrawal key no account has.
  {
    role: 'withdraw',
    path: '/0/private/WithdrawInfo',
    params: { asset: 'XBT', key: 'talia-permission-check', amount: '0.00001' },
  },
  // validate=true: checked, never placed. A limit buy at 1 USD for good measure.
  {
    role: 'trade',
    path: '/0/private/AddOrder',
    params: { pair: 'XBTUSD', type: 'buy', ordertype: 'limit', price: '1', volume: '0.0001', validate: 'true' },
  },
];

/**
 * The answers to the three questions, to one verdict:
 *   'tooPowerful'  the key can withdraw or trade;
 *   'uncheckable'  the key lacks Query Funds, so WithdrawInfo's refusal
 *                  proves nothing (it needs Query Funds too);
 *   'unknown'      a question was never really asked (busy, slow down);
 *   'readOnly'     Balance answered, and both others were refused.
 */
export type KrakenKeyVerdict = 'readOnly' | 'tooPowerful' | 'uncheckable' | 'unknown';

export function krakenReadOnlyVerdict(answers: Record<KrakenProbeRole, KrakenPermissionVerdict>): KrakenKeyVerdict {
  if (answers.withdraw === 'allowed' || answers.trade === 'allowed') return 'tooPowerful';
  if (answers.queryFunds === 'denied') return 'uncheckable';
  if (answers.queryFunds === 'unknown' || answers.withdraw === 'unknown' || answers.trade === 'unknown') return 'unknown';
  return 'readOnly';
}

export const KRAKEN_KEY_TOO_POWERFUL =
  'This key can trade or withdraw. Talia only reads, so make a new key in Kraken with only the Query permissions and connect that one.';

export const KRAKEN_KEY_UNCHECKABLE =
  'This key does not have Query Funds, so Talia cannot check that it can only read. Please make a new key in Kraken with only the Query permissions and connect that one.';

/**
 * What to say when Kraken's address answered with something other than its
 * JSON: usually a block page from the network in front of it (Cloudflare, a
 * regional rule, a carrier's captive page). The status and the first words of
 * the page are the only clue anyone has, so they go in the message.
 */
export function krakenOddReplyMessage(status: number, bodyText: string, detail?: string): string {
  const words = bodyText
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  const who = status >= 500 ? 'Kraken is having trouble' : 'Something in front of Kraken answered';
  const tail = detail ? ` (${detail})` : '';
  // Seen live (decided 2026-09-07): a pasted private key that was subtly wrong
  // got an EMPTY 400 from Kraken, twice; the same key scanned from Kraken's
  // QR worked at once. Kraken does not say "invalid signature" for it.
  const advice =
    status === 400
      ? 'If the private key was pasted, scan it from Kraken\u2019s QR code instead.'
      : 'Try again on another network, such as Wi-Fi.';
  return `${who} with status ${status} instead of data${words ? `: "${words}"` : ''}${tail}. ${advice}`;
}

/**
 * The response headers worth quoting when a reply was not Kraken's data: they
 * say WHO answered (Kraken's edge sets `server: cloudflare` and a `cf-ray`;
 * a filter or proxy on the phone sets something else or nothing).
 */
export function describeReplyHeaders(get: (name: string) => string | null, redirectedTo?: string): string {
  const parts: string[] = [];
  for (const name of ['server', 'cf-ray', 'content-type', 'content-length', 'via', 'x-cache']) {
    const v = get(name);
    if (v) parts.push(`${name}=${v.slice(0, 40)}`);
  }
  if (redirectedTo) parts.push(`redirected to ${redirectedTo.slice(0, 60)}`);
  return parts.length ? parts.join(', ') : 'no headers';
}

function roundTo(n: number, decimals: number): number {
  return Number(n.toFixed(decimals));
}
