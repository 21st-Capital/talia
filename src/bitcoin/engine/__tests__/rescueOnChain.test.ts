/**
 * The rescue's Sent page and its bookkeeping (2026-10-19) hold through the
 * engine (bdk-ffi 3.1.1 behind TaliaBdkWalletModule). The Rescue screen asks
 * an engine for:
 *
 *   - the vault's coins and which outputs are its own (the rescue rule
 *     before a broadcast, `assertRescueSpend`);
 *   - its record of a transaction by txid, waiting ones included, with
 *     what it took from the vault (`sent`) and its fee (`findWalletTx`,
 *     `networkTx`), and the rescue rule on it (`assertRescueOnChain`);
 *   - the broadcast itself, to the server the chain-server rule hands in,
 *     of a raw transaction or of the signed PSBT 21st Capital's rescue
 *     signer returns for a script-path spend, which the engine finishes
 *     with its library's finalizer before the rule and the broadcast.
 *
 * The engine is driven here with the chain facts through its bridge (a
 * stand-in of the module), and must give the right answers: the txid sent
 * to the server the rule hands in, the record of the rescue once it is out,
 * the verdicts of the rescue rule, the reading of the network's words
 * (wallet/broadcastAnswer.ts, wallet/chainServers.ts). Until the old engine's
 * removal (decided 2026-11-04) the old engine (bdk 0.28 behind bdk-rn)
 * was driven beside it and had to give the same answers.
 */
jest.mock('../spendGate', () => ({ assertSigningEnabled: () => undefined }));

import { signedRescueTx } from '../../../testing/signedRescueTx';
import { rawTxShape, BroadcastRefusedError } from '../../psbt/broadcastCheck';
import type { RescueExpectation } from '../../psbt/broadcastCheck';
import { scriptToAddress } from '../../psbt/parse';
import { encodeBase64 } from '../../psbt/export';
import { assertRescueOnChain } from '../engineShared';
import { BdkWalletEngineV3 } from '../bdkWalletEngine';
import type { BdkWalletNative, NativeServer } from '../bdkWalletNative';
import type { BackendConfig, WalletEngine } from '../types';
import { answerMayBeLost, findWalletTx, networkTx } from '../../../wallet/broadcastAnswer';
import {
  __forgetGoodServersForTests,
  broadcastWithWatchdog,
  chainServersFor,
  serverFailed,
  serverUnreachable,
} from '../../../wallet/chainServers';

const TX = signedRescueTx(9);
const hexBytes = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));
/** Where the client asked the rescue to go: where TX pays. */
const DEST_SCRIPT = TX.outScriptHex;
const DEST = scriptToAddress(hexBytes(DEST_SCRIPT), 'testnet')!;
/** The coin TX spends was worth 380 000: it pays 370 083, 9 917 in fee. */
const COIN_SATS = 380_000;
const FEE = COIN_SATS - TX.valueSats;

/** The chain the engine reads, per test. */
const mockChain = {
  /** Is the rescue on the chain (and the coin spent)? */
  onChain: false,
  /** The vault's record of the rescue once it is out. */
  sent: COIN_SATS,
  fee: FEE as number | null,
  /** Every connection: which server, for which call (and the transaction a broadcast sent, hex, when known). */
  calls: [] as Array<{ engine: string; call: string; url: string; sent?: string }>,
  /** What each library's finalizer was handed (base64). */
  finalizing: [] as Array<{ engine: string; psbt: string }>,
};

// ---------------------------------------------------------------- the engine, module stand-in

