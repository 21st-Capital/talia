/**
 * A saved Esplora server moves to Electrum, once, at start (decided 2026-10-07:
 * yes to moving those installs; Settings has offered Electrum only since
 * 2026-07). A Bitcoin Electrum server the client saved is kept rather than
 * swapped for the public default, and a Bitcoin Esplora server of their own
 * with no Electrum server beside it is HELD: no server at all until they
 * enter one, never the public default (decided 2026-10-18: "we should never leak
 * their vaults to any other node").
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
import { esploraHost, moveOffEsplora } from '../settingsMigration';
import { loadSettings, DEFAULT_SETTINGS } from '../storage';
import { backendFor } from '../engineProvider';
import {
  broadcastThroughChainServers,
  chainServerNote,
  chainServersFor,
  NO_BITCOIN_SERVER,
  othersMayBeAsked,
  serverHold,
  syncThroughChainServers,
} from '../chainServers';
import { explorerApiFor } from '../../services/txPrevouts';
import { DEFAULT_ELECTRUM, TESTNET4_ELECTRUM_SERVERS } from '../../bitcoin/network';

const KEY = 'keel.settings.v2';
const store = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;
const setItem = AsyncStorage.setItem as jest.Mock;

/** What an install that picked Esplora before 2026-07 has on disk. */
const ESPLORA_INSTALL = {
  defaultNetwork: 'bitcoin',
  backendType: 'esplora',
  electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' },
  esploraUrls: { bitcoin: 'https://node.local/api', signet: 'https://mempool.space/signet/api' },
  unit: 'sats',
  fiat: 'EUR',
  hideBalances: true,
  pinSet: true,
};

beforeEach(() => {
  store.clear();
  setItem.mockClear();
});

describe('moveOffEsplora', () => {
  it('moves a saved Esplora server, custom or public, to Electrum, keeping a Bitcoin server the client saved', () => {
    const { esploraUrls: _gone, ...rest } = ESPLORA_INSTALL;
    expect(moveOffEsplora(ESPLORA_INSTALL)).toEqual({
      ...rest,
      backendType: 'electrum',
      electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' },
    });
    expect(moveOffEsplora({ backendType: 'esplora' })).toEqual({ backendType: 'electrum', electrumUrls: {} });
    // Only a Bitcoin server is kept: the others are the defaults' again.
    expect(
      moveOffEsplora({ backendType: 'esplora', electrumUrls: { testnet: 'ssl://10.0.0.5:50002', bitcoin: ' ' } }),
    ).toEqual({ backendType: 'electrum', electrumUrls: {} });
  });

  it('holds a Bitcoin Esplora server of the client\'s own when no Electrum server stands beside it', () => {
    // The reviewer's install: its own Esplora server, nothing else.
    expect(
      moveOffEsplora({
        backendType: 'esplora',
        esploraUrls: { bitcoin: 'http://umbrel.local:3006/api' },
        electrumUrls: {},
      }),
    ).toEqual({
      backendType: 'electrum',
      electrumUrls: {},
      bitcoinServerHold: { reason: 'esplora', host: 'umbrel.local:3006' },
    });
    // A public one they picked is theirs too: never swapped for Blockstream.
    expect(
      moveOffEsplora({ backendType: 'esplora', esploraUrls: { bitcoin: 'https://mempool.space/api' } }),
    ).toMatchObject({ bitcoinServerHold: { reason: 'esplora', host: 'mempool.space' } });
    // A saved Electrum server wins: kept, and nothing is held.
    expect(moveOffEsplora(ESPLORA_INSTALL)).not.toHaveProperty('bitcoinServerHold');
  });

  it('holds nothing for the public Esplora default, a Testnet4 or Signet one, or none', () => {
    for (const esploraUrls of [
      { bitcoin: 'https://blockstream.info/api' },
      { bitcoin: ' https://Blockstream.info/api/ ' },
      { signet: 'https://mempool.space/signet/api', testnet: 'https://10.0.0.5/api' },
      { bitcoin: '  ' },
      { bitcoin: 7 },
      [],
      null,
    ]) {
      expect(moveOffEsplora({ backendType: 'esplora', esploraUrls })).toEqual({ backendType: 'electrum', electrumUrls: {} });
    }
  });

  it('names the held server by its host and port, without a login or path', () => {
    expect(esploraHost('http://umbrel.local:3006/api')).toBe('umbrel.local:3006');
    expect(esploraHost('https://me:secret@node.example.org/api/')).toBe('node.example.org');
    expect(esploraHost('https://[fd00::5]:3002')).toBe('[fd00::5]:3002');
    expect(esploraHost('10.0.0.20:3002/api')).toBe('10.0.0.20:3002');
  });

  it('leaves everything else alone', () => {
    const electrum = { ...ESPLORA_INSTALL, backendType: 'electrum' };
    expect(moveOffEsplora(electrum)).toBeNull();
    expect(moveOffEsplora({ unit: 'btc' })).toBeNull();
    for (const odd of [null, 5, 'esplora', ['esplora'], undefined]) {
      expect(moveOffEsplora(odd)).toBeNull();
    }
  });
});

