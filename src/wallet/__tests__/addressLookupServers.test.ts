/**
 * Which servers the address book's lookup may ask (decided 2026-11-05): the
 * ones the vault's network uses, under the same rule as its sync (decided
 * 2026-10-18). Bitcoin: the one server the client chose, or the default
 * while none is saved, and nothing at all while a server is held. Testnet4:
 * the built-in servers, moving on after one failed or said nothing. Every
 * server is asked with the lookup's own settings, and one attempt has about
 * 20 seconds.
 */
import {
  __forgetGoodServersForTests,
  ADDRESS_LOOKUP_ATTEMPT_MS,
  chainServersFor,
  lookupThroughChainServers,
  NO_BITCOIN_SERVER,
  NO_TESTNET4_SERVER_ANSWERED,
  silentServerGivesUpMs,
  syncThroughChainServers,
} from '../chainServers';
import { ADDRESS_LOOKUP_RETRY, ADDRESS_LOOKUP_TIMEOUT_S } from '../../bitcoin/engine/bdkWalletRules';
import { DEFAULT_ELECTRUM, TESTNET4_ELECTRUM_SERVERS } from '../../bitcoin/network';
import type { BackendConfig } from '../../bitcoin/engine/types';

const HOME_NODE = 'ssl://10.0.0.20:50002';
const PICKED_PUBLIC = 'ssl://electrum.acinq.co:50002';

const saved = (bitcoin?: string) => ({ electrumUrls: bitcoin ? { bitcoin } : {} });
const HELD = { electrumUrls: {}, bitcoinServerHold: { reason: 'esplora' as const, host: 'umbrel.local:3006' } };
const UNREADABLE = { electrumUrls: {}, bitcoinServerHold: { reason: 'unreadable' as const } };

const refused = () => Object.assign(new Error('Electrum client error: connection refused'), { code: 'SERVER_UNREACHABLE' });

/** A run that records each server it was handed and answers per url. */
function recorder(answer: (b: BackendConfig) => Promise<string>) {
  const asked: BackendConfig[] = [];
  return {
    asked,
    run: (b: BackendConfig) => {
      asked.push(b);
      return answer(b);
    },
  };
}

beforeEach(() => __forgetGoodServersForTests());

describe('a Bitcoin lookup goes to the one server the client chose, and to no other', () => {
  it('a home node, exactly as saved, with the lookup settings', async () => {
    const r = recorder(async () => 'facts');
    await expect(lookupThroughChainServers('bitcoin', saved(HOME_NODE), r.run)).resolves.toBe('facts');
    expect(r.asked).toEqual([
      expect.objectContaining({ url: HOME_NODE, validateDomain: false, retry: ADDRESS_LOOKUP_RETRY, timeout: ADDRESS_LOOKUP_TIMEOUT_S }),
    ]);
    expect([ADDRESS_LOOKUP_RETRY, ADDRESS_LOOKUP_TIMEOUT_S]).toEqual([0, 8]);
  });

  it('a server that fails is the answer: nothing else is tried, its error comes back', async () => {
    for (const url of [HOME_NODE, PICKED_PUBLIC]) {
      const r = recorder(async () => {
        throw refused();
      });
      await expect(lookupThroughChainServers('bitcoin', saved(url), r.run)).rejects.toThrow(/connection refused/);
      expect(r.asked.map((b) => b.url)).toEqual([url]);
    }
  });

  it('with nothing saved, the default server alone', async () => {
    const r = recorder(async () => {
      throw refused();
    });
    await expect(lookupThroughChainServers('bitcoin', saved(), r.run)).rejects.toThrow();
    expect(r.asked.map((b) => b.url)).toEqual([DEFAULT_ELECTRUM.bitcoin]);
  });

  it('while a server is held (an old Esplora server, unreadable settings) NOTHING is asked', async () => {
    for (const held of [HELD, UNREADABLE]) {
      const r = recorder(async () => 'facts');
      await expect(lookupThroughChainServers('bitcoin', held, r.run)).rejects.toThrow(NO_BITCOIN_SERVER);
      expect(r.asked).toEqual([]);
    }
  });

  it('a saved server wins over a hold, as for the sync', async () => {
    const r = recorder(async () => 'facts');
    await lookupThroughChainServers('bitcoin', { ...HELD, electrumUrls: { bitcoin: HOME_NODE } }, r.run);
    expect(r.asked.map((b) => b.url)).toEqual([HOME_NODE]);
  });

  it('exactly the servers the sync uses', () => {
    for (const settings of [saved(HOME_NODE), saved(PICKED_PUBLIC), saved(), HELD]) {
      expect(chainServersFor('bitcoin', settings).map((b) => b.url)).toHaveLength(settings === HELD ? 0 : 1);
    }
  });
});

