/**
 * Coinbase, the pure part (decided 2026-09-07, the second exchange after Kraken):
 * the CDP key file, the ES256 request token, and Advanced Trade fills turned
 * into portfolio entries.
 *
 * Same two rules as Kraken: the key lives ONLY on the client's phone, and it
 * is a read-only key (the CDP portal's "view" permission).
 *
 * Coinbase's API of 2026 (docs.cdp.coinbase.com): a "Secret API key" is a
 * name like organizations/<org>/apiKeys/<id> plus a private key. Every
 * request carries a fresh JWT signed with that key: ES256 only on this API
 * (the portal recommends Ed25519, which this API refuses; the guide says to
 * pick ECDSA), two minutes of life, and a `uri` claim naming the exact
 * request. History comes from Advanced Trade "fills": one row per trade
 * execution with price, size, commission and side. The sandbox at
 * api-sandbox.coinbase.com answers the same shape without any key, which is
 * how the flow was tried without a Coinbase account.
 *
 * Not covered yet: crypto sends and receives (the consumer transactions API
 * is a separate surface), and REVERSAL / CORRECTION adjustments to fills.
 *
 * Pure: no network, no storage, no clock (time and nonce are passed in).
 */
import { p256 } from '@noble/curves/p256';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { base64, base64urlnopad } from '@scure/base';

import type { ExchangeEntryDraft } from './drafts';
import { entryTotalWithFee, fiatDecimals } from '../wallet/manualEntryPricing';
import { parseAmountToSats } from '../wallet/manualLedger';
import type { ManualEntry, ManualEntryKind } from '../wallet/manualLedger';
import type { FiatCurrency } from '../wallet/types';
import { COINBASE_ENTRY_PREFIX } from '../wallet/entryIds';
import { sourceFieldsFor } from '../wallet/entrySources';

export const COINBASE_API_HOST = 'api.coinbase.com';
export const COINBASE_SANDBOX_HOST = 'api-sandbox.coinbase.com';
export const COINBASE_FILLS_PATH = '/api/v3/brokerage/orders/historical/fills';
/** What the key may do (decided 2026-09-26): can_view, can_trade, can_transfer. */
export const COINBASE_KEY_PERMISSIONS_PATH = '/api/v3/brokerage/key_permissions';

export const COINBASE_KEY_TOO_POWERFUL =
  'This key can trade or move funds. Talia only reads, so make a new key in Coinbase with View permission only and connect that one.';

/**
 * Is this key limited to reading (decided 2026-09-26)?
 * Read off Coinbase's own answer about the key: 'readOnly' only when it says
 * plainly that the key can neither trade nor transfer; 'tooPowerful' when it
 * says either; 'unknown' for an answer that says neither.
 */
export function coinbaseKeyVerdict(body: unknown): 'readOnly' | 'tooPowerful' | 'unknown' {
  const b = (body ?? {}) as { can_trade?: unknown; can_transfer?: unknown };
  if (b.can_trade === true || b.can_transfer === true) return 'tooPowerful';
  if (b.can_trade === false && b.can_transfer === false) return 'readOnly';
  return 'unknown';
}
export { COINBASE_ENTRY_PREFIX };

/* ------------------------------------------------------------ the key file */

export interface CoinbaseKeyInput {
  /** organizations/<org>/apiKeys/<id> */
  keyName?: string;
  /** The private key as pasted: a PEM block, or a bare base64 scalar. */
  secret?: string;
}

const KEY_NAME_RE = /organizations\/[0-9a-f-]+\/apiKeys\/[0-9a-f-]+/i;
const PEM_RE = /-----BEGIN (?:EC )?PRIVATE KEY-----[\s\S]*?-----END (?:EC )?PRIVATE KEY-----/;

/**
 * Whatever the client pasted or scanned: the downloaded key file (JSON with
 * name and privateKey), the two values on separate lines, or one of them.
 */
