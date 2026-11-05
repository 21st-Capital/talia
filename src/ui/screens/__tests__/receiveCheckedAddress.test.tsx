/**
 * Receive never offers an address it has not checked (decided 2026-10-30).
 *
 * The engine's database is in memory, so before a vault's first sync of a
 * launch, or after a failed one (offline, a home node off), a vault with
 * history answers index 0, an address already paid, and the first load took
 * that answer, wrote it over the good saved address and saved a pool of paid
 * addresses 0..9 for the ↻. The screen is mounted for real, with an engine
 * that answers exactly that way; the page components are plain hosts.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

/** What the mocks read: the vault's history, and how its sync goes. */
const mockWorld = {
  /** The first unused address once the engine has synced. */
  firstUnused: 7,
  synced: false,
  wallet: {
    id: 'w1',
    label: 'Savings',
    descriptor: 'wpkh([d34db33f/84h/0h/0h]xpub/0/*)',
    network: 'bitcoin',
    kind: 'single',
    source: 'generic',
    transport: 'paste',
    createdAt: 1,
  } as Record<string, unknown>,
  /** The next `syncWallet`: answered by the test. */
  sync: async (): Promise<void> => undefined,
};
const mockAt = (index: number) => ({ address: `bc1qaddress${index}`, index, uri: `bitcoin:bc1qaddress${index}` });
const mockEngine = {
  /** The real engine's answer: it knows nothing before a finished sync. */
  getReceiveAddress: jest.fn(async (which: 'new' | 'lastUnused' | number) => {
    if (typeof which === 'number') return mockAt(which);
    if (!mockWorld.synced) return mockAt(0);
    return mockAt(which === 'new' ? mockWorld.firstUnused + 1 : mockWorld.firstUnused);
  }),
};
const mockSyncWallet = jest.fn(async () => {
  await mockWorld.sync();
  mockWorld.synced = true;
  return mockEngine;
});
const mockGetEngine = jest.fn(async () => mockEngine);

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  ActivityIndicator: 'ActivityIndicator',
  TouchableOpacity: 'TouchableOpacity',
  InteractionManager: {
    runAfterInteractions: (f: () => void) => {
      f();
      return { cancel: () => undefined };
    },
  },
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@react-native-async-storage/async-storage', () => require('../../../testing/memoryAsyncStorage'));
jest.mock('../../components', () => {
  const R = require('react');
  const host =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      R.createElement(name, p, children);
  return {
    Screen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) =>
      R.createElement('Screen', null, children, R.createElement('Footer', null, footer)),
    AddressChunks: host('AddressChunks'),
    BrandedQr: host('BrandedQr'),
    HeaderIconButton: host('HeaderIconButton'),
    ShareRow: host('ShareRow'),
    CopiedFlash: host('CopiedFlash'),
    AppDialog: host('AppDialog'),
    ConsentCheckbox: host('ConsentCheckbox'),
    CopyIcon: host('CopyIcon'),
    InfoHeading: host('InfoHeading'),
    RefreshIcon: host('RefreshIcon'),
    Gloss: host('Gloss'),
    cardGlow: () => 0,
    Button: (p: { title: string; onPress: () => void; disabled?: boolean }) =>
      R.createElement('Button', { title: p.title, onPress: p.onPress, disabled: !!p.disabled }),
  };
});
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../../wallet', () => {
  const cache = require('../../../wallet/addrCache');
  return {
    useWallets: () => ({
      getWallet: () => mockWorld.wallet,
      getEngine: mockGetEngine,
      syncWallet: mockSyncWallet,
      updateWallet: async () => undefined,
    }),
    loadAddrCache: cache.loadAddrCache,
    saveAddrCache: cache.saveAddrCache,
    ADDRESSES_NOT_CHECKED: cache.ADDRESSES_NOT_CHECKED,
    ADDRESS_CHECK_PATIENCE_MS: cache.ADDRESS_CHECK_PATIENCE_MS,
    addressCheckOffered: () => true,
  };
});
jest.mock('../../../wallet/deviceKinds', () => ({ deviceName: () => 'Ledger' }));
jest.mock('../../hooks/useProviderFingerprints', () => ({ useProviderFingerprints: () => ({ providerFps: [] }) }));
jest.mock('../../../config', () => ({ HWW_ENABLED: true, LEDGER_PREVIEW: false, SIGNING_ENABLED: true }));
jest.mock('../../../platform/clipboard', () => ({ copyToClipboard: () => undefined }));
jest.mock('../../../platform/files', () => ({ shareVia: async () => undefined }));
jest.mock('../../../services/companyAuth', () => ({ loadSession: async () => null }));
jest.mock('../../../services/cosign', () => ({ recordUntestedVaultAck: async () => undefined }));
jest.mock('../../../services/vaultTesting', () => ({ checkVaultTested: async () => null, vaultTestingQuery: () => null }));
jest.mock('../../../wallet/addressCheckStore', () => ({
  addressCheckVerdict: () => null,
  onAddressCheck: () => () => undefined,
  reportAddressMismatch: () => undefined,
}));
jest.mock('../../../bitcoin/engine/addressCheck', () => ({
  blocksReceive: () => false,
  RECEIVE_PAUSED_TITLE: 'Paused',
  shownCheckShows: (r: { kind: string } | null) => r?.kind === 'match',
  verifyPinnedAddress: async () => ({ kind: 'match' }),
  verifyShownAddress: () => ({ kind: 'match' }),
}));

