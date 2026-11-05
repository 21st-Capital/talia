/**
 * Heir invites: client service (decided 2026-07-24 design, built 2026-07-26).
 *
 * OWNER side: build the sealed blobs (crypto/envelope.ts), store them on the
 * blind backend, compose the invite email from the owner's own mail app. The
 * code never touches our server.
 *
 * HEIR side: claim by code (lookup token derived on-device), open the sealed
 * card, later open the descriptor with the code + their hardware key.
 *
 * Local records:
 *   - owner: which invites this device created (for release_at upkeep).
 *   - heir: claimed invites + the CODE. The code lives in the KEYCHAIN — it
 *     is half of the descriptor's decryption key and may sit on the device
 *     for months in strict mode. (AsyncStorage is excluded from backups, but a
 *     forensic copy of the phone reads it; the Keychain item does not travel.)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteSecret, getSecret, setSecret } from './keychain';
import { sealedGetItem, sealedSetItem } from '../wallet/sealedStore';

import { COMPANY_API, authHeaders, loadSession } from './companyAuth';
import type { CompanySession } from './companyAuth';
import { lookupHash, lookupToken, openCard } from '../crypto/envelope';
// Concrete modules, not the wallet barrel — the barrel exports WalletProvider,
// which imports THIS file (cycle).
import { earliestHeirUnlockIso } from '../wallet/heirRelease';
import type { Utxo, WalletTx } from '../bitcoin/engine/types';

// react-native-get-random-values (src/polyfills.ts) provides this on device.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

const BASE = `${COMPANY_API}/api/vaults/heir-invites/`;

const OWNER_KEY = 'talia.heirInvites.owner.v1';
const HEIR_KEY = 'talia.heirInvites.claimed.v1';
const CODE_SERVICE = 'talia.heirInvite.code';

async function jsonOrEmpty(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Same convention as rescue/cosign/billing: 401 gets the re-login message. */
function requireAuthed(res: Response): void {
  if (res.status === 401) {
    throw new Error('Your session has expired. Please log in again.');
  }
}

function fail(body: Record<string, unknown>, fallback: string): never {
  throw new Error((body.message as string) || fallback);
}

/** The code of a talia://invite/CODE link, validated (./deepLinks):
 *  null for any other link or a malformed code. */
export { inviteCodeFromUrl } from './deepLinks';

// ─── Owner side ──────────────────────────────────────────────────────────────

export interface OwnerInviteRecord {
  inviteId: string;
  walletId: string;
  /** RANDOM UUID grouping this vault's invites server-side. Never derived
   *  from the descriptor — it must not correlate to anything on-chain. */
  vaultLocalId: string;
  heirFingerprint: string;
  heirName: string;
  /** The heir's wallet.heirs id — the primary matcher for keyless heirs now
   *  that email is optional (decided 2026-08-27). Absent on older records. */
  heirId?: string;
  /** Matches OLDER keyless records to heirs (fingerprint '', no heirId). */
  heirEmail?: string;
  /** Account that created the invite (lowercase). Release-date pushes only
   *  make sense under THIS account — the server rejects everyone else
   *  (silently, as updated: 0), which cost a test day (2026-07-26). */
  ownerEmail?: string;
  mode: 'strict' | 'full';
  createdAt: number;
  /** Server-side claim deadline (ISO) — pending invites expire after it. */
  expiresAt?: string;
}

// Both invite lists are sealed at rest (./wallet/sealedStore, decided 2026-09-26):
// they name the heirs and carry their emails and key fingerprints.

/** The owner's list; THROWS when it cannot be read, so a writer never saves
 *  a shortened list over the real one. */
async function readOwnerInvites(): Promise<OwnerInviteRecord[]> {
  const raw = await sealedGetItem(OWNER_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OwnerInviteRecord[];
  } catch {
    return [];
  }
}

export async function loadOwnerInvites(): Promise<OwnerInviteRecord[]> {
  try {
    return await readOwnerInvites();
  } catch {
    return [];
  }
}

