/**
 * When the independent address check runs and what it blocks (decided 2026-10-15;
 * decided 2026-10-17): it is only queued when a vault's engine is made, runs
 * when the app is idle with one scure derivation per pause, is remembered as
 * a digest in the sealed store so the next launch derives nothing for the
 * same answers, and a mismatch of either keychain refuses every build of the
 * vault (a build waiting for the check starts it at once).
 */
jest.mock('react-native', () => ({ InteractionManager: { runAfterInteractions: (f: () => void) => f() } }));
jest.mock('../../config', () => ({ BUILD_FLAVOUR: 'full' }));
jest.mock('../../platform/engineReportFile', () => ({ REPORT_APP: {}, updateEngineReport: jest.fn() }));
jest.mock('../sealedStore', () => ({
  sealedGetItem: jest.fn(async () => null),
  sealedSetItem: jest.fn(async () => undefined),
}));

import {
  ADDRESS_CHECK_IDLE_MS,
  ADDRESS_CHECK_PROVEN_KEY,
  addressCheckVerdict,
  guardedEngine,
  onAddressCheck,
  reportAddressMismatch,
  resetAddressChecksForTests,
  scheduleAddressCheck,
} from '../addressCheckStore';
import type { ProvenStorage } from '../addressCheckStore';
import { classifyEngineError, EngineError } from '../../bitcoin/engine/engineError';
import { blocksBuilding, blocksReceive, isSendPaused, SEND_PAUSED_TITLE } from '../../bitcoin/engine/addressCheck';
import { updateEngineReport } from '../../platform/engineReportFile';
import { emptyEngineReport } from '../engineReport';
import type { EngineReport } from '../engineReport';
import { scureAddresses } from '../../bitcoin/descriptor/scureAddresses';
import { splitMultipathDescriptor } from '../../bitcoin/descriptor/multipath';
import { SPARROW_SINGLE_SIG } from '../../bitcoin/descriptor/__fixtures__/descriptors';
import type { WalletEngine } from '../../bitcoin/engine/types';

const pair = splitMultipathDescriptor(SPARROW_SINGLE_SIG);
const idx = Array.from({ length: 10 }, (_, i) => i);
const ext = scureAddresses(pair.external, 'testnet', idx)!;
const int = scureAddresses(pair.internal!, 'testnet', idx)!;
const vault = { id: 'v1', descriptor: SPARROW_SINGLE_SIG, network: 'testnet' as const };

/** An engine giving scure's addresses, or one change address wrong; it records every call. */
function engine(opts: { wrongChange?: number } = {}) {
  const calls: string[] = [];
  const e = {
    network: 'testnet',
    getReceiveAddress: async (i: number) => {
      calls.push(`ext ${i}`);
      return { address: ext[i].address, index: i, uri: '' };
    },
    getInternalAddress: async (i: number) => {
      calls.push(`int ${i}`);
      return { address: i === opts.wrongChange ? ext[i].address : int[i].address, index: i, uri: '' };
    },
    getBalance: async function (this: unknown) {
      calls.push('balance');
      return { confirmed: 1, trustedPending: 0, untrustedPending: 0, spendable: 1, total: 1 };
    },
    buildPsbt: async () => {
      calls.push('build');
      return { psbtBase64: 'p', txid: 't', feeSats: 1, sentSats: 1 };
    },
    buildRescuePsbt: async () => {
      calls.push('rescue');
      return { psbtBase64: 'p', txid: 't', feeSats: 1, sentSats: 0 };
    },
  };
  return { e: e as unknown as WalletEngine, calls };
}

function memory(): ProvenStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: async (k) => data[k] ?? null, setItem: async (k, v) => void (data[k] = v) };
}

/** Deps: idle at once; every timer of `ms` > 0 only when the test says. */
function setup(storage = memory()) {
  let pauses = 0;
  const waiting: Array<() => void> = [];
  resetAddressChecksForTests({
    storage,
    idle: async () => undefined,
    sleep: (ms) => {
      if (ms === 0) {
        pauses += 1;
        return Promise.resolve();
      }
      return new Promise<void>((r) => waiting.push(r));
    },
  });
  const flush = async () => {
    for (let i = 0; i < 200; i++) await Promise.resolve();
  };
  return {
    storage,
    pauses: () => pauses,
    /** The queue's pause before a sweep ends. */
    idleOver: async () => {
      await flush();
      waiting.splice(0).forEach((r) => r());
      await flush();
    },
    flush,
  };
}