import { ReceiveScreen } from '../ReceiveScreen';
import { ADDRESSES_NOT_CHECKED, ADDRESS_CHECK_PATIENCE_MS, loadAddrCache, saveAddrCache } from '../../../wallet/addrCache';
import type { AddressCache } from '../../../wallet/addrCache';

const storage = require('@react-native-async-storage/async-storage').default as {
  setItem: (k: string, v: string) => Promise<void>;
  __clear: () => void;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const settle = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) await new Promise((done) => setImmediate(done));
  });

/** What an earlier launch saved: its first unused address and the pool after it. */
const SAVED: AddressCache = {
  firstUnused: 5,
  unused: [5, 6, 7].map((index) => ({ address: `bc1qaddress${index}`, index })),
  used: [{ address: 'bc1qaddress4', index: 4, balanceSats: 1000 }],
  updatedAt: 1,
};
const saveSaved = (cache: AddressCache = SAVED) => saveAddrCache('w1', cache);

const nav = () => ({ setOptions: jest.fn(), setParams: jest.fn(), navigate: jest.fn(), goBack: jest.fn() });
type Nav = ReturnType<typeof nav>;

let mounted: TestRenderer.ReactTestRenderer | null = null;
async function open(navigation: Nav = nav(), params: Record<string, unknown> = {}): Promise<TestRenderer.ReactTestRenderer> {
  await act(async () => {
    mounted = TestRenderer.create(
      <ReceiveScreen navigation={navigation as never} route={{ key: 'r', name: 'Receive', params: { walletId: 'w1', ...params } } as never} />,
    );
  });
  await settle();
  return mounted!;
}

const hosts = (r: TestRenderer.ReactTestRenderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type);
const shown = (r: TestRenderer.ReactTestRenderer) => hosts(r, 'AddressChunks')[0]?.props.address as string | undefined;
const qr = (r: TestRenderer.ReactTestRenderer) => hosts(r, 'BrandedQr')[0]?.props.value as string | undefined;
const buttons = (r: TestRenderer.ReactTestRenderer) => hosts(r, 'Button').map((b) => b.props.title as string);
const button = (r: TestRenderer.ReactTestRenderer, title: string) =>
  hosts(r, 'Button').find((b) => b.props.title === title)!.props.onPress as () => void;
const text = (r: TestRenderer.ReactTestRenderer) =>
  hosts(r, 'Text')
    .flatMap((t) => t.children)
    .filter((c): c is string => typeof c === 'string');
