/**
 * Decided 2026-09-26: once the certificate is checked for
 * every internet server, two servers Talia used to suggest fail it under
 * the name it suggested (their certificates name another host of the same
 * operator), and bitcoin.lu.ke carries a self-made certificate.
 *
 * Those saved choices used to be rewritten at start (the new name, or the
 * public default). Since 2026-10-18 ("if a user prefers a specific public
 * node, we should never automatically fall to any other public node") they
 * are kept exactly as saved and earn a note instead
 * (wallet/chainServers.ts `chainServerNote`, tested there).
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
import {
  savedServerNotice,
  SUGGESTED_ELECTRUM_SERVERS,
  electrumValidatesCertificate,
} from '../../bitcoin/electrumTls';
import { loadSettings } from '../storage';
import { backendFor } from '../engineProvider';

const store = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;
const setItem = AsyncStorage.setItem as jest.Mock;

beforeEach(() => {
  store.clear();
  setItem.mockClear();
});

describe('saved servers that fail today\'s certificate check', () => {
  it('Talia knows the new name of a renamed one, and which one is retired', () => {
    expect(savedServerNotice('ssl://mainnet.foundationdevices.com:50002')).toEqual({
      kind: 'renamed',
      to: 'ssl://mainnet-0.foundation.xyz:50002',
    });
    expect(savedServerNotice('SSL://Electrum1.BlueWallet.io:443')).toEqual({
      kind: 'renamed',
      to: 'ssl://electrum2.bluewallet.io:443',
    });
    expect(savedServerNotice('ssl://bitcoin.lu.ke:50002')).toEqual({ kind: 'retired' });
  });

  it('anything typed by hand has nothing to say', () => {
    for (const url of [
      'ssl://10.0.0.20:50002',
      'tcp://electrum1.bluewallet.io:50001',
      'ssl://electrum.acinq.co:50002',
      'ssl://mainnet.foundationdevices.com:50003',
    ]) {
      expect(savedServerNotice(url)).toBeNull();
    }
  });

  it('no suggested server is one with a notice, and each is checked by its certificate', () => {
    for (const { host, port } of SUGGESTED_ELECTRUM_SERVERS) {
      const url = `ssl://${host}:${port}`;
      expect(savedServerNotice(url)).toBeNull();
      expect(electrumValidatesCertificate(url)).toBe(true);
    }
    const hosts = SUGGESTED_ELECTRUM_SERVERS.map((s) => s.host);
    expect(hosts).not.toContain('mainnet.foundationdevices.com');
    expect(hosts).not.toContain('electrum1.bluewallet.io');
    expect(hosts).not.toContain('bitcoin.lu.ke');
  });

  it('loading the settings keeps them exactly as saved, and writes nothing', async () => {
    for (const url of ['ssl://mainnet.foundationdevices.com:50002', 'ssl://bitcoin.lu.ke:50002']) {
      store.set('keel.settings.v2', JSON.stringify({ electrumUrls: { bitcoin: url } }));
      expect((await loadSettings()).electrumUrls).toEqual({ bitcoin: url });
    }
    expect(setItem).not.toHaveBeenCalled();
  });

  it('syncing uses them as saved: never the new name behind the client\'s back, never the public default', () => {
    const settings = (bitcoin: string) => ({ backendType: 'electrum', electrumUrls: { bitcoin } }) as never;
    expect(backendFor('bitcoin', settings('ssl://electrum1.bluewallet.io:443'))).toMatchObject({
      url: 'ssl://electrum1.bluewallet.io:443',
      validateDomain: true,
    });
    expect(backendFor('bitcoin', settings('ssl://bitcoin.lu.ke:50002'))).toMatchObject({
      url: 'ssl://bitcoin.lu.ke:50002',
      validateDomain: true,
    });
  });
});
