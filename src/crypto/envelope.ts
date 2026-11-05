/**
 * Heir-invite envelope — the split-knowledge crypto that keeps the server
 * blind (design settled 2026-07-24).
 *
 * INVARIANT #0: the descriptor must NEVER be visible to 21C or its server.
 * Everything the server stores is ciphertext whose keys derive from two
 * things it never sees:
 *
 *   - the INVITE CODE `C` — generated on the owner's phone, delivered to the
 *     heir in a client-composed email. Derives the lookup token (how the heir
 *     finds the invite without the server learning C) and K_outer (opens the
 *     sealed CARD: vault label, heir name, expected key fingerprint).
 *   - the HEIR'S XPUB — read from their hardware key at activation. Derives
 *     K_inner (opens the DESCRIPTOR).
 *
 * The descriptor blob is sealed K_outer(K_inner(payload)): both the code AND
 * the heir's xpub are required. THE XPUB IS PUBLIC MATERIAL (decided
 * 2026-09-26): it sits in the owner's descriptor, in every
 * export and PSBT touching that key, and in any watch-only software the heir
 * used. So decrypting is NOT proof that the heir holds the device; the inner
 * layer only stops the code ALONE from opening the vault, and the code must
 * be kept as private as the vault. Real proof of possession needs a secret
 * the device alone can produce: the server withholding the descriptor blob
 * until the heir signs a server nonce with the key at the recorded origin
 * path (hardware wallets sign messages; they do not do arbitrary ECDH), a
 * backend and app change listed as open. In STRICT mode the server additionally
 * withholds that blob until `release_at`, so before the timelock there is
 * nothing on the heir's device to attack, mathematically.
 *
 * Primitives: HKDF-SHA256 + XChaCha20-Poly1305 (@noble/ciphers, pinned v1 —
 * v2 is ESM-only, which this Metro and Jest setup cannot load). Padding
 * to fixed buckets so ciphertext length reveals nothing about descriptor
 * size. Pure module — no I/O, no storage; gets a full jest suite.
 */
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { base64, createBase58check } from '@scure/base';

import { utf8ToBytes, bytesToUtf8 } from '../bitcoin/bbqr/bbqr';

// Provided by react-native-get-random-values on device (src/polyfills.ts) and
// by Node's webcrypto in jest. RN's tsconfig has no DOM lib, hence the declare.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const BASE58CHECK = createBase58check(sha256);

// ─── Invite code ─────────────────────────────────────────────────────────────

/** Crockford base32 — no I, L, O, U; unambiguous to read over a phone. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_CHARS = 20; // 20 × 5 bits = 100 bits of entropy
const V1_SALT = 'talia-heir-invite-v1';

/** Generate a fresh invite code: TALIA-XXXXX-XXXXX-XXXXX-XXXXX. */
export function generateInviteCode(): string {
  const rnd = new Uint8Array(CODE_CHARS);
  // Requires crypto.getRandomValues (react-native-get-random-values on
  // device, Node's webcrypto in tests). Throwing here beats weak randomness.
  crypto.getRandomValues(rnd);
  let chars = '';
  for (let i = 0; i < CODE_CHARS; i++) chars += CROCKFORD[rnd[i] & 31];
  const groups = chars.match(/.{5}/g) as string[];
  return `TALIA-${groups.join('-')}`;
}

/**
 * Canonical form of a typed/scanned code: the bare 20 characters, uppercase,
 * Crockford-normalized (I→1, L→1, O→0), prefix and separators dropped.
 * Returns null when it can't be a v1 invite code.
 */
export function normalizeInviteCode(input: string): string | null {
  let s = input.trim().toUpperCase();
  s = s.replace(/^TALIA[\s-]*/i, '').replace(/[\s-]+/g, '');
  s = s.replace(/I|L/g, '1').replace(/O/g, '0');
  if (s.length !== CODE_CHARS) return null;
  for (const ch of s) if (!CROCKFORD.includes(ch)) return null;
  return s;
}

// ─── Key derivation ──────────────────────────────────────────────────────────

function derive(ikm: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, ikm, utf8ToBytes(V1_SALT), utf8ToBytes(info), 32);
}

/** Sent to the server at claim; the server stores only sha256 of it. */
export function lookupToken(code: string): string {
  const c = normalizeInviteCode(code);
  if (!c) throw new Error('Not a valid invite code.');
  return toHex(derive(utf8ToBytes(c), 'lookup'));
}

/** What the server stores: sha256(lookupToken-bytes), hex. */
export function lookupHash(code: string): string {
  return toHex(sha256(fromHex(lookupToken(code))));
}

