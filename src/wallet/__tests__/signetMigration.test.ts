/**
 * A phone whose saved network was Signet moves to Testnet4 at start (decided
 * 2026-10-18: "remove signet, keep only bitcoin and testnet4"). Settings →
 * Network no longer offers Signet, so without this a phone set to it would
 * keep putting new test-key vaults on Signet.
 *
 * The same day the Testnet4 settings went too ("remove the testnet settings
 * completely"; moveOffTestnetSettings, testnetSettingsMigration.test.ts), so
 * at start a Signet phone ends on Bitcoin with no saved test server: both
 * moves, in one write.
 */
// storage.ts reaches the Keychain through the sealed vault list.
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    removeItem: jest.fn(async (k: string) => void store.delete(k)),
  };
});
jest.mock('../../bitcoin', () => ({
  activeEngineFactory: () => ({}),
  fakeWalletEngineFactory: () => ({}),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { moveOffSignet } from '../settingsMigration';
import { loadSettings } from '../storage';
import { backendFor } from '../engineProvider';
import { OFFERED_NETWORKS, TESTNET4_ELECTRUM_SERVERS } from '../../bitcoin/network';

const KEY = 'keel.settings.v2';
const store = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;
const setItem = AsyncStorage.setItem as jest.Mock;

/** What a phone set to Signet in Settings → Network has on disk. */
const SIGNET_INSTALL = {
  defaultNetwork: 'signet',
  backendType: 'electrum',
  electrumUrls: {
    bitcoin: 'ssl://10.0.0.20:50002',
    testnet: 'ssl://10.0.0.5:50002',
    signet: 'ssl://10.0.0.5:60602',
  },
  unit: 'sats',
  fiat: 'EUR',
  hideBalances: true,
  pinSet: true,
};

/** The same phone once moved off Signet: Testnet4, the Signet server gone,
 *  the rest kept (what `moveOffSignet` alone returns). */
const MOVED = {
  ...SIGNET_INSTALL,
  defaultNetwork: 'testnet',
  electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002', testnet: 'ssl://10.0.0.5:50002' },
};

/** What loading stores: off Signet, then off the Testnet4 settings too
 *  (Bitcoin, the Bitcoin server kept, no test server). */
const LOADED = {
  ...SIGNET_INSTALL,
  defaultNetwork: 'bitcoin',
  electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' },
};

beforeEach(() => {
  store.clear();
  setItem.mockClear();
});

describe('moveOffSignet', () => {
  it('moves a saved Signet choice to Testnet4 and drops the saved Signet server', () => {
    expect(moveOffSignet(SIGNET_INSTALL)).toEqual(MOVED);
    expect(moveOffSignet({ defaultNetwork: 'signet' })).toEqual({ defaultNetwork: 'testnet' });
  });

  it('drops a Signet server saved while another network was chosen, and keeps that choice', () => {
    expect(
      moveOffSignet({ defaultNetwork: 'bitcoin', electrumUrls: { signet: 'ssl://mempool.space:60602' } }),
    ).toEqual({ defaultNetwork: 'bitcoin', electrumUrls: {} });
  });

  it('leaves Mainnet, Testnet4 and anything odd alone', () => {
    for (const net of OFFERED_NETWORKS) {
      expect(moveOffSignet({ ...MOVED, defaultNetwork: net })).toBeNull();
    }
    expect(moveOffSignet({ unit: 'btc' })).toBeNull();
    expect(moveOffSignet({ defaultNetwork: 'testnet', electrumUrls: null })).toBeNull();
    for (const odd of [null, 5, 'signet', ['signet'], undefined]) {
      expect(moveOffSignet(odd)).toBeNull();
    }
  });

  it('every choice it leaves is a network a vault can be on', () => {
    const moved = moveOffSignet(SIGNET_INSTALL);
    expect(OFFERED_NETWORKS).toContain(moved?.defaultNetwork);
  });
});

describe('at start', () => {
  it('ends on Bitcoin, keeps every other choice, and no saved Signet or Testnet4 server is left to use', async () => {
    store.set(KEY, JSON.stringify(SIGNET_INSTALL));
    const s = await loadSettings();
    expect(s.defaultNetwork).toBe('bitcoin');
    expect(s.electrumUrls).toEqual(LOADED.electrumUrls);
    expect(s.unit).toBe('sats');
    expect(s.fiat).toBe('EUR');
    expect(s.hideBalances).toBe(true);
    expect(s.pinSet).toBe(true);
    expect(backendFor('signet', s)).toMatchObject({ url: TESTNET4_ELECTRUM_SERVERS[0] });
    expect(backendFor('testnet', s)).toMatchObject({ url: TESTNET4_ELECTRUM_SERVERS[0] });
    expect(backendFor('bitcoin', s)).toMatchObject({ url: 'ssl://10.0.0.20:50002' });
  });

  it('stores the moves straight away, in one write, so they happen once', async () => {
    store.set(KEY, JSON.stringify(SIGNET_INSTALL));
    const first = await loadSettings();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get(KEY)!)).toEqual(LOADED);
    const second = await loadSettings();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('writes nothing for a phone on Bitcoin with no test server', async () => {
    store.set(KEY, JSON.stringify(LOADED));
    expect((await loadSettings()).defaultNetwork).toBe('bitcoin');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('an old Esplora install on Signet makes every move in one write', async () => {
    store.set(
      KEY,
      JSON.stringify({ ...SIGNET_INSTALL, backendType: 'esplora', esploraUrls: { signet: 'https://mempool.space/signet/api' } }),
    );
    const s = await loadSettings();
    expect(s.backendType).toBe('electrum');
    expect(s.defaultNetwork).toBe('bitcoin');
    // The client's own Bitcoin server stays (decided 2026-10-18).
    expect(s.electrumUrls).toEqual({ bitcoin: 'ssl://10.0.0.20:50002' });
    expect(setItem).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(store.get(KEY)!);
    expect(saved.defaultNetwork).toBe('bitcoin');
    expect(saved.backendType).toBe('electrum');
    expect('esploraUrls' in saved).toBe(false);
  });

  it('still moves for this run when the settings cannot be written, and tries again next start', async () => {
    store.set(KEY, JSON.stringify(SIGNET_INSTALL));
    setItem.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    expect((await loadSettings()).defaultNetwork).toBe('bitcoin');
    expect(JSON.parse(store.get(KEY)!).defaultNetwork).toBe('signet');
    expect((await loadSettings()).defaultNetwork).toBe('bitcoin');
    expect(JSON.parse(store.get(KEY)!).defaultNetwork).toBe('bitcoin');
  });
});
