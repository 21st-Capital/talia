/**
 * Encrypted descriptor backups in the format Liana writes since v16.0: the
 * newer BIP-138 draft, "Compact Encryption Scheme for Non-seed Wallet Data",
 * as the `bip138` crate 0.2.0 implements it (Liana v16.0 pins that exact
 * version). Liana saves these as `.bip138` files, and also reads them as
 * base64 text.
 *
 * READING ONLY (decided 2026-11-05). Talia keeps writing the older `.bed`
 * format (`encryptedBackup.ts`): Liana v16 still reads it (its `bip138`
 * dependency carries the `v0` reader for exactly that), every Talia build in
 * clients' hands reads it, and a Talia that wrote `.bip138` would hand a
 * client on Liana v15 or an older Talia a file they cannot open. This file
 * exists so a backup made in Liana v16 opens in Talia.
 *
 * WHAT CHANGED FROM `.bed`, field by field (both carry one secret that seals
 * the payload, XORed into one slot per key):
 *
 *                     .bed (BEB)                  .bip138
 *   magic             "BEB"                       "BIP138"
 *   keys              33-byte compressed          32-byte x-only
 *   hash              sha256(tag ‖ data)          BIP340 tagged hash
 *   cipher            AES-256-GCM                 ChaCha20-Poly1305
 *   paths             every key's origin path     only paths a reader would
 *                                                 not try anyway (unless the
 *                                                 exporter asks for all)
 *   payload           one content item            content items, then zero
 *                                                 padding
 *
 * THE FILE:
 *   "BIP138" ‖ version (1) ‖ paths ‖ slots ‖ encryption (1) ‖ nonce (12) ‖
 *   length (CompactSize) ‖ ciphertext, and anything after it is ignored.
 *   paths  = count ‖ (depth ‖ child (4 bytes, big-endian))…
 *   slots  = count ‖ c_i (32 bytes)…, padded with random decoys to 5, 10,
 *            20… so the count does not tell how many keys the vault has.
 *   s      = taggedHash("BIP138_DECRYPTION_SECRET", k_1 ‖ … ‖ k_n) over the
 *            distinct x-only keys in increasing order; ChaCha20-Poly1305
 *            under s seals the payload.
 *   c_i    = s XOR taggedHash("BIP138_INDIVIDUAL_SECRET", k_i).
 *   payload = (type ‖ [length] ‖ data ‖ length ‖ plaintext)… until a type
 *            byte 0x00 or the end; type 0x01 is a BIP number (a descriptor
 *            is BIP 380), 0x02 a vendor tag, 0x03 a text, any other type
 *            under 0x80 is skipped and 0x80 or above refuses the payload.
 *
 * The same caveat as `.bed`: every key here is PUBLIC material (an xpub), so
 * anyone who knows one of the vault's xpubs can open the file. Nothing in it
 * names a participant.
 *
 * Every rule here follows `bip138-ll` 0.2.0 (`src/lib.rs`), checked against
 * the crate's published test vectors and against files the crate wrote
 * (`__tests__/bip138Backup.test.ts`). Pure: no storage, no network, no clock.
 */
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes } from '@noble/hashes/utils';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** What a `.bip138` file starts with. */
export const BIP138_MAGIC = utf8('BIP138');
/** The only version the format defines (0 is reserved). */
export const BIP138_VERSION = 1;
/** The encryption byte for ChaCha20-Poly1305, the only cipher defined. */
export const BIP138_CHACHA20_POLY1305 = 0x01;
/** A descriptor is the content of BIP 380. */
export const BIP380 = 380;
const NONCE_LEN = 12;
const SECRET_LEN = 32;
const TAG_DECRYPTION = 'BIP138_DECRYPTION_SECRET';
const TAG_INDIVIDUAL = 'BIP138_INDIVIDUAL_SECRET';

const CONTENT_END = 0x00;
const CONTENT_BIP = 0x01;
const CONTENT_PROPRIETARY = 0x02;
const CONTENT_STRING = 0x03;
const CONTENT_UPGRADE = 0x80;

