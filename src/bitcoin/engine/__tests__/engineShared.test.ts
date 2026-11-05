/**
 * BDK upgrade (decided 2026-10-15): the engine's pure half, moved out of
 * bdkEngine.ts so the new engine runs the same code. What the old engine
 * does with it end to end is pinned by bdkBridgeProtocol.test.ts (never
 * edited); this pins each helper on its own.
 */
import {
  assertFeeRate,
  assertRescueSpend,
  assertReviewedRawTx,
  descriptorPair,
  finishFinalization,
  rescueNotAssembledError,
  sortByRecencyDesc,
  toUri,
} from '../engineShared';
import { BroadcastRefusedError, rawTxShape } from '../../psbt/broadcastCheck';
import { encodeBase64, PSBT_MAGIC } from '../../psbt/export';
import { MAX_FEE_RATE } from '../../psbt/build';
import type { WalletTx } from '../types';
import { MAINNET_SINGLE_SIG, SPARROW_SINGLE_SIG } from '../../descriptor/__fixtures__/descriptors';

const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

/** The bridge recording's raw transaction: version 2, one input, one P2WPKH output. */
const RAW_TX = bytes(
  '02000000' + '01' + '11'.repeat(32) + '00000000' + '00' + 'fdffffff' + '01' + 'e803000000000000' + '16' + '0014' +
    '22'.repeat(20) + '00000000',
);

/** That transaction as a PSBT; `finalWitness` puts a final witness on its input. */
function psbt(finalWitness: boolean): string {
  const tx = Array.from(RAW_TX);
  const global = [1, 0x00, tx.length, ...tx, 0];
  // PSBT_IN_FINAL_SCRIPTWITNESS (0x08): one witness item of one byte.
  const input = finalWitness ? [1, 0x08, 3, 1, 1, 7, 0] : [0];
  return encodeBase64(Uint8Array.from([...PSBT_MAGIC, ...global, ...input, 0]));
}

const tx = (over: Partial<WalletTx>): WalletTx => ({
  txid: 'x',
  received: 0,
  sent: 0,
  netAmount: 0,
  confirmed: true,
  ...over,
});

describe('the fee-rate ceiling (decided 2026-09-26)', () => {
  it('takes a rate above 0 and up to the ceiling', () => {
    expect(() => assertFeeRate(0.1)).not.toThrow();
    expect(() => assertFeeRate(MAX_FEE_RATE)).not.toThrow();
  });

  it.each([0, -1, NaN, Infinity, MAX_FEE_RATE + 0.1])('refuses %p with the words the bridge recording holds', (rate) => {
    expect(() => assertFeeRate(rate)).toThrow('The fee rate must be above 0 and at most 2000 sat/vB.');
  });
});

describe('history order', () => {
  it('unconfirmed first, then newest block first, sends above receives inside one block', () => {
    const list = [
      tx({ txid: 'old', blockHeight: 10, netAmount: 5 }),
      tx({ txid: 'recv', blockHeight: 20, netAmount: 100 }),
      tx({ txid: 'pending', confirmed: false, blockHeight: undefined }),
      tx({ txid: 'send', blockHeight: 20, netAmount: -90 }),
    ].sort(sortByRecencyDesc);
    expect(list.map((t) => t.txid)).toEqual(['pending', 'send', 'recv', 'old']);
  });

  it('the bitcoin: form for the QR', () => {
    expect(toUri('bc1qx')).toBe('bitcoin:bc1qx');
  });
});

describe('the descriptors a wallet opens with', () => {
  it('a multipath descriptor is split into receive and change', () => {
    const pair = descriptorPair({ descriptor: SPARROW_SINGLE_SIG });
    expect(pair.external).toContain('/0/*');
    expect(pair.internal).toContain('/1/*');
    expect(pair.external).not.toContain('<0;1>');
  });

  it('a change descriptor that is given wins over the split', () => {
    const pair = descriptorPair({ descriptor: SPARROW_SINGLE_SIG, changeDescriptor: 'wpkh(change)' });
    expect(pair.internal).toBe('wpkh(change)');
  });

  it('a single-path descriptor alone opens with no change descriptor', () => {
    const single = SPARROW_SINGLE_SIG.replace('<0;1>', '0');
    expect(descriptorPair({ descriptor: single })).toEqual({ external: single.trim(), internal: null });
    expect(descriptorPair({ descriptor: single, changeDescriptor: '' }).internal).toBeNull();
  });
});

