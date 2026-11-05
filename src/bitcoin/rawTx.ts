/**
 * Pure reader for a consensus-encoded bitcoin transaction — powers the
 * BlueWallet-style Advanced panel on the transaction page: size, virtual
 * size, fee rate, and the input/output address lists.
 *
 * Speed up and Cancel (wallet/replacement.ts) also read it: the original's
 * nSequence values, its real size and its output sizes.
 *
 * Nothing here signs, builds, or validates. Address recovery
 * for INPUTS is best-effort from what the input itself reveals (witness
 * pubkey → P2WPKH, witness script → P2WSH, scriptSig pubkey → P2PKH);
 * inputs that don't reveal their script (e.g. taproot key-path) fall back
 * to null and the UI shows the outpoint instead. Hashing uses the audited
 * @noble primitives; everything consensus-critical stays in BDK.
 */
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { scriptToAddress } from './psbt/parse';
import type { Network } from './descriptor/types';

export interface RawTxInput {
  /** Funding outpoint (txid big-endian hex, as explorers show it). */
  txid: string;
  vout: number;
  /** Best-effort recovered address; null when the input doesn't reveal it. */
  address: string | null;
  /**
   * The input's nSequence. Speed up and Cancel read it: anything below
   * 0xFFFFFFFE signals replaceability (BIP-125), and 0xFFFFFFFD is what BDK
   * writes on the everyday path, where a timelocked path carries its
   * `older(N)` wait instead.
   */
  sequence: number;
}

export interface RawTxOutput {
  address: string | null;
  valueSats: number;
  /** The output's scriptPubKey, hex: what a check compares, never the
   *  address text (one script has an address per network). */
  scriptHex: string;
  /** Length of the output's script in bytes: a replacement's size is the
   *  original's with its outputs swapped, so the fee floor needs it. */
  scriptLength: number;
}

export interface RawTxInfo {
  /** The txid: double SHA-256 of the WITNESS-FREE serialization, displayed
   *  big-endian. For segwit and taproot spends it equals the unsigned
   *  transaction's, which is how a returned transaction is matched to the
   *  PSBT the client reviewed (decided 2026-09-26). */
  txid: string;
  /**
   * The txid with every scriptSig emptied: the id of the transaction as it
   * stood UNSIGNED. For segwit and taproot spends it equals `txid`; for a
   * nested-segwit (sh-wpkh, sh-wsh) or legacy input the signature sits in
   * the scriptSig and changes `txid`, so matching a returned transaction to
   * the PSBT it answers compares this one (a PSBT's unsigned transaction
   * has empty scriptSigs by BIP-174).
   */
  unsignedTxid: string;
  /** Full serialized size in bytes. */
  sizeBytes: number;
  /** BIP-141 weight units. */
  weight: number;
  /** ceil(weight / 4) — what fee rates divide by. */
  vsize: number;
  inputs: RawTxInput[];
  outputs: RawTxOutput[];
  hex: string;
  /** nVersion: BIP-68 relative waits bind only from version 2. */
  version: number;
  /** nLockTime: a block height below 500 000 000, else a Unix time. */
  lockTime: number;
}

class Reader {
  constructor(
    private buf: Uint8Array,
    public pos = 0,
  ) {}
  bytes(n: number): Uint8Array {
    if (this.buf.length - this.pos < n) throw new Error('Transaction truncated');
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u8(): number {
    return this.bytes(1)[0];
  }
  u32(): number {
    const b = this.bytes(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16)) + b[3] * 0x1000000;
  }
  u64(): number {
    const lo = this.u32();
    const hi = this.u32();
    return hi * 0x100000000 + lo;
  }
  varint(): number {
    const first = this.u8();
    if (first < 0xfd) return first;
    if (first === 0xfd) return this.bytes(2).reduce((a, b, i) => a + b * 256 ** i, 0);
    if (first === 0xfe) return this.u32();
    return this.u64();
  }
  varBytes(): Uint8Array {
    return this.bytes(this.varint());
  }
}

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const hash160 = (b: Uint8Array): Uint8Array => ripemd160(sha256(b));

/** Last data push of a script (naive walk — enough for P2PKH scriptSigs). */
function lastPush(script: Uint8Array): Uint8Array | null {
  const r = new Reader(script);
  let last: Uint8Array | null = null;
  try {
    while (r.pos < script.length) {
      const op = r.u8();
      if (op > 0 && op <= 75) last = r.bytes(op);
      else if (op === 0x4c) last = r.bytes(r.u8());
      else return null; // any other opcode → not a plain sig+pubkey push script
    }
  } catch {
    return null;
  }
  return last;
}

