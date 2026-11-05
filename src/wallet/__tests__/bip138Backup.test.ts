/**
 * Encrypted descriptor backups in the format Liana writes since v16.0
 * (`.bip138`, the newer BIP-138 draft), read by `bip138Backup.ts` and through
 * the app's own reader (`parseBackup`, `openBackup`, `readSealedBackup`).
 *
 * Two kinds of evidence, neither written by our code:
 *
 * 1. Files the `bip138` crate 0.2.0 wrote, the library and version Liana v16.0
 *    exports with, called the way Liana's export calls it, for the vault
 *    below (keys of BIP-32 test vectors 1, 2 and 3, so no real device's):
 *    `__fixtures__/liana_test_vault.bip138` as Liana's export writes it by
 *    default (paths every reader tries are left out), and
 *    `__fixtures__/liana_test_vault_paths.bip138` with those paths stored too.
 *    If these tests stop passing, a backup made in Liana no longer opens in
 *    Talia. To write them again (Rust and network access needed; each run
 *    draws a new nonce and new decoy slots, and every test here still holds):
 *
 *      cargo run --release --locked --manifest-path scripts/liana-bip138-fixture/Cargo.toml \
 *        --target-dir "${TMPDIR:-/tmp}/liana-bip138-fixture" -- \
 *        src/wallet/__tests__/__fixtures__/liana_test_vault.bip138
 *      cargo run --release --locked --manifest-path scripts/liana-bip138-fixture/Cargo.toml \
 *        --target-dir "${TMPDIR:-/tmp}/liana-bip138-fixture" -- \
 *        src/wallet/__tests__/__fixtures__/liana_test_vault_paths.bip138 --store-common-paths
 *
 *    The program is `scripts/liana-bip138-fixture/src/main.rs`; it carries its
 *    own copy of VAULT_DESCRIPTOR (change both together) and refuses a vault
 *    whose keys are not the test vectors'.
 *
 * 2. The crate's published test vectors, copied verbatim from
 *    github.com/pythcoiner/bip138 at commit 83ba5f391dae (the 0.2.0 release):
 *    `test_vectors/chacha20poly1305_encryption.json` (already here as
 *    `bip138_chacha_vectors.json`), `encrypted_backup.json`,
 *    `encryption_secret.json` and `content_type.json`, as
 *    `bip138_<name>_vectors.json`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { base64 } from '@scure/base';

import {
  BIP138_MAGIC,
  bip138DecryptionSecret,
  bip138Descriptor,
  bip138IndividualSecret,
  decodeBip138Payload,
  isBip138,
  openBip138,
  parseBip138,
  parseBip138Content,
  readCompactSize,
} from '../bip138Backup';
import {
  compressedFromXpub,
  decryptBackup,
  encryptBackup,
  openBackup,
  parseBackup,
  participantKeys,
  readSealedBackup,
} from '../encryptedBackup';

const FIX = join(__dirname, '__fixtures__');
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIX, name)));
const vectors = <T>(name: string): T => JSON.parse(readFileSync(join(FIX, name), 'utf8')) as T;

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string): Uint8Array =>
  new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const xor = (a: Uint8Array, b: Uint8Array): Uint8Array => a.map((x, i) => x ^ b[i]);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
};
const compactSize = (n: number): Uint8Array =>
  n < 0xfd ? new Uint8Array([n]) : new Uint8Array([0xfd, n & 0xff, n >> 8]);
const xonly = (xpub: string): Uint8Array => compressedFromXpub(xpub)!.slice(1);

/** Liana's default export of VAULT_DESCRIPTOR (see the header). */
const LIANA_FILE = fixture('liana_test_vault.bip138');
/** The same vault with the common derivation paths stored. */
const LIANA_FILE_PATHS = fixture('liana_test_vault_paths.bip138');

