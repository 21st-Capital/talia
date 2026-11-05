/**
 * The leaf hazard (decided 2026-10-17; the library fork calls it
 * D10): a spending path with `older(N)` or `after(N)` counts as satisfied
 * only when the TRANSACTION satisfies it. The coin's age never does.
 *
 * Both libraries finalized an everyday spend through a timelocked leaf when
 * one device held keys on two paths and signed both: the coin was old enough,
 * but the transaction (nSequence 0xFFFFFFFD, version 1) did not carry the wait,
 * so OP_CHECKSEQUENCEVERIFY fails and the network refuses it. The libraries
 * are fixed (both pinned library builds). Once they leave such an input
 * open, completePsbt hands it to the @scure fallback, which never looks at
 * timelocks either: on the same copies it built the recovery leaf's witness
 * (taproot) or a witness with no signatures at all (a wsh script it has no
 * template for). This module is the fallback's half of the rule: what each
 * witness it built would execute, and whether the transaction carries every
 * lock in it.
 *
 * Pure (no native import), so Jest runs it in Node.
 */
import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { decodeBase64 } from './export';
import { runTapscript } from './tapscriptRun';
import { carriesAfter, carriesOlder, SEQUENCE_FINAL } from '../txLocks';
import type { TxLocks } from '../txLocks';

export { carriesAfter, carriesOlder };
export type { TxLocks };

/** Every `<n> OP_CHECKSEQUENCEVERIFY` and `<n> OP_CHECKLOCKTIMEVERIFY` in a script. */
export function scriptTimelocks(script: Uint8Array): Array<{ kind: 'older' | 'after'; value: number }> {
  const ops = btc.Script.decode(script);
  const out: Array<{ kind: 'older' | 'after'; value: number }> = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op !== 'CHECKSEQUENCEVERIFY' && op !== 'CHECKLOCKTIMEVERIFY') continue;
    const prev = i > 0 ? ops[i - 1] : undefined;
    let value = NaN; // a lock whose value cannot be read is never carried
    if (typeof prev === 'number') value = prev;
    else if (prev instanceof Uint8Array) {
      try {
        value = Number(btc.ScriptNum(5).decode(prev));
      } catch {
        value = NaN;
      }
    }
    out.push({ kind: op === 'CHECKSEQUENCEVERIFY' ? 'older' : 'after', value });
  }
  return out;
}

/** The PSBT's transaction-level lock fields; null when it cannot be read. */
export function txLocksOf(psbtBase64: string): TxLocks | null {
  const tx = load(psbtBase64);
  if (!tx) return null;
  const sequences: number[] = [];
  for (let i = 0; i < tx.inputsLength; i++) sequences.push(tx.getInput(i).sequence ?? SEQUENCE_FINAL);
  return { version: tx.version, lockTime: tx.lockTime, sequences };
}

function load(psbtBase64: string): btc.Transaction | null {
  try {
    const bytes = decodeBase64(psbtBase64);
    if (!bytes) return null;
    return btc.Transaction.fromPSBT(bytes, {
      allowUnknownOutputs: true,
      allowUnknownInputs: true,
      allowLegacyWitnessUtxo: true,
    });
  } catch {
    return null;
  }
}

type Input = ReturnType<btc.Transaction['getInput']>;

const sameBytes = (a?: Uint8Array, b?: Uint8Array): boolean =>
  (a?.length ?? 0) === (b?.length ?? 0) && (a ?? new Uint8Array()).every((x, i) => x === b![i]);

