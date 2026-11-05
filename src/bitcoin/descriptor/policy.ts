/**
 * Flatten a descriptor's miniscript into human-presentable SPENDING PATHS.
 *
 * Liana's Settings > Wallet shows the policy as dense prose; the goal for Talia's
 * version is "super easy to read". This module does the structural half: each
 * path is "these key groups must sign" plus an optional timelock. The UI
 * renders the friendly cards/graph from this.
 *
 * String classification only (like the rest of this layer) — BDK owns the
 * real semantics. Exotic shapes we can't flatten faithfully return
 * `exact: false` so the UI can fall back to the raw descriptor.
 */
import { extractBalanced, parseKeyOrigins, splitTopLevel, stripChecksum } from './parse';
import type { KeyOrigin } from './types';
import { isProvablyUnspendableKey } from './unspendable';
import { csvLock } from './timelock';
import { carriesAfter, carriesOlder } from '../txLocks';
import type { TxLocks } from '../txLocks';

export interface PolicyGroup {
  /** How many of `keys` must sign. */
  threshold: number;
  keys: KeyOrigin[];
}

export interface PolicyPath {
  /** Relative timelock (blocks since the coin confirmed) gating this path.
   *  For a time-based lock (`olderIsTime`) this is a conservative estimate
   *  in blocks, never an exact count. */
  olderBlocks?: number;
  /** The relative lock is BIP-68 TIME (512-second units), not blocks. */
  olderIsTime?: boolean;
  /** Absolute locktime gating this path: a block height, or a Unix time
   *  when `afterIsTime` (a value of 500 000 000 or more, per consensus). */
  afterHeight?: number;
  /** `after()` names a moment (Unix seconds), not a block height. */
  afterIsTime?: boolean;
  /** Every group must be satisfied (they are AND-ed). */
  groups: PolicyGroup[];
}

/**
 * How many signatures a path needs, and from which keys — correct for BOTH
 * shapes a path can take (decided 2026-07-28, after a 3-of-3 AND-chain was read as
 * needing ONE signature):
 *
 *   multi_a(2,A,B,C)                  → ONE group,  threshold 2  → needs 2
 *   and_v(v:and_v(v:pk(A),pk(B)),pk(C)) → THREE groups, threshold 1 each,
 *                                        AND-ed → needs 3
 *
 * Reading `groups[0].threshold` is wrong for the second shape and dangerously
 * understates it. Every caller asking "is this path satisfied?" must use this.
 */
export function pathRequirement(path: PolicyPath): {
  /** Total signatures needed to satisfy the whole (AND-ed) path. */
  needed: number;
  /** Every key that can contribute, deduplicated. */
  keys: KeyOrigin[];
} {
  let needed = 0;
  const keys: KeyOrigin[] = [];
  const seen = new Set<string>();
  for (const g of path.groups) {
    needed += g.threshold;
    for (const k of g.keys) {
      const id = k.fingerprint?.toLowerCase() ?? k.xpub;
      if (!seen.has(id)) {
        seen.add(id);
        keys.push(k);
      }
    }
  }
  return { needed, keys };
}

/**
 * Is this path satisfied by the keys that have signed? Group-aware: EVERY
 * AND-ed group must independently reach its own threshold, so signing the
 * same key twice — or two keys inside one group of a three-group AND — can
 * never stand in for the rest.
 */
export function pathSatisfiedBy(path: PolicyPath, signedFingerprints: string[]): boolean {
  if (path.groups.length === 0) return false;
  const signed = new Set(signedFingerprints.map((f) => f.toLowerCase()));
  return path.groups.every((g) => {
    const have = g.keys.filter(
      (k) => k.fingerprint && signed.has(k.fingerprint.toLowerCase()),
    ).length;
    return have >= g.threshold;
  });
}

/**
 * Is `path` satisfied on EVERY input by signatures made under ONE spend
 * condition (decided 2026-09-26)? `signerGroups` is
 * `psbtSignatureStatus().signerGroups`: per input, the fingerprints that
 * signed the same tapleaf. Keys that signed two different leaves never add
 * up, because the network checks each leaf on its own.
 */
