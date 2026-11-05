/**
 * Parse a scanned QR payload into a candidate Bitcoin address.
 *
 * Accepts a raw address or a BIP-21 payment request
 * (`bitcoin:<addr>?amount=…`, read by `bip21.ts`). This is string plumbing
 * only — ownership/validity is decided by BDK
 * (`WalletEngine.ownsAddress` / PSBT building), never here.
 * `readSendAddress` adds the checks Send and the Rescue ask of an address
 * as it arrives.
 */
import { addressFamily, addressFitsNetwork } from './addressNetwork';
import { isLightningText, readPaymentRequest } from './bip21';
import type { Network } from './descriptor/types';

export interface ScannedAddress {
  address: string;
  /** The request's own amount, exact, when the link asked for one. */
  amountSats?: number;
}

const ADDRESS_SHAPE = /^(bc1|tb1|bcrt1)[02-9ac-hj-np-z]{6,87}$|^[13mn2][1-9A-HJ-NP-Za-km-z]{25,39}$/i;

/** No address is longer: bech32's own limit, which the reader holds it to. */
const LONGEST_ADDRESS = 90;

/**
 * Whether a `bitcoin:` link is followed by another link or address (decided
 * 2026-10-31). Everything after the `?` reads as parameters, so a second one
 * on the next line was dropped without a word and the first was paid. It asks
 * before the spaces go: they are all that tells a second address from a label,
 * and an unencoded "?label=My Shop" and a link an email wrapped are both real.
 * An address counts only when it decodes, and its pieces are tried together,
 * because an email wraps a long one too.
 */
function holdsAnotherAddress(raw: string): boolean {
  const solid = raw.replace(/\s+/g, '');
  if (!/^bitcoin:/i.test(solid) || !solid.includes('?')) return false;
  if (/bitcoin:/i.test(solid.slice(solid.indexOf('?')))) return true;
  const words = raw.slice(raw.indexOf('?') + 1).split(/[\s,;]+/);
  for (let first = 0; first < words.length; first++) {
    let joined = '';
    for (let word = first; word < words.length && joined.length <= LONGEST_ADDRESS; word++) {
      joined += words[word];
      if (addressFamily(joined) != null) return true;
    }
  }
  return false;
}

/** What a payload holds, before any network is asked about it. */
type Reading =
  | { kind: 'address'; address: string; amountSats?: number; badAmount: boolean }
  | { kind: 'several' | 'lightning' | 'unsupported' | 'invalid' };

function readPayload(raw: string): Reading {
  if (holdsAnotherAddress(raw)) return { kind: 'several' };
  let text = raw.trim();
  if (isLightningText(text)) return { kind: 'lightning' };
  let amountSats: number | undefined;
  let badAmount = false;

  const request = readPaymentRequest(text);
  if (request) {
    if (request.kind === 'lightning' || request.kind === 'unsupported') return { kind: request.kind };
    if (request.kind === 'noAddress') return { kind: 'invalid' };
    text = request.address;
    if (request.kind === 'badAmount') badAmount = true;
    else amountSats = request.amountSats;
  }

  // bech32 is case-insensitive but must not be mixed-case.
  const isBech = /^(bc1|tb1|bcrt1)/i.test(text);
  if (isBech && text !== text.toLowerCase() && text !== text.toUpperCase()) {
    return { kind: 'invalid' };
  }
  if (isBech) text = text.toLowerCase();

  if (!ADDRESS_SHAPE.test(text)) return { kind: 'invalid' };
  return { kind: 'address', address: text, amountSats, badAmount };
}

/**
 * The address a payload holds, with the amount it asks for, or null. A link
 * BIP-21 calls invalid (a `req-` parameter, an amount that is not one) holds
 * none, and neither does a Lightning request.
 */
export function parseScannedAddress(raw: string): ScannedAddress | null {
  const read = readPayload(raw);
  if (read.kind !== 'address' || read.badAmount) return null;
  return read.amountSats != null ? { address: read.address, amountSats: read.amountSats } : { address: read.address };
}

/** What a scan or a paste handed over, judged for the vault paying it. */
export type SendAddress =
  | { kind: 'address'; address: string; amountSats?: number }
  | { kind: 'wrongNetwork' }
  | { kind: 'several' }
  | { kind: 'lightning' }
  | { kind: 'unsupported' }
  | { kind: 'badAmount' }
  | { kind: 'invalid' };

/**
 * The one reading of an address arriving at Send or the Rescue, a scan and a
 * paste alike, so a `bitcoin:` link means the same either way. An address that
 * does not decode is 'invalid' here, not a wrong network at Sign. A payment
 * request's amount comes with its address; the Rescue moves everything and
 * leaves it unused. The address is judged before the amount, so a request
 * with both wrong is named by its address.
 */
export function readSendAddress(raw: string, network: Network): SendAddress {
  if (holdsAnotherAddress(raw)) return { kind: 'several' };
  // Addresses arrive with line breaks and spaces from emails and chats; none
  // of that is part of the address.
  const read = readPayload(raw.replace(/\s+/g, ''));
  if (read.kind !== 'address') return { kind: read.kind };
  if (addressFamily(read.address) == null) return { kind: 'invalid' };
  if (!addressFitsNetwork(read.address, network)) return { kind: 'wrongNetwork' };
  if (read.badAmount) return { kind: 'badAmount' };
  return read.amountSats != null
    ? { kind: 'address', address: read.address, amountSats: read.amountSats }
    : { kind: 'address', address: read.address };
}

/**
 * The title of a refused address: a title and OK, no paragraph. Each holds in
 * every case it stands for: an empty clipboard, other text, a broken address,
 * a paste iOS was told not to allow, a QR code with no address in it.
 */
export function refusedAddressTitle(kind: Exclude<SendAddress['kind'], 'address'>): string {
  switch (kind) {
    case 'several':
      return 'More than one address found';
    case 'wrongNetwork':
      return 'This address is for another network';
    case 'lightning':
      return 'Lightning payments are not supported';
    case 'unsupported':
      return 'This payment request is not supported';
    case 'badAmount':
      return 'The amount in this request is not valid';
    case 'invalid':
      return 'No Bitcoin address found';
  }
}
