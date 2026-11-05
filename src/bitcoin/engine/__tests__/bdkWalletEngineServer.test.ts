/**
 * The new engine and the vault's servers (decided 2026-10-18: a Bitcoin
 * vault talks to the server the client chose and to no other; a Testnet4
 * vault to the built-in list, each server asked the Testnet4 way). The
 * same rules bdkEngineServer.test.ts holds today's engine to:
 *
 *   - a sync and the connection test go to the server handed in, with its
 *     own retry, timeout and certificate rule (Testnet4's no-retry, 8 s
 *     setting reaches the bridge as it is);
 *   - every broadcast goes to the server handed in, through a short-lived
 *     client of its own, never the server of the last sync;
 *   - the one sync the engine makes on its own (after its library recreated
 *     a wallet) asks the vault's servers as they are THEN, so a server the
 *     client has left is never asked again, and nothing is asked while the
 *     vault has no server.
 *
 * The bridge is a stand-in that records which server each call names; the
 * servers come from wallet/chainServers.ts, the rule the app uses.
 */
jest.mock('../spendGate', () => ({ assertSigningEnabled: () => undefined }));

import { BdkWalletEngineV3, testBackendConnectionV3 } from '../bdkWalletEngine';
import type { BdkWalletNative, NativeServer } from '../bdkWalletNative';
import type { BackendConfig } from '../types';
import { chainServersFor, __forgetGoodServersForTests } from '../../../wallet/chainServers';
import { TESTNET4_ELECTRUM_SERVERS } from '../../network';
import { signedRescueTx } from '../../../testing/signedRescueTx';
import { SPARROW_SINGLE_SIG } from '../../descriptor/__fixtures__/descriptors';

const reject = (code: string, message: string) => Object.assign(new Error(message), { code });

type Seen = { call: string; server?: NativeServer };

/** A bridge that answers like the library and remembers the server of every call. */
function bridge(o: { panicOnce?: boolean; unspentResyncing?: { once: boolean } } = {}) {
  const seen: Seen[] = [];
  let needsSync = false;
  let panicked = false;
  const base: Record<string, (...a: never[]) => unknown> = {
    openWallet: () => 'w1',
    closeWallet: () => true,
    sync: (_id: string, server: NativeServer) => {
      seen.push({ call: 'sync', server });
      needsSync = false;
      return { tipHeight: 900, tipHash: 'fe'.repeat(32), ms: 1, passes: 1, lookahead: 150 };
    },
    balance: () => {
      if (o.panicOnce && !panicked) {
        panicked = true;
        needsSync = true;
        throw reject('RUST_PANIC', 'The wallet library stopped');
      }
      if (needsSync) throw reject('WALLET_RESYNCING', 'syncing');
      return { confirmed: 7, trustedPending: 0, untrustedPending: 0, immature: 0, spendable: 7, total: 7 };
    },
    unspent: () => {
      if (o.unspentResyncing?.once) {
        // The bridge recreated the wallet behind the engine's back.
        o.unspentResyncing.once = false;
        throw reject('WALLET_RESYNCING', 'syncing');
      }
      if (needsSync) throw reject('WALLET_RESYNCING', 'syncing');
      return [];
    },
    extract: () => '0200',
    parseTransaction: () => ({ txid: 'ee'.repeat(32) }),
    broadcast: (server: NativeServer) => {
      seen.push({ call: 'broadcast', server });
      return 'cd'.repeat(32);
    },
    probeServer: (server: NativeServer) => {
      seen.push({ call: 'probeServer', server });
      return { height: 900 };
    },
    isMine: () => false,
    transactions: () => [
      { txid: 'ab'.repeat(32), sent: 0, received: 5, fee: 1, height: 812, timestamp: 1_700_000_000, blockHash: 'cd'.repeat(32) },
      { txid: 'ef'.repeat(32), sent: 0, received: 6, fee: 1, height: null, timestamp: null, blockHash: null },
      // A bridge before 2026-10-28 gives no hash.
      { txid: '12'.repeat(32), sent: 0, received: 7, fee: 1, height: 811, timestamp: 1_699_999_000 },
    ],
    serverBlocks: (_id: string, server: NativeServer, heights: number[]) => {
      seen.push({ call: 'serverBlocks', server });
      return heights.map((h) => (h > 900 ? null : { height: h, hash: 'cd'.repeat(32), time: 1_700_000_000 }));
    },
  };
  const native = new Proxy(base, {
    get: (t, name: string) => async (...args: never[]) => {
      const f = t[name];
      if (!f) throw new Error(`the stand-in has no ${name}`);
      return f(...args);
    },
  }) as unknown as BdkWalletNative;
  return { native, seen };
}