export function pathSatisfiedOnEveryInput(
  path: PolicyPath,
  signerGroups: Array<Record<string, string[]>>,
): boolean {
  if (signerGroups.length === 0) return false;
  return signerGroups.every((groups) => Object.values(groups).some((g) => pathSatisfiedBy(path, g)));
}

/** The path that can spend NOW (parsePolicy sorts unlocked paths first). */
export function primaryPath(policy: WalletPolicy): PolicyPath | undefined {
  return (
    policy.paths.find((p) => p.olderBlocks === undefined && p.afterHeight === undefined) ??
    policy.paths[0]
  );
}

/**
 * The shape Talia REFUSES to build, detected in a descriptor we did not build
 * (decided 2026-07-28). The everyday path needs every key it holds, so losing any
 * one of them locks the coins for good.
 *
 * Returns null for every shape we do offer — and for descriptors we could not
 * flatten faithfully, because the fallback invents a single group whose
 * threshold equals its key count and would otherwise raise a false alarm on
 * every exotic script.
 */
export function deadEndShape(
  policy: WalletPolicy,
): { needed: number; total: number; hasRecovery: boolean } | null {
  if (!policy.exact) return null;
  const primary = primaryPath(policy);
  if (!primary) return null;
  const { needed, keys } = pathRequirement(primary);
  const total = keys.length;
  if (total < 2 || needed < total) return null;
  const hasRecovery = policy.paths.some(
    (p) => p !== primary && (p.olderBlocks !== undefined || p.afterHeight !== undefined),
  );
  if (total === 2 && hasRecovery) return null; // the one k-of-k we allow
  return { needed, total, hasRecovery };
}

export interface WalletPolicy {
  /** Primary (unlocked) paths first, then by ascending timelock. */
  paths: PolicyPath[];
  /** False when the script had shapes we couldn't flatten faithfully. */
  exact: boolean;
}

/** Wrappers (a:, s:, c:, t:, d:, v:, j:, n:, l:, u:) don't change WHO signs. */
const WRAPPER_RE = /^[asctdvjnlu]+:/;

function parseKey(expr: string): KeyOrigin {
  const keys = parseKeyOrigins(expr);
  // Non-xpub keys (raw hex pubkeys in miniscript) still deserve a row.
  return keys[0] ?? { xpub: expr.trim() };
}

class Unsupported extends Error {}

/** All ways to satisfy `expr`, as flattened paths. */
function branches(expr: string): PolicyPath[] {
  const s = expr.trim().replace(WRAPPER_RE, '');
  if (s === '1') return [{ groups: [] }];
  if (s === '0') return [];

  const open = s.indexOf('(');
  if (open < 0) throw new Unsupported(`Unrecognised fragment: ${s}`);
  const name = s.slice(0, open);
  const inner = extractBalanced(s, open);
  if (inner === undefined) throw new Unsupported(`Unbalanced: ${s}`);
  const args = splitTopLevel(inner);

  switch (name) {
    case 'pk':
    case 'pkh':
    case 'pk_k':
    case 'pk_h':
      return [{ groups: [{ threshold: 1, keys: [parseKey(args[0])] }] }];
    case 'multi':
    case 'sortedmulti':
    case 'multi_a':
    case 'sortedmulti_a': {
      const k = Number(args[0]);
      if (!Number.isInteger(k)) throw new Unsupported(`Bad threshold in ${s}`);
      return [{ groups: [{ threshold: k, keys: args.slice(1).map(parseKey) }] }];
    }
    case 'older': {
      // BIP-68: a time-based value (bit 22) counts 512-second units, not
      // blocks (decided 2026-09-26). csvLock reads it the one way everywhere.
      const lock = csvLock(Number(args[0]));
      if (!lock) throw new Unsupported(`Bad relative timelock in ${s}`);
      return [lock.time ? { olderBlocks: lock.blocks, olderIsTime: true, groups: [] } : { olderBlocks: lock.blocks, groups: [] }];
    }
    case 'after': {
      const n = Number(args[0]);
      // nLockTime of 500 000 000 or more is a Unix time, not a height
      // (the same rule's absolute twin): never "opens at block 1 700 000 000".
      return [{ afterHeight: n, ...(n >= 500_000_000 ? { afterIsTime: true } : {}), groups: [] }];
    }
    case 'and_v':
    case 'and_b':
    case 'and_n':
      return combineAll(branches(args[0]), branches(args[1]));
    case 'andor':
      // andor(X,Y,Z) = (X and Y) or Z
      return [...combineAll(branches(args[0]), branches(args[1])), ...branches(args[2])];
    case 'or_b':
    case 'or_c':
    case 'or_d':
    case 'or_i':
      return [...branches(args[0]), ...branches(args[1])];
    case 'thresh': {
      const k = Number(args[0]);
      const subs = args.slice(1).map(branches);
      // The common readable case: k-of-n over plain keys.
      const singleKeys = subs.map((b) =>
        b.length === 1 &&
        b[0].groups.length === 1 &&
        b[0].groups[0].threshold === 1 &&
        b[0].groups[0].keys.length === 1 &&
        b[0].olderBlocks === undefined &&
        b[0].afterHeight === undefined
          ? b[0].groups[0].keys[0]
          : null,
      );
      if (Number.isInteger(k) && singleKeys.every((x) => x !== null)) {
        return [{ groups: [{ threshold: k, keys: singleKeys as KeyOrigin[] }] }];
      }
      throw new Unsupported('thresh over non-key subexpressions');
    }
    default:
      throw new Unsupported(`Unsupported fragment: ${name}`);
  }
}

