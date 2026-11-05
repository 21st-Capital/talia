/**
 * Encrypted descriptor backups, byte compatible with Liana (decided 2026-08-29).
 *
 * A plain descriptor QR hands the whole vault to anyone who photographs the
 * screen: not the coins, which stay watch-only, but the balance, every address
 * and the signing policy, forever. This seals it so only someone who ALREADY
 * holds one of the vault's own account keys can open it, with no password to
 * agree on and nothing extra to remember.
 *
 * WHICH FORMAT THIS IS, because there are two and picking the wrong one means
 * files that do not open. The scheme is heading for BIP-138, "Compact
 * Encryption Scheme for Non-seed Wallet Data", still a draft. Liana ships the
 * `bitcoin-encrypted-backup` crate pinned at 0.0.2, which implements an
 * EARLIER revision, and that is what this file implements, because
 * compatibility with the wallet our clients actually use beats agreement with
 * a draft that is still moving. The differences are not cosmetic:
 *
 *                        shipped 0.0.2 (here)      current draft
 *   magic                "BEB"                     "BIP138"
 *   keys                 33-byte compressed        32-byte x-only
 *   hash                 sha256(tag ‖ data)        BIP340 tagged hash
 *   cipher               AES-256-GCM               ChaCha20-Poly1305
 *
 * Verified end to end against a .bed file written by bitcoin-encrypted-backup
 * 0.0.2, the library Liana wrote its .bed backups with up to v15.0, for a
 * test vault of a made-up key (BIP-32 test vector 1) and 21st Capital's
 * testnet co-signer and rescue keys (public keys). It is in the fixtures: the
 * test decrypts it and gets its descriptor back, checksum and all.
 *
 * Liana v16.0 moved its EXPORT to the newer draft (`.bip138` files) and still
 * reads `.bed`. `parseBackup` and `openBackup` read both, the newer one
 * through `bip138Backup.ts`; this file still WRITES `.bed`, which every Liana
 * and every Talia in clients' hands opens (decided 2026-11-05, reasons there).
 *
 * HOW IT WORKS, since the scheme is unusual and worth understanding:
 *   · every allowed key in the descriptor becomes its 33-byte compressed
 *     public key, and those are SORTED;
 *   · s   = sha256("BEB_BACKUP_DECRYPTION_SECRET" ‖ k1 ‖ … ‖ kn) encrypts the
 *     payload, once;
 *   · s_i = sha256("BEB_BACKUP_INDIVIDUAL_SECRET" ‖ k_i), and the file carries
 *     c_i = s XOR s_i for each participant.
 * Anyone holding k_i recomputes s_i, XORs it into c_i, and recovers s. Nothing
 * in the file names a participant, so it never says whose vault it is.
 *
 * WHAT IT DOES NOT PROTECT AGAINST, which the app must never overstate:
 * every "key" here is PUBLIC material (an xpub), so someone who already knows
 * one participant's xpub can open it, and so can anyone who knows the whole
 * descriptor. It is a "you must know a participant's xpub" gate, not a
 * password. Since 2026-09-30 (decided 2026-09-26) the app leaves 21st
 * Capital's keys OUT of the participants (`excludeFingerprints`): our xpubs
 * sit in our key pool, and before per-vault keys every app-built vault shared
 * one co-signer xpub that every other client could read off their own
 * descriptor. Backups made before that still open with our keys. A real
 * secret (a passphrase through a KDF) would break Liana's open-with-device
 * flow, which knows nothing of one; that is a decision still to be made.
 *
 * A key with NO trailing derivation is excluded on purpose: its root pubkey
 * would also be the on-chain pubkey, so one observed spend would hand the
 * secret to the world. The BIP341 NUMS point goes for the same reason, being a
 * published constant, and every taproot vault carries one.
 *
 * Pure: no storage, no network, no clock.
 */
import { gcm } from '@noble/ciphers/aes';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, randomBytes } from '@noble/hashes/utils';
import { base58check, base64 } from '@scure/base';

import { bip138Descriptor, isBip138, openBip138, parseBip138 } from './bip138Backup';

/** What Talia writes, what Liana wrote up to v15.0, and what Liana v16 still reads. */
export const MAGIC = new Uint8Array([0x42, 0x45, 0x42]); // "BEB"
export const BACKUP_VERSION = 1;
const ENC_AES_256_GCM = 0x01;
const NONCE_LEN = 12;
/** BIP-380: an output script descriptor. */
const BIP380 = 380;
const TAG_DECRYPTION = 'BEB_BACKUP_DECRYPTION_SECRET';
const TAG_INDIVIDUAL = 'BEB_BACKUP_INDIVIDUAL_SECRET';
/** The BIP341 NUMS point: a published constant, so never a participant. */
const NUMS_X = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function taggedSha(tag: string, ...parts: Uint8Array[]): Uint8Array {
  return sha256(concatBytes(utf8(tag), ...parts));
}