function newBridge(): BdkWalletNative {
  const base: Record<string, (...a: never[]) => unknown> = {
    openWallet: () => 'w1',
    sync: (_id: string, server: NativeServer) => {
      mockChain.calls.push({ engine: 'v3', call: 'sync', url: server.url });
      return { tipHeight: 157_034, ms: 1, passes: 1, lookahead: 150 };
    },
    unspent: () =>
      mockChain.onChain
        ? []
        : [{ txid: TX.spends.txid, vout: TX.spends.vout, value: COIN_SATS, keychain: 'external', index: 0, height: 157_000, address: null }],
    // bdk-ffi's transactions(): sent_and_received and calculate_fee (null when unknown).
    transactions: () =>
      mockChain.onChain
        ? [{ txid: TX.txid, sent: mockChain.sent, received: 0, fee: mockChain.fee, height: null, timestamp: null }]
        : [],
    isMine: () => false,
    parseTransaction: () => ({ txid: TX.txid }),
    // The library's finalizer (finalize_psbt_keeping_metadata): the signed
    // rescue is finalized, anything else comes back as it went in, refused.
    finalize: (_id: string, psbt: string) => {
      mockChain.finalizing.push({ engine: 'v3', psbt });
      return psbt === SIGNED_B64
        ? { psbt: FINAL_B64, finalized: true, error: null }
        : { psbt, finalized: false, error: 'SignerError.MissingKey' };
    },
    psbtInfo: (psbt: string) => ({ psbt, txid: TX.txid, fee: FEE }),
    extract: (psbt: string) => {
      if (psbt !== FINAL_B64) throw new Error('the stand-in extracts the finalized rescue only');
      return TX.rawHex;
    },
    broadcast: (server: NativeServer, hex: string) => {
      mockChain.calls.push({ engine: 'v3', call: 'broadcast', url: server.url, sent: hex });
      return TX.txid;
    },
  };
  return new Proxy(base, {
    get: (t, name: string) => async (...args: never[]) => {
      const f = t[name];
      if (!f) throw new Error(`the stand-in has no ${name}`);
      return f(...args);
    },
  }) as unknown as BdkWalletNative;
}

const DESCRIPTOR = "tr([d34db33f/86'/1'/0']tpubDCm4cDYdbeoK5uiUMZTXSKZYQtqyWQLx1dDhiJHy7sgNK4xYsoyRQ9pSBKvqpTxwiFDAcwXxitzqUhgMMh1zd7mxoBV8M2ASfoKmeVF67BB/0/*)";

const ENGINES: Array<[string, () => Promise<WalletEngine>]> = [
  ['the engine (3.1.1)', () => BdkWalletEngineV3.create({ descriptor: DESCRIPTOR, network: 'testnet' }, { native: newBridge() })],
];

const EXPECT: RescueExpectation = { destinationScriptHex: DEST_SCRIPT };
const SIGNED_B64 = encodeBase64(TX.signedPsbt);
const FINAL_B64 = encodeBase64(TX.finalizedPsbt);
const SETTINGS = { electrumUrls: {} };

beforeEach(() => {
  mockChain.onChain = false;
  mockChain.sent = COIN_SATS;
  mockChain.fee = FEE;
  mockChain.calls = [];
  mockChain.finalizing = [];
  __forgetGoodServersForTests();
});

