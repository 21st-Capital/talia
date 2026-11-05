/**
 * End-to-end encryption + merge logic for virtual-vault sync (decided 2026-08-26:
 * "if the privacy of the user is maintained, lets sync these portfolios
 * through the users account").
 *
 * THE CONTRACT: the server stores one opaque ciphertext per account (see the
 * backend's VirtualVaultBlob). The key derives from the user's SYNC PASSWORD
 * on the phone and never leaves it, so amounts, prices, dates and notes are
 * unreadable server-side without the password (a WEAK password can be
 * guessed offline against the blob, hence syncPasswordProblem). Losing the
 * password loses the
 * synced copy — the honest price of the server holding nothing; the local
 * data and file/QR exports are unaffected.
 *
 * Primitives are the repo's proven set (same as the heir-invite envelope):
 * scrypt for the password KDF, XChaCha20-Poly1305 for AEAD — @noble pinned
 * v1 (v2 is ESM-only, which this Metro and Jest setup cannot load).
 *
 * The MERGE is last-writer-wins PER VAULT on the app's own stamps, with
 * tombstones so a deletion on one phone doesn't resurrect from the other.
 * Pure module — no I/O, no storage; fully unit-tested.
 */
import { scryptAsync } from '@noble/hashes/scrypt';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { base64 } from '@scure/base';

import { utf8ToBytes, bytesToUtf8 } from '../bitcoin/bbqr/bbqr';
import type { ManualEntry } from '../wallet/manualLedger';

declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

// ─── Key derivation ──────────────────────────────────────────────────────────

/** The account blob: a key derived from the sync password by scrypt. */
const KDF_ID = 'scrypt-n15-r8-p1';
/**
 * A SHARED portfolio's blob (2026-09-12): the key is 32 random bytes minted
 * at Share and handed to members inside the sealed invite card, so there is
 * no password and NO KDF anywhere (the 12-second lesson below). The tag is
 * checked on open, so a blob sealed one way can never be opened as the other.
 */
export const RANDOM_KEY_ID = 'random-key-v1';
const ENVELOPE_V = 1;

/**
 * Sync key from the password, scoped to the ACCOUNT: the same password on two
 * accounts yields unrelated keys, and a blob can never be opened against the
 * wrong account's data. NFKC so the same visible password always produces
 * the same bytes across keyboards.
 */
export async function deriveSyncKey(password: string, accountEmail: string): Promise<Uint8Array> {
  const salt = sha256(utf8ToBytes(`talia-vvault-sync-v1:${accountEmail.trim().toLowerCase()}`));
  // scryptASYNC on purpose: the sync KDF runs at cold start, and the sync
  // flavour froze the JS thread for hundreds of ms — starving the splash
  // animation into its kill-timeout (felt in a phone test, 2026-08-27).
  return scryptAsync(utf8ToBytes(password.normalize('NFKC')), salt, {
    N: 2 ** 15,
    r: 8,
    p: 1,
    dkLen: 32,
  });
}

// ─── Keychain credential ─────────────────────────────────────────────────────
//
// THE 12-SECOND LESSON (2026-08-27): scrypt(2^15) takes ~11.3s on Hermes'
// interpreter, and noble's scryptAsync "yields" via an EMPTY MICROTASK
// (`const nextTick = async () => {}`) — which yields to nothing: timers,
// rendering and events all stall exactly as with the sync version. Running
// the KDF anywhere near launch froze the phone on every cold start for two
// days and burned seven wrong bisects. The rule: the KDF runs ONCE, at
// enablement, on a screen showing a spinner — and the DERIVED KEY is stored
// in the Keychain (since 2026-09-26 the key ALONE, this device only; the
// password is never stored). Launches read 32 bytes. Never put a KDF on or
// near the boot path.

