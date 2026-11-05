/**
 * BDK upgrade (decided 2026-10-15): the phone app copies each
 * signing round on testnet, so the new library can be replayed against
 * what the devices really sent back. The copy must change nothing about
 * the call it watches.
 */
import {
  MAX_SIGNING_ROUNDS,
  SIGNING_ROUNDS_SCHEMA,
  capturesSigningRounds,
  capturingEngine,
  clearSigningRounds,
  onSigningRounds,
  signingRounds,
  signingRoundsFile,
} from '../signingRounds';
import type { BackendConfig, CompletedPsbt, WalletEngine } from '../types';
import type { PolicyNode } from '../policyPath';
import { PINNED_SEARCH_LIMIT, verifyPinnedAddress } from '../addressCheck';
import { scureAddresses } from '../../descriptor/scureAddresses';
import { splitMultipathDescriptor } from '../../descriptor/multipath';
import { SPARROW_SINGLE_SIG } from '../../descriptor/__fixtures__/descriptors';

const backend: BackendConfig = { type: 'electrum', url: 'ssl://x.example:50002' };

function stub(): WalletEngine {
  const done: CompletedPsbt = { finalized: true, psbtBase64: 'cHNidP8final', txid: 'aa'.repeat(32) };
  return {
    network: 'testnet',
    sync: jest.fn(async () => undefined),
    getBalance: jest.fn(async () => ({ confirmed: 1, trustedPending: 2, untrustedPending: 3, spendable: 4, total: 6 })),
    listTransactions: jest.fn(async () => []),
    getReceiveAddress: jest.fn(async (w) => ({ address: `a-${String(w)}`, index: 1, uri: 'bitcoin:a' })),
    getInternalAddress: jest.fn(async (w) => ({ address: `c-${String(w)}`, index: 2, uri: 'bitcoin:c' })),
    listUtxos: jest.fn(async () => []),
    getTipHeight: jest.fn(() => 70_000),
    ownsAddress: jest.fn(async () => true),
    buildPsbt: jest.fn(async () => ({ psbtBase64: 'p', txid: 't', feeSats: 1, sentSats: 2 })),
    buildRescuePsbt: jest.fn(async () => ({ psbtBase64: 'r', txid: 't', feeSats: 1, sentSats: 0 })),
    completePsbt: jest.fn(async () => done),
    broadcastPsbt: jest.fn(async () => 'sent-psbt'),
    broadcastRawTx: jest.fn(async () => 'sent-raw'),
    broadcastRescue: jest.fn(async () => 'sent-rescue'),
    getRawTx: jest.fn(async () => null),
  } as unknown as WalletEngine;
}

beforeEach(() => clearSigningRounds());

describe('only the phone app on testnet', () => {
  it('copies rounds in no other build and on no other network', () => {
    expect(capturesSigningRounds('full', 'testnet')).toBe(true);
    for (const network of ['bitcoin', 'signet', 'regtest'] as const) expect(capturesSigningRounds('full', network)).toBe(false);
    for (const flavour of ['signing', 'store'] as const) expect(capturesSigningRounds(flavour, 'testnet')).toBe(false);
  });
});

describe('the wrapped engine is the same engine', () => {
  it('passes every other call straight through, with the same answer', async () => {
    const inner = stub();
    const e = capturingEngine(inner);
    expect(e.network).toBe('testnet');
    await e.sync(backend);
    expect(inner.sync).toHaveBeenCalledWith(backend);
    expect(await e.getBalance()).toEqual(await inner.getBalance());
    expect(await e.getReceiveAddress(7)).toEqual({ address: 'a-7', index: 1, uri: 'bitcoin:a' });
    expect(await e.getInternalAddress('new')).toEqual({ address: 'c-new', index: 2, uri: 'bitcoin:c' });
    expect(e.getTipHeight()).toBe(70_000);
    expect(await e.ownsAddress('tb1q')).toBe(true);
    const request = { recipients: [{ address: 'tb1q', amountSats: 1 }], feeRate: 2, replacing: ['bb'.repeat(32)] };
    await e.buildPsbt(request);
    expect(inner.buildPsbt).toHaveBeenCalledWith(request);
    expect(await e.broadcastPsbt('cHNidP8final', backend)).toBe('sent-psbt');
    expect(signingRounds()).toEqual([]);
  });

  it('copies a completePsbt: what went out, what came back, what the engine made of it', async () => {
    const inner = stub();
    const e = capturingEngine(inner);
    const result = await e.completePsbt('cHNidP8signed', 'cHNidP8original', { inputConfirmations: 3 });
    expect(inner.completePsbt).toHaveBeenCalledWith('cHNidP8signed', 'cHNidP8original', { inputConfirmations: 3 });
    expect(result).toEqual({ finalized: true, psbtBase64: 'cHNidP8final', txid: 'aa'.repeat(32) });
    expect(signingRounds()).toEqual([
      expect.objectContaining({
        network: 'testnet',
        call: 'completePsbt',
        originalPsbtBase64: 'cHNidP8original',
        replyBase64: 'cHNidP8signed',
        opts: { inputConfirmations: 3 },
        result: { finalized: true, psbtBase64: 'cHNidP8final', txid: 'aa'.repeat(32) },
      }),
    ]);
  });

  it('copies the rescue signer\'s reply and a raw transaction, and the txid sent', async () => {
    const e = capturingEngine(stub());
    await e.broadcastRescue(Uint8Array.from([1, 2, 3]), {}, backend);
    await e.broadcastRawTx(Uint8Array.from([4, 5]), backend, 'cc'.repeat(32));
    expect(signingRounds().map((r) => [r.call, r.replyBase64, r.sentTxid, r.expectedTxid])).toEqual([
      ['broadcastRescue', 'AQID', 'sent-rescue', undefined],
      ['broadcastRawTx', 'BAU=', 'sent-raw', 'cc'.repeat(32)],
    ]);
  });

  it('a refusal is thrown exactly as it was, and kept', async () => {
    const inner = stub();
    const refusal = new Error('This is a different transaction from the one that was requested. Nothing was sent.');
    (inner.broadcastRawTx as jest.Mock).mockRejectedValue(refusal);
    await expect(capturingEngine(inner).broadcastRawTx(Uint8Array.from([1]), backend, 'dd'.repeat(32))).rejects.toBe(refusal);
    expect(signingRounds()[0].error).toBe(refusal.message);
  });

  it('a copy that cannot be made never stands in the way', async () => {
    const inner = stub();
    const e = capturingEngine(inner);
    // Bytes that cannot even be read: the copy fails, the call still runs as
    // it would have, with the very same argument.
    const unreadable = {
      get length(): number {
        throw new Error('unreadable');
      },
    } as unknown as Uint8Array;
    await expect(e.broadcastRescue(unreadable, {}, backend)).resolves.toBe('sent-rescue');
    expect(inner.broadcastRescue).toHaveBeenCalledWith(unreadable, {}, backend);
    expect(signingRounds()).toEqual([]);
    const off = onSigningRounds(() => {
      throw new Error('listener');
    });
    await expect(e.completePsbt('cHNidP8x')).resolves.toMatchObject({ finalized: true });
    off();
  });
});

