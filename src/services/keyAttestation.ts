/**
 * The per-key proof of 21st Capital's keys (decided 2026-09-26).
 * Pure, no I/O.
 *
 * THE PROBLEM. Talia builds a vault on whatever co-signer and rescue xpub
 * the backend hands over, and one superuser can rewrite a pool key's xpub in
 * the database. A swapped RESCUE key would let whoever swapped it spend those
 * vaults alone once the timelock opens. issuedKeyPins.ts proves the seed's
 * FINGERPRINT, which is a label: it cannot tie the xpub to the seed, because
 * the account key is hardened.
 *
 * THE PROOF. The hardware wallet that holds each 21C seed signs, once per
 * pool file, a short manifest (BIP-137, P2PKH, at m/44'/coin'/99'/0/0) whose
 * last line is the root of a Merkle tree (RFC 9162) over every key in the
 * file. The backend keeps that signature plus each key's audit path and
 * serves them with the key. Here the app rebuilds the key's leaf from the
 * key it was handed, walks the path to the root, recovers the signer from
 * the signature and compares the signer's address with the address PINNED
 * in the app for that (network, purpose, seed), which was read off the
 * device's own screen. Nothing the server says about purpose, network or
 * account is taken from the proof: those come from the slot, the vault and
 * the key itself.
 *
 * The encoding and the order of the checks are shared byte for byte with the
 * 21st Capital's key tooling and the backend. The golden vectors
 * in __tests__/fixtures (the shared key-proof-vectors.json, a copy of
 * the tooling's own set, and Talia's own key-proof-vectors.talia.json) were
 * made with that tooling and are never regenerated.
 *
 * What the switches in keyAttestationPins.ts do with a result is decided by
 * judgeKeyProof below. Until a mode is turned on, nothing here changes what
 * a client sees.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base64, createBase58check, hex } from '@scure/base';
import {
  KEY_ATTESTATION_PINS,
  KEY_PROOF_MODE,
  KEY_PROOF_REQUIRED,
} from './keyAttestationPins';
import type {
  AttestationPins,
  KeyProofMode,
  ProofNet,
  ProofPurpose,
} from './keyAttestationPins';

const base58check = createBase58check(sha256);

export const PROOF_FORMAT = '21c-key-proof-v1';
/** A tree of 2^32 keys needs 32 hashes; nothing longer is read. */
export const MAX_PROOF_PATH = 32;
/** Accounts are hardened indexes: nothing above 2^31 - 1. */
export const MAX_ACCOUNT = 0x7fffffff;
/** A proof object has exactly these fields. */
const PROOF_FIELDS = ['format', 'index', 'manifest', 'path', 'signature'];
const COIN: Readonly<Record<ProofNet, number>> = { mainnet: 0, testnet4: 1 };

export type ProofStatus = 'verified' | 'unpinned' | 'missing' | 'invalid';
export type ProofCode =
  | 'PROOF_FORMAT'
  | 'PROOF_MANIFEST'
  | 'PROOF_PURPOSE'
  | 'PROOF_NETWORK'
  | 'PROOF_SEED'
  | 'PROOF_KEY_SHAPE'
  | 'PROOF_ACCOUNT_RANGE'
  | 'PROOF_INDEX'
  | 'PROOF_PATH'
  | 'PROOF_SIGNATURE'
  | 'PROOF_WRONG_KEY';

/** `code` is set for `invalid` only; unpinned and missing are statuses. */
export interface KeyProofResult {
  status: ProofStatus;
  code: ProofCode | null;
}

/** The key as served: fingerprint (lowercase), origin path, xpub as stored. */
export interface ProvenKey {
  fingerprint: string;
  originPath: string;
  xpub: string;
}

// ------------------------------------------------------------- the tree ---

/** One key's leaf: seven fixed lines, joined by "\n", no trailing newline. */
export function leafBytes(
  row: { account: number; fingerprint: string; xpub: string },
  purpose: ProofPurpose,
  coin: number,
): Uint8Array {
  const a = row.account;
  return utf8ToBytes(
    [
      '21C pool leaf v2',
      `purpose ${purpose}`,
      `chain 48'/${coin}'`,
      `account ${a}`,
      `seed ${row.fingerprint.toLowerCase()}`,
      `path 48'/${coin}'/${a}'/2'`,
      `xpub ${row.xpub}`,
    ].join('\n'),
  );
}