describe('at start', () => {
  it('keeps the client\'s own Bitcoin server, every other choice, and syncs through Electrum', async () => {
    store.set(KEY, JSON.stringify(ESPLORA_INSTALL));
    const s = await loadSettings();
    expect(s.backendType).toBe('electrum');
    expect(s.electrumUrls).toEqual({ bitcoin: 'ssl://10.0.0.20:50002' });
    expect(s.unit).toBe('sats');
    expect(s.fiat).toBe('EUR');
    expect(s.hideBalances).toBe(true);
    expect(s.pinSet).toBe(true);
    expect(backendFor('bitcoin', s)).toMatchObject({ type: 'electrum', url: 'ssl://10.0.0.20:50002' });
    for (const network of ['testnet', 'signet'] as const) {
      expect(backendFor(network, s)).toMatchObject({ type: 'electrum', url: DEFAULT_ELECTRUM.testnet, validateDomain: true });
    }
  });

  it('an install whose own Esplora server had no Electrum server beside it syncs through NO server, and says so', async () => {
    store.set(
      KEY,
      JSON.stringify({ defaultNetwork: 'bitcoin', backendType: 'esplora', esploraUrls: { bitcoin: 'http://umbrel.local:3006/api' }, electrumUrls: {} }),
    );
    const s = await loadSettings();
    expect(s.electrumUrls).toEqual({});
    expect(serverHold('bitcoin', s)).toEqual({ reason: 'esplora', host: 'umbrel.local:3006' });
    // Not the public default: no server at all.
    expect(chainServersFor('bitcoin', s)).toEqual([]);
    expect(backendFor('bitcoin', s)).toBeNull();
    const asked: string[] = [];
    const ask = async (b: { url: string }) => {
      asked.push(b.url);
      return 'never';
    };
    await expect(syncThroughChainServers('bitcoin', s, ask)).rejects.toThrow(NO_BITCOIN_SERVER);
    await expect(broadcastThroughChainServers('bitcoin', s, ask)).rejects.toThrow(NO_BITCOIN_SERVER);
    expect(asked).toEqual([]);
    // Nor the block explorer, on the transaction page.
    expect(othersMayBeAsked('bitcoin', s)).toBe(false);
    expect(explorerApiFor('bitcoin', s)).toBeNull();
    // The vault and Settings → Network say what to do.
    expect(chainServerNote('bitcoin', s, { where: 'vault' })).toBe(
      'Talia can no longer use umbrel.local:3006, the server you chose, as it was set up. Enter it again in Settings → Network.',
    );
    expect(chainServerNote('bitcoin', s, { where: 'settings' })).toBe(
      'Talia can no longer use umbrel.local:3006, the server you chose, as it was set up. Enter it again and tap Save & test.',
    );
    // Testnet4 vaults are not held: their built-in servers, as ever.
    expect(chainServersFor('testnet', s).map((b) => b.url)).toEqual(TESTNET4_ELECTRUM_SERVERS);
  });

  it('the hold is stored, survives a restart, and goes once a server is saved', async () => {
    store.set(KEY, JSON.stringify({ backendType: 'esplora', esploraUrls: { bitcoin: 'http://umbrel.local:3006/api' } }));
    await loadSettings();
    expect(JSON.parse(store.get(KEY)!).bitcoinServerHold).toEqual({ reason: 'esplora', host: 'umbrel.local:3006' });
    const again = await loadSettings();
    expect(serverHold('bitcoin', again)).not.toBeNull();
    // Saved in Settings → Network: that server, and the hold is ignored
    // even if it were still stored.
    const saved = { ...again, electrumUrls: { bitcoin: 'tcp://umbrel.local:50001' } };
    expect(serverHold('bitcoin', saved)).toBeNull();
    expect(chainServersFor('bitcoin', saved).map((b) => b.url)).toEqual(['tcp://umbrel.local:50001']);
  });

  it('an install that had picked the public Esplora default moves to the public Electrum default', async () => {
    store.set(KEY, JSON.stringify({ ...ESPLORA_INSTALL, electrumUrls: {}, esploraUrls: { bitcoin: 'https://blockstream.info/api' } }));
    const s = await loadSettings();
    expect(s.electrumUrls).toEqual({});
    expect(serverHold('bitcoin', s)).toBeNull();
    expect(backendFor('bitcoin', s)).toMatchObject({ url: DEFAULT_ELECTRUM.bitcoin, validateDomain: true });
  });

  it('stores the move straight away, so it happens once', async () => {
    store.set(KEY, JSON.stringify(ESPLORA_INSTALL));
    const first = await loadSettings();
    expect(setItem).toHaveBeenCalledTimes(1);
    const { esploraUrls: _gone, ...rest } = ESPLORA_INSTALL;
    expect(JSON.parse(store.get(KEY)!)).toEqual({
      ...rest,
      backendType: 'electrum',
      electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' },
    });
    const second = await loadSettings();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('writes nothing for an install already on Electrum, or with nothing saved', async () => {
    store.set(KEY, JSON.stringify({ ...ESPLORA_INSTALL, backendType: 'electrum' }));
    const s = await loadSettings();
    expect(s.electrumUrls).toEqual({ bitcoin: 'ssl://10.0.0.20:50002' });
    // The Esplora servers an older install stored are not carried along.
    expect('esploraUrls' in s).toBe(false);
    store.delete(KEY);
    expect(await loadSettings()).toBe(DEFAULT_SETTINGS);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('still moves for this run when the settings cannot be written, and tries again next start', async () => {
    store.set(KEY, JSON.stringify(ESPLORA_INSTALL));
    setItem.mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    expect((await loadSettings()).backendType).toBe('electrum');
    expect(JSON.parse(store.get(KEY)!).backendType).toBe('esplora');
    expect((await loadSettings()).backendType).toBe('electrum');
    expect(JSON.parse(store.get(KEY)!).backendType).toBe('electrum');
  });
});