describe('when the check runs', () => {
  it('making an engine only queues it: nothing is asked or derived until the app is idle', async () => {
    const t = setup();
    const { e, calls } = engine();
    const verdict = scheduleAddressCheck(vault, e);
    await t.flush();
    expect(calls).toEqual([]);
    expect(t.pauses()).toBe(0);
    expect(addressCheckVerdict('v1')).toBeNull();
    await t.idleOver();
    expect(await verdict).toMatchObject({ kind: 'match', derived: true });
    expect(t.pauses()).toBe(22); // each deriver made, then each address derived, in a piece of its own
    expect(ADDRESS_CHECK_IDLE_MS).toBeGreaterThan(0);
  });

  it('a proven sweep is kept sealed; the next launch with the same answers derives nothing', async () => {
    (updateEngineReport as jest.Mock).mockClear();
    const storage = memory();
    let t = setup(storage);
    const first = scheduleAddressCheck(vault, engine().e);
    await t.idleOver();
    expect(await first).toMatchObject({ kind: 'match', derived: true });
    const record = JSON.parse(storage.data[ADDRESS_CHECK_PROVEN_KEY]);
    expect(Object.keys(record)).toHaveLength(1);
    // The record names no descriptor and no address: a hash of the vault, a digest of its answers.
    expect(storage.data[ADDRESS_CHECK_PROVEN_KEY]).not.toMatch(/tpub|tb1/);
    // The next launch.
    t = setup(storage);
    const again = scheduleAddressCheck(vault, engine().e);
    await t.idleOver();
    expect(await again).toMatchObject({ kind: 'match', derived: false });
    expect(t.pauses()).toBe(0);
    // Both launches are counted, each under its own field (decided 2026-11-04 after a
    // phone test: a build whose vaults were all proven before left no entry at all).
    const app = { version: '1', build: '1', flavour: 'full' } as const;
    const counted = (updateEngineReport as jest.Mock).mock.calls.map(
      ([f]) => (f(emptyEngineReport(app, new Date()), app) as EngineReport).builds[0].sections.preflight,
    );
    expect(counted).toEqual([
      expect.objectContaining({ byOutcome: { match: 1 }, byField: { 'scure.address': 1 } }),
      expect.objectContaining({ byOutcome: { match: 1 }, byField: { 'scure.proven': 1 } }),
    ]);
  });

  it('one vault at a time', async () => {
    const t = setup();
    const a = engine();
    const b = engine();
    void scheduleAddressCheck(vault, a.e);
    void scheduleAddressCheck({ ...vault, id: 'v2', descriptor: SPARROW_SINGLE_SIG + ' ' }, b.e);
    await t.idleOver();
    expect(a.calls.length).toBe(20);
    expect(b.calls).toEqual([]);
    await t.idleOver();
    expect(b.calls.length).toBe(20);
  });
});

describe('what a mismatch blocks', () => {
  it('a change address that differs refuses every build of the vault, before the engine builds', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup();
    const { e, calls } = engine({ wrongChange: 6 });
    const guarded = guardedEngine(e, vault);
    void scheduleAddressCheck(vault, e);
    // A build while the sweep is still queued starts it at once and waits for it.
    const send = guarded.buildPsbt({ recipients: [{ address: ext[0].address, amountSats: 1 }], feeRate: 1 });
    const rescue = guarded.buildRescuePsbt({ utxos: [], destination: ext[0].address, feeRate: 1, branchFingerprint: 'aa' });
    await t.flush();
    await expect(send).rejects.toMatchObject({ code: 'ADDRESS_CHECK_FAILED' });
    await expect(rescue).rejects.toMatchObject({ code: 'ADDRESS_CHECK_FAILED' });
    expect(calls).not.toContain('build');
    expect(calls).not.toContain('rescue');
    expect(addressCheckVerdict('v1')).toEqual({ kind: 'mismatch', keychain: 'internal', index: 6 });
    await send.catch((err) => expect(classifyEngineError(err)).toBe('ADDRESS_CHECK_FAILED'));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/internal 6: the engine and scure disagree/));
    warn.mockRestore();
  });

  it('a vault whose addresses agree builds; every other call goes straight through', async () => {
    const t = setup();
    const { e, calls } = engine();
    const guarded = guardedEngine(e, vault);
    expect(await guarded.getBalance()).toMatchObject({ total: 1 });
    expect(guarded.network).toBe('testnet');
    const send = guarded.buildPsbt({ recipients: [{ address: ext[0].address, amountSats: 1 }], feeRate: 1 });
    await t.flush();
    expect(await send).toMatchObject({ txid: 't' });
    expect(calls.filter((c) => c === 'build')).toHaveLength(1);
  });

  it('an engine that cannot answer blocks nothing', async () => {
    const t = setup();
    const { e, calls } = engine();
    const busy = { ...e, getReceiveAddress: async () => Promise.reject(new Error('queue busy')) } as unknown as WalletEngine;
    const guarded = guardedEngine(busy, vault);
    const send = guarded.buildPsbt({ recipients: [{ address: ext[0].address, amountSats: 1 }], feeRate: 1 });
    await t.flush();
    expect(await send).toMatchObject({ txid: 't' });
    expect(calls).toContain('build');
  });
});

