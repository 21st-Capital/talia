/**
 * Shared portfolios, the I/O half (decided 2026-09-12). The crypto and the merge
 * live in crypto/sharedPortfolio.ts and crypto/vaultSync.ts (pure, tested);
 * this module talks to the blind backend and the Keychain.
 *
 *   /api/vaults/shared-portfolios/   one opaque blob per SHARE, versioned;
 *                                    members, invites; compare-and-swap PUT.
 *
 * The portfolio key K_p lives in the Keychain under one service per share
 * (WHEN_UNLOCKED_THIS_DEVICE_ONLY, like an exchange key): it is what opens
 * every participant's copy, so it never goes to AsyncStorage and never to
 * the server. A phone without the key holds an ordinary portfolio.
 *
 * The per-share sync loop (`runSharedSync`) is: GET blob -> mergeVault(local,
 * remote) -> save ENTRIES before META -> PUT with base_version -> on 409 merge
 * with the winner and retry (three attempts at most). It needs a session and
 * the key, and NOT account sync being enabled: a member who never turned
 * account sync on still syncs the portfolios shared with them. WalletProvider
 * owns WHEN it runs (after the account loop, in the same single flight).
 */
import { deleteSecret, getSecret, setSecret } from './keychain';
import { base64 } from '@scure/base';

import { COMPANY_API, authHeaders, loadSession } from './companyAuth';
import type { CompanySession } from './companyAuth';
import { replaceEntryTombstones, entryTombstonesFor, recordEntryTombstones } from './virtualVaultSync';
import { sharedSyncPlan,
  openPortfolioCard,
  openSharedVault,
  portfolioLookupHash,
  portfolioLookupToken,
  sameSharedVault,
  sealPortfolioCard,
  sealSharedVault,
  sharedStamp,
} from '../crypto/sharedPortfolio';
import type { OpenedPortfolioCard } from '../crypto/sharedPortfolio';
import { mergeVault } from '../crypto/vaultSync';
import type { SyncVault } from '../crypto/vaultSync';
import { loadManualEntries, saveManualEntries } from '../wallet/manualEntries';
import { isSharedViewer } from '../wallet/sharedAccess';
import type { SharedPortfolio, WalletMeta } from '../wallet/types';

const BASE = `${COMPANY_API}/api/vaults/shared-portfolios/`;
const KEY_SERVICE = 'talia.sharedPortfolio.key';

const serviceFor = (shareId: string): string => `${KEY_SERVICE}.${shareId}`;

// ─── The key ─────────────────────────────────────────────────────────────────

export async function storeShareKey(shareId: string, key: Uint8Array): Promise<void> {
  await setSecret(serviceFor(shareId), 'share-key', base64.encode(key));
}

