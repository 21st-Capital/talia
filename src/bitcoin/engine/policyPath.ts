/**
 * Which spending branch a build takes, in the form BDK wants it: the
 * `policy_path` of our bdk-ffi fork, `{policyNodeId: [childIndex, …]}`,
 * read off BDK's own policy tree (`Wallet.policies_json`).
 *
 * BDK refuses to choose between the branches of a multi-path descriptor on
 * its own (SpendingPolicyRequired), and it checks the choice node by node:
 * every THRESH on the way down whose children carry a timelock needs its
 * own entry, or the build fails with "Not enough items selected: <id>".
 *
 * Pure (no native import), so it is tested in Node against the real trees
 * BDK produced for every vault shape (`__fixtures__/bdkPolicies.json`).
 */
import { parsePolicy } from '../descriptor/policy';

/** Shape of BDK's serialized spending policy (we only rely on this subset). */
export interface PolicyNode {
  id?: string;
  type?: string;
  items?: PolicyNode[];
  threshold?: number;
  [key: string]: unknown;
}

export type PolicyPath = Record<string, number[]>;

/** Does any node in this policy subtree carry a timelock? */
function subtreeHasTimelock(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(subtreeHasTimelock);
  if (!node || typeof node !== 'object') return false;
  const o = node as PolicyNode;
  if (typeof o.type === 'string' && o.type.toUpperCase().includes('TIMELOCK')) return true;
  return Object.values(o).some(subtreeHasTimelock);
}

/** Every `fingerprint` value in this policy subtree, lowercased. */
function subtreeFingerprints(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const n of node) subtreeFingerprints(n, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'fingerprint' && typeof v === 'string') out.add(v.toLowerCase());
    else subtreeFingerprints(v, out);
  }
  return out;
}

/**
 * Which child of the policy root is the PRIMARY spending branch.
 *
 * `{root: [0]}` was right for wsh(or_d(primary,…)), but a taproot root lists
 * the (unspendable) internal key first, so index 0 would select a branch
 * nobody can sign. Pick the first timelock-free child that contains ALL of
 * the descriptor's primary-path fingerprints; fall back to timelock-free,
 * then to 0. Returns null when the root has no alternatives to choose from.
 */
function primaryBranchIndex(root: PolicyNode, descriptor: string): number | null {
  const items = root.items;
  if (!Array.isArray(items) || items.length < 2) return null;

  let primaryFps = new Set<string>();
  try {
    const policy = parsePolicy(descriptor);
    const primary =
      policy.paths.find((p) => p.olderBlocks === undefined && p.afterHeight === undefined) ??
      policy.paths[0];
    for (const g of primary?.groups ?? []) {
      for (const k of g.keys) {
        if (k.fingerprint) primaryFps.add(k.fingerprint.toLowerCase());
      }
    }
  } catch {
    primaryFps = new Set();
  }

  const unlocked = items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => !subtreeHasTimelock(item));
  if (unlocked.length === 0) return 0;
  if (primaryFps.size > 0) {
    for (const { item, i } of unlocked) {
      const fps = subtreeFingerprints(item);
      if ([...primaryFps].every((fp) => fps.has(fp))) return i;
    }
  }
  return unlocked[0].i;
}

/**
 * The children of one node a spend by `fp` takes: as many as the node
 * needs, the TIMELOCKED branch holding the key first (e.g. the rescue
 * leaf), then any branch holding it, then a branch with a wait (a bare
 * `older` beside the key in a `thresh`), then the rest, in tree order.
 */