const PUBLIC: BackendConfig = { type: 'electrum', url: 'ssl://public.example:50002', retry: 5, timeout: 30, validateDomain: true };
const HOME: BackendConfig = { type: 'electrum', url: 'ssl://10.0.0.2:50002', retry: 5, timeout: 30, validateDomain: false };

beforeEach(() => __forgetGoodServersForTests());

describe('a sync and the connection test go to the server handed in', () => {
  it('Testnet4\'s own setting (no second try on a server, 8 s) reaches the bridge as it is', async () => {
    const [first] = chainServersFor('testnet', { electrumUrls: {} });
    expect(first.retry).toBe(0);
    expect(first.timeout).toBe(8);
    const { native, seen } = bridge();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await e.sync(first);
    expect(seen).toEqual([{ call: 'sync', server: { url: first.url, retry: 0, timeout: 8, validateDomain: true } }]);
  });

  it('a Bitcoin vault\'s server exactly as the client saved it, with its certificate rule', async () => {
    const [home] = chainServersFor('bitcoin', { electrumUrls: { bitcoin: HOME.url } });
    const { native, seen } = bridge();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await e.sync(home);
    expect(seen[0].server).toMatchObject({ url: HOME.url, validateDomain: false });
    expect(await testBackendConnectionV3(home, native)).toBe(900);
    expect(seen[1]).toEqual({ call: 'probeServer', server: expect.objectContaining({ url: HOME.url, validateDomain: false }) });
  });
});

describe('every broadcast goes to the server handed in, never the last sync\'s', () => {
  it('a payment made right after the client saved their own node goes to that node, not the public server the vault synced with', async () => {
    const { native, seen } = bridge();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await e.sync(PUBLIC);
    await e.broadcastPsbt('cHNidP8=', HOME);
    expect(seen.map((s) => [s.call, s.server?.url, s.server?.validateDomain])).toEqual([
      ['sync', PUBLIC.url, true],
      ['broadcast', HOME.url, false],
    ]);
  });

  it('the same for a reviewed raw transaction and for a rescue', async () => {
    const tx = signedRescueTx(4);
    const { native, seen } = bridge();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await e.sync(PUBLIC);
    await e.broadcastRawTx(tx.raw, HOME, tx.txid);
    // The rescue's own checks refuse this coin (not the vault's): nothing goes out at all.
    await expect(e.broadcastRescue(tx.raw, {}, HOME)).rejects.toMatchObject({ refusal: { code: 'foreign-coins' } });
    expect(seen.filter((s) => s.call === 'broadcast').map((s) => s.server?.url)).toEqual([HOME.url]);
  });

  it('a Testnet4 broadcast moving on to the next server reaches that server', async () => {
    const [first, second] = chainServersFor('testnet', { electrumUrls: {} });
    const { native, seen } = bridge();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await e.sync(first);
    await e.broadcastPsbt('cHNidP8=', second);
    expect(seen.filter((s) => s.call === 'broadcast').map((s) => s.server?.url)).toEqual([TESTNET4_ELECTRUM_SERVERS[1]]);
  });
});

