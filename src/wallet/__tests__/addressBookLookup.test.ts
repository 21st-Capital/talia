/**
 * The address book's check, run (decided 2026-11-05): an Exchange Address is
 * never looked up; a Private Address is asked about on the vault network's
 * own server (the server rule), and a spent one is remembered as
 * `spentSeenAt` and never asked about again; nothing found is not stored;
 * any error, no server or an older bridge is 'unknown'.
 */
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));
const mockLookUp = jest.fn();
jest.mock('../engineProvider', () => ({ lookUpActivity: (...args: unknown[]) => mockLookUp(...args) }));

import { __forgetAddressChecksForTests, checkBookAddress, lookupNetworkOf } from '../addressBookLookup';
import type { BookCheckDeps } from '../addressBookLookup';
import { activityVerdict } from '../addressBookCheck';
import { loadAddressBook, saveAddress, __resetAddressBookForTests } from '../addressBook';
import { __forgetGoodServersForTests, NO_BITCOIN_SERVER } from '../chainServers';
import { __resetSealedStoreForTests } from '../sealedStore';
import { DEFAULT_ELECTRUM, TESTNET4_ELECTRUM_SERVERS } from '../../bitcoin/network';
import { fakeAddressActivity } from '../../bitcoin/engine/fakeEngine';
import type { AddressActivity, BackendConfig } from '../../bitcoin/engine/types';
import type { Network } from '../../bitcoin/descriptor/types';

const mem = require('../../testing/memoryKeychain') as typeof import('../../testing/memoryKeychain');
const disk = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const TEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const HOME_NODE = 'ssl://10.0.0.20:50002';
const id = (c: string) => c.repeat(64);

const SPENT: AddressActivity = {
  kind: 'txs',
  txs: [
    { txid: id('a'), height: 800_000, spends: [`${id('e')}:0`], pays: [0] },
    { txid: id('b'), height: 800_001, spends: [`${id('a')}:0`], pays: [] },
  ],
};
const RECEIVED: AddressActivity = { kind: 'txs', txs: [{ txid: id('a'), height: 800_000, spends: [`${id('e')}:0`], pays: [0] }] };

/** Deps that record what was asked; `answer` per server url. */
function deps(answer: (b: BackendConfig) => Promise<AddressActivity | null>, knownSpentAt?: number) {
  const asked: Array<{ url: string; retry?: number; timeout?: number; network: Network; address: string }> = [];
  const marked: Array<[string, number]> = [];
  const d: BookCheckDeps = {
    lookUp: (b, network, address) => {
      asked.push({ url: b.url, retry: b.retry, timeout: b.timeout, network, address });
      return answer(b);
    },
    knownSpentAt: async () => knownSpentAt,
    markSpent: async (address, at) => {
      marked.push([address, at]);
    },
    now: () => 1234,
  };
  return { d, asked, marked };
}

const settings = (bitcoin?: string) => ({ electrumUrls: bitcoin ? { bitcoin } : {} });

beforeEach(() => {
  __forgetAddressChecksForTests();
  __forgetGoodServersForTests();
  mockLookUp.mockReset();
  mem.__reset();
  disk.clear();
  __resetSealedStoreForTests();
  __resetAddressBookForTests();
});

describe('an Exchange Address is NEVER looked up', () => {
  it('idle, and nothing asked', async () => {
    const { d, asked } = deps(async () => SPENT);
    await expect(checkBookAddress({ address: BTC, category: 'exchange', network: 'bitcoin', settings: settings() }, d)).resolves.toEqual({
      state: 'idle',
    });
    expect(asked).toEqual([]);
  });
});

