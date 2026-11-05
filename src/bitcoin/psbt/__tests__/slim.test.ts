import { base64 } from '@scure/base';

import { slimPsbtForDevice, slimPsbtBase64ForDevice } from '../slim';

/** Minimal hand-built PSBT: 1 input, 1 output, chosen field maps. */
function buildPsbt(opts: {
  /** scriptPubKey of the input's witness_utxo; omit for no witness_utxo. */
  witnessScript?: number[];
  /** Bytes of junk standing in for the parent tx; omit for none. */
  nonWitnessBytes?: number;
  /** Extra proprietary entry in the input map, must survive untouched. */
  extraEntry?: boolean;
}): Uint8Array {
  const out: number[] = [];
  const varint = (n: number) => {
    if (n < 0xfd) out.push(n);
    else out.push(0xfd, n & 0xff, (n >> 8) & 0xff);
  };
  const push = (...b: number[]) => out.push(...b);

  // Unsigned tx: v2, 1 in (null outpoint-ish), 1 out (v1 spk), locktime 0.
  const tx: number[] = [];
  const txVarint = (n: number) => tx.push(n); // all our lengths are < 0xfd
  tx.push(2, 0, 0, 0); // version
  txVarint(1); // n inputs
  for (let i = 0; i < 32; i++) tx.push(0x11); // txid
  tx.push(0, 0, 0, 0); // vout
  txVarint(0); // scriptSig
  tx.push(0xff, 0xff, 0xff, 0xff); // sequence
  txVarint(1); // n outputs
  tx.push(0x10, 0x27, 0, 0, 0, 0, 0, 0); // 10 000 sats
  txVarint(34);
  tx.push(0x51, 0x20, ...Array(32).fill(0x22)); // taproot spk
  tx.push(0, 0, 0, 0); // locktime

  push(0x70, 0x73, 0x62, 0x74, 0xff); // magic
  // Global map: {00} -> unsigned tx
  varint(1);
  push(0x00);
  varint(tx.length);
  push(...tx);
  push(0x00); // end global

  // Input map
  if (opts.nonWitnessBytes) {
    varint(1);
    push(0x00); // non_witness_utxo
    varint(opts.nonWitnessBytes);
    push(...Array(opts.nonWitnessBytes).fill(0xab));
  }
  if (opts.witnessScript) {
    varint(1);
    push(0x01); // witness_utxo
    const v: number[] = [0x10, 0x27, 0, 0, 0, 0, 0, 0];
    v.push(opts.witnessScript.length, ...opts.witnessScript);
    varint(v.length);
    push(...v);
  }
  if (opts.extraEntry) {
    varint(3);
    push(0xfc, 0x01, 0x02); // proprietary key
    varint(2);
    push(0xde, 0xad);
  }
  push(0x00); // end input

  push(0x00); // end (empty) output map
  return Uint8Array.from(out);
}

const V1_SPK = [0x51, 0x20, ...Array(32).fill(0x22)];
const V0_SPK = [0x00, 0x14, ...Array(20).fill(0x33)];

describe('slimPsbtForDevice', () => {
  it('drops the parent transaction from a taproot input', () => {
    const fat = buildPsbt({ witnessScript: V1_SPK, nonWitnessBytes: 500, extraEntry: true });
    const slim = slimPsbtForDevice(fat);
    expect(slim.length).toBeLessThan(fat.length - 490);
    // The witness_utxo and the proprietary entry survive byte-for-byte.
    expect(slim).toEqual(
      slimPsbtForDevice(buildPsbt({ witnessScript: V1_SPK, extraEntry: true })),
    );
  });

  it('KEEPS the parent transaction on a segwit-v0 input (wsh vaults need it)', () => {
    const fat = buildPsbt({ witnessScript: V0_SPK, nonWitnessBytes: 500 });
    expect(slimPsbtForDevice(fat)).toEqual(fat);
  });

  it('keeps the parent when there is no witness_utxo to stand in for it', () => {
    const fat = buildPsbt({ nonWitnessBytes: 500 });
    expect(slimPsbtForDevice(fat)).toEqual(fat);
  });

  it('is idempotent and faithful on an already-slim PSBT', () => {
    const slim = buildPsbt({ witnessScript: V1_SPK, extraEntry: true });
    expect(slimPsbtForDevice(slim)).toEqual(slim);
  });

  it('refuses bytes that are not a PSBT', () => {
    expect(() => slimPsbtForDevice(Uint8Array.from([1, 2, 3, 4, 5, 6]))).toThrow('Not a PSBT');
  });

  it('base64 wrapper reports the sizes', () => {
    const fat = buildPsbt({ witnessScript: V1_SPK, nonWitnessBytes: 500 });
    const res = slimPsbtBase64ForDevice(base64.encode(fat));
    expect(res.beforeBytes).toBe(fat.length);
    expect(res.afterBytes).toBeLessThan(res.beforeBytes - 490);
    expect(base64.decode(res.psbt)).toEqual(slimPsbtForDevice(fat));
  });
});