/** True when the bytes start with the `.bip138` magic. */
export function isBip138(bytes: Uint8Array): boolean {
  return bytes.length >= BIP138_MAGIC.length && BIP138_MAGIC.every((v, i) => bytes[i] === v);
}

/** BIP340's tagged hash: sha256(sha256(tag) ‖ sha256(tag) ‖ data). */
export function bip138TaggedHash(tag: string, data: Uint8Array): Uint8Array {
  const t = sha256(utf8(tag));
  return sha256(concatBytes(t, t, data));
}

const compare = (a: Uint8Array, b: Uint8Array): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
};

/**
 * The secret that seals the payload, over the distinct x-only keys in
 * increasing order, whatever order they are handed in.
 */
export function bip138DecryptionSecret(xonlyKeys: readonly Uint8Array[]): Uint8Array {
  const sorted = [...xonlyKeys].sort(compare);
  const distinct = sorted.filter((k, i) => i === 0 || compare(k, sorted[i - 1]) !== 0);
  return bip138TaggedHash(TAG_DECRYPTION, concatBytes(...distinct));
}

/** The hash a key holder XORs into a slot to recover the secret. */
export function bip138IndividualSecret(xonlyKey: Uint8Array): Uint8Array {
  return bip138TaggedHash(TAG_INDIVIDUAL, xonlyKey);
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * Bitcoin's CompactSize at `i`, refusing a non-minimal encoding as the crate
 * does. Null when it runs past the end or does not fit a safe integer.
 */
export function readCompactSize(b: Uint8Array, i: number): { value: number; next: number } | null {
  if (i >= b.length) return null;
  const first = b[i];
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (first < 0xfd) return { value: first, next: i + 1 };
  if (first === 0xfd) {
    if (i + 3 > b.length) return null;
    const v = view.getUint16(i + 1, true);
    return v >= 0xfd ? { value: v, next: i + 3 } : null;
  }
  if (first === 0xfe) {
    if (i + 5 > b.length) return null;
    const v = view.getUint32(i + 1, true);
    return v >= 0x10000 ? { value: v, next: i + 5 } : null;
  }
  if (i + 9 > b.length) return null;
  const low = view.getUint32(i + 1, true);
  const high = view.getUint32(i + 5, true);
  // At least 2^32 to be minimal, and within a safe integer (no file is
  // anywhere near that long, so the caller then finds it runs past the end).
  if (high === 0 || high >= 0x200000) return null;
  return { value: high * 0x100000000 + low, next: i + 9 };
}

// ─── the file ────────────────────────────────────────────────────────────────

export interface Bip138Container {
  /** The derivation paths the file records, as BIP-32 child numbers. Empty
   *  for a vault whose keys all sit at paths every reader tries anyway. */
  paths: number[][];
  /** One slot per key plus decoys, in file order. */
  individualSecrets: Uint8Array[];
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Read the container, or null when the bytes are not a `.bip138` backup this
 * reader can open: another magic or version, a malformed field, a cipher other
 * than ChaCha20-Poly1305, or an all-zero nonce, which the format forbids.
 */
export function parseBip138(bytes: Uint8Array): Bip138Container | null {
  if (!isBip138(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = BIP138_MAGIC.length;
  if (bytes[i] !== BIP138_VERSION) return null;
  i += 1;

  if (i >= bytes.length) return null;
  const pathCount = bytes[i];
  i += 1;
  const paths: number[][] = [];
  for (let p = 0; p < pathCount; p++) {
    if (i >= bytes.length) return null;
    const depth = bytes[i];
    i += 1;
    if (depth === 0 || i + depth * 4 > bytes.length) return null;
    const path: number[] = [];
    for (let c = 0; c < depth; c++) {
      path.push(view.getUint32(i, false));
      i += 4;
    }
    paths.push(path);
  }

  if (i >= bytes.length) return null;
  const slotCount = bytes[i];
  i += 1;
  if (slotCount === 0 || i + slotCount * SECRET_LEN > bytes.length) return null;
  const individualSecrets: Uint8Array[] = [];
  for (let s = 0; s < slotCount; s++) {
    individualSecrets.push(bytes.slice(i, i + SECRET_LEN));
    i += SECRET_LEN;
  }

  if (bytes[i] !== BIP138_CHACHA20_POLY1305) return null;
  i += 1;
  if (i + NONCE_LEN > bytes.length) return null;
  const nonce = bytes.slice(i, i + NONCE_LEN);
  if (nonce.every((b) => b === 0)) return null;
  i += NONCE_LEN;

  const len = readCompactSize(bytes, i);
  if (!len || len.next + len.value > bytes.length) return null;
  const ciphertext = bytes.slice(len.next, len.next + len.value);
  return { paths, individualSecrets, nonce, ciphertext };
}

// ─── the payload ─────────────────────────────────────────────────────────────

/** What a content item is: a BIP's content, a vendor's, a text, or a type
 *  this reader does not know (skipped, as the format says). */
export type Bip138Content =
  | { type: 'bip'; bip: number }
  | { type: 'proprietary'; tag: Uint8Array }
  | { type: 'string' }
  | { type: 'unknown' };

export interface Bip138Item {
  content: Bip138Content;
  data: Uint8Array;
}

/** One item's content metadata at the start of `b`, with its length in bytes;
 *  null when it is malformed or a type that refuses the payload. */
export function parseBip138Content(b: Uint8Array): { length: number; content: Bip138Content } | null {
  if (b.length === 0) return null;
  const type = b[0];
  if (type === CONTENT_END) return null;
  if (type === CONTENT_BIP) {
    if (b.length < 3) return null;
    return { length: 3, content: { type: 'bip', bip: (b[1] << 8) | b[2] } };
  }
  if (type >= CONTENT_UPGRADE) return null;
  const len = readCompactSize(b, 1);
  if (!len || len.next + len.value > b.length) return null;
  const data = b.slice(len.next, len.next + len.value);
  const length = len.next + len.value;
  if (type === CONTENT_PROPRIETARY) return { length, content: { type: 'proprietary', tag: data } };
  if (type === CONTENT_STRING) return data.length === 0 ? { length, content: { type: 'string' } } : null;
  return { length, content: { type: 'unknown' } };
}

/** The items of a decrypted payload, or null when it is malformed or holds
 *  none. The zero padding after the last item is ignored. */
export function decodeBip138Payload(payload: Uint8Array): Bip138Item[] | null {
  const items: Bip138Item[] = [];
  let i = 0;
  while (i < payload.length) {
    if (payload[i] === CONTENT_END) break;
    const meta = parseBip138Content(payload.subarray(i));
    if (!meta) return null;
    i += meta.length;
    const len = readCompactSize(payload, i);
    if (!len || len.next + len.value > payload.length) return null;
    items.push({ content: meta.content, data: payload.slice(len.next, len.next + len.value) });
    i = len.next + len.value;
  }
  return items.length > 0 ? items : null;
}

/**
 * Open a `.bip138` backup with one x-only key: its items, or null when that
 * key takes no part in it (or the file is not one). The first slot the key
 * unlocks decides, as in the crate.
 */
export function openBip138(bytes: Uint8Array, xonlyKey: Uint8Array): Bip138Item[] | null {
  if (xonlyKey.length !== 32) return null;
  const backup = parseBip138(bytes);
  if (!backup) return null;
  const si = bip138IndividualSecret(xonlyKey);
  for (const ci of backup.individualSecrets) {
    let payload: Uint8Array;
    try {
      payload = chacha20poly1305(xor(ci, si), backup.nonce).decrypt(backup.ciphertext);
    } catch {
      continue; // Not this slot: a decoy, or another key's.
    }
    return decodeBip138Payload(payload);
  }
  return null;
}

/** The descriptor among opened items: the first BIP 380 item that is valid
 *  UTF-8, or null when the backup holds something else. */
export function bip138Descriptor(items: readonly Bip138Item[]): string | null {
  for (const item of items) {
    if (item.content.type !== 'bip' || item.content.bip !== BIP380) continue;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(item.data);
    } catch {
      // Not text; look on.
    }
  }
  return null;
}
