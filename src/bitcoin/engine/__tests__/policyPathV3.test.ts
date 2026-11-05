/**
 * BDK upgrade (decided 2026-10-15): the policy helpers on the NEW library's
 * own trees (`bdkPolicies.v3.json`, written by bdk-ffi 3.1.1 from the
 * fork's talia-3 line for the same shapes and test keys as 0.28's
 * `bdkPolicies.json`). The same checks policyPath.test.ts makes on 0.28's
 * set, run on 3.x's: its timelock forms (`{"Blocks":n}`, plain absolute
 * numbers), its node ids and its "Not enough" spelling.
 *
 * And the preflight's rule: once normalized, the two libraries' trees are
 * the same policy for every shape.
 */
import { parsePolicy } from '../../descriptor/policy';
import { branchPolicyPath, chosenPathHasRelativeTimelock, normalizePolicyTree, primaryPolicyPath, samePolicyTree } from '../policyPath';
import { bdkCondition, bdkRequiresPath, bdkShapes } from '../../../testing/bdkPolicyMirror';
import type { BdkShape as Shape, Condition } from '../../../testing/bdkPolicyMirror';

const old = bdkShapes();
const shapes = bdkShapes('bdkPolicies.v3.json');

const nSequenceFor = (c: Condition) => c.csv ?? (c.timelock != null ? 0xfffffffe : 0xffffffff);

describe('the two libraries, the same vaults', () => {
  it('the same shapes, in the same order', () => {
    expect(shapes.map(([n]) => n)).toEqual(old.map(([n]) => n));
    expect(shapes.length).toBeGreaterThan(4);
  });

  it.each(shapes)('%s: the same policy once normalized (the preflight\'s rule)', (name, s) => {
    const o = old.find(([n]) => n === name)![1];
    expect(samePolicyTree(o.policyExternal, s.policyExternal)).toBe(true);
    expect(samePolicyTree(o.policyInternal, s.policyInternal)).toBe(true);
    expect(JSON.stringify(normalizePolicyTree(s.policyExternal))).toBe(JSON.stringify(normalizePolicyTree(o.policyExternal)));
    // but not written the same way: 3.x's ids and timelock forms differ
    if (o.bdkRescueBuild) expect(JSON.stringify(s.policyExternal)).not.toBe(JSON.stringify(o.policyExternal));
  });
});

describe('the BDK mirror says what the new library said', () => {
  it.each(shapes.filter(([, s]) => s.bdkRescueBuild))('%s', (_name, s) => {
    for (const run of Object.values(s.bdkRescueBuild!)) {
      if (run.error) {
        const wanted = run.error.replace(/^policy error: /, '');
        expect(() => bdkCondition(s.policyExternal, run.path, 'enough')).toThrow(wanted);
      } else {
        expect(nSequenceFor(bdkCondition(s.policyExternal, run.path, 'enough'))).toBe(run.nSequence);
      }
    }
    const everyday = s.bdkEverydayBuild.path;
    if (everyday) expect(bdkCondition(s.policyExternal, everyday, 'enough')).toEqual({});
  });

  it.each(shapes)('%s asks for a path exactly when the library did', (_name, s) => {
    expect(bdkRequiresPath(s.policyExternal)).toBe(s.bdkEverydayBuild.firstTry !== 'ok');
  });
});

function timelockedKeys(s: Shape): Array<{ fp: string; csv?: number; timelock?: number }> {
  const out: Array<{ fp: string; csv?: number; timelock?: number }> = [];
  for (const p of parsePolicy(s.descriptorExternal).paths) {
    if (p.olderBlocks == null && p.afterHeight == null) continue;
    for (const g of p.groups) {
      for (const k of g.keys) out.push({ fp: k.fingerprint!.toLowerCase(), csv: p.olderBlocks, timelock: p.afterHeight });
    }
  }
  return out;
}

describe('a spend on a recovery path takes that path, on the new library\'s trees', () => {
  const cases = shapes.flatMap(([name, s]) => timelockedKeys(s).map((k) => [name, k.fp, k, s] as const));

  it('covers both wsh recovery keys and the taproot ones', () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  it.each(cases)('%s, key %s', (_name, fp, want, s) => {
    for (const tree of [s.policyExternal, s.policyInternal]) {
      const p = branchPolicyPath(tree, fp);
      expect(p).not.toBeNull();
      const got = bdkCondition(tree, p!, 'enough');
      expect(got.csv).toBe(want.csv);
      expect(got.timelock).toBe(want.timelock);
      // The version the new engine asks for follows the path.
      expect(chosenPathHasRelativeTimelock({ external: tree }, { external: p })).toBe(want.csv != null);
    }
  });

  it('the wsh vault with two recovery paths chooses at the nested node: the very path the library built', () => {
    const s = shapes.find(([n]) => n === 'wsh-layered-older')![1];
    expect(branchPolicyPath(s.policyExternal, 'de1725c5')).toEqual(s.bdkRescueBuild!.fullPath.path);
  });
});

describe('the everyday path on the new library\'s trees', () => {
  it.each(shapes)('%s', (_name, s) => {
    for (const tree of [s.policyExternal, s.policyInternal]) {
      const p = primaryPolicyPath(tree, s.descriptorExternal);
      if (s.bdkEverydayBuild.firstTry !== 'ok') expect(p).toEqual(s.bdkEverydayBuild.path);
      if (p) {
        expect(bdkCondition(tree, p, 'enough')).toEqual({});
        expect(chosenPathHasRelativeTimelock({ external: tree }, { external: p })).toBe(false);
      }
    }
  });
});