describe("the inner engine's optional reads pass through too (decided 2026-10-20)", () => {
  it('forwards addressReach and policyTree where the engine has them, and adds neither where it does not', async () => {
    const tree = { id: 'root', type: 'THRESH' } as unknown as PolicyNode;
    const inner = {
      ...stub(),
      addressReach: jest.fn(async (k: 'external' | 'internal') => (k === 'external' ? 1200 : null)),
      policyTree: jest.fn(async () => tree),
    };
    const e = capturingEngine(inner);
    expect(await e.addressReach!('external')).toBe(1200);
    expect(await e.addressReach!('internal')).toBeNull();
    expect(inner.addressReach).toHaveBeenLastCalledWith('internal');
    expect(await e.policyTree!('internal')).toBe(tree);
    expect(inner.policyTree).toHaveBeenCalledWith('internal');
    // Today's engine has no reach: the wrapper must not invent one, or
    // Receive would take an answer the engine never gave.
    const bare = capturingEngine(stub());
    expect('addressReach' in bare).toBe(false);
    expect('policyTree' in bare).toBe(false);
    expect(signingRounds()).toEqual([]);
  });

  it("Receive finds a coin past index 999 through the wrapped new engine, as through the engine itself", async () => {
    // The phone app on Testnet4 wraps every engine (capturesSigningRounds),
    // the new one included under 'v3'.
    const pair = splitMultipathDescriptor(SPARROW_SINGLE_SIG);
    const ext = scureAddresses(pair.external, 'testnet', Array.from({ length: 1201 }, (_, i) => i))!.map((a) => a.address);
    const int = scureAddresses(pair.internal!, 'testnet', Array.from({ length: PINNED_SEARCH_LIMIT }, (_, i) => i))!.map((a) => a.address);
    const vault = { descriptor: SPARROW_SINGLE_SIG, network: 'testnet' as const };
    const peeks = {
      getReceiveAddress: async (i?: unknown) => ({ address: ext[Number(i)], index: Number(i), uri: '' }),
      getInternalAddress: async (i?: unknown) => ({ address: int[Number(i)], index: Number(i), uri: '' }),
    };
    const reaching = { ...stub(), ...peeks, addressReach: async (k: 'external' | 'internal') => (k === 'external' ? 1200 : null) };
    expect(await verifyPinnedAddress(vault, reaching, ext[1200])).toEqual({ kind: 'match' });
    expect(await verifyPinnedAddress(vault, capturingEngine(reaching), ext[1200])).toEqual({ kind: 'match' });
    // The control: an engine that cannot say how far it reaches gets the fixed bound.
    expect(await verifyPinnedAddress(vault, capturingEngine({ ...stub(), ...peeks }), ext[1200])).toEqual({ kind: 'not-found' });
  });
});

describe('what is kept and exported', () => {
  it('keeps the latest rounds only', async () => {
    const e = capturingEngine(stub());
    for (let i = 0; i < MAX_SIGNING_ROUNDS + 5; i++) await e.completePsbt(`cHNidP8-${i}`);
    const kept = signingRounds();
    expect(kept).toHaveLength(MAX_SIGNING_ROUNDS);
    expect(kept[0].replyBase64).toBe('cHNidP8-5');
  });

  it('tells the Diagnostics page when a round arrives', async () => {
    const heard = jest.fn();
    const off = onSigningRounds(heard);
    await capturingEngine(stub()).completePsbt('cHNidP8x');
    expect(heard).toHaveBeenCalledTimes(1);
    off();
  });

  it('the exported file names its schema and the app, and holds testnet rounds only', async () => {
    await capturingEngine(stub()).completePsbt('cHNidP8x', 'cHNidP8o');
    const list = [...signingRounds(), { ...signingRounds()[0], network: 'bitcoin' as const }];
    const file = JSON.parse(signingRoundsFile(list, { version: '1.1.7', build: '22' }));
    expect(file.schema).toBe(SIGNING_ROUNDS_SCHEMA);
    expect(file.app).toEqual({ version: '1.1.7', build: '22' });
    expect(file.rounds).toHaveLength(1);
    expect(file.rounds[0].network).toBe('testnet');
  });
});
