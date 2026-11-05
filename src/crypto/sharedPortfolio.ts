/**
 * Shared portfolios (decided 2026-09-12: share a hand-kept portfolio with other
 * people "using the same method we use for on-chain vault heirs", synced for
 * every participant). The pure half: keys, codes, the sealed card, the
 * shared blob, and the stamp the server compares. No I/O; fully unit-tested.
 *
 * HOW IT STAYS PRIVATE. At Share the owner's phone mints a random 32-byte
 * portfolio key K_p and a share id. The portfolio's SyncVault is sealed under
 * K_p with the SAME XChaCha20-Poly1305 envelope the account blob uses
 * (crypto/vaultSync.ts), tagged RANDOM_KEY_ID so the two can never be opened
 * as each other. An invite is the KEYLESS heir-invite mechanism
 * (crypto/envelope.ts): a code TALIA-P-XXXXX-XXXXX-XXXXX-XXXXX generated on
 * the phone, a CARD sealed under that code carrying K_p and the portfolio's
 * identity, and a lookup token so the claimant finds the invite without the
 * server ever seeing the code. The server stores ciphertext and hashes only.
 *
 * NO PASSWORD, NO KDF, on purpose: K_p is random, lives in the Keychain, and
 * launches read 32 bytes. Nothing here may ever run a key derivation near
 * boot (the 12-second lesson in crypto/vaultSync.ts).
 *
 * The merge is the account loop's own `mergeVault` (per-entry LWW with
 * tombstones), reused, not reimplemented: two members editing the same
 * portfolio converge exactly as two phones on one account do.
 */
import { base64 } from '@scure/base';

import { utf8ToBytes, bytesToUtf8 } from '../bitcoin/bbqr/bbqr';
import { lookupHash, lookupToken, normalizeInviteCode, openWithCode, sealToCode } from './envelope';
import { RANDOM_KEY_ID, isSyncVault, openSyncBlob, padPayload, sealSyncBlob } from './vaultSync';
import type { SyncVault } from './vaultSync';
import { mergeVault } from './vaultSync';

// react-native-get-random-values (src/polyfills.ts) on device, Node's
// webcrypto in jest. RN's tsconfig has no DOM lib, hence the declare.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

// ─── Keys and ids ────────────────────────────────────────────────────────────

/** A fresh portfolio key: 32 random bytes. Throwing beats weak randomness. */
export function newShareKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

/** A fresh share id: UUID v4, minted on the phone (the server accepts it as
 *  is; a second POST of the same id by the same owner is idempotent). */
export function newShareId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ─── Invite codes ────────────────────────────────────────────────────────────

/** Crockford base32, as the heir code: no I, L, O, U. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BODY_CHARS = 20; // 100 bits, the same as an heir code

/**
 * Canonical 20-character body of a typed or scanned portfolio code, or null
 * when the input cannot be one. Accepts every way a person types it: lower
 * case, spaces for dashes, no dashes at all, with or without the TALIA
 * prefix. What it REQUIRES is the P marker in front of the body: a plain
 * heir code (TALIA-XXXXX-XXXXX-XXXXX-XXXXX) is never a portfolio code, and
 * an heir code whose body happens to start with P is one character short.
 */
export function normalizePortfolioInviteCode(input: string): string | null {
  let s = input.trim().toUpperCase();
  s = s.replace(/^TALIA[\s-]*/, '').replace(/[\s-]+/g, '');
  if (s.length !== BODY_CHARS + 1 || s[0] !== 'P') return null;
  const body = s.slice(1).replace(/I|L/g, '1').replace(/O/g, '0');
  for (const ch of body) if (!CROCKFORD.includes(ch)) return null;
  return body;
}

export function isPortfolioInviteCode(input: string): boolean {
  return normalizePortfolioInviteCode(input) != null;
}

/** TALIA-P-XXXXX-XXXXX-XXXXX-XXXXX from a typed portfolio code in any of its
 *  variants, or from a bare 20-character body (what the generator mints).
 *  A full heir code is refused: it is a different invite. */
