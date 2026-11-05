/**
 * Client half of virtual-vault sync (decided 2026-08-26). The heavy thinking —
 * key derivation, the envelope, the per-entry merge — lives in
 * crypto/vaultSync.ts (pure, tested). This module does the I/O around it:
 *
 *   local state  = the manual wallets + their entries + deletion tombstones
 *   remote state = one E2E-encrypted blob behind the user's 21C session
 *
 * A sync is: build local → fetch remote → merge → apply what changed locally
 * → push if the merge changed the remote. The server's 409 (someone else
 * pushed newer state) feeds the winner back through the same merge and
 * retries once — nothing ever clobbers, in either direction.
 *
 * Hardened after the 2026-08-26 adversarial review:
 *  - The store is RE-READ at write-back and tombstones are unioned, so a
 *    deletion (or a disable) that lands while a sync is in flight survives.
 *  - Sync is BOUND to the account that enabled it (`boundEmail`): logging
 *    into a different 21C account on the same phone will not cross-pollinate
 *    portfolios, and the KDF salt uses the bound email so a later change to
 *    the account's email string cannot orphan the blob.
 *  - Entry deletions carry per-vault tombstones (recordEntryTombstone).
 *  - The derived key is memoised per enablement — scrypt runs once, not on
 *    every debounced push.
 *
 * The DERIVED KEY lives in the iOS Keychain, this device only; the sync
 * password itself is never stored (decided 2026-09-26). WalletProvider owns WHEN syncs run; this module
 * owns HOW.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteSecret, getSecret, setSecret } from './keychain';

import { COMPANY_API, loadSession } from './companyAuth';
import { base64 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import {
  credentialNeedsRewrite,
  decodeSyncCredential,
  deriveSyncKey,
  encodeSyncCredential,
  mergeSyncStates,
  mergeVault,
  openSyncBlob,
  padPayload,
  parseSyncState,
  sealSyncBlob,
  serializeSyncState,
  stateStamp,
  syncPasswordProblem,
} from '../crypto/vaultSync';
import type { SyncState, SyncTombstone, SyncVault } from '../crypto/vaultSync';
import { loadManualEntries, saveManualEntries } from '../wallet/manualEntries';
import type { WalletMeta } from '../wallet/types';

const SYNC_URL = `${COMPANY_API}/api/vaults/virtual-vaults/sync/`;
const KEYCHAIN_SERVICE = 'talia-vvault-sync';
const STORE_KEY = 'keel.vvaultsync.v1';

interface SyncStore {
  enabled: boolean;
  /** The account this phone's sync belongs to — set at enable time. */
  boundEmail?: string;
  tombstones: SyncTombstone[];
  /** Per-vault entry deletions awaiting propagation. */
  entryTombstones?: Record<string, SyncTombstone[]>;
  lastSyncAt?: number;
}

async function loadStore(): Promise<SyncStore> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return { enabled: false, tombstones: [] };
    const parsed = JSON.parse(raw) as Partial<SyncStore>;
    return {
      enabled: parsed.enabled === true,
      boundEmail: typeof parsed.boundEmail === 'string' ? parsed.boundEmail : undefined,
      tombstones: Array.isArray(parsed.tombstones) ? parsed.tombstones : [],
      entryTombstones:
        parsed.entryTombstones && typeof parsed.entryTombstones === 'object'
          ? parsed.entryTombstones
          : undefined,
      lastSyncAt: typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : undefined,
    };
  } catch {
    return { enabled: false, tombstones: [] };
  }
}

async function saveStore(store: SyncStore): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
}

/** scrypt runs once per enablement, not on every debounced push. */
let keyMemo: { boundEmail: string; key: Uint8Array } | null = null;

export async function isSyncEnabled(): Promise<boolean> {
  return (await loadStore()).enabled;
}

export async function lastSyncAt(): Promise<number | undefined> {
  return (await loadStore()).lastSyncAt;
}

export async function syncBoundEmail(): Promise<string | undefined> {
  return (await loadStore()).boundEmail;
}

/** The password typed does not open the account's synced copy. The screen
 *  then offers to start over (`enableSync(pw, { replaceExisting: true })`). */