export function parseCoinbaseKeyInput(text: string): CoinbaseKeyInput {
  const out: CoinbaseKeyInput = {};
  const raw = text.trim();
  if (!raw) return out;
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'string') continue;
        if (/^(name|id|apikeyname|api_key_name|keyname|key_name|apiKeyId|api_key_id)$/i.test(k) && KEY_NAME_RE.test(v)) out.keyName = v.match(KEY_NAME_RE)![0];
        if (/^(privatekey|private_key|secret|apisecret|api_secret|apiKeySecret|api_key_secret)$/i.test(k)) out.secret = v.trim();
      }
      if (out.keyName || out.secret) return out;
    } catch {
      // not JSON after all
    }
  }
  const name = raw.match(KEY_NAME_RE);
  if (name) out.keyName = name[0];
  const pem = raw.match(PEM_RE);
  if (pem) {
    out.secret = pem[0];
  } else {
    // A bare base64 line of the right size is a raw ECDSA scalar (32 bytes).
    for (const token of raw.replace(KEY_NAME_RE, ' ').split(/\s+/)) {
      if (/^[A-Za-z0-9+/=]{40,}$/.test(token)) {
        try {
          const n = base64.decode(token).length;
          if (n === 32 || n === 64) {
            out.secret = token;
            break;
          }
        } catch {
          // not base64
        }
      }
    }
  }
  return out;
}

/* ----------------------------------------------------------- the private key */

interface Tlv {
  tag: number;
  start: number;
  end: number;
}

/** One DER element at `at`: tag, and where its content starts and ends. */
function derRead(bytes: Uint8Array, at: number): Tlv | null {
  if (at + 2 > bytes.length) return null;
  const tag = bytes[at];
  let len = bytes[at + 1];
  let p = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4 || p + n > bytes.length) return null;
    len = 0;
    for (let i = 0; i < n; i += 1) len = (len << 8) | bytes[p++];
  }
  if (p + len > bytes.length) return null;
  return { tag, start: p, end: p + len };
}

function derChildren(bytes: Uint8Array, start: number, end: number): Tlv[] {
  const out: Tlv[] = [];
  let at = start;
  while (at < end) {
    const t = derRead(bytes, at);
    if (!t) break;
    out.push(t);
    at = t.end;
  }
  return out;
}

/**
 * The 32-byte scalar inside an EC private key in DER: SEC1 (version 1, the
 * key is the OCTET STRING) or PKCS#8 (version 0, the OCTET STRING wraps a
 * SEC1 structure). Null for anything else, including an Ed25519 key.
 */
function scalarFromDer(der: Uint8Array): Uint8Array | null {
  const seq = derRead(der, 0);
  if (!seq || seq.tag !== 0x30) return null;
  const kids = derChildren(der, seq.start, seq.end);
  if (kids.length < 2 || kids[0].tag !== 0x02 || kids[0].end - kids[0].start !== 1) return null;
  const version = der[kids[0].start];
  const oct = kids.find((k) => k.tag === 0x04);
  if (!oct) return null;
  const content = der.slice(oct.start, oct.end);
  if (version === 1) return content.length === 32 ? content : null;
  if (version === 0) return scalarFromDer(content);
  return null;
}

export type CoinbaseKeyProblem = 'empty' | 'unreadable' | 'ed25519' | 'invalid';

/**
 * The signing scalar from what the client gave: a PEM block (SEC1 or
 * PKCS#8) or a bare base64 scalar. Ed25519 keys (64 raw bytes, or a PKCS#8
 * block that holds no EC key) are named as such: the portal recommends
 * them, and this API refuses them.
 */
export function coinbaseSigningKey(secret: string): { scalar: Uint8Array } | { problem: CoinbaseKeyProblem } {
  const s = secret.trim();
  if (!s) return { problem: 'empty' };
  let scalar: Uint8Array | null = null;
  if (/-----BEGIN/.test(s)) {
    const body = s
      .replace(/-----BEGIN [^-]+-----/, '')
      .replace(/-----END [^-]+-----/, '')
      .replace(/\s+/g, '');
    let der: Uint8Array;
    try {
      der = base64.decode(body);
    } catch {
      return { problem: 'unreadable' };
    }
    scalar = scalarFromDer(der);
    if (!scalar) {
      // PKCS#8 with the Ed25519 OID (2b 65 70) is the common wrong key type.
      const hex = Array.from(der.slice(0, 24), (b) => b.toString(16).padStart(2, '0')).join('');
      return { problem: hex.includes('2b6570') ? 'ed25519' : 'unreadable' };
    }
  } else {
    let rawBytes: Uint8Array;
    try {
      rawBytes = base64.decode(s.replace(/\s+/g, ''));
    } catch {
      return { problem: 'unreadable' };
    }
    if (rawBytes.length === 64) return { problem: 'ed25519' };
    if (rawBytes.length !== 32) return { problem: 'unreadable' };
    scalar = rawBytes;
  }
  if (!p256.utils.isValidPrivateKey(scalar)) return { problem: 'invalid' };
  return { scalar };
}

