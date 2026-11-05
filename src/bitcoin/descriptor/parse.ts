/**
 * Pure-TypeScript descriptor classifier and previewer.
 *
 * Goal: given a descriptor string pasted/scanned/imported by the user, work out
 * enough about it to (a) route the import, (b) show a human-readable summary,
 * and (c) reject unsafe input (private keys in a watch-only wallet). This does
 * NOT re-implement descriptor semantics — BDK parses and derives for real when
 * the wallet is created. Keeping this layer pure keeps it unit-testable without
 * native modules.
 */
import type {
  DescriptorKind,
  KeyOrigin,
  Network,
  ParsedDescriptor,
  ScriptType,
  Timelock,
} from './types';

/** Extended-key version prefixes grouped by network. */
const MAINNET_PREFIXES = ['xpub', 'ypub', 'zpub', 'Ypub', 'Zpub', 'xprv', 'yprv', 'zprv', 'Yprv', 'Zprv'];
const TESTNET_PREFIXES = ['tpub', 'upub', 'vpub', 'Upub', 'Vpub', 'tprv', 'uprv', 'vprv', 'Uprv', 'Vprv'];
const PRIVATE_PREFIXES = ['xprv', 'yprv', 'zprv', 'Yprv', 'Zprv', 'tprv', 'uprv', 'vprv', 'Uprv', 'Vprv'];