function outerKey(code: string): Uint8Array {
  const c = normalizeInviteCode(code);
  if (!c) throw new Error('Not a valid invite code.');
  return derive(utf8ToBytes(c), 'outer-key');
}

/**
 * K_inner from the heir's xpub. Canonicalization: base58check-decode, require
 * 78 bytes, ZERO the 4 version bytes — so xpub/tpub/zpub/vpub of the same key
 * all derive the same K_inner, whatever wallet exported it.
 */
export function innerKeyFromXpub(xpub: string, innerSalt: Uint8Array): Uint8Array {
  const bytes = canonicalXpubBytes(xpub);
  return hkdf(sha256, bytes, innerSalt, utf8ToBytes(`${V1_SALT}/inner-key`), 32);
}

export function canonicalXpubBytes(xpub: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = BASE58CHECK.decode(xpub.trim());
  } catch {
    throw new Error('That is not a valid extended public key.');
  }
  if (bytes.length !== 78) throw new Error('Unexpected extended-key length.');
  const canon = new Uint8Array(bytes);
  canon[0] = canon[1] = canon[2] = canon[3] = 0; // version-agnostic
  return canon;
}

// ─── Seal / open ─────────────────────────────────────────────────────────────

const NONCE_LEN = 24;
/** Ciphertext length hides payload size: everything pads to one of these. */
const BUCKETS = [2048, 4096, 8192, 16384];

function pad(plain: Uint8Array): Uint8Array {
  const need = plain.length + 4;
  const bucket = BUCKETS.find((b) => b >= need);
  if (!bucket) throw new Error('Payload too large for the invite envelope.');
  const out = new Uint8Array(bucket);
  // 4-byte BE length prefix, then payload, then zeros.
  out[0] = (plain.length >>> 24) & 0xff;
  out[1] = (plain.length >>> 16) & 0xff;
  out[2] = (plain.length >>> 8) & 0xff;
  out[3] = plain.length & 0xff;
  out.set(plain, 4);
  return out;
}

function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length < 4) throw new Error('Envelope too short.');
  const len = (padded[0] << 24) | (padded[1] << 16) | (padded[2] << 8) | padded[3];
  if (len < 0 || len + 4 > padded.length) throw new Error('Envelope length is corrupt.');
  return padded.subarray(4, 4 + len);
}

function seal(key: Uint8Array, plain: Uint8Array): Uint8Array {
  const nonce = new Uint8Array(NONCE_LEN);
  crypto.getRandomValues(nonce);
  const ct = xchacha20poly1305(key, nonce).encrypt(pad(plain));
  const out = new Uint8Array(NONCE_LEN + ct.length);
  out.set(nonce, 0);
  out.set(ct, NONCE_LEN);
  return out;
}

function open(key: Uint8Array, sealed: Uint8Array): Uint8Array {
  if (sealed.length <= NONCE_LEN) throw new Error('Envelope too short.');
  const nonce = sealed.subarray(0, NONCE_LEN);
  const ct = sealed.subarray(NONCE_LEN);
  return unpad(xchacha20poly1305(key, nonce).decrypt(ct));
}

// ─── Code-sealed envelope, for other invite kinds ────────────────────────────
//
// A shared-portfolio invite (crypto/sharedPortfolio.ts) reuses this exact
// envelope: the same Crockford code body, the same HKDF outer key, the same
// padded XChaCha20-Poly1305 seal. These two wrappers are the only door to the
// private helpers, so the heir format above cannot drift apart from it.

/** Seal bytes under the code alone; base64 out. `code` may be a full heir
 *  code or the bare 20-character body (both normalise the same way). */
export function sealToCode(code: string, bytes: Uint8Array): string {
  return base64.encode(seal(outerKey(code), bytes));
}

/** Open what `sealToCode` produced. Throws on a wrong code or damage. */
export function openWithCode(code: string, sealedB64: string): Uint8Array {
  return open(outerKey(code), base64.decode(sealedB64));
}

// ─── The two blobs ───────────────────────────────────────────────────────────

export interface InviteCard {
  v: 1;
  /** 'key' (default, absent on early cards): opening the descriptor takes
   *  the code AND the heir's hardware key. 'code': the code alone opens it —
   *  a KEYLESS heir (decided 2026-07-26), necessarily full visibility. */
  access?: 'key' | 'code';
  vaultLabel: string;
  heirName: string;
  /** Master fingerprint of the key that unlocks the descriptor blob.
   *  Absent on keyless (access 'code') invites. */
  expectedFingerprint?: string;
  /** Origin path of the heir's key (e.g. "86'/1'/0'") — which slot of a
   *  hardware export to use at activation. A path reveals no key material. */
  heirOriginPath?: string;
  network: string;
  mode: 'strict' | 'full';
  /** Salt for the xpub-derived inner key. Absent on keyless invites. */
  innerSaltB64?: string;
}