export class SyncPasswordMismatchError extends Error {
  constructor() {
    super('That is not the sync password for this account.');
    this.name = 'SyncPasswordMismatchError';
  }
}

export function isSyncPasswordMismatch(e: unknown): e is SyncPasswordMismatchError {
  return e instanceof SyncPasswordMismatchError;
}

/** The key made from the last password that did NOT open the copy, so a
 *  start over right after needs no second ten-second derivation. Memory only,
 *  and only for the same account and the same password. */
let lastMismatch: { boundEmail: string; pwDigest: string; key: Uint8Array } | null = null;

function digestOf(password: string): string {
  return base64.encode(sha256(utf8ToBytes(password)));
}

async function keyFor(password: string, boundEmail: string): Promise<Uint8Array> {
  const d = digestOf(password);
  if (lastMismatch && lastMismatch.boundEmail === boundEmail && lastMismatch.pwDigest === d) return lastMismatch.key;
  return deriveSyncKey(password, boundEmail);
}

/** Enable sync for the LOGGED-IN account. Throws without a session email —
 *  the settings screen only offers enabling when logged in.
 *
 *  When the account already has a synced copy (another phone, or this one
 *  before it turned sync off or was reinstalled), the password must OPEN
 *  that copy: a wrong one throws SyncPasswordMismatchError rather than being
 *  stored and failing on every sync. A forgotten password is not a dead end
 *  (decided 2026-09-30): `replaceExisting` deletes the synced copy on the
 *  server and starts over with this password. This phone's portfolios are
 *  untouched and go up with the next sync. Whenever the password will be the
 *  only thing guarding a fresh copy, it must pass `syncPasswordProblem`
 *  (decided 2026-09-26). */