describe('a pause found past the sweep (decided 2026-10-17: the change sits at the library\'s next index)', () => {
  /** The sweep matches; the engine's own build refuses: its change output is not scure's at internal 37. */
  function changeRefused(code: 'ADDRESS_CHECK_FAILED' | 'POST_BUILD_CHECK' = 'ADDRESS_CHECK_FAILED') {
    const base = engine();
    let builds = 0;
    const e = {
      ...(base.e as unknown as Record<string, unknown>),
      buildPsbt: async () => {
        builds += 1;
        throw code === 'ADDRESS_CHECK_FAILED'
          ? new EngineError('ADDRESS_CHECK_FAILED', SEND_PAUSED_TITLE, { mismatch: { keychain: 'internal', index: 37 } })
          : new EngineError('POST_BUILD_CHECK', 'The payment was not built safely: the payment could not be read');
      },
      buildRescuePsbt: async () => {
        builds += 1;
        return { psbtBase64: 'p', txid: 't', feeSats: 1, sentSats: 0 };
      },
    } as unknown as WalletEngine;
    return { e, builds: () => builds };
  }
  const request = { recipients: [{ address: ext[0].address, amountSats: 1 }], feeRate: 1 };

  it('a build the engine refuses for its own output pauses the vault: told to Receive and Send, and every later build refused first', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (updateEngineReport as jest.Mock).mockClear();
    const t = setup();
    const { e, builds } = changeRefused();
    const told: unknown[] = [];
    onAddressCheck((id, v) => told.push([id, v]));
    const guarded = guardedEngine(e, vault);
    const first = guarded.buildPsbt(request);
    await t.flush();
    const err = await first.catch((x) => x);
    expect(isSendPaused(err)).toBe(true);
    expect(builds()).toBe(1);
    // The sweep matched, then the build found the disagreement: the vault is paused.
    expect(told).toEqual([
      ['v1', expect.objectContaining({ kind: 'match' })],
      ['v1', { kind: 'mismatch', keychain: 'internal', index: 37 }],
    ]);
    expect(addressCheckVerdict('v1')).toEqual({ kind: 'mismatch', keychain: 'internal', index: 37 });
    expect(blocksReceive(addressCheckVerdict('v1'))).toBe(true);
    expect(blocksBuilding(addressCheckVerdict('v1'))).toBe(true);
    // Every later build, a rescue's included, is refused before the engine is asked.
    const again = guarded.buildPsbt(request);
    const rescue = guarded.buildRescuePsbt({ utxos: [], destination: ext[0].address, feeRate: 1, branchFingerprint: 'aa' });
    await t.flush();
    expect(isSendPaused(await again.catch((x) => x))).toBe(true);
    expect(isSendPaused(await rescue.catch((x) => x))).toBe(true);
    expect(builds()).toBe(1);
    // Counted under its own field, and logged without an address.
    const app = { version: '1', build: '1', flavour: 'full' } as const;
    const counted = (updateEngineReport as jest.Mock).mock.calls.map(
      ([f]) => (f(emptyEngineReport(app, new Date()), app) as EngineReport).builds[0].sections.preflight.byField,
    );
    expect(counted).toContainEqual({ 'scure.output': 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/scure\.output internal 37: the engine and scure disagree/));
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/tb1|tpub/);
    warn.mockRestore();
  });

  it('a pause stays for the launch: a later sweep that matches never lifts it', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = setup();
    const { e } = engine();
    reportAddressMismatch(vault, 'external', 37);
    expect(addressCheckVerdict('v1')).toEqual({ kind: 'mismatch', keychain: 'external', index: 37 });
    // The 0..9 sweep runs and matches: it cannot see index 37, so the pause holds.
    const sweep = scheduleAddressCheck(vault, e);
    await t.idleOver();
    expect(await sweep).toMatchObject({ kind: 'match' });
    expect(addressCheckVerdict('v1')).toEqual({ kind: 'mismatch', keychain: 'external', index: 37 });
    const guarded = guardedEngine(e, vault);
    const send = guarded.buildPsbt(request);
    await t.flush();
    expect(isSendPaused(await send.catch((x) => x))).toBe(true);
    warn.mockRestore();
  });

  it('a build refused for anything else (a payment that could not be read) pauses nothing', async () => {
    const t = setup();
    const { e, builds } = changeRefused('POST_BUILD_CHECK');
    const guarded = guardedEngine(e, vault);
    const first = guarded.buildPsbt(request);
    await t.flush();
    const err = await first.catch((x) => x);
    expect(classifyEngineError(err)).toBe('POST_BUILD_CHECK');
    expect(isSendPaused(err)).toBe(false);
    expect(addressCheckVerdict('v1')).toMatchObject({ kind: 'match' });
    // The next build reaches the engine again.
    const next = guarded.buildPsbt(request);
    await t.flush();
    await next.catch(() => undefined);
    expect(builds()).toBe(2);
  });

  it('an ADDRESS_CHECK_FAILED with no location (the gate\'s own refusal) is not mistaken for a new finding', async () => {
    const t = setup();
    const told: unknown[] = [];
    onAddressCheck((id, v) => told.push(v));
    const { e } = engine();
    const plain = { ...(e as unknown as Record<string, unknown>), buildPsbt: async () => Promise.reject(new EngineError('ADDRESS_CHECK_FAILED', SEND_PAUSED_TITLE)) } as unknown as WalletEngine;
    const send = guardedEngine(plain, vault).buildPsbt(request);
    await t.flush();
    await send.catch(() => undefined);
    expect(told).toEqual([expect.objectContaining({ kind: 'match' })]);
  });
});
