/**
 * Put a PSBT's outputs in a random order (BDK upgrade, decided
 * 2026-10-15: "transactions shaped exactly like today").
 *
 * bdk 0.28 built every Talia transaction with TxOrdering::Shuffle, which in
 * 0.28 shuffled the OUTPUTS only: the change was never recognisable by its
 * place. bdk_wallet 3.x's Shuffle shuffles the inputs too, so the new bridge
 * builds with TxOrdering::Untouched (the inputs stay in 0.28's order, the
 * outputs come recipients first, change last) and the new engine shuffles the
 * outputs here, the way 0.28 did.
 *
 * Every byte but the outputs' order is kept: the global map's entries (the
 * unsigned transaction in place, same length), every input map as it was,
 * each output map moved with its output (a change output keeps its
 * derivation). Returns the new PSBT and its unsigned txid. Pure; tested.
 */
import { sha256 } from '@noble/hashes/sha256';
import { decodeBase64, encodeBase64, PSBT_MAGIC } from './export';
import { Reader } from './parse';

export interface ShuffledPsbt {
  psbtBase64: string;
  /** The unsigned transaction's txid (display order). */
  txid: string;
  /** order[i] = the index the new output i had before. */
  order: number[];
}

/** A random index below n, from a source of floats in [0, 1). */
type Random = () => number;

const txidOf = (tx: Uint8Array): string => {
  const h = sha256(sha256(tx));
  let out = '';
  for (let i = h.length - 1; i >= 0; i--) out += h[i].toString(16).padStart(2, '0');
  return out;
};

/** Skip one key-value map, returning where the unsigned tx value sits if met. */
function skipMap(r: Reader, wantTx: boolean): { txAt: [number, number] | null } {
  let txAt: [number, number] | null = null;
  for (;;) {
    const keyLen = r.varint();
    if (keyLen === 0) return { txAt };
    const key = r.bytes(keyLen);
    const valueLen = r.varint();
    const start = r.pos;
    r.bytes(valueLen);
    if (wantTx && keyLen === 1 && key[0] === 0x00) txAt = [start, r.pos];
  }
}

/** Fisher-Yates over 0..n-1. */
export function shuffledOrder(n: number, random: Random): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** A uniform float in [0, 1) from the platform's CSPRNG (react-native-get-random-values on the phone). */
export function secureRandom(): number {
  const b = new Uint32Array(1);
  (globalThis as { crypto: { getRandomValues: (a: Uint32Array) => Uint32Array } }).crypto.getRandomValues(b);
  return b[0] / 0x100000000;
}

/**
 * The PSBT with its outputs in `order` (or a fresh random order). Throws on
 * anything that is not a readable PSBT; never changes an input or an entry.
 */
export function shufflePsbtOutputs(psbtBase64: string, random: Random = secureRandom, order?: number[]): ShuffledPsbt {
  const bytes = decodeBase64(psbtBase64);
  if (!bytes || bytes.length < 5 || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error('Not a PSBT');
  }
  const r = new Reader(bytes, PSBT_MAGIC.length);
  const { txAt } = skipMap(r, true);
  const globalEnd = r.pos;
  if (!txAt) throw new Error('The PSBT has no unsigned transaction');
  const tx = bytes.slice(txAt[0], txAt[1]);

  // The unsigned transaction: version, inputs, outputs (kept as raw slices), lock time.
  const t = new Reader(tx);
  t.u32();
  const nIn = t.varint();
  if (nIn === 0) throw new Error('The unsigned transaction has no inputs');
  for (let i = 0; i < nIn; i++) {
    t.bytes(36);
    t.varBytes();
    t.u32();
  }
  const outsAt = t.pos;
  const nOut = t.varint();
  const outs: Uint8Array[] = [];
  for (let i = 0; i < nOut; i++) {
    const s = t.pos;
    t.bytes(8);
    t.varBytes();
    outs.push(tx.slice(s, t.pos));
  }
  const tail = tx.slice(t.pos);
  if (tail.length !== 4) throw new Error('The unsigned transaction is not a plain one');

  const inputMaps: Uint8Array[] = [];
  for (let i = 0; i < nIn; i++) {
    const s = r.pos;
    skipMap(r, false);
    inputMaps.push(bytes.slice(s, r.pos));
  }
  const outputMaps: Uint8Array[] = [];
  for (let i = 0; i < nOut; i++) {
    const s = r.pos;
    skipMap(r, false);
    outputMaps.push(bytes.slice(s, r.pos));
  }
  if (r.remaining !== 0) throw new Error('The PSBT has bytes after its last map');

  const ord = order ?? shuffledOrder(nOut, random);
  if (ord.length !== nOut || new Set(ord).size !== nOut || ord.some((i) => i < 0 || i >= nOut)) {
    throw new Error('Not an order of the outputs');
  }

  // The transaction with its outputs reordered: same bytes, same length.
  const outputCountEnd = (() => {
    const c = new Reader(tx, outsAt);
    c.varint();
    return c.pos;
  })();
  const newTx = new Uint8Array(tx.length);
  let w = 0;
  const put = (b: Uint8Array) => {
    newTx.set(b, w);
    w += b.length;
  };
  put(tx.slice(0, outputCountEnd));
  for (const i of ord) put(outs[i]);
  put(tail);

  const out = new Uint8Array(bytes.length);
  let o = 0;
  const emit = (b: Uint8Array) => {
    out.set(b, o);
    o += b.length;
  };
  emit(bytes.slice(0, txAt[0]));
  emit(newTx);
  emit(bytes.slice(txAt[1], globalEnd));
  for (const m of inputMaps) emit(m);
  for (const i of ord) emit(outputMaps[i]);
  return { psbtBase64: encodeBase64(out), txid: txidOf(newTx), order: ord };
}
