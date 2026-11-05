/**
 * Stored settings that cannot be read never mean "no server chosen" (the
 * network rules, decided 2026-10-18: "we should never leak their vaults to
 * any other node").
 *
 * `loadSettings` used to answer damaged settings with the plain defaults, so
 * a client whose saved server was their home node had every vault synced
 * through the public default, with no note. Nothing stored is still the
 * defaults; stored but unreadable holds the Bitcoin server
 * (`bitcoinServerHold` 'unreadable'): no server until the client saves one
 * or resets, and the vault says so.
 */
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
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../storage';
import { chainServerNote, chainServersFor, NO_BITCOIN_SERVER, othersMayBeAsked, serverHold, syncThroughChainServers } from '../chainServers';
import { TESTNET4_ELECTRUM_SERVERS } from '../../bitcoin/network';

const KEY = 'keel.settings.v2';
const store = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;
const HOME_NODE = 'ssl://10.0.0.20:50002';

beforeEach(() => store.clear());

describe('stored settings that cannot be read', () => {
  it('damaged JSON holds the Bitcoin server: nothing is asked, and the vault says so', async () => {
    // What a cut-off write of {"electrumUrls":{"bitcoin":"ssl://10.0.0.20:50002"},... leaves.
    store.set(KEY, '{"defaultNetwork":"bitcoin","electrumUrls":{"bitcoin":"ssl://192.168');
    const s = await loadSettings();
    expect(serverHold('bitcoin', s)).toEqual({ reason: 'unreadable' });
    expect(chainServersFor('bitcoin', s)).toEqual([]);
    const run = jest.fn(async () => 1);
    await expect(syncThroughChainServers('bitcoin', s, run)).rejects.toThrow(NO_BITCOIN_SERVER);
    expect(run).not.toHaveBeenCalled();
    expect(othersMayBeAsked('bitcoin', s)).toBe(false);
    expect(chainServerNote('bitcoin', s, { where: 'vault' })).toBe(
      'Talia could not read its network settings and uses no server until you check them in Settings → Network.',
    );
    expect(chainServerNote('bitcoin', s, { where: 'settings' })).toBe(
      'Talia could not read its network settings. Enter your server and tap Save & test, or tap Reset to default server.',
    );
    // Every other setting is the default, as before; Testnet4 is not held.
    expect({ ...s, bitcoinServerHold: undefined }).toEqual({ ...DEFAULT_SETTINGS, bitcoinServerHold: undefined });
    expect(chainServersFor('testnet', s).map((b) => b.url)).toEqual(TESTNET4_ELECTRUM_SERVERS);
  });

  it('JSON that is not settings, or saved servers that are not servers, hold it too', async () => {
    for (const raw of [
      'null',
      '[]',
      '"electrum"',
      '7',
      JSON.stringify({ electrumUrls: 'ssl://10.0.0.20:50002' }),
      JSON.stringify({ electrumUrls: ['ssl://10.0.0.20:50002'] }),
      JSON.stringify({ electrumUrls: null }),
      JSON.stringify({ electrumUrls: { bitcoin: 50002 } }),
      JSON.stringify({ electrumUrls: { bitcoin: { url: HOME_NODE } } }),
      JSON.stringify({ electrumUrls: {}, bitcoinServerHold: 'yes' }),
      JSON.stringify({ electrumUrls: {}, bitcoinServerHold: { reason: 'esplora' } }),
    ]) {
      store.set(KEY, raw);
      expect([raw, serverHold('bitcoin', await loadSettings())]).toEqual([raw, { reason: 'unreadable' }]);
    }
  });

  it('a saved server that IS readable wins, whatever else is odd', async () => {
    store.set(KEY, JSON.stringify({ electrumUrls: { bitcoin: HOME_NODE, testnet: 9 }, bitcoinServerHold: 'yes' }));
    const s = await loadSettings();
    expect(serverHold('bitcoin', s)).toBeNull();
    expect(chainServersFor('bitcoin', s).map((b) => b.url)).toEqual([HOME_NODE]);
    // An odd value for another network is simply not a server.
    expect(s.electrumUrls).toEqual({ bitcoin: HOME_NODE });
  });

  it('nothing stored is the defaults, and readable settings with no server the default server', async () => {
    expect(await loadSettings()).toBe(DEFAULT_SETTINGS);
    expect(serverHold('bitcoin', DEFAULT_SETTINGS)).toBeNull();
    store.set(KEY, JSON.stringify({ unit: 'sats', electrumUrls: {} }));
    const s = await loadSettings();
    expect('bitcoinServerHold' in s).toBe(false);
    expect(chainServersFor('bitcoin', s).map((b) => b.url)).toEqual(['ssl://electrum.blockstream.info:50002']);
  });

  it('the hold is saved with the next change and lasts until a server is saved', async () => {
    store.set(KEY, '{broken');
    const s = await loadSettings();
    // The next change of any setting writes the hold down with it.
    await saveSettings({ ...s, unit: 'sats' });
    expect(JSON.parse(store.get(KEY)!).bitcoinServerHold).toEqual({ reason: 'unreadable' });
    expect(serverHold('bitcoin', await loadSettings())).toEqual({ reason: 'unreadable' });
    // Saving a server (Settings → Network clears the hold as it saves).
    await saveSettings({ ...s, electrumUrls: { bitcoin: HOME_NODE }, bitcoinServerHold: undefined });
    const after = await loadSettings();
    expect(serverHold('bitcoin', after)).toBeNull();
    expect(chainServersFor('bitcoin', after).map((b) => b.url)).toEqual([HOME_NODE]);
  });

  it('a store that does not answer is not "nothing stored": loadSettings throws', async () => {
    (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('database is locked');
    });
    await expect(loadSettings()).rejects.toThrow('database is locked');
  });
});