describe('slimPsbtForLedgerPolicy', () => {
  const { slimPsbtForLedgerPolicy } = require('../slim');

  /** Adds policy-era entries to the basic taproot input. */
  function policyPsbt(): Uint8Array {
    const base = buildPsbt({ witnessScript: V1_SPK, nonWitnessBytes: 60, extraEntry: true });
    // Splice extra entries into the input map: rebuild by hand is brittle,
    // so append entries by editing bytes just before the input map's end.
    // The input map ends at the byte before the final 0x01 0x00 (empty
    // output map terminator + its end) — easier: rebuild via the builder's
    // layout knowledge: the last two bytes are [0x00 output-end] and the
    // byte before is the input map end 0x00.
    const endOfInput = base.length - 1 /* output end */ - 1 /* input end */;
    const head = Array.from(base.slice(0, endOfInput));
    const tail = Array.from(base.slice(endOfInput));
    const entry = (keyType: number, keyData: number[], value: number[]) => {
      const key = [keyType, ...keyData];
      head.push(key.length, ...key, value.length, ...value);
    };
    // tap_leaf_script, tap_internal_key, tap_merkle_root
    entry(0x15, [0xc0], Array(40).fill(0x44));
    entry(0x17, [], Array(32).fill(0x55));
    entry(0x18, [], Array(32).fill(0x66));
    // tap_bip32_derivation: ours (fp 3442193e) and a co-signer's (cc000007)
    const tapDeriv = (fp: number[]) => [0x00 /* 0 leaf hashes */, ...fp, 1, 0, 0, 0];
    entry(0x16, Array(32).fill(0x77), tapDeriv([0x34, 0x42, 0x19, 0x3e]));
    entry(0x16, Array(32).fill(0x88), tapDeriv([0xcc, 0x00, 0x00, 0x07]));
    return Uint8Array.from([...head, ...tail]);
  }

  it('keeps only witness_utxo, unknown entries and OUR derivation', () => {
    const fat = policyPsbt();
    const slim = slimPsbtForLedgerPolicy(fat, '3442193E');
    // Dropped: parent tx, leaf script, internal key, merkle root, other
    // signer's derivation. Kept: witness_utxo, proprietary, ours.
    expect(slim.length).toBeLessThan(fat.length - 150);
    const again = slimPsbtForLedgerPolicy(slim, '3442193e');
    expect(again).toEqual(slim); // idempotent
    // Our derivation entry's 32-byte pubkey keyData survives.
    expect(Array.from(slim).join(',')).toContain(Array(32).fill(0x77).join(','));
    // The co-signer's does not.
    expect(Array.from(slim).join(',')).not.toContain(Array(32).fill(0x88).join(','));
  });

  it('leaves v0 inputs completely untouched', () => {
    const fat = buildPsbt({ witnessScript: V0_SPK, nonWitnessBytes: 60 });
    expect(slimPsbtForLedgerPolicy(fat, '3442193e')).toEqual(fat);
  });

  it('cuts the change output down to our derivation too', () => {
    const base = buildPsbt({ witnessScript: V1_SPK });
    // Append entries into the (currently empty) output map: the final byte
    // is its 0x00 terminator.
    const head = Array.from(base.slice(0, base.length - 1));
    const entry = (keyType: number, keyData: number[], value: number[]) => {
      const key = [keyType, ...keyData];
      head.push(key.length, ...key, value.length, ...value);
    };
    const tapDeriv = (fp: number[]) => [0x00, ...fp, 1, 0, 0, 0];
    entry(0x05, [], Array(32).fill(0x99)); // out tap_internal_key
    entry(0x06, [], Array(80).fill(0xaa)); // out tap_tree
    entry(0x07, Array(32).fill(0xbb), tapDeriv([0x34, 0x42, 0x19, 0x3e])); // ours
    entry(0x07, Array(32).fill(0xcc), tapDeriv([0xcc, 0x00, 0x00, 0x07])); // co-signer
    head.push(0x00);
    const fat = Uint8Array.from(head);
    const slim = slimPsbtForLedgerPolicy(fat, '3442193e');
    expect(Array.from(slim).join(',')).toContain(Array(32).fill(0xbb).join(','));
    expect(Array.from(slim).join(',')).not.toContain(Array(32).fill(0xcc).join(','));
    expect(Array.from(slim).join(',')).not.toContain(Array(80).fill(0xaa).join(','));
  });
});