export function coinbaseKeyProblemMessage(problem: CoinbaseKeyProblem): string {
  switch (problem) {
    case 'empty':
      return 'Paste the private key.';
    case 'ed25519':
      return 'This is an Ed25519 key, which Coinbase does not accept for reading history. Make a new key and choose ECDSA as the signature algorithm.';
    case 'invalid':
      return 'That private key is not valid. Copy it again from Coinbase.';
    default:
      return 'That does not look like a Coinbase private key. Paste the whole block, from BEGIN to END.';
  }
}

/* ------------------------------------------------------------------ the JWT */

export interface CoinbaseJwtInput {
  keyName: string;
  scalar: Uint8Array;
  method: 'GET' | 'POST';
  host: string;
  /** Path only, no query string: that is what the `uri` claim names. */
  path: string;
  nowSecs: number;
  /** Random hex, one per token: Coinbase rejects a reused nonce. */
  nonceHex: string;
}

function b64urlJson(value: unknown): string {
  return base64urlnopad.encode(utf8ToBytes(JSON.stringify(value)));
}

/**
 * The bearer token for ONE request, as Coinbase's documentation specifies:
 * ES256 over header.payload, `kid` and `sub` the key name, `iss` "cdp",
 * two minutes of life, `uri` "METHOD host/path".
 */
export function coinbaseJwt(input: CoinbaseJwtInput): string {
  const header = { typ: 'JWT', alg: 'ES256', kid: input.keyName, nonce: input.nonceHex };
  const payload = {
    sub: input.keyName,
    iss: 'cdp',
    nbf: input.nowSecs,
    exp: input.nowSecs + 120,
    uri: `${input.method} ${input.host}${input.path}`,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = p256.sign(sha256(utf8ToBytes(signingInput)), input.scalar, { lowS: true });
  return `${signingInput}.${base64urlnopad.encode(sig.toCompactRawBytes())}`;
}

/** For tests and diagnostics: does this token verify under the key? */
export function coinbaseJwtVerifies(token: string, scalar: Uint8Array): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const pub = p256.getPublicKey(scalar);
  return p256.verify(base64urlnopad.decode(parts[2]), sha256(utf8ToBytes(`${parts[0]}.${parts[1]}`)), pub);
}

/* ---------------------------------------------------------------- products */

const FIAT: Record<string, FiatCurrency> = {
  USD: 'USD',
  EUR: 'EUR',
  GBP: 'GBP',
  CHF: 'CHF',
  CAD: 'CAD',
  AUD: 'AUD',
  JPY: 'JPY',
};
const USD_STABLE = new Set(['USDC', 'USDT', 'DAI', 'PYUSD', 'USDS']);

export interface CoinbaseProduct {
  btcSide: 'base' | 'quote';
  other: string;
  fiat?: FiatCurrency;
  stablecoin: boolean;
}

/** "BTC-USD" is bitcoin against dollars; "ETH-BTC" is ether against bitcoin. */
export function parseCoinbaseProduct(productId: string): CoinbaseProduct | null {
  const [base, quote] = productId.toUpperCase().split('-');
  if (!base || !quote) return null;
  let btcSide: 'base' | 'quote';
  let other: string;
  if (base === 'BTC' && quote !== 'BTC') {
    btcSide = 'base';
    other = quote;
  } else if (quote === 'BTC' && base !== 'BTC') {
    btcSide = 'quote';
    other = base;
  } else {
    return null;
  }
  const stablecoin = USD_STABLE.has(other);
  return { btcSide, other, fiat: FIAT[other] ?? (stablecoin ? 'USD' : undefined), stablecoin };
}

/* ------------------------------------------------------------------- fills */

/** One row of Advanced Trade's fills list, as the API sends it. */
export interface CoinbaseFill {
  entry_id: string;
  trade_id: string;
  order_id: string;
  /** RFC 3339, sometimes with nanoseconds. */
  trade_time: string;
  /** FILL for a real execution; REVERSAL / CORRECTION / SYNTHETIC adjust one. */
  trade_type: string;
  price: string;
  /** In the base asset, unless `size_in_quote`. */
  size: string;
  /** In the quote asset. */
  commission: string;
  product_id: string;
  size_in_quote: boolean;
  side: 'BUY' | 'SELL';
}

export function coinbaseEntryId(entryId: string): string {
  return `${COINBASE_ENTRY_PREFIX}${entryId}`;
}

export function isCoinbaseEntry(e: Pick<ManualEntry, 'id'>): boolean {
  return e.id.startsWith(COINBASE_ENTRY_PREFIX);
}

