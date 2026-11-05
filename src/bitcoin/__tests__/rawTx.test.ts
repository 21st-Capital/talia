import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { parseRawTransaction } from '../rawTx';
import { scriptToAddress } from '../psbt/parse';

// --- byte builders ---------------------------------------------------------
const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n: number): number[] => [...u32(n % 0x100000000), ...u32(Math.floor(n / 0x100000000))];
const varint = (n: number): number[] => (n < 0xfd ? [n] : [0xfd, n & 0xff, n >> 8]);

const PUBKEY = Uint8Array.from([0x02, ...new Array(32).fill(0x11)]);
const H160 = ripemd160(sha256(PUBKEY));
const OUT_SCRIPT = [0x00, 0x14, ...new Array(20).fill(0x22)]; // p2wpkh
const DUMMY_SIG = new Array(71).fill(0xaa);

function buildSegwitTx(): Uint8Array {
  return Uint8Array.from([
    ...u32(2), // version
    0x00, 0x01, // segwit marker + flag
    ...varint(1),
    ...new Array(31).fill(0), 0x01, // prev txid (LE) — reversed hex ends ...01 first
    ...u32(3), // vout
    ...varint(0), // empty scriptSig
    ...u32(0xfffffffd),
    ...varint(1),
    ...u64(50_000),
    ...varint(OUT_SCRIPT.length), ...OUT_SCRIPT,
    // witness: [sig, pubkey] → P2WPKH input
    ...varint(2),
    ...varint(DUMMY_SIG.length), ...DUMMY_SIG,
    ...varint(PUBKEY.length), ...Array.from(PUBKEY),
    ...u32(0), // locktime
  ]);
}

describe('parseRawTransaction', () => {
  const tx = buildSegwitTx();
  const info = parseRawTransaction(tx, 'testnet');

  it('measures size, weight and vsize per BIP-141', () => {
    expect(info.sizeBytes).toBe(tx.length);
    const witnessBytes = 2 + 1 + 1 + 71 + 1 + 33; // marker/flag + stack
    const base = tx.length - witnessBytes;
    expect(info.weight).toBe(base * 3 + tx.length);
    expect(info.vsize).toBe(Math.ceil(info.weight / 4));
  });

  it('recovers the P2WPKH input address from its witness pubkey', () => {
    expect(info.inputs).toHaveLength(1);
    expect(info.inputs[0].vout).toBe(3);
    // serialized little-endian txid is displayed reversed
    expect(info.inputs[0].txid.startsWith('01')).toBe(true);
    expect(info.inputs[0].address).toBe(
      scriptToAddress(Uint8Array.from([0x00, 0x14, ...H160]), 'testnet'),
    );
    expect(info.inputs[0].address!.startsWith('tb1q')).toBe(true);
  });

  it('encodes outputs on the right network and round-trips hex', () => {
    expect(info.outputs).toEqual([
      {
        address: scriptToAddress(Uint8Array.from(OUT_SCRIPT), 'testnet'),
        valueSats: 50_000,
        scriptLength: OUT_SCRIPT.length,
        scriptHex: OUT_SCRIPT.map((b) => b.toString(16).padStart(2, '0')).join(''),
      },
    ]);
    expect(info.hex).toHaveLength(tx.length * 2);
  });

  it('names the transaction by its WITNESS-FREE txid (decided 2026-09-26)', () => {
    // Segwit: the witness is not part of the txid, so a signed transaction
    // keeps the txid of the unsigned one.
    expect(info.txid).toMatch(/^[0-9a-f]{64}$/);
    const witnessLength = 1 + 1 + 71 + 1 + 33; // stack count + sig + pubkey
    const noWitness = parseRawTransaction(
      Uint8Array.from([...tx.slice(0, 4), ...tx.slice(6, tx.length - 4 - witnessLength), ...tx.slice(tx.length - 4)]),
      'testnet',
    );
    expect(noWitness.txid).toBe(info.txid);
  });

  it('parses legacy (non-segwit) transactions', () => {
    const legacy = Uint8Array.from([
      ...u32(1),
      ...varint(1),
      ...new Array(32).fill(0xcc),
      ...u32(0),
      // scriptSig: push sig, push pubkey → P2PKH recovery
      ...varint(1 + DUMMY_SIG.length + 1 + PUBKEY.length),
      DUMMY_SIG.length, ...DUMMY_SIG,
      PUBKEY.length, ...Array.from(PUBKEY),
      ...u32(0xffffffff),
      ...varint(1),
      ...u64(9_000),
      ...varint(OUT_SCRIPT.length), ...OUT_SCRIPT,
      ...u32(0),
    ]);
    const li = parseRawTransaction(legacy, 'bitcoin');
    expect(li.weight).toBe(legacy.length * 4);
    expect(li.vsize).toBe(legacy.length);
    expect(li.inputs[0].address!.startsWith('1')).toBe(true);
    expect(li.inputs[0].sequence).toBe(0xffffffff);
  });

  it('keeps each input nSequence (Speed up and Cancel read it)', () => {
    // The everyday path: BDK writes 0xFFFFFFFD, which also signals RBF.
    expect(info.inputs[0].sequence).toBe(0xfffffffd);

    // Two inputs: one on a timelocked path (older(52560) as its sequence),
    // one that opted out of replacement (0xFFFFFFFE).
    const two = Uint8Array.from([
      ...u32(2),
      0x00, 0x01,
      ...varint(2),
      ...new Array(32).fill(0x01), ...u32(0), ...varint(0), ...u32(52_560),
      ...new Array(32).fill(0x02), ...u32(1), ...varint(0), ...u32(0xfffffffe),
      ...varint(1),
      ...u64(10_000),
      ...varint(OUT_SCRIPT.length), ...OUT_SCRIPT,
      ...varint(2), ...varint(DUMMY_SIG.length), ...DUMMY_SIG, ...varint(PUBKEY.length), ...Array.from(PUBKEY),
      ...varint(2), ...varint(DUMMY_SIG.length), ...DUMMY_SIG, ...varint(PUBKEY.length), ...Array.from(PUBKEY),
      ...u32(0),
    ]);
    const parsed = parseRawTransaction(two, 'testnet');
    expect(parsed.inputs.map((i) => i.sequence)).toEqual([52_560, 0xfffffffe]);
    expect(parsed.inputs.map((i) => i.vout)).toEqual([0, 1]);
  });

  it('reads the full 32-bit sequence without going negative', () => {
    expect(info.inputs[0].sequence).toBeGreaterThan(0);
    expect(info.inputs[0].sequence).toBe(4_294_967_293);
  });
});