export interface SyncCredential {
  /** LEGACY only: the sync password itself, which the Keychain used to hold
   *  beside the key. Nothing writes it any more (decided 2026-09-26:
   *  a password in a backup-migratable item is a password handed
   *  to anyone with the backup, and people reuse passwords). A stored
   *  password is read ONCE to migrate and then dropped. */
  password?: string;
  /** The scrypt-derived key, base64: all that sync ever needs. */
  keyB64?: string;
}

/** Serialize for the Keychain "password" field: the derived key alone. */
export function encodeSyncCredential(cred: { keyB64: string }): string {
  return JSON.stringify({ v: 2, keyB64: cred.keyB64 });
}

/** Parse a Keychain value: the v2 key-only form, the v1 envelope that also
 *  held the password, or a LEGACY bare password from before the derived key
 *  was stored (keyB64 undefined: the caller schedules a one-time migration). */
export function decodeSyncCredential(stored: string): SyncCredential {
  try {
    const doc = JSON.parse(stored) as { v?: number; password?: string; keyB64?: string };
    if (doc.v === 2 && typeof doc.keyB64 === 'string') {
      return { keyB64: doc.keyB64 };
    }
    if (doc.v === 1 && typeof doc.password === 'string') {
      return { password: doc.password, keyB64: typeof doc.keyB64 === 'string' ? doc.keyB64 : undefined };
    }
  } catch {
    // legacy bare password
  }
  return { password: stored };
}

/** True when a stored credential still carries the password and must be
 *  rewritten in the key-only form. */
export function credentialNeedsRewrite(cred: SyncCredential): boolean {
  return cred.password != null;
}

/**
 * A password strong enough to be the ONLY thing between a synced copy and
 * someone who holds the server's sealed blob (decided 2026-09-26). The key is
 * derived from the password and the account email, and the server knows the
 * email, so a guessable password can be tried offline against the blob. The
 * KDF cannot be made much slower on Hermes (the 12-second lesson above), so
 * the password has to carry the weight: at least 12 characters, not one
 * repeated pattern, not digits alone, not a well-known password. Returns the
 * reason in plain words, or null when it will do.
 *
 * Applied only when the ACCOUNT has no synced copy yet: a second phone must
 * be able to type the password the first phone chose, whatever its length.
 */
export const SYNC_PASSWORD_MIN = 12;
const COMMON = ['password', 'passwort', 'qwerty', 'azerty', '123456', 'abcdef', 'letmein', 'bitcoin', 'satoshi', 'talia', 'iloveyou', 'welcome'];
export function syncPasswordProblem(password: string): string | null {
  const pw = password.normalize('NFKC');
  if (pw.length < SYNC_PASSWORD_MIN) {
    return `Choose a sync password of at least ${SYNC_PASSWORD_MIN} characters.`;
  }
  if (new Set(pw.toLowerCase()).size < 6 || /^\d+$/.test(pw)) {
    return 'Choose a sync password that is harder to guess.';
  }
  const lower = pw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const stripped = COMMON.reduce((rest, word) => rest.split(word).join(''), lower);
  if (stripped.length < 6) return 'Choose a sync password that is harder to guess.';
  return null;
}

// ─── Envelope ────────────────────────────────────────────────────────────────

/** Seal a JSON payload string into the wire envelope. `kdf` names how the
 *  key was made (default: the account blob's scrypt tag; shared portfolios
 *  pass RANDOM_KEY_ID) and is checked again on open. */
export function sealSyncBlob(key: Uint8Array, payloadJson: string, kdf: string = KDF_ID): string {
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  const ct = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(payloadJson));
  return JSON.stringify({
    v: ENVELOPE_V,
    kdf,
    nonce: base64.encode(nonce),
    ct: base64.encode(ct),
  });
}

/** Open a wire envelope. Throws a user-readable error on anything wrong —
 *  and a wrong password IS "anything wrong" (Poly1305 refuses to decrypt).
 *  A blob carrying a different `kdf` tag than expected is refused before any
 *  decryption: the two envelopes are never interchangeable. */
