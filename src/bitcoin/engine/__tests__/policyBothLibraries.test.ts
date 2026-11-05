/**
 * BDK upgrade (decided 2026-10-15): the policy helpers read the
 * trees of both libraries.
 *
 * bdk_wallet 3.x writes the same tree as 0.28 with three differences: a
 * RELATIVETIMELOCK's value is `{"Blocks":n}` or `{"Time":u}`, an
 * ABSOLUTETIMELOCK's a plain number, and the ids of timelock nodes (and of
 * every node above one) change. The new library's own fixture set
 * (`bdkPolicies.v3.json`) arrives with its bridge; until
 * then the 3.x form is made here from 0.28's real trees by exactly those
 * three differences (`as3x`), so every check below runs on both forms.
 *
 * 0.28's own tests (`policyPath.test.ts`) are untouched.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  absoluteTimelockValue,
  branchPolicyPath,
  chosenPathHasRelativeTimelock,
  normalizePolicyTree,
  pathCondition,
  primaryPolicyPath,
  relativeTimelockValue,
  samePolicyTree,
} from '../policyPath';
import type { PolicyNode, PolicyPath } from '../policyPath';
import { parsePolicy } from '../../descriptor/policy';
import { bdkCondition, bdkErrorPattern, bdkRequiresPath, bdkShapes, mergeConditions } from '../../../testing/bdkPolicyMirror';
import type { BdkShape } from '../../../testing/bdkPolicyMirror';

const shapes = bdkShapes();

/** 0.28's tree written the 3.x way; `renameIds` gives every node a new id. */
function as3x(node: unknown, renameIds: boolean, counter = { n: 0 }): unknown {
  if (Array.isArray(node)) return node.map((n) => as3x(n, renameIds, counter));
  if (!node || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // Keys in another order too: the comparison must not care.
  for (const k of Object.keys(o).reverse()) {
    const v = o[k];
    if (k === 'id') out.id = renameIds ? `new${(counter.n += 1)}` : v;
    else if (k === 'value' && o.type === 'RELATIVETIMELOCK') out.value = { Blocks: v };
    else if (k === 'value' && o.type === 'ABSOLUTETIMELOCK') out.value = absoluteTimelockValue(v);
    else if (k === 'condition') out.condition = cond3x(v);
    else if (k === 'conditions') {
      const map: Record<string, unknown> = {};
      for (const [at, list] of Object.entries(v as Record<string, unknown[]>)) map[at] = [...list].reverse().map(cond3x);
      out.conditions = map;
    } else out[k] = as3x(v, renameIds, counter);
  }
  return out;
}

function cond3x(c: unknown): unknown {
  const o = { ...(c as Record<string, unknown>) };
  if (o.csv != null) o.csv = { Blocks: o.csv };
  if (o.timelock != null) o.timelock = absoluteTimelockValue(o.timelock);
  return o;
}

/** Every key behind a wait, the wait, and the path a spend by it takes. */
function timelockedKeys(s: BdkShape): Array<{ fp: string; csv?: number; timelock?: number }> {
  return parsePolicy(s.descriptorExternal)
    .paths.filter((p) => p.olderBlocks != null || p.afterHeight != null)
    .flatMap((p) =>
      p.groups.flatMap((g) => g.keys.map((k) => ({ fp: k.fingerprint!.toLowerCase(), csv: p.olderBlocks, timelock: p.afterHeight }))),
    );
}

/** Every path the fixtures and the engine use on a shape. */
function pathsOf(s: BdkShape): PolicyPath[] {
  const out: PolicyPath[] = [{}];
  if (s.bdkEverydayBuild.path) out.push(s.bdkEverydayBuild.path);
  for (const run of Object.values(s.bdkRescueBuild ?? {})) out.push(run.path);
  for (const k of timelockedKeys(s)) {
    const p = branchPolicyPath(s.policyExternal, k.fp);
    if (p) out.push(p);
  }
  return out;
}

describe('timelock values in either form', () => {
  it('relative: the number 0.28 wrote, or 3.x Blocks and Time', () => {
    expect(relativeTimelockValue(4383)).toBe(4383);
    expect(relativeTimelockValue({ Blocks: 4383 })).toBe(4383);
    // 512-second units carry BIP-68's type flag, as in 0.28's nSequence form.
    expect(relativeTimelockValue({ Time: 3 })).toBe(0x400003);
    expect(relativeTimelockValue({ Height: 1 })).toBeNull();
    expect(relativeTimelockValue('4383')).toBeNull();
  });

  it('absolute: 0.28 Blocks and Seconds, or the plain 3.x number', () => {
    expect(absoluteTimelockValue({ Blocks: 60000 })).toBe(60000);
    expect(absoluteTimelockValue({ Seconds: 1_700_000_000 })).toBe(1_700_000_000);
    expect(absoluteTimelockValue(60000)).toBe(60000);
    expect(absoluteTimelockValue(null)).toBeNull();
  });
});

describe("the BDK mirror reads 3.x's trees and words", () => {
  it.each(shapes)('%s: the same condition on every path, in either form', (_name, s) => {
    for (const tree of [s.policyExternal, s.policyInternal]) {
      const v3 = as3x(tree, false) as PolicyNode;
      for (const p of pathsOf(s)) {
        let old: unknown;
        try {
          old = bdkCondition(tree, p);
        } catch (e) {
          old = (e as Error).message;
        }
        let now: unknown;
        try {
          now = bdkCondition(v3, p);
        } catch (e) {
          now = (e as Error).message;
        }
        expect(now).toEqual(old);
      }
      expect(bdkRequiresPath(v3, 'enough')).toBe(bdkRequiresPath(tree));
    }
  });

  it('refuses in either spelling, and a recorded refusal matches both', () => {
    const s = shapes.find(([n]) => n === 'wsh-layered-older')![1];
    const run = s.bdkRescueBuild!.rootOnly;
    expect(run.error).toBe('Not enought items selected: xkhqahzm');
    expect(() => bdkCondition(s.policyExternal, run.path)).toThrow(run.error!);
    expect(() => bdkCondition(s.policyExternal, run.path, 'enough')).toThrow('Not enough items selected: xkhqahzm');
    const either = bdkErrorPattern(run.error!);
    expect(either.test('Not enough items selected: xkhqahzm')).toBe(true);
    expect(either.test('Not enought items selected: xkhqahzm')).toBe(true);
    expect(either.test('Not enough items selected: other')).toBe(false);
  });
});

/** Every MULTISIG node of a tree. */
function multisigs(node: PolicyNode, out: PolicyNode[] = []): PolicyNode[] {
  if (node.type === 'MULTISIG') out.push(node);
  for (const item of node.items ?? []) multisigs(item, out);
  return out;
}

/** Each path again with one MULTISIG given a key index it does not have. */
function withKeyPastTheEnd(tree: PolicyNode, paths: PolicyPath[]): PolicyPath[] {
  return multisigs(tree).flatMap((m) =>
    paths.map((p) => ({ ...p, [m.id!]: [0, (m.keys as unknown[]).length] })),
  );
}

describe('pathCondition is BDK\'s get_condition, read without throwing', () => {
  it.each(shapes)('%s', (_name, s) => {
    for (const tree of [s.policyExternal, s.policyInternal, as3x(s.policyExternal, false) as PolicyNode]) {
      for (const p of [...pathsOf(s), ...withKeyPastTheEnd(tree, pathsOf(s))]) {
        let want: unknown;
        try {
          const c = bdkCondition(tree, p);
          want = Object.fromEntries(Object.entries(c).filter(([, v]) => v != null));
        } catch {
          want = null;
        }
        expect(pathCondition(tree, p)).toEqual(want);
      }
    }
  });
});

describe('the paths BDK refuses: a key index past the end, waits in two units', () => {
  const wait = (id: string, type: 'RELATIVETIMELOCK' | 'ABSOLUTETIMELOCK', value: unknown): PolicyNode => ({
    id,
    type,
    value,
  });
  const both = (id: string, a: PolicyNode, b: PolicyNode): PolicyNode => ({ id, type: 'THRESH', threshold: 2, items: [a, b] });
  const refused = (tree: PolicyNode, p: PolicyPath, words: string) => {
    expect(() => bdkCondition(tree, p)).toThrow(words);
    expect(pathCondition(tree, p)).toBeNull();
  };

  it('a MULTISIG asked for a key it does not have (IndexOutOfRange)', () => {
    const plain = shapes.find(([n]) => n === 'wsh-sortedmulti-2of3')![1].policyExternal;
    expect(plain.type).toBe('MULTISIG');
    refused(plain, { [plain.id!]: [0, 3] }, 'Index out of range: 3');
    // Too few keys is refused first, as BDK checks it first.
    refused(plain, { [plain.id!]: [7] }, 'Not enought items selected');
    expect(pathCondition(plain, { [plain.id!]: [0, 2] })).toEqual({});
  });

  it('the rescue branch with its MULTISIG asked for a key past the end is not a CSV path', () => {
    const s = shapes.find(([n]) => n === 'tr-nums-layered-older')![1];
    const run = s.bdkRescueBuild!.fullPath;
    const both2 = { external: s.policyExternal, internal: s.policyInternal };
    expect(chosenPathHasRelativeTimelock(both2, { external: run.path, internal: run.path })).toBe(true);
    const rescue = s.policyExternal.items![3];
    const ms = rescue.items!.find((i) => i.type === 'MULTISIG')!;
    const bad = { ...run.path, [ms.id!]: [0, 3] };
    refused(s.policyExternal, bad, 'Index out of range: 3');
    expect(chosenPathHasRelativeTimelock(both2, { external: bad, internal: run.path })).toBe(false);
  });

  it('a block wait beside a time wait (MixedTimelockUnits), in either form', () => {
    // 0.28's nSequence form: 10 blocks, and one 512-second unit (bit 22).
    refused(both('r', wait('a', 'RELATIVETIMELOCK', 10), wait('b', 'RELATIVETIMELOCK', 0x400001)), { r: [0, 1] }, 'Mixed timelock units');
    // 3.x's form of the same two.
    refused(
      both('r', wait('a', 'RELATIVETIMELOCK', { Blocks: 10 }), wait('b', 'RELATIVETIMELOCK', { Time: 1 })),
      { r: [0, 1] },
      'Mixed timelock units',
    );
    // A height beside a date: 0.28's tagged form and 3.x's plain numbers.
    refused(
      both('r', wait('a', 'ABSOLUTETIMELOCK', { Blocks: 60000 }), wait('b', 'ABSOLUTETIMELOCK', { Seconds: 1_700_000_000 })),
      { r: [0, 1] },
      'Mixed timelock units',
    );
    refused(both('r', wait('a', 'ABSOLUTETIMELOCK', 499_999_999), wait('b', 'ABSOLUTETIMELOCK', 500_000_000)), { r: [0, 1] }, 'Mixed timelock units');
  });

  it('two waits in one unit merge to the larger, as BDK merges them', () => {
    const blocks = both('r', wait('a', 'RELATIVETIMELOCK', 10), wait('b', 'RELATIVETIMELOCK', { Blocks: 4383 }));
    expect(pathCondition(blocks, { r: [0, 1] })).toEqual({ csv: 4383 });
    expect(bdkCondition(blocks, { r: [0, 1] })).toEqual({ csv: 4383, timelock: undefined });
    const time = both('r', wait('a', 'RELATIVETIMELOCK', 0x400002), wait('b', 'RELATIVETIMELOCK', { Time: 5 }));
    expect(pathCondition(time, { r: [0, 1] })).toEqual({ csv: 0x400005 });
    // The disable flag (bit 31) makes a sequence no lock at all, whatever bit 22 says.
    const disabled = both('r', wait('a', 'RELATIVETIMELOCK', 10), wait('b', 'RELATIVETIMELOCK', 0x80400000));
    expect(pathCondition(disabled, { r: [0, 1] })).toEqual({ csv: 0x80400000 });
    expect(bdkCondition(disabled, { r: [0, 1] }).csv).toBe(0x80400000);
    // A relative and an absolute wait never mix: each is its own kind.
    const kinds = both('r', wait('a', 'RELATIVETIMELOCK', 0x400001), wait('b', 'ABSOLUTETIMELOCK', 60000));
    expect(pathCondition(kinds, { r: [0, 1] })).toEqual({ csv: 0x400001, timelock: 60000 });
  });

  it('two keychains whose waits count different units answer false, as create_tx refuses them', () => {
    const external = both('e', wait('a', 'RELATIVETIMELOCK', 10), wait('b', 'RELATIVETIMELOCK', 20));
    const internalTime = both('i', wait('c', 'RELATIVETIMELOCK', { Time: 3 }), wait('d', 'RELATIVETIMELOCK', { Time: 4 }));
    const internalBlocks = both('i', wait('c', 'RELATIVETIMELOCK', 30), wait('d', 'RELATIVETIMELOCK', 40));
    expect(chosenPathHasRelativeTimelock({ external, internal: internalBlocks }, {})).toBe(true);
    expect(chosenPathHasRelativeTimelock({ external, internal: internalTime }, {})).toBe(false);
    expect(() => mergeConditions(bdkCondition(external, {}), bdkCondition(internalTime, {}))).toThrow('Mixed timelock units');
  });
});

describe('chosenPathHasRelativeTimelock: the version 0.28 chose', () => {
  const both = (s: BdkShape, renamed = false) => ({
    external: (renamed ? as3x(s.policyExternal, false) : s.policyExternal) as PolicyNode,
    internal: (renamed ? as3x(s.policyInternal, false) : s.policyInternal) as PolicyNode,
  });

  it.each(shapes)('%s: the everyday path waits for nothing', (_name, s) => {
    const p = primaryPolicyPath(s.policyExternal, s.descriptorExternal);
    for (const form of [false, true]) {
      expect(chosenPathHasRelativeTimelock(both(s, form), { external: p, internal: p })).toBe(false);
    }
  });

  it.each(shapes.filter(([, s]) => s.bdkRescueBuild))('%s: a rescue build has a CSV exactly when 0.28 wrote one in nSequence', (_name, s) => {
    for (const run of Object.values(s.bdkRescueBuild!)) {
      if (run.error) continue;
      const csvInSequence = run.nSequence! < 0xfffffffe;
      for (const form of [false, true]) {
        expect(chosenPathHasRelativeTimelock(both(s, form), { external: run.path, internal: run.path })).toBe(csvInSequence);
      }
    }
  });

  it("the real transactions 0.28 built: version 2 exactly on a path with an older()", () => {
    const spends = (
      JSON.parse(fs.readFileSync(path.join(__dirname, '../__fixtures__/bdkTimelockedSpends.json'), 'utf8')) as {
        spends: Array<{ shape: string; spend: 'heir' | 'rescue'; hex: string }>;
      }
    ).spends;
    let checked = 0;
    for (const sp of spends) {
      const s = shapes.find(([n]) => n === sp.shape)?.[1];
      if (!s) continue; // a shape the policy fixtures do not hold
      // The harness's rescue key is the one behind the longest wait; the heir's the other.
      const keys = timelockedKeys(s);
      const longest = Math.max(...keys.map((k) => k.csv ?? k.timelock ?? 0));
      const key = keys.find((k) => ((k.csv ?? k.timelock) === longest) === (sp.spend === 'rescue'))!;
      const paths = {
        external: branchPolicyPath(s.policyExternal, key.fp),
        internal: branchPolicyPath(s.policyInternal, key.fp),
      };
      const version = parseInt(sp.hex.slice(0, 2), 16);
      expect([sp.shape, sp.spend, chosenPathHasRelativeTimelock(both(s), paths)]).toEqual([sp.shape, sp.spend, version === 2]);
      checked += 1;
    }
    expect(checked).toBe(12);
  });

  it('a path BDK refuses, or no tree at all, is not a CSV path', () => {
    const s = shapes.find(([n]) => n === 'wsh-layered-older')![1];
    const run = s.bdkRescueBuild!.rootOnly;
    expect(chosenPathHasRelativeTimelock(both(s), { external: run.path, internal: run.path })).toBe(false);
    expect(chosenPathHasRelativeTimelock({ external: null }, {})).toBe(false);
  });
});

describe('normalizePolicyTree: one form for both libraries', () => {
  const ids = (n: unknown): string[] =>
    Array.isArray(n)
      ? n.flatMap(ids)
      : n && typeof n === 'object'
        ? Object.entries(n).flatMap(([k, v]) => (k === 'id' ? [String(v)] : ids(v)))
        : [];

  it.each(shapes)('%s: 3.x encoding, new ids, shuffled conditions: the same tree', (_name, s) => {
    for (const tree of [s.policyExternal, s.policyInternal]) {
      const v3 = as3x(tree, true);
      expect(ids(v3)).not.toEqual(ids(tree));
      expect(normalizePolicyTree(v3)).toEqual(normalizePolicyTree(tree));
      expect(samePolicyTree(v3, tree)).toBe(true);
      // Stable: normalizing twice changes nothing; no id is left.
      expect(normalizePolicyTree(normalizePolicyTree(tree))).toEqual(normalizePolicyTree(tree));
      expect(ids(normalizePolicyTree(tree))).toEqual([]);
    }
  });

  it("keeps 0.28's own encoding as it is", () => {
    const s = shapes.find(([n]) => n === 'wsh-after')![1];
    const text = JSON.stringify(normalizePolicyTree(s.policyExternal));
    expect(text).toContain('"type":"ABSOLUTETIMELOCK","value":{"Blocks":60000}');
    expect(text).toContain('"condition":{"timelock":{"Blocks":60000}}');
    const layered = JSON.stringify(normalizePolicyTree(shapes.find(([n]) => n === 'wsh-layered-older')![1].policyExternal));
    expect(layered).toContain('"type":"RELATIVETIMELOCK","value":4383');
    expect(layered).toContain('"condition":{"csv":4383}');
  });

  it('tells different policies apart', () => {
    // Every shape is its own policy.
    for (const [a, sa] of shapes) {
      for (const [b, sb] of shapes) {
        if (a !== b) expect([a, b, samePolicyTree(sa.policyExternal, sb.policyExternal)]).toEqual([a, b, false]);
      }
    }
    // A wait one block longer, or another key, is another policy.
    const tree = shapes.find(([n]) => n === 'wsh-layered-older')![1].policyExternal;
    const longer = JSON.parse(JSON.stringify(tree).replace('"value":4383', '"value":4384'));
    expect(samePolicyTree(longer, tree)).toBe(false);
    const otherKey = JSON.parse(JSON.stringify(tree).replace('55ac6beb', '55ac6bec'));
    expect(samePolicyTree(otherKey, tree)).toBe(false);
  });

  it('the paths the engine chooses are the same on the 3.x form, by tree position', () => {
    for (const [, s] of shapes) {
      const v3 = as3x(s.policyExternal, false) as PolicyNode;
      expect(primaryPolicyPath(v3, s.descriptorExternal)).toEqual(primaryPolicyPath(s.policyExternal, s.descriptorExternal));
      for (const k of timelockedKeys(s)) expect(branchPolicyPath(v3, k.fp)).toEqual(branchPolicyPath(s.policyExternal, k.fp));
    }
  });
});
