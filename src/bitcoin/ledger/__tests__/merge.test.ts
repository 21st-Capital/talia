import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';

import { decodeBase64, encodeBase64 } from '../../psbt/export';
import { mergeLedgerSignatures } from '../merge';

/** A minimal one-input wpkh PSBT, built with the same library merge uses. */
function wpkhPsbt(): { psbtBase64: string; pubkey: Uint8Array } {
  // Deterministic 33-byte compressed pubkey (a valid secp point: G).
  const pubkey = hex.decode('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  const spk = btc.p2wpkh(pubkey, btc.TEST_NETWORK);
  const tx = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true });
  tx.addInput({
    txid: hex.decode('11'.repeat(32)),
    index: 0,
    witnessUtxo: { script: spk.script, amount: 50_000n },
  });
  tx.addOutputAddress(spk.address as string, 40_000n, btc.TEST_NETWORK);
  return { psbtBase64: encodeBase64(tx.toPSBT(0)), pubkey };
}

describe('mergeLedgerSignatures', () => {
  it('lands a 33-byte-pubkey ECDSA signature in partialSig', () => {
    const { psbtBase64, pubkey } = wpkhPsbt();
    const signature = new Uint8Array(71).fill(7);
    const merged = mergeLedgerSignatures(psbtBase64, [{ inputIndex: 0, pubkey, signature }]);

    const back = btc.Transaction.fromPSBT(decodeBase64(merged) as Uint8Array, {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
    });
    const partial = back.getInput(0).partialSig;
    expect(partial).toHaveLength(1);
    expect(hex.encode(partial![0][0])).toBe(hex.encode(pubkey));
    expect(hex.encode(partial![0][1])).toBe(hex.encode(signature));
  });

  it('the original PSBT is unchanged apart from the signature', () => {
    const { psbtBase64, pubkey } = wpkhPsbt();
    const merged = mergeLedgerSignatures(psbtBase64, [
      { inputIndex: 0, pubkey, signature: new Uint8Array(71).fill(7) },
    ]);
    const a = btc.Transaction.fromPSBT(decodeBase64(psbtBase64) as Uint8Array);
    const b = btc.Transaction.fromPSBT(decodeBase64(merged) as Uint8Array);
    expect(b.outputsLength).toBe(a.outputsLength);
    expect(b.inputsLength).toBe(a.inputsLength);
    expect(hex.encode(b.getInput(0).witnessUtxo!.script)).toBe(
      hex.encode(a.getInput(0).witnessUtxo!.script),
    );
  });

  it('lands a taproot SCRIPT-path signature in tapScriptSig (our multi_a vaults)', () => {
    const { psbtBase64: base } = wpkhPsbt();
    const xonly = hex.decode('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
    const leaf = new Uint8Array(32).fill(3);
    const signature = new Uint8Array(64).fill(9);
    const merged = mergeLedgerSignatures(base, [
      { inputIndex: 0, pubkey: xonly, tapleafHash: leaf, signature },
    ]);
    const back = btc.Transaction.fromPSBT(decodeBase64(merged) as Uint8Array, {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
    });
    const entry = back.getInput(0).tapScriptSig;
    expect(entry).toHaveLength(1);
    expect(hex.encode(entry![0][0].pubKey)).toBe(hex.encode(xonly));
    expect(hex.encode(entry![0][0].leafHash)).toBe(hex.encode(leaf));
    expect(hex.encode(entry![0][1])).toBe(hex.encode(signature));
    // Re-merging the SAME signature adds nothing and says so.
    expect(() =>
      mergeLedgerSignatures(merged, [{ inputIndex: 0, pubkey: xonly, tapleafHash: leaf, signature }]),
    ).toThrow('nothing new');
  });

  it('lands a taproot KEY-path signature in tapKeySig (single-key tr vaults)', () => {
    const { psbtBase64: base } = wpkhPsbt();
    const xonly = hex.decode('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
    const signature = new Uint8Array(64).fill(5);
    const merged = mergeLedgerSignatures(base, [{ inputIndex: 0, pubkey: xonly, signature }]);
    const back = btc.Transaction.fromPSBT(decodeBase64(merged) as Uint8Array, {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
    });
    expect(hex.encode(back.getInput(0).tapKeySig as Uint8Array)).toBe(hex.encode(signature));
    expect(() =>
      mergeLedgerSignatures(merged, [{ inputIndex: 0, pubkey: xonly, signature }]),
    ).toThrow('nothing new');
  });

  it('an already-present ECDSA signature is never clobbered', () => {
    const { psbtBase64, pubkey } = wpkhPsbt();
    const first = new Uint8Array(71).fill(7);
    const merged = mergeLedgerSignatures(psbtBase64, [
      { inputIndex: 0, pubkey, signature: first },
    ]);
    expect(() =>
      mergeLedgerSignatures(merged, [
        { inputIndex: 0, pubkey, signature: new Uint8Array(71).fill(8) },
      ]),
    ).toThrow('nothing new');
    const back = btc.Transaction.fromPSBT(decodeBase64(merged) as Uint8Array, {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
    });
    expect(hex.encode(back.getInput(0).partialSig![0][1])).toBe(hex.encode(first));
  });

  it('refuses a signature shape it does not recognise', () => {
    const { psbtBase64 } = wpkhPsbt();
    expect(() =>
      mergeLedgerSignatures(psbtBase64, [
        { inputIndex: 0, pubkey: new Uint8Array(20), signature: new Uint8Array(71) },
      ]),
    ).toThrow('does not recognise');
  });

  it('refuses garbage instead of limping onward', () => {
    expect(() => mergeLedgerSignatures('not-a-psbt!!', [])).toThrow('could not be read');
  });
});