export function formatPortfolioInviteCode(input: string): string {
  const bare = /^[0-9A-Za-z]{20}$/.test(input.trim()) ? normalizeInviteCode(input) : null;
  const body = normalizePortfolioInviteCode(input) ?? bare;
  if (!body) throw new Error('Not a valid portfolio invite code.');
  const groups = body.match(/.{5}/g) as string[];
  return `TALIA-P-${groups.join('-')}`;
}

/** Generate a fresh portfolio invite code. */
export function newPortfolioInviteCode(): string {
  const rnd = new Uint8Array(BODY_CHARS);
  crypto.getRandomValues(rnd);
  let body = '';
  for (let i = 0; i < BODY_CHARS; i++) body += CROCKFORD[rnd[i] & 31];
  return formatPortfolioInviteCode(body);
}

function bodyOf(code: string): string {
  const body = normalizePortfolioInviteCode(code);
  if (!body) throw new Error('Not a valid portfolio invite code.');
  return body;
}

/** Sent to the server at claim; the server stores only sha256 of it. */
export function portfolioLookupToken(code: string): string {
  return lookupToken(bodyOf(code));
}

/** What the server stores: sha256(lookupToken-bytes), hex. */
export function portfolioLookupHash(code: string): string {
  return lookupHash(bodyOf(code));
}

// ─── The sealed card ─────────────────────────────────────────────────────────

/** What the code opens: the portfolio's identity and its key. The server
 *  holds this as opaque ciphertext; the code never reaches it. */
export interface PortfolioCard {
  v: 1;
  kind: 'portfolio';
  shareId: string;
  /** The owner's wallet id. The member's copy takes the SAME id so entries
   *  line up across every participant, as the account loop lines up phones. */
  portfolioId: string;
  label: string;
  icon?: string;
  ownerName?: string;
  /** K_p, base64. */
  keyB64: string;
}

export interface PortfolioCardInput {
  shareId: string;
  portfolioId: string;
  label: string;
  icon?: string;
  ownerName?: string;
  key: Uint8Array;
}

/** The card as the claimant reads it: key decoded, wire fields dropped. */
export interface OpenedPortfolioCard {
  shareId: string;
  portfolioId: string;
  label: string;
  icon?: string;
  ownerName?: string;
  key: Uint8Array;
}

/** Owner side: seal the card under the code. */
export function sealPortfolioCard(code: string, input: PortfolioCardInput): string {
  if (input.key.length !== 32) throw new Error('A portfolio key is 32 bytes.');
  const card: PortfolioCard = {
    v: 1,
    kind: 'portfolio',
    shareId: input.shareId,
    portfolioId: input.portfolioId,
    label: input.label,
    ...(input.icon ? { icon: input.icon } : {}),
    ...(input.ownerName ? { ownerName: input.ownerName } : {}),
    keyB64: base64.encode(input.key),
  };
  return sealToCode(bodyOf(code), utf8ToBytes(JSON.stringify(card)));
}

/** Claimant side: the code alone opens the card. Wrong code, a card of
 *  another kind, or damage all refuse with a plain message. */
export function openPortfolioCard(code: string, cardB64: string): OpenedPortfolioCard {
  let plain: Uint8Array;
  try {
    plain = openWithCode(bodyOf(code), cardB64);
  } catch {
    throw new Error('This code does not open the invite. Check it and try again.');
  }
  let card: Partial<PortfolioCard>;
  try {
    card = JSON.parse(bytesToUtf8(plain)) as Partial<PortfolioCard>;
  } catch {
    throw new Error('The invite is damaged.');
  }
  if (card.kind !== 'portfolio') throw new Error('This is not a portfolio invite.');
  if (card.v !== 1) throw new Error('This invite needs a newer version of Talia. Please update the app.');
  if (
    typeof card.shareId !== 'string' ||
    typeof card.portfolioId !== 'string' ||
    typeof card.label !== 'string' ||
    typeof card.keyB64 !== 'string'
  ) {
    throw new Error('The invite is damaged.');
  }
  let key: Uint8Array;
  try {
    key = base64.decode(card.keyB64);
  } catch {
    throw new Error('The invite is damaged.');
  }
  if (key.length !== 32) throw new Error('The invite is damaged.');
  return {
    shareId: card.shareId,
    portfolioId: card.portfolioId,
    label: card.label,
    icon: typeof card.icon === 'string' ? card.icon : undefined,
    ownerName: typeof card.ownerName === 'string' ? card.ownerName : undefined,
    key,
  };
}

