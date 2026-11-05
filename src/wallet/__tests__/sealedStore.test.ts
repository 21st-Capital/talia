/**
 * Decided 2026-09-26: every vault's descriptor, the
 * heirs' names and emails and half-signed payments sat in AsyncStorage in
 * the clear. They are sealed now with a Keychain key (this device only), and
 * the rules that keep the vault list from ever being lost are pinned here.
 */
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

import {
  SEALED_PREFIX,
  UNREADABLE_SUFFIX,
  SealedStoreError,
  __resetSealedStoreForTests,
  isSealedStoreError,
  startOverSealedStore,
  openValue,
  sealValue,
  sealedGetItem,
  sealedRemoveItem,
  sealedSetItem,
} from '../sealedStore';
import { __forgetWalletsReadForTests, loadWallets, saveWallets } from '../storage';
import type { WalletMeta } from '../types';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mem = require('../../testing/memoryKeychain') as typeof import('../../testing/memoryKeychain');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const disk = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;

const DESCRIPTOR = "wsh(sortedmulti(2,[aabbccdd/48'/0'/0'/2']xpubSECRETLOOKINGKEY/<0;1>/*,[11223344/48'/0'/0'/2']xpubOTHERKEY/<0;1>/*))";

beforeEach(() => {
  mem.__reset();
  disk.clear();
  __resetSealedStoreForTests();
});

describe('the envelope', () => {
  const key = new Uint8Array(32).fill(7);
  it('round-trips and is bound to its storage name', () => {
    const sealed = sealValue(key, 'a', 'hello');
    expect(sealed.startsWith(SEALED_PREFIX)).toBe(true);
    expect(openValue(key, 'a', sealed)).toBe('hello');
    expect(() => openValue(key, 'b', sealed)).toThrow();
    expect(() => openValue(new Uint8Array(32).fill(8), 'a', sealed)).toThrow();
  });
  it('never repeats a nonce for the same value', () => {
    expect(sealValue(key, 'a', 'x')).not.toBe(sealValue(key, 'a', 'x'));
  });
});

