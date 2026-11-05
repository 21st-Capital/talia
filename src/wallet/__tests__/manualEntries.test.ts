/**
 * The in-memory mirror in front of the entry store (decided 2026-09-12: a
 * portfolio must open instantly). The store is the truth; the mirror is what
 * a screen paints before its read lands.
 */
import {
  clearManualEntries,
  loadManualEntries,
  peekManualEntries,
  saveManualEntries,
} from '../manualEntries';
import type { ManualEntry } from '../manualLedger';

// The repo has no AsyncStorage mock, so give it one (as pendingMerge does).
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: jest.fn(async (k: string) => void store.delete(k)),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AsyncStorage = require('@react-native-async-storage/async-storage') as {
  getItem: jest.Mock;
  setItem: jest.Mock;
  removeItem: jest.Mock;
};

const KEY = (id: string): string => `keel.manualentries.v1:${id}`;

let seq = 0;
function entry(kind: 'buy' | 'sell', amountSats: number): ManualEntry {
  seq += 1;
  return { id: `e${seq}`, kind, amountSats, date: 1_700_000_000_000 + seq, createdAt: seq };
}

// The mirror is module state, so every test gets its own wallet id.
let walletSeq = 0;
const wallet = (): string => `w${++walletSeq}`;

describe('peekManualEntries', () => {
  it('knows nothing about a wallet that was never loaded or saved', () => {
    expect(peekManualEntries(wallet())).toBeUndefined();
  });

  it('answers what the last load read, without another storage read', async () => {
    const id = wallet();
    const list = [entry('buy', 1000), entry('sell', 250)];
    await AsyncStorage.setItem(KEY(id), JSON.stringify(list));
    AsyncStorage.getItem.mockClear();

    await loadManualEntries(id);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
    expect(peekManualEntries(id)).toEqual(list);
    expect(AsyncStorage.getItem).toHaveBeenCalledTimes(1);
  });

  it('hands out a copy, so a caller cannot edit the mirror in place', async () => {
    const id = wallet();
    await saveManualEntries(id, [entry('buy', 1000)]);
    const peeked = peekManualEntries(id)!;
    peeked.push(entry('buy', 999));
    expect(peekManualEntries(id)).toHaveLength(1);
  });

  it('answers what the last save wrote, with no load in between', async () => {
    const id = wallet();
    const list = [entry('buy', 5000)];
    await saveManualEntries(id, list);
    expect(peekManualEntries(id)).toEqual(list);
  });

  it('keeps the previous list when a save fails, and the save still throws', async () => {
    const id = wallet();
    const before = [entry('buy', 100)];
    await saveManualEntries(id, before);
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('disk full'));

    await expect(saveManualEntries(id, [...before, entry('buy', 200)])).rejects.toThrow('disk full');
    expect(peekManualEntries(id)).toEqual(before);
    // The store was never written either, so a fresh load agrees.
    expect(await loadManualEntries(id)).toEqual(before);
  });

  it('forgets a wallet that was cleared', async () => {
    const id = wallet();
    await saveManualEntries(id, [entry('buy', 100)]);
    await clearManualEntries(id);
    expect(peekManualEntries(id)).toBeUndefined();
    expect(await loadManualEntries(id)).toEqual([]);
  });

  it('is not put back to a stale list by a read that resolves after a newer save', async () => {
    const id = wallet();
    const old = [entry('buy', 100)];
    const fresh = [...old, entry('buy', 200)];
    await AsyncStorage.setItem(KEY(id), JSON.stringify(old));

    // A slow read starts first and resolves only once told to.
    let release: (() => void) | undefined;
    AsyncStorage.getItem.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          release = () => resolve(JSON.stringify(old));
        }),
    );
    const slowRead = loadManualEntries(id);
    await saveManualEntries(id, fresh);
    expect(peekManualEntries(id)).toEqual(fresh);

    release!();
    // The read returns what it read (the store's truth at that moment) ...
    expect(await slowRead).toEqual(old);
    // ... but the mirror keeps the newer save.
    expect(peekManualEntries(id)).toEqual(fresh);
  });

  it('mirrors an empty list for corrupt or missing storage, like the load itself', async () => {
    const id = wallet();
    await AsyncStorage.setItem(KEY(id), '{not json');
    expect(await loadManualEntries(id)).toEqual([]);
    expect(peekManualEntries(id)).toEqual([]);
  });

  it('mirrors the filtered list: malformed records are dropped from both', async () => {
    const id = wallet();
    const good = entry('buy', 100);
    await AsyncStorage.setItem(KEY(id), JSON.stringify([good, { id: 'x', kind: 'buy' }, null]));
    expect(await loadManualEntries(id)).toEqual([good]);
    expect(peekManualEntries(id)).toEqual([good]);
  });
});