function chooseChildren(items: PolicyNode[], needed: number, fp: string): number[] {
  const rank = (item: PolicyNode): number => {
    const holds = subtreeFingerprints(item).has(fp);
    const waits = subtreeHasTimelock(item);
    return holds && waits ? 0 : holds ? 1 : waits ? 2 : 3;
  };
  return items
    .map((item, i) => ({ i, r: rank(item) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, Math.min(Math.max(needed, 1), items.length))
    .map((x) => x.i)
    .sort((a, b) => a - b);
}

/**
 * Below the root, BDK asks for a choice only at a THRESH that spends fewer
 * children than it has and has a wait somewhere under it. wsh nests its
 * recovery paths (`or_d(primary, or_i(heir, rescue))`), so the second
 * choice lives one level down; taproot puts every leaf on the root.
 */
function chooseBelow(node: PolicyNode, fp: string, out: PolicyPath): void {
  const items = node.items;
  if (node.type !== 'THRESH' || !Array.isArray(items)) return;
  const needed = typeof node.threshold === 'number' ? node.threshold : items.length;
  if (needed >= items.length || !items.some(subtreeHasTimelock)) {
    for (const item of items) chooseBelow(item, fp, out);
    return;
  }
  const chosen = chooseChildren(items, needed, fp);
  if (node.id) out[node.id] = chosen;
  for (const i of chosen) chooseBelow(items[i], fp, out);
}

/** The everyday spend's path: the root's primary branch. Null when the
 *  tree offers no choice (BDK then needs no path). */
export function primaryPolicyPath(root: PolicyNode | null, descriptor: string): PolicyPath | null {
  const index = root ? primaryBranchIndex(root, descriptor) : null;
  return root?.id && index != null ? { [root.id]: [index] } : null;
}

/**
 * The path of the timelocked branch holding `fp` (a rescue or an heir's
 * key), with a choice at the root and at every node below it that asks for
 * one (decided 2026-10-07: a root-only path failed every rescue on
 * a wsh vault with two recovery paths). Null when no branch holds that key.
 */
export function branchPolicyPath(root: PolicyNode | null, fp: string): PolicyPath | null {
  const items = root?.items;
  if (!root?.id || !Array.isArray(items) || items.length < 2) return null;
  const want = fp.toLowerCase();
  if (!items.some((item) => subtreeFingerprints(item).has(want))) return null;
  const chosen = chooseChildren(items, typeof root.threshold === 'number' ? root.threshold : 1, want);
  const out: PolicyPath = { [root.id]: chosen };
  for (const i of chosen) chooseBelow(items[i], want, out);
  return out;
}

// ------------------------------------------------ both libraries' trees
//
// BDK upgrade (decided 2026-10-15). bdk_wallet 3.x writes
// the same policy tree with three differences: a RELATIVETIMELOCK's `value`
// is `{"Blocks":n}` or `{"Time":u}` (0.28: the nSequence number), an
// ABSOLUTETIMELOCK's is a plain number (0.28: `{"Blocks":n}` or
// `{"Seconds":n}`), and every timelock node's id, and each id above it,
// changes. The functions below read either form.

/** A relative timelock in 0.28's form, the number nSequence carries: a
 *  3.x `{"Time":u}` counts 512-second units, which BIP-68 marks with bit 22. */
export function relativeTimelockValue(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as { Blocks?: unknown; Time?: unknown };
    if (typeof o.Blocks === 'number') return o.Blocks;
    // BIP-68's type flag (bit 22) over a 16-bit count: the same as an OR.
    if (typeof o.Time === 'number') return 0x400000 + o.Time;
  }
  return null;
}

/** An absolute timelock as the number nLockTime carries, from either form. */
export function absoluteTimelockValue(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as { Blocks?: unknown; Seconds?: unknown };
    if (typeof o.Blocks === 'number') return o.Blocks;
    if (typeof o.Seconds === 'number') return o.Seconds;
  }
  return null;
}

/** 0.28's form of an absolute timelock: heights below 500 000 000, else time. */
function absoluteTimelock028(v: unknown): unknown {
  const n = absoluteTimelockValue(v);
  if (n == null) return v;
  return n < 500_000_000 ? { Blocks: n } : { Seconds: n };
}

/** What a spend on a path must satisfy: the largest wait of each kind. */
export interface PathCondition {
  /** The relative wait (0.28's nSequence form), when the path has one. */
  csv?: number;
  /** The absolute wait (nLockTime), when the path has one. */
  timelock?: number;
}