async function saveOwnerInvites(list: OwnerInviteRecord[]): Promise<void> {
  await sealedSetItem(OWNER_KEY, JSON.stringify(list));
}

/** One stable random vault-local id per wallet, created on first invite. */
export async function vaultLocalIdFor(walletId: string): Promise<string> {
  const key = `talia.heirInvites.vaultLocalId.${walletId}`;
  const existing = await AsyncStorage.getItem(key);
  if (existing) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // UUIDv4 shape
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  await AsyncStorage.setItem(key, id);
  return id;
}

export async function createInvite(
  session: CompanySession,
  input: {
    code: string;
    walletId: string;
    vaultLocalId: string;
    heirName: string;
    /** Optional since 2026-08-27: the owner may pass the code on
     *  personally without ever recording an email. */
    heirEmail?: string;
    heirFingerprint: string;
    /** wallet.heirs id of this heir, when the wallet records one. */
    heirId?: string;
    mode: 'strict' | 'full';
    cardCiphertextB64: string;
    descriptorCiphertextB64: string;
    /** Strict: current estimate of the earliest heir unlock (ISO), if known. */
    releaseAtIso: string | null;
  },
): Promise<{ inviteId: string }> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lookup_hash: lookupHash(input.code),
      vault_local_id: input.vaultLocalId,
      heir_label: input.heirName,
      // Omitted when the owner recorded no email — the server field is
      // optional; sending nothing beats sending an empty string.
      ...(input.heirEmail?.trim() ? { heir_email: input.heirEmail.trim() } : {}),
      mode: input.mode,
      card_ciphertext: input.cardCiphertextB64,
      descriptor_ciphertext: input.descriptorCiphertextB64,
      release_at: input.releaseAtIso,
    }),
  });
  requireAuthed(res);
  const body = await jsonOrEmpty(res);
  if (!res.ok) fail(body, 'Could not store the invite.');

  const record: OwnerInviteRecord = {
    inviteId: String(body.id),
    walletId: input.walletId,
    vaultLocalId: input.vaultLocalId,
    heirFingerprint: input.heirFingerprint.toLowerCase(),
    heirName: input.heirName,
    heirId: input.heirId,
    heirEmail: input.heirEmail?.trim().toLowerCase() || undefined,
    ownerEmail: session.email?.toLowerCase(),
    mode: input.mode,
    createdAt: Date.now(),
    expiresAt: typeof body.expires_at === 'string' ? body.expires_at : undefined,
  };
  await saveOwnerInvites([...(await readOwnerInvites()), record]);
  return { inviteId: record.inviteId };
}

/** Strict-mode upkeep: push this vault's earliest-heir-unlock estimate.
 *  Returns how many invites the server actually updated — 0 with a live
 *  session means the session doesn't own them (never treat that as done). */
export async function pushReleaseAt(
  session: CompanySession,
  vaultLocalId: string,
  releaseAtIso: string | null,
): Promise<{ ok: boolean; updated: number }> {
  try {
    const res = await fetch(`${BASE}release-at/`, {
      method: 'PATCH',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: JSON.stringify({ vault_local_id: vaultLocalId, release_at: releaseAtIso }),
    });
    if (!res.ok) return { ok: false, updated: 0 };
    const body = await jsonOrEmpty(res);
    return { ok: true, updated: Number(body.updated ?? 0) || 0 };
  } catch {
    // best-effort — the next sync pushes again
    return { ok: false, updated: 0 };
  }
}

/** What the release-date computation needs from a freshly-synced engine. */
interface SyncedEngineView {
  listUtxos(): Promise<Utxo[]>;
  listTransactions(): Promise<WalletTx[]>;
  getTipHeight(): number | undefined;
}

/**
 * The vault-wide strict-mode release date (the server sees ONE date, decided
 * 2026-07-24). Null = fail closed (the server never releases on null).
 * Engine errors THROW so a transient failure never clobbers a good date.
 */
