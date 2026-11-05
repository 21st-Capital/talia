/**
 * Test helper: BDK's own spending-policy trees for every vault shape (the
 * shipped bdk-ffi fork, test keys; `bitcoin/engine/__fixtures__`), and a
 * mirror of the check BDK 0.28.2 runs on a policy path before it builds,
 * `Policy::get_condition` and `requires_path` in
 * vendor/bdk/src/descriptor/policy.rs, error strings included.
 *
 * The mirror is held to what BDK really did with these trees
 * (`policyPath.test.ts`) before any other test leans on it.
 *
 * It reads bdk_wallet 3.x's trees too (BDK upgrade, decided 2026-10-15):
 * a RELATIVETIMELOCK `{"Blocks":n}` or `{"Time":u}`, an ABSOLUTETIMELOCK as
 * a plain number. 0.28 spelled its refusal "Not enought items selected",
 * 3.x "Not enough": the mirror throws 0.28's words unless told otherwise,
 * so the 0.28 tests read exactly as they did, and `bdkErrorPattern` matches
 * a recorded refusal in either spelling.
 */
import * as fs from 'fs';
import * as path from 'path';
import { absoluteTimelockValue, relativeTimelockValue } from '../bitcoin/engine/policyPath';
import type { PolicyNode, PolicyPath } from '../bitcoin/engine/policyPath';

export interface BdkShape {
  descriptorExternal: string;
  descriptorInternal: string;
  fingerprints: string[];
  policyExternal: PolicyNode;
  policyInternal: PolicyNode;
  bdkEverydayBuild: { firstTry: string; path: PolicyPath | null; nSequence: number };
  bdkRescueBuild?: Record<
    'rootOnly' | 'fullPath',
    { path: PolicyPath; error?: string; nSequence?: number; finalized?: boolean }
  >;
}

/** Every shape of a fixture set: 0.28's `bdkPolicies.json` unless named
 *  (the new library's set is `bdkPolicies.v3.json`). */
export function bdkShapes(file = 'bdkPolicies.json'): Array<[string, BdkShape]> {
  const all = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../bitcoin/engine/__fixtures__', file), 'utf8'),
  ) as Record<string, BdkShape | string>;
  return Object.entries(all).filter((e): e is [string, BdkShape] => typeof e[1] === 'object');
}

export type Condition = { csv?: number; timelock?: number };

const isNull = (c: Condition) => c.csv == null && c.timelock == null;

/** How the library spelled "not enough": 0.28's typo, or 3.x's word. */
export type BdkSpelling = 'enought' | 'enough';

/** A refusal BDK recorded, as a pattern that matches it in either spelling. */
export function bdkErrorPattern(recorded: string): RegExp {
  const escaped = recorded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/Not enought? items selected/, 'Not enought? items selected'));
}

export function bdkCondition(node: PolicyNode, p: PolicyPath, spelling: BdkSpelling = 'enought'): Condition {
  const items = node.items ?? [];
  const threshold = node.threshold ?? 0;
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  const fallback =
    node.type === 'THRESH' && items.length === threshold
      ? range(threshold)
      : node.type === 'MULTISIG'
        ? range((node.keys as unknown[]).length)
        : [];
  const selected = new Set(p[node.id ?? ''] ?? fallback);
  switch (node.type) {
    case 'THRESH': {
      const mapped = items.map((i) => {
        try {
          return { ok: bdkCondition(i, p, spelling) };
        } catch (e) {
          return { err: e as Error };
        }
      });
      // "if all the requirements are null we don't care about `selected`"
      if (mapped.every((m) => m.ok && isNull(m.ok))) return {};
      for (const i of selected) if (i >= items.length) throw new Error(`Index out of range: ${i}`);
      if (selected.size < threshold) throw new Error(`Not ${spelling} items selected: ${node.id}`);
      return mapped
        .filter((_, i) => selected.has(i))
        .reduce<Condition>((acc, m) => {
          if (m.err) throw m.err;
          return mergeConditions(acc, m.ok as Condition);
        }, {});
    }
    case 'MULTISIG': {
      if (selected.size < threshold) throw new Error(`Not ${spelling} items selected: ${node.id}`);
      const keys = (node.keys as unknown[]).length;
      for (const i of selected) if (i >= keys) throw new Error(`Index out of range: ${i}`);
      return {};
    }
    case 'ABSOLUTETIMELOCK':
      // 0.28 serializes an absolute lock as {"Blocks": n} (or {"Seconds": n}),
      // 3.x as the plain number.
      return { timelock: absoluteTimelockValue(node.value) ?? undefined };
    case 'RELATIVETIMELOCK':
      // 0.28: the nSequence number; 3.x: {"Blocks": n} or {"Time": u}.
      return { csv: relativeTimelockValue(node.value) ?? undefined };
    default:
      return {};
  }
}

// rust-bitcoin 0.29, written out here rather than imported, so the mirror
// does not share the code it checks: `Sequence::is_time_locked` (the
// disable flag, bit 31, clear and the type flag, bit 22, set) and
// `LockTime::is_same_unit` (a height below 500 000 000, else a time).
const SEQUENCE_DISABLE_FLAG = 0x80000000;
const SEQUENCE_TYPE_FLAG = 0x00400000;
const LOCK_TIME_THRESHOLD = 500_000_000;
const sequenceIsTime = (n: number) => n < SEQUENCE_DISABLE_FLAG && Math.floor(n / SEQUENCE_TYPE_FLAG) % 2 === 1;
const lockTimeIsTime = (n: number) => n >= LOCK_TIME_THRESHOLD;

/** BDK's `Condition::merge`: the larger wait of each kind, refusing two
 *  waits of one kind in different units ("Mixed timelock units"). */
export function mergeConditions(a: Condition, b: Condition): Condition {
  if (a.csv != null && b.csv != null && sequenceIsTime(a.csv) !== sequenceIsTime(b.csv)) {
    throw new Error('Mixed timelock units');
  }
  if (a.timelock != null && b.timelock != null && lockTimeIsTime(a.timelock) !== lockTimeIsTime(b.timelock)) {
    throw new Error('Mixed timelock units');
  }
  const max = (x?: number, y?: number) => (x == null ? y : y == null ? x : Math.max(x, y));
  return { csv: max(a.csv, b.csv), timelock: max(a.timelock, b.timelock) };
}

/** BDK's `Policy::requires_path`: no path given, and the tree cannot choose. */
export function bdkRequiresPath(root: PolicyNode, spelling: BdkSpelling = 'enought'): boolean {
  try {
    bdkCondition(root, {}, spelling);
    return false;
  } catch {
    return true;
  }
}
