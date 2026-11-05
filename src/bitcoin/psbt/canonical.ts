/**
 * A PSBT read map by map, and a canonical form of it for comparing two
 * copies whatever order their writers put the entries in (BDK upgrade, decided
 * 2026-10-15: "PSBT map order" is an allowed difference between the
 * two libraries; every entry's key and value must still be the same).
 * Pure. The shadow checks compared two engines' copies with it until the old
 * engine's removal (decided 2026-11-04); since then the address check reads a build's
 * outputs through `psbtMaps` (bitcoin/engine/addressCheck.ts) and the tier
 * C runner compares a refused finalize's copy with `canonicalPsbt`.
 */
import { decodeBase64, PSBT_MAGIC } from './export';
import { Reader, parseTx } from './parse';

export interface RawEntry {
  /** The whole key (type byte and key data), hex. */
  key: string;
  value: string;
}

export interface PsbtMaps {
  global: RawEntry[];
  inputs: RawEntry[][];
  outputs: RawEntry[][];
  tx: ReturnType<typeof parseTx> & { version: number };
}

const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function readEntries(r: Reader): RawEntry[] {
  const out: RawEntry[] = [];
  for (;;) {
    const keyLen = r.varint();
    if (keyLen === 0) return out;
    const key = r.bytes(keyLen);
    const value = r.varBytes();
    out.push({ key: toHex(key), value: toHex(value) });
  }
}

/** Every map of a PSBT, and its unsigned transaction read; null when unreadable. */
export function psbtMaps(base64: string): PsbtMaps | null {
  try {
    const bytes = decodeBase64(base64);
    if (!bytes || bytes.length < 5 || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) return null;
    const r = new Reader(bytes, PSBT_MAGIC.length);
    const global = readEntries(r);
    const txEntry = global.find((e) => e.key === '00');
    if (!txEntry) return null;
    const txBytes = Uint8Array.from((txEntry.value.match(/../g) ?? []).map((h) => parseInt(h, 16)));
    const version = (txBytes[0] | (txBytes[1] << 8) | (txBytes[2] << 16)) + txBytes[3] * 0x1000000;
    const tx = { ...parseTx(new Reader(txBytes)), version };
    const inputs = tx.ins.map(() => readEntries(r));
    const outputs = tx.outs.map(() => readEntries(r));
    return { global, inputs, outputs, tx };
  } catch {
    return null;
  }
}

const sortEntries = (m: RawEntry[]) => [...m].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/**
 * One string per PSBT whatever its map order: every map's entries sorted by
 * key. `dropOutput` names output key types left out (the shadow checks
 * left out PSBT_OUT_TAP_TREE, 0x06: 0.28 and 3.x list a change output's
 * leaves in another order for the same merkle root).
 */
export function canonicalPsbt(base64: string, dropOutput: number[] = []): string | null {
  const m = psbtMaps(base64);
  if (!m) return null;
  const keep = (e: RawEntry) => !dropOutput.includes(parseInt(e.key.slice(0, 2), 16));
  return JSON.stringify({
    global: sortEntries(m.global),
    inputs: m.inputs.map(sortEntries),
    outputs: m.outputs.map((o) => sortEntries(o.filter(keep))),
  });
}
