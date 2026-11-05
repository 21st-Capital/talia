/**
 * The address book's lookup through the engine seam (decided 2026-11-05):
 * the bridge's `addressActivity` is OPTIONAL (an older binary has none, and
 * the check then answers 'unknown'), it is asked with the lookup's own
 * settings (no second try, 8 s an answer) on the server handed in, an
 * address of another network is never asked about, and the provider never
 * starts the known-answer test for it.
 */
jest.mock('../../../config', () => ({ ...jest.requireActual('../../../config'), BUILD_FLAVOUR: 'store' }));

import { addressActivityV3 } from '../bdkWalletEngine';
import type { BdkWalletNative, NativeServer } from '../bdkWalletNative';
import { ADDRESS_LOOKUP_RETRY, ADDRESS_LOOKUP_TIMEOUT_S, lookupServerOf, probeServerOf, syncServerOf } from '../bdkWalletRules';
import { configureEngine, ensureKnownAnswer, LIBRARY_CHECK_FAILED, lookUpAddressActivity, NO_WALLET_LIBRARY, resetEngineForTests } from '../engineProvider';
import { EngineError, serverUnreachable } from '../engineError';
import { fakeAddressActivity } from '../fakeEngine';
import type { AddressActivity, BackendConfig } from '../types';

const HOME: BackendConfig = { type: 'electrum', url: 'ssl://10.0.0.20:50002', retry: 5, timeout: 30, validateDomain: false };
const TEST_ADDRESS = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const BTC_ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const ANSWER: AddressActivity = { kind: 'txs', txs: [] };

/** A bridge that records every call; `withLookup` false is a binary from before the call. */
function bridge(opts: { withLookup?: boolean; answer?: unknown } = {}) {
  const calls: Array<{ call: string; args: unknown[] }> = [];
  const native: Record<string, unknown> = {
    knownAnswer: async () => {
      calls.push({ call: 'knownAnswer', args: [] });
      return { passed: true, vectors: 4 };
    },
    probeServer: async (...args: unknown[]) => {
      calls.push({ call: 'probeServer', args });
      return { height: 1 };
    },
  };
  if (opts.withLookup !== false) {
    native.addressActivity = async (...args: unknown[]) => {
      calls.push({ call: 'addressActivity', args });
      if (opts.answer instanceof Error) throw opts.answer;
      return opts.answer ?? ANSWER;
    };
  }
  return { native: native as unknown as BdkWalletNative, calls };
}

beforeEach(() => resetEngineForTests());

describe('the lookup settings', () => {
  it('no second try and 8 seconds an answer, whatever the server says, its certificate rule kept', () => {
    expect([ADDRESS_LOOKUP_RETRY, ADDRESS_LOOKUP_TIMEOUT_S]).toEqual([0, 8]);
    expect(lookupServerOf(HOME)).toEqual<NativeServer>({ url: HOME.url, retry: 0, timeout: 8, validateDomain: false });
    expect(lookupServerOf({ type: 'electrum', url: 'ssl://x:1' })).toEqual({ url: 'ssl://x:1', retry: 0, timeout: 8, validateDomain: true });
    // The sync and the connection test keep their own.
    expect(syncServerOf(HOME)).toMatchObject({ retry: 5, timeout: 30 });
    expect(probeServerOf({ type: 'electrum', url: 'ssl://x:1' })).toMatchObject({ retry: 2, timeout: 15 });
  });
});

describe('the engine call', () => {
  it('asks the server handed in, with the lookup settings and the bridge\'s network name', async () => {
    const { native, calls } = bridge();
    await expect(addressActivityV3(HOME, 'testnet', ` ${TEST_ADDRESS} `, native)).resolves.toEqual(ANSWER);
    expect(calls).toEqual([
      { call: 'addressActivity', args: [{ url: HOME.url, retry: 0, timeout: 8, validateDomain: false }, 'testnet', TEST_ADDRESS] },
    ]);
  });

  it('an older binary without the call answers null, asking nothing', async () => {
    const { native, calls } = bridge({ withLookup: false });
    await expect(addressActivityV3(HOME, 'bitcoin', BTC_ADDRESS, native)).resolves.toBeNull();
    expect(calls).toEqual([]);
  });

  it('an address of another network is never asked about', async () => {
    const { native, calls } = bridge();
    await expect(addressActivityV3(HOME, 'bitcoin', TEST_ADDRESS, native)).rejects.toThrow(/test network/);
    await expect(addressActivityV3(HOME, 'testnet', BTC_ADDRESS, native)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("a server the bridge could not reach keeps the bridge's mark", async () => {
    const refusal = Object.assign(new Error('Electrum client error: connection refused'), { code: 'SERVER_UNREACHABLE' });
    const { native } = bridge({ answer: refusal });
    const e = await addressActivityV3(HOME, 'bitcoin', BTC_ADDRESS, native).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).code).toBe('SERVER_UNREACHABLE');
    expect(serverUnreachable(e)).toBe(true);
  });
});

describe('the provider', () => {
  it('a build without the library asks nothing and says so', async () => {
    await expect(lookUpAddressActivity(HOME, 'bitcoin', BTC_ADDRESS)).rejects.toThrow(NO_WALLET_LIBRARY);
  });

  it('never runs the known-answer test for a lookup', async () => {
    const { native, calls } = bridge();
    configureEngine({ native });
    await expect(lookUpAddressActivity(HOME, 'bitcoin', BTC_ADDRESS)).resolves.toEqual(ANSWER);
    expect(calls.map((c) => c.call)).toEqual(['addressActivity']);
  });

  it('a library whose known answers FAILED this launch is not asked', async () => {
    const { native, calls } = bridge();
    (native as unknown as { knownAnswer: () => Promise<unknown> }).knownAnswer = async () => ({ passed: false, vectors: 4 });
    configureEngine({ native });
    await ensureKnownAnswer();
    await expect(lookUpAddressActivity(HOME, 'bitcoin', BTC_ADDRESS)).rejects.toThrow(LIBRARY_CHECK_FAILED);
    expect(calls.map((c) => c.call)).toEqual([]);
  });

  it('an older binary answers null through the provider too', async () => {
    configureEngine({ native: bridge({ withLookup: false }).native });
    await expect(lookUpAddressActivity(HOME, 'bitcoin', BTC_ADDRESS)).resolves.toBeNull();
  });
});

describe('the fake (offline UI development)', () => {
  it('nothing for an address, a spent history for one it is told is spent', () => {
    expect(fakeAddressActivity(BTC_ADDRESS)).toEqual({ kind: 'txs', txs: [] });
    const spent = fakeAddressActivity(BTC_ADDRESS, new Set([BTC_ADDRESS]));
    expect(spent.kind).toBe('txs');
  });
});
