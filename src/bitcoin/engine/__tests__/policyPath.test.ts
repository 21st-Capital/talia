/**
 * Decided 2026-10-07: a rescue (or an heir's spend) on a
 * wsh vault with two or more recovery paths failed in BDK with "Not enough
 * items selected", because Talia chose a branch at the root of the policy
 * tree only. In wsh, `or_d(primary, or_i(heir, rescue))` nests the recovery
 * paths one level down, and BDK wants a choice at that node too. Taproot
 * flattens every leaf onto the root, which is why taproot vaults worked.
 *
 * The trees here are BDK's own (`policies_json` of the shipped fork, test
 * keys), and `bdkCondition` (src/testing/bdkPolicyMirror) mirrors BDK
 * 0.28.2's `Policy::get_condition`, the check that refused the build; the
 * first block holds it to what BDK really did with the same trees.
 */
import { parsePolicy } from '../../descriptor/policy';
import { branchPolicyPath, primaryPolicyPath } from '../policyPath';
import { bdkCondition, bdkRequiresPath, bdkShapes } from '../../../testing/bdkPolicyMirror';
import type { BdkShape as Shape, Condition } from '../../../testing/bdkPolicyMirror';

const shapes = bdkShapes();

/** What BDK puts in nSequence for a condition with RBF off, as it did. */
const nSequenceFor = (c: Condition) => c.csv ?? (c.timelock != null ? 0xfffffffe : 0xffffffff);

describe('the BDK mirror says what BDK said', () => {
  it.each(shapes.filter(([, s]) => s.bdkRescueBuild))('%s', (_name, s) => {
    for (const run of Object.values(s.bdkRescueBuild!)) {
      if (run.error) {
        expect(() => bdkCondition(s.policyExternal, run.path)).toThrow(run.error);
      } else {
        expect(nSequenceFor(bdkCondition(s.policyExternal, run.path))).toBe(run.nSequence);
      }
    }
    // The everyday path never waits: BDK built it RBF-signalled (0xFFFFFFFD).
    const everyday = s.bdkEverydayBuild.path;
    if (everyday) expect(bdkCondition(s.policyExternal, everyday)).toEqual({});
  });

  it.each(shapes)('%s asks for a path exactly when BDK did', (_name, s) => {
    expect(bdkRequiresPath(s.policyExternal)).toBe(s.bdkEverydayBuild.firstTry !== 'ok');
  });
});

/** Every key that signs on a path with a wait, and that wait. */
function timelockedKeys(s: Shape): Array<{ fp: string; csv?: number; timelock?: number }> {
  const out: Array<{ fp: string; csv?: number; timelock?: number }> = [];
  for (const p of parsePolicy(s.descriptorExternal).paths) {
    if (p.olderBlocks == null && p.afterHeight == null) continue;
    for (const g of p.groups) {
      for (const k of g.keys) {
        out.push({ fp: k.fingerprint!.toLowerCase(), csv: p.olderBlocks, timelock: p.afterHeight });
      }
    }
  }
  return out;
}

describe('a spend on a recovery path takes that path, on every vault shape', () => {
  const cases = shapes.flatMap(([name, s]) =>
    timelockedKeys(s).map((k) => [name, k.fp, k, s] as const),
  );

  it('covers both wsh recovery keys and the taproot ones', () => {
    expect(cases.map(([name, fp]) => `${name}/${fp}`)).toEqual(
      expect.arrayContaining([
        'wsh-layered-older/55ac6beb', // the heir, 4 383 blocks
        'wsh-layered-older/de1725c5', // the rescue key, 65 535 blocks
        'wsh-after/b04e5885',
        'tr-nums-layered-older/de1725c5',
        'tr-nums-layered-older/c615b7d8',
        'tr-liana-keypath-older/b04e5885',
      ]),
    );
  });

  it.each(cases)('%s, key %s', (_name, fp, want, s) => {
    for (const tree of [s.policyExternal, s.policyInternal]) {
      const p = branchPolicyPath(tree, fp);
      expect(p).not.toBeNull();
      const got = bdkCondition(tree, p!);
      expect(got.csv).toBe(want.csv);
      expect(got.timelock).toBe(want.timelock);
    }
  });

  it('the wsh vault with two recovery paths chooses at the nested node too', () => {
    const s = shapes.find(([n]) => n === 'wsh-layered-older')![1];
    // The very path BDK built, signed and finalized in the harness.
    expect(branchPolicyPath(s.policyExternal, 'de1725c5')).toEqual(s.bdkRescueBuild!.fullPath.path);
    expect(branchPolicyPath(s.policyExternal, '55ac6beb')).toEqual({ sd3j7nr3: [1], xkhqahzm: [0] });
  });

  it('every path that already worked stays exactly as it was', () => {
    for (const [name, s] of shapes) {
      const run = s.bdkRescueBuild?.rootOnly;
      if (!run || run.error) continue;
      // The harness's rescue key: the one behind the longest wait.
      const keys = timelockedKeys(s);
      const longest = Math.max(...keys.map((k) => k.csv ?? k.timelock ?? 0));
      const rescueFp = keys.find((k) => (k.csv ?? k.timelock) === longest)!.fp;
      expect([name, branchPolicyPath(s.policyExternal, rescueFp)]).toEqual([name, run.path]);
    }
  });

  it('a key on no branch has no path', () => {
    const s = shapes.find(([n]) => n === 'wsh-layered-older')![1];
    expect(branchPolicyPath(s.policyExternal, '00000000')).toBeNull();
    expect(branchPolicyPath(null, 'de1725c5')).toBeNull();
  });
});

describe('the everyday path is unchanged', () => {
  it.each(shapes)('%s', (_name, s) => {
    for (const tree of [s.policyExternal, s.policyInternal]) {
      const p = primaryPolicyPath(tree, s.descriptorExternal);
      // The engine asks for a path only when BDK refused to choose.
      if (s.bdkEverydayBuild.firstTry !== 'ok') expect(p).toEqual(s.bdkEverydayBuild.path);
      if (p) expect(bdkCondition(tree, p)).toEqual({});
    }
  });
});
