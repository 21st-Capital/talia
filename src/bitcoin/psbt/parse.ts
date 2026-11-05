/**
 * Minimal pure-TS BIP-174 PSBT reader — enough to ROUTE and PREVIEW a scanned
 * PSBT: which wallet (by master-key fingerprints) should sign it, where the
 * money goes, and what fee it pays.
 *
 * This is deliberately a *reader*: no signing, no mutation, no script
 * interpretation beyond the four standard output templates. Address encoding
 * uses the audited @scure/@noble primitives (encoding, not cryptography);
 * everything consensus-critical stays in BDK.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bech32, bech32m, createBase58check } from '@scure/base';
import { decodeBase64, PSBT_MAGIC } from './export';
import type { Network } from '../descriptor/types';

const base58check = createBase58check(sha256);

export interface PsbtOutputSummary {
  /** Encoded address, or null for non-standard scripts (e.g. OP_RETURN). */
  address: string | null;
  amountSats: number;
  /**
   * True when the output map carries a BIP-32 or taproot derivation entry.
   * A HINT for signing devices only: whoever wrote the PSBT writes those
   * entries, so it never decides "change" or "refresh" (decided
   * 2026-09-26). What does is `isOwn`.
   */
  hasDerivation: boolean;
  /**
   * The output pays THIS vault, as BDK decides against the vault's own
   * descriptor (`wallet/ownOutputs.markOwnOutputs`). Absent until that
   * answer is in, which every reader takes as "leaving the vault".
   */
  isOwn?: boolean;
}

export interface PsbtInputRef {
  /** Funding outpoint — enough to look the coin's confirmation height up. */
  txid: string;
  vout: number;
}

export interface ParsedPsbt {
  numInputs: number;
  numOutputs: number;
  /** The coins this transaction spends (display-order). */
  inputRefs: PsbtInputRef[];
  /** Master fingerprints (lowercase hex) found in input derivation entries. */
  inputFingerprints: string[];
  outputs: PsbtOutputSummary[];
  /** Sum of known input amounts; null when any input lacks utxo data. */
  totalInSats: number | null;
  totalOutSats: number;
  /** totalIn − totalOut; null when inputs are incomplete. */
  feeSats: number | null;
}

