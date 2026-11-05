/**
 * No sync before the settings are read (the network rules, decided
 * 2026-10-18: "we should never leak their vaults to any other node").
 *
 * Until `loadSettings` settles, the provider's settings are the defaults,
 * whose Bitcoin server is the public one. The strict-invite release upkeep
 * starts as soon as the VAULT LIST is in, which can be first, and it syncs
 * at once: a client whose saved server is their home node had those vaults
 * synced through electrum.blockstream.info. And when the store did not
 * answer at all, the settings were never read, but the upkeep synced all
 * the same.
 *
 * The provider is mounted for real, with its sync, its upkeep and the real
 * server rule (wallet/chainServers.ts); storage, the engine and the services
 * around it are replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const HOME_NODE = 'ssl://homenode.local:50002';

const mockSynced: string[] = [];
const mockEngine = {
  sync: jest.fn(async (backend: { url: string }) => {
    mockSynced.push(backend.url);
  }),
  listTransactions: jest.fn(async () => []),
  getTipHeight: () => undefined,
};
const mockVault = {
  id: 'w_home',
  label: 'Savings',
  descriptor: 'wpkh([d34db33f/84h/0h/0h]xpub/0/*)',
  network: 'bitcoin',
  kind: 'single',
  source: 'generic',
  transport: 'paste',
  createdAt: 1,
};
const mockLoads: { settings: () => Promise<unknown> } = { settings: async () => ({}) };
/** What each engine was opened with (the vault's servers among it). */
const mockOpened: Array<{ chainServers?: () => Promise<ReadonlyArray<{ url: string }>> }> = [];
/** The next engine's opening, when a test holds it open; `copies`: each opening its own object. */
const mockMaking: { hold: Promise<void> | null; copies: boolean } = { hold: null, copies: false };

jest.mock('react-native', () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Linking: { addEventListener: () => ({ remove: () => undefined }), getInitialURL: async () => null },
  InteractionManager: { runAfterInteractions: () => ({ cancel: () => undefined }) },
}));
jest.mock('../storage', () => ({
  DEFAULT_SETTINGS: {
    themeMode: 'system',
    defaultNetwork: 'bitcoin',
    backendType: 'electrum',
    electrumUrls: {},
    unit: 'btc',
    fiat: 'USD',
    hideBalances: false,
    biometricsEnabled: false,
    requireAuthOnOpen: false,
    requireAuthToUnhide: false,
    hiddenCategories: [],
  },
  loadSettings: () => mockLoads.settings(),
  loadWallets: async () => [mockVault],
  saveWallets: async () => undefined,
  saveSettings: async () => undefined,
  newWalletId: () => 'w_new',
}));
jest.mock('../sealedStore', () => ({ isSealedStoreError: () => false, startOverSealedStore: async () => undefined }));
jest.mock('../engineProvider', () => ({
  USE_FAKE_ENGINE: false,
  getEngineFactory: async () => ({
    create: async (params: (typeof mockOpened)[number]) => {
      mockOpened.push(params);
      await mockMaking.hold;
      return mockMaking.copies ? { ...mockEngine } : mockEngine;
    },
  }),
}));
// The independent address check, which the provider queues for every engine
// (BDK upgrade branch): not this test's subject.
jest.mock('../addressCheckStore', () => ({
  guardedEngine: <E,>(engine: E) => engine,
  scheduleAddressCheck: async () => null,
}));
jest.mock('../txCache', () => ({ clearTxCache: async () => undefined }));
jest.mock('../addrCache', () => ({ clearAddrCache: async () => undefined }));
jest.mock('../utxoCache', () => ({ clearUtxoCache: async () => undefined }));
jest.mock('../manualEntries', () => ({
  clearManualEntries: async () => undefined,
  loadManualEntries: async () => [],
  saveManualEntries: async () => undefined,
}));
jest.mock('../coinCosts', () => ({ clearCoinCosts: async () => undefined }));
jest.mock('../txReplacements', () => ({ clearTxReplacements: async () => undefined, pruneTxReplacements: async () => undefined }));
jest.mock('../../services/virtualVaultSync', () => ({
  entryTombstoneIdsFor: () => [],
  migrateLegacyCredential: async () => false,
  recordTombstone: async () => undefined,
  runSync: async () => ({ kind: 'idle' }),
}));
jest.mock('../../services/bitboxPairing', () => ({ upgradeNoiseConfigProtection: async () => undefined }));
jest.mock('../../platform/files', () => ({ sweepExportLeftovers: async () => undefined }));
jest.mock('../../services/sharedPortfolio', () => ({ removeShareKey: async () => undefined, runSharedSync: async () => undefined }));
jest.mock('../sharedAccess', () => ({ isSharedViewer: () => false }));
jest.mock('../vaultToPortfolio', () => ({ portfolioEntriesFromHistory: () => [], toManualEntries: () => [] }));
jest.mock('../historicalPrice', () => ({ getHistoricalPoint: async () => null }));
jest.mock('../../services/companyAuth', () => ({
  loadSession: async () => ({ email: 'owner@example.com' }),
  onSessionSaved: () => () => undefined,
}));
jest.mock('../../services/heirInvite', () => ({
  // A strict invite on the vault: the upkeep syncs it at start.
  loadOwnerInvites: async () => [{ mode: 'strict', walletId: 'w_home', ownerEmail: 'owner@example.com' }],
  maybePushReleaseAt: async () => undefined,
  maybeReconcileClaimedInvites: async () => undefined,
}));
jest.mock('../../platform/notifications', () => ({
  cancelAllReminders: async () => undefined,
  hasNotificationPermission: async () => false,
  syncScheduledReminders: async () => undefined,
}));
jest.mock('../timelockReminders', () => ({ timelockReminders: () => [] }));
jest.mock('../../services/billing', () => ({
  fetchSubscriptions: async () => [],
  hasActiveSubscription: () => false,
  pollSubscriptionActive: async () => false,
}));
jest.mock('../../services/deepLinks', () => ({ isCheckoutReturnUrl: () => false }));

