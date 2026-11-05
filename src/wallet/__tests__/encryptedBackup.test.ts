/**
 * Encrypted descriptor backups in Liana's format: which keys may open one,
 * the round trip, the way the app carries it, the derivation paths Liana
 * needs to ask a device, and a file our own code did not write.
 *
 * That file, `__fixtures__/liana_test_vault.bed`, was written by
 * bitcoin-encrypted-backup 0.0.2, the library Liana wrote its .bed backups
 * with up to v15.0 (Liana v16 writes .bip138 files, which Talia reads too:
 * bip138Backup.test.ts), called the way Liana's backup export called it, for
 * the vault below:
 * a test vault of made-up keys (BIP-32 test vectors 1, 2 and 3, the vault of
 * the .bip138 fixtures), no real device's key. It is the cross check that
 * a client's backup opens in the wallet we tell them to recover with: if its
 * tests stop passing, we no longer read what Liana writes. To write it again
 * (Rust and network access needed; a new file has a new nonce, so its bytes
 * change and every test here still holds):
 *
 *   cargo run --release --manifest-path scripts/liana-bed-fixture/Cargo.toml \
 *     --target-dir "${TMPDIR:-/tmp}/liana-bed-fixture" -- \
 *     src/wallet/__tests__/__fixtures__/liana_test_vault.bed
 *
 * The program is `scripts/liana-bed-fixture/src/main.rs`, and its README says
 * which Liana code it follows. It carries its own copy of VAULT_DESCRIPTOR:
 * change both together.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { gcm } from '@noble/ciphers/aes';

import {
  compressedFromXpub,
  decryptBackup,
  descriptorPaths,
  decryptionSecret,
  encryptBackup,
  individualSecret,
  parseBackup,
  participantKeys,
  readPayload,
  encodePayload,
  encodeTaliaPayload,
  openBackup,
  readTaliaPayload,
} from '../encryptedBackup';

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** The backup Liana's .bed library wrote for VAULT_DESCRIPTOR (see the header). */
const LIANA_FILE = new Uint8Array(readFileSync(join(__dirname, '__fixtures__', 'liana_test_vault.bed')));

/** A testnet vault of made-up keys, derived from the seeds of BIP-32 test vectors 1, 2 and 3 at m/48'/1'/0'/2'. */
const VAULT_DESCRIPTOR =
  "tr(tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ/<0;1>/*,{multi_a(2,[3442193e/48'/1'/0'/2']tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg/<0;1>/*,[bd16bee5/48'/1'/0'/2']tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ/<0;1>/*),and_v(v:pk([41d63b50/48'/1'/0'/2']tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr/<0;1>/*),older(65535))})#ffpaesuq";

const VAULT_KEYS = [
  'tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg',
  'tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ',
  'tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr',
];
/**
 * The internal key of that taproot vault: unspendable, and nobody's key. It is
 * the one Liana derives from the vault's three keys, in tree order.
 */
const NUMS_KEY =
  'tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ';

describe('which keys may open a backup', () => {
  it('finds exactly the three keys a client holds, not the NUMS key', () => {
    // The taproot internal key is a published constant with a chain code on
    // top. Wrapping to it would let anyone who knows the scheme open the file.
    const keys = participantKeys(VAULT_DESCRIPTOR);
    expect(keys).toHaveLength(3);
    expect(keys.map(hex)).not.toContain(hex(compressedFromXpub(NUMS_KEY)!));
  });

  it('EXCLUDES a key with no trailing derivation', () => {
    // Its root pubkey would also be the on-chain pubkey, so one observed spend
    // would hand the secret to the world.
    expect(participantKeys(`wpkh(${VAULT_KEYS[0]})`)).toHaveLength(0);
  });

  it('refuses to seal a vault no key could open', () => {
    expect(() => encryptBackup(`wpkh(${VAULT_KEYS[0]})`)).toThrow(/derivation path/i);
  });

  it('never lets a slot be all zeroes', () => {
    // Distinct tags, so s and s_i can never be equal.
    const k = compressedFromXpub(VAULT_KEYS[0])!;
    expect(hex(decryptionSecret([k]))).not.toBe(hex(individualSecret(k)));
  });
});