/**
 * A testnet taproot vault in Liana's shape: two of the first two keys at any
 * time, or the third alone after 65535 blocks. Its keys are BIP-32 test
 * vectors 1, 2 and 3 at m/48'/1'/0'/2', and its internal key is the
 * unspendable key Liana derives from them.
 */
const VAULT_DESCRIPTOR =
  "tr(tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ/<0;1>/*,{multi_a(2,[3442193e/48'/1'/0'/2']tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg/<0;1>/*,[bd16bee5/48'/1'/0'/2']tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ/<0;1>/*),and_v(v:pk([41d63b50/48'/1'/0'/2']tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr/<0;1>/*),older(65535))})#ffpaesuq";

const VAULT_KEYS = [
  'tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg',
  'tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ',
  'tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr',
];
/** The vault's internal key: the NUMS point with a chain code, nobody's key. */
const UNSPENDABLE_KEY =
  'tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ';
/** BIP-32 test vector 1's MASTER key: the same seed as the first key, but not
 *  a key of this vault. */
const UNRELATED_KEY =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';

const H = 0x80000000;

/** The plaintext Liana's export seals: one BIP 380 item, no padding. */
const expectedPayload = (): Uint8Array => {
  const descriptor = utf8(VAULT_DESCRIPTOR);
  return concat(new Uint8Array([0x01, 0x01, 0x7c]), compactSize(descriptor.length), descriptor);
};

describe('a backup Liana v16 wrote, read byte for byte', () => {
  it('is the container the BIP describes, and rebuilds to the same bytes', () => {
    const parsed = parseBip138(LIANA_FILE)!;
    expect(parsed).not.toBeNull();
    // Every key sits at m/48'/1'/0'/2', a path every reader tries, so
    // Liana's default export records none.
    expect(parsed.paths).toEqual([]);
    expect(parsed.individualSecrets).toHaveLength(5); // 3 keys, 2 decoys
    expect(parsed.nonce.some((b) => b !== 0)).toBe(true);
    expect(parsed.ciphertext).toHaveLength(expectedPayload().length + 16);
    const rebuilt = concat(
      BIP138_MAGIC,
      new Uint8Array([1, 0, parsed.individualSecrets.length]),
      ...parsed.individualSecrets,
      new Uint8Array([1]),
      parsed.nonce,
      compactSize(parsed.ciphertext.length),
      parsed.ciphertext,
    );
    expect(hex(rebuilt)).toBe(hex(LIANA_FILE));
  });

  it('records the path when asked to store the common ones', () => {
    const parsed = parseBip138(LIANA_FILE_PATHS)!;
    expect(parsed.paths).toEqual([[48 + H, 1 + H, 0 + H, 2 + H]]);
    expect(hex(LIANA_FILE_PATHS.slice(0, 25))).toBe(
      hex(BIP138_MAGIC) + '01' + '01' + '04' + '80000030' + '80000001' + '80000000' + '80000002',
    );
  });

  it('carries exactly the slots its three keys give, the rest decoys', () => {
    const keys = participantKeys(VAULT_DESCRIPTOR).map((k) => k.slice(1));
    expect(keys).toHaveLength(3); // the unspendable internal key is not one
    const secret = bip138DecryptionSecret(keys);
    const real = keys.map((k) => hex(xor(secret, bip138IndividualSecret(k)))).sort();
    for (const file of [LIANA_FILE, LIANA_FILE_PATHS]) {
      const slots = parseBip138(file)!.individualSecrets.map(hex);
      expect(slots.filter((s) => real.includes(s)).sort()).toEqual(real);
      expect(slots.filter((s) => !real.includes(s))).toHaveLength(2);
      // Slots are written sorted, which hides which one is real.
      expect([...slots].sort()).toEqual(slots);
    }
  });

  it('decrypts under that secret to exactly the payload Liana seals', () => {
    const keys = participantKeys(VAULT_DESCRIPTOR).map((k) => k.slice(1));
    const parsed = parseBip138(LIANA_FILE)!;
    const payload = chacha20poly1305(bip138DecryptionSecret(keys), parsed.nonce).decrypt(parsed.ciphertext);
    expect(hex(payload)).toBe(hex(expectedPayload()));
  });

  it('opens with each of its keys and gives the descriptor back, checksum and all', () => {
    for (const file of [LIANA_FILE, LIANA_FILE_PATHS]) {
      for (const key of VAULT_KEYS) {
        const items = openBip138(file, xonly(key))!;
        expect(items).toHaveLength(1);
        expect(items[0].content).toEqual({ type: 'bip', bip: 380 });
        expect(bip138Descriptor(items)).toBe(VAULT_DESCRIPTOR);
      }
    }
  });

  it('stays shut for a key that is not the vault’s, and for its unspendable key', () => {
    for (const file of [LIANA_FILE, LIANA_FILE_PATHS]) {
      expect(openBip138(file, xonly(UNRELATED_KEY))).toBeNull();
      expect(openBip138(file, xonly(UNSPENDABLE_KEY))).toBeNull();
      expect(openBackup(file, UNRELATED_KEY)).toBeNull();
      expect(openBackup(file, UNSPENDABLE_KEY)).toBeNull();
    }
  });
});