/** Recover an input's address from what it reveals about its own script. */
function inputAddress(
  scriptSig: Uint8Array,
  witness: Uint8Array[],
  network: Network,
): string | null {
  if (witness.length === 2 && witness[1].length === 33 && scriptSig.length === 0) {
    // P2WPKH: [signature, compressed pubkey]
    const h = hash160(witness[1]);
    return scriptToAddress(Uint8Array.from([0x00, 0x14, ...h]), network);
  }
  if (witness.length >= 2 && scriptSig.length === 0) {
    // Taproot script-path spends end in a control block (0xc0/0xc1 parity
    // byte, length 33+32m) — no address recoverable from those.
    const last = witness[witness.length - 1];
    const isTapControl = (last[0] & 0xfe) === 0xc0 && last.length % 32 === 1;
    if (!isTapControl) {
      // P2WSH: last witness item is the witness script
      return scriptToAddress(
        Uint8Array.from([0x00, 0x20, ...sha256(last)]),
        network,
      );
    }
  }
  if (witness.length === 0 && scriptSig.length > 0) {
    // Legacy P2PKH: scriptSig pushes <sig> <pubkey>
    const pk = lastPush(scriptSig);
    if (pk && (pk.length === 33 || pk.length === 65)) {
      const h = hash160(pk);
      return scriptToAddress(
        Uint8Array.from([0x76, 0xa9, 0x14, ...h, 0x88, 0xac]),
        network,
      );
    }
  }
  return null; // taproot key-path and friends don't reveal their script
}

export function parseRawTransaction(bytes: Uint8Array, network: Network): RawTxInfo {
  const r = new Reader(bytes);
  const version = r.u32();
  let insStart = r.pos;
  let nIn = r.varint();
  let segwit = false;
  if (nIn === 0) {
    const flag = r.u8();
    if (flag !== 1) throw new Error('Invalid transaction');
    segwit = true;
    insStart = r.pos;
    nIn = r.varint();
  }
  const inCountBytes = bytes.slice(insStart, r.pos);
  const ins: Array<{
    txid: string;
    vout: number;
    scriptSig: Uint8Array;
    sequence: number;
    prevoutBytes: Uint8Array;
    sequenceBytes: Uint8Array;
  }> = [];
  for (let i = 0; i < nIn; i++) {
    const prevStart = r.pos;
    // txid is serialized little-endian; explorers display it reversed.
    const txid = toHex(r.bytes(32).slice().reverse());
    const vout = r.u32();
    const prevoutBytes = bytes.slice(prevStart, r.pos);
    const scriptSig = r.varBytes();
    const seqStart = r.pos;
    const sequence = r.u32();
    ins.push({ txid, vout, scriptSig, sequence, prevoutBytes, sequenceBytes: bytes.slice(seqStart, r.pos) });
  }
  const outsStart = r.pos;
  const nOut = r.varint();
  const outputs: RawTxOutput[] = [];
  for (let i = 0; i < nOut; i++) {
    const valueSats = r.u64();
    const script = r.varBytes();
    outputs.push({
      address: scriptToAddress(script, network),
      valueSats,
      scriptLength: script.length,
      scriptHex: toHex(script),
    });
  }
  const witnesses: Uint8Array[][] = [];
  const witnessStart = r.pos;
  if (segwit) {
    for (let i = 0; i < nIn; i++) {
      const items = r.varint();
      const stack: Uint8Array[] = [];
      for (let j = 0; j < items; j++) stack.push(r.varBytes());
      witnesses.push(stack);
    }
  }
  const witnessBytes = segwit ? r.pos - witnessStart + 2 : 0; // + marker/flag
  const lockStart = r.pos;
  const lockTime = r.u32();
  const sizeBytes = r.pos;
  // Witness-free serialization: version, inputs and outputs, locktime.
  const stripped = new Uint8Array(4 + (witnessStart - insStart) + 4);
  stripped.set(bytes.slice(0, 4), 0);
  stripped.set(bytes.slice(insStart, witnessStart), 4);
  stripped.set(bytes.slice(lockStart, lockStart + 4), 4 + (witnessStart - insStart));
  const txid = toHex(sha256(sha256(stripped)).reverse());
  // The same serialization with every scriptSig emptied (length byte 0).
  const unsignedParts: Uint8Array[] = [bytes.slice(0, 4), inCountBytes];
  for (const inp of ins) unsignedParts.push(inp.prevoutBytes, Uint8Array.of(0), inp.sequenceBytes);
  unsignedParts.push(bytes.slice(outsStart, witnessStart), bytes.slice(lockStart, lockStart + 4));
  const unsignedLen = unsignedParts.reduce((n, p) => n + p.length, 0);
  const unsignedSer = new Uint8Array(unsignedLen);
  let at = 0;
  for (const part of unsignedParts) {
    unsignedSer.set(part, at);
    at += part.length;
  }
  const unsignedTxid = toHex(sha256(sha256(unsignedSer)).reverse());
  const baseSize = sizeBytes - witnessBytes;
  const weight = baseSize * 3 + sizeBytes;
  const vsize = Math.ceil(weight / 4);

  const inputs: RawTxInput[] = ins.map((inp, i) => ({
    txid: inp.txid,
    vout: inp.vout,
    address: inputAddress(inp.scriptSig, witnesses[i] ?? [], network),
    sequence: inp.sequence,
  }));

  return {
    txid,
    unsignedTxid,
    sizeBytes,
    weight,
    vsize,
    inputs,
    outputs,
    hex: toHex(bytes.slice(0, sizeBytes)),
    version,
    lockTime,
  };
}