/** Matches `[fingerprint/origin]` key origin blocks. */
const ORIGIN_RE = /\[([0-9a-fA-F]{8})((?:\/[0-9]+['hH]?)*)\]/;

/** Matches an extended key with an optional origin prefix and trailing path. */
const KEY_RE =
  /(\[[0-9a-fA-F]{8}(?:\/[0-9]+['hH]?)*\])?([xyztuvYZUV](?:pub|prv)[1-9A-HJ-NP-Za-km-z]{50,120})((?:\/[<>0-9;*'hH]+)*)/g;

/** Matches `older(N)` / `after(N)` timelock fragments in miniscript. */
const OLDER_RE = /older\((\d+)\)/g;
const AFTER_RE = /after\((\d+)\)/g;

/** Split a descriptor into its body and optional `#checksum`. */
export function stripChecksum(raw: string): { body: string; checksum?: string } {
  const trimmed = raw.trim();
  const hashIdx = trimmed.lastIndexOf('#');
  // A valid BIP-380 checksum is 8 chars of the charset and terminal.
  if (hashIdx !== -1 && /^#[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8}$/.test(trimmed.slice(hashIdx))) {
    return { body: trimmed.slice(0, hashIdx), checksum: trimmed.slice(hashIdx + 1) };
  }
  return { body: trimmed };
}

// --- BIP-380 descriptor checksum ------------------------------------------------

const INPUT_CHARSET =
  '0123456789()[],\'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#"\\ ';
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
// The 40-bit generator constants, as plain numbers: a 40-bit value is exact
// in a double, and XOR is done on the two halves (no BigInt on the device).
const GENERATOR = [0xf5dee51989, 0xa9fdca3312, 0x1bab10e32d, 0x3706b1677a, 0x644d626ffd];
const TWO32 = 2 ** 32;
const xor40 = (a: number, b: number): number =>
  ((Math.floor(a / TWO32) ^ Math.floor(b / TWO32)) >>> 0) * TWO32 + (((a >>> 0) ^ (b >>> 0)) >>> 0);

function polymod(c: number, val: number): number {
  const c0 = Math.floor(c / 2 ** 35);
  let out = xor40((c % 2 ** 35) * 32, val);
  for (let i = 0; i < 5; i++) if ((c0 >> i) & 1) out = xor40(out, GENERATOR[i]);
  return out;
}

/**
 * The BIP-380 checksum of a descriptor body (no `#`), or null when the body
 * holds a character the descriptor alphabet does not. Pure encoding, the
 * reference algorithm from BIP-380 (decided 2026-09-26).
 */
export function descriptorChecksum(body: string): string | null {
  let c = 1;
  let cls = 0;
  let clscount = 0;
  for (const ch of body) {
    const pos = INPUT_CHARSET.indexOf(ch);
    if (pos === -1) return null;
    c = polymod(c, pos & 31);
    cls = cls * 3 + (pos >> 5);
    if (++clscount === 3) {
      c = polymod(c, cls);
      cls = 0;
      clscount = 0;
    }
  }
  if (clscount > 0) c = polymod(c, cls);
  for (let i = 0; i < 8; i++) c = polymod(c, 0);
  c = xor40(c, 1);
  let out = '';
  for (let j = 0; j < 8; j++) out += CHECKSUM_CHARSET[Math.floor(c / 2 ** (5 * (7 - j))) % 32];
  return out;
}

/**
 * False only when the descriptor CARRIES a checksum and it does not match its
 * body: the string was changed or damaged after the checksum was written. No
 * checksum at all is not a mismatch (Talia composes without one, and BIP-380
 * makes it optional). Checked over the ORIGINAL body, before any multipath
 * split, which is where the checksum was computed.
 */
export function checksumMatches(raw: string): boolean {
  const { body, checksum } = stripChecksum(raw);
  if (!checksum) return true;
  return descriptorChecksum(body) === checksum;
}

/** Detect the target network from extended-key version bytes. */
export function detectNetwork(body: string): Network | undefined {
  // testnet/signet/regtest all use the same tpub-family prefixes, so we can only
  // narrow to "testnet-family" here; the exact one is chosen at import time.
  for (const p of TESTNET_PREFIXES) {
    if (body.includes(p)) return 'testnet';
  }
  for (const p of MAINNET_PREFIXES) {
    if (body.includes(p)) return 'bitcoin';
  }
  return undefined;
}

/** Determine the outermost script context. */
export function detectScriptType(body: string): ScriptType {
  if (body.startsWith('tr(')) return 'tr';
  if (body.startsWith('wpkh(')) return 'wpkh';
  if (body.startsWith('pkh(')) return 'pkh';
  if (body.startsWith('sh(wpkh(')) return 'sh-wpkh';
  if (body.startsWith('sh(wsh(')) return 'sh-wsh';
  if (body.startsWith('wsh(')) return 'wsh';
  if (body.startsWith('sh(')) return 'sh';
  return 'unknown';
}

/** True if the descriptor carries any private-key material. */
export function containsPrivateKeys(body: string): boolean {
  if (PRIVATE_PREFIXES.some((p) => body.includes(p))) return true;
  // Bare WIF keys (mainnet 5/K/L, testnet 9/c) inside descriptors are rare but
  // must also be treated as private material. Heuristic: a WIF-length base58
  // token that is not an xpub-family key.
  return /(^|[(,])([5KL9c][1-9A-HJ-NP-Za-km-z]{50,51})($|[),])/.test(body);
}

/** Extract all key origins (xpubs with optional fingerprint/derivation). */
export function parseKeyOrigins(body: string): KeyOrigin[] {
  const keys: KeyOrigin[] = [];
  let m: RegExpExecArray | null;
  KEY_RE.lastIndex = 0;
  while ((m = KEY_RE.exec(body)) !== null) {
    const [, origin, xpub, keyPath] = m;
    const key: KeyOrigin = { xpub };
    if (origin) {
      const om = ORIGIN_RE.exec(origin);
      if (om) {
        key.fingerprint = om[1].toLowerCase();
        key.originPath = om[2] ? om[2].replace(/^\//, '') : undefined;
      }
    }
    if (keyPath) key.keyPath = keyPath.replace(/^\//, '');
    keys.push(key);
  }
  return keys;
}

/** Collect all relative/absolute timelocks present in miniscript fragments. */
export function parseTimelocks(body: string): Timelock[] {
  const locks: Timelock[] = [];
  let m: RegExpExecArray | null;
  OLDER_RE.lastIndex = 0;
  while ((m = OLDER_RE.exec(body)) !== null) {
    locks.push({ type: 'relative', value: Number(m[1]) });
  }
  AFTER_RE.lastIndex = 0;
  while ((m = AFTER_RE.exec(body)) !== null) {
    locks.push({ type: 'absolute', value: Number(m[1]) });
  }
  return locks;
}

/**
 * Extract `(m, n)` from a simple, single top-level multisig descriptor
 * (`multi`, `sortedmulti`, `multi_a`). Returns undefined for miniscript policies
 * with multiple/threshold branches, where a single m-of-n is not meaningful.
 */
export function parseMultisig(body: string): { threshold: number; totalKeys: number } | undefined {
  const match = /(?:sortedmulti|multi_a|multi)\(/.exec(body);
  if (!match) return undefined;
  const open = match.index + match[0].length - 1; // index of '('
  const inner = extractBalanced(body, open);
  if (inner === undefined) return undefined;
  const args = splitTopLevel(inner);
  if (args.length < 2) return undefined;
  const threshold = Number(args[0]);
  if (!Number.isInteger(threshold)) return undefined;
  return { threshold, totalKeys: args.length - 1 };
}

/** Classify the wallet kind from the accumulated signals. */
export function classify(
  scriptType: ScriptType,
  hasMultisig: boolean,
  timelocks: Timelock[],
  keyCount: number,
): DescriptorKind {
  // Timelocks are the defining trait of Liana-style recovery wallets.
  if (timelocks.length > 0) return 'miniscript';
  if (hasMultisig) return 'multisig';
  if (scriptType === 'wpkh' || scriptType === 'pkh' || scriptType === 'sh-wpkh') return 'single-sig';
  if (scriptType === 'tr' && keyCount <= 1) return 'single-sig';
  if (scriptType === 'unknown') return 'unknown';
  // wsh/tr wrapping a single key with no multi and no timelock → single-sig.
  return keyCount > 1 ? 'multisig' : 'single-sig';
}

/**
 * Parse and classify a descriptor string. Throws only on empty input; anything
 * else yields a best-effort ParsedDescriptor (with kind 'unknown' if opaque).
 */
export function parseDescriptor(raw: string): ParsedDescriptor {
  if (!raw || !raw.trim()) {
    throw new Error('Empty descriptor');
  }
  const { body, checksum } = stripChecksum(raw);
  const scriptType = detectScriptType(body);
  const keys = parseKeyOrigins(body);
  const timelocks = parseTimelocks(body);
  const multi = parseMultisig(body);
  const hasMultisig = multi !== undefined;
  const kind = classify(scriptType, hasMultisig, timelocks, keys.length);

  return {
    raw: raw.trim(),
    body,
    checksum,
    kind,
    scriptType,
    network: detectNetwork(body),
    keys,
    threshold: multi?.threshold,
    totalKeys: multi?.totalKeys,
    timelocks,
    isMultipath: /<\s*\d+\s*;\s*\d+\s*>/.test(body),
    containsPrivateKeys: containsPrivateKeys(body),
  };
}

// --- small parenthesis helpers -------------------------------------------------

/** Return the substring inside the parentheses starting at `openIdx` ('('). */
export function extractBalanced(s: string, openIdx: number): string | undefined {
  if (s[openIdx] !== '(') return undefined;
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return s.slice(openIdx + 1, i);
    }
  }
  return undefined;
}

/** Split a comma-separated argument list, ignoring commas inside nested (). */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}
