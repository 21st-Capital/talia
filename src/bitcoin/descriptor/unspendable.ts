/**
 * Unspendable taproot internal key — LIANA'S EXACT SCHEME, so Talia vaults
 * export/import cleanly with Liana (which VERIFIES the internal key is the
 * deterministic unspendable one and rejects the descriptor otherwise —
 * found in a phone test as "Failed to read the descriptor", 2026-07-19).
 *
 * Spec (delvingbitcoin.org/t/unspendable-keys-in-descriptors/304, as
 * implemented in liana/src/descriptors/analysis.rs):
 *   pubkey     = BIP-341 NUMS point H (no known discrete log)
 *   chain code = SHA256( concat of the 33-byte compressed pubkeys of every
 *                tap-tree xpub, in tap-tree iteration order, one entry PER
 *                OCCURRENCE — no sorting, no dedup )
 *   xpub       = depth 0, parent fingerprint 00000000, child number 0
 * Used in the descriptor as <xpub>/<0;1>/* with no origin.
 *
 * Verified byte-for-byte against a published Liana testnet descriptor
 * (see unspendable.test.ts). Public material only — no key material here.
 */
import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';
import type { KeyOrigin } from './types';

const base58check = createBase58check(sha256);

/** BIP-341's NUMS point H, x-only (its even-Y compressed form is 02||H). */
const NUMS_X = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

const XPUB_VERSION = '0488b21e'; // mainnet xpub
const TPUB_VERSION = '043587cf'; // testnet/signet tpub

const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));

/** The 33-byte compressed pubkey inside a serialized xpub/tpub. */
function xpubPubkey(xpub: string): Uint8Array {
  const bytes = base58check.decode(xpub);
  if (bytes.length !== 78) throw new Error('Not a valid extended public key.');
  return bytes.slice(45, 78);
}

/**
 * Liana-style unspendable internal xpub for a vault whose tap tree contains
 * `keys` — MUST be passed in tap-tree order (leaf by leaf, keys as written),
 * because the chain code commits to that exact sequence.
 */
export function unspendableInternalKey(keys: KeyOrigin[]): string {
  if (keys.length === 0) throw new Error('An unspendable key needs the vault keys.');
  const testnet = keys.some((k) => k.xpub.startsWith('tpub'));

  const concat = new Uint8Array(keys.length * 33);
  keys.forEach((k, i) => concat.set(xpubPubkey(k.xpub), i * 33));
  const chainCode = sha256(concat);

  const raw = new Uint8Array(78);
  raw.set(hexBytes(testnet ? TPUB_VERSION : XPUB_VERSION), 0);
  // depth 0, parent fingerprint 00000000, child number 0 — a "master" key.
  raw.set(chainCode, 13);
  raw[45] = 0x02;
  raw.set(hexBytes(NUMS_X), 46);
  return base58check.encode(raw);
}

/**
 * Is this taproot INTERNAL key provably unspendable? (Decided
 * 2026-09-26.)
 *
 * An origin-less internal key used to be ASSUMED to be Liana's NUMS key and
 * left out of every summary of who can spend. A descriptor someone else wrote
 * can put their own xpub there with no origin: it then looks exactly like a
 * NUMS key while that one key spends every coin alone through the key path.
 * So unspendability is PROVEN, never assumed.
 *
 * Proof: the key's point has BIP-341's H as its x coordinate. Nobody knows a
 * discrete logarithm for H, and every unhardened BIP-32 child of an xpub
 * whose key is H is H plus a public tweak, so nobody knows one for any child
 * either. The chain code does not matter for this (Liana's commitment to the
 * tree keys only keeps the key from being recognisable on-chain), which is
 * why vaults Talia built before it adopted Liana's chain code pass too.
 *
 * Accepted forms: an xpub/tpub (with or without origin, with any unhardened
 * derivation after it) whose key is H, or H written as a raw 32-byte x-only
 * key or a 33-byte compressed key. Anything else, including a key that might
 * be H plus a secret multiple of G (unprovable without the secret), is a
 * real signer.
 */
export function isProvablyUnspendableKey(keyExpr: string): boolean {
  const expr = keyExpr.trim().replace(/^\[[^\]]*\]/, '');
  const raw = /^([0-9a-fA-F]{64}|0[23][0-9a-fA-F]{64})$/.exec(expr);
  if (raw) return raw[1].slice(-64).toLowerCase() === NUMS_X;
  const m = /^([xt]pub[1-9A-HJ-NP-Za-km-z]{100,112})((?:\/(?:\d+|\*|<\d+;\d+>))*)$/.exec(expr);
  if (!m) return false;
  try {
    const pub = xpubPubkey(m[1]);
    let hex = '';
    for (let i = 1; i < 33; i++) hex += pub[i].toString(16).padStart(2, '0');
    return (pub[0] === 0x02 || pub[0] === 0x03) && hex === NUMS_X;
  } catch {
    return false;
  }
}