export async function computeVaultReleaseAtIso(
  wallet: { descriptor: string; heirs?: Array<{ fingerprint?: string }> },
  engine: SyncedEngineView,
): Promise<string | null> {
  const heirFingerprints = (wallet.heirs ?? [])
    .map((h) => h.fingerprint ?? '')
    .filter(Boolean);
  const [utxos, txs] = await Promise.all([engine.listUtxos(), engine.listTransactions()]);
  return earliestHeirUnlockIso({
    descriptor: wallet.descriptor,
    heirFingerprints,
    utxos,
    txs,
    tipHeight: engine.getTipHeight(),
    nowMs: Date.now(),
  });
}

/**
 * Sync hook: refresh the server's release date for this vault's STRICT
 * invites. Cheap no-op for the common case (no invites / not logged in);
 * never throws — sync must not care.
 */
export async function maybePushReleaseAt(
  wallet: { id: string; descriptor: string; heirs?: Array<{ fingerprint?: string }> },
  engine: SyncedEngineView,
): Promise<void> {
  try {
    const session = await loadSession();
    if (!session) return;
    const email = session.email?.toLowerCase();
    // Only the CREATING account's pushes can land — the server scopes the
    // PATCH to request.user. A record from another account (same-phone
    // owner/heir switching, found 2026-07-26) is skipped, not silently no-oped.
    const strict = (await loadOwnerInvites()).filter(
      (r) =>
        r.walletId === wallet.id &&
        r.mode === 'strict' &&
        (!r.ownerEmail || !email || r.ownerEmail === email),
    );
    if (strict.length === 0) return;
    const releaseAtIso = await computeVaultReleaseAtIso(wallet, engine);
    await pushReleaseAt(session, strict[0].vaultLocalId, releaseAtIso);
  } catch {
    // best-effort — the next sync tries again
  }
}

/** The owner's view of one server-side invite (GET mine/). */
export interface MyInvite {
  id: string;
  vaultLocalId: string;
  heirLabel: string;
  heirEmail: string;
  mode: 'strict' | 'full';
  status: 'pending' | 'claimed' | 'revoked' | 'expired';
  releaseAt: string | null;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
  /** Claimed from an account whose address is not the one invited. Allowed by
   *  design (an invite is claimed by CODE, not by address), but the owner is
   *  the only person who can tell an heir who changed mailbox from someone who
   *  got hold of the code, so they are shown it and can revoke (decided 2026-08-30). */
  emailMismatch: boolean;
  /** The address that actually claimed it. Empty unless there is a mismatch. */
  claimedByEmail: string;
}

/** The server's truth about this owner's invites — statuses, claims, and the
 *  180-day expiry are only visible here, never in the local records. */
export async function fetchMyInvites(session: CompanySession): Promise<MyInvite[]> {
  const res = await fetch(`${BASE}mine/`, { headers: authHeaders(session) });
  requireAuthed(res);
  if (!res.ok) throw new Error('Could not load your invites.');
  const body = (await res.json()) as Record<string, unknown>[];
  return body.map((b) => ({
    id: String(b.id),
    vaultLocalId: String(b.vault_local_id ?? ''),
    heirLabel: String(b.heir_label ?? ''),
    heirEmail: String(b.heir_email ?? ''),
    mode: (b.mode as 'strict' | 'full') ?? 'strict',
    status: (b.status as MyInvite['status']) ?? 'pending',
    releaseAt: (b.release_at as string) ?? null,
    createdAt: String(b.created_at ?? ''),
    expiresAt: String(b.expires_at ?? ''),
    claimedAt: (b.claimed_at as string) ?? null,
    emailMismatch: b.email_mismatch === true,
    claimedByEmail: String(b.claimed_by_email ?? ''),
  }));
}

export async function revokeInvite(session: CompanySession, inviteId: string): Promise<void> {
  const res = await fetch(`${BASE}${inviteId}/revoke/`, {
    method: 'POST',
    headers: authHeaders(session),
  });
  requireAuthed(res);
  if (!res.ok) fail(await jsonOrEmpty(res), 'Could not revoke the invite.');
  await saveOwnerInvites((await readOwnerInvites()).filter((r) => r.inviteId !== inviteId));
}