export interface DescriptorPayload {
  v: 1;
  descriptor: string;
  /** Separate change descriptor, for vaults imported as a receive+change
   *  pair (multipath vaults carry <0;1> inside `descriptor` instead). */
  changeDescriptor?: string;
  network: string;
  vaultLabel: string;
  /** The owner's key names by fingerprint — the heir's signing ceremony
   *  speaks in these instead of raw fingerprints (decided 2026-07-27). */
  keyLabels?: Record<string, string>;
  /** 21st Capital-issued key fingerprints, so the heir's vault knows which
   *  keys are the provider's (rescue routing, no registration prompts). */
  providerKeyFingerprints?: string[];
}

/** Owner side: build both ciphertexts for one heir invite. No `heirXpub` =
 *  a KEYLESS invite: the code alone seals the descriptor (single layer). */
export function buildInviteBlobs(input: {
  code: string;
  heirXpub?: string;
  card: Omit<InviteCard, 'v' | 'innerSaltB64' | 'access'>;
  descriptor: DescriptorPayload;
}): { cardCiphertextB64: string; descriptorCiphertextB64: string } {
  const kOuter = outerKey(input.code);

  if (!input.heirXpub) {
    // Keyless: nothing anchors a strict-mode countdown — refuse rather than
    // seal an invite the server would withhold forever.
    if (input.card.mode !== 'full') {
      throw new Error('A keyless invite must be full visibility.');
    }
    const card: InviteCard = { v: 1, access: 'code', ...input.card };
    return {
      cardCiphertextB64: base64.encode(seal(kOuter, utf8ToBytes(JSON.stringify(card)))),
      descriptorCiphertextB64: base64.encode(
        seal(kOuter, utf8ToBytes(JSON.stringify(input.descriptor))),
      ),
    };
  }

  const innerSalt = new Uint8Array(16);
  crypto.getRandomValues(innerSalt);
  const kInner = innerKeyFromXpub(input.heirXpub, innerSalt);

  const card: InviteCard = {
    v: 1,
    access: 'key',
    ...input.card,
    innerSaltB64: base64.encode(innerSalt),
  };
  const cardCt = seal(kOuter, utf8ToBytes(JSON.stringify(card)));

  // Descriptor: inner seal under the heir's key, outer seal under the code —
  // BOTH are required, in the same order on both sides.
  const inner = seal(kInner, utf8ToBytes(JSON.stringify(input.descriptor)));
  const outer = seal(kOuter, inner);

  return {
    cardCiphertextB64: base64.encode(cardCt),
    descriptorCiphertextB64: base64.encode(outer),
  };
}

/** Heir side, step 1: the code alone opens the sealed card. */
export function openCard(code: string, cardCiphertextB64: string): InviteCard {
  const plain = open(outerKey(code), base64.decode(cardCiphertextB64));
  const card = JSON.parse(bytesToUtf8(plain)) as InviteCard;
  if (card.v !== 1) throw new Error('This invite needs a newer app version.');
  return card;
}

/** Heir side, step 2: code + THEIR key open the descriptor. A keyless
 *  (`access: 'code'`) card opens with the code alone — pass null. */
export function openDescriptor(
  code: string,
  card: InviteCard,
  heirXpub: string | null,
  descriptorCiphertextB64: string,
): DescriptorPayload {
  const outer = open(outerKey(code), base64.decode(descriptorCiphertextB64));

  let plain: Uint8Array;
  if (card.access === 'code') {
    plain = outer;
  } else {
    if (!heirXpub || !card.innerSaltB64) {
      throw new Error('Opening this vault requires the hardware key it is locked to.');
    }
    const innerSalt = base64.decode(card.innerSaltB64);
    const kInner = innerKeyFromXpub(heirXpub, innerSalt);
    try {
      plain = open(kInner, outer);
    } catch {
      throw new Error(
        `This key does not open the vault. The invite is locked to the key ` +
          `with fingerprint ${(card.expectedFingerprint ?? '').toUpperCase()}.`,
      );
    }
  }
  const payload = JSON.parse(bytesToUtf8(plain)) as DescriptorPayload;
  if (payload.v !== 1) throw new Error('This invite needs a newer app version.');
  return payload;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