describe('a Private Address', () => {
  it('is asked about on the server the client chose, with the lookup settings, its address bare', async () => {
    const { d, asked } = deps(async () => RECEIVED);
    const answer = await checkBookAddress(
      { address: BTC.toUpperCase(), category: 'private', network: 'bitcoin', settings: settings(HOME_NODE) },
      d,
    );
    expect(answer).toEqual({ state: 'notFound' });
    expect(asked).toEqual([{ url: HOME_NODE, retry: 0, timeout: 8, network: 'bitcoin', address: BTC }]);
  });

  it('spent: remembered as spentSeenAt, and never asked about again', async () => {
    const { d, asked, marked } = deps(async () => SPENT);
    const req = { address: BTC, category: 'private' as const, network: 'bitcoin' as const, settings: settings() };
    await expect(checkBookAddress(req, d)).resolves.toEqual({ state: 'spent', spentSeenAt: 1234 });
    expect(marked).toEqual([[BTC, 1234]]);
    await expect(checkBookAddress(req, d)).resolves.toEqual({ state: 'spent', spentSeenAt: 1234 });
    expect(asked).toHaveLength(1);
  });

  it('what the screen or the book already knows is not asked again', async () => {
    const known = deps(async () => RECEIVED);
    await expect(
      checkBookAddress({ address: BTC, category: 'private', network: 'bitcoin', settings: settings(), spentSeenAt: 7 }, known.d),
    ).resolves.toEqual({ state: 'spent', spentSeenAt: 7 });
    const book = deps(async () => RECEIVED, 9);
    await expect(checkBookAddress({ address: BTC, category: 'private', network: 'bitcoin', settings: settings() }, book.d)).resolves.toEqual({
      state: 'spent',
      spentSeenAt: 9,
    });
    expect([...known.asked, ...book.asked]).toEqual([]);
  });

  it('nothing found is not stored: it is asked again next time', async () => {
    const { d, asked, marked } = deps(async () => ({ kind: 'txs', txs: [] }));
    const req = { address: BTC, category: 'private' as const, network: 'bitcoin' as const, settings: settings() };
    await checkBookAddress(req, d);
    await expect(checkBookAddress(req, d)).resolves.toEqual({ state: 'notFound' });
    expect(asked).toHaveLength(2);
    expect(marked).toEqual([]);
  });

  it('a long history with no proof is unknown, never nothing found', async () => {
    const { d } = deps(async () => ({ kind: 'long', history: [{ txid: id('a'), height: 1 }], unspent: [{ txid: id('a'), vout: 0, height: 1 }] }));
    await expect(checkBookAddress({ address: BTC, category: 'private', network: 'bitcoin', settings: settings() }, d)).resolves.toEqual({
      state: 'unknown',
    });
  });

  it('an error, an older bridge (null) or a held server is unknown', async () => {
    const failing = deps(async () => {
      throw Object.assign(new Error('Electrum client error: connection refused'), { code: 'SERVER_UNREACHABLE' });
    });
    const older = deps(async () => null);
    const held = deps(async () => SPENT);
    const req = { address: BTC, category: 'private' as const, network: 'bitcoin' as const };
    await expect(checkBookAddress({ ...req, settings: settings() }, failing.d)).resolves.toEqual({ state: 'unknown' });
    await expect(checkBookAddress({ ...req, settings: settings() }, older.d)).resolves.toEqual({ state: 'unknown' });
    await expect(
      checkBookAddress({ ...req, settings: { electrumUrls: {}, bitcoinServerHold: { reason: 'unreadable' } } }, held.d),
    ).resolves.toEqual({ state: 'unknown' });
    expect(held.asked).toEqual([]);
    expect(NO_BITCOIN_SERVER).toBeTruthy();
  });

  it('a Bitcoin lookup with nothing saved asks the default server alone', async () => {
    const { d, asked } = deps(async () => {
      throw new Error('Electrum client error: connection refused');
    });
    await checkBookAddress({ address: BTC, category: 'private', network: 'bitcoin', settings: settings() }, d);
    expect(asked.map((a) => a.url)).toEqual([DEFAULT_ELECTRUM.bitcoin]);
  });

  it('Testnet4 moves on to the next built-in server', async () => {
    const { d, asked } = deps(async (b) => {
      if (b.url === TESTNET4_ELECTRUM_SERVERS[0]) throw Object.assign(new Error('refused'), { code: 'SERVER_UNREACHABLE' });
      return SPENT;
    });
    await expect(checkBookAddress({ address: TEST, category: 'private', network: 'testnet', settings: settings(HOME_NODE) }, d)).resolves.toEqual({
      state: 'spent',
      spentSeenAt: 1234,
    });
    expect(asked.map((a) => a.url)).toEqual(TESTNET4_ELECTRUM_SERVERS.slice(0, 2));
  });

  it('an address the vault cannot pay is never asked about; without a vault, its own network', async () => {
    const { d, asked } = deps(async () => RECEIVED);
    await expect(checkBookAddress({ address: TEST, category: 'private', network: 'bitcoin', settings: settings() }, d)).resolves.toEqual({
      state: 'idle',
    });
    await expect(checkBookAddress({ address: 'nonsense', category: 'private', settings: settings() }, d)).resolves.toEqual({ state: 'idle' });
    expect(asked).toEqual([]);
    await checkBookAddress({ address: TEST, category: 'private', settings: settings() }, d);
    expect(asked.map((a) => a.network)).toEqual(['testnet']);
    expect([lookupNetworkOf(BTC), lookupNetworkOf(TEST), lookupNetworkOf('bcrt1q022amqf3jv7mg744rcjmst222dfazqvmurt943')]).toEqual([
      'bitcoin',
      'testnet',
      'regtest',
    ]);
  });
});

describe('with the real book and engine entry', () => {
  it('a saved Private Address found spent carries spentSeenAt in the book', async () => {
    mockLookUp.mockResolvedValue(SPENT);
    await saveAddress({ address: BTC, name: 'Mum', category: 'private' }, 1);
    const answer = await checkBookAddress({ address: BTC, category: 'private', network: 'bitcoin', settings: settings(HOME_NODE) });
    expect(answer.state).toBe('spent');
    expect((await loadAddressBook())[0].spentSeenAt).toBe(answer.spentSeenAt);
    expect(mockLookUp).toHaveBeenCalledTimes(1);
    expect(mockLookUp.mock.calls[0][0]).toMatchObject({ url: HOME_NODE, retry: 0, timeout: 8 });
    // A second check reads the book and asks nothing.
    __forgetAddressChecksForTests();
    await expect(checkBookAddress({ address: BTC, category: 'private', network: 'bitcoin', settings: settings(HOME_NODE) })).resolves.toEqual(
      answer,
    );
    expect(mockLookUp).toHaveBeenCalledTimes(1);
  });

  it("the fake's canned answers read as the rule says", () => {
    expect(activityVerdict(fakeAddressActivity(BTC))).toBe('notFound');
    expect(activityVerdict(fakeAddressActivity(BTC, new Set([BTC])))).toBe('spent');
  });
});