// ─── Heir side ───────────────────────────────────────────────────────────────

export interface ClaimResult {
  id: string;
  status: string;
  mode: 'strict' | 'full';
  cardCiphertext: string;
  releaseAt: string | null;
  descriptorReleased: boolean;
  descriptorCiphertext: string | null;
}

function toClaimResult(body: Record<string, unknown>): ClaimResult {
  return {
    id: String(body.id),
    status: String(body.status),
    mode: (body.mode as 'strict' | 'full') ?? 'strict',
    cardCiphertext: String(body.card_ciphertext ?? ''),
    releaseAt: (body.release_at as string) ?? null,
    descriptorReleased: Boolean(body.descriptor_released),
    descriptorCiphertext: (body.descriptor_ciphertext as string) ?? null,
  };
}

/** Present the code-derived token. The server never sees the code. */
export async function claimInvite(session: CompanySession, code: string): Promise<ClaimResult> {
  const res = await fetch(`${BASE}claim/`, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ lookup_token: lookupToken(code) }),
  });
  requireAuthed(res);
  const body = await jsonOrEmpty(res);
  if (res.status === 410) {
    throw new Error(
      'This invite is no longer available. It may have been revoked, expired, or already used. Please contact the person who invited you.',
    );
  }
  if (!res.ok) fail(body, 'Could not claim the invite.');
  return toClaimResult(body);
}

/** Strict-mode poll: the heir's claimed invites, descriptor when released. */
export async function fetchClaimedInvites(session: CompanySession): Promise<ClaimResult[]> {
  const res = await fetch(`${BASE}claimed/`, { headers: authHeaders(session) });
  requireAuthed(res);
  if (!res.ok) throw new Error('Could not check your invites.');
  const body = (await res.json()) as Record<string, unknown>[];
  return body.map(toClaimResult);
}

// ─── Heir-side local records ────────────────────────────────────────────────

export interface ClaimedInviteRecord {
  inviteId: string;
  /** Account that claimed it (lowercase). A phone can host several accounts
   *  in turn — an owner must never see the invites an heir claimed here
   *  (decided 2026-07-26). Absent on records from before this field existed;
   *  `reconcileClaimedInvites` stamps them from the server's own list. */
  claimedByEmail?: string;
  /** 'key' = activation scans the heir's hardware key; 'code' = keyless,
   *  the stored code alone opens the vault. */
  access: 'key' | 'code';
  /** Decrypted card fields the sealed-vault tile shows. */
  vaultLabel: string;
  heirName: string;
  /** Absent on keyless invites. */
  expectedFingerprint?: string;
  heirOriginPath?: string;
  network: string;
  mode: 'strict' | 'full';
  /** Absent on keyless invites. */
  innerSaltB64?: string;
  cardCiphertext: string;
  releaseAt: string | null;
  claimedAt: number;
}

/** The sealed cards THIS account may see. Records claimed by another
 *  account on the same phone stay hidden (never deleted — that account may
 *  log back in). Unstamped legacy records are hidden too; the reconcile
 *  below stamps the genuine ones from the server's list. */
export async function loadVisibleClaimedInvites(
  email: string | undefined | null,
): Promise<ClaimedInviteRecord[]> {
  const e = email?.toLowerCase();
  if (!e) return [];
  return (await loadClaimedInvites()).filter((r) => r.claimedByEmail === e);
}

/**
 * Make the local sealed cards agree with the server for THIS account:
 *   - server invite missing locally → rebuild it (the card ciphertext is on
 *     the server, the code is in this device's Keychain) — self-healing
 *     after the native-storage loss found in a phone test on 2026-07-26;
 *   - local record the server still lists → stamp it with this account
 *     (migrates pre-scoping records);
 *   - local record of THIS account the server no longer lists → drop it
 *     (revoked, or activated on another device).
 * Records belonging to other accounts are never touched.
 */
