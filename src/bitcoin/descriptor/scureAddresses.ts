/**
 * An independent opinion on a vault's addresses (the independent address
 * check, decided 2026-10-15): `@scure/btc-signer` and
 * `@scure/bip32`, never either BDK library, derive a descriptor's addresses
 * for every shape Talia's own TypeScript can express, so a library that
 * derives another address is caught before anyone is paid to it.
 *
 * What it reads (one keychain's descriptor; split a `<0;1>` one first):
 *   pkh(K)  wpkh(K)  sh(wpkh(K))  tr(K)  tr(K, TREE)
 *   wsh(M)  sh(wsh(M))  sh(multi|sortedmulti(k, K...))
 * where M is the segwit v0 miniscript Talia composes and Liana writes for a
 * layered vault: multi, sortedmulti, pk, pkh, and_v(v:X, older(n) | after(n)),
 * or_d, or_i; and a TREE is `{A,B}` of tapscript leaves pk, multi_a,
 * sortedmulti_a and and_v(v:pk|v:multi_a|v:sortedmulti_a, older(n) | after(n)).
 * K is `[origin]xpub` (or tpub) with unhardened steps and one trailing `/*`,
 * or a bare x-only key inside tr(). Anything else answers null ("not covered"). While two
 * wallet libraries shipped, the per-vault preflight compared the libraries on those shapes;
 * since the old engine's removal (decided 2026-11-04) nothing checks them independently.
 * The planned evidence from TestFlight and the App Store before that removal was
 * skipped (decided 2026-11-04), so no TestFlight report and no App Store count came
 * in, and the TestFlight and App Store builds never compared the libraries on them. What the
 * removal rests on is the full build's phone tests alone: the testnet and mainnet checklists
 * (after phone tests on 2026-10-31 and 2026-11-04), its engine report reading 11 installs on
 * the new library, every check agreed, 0 fallbacks. Tier C's build matrix on the one engine
 * (decided 2026-11-04) is the coverage still owed for them.
 *
 * Scripts are written by hand from BIP-379's fragment table, which is what
 * makes this an opinion of its own; `scureAddresses.test.ts` holds it to
 * the addresses both libraries derived for a whole corpus of vault
 * shapes. Pure; public keys only.
 */
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import type { Network } from './types';

const TPUB = { private: 0x04358394, public: 0x043587cf };
const NETWORKS: Record<Network, typeof btc.NETWORK> = {
  bitcoin: btc.NETWORK,
  testnet: btc.TEST_NETWORK,
  signet: btc.TEST_NETWORK,
  regtest: { ...btc.TEST_NETWORK, bech32: 'bcrt' },
};

/** One address of a keychain: the address and its scriptPubKey (hex). */
export interface DerivedAddress {
  index: number;
  address: string;
  script: string;
}

/** A descriptor as a function of the index, or null when not covered. */
export type Deriver = (index: number) => { address: string; script: Uint8Array };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const cmp = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};
const concat = (...parts: Array<Uint8Array | number[]>): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) out.push(...p);
  return Uint8Array.from(out);
};

