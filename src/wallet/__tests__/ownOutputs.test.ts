/**
 * Decided 2026-09-26: "change", "Refresh" and the
 * co-signing limit's own_outputs were read off any derivation entry in an
 * output map, which whoever wrote the PSBT controls. Ownership is BDK's
 * answer against the vault's descriptor now, in one place.
 */
import { markOwnOutputs, ownOutputIndices, ownOutputIndicesOf } from '../ownOutputs';
import { psbtTxShape } from '../../bitcoin/psbt/broadcastCheck';
import { encodeBase64, PSBT_MAGIC } from '../../bitcoin/psbt/export';
import { parsePsbt, scriptToAddress } from '../../bitcoin/psbt/parse';

const NET = 'testnet' as const;
const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const p2wpkh = (b: number) => [0x00, 0x14, ...new Array(20).fill(b)];
const OWN = p2wpkh(0x22);
const THIEF = p2wpkh(0x33);

/** A fake BIP-32 derivation entry, any fingerprint: what an attacker adds. */
const derivation = [34, 0x02, 0x02, ...new Array(32).fill(0x44), 8, 0xde, 0xad, 0xbe, 0xef, ...u32(0)];

function psbt(): string {
  const outs = [THIEF, OWN];
  const tx = [
    ...u32(2), 1, ...new Array(32).fill(0xaa), ...u32(0), 0, ...u32(0xfffffffd),
    outs.length, ...outs.flatMap((s) => [...u32(90_000), ...u32(0), s.length, ...s]), ...u32(0),
  ];
  // input map empty; BOTH outputs carry a derivation entry
  return encodeBase64(
    Uint8Array.from([...PSBT_MAGIC, 1, 0x00, tx.length, ...tx, 0, 0, ...derivation, 0, ...derivation, 0]),
  );
}

const engine = {
  network: NET,
  ownsAddress: async (a: string) => a === scriptToAddress(Uint8Array.from(OWN), NET),
};

describe('which outputs are the vault\'s own', () => {
  it('a derivation entry on a stranger\'s output is only a hint', async () => {
    const b64 = psbt();
    const parsed = parsePsbt(b64, NET);
    expect(parsed.outputs.map((o) => o.hasDerivation)).toEqual([true, true]);
    const own = await ownOutputIndices(engine, b64);
    expect(own).toEqual([1]);
    const marked = markOwnOutputs(parsed, own);
    expect(marked.outputs.map((o) => o.isOwn)).toEqual([false, true]);
    // So the payment is a payment, never "Refresh".
    expect(marked.outputs.every((o) => o.isOwn)).toBe(false);
    // The same answer for outputs already read (a signed transaction's).
    expect(await ownOutputIndicesOf(engine, psbtTxShape(b64)!.outputs)).toEqual([1]);
  });

  it('an engine that cannot answer marks nothing as the vault\'s own', async () => {
    const broken = { network: NET, ownsAddress: async () => { throw new Error('offline'); } };
    expect(await ownOutputIndices(broken, psbt())).toEqual([]);
    expect(await ownOutputIndices(engine, 'not a psbt')).toEqual([]);
  });
});

describe('no screen reads "ours" off a derivation entry', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  it('the ui never touches hasDerivation', () => {
    const dir = path.join(__dirname, '../../ui');
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : [],
      );
    const offenders = walk(dir).filter((f) => fs.readFileSync(f, 'utf8').includes('hasDerivation'));
    expect(offenders).toEqual([]);
  });
});