const namedAddresses = () => mockEngine.getReceiveAddress.mock.calls.map(([which]) => which);
/** The ↻, as the header holds it now. */
const refresh = (navigation: Nav) => {
  const { headerRight } = navigation.setOptions.mock.lastCall![0] as { headerRight: () => React.ReactElement<{ onPress: () => Promise<void> }> };
  return headerRight().props.onPress();
};

beforeEach(() => {
  storage.__clear();
  mockWorld.synced = false;
  mockWorld.firstUnused = 7;
  mockWorld.sync = async () => undefined;
  mockEngine.getReceiveAddress.mockClear();
  mockSyncWallet.mockClear();
  mockGetEngine.mockClear();
});
afterEach(async () => {
  await act(async () => mounted?.unmount());
  mounted = null;
});

describe('the first load', () => {
  it('shows no address while the sync runs: the saved one may have been paid since', async () => {
    await saveSaved();
    let finish!: () => void;
    mockWorld.sync = () => new Promise<void>((done) => (finish = done));
    const r = await open();
    expect(mockSyncWallet).toHaveBeenCalledTimes(1);
    expect(namedAddresses()).toEqual([]);
    expect(shown(r)).toBeUndefined();
    expect(qr(r)).toBeUndefined();
    expect(hosts(r, 'ActivityIndicator')).toHaveLength(1);
    // Nothing is offered for an address that may still change.
    expect(buttons(r)).toEqual([]);

    await act(async () => finish());
    await settle();
    expect(shown(r)).toBe('bc1qaddress7');
    expect(qr(r)).toBe('bitcoin:bc1qaddress7');
    expect(buttons(r)).toContain('Verify on Hardware');
  });

  describe('a check that takes too long', () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
    afterEach(() => jest.useRealTimers());
    const wait = (ms: number) =>
      act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
      });

    it('shows the saved address at the limit and not before, and offers nothing that may change', async () => {
      await saveSaved();
      mockWorld.sync = () => new Promise<void>(() => undefined);
      const r = await open();
      await wait(ADDRESS_CHECK_PATIENCE_MS - 1);
      expect(shown(r)).toBeUndefined();
      await wait(1);
      await settle();
      expect(shown(r)).toBe('bc1qaddress5');
      expect(qr(r)).toBe('bitcoin:bc1qaddress5');
      expect(buttons(r)).toEqual([]);
    });

    it('swaps it if the check then says it was paid', async () => {
      await saveSaved();
      let finish!: () => void;
      mockWorld.sync = () => new Promise<void>((done) => (finish = done));
      const r = await open();
      await wait(ADDRESS_CHECK_PATIENCE_MS);
      await settle();
      expect(shown(r)).toBe('bc1qaddress5');
      await act(async () => finish());
      await settle();
      expect(shown(r)).toBe('bc1qaddress7');
      expect(qr(r)).toBe('bitcoin:bc1qaddress7');
    });

    it('with nothing saved keeps its spinner until the check ends', async () => {
      mockWorld.sync = () => new Promise<void>(() => undefined);
      const r = await open();
      await wait(ADDRESS_CHECK_PATIENCE_MS * 2);
      await settle();
      expect(shown(r)).toBeUndefined();
      expect(hosts(r, 'ActivityIndicator')).toHaveLength(1);
      expect(text(r)).not.toContain(ADDRESSES_NOT_CHECKED);
    });

    it('a check that ends in time leaves no timer behind to paint over it', async () => {
      await saveSaved();
      const r = await open();
      expect(shown(r)).toBe('bc1qaddress7');
      await wait(ADDRESS_CHECK_PATIENCE_MS * 2);
      await settle();
      expect(shown(r)).toBe('bc1qaddress7');
    });
  });

  it('a finished sync: the first unused address, and the pool refilled from it', async () => {
    await saveSaved();
    const r = await open();
    expect(shown(r)).toBe('bc1qaddress7');
    expect(namedAddresses()).toEqual(['lastUnused', 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const saved = await loadAddrCache('w1');
    expect(saved?.firstUnused).toBe(7);
    expect(saved?.unused.map((a) => a.index)).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(saved?.used).toEqual(SAVED.used);
  });

  it('a failed sync keeps the saved address: no paid address, nothing asked, nothing saved over it', async () => {
    await saveSaved();
    mockWorld.sync = async () => {
      throw new Error('Electrum client error: unexpected end of file');
    };
    const r = await open();
    expect(shown(r)).toBe('bc1qaddress5');
    expect(qr(r)).toBe('bitcoin:bc1qaddress5');
    expect(namedAddresses()).toEqual([]);
    expect(await loadAddrCache('w1')).toEqual(SAVED);
    expect(text(r).join(' ')).not.toMatch(/Could not|Electrum/);
    // Settled: the address on show will not change under the check.
    expect(buttons(r)).toContain('Verify on Hardware');
  });

  it('a failed sync with nothing saved shows no address, one plain line and Try again', async () => {
    mockWorld.sync = async () => {
      throw new Error('Connection refused (os error 61)');
    };
    const r = await open();
    expect(shown(r)).toBeUndefined();
    expect(qr(r)).toBeUndefined();
    expect(hosts(r, 'ActivityIndicator')).toHaveLength(0);
    expect(namedAddresses()).toEqual([]);
    expect(await loadAddrCache('w1')).toBeNull();
    expect(text(r)).toContain(ADDRESSES_NOT_CHECKED);
    expect(buttons(r)).toEqual(['Try again']);
    expect(ADDRESSES_NOT_CHECKED).not.toMatch(/—|input|output|server error/i);
  });

  it('Try again syncs again, and a sync that works shows the checked address', async () => {
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const r = await open();
    let finish!: () => void;
    mockWorld.sync = () => new Promise<void>((done) => (finish = done));
    await act(async () => button(r, 'Try again')());
    await settle();
    // Asking again: the wheel, not the same refusal.
    expect(mockSyncWallet).toHaveBeenCalledTimes(2);
    expect(text(r)).not.toContain(ADDRESSES_NOT_CHECKED);
    expect(hosts(r, 'ActivityIndicator')).toHaveLength(1);
    await act(async () => finish());
    await settle();
    expect(shown(r)).toBe('bc1qaddress7');
    expect(buttons(r)).not.toContain('Try again');
  });

  it('Try again that fails again comes back to the line', async () => {
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const r = await open();
    await act(async () => button(r, 'Try again')());
    await settle();
    expect(mockSyncWallet).toHaveBeenCalledTimes(2);
    expect(text(r)).toContain(ADDRESSES_NOT_CHECKED);
    expect(namedAddresses()).toEqual([]);
  });

  describe('an engine that fails after a finished sync', () => {
    const real = mockEngine.getReceiveAddress.getMockImplementation()!;
    const refuses = () =>
      mockEngine.getReceiveAddress.mockImplementation(async (which) => {
        if (which === 'lastUnused') throw new Error('Electrum client error: unexpected end of file');
        return real(which);
      });
    afterEach(() => mockEngine.getReceiveAddress.mockImplementation(real));

    it('keeps the saved address, as a failed sync does: never the library text', async () => {
      await saveSaved();
      refuses();
      const r = await open();
      expect(shown(r)).toBe('bc1qaddress5');
      expect(qr(r)).toBe('bitcoin:bc1qaddress5');
      expect(text(r).join(' ')).not.toMatch(/Could not|Electrum/);
      expect(await loadAddrCache('w1')).toEqual(SAVED);
      expect(buttons(r)).toEqual(['Verify on Hardware']);
    });

    it('with nothing saved: the one line and Try again', async () => {
      refuses();
      const r = await open();
      expect(shown(r)).toBeUndefined();
      expect(text(r)).toEqual([ADDRESSES_NOT_CHECKED]);
      expect(buttons(r)).toEqual(['Try again']);
    });
  });

  describe('a pool an earlier build saved from an engine that had not synced', () => {
    const fails = () => {
      mockWorld.sync = async () => {
        throw new Error('Connection refused (os error 61)');
      };
    };
    const pool = (indexes: number[]) => indexes.map((index) => ({ address: `bc1qaddress${index}`, index }));

    it('offers nothing its own used list names, and a failed sync lands past them', async () => {
      await saveSaved({
        firstUnused: 0,
        unused: pool([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
        used: [4, 3, 2, 1, 0].map((index) => ({ address: `bc1qaddress${index}`, index, balanceSats: 0 })),
        updatedAt: 1,
      });
      fails();
      const r = await open();
      expect(shown(r)).toBe('bc1qaddress5');
    });

    it('with no address left, says it could not check rather than show a paid one', async () => {
      await saveSaved({ firstUnused: 0, unused: pool([0, 1, 2]), used: [{ address: 'bc1qaddress4', index: 4, balanceSats: 1000 }], updatedAt: 1 });
      fails();
      const r = await open();
      expect(shown(r)).toBeUndefined();
      expect(text(r)).toEqual([ADDRESSES_NOT_CHECKED]);
      expect(buttons(r)).toEqual(['Try again']);
    });
  });

  it('a screen closed during the sync asks nothing afterwards', async () => {
    await saveSaved();
    let finish!: () => void;
    mockWorld.sync = () => new Promise<void>((done) => (finish = done));
    const r = await open();
    await act(async () => r.unmount());
    mounted = null;
    await act(async () => finish());
    await settle();
    expect(namedAddresses().filter((w) => typeof w === 'number')).toEqual([]);
    expect(await loadAddrCache('w1')).toEqual(SAVED);
  });
});

describe('a pinned address stays as it is', () => {
  it('no sync, no derivation, the address it was opened on', async () => {
    await saveSaved();
    const r = await open(nav(), { address: 'bc1qpinned', index: 3 });
    expect(mockSyncWallet).not.toHaveBeenCalled();
    expect(namedAddresses()).toEqual([]);
    expect(shown(r)).toBe('bc1qpinned');
    expect(buttons(r)).toContain('Verify on Hardware');
  });
});

describe('the ↻', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }));
  afterEach(() => jest.useRealTimers());

  const press = async (navigation: Nav) => {
    await act(async () => {
      void refresh(navigation);
      await jest.advanceTimersByTimeAsync(2000);
    });
    await settle();
  };

  describe('while the first load is still checking', () => {
    const slowCheck = async (navigation: Nav) => {
      await saveSaved();
      let finish!: () => void;
      mockWorld.sync = () => new Promise<void>((done) => (finish = done));
      const r = await open(navigation);
      return { r, finish: () => finish() };
    };
    const pastPatience = async () => {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(ADDRESS_CHECK_PATIENCE_MS);
      });
      await settle();
    };
    const pressNoWait = async (navigation: Nav) => {
      await act(async () => {
        void refresh(navigation);
      });
      await settle();
    };

    it('does nothing and reads as idle under the spinner, with no address to step on from', async () => {
      const navigation = nav();
      const { r } = await slowCheck(navigation);
      const header = navigation.setOptions.mock.lastCall![0] as { headerRight: () => React.ReactElement<{ disabled: boolean }> };
      expect(header.headerRight().props.disabled).toBe(true);
      await press(navigation);
      expect(shown(r)).toBeUndefined();
      expect(namedAddresses()).toEqual([]);
    });

    it('steps on from the saved address at once, as it does offline', async () => {
      const navigation = nav();
      const { r } = await slowCheck(navigation);
      await pastPatience();
      await press(navigation);
      expect(shown(r)).toBe('bc1qaddress6');
      expect(qr(r)).toBe('bitcoin:bc1qaddress6');
      expect(mockSyncWallet).toHaveBeenCalledTimes(1);
    });

    it('an address the check proves paid goes when the check lands', async () => {
      const navigation = nav();
      const { r, finish } = await slowCheck(navigation);
      await pastPatience();
      await press(navigation); // 6, and the check will say 7
      await act(async () => finish());
      await settle();
      expect(shown(r)).toBe('bc1qaddress7');
      expect(qr(r)).toBe('bitcoin:bc1qaddress7');
      await press(navigation);
      expect(shown(r)).toBe('bc1qaddress8');
    });

    it('an address the check leaves unpaid stays, and the ↻ goes on from it', async () => {
      const navigation = nav();
      const { r, finish } = await slowCheck(navigation);
      mockWorld.firstUnused = 5;
      await pastPatience();
      await press(navigation); // 6, above the check's 5
      await act(async () => finish());
      await settle();
      expect(shown(r)).toBe('bc1qaddress6');
      await press(navigation);
      expect(shown(r)).toBe('bc1qaddress7');
    });

    it('a refill a tap started before the check landed never brings back what the check proved paid', async () => {
      await saveSaved({ ...SAVED, unused: SAVED.unused.slice(0, 1) });
      const real = mockEngine.getReceiveAddress.getMockImplementation()!;
      let release!: () => void;
      const queued = new Promise<void>((done) => (release = done));
      mockEngine.getReceiveAddress.mockImplementation(async (which) => {
        if (which === 5) await queued;
        return real(which);
      });
      let finish!: () => void;
      mockWorld.firstUnused = 20;
      mockWorld.sync = () => new Promise<void>((done) => (finish = done));
      const navigation = nav();
      const r = await open(navigation);
      await pastPatience();
      await pressNoWait(navigation); // the refill from 5 waits on the queue
      await act(async () => finish());
      await settle();
      expect(shown(r)).toBe('bc1qaddress20');
      await act(async () => release());
      await settle();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });
      await settle();
      expect(Number(shown(r)!.replace('bc1qaddress', ''))).toBeGreaterThanOrEqual(20);
      expect(qr(r)).toBe(`bitcoin:${shown(r)}`);
      const saved = await loadAddrCache('w1');
      expect(saved?.unused.map((a) => a.index)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
      mockEngine.getReceiveAddress.mockImplementation(real);
    });

    it('a check landing in the middle of a scramble ends it: the text never parts from the QR', async () => {
      const navigation = nav();
      const { r, finish } = await slowCheck(navigation);
      await pastPatience();
      await pressNoWait(navigation); // scrambling towards 6
      await act(async () => finish());
      await settle();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });
      await settle();
      expect(qr(r)).toBe('bitcoin:bc1qaddress7');
      expect(shown(r)).toBe('bc1qaddress7');
      expect(buttons(r)).toContain('Verify on Hardware');
    });
  });

  it('after a failed sync it still steps through the saved addresses', async () => {
    await saveSaved();
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation);
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress6');
    expect(qr(r)).toBe('bitcoin:bc1qaddress6');
    expect(namedAddresses()).toEqual([]);
  });

  it('with one saved address and no server it counts on from that address, never from the top of an unsynced engine', async () => {
    await saveSaved({ ...SAVED, unused: SAVED.unused.slice(0, 1) });
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation);
    await press(navigation);
    expect(namedAddresses()).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(shown(r)).toBe('bc1qaddress6');
    expect(qr(r)).toBe('bitcoin:bc1qaddress6');
    const saved = await loadAddrCache('w1');
    expect(saved?.used).toEqual(SAVED.used);
    expect(saved?.unused[0].index).toBe(5);
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress7');
  });

  it('with no address to give at all it leaves the page as it is', async () => {
    await saveSaved({ ...SAVED, unused: SAVED.unused.slice(0, 1) });
    const real = mockEngine.getReceiveAddress.getMockImplementation()!;
    mockEngine.getReceiveAddress.mockImplementation(async () => {
      throw new Error('the library would not answer');
    });
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation);
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress5');
    expect(qr(r)).toBe('bitcoin:bc1qaddress5');
    mockEngine.getReceiveAddress.mockImplementation(real);
  });

  it('on a pinned page it asks only a synced engine', async () => {
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation, { address: 'bc1qpinned', index: 3 });
    await press(navigation);
    expect(namedAddresses()).toEqual([]);
    expect(shown(r)).toBe('bc1qpinned');
  });

  it('on a pinned page with no server it takes the saved addresses, and never counts on from the pinned one, which may be paid', async () => {
    await saveSaved();
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation, { address: 'bc1qpinned', index: 3 });
    await press(navigation);
    expect(namedAddresses()).toEqual([]);
    expect(shown(r)).toBe('bc1qaddress5');
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress6');
  });

  it('on a page pinned to the first saved address with no server it moves on from it', async () => {
    await saveSaved();
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation, { address: 'bc1qaddress5', index: 5 });
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress6');
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress7');
  });

  it('once a pinned page has left its address, it counts on from the saved one it reached', async () => {
    await saveSaved({ ...SAVED, unused: SAVED.unused.slice(0, 1) });
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation, { address: 'bc1qpinned', index: 2 });
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress5');
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress6');
  });

  it('a pinned page asks the server again once it has one: the saved pool may be out of date', async () => {
    await saveSaved();
    let offline = true;
    mockWorld.sync = async () => {
      if (offline) throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation, { address: 'bc1qpinned', index: 3 });
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress5');
    offline = false;
    await press(navigation);
    expect(mockSyncWallet).toHaveBeenCalledTimes(2);
    expect(shown(r)).toBe('bc1qaddress8');
  });

  describe('after a finished sync it never steps onto an address that sync proved paid', () => {
    const real = mockEngine.getReceiveAddress.getMockImplementation()!;
    afterEach(() => mockEngine.getReceiveAddress.mockImplementation(real));

    it('with the refill still queued behind another vault\'s sync', async () => {
      await saveSaved(); // 5, 6, 7 from an earlier launch; the sync says 7
      let release!: () => void;
      const queued = new Promise<void>((done) => (release = done));
      mockEngine.getReceiveAddress.mockImplementation(async (which) => {
        if (typeof which === 'number') await queued;
        return real(which);
      });
      const navigation = nav();
      const r = await open(navigation);
      expect(shown(r)).toBe('bc1qaddress7');
      // The pool holds the address on show alone until the refill comes.
      await press(navigation);
      expect(shown(r)).toBe('bc1qaddress7');
      expect(buttons(r)).toEqual([]);
      release();
      await settle();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });
      await settle();
      expect(shown(r)).toBe('bc1qaddress8');
      expect(qr(r)).toBe('bitcoin:bc1qaddress8');
    });

    it('with a refill that failed: the pool lost them anyway, on disk too', async () => {
      await saveSaved();
      mockEngine.getReceiveAddress.mockImplementation(async (which) => {
        if (typeof which === 'number') throw new Error('the library would not answer');
        return real(which);
      });
      const navigation = nav();
      const r = await open(navigation);
      await press(navigation);
      expect(shown(r)).toBe('bc1qaddress8');
      const saved = await loadAddrCache('w1');
      expect(saved?.firstUnused).toBe(7);
      expect(saved?.unused.map((a) => a.index)).toEqual([7]);
      expect(saved?.used).toEqual(SAVED.used);
    });

    it('keeps what stands above the first unused address, and the ↻ goes on through it', async () => {
      await saveSaved({ ...SAVED, unused: [5, 6, 7, 8, 9].map((index) => ({ address: `bc1qaddress${index}`, index })) });
      mockEngine.getReceiveAddress.mockImplementation(async (which) => {
        if (typeof which === 'number') throw new Error('the library would not answer');
        return real(which);
      });
      const navigation = nav();
      const r = await open(navigation);
      expect(shown(r)).toBe('bc1qaddress7');
      await press(navigation);
      expect(shown(r)).toBe('bc1qaddress8');
      expect(namedAddresses()).not.toContain('new');
    });
  });

  it('on the page with no address it is Try again: nothing derived for nobody, and a server that came back shows its address', async () => {
    let failing = true;
    mockWorld.sync = async () => {
      if (failing) throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation);
    expect(text(r)).toContain(ADDRESSES_NOT_CHECKED);
    failing = false;
    await press(navigation);
    expect(namedAddresses()).not.toContain('new');
    expect(mockSyncWallet).toHaveBeenCalledTimes(2);
    expect(shown(r)).toBe('bc1qaddress7');
    expect(text(r)).not.toContain(ADDRESSES_NOT_CHECKED);
    expect(buttons(r)).toEqual(['Verify on Hardware']);
  });

  it('a sync that fails changes nothing: the same address keeps its match from the device', async () => {
    mockWorld.sync = async () => {
      throw new Error('offline');
    };
    const navigation = nav();
    const r = await open(navigation, {
      address: 'bc1qpinned',
      index: 3,
      verdict: { kind: 'match', address: 'bc1qpinned', device: 'ledger' },
    });
    await settle();
    expect(text(r).join(' ')).toContain('shows the same address');
    await press(navigation);
    expect(shown(r)).toBe('bc1qpinned');
    expect(text(r).join(' ')).toContain('shows the same address');
    expect(buttons(r)).toEqual([]);
  });

  it('a new address still clears the match: it belongs to the address it judged', async () => {
    const navigation = nav();
    const r = await open(navigation, {
      address: 'bc1qpinned',
      index: 3,
      verdict: { kind: 'match', address: 'bc1qpinned', device: 'ledger' },
    });
    await settle();
    await press(navigation);
    expect(shown(r)).toBe('bc1qaddress8');
    expect(text(r).join(' ')).not.toContain('shows the same address');
    expect(buttons(r)).toEqual(['Verify on Hardware']);
  });

  it('a slow sync: no scramble, the text and the QR stay together, and only then the new address', async () => {
    let finish!: () => void;
    const navigation = nav();
    const r = await open(navigation, { address: 'bc1qpinned', index: 3 });
    mockWorld.sync = () => new Promise<void>((done) => (finish = done));
    await act(async () => {
      void refresh(navigation);
      await jest.advanceTimersByTimeAsync(60_000);
    });
    await settle();
    expect(shown(r)).toBe('bc1qpinned');
    expect(qr(r)).toBe('bitcoin:bc1qpinned');
    // The address is about to change, so nothing is checked against it.
    expect(buttons(r)).toEqual([]);
    // A second tap asks nothing more.
    await act(async () => {
      void refresh(navigation);
    });
    expect(mockSyncWallet).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
      await jest.advanceTimersByTimeAsync(2000);
    });
    await settle();
    expect(shown(r)).toBe('bc1qaddress8');
    expect(qr(r)).toBe('bitcoin:bc1qaddress8');
    expect(buttons(r)).toEqual(['Verify on Hardware']);
  });

  describe('on a change coin\'s page', () => {
    const check = () => jest.spyOn(require('../../../bitcoin/engine/addressCheck'), 'verifyShownAddress');

    it('the coin\'s own address is checked on its keychain', async () => {
      const spy = check();
      await open(nav(), { address: 'bc1qchange', index: 3, keychain: 'internal' });
      expect(spy.mock.calls.map((c) => c.slice(1))).toEqual([['internal', 3, 'bc1qchange']]);
      spy.mockRestore();
    });

    it('the ↻ brings a receive address, checked as one: no false mismatch to pause the vault', async () => {
      const spy = check();
      const navigation = nav();
      await open(navigation, { address: 'bc1qchange', keychain: 'internal' });
      await press(navigation);
      expect(spy.mock.calls.map((c) => c.slice(1))).toEqual([['external', 8, 'bc1qaddress8']]);
      spy.mockRestore();
    });
  });
});