describe('through the app’s reader', () => {
  it('parseBackup tells the two formats apart', () => {
    expect(parseBackup(LIANA_FILE)?.format).toBe('bip138');
    expect(parseBackup(LIANA_FILE_PATHS)?.paths).toEqual([[48 + H, 1 + H, 0 + H, 2 + H]]);
    const bed = encryptBackup(VAULT_DESCRIPTOR, { paths: [[48 + H, 1 + H, 0 + H, 2 + H]] });
    expect(parseBackup(bed)?.format).toBe('bed');
  });

  it('openBackup and decryptBackup open it with any key as the import gives it', () => {
    for (const key of VAULT_KEYS) {
      // A device answers a bare xpub; a pasted key may carry its origin and
      // derivation, as in the descriptor.
      for (const given of [key, `[3442193e/48h/1h/0h/2h]${key}/<0;1>/*`]) {
        expect(openBackup(LIANA_FILE, given)).toEqual({ kind: 'descriptor', descriptor: VAULT_DESCRIPTOR });
        expect(decryptBackup(LIANA_FILE, given)).toBe(VAULT_DESCRIPTOR);
      }
    }
  });

  it('readSealedBackup takes the file, its base64 text (Liana reads that too) and a paste', () => {
    const text = base64.encode(LIANA_FILE);
    expect(text.startsWith('QklQMTM4')).toBe(true); // "BIP138"
    for (const input of [LIANA_FILE, utf8(text), utf8(`${text}\n`), text, `  ${text}  `]) {
      const sealed = readSealedBackup(input);
      expect(sealed && hex(sealed)).toBe(hex(LIANA_FILE));
      expect(openBackup(sealed!, VAULT_KEYS[2])?.kind).toBe('descriptor');
    }
    expect(readSealedBackup(VAULT_DESCRIPTOR)).toBeNull();
    expect(readSealedBackup(utf8(VAULT_DESCRIPTOR))).toBeNull();
  });

  it('refuses a file cut short, another version, or a zeroed nonce, as not a backup', () => {
    expect(parseBackup(LIANA_FILE.slice(0, 40))).toBeNull();
    expect(parseBackup(LIANA_FILE.slice(0, LIANA_FILE.length - 1))).toBeNull();
    const v2 = LIANA_FILE.slice();
    v2[6] = 2;
    expect(parseBackup(v2)).toBeNull();
    const zeroNonce = LIANA_FILE.slice();
    const at = 6 + 1 + 1 + 1 + 5 * 32 + 1;
    zeroNonce.fill(0, at, at + 12);
    expect(parseBackup(zeroNonce)).toBeNull();
    // A recorded path must have at least one step.
    const emptyPath = concat(LIANA_FILE.slice(0, 7), new Uint8Array([1, 0]), LIANA_FILE.slice(8));
    expect(parseBackup(emptyPath)).toBeNull();
    expect(isBip138(utf8('BIP13'))).toBe(false);
  });

  it('a damaged ciphertext opens for nobody', () => {
    const damaged = LIANA_FILE.slice();
    damaged[damaged.length - 20] ^= 1;
    for (const key of VAULT_KEYS) expect(openBackup(damaged, key)).toBeNull();
  });

  it('Talia itself still writes .bed, which Liana v16 reads', () => {
    const written = encryptBackup(VAULT_DESCRIPTOR, { paths: [[48 + H, 1 + H, 0 + H, 2 + H]] });
    expect(hex(written.slice(0, 3))).toBe(hex(utf8('BEB')));
    expect(isBip138(written)).toBe(false);
    expect(decryptBackup(written, VAULT_KEYS[0])).toBe(VAULT_DESCRIPTOR);
  });
});