describe('sealedSetItem / sealedGetItem', () => {
  it('what reaches the disk is sealed: no descriptor, no key text', async () => {
    await sealedSetItem('keel.wallets.v1', JSON.stringify([{ descriptor: DESCRIPTOR }]));
    const raw = disk.get('keel.wallets.v1') ?? '';
    expect(raw.startsWith(SEALED_PREFIX)).toBe(true);
    expect(raw).not.toMatch(/xpub|SECRETLOOKING|aabbccdd|descriptor/);
    expect(JSON.parse((await sealedGetItem('keel.wallets.v1')) ?? '[]')[0].descriptor).toBe(DESCRIPTOR);
  });

  it('the store key is this-device-only and readable only while the phone is unlocked', async () => {
    await sealedSetItem('x', 'y');
    const item = mem.__items().get('talia.store.key.v1');
    expect(item?.options.accessible).toBe('AccessibleWhenUnlockedThisDeviceOnly');
  });

  it('an old plaintext value still reads, and is sealed in place by that read', async () => {
    disk.set('cosign.pending.v1', '[{"id":"p1"}]');
    expect(await sealedGetItem('cosign.pending.v1')).toBe('[{"id":"p1"}]');
    expect(disk.get('cosign.pending.v1')?.startsWith(SEALED_PREFIX)).toBe(true);
    expect(await sealedGetItem('cosign.pending.v1')).toBe('[{"id":"p1"}]');
  });

  it('a write queued behind the migration is never undone by it', async () => {
    disk.set('n', 'old');
    const read = sealedGetItem('n');
    const write = sealedSetItem('n', 'new');
    await Promise.all([read, write]);
    expect(await sealedGetItem('n')).toBe('new');
  });

  it('a Keychain that cannot answer THROWS, mints no key and touches nothing', async () => {
    await sealedSetItem('n', 'value');
    const before = disk.get('n');
    const keyBefore = mem.__items().get('talia.store.key.v1')?.password;
    __resetSealedStoreForTests();
    mem.__failNextRead();
    await expect(sealedGetItem('n')).rejects.toThrow();
    expect(disk.get('n')).toBe(before);
    expect(mem.__items().get('talia.store.key.v1')?.password).toBe(keyBefore);
    expect(await sealedGetItem('n')).toBe('value');
  });

  it('a key that is gone while sealed data exists: an error, never a new key or an empty list', async () => {
    await sealedSetItem('n', 'precious');
    const sealed = disk.get('n');
    mem.__reset(); // the key is gone (a team move, a phone restored from a backup)
    __resetSealedStoreForTests();
    const err = await sealedGetItem('n').catch((e) => e);
    expect(isSealedStoreError(err) && err.problem).toBe('key-missing');
    await expect(sealedSetItem('n', 'fresh')).rejects.toThrow(SealedStoreError);
    expect(disk.get('n')).toBe(sealed);
    expect(mem.__items().has('talia.store.key.v1')).toBe(false);
  });

  it('starting over keeps the old data aside, and a key that comes back brings it back', async () => {
    await sealedSetItem('n', 'precious');
    const oldKey = mem.__items().get('talia.store.key.v1')!;
    mem.__reset();
    __resetSealedStoreForTests();
    await startOverSealedStore();
    expect(await sealedGetItem('n')).toBeNull();
    expect(disk.get('n' + UNREADABLE_SUFFIX)?.startsWith(SEALED_PREFIX)).toBe(true);
    await sealedSetItem('n', 'after');
    // The old Keychain item returns (the team is switched back).
    mem.__items().set('talia.store.key.v1', oldKey);
    __resetSealedStoreForTests();
    expect(await sealedGetItem('n')).toBe('precious');
    // What was written meanwhile is kept aside too, never deleted.
    const copies = [...disk.keys()].filter((k) => k.startsWith('n' + UNREADABLE_SUFFIX));
    expect(copies.length).toBe(1);
  });

  it('a key that did not seal the data throws "unreadable" and moves nothing', async () => {
    await sealedSetItem('n', 'precious');
    const before = new Map(disk);
    mem.__items().set('talia.store.key.v1', { username: 'store-key', password: Buffer.alloc(32, 9).toString('base64'), options: {} });
    __resetSealedStoreForTests();
    const err = await sealedGetItem('n').catch((e) => e);
    expect(isSealedStoreError(err) && err.problem).toBe('unreadable');
    expect(new Map(disk)).toEqual(before);
  });

  it('a damaged key item is reported, and starting over mints a working key', async () => {
    await sealedSetItem('n', 'precious');
    mem.__items().set('talia.store.key.v1', { username: 'store-key', password: 'c2hvcnQ=', options: {} });
    __resetSealedStoreForTests();
    const err = await sealedGetItem('n').catch((e) => e);
    expect(isSealedStoreError(err) && err.problem).toBe('damaged-key');
    await startOverSealedStore();
    await sealedSetItem('n', 'new');
    __resetSealedStoreForTests();
    expect(await sealedGetItem('n')).toBe('new');
  });

  it('under the right key a damaged value is set aside, numbered, never over an earlier copy', async () => {
    await sealedSetItem('n', 'one');
    disk.set('n', disk.get('n')!.slice(0, -4) + 'AAAA');
    const first = disk.get('n');
    expect(await sealedGetItem('n')).toBeNull();
    expect(disk.get('n' + UNREADABLE_SUFFIX)).toBe(first);
    await sealedSetItem('n', 'two');
    disk.set('n', disk.get('n')!.slice(0, -4) + 'BBBB');
    const second = disk.get('n');
    expect(await sealedGetItem('n')).toBeNull();
    expect(disk.get('n' + UNREADABLE_SUFFIX)).toBe(first);
    expect(disk.get('n' + UNREADABLE_SUFFIX + '.2')).toBe(second);
  });

  it('a set-aside copy the current key opens is put back when its name is empty', async () => {
    await sealedSetItem('n', 'kept');
    disk.set('n' + UNREADABLE_SUFFIX, disk.get('n')!);
    disk.delete('n');
    __resetSealedStoreForTests(); // the next launch
    expect(await sealedGetItem('n')).toBe('kept');
    expect(disk.has('n' + UNREADABLE_SUFFIX)).toBe(false);
  });

  it('two first-time callers share ONE key', async () => {
    await Promise.all([sealedSetItem('a', '1'), sealedSetItem('b', '2')]);
    __resetSealedStoreForTests(); // a fresh launch reads the key back
    expect(await sealedGetItem('a')).toBe('1');
    expect(await sealedGetItem('b')).toBe('2');
  });

  it('removes', async () => {
    await sealedSetItem('a', '1');
    await sealedRemoveItem('a');
    expect(await sealedGetItem('a')).toBeNull();
  });
});

describe('the vault list (wallet/storage)', () => {
  const wallet = { id: 'w1', label: 'Family', descriptor: DESCRIPTOR } as unknown as WalletMeta;

  beforeEach(() => __forgetWalletsReadForTests());

  it('refuses a save before the stored list was read: an unread list is never replaced', async () => {
    disk.set('keel.wallets.v1', JSON.stringify([wallet]));
    await expect(saveWallets([])).rejects.toThrow();
    expect(JSON.parse(disk.get('keel.wallets.v1')!)[0].id).toBe('w1');
  });

  it('keeps refusing saves while the list cannot be opened', async () => {
    await loadWallets();
    await saveWallets([wallet]);
    mem.__reset(); // key gone
    __resetSealedStoreForTests();
    __forgetWalletsReadForTests(); // the next launch
    await expect(loadWallets()).rejects.toThrow(SealedStoreError);
    await expect(saveWallets([])).rejects.toThrow();
  });

  it('is sealed on save and opens on load', async () => {
    await loadWallets();
    await saveWallets([wallet]);
    expect(disk.get('keel.wallets.v1')).not.toMatch(/xpub|Family/);
    expect((await loadWallets())[0].descriptor).toBe(DESCRIPTOR);
  });

  it('a list saved before sealing still loads, then is sealed', async () => {
    disk.set('keel.wallets.v1', JSON.stringify([wallet]));
    expect((await loadWallets())[0].label).toBe('Family');
    expect(disk.get('keel.wallets.v1')?.startsWith(SEALED_PREFIX)).toBe(true);
  });

  it('refuses to answer "no vaults" when it simply cannot read', async () => {
    await loadWallets();
    await saveWallets([wallet]);
    __resetSealedStoreForTests();
    mem.__failNextRead();
    await expect(loadWallets()).rejects.toThrow();
  });
});