/** AND: every combination of a-path with b-path, merging groups and locks. */
function combineAll(a: PolicyPath[], b: PolicyPath[]): PolicyPath[] {
  const out: PolicyPath[] = [];
  for (const pa of a) {
    for (const pb of b) {
      out.push({
        groups: [...pa.groups, ...pb.groups],
        olderBlocks: maxDefined(pa.olderBlocks, pb.olderBlocks),
        ...(pa.olderIsTime || pb.olderIsTime ? { olderIsTime: true } : {}),
        afterHeight: maxDefined(pa.afterHeight, pb.afterHeight),
        ...(pa.afterIsTime || pb.afterIsTime ? { afterIsTime: true } : {}),
      });
    }
  }
  return out;
}

const maxDefined = (x?: number, y?: number): number | undefined =>
  x === undefined ? y : y === undefined ? x : Math.max(x, y);

/** Split a taproot tree `{A,{B,C}}` into its leaf scripts. */
function taprootLeaves(tree: string): string[] {
  const t = tree.trim();
  if (!t.startsWith('{')) return [t];
  // Split `{X,Y}` at the top-level comma (X/Y may nest more braces/parens).
  let depth = 0;
  for (let i = 1; i < t.length - 1; i++) {
    const c = t[i];
    if (c === '{' || c === '(') depth++;
    else if (c === '}' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      return [...taprootLeaves(t.slice(1, i)), ...taprootLeaves(t.slice(i + 1, -1))];
    }
  }
  return [t];
}

const lockRank = (p: PolicyPath): number => p.olderBlocks ?? p.afterHeight ?? -1;

