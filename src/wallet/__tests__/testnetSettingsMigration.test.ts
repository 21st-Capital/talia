/**
 * The phone's Testnet4 settings go at start (decided 2026-10-18: "can we also
 * remove the testnet settings completely and just have testnet vaults sync
 * automatically to public nodes?"). Settings → Network edits the Bitcoin
 * server alone, and every Testnet4 vault syncs through the built-in servers,
 * so a saved Testnet4 server is dropped and the saved network choice (the
 * page's old radio row) goes back to Bitcoin. Once, stored straight away.
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
import { moveOffTestnetSettings } from '../settingsMigration';
import { loadSettings, DEFAULT_SETTINGS } from '../storage';
import { backendFor } from '../engineProvider';
import { __forgetGoodServersForTests } from '../chainServers';
import { TESTNET4_ELECTRUM_SERVERS } from '../../bitcoin/network';

const KEY = 'keel.settings.v2';
const store = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;
const setItem = AsyncStorage.setItem as jest.Mock;

/** A phone set to Testnet4 with its own test server and a home node for Bitcoin. */
const TESTNET_PHONE = {
  defaultNetwork: 'testnet',
  backendType: 'electrum',
  electrumUrls: {
    bitcoin: 'ssl://10.0.0.20:50002',
    testnet: 'ssl://10.0.0.5:50002',
    regtest: 'tcp://127.0.0.1:60401',
  },
  unit: 'sats',
  fiat: 'EUR',
  hideBalances: true,
  pinSet: true,
};

/** The same phone once moved: Bitcoin, no test server, everything else kept. */
const MOVED = {
  ...TESTNET_PHONE,
  defaultNetwork: 'bitcoin',
  electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002', regtest: 'tcp://127.0.0.1:60401' },
};

beforeEach(() => {
  store.clear();
  setItem.mockClear();
  __forgetGoodServersForTests();
});

describe('moveOffTestnetSettings', () => {
  it('drops the saved Testnet4 server and puts the network choice back on Bitcoin', () => {
    expect(moveOffTestnetSettings(TESTNET_PHONE)).toEqual(MOVED);
  });

  it('a Testnet4 server saved while Bitcoin was chosen goes too, and the Bitcoin server stays as it was', () => {
    expect(
      moveOffTestnetSettings({ defaultNetwork: 'bitcoin', electrumUrls: { bitcoin: 'ssl://bitcoin.lu.ke:50002', testnet: 'ssl://x.example:1' } }),
    ).toEqual({ defaultNetwork: 'bitcoin', electrumUrls: { bitcoin: 'ssl://bitcoin.lu.ke:50002' } });
  });

  it('a choice of Testnet4 with no server saved moves to Bitcoin alone', () => {
    expect(moveOffTestnetSettings({ defaultNetwork: 'testnet' })).toEqual({ defaultNetwork: 'bitcoin' });
    expect(moveOffTestnetSettings({ defaultNetwork: 'testnet', electrumUrls: {} })).toEqual({
      defaultNetwork: 'bitcoin',
      electrumUrls: {},
    });
  });

  it('a leftover Signet value goes the same way', () => {
    expect(moveOffTestnetSettings({ defaultNetwork: 'signet', electrumUrls: { signet: 'ssl://a.example:1' } })).toEqual({
      defaultNetwork: 'bitcoin',
      electrumUrls: {},
    });
  });

  it('is idempotent: its own result, Bitcoin, Regtest and anything odd are left alone', () => {
    expect(moveOffTestnetSettings(MOVED)).toBeNull();
    expect(moveOffTestnetSettings({ defaultNetwork: 'bitcoin', electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } })).toBeNull();
    expect(moveOffTestnetSettings({ defaultNetwork: 'regtest', electrumUrls: { regtest: 'tcp://127.0.0.1:60401' } })).toBeNull();
    expect(moveOffTestnetSettings({ unit: 'btc' })).toBeNull();
    expect(moveOffTestnetSettings({ defaultNetwork: 'bitcoin', electrumUrls: null })).toBeNull();
    for (const odd of [null, 5, 'testnet', ['testnet'], undefined]) {
      expect(moveOffTestnetSettings(odd)).toBeNull();
    }
  });
});

describe('at start', () => {
  it('loads Bitcoin, keeps every other choice, and a Testnet4 vault syncs through the built-in servers', async () => {
    store.set(KEY, JSON.stringify(TESTNET_PHONE));
    const s = await loadSettings();
    expect(s.defaultNetwork).toBe('bitcoin');
    expect(s.electrumUrls).toEqual(MOVED.electrumUrls);
    expect(s.unit).toBe('sats');
    expect(s.fiat).toBe('EUR');
    expect(s.hideBalances).toBe(true);
    expect(s.pinSet).toBe(true);
    expect(backendFor('testnet', s)?.url).toBe(TESTNET4_ELECTRUM_SERVERS[0]);
    expect(backendFor('bitcoin', s)?.url).toBe('ssl://10.0.0.20:50002');
  });

  it('stores the move straight away, so it happens once', async () => {
    store.set(KEY, JSON.stringify(TESTNET_PHONE));
    const first = await loadSettings();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get(KEY)!)).toEqual(MOVED);
    const second = await loadSettings();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('writes nothing for a phone that never had Testnet4 settings, or no settings at all', async () => {
    store.set(KEY, JSON.stringify(MOVED));
    expect((await loadSettings()).electrumUrls).toEqual(MOVED.electrumUrls);
    store.delete(KEY);
    expect(await loadSettings()).toBe(DEFAULT_SETTINGS);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('still moves for this run when the settings cannot be written, and tries again next start', async () => {
    store.set(KEY, JSON.stringify(TESTNET_PHONE));
    setItem.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    expect((await loadSettings()).defaultNetwork).toBe('bitcoin');
    expect(JSON.parse(store.get(KEY)!).defaultNetwork).toBe('testnet');
    expect((await loadSettings()).electrumUrls).toEqual(MOVED.electrumUrls);
    expect(JSON.parse(store.get(KEY)!)).toEqual(MOVED);
  });
});
