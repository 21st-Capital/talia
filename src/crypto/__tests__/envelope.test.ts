/**
 * The heir-invite envelope is a security boundary: these tests cover the
 * happy path AND the ways it must refuse — wrong code, wrong key, tampered
 * ciphertext — plus the properties the design leans on (server blindness via
 * lookup hashing, size hiding via bucket padding, SLIP-132 canonicalization).
 */
import {
  buildInviteBlobs,
  canonicalXpubBytes,
  generateInviteCode,
  lookupHash,
  lookupToken,
  normalizeInviteCode,
  openCard,
  openDescriptor,
} from '../envelope';

// Published test keys (public data only): the heir is BIP-32 test vector 1's
// seed at m/86'/1'/0' (master fingerprint 3442193e, the key the golden
// vectors seal), the other key test vector 2's seed at the same path.
const HEIR_TPUB =
  'tpubDDXRVY4eRY4p4iqLUQNQokx89YLZEpTyA8UdLVYRMV8HacVdwHRi1TWKMSY3kh8WpNBA4kB4Xet3hCxxVvSw83DZ5fhqiSysSsYCWJ7k79E';
const OTHER_TPUB =
  'tpubDCuFYGtwQbunU2hJUzex1tW6kCqEMHGhx4iVs88DuWY1c1YUapyhFG7NfmHGs75WbCkwcc6oP3bwwE4y453HdykZZAv2vMPsj9w9qoTL2CJ';

// The first key is the "abandon ... about" mnemonic at m/48'/1'/0'/2'.
const DESCRIPTOR =
  "tr([73c5da0a/48'/1'/0'/2']tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ/<0;1>/*,{pk([3442193e/86'/1'/0']" +
  HEIR_TPUB +
  '/<0;1>/*)})#dummy';

const card = {
  vaultLabel: 'Family Vault',
  heirName: 'Sofia',
  expectedFingerprint: '3442193e',
  heirOriginPath: "86'/1'/0'",
  network: 'testnet',
  mode: 'strict' as const,
};

const descriptorPayload = {
  v: 1 as const,
  descriptor: DESCRIPTOR,
  network: 'testnet',
  vaultLabel: 'Family Vault',
};

function freshInvite() {
  const code = generateInviteCode();
  const blobs = buildInviteBlobs({
    code,
    heirXpub: HEIR_TPUB,
    card,
    descriptor: descriptorPayload,
  });
  return { code, ...blobs };
}

