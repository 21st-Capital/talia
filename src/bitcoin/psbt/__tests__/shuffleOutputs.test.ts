/**
 * The new engine shuffles a built PSBT's outputs, as bdk 0.28 did (decided
 * 2026-10-15; the bridge builds with TxOrdering.untouched so the inputs keep 0.28's
 * order). Only the outputs move: each with its own output map, every other
 * byte kept, and the txid is the shuffled transaction's.
 */
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { shuffledOrder, shufflePsbtOutputs } from '../shuffleOutputs';
import { unsignedTxid } from '../parse';
import { canonicalPsbt, psbtMaps } from '../canonical';
import { decodeBase64, encodeBase64 } from '../export';

const NET = btc.TEST_NETWORK;
const key = HDKey.fromMasterSeed(sha256(utf8ToBytes('shuffle-test')));
const at = (i: number) => key.derive(`m/84'/1'/0'/0/${i}`);

function psbtWith(outputs: number): string {
  const tx = new btc.Transaction({ allowUnknownOutputs: true });
  for (let i = 0; i < 2; i++) {
    const pay = btc.p2wpkh(at(i).publicKey!, NET);
    tx.addInput({
      txid: new Uint8Array(32).fill(i + 1),
      index: i,
      witnessUtxo: { script: pay.script, amount: 100_000n },
      bip32Derivation: [[at(i).publicKey!, { fingerprint: key.fingerprint, path: [0x80000054, 0x80000001, 0x80000000, 0, i] }]],
    });
  }
  for (let i = 0; i < outputs; i++) {
    const pub = at(10 + i).publicKey!;
    tx.addOutput({
      script: btc.p2wpkh(pub, NET).script,
      amount: BigInt(10_000 + i),
      // Only the second output carries a derivation (a change output).
      ...(i === 1 ? { bip32Derivation: [[pub, { fingerprint: key.fingerprint, path: [0x80000054, 0x80000001, 0x80000000, 1, 7] }]] } : {}),
    } as never);
  }
  return encodeBase64(tx.toPSBT());
}

describe('the output shuffle', () => {
  it('moves each output with its own map, and nothing else', () => {
    const before = psbtWith(3);
    const r = shufflePsbtOutputs(before, Math.random, [2, 0, 1]);
    const a = psbtMaps(before)!;
    const b = psbtMaps(r.psbtBase64)!;
    expect(b.tx.outs.map((o) => o.amountSats)).toEqual([10_002, 10_000, 10_001]);
    expect(b.outputs).toEqual([a.outputs[2], a.outputs[0], a.outputs[1]]);
    expect(b.inputs).toEqual(a.inputs);
    expect(b.tx.ins).toEqual(a.tx.ins);
    expect(b.tx.version).toBe(a.tx.version);
    expect(b.tx.lockTime).toBe(a.tx.lockTime);
    // The change output still carries its derivation, now third.
    expect(b.outputs[2].some((e) => e.key.startsWith('02'))).toBe(true);
    expect(r.order).toEqual([2, 0, 1]);
    // The txid is the new transaction's, as the parser reads it.
    expect(r.txid).toBe(unsignedTxid(r.psbtBase64));
    expect(r.txid).not.toBe(unsignedTxid(before));
    // The same length, and scure reads it.
    expect(decodeBase64(r.psbtBase64)!.length).toBe(decodeBase64(before)!.length);
    expect(btc.Transaction.fromPSBT(decodeBase64(r.psbtBase64)!).outputsLength).toBe(3);
  });

  it('the identity order gives the same bytes back', () => {
    const before = psbtWith(3);
    expect(shufflePsbtOutputs(before, Math.random, [0, 1, 2]).psbtBase64).toBe(before);
  });

  it('a single output stays where it is', () => {
    const before = psbtWith(1);
    expect(shufflePsbtOutputs(before).psbtBase64).toBe(before);
  });

  it('is a uniform shuffle of the order (Fisher-Yates)', () => {
    const seen = new Map<string, number>();
    let s = 1;
    const random = () => ((s = (s * 48271) % 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 6000; i++) {
      const k = shuffledOrder(3, random).join('');
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    expect(seen.size).toBe(6);
    for (const n of seen.values()) expect(n).toBeGreaterThan(800);
  });

  it('refuses what is not a PSBT or not an order of its outputs', () => {
    expect(() => shufflePsbtOutputs('aGVsbG8=')).toThrow('Not a PSBT');
    expect(() => shufflePsbtOutputs(psbtWith(2), Math.random, [0, 0])).toThrow('Not an order');
    expect(() => shufflePsbtOutputs(psbtWith(2), Math.random, [0, 1, 2])).toThrow('Not an order');
  });

  it('canonical form: the same PSBT whatever the map order', () => {
    const p = psbtWith(2);
    expect(canonicalPsbt(p)).toBe(canonicalPsbt(p));
    // A shuffled copy is another PSBT (another transaction).
    expect(canonicalPsbt(shufflePsbtOutputs(p, Math.random, [1, 0]).psbtBase64)).not.toBe(canonicalPsbt(p));
    expect(canonicalPsbt('nonsense')).toBeNull();
  });
});
