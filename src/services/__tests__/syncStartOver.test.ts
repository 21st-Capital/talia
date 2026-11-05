/**
 * Portfolio Sync with a forgotten password (decided 2026-09-30). An earlier fix
 * made a wrong password refuse to turn sync on when the account already has
 * a synced copy; with nothing else, an owner who forgot it could never use
 * sync again. Now the refusal is a typed error and the owner can start over:
 * the synced copy is deleted and a new strong password takes its place.
 */
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));
jest.mock('../companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  loadSession: jest.fn(async () => ({ email: 'Owner@Example.com', accessToken: 'at' })),
}));

import { deriveSyncKey, sealSyncBlob } from '../../crypto/vaultSync';
import { enableSync, isSyncEnabled, isSyncPasswordMismatch } from '../virtualVaultSync';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mem = require('../../testing/memoryKeychain') as typeof import('../../testing/memoryKeychain');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const disk = require('../../testing/memoryAsyncStorage') as typeof import('../../testing/memoryAsyncStorage');

const OLD_PW = 'forgotten-horse-battery-7';
const NEW_PW = 'correct-staple-lantern-42';

let serverBlob: string | null = null;
const calls: string[] = [];

beforeAll(async () => {
  const key = await deriveSyncKey(OLD_PW, 'owner@example.com');
  serverBlob = sealSyncBlob(key, JSON.stringify({ v: 1, vaults: [], tombstones: [] }));
});

let deleteOk = true;
beforeEach(() => {
  mem.__reset();
  disk.__clear();
  calls.length = 0;
  deleteOk = true;
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push(method);
    if (method === 'DELETE') {
      if (!deleteOk) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 204, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ blob: serverBlob }) };
  });
});

describe('a wrong password against an existing synced copy', () => {
  it('is refused with a typed error, in words true on every phone', async () => {
    const err = await enableSync('some-other-password-9').catch((e) => e);
    expect(isSyncPasswordMismatch(err)).toBe(true);
    expect((err as Error).message).toBe('That is not the sync password for this account.');
    expect((err as Error).message).not.toMatch(/other phone/);
    expect(await isSyncEnabled()).toBe(false);
    expect(calls).not.toContain('DELETE');
  });

  it('can start over: the copy is deleted, the new password is stored as a key, sync is on', async () => {
    await expect(enableSync(NEW_PW)).rejects.toThrow();
    await enableSync(NEW_PW, { replaceExisting: true });
    expect(calls.filter((c) => c === 'DELETE')).toHaveLength(1);
    expect(await isSyncEnabled()).toBe(true);
    const item = mem.__items().get('talia-vvault-sync');
    expect(item?.password).not.toMatch(new RegExp(NEW_PW));
  }, 20_000);

  it('starting over still demands a strong password, and deletes nothing when it is weak', async () => {
    await expect(enableSync('short', { replaceExisting: true })).rejects.toThrow(/at least 12/);
    expect(calls).not.toContain('DELETE');
    expect(await isSyncEnabled()).toBe(false);
  });

  it('nothing is turned on when the server does not confirm the copy is gone', async () => {
    deleteOk = false;
    await expect(enableSync(NEW_PW, { replaceExisting: true })).rejects.toThrow(/Could not remove/);
    expect(await isSyncEnabled()).toBe(false);
    expect(mem.__items().has('talia-vvault-sync')).toBe(false);
  }, 20_000);

  it('the right password still opens the copy, with no delete', async () => {
    await enableSync(OLD_PW);
    expect(calls).not.toContain('DELETE');
    expect(await isSyncEnabled()).toBe(true);
  }, 20_000);
});