/** A relative wait counted in time, not blocks: rust-bitcoin's
 *  `Sequence::is_time_locked` (BIP-68's type flag, bit 22, on a sequence
 *  whose disable flag, bit 31, is clear). */
const relativeIsTime = (csv: number): boolean => csv < 0x80000000 && (csv & 0x400000) !== 0;

/** An absolute wait counted in time, not height (`LockTime` Seconds). */
const absoluteIsTime = (timelock: number): boolean => timelock >= 500_000_000;

/**
 * BDK's `Condition::merge`: the larger wait of each kind, or 'invalid'
 * where two waits of one kind count different units (MixedTimelockUnits:
 * a block wait beside a time wait, or a height beside a date).
 */
const merged = (a: PathCondition, b: PathCondition): PathCondition | 'invalid' => {
  if (a.csv != null && b.csv != null && relativeIsTime(a.csv) !== relativeIsTime(b.csv)) return 'invalid';
  if (a.timelock != null && b.timelock != null && absoluteIsTime(a.timelock) !== absoluteIsTime(b.timelock)) {
    return 'invalid';
  }
  const max = (x?: number, y?: number) => (x == null ? y : y == null ? x : Math.max(x, y));
  const out: PathCondition = {};
  const csv = max(a.csv, b.csv);
  const timelock = max(a.timelock, b.timelock);
  if (csv != null) out.csv = csv;
  if (timelock != null) out.timelock = timelock;
  return out;
};

const isNone = (c: PathCondition) => c.csv == null && c.timelock == null;

/**
 * BDK's own `Policy::get_condition` (vendor/bdk/src/descriptor/policy.rs in
 * 0.28.2, the same rule in 3.x), read without throwing: the waits a spend on
 * `path` must meet, or 'invalid' where BDK refuses the path: a node given
 * fewer children than it needs (NotEnoughItemsSelected), an index a THRESH
 * or a MULTISIG does not have (IndexOutOfRange), or chosen children whose
 * waits count different units (MixedTimelockUnits).
 */
function conditionOn(node: PolicyNode, path: PolicyPath): PathCondition | 'invalid' {
  const items = Array.isArray(node.items) ? node.items : [];
  const threshold = typeof node.threshold === 'number' ? node.threshold : 0;
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  // With nothing chosen, BDK takes every child of a THRESH that needs them
  // all and every key of a MULTISIG, and nothing anywhere else.
  const fallback =
    node.type === 'THRESH' && items.length === threshold
      ? range(threshold)
      : node.type === 'MULTISIG'
        ? range(Array.isArray(node.keys) ? node.keys.length : 0)
        : [];
  const selected = new Set(path[node.id ?? ''] ?? fallback);
  switch (node.type) {
    case 'THRESH': {
      const each = items.map((i) => conditionOn(i, path));
      if (each.every((c) => c !== 'invalid' && isNone(c))) return {};
      if ([...selected].some((i) => i >= items.length) || selected.size < threshold) return 'invalid';
      let out: PathCondition = {};
      for (let i = 0; i < each.length; i++) {
        if (!selected.has(i)) continue;
        const c = each[i];
        if (c === 'invalid') return 'invalid';
        const next = merged(out, c);
        if (next === 'invalid') return 'invalid';
        out = next;
      }
      return out;
    }
    case 'MULTISIG': {
      const keys = Array.isArray(node.keys) ? node.keys.length : 0;
      if (selected.size < threshold) return 'invalid';
      return [...selected].some((i) => i >= keys) ? 'invalid' : {};
    }
    case 'RELATIVETIMELOCK': {
      const csv = relativeTimelockValue(node.value);
      return csv == null ? {} : { csv };
    }
    case 'ABSOLUTETIMELOCK': {
      const timelock = absoluteTimelockValue(node.value);
      return timelock == null ? {} : { timelock };
    }
    default:
      return {};
  }
}