export class Reader {
  constructor(
    private buf: Uint8Array,
    public pos = 0,
  ) {}
  get remaining(): number {
    return this.buf.length - this.pos;
  }
  bytes(n: number): Uint8Array {
    if (this.remaining < n) throw new Error('PSBT truncated');
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
  /** 64-bit LE amount as a JS number (sats fit in 2^53). */
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

interface TxOut {
  amountSats: number;
  script: Uint8Array;
}

/** Parse a serialized (witness-free, per BIP-174) transaction's outputs. */
export function parseTx(r: Reader): {
  ins: Array<{ txid: string; vout: number; sequence: number }>;
  outs: TxOut[];
  /** nLockTime: a block height below 500 000 000, a Unix time at or above. */
  lockTime: number;
} {
  r.u32(); // version
  let nIn = r.varint();
  // Defensive: a witness-serialized tx (marker 0x00 flag 0x01) can appear in
  // non_witness_utxo values.
  let hasWitness = false;
  if (nIn === 0) {
    const flag = r.u8();
    if (flag !== 1) throw new Error('Invalid tx');
    hasWitness = true;
    nIn = r.varint();
  }
  const ins: Array<{ txid: string; vout: number; sequence: number }> = [];
  for (let i = 0; i < nIn; i++) {
    // Prev txid is serialized little-endian; display order is reversed.
    const txid = toHex(r.bytes(32).reverse());
    const vout = r.u32();
    r.varBytes(); // scriptSig
    const sequence = r.u32();
    ins.push({ txid, vout, sequence });
  }
  const nOut = r.varint();
  const outs: TxOut[] = [];
  for (let i = 0; i < nOut; i++) {
    const amountSats = r.u64();
    const script = r.varBytes();
    outs.push({ amountSats, script });
  }
  if (hasWitness) {
    for (let i = 0; i < nIn; i++) {
      const items = r.varint();
      for (let j = 0; j < items; j++) r.varBytes();
    }
  }
  const lockTime = r.u32();
  return { ins, outs, lockTime };
}

/** Encode the four standard script templates to an address on `network`. */
export function scriptToAddress(
  script: Uint8Array,
  network: Network = 'bitcoin',
): string | null {
  // Address encoding is network-specific: the SAME script renders bc1… on
  // mainnet and tb1… on testnet/signet (with a different checksum). Getting
  // this wrong showed a testnet recipient as a mainnet address (decided 2026-07-18).
  const hrp = network === 'bitcoin' ? 'bc' : network === 'regtest' ? 'bcrt' : 'tb';
  const p2pkhVersion = network === 'bitcoin' ? 0x00 : 0x6f;
  const p2shVersion = network === 'bitcoin' ? 0x05 : 0xc4;
  const words = (program: Uint8Array, version: number) => [
    version,
    ...bech32.toWords(program),
  ];
  // P2WPKH / P2WSH (witness v0)
  if (script.length === 22 && script[0] === 0x00 && script[1] === 0x14) {
    return bech32.encode(hrp, words(script.slice(2), 0));
  }
  if (script.length === 34 && script[0] === 0x00 && script[1] === 0x20) {
    return bech32.encode(hrp, words(script.slice(2), 0), 90);
  }
  // P2TR (witness v1, bech32m)
  if (script.length === 34 && script[0] === 0x51 && script[1] === 0x20) {
    return bech32m.encode(hrp, words(script.slice(2), 1), 90);
  }
  // P2PKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
  if (
    script.length === 25 &&
    script[0] === 0x76 &&
    script[1] === 0xa9 &&
    script[2] === 0x14 &&
    script[23] === 0x88 &&
    script[24] === 0xac
  ) {
    return base58check.encode(Uint8Array.from([p2pkhVersion, ...script.slice(3, 23)]));
  }
  // P2SH: OP_HASH160 <20> OP_EQUAL
  if (script.length === 23 && script[0] === 0xa9 && script[1] === 0x14 && script[22] === 0x87) {
    return base58check.encode(Uint8Array.from([p2shVersion, ...script.slice(2, 22)]));
  }
  return null;
}

/** Read one PSBT key-value map; returns entries and stops after the 0x00 end. */
export function readMap(r: Reader): Array<{ keyType: number; keyData: Uint8Array; value: Uint8Array }> {
  const entries: Array<{ keyType: number; keyData: Uint8Array; value: Uint8Array }> = [];
  for (;;) {
    const keyLen = r.varint();
    if (keyLen === 0) return entries;
    const key = r.bytes(keyLen);
    const value = r.varBytes();
    // Key type is itself a varint, but every type we care about is 1 byte.
    entries.push({ keyType: key[0], keyData: key.slice(1), value });
  }
}

/** Fingerprint from a BIP32_DERIVATION value: <4-byte fp><path…>. */
const fpOf = (value: Uint8Array): string => toHex(value.slice(0, 4));

/** `<fp>/<path>` from the bytes `<4-byte fp><u32 LE…>` of a derivation, the
 *  path written with `'` for a hardened step ("f5d9e0c9/48'/1'/0'/2'/2/0"). */
function originText(r: Reader): string {
  const fp = toHex(r.bytes(4));
  const steps: string[] = [];
  while (r.remaining >= 4) {
    const n = r.u32();
    steps.push(n >= 0x80000000 ? `${n - 0x80000000}'` : String(n));
  }
  return [fp, ...steps].join('/');
}

/** The full origin of a BIP32_DERIVATION or TAP_BIP32_DERIVATION value, or null. */
function originOf(value: Uint8Array, tap: boolean): string | null {
  try {
    const r = new Reader(value);
    if (tap) r.bytes(32 * r.varint());
    return originText(r);
  } catch {
    return null;
  }
}

/** Fingerprint from a TAP_BIP32_DERIVATION value: <varint n><32×n hashes><fp><path…>. */
export function tapFpOf(value: Uint8Array): string | null {
  const r = new Reader(value);
  try {
    const n = r.varint();
    r.bytes(32 * n);
    return toHex(r.bytes(4));
  } catch {
    return null;
  }
}

/** The PSBT's unsigned transaction, consensus bytes; null when unreadable. */
export function psbtUnsignedTx(base64: string): Uint8Array | null {
  try {
    const bytes = decodeBase64(base64);
    if (!bytes || bytes.length < 5 || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) {
      return null;
    }
    const r = new Reader(bytes, PSBT_MAGIC.length);
    return readMap(r).find((e) => e.keyType === 0x00)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * The txid of a PSBT's UNSIGNED transaction — a stable name for "this spend".
 *
 * Why this exists (decided 2026-07-29): the pending list showed one payment twice,
 * because the phone-parked copy and the 21C co-sign request are separate
 * records whose ids come from unrelated namespaces, and nothing ever compared
 * the two spends to notice they were the same money going to the same place.
 *
 * The merge key CANNOT be the PSBT bytes — they change every time a signature
 * is added. The unsigned transaction does not: same inputs, same outputs,
 * whoever has signed. So its hash names the spend identically across the
 * unsigned build, one signature, two signatures, the stripped blind request
 * sent to 21st Capital, and the copy they send back.
 *
 * For segwit and taproot this also equals the txid the network will confirm
 * (witnesses are excluded from txid), so it doubles as the key for clearing
 * records once the spend lands. For legacy `pkh`/`sh` inputs — which Talia can
 * import but never creates — signatures live in the scriptSig and DO change
 * the txid; matching then simply fails, leaving a stale row rather than
 * removing the wrong one.
 *
 * @returns 64-char big-endian hex, or null if the input is not a readable PSBT.
 */
export function unsignedTxid(base64: string): string | null {
  try {
    const tx = psbtUnsignedTx(base64);
    if (!tx) return null;
    // Double-SHA256 of the raw unsigned tx, displayed big-endian as everywhere
    // else in Bitcoin.
    const h = sha256(sha256(tx));
    let out = '';
    for (let i = h.length - 1; i >= 0; i--) out += h[i].toString(16).padStart(2, '0');
    return out;
  } catch {
    return null;
  }
}

/**
 * The unsigned transaction's lock time and whether it signals replacement
 * (BIP-125: any input's sequence below 0xFFFFFFFE). A BitBox shows both on
 * a page of its own before the total, so the signing screen's drawing of it
 * reads them here rather than guess. Null for anything that is not a PSBT.
 */
export function psbtLockTime(base64: string): { lockTime: number; rbf: boolean } | null {
  try {
    const bytes = decodeBase64(base64);
    if (!bytes || bytes.length < 5 || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) return null;
    const txEntry = readMap(new Reader(bytes, PSBT_MAGIC.length)).find((e) => e.keyType === 0x00);
    if (!txEntry) return null;
    const tx = parseTx(new Reader(txEntry.value));
    return { lockTime: tx.lockTime, rbf: tx.ins.some((i) => i.sequence < 0xfffffffe) };
  } catch {
    return null;
  }
}

export function parsePsbt(base64: string, network: Network = 'bitcoin'): ParsedPsbt {
  const bytes = decodeBase64(base64);
  if (!bytes || bytes.length < 5 || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error('Not a valid PSBT');
  }
  const r = new Reader(bytes, PSBT_MAGIC.length);

  // Global map: the unsigned tx (key type 0x00) defines input/output counts.
  const globalEntries = readMap(r);
  const txEntry = globalEntries.find((e) => e.keyType === 0x00);
  if (!txEntry) throw new Error('PSBT has no unsigned transaction');
  const tx = parseTx(new Reader(txEntry.value));

  const inputFingerprints = new Set<string>();
  let totalIn: number | null = 0;

  for (const input of tx.ins) {
    const entries = readMap(r);
    let amount: number | null = null;
    for (const e of entries) {
      if (e.keyType === 0x01) {
        // witness_utxo: <8-byte amount><script>
        amount = new Reader(e.value).u64();
      } else if (e.keyType === 0x00 && amount == null) {
        // non_witness_utxo: whole previous tx — our input's vout has the amount
        try {
          const prev = parseTx(new Reader(e.value));
          amount = prev.outs[input.vout]?.amountSats ?? null;
        } catch {
          amount = null;
        }
      } else if (e.keyType === 0x06) {
        inputFingerprints.add(fpOf(e.value));
      } else if (e.keyType === 0x16) {
        const fp = tapFpOf(e.value);
        if (fp) inputFingerprints.add(fp);
      }
    }
    totalIn = amount == null || totalIn == null ? null : totalIn + amount;
  }

  const outputs: PsbtOutputSummary[] = [];
  for (const out of tx.outs) {
    const entries = readMap(r);
    const hasDerivation = entries.some((e) => e.keyType === 0x02 || e.keyType === 0x07);
    outputs.push({
      address: scriptToAddress(out.script, network),
      amountSats: out.amountSats,
      hasDerivation,
    });
  }

  const totalOutSats = outputs.reduce((s, o) => s + o.amountSats, 0);
  return {
    numInputs: tx.ins.length,
    numOutputs: outputs.length,
    inputRefs: tx.ins.map((i) => ({ txid: i.txid, vout: i.vout })),
    inputFingerprints: [...inputFingerprints],
    outputs,
    totalInSats: totalIn,
    totalOutSats,
    feeSats: totalIn == null ? null : totalIn - totalOutSats,
  };
}

export interface PsbtSignatureStatus {
  /** Fingerprints that have a partial signature on EVERY input they appear in. */
  signedFingerprints: string[];
  /** Fingerprints present in the derivations but not (fully) signed yet. */
  pendingFingerprints: string[];
  /** Partial signatures on the least-signed input — the ceremony's progress. */
  signatureCount: number;
  /**
   * Per input, the fingerprints that signed TOGETHER under one spend
   * condition, keyed by it: a tapleaf hash (hex; a TAP_SCRIPT_SIG is keyed
   * by x-only pubkey AND leaf hash) or `ecdsa` for partial signatures. Keys
   * that signed different leaves never add up to one path (decided
   * 2026-09-26): the network checks each leaf on its own.
   */
  signerGroups: SignerGroups;
  /**
   * `signerGroups` by KEY instead of by seed: per input and per spend
   * condition, the full derivation of each key that signed
   * ("f5d9e0c9/48'/1'/0'/2'/2/0"). One seed often holds keys on two paths
   * (Liana's `<0;1>` and `<2;3>`), and a fingerprint cannot tell which of
   * them signed (the leaf hazard, decided 2026-10-17). A key with no derivation is left out.
   */
  signerKeys: SignerGroups;
}

/** Per input: spend condition (leaf hash hex, or `ecdsa`) -> fingerprints. */
export type SignerGroups = Array<Record<string, string[]>>;

/**
 * The signer groups of several copies of ONE transaction, merged per input
 * and per leaf: what a finalizer that combined them had to work with.
 */
export function mergeSignerGroups(...all: SignerGroups[]): SignerGroups {
  const n = Math.max(0, ...all.map((g) => g.length));
  const out: SignerGroups = [];
  for (let i = 0; i < n; i++) {
    const merged: Record<string, string[]> = {};
    for (const groups of all) {
      for (const [leaf, fps] of Object.entries(groups[i] ?? {})) {
        merged[leaf] = [...new Set([...(merged[leaf] ?? []), ...fps])];
      }
    }
    out.push(merged);
  }
  return out;
}

/** Leaf hashes a TAP_BIP32_DERIVATION value lists (hex), or null. */
function tapLeavesOf(value: Uint8Array): string[] | null {
  const r = new Reader(value);
  try {
    const n = r.varint();
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(toHex(r.bytes(32)));
    return out;
  } catch {
    return null;
  }
}

/**
 * Who has signed a partially-signed multisig PSBT so far. Drives the
 * ceremony progress UI: signature rounds continue until BDK can finalize.
 */
export function psbtSignatureStatus(base64: string): PsbtSignatureStatus {
  const empty: PsbtSignatureStatus = {
    signedFingerprints: [],
    pendingFingerprints: [],
    signatureCount: 0,
    signerGroups: [],
    signerKeys: [],
  };
  const bytes = decodeBase64(base64);
  if (!bytes || bytes.length < 5 || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) {
    return empty;
  }
  try {
    const r = new Reader(bytes, PSBT_MAGIC.length);
    const globalEntries = readMap(r);
    const txEntry = globalEntries.find((e) => e.keyType === 0x00);
    if (!txEntry) return empty;
    const tx = parseTx(new Reader(txEntry.value));

    const signedPerInput: Array<Set<string>> = []; // fingerprints
    const seenPerInput: Array<Set<string>> = [];
    const signerGroups: SignerGroups = [];
    const signerKeys: SignerGroups = [];
    let minSigs: number | null = null;
    for (let i = 0; i < tx.ins.length; i++) {
      const entries = readMap(r);
      const fpByPubkey = new Map<string, string>();
      /** The full derivation of each key: which KEY of a seed signed. */
      const originByPubkey = new Map<string, string>();
      /** Leaves each x-only key's derivation says it sits in. */
      const leavesByPubkey = new Map<string, Set<string>>();
      const ecdsaSigners = new Set<string>(); // pubkeys
      /** leaf hash -> x-only pubkeys with a signature for THAT leaf */
      const leafSigners = new Map<string, Set<string>>();
      for (const e of entries) {
        if (e.keyType === 0x06) {
          fpByPubkey.set(toHex(e.keyData), fpOf(e.value));
          const origin = originOf(e.value, false);
          if (origin) originByPubkey.set(toHex(e.keyData), origin);
        } else if (e.keyType === 0x02) ecdsaSigners.add(toHex(e.keyData));
        else if (e.keyType === 0x16) {
          // TAP_BIP32_DERIVATION: keyData is the x-only pubkey.
          const fp = tapFpOf(e.value);
          if (fp) fpByPubkey.set(toHex(e.keyData), fp);
          const origin = originOf(e.value, true);
          if (origin) originByPubkey.set(toHex(e.keyData), origin);
          const leaves = tapLeavesOf(e.value);
          if (leaves && leaves.length > 0) leavesByPubkey.set(toHex(e.keyData), new Set(leaves));
        } else if (e.keyType === 0x14 && e.keyData.length === 64) {
          // TAP_SCRIPT_SIG: keyData = <32B x-only pubkey><32B leaf hash>.
          const pubkey = toHex(e.keyData.slice(0, 32));
          const leaf = toHex(e.keyData.slice(32, 64));
          // A signature for a leaf the key's own derivation does not list
          // is not a signature of that key in that leaf.
          const listed = leavesByPubkey.get(pubkey);
          if (listed && !listed.has(leaf)) continue;
          const set = leafSigners.get(leaf) ?? new Set<string>();
          set.add(pubkey);
          leafSigners.set(leaf, set);
        }
      }
      // Derivations may come after the signatures in the map: re-check the
      // leaf listing now that every derivation has been read.
      for (const [leaf, pubkeys] of leafSigners) {
        for (const pk of [...pubkeys]) {
          const listed = leavesByPubkey.get(pk);
          if (listed && !listed.has(leaf)) pubkeys.delete(pk);
        }
      }
      const sigPubkeys = new Set<string>([
        ...ecdsaSigners,
        ...[...leafSigners.values()].flatMap((set) => [...set]),
      ]);
      minSigs = minSigs == null ? sigPubkeys.size : Math.min(minSigs, sigPubkeys.size);
      const signed = new Set<string>();
      const seen = new Set<string>();
      for (const [pubkey, fp] of fpByPubkey) {
        seen.add(fp);
        if (sigPubkeys.has(pubkey)) signed.add(fp);
      }
      const fpsOf = (pubkeys: Iterable<string>): string[] => [
        ...new Set([...pubkeys].flatMap((pk) => (fpByPubkey.has(pk) ? [fpByPubkey.get(pk)!] : []))),
      ];
      const originsOf = (pubkeys: Iterable<string>): string[] => [
        ...new Set([...pubkeys].flatMap((pk) => (originByPubkey.has(pk) ? [originByPubkey.get(pk)!] : []))),
      ];
      const groups: Record<string, string[]> = {};
      const keyGroups: Record<string, string[]> = {};
      for (const [leaf, pubkeys] of leafSigners) {
        if (pubkeys.size === 0) continue;
        groups[leaf] = fpsOf(pubkeys);
        keyGroups[leaf] = originsOf(pubkeys);
      }
      if (ecdsaSigners.size > 0) {
        groups.ecdsa = fpsOf(ecdsaSigners);
        keyGroups.ecdsa = originsOf(ecdsaSigners);
      }
      signerGroups.push(groups);
      signerKeys.push(keyGroups);
      signedPerInput.push(signed);
      seenPerInput.push(seen);
    }

    const allSeen = new Set(seenPerInput.flatMap((s) => [...s]));
    const signedFingerprints: string[] = [];
    const pendingFingerprints: string[] = [];
    for (const fp of allSeen) {
      // Signed = signed on every input the key participates in.
      const fully = seenPerInput.every(
        (seen, i) => !seen.has(fp) || signedPerInput[i].has(fp),
      );
      (fully ? signedFingerprints : pendingFingerprints).push(fp);
    }
    return { signedFingerprints, pendingFingerprints, signatureCount: minSigs ?? 0, signerGroups, signerKeys };
  } catch {
    return empty;
  }
}

/**
 * True when EVERY input carries a final scriptSig (0x07) or final witness
 * (0x08) — i.e. the PSBT is fully signed + finalized and its transaction can
 * be extracted for broadcast.
 */
export function psbtInputsFinalized(base64: string): boolean {
  const bytes = decodeBase64(base64);
  if (!bytes || bytes.length < 5 || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) {
    return false;
  }
  try {
    const r = new Reader(bytes, PSBT_MAGIC.length);
    const globalEntries = readMap(r);
    const txEntry = globalEntries.find((e) => e.keyType === 0x00);
    if (!txEntry) return false;
    const tx = parseTx(new Reader(txEntry.value));
    if (tx.ins.length === 0) return false;
    for (let i = 0; i < tx.ins.length; i++) {
      const entries = readMap(r);
      if (!entries.some((e) => e.keyType === 0x07 || e.keyType === 0x08)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