describe('after the library finalized: the scure fallback and its judge', () => {
  it('a finalized PSBT passes through untouched, with no notes', () => {
    expect(
      finishFinalization({ descriptor: MAINNET_SINGLE_SIG, bdkPsbtBase64: psbt(true), signedPsbtBase64: psbt(true) }),
    ).toEqual({ psbtBase64: psbt(true), finalized: true, finalizeNotes: undefined });
  });

  it('a single copy nothing could finalize keeps the library\'s reason', () => {
    const open = psbt(false);
    expect(
      finishFinalization({ descriptor: MAINNET_SINGLE_SIG, bdkPsbtBase64: open, bdkError: 'Missing UTXO', signedPsbtBase64: open }),
    ).toEqual({ psbtBase64: open, finalized: false, finalizeNotes: ['bdk sign/finalize: Missing UTXO'] });
    expect(
      finishFinalization({ descriptor: MAINNET_SINGLE_SIG, bdkPsbtBase64: open, signedPsbtBase64: open }).finalizeNotes,
    ).toEqual(['bdk sign/finalize: no error, produced no witness']);
  });

  it('two copies that could not be combined name the library and every route that gave up', () => {
    const open = psbt(false);
    const out = finishFinalization({
      descriptor: MAINNET_SINGLE_SIG,
      bdkPsbtBase64: open,
      bdkError: 'Missing UTXO',
      signedPsbtBase64: open,
      originalPsbtBase64: open,
    });
    expect(out.finalized).toBe(false);
    expect(out.finalizeNotes?.[0]).toBe('bdk sign/finalize: Missing UTXO');
    expect(out.finalizeNotes!.length).toBeGreaterThan(1);
  });
});

describe('what comes back from outside is checked before it is sent', () => {
  const unsigned = rawTxShape(RAW_TX, 'bitcoin')!.unsignedTxid;

  it('the reviewed transaction passes', () => {
    expect(() => assertReviewedRawTx(RAW_TX, 'bitcoin', unsigned)).not.toThrow();
    expect(() => assertReviewedRawTx(RAW_TX, 'bitcoin', unsigned.toUpperCase())).not.toThrow();
  });

  it('another transaction, no expected txid, or unreadable bytes are refused (decided 2026-09-26)', () => {
    const refused = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        expect(e).toBeInstanceOf(BroadcastRefusedError);
        return (e as BroadcastRefusedError).refusal.code;
      }
      throw new Error('not refused');
    };
    expect(refused(() => assertReviewedRawTx(RAW_TX, 'bitcoin', 'dd'.repeat(32)))).toBe('different-tx');
    expect(refused(() => assertReviewedRawTx(RAW_TX, 'bitcoin', ''))).toBe('different-tx');
    expect(refused(() => assertReviewedRawTx(Uint8Array.from([1, 2, 3]), 'bitcoin', unsigned))).toBe('unreadable');
    // The words the bridge recording holds for it.
    expect(() => assertReviewedRawTx(RAW_TX, 'bitcoin', 'dd'.repeat(32))).toThrow(
      'This is a different transaction from the one that was requested. Nothing was sent.',
    );
  });

  it('a rescue nobody can read is refused before anything is asked of the engine', async () => {
    const engine = {
      network: 'bitcoin' as const,
      listUtxos: jest.fn(async () => []),
      ownsAddress: jest.fn(async () => false),
    };
    await expect(assertRescueSpend(engine, null, {})).rejects.toBeInstanceOf(BroadcastRefusedError);
    expect(engine.listUtxos).not.toHaveBeenCalled();
  });

  it('a rescue that could not be assembled says so, with its reasons', () => {
    expect(rescueNotAssembledError().message).toBe(
      'The signed rescue could not be assembled for sending. Please contact the recovery team.',
    );
    expect(rescueNotAssembledError(['a', 'b']).message).toBe(
      'The signed rescue could not be assembled for sending. Please contact the recovery team.\n\nDetails:\n· a\n· b',
    );
  });
});
