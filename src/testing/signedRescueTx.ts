/**
 * A small signed taproot spend for Jest, in its forms: the raw transaction
 * (witness included), the PSBT of the same unsigned transaction (bare, as
 * the signer received it, as the signer returns it with its signature but
 * not finalized, and finalized), and the txid the network knows it by,
 * computed here on its own (double SHA-256 of the transaction WITHOUT its
 * witness, shown reversed) so tests do not take the code under test's word
 * for it. Test-only bytes: the signature is filler and spends nothing real.
 */
import { sha256 } from '@noble/hashes/sha256';

const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n: number): number[] => [...u32(n % 0x100000000), ...u32(Math.floor(n / 0x100000000))];
const varint = (n: number): number[] => (n < 0xfd ? [n] : [0xfd, n & 0xff, n >> 8]);
const hex = (b: Uint8Array | number[]): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** OP_1 <32 bytes>: a taproot output. */
const OUT_SCRIPT = [0x51, 0x20, ...new Array(32).fill(0x33)];
const SIG = new Array(64).fill(0xaa);

export interface SignedRescueTx {
  raw: Uint8Array;
  rawHex: string;
  /** The unsigned PSBT: no signature, nothing a finalizer can assemble. */
  psbt: Uint8Array;
  /** As a signer returns it for a script-path spend: its signature
   *  (PSBT_IN_TAP_KEY_SIG), not finalized (21st Capital's rescue signer). */
  signedPsbt: Uint8Array;
  /** The same, finalized (PSBT_IN_FINAL_SCRIPTWITNESS): what a finalizer makes of it. */
  finalizedPsbt: Uint8Array;
  txid: string;
  /** The coin it spends, `txid:vout`. */
  spends: { txid: string; vout: number };
  /** The one output's script (hex): a taproot output, where it pays. */
  outScriptHex: string;
  /** What that output pays. */
  valueSats: number;
}

/** `seed` varies the coin spent, so two calls give two transactions. */
export function signedRescueTx(seed = 1, valueSats = 370_083): SignedRescueTx {
  const prevLe = [...new Array(31).fill(0), seed & 0xff];
  const input = [...prevLe, ...u32(0), ...varint(0), ...u32(0xfffffffd)];
  const output = [...u64(valueSats), ...varint(OUT_SCRIPT.length), ...OUT_SCRIPT];
  const unsigned = Uint8Array.from([...u32(2), ...varint(1), ...input, ...varint(1), ...output, ...u32(0)]);
  const raw = Uint8Array.from([
    ...u32(2),
    0x00,
    0x01,
    ...varint(1),
    ...input,
    ...varint(1),
    ...output,
    ...varint(1),
    ...varint(SIG.length),
    ...SIG,
    ...u32(0),
  ]);
  const psbtWith = (input: number[]) =>
    Uint8Array.from([
      0x70, 0x73, 0x62, 0x74, 0xff,
      // global: the unsigned transaction
      ...varint(1), 0x00, ...varint(unsigned.length), ...Array.from(unsigned),
      0x00,
      // one input map, one output map (empty)
      ...input,
      0x00,
      0x00,
    ]);
  const psbt = psbtWith([]);
  const signedPsbt = psbtWith([...varint(1), 0x13, ...varint(SIG.length), ...SIG]);
  const witness = [...varint(1), ...varint(SIG.length), ...SIG];
  const finalizedPsbt = psbtWith([...varint(1), 0x08, ...varint(witness.length), ...witness]);
  const txid = hex(Array.from(sha256(sha256(unsigned))).reverse());
  return {
    raw,
    rawHex: hex(raw),
    psbt,
    signedPsbt,
    finalizedPsbt,
    txid,
    spends: { txid: hex([...prevLe].reverse()), vout: 0 },
    outScriptHex: hex(OUT_SCRIPT),
    valueSats,
  };
}