describe('a Testnet4 lookup uses the built-in servers, with fail-over', () => {
  it('the next server after one could not be reached, and the one that answered first next time', async () => {
    const first = TESTNET4_ELECTRUM_SERVERS[0];
    const r = recorder(async (b) => {
      if (b.url === first) throw refused();
      return 'facts';
    });
    await expect(lookupThroughChainServers('testnet', saved(HOME_NODE), r.run)).resolves.toBe('facts');
    expect(r.asked.map((b) => b.url)).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 2));
    for (const b of r.asked) expect(b).toMatchObject({ retry: 0, timeout: 8 });
    // A saved Bitcoin server is never a Testnet4 lookup's.
    expect(r.asked.map((b) => b.url)).not.toContain(HOME_NODE);
    expect(chainServersFor('testnet', saved())[0].url).toBe(TESTNET4_ELECTRUM_SERVERS[1]);
  });

  it('a server that answered with an error is passed over too', async () => {
    const r = recorder(async (b) => {
      if (b.url === TESTNET4_ELECTRUM_SERVERS[0]) throw new Error('Electrum server error: "history too large"');
      return 'facts';
    });
    await expect(lookupThroughChainServers('testnet', saved(), r.run)).resolves.toBe('facts');
    expect(r.asked).toHaveLength(2);
  });

  it('none answering says so', async () => {
    const r = recorder(async () => {
      throw refused();
    });
    await expect(lookupThroughChainServers('testnet', saved(), r.run)).rejects.toThrow(NO_TESTNET4_SERVER_ANSWERED);
    expect(r.asked.map((b) => b.url)).toEqual([...TESTNET4_ELECTRUM_SERVERS]);
  });

  it('a silent server is left after about 20 seconds, when its native call has ended by itself', async () => {
    jest.useFakeTimers();
    try {
      const r = recorder((b) => (b.url === TESTNET4_ELECTRUM_SERVERS[0] ? new Promise<string>(() => undefined) : Promise.resolve('facts')));
      const done = lookupThroughChainServers('testnet', saved(), r.run);
      await jest.advanceTimersByTimeAsync(ADDRESS_LOOKUP_ATTEMPT_MS - 1);
      expect(r.asked).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      await expect(done).resolves.toBe('facts');
      expect(r.asked).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
    expect(ADDRESS_LOOKUP_ATTEMPT_MS).toBe(20_000);
    expect(silentServerGivesUpMs({ retry: ADDRESS_LOOKUP_RETRY, timeout: ADDRESS_LOOKUP_TIMEOUT_S })).toBe(16_000);
    expect(silentServerGivesUpMs({ retry: ADDRESS_LOOKUP_RETRY, timeout: ADDRESS_LOOKUP_TIMEOUT_S })).toBeLessThan(ADDRESS_LOOKUP_ATTEMPT_MS);
  });

  it('the lookup does not change the sync\'s own servers or settings', async () => {
    const seen: BackendConfig[] = [];
    await syncThroughChainServers('bitcoin', saved(HOME_NODE), async (b) => {
      seen.push(b);
    });
    expect(seen[0].retry).not.toBe(ADDRESS_LOOKUP_RETRY);
  });
});