export function parsePolicy(raw: string): WalletPolicy {
  const { body } = stripChecksum(raw);
  try {
    let paths: PolicyPath[];
    if (body.startsWith('wsh(') || body.startsWith('sh(wsh(')) {
      const start = body.indexOf('wsh(') + 3;
      paths = branches(extractBalanced(body, start) ?? '');
    } else if (body.startsWith('wpkh(') || body.startsWith('pkh(') || body.startsWith('sh(wpkh(')) {
      const keys = parseKeyOrigins(body);
      paths = [{ groups: [{ threshold: 1, keys: keys.slice(0, 1) }] }];
    } else if (body.startsWith('tr(')) {
      const inner = extractBalanced(body, 2) ?? '';
      const parts = splitTopLevel(inner);
      paths = [];
      // The internal key is a spending path of its own (the key path), one
      // key with no wait, UNLESS it is proven unspendable: Liana's and
      // Talia's NUMS key. Having no origin proves nothing (decided
      // 2026-09-26): an xpub someone else wrote there without
      // one would otherwise vanish from every summary of who can spend.
      if (parts.length === 1 || !isProvablyUnspendableKey(parts[0])) {
        paths.push({ groups: [{ threshold: 1, keys: [parseKey(parts[0])] }] });
      }
      if (parts.length > 1) {
        for (const leaf of taprootLeaves(parts.slice(1).join(','))) {
          paths.push(...branches(leaf));
        }
      }
    } else if (body.startsWith('sh(') || /^(sortedmulti|multi)\(/.test(body)) {
      const start = body.indexOf('(');
      const inner = body.startsWith('sh(') ? extractBalanced(body, start) ?? '' : body;
      paths = branches(inner);
    } else {
      throw new Unsupported('Unknown top-level script');
    }

    // Drop degenerate paths (a bare older() with no keys can't spend alone).
    paths = paths.filter((p) => p.groups.length > 0);
    if (paths.length === 0) throw new Unsupported('No spendable paths found');
    paths.sort((a, b) => lockRank(a) - lockRank(b));
    return { paths, exact: true };
  } catch (e) {
    if (e instanceof Unsupported) {
      // Fallback: every key on one row, no structure claimed.
      const keys = parseKeyOrigins(body);
      return {
        paths: keys.length > 0 ? [{ groups: [{ threshold: keys.length, keys }] }] : [],
        exact: false,
      };
    }
    throw e;
  }
}

/**
 * "Singlesig" / "Multisig" — how many distinct signers the descriptor
 * involves, across ALL paths (a Liana single-key wallet with a separate
 * recovery key is multi-key custody, hence "Multisig" per the chosen labelling).
 */
export function sigTypeLabel(raw: string): 'Single-sig' | 'Multisig' {
  const keys = parseKeyOrigins(stripChecksum(raw).body);
  const distinct = new Set(keys.map((k) => k.fingerprint ?? k.xpub));
  return distinct.size > 1 ? 'Multisig' : 'Single-sig';
}

/** The judge's leaf-hazard refusal (a waiting path the transaction does not open). */
export const WAIT_NOT_CARRIED =
  'these signatures are for a path that opens only after a wait, and this ' +
  'transaction does not carry that wait, so the network would reject it';

/**
 * Does the transaction carry this path's wait on EVERY input (the leaf hazard)? A path
 * with no wait always does. `older` in blocks is checked to the block; a
 * time-based `older` keeps only an estimate in `olderBlocks`, so for it the
 * kind of wait is checked (BIP-68 time units, the switch on, version 2) and
 * the exact value is left to the witness check, which reads it off the
 * script itself.
 */
function txCarriesPath(tx: TxLocks, p: PolicyPath): boolean {
  for (let i = 0; i < tx.sequences.length; i++) {
    if (p.olderBlocks !== undefined) {
      const n = p.olderIsTime ? 0x00400000 | 1 : p.olderBlocks;
      if (!carriesOlder(tx, i, n)) return false;
    }
    if (p.afterHeight !== undefined && !carriesAfter(tx, i, p.afterHeight)) return false;
  }
  return true;
}

/**
 * May this transaction spend through `p` at all (the leaf hazard)? A path with no wait
 * always may. A waiting path only when the transaction carries its wait on
 * every input; when its lock fields cannot be read (`tx` null), never. The
 * coin's age plays no part: the network reads nSequence and nLockTime.
 */
export function pathOpenForTx(p: PolicyPath, tx: TxLocks | null | undefined): boolean {
  if (p.olderBlocks === undefined && p.afterHeight === undefined) return true;
  if (!tx) return false;
  return txCarriesPath(tx, p);
}

/**
 * Is the key that signed (its derivation as psbtSignatureStatus writes it,
 * "f5d9e0c9/48'/1'/0'/2'/2/0") this key of the policy? One seed often holds
 * keys on two paths (Liana's `<0;1>/*` beside `<2;3>/*` on one account), and
 * its fingerprint is the same on both, so where the descriptor names the
 * key's branches they decide. Without them (no origin path, a single-branch
 * key, a derivation of another depth) the fingerprint decides, as before.
 */
export function signerHoldsKey(origin: string, k: KeyOrigin): boolean {
  const [fp, ...steps] = origin.split('/');
  if (!k.fingerprint || fp.toLowerCase() !== k.fingerprint.toLowerCase()) return false;
  const multi = /^<(\d+(?:;\d+)+)>\/\*$/.exec(k.keyPath ?? '');
  if (!multi || k.originPath == null) return true;
  const base = k.originPath
    .replace(/^m\//, '')
    .split('/')
    .filter((s) => s !== '')
    .map((s) => s.replace(/[hH]$/, "'"));
  if (steps.length !== base.length + 2) return true;
  if (!base.every((s, i) => s === steps[i])) return false; // another account of the seed
  return multi[1].split(';').includes(steps[base.length]);
}

/** Where a working copy stands on the spending path it is on. */
export interface PathInPlay {
  path: PolicyPath;
  /** Every group met on every input under one spend condition AND the
   *  transaction opens the path (the leaf hazard). */
  satisfied: boolean;
  /** Signatures the whole path needs (`pathRequirement`). */
  needed: number;
  /** The path's keys, deduplicated (`pathRequirement`). */
  keys: KeyOrigin[];
  /** Distinct fingerprints (lower case) of the path's keys that signed. */
  signers: string[];
  /** Signatures still to come on this path; 0 once it is satisfied. */
  missing: number;
}

/**
 * The spending path a working copy is on, for the signing screens (the
 * leaf hazard, decided 2026-10-17). Only a path the TRANSACTION opens can be the one
 * that completes it: a device holding keys on the everyday path and on a
 * recovery path signs both, the coins may be old enough, but an everyday
 * spend (nSequence 0xFFFFFFFD, version 1) carries no wait, so the recovery
 * signature can never finish it and the everyday path stays in play.
 *
 * `chosen`: a path the owner opened on purpose (a timelocked layer), which
 * wins. Otherwise the satisfied open path, else the open path with the
 * fewest signatures missing (parsePolicy's order breaks ties, the everyday
 * path first). Only when the transaction opens no path at all are the closed
 * ones scored, so the screen still names something; none of them counts as
 * satisfied.
 */
export function pathInPlay(
  policy: WalletPolicy,
  status: {
    signerGroups: Array<Record<string, string[]>>;
    signedFingerprints: string[];
    /** psbtSignatureStatus's per-key derivations; without them the seed's
     *  fingerprint decides, as it always did. */
    signerKeys?: Array<Record<string, string[]>>;
  },
  tx: TxLocks | null | undefined,
  chosen?: PolicyPath | null,
): PathInPlay | null {
  const byKey = status.signerKeys != null && status.signerKeys.length > 0 ? status.signerKeys : null;
  const signed = new Set(status.signedFingerprints.map((f) => f.toLowerCase()));
  /** Did key `k` sign, on every input? By its own derivation where the PSBT
   *  says which key of a seed signed. */
  const keySigned = (k: KeyOrigin): boolean => {
    if (!k.fingerprint) return false;
    if (!byKey) return signed.has(k.fingerprint.toLowerCase());
    return byKey.every((groups) => Object.values(groups).some((origins) => origins.some((o) => signerHoldsKey(o, k))));
  };
  /** Every group met under ONE spend condition on every input (decided 2026-09-26),
   *  each signature counted for the key that made it. */
  const metOnEveryInput = (p: PolicyPath): boolean => {
    if (!byKey) return pathSatisfiedOnEveryInput(p, status.signerGroups);
    if (p.groups.length === 0) return false;
    return byKey.every((groups) =>
      Object.values(groups).some((origins) =>
        p.groups.every((g) => g.keys.filter((k) => origins.some((o) => signerHoldsKey(o, k))).length >= g.threshold),
      ),
    );
  };
  const describe = (p: PolicyPath): PathInPlay => {
    const { needed, keys } = pathRequirement(p);
    const signers = [...new Set(keys.filter(keySigned).map((k) => k.fingerprint!.toLowerCase()))];
    const satisfied = pathOpenForTx(p, tx) && metOnEveryInput(p);
    return { path: p, satisfied, needed, keys, signers, missing: satisfied ? 0 : Math.max(0, needed - signers.length) };
  };
  if (chosen) return describe(chosen);
  const open = policy.paths.filter((p) => pathOpenForTx(p, tx));
  const scored = (open.length > 0 ? open : policy.paths).map(describe);
  const done = scored.find((s) => s.satisfied);
  if (done) return done;
  return [...scored].sort((a, b) => a.missing - b.missing)[0] ?? null;
}

/**
 * May we trust a FALLBACK-assembled witness for these signatures?
 *
 * When BDK cannot build a witness we retry with @scure (the sign-first
 * co-sign bug, 2026-07-24). That library classifies our recovery leaf —
 * `and_v(v:pk(K),older(N))` — as "unknown" and, for unknown scripts, assembles
 * whatever signatures it finds WITHOUT checking the script's conditions. So it
 * will happily produce a witness for a timelocked branch whose wait is not
 * over, the app reports "ready to send", and the network rejects it. Nothing is
 * lost, but the client is told it worked at the exact moment they are already
 * in trouble (found 2026-07-29).
 *
 * The obvious guard — "refuse any timelocked path" — BREAKS RESCUE, which is
 * why it is not what this does. A rescue is signed ONLY by the rescue key, that
 * key appears ONLY behind a timelock, and the rescue screen has no other
 * assembly route. Refusing timelocked paths outright would fail every genuine
 * rescue.
 *
 * So the question is "is this ready?", never "does this have a wait?". We
 * refuse only when the wait is PROVABLY not over. Unknown stays allowed, in
 * keeping with the rest of this guard: we never block on missing information.
 *
 * @param inputConfirmations confirmations on the YOUNGEST coin being spent —
 *   undefined when the caller cannot tell.
 */
export function fallbackWitnessAllowed(
  policy: WalletPolicy,
  /** Fingerprints that signed, or (preferred) the per-input, per-leaf
   *  signer groups from psbtSignatureStatus, which never add up signatures
   *  made on different leaves (decided 2026-09-26). */
  signed: string[] | { signerGroups: Array<Record<string, string[]>> },
  inputConfirmations?: number,
  /** The transaction's own lock fields (the leaf hazard, decided 2026-10-17):
   *  a waiting path counts only when the TRANSACTION carries its wait. The
   *  coin's age alone never opens it. Absent: not judged here (the witness
   *  check in psbt/timelockCheck.ts still runs on every fallback). */
  tx?: TxLocks,
): { allowed: boolean; reason?: string } {
  const satisfies = (p: PolicyPath): boolean =>
    Array.isArray(signed) ? pathSatisfiedBy(p, signed) : pathSatisfiedOnEveryInput(p, signed.signerGroups);
  // Cannot judge the policy at all → do not block (unchanged behaviour).
  if (!policy.exact) return { allowed: true };
  const judgeable = policy.paths.every((p) =>
    p.groups.every((g) => g.keys.every((k) => !!k.fingerprint)),
  );
  if (!judgeable) return { allowed: true };

  const candidates = policy.paths.filter(satisfies);
  if (candidates.length === 0) {
    return {
      allowed: false,
      reason: 'the signatures present do not satisfy any spending path',
    };
  }
  // The leaf hazard: the first path whose wait the transaction carries (a path with no
  // wait always does). Signatures for a waiting path the transaction does
  // not open are refused, however old the coins are: the network checks the
  // transaction's nSequence and nLockTime, never the coin's age.
  const satisfied = tx ? candidates.find((p) => txCarriesPath(tx, p)) : candidates[0];
  if (!satisfied) {
    return { allowed: false, reason: WAIT_NOT_CARRIED };
  }

  const need = satisfied.olderBlocks;
  if (need == null) return { allowed: true }; // no wait on this path
  // A time-based wait is judged by the chain's clock, which a block count
  // cannot prove either way: unknown, so not blocked.
  if (satisfied.olderIsTime) return { allowed: true };
  if (inputConfirmations == null) return { allowed: true }; // cannot tell
  if (inputConfirmations >= need) return { allowed: true }; // the wait is over

  return {
    allowed: false,
    reason:
      `this path opens ${need} blocks after the coins last moved, and the ` +
      `youngest coin has ${inputConfirmations}, so the network would reject it`,
  };
}