/** RFC 9162: leaf = SHA-256(0x00 || leaf), node = SHA-256(0x01 || L || R). */
export function leafHash(
  row: { account: number; fingerprint: string; xpub: string },
  purpose: ProofPurpose,
  coin: number,
): Uint8Array {
  return sha256(concatBytes(new Uint8Array([0]), leafBytes(row, purpose, coin)));
}

export function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concatBytes(new Uint8Array([1]), left, right));
}

/**
 * The root and every leaf's audit path in one bottom-up pass. A lone last
 * node moves up a level unchanged, which is RFC 9162's MTH (the last node is
 * never duplicated). Used by the tests and by anyone building a proof.
 */
export function merkleTree(leaves: readonly Uint8Array[]): { root: Uint8Array; paths: Uint8Array[][] } {
  if (leaves.length === 0) throw new Error('a tree needs at least one leaf');
  const paths: Uint8Array[][] = leaves.map(() => []);
  let level: { hash: Uint8Array; members: number[] }[] = leaves.map((h, i) => ({ hash: h, members: [i] }));
  while (level.length > 1) {
    const next: typeof level = [];
    for (let j = 0; j < level.length; j += 2) {
      const left = level[j];
      const right = level[j + 1];
      if (!right) {
        next.push(left);
        continue;
      }
      for (const i of left.members) paths[i].push(right.hash);
      for (const i of right.members) paths[i].push(left.hash);
      next.push({ hash: nodeHash(left.hash, right.hash), members: [...left.members, ...right.members] });
    }
    level = next;
  }
  return { root: level[0].hash, paths };
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** RFC 9162 section 2.1.3.2: is `leaf` at `index` of a tree of `size` under `root`? */
export function verifyAuditPath(
  leaf: Uint8Array,
  index: number,
  size: number,
  path: readonly Uint8Array[],
  root: Uint8Array,
): boolean {
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(size)) return false;
  if (index < 0 || index >= size || path.length > MAX_PROOF_PATH) return false;
  // fn and sn stay below 2^34 here (size is at most 10 digits), so plain
  // division is exact where 32-bit shifts would not be.
  let fn = index;
  let sn = size - 1;
  let r = leaf;
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      r = nodeHash(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && equalBytes(r, root);
}

// --------------------------------------------------------- the manifest ---

export interface ManifestV2 {
  purpose: ProofPurpose;
  seed: string;
  coin: number;
  first: number;
  last: number;
  count: number;
  root: Uint8Array;
}

const DEC = '(0|[1-9][0-9]{0,9})';
const MANIFEST_V2 = new RegExp(
  '^21C key pool v2\\n' +
    'purpose (cosigner|rescue)\\n' +
    'seed ([0-9a-f]{8})\\n' +
    `chain 48'/${DEC}'\\n` +
    `accounts ${DEC}-${DEC}\\n` +
    `keys ${DEC}\\n` +
    'root ([0-9a-f]{64})$',
);

/**
 * The strict v2 manifest (ASCII, seven lines in order, no trailing newline,
 * decimals without leading zeros, lowercase hex, count == last - first + 1,
 * last <= 2^31 - 1), else null. The chain's coin is read as written: a coin
 * that is not the vault's is the caller's PROOF_NETWORK, not a bad manifest.
 */
export function parseManifestV2(text: unknown): ManifestV2 | null {
  if (typeof text !== 'string') return null;
  const m = MANIFEST_V2.exec(text);
  if (!m) return null;
  const coin = Number(m[3]);
  const first = Number(m[4]);
  const last = Number(m[5]);
  const count = Number(m[6]);
  if (first > last || last > MAX_ACCOUNT || count !== last - first + 1) return null;
  return { purpose: m[1] as ProofPurpose, seed: m[2], coin, first, last, count, root: hex.decode(m[7]) };
}

// -------------------------------------------------------- the signature ---

function varint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, n >> 8]);
  return new Uint8Array([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
}

/** BIP-137 "Bitcoin Signed Message" hash of a text. */
export function messageHash(message: string): Uint8Array {
  const m = utf8ToBytes(message);
  const data = concatBytes(utf8ToBytes('\x18Bitcoin Signed Message:\n'), varint(m.length), m);
  return sha256(sha256(data));
}

/**
 * The compressed public key behind a BIP-137 signature (base64, 65 bytes:
 * header 27-42, r, s). High-S is refused. Throws on anything else, as the
 * tools' recover_pubkey does.
 */
export function recoverSigner(message: string, signatureB64: string): Uint8Array {
  const sig = base64.decode(signatureB64);
  if (sig.length !== 65) throw new Error('signature must be 65 bytes');
  const header = sig[0];
  if (header < 27 || header > 42) throw new Error('unknown signature header');
  const recovery = (header - 27) & 3;
  const parsed = secp256k1.Signature.fromCompact(sig.slice(1)).addRecoveryBit(recovery);
  if (parsed.hasHighS()) throw new Error('high-S signature refused');
  return parsed.recoverPublicKey(messageHash(message)).toRawBytes(true);
}

export function p2pkhAddress(pubkey: Uint8Array, coin: number): string {
  const version = coin === 0 ? 0x00 : 0x6f;
  return base58check.encode(concatBytes(new Uint8Array([version]), ripemd160(sha256(pubkey))));
}

/** A pin counts only as a P2PKH address of its own network. */
export function isPinAddress(pin: unknown, coin: number): pin is string {
  if (typeof pin !== 'string' || !pin.trim()) return false;
  try {
    const raw = base58check.decode(pin.trim());
    return raw.length === 21 && raw[0] === (coin === 0 ? 0x00 : 0x6f);
  } catch {
    return false;
  }
}

/**
 * The pinned address for (network, purpose, seed), or null when not pinned.
 * The seed is matched in lower case; a pin that is not a P2PKH address of
 * that network (a placeholder "", a typo, the other network's) reads as no
 * pin at all. Surrounding spaces are trimmed.
 */
export function pinFor(
  pins: AttestationPins,
  network: ProofNet,
  purpose: ProofPurpose,
  seed: string,
): string | null {
  const table = pins[network]?.[purpose];
  if (!table || typeof table !== 'object') return null;
  for (const [k, v] of Object.entries(table)) {
    if (k.toLowerCase() === seed && isPinAddress(v, COIN[network])) return v.trim();
  }
  return null;
}

// ------------------------------------------------------------ the check ---

const ORIGIN = /^48'\/(0|[1-9][0-9]{0,9})'\/(0|[1-9][0-9]{0,9})'\/2'$/;
/** Base58 only, at most 120 characters (a real xpub has 111): no space and
 *  no newline, nothing that could change the shape of a leaf. */
const XPUB_TEXT = /^[1-9A-HJ-NP-Za-km-z]{1,120}$/;
const HASH_HEX = /^[0-9a-f]{64}$/;

const invalid = (code: ProofCode): KeyProofResult => ({ status: 'invalid', code });

/**
 * The seven steps of the contract, in the tooling's order (check_key_proof in
 * 21st Capital's key tooling; the first failure decides the code, and both golden sets
 * hold the two to the same answers). `account` is the account the server
 * named for this vault (optional; the key's origin path decides, and the two
 * must agree). `proof` is the raw `proof` field: null or absent is
 * `missing`; anything else that is not a good proof is `invalid`.
 *
 *   key fields          PROOF_KEY_SHAPE, PROOF_NETWORK (origin on another chain)
 *   proof object        PROOF_FORMAT (exactly five fields, the format, the types)
 *   manifest            PROOF_MANIFEST
 *   purpose/chain/seed  PROOF_PURPOSE, PROOF_NETWORK, PROOF_SEED
 *   range, index        PROOF_ACCOUNT_RANGE, PROOF_INDEX
 *   inclusion           PROOF_PATH
 *   signature           PROOF_SIGNATURE
 *   pin                 unpinned, or PROOF_WRONG_KEY
 */
export function checkKeyProof(input: {
  key: ProvenKey;
  proof: unknown;
  network: ProofNet;
  purpose: ProofPurpose;
  account?: number | null;
  pins?: AttestationPins;
}): KeyProofResult {
  const { key, proof, network, purpose } = input;
  const pins = input.pins ?? KEY_ATTESTATION_PINS;
  const coin = COIN[network];
  if (coin === undefined) return invalid('PROOF_NETWORK');
  if (proof === null || proof === undefined) return { status: 'missing', code: null };

  // 1. What the proof must be about comes from the key and the slot: the
  //    account from the origin path (which must be canonical and on this
  //    vault's chain), and the server's account must be that same number.
  const om = typeof key.originPath === 'string' ? ORIGIN.exec(key.originPath) : null;
  if (!om) return invalid('PROOF_KEY_SHAPE');
  if (Number(om[1]) !== coin) return invalid('PROOF_NETWORK');
  const account = Number(om[2]);
  if (account > MAX_ACCOUNT) return invalid('PROOF_KEY_SHAPE');
  if (input.account != null && input.account !== account) return invalid('PROOF_KEY_SHAPE');
  const fp = typeof key.fingerprint === 'string' ? key.fingerprint.toLowerCase() : '';
  if (!/^[0-9a-f]{8}$/.test(fp)) return invalid('PROOF_KEY_SHAPE');
  if (typeof key.xpub !== 'string' || !XPUB_TEXT.test(key.xpub)) return invalid('PROOF_KEY_SHAPE');

  // 2. Format (exactly the five fields, their types) and the strict manifest.
  if (typeof proof !== 'object' || Array.isArray(proof)) return invalid('PROOF_FORMAT');
  const p = proof as Record<string, unknown>;
  if (Object.keys(p).sort().join() !== PROOF_FIELDS.join()) return invalid('PROOF_FORMAT');
  if (p.format !== PROOF_FORMAT || typeof p.manifest !== 'string') return invalid('PROOF_FORMAT');
  if (typeof p.signature !== 'string' || !Array.isArray(p.path)) return invalid('PROOF_FORMAT');
  if (typeof p.index !== 'number' || !Number.isInteger(p.index)) return invalid('PROOF_FORMAT');
  const manifest = parseManifestV2(p.manifest);
  if (!manifest) return invalid('PROOF_MANIFEST');

  // 3. Purpose, chain and seed.
  if (manifest.purpose !== purpose) return invalid('PROOF_PURPOSE');
  if (manifest.coin !== coin) return invalid('PROOF_NETWORK');
  if (manifest.seed !== fp) return invalid('PROOF_SEED');

  // 4. The key's place in the signed range.
  if (account < manifest.first || account > manifest.last) return invalid('PROOF_ACCOUNT_RANGE');
  if (p.index !== account - manifest.first) return invalid('PROOF_INDEX');

  // 5. Inclusion under the signed root.
  const rawPath = p.path as unknown[];
  if (rawPath.length > MAX_PROOF_PATH) return invalid('PROOF_PATH');
  if (!rawPath.every((h) => typeof h === 'string' && HASH_HEX.test(h))) return invalid('PROOF_PATH');
  const leaf = leafHash({ account, fingerprint: fp, xpub: key.xpub }, purpose, coin);
  const path = (rawPath as string[]).map((h) => hex.decode(h));
  if (!verifyAuditPath(leaf, p.index, manifest.count, path, manifest.root)) return invalid('PROOF_PATH');

  // 6. Who signed the manifest.
  let address: string;
  try {
    address = p2pkhAddress(recoverSigner(p.manifest, p.signature), coin);
  } catch {
    return invalid('PROOF_SIGNATURE');
  }

  // 7. Is that the device pinned for this seed?
  const pin = pinFor(pins, network, purpose, fp);
  if (!pin) return { status: 'unpinned', code: null };
  if (address !== pin) return invalid('PROOF_WRONG_KEY');
  return { status: 'verified', code: null };
}

// ------------------------------------------------------- the switches -----

export interface KeyProofPolicy {
  mode: Readonly<Record<ProofNet, KeyProofMode>>;
  required: Readonly<Record<ProofNet, Readonly<Record<ProofPurpose, boolean>>>>;
  pins: AttestationPins;
}

/** What this build does: as keyAttestationPins.ts sets it. */
export const KEY_PROOF_POLICY: KeyProofPolicy = {
  mode: KEY_PROOF_MODE,
  required: KEY_PROOF_REQUIRED,
  pins: KEY_ATTESTATION_PINS,
};

/** A value that is not off or enforce reads as report, which never refuses. */
export function proofModeFor(policy: KeyProofPolicy, network: ProofNet): KeyProofMode {
  const m = policy.mode[network] as string | undefined;
  return m === 'off' || m === 'enforce' ? m : 'report';
}

export interface KeyProofVerdict {
  /** Null when the mode is off: the proof was not looked at. */
  result: KeyProofResult | null;
  /** True only when this vault must not be built on the key. */
  refuse: boolean;
  /** One diagnostic line (never an xpub), or null when there is nothing to say. */
  note: string | null;
}

/**
 * The mode matrix for one issued key.
 *  - off: not checked.
 *  - report: checked; anything but verified gives a note, nothing refuses.
 *  - enforce: an INVALID proof refuses. A missing or unpinned one refuses only
 *    when KEY_PROOF_REQUIRED is on for that network and purpose.
 */
export function judgeKeyProof(input: {
  key: ProvenKey;
  proof: unknown;
  network: ProofNet;
  purpose: ProofPurpose;
  account?: number | null;
  policy?: KeyProofPolicy;
}): KeyProofVerdict {
  const policy = input.policy ?? KEY_PROOF_POLICY;
  const mode = proofModeFor(policy, input.network);
  if (mode === 'off') return { result: null, refuse: false, note: null };
  const result = checkKeyProof({ ...input, pins: policy.pins });
  if (result.status === 'verified') return { result, refuse: false, note: null };
  const note = `${input.purpose} key proof ${result.status}${result.code ? ` (${result.code})` : ''}`;
  if (mode !== 'enforce') return { result, refuse: false, note };
  const required = policy.required[input.network]?.[input.purpose] === true;
  return { result, refuse: result.status === 'invalid' || required, note };
}

// ------------------------------------------------------------- words ------

/**
 * What a client reads about this, in both languages. Titles only on
 * dialogs (the dialog rule); no em dash; every sentence holds for any vault shape
 * (one of our keys or two, a vault of one's own plan or of someone else's).
 * German says "Vault" whenever a vault is named.
 */
export const KEY_PROOF_COPY = {
  en: {
    /** The builder's refusal of the keys it was handed, for any reason,
     *  once the proof check is enforced (keyCheckFailedTitle). */
    checkFailedTitle: 'The 21st Capital key check did not pass',
    /** Today's refusal title, word for word. It stays until the pins file switches the
     *  proof check to enforce for the network: nothing a client reads may
     *  change before then (decided 2026-10-06). */
    checkFailedTitleBeforeEnforce: 'Your 21st Capital keys could not be verified',
    /** Keys withheld until their proof is in (backend enforce): the keys
     *  exist but are not handed over yet, so "not assigned" would be untrue. */
    proofPendingMessage:
      'The 21st Capital team has been notified and will have them ready shortly. ' +
      'Check back here in a little while.',
    /** The later "proven" mark on the key check (enforce only). */
    provenMark: 'Confirmed by our key device',
  },
  de: {
    checkFailedTitle: 'Die Prüfung der Schlüssel von 21st Capital ist fehlgeschlagen',
    proofPendingMessage:
      'Das Team von 21st Capital ist informiert und stellt sie in Kürze bereit. ' +
      'Schauen Sie bitte bald wieder hier vorbei.',
    provenMark: 'Von unserem Schlüsselgerät bestätigt',
  },
} as const;

/**
 * The title the builder shows when it refuses the keys it was handed (the
 * fingerprint checks or, with enforce, the proof). Today's title until the
 * proof check is enforced for this network; a misspelt mode reads as report
 * and keeps today's title too.
 */
export function keyCheckFailedTitle(network: ProofNet, policy: KeyProofPolicy = KEY_PROOF_POLICY): string {
  return proofModeFor(policy, network) === 'enforce'
    ? KEY_PROOF_COPY.en.checkFailedTitle
    : KEY_PROOF_COPY.en.checkFailedTitleBeforeEnforce;
}
