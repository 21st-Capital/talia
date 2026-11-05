/**
 * The @scure fallback's witness check against the network's own rules (leaf
 * hazard, decided 2026-10-17). Every vector is a signed copy the fallback finalizes
 * (tapleaves @scure has no template for, its own multi_a, P2SH-P2WPKH, P2SH
 * and P2WSH multisig), under an everyday, a recovery and a final nSequence,
 * signed by every subset of keys that signs anything; `consensus` is
 * libbitcoinconsensus's verdict on the finished transaction
 * (scripts/fallback-consensus: gen.mjs, then check.rs). The check must pass
 * every transaction the network accepts and refuse every one it refuses.
 *
 * Before this, among others: a timelocked multi_a(2 of 3) signed by two was
 * finished without the third key's empty place and passed (the network
 * refuses it); or_d(pk(A),and_v(v:pk(B),older(144))) signed by A on an
 * everyday spend was refused as "a path that opens only after a wait",
 * although A's branch never runs the wait; and sh(wpkh) was refused as a
 * script with no template. Test keys only.
 */
import * as btc from '@scure/btc-signer';
import { scureFinalizePsbt } from '../finalize';
import { fallbackWitnessProblems } from '../timelockCheck';
import { decodeBase64 } from '../export';
import fx from '../__fixtures__/fallbackConsensus.json';

type Vector = { name: string; before: string; finalTx: string | null; scure: string; consensus?: string };
const vectors = fx.vectors as Vector[];
const finished = vectors.filter((v) => v.finalTx != null);

const extractHex = (b64: string): string =>
  Array.from(
    btc.Transaction.fromPSBT(decodeBase64(b64)!, { allowUnknownInputs: true, allowUnknownOutputs: true }).extract(),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');

describe('the fallback witness check agrees with libbitcoinconsensus', () => {
  it('covers both verdicts', () => {
    expect(finished.filter((v) => v.consensus === 'ok').length).toBeGreaterThan(20);
    expect(finished.filter((v) => v.consensus !== 'ok').length).toBeGreaterThan(20);
  });

  it.each(finished.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    const after = scureFinalizePsbt(v.before);
    expect(after).not.toBeNull();
    // The app's @scure finishes the very transaction the network was asked about.
    expect(extractHex(after!)).toBe(v.finalTx);
    const problems = fallbackWitnessProblems(v.before, after!);
    if (v.consensus === 'ok') expect(problems).toEqual([]);
    else expect(problems).toHaveLength(1);
  });
});

const named = (name: string) => {
  const v = vectors.find((x) => x.name === name)!;
  expect(v).toBeDefined();
  return { v, problems: fallbackWitnessProblems(v.before, scureFinalizePsbt(v.before)!) };
};

describe('the leaf-hazard cases', () => {
  it('a timelocked multi_a(2 of 3) signed by two: no empty place for the third key, refused (the network refuses it)', () => {
    const { v, problems } = named('tr and_v(v:multi_a(2,A,B,C),older(144)) / recovery / signed by A+B');
    expect(v.consensus).not.toBe('ok');
    const witness = btc.Transaction.fromPSBT(decodeBase64(scureFinalizePsbt(v.before)!)!, { allowUnknownInputs: true })
      .getInput(0).finalScriptWitness!;
    expect(witness.map((w) => w.length)).toEqual([64, 64, 108, 33]); // the probe's own shape
    expect(problems[0]).toMatch(/^coin 1: the backup assembler built a witness this script refuses/);
  });

  it('or_d(pk(A),and_v(v:pk(B),older(144))) signed by A on an everyday spend: A\'s branch never runs the wait, accepted', () => {
    const { v, problems } = named('tr or_d(pk(A),and_v(v:pk(B),older(144))) / everyday / signed by A');
    expect(v.consensus).toBe('ok');
    expect(problems).toEqual([]);
  });

  it('the wait itself on an everyday spend still names the wait', () => {
    const { v, problems } = named('tr and_v(v:pk(A),older(144)) / everyday / signed by A');
    expect(v.consensus).not.toBe('ok');
    expect(problems[0]).toMatch(/^coin 1: this signature uses a path that opens only after a wait/);
  });

  it('sh(wpkh): a single key with no script of its own, accepted', () => {
    const { v, problems } = named('sh(wpkh(A)) / signed by A');
    expect(v.consensus).toBe('ok');
    expect(problems).toEqual([]);
  });
});