export async function reconcileClaimedInvites(
  session: CompanySession,
): Promise<ClaimedInviteRecord[]> {
  const email = session.email?.toLowerCase();
  const server = await fetchClaimedInvites(session);
  const serverIds = new Set(server.map((s) => s.id));
  const local = await loadClaimedInvites();

  for (const s of server) {
    const existing = local.find((r) => r.inviteId === s.id);
    if (existing) {
      // The release date MOVES: refreshing the coins restarts the heir
      // timelock, and the owner's app pushes the later date. A stale local
      // copy made the home tile claim "ready to open" long after the
      // countdown had restarted (decided 2026-07-26): follow the server.
      if (existing.claimedByEmail !== email || existing.releaseAt !== s.releaseAt) {
        await saveClaimedInvite({ ...existing, claimedByEmail: email, releaseAt: s.releaseAt });
      }
      continue;
    }
    try {
      const code = await loadInviteCode(s.id);
      // No code = already activated here, or claimed on another device.
      if (!code) continue;
      const card = openCard(code, s.cardCiphertext);
      await saveClaimedInvite({
        inviteId: s.id,
        claimedByEmail: email,
        access: card.access === 'code' ? 'code' : 'key',
        vaultLabel: card.vaultLabel,
        heirName: card.heirName,
        expectedFingerprint: card.expectedFingerprint?.toLowerCase(),
        heirOriginPath: card.heirOriginPath,
        network: card.network,
        mode: card.mode,
        innerSaltB64: card.innerSaltB64,
        cardCiphertext: s.cardCiphertext,
        releaseAt: s.releaseAt,
        claimedAt: Date.now(),
      });
    } catch {
      // one undecryptable invite must not break the rest
    }
  }

  for (const r of local) {
    if (r.claimedByEmail === email && !serverIds.has(r.inviteId)) {
      await removeClaimedInvite(r.inviteId);
    }
  }
  return loadVisibleClaimedInvites(email);
}

let lastReconcileAt = 0;

/** Throttled reconcile for hot paths (home focus, app foreground): keeps the
 *  sealed tiles honest without a request per navigation. Returns null when
 *  it skipped — callers keep what they have. */
export async function maybeReconcileClaimedInvites(
  minIntervalMs = 30_000,
): Promise<ClaimedInviteRecord[] | null> {
  if (Date.now() - lastReconcileAt < minIntervalMs) return null;
  try {
    const session = await loadSession();
    if (!session) return null;
    lastReconcileAt = Date.now();
    return await reconcileClaimedInvites(session);
  } catch {
    return null; // offline — local cards stay as they are
  }
}

async function readClaimedInvites(): Promise<ClaimedInviteRecord[]> {
  const raw = await sealedGetItem(HEIR_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ClaimedInviteRecord[];
  } catch {
    return [];
  }
}

export async function loadClaimedInvites(): Promise<ClaimedInviteRecord[]> {
  try {
    return await readClaimedInvites();
  } catch {
    return [];
  }
}

export async function saveClaimedInvite(rec: ClaimedInviteRecord): Promise<void> {
  const rest = (await readClaimedInvites()).filter((r) => r.inviteId !== rec.inviteId);
  await sealedSetItem(HEIR_KEY, JSON.stringify([...rest, rec]));
}

export async function removeClaimedInvite(inviteId: string): Promise<void> {
  await sealedSetItem(
    HEIR_KEY,
    JSON.stringify((await readClaimedInvites()).filter((r) => r.inviteId !== inviteId)),
  );
  await deleteSecret(`${CODE_SERVICE}.${inviteId}`);
}

/** The invite CODE — Keychain, not AsyncStorage: it is half the decryption
 *  key and may live on the device for months in strict mode. */
export async function storeInviteCode(inviteId: string, code: string): Promise<void> {
  await setSecret(`${CODE_SERVICE}.${inviteId}`, 'invite-code', code);
}

export async function loadInviteCode(inviteId: string): Promise<string | null> {
  return getSecret(`${CODE_SERVICE}.${inviteId}`);
}