const sameWitness = (a?: Uint8Array[], b?: Uint8Array[]): boolean =>
  (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((x, i) => sameBytes(x, b![i]));

function spentScript(inp: Input): Uint8Array | undefined {
  if (inp.witnessUtxo) return inp.witnessUtxo.script;
  const prev = inp.nonWitnessUtxo;
  if (prev && inp.index != null) return prev.outputs[inp.index]?.script;
  return undefined;
}

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const TAPLEAF_TAG = sha256(utf8ToBytes('TapLeaf'));

/** BIP-341's leaf hash: tagged "TapLeaf" over version, compact size, script. */
function tapLeafHash(script: Uint8Array, version: number): Uint8Array {
  const n = script.length;
  const size =
    n < 0xfd
      ? Uint8Array.of(n)
      : n <= 0xffff
        ? Uint8Array.of(0xfd, n & 0xff, n >> 8)
        : Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  return sha256(concatBytes(TAPLEAF_TAG, TAPLEAF_TAG, Uint8Array.of(version), size, script));
}

/** Per input: "<x-only key>:<leaf hash>" -> the signature some copy holds. */
type LeafSigs = Array<Map<string, Uint8Array>>;

function leafSigsOf(copies: btc.Transaction[]): LeafSigs {
  const out: LeafSigs = [];
  for (const tx of copies) {
    for (let i = 0; i < tx.inputsLength; i++) {
      const m = (out[i] ??= new Map());
      for (const [{ pubKey, leafHash }, sig] of tx.getInput(i).tapScriptSig ?? []) {
        m.set(`${hex(pubKey)}:${hex(leafHash)}`, sig);
      }
    }
  }
  return out;
}

const NO_TEMPLATE = 'the backup assembler has no template for this vault\'s script and would send it without signatures';
const UNCHECKED = 'Talia cannot check this script, so what the backup assembler built is not sent';
const lockProblem = (coin: string, lock: 'older' | 'after'): string =>
  lock === 'older'
    ? `${coin}: this signature uses a path that opens only after a wait, and this transaction does not carry that wait, so the network would reject it`
    : `${coin}: this signature uses a path that opens only at a set date or block, and this transaction does not carry it, so the network would reject it`;

/**
 * Why the network would refuse what the fallback built for input `i`, or
 * null. `sigs` holds every signature the copies it was built from carry.
 */
function inputProblem(tx: TxLocks, i: number, inp: Input, sigs: LeafSigs): string | null {
  const coin = `coin ${i + 1}`;
  const script = spentScript(inp);
  if (!script) return `${coin}: the copy does not say which coin it spends, so the backup assembler cannot be checked`;
  let kind: string;
  try {
    kind = btc.OutScript.decode(script).type;
  } catch {
    kind = 'unknown';
  }
  const witness = inp.finalScriptWitness ?? [];
  const typeOf = (s: Uint8Array | null | undefined): string => {
    try {
      return s ? btc.OutScript.decode(s).type : 'unknown';
    } catch {
      return 'unknown';
    }
  };
  // The script the witness runs, and whether every lock in it surely runs.
  let executed: Uint8Array | null = null;
  if (kind === 'tr') {
    const stack = witness.length >= 2 && witness[witness.length - 1][0] === 0x50 ? witness.slice(0, -1) : witness;
    if (stack.length <= 1) return null; // the key path: no script, no lock
    const control = stack[stack.length - 1];
    if ((control[0] & 0xfe) !== 0xc0) {
      return `${coin}: the backup assembler used a script version Talia cannot check, so it is not sent`;
    }
    const leaf = stack[stack.length - 2];
    const leafType = typeOf(leaf);
    if (leafType !== 'tr_ms' && leafType !== 'tr_ns') {
      // @scure's "unknown" leaf: it stacks the signatures it has in key
      // order, with no empty place for a key that did not sign, whatever
      // the script. So the leaf is RUN over that witness (decided
      // 2026-10-17): a missing place, a lock the transaction does not
      // carry on the branch actually taken, or anything Talia cannot run.
      const leafHash = hex(tapLeafHash(leaf, control[0] & 0xfe));
      const verdict = runTapscript(leaf, stack.slice(0, -2), tx, i, (xonly) => sigs[i]?.get(`${hex(xonly)}:${leafHash}`));
      if (verdict.ok) return null;
      if (verdict.why === 'lock') return lockProblem(coin, verdict.lock);
      if (verdict.why === 'witness') {
        return `${coin}: the backup assembler built a witness this script refuses (a key's place is missing or a signature is out of place), so it is not sent`;
      }
      return `${coin}: ${UNCHECKED}`;
    }
    executed = leaf; // @scure's own multi_a and pk templates
  } else if (kind === 'wsh' || kind === 'sh') {
    let redeem: Uint8Array | null = null;
    if (kind === 'sh') {
      // The redeem script is the scriptSig's last push (decided 2026-10-17:
      // the witness's last item is the KEY for sh(wpkh), not a script).
      try {
        const sig = btc.Script.decode(inp.finalScriptSig ?? new Uint8Array());
        const last = sig[sig.length - 1];
        redeem = last instanceof Uint8Array ? last : null;
      } catch {
        redeem = null;
      }
      if (!redeem) return `${coin}: the backup assembler built no script to check, so it is not sent`;
    }
    const redeemType = kind === 'sh' ? typeOf(redeem) : 'wsh';
    if (redeemType === 'wpkh') return null; // sh(wpkh): a single key, no script of its own
    // The witness script is the witness's last item; a legacy P2SH runs
    // the redeem script itself.
    executed = redeemType === 'wsh' ? (witness[witness.length - 1] ?? null) : redeem;
    // @scure assembles only the scripts it has a template for (multisig, a
    // single key). For any other script it hands back the script alone, with
    // no signature in front of it, which the network always refuses.
    if (executed && typeOf(executed) === 'unknown') return `${coin}: ${NO_TEMPLATE}`;
  } else {
    return null; // a single key (pkh, wpkh, pk): no script of its own, no lock
  }
  if (!executed) return `${coin}: the backup assembler built no script to check, so it is not sent`;
  for (const lock of scriptTimelocks(executed)) {
    const carried =
      Number.isFinite(lock.value) &&
      (lock.kind === 'older' ? carriesOlder(tx, i, lock.value) : carriesAfter(tx, i, lock.value));
    if (!carried) return lockProblem(coin, lock.kind);
  }
  return null;
}

/**
 * Every reason the network would refuse a witness the FALLBACK built: each
 * input whose final fields differ between `beforeBase64` (the library's
 * result, the library is trusted for its own inputs) and `afterBase64` (the
 * fallback's) is checked. An empty list means nothing found.
 *
 * A tapleaf @scure has no template for is RUN over the witness it built
 * (`tapscriptRun.ts`): exact for every opcode miniscript writes, and what it
 * cannot run is refused as unchecked. @scure's own templates (`multi_a`, a
 * `pk` chain, a wsh or P2SH multisig or single key) carry no lock; any other
 * wsh or P2SH script is refused, because @scure sends it with no signature.
 * A refusal here is clean (nothing is sent); an invalid transaction never is.
 */
export function fallbackWitnessProblems(
  beforeBase64: string,
  afterBase64: string,
  /** The copies the fallback built its witness from: every signature they
   *  hold may sit in a tapleaf's witness. */
  sourcesBase64: string[] = [],
): string[] {
  const after = load(afterBase64);
  if (!after) return ['the assembled copy cannot be read'];
  const before = load(beforeBase64);
  const sigs = leafSigsOf(
    [before, ...sourcesBase64.map(load)].filter((t): t is btc.Transaction => t != null),
  );
  const locks: TxLocks = {
    version: after.version,
    lockTime: after.lockTime,
    sequences: Array.from({ length: after.inputsLength }, (_, i) => after.getInput(i).sequence ?? SEQUENCE_FINAL),
  };
  const problems: string[] = [];
  for (let i = 0; i < after.inputsLength; i++) {
    const inp = after.getInput(i);
    const was = before && i < before.inputsLength ? before.getInput(i) : undefined;
    const untouched =
      was != null &&
      was.finalScriptWitness != null &&
      sameWitness(was.finalScriptWitness, inp.finalScriptWitness) &&
      sameBytes(was.finalScriptSig, inp.finalScriptSig);
    if (untouched) continue;
    const problem = inputProblem(locks, i, inp, sigs);
    if (problem) problems.push(problem);
  }
  return problems;
}