export function openSyncBlob(key: Uint8Array, blob: string, kdf: string = KDF_ID): string {
  let doc: { v?: number; kdf?: string; nonce?: string; ct?: string };
  try {
    doc = JSON.parse(blob) as typeof doc;
  } catch {
    throw new Error('The synced data is not in a format this app understands.');
  }
  if (doc.v !== ENVELOPE_V) {
    throw new Error('This synced data was made by a newer version of Talia. Please update the app.');
  }
  if (doc.kdf !== kdf) {
    throw new Error('This synced data was not sealed for this kind of key.');
  }
  if (typeof doc.nonce !== 'string' || typeof doc.ct !== 'string') {
    throw new Error('The synced data is damaged.');
  }
  try {
    const pt = xchacha20poly1305(key, base64.decode(doc.nonce)).decrypt(base64.decode(doc.ct));
    return bytesToUtf8(pt);
  } catch {
    throw new Error('Wrong sync password, or the synced data is damaged.');
  }
}

// ─── Sync state + merge ──────────────────────────────────────────────────────

export interface SyncVault {
  /** The wallet id — stable across devices so edits line up. */
  id: string;
  label: string;
  icon?: string;
  entries: ManualEntry[];
  /** Entry ids DELETED from this vault, with deletion stamps — so removing
   *  an entry on one phone doesn't resurrect from the other. */
  deletedEntries?: SyncTombstone[];
  /** Unix ms of the last edit to this vault (rename, entry change). */
  updatedAt: number;
}

export interface SyncTombstone {
  id: string;
  /** Unix ms of the deletion. */
  at: number;
}

export interface SyncState {
  vaults: SyncVault[];
  tombstones: SyncTombstone[];
}

/** The payload inside the envelope. */
export function serializeSyncState(state: SyncState): string {
  return JSON.stringify({ v: 1, ...state });
}

export function parseSyncState(json: string): SyncState {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new Error('The synced data is damaged.');
  }
  const d = doc as Partial<SyncState> & { v?: number };
  if (d.v !== 1 || !Array.isArray(d.vaults)) {
    throw new Error('The synced data is damaged.');
  }
  return {
    vaults: d.vaults.filter(isSyncVault),
    tombstones: Array.isArray(d.tombstones) ? d.tombstones.filter(isTombstone) : [],
  };
}

/** Structural check on one vault record (the shared-portfolio blob carries
 *  exactly one of these, so the check is shared). */
export function isSyncVault(v: unknown): v is SyncVault {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Partial<SyncVault>;
  return (
    typeof x.id === 'string' &&
    typeof x.label === 'string' &&
    Array.isArray(x.entries) &&
    typeof x.updatedAt === 'number'
  );
}

function isTombstone(v: unknown): v is SyncTombstone {
  if (typeof v !== 'object' || v === null) return false;
  const x = v as Partial<SyncTombstone>;
  return typeof x.id === 'string' && typeof x.at === 'number';
}

export interface MergeResult {
  merged: SyncState;
  /** True when `merged` differs from the LOCAL input — the caller must apply
   *  it to local storage. */
  localChanged: boolean;
  /** True when `merged` differs from the REMOTE input — the caller must push. */
  remoteChanged: boolean;
}

/** An entry's own edit stamp; entries from before the field read as created. */
function entryStamp(e: ManualEntry): number {
  return e.updatedAt ?? e.createdAt;
}

/**
 * Merge two copies of ONE vault. Label/icon follow the newer VAULT stamp;
 * entries merge PER ENTRY (LWW on the entry's own stamp; union otherwise;
 * per-entry tombstones make deletions stick). A vault-level action like a
 * rename can therefore never take the other phone's entries with it — the
 * failure the 2026-08-26 adversarial review proved against whole-vault LWW.
 */