describe('the sync the engine makes on its own, after a panic', () => {
  async function afterPanic(servers: () => Promise<readonly BackendConfig[]>, synced: BackendConfig) {
    const { native, seen } = bridge({ panicOnce: true });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'bitcoin', chainServers: servers }, { native });
    await e.sync(synced);
    await expect(e.getBalance()).rejects.toMatchObject({ code: 'RUST_PANIC' });
    return { e, seen };
  }

  it('the last sync\'s server while it is still the vault\'s', async () => {
    const { e, seen } = await afterPanic(async () => [PUBLIC], PUBLIC);
    expect(await e.getBalance()).toMatchObject({ total: 7 });
    expect(seen.map((s) => s.server?.url)).toEqual([PUBLIC.url, PUBLIC.url]);
  });

  it('the client chose their own node since: the node, never the public server they left', async () => {
    const settings = { electrumUrls: {} as Record<string, string> };
    const { e, seen } = await afterPanic(async () => chainServersFor('bitcoin', settings), chainServersFor('bitcoin', settings)[0]);
    settings.electrumUrls.bitcoin = HOME.url;
    expect(await e.getBalance()).toMatchObject({ total: 7 });
    expect(seen.map((s) => [s.server?.url, s.server?.validateDomain])).toEqual([
      ['ssl://electrum.blockstream.info:50002', true],
      [HOME.url, false],
    ]);
  });

  it('a Testnet4 vault keeps the built-in server it last used', async () => {
    const list = chainServersFor('testnet', { electrumUrls: {} });
    const { native, seen } = bridge({ panicOnce: true });
    const e = await BdkWalletEngineV3.create(
      { descriptor: SPARROW_SINGLE_SIG, network: 'testnet', chainServers: async () => list },
      { native },
    );
    await e.sync(list[2]);
    await expect(e.getBalance()).rejects.toMatchObject({ code: 'RUST_PANIC' });
    await e.getBalance();
    expect(seen.map((s) => s.server?.url)).toEqual([list[2].url, list[2].url]);
  });

  it('while the vault has no server, nothing is asked: the read fails and the next sync of the vault mends it', async () => {
    const servers: { now: BackendConfig[] } = { now: [PUBLIC] };
    const { e, seen } = await afterPanic(async () => servers.now, PUBLIC);
    servers.now = [];
    await expect(e.getBalance()).rejects.toMatchObject({ code: 'WALLET_RESYNCING' });
    expect(seen.map((s) => s.call)).toEqual(['sync']);
  });

  it('a read that meets WALLET_RESYNCING from a panic it did not see asks the vault\'s servers too', async () => {
    const settings = { electrumUrls: {} as Record<string, string> };
    const unspentResyncing = { once: false };
    const { native, seen } = bridge({ unspentResyncing });
    const e = await BdkWalletEngineV3.create(
      { descriptor: SPARROW_SINGLE_SIG, network: 'bitcoin', chainServers: async () => chainServersFor('bitcoin', settings) },
      { native },
    );
    await e.sync(chainServersFor('bitcoin', settings)[0]);
    settings.electrumUrls.bitcoin = HOME.url;
    unspentResyncing.once = true;
    expect(await e.listUtxos()).toEqual([]);
    expect(seen.map((s) => s.server?.url)).toEqual(['ssl://electrum.blockstream.info:50002', HOME.url]);
  });

  it('without the wallet layer\'s list (the tier C runner), the last sync\'s server, as before', async () => {
    const { native, seen } = bridge({ panicOnce: true });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'bitcoin' }, { native });
    await e.sync(PUBLIC);
    await expect(e.getBalance()).rejects.toMatchObject({ code: 'RUST_PANIC' });
    await e.getBalance();
    expect(seen.map((s) => s.server?.url)).toEqual([PUBLIC.url, PUBLIC.url]);
  });
});

// Decided 2026-10-28: the shadow's check of a reported block against the chain.
describe('the server\'s blocks, for the shadow\'s reorganisation check', () => {
  it('are asked of the last sync\'s server, and nothing is asked before a sync', async () => {
    const { native, seen } = bridge();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    expect(await e.serverBlocks([812])).toBeNull();
    expect(seen).toEqual([]);
    await e.sync(HOME);
    expect(await e.serverBlocks([812, 901])).toEqual([{ height: 812, hash: 'cd'.repeat(32), time: 1_700_000_000 }, null]);
    expect(seen.map((x) => [x.call, x.server?.url, x.server?.validateDomain])).toEqual([
      ['sync', HOME.url, false],
      ['serverBlocks', HOME.url, false],
    ]);
  });

  it('a confirmed transaction carries its block\'s hash where the bridge gives one; nothing else changes', async () => {
    const { native } = bridge();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await e.sync(PUBLIC);
    const txs = await e.listTransactions();
    expect(txs.find((t) => t.txid === 'ab'.repeat(32))).toMatchObject({ confirmed: true, blockHeight: 812, blockHash: 'cd'.repeat(32) });
    expect(txs.find((t) => t.txid === 'ef'.repeat(32))).not.toHaveProperty('blockHash');
    expect(txs.find((t) => t.txid === '12'.repeat(32))).not.toHaveProperty('blockHash');
  });

  it('the tip block\'s hash of the last sync, forgotten after a panic', async () => {
    const { native } = bridge({ panicOnce: true });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'bitcoin' }, { native });
    expect(e.getTipHash()).toBeUndefined();
    await e.sync(PUBLIC);
    expect(e.getTipHash()).toBe('fe'.repeat(32));
    await expect(e.getBalance()).rejects.toMatchObject({ code: 'RUST_PANIC' });
    expect(e.getTipHash()).toBeUndefined();
  });

  it('a bridge without the call answers nothing', async () => {
    const { native } = bridge();
    const plain = new Proxy(native, { get: (t, n) => (n === 'serverBlocks' ? undefined : (t as never)[n]) }) as BdkWalletNative;
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native: plain });
    await e.sync(PUBLIC);
    expect(await e.serverBlocks([812])).toBeNull();
  });
});
