/**
 * The Addresses list never rewrites what it saved from an engine that did not
 * sync (decided 2026-10-30). The engine's database is in memory, so after a
 * failed sync a vault with history answers index 0, and the refresh's old
 * fallback (catch, then getEngine) saved that: every address unused from 0,
 * the used tab empty. The screen is mounted for real, with an engine that
 * answers exactly that way; the page components are plain hosts.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockWorld = {
  synced: false,
  firstUnused: 3,
  sync: async (): Promise<void> => undefined,
  wallet: { id: 'w1', label: 'Savings', descriptor: 'wpkh(x)', network: 'bitcoin', cachedBalanceSats: 0 } as Record<string, unknown>,
};
const mockAt = (index: number) => ({ address: `bc1qaddress${index}`, index, uri: '' });
const mockEngine = {
  getReceiveAddress: jest.fn(async (which: 'new' | 'lastUnused' | number) => {
    if (typeof which === 'number') return mockAt(which);
    return mockAt(mockWorld.synced ? mockWorld.firstUnused : 0);
  }),
  listUtxos: jest.fn(async () => []),
};
const mockSyncWallet = jest.fn(async () => {
  await mockWorld.sync();
  mockWorld.synced = true;
  return mockEngine;
});
const mockGetEngine = jest.fn(async () => mockEngine);

jest.mock('react-native', () => {
  const R = require('react');
  return {
    ...require('../../__tests__/rnStub').reactNative,
    ActivityIndicator: 'ActivityIndicator',
    TouchableOpacity: 'TouchableOpacity',
    TextInput: 'TextInput',
    InteractionManager: {
      runAfterInteractions: (f: () => void) => {
        void f();
        return { cancel: () => undefined };
      },
    },
    FlatList: (p: {
      data: unknown[];
      renderItem: (i: { item: unknown }) => React.ReactNode;
      ListEmptyComponent: React.ReactNode;
    }) =>
      R.createElement(
        'FlatList',
        { rows: p.data.length },
        p.data.length ? p.data.map((item, i) => R.createElement('Row', { key: i }, p.renderItem({ item }))) : p.ListEmptyComponent,
      ),
  };
});
jest.mock('@react-native-async-storage/async-storage', () => require('../../../testing/memoryAsyncStorage'));
jest.mock('../../components', () => {
  const R = require('react');
  const host =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      R.createElement(name, p, children);
  return {
    Gloss: host('Gloss'),
    PageFooter: host('PageFooter'),
    RefreshIcon: host('RefreshIcon'),
    SearchIcon: host('SearchIcon'),
    SegmentedControl: host('SegmentedControl'),
    cardGlow: () => 0,
    Button: (p: { title: string; onPress: () => void }) => R.createElement('Button', { title: p.title, onPress: p.onPress }),
  };
});
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../../wallet', () => {
  const cache = require('../../../wallet/addrCache');
  return {
    useWallets: () => ({ getWallet: () => mockWorld.wallet, getEngine: mockGetEngine, syncWallet: mockSyncWallet }),
    addressDigitRuns: (a: string) => [{ text: a, digit: false }],
    loadAddrCache: cache.loadAddrCache,
    saveAddrCache: cache.saveAddrCache,
    ADDRESSES_NOT_CHECKED: cache.ADDRESSES_NOT_CHECKED,
    ADDRESS_CHECK_PATIENCE_MS: cache.ADDRESS_CHECK_PATIENCE_MS,
    loadUtxoCache: async () => null,
  };
});
jest.mock('../../../config', () => ({ UNUSED_ADDRESS_COUNT: 3 }));

import { AddressesScreen } from '../AddressesScreen';
import { ADDRESSES_NOT_CHECKED, ADDRESS_CHECK_PATIENCE_MS, loadAddrCache, saveAddrCache } from '../../../wallet/addrCache';
import type { AddressCache } from '../../../wallet/addrCache';

const storage = require('@react-native-async-storage/async-storage').default as { __clear: () => void };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const settle = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) await new Promise((done) => setImmediate(done));
  });

const SAVED: AddressCache = {
  firstUnused: 5,
  unused: [5, 6, 7].map((index) => ({ address: `bc1qaddress${index}`, index })),
  used: [{ address: 'bc1qaddress4', index: 4, balanceSats: 1000 }],
  updatedAt: 1,
};

let mounted: TestRenderer.ReactTestRenderer | null = null;
async function open(): Promise<TestRenderer.ReactTestRenderer> {
  await act(async () => {
    mounted = TestRenderer.create(
      <AddressesScreen navigation={{ navigate: jest.fn() } as never} route={{ key: 'a', name: 'Addresses', params: { walletId: 'w1' } } as never} />,
    );
  });
  await settle();
  return mounted!;
}

const hosts = (r: TestRenderer.ReactTestRenderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type);
const rows = (r: TestRenderer.ReactTestRenderer) => hosts(r, 'FlatList')[0].props.rows as number;
const text = (r: TestRenderer.ReactTestRenderer) =>
  hosts(r, 'Text')
    .flatMap((t) => t.children)
    .filter((c): c is string => typeof c === 'string');
const buttons = (r: TestRenderer.ReactTestRenderer) => hosts(r, 'Button').map((b) => b.props.title as string);

beforeEach(() => {
  storage.__clear();
  mockWorld.synced = false;
  mockWorld.firstUnused = 3;
  mockWorld.sync = async () => undefined;
  mockEngine.getReceiveAddress.mockClear();
  mockEngine.listUtxos.mockClear();
  mockSyncWallet.mockClear();
  mockGetEngine.mockClear();
});
afterEach(async () => {
  await act(async () => mounted?.unmount());
  mounted = null;
});

describe('while the refresh runs', () => {
  const held = () => {
    let finish!: () => void;
    mockWorld.sync = () => new Promise<void>((done) => (finish = done));
    return () => finish();
  };

  it('no unused address shows: a saved one may have been paid since', async () => {
    await saveAddrCache('w1', SAVED);
    const finish = held();
    const r = await open();
    expect(rows(r)).toBe(0);
    expect(hosts(r, 'ActivityIndicator')).toHaveLength(1);
    await act(async () => finish());
    await settle();
    expect(rows(r)).toBe(3);
    expect(hosts(r, 'ActivityIndicator')).toHaveLength(0);
  });

  describe('for too long', () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
    afterEach(() => jest.useRealTimers());
    const wait = (ms: number) =>
      act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });

    it('shows the saved list at the limit and not before, and the refresh still lands over it', async () => {
      await saveAddrCache('w1', SAVED);
      const finish = held();
      const r = await open();
      await wait(ADDRESS_CHECK_PATIENCE_MS - 1);
      expect(rows(r)).toBe(0);
      await wait(1);
      await settle();
      expect(rows(r)).toBe(3);
      expect(hosts(r, 'ActivityIndicator')).toHaveLength(0);
      await act(async () => finish());
      await settle();
      const saved = await loadAddrCache('w1');
      expect(saved?.firstUnused).toBe(3);
    });

    it('with nothing saved keeps its spinner, and never reads as empty', async () => {
      held();
      const r = await open();
      await wait(ADDRESS_CHECK_PATIENCE_MS);
      await settle();
      expect(text(r)).not.toContain('No Addresses Found');
    });

    it('with every saved unused address taken out keeps its spinner too', async () => {
      await saveAddrCache('w1', { ...SAVED, used: [{ address: 'bc1used', index: 9 }] });
      held();
      const r = await open();
      await wait(ADDRESS_CHECK_PATIENCE_MS);
      await settle();
      expect(text(r)).not.toContain('No Addresses Found');
      expect(hosts(r, 'ActivityIndicator').length).toBeGreaterThan(0);
    });

    it('a refresh that ended in time leaves no timer to paint the saved list over it', async () => {
      await saveAddrCache('w1', { ...SAVED, unused: SAVED.unused.slice(0, 1) });
      const r = await open();
      expect(rows(r)).toBe(3);
      await wait(ADDRESS_CHECK_PATIENCE_MS);
      await settle();
      expect(rows(r)).toBe(3);
    });
  });
});

describe('the refresh', () => {
  it('after a finished sync rewrites the list from the engine', async () => {
    await saveAddrCache('w1', SAVED);
    const r = await open();
    const saved = await loadAddrCache('w1');
    expect(saved?.firstUnused).toBe(3);
    expect(saved?.unused.map((a) => a.index)).toEqual([3, 4, 5]);
    expect(saved?.used.map((a) => a.index)).toEqual([2, 1, 0]);
    expect(rows(r)).toBe(3);
  });

  it('after a failed sync touches nothing: no engine, the saved list on screen and on disk', async () => {
    await saveAddrCache('w1', SAVED);
    mockWorld.sync = async () => {
      throw new Error('Electrum client error: unexpected end of file');
    };
    const r = await open();
    expect(mockGetEngine).not.toHaveBeenCalled();
    expect(mockEngine.getReceiveAddress).not.toHaveBeenCalled();
    expect(mockEngine.listUtxos).not.toHaveBeenCalled();
    expect(await loadAddrCache('w1')).toEqual(SAVED);
    expect(rows(r)).toBe(3);
    expect(text(r)).not.toContain(ADDRESSES_NOT_CHECKED);
    expect(hosts(r, 'ActivityIndicator')).toHaveLength(0);
  });

  it('a failed sync with nothing saved says so with Try again, never "No Addresses Found"', async () => {
    mockWorld.sync = async () => {
      throw new Error('Connection refused (os error 61)');
    };
    const r = await open();
    expect(await loadAddrCache('w1')).toBeNull();
    expect(text(r)).toContain(ADDRESSES_NOT_CHECKED);
    expect(text(r)).not.toContain('No Addresses Found');
    expect(buttons(r)).toEqual(['Try again']);
  });

  it('the same with a saved used list and no unused address left in it', async () => {
    await saveAddrCache('w1', { ...SAVED, used: [{ address: 'bc1used', index: 9 }] });
    mockWorld.sync = async () => {
      throw new Error('Connection refused (os error 61)');
    };
    const r = await open();
    expect(text(r)).toContain(ADDRESSES_NOT_CHECKED);
    expect(text(r)).not.toContain('No Addresses Found');
    expect(buttons(r)).toEqual(['Try again']);
  });

  it('Try again syncs again and fills the list, with the wheel meanwhile', async () => {
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const r = await open();
    expect(hosts(r, 'PageFooter')).toHaveLength(1);
    let finish!: () => void;
    mockWorld.sync = () => new Promise<void>((done) => (finish = done));
    await act(async () => (hosts(r, 'Button')[0].props.onPress as () => void)());
    await settle();
    expect(hosts(r, 'ActivityIndicator')).toHaveLength(1);
    expect(text(r)).not.toContain('No Addresses Found');
    expect(hosts(r, 'Button')).toHaveLength(0);
    await act(async () => finish());
    await settle();
    expect(mockSyncWallet).toHaveBeenCalledTimes(2);
    expect(rows(r)).toBe(3);
    expect(text(r)).not.toContain(ADDRESSES_NOT_CHECKED);
    expect((await loadAddrCache('w1'))?.firstUnused).toBe(3);
  });

  describe('an engine that fails after a finished sync', () => {
    const real = mockEngine.getReceiveAddress.getMockImplementation()!;
    const refuses = () =>
      mockEngine.getReceiveAddress.mockImplementation(async (which) => {
        if (which === 'lastUnused') throw new Error('Electrum client error: unexpected end of file');
        return real(which);
      });
    const escaped: unknown[] = [];
    const onEscape = (e: unknown) => escaped.push(e);
    beforeEach(() => {
      escaped.length = 0;
      process.on('unhandledRejection', onEscape);
    });
    afterEach(() => {
      process.off('unhandledRejection', onEscape);
      mockEngine.getReceiveAddress.mockImplementation(real);
    });

    it('with nothing saved reads as a failed sync: the line and Try again, nothing thrown', async () => {
      refuses();
      const r = await open();
      await new Promise((done) => setImmediate(done));
      expect(text(r)).toEqual([ADDRESSES_NOT_CHECKED]);
      expect(buttons(r)).toEqual(['Try again']);
      expect(escaped).toEqual([]);
    });

    it('Try again, the engine answering by then, fills the list', async () => {
      refuses();
      const r = await open();
      mockEngine.getReceiveAddress.mockImplementation(real);
      await act(async () => (hosts(r, 'Button')[0].props.onPress as () => void)());
      await settle();
      expect(rows(r)).toBe(3);
      expect(buttons(r)).toEqual([]);
      expect(escaped).toEqual([]);
    });

    it('with a saved list leaves it alone, on screen and on disk', async () => {
      await saveAddrCache('w1', SAVED);
      refuses();
      const r = await open();
      expect(rows(r)).toBe(3);
      expect(buttons(r)).toEqual([]);
      expect(await loadAddrCache('w1')).toEqual(SAVED);
      expect(escaped).toEqual([]);
    });

    it('a refusal part way through the list writes none of it', async () => {
      await saveAddrCache('w1', SAVED);
      mockEngine.getReceiveAddress.mockImplementation(async (which) => {
        if (which === 1) throw new Error('the library would not answer');
        return real(which);
      });
      await open();
      expect(await loadAddrCache('w1')).toEqual(SAVED);
      expect(escaped).toEqual([]);
    });
  });

  it('an old pool loses what its own used list names', async () => {
    await saveAddrCache('w1', {
      firstUnused: 0,
      unused: [0, 1, 2, 3, 4, 5, 6].map((index) => ({ address: `bc1qaddress${index}`, index })),
      used: [{ address: 'bc1qaddress4', index: 4, balanceSats: 1000 }],
      updatedAt: 1,
    });
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const r = await open();
    expect(rows(r)).toBe(2);
    expect((await loadAddrCache('w1'))?.unused.map((a) => a.index)).toEqual([5, 6]);
  });

  it('a vault with no addresses yet still reads as empty, once its sync finished', async () => {
    mockEngine.getReceiveAddress.mockImplementationOnce(async () => mockAt(0));
    const r = await open();
    expect(text(r)).not.toContain(ADDRESSES_NOT_CHECKED);
  });
});