// ─── The shared blob ─────────────────────────────────────────────────────────

const PAYLOAD_V = 1;

/** Seal one portfolio's SyncVault under K_p, padded to a size bucket. */
export function sealSharedVault(key: Uint8Array, vault: SyncVault): string {
  const payload = JSON.stringify({ v: PAYLOAD_V, vault });
  return sealSyncBlob(key, padPayload(payload), RANDOM_KEY_ID);
}

/** Open a shared blob. The scrypt-tagged account envelope is refused by the
 *  tag check before any decryption is attempted. */
export function openSharedVault(key: Uint8Array, blob: string): SyncVault {
  let json: string;
  try {
    json = openSyncBlob(key, blob, RANDOM_KEY_ID);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/sync password/.test(msg)) {
      throw new Error('This shared portfolio could not be opened with the key on this phone.');
    }
    throw e;
  }
  let doc: { v?: number; vault?: unknown };
  try {
    doc = JSON.parse(json) as typeof doc;
  } catch {
    throw new Error('The shared portfolio data is damaged.');
  }
  if (doc.v !== PAYLOAD_V || !isSyncVault(doc.vault)) {
    throw new Error('The shared portfolio data is damaged.');
  }
  return doc.vault;
}

// ─── Comparison and the server stamp ─────────────────────────────────────────

/** Canonical shape, so two vaults compare by content, not key order. */
function normalizeVault(v: SyncVault): SyncVault {
  return {
    id: v.id,
    label: v.label,
    icon: v.icon,
    entries: [...v.entries].sort(
      (x, y) => x.date - y.date || x.createdAt - y.createdAt || x.id.localeCompare(y.id),
    ),
    deletedEntries: [...(v.deletedEntries ?? [])].sort((x, y) => x.id.localeCompare(y.id)),
    updatedAt: v.updatedAt,
  };
}

/** True when the two carry the same content (after a merge: "did local
 *  change?" and "does the server need a push?"). */
export function sameSharedVault(a: SyncVault, b: SyncVault): boolean {
  return JSON.stringify(normalizeVault(a)) === JSON.stringify(normalizeVault(b));
}

/**
 * What one shared sync should do with the two copies.
 *
 * A MEMBER reads: their copy is the owner's, verbatim, and nothing of theirs
 * is ever pushed (decided 2026-09-14: the owner is the only person who can update the
 * portfolio). Mirroring rather than merging is what keeps an entry that
 * predates view-only, or one written by a path nobody guarded yet, from
 * lingering on their phone and showing a balance the owner never recorded.
 * The OWNER merges both sides and pushes when the result differs.
 */
export function sharedSyncPlan(
  viewer: boolean,
  local: SyncVault,
  remote: SyncVault,
): { merged: SyncVault; needPush: boolean } {
  if (viewer) return { merged: remote, needPush: false };
  const merged = mergeVault(local, remote);
  return { merged, needPush: !sameSharedVault(merged, remote) };
}

/** The `client_updated_at` the server keeps beside the blob: the newest
 *  stamp in the vault, rounded UP to the minute so the plaintext reveals
 *  edit order, not the moment anyone touched the portfolio (the same rule
 *  as the account blob's stateStamp). */
export function sharedStamp(vault: SyncVault): number {
  const exact = Math.max(
    1,
    vault.updatedAt,
    ...vault.entries.map((e) => e.updatedAt ?? e.createdAt),
    ...(vault.deletedEntries ?? []).map((t) => t.at),
  );
  return Math.ceil(exact / 60_000) * 60_000;
}