describe('round trip', () => {
  it('opens with any one participant key', () => {
    const sealed = encryptBackup(VAULT_DESCRIPTOR);
    for (const k of VAULT_KEYS) expect(decryptBackup(sealed, k)).toBe(VAULT_DESCRIPTOR);
  });

  it('opens with the key however the client writes it', () => {
    const sealed = encryptBackup(VAULT_DESCRIPTOR);
    expect(decryptBackup(sealed, `[3442193e/48'/1'/0'/2']${VAULT_KEYS[0]}/<0;1>/*`)).toBe(
      VAULT_DESCRIPTOR,
    );
  });

  it('stays shut for a key that has nothing to do with it', () => {
    const stranger =
      'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba';
    expect(decryptBackup(encryptBackup(VAULT_DESCRIPTOR), stranger)).toBeNull();
  });

  it('is meaningless to the vault’s own unspendable key', () => {
    expect(decryptBackup(encryptBackup(VAULT_DESCRIPTOR), NUMS_KEY)).toBeNull();
  });

  it('says nothing about whose vault it is', () => {
    const text = Buffer.from(encryptBackup(VAULT_DESCRIPTOR)).toString('latin1');
    expect(text).not.toContain(VAULT_KEYS[0]);
    expect(text).not.toContain('3442193e');
    expect(text).not.toContain('multi_a');
  });

  it('can hide how many keys the vault has', () => {
    expect(parseBackup(encryptBackup(VAULT_DESCRIPTOR, { decoys: true }))!.individualSecrets)
      .toHaveLength(5);
  });

  it('refuses a tampered file rather than returning half a vault', () => {
    const sealed = encryptBackup(VAULT_DESCRIPTOR);
    sealed[sealed.length - 1] ^= 0xff;
    expect(decryptBackup(sealed, VAULT_KEYS[0])).toBeNull();
  });

  it('carries the derivation paths that help a recovery', () => {
    const sealed = encryptBackup(VAULT_DESCRIPTOR, { paths: [[0x80000030, 0x80000001]] });
    expect(parseBackup(sealed)!.paths).toEqual([[0x80000030, 0x80000001]]);
  });
});

describe("21st Capital's keys never open a client's backup (decided 2026-09-26)", () => {
  // Pretend the timelocked key (41d63b50) is ours. Its xpub is public to
  // anyone who can read our key pool, and before per-vault keys one such
  // xpub sat in every app-built vault.
  const OURS = new Set(['41D63B50']);

  it('leaves our key out of the participants, by its origin fingerprint', () => {
    expect(participantKeys(VAULT_DESCRIPTOR, OURS)).toHaveLength(2);
    expect(participantKeys(VAULT_DESCRIPTOR, OURS).map(hex)).not.toContain(hex(compressedFromXpub(VAULT_KEYS[2])!));
  });

  it("our xpub cannot open it; each of the client's keys still can", () => {
    const sealed = encryptBackup(VAULT_DESCRIPTOR, { decoys: true, excludeFingerprints: OURS });
    expect(decryptBackup(sealed, VAULT_KEYS[2])).toBeNull();
    expect(decryptBackup(sealed, VAULT_KEYS[0])).toBe(VAULT_DESCRIPTOR);
    expect(decryptBackup(sealed, VAULT_KEYS[1])).toBe(VAULT_DESCRIPTOR);
  });

  it('a vault whose only keys are ours is never sealed to nobody', () => {
    const all = new Set(['3442193e', 'bd16bee5', '41d63b50']);
    expect(() => encryptBackup(VAULT_DESCRIPTOR, { excludeFingerprints: all })).toThrow(/derivation path/i);
  });

  it('the vault screen seals with our keys excluded, and only once it knows them', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'ui', 'screens', 'WalletDetailScreen.tsx'), 'utf8');
    const at = src.indexOf('encryptBackup(wallet.descriptor');
    expect(src.slice(at, at + 300)).toMatch(/excludeFingerprints: known21C/);
    expect(src).toMatch(/if \(!known21CSettled\) return null;/);
  });
});