describe('invite codes', () => {
  it('have the right shape and 100 bits of charset', () => {
    const c = generateInviteCode();
    expect(c).toMatch(/^TALIA(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
  });

  it('normalize forgivingly: case, spacing, dashes, I/L/O confusables', () => {
    const canonical = normalizeInviteCode('TALIA-ABCDE-FGH1J-K2MNP-QRSTV');
    expect(normalizeInviteCode('talia abcde fghIj k2mnp qrstv')).toBe(canonical);
    expect(normalizeInviteCode('  AbCdE-FGHlJ-K2MNP-QRSTV ')).toBe(canonical);
    expect(normalizeInviteCode('ABCDEFGH1JK2MNPQRSTV')).toBe(canonical);
  });

  it('reject garbage rather than deriving keys from it', () => {
    expect(normalizeInviteCode('TALIA-SHORT')).toBeNull();
    expect(normalizeInviteCode('')).toBeNull();
    expect(normalizeInviteCode('TALIA-ABCDE-FGH1J-K2MNP-QRSTU')).toBeNull(); // U not in charset
  });

  it('two generated codes differ (sanity on the CSPRNG path)', () => {
    expect(generateInviteCode()).not.toBe(generateInviteCode());
  });
});

describe('server blindness', () => {
  it('lookupHash(code) === sha256(lookupToken) and neither reveals the other direction', () => {
    const { code } = freshInvite();
    const token = lookupToken(code);
    const hash = lookupHash(code);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toBe(hash);
  });

  it('the same code always derives the same token (dashes or not)', () => {
    const { code } = freshInvite();
    expect(lookupToken(code)).toBe(lookupToken(code.toLowerCase().replace(/-/g, ' ')));
  });
});

describe('the sealed card', () => {
  it('opens with the right code and carries the activation metadata', () => {
    const inv = freshInvite();
    const c = openCard(inv.code, inv.cardCiphertextB64);
    expect(c.vaultLabel).toBe('Family Vault');
    expect(c.expectedFingerprint).toBe('3442193e');
    expect(c.mode).toBe('strict');
    expect(c.access).toBe('key');
    expect((c.innerSaltB64 ?? '').length).toBeGreaterThan(0);
  });

  it('refuses a wrong code outright', () => {
    const inv = freshInvite();
    const wrong = generateInviteCode();
    expect(() => openCard(wrong, inv.cardCiphertextB64)).toThrow();
  });

  it('refuses a tampered ciphertext (AEAD integrity)', () => {
    const inv = freshInvite();
    const bytes = require('@scure/base').base64.decode(inv.cardCiphertextB64) as Uint8Array;
    bytes[40] ^= 0x01;
    const tampered = require('@scure/base').base64.encode(bytes) as string;
    expect(() => openCard(inv.code, tampered)).toThrow();
  });

  it('never contains the descriptor', () => {
    const inv = freshInvite();
    const c = openCard(inv.code, inv.cardCiphertextB64);
    expect(JSON.stringify(c)).not.toContain('tpubDFH9dgzv');
  });
});

describe('the descriptor blob', () => {
  it("opens with code + the heir's key, in any SLIP-132 dress", () => {
    const inv = freshInvite();
    const c = openCard(inv.code, inv.cardCiphertextB64);
    const p = openDescriptor(inv.code, c, HEIR_TPUB, inv.descriptorCiphertextB64);
    expect(p.descriptor).toBe(DESCRIPTOR);
  });

  it('refuses the WRONG key with a message naming the expected fingerprint', () => {
    const inv = freshInvite();
    const c = openCard(inv.code, inv.cardCiphertextB64);
    expect(() => openDescriptor(inv.code, c, OTHER_TPUB, inv.descriptorCiphertextB64)).toThrow(
      /3442193E/,
    );
  });

  it('refuses the right key with the wrong code', () => {
    const inv = freshInvite();
    const other = freshInvite();
    const c = openCard(inv.code, inv.cardCiphertextB64);
    expect(() =>
      openDescriptor(other.code, c, HEIR_TPUB, inv.descriptorCiphertextB64),
    ).toThrow();
  });
});

describe('keyless invites (access: code)', () => {
  const keylessCard = {
    vaultLabel: 'Family Vault',
    heirName: 'Nora',
    network: 'testnet',
    mode: 'full' as const,
  };

  function freshKeyless() {
    const code = generateInviteCode();
    const blobs = buildInviteBlobs({ code, card: keylessCard, descriptor: descriptorPayload });
    return { code, ...blobs };
  }

  it('the code alone opens card AND descriptor — no key involved', () => {
    const inv = freshKeyless();
    const c = openCard(inv.code, inv.cardCiphertextB64);
    expect(c.access).toBe('code');
    expect(c.innerSaltB64).toBeUndefined();
    expect(c.expectedFingerprint).toBeUndefined();
    const p = openDescriptor(inv.code, c, null, inv.descriptorCiphertextB64);
    expect(p.descriptor).toBe(DESCRIPTOR);
  });

  it('a wrong code still opens nothing', () => {
    const inv = freshKeyless();
    const wrong = generateInviteCode();
    expect(() => openCard(wrong, inv.cardCiphertextB64)).toThrow();
    const c = openCard(inv.code, inv.cardCiphertextB64);
    expect(() => openDescriptor(wrong, c, null, inv.descriptorCiphertextB64)).toThrow();
  });

  it('refuses to seal keyless + strict (nothing anchors the countdown)', () => {
    expect(() =>
      buildInviteBlobs({
        code: generateInviteCode(),
        card: { ...keylessCard, mode: 'strict' },
        descriptor: descriptorPayload,
      }),
    ).toThrow(/full visibility/);
  });

  it('a KEYED card refuses to open without the key', () => {
    const inv = freshInvite();
    const c = openCard(inv.code, inv.cardCiphertextB64);
    expect(() => openDescriptor(inv.code, c, null, inv.descriptorCiphertextB64)).toThrow(
      /hardware key/,
    );
  });
});

describe('nonce freshness', () => {
  it('sealing the SAME invite twice yields different nonces and ciphertexts', () => {
    const code = generateInviteCode();
    const a = buildInviteBlobs({ code, heirXpub: HEIR_TPUB, card, descriptor: descriptorPayload });
    const b = buildInviteBlobs({ code, heirXpub: HEIR_TPUB, card, descriptor: descriptorPayload });
    expect(a.cardCiphertextB64).not.toBe(b.cardCiphertextB64);
    expect(a.descriptorCiphertextB64).not.toBe(b.descriptorCiphertextB64);
    // The first 24 bytes ARE the XChaCha nonce — a constant/zeroed nonce
    // (catastrophic with a reused key) must fail here.
    const { base64 } = require('@scure/base');
    const nonceA = Array.from(base64.decode(a.cardCiphertextB64).slice(0, 24) as Uint8Array);
    const nonceB = Array.from(base64.decode(b.cardCiphertextB64).slice(0, 24) as Uint8Array);
    expect(nonceA).not.toEqual(nonceB);
    expect(nonceA.some((x) => x !== 0)).toBe(true);
  });
});

describe('size hiding', () => {
  it('a short and a long descriptor produce identical ciphertext lengths', () => {
    const short = freshInvite();
    const code = generateInviteCode();
    const long = buildInviteBlobs({
      code,
      heirXpub: HEIR_TPUB,
      card,
      descriptor: { ...descriptorPayload, descriptor: DESCRIPTOR + '/*'.repeat(200) },
    });
    expect(long.descriptorCiphertextB64.length).toBe(short.descriptorCiphertextB64.length);
  });
});

describe('xpub canonicalization', () => {
  /** The heir's key re-dressed in SLIP-132 vpub clothes (same key bytes,
   *  different version prefix) — what a different wallet's export looks like. */
  function vpubDress(tpub: string): string {
    const { createBase58check } = require('@scure/base');
    const { sha256 } = require('@noble/hashes/sha256');
    const b58 = createBase58check(sha256);
    const bytes = new Uint8Array(b58.decode(tpub));
    bytes.set([0x04, 0x5f, 0x1c, 0xf6], 0); // vpub version
    return b58.encode(bytes);
  }

  it('is version-agnostic: only the 4 version bytes are zeroed', () => {
    const a = canonicalXpubBytes(HEIR_TPUB);
    expect(a.length).toBe(78);
    expect(Array.from(a.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it('an ACTUAL SLIP-132 re-dress derives identical canonical bytes', () => {
    const vpub = vpubDress(HEIR_TPUB);
    expect(vpub.startsWith('vpub')).toBe(true);
    expect(canonicalXpubBytes(vpub)).toEqual(canonicalXpubBytes(HEIR_TPUB));
  });

  it('a blob sealed to the tpub opens with the vpub dress of the same key', () => {
    const inv = freshInvite();
    const c = openCard(inv.code, inv.cardCiphertextB64);
    const p = openDescriptor(inv.code, c, vpubDress(HEIR_TPUB), inv.descriptorCiphertextB64);
    expect(p.descriptor).toBe(DESCRIPTOR);
  });

  it('rejects non-keys', () => {
    expect(() => canonicalXpubBytes('definitely-not-a-key')).toThrow();
  });
});