function xor(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

/** The 33-byte compressed public key of an extended key. */
export function compressedFromXpub(xpub: string): Uint8Array | null {
  try {
    const raw = base58check(sha256).decode(xpub.trim());
    return raw.length === 78 ? raw.slice(45, 78) : null;
  } catch {
    return null;
  }
}

/**
 * The participant keys of a descriptor: an extended key WITH a trailing
 * derivation step or wildcard, NUMS excluded. Sorted and deduplicated, which
 * is the order the secret is computed over.
 */
export function participantKeys(
  descriptor: string,
  /** Origin fingerprints whose keys must NOT open the file (21st Capital's,
   *  decided 2026-09-26). Lowercase or not; compared lowercased. */
  excludeFingerprints?: ReadonlySet<string>,
): Uint8Array[] {
  const found = new Map<string, Uint8Array>();
  const excluded = new Set([...(excludeFingerprints ?? [])].map((f) => f.toLowerCase()));
  const re = /(?:\[([0-9a-fA-F]{8})?[^\]]*\])?([xtuvyzUVYZ]pub[1-9A-HJ-NP-Za-km-z]+)((?:\/(?:\d+[h']?|\*|<[^>]*>))+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(descriptor)) !== null) {
    const [, fp, key, trailing] = m;
    if (!trailing) continue;
    if (fp && excluded.has(fp.toLowerCase())) continue;
    const c = compressedFromXpub(key);
    if (!c) continue;
    if (hex(c.slice(1)) === NUMS_X) continue;
    found.set(hex(c), c);
  }
  return [...found.values()].sort((a, b) => hex(a).localeCompare(hex(b)));
}


/**
 * The derivation paths this descriptor's keys came from, as BIP-32 child
 * arrays, ready to record in a backup.
 *
 * NOT optional in practice, whatever the spec says (found by testing,
 * 2026-08-29): Liana's decrypt-with-a-device flow asks the hardware
 * wallet for xpubs ONLY at the paths the file records. A backup with none is
 * unopenable there by device, which is exactly what happened to our first
 * export. The paths also carry the coin type, so they say which network the
 * vault is on.
 */
export function descriptorPaths(descriptor: string): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>();
  const re = /\[[0-9a-fA-F]{8}((?:\/\d+[h']?)+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(descriptor)) !== null) {
    const path = m[1].replace(/^\//, '');
    if (seen.has(path)) continue;
    seen.add(path);
    const children = path.split('/').map((part) => {
      const hardened = part.endsWith("'") || part.endsWith('h');
      const n = parseInt(hardened ? part.slice(0, -1) : part, 10);
      return hardened ? (n + 0x80000000) >>> 0 : n >>> 0;
    });
    if (children.every((c) => Number.isFinite(c))) out.push(children);
  }
  return out;
}

export function decryptionSecret(sortedKeys: readonly Uint8Array[]): Uint8Array {
  return taggedSha(TAG_DECRYPTION, ...sortedKeys);
}

export function individualSecret(key: Uint8Array): Uint8Array {
  return taggedSha(TAG_INDIVIDUAL, key);
}

// ─── varint ──────────────────────────────────────────────────────────────────

function writeVarInt(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n]);
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff]);
  const b = new Uint8Array(5);
  b[0] = 0xfe;
  new DataView(b.buffer).setUint32(1, n, true);
  return b;
}

function readVarInt(b: Uint8Array, i: number): { value: number; next: number } {
  const first = b[i];
  const view = new DataView(b.buffer, b.byteOffset);
  if (first < 0xfd) return { value: first, next: i + 1 };
  if (first === 0xfd) return { value: view.getUint16(i + 1, true), next: i + 3 };
  if (first === 0xfe) return { value: view.getUint32(i + 1, true), next: i + 5 };
  throw new Error('Backup value too large to read.');
}

// ─── the payload ─────────────────────────────────────────────────────────────

/** `<CONTENT_TYPE_LENGTH><BIP number><content>`; the content runs to the end. */
export function encodePayload(descriptor: string): Uint8Array {
  const bip = new Uint8Array(2);
  new DataView(bip.buffer).setUint16(0, BIP380, false);
  return concatBytes(new Uint8Array([2]), bip, utf8(descriptor));
}

/**
 * Talia's own content in the same sealed container (decided 2026-09-15: the vault's
 * name, key names and registrations must travel Talia to Talia). A proprietary
 * content type, which the format allows for any type longer than a BIP number,
 * so Liana refuses it rather than misreading it. The FILE backup never carries
 * it: that one has to open in Liana.
 */
const TALIA_CONTENT = utf8('TALIA');

/** `<5>TALIA<json>`: a Talia vault export, sealed like a descriptor. */
export function encodeTaliaPayload(json: string): Uint8Array {
  return concatBytes(new Uint8Array([TALIA_CONTENT.length]), TALIA_CONTENT, utf8(json));
}

/** The Talia vault export from a decrypted payload, or null for anything else. */
export function readTaliaPayload(payload: Uint8Array): string | null {
  if (payload[0] !== TALIA_CONTENT.length) return null;
  for (let i = 0; i < TALIA_CONTENT.length; i++) {
    if (payload[1 + i] !== TALIA_CONTENT[i]) return null;
  }
  return new TextDecoder().decode(payload.slice(1 + TALIA_CONTENT.length));
}

/** The descriptor from a decrypted payload, or null if it carries something else. */
export function readPayload(payload: Uint8Array): string | null {
  const typeLen = payload[0];
  if (typeLen !== 2) return null; // 0 = none, >2 = proprietary
  const bip = new DataView(payload.buffer, payload.byteOffset).getUint16(1, false);
  if (bip !== BIP380) return null;
  return new TextDecoder().decode(payload.slice(3));
}

// ─── the file ────────────────────────────────────────────────────────────────

export interface ParsedBackup {
  /** `.bed` (what this file writes, Liana up to v15) or `.bip138` (what
   *  Liana writes since v16), told apart by the magic. */
  format: 'bed' | 'bip138';
  paths: number[][];
  individualSecrets: Uint8Array[];
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Seal a descriptor. `decoys` rounds the visible participant count up so the
 * file does not announce how many keys the vault has.
 */
export function encryptBackup(
  descriptor: string,
  /** `content`: what to seal instead of the descriptor itself (a Talia vault
   *  export). The descriptor still decides whose keys open it. */
  opts: {
    paths?: number[][];
    decoys?: boolean;
    content?: Uint8Array;
    /** 21st Capital's key fingerprints: their keys are left out of the
     *  file, so a 21C xpub (which other people may know: the key pool, and
     *  the one co-signer key every early vault shared) never opens a
     *  client's backup (decided 2026-09-26). Liana still
     *  opens it with any of the client's own keys. */
    excludeFingerprints?: ReadonlySet<string>;
  } = {},
): Uint8Array {
  const keys = participantKeys(descriptor, opts.excludeFingerprints);
  if (keys.length === 0) {
    throw new Error(
      'This vault has no account key that can lock a backup. A key needs a derivation path for the backup to be safe.',
    );
  }
  const secret = decryptionSecret(keys);
  const secrets = keys.map((k) => xor(secret, individualSecret(k)));
  if (opts.decoys) {
    let bucket = 5;
    while (bucket < secrets.length && bucket < 255) bucket *= 2;
    const target = Math.min(bucket, 255);
    while (secrets.length < target) secrets.push(randomBytes(32));
  }
  secrets.sort((a, b) => hex(a).localeCompare(hex(b)));

  let nonce = randomBytes(NONCE_LEN);
  while (nonce.every((b) => b === 0)) nonce = randomBytes(NONCE_LEN);
  const ciphertext = gcm(secret, nonce).encrypt(opts.content ?? encodePayload(descriptor));

  const paths = opts.paths ?? [];
  const pathBytes: Uint8Array[] = [new Uint8Array([paths.length])];
  for (const p of paths) {
    const b = new Uint8Array(1 + p.length * 4);
    b[0] = p.length;
    const view = new DataView(b.buffer);
    p.forEach((child, i) => view.setUint32(1 + i * 4, child >>> 0, false));
    pathBytes.push(b);
  }

  return concatBytes(
    MAGIC,
    new Uint8Array([BACKUP_VERSION]),
    ...pathBytes,
    new Uint8Array([secrets.length]),
    ...secrets,
    new Uint8Array([ENC_AES_256_GCM]),
    nonce,
    writeVarInt(ciphertext.length),
    ciphertext,
  );
}

/** Read the container, either format. Returns null when this is not one. */
export function parseBackup(bytes: Uint8Array): ParsedBackup | null {
  if (isBip138(bytes)) {
    const newer = parseBip138(bytes);
    return newer ? { format: 'bip138', ...newer } : null;
  }
  try {
    if (bytes.length < MAGIC.length || !MAGIC.every((v, i) => bytes[i] === v)) return null;
    let i = MAGIC.length;
    if (bytes[i] !== BACKUP_VERSION) return null;
    i += 1;
    const pathCount = bytes[i];
    i += 1;
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const paths: number[][] = [];
    for (let p = 0; p < pathCount; p++) {
      const depth = bytes[i];
      i += 1;
      const path: number[] = [];
      for (let c = 0; c < depth; c++) {
        path.push(view.getUint32(i, false));
        i += 4;
      }
      paths.push(path);
    }
    const secretCount = bytes[i];
    i += 1;
    if (secretCount === 0) return null;
    const individualSecrets: Uint8Array[] = [];
    for (let s = 0; s < secretCount; s++) {
      individualSecrets.push(bytes.slice(i, i + 32));
      i += 32;
    }
    if (bytes[i] !== ENC_AES_256_GCM) return null;
    i += 1;
    const nonce = bytes.slice(i, i + NONCE_LEN);
    i += NONCE_LEN;
    const len = readVarInt(bytes, i);
    const ciphertext = bytes.slice(len.next, len.next + len.value);
    if (ciphertext.length === 0) return null;
    return { format: 'bed', paths, individualSecrets, nonce, ciphertext };
  } catch {
    return null;
  }
}

/** What a sealed backup holds once opened: a descriptor (Liana's files and
 *  the file backup) or a Talia vault export (Talia to Talia). */
export type OpenedBackup = { kind: 'descriptor'; descriptor: string } | { kind: 'talia'; json: string };

/**
 * Open a backup with one account key. Null when that key takes no part in the
 * vault, which is the only answer the format can give: it deliberately says
 * nothing about whose keys would work.
 */
export function openBackup(bytes: Uint8Array, xpub: string): OpenedBackup | null {
  const key = compressedFromXpub(stripKeyDecoration(xpub));
  if (!key) return null;
  if (isBip138(bytes)) {
    // Liana's .bip138 holds the descriptor as a BIP 380 item. Talia never
    // writes this format, so a Talia vault export cannot be inside one.
    const items = openBip138(bytes, key.slice(1));
    const descriptor = items ? bip138Descriptor(items) : null;
    return descriptor ? { kind: 'descriptor', descriptor } : null;
  }
  const backup = parseBackup(bytes);
  if (!backup) return null;
  const si = individualSecret(key);
  for (const ci of backup.individualSecrets) {
    try {
      const payload = gcm(xor(ci, si), backup.nonce).decrypt(backup.ciphertext);
      const descriptor = readPayload(payload);
      if (descriptor) return { kind: 'descriptor', descriptor };
      const json = readTaliaPayload(payload);
      if (json) return { kind: 'talia', json };
    } catch {
      // Not this slot: a decoy, or another participant's.
    }
  }
  return null;
}

/** Open a backup that holds a DESCRIPTOR (Liana's format), or null. */
export function decryptBackup(bytes: Uint8Array, xpub: string): string | null {
  const opened = openBackup(bytes, xpub);
  return opened?.kind === 'descriptor' ? opened.descriptor : null;
}

/** `[fp/48h/1h/0h/2h]xpub…/<0;1>/*` → `xpub…`. */
export function stripKeyDecoration(raw: string): string {
  let s = raw.trim();
  const close = s.indexOf(']');
  if (s.startsWith('[') && close > 0) s = s.slice(close + 1);
  const slash = s.indexOf('/');
  if (slash > 0) s = s.slice(0, slash);
  return s.trim();
}

/**
 * A sealed vault backup, from whatever carried it: a file's bytes (`.bed` or
 * `.bip138`), the same file as base64 TEXT (Liana also reads a backup that
 * way, and an animated BBQr carries Talia's as text, having no binary file
 * type), or pasted or scanned base64. Null for anything else, which is every
 * other import.
 */
export function readSealedBackup(input: string | Uint8Array): Uint8Array | null {
  const fromBase64 = (text: string): Uint8Array | null => {
    const cleaned = text.trim().replace(/\s+/g, '');
    if (!cleaned || /[^A-Za-z0-9+/=]/.test(cleaned)) return null;
    try {
      return base64.decode(cleaned);
    } catch {
      return null;
    }
  };
  const candidates: Array<Uint8Array | null> = [];
  if (typeof input === 'string') {
    candidates.push(fromBase64(input));
  } else {
    // Raw bytes first, then the same bytes read as base64 text.
    candidates.push(input);
    try {
      candidates.push(fromBase64(new TextDecoder().decode(input)));
    } catch {
      // Not text; the raw reading above is the only one.
    }
  }
  for (const bytes of candidates) {
    if (bytes && parseBackup(bytes)) return bytes;
  }
  return null;
}