const ESTIMATE_NOTE = 'Price estimated at that day’s market rate.';

/** Every entry this sync writes names Coinbase as its source (decided
 *  2026-10-22), from the one list of sources. */
const COINBASE_SOURCE = sourceFieldsFor('coinbase') ?? {};

/** RFC 3339 with more than millisecond precision, to a Date the platform
 *  parses reliably (Hermes and V8 differ on nine fractional digits). */
export function coinbaseTimeToMs(trade_time: string): number | null {
  const trimmed = trade_time.replace(/(\.\d{3})\d+/, '$1');
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

function money(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Fills to entry drafts, oldest first. Fills without bitcoin, adjusted
 *  fills and unusable rows are skipped. */
export function coinbaseFillsToEntries(fills: readonly CoinbaseFill[], now: number): ExchangeEntryDraft[] {
  const out: ExchangeEntryDraft[] = [];
  for (const f of fills) {
    if (f.trade_type !== 'FILL') continue;
    if (f.side !== 'BUY' && f.side !== 'SELL') continue;
    const product = parseCoinbaseProduct(f.product_id);
    if (!product) continue;
    const ms = coinbaseTimeToMs(f.trade_time);
    if (ms == null) continue;
    const price = money(f.price);
    const size = money(f.size);
    const fee = money(f.commission) ?? 0;
    if (price == null || size == null || price <= 0 || size <= 0) continue;
    const base: ManualEntry = {
      id: coinbaseEntryId(f.entry_id),
      kind: 'buy',
      amountSats: 0,
      date: ms,
      createdAt: now,
      ...COINBASE_SOURCE,
    };
    const tsSecs = ms / 1000;

    if (product.btcSide === 'base') {
      // Bitcoin bought or sold; the other side is money (or another coin).
      const btc = f.size_in_quote ? size / price : size;
      const amountSats = parseAmountToSats(btc.toFixed(8), 'btc');
      if (amountSats == null || amountSats <= 0) continue;
      const kind: ManualEntryKind = f.side === 'BUY' ? 'buy' : 'sell';
      if (product.fiat) {
        const coins = f.size_in_quote ? size : btc * price;
        const total = entryTotalWithFee(kind, coins, fee, product.fiat);
        out.push({
          tsSecs,
          needsEstimate: false,
          entry: {
            ...base,
            kind,
            amountSats,
            fiatAmount: total?.total,
            fiatCurrency: total ? product.fiat : undefined,
            feeAmount: total && !total.clampedAtZero && fee > 0 ? Number(fee.toFixed(fiatDecimals(product.fiat))) : undefined,
            note: product.stablecoin ? `Coinbase trade, paid in ${product.other}, counted as US dollars.` : 'Coinbase trade.',
          },
        });
      } else {
        out.push({
          tsSecs,
          needsEstimate: true,
          entry: { ...base, kind, amountSats, note: `Coinbase trade against ${product.other}. ${ESTIMATE_NOTE}` },
        });
      }
    } else {
      // Another coin against bitcoin: buying it spends bitcoin (plus the
      // fee, which is in bitcoin), selling it brings bitcoin in (minus it).
      const btcGross = f.size_in_quote ? size : size * price;
      const kind: ManualEntryKind = f.side === 'BUY' ? 'sell' : 'buy';
      const btc = kind === 'sell' ? btcGross + fee : Math.max(0, btcGross - fee);
      const amountSats = parseAmountToSats(btc.toFixed(8), 'btc');
      if (amountSats == null || amountSats <= 0) continue;
      out.push({
        tsSecs,
        needsEstimate: true,
        entry: { ...base, kind, amountSats, note: `Coinbase trade, bitcoin for ${product.other}. ${ESTIMATE_NOTE}` },
      });
    }
  }
  return out.sort((a, b) => a.entry.date - b.entry.date);
}

/* ------------------------------------------------------------------ errors */

/** An HTTP failure from Coinbase, in plain words. */
export function coinbaseErrorMessage(status: number, bodyText: string): string {
  const words = bodyText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  if (status === 401) return 'Coinbase did not accept this key. Check the key name and the private key.';
  if (status === 403) return 'This key is not allowed to read your history. On Coinbase, give it the View permission.';
  if (status === 429) return 'Coinbase asked Talia to slow down. Please try again in a minute.';
  if (status >= 500) return 'Coinbase is having trouble right now. Please try again shortly.';
  return `Coinbase answered with status ${status}${words ? `: "${words}"` : ''}.`;
}