describe('the way the app carries it', () => {
  it('survives the base64 a QR carries', () => {
    // BBQr here has no binary file type, so the QR sends base64 text and the
    // receiving phone decodes it before recognising the magic.
    const sealed = encryptBackup(VAULT_DESCRIPTOR);
    const asText = Buffer.from(sealed).toString('base64');
    const back = new Uint8Array(Buffer.from(asText, 'base64'));
    expect(parseBackup(back)).not.toBeNull();
    expect(decryptBackup(back, VAULT_KEYS[0])).toBe(VAULT_DESCRIPTOR);
  });

  it('is recognisable as the UTF-8 of base64, which is what an animated QR carries', () => {
    // The bug found in a phone test: a BBQr frame set carries TEXT, so the joined bytes are
    // the UTF-8 of the base64, not the backup. Reading them as raw bytes finds
    // no magic and the import fell through to "no descriptor found".
    const sealed = encryptBackup(VAULT_DESCRIPTOR);
    const asText = Buffer.from(sealed).toString('base64');
    const carriedBytes = new TextEncoder().encode(asText);
    expect(parseBackup(carriedBytes)).toBeNull(); // raw reading finds nothing
    const decoded = new Uint8Array(
      Buffer.from(new TextDecoder().decode(carriedBytes), 'base64'),
    );
    expect(decryptBackup(decoded, VAULT_KEYS[0])).toBe(VAULT_DESCRIPTOR);
  });

  it('is not mistaken for a descriptor, nor a descriptor for a backup', () => {
    // The import screen decides by magic, so an ordinary import must not be
    // caught by the unlock flow.
    expect(parseBackup(new TextEncoder().encode(VAULT_DESCRIPTOR))).toBeNull();
    expect(parseBackup(new TextEncoder().encode(VAULT_KEYS[0]))).toBeNull();
  });
});

describe('the derivation paths, which Liana needs to ask a device', () => {
  it('reads each key’s origin path out of the descriptor', () => {
    // All three of the vault's keys sit at m/48'/1'/0'/2'.
    expect(descriptorPaths(VAULT_DESCRIPTOR)).toEqual([
      [0x80000030, 0x80000001, 0x80000000, 0x80000002],
    ]);
  });

  it('records them in the file, or Liana cannot use a hardware wallet', () => {
    // Liana's collect_xpubs asks the device ONLY at the paths the file
    // carries. Our first export recorded none, and a Ledger could not
    // open it in Liana: "Failed to decrypt file with this device".
    const sealed = encryptBackup(VAULT_DESCRIPTOR, {
      paths: descriptorPaths(VAULT_DESCRIPTOR),
    });
    expect(parseBackup(sealed)!.paths).toEqual([
      [0x80000030, 0x80000001, 0x80000000, 0x80000002],
    ]);
  });

  it('writes the same paths Liana wrote for the same vault', () => {
    const theirs = parseBackup(LIANA_FILE)!.paths;
    const ours = parseBackup(
      encryptBackup(VAULT_DESCRIPTOR, { paths: descriptorPaths(VAULT_DESCRIPTOR) }),
    )!.paths;
    expect(ours).toEqual(theirs);
  });

  it('a mainnet vault records coin type 0, a test vault records 1', () => {
    const main = descriptorPaths("wpkh([aabbccdd/84'/0'/0']xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8/<0;1>/*)");
    expect(main[0][1]).toBe(0x80000000); // 0'
    expect(descriptorPaths(VAULT_DESCRIPTOR)[0][1]).toBe(0x80000001); // 1'
  });
});

describe('the payload framing', () => {
  it('reads the framing Liana writes, and our own encoder produces it', () => {
    expect(readPayload(new Uint8Array([2, 0x01, 0x7c, 119, 111]))).toBe('wo');
    expect(readPayload(encodePayload(VAULT_DESCRIPTOR))).toBe(VAULT_DESCRIPTOR);
  });
});