export async function loadShareKey(shareId: string): Promise<Uint8Array | null> {
  try {
    const item = await getSecret(serviceFor(shareId));
    if (!item) return null;
    const key = base64.decode(item);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

export async function removeShareKey(shareId: string): Promise<void> {
  await deleteSecret(serviceFor(shareId));
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function jsonOrEmpty(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Same convention as the rest of the services: 401 = log in again. */
function requireAuthed(res: Response): void {
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
}

function fail(body: Record<string, unknown>, fallback: string): never {
  const msg = (body.detail as string) || (body.message as string) || fallback;
  throw new Error(msg);
}

const jsonHeaders = (session: CompanySession): Record<string, string> => ({
  ...authHeaders(session),
  'Content-Type': 'application/json',
});

// ─── Shares ──────────────────────────────────────────────────────────────────

/** Owner: create the share with the portfolio's current state as version 1. */
export async function createShare(
  session: CompanySession,
  input: { shareId: string; key: Uint8Array; vault: SyncVault },
): Promise<{ shareId: string; version: number }> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: jsonHeaders(session),
    body: JSON.stringify({
      share_id: input.shareId,
      blob: sealSharedVault(input.key, input.vault),
      client_updated_at: sharedStamp(input.vault),
    }),
  });
  requireAuthed(res);
  const body = await jsonOrEmpty(res);
  if (res.status === 409) throw new Error('This share id is already taken. Please try again.');
  if (res.status === 413) throw new Error('This portfolio is too large to share.');
  if (res.status === 429) throw new Error('You have reached the limit of shared portfolios for your account.');
  if (!res.ok) fail(body, 'Could not start sharing.');
  return { shareId: String(body.share_id ?? input.shareId), version: Number(body.version ?? 1) || 1 };
}

export interface ShareMember {
  userId: string;
  email: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface ShareInvite {
  id: string;
  inviteeLabel: string;
  inviteeEmail: string;
  status: 'pending' | 'claimed' | 'revoked' | 'expired';
  expiresAt: string;
  claimedAt: string | null;
  /** Claimed from an account whose address is not the one invited. Allowed
   *  (an invite is claimed by CODE), but only the owner can tell a member
   *  who changed mailbox from someone who got hold of the code. */
  emailMismatch: boolean;
  claimedByEmail: string;
}

export interface MyShare {
  shareId: string;
  role: 'owner' | 'member';
  version: number;
  updatedAt: string;
  members: ShareMember[];
  /** Owner only; empty for a member. */
  invites: ShareInvite[];
}

/** Every share this account is in, with members (and, for the owner, invites). */
export async function fetchMyShares(session: CompanySession): Promise<MyShare[]> {
  const res = await fetch(`${BASE}mine/`, { headers: authHeaders(session) });
  requireAuthed(res);
  if (!res.ok) throw new Error('Could not load your shared portfolios.');
  const body = (await res.json()) as Record<string, unknown>[];
  return body.map((b) => ({
    shareId: String(b.share_id),
    role: b.role === 'owner' ? 'owner' : 'member',
    version: Number(b.version ?? 0) || 0,
    updatedAt: String(b.updated_at ?? ''),
    members: (Array.isArray(b.members) ? (b.members as Record<string, unknown>[]) : []).map((m) => ({
      userId: String(m.user_id),
      email: String(m.email ?? ''),
      role: m.role === 'owner' ? 'owner' : 'member',
      joinedAt: String(m.joined_at ?? ''),
    })),
    invites: (Array.isArray(b.invites) ? (b.invites as Record<string, unknown>[]) : []).map((i) => ({
      id: String(i.id),
      inviteeLabel: String(i.invitee_label ?? ''),
      inviteeEmail: String(i.invitee_email ?? ''),
      status: (i.status as ShareInvite['status']) ?? 'pending',
      expiresAt: String(i.expires_at ?? ''),
      claimedAt: (i.claimed_at as string) ?? null,
      emailMismatch: i.email_mismatch === true,
      claimedByEmail: String(i.claimed_by_email ?? ''),
    })),
  }));
}

/** Owner: seal the card under a fresh code and store it. The code never
 *  reaches the server; it stores the lookup hash and the ciphertext. */
export async function createShareInvite(
  session: CompanySession,
  input: {
    shareId: string;
    code: string;
    key: Uint8Array;
    portfolioId: string;
    label: string;
    icon?: string;
    ownerName?: string;
    inviteeLabel: string;
    inviteeEmail?: string;
  },
): Promise<{ inviteId: string; expiresAt: string }> {
  const cardCiphertext = sealPortfolioCard(input.code, {
    shareId: input.shareId,
    portfolioId: input.portfolioId,
    label: input.label,
    icon: input.icon,
    ownerName: input.ownerName,
    key: input.key,
  });
  const res = await fetch(`${BASE}${input.shareId}/invites/`, {
    method: 'POST',
    headers: jsonHeaders(session),
    body: JSON.stringify({
      lookup_hash: portfolioLookupHash(input.code),
      card_ciphertext: cardCiphertext,
      invitee_label: input.inviteeLabel,
      ...(input.inviteeEmail?.trim() ? { invitee_email: input.inviteeEmail.trim() } : {}),
    }),
  });
  requireAuthed(res);
  const body = await jsonOrEmpty(res);
  if (res.status === 409) throw new Error('That code is already in use. Please create the invite again.');
  if (res.status === 429) {
    throw new Error('This portfolio has reached its limit of people and pending invites.');
  }
  if (!res.ok) fail(body, 'Could not create the invite.');
  return { inviteId: String(body.id), expiresAt: String(body.expires_at ?? '') };
}

export async function revokeShareInvite(
  session: CompanySession,
  shareId: string,
  inviteId: string,
): Promise<void> {
  const res = await fetch(`${BASE}${shareId}/invites/${inviteId}/revoke/`, {
    method: 'POST',
    headers: authHeaders(session),
  });
  requireAuthed(res);
  if (!res.ok) fail(await jsonOrEmpty(res), 'Could not revoke the invite.');
}

export interface ClaimedShare {
  inviteId: string;
  shareId: string;
  role: 'owner' | 'member';
  card: OpenedPortfolioCard;
  /** The share's current state, opened with the card's key. */
  vault: SyncVault;
  version: number;
}

/** Claimant: present the code-derived token, open the card with the code,
 *  open the blob with the card's key. Unknown, revoked, expired and taken
 *  invites all answer one plain message, on purpose. */
export async function claimShareInvite(session: CompanySession, code: string): Promise<ClaimedShare> {
  const res = await fetch(`${BASE}invites/claim/`, {
    method: 'POST',
    headers: jsonHeaders(session),
    body: JSON.stringify({ lookup_token: portfolioLookupToken(code) }),
  });
  requireAuthed(res);
  const body = await jsonOrEmpty(res);
  if (res.status === 410 || res.status === 404) {
    throw new Error(
      'This invite can no longer be used. It may have been revoked, expired or already used. Ask the person who shared the portfolio for a new one.',
    );
  }
  if (!res.ok) fail(body, 'Could not join the portfolio.');
  const card = openPortfolioCard(code, String(body.card_ciphertext ?? ''));
  if (typeof body.blob !== 'string') throw new Error('The shared portfolio data is missing.');
  const vault = openSharedVault(card.key, body.blob);
  return {
    inviteId: String(body.invite_id),
    shareId: String(body.share_id ?? card.shareId),
    role: body.role === 'owner' ? 'owner' : 'member',
    card,
    vault,
    version: Number(body.version ?? 1) || 1,
  };
}

export async function removeMember(session: CompanySession, shareId: string, userId: string): Promise<void> {
  const res = await fetch(`${BASE}${shareId}/members/${userId}/remove/`, {
    method: 'POST',
    headers: authHeaders(session),
  });
  requireAuthed(res);
  if (!res.ok) fail(await jsonOrEmpty(res), 'Could not remove this person.');
}

export async function leaveShare(session: CompanySession, shareId: string): Promise<void> {
  const res = await fetch(`${BASE}${shareId}/leave/`, { method: 'POST', headers: authHeaders(session) });
  requireAuthed(res);
  // Gone already (removed by the owner, or the owner stopped sharing) is
  // the outcome the member wanted.
  if (res.status === 404) return;
  if (res.status === 409) throw new Error('The owner of a shared portfolio cannot leave it. Stop sharing instead.');
  if (!res.ok) fail(await jsonOrEmpty(res), 'Could not leave the portfolio.');
}

export async function deleteShare(session: CompanySession, shareId: string): Promise<void> {
  const res = await fetch(`${BASE}${shareId}/`, { method: 'DELETE', headers: authHeaders(session) });
  requireAuthed(res);
  if (res.status === 404) return; // already gone
  if (!res.ok) fail(await jsonOrEmpty(res), 'Could not stop sharing.');
}

// ─── The per-share sync loop ─────────────────────────────────────────────────

export interface SharedSyncApply {
  /** Update label/icon/stamp. The provider SKIPS it when its CURRENT stamp
   *  is already >= the incoming one (an edit landed mid-sync). */
  updateMeta: (v: { id: string; label: string; icon?: string; updatedAt: number }) => Promise<void>;
  /** Record version / lastSyncAt / lastError on the wallet's share. */
  updateShare: (id: string, patch: Partial<SharedPortfolio>) => Promise<void>;
  /** The share is gone for this phone (the blob answered 404/410). */
  ended: (id: string, how: NonNullable<SharedPortfolio['ended']>) => Promise<void>;
}

export type SharedSyncOutcome =
  | { kind: 'synced'; pulled: boolean; pushed: boolean; version: number }
  | { kind: 'skipped'; reason: 'inactive' | 'loggedOut' | 'noKey' }
  | { kind: 'ended' }
  | { kind: 'failed'; message: string };

const MAX_PUSH_ATTEMPTS = 3;

interface RemoteBlob {
  vault: SyncVault;
  version: number;
}

async function fetchRemote(
  session: CompanySession,
  shareId: string,
  key: Uint8Array,
): Promise<RemoteBlob | 'gone'> {
  const res = await fetch(`${BASE}${shareId}/blob/`, { headers: authHeaders(session) });
  requireAuthed(res);
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) throw new Error(`The sync server answered ${res.status}.`);
  const body = (await res.json()) as { blob?: string; version?: number };
  if (typeof body.blob !== 'string') throw new Error('The shared portfolio data is missing.');
  return { vault: openSharedVault(key, body.blob), version: Number(body.version ?? 0) || 0 };
}

/** Compare-and-swap push. Returns the new version, or the winner on 409. */
async function pushRemote(
  session: CompanySession,
  shareId: string,
  key: Uint8Array,
  vault: SyncVault,
  baseVersion: number,
): Promise<{ ok: true; version: number } | { ok: false; winner: RemoteBlob } | 'gone'> {
  const res = await fetch(`${BASE}${shareId}/blob/`, {
    method: 'PUT',
    headers: jsonHeaders(session),
    body: JSON.stringify({
      blob: sealSharedVault(key, vault),
      base_version: baseVersion,
      client_updated_at: sharedStamp(vault),
    }),
  });
  requireAuthed(res);
  if (res.status === 404 || res.status === 410) return 'gone';
  if (res.status === 413) throw new Error('This portfolio has grown too large to share.');
  const body = (await jsonOrEmpty(res)) as { blob?: string; version?: number };
  if (res.status === 409) {
    if (typeof body.blob !== 'string') throw new Error('The shared portfolio data is missing.');
    return { ok: false, winner: { vault: openSharedVault(key, body.blob), version: Number(body.version ?? 0) || 0 } };
  }
  if (!res.ok) fail(body as Record<string, unknown>, `The sync server answered ${res.status}.`);
  return { ok: true, version: Number(body.version ?? baseVersion + 1) || baseVersion + 1 };
}

/**
 * Run one sync of one shared portfolio. The caller guarantees at most one
 * sync in flight per phone (WalletProvider's single flight, which also runs
 * the account loop, so the two never apply over each other).
 */
export async function runSharedSync(wallet: WalletMeta, apply: SharedSyncApply): Promise<SharedSyncOutcome> {
  const share = wallet.sharedPortfolio;
  if (!wallet.manual || !share || share.ended) return { kind: 'skipped', reason: 'inactive' };
  const session = await loadSession();
  if (!session) return { kind: 'skipped', reason: 'loggedOut' };
  const key = await loadShareKey(share.shareId);
  if (!key) return { kind: 'skipped', reason: 'noKey' };

  try {
    const local: SyncVault = {
      id: wallet.id,
      label: wallet.label,
      icon: wallet.icon,
      entries: await loadManualEntries(wallet.id),
      deletedEntries: await entryTombstonesFor(wallet.id),
      updatedAt: wallet.manualUpdatedAt ?? wallet.createdAt,
    };

    const remote = await fetchRemote(session, share.shareId, key);
    if (remote === 'gone') {
      await removeShareKey(share.shareId);
      await apply.ended(wallet.id, 'stopped');
      return { kind: 'ended' };
    }

    // A member reads: their copy MIRRORS the owner's, so a stray local entry
    // (or one added before view-only) cannot linger and show a balance the
    // owner never recorded (decided 2026-09-14).
    const viewer = isSharedViewer(wallet);
    const plan = sharedSyncPlan(viewer, local, remote.vault);
    let merged = plan.merged;
    let version = remote.version;
    // The blob names the OWNER's portfolio id, which is this wallet's id on
    // every phone; keep ours regardless so a stray id can never re-key it.
    merged = { ...merged, id: wallet.id };

    // Push merged -> remote when it differs; on 409 merge with the winner
    // and try again, a few times at most.
    let pushed = false;
    let needPush = plan.needPush;
    for (let attempt = 0; needPush; attempt += 1) {
      if (attempt >= MAX_PUSH_ATTEMPTS) {
        throw new Error('Someone else is editing this portfolio right now. It will sync again shortly.');
      }
      const result = await pushRemote(session, share.shareId, key, merged, version);
      if (result === 'gone') {
        await removeShareKey(share.shareId);
        await apply.ended(wallet.id, 'stopped');
        return { kind: 'ended' };
      }
      if (result.ok) {
        pushed = true;
        version = result.version;
        needPush = false;
      } else {
        merged = { ...mergeVault(merged, result.winner.vault), id: wallet.id };
        version = result.winner.version;
        // The winner may already hold everything we had; then there is
        // nothing left to push.
        needPush = !sameSharedVault(merged, result.winner.vault);
      }
    }

    // Apply merged -> local. ENTRIES BEFORE META (the account loop's rule):
    // an old stamp over new entries re-merges cleanly next time; the other
    // order strands a fresh stamp over stale entries. Re-read the entries
    // first so a line typed while this sync was on the network survives.
    let pulled = !sameSharedVault(merged, local);
    if (viewer) {
      // Compare against the disk as it is NOW, not the snapshot taken before
      // the network round trip: a feed that wrote in between would otherwise
      // survive until the next sync (decided 2026-09-14).
      const now: SyncVault = {
        ...local,
        entries: await loadManualEntries(wallet.id),
        deletedEntries: await entryTombstonesFor(wallet.id),
      };
      pulled = !sameSharedVault(merged, now);
    }
    if (pulled) {
      if (viewer) {
        // The owner's copy as it stands, not a merge: nothing local to keep,
        // tombstones included (a member's own would otherwise linger and, once
        // newer than an entry the owner still has, delete it).
        await saveManualEntries(wallet.id, merged.entries);
        await replaceEntryTombstones(wallet.id, merged.deletedEntries ?? []);
      } else {
      const current = await loadManualEntries(wallet.id);
      const settled = mergeVault(
        {
          id: wallet.id,
          label: merged.label,
          icon: merged.icon,
          entries: current,
          deletedEntries: await entryTombstonesFor(wallet.id),
          updatedAt: 0, // entries decide per entry; meta comes from `merged`
        },
        merged,
      );
      await saveManualEntries(wallet.id, settled.entries);
      await recordEntryTombstones(wallet.id, settled.deletedEntries ?? []);
      }
      await apply.updateMeta({ id: wallet.id, label: merged.label, icon: merged.icon, updatedAt: merged.updatedAt });
    }
    await apply.updateShare(wallet.id, { version, lastSyncAt: Date.now(), lastError: undefined });
    return { kind: 'synced', pulled, pushed, version };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Sync failed.';
    try {
      await apply.updateShare(wallet.id, { lastError: message });
    } catch {
      // the outcome carries it
    }
    return { kind: 'failed', message };
  }
}