// ─── the crate's published vectors ───────────────────────────────────────────

interface ChachaVector {
  description: string;
  nonce: string;
  plaintext: string;
  secret: string;
  ciphertext: string | null;
}

interface SecretVector {
  description: string;
  keys: string[];
  decryption_secret: string;
  individual_secrets: string[];
}

interface BackupVector {
  description: string;
  version: number;
  encryption: number;
  content: string;
  keys: string[];
  derivation_paths: string[];
  plaintext: string;
  nonce: string;
  expected: string;
  trailing?: string | null;
  expected_base64?: string;
  extra?: Array<{ content: string; plaintext: string }>;
  valid?: boolean;
}

interface ContentVector {
  description: string;
  valid: boolean;
  content: string;
}

/** `common_derivation_paths` in bip138-ll: paths an encoder leaves out
 *  because every decoder tries them. */
const COMMON_PATHS = new Set<string>();
for (const coin of [0, 1]) {
  for (let account = 0; account <= 9; account++) {
    for (const script of [1, 2]) COMMON_PATHS.add(`48'/${coin}'/${account}'/${script}'`);
    for (const purpose of [44, 49, 84, 86, 87]) COMMON_PATHS.add(`${purpose}'/${coin}'/${account}'`);
  }
}
const pathChildren = (path: string): number[] =>
  path
    .replace(/^m\//, '')
    .split('/')
    .map((c) => (c.endsWith("'") ? parseInt(c, 10) + H : parseInt(c, 10)));

describe('the crate’s published vectors', () => {
  it('ChaCha20-Poly1305 seals as the BIP’s cipher vectors say', () => {
    const cases = vectors<ChachaVector[]>('bip138_chacha_vectors.json');
    let checked = 0;
    for (const v of cases) {
      if (v.ciphertext === null) continue; // what the encoder must refuse
      const sealed = chacha20poly1305(unhex(v.secret), unhex(v.nonce)).encrypt(unhex(v.plaintext));
      expect(hex(sealed)).toBe(v.ciphertext);
      checked += 1;
    }
    expect(checked).toBe(3);
  });

  it('derives the decryption and individual secrets of every key set', () => {
    const cases = vectors<SecretVector[]>('bip138_encryption_secret_vectors.json');
    expect(cases).toHaveLength(8);
    for (const v of cases) {
      const keys = v.keys.map((k) => unhex(k).slice(1));
      const secret = bip138DecryptionSecret(keys);
      expect(hex(secret)).toBe(v.decryption_secret);
      const distinct = [...new Set(keys.map(hex))].sort();
      expect(distinct.map((k) => hex(xor(secret, bip138IndividualSecret(unhex(k)))))).toEqual(
        v.individual_secrets,
      );
    }
  });

  it('reads every content type the vectors list, and refuses the invalid ones', () => {
    for (const v of vectors<ContentVector[]>('bip138_content_type_vectors.json')) {
      expect([v.description, parseBip138Content(unhex(v.content)) !== null]).toEqual([v.description, v.valid]);
    }
  });

  it('parses and opens every backup vector with each of its keys, trailing bytes ignored', () => {
    const cases = vectors<BackupVector[]>('bip138_encrypted_backup_vectors.json');
    expect(cases).toHaveLength(7);
    for (const v of cases) {
      const bytes = unhex(v.expected);
      if (v.valid === false) {
        // An all-zero nonce MUST be refused before any decryption.
        expect([v.description, parseBip138(bytes)]).toEqual([v.description, null]);
        continue;
      }
      const parsed = parseBip138(bytes)!;
      expect([v.description, parsed !== null]).toEqual([v.description, true]);
      expect(hex(parsed.nonce)).toBe(v.nonce);
      const stored = v.derivation_paths
        .filter((p) => !COMMON_PATHS.has(p.replace(/^m\//, '')))
        .map(pathChildren)
        .sort((a, b) => a.join('/').localeCompare(b.join('/')));
      expect([...parsed.paths].sort((a, b) => a.join('/').localeCompare(b.join('/')))).toEqual(stored);

      const items = [{ content: v.content, plaintext: v.plaintext }, ...(v.extra ?? [])].map((it) => ({
        content: parseBip138Content(unhex(it.content))!.content,
        data: utf8(it.plaintext),
      }));
      const withTrailer = v.trailing ? concat(bytes, unhex(v.trailing)) : null;
      for (const key of v.keys) {
        const k = unhex(key).slice(1);
        expect([v.description, openBip138(bytes, k)]).toEqual([v.description, items]);
        if (withTrailer) expect(openBip138(withTrailer, k)).toEqual(items);
      }
      if (v.expected_base64) {
        const sealed = readSealedBackup(v.expected_base64);
        expect(sealed && hex(sealed)).toBe(v.expected);
      }
    }
  });

  it('reads lengths as Bitcoin’s CompactSize, refusing a non-minimal one as the crate does', () => {
    expect(readCompactSize(new Uint8Array([0xfc]), 0)).toEqual({ value: 0xfc, next: 1 });
    expect(readCompactSize(new Uint8Array([0xfd, 0xfd, 0x00]), 0)).toEqual({ value: 0xfd, next: 3 });
    expect(readCompactSize(new Uint8Array([0xfe, 0x00, 0x00, 0x01, 0x00]), 0)).toEqual({ value: 0x10000, next: 5 });
    expect(readCompactSize(new Uint8Array([0xff, 0, 0, 0, 0, 1, 0, 0, 0]), 0)).toEqual({ value: 2 ** 32, next: 9 });
    expect(readCompactSize(new Uint8Array([0xfd, 0xfc, 0x00]), 0)).toBeNull();
    expect(readCompactSize(new Uint8Array([0xfe, 0xff, 0xff, 0x00, 0x00]), 0)).toBeNull();
    expect(readCompactSize(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0]), 0)).toBeNull();
    expect(readCompactSize(new Uint8Array([0xfd, 0x00]), 0)).toBeNull();
    expect(readCompactSize(new Uint8Array([]), 0)).toBeNull();
  });

  it('opens nothing from a payload with a type that refuses it, or with no item', () => {
    expect(decodeBip138Payload(new Uint8Array([]))).toBeNull();
    expect(decodeBip138Payload(new Uint8Array([0x00, 0x00]))).toBeNull();
    expect(decodeBip138Payload(new Uint8Array([0x80, 0x00, 0x00]))).toBeNull();
    // An item, then zero padding: the padding is not an item.
    expect(decodeBip138Payload(new Uint8Array([0x03, 0x00, 0x01, 0x41, 0x00, 0x00]))).toEqual([
      { content: { type: 'string' }, data: utf8('A') },
    ]);
    // An unknown type below 0x80 is skipped over, not refused.
    expect(decodeBip138Payload(new Uint8Array([0x10, 0x01, 0xaa, 0x01, 0x42]))).toEqual([
      { content: { type: 'unknown' }, data: utf8('B') },
    ]);
  });
});
