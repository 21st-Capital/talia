/**
 * BIP-21 payment requests (decided 2026-11-04: a client scans a checkout's QR
 * code and pays the exact amount it asks for, in one go). Pure string
 * reading: what a `bitcoin:` link asks for. Whether its address decodes, and
 * for which network, is `readSendAddress`'s to judge (`scanParse.ts`).
 *
 * The rules a request is held to:
 * - The scheme and the parameter names in any case (BIP-21's grammar is ABNF,
 *   whose quoted strings are case-insensitive; a QR code in alphanumeric mode
 *   is all capitals).
 * - `amount` is decimal bitcoin with a point: digits and at most one point,
 *   no sign, exponent, comma or space, nothing below one satoshi, more than
 *   nothing and no more than 21 million. It is read digit by digit into
 *   satoshis, never through a floating-point number, so the amount paid is
 *   the amount asked, to the satoshi. Two amounts are refused, as neither
 *   can be the one meant.
 * - A `req-` parameter is one the payer MUST understand, and Talia
 *   understands none, so the whole request is refused (BIP-21: "If a client
 *   does not implement any variables which are prefixed with req-, it MUST
 *   consider the entire URI invalid"). Any other parameter Talia does not
 *   know (a Lightning invoice beside the address, a payjoin endpoint) is
 *   left unused, as BIP-21 says.
 * - An empty address with a `lightning=` or `lno=` parameter is a Lightning
 *   request and nothing else (BIP-321's reading of an empty address).
 */

/** No more bitcoin will ever exist, so no request can ask for more. */
export const MAX_SATS = 21_000_000 * 100_000_000;

const SATS_PER_BTC = 100_000_000;

export type PaymentRequest =
  | {
      kind: 'request';
      /** As written in the link: nothing here says it decodes. */
      address: string;
      amountSats?: number;
      label?: string;
      message?: string;
    }
  /** The address is there, its amount is not a bitcoin amount. */
  | { kind: 'badAmount'; address: string }
  /** A `req-` parameter, which Talia must understand and does not. */
  | { kind: 'unsupported'; param: string }
  /** No address, only a Lightning invoice or offer. */
  | { kind: 'lightning' }
  /** No address, and nothing else Talia can pay. */
  | { kind: 'noAddress' };

/**
 * A decimal bitcoin amount in satoshis, or null when it is not one. Read as
 * text, so "0.1" is exactly 10,000,000 satoshis and never 9,999,999.
 */
export function btcToSats(text: string): number | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m) return null;
  const [, written, frac = ''] = m;
  if (written === '' && frac === '') return null;
  // Below one satoshi: no transaction can carry it. Zeros past the eighth
  // place change nothing and are taken.
  if (/[^0]/.test(frac.slice(8))) return null;
  const whole = written.replace(/^0+/, '');
  if (whole.length > 8) return null;
  const sats = Number(whole || '0') * SATS_PER_BTC + Number(frac.slice(0, 8).padEnd(8, '0'));
  return sats > 0 && sats <= MAX_SATS ? sats : null;
}

/** Satoshis as decimal bitcoin, exact, with no trailing zeros ("0.0015"). */
export function satsToBtcText(sats: number): string {
  const whole = Math.floor(sats / SATS_PER_BTC);
  const frac = String(sats % SATS_PER_BTC).padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/**
 * Text that asks for a Lightning payment on its own: a `lightning:` link, a
 * BOLT-11 invoice on any network, an LNURL, a BOLT-12 offer or invoice
 * request. No Bitcoin address starts this way.
 */
export function isLightningText(text: string): boolean {
  return /^(?:lightning:|ln(?:bc|tb|url|o1|i1))/i.test(text.trim());
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A `bitcoin:` link read as BIP-21 asks, or null when the text is not one.
 * The text should hold no spaces the link did not carry; a label an email
 * left unencoded ("?label=My Shop") is fine.
 */
export function readPaymentRequest(text: string): PaymentRequest | null {
  const t = text.trim();
  if (!/^bitcoin:/i.test(t)) return null;
  const body = t.slice('bitcoin:'.length);
  const q = body.indexOf('?');
  const address = q >= 0 ? body.slice(0, q) : body;
  const params = (q >= 0 ? body.slice(q + 1).split('&') : [])
    .filter((part) => part !== '')
    .map((part) => {
      const eq = part.indexOf('=');
      return eq >= 0
        ? { key: part.slice(0, eq).toLowerCase(), value: part.slice(eq + 1) }
        : { key: part.toLowerCase(), value: '' };
    });

  const required = params.find((p) => p.key.startsWith('req-'));
  if (required) return { kind: 'unsupported', param: required.key };
  if (address === '') {
    return params.some((p) => p.key === 'lightning' || p.key === 'lno')
      ? { kind: 'lightning' }
      : { kind: 'noAddress' };
  }

  const amounts = params.filter((p) => p.key === 'amount');
  let amountSats: number | undefined;
  if (amounts.length > 1) return { kind: 'badAmount', address };
  if (amounts.length === 1) {
    const sats = btcToSats(amounts[0].value);
    if (sats == null) return { kind: 'badAmount', address };
    amountSats = sats;
  }
  const label = params.find((p) => p.key === 'label');
  const message = params.find((p) => p.key === 'message');
  return {
    kind: 'request',
    address,
    ...(amountSats != null ? { amountSats } : {}),
    ...(label ? { label: decoded(label.value) } : {}),
    ...(message ? { message: decoded(message.value) } : {}),
  };
}