export async function enableSync(password: string, opts: { replaceExisting?: boolean } = {}): Promise<void> {
  const session = await loadSession();
  if (!session?.email) throw new Error('Log in to your 21st Capital account first.');
  const boundEmail = session.email.trim().toLowerCase();
  let existing: string | null = null;
  try {
    const res = await fetch(SYNC_URL, { headers: { Authorization: `Bearer ${session.accessToken}` } });
    if (res.status === 200) {
      const body = (await res.json()) as { blob?: string };
      if (typeof body.blob === 'string') existing = body.blob;
    } else if (res.status !== 204 && res.status !== 404) {
      throw new Error(`Sync server answered ${res.status}.`);
    }
  } catch (e) {
    throw e instanceof Error && /Sync server/.test(e.message)
      ? e
      : new Error('Could not reach 21st Capital. Check the connection and try again.');
  }
  const replacing = existing != null && opts.replaceExisting === true;
  if (existing == null || replacing) {
    const problem = syncPasswordProblem(password);
    if (problem) throw new Error(problem);
  }
  // The ONE place the KDF runs: at enablement, behind the settings screen's
  // spinner (~11s on-device — the screen says so). The derived key is stored
  // so launches never pay this again. See crypto/vaultSync.ts for the
  // 12-second lesson this encodes.
  const key = await keyFor(password, boundEmail);
  if (existing != null && !replacing) {
    try {
      openSyncBlob(key, existing);
    } catch {
      lastMismatch = { boundEmail, pwDigest: digestOf(password), key };
      throw new SyncPasswordMismatchError();
    }
  }
  if (replacing) {
    // Remove the copy nobody can open any more. Nothing is stored or enabled
    // unless the server confirms it is gone.
    let gone = false;
    try {
      const res = await fetch(SYNC_URL, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      gone = res.ok || res.status === 404;
    } catch {
      gone = false;
    }
    if (!gone) throw new Error('Could not remove the synced copy. Check the connection and try again.');
  }
  lastMismatch = null;
  await setSecret(KEYCHAIN_SERVICE, 'sync', encodeSyncCredential({ keyB64: base64.encode(key) }));
  keyMemo = { boundEmail, key };
  const store = await loadStore();
  await saveStore({ ...store, enabled: true, boundEmail });
}

/** Disable on THIS phone. `deleteServerCopy` also removes the account blob;
 *  returns false when that removal could not be confirmed. */
export async function disableSync(deleteServerCopy: boolean): Promise<boolean> {
  let serverOk = true;
  if (deleteServerCopy) {
    serverOk = false;
    const session = await loadSession();
    if (session) {
      try {
        const res = await fetch(SYNC_URL, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        serverOk = res.ok;
      } catch {
        serverOk = false;
      }
    }
  }
  await deleteSecret(KEYCHAIN_SERVICE);
  keyMemo = null;
  const store = await loadStore();
  await saveStore({ ...store, enabled: false, boundEmail: undefined });
  return serverOk;
}

/** Record a deleted manual VAULT so the deletion propagates. */
export async function recordTombstone(walletId: string, at: number): Promise<void> {
  const store = await loadStore();
  await saveStore({
    ...store,
    tombstones: [...store.tombstones.filter((t) => t.id !== walletId), { id: walletId, at }],
  });
}

/** Record a deleted ENTRY so removing it on one phone sticks on the other. */
export async function recordEntryTombstone(
  walletId: string,
  entryId: string,
  at: number,
): Promise<void> {
  const store = await loadStore();
  const forVault = store.entryTombstones?.[walletId] ?? [];
  await saveStore({
    ...store,
    entryTombstones: {
      ...store.entryTombstones,
      [walletId]: [...forVault.filter((t) => t.id !== entryId), { id: entryId, at }],
    },
  });
}

/** Entry ids the owner DELETED from this portfolio — the auto-appender must
 *  never resurrect them (a deleted auto-entry stays deleted). */
export async function entryTombstoneIdsFor(walletId: string): Promise<Set<string>> {
  const store = await loadStore();
  return new Set((store.entryTombstones?.[walletId] ?? []).map((t) => t.id));
}

/** This portfolio's entry tombstones with their stamps: the shared-portfolio
 *  loop (services/sharedPortfolio.ts) builds its SyncVault from the SAME
 *  record the account loop uses, so a deletion propagates through both. */
export async function entryTombstonesFor(walletId: string): Promise<SyncTombstone[]> {
  const store = await loadStore();
  return [...(store.entryTombstones?.[walletId] ?? [])];
}

/** Union tombstones learned from a shared portfolio's blob into the local
 *  record (newest stamp per id). Without this a deletion made by another
 *  member would be re-fought on every round against this phone's own
 *  account blob, which still carries the entry. */
/**
 * Replace a portfolio's entry tombstones with exactly this list.
 *
 * For a MEMBER's mirrored copy: the owner's blob is the truth, so a tombstone
 * the member made while the copy was theirs must not survive into it. Left in,
 * it made every sync see a difference (endless rewrites) and could delete an
 * entry the owner still has (decided 2026-09-14).
 */
export async function replaceEntryTombstones(
  walletId: string,
  tombstones: readonly SyncTombstone[],
): Promise<void> {
  const store = await loadStore();
  await saveStore({
    ...store,
    entryTombstones: { ...store.entryTombstones, [walletId]: [...tombstones] },
  });
}

export async function recordEntryTombstones(
  walletId: string,
  tombstones: readonly SyncTombstone[],
): Promise<void> {
  if (tombstones.length === 0) return;
  const store = await loadStore();
  const byId = new Map<string, number>();
  for (const t of [...(store.entryTombstones?.[walletId] ?? []), ...tombstones]) {
    byId.set(t.id, Math.max(byId.get(t.id) ?? 0, t.at));
  }
  await saveStore({
    ...store,
    entryTombstones: {
      ...store.entryTombstones,
      [walletId]: [...byId.entries()].map(([id, at]) => ({ id, at })),
    },
  });
}

/** One-time upgrade of a legacy credential to the key-only form.
 *
 *  - A v1 item (password AND key) is rewritten with the key alone, this
 *    device only. No KDF: cheap, safe anywhere.
 *  - A bare legacy password runs the ~11s KDF ONCE — call it far from boot
 *    (the provider schedules it ≥15s after launch) or from the settings
 *    screen — and is then replaced by the key alone.
 *  Returns true when a rewrite happened. */
export async function migrateLegacyCredential(): Promise<boolean> {
  const store = await loadStore();
  const stored = await getSecret(KEYCHAIN_SERVICE);
  if (!stored) return false;
  const cred = decodeSyncCredential(stored);
  if (!credentialNeedsRewrite(cred)) return false;
  if (cred.keyB64 != null) {
    await setSecret(KEYCHAIN_SERVICE, 'sync', encodeSyncCredential({ keyB64: cred.keyB64 }));
    return true;
  }
  if (!store.enabled || !store.boundEmail || cred.password == null) return false;
  const key = await deriveSyncKey(cred.password, store.boundEmail);
  await setSecret(KEYCHAIN_SERVICE, 'sync', encodeSyncCredential({ keyB64: base64.encode(key) }));
  keyMemo = { boundEmail: store.boundEmail, key };
  return true;
}

export interface SyncApply {
  /** Create a manual wallet with a FIXED id — or update it if the id exists
   *  (overlapping syncs must never insert a duplicate row). */
  createManual: (v: { id: string; label: string; icon?: string; updatedAt: number }) => Promise<void>;
  /** Update label/icon/stamp — the provider SKIPS it when its CURRENT stamp
   *  is already >= the incoming one (an edit landed mid-sync). */
  updateManual: (v: { id: string; label: string; icon?: string; updatedAt: number }) => Promise<void>;
  /** Remove a manual wallet (a remote tombstone won). */
  removeManual: (id: string) => Promise<void>;
}

export type SyncOutcome =
  | { kind: 'synced'; pulled: boolean; pushed: boolean }
  | { kind: 'skipped'; reason: 'disabled' | 'loggedOut' | 'noPassword' | 'wrongAccount' | 'needsMigration' }
  | { kind: 'failed'; message: string };

/**
 * Run one full sync. The caller (WalletProvider) guarantees at most ONE
 * runSync in flight — overlapping applies were proven to duplicate vaults.
 */
export async function runSync(
  manualWallets: readonly WalletMeta[],
  apply: SyncApply,
  /**
   * Portfolio ids this account must not carry: the ones shared WITH this
   * phone, which mirror their owner. Dropped from the remote state before
   * the merge, so the next push writes them out of the account blob and the
   * account's other phones remove the plain copies they were handed
   * (decided 2026-09-14). Nothing is done to those wallets locally.
   */
  excludeIds: ReadonlySet<string> = new Set(),
): Promise<SyncOutcome> {
  const store = await loadStore();
  if (!store.enabled) return { kind: 'skipped', reason: 'disabled' };
  const session = await loadSession();
  if (!session) return { kind: 'skipped', reason: 'loggedOut' };
  const sessionEmail = session.email?.trim().toLowerCase();
  const boundEmail = store.boundEmail ?? sessionEmail;
  if (!boundEmail) return { kind: 'skipped', reason: 'loggedOut' };
  if (sessionEmail && sessionEmail !== boundEmail) {
    // A different 21C account is logged in — never mix two accounts' vaults.
    return { kind: 'skipped', reason: 'wrongAccount' };
  }
  const stored = await getSecret(KEYCHAIN_SERVICE);
  if (!stored) return { kind: 'skipped', reason: 'noPassword' };
  const cred = decodeSyncCredential(stored);
  if (cred.keyB64 == null) {
    // Legacy enablement from before the derived key was stored: deriving
    // here would freeze the app ~11s (the cold-start bug). Skip; the
    // provider schedules migrateLegacyCredential far from boot.
    return { kind: 'skipped', reason: 'needsMigration' };
  }

  try {
    if (keyMemo == null || keyMemo.boundEmail !== boundEmail) {
      keyMemo = { boundEmail, key: base64.decode(cred.keyB64) };
    }
    const key = keyMemo.key;

    // Local state: wallets + their entries + entry tombstones.
    const vaults: SyncVault[] = [];
    for (const w of manualWallets) {
      vaults.push({
        id: w.id,
        label: w.label,
        icon: w.icon,
        entries: await loadManualEntries(w.id),
        deletedEntries: store.entryTombstones?.[w.id] ?? [],
        updatedAt: w.manualUpdatedAt ?? w.createdAt,
      });
    }
    const local: SyncState = { vaults, tombstones: store.tombstones };

    // Remote state.
    const auth = { Authorization: `Bearer ${session.accessToken}` };
    const res = await fetch(SYNC_URL, { headers: auth });
    let remote: SyncState = { vaults: [], tombstones: [] };
    if (res.status === 200) {
      const body = (await res.json()) as { blob?: string };
      if (typeof body.blob === 'string') {
        remote = parseSyncState(openSyncBlob(key, body.blob));
        if (excludeIds.size > 0) {
          remote = { ...remote, vaults: remote.vaults.filter((v) => !excludeIds.has(v.id)) };
        }
      }
    } else if (res.status !== 204) {
      return { kind: 'failed', message: `Sync server answered ${res.status}.` };
    }

    const { merged, localChanged, remoteChanged } = mergeSyncStates(local, remote);

    // Apply merged → local. ENTRIES BEFORE META: if we die between the two
    // writes, the old stamp over new entries re-merges cleanly next time —
    // the other order strands a fresh stamp over stale entries.
    if (localChanged) {
      const localIds = new Set(vaults.map((v) => v.id));
      const mergedIds = new Set(merged.vaults.map((v) => v.id));
      // Mid-flight edits: entries saved while this sync was on the network
      // are NOT in the snapshot. Re-merge each vault against its CURRENT
      // entry file (per-entry LWW protects the fresh edit) instead of blind
      // writing the snapshot's list — the re-verify pass proved the blind
      // write permanently lost an entry typed during the fetch.
      const freshMid = await loadStore();
      for (const v of merged.vaults) {
        const currentEntries = await loadManualEntries(v.id);
        const settled = mergeVault(
          {
            id: v.id,
            label: v.label,
            icon: v.icon,
            entries: currentEntries,
            deletedEntries: freshMid.entryTombstones?.[v.id] ?? [],
            updatedAt: 0, // entries decide per-entry; meta comes from `v`
          },
          v,
        );
        await saveManualEntries(v.id, settled.entries);
        if (localIds.has(v.id)) await apply.updateManual(v);
        else await apply.createManual(v);
      }
      for (const v of vaults) {
        if (!mergedIds.has(v.id)) await apply.removeManual(v.id);
      }
    }

    // Push merged → remote (retry once through a 409's winner).
    let pushed = false;
    if (remoteChanged) {
      pushed = await push(key, auth, merged);
      if (!pushed) {
        const res2 = await fetch(SYNC_URL, { headers: auth });
        if (res2.status === 200) {
          const body = (await res2.json()) as { blob?: string };
          if (typeof body.blob === 'string') {
            let winner = parseSyncState(openSyncBlob(key, body.blob));
            if (excludeIds.size > 0) {
              winner = { ...winner, vaults: winner.vaults.filter((v) => !excludeIds.has(v.id)) };
            }
            const retry = mergeSyncStates(merged, winner);
            pushed = await push(key, auth, retry.merged);
          }
        }
      }
    }

    // Write-back against a FRESH store read: a tombstone recorded (or a
    // disable performed) while this sync was in flight must survive.
    const fresh = await loadStore();
    const tombById = new Map<string, number>();
    for (const t of [...merged.tombstones, ...fresh.tombstones]) {
      tombById.set(t.id, Math.max(tombById.get(t.id) ?? 0, t.at));
    }
    const entryTombs: Record<string, SyncTombstone[]> = {};
    for (const v of merged.vaults) {
      if (v.deletedEntries && v.deletedEntries.length > 0) entryTombs[v.id] = v.deletedEntries;
    }
    for (const [wid, list] of Object.entries(fresh.entryTombstones ?? {})) {
      const seen = new Set((entryTombs[wid] ?? []).map((t) => t.id));
      entryTombs[wid] = [...(entryTombs[wid] ?? []), ...list.filter((t) => !seen.has(t.id))];
    }
    await saveStore({
      ...fresh,
      tombstones: [...tombById.entries()].map(([id, at]) => ({ id, at })),
      entryTombstones: entryTombs,
      lastSyncAt: Date.now(),
    });
    return { kind: 'synced', pulled: localChanged, pushed };
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : 'Sync failed.' };
  }
}

async function push(
  key: Uint8Array,
  auth: Record<string, string>,
  state: SyncState,
): Promise<boolean> {
  const res = await fetch(SYNC_URL, {
    method: 'PUT',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blob: sealSyncBlob(key, padPayload(serializeSyncState(state))),
      client_updated_at: stateStamp(state),
    }),
  });
  return res.status === 204;
}