describe.each(ENGINES)('%s', (_name, open) => {
  it('broadcasts the checked rescue to the server the chain-server rule hands in, and names its txid', async () => {
    const engine = await open();
    const [first, second] = chainServersFor('testnet', SETTINGS);
    await engine.sync(second);
    expect(await findWalletTx(engine, TX.txid)).toBeNull();
    const sent = await broadcastWithWatchdog('testnet', SETTINGS, (b: BackendConfig) => engine.broadcastRescue(TX.raw, EXPECT, b));
    expect(sent).toBe(TX.txid);
    expect(mockChain.calls.filter((c) => c.call === 'broadcast').map((c) => c.url)).toEqual([first.url]);
  });

  it('a rescue signed as a PSBT (a script-path spend) is finished by the library, checked, and sent to the server the rule hands in, never the last sync\'s', async () => {
    const engine = await open();
    const [first, second] = chainServersFor('testnet', SETTINGS);
    await engine.sync(second);
    const sent = await broadcastWithWatchdog('testnet', SETTINGS, (b: BackendConfig) => engine.broadcastRescue(TX.signedPsbt, EXPECT, b));
    expect(sent).toBe(TX.txid);
    // The signer's own copy went to the library's finalizer, and the
    // finalized transaction went out, once, to the server handed in.
    expect(mockChain.finalizing.map((f) => f.psbt)).toEqual([SIGNED_B64]);
    const broadcasts = mockChain.calls.filter((c) => c.call === 'broadcast');
    expect(broadcasts.map((c) => [c.url, c.sent])).toEqual([[first.url, TX.rawHex]]);
    expect(first.url).not.toBe(second.url);
  });

  it('a signed PSBT that pays anywhere but the destination filed on this phone is refused once finished, before anything is sent', async () => {
    const engine = await open();
    const other: RescueExpectation = { destinationScriptHex: '5120' + '44'.repeat(32) };
    await expect(engine.broadcastRescue(TX.signedPsbt, other, chainServersFor('testnet', SETTINGS)[0])).rejects.toMatchObject({
      refusal: { code: 'wrong-destination' },
    });
    expect(mockChain.finalizing).toHaveLength(1);
    expect(mockChain.calls.filter((c) => c.call === 'broadcast')).toEqual([]);
  });

  it('a PSBT no finalizer can assemble (no signature) is refused, and nothing is sent', async () => {
    const engine = await open();
    await expect(engine.broadcastRescue(TX.psbt, EXPECT, chainServersFor('testnet', SETTINGS)[0])).rejects.toThrow(
      /could not be assembled/,
    );
    expect(mockChain.calls.filter((c) => c.call === 'broadcast')).toEqual([]);
  });

  it('once it is out: the record of it is found by txid, waiting, with what it took and its fee, and passes the rescue rule', async () => {
    const engine = await open();
    mockChain.onChain = true;
    const found = await networkTx(async () => {
      await engine.sync(chainServersFor('testnet', SETTINGS)[0]);
      return engine;
    }, TX.txid.toUpperCase());
    expect(found).not.toBe(false);
    expect(found).not.toBeNull();
    const { tx } = found as { tx: Awaited<ReturnType<typeof findWalletTx>> & object };
    expect(tx).toMatchObject({ txid: TX.txid, sent: COIN_SATS, received: 0, fee: FEE, confirmed: false });
    await expect(assertRescueOnChain(engine, rawTxShape(TX.raw, 'testnet'), tx, EXPECT)).resolves.toBeUndefined();
  });

  it('a record whose fee the library does not know, or that took less than it pays, is refused: a coin may be someone else\'s', async () => {
    const engine = await open();
    mockChain.onChain = true;
    mockChain.fee = null;
    let tx = (await findWalletTx(engine, TX.txid))!;
    expect(tx.fee).toBeUndefined();
    await expect(assertRescueOnChain(engine, rawTxShape(TX.raw, 'testnet'), tx, EXPECT)).rejects.toMatchObject({
      refusal: { code: 'foreign-coins' },
    });
    mockChain.fee = FEE;
    mockChain.sent = COIN_SATS - 1_000;
    tx = (await findWalletTx(engine, TX.txid))!;
    await expect(assertRescueOnChain(engine, rawTxShape(TX.raw, 'testnet'), tx, EXPECT)).rejects.toBeInstanceOf(BroadcastRefusedError);
  });

  it('a rescue that pays anywhere but the destination filed on this phone is refused, before and after it is out', async () => {
    const engine = await open();
    const other: RescueExpectation = { destinationScriptHex: '5120' + '44'.repeat(32) };
    await expect(engine.broadcastRescue(TX.raw, other, chainServersFor('testnet', SETTINGS)[0])).rejects.toMatchObject({
      refusal: { code: 'wrong-destination' },
    });
    expect(mockChain.calls.filter((c) => c.call === 'broadcast')).toEqual([]);
    mockChain.onChain = true;
    const tx = (await findWalletTx(engine, TX.txid))!;
    await expect(assertRescueOnChain(engine, rawTxShape(TX.raw, 'testnet'), tx, other)).rejects.toMatchObject({
      refusal: { code: 'wrong-destination' },
    });
  });

  it('the destination is not the vault\'s own', async () => {
    const engine = await open();
    expect(await engine.ownsAddress(DEST)).toBe(false);
  });
});

describe('the network\'s words, as the library gives them', () => {
  // Through its module (TaliaBdkWalletModule.swift `describe`: "Electrum
  // client error: " and electrum-client's own words, "Electrum server error"
  // for an answer). The old library's words through bdk-rn, which the same
  // rules read until the old engine's removal, are no longer given by anything.
  const next = (m: string) => Object.assign(new Error(`Electrum client error: ${m}`), { code: 'OTHER' });
  const cases: Array<[string, string, { unreachable: boolean; failed: boolean; mayBeLost: boolean }]> = [
    [
      'a refusal (the server answered)',
      'Electrum server error: {"code":-26,"message":"min relay fee not met, 100 < 141"}',
      { unreachable: false, failed: true, mayBeLost: false },
    ],
    [
      'an answer that could not be read',
      'Error during the deserialization of a response from the server: expected value',
      { unreachable: false, failed: true, mayBeLost: false },
    ],
    [
      'no server reached (every try failed)',
      'Made one or multiple attempts, all errored',
      { unreachable: true, failed: true, mayBeLost: true },
    ],
    [
      'a certificate refused',
      'invalid peer certificate: UnknownIssuer',
      { unreachable: true, failed: true, mayBeLost: true },
    ],
  ];
  it.each(cases)('%s', (_label, words, want) => {
    const e = next(words);
    expect({ unreachable: serverUnreachable(e), failed: serverFailed(e), mayBeLost: answerMayBeLost(e) }).toEqual(want);
  });
});