export function mergeVault(a: SyncVault, b: SyncVault): SyncVault {
  const newer = a.updatedAt >= b.updatedAt ? a : b;

  const entryTombs = new Map<string, number>();
  for (const t of [...(a.deletedEntries ?? []), ...(b.deletedEntries ?? [])]) {
    entryTombs.set(t.id, Math.max(entryTombs.get(t.id) ?? 0, t.at));
  }
  const byId = new Map<string, ManualEntry>();
  for (const e of [...a.entries, ...b.entries]) {
    const existing = byId.get(e.id);
    if (existing == null || entryStamp(e) > entryStamp(existing)) byId.set(e.id, e);
  }
  for (const [id, at] of entryTombs) {
    const e = byId.get(id);
    if (e != null && entryStamp(e) <= at) byId.delete(id);
    if (e != null && entryStamp(e) > at) entryTombs.delete(id); // the edit won
  }

  return {
    id: newer.id,
    label: newer.label,
    icon: newer.icon,
    entries: [...byId.values()].sort(
      (x, y) => x.date - y.date || x.createdAt - y.createdAt || x.id.localeCompare(y.id),
    ),
    deletedEntries: [...entryTombs.entries()]
      .map(([id, at]) => ({ id, at }))
      .sort((x, y) => x.id.localeCompare(y.id)),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}

/**
 * Merge two sync states. Vaults merge per-vault (see mergeVault); a vault
 * tombstone deletes a vault unless it was edited AFTER the deletion (an edit
 * on phone B after phone A deleted = the edit wins, because losing typed-in
 * data is worse than resurrecting a vault someone can delete again).
 */
export function mergeSyncStates(local: SyncState, remote: SyncState): MergeResult {
  const tombs = new Map<string, number>();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    tombs.set(t.id, Math.max(tombs.get(t.id) ?? 0, t.at));
  }

  const byId = new Map<string, SyncVault>();
  for (const v of [...local.vaults, ...remote.vaults]) {
    const existing = byId.get(v.id);
    byId.set(v.id, existing == null ? v : mergeVault(existing, v));
  }
  for (const [id, at] of tombs) {
    const v = byId.get(id);
    if (v != null && v.updatedAt <= at) byId.delete(id);
    if (v != null && v.updatedAt > at) tombs.delete(id); // the edit won — drop the tombstone
  }

  const merged: SyncState = {
    vaults: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    tombstones: [...tombs.entries()]
      .map(([id, at]) => ({ id, at }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return {
    merged,
    localChanged: !sameState(normalizeState(merged), normalizeState(local)),
    remoteChanged: !sameState(normalizeState(merged), normalizeState(remote)),
  };
}

/** Canonical shape for comparison: fixed key order (JSON.stringify is
 *  key-order sensitive) and sorted collections. */
function normalizeState(s: SyncState): SyncState {
  return {
    vaults: [...s.vaults]
      .map((v) => ({
        id: v.id,
        label: v.label,
        icon: v.icon,
        entries: [...v.entries].sort(
          (x, y) => x.date - y.date || x.createdAt - y.createdAt || x.id.localeCompare(y.id),
        ),
        deletedEntries: [...(v.deletedEntries ?? [])].sort((x, y) => x.id.localeCompare(y.id)),
        updatedAt: v.updatedAt,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    tombstones: [...s.tombstones].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function sameState(a: SyncState, b: SyncState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The LWW stamp the server compares (its `client_updated_at`) — rounded up
 *  to the minute so the plaintext reveals edit ORDER, not the exact moment
 *  the owner touched their portfolio (a metadata leak, decided 2026-08-26). */
export function stateStamp(state: SyncState): number {
  const exact = Math.max(
    1,
    ...state.vaults.map((v) => v.updatedAt),
    ...state.tombstones.map((t) => t.at),
  );
  return Math.ceil(exact / 60_000) * 60_000;
}

/** Pad the payload to a size bucket so the ciphertext length reveals the
 *  scale of the portfolio only coarsely (JSON.parse ignores the padding). */
export function padPayload(json: string, bucket = 4096): string {
  const target = Math.max(bucket, Math.ceil(json.length / bucket) * bucket);
  return json + ' '.repeat(target - json.length);
}