/** The waits a spend on `path` must meet, or null where BDK refuses the path. */
export function pathCondition(root: PolicyNode, path: PolicyPath | null): PathCondition | null {
  const c = conditionOn(root, path ?? {});
  return c === 'invalid' ? null : c;
}

/** A vault's two policy trees, receive and change (no change tree: none). */
export interface KeychainPolicies {
  external: PolicyNode | null;
  internal?: PolicyNode | null;
}

/** The policy path given to each keychain (none: BDK's own choice). */
export interface KeychainPaths {
  external?: PolicyPath | null;
  internal?: PolicyPath | null;
}

/**
 * Does the chosen spending path carry a relative timelock (an `older()`)?
 *
 * 0.28 decides the transaction's version by it: version 2 when the merged
 * condition of both keychains has a CSV, else version 1 (`create_tx`). The
 * new engine keeps that shape and asks this.
 * Checked against the real transactions 0.28 built (`bdkTimelockedSpends.json`).
 * A path BDK would refuse answers false, and so do two keychains whose
 * waits count different units (create_tx merges them the same way): that
 * build fails on its own, and the post-build checks refuse a CSV input in a
 * version 1 transaction.
 */
export function chosenPathHasRelativeTimelock(policies: KeychainPolicies, path: KeychainPaths): boolean {
  let out: PathCondition = {};
  for (const kc of ['external', 'internal'] as const) {
    const tree = policies[kc];
    if (!tree) continue;
    const c = pathCondition(tree, path[kc] ?? null);
    if (c == null) return false;
    const next = merged(out, c);
    if (next === 'invalid') return false;
    out = next;
  }
  return out.csv != null;
}

/** A condition object of either library in 0.28's form. */
function condition028(c: unknown): unknown {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return c;
  const o = c as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    if (k === 'csv') out.csv = relativeTimelockValue(o.csv) ?? o.csv;
    else if (k === 'timelock') out.timelock = absoluteTimelock028(o.timelock);
    else out[k] = o[k];
  }
  return out;
}

const canonical = (v: unknown): string => JSON.stringify(v);

/**
 * One tree in one form, whichever library wrote it (the comparator's
 * normalization, decided 2026-10-15, for the preflight and the
 * shadow checks, which went with the old engine, decided
 * 2026-11-04; it still holds the new library's recorded trees to the 0.28
 * fixtures kept as reference data, policyBothLibraries.test.ts):
 *   - timelocks re-encoded to 0.28's form, in the nodes and in every
 *     `condition` and `conditions` entry;
 *   - each `conditions` list sorted (0.28 kept them in a hash set, so their
 *     order is not the library's to keep);
 *   - node ids dropped, so trees compare by tree position;
 *   - keys of every object in one order.
 * Two vaults' trees are the same policy exactly when their normalized JSON
 * is equal.
 */
export function normalizePolicyTree(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizePolicyTree);
  if (!node || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (k === 'id') continue;
    if (k === 'value' && o.type === 'RELATIVETIMELOCK') out.value = relativeTimelockValue(v) ?? v;
    else if (k === 'value' && o.type === 'ABSOLUTETIMELOCK') out.value = absoluteTimelock028(v);
    else if (k === 'condition') out.condition = condition028(v);
    else if (k === 'conditions' && v && typeof v === 'object' && !Array.isArray(v)) {
      const map: Record<string, unknown> = {};
      for (const at of Object.keys(v as object).sort()) {
        const list = (v as Record<string, unknown>)[at];
        map[at] = Array.isArray(list)
          ? list.map(condition028).sort((a, b) => (canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0))
          : list;
      }
      out.conditions = map;
    } else out[k] = normalizePolicyTree(v);
  }
  return out;
}

/** Are two trees the same policy, whichever library wrote each? */
export function samePolicyTree(a: unknown, b: unknown): boolean {
  return canonical(normalizePolicyTree(a)) === canonical(normalizePolicyTree(b));
}