import { SETTINGS_NOT_READ, WalletProvider, useWallets } from '../WalletProvider';
import type { WalletMeta } from '../types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await new Promise((done) => setTimeout(done, 0));
  });

/** The provider's context, as a screen sees it. */
let ctx: ReturnType<typeof useWallets> | null = null;
function Probe(): null {
  ctx = useWallets();
  return null;
}

let mounted: TestRenderer.ReactTestRenderer | null = null;
async function mount(): Promise<void> {
  await act(async () => {
    mounted = TestRenderer.create(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
  });
  await settle();
}

beforeEach(() => {
  mockSynced.length = 0;
  mockOpened.length = 0;
  mockEngine.sync.mockClear();
  ctx = null;
});
afterEach(async () => {
  await act(async () => mounted?.unmount());
  mounted = null;
});

describe('a sync waits for the settings', () => {
  it('the start-up sync of a strict-invite vault waits, then goes to the home node, never the default', async () => {
    let read!: (s: unknown) => void;
    mockLoads.settings = () => new Promise((done) => (read = done));
    await mount();
    // The vault list is in and the upkeep has started; the settings are not.
    expect(ctx?.loading).toBe(false);
    expect(ctx?.settingsLoaded).toBe(false);
    expect(mockEngine.sync).not.toHaveBeenCalled();

    read({
      themeMode: 'system',
      defaultNetwork: 'bitcoin',
      backendType: 'electrum',
      electrumUrls: { bitcoin: HOME_NODE },
      unit: 'btc',
      fiat: 'USD',
      hideBalances: false,
      biometricsEnabled: false,
      requireAuthOnOpen: false,
      requireAuthToUnhide: false,
      hiddenCategories: [],
    });
    await settle();
    expect(mockSynced).toEqual([HOME_NODE]);
  });

  it('a sync an engine makes on its own asks the vault\'s servers once the settings are read: the home node alone', async () => {
    let read!: (s: unknown) => void;
    mockLoads.settings = () => new Promise((done) => (read = done));
    await mount();
    expect(mockOpened.length).toBeGreaterThan(0);
    const servers = mockOpened[0].chainServers!;
    let answered: ReadonlyArray<{ url: string }> | null = null;
    void servers().then((s) => (answered = s));
    await settle();
    // Not before the settings are read: until then they are the defaults.
    expect(answered).toBeNull();
    read({ defaultNetwork: 'bitcoin', backendType: 'electrum', electrumUrls: { bitcoin: HOME_NODE }, hiddenCategories: [] });
    await settle();
    expect(answered!.map((s) => s.url)).toEqual([HOME_NODE]);
  });

  it('when the store does not answer, nothing syncs at all, and a sync says why', async () => {
    mockLoads.settings = async () => {
      throw new Error('AsyncStorage: the database is locked');
    };
    await mount();
    expect(ctx?.loading).toBe(false);
    expect(ctx?.settingsLoaded).toBe(false);
    expect(mockEngine.sync).not.toHaveBeenCalled();
    await expect(ctx!.syncWallet(mockVault as unknown as WalletMeta, { force: true })).rejects.toThrow(SETTINGS_NOT_READ);
    expect(mockSynced).toEqual([]);
    // Nor may an engine reach any server on its own.
    expect(await mockOpened[0].chainServers!()).toEqual([]);
  });

  it('settings read before the vault list: syncs go straight through, to the saved server', async () => {
    mockLoads.settings = async () => ({
      defaultNetwork: 'bitcoin',
      backendType: 'electrum',
      electrumUrls: { bitcoin: HOME_NODE },
      hiddenCategories: [],
    });
    await mount();
    expect(mockSynced).toEqual([HOME_NODE]);
    await ctx!.syncWallet(mockVault as unknown as WalletMeta, { force: true });
    expect(mockSynced).toEqual([HOME_NODE, HOME_NODE]);
  });

  it('settings read as unreadable hold the Bitcoin server: nothing is asked', async () => {
    mockLoads.settings = async () => ({
      defaultNetwork: 'bitcoin',
      backendType: 'electrum',
      electrumUrls: {},
      bitcoinServerHold: { reason: 'unreadable' },
      hiddenCategories: [],
    });
    await mount();
    expect(ctx?.settingsLoaded).toBe(true);
    await expect(ctx!.syncWallet(mockVault as unknown as WalletMeta, { force: true })).rejects.toThrow(
      'No server is set for your Bitcoin vaults',
    );
    expect(mockSynced).toEqual([]);
  });
});

// Decided 2026-10-30: two screens asking at once made two engines for one
// vault, each with its own memory of the chain, and the second replaced the
// first while a sync was running on it. Receive and Addresses both sync now.
describe('one engine per vault', () => {
  const vault = mockVault as unknown as WalletMeta;
  const hold = () => {
    let open!: () => void;
    mockMaking.hold = new Promise<void>((done) => (open = done));
    return () => {
      mockMaking.hold = null;
      open();
    };
  };
  const opens = () => mockOpened.length;

  beforeEach(() => {
    mockLoads.settings = async () => ({});
  });
  afterEach(() => {
    mockMaking.hold = null;
    mockMaking.copies = false;
  });

  it('two callers at once get the one being made', async () => {
    await mount();
    await settle();
    await act(async () => ctx!.removeWallet(vault.id));
    const before = opens();
    const release = hold();
    const first = ctx!.getEngine(vault);
    const second = ctx!.getEngine(vault);
    const third = ctx!.syncWallet(vault);
    await settle();
    expect(opens()).toBe(before + 1);
    release();
    expect(await first).toBe(await second);
    expect(await third).toBe(await first);
    expect(opens()).toBe(before + 1);
    // And it is kept: later callers do not make another.
    await ctx!.getEngine(vault);
    expect(opens()).toBe(before + 1);
  });

  it('an opening that failed is forgotten: the next caller tries again', async () => {
    await mount();
    await settle();
    await act(async () => ctx!.removeWallet(vault.id));
    const before = opens();
    let refuse!: (e: Error) => void;
    mockMaking.hold = new Promise<void>((_, reject) => (refuse = reject));
    const first = ctx!.getEngine(vault);
    const second = ctx!.getEngine(vault);
    refuse(new Error('the library would not open'));
    await expect(first).rejects.toThrow('the library would not open');
    await expect(second).rejects.toThrow('the library would not open');
    mockMaking.hold = null;
    await expect(ctx!.getEngine(vault)).resolves.toBe(mockEngine);
    expect(opens()).toBe(before + 2);
  });

  it('an engine made for a descriptor that changed meanwhile is not kept', async () => {
    await mount();
    await settle();
    await act(async () => ctx!.removeWallet(vault.id));
    const release = hold();
    const stale = ctx!.getEngine(vault);
    await settle();
    await act(async () => ctx!.upgradeDescriptor(vault.id, 'wpkh([d34db33f/84h/0h/0h]xpub/0/*)#new'));
    release();
    await stale;
    const before = opens();
    await ctx!.getEngine({ ...vault, descriptor: 'wpkh([d34db33f/84h/0h/0h]xpub/0/*)#new' });
    expect(opens()).toBe(before + 1);
  });

  // Decided 2026-10-30: the stamp said the vault was fresh while the engine
  // handed out had synced nothing, which is how index 0 reached Receive.
  describe('a sync of an engine the vault has left stamps nothing', () => {
    const upgraded = { ...vault, descriptor: `${vault.descriptor}#new` } as WalletMeta;
    /** The next `engine.sync`, held until the returned function is called. */
    const holdSync = () => {
      let finish!: () => void;
      mockEngine.sync.mockImplementationOnce(() => new Promise<void>((done) => (finish = done)));
      return () => finish();
    };

    it('the old engine\'s sync finishing after the upgrade', async () => {
      await mount();
      await settle();
      const finish = holdSync();
      const inFlight = ctx!.syncWallet(vault, { force: true });
      await settle();
      await act(async () => ctx!.upgradeDescriptor(vault.id, upgraded.descriptor));
      finish();
      await inFlight;
      await settle();
      mockEngine.sync.mockClear();
      const before = opens();
      await ctx!.syncWallet(upgraded);
      expect(opens()).toBe(before + 1);
      expect(mockEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('the same with the new engine already made: it is not the one that synced', async () => {
      await mount();
      await settle();
      mockMaking.copies = true;
      await act(async () => ctx!.removeWallet(vault.id));
      const oldEngine = await ctx!.getEngine(vault);
      const finish = holdSync();
      const inFlight = ctx!.syncWallet(vault, { force: true });
      await settle();
      await act(async () => ctx!.upgradeDescriptor(vault.id, upgraded.descriptor));
      const newEngine = await ctx!.getEngine(upgraded);
      expect(newEngine).not.toBe(oldEngine);
      finish();
      expect(await inFlight).toBe(oldEngine);
      await settle();
      mockEngine.sync.mockClear();
      expect(await ctx!.syncWallet(upgraded)).toBe(newEngine);
      expect(mockEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('an engine still being made when the upgrade came', async () => {
      await mount();
      await settle();
      await act(async () => ctx!.removeWallet(vault.id));
      const release = hold();
      const inFlight = ctx!.syncWallet(vault);
      await settle();
      await act(async () => ctx!.upgradeDescriptor(vault.id, upgraded.descriptor));
      release();
      await inFlight;
      await settle();
      mockEngine.sync.mockClear();
      await ctx!.syncWallet(upgraded);
      expect(mockEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('a vault removed during its sync', async () => {
      await mount();
      await settle();
      const finish = holdSync();
      const inFlight = ctx!.syncWallet(vault, { force: true });
      await settle();
      await act(async () => ctx!.removeWallet(vault.id));
      finish();
      await inFlight;
      await settle();
      mockEngine.sync.mockClear();
      await ctx!.syncWallet(vault);
      expect(mockEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('the vault\'s own engine still counts as fresh for the minute', async () => {
      await mount();
      await settle();
      await ctx!.syncWallet(vault, { force: true });
      mockEngine.sync.mockClear();
      await ctx!.syncWallet(vault);
      expect(mockEngine.sync).not.toHaveBeenCalled();
    });
  });

  describe('a sync already running', () => {
    /** The next `engine.sync`, held until the returned function is called. */
    const holdSync = () => {
      let finish!: () => void;
      mockEngine.sync.mockImplementationOnce(() => new Promise<void>((done) => (finish = done)));
      return () => finish();
    };
    /** Past the minute in which the mount's own sync counts as fresh. */
    const pastFresh = () => {
      const later = Date.now() + 61_000;
      clock = jest.spyOn(Date, 'now').mockReturnValue(later);
      mockEngine.sync.mockClear();
    };
    let clock: jest.SpyInstance | null = null;
    afterEach(() => {
      clock?.mockRestore();
      clock = null;
    });

    it('is joined by a page that only needs a finished one: no second sync on the one native queue', async () => {
      await mount();
      await settle();
      pastFresh();
      const finish = holdSync();
      const background = ctx!.syncWallet(vault, { force: true });
      await settle();
      const page = ctx!.syncWallet(vault);
      await settle();
      expect(mockEngine.sync).toHaveBeenCalledTimes(1);
      finish();
      expect(await page).toBe(await background);
      expect(mockEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('never stands in for a force: what just happened may be after it started', async () => {
      await mount();
      await settle();
      pastFresh();
      const finish = holdSync();
      const running = ctx!.syncWallet(vault);
      await settle();
      const forced = ctx!.syncWallet(vault, { force: true });
      await settle();
      expect(mockEngine.sync).toHaveBeenCalledTimes(2);
      finish();
      await Promise.all([running, forced]);
    });

    it('that fails fails for whoever joined it, and the next caller starts its own', async () => {
      await mount();
      await settle();
      pastFresh();
      mockEngine.sync.mockImplementationOnce(async () => {
        throw new Error('all errored');
      });
      const first = ctx!.syncWallet(vault);
      const joined = ctx!.syncWallet(vault);
      await expect(first).rejects.toThrow();
      await expect(joined).rejects.toThrow();
      mockEngine.sync.mockClear();
      await ctx!.syncWallet(vault);
      expect(mockEngine.sync).toHaveBeenCalledTimes(1);
    });

    it('of an engine the vault has left is not joined: the new engine syncs for itself', async () => {
      mockMaking.copies = true;
      await mount();
      await settle();
      pastFresh();
      const finish = holdSync();
      const old = ctx!.syncWallet(vault, { force: true });
      await settle();
      await act(async () => ctx!.upgradeDescriptor(vault.id, 'wpkh([d34db33f/84h/0h/0h]xpub/0/*)#new'));
      const fresh = ctx!.syncWallet(vault);
      await settle();
      expect(mockEngine.sync).toHaveBeenCalledTimes(2);
      finish();
      await Promise.all([old, fresh]);
      mockMaking.copies = false;
    });

    it('on a server the client has just left is not joined: the next caller asks the one saved now', async () => {
      await mount();
      await settle();
      pastFresh();
      const finish = holdSync();
      const old = ctx!.syncWallet(vault);
      await settle();
      await act(async () => ctx!.updateSettings({ electrumUrls: { bitcoin: HOME_NODE } }));
      mockSynced.length = 0;
      const page = ctx!.syncWallet(vault);
      await settle();
      expect(mockEngine.sync).toHaveBeenCalledTimes(2);
      expect(mockSynced).toEqual([HOME_NODE]);
      finish();
      await Promise.all([old, page]);
    });

    it('that ends on a server the client has left calls nothing fresh: the next caller asks the one saved now', async () => {
      await mount();
      await settle();
      pastFresh();
      const finish = holdSync();
      const old = ctx!.syncWallet(vault);
      await settle();
      await act(async () => ctx!.updateSettings({ electrumUrls: { bitcoin: HOME_NODE } }));
      finish();
      await old;
      mockSynced.length = 0;
      await ctx!.syncWallet(vault);
      expect(mockSynced).toEqual([HOME_NODE]);
    });
  });

  it('a sync minutes old on the last server is not fresh on the next one', async () => {
    await mount();
    await settle();
    await ctx!.syncWallet(vault);
    await act(async () => ctx!.updateSettings({ electrumUrls: { bitcoin: HOME_NODE } }));
    mockSynced.length = 0;
    await ctx!.syncWallet(vault);
    expect(mockSynced).toEqual([HOME_NODE]);
  });

  it('a change that is not about servers leaves a fresh sync fresh', async () => {
    await mount();
    await settle();
    await ctx!.syncWallet(vault);
    mockEngine.sync.mockClear();
    await act(async () => ctx!.updateSettings({ btcOnly: true }));
    await ctx!.syncWallet(vault);
    expect(mockEngine.sync).not.toHaveBeenCalled();
  });

  it('a new engine is never "fresh enough": an upgraded descriptor syncs again inside the minute', async () => {
    await mount();
    await settle();
    await ctx!.syncWallet(vault, { force: true });
    mockEngine.sync.mockClear();
    await ctx!.syncWallet(vault);
    expect(mockEngine.sync).not.toHaveBeenCalled();
    await act(async () => ctx!.upgradeDescriptor(vault.id, 'wpkh([d34db33f/84h/0h/0h]xpub/0/*)#new'));
    await ctx!.syncWallet(vault);
    expect(mockEngine.sync).toHaveBeenCalledTimes(1);
  });
});
