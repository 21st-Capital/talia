/**
 * Runs a tapleaf script over the witness the @scure fallback built for it,
 * the way the network would (BIP-342), to say whether the network accepts
 * it, before Talia sends it. Signatures are never verified cryptographically:
 * a non-empty signature counts only when it is, byte for byte, the one the
 * PSBT holds for that key in that leaf (`sigFor`), so what is checked is that
 * every signature sits in its key's place and every key that did not sign has
 * its empty place. Timelocks are judged against the transaction's own fields
 * (`txLocks.ts`), on the branch the witness actually takes.
 *
 * Why (leaf hazard, decided 2026-10-17): @scure has templates for a plain `multi_a`
 * and a chain of `pk`s; every other leaf (`and_v(v:multi_a(2,A,B,C),older(N))`,
 * `or_d(pk(A),and_v(v:pk(B),older(N)))`) lands in its "unknown" branch, which
 * stacks the signatures it has in key order and nothing else. A missing key
 * then leaves no empty place, so a 2-of-3 signed by two is refused by the
 * network; and a branch the witness never runs carries a wait that does not
 * matter. Reading the locks alone could see neither.
 *
 * Covers the opcodes miniscript writes into a tapleaf. Anything else (hash
 * locks, OP_SUCCESS, arithmetic beyond ADD) is `unchecked`: the caller sends
 * nothing it cannot check. Pure; tested in `__tests__/tapscriptRun.test.ts`.
 */
import * as btc from '@scure/btc-signer';
import { carriesAfter, carriesOlder } from '../txLocks';
import type { TxLocks } from '../txLocks';

export type TapscriptVerdict =
  | { ok: true }
  /** The network refuses it: a lock the transaction does not carry. */
  | { ok: false; why: 'lock'; lock: 'older' | 'after' }
  /** The network refuses it: a place missing, a signature out of place,
   *  the script ending false or with more than one item. */
  | { ok: false; why: 'witness' }
  /** Talia cannot tell: an opcode or shape this runner does not cover. */
  | { ok: false; why: 'unchecked' };

class Refused extends Error {
  constructor(public verdict: TapscriptVerdict) {
    super('refused');
  }
}

const SEQUENCE_DISABLE = 0x80000000;

const isTrue = (b: Uint8Array): boolean => {
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 0) return !(i === b.length - 1 && b[i] === 0x80);
  }
  return false;
};

const num = (b: Uint8Array, limit = 4): number => {
  try {
    return Number(btc.ScriptNum(limit, true).decode(b));
  } catch {
    throw new Refused({ ok: false, why: 'witness' });
  }
};

const enc = (n: number): Uint8Array => (n === 0 ? new Uint8Array() : btc.ScriptNum().encode(BigInt(n)));

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Run `script` (a tapleaf, leaf version 0xc0) over `items` (the witness
 * before the script and the control block, bottom first) for input `i`.
 */
