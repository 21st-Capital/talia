/**
 * The tapleaf runner behind the fallback's witness check (leaf hazard,
 * decided 2026-10-17). Its verdicts on real witnesses are held to libbitcoinconsensus
 * in fallbackConsensus.test.ts; these pin the edges that suite cannot reach.
 */
import * as btc from '@scure/btc-signer';
import { runTapscript } from '../tapscriptRun';
import type { TxLocks } from '../../txLocks';

const K = (n: number) => new Uint8Array(32).fill(n);
const SIG = (n: number) => new Uint8Array(64).fill(n);
const everyday: TxLocks = { version: 1, lockTime: 70000, sequences: [0xfffffffd] };
const recovery: TxLocks = { version: 2, lockTime: 70000, sequences: [144] };
const known = (pairs: Array<[number, number]>) => (x: Uint8Array) => {
  const hit = pairs.find(([k]) => x.every((b) => b === k));
  return hit ? SIG(hit[1]) : undefined;
};
const S = (ops: Parameters<typeof btc.Script.encode>[0]) => btc.Script.encode(ops);

describe('runTapscript', () => {
  const multiA = S([K(1), 'CHECKSIG', K(2), 'CHECKSIGADD', K(3), 'CHECKSIGADD', 2, 'NUMEQUALVERIFY', 144, 'CHECKSEQUENCEVERIFY']);

  it('a 2-of-3 with the third key\'s empty place passes on a transaction that carries the wait', () => {
    const items = [new Uint8Array(), SIG(2), SIG(1)]; // bottom first: C empty, B, A on top
    expect(runTapscript(multiA, items, recovery, 0, known([[1, 1], [2, 2]]))).toEqual({ ok: true });
  });

  it('...and names the wait on an everyday spend', () => {
    const items = [new Uint8Array(), SIG(2), SIG(1)];
    expect(runTapscript(multiA, items, everyday, 0, known([[1, 1], [2, 2]]))).toEqual({ ok: false, why: 'lock', lock: 'older' });
  });

  it('a signature that is not the PSBT\'s own for that key is a witness the network refuses', () => {
    const items = [new Uint8Array(), SIG(1), SIG(2)]; // A's and B's swapped
    expect(runTapscript(multiA, items, recovery, 0, known([[1, 1], [2, 2]]))).toEqual({ ok: false, why: 'witness' });
  });

  it('MINIMALIF: an IF argument other than empty or 0x01 fails', () => {
    const leaf = S(['IF', K(1), 'CHECKSIG', 'ELSE', K(2), 'CHECKSIG', 'ENDIF']);
    expect(runTapscript(leaf, [SIG(1), Uint8Array.of(1)], recovery, 0, known([[1, 1]]))).toEqual({ ok: true });
    expect(runTapscript(leaf, [SIG(1), Uint8Array.of(2)], recovery, 0, known([[1, 1]]))).toEqual({ ok: false, why: 'witness' });
  });

  it('more than one item left over fails (BIP-342 clean stack)', () => {
    const leaf = S([K(1), 'CHECKSIG']);
    expect(runTapscript(leaf, [SIG(9), SIG(1)], recovery, 0, known([[1, 1]]))).toEqual({ ok: false, why: 'witness' });
  });

  it('what it does not cover is unchecked, never passed: a hash lock, even in a branch not taken', () => {
    const hashlock = S(['SIZE', 32, 'EQUALVERIFY', 'SHA256', new Uint8Array(32), 'EQUALVERIFY', K(1), 'CHECKSIG']);
    expect(runTapscript(hashlock, [SIG(1), new Uint8Array(32)], recovery, 0, known([[1, 1]]))).toEqual({ ok: false, why: 'unchecked' });
    const branch = S([K(1), 'CHECKSIG', 'NOTIF', 'SHA256', 'DROP', 'ENDIF', 1]);
    expect(runTapscript(branch, [SIG(1)], recovery, 0, known([[1, 1]]))).toEqual({ ok: false, why: 'unchecked' });
  });

  it('an unreadable script is unchecked', () => {
    expect(runTapscript(Uint8Array.of(0x4c), [], recovery, 0, () => undefined)).toEqual({ ok: false, why: 'unchecked' });
  });

  it('after(): nLockTime of the same kind, at least the height, and a non-final nSequence', () => {
    const leaf = S([K(1), 'CHECKSIGVERIFY', 60000, 'CHECKLOCKTIMEVERIFY']);
    const sig = known([[1, 1]]);
    expect(runTapscript(leaf, [SIG(1)], { version: 2, lockTime: 70000, sequences: [0xfffffffe] }, 0, sig)).toEqual({ ok: true });
    expect(runTapscript(leaf, [SIG(1)], { version: 2, lockTime: 59999, sequences: [0xfffffffe] }, 0, sig)).toEqual({ ok: false, why: 'lock', lock: 'after' });
    expect(runTapscript(leaf, [SIG(1)], { version: 2, lockTime: 70000, sequences: [0xffffffff] }, 0, sig)).toEqual({ ok: false, why: 'lock', lock: 'after' });
  });
});