/** Split at top-level commas (outside (), {} and []). */
function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if ('({['.includes(c)) depth++;
    if (')}]'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

function call(s: string): { fn: string; args: string[] } | null {
  const m = /^([a-z_]+)\((.*)\)$/s.exec(s);
  if (!m) return null;
  return { fn: m[1], args: splitTop(m[2]) };
}

/** A key expression: its public key at an index (33-byte compressed, or 32-byte x-only). */
interface KeyAt {
  xonly: boolean;
  at: (i: number) => Uint8Array;
}

function keyOf(s: string): KeyAt | null {
  const bare = /^([0-9a-fA-F]{64})$/.exec(s);
  if (bare) {
    const x = Uint8Array.from(bare[1].match(/../g)!.map((h) => parseInt(h, 16)));
    return { xonly: true, at: () => x };
  }
  const m = /^(?:\[[0-9a-fA-F]{8}(?:\/\d+['h]?)*\])?([xt]pub[1-9A-HJ-NP-Za-km-z]+)((?:\/\d+)*)(\/\*)?$/.exec(s);
  if (!m) return null;
  let node: HDKey;
  try {
    node = m[1].startsWith('t') ? HDKey.fromExtendedKey(m[1], TPUB) : HDKey.fromExtendedKey(m[1]);
    for (const step of m[2].split('/').filter(Boolean)) node = node.deriveChild(Number(step));
  } catch {
    return null;
  }
  const ranged = !!m[3];
  const cache = new Map<number, Uint8Array>();
  return {
    xonly: false,
    at: (i) => {
      if (!ranged) return node.publicKey as Uint8Array;
      let k = cache.get(i);
      if (!k) {
        k = node.deriveChild(i).publicKey as Uint8Array;
        cache.set(i, k);
      }
      return k;
    },
  };
}

const xonlyOf = (k: Uint8Array) => (k.length === 32 ? k : k.slice(1));
const hash160 = (b: Uint8Array) => ripemd160(sha256(b));

/** A minimal push of a number (BIP-62: OP_0, OP_1..OP_16, else a script number). */
function pushNumber(n: number): number[] {
  if (n === 0) return [0x00];
  if (n >= 1 && n <= 16) return [0x50 + n];
  const bytes: number[] = [];
  let v = n;
  while (v > 0) {
    bytes.push(v & 0xff);
    v = Math.floor(v / 256);
  }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(0x00);
  return [bytes.length, ...bytes];
}
const pushBytes = (b: Uint8Array): number[] => [b.length, ...b];

const OP = {
  CHECKSIG: 0xac,
  CHECKSIGVERIFY: 0xad,
  CHECKMULTISIG: 0xae,
  CHECKMULTISIGVERIFY: 0xaf,
  CHECKSIGADD: 0xba,
  NUMEQUAL: 0x9c,
  NUMEQUALVERIFY: 0x9d,
  CSV: 0xb2,
  CLTV: 0xb1,
  DUP: 0x76,
  HASH160: 0xa9,
  EQUALVERIFY: 0x88,
  IFDUP: 0x73,
  NOTIF: 0x64,
  IF: 0x63,
  ELSE: 0x67,
  ENDIF: 0x68,
};

type Ctx = 'segwitv0' | 'tap';
/** A fragment as a function of the index: its script bytes. */
type Frag = (i: number) => Uint8Array;

/**
 * One miniscript fragment (BIP-379), `verify` when wrapped in v:. Returns
 * null for anything outside the subset above.
 */
function fragment(s: string, ctx: Ctx, verify = false): Frag | null {
  if (s.startsWith('v:')) return verify ? null : fragment(s.slice(2), ctx, true);
  const c = call(s);
  if (!c) return null;
  const keys = (args: string[]) => {
    const ks = args.map(keyOf);
    if (ks.some((k) => !k)) return null;
    return ks as KeyAt[];
  };
  const keyBytes = (k: KeyAt, i: number) => (ctx === 'tap' ? xonlyOf(k.at(i)) : k.at(i));
  switch (c.fn) {
    case 'pk': {
      const k = keyOf(c.args[0]);
      if (!k || (k.xonly && ctx !== 'tap')) return null;
      return (i) => concat(pushBytes(keyBytes(k, i)), [verify ? OP.CHECKSIGVERIFY : OP.CHECKSIG]);
    }
    case 'pkh': {
      if (ctx === 'tap') return null;
      const k = keyOf(c.args[0]);
      if (!k || k.xonly) return null;
      return (i) =>
        concat([OP.DUP, OP.HASH160], pushBytes(hash160(k.at(i))), [OP.EQUALVERIFY, verify ? OP.CHECKSIGVERIFY : OP.CHECKSIG]);
    }
    case 'multi':
    case 'sortedmulti': {
      if (ctx === 'tap') return null;
      const k = Number(c.args[0]);
      const ks = keys(c.args.slice(1));
      if (!ks || ks.some((x) => x.xonly) || !Number.isInteger(k)) return null;
      return (i) => {
        let pubs = ks.map((x) => x.at(i));
        if (c.fn === 'sortedmulti') pubs = [...pubs].sort(cmp);
        return concat(pushNumber(k), ...pubs.map(pushBytes), pushNumber(pubs.length), [
          verify ? OP.CHECKMULTISIGVERIFY : OP.CHECKMULTISIG,
        ]);
      };
    }
    case 'multi_a':
    case 'sortedmulti_a': {
      if (ctx !== 'tap') return null;
      const k = Number(c.args[0]);
      const ks = keys(c.args.slice(1));
      if (!ks || !Number.isInteger(k)) return null;
      return (i) => {
        let pubs = ks.map((x) => xonlyOf(x.at(i)));
        if (c.fn === 'sortedmulti_a') pubs = [...pubs].sort(cmp);
        const parts: number[] = [];
        pubs.forEach((p, n) => parts.push(...pushBytes(p), n === 0 ? OP.CHECKSIG : OP.CHECKSIGADD));
        return concat(parts, pushNumber(k), [verify ? OP.NUMEQUALVERIFY : OP.NUMEQUAL]);
      };
    }
    case 'older':
    case 'after': {
      if (verify) return null;
      const n = Number(c.args[0]);
      if (!Number.isInteger(n) || n < 1 || n >= 0x80000000) return null;
      return () => concat(pushNumber(n), [c.fn === 'older' ? OP.CSV : OP.CLTV]);
    }
    case 'and_v': {
      if (verify || c.args.length !== 2 || !c.args[0].startsWith('v:')) return null;
      const x = fragment(c.args[0], ctx);
      const y = fragment(c.args[1], ctx);
      return x && y ? (i) => concat(x(i), y(i)) : null;
    }
    case 'or_d': {
      if (verify || c.args.length !== 2) return null;
      const x = fragment(c.args[0], ctx);
      const z = fragment(c.args[1], ctx);
      return x && z ? (i) => concat(x(i), [OP.IFDUP, OP.NOTIF], z(i), [OP.ENDIF]) : null;
    }
    case 'or_i': {
      if (verify || c.args.length !== 2) return null;
      const x = fragment(c.args[0], ctx);
      const z = fragment(c.args[1], ctx);
      return x && z ? (i) => concat([OP.IF], x(i), [OP.ELSE], z(i), [OP.ENDIF]) : null;
    }
    default:
      return null;
  }
}

type TapTree = { script: Uint8Array; leafVersion: number } | [TapTree, TapTree];
type TreeAt = (i: number) => TapTree;

/** A tap tree `{A,B}` of leaves, or one leaf. */
function tree(s: string): TreeAt | null {
  if (s.startsWith('{') && s.endsWith('}')) {
    const parts = splitTop(s.slice(1, -1));
    if (parts.length !== 2) return null;
    const a = tree(parts[0]);
    const b = tree(parts[1]);
    return a && b ? (i) => [a(i), b(i)] : null;
  }
  const leaf = fragment(s, 'tap');
  return leaf ? (i) => ({ script: leaf(i), leafVersion: 0xc0 }) : null;
}

/**
 * The deriver of one keychain's descriptor (no `<0;1>`), or null when the
 * shape is not one this file reads.
 */
export function scureDeriver(descriptor: string, network: Network): Deriver | null {
  const body = descriptor.split('#')[0].trim();
  if (body.includes('<')) return null;
  const net = NETWORKS[network];
  const top = call(body);
  if (!top) return null;
  const out = (p: { address?: string; script: Uint8Array }) => {
    if (!p.address) throw new Error('no address form');
    return { address: p.address, script: p.script };
  };
  switch (top.fn) {
    case 'pkh':
    case 'wpkh': {
      const k = keyOf(top.args[0]);
      if (!k || k.xonly || top.args.length !== 1) return null;
      return (i) => out(top.fn === 'pkh' ? btc.p2pkh(k.at(i), net) : btc.p2wpkh(k.at(i), net));
    }
    case 'wsh': {
      const f = top.args.length === 1 ? fragment(top.args[0], 'segwitv0') : null;
      return f && ((i) => out(btc.p2wsh({ type: 'unknown', script: f(i) } as never, net)));
    }
    case 'sh': {
      const inner = call(top.args[0]);
      if (!inner || top.args.length !== 1) return null;
      if (inner.fn === 'wpkh') {
        const k = keyOf(inner.args[0]);
        return k && !k.xonly ? (i) => out(btc.p2sh(btc.p2wpkh(k.at(i), net), net)) : null;
      }
      if (inner.fn === 'wsh') {
        const f = inner.args.length === 1 ? fragment(inner.args[0], 'segwitv0') : null;
        return f && ((i) => out(btc.p2sh(btc.p2wsh({ type: 'unknown', script: f(i) } as never, net), net)));
      }
      if (inner.fn === 'multi' || inner.fn === 'sortedmulti') {
        const f = fragment(top.args[0], 'segwitv0');
        return f && ((i) => out(btc.p2sh({ type: 'unknown', script: f(i) } as never, net)));
      }
      return null;
    }
    case 'tr': {
      const internal = keyOf(top.args[0]);
      if (!internal || top.args.length > 2) return null;
      if (top.args.length === 1) return (i) => out(btc.p2tr(xonlyOf(internal.at(i)), undefined, net));
      const t = tree(top.args[1]);
      return t && ((i) => out(btc.p2tr(xonlyOf(internal.at(i)), t(i) as never, net, true)));
    }
    default:
      return null;
  }
}

/** The addresses at `indexes`, or null when the shape is not covered. */
export function scureAddresses(descriptor: string, network: Network, indexes: number[]): DerivedAddress[] | null {
  const d = scureDeriver(descriptor, network);
  if (!d) return null;
  return indexes.map((index) => {
    const a = d(index);
    return { index, address: a.address, script: hex(a.script) };
  });
}