export function runTapscript(
  script: Uint8Array,
  items: Uint8Array[],
  tx: TxLocks,
  i: number,
  /** The signature the PSBT holds for this x-only key in this leaf. */
  sigFor: (xonly: Uint8Array) => Uint8Array | undefined,
): TapscriptVerdict {
  let ops: ReturnType<typeof btc.Script.decode>;
  try {
    ops = btc.Script.decode(script);
  } catch {
    return { ok: false, why: 'unchecked' };
  }
  const stack: Uint8Array[] = items.map((x) => x);
  const alt: Uint8Array[] = [];
  const exec: boolean[] = [];
  const pop = (): Uint8Array => {
    const v = stack.pop();
    if (v === undefined) throw new Refused({ ok: false, why: 'witness' });
    return v;
  };
  const top = (): Uint8Array => {
    const v = stack[stack.length - 1];
    if (v === undefined) throw new Refused({ ok: false, why: 'witness' });
    return v;
  };
  const fail = (): never => {
    throw new Refused({ ok: false, why: 'witness' });
  };
  /** A non-empty signature counts only as the PSBT's own for that key. */
  const signed = (sig: Uint8Array, key: Uint8Array): boolean => {
    if (sig.length === 0) return false;
    if (key.length !== 32) throw new Refused({ ok: false, why: 'unchecked' });
    const known = sigFor(key);
    if (!known || !same(known, sig)) fail();
    return true;
  };
  try {
    for (const op of ops) {
      const running = exec.every(Boolean);
      if (op === 'IF' || op === 'NOTIF') {
        let take = false;
        if (running) {
          const v = pop();
          // MINIMALIF (BIP-342): the argument is empty or exactly 0x01.
          if (v.length > 1 || (v.length === 1 && v[0] !== 1)) fail();
          take = op === 'IF' ? v.length === 1 : v.length === 0;
        }
        exec.push(take);
        continue;
      }
      if (op === 'ELSE') {
        if (exec.length === 0) fail();
        exec[exec.length - 1] = !exec[exec.length - 1];
        continue;
      }
      if (op === 'ENDIF') {
        if (exec.length === 0) fail();
        exec.pop();
        continue;
      }
      if (!running) {
        if (typeof op === 'string' && !(op in HANDLED)) return { ok: false, why: 'unchecked' };
        continue;
      }
      if (typeof op === 'number') {
        stack.push(enc(op));
        continue;
      }
      if (op instanceof Uint8Array) {
        stack.push(op);
        continue;
      }
      switch (op) {
        case 'CHECKSIG': {
          const key = pop();
          const sig = pop();
          stack.push(enc(signed(sig, key) ? 1 : 0));
          break;
        }
        case 'CHECKSIGVERIFY': {
          const key = pop();
          if (!signed(pop(), key)) fail();
          break;
        }
        case 'CHECKSIGADD': {
          const key = pop();
          const n = num(pop());
          const sig = pop();
          stack.push(enc(n + (signed(sig, key) ? 1 : 0)));
          break;
        }
        case 'NUMEQUAL':
        case 'NUMEQUALVERIFY': {
          const b = num(pop());
          const a = num(pop());
          if (op === 'NUMEQUALVERIFY') {
            if (a !== b) fail();
          } else stack.push(enc(a === b ? 1 : 0));
          break;
        }
        case 'EQUAL':
        case 'EQUALVERIFY': {
          const b = pop();
          const a = pop();
          if (op === 'EQUALVERIFY') {
            if (!same(a, b)) fail();
          } else stack.push(enc(same(a, b) ? 1 : 0));
          break;
        }
        case 'VERIFY':
          if (!isTrue(pop())) fail();
          break;
        case 'DROP':
          pop();
          break;
        case 'DUP':
          stack.push(top());
          break;
        case 'IFDUP':
          if (isTrue(top())) stack.push(top());
          break;
        case 'SWAP': {
          const b = pop();
          const a = pop();
          stack.push(b, a);
          break;
        }
        case 'SIZE':
          stack.push(enc(top().length));
          break;
        case 'NOT':
          stack.push(enc(num(pop()) === 0 ? 1 : 0));
          break;
        case '0NOTEQUAL':
          stack.push(enc(num(pop()) !== 0 ? 1 : 0));
          break;
        case 'ADD': {
          const b = num(pop());
          const a = num(pop());
          stack.push(enc(a + b));
          break;
        }
        case 'BOOLAND':
        case 'BOOLOR': {
          const b = num(pop()) !== 0;
          const a = num(pop()) !== 0;
          stack.push(enc((op === 'BOOLAND' ? a && b : a || b) ? 1 : 0));
          break;
        }
        case 'TOALTSTACK':
          alt.push(pop());
          break;
        case 'FROMALTSTACK': {
          const v = alt.pop();
          if (v === undefined) fail();
          stack.push(v!);
          break;
        }
        case 'CHECKSEQUENCEVERIFY': {
          const n = num(top(), 5);
          if (n < 0) fail();
          if ((n & SEQUENCE_DISABLE) === 0 && !carriesOlder(tx, i, n)) {
            return { ok: false, why: 'lock', lock: 'older' };
          }
          break;
        }
        case 'CHECKLOCKTIMEVERIFY': {
          const n = num(top(), 5);
          if (n < 0) fail();
          if (!carriesAfter(tx, i, n)) return { ok: false, why: 'lock', lock: 'after' };
          break;
        }
        default:
          return { ok: false, why: 'unchecked' };
      }
    }
  } catch (e) {
    if (e instanceof Refused) return e.verdict;
    return { ok: false, why: 'unchecked' };
  }
  if (exec.length !== 0) return { ok: false, why: 'witness' };
  // BIP-342: exactly one item left, and it is true.
  if (stack.length !== 1 || !isTrue(stack[0])) return { ok: false, why: 'witness' };
  return { ok: true };
}

/** Opcodes the runner knows; anything else, even in a branch not taken, is
 *  `unchecked` (an OP_SUCCESS anywhere changes the whole script's meaning). */
const HANDLED: Record<string, true> = Object.fromEntries(
  [
    'CHECKSIG', 'CHECKSIGVERIFY', 'CHECKSIGADD', 'NUMEQUAL', 'NUMEQUALVERIFY', 'EQUAL', 'EQUALVERIFY',
    'VERIFY', 'DROP', 'DUP', 'IFDUP', 'SWAP', 'SIZE', 'NOT', '0NOTEQUAL', 'ADD', 'BOOLAND', 'BOOLOR',
    'TOALTSTACK', 'FROMALTSTACK', 'CHECKSEQUENCEVERIFY', 'CHECKLOCKTIMEVERIFY',
  ].map((o) => [o, true as const]),
);