describe('a file written by the library Liana wrote its .bed backups with', () => {
  it('parses byte for byte', () => {
    const parsed = parseBackup(LIANA_FILE)!;
    expect(parsed).not.toBeNull();
    expect(Array.from(LIANA_FILE.subarray(0, 4))).toEqual([0x42, 0x45, 0x42, 0x01]); // "BEB", version 1
    expect(parsed.paths).toEqual([[0x80000030, 0x80000001, 0x80000000, 0x80000002]]);
    expect(parsed.individualSecrets).toHaveLength(3);
    expect(parsed.nonce).toHaveLength(12);
    // The payload is the descriptor behind its 3-byte framing, plus the
    // 16-byte AES-GCM tag, and nothing is left over after it.
    expect(parsed.ciphertext.length).toBe(3 + VAULT_DESCRIPTOR.length + 16);
    const header =
      3 + 1 + // magic, version
      1 + 1 + 4 * 4 + // one path, four children
      1 + 3 * 32 + // three slots
      1 + 12 + // cipher, nonce
      3; // the ciphertext length, a 3-byte varint above 252
    expect(LIANA_FILE.length).toBe(header + parsed.ciphertext.length);
  });

  it('has slots we can reproduce, which proves the derivation matches', () => {
    const parsed = parseBackup(LIANA_FILE)!;
    const keys = participantKeys(VAULT_DESCRIPTOR);
    const secret = decryptionSecret(keys);
    const ours = keys
      .map((k) => {
        const si = individualSecret(k);
        return hex(secret.map((b, i) => b ^ si[i]) as Uint8Array);
      })
      .sort();
    expect(ours).toEqual(parsed.individualSecrets.map(hex).sort());
  });

  it('DECRYPTS with each of its own keys, which is the whole point', () => {
    for (const k of VAULT_KEYS) {
      expect(decryptBackup(LIANA_FILE, k)).toBe(VAULT_DESCRIPTOR);
    }
  });

  it("the app's reader opens it and returns the descriptor, however the key is written", () => {
    for (const k of VAULT_KEYS) {
      expect(openBackup(LIANA_FILE, k)).toEqual({ kind: 'descriptor', descriptor: VAULT_DESCRIPTOR });
    }
    expect(decryptBackup(LIANA_FILE, `[3442193e/48'/1'/0'/2']${VAULT_KEYS[0]}/<0;1>/*`)).toBe(
      VAULT_DESCRIPTOR,
    );
  });

  it('stays shut for a key that has nothing to do with it', () => {
    const stranger =
      'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba';
    expect(decryptBackup(LIANA_FILE, stranger)).toBeNull();
    expect(openBackup(LIANA_FILE, stranger)).toBeNull();
  });

  it('is meaningless to the vault’s own unspendable key', () => {
    expect(decryptBackup(LIANA_FILE, NUMS_KEY)).toBeNull();
  });

  it('says nothing about whose vault it is', () => {
    const text = Buffer.from(LIANA_FILE).toString('latin1');
    for (const k of VAULT_KEYS) expect(text).not.toContain(k);
    for (const fp of ['3442193e', 'bd16bee5', '41d63b50']) expect(text).not.toContain(fp);
    expect(text).not.toContain('multi_a');
  });

  it('reads the payload framing Liana writes, the same bytes our encoder writes', () => {
    const parsed = parseBackup(LIANA_FILE)!;
    const plain = gcm(decryptionSecret(participantKeys(VAULT_DESCRIPTOR)), parsed.nonce).decrypt(
      parsed.ciphertext,
    );
    expect(hex(plain)).toBe(hex(encodePayload(VAULT_DESCRIPTOR)));
    expect(readPayload(plain)).toBe(VAULT_DESCRIPTOR);
  });

  it('survives the base64 a QR carries', () => {
    const back = new Uint8Array(Buffer.from(Buffer.from(LIANA_FILE).toString('base64'), 'base64'));
    expect(decryptBackup(back, VAULT_KEYS[1])).toBe(VAULT_DESCRIPTOR);
  });
});

describe('a Talia vault export sealed in the same container', () => {
  const json = JSON.stringify({ type: 'talia-vault', version: 1, name: 'Family vault', descriptor: VAULT_DESCRIPTOR });

  it('opens with any one participant key, as the Talia export it is', () => {
    const sealed = encryptBackup(VAULT_DESCRIPTOR, { decoys: true, content: encodeTaliaPayload(json) });
    for (const k of VAULT_KEYS) expect(openBackup(sealed, k)).toEqual({ kind: 'talia', json });
  });

  it('is refused by a descriptor reader, so Liana never misreads it', () => {
    expect(readPayload(encodeTaliaPayload(json))).toBeNull();
    const sealed = encryptBackup(VAULT_DESCRIPTOR, { content: encodeTaliaPayload(json) });
    expect(decryptBackup(sealed, VAULT_KEYS[0])).toBeNull();
  });

  it('leaves the descriptor backup exactly as it was', () => {
    const sealed = encryptBackup(VAULT_DESCRIPTOR, { decoys: true });
    expect(openBackup(sealed, VAULT_KEYS[1])).toEqual({ kind: 'descriptor', descriptor: VAULT_DESCRIPTOR });
    expect(decryptBackup(sealed, VAULT_KEYS[1])).toBe(VAULT_DESCRIPTOR);
    expect(readTaliaPayload(encodePayload(VAULT_DESCRIPTOR))).toBeNull();
  });

  it('opens for nobody whose key is not in the vault', () => {
    const sealed = encryptBackup(VAULT_DESCRIPTOR, { content: encodeTaliaPayload(json) });
    expect(openBackup(sealed, NUMS_KEY)).toBeNull();
  });
});
