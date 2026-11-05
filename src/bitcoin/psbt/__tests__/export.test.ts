import { looksLikePsbt, looksLikeRawTx, decodeHexOrBase64, encodeBase64,
  decodeBase64,
  isValidBase64Psbt,
  makePsbtExport,
  psbtFilename,
  slugify,
} from '../export';
import { FAKE_PSBT_BASE64 } from '../../engine/fakeEngine';

describe('decodeBase64', () => {
  it('decodes standard base64', () => {
    // "psbt" -> [0x70,0x73,0x62,0x74]
    expect(Array.from(decodeBase64('cHNidA==')!)).toEqual([0x70, 0x73, 0x62, 0x74]);
  });
  it('returns null on malformed input', () => {
    expect(decodeBase64('!!!!')).toBeNull();
    expect(decodeBase64('abc')).toBeNull(); // not a multiple of 4
  });
});

describe('isValidBase64Psbt', () => {
  it('accepts a PSBT-magic payload', () => {
    expect(isValidBase64Psbt(FAKE_PSBT_BASE64)).toBe(true);
  });
  it('accepts real-world PSBT prefix', () => {
    // A minimal well-formed PSBT begins with base64 "cHNidP8B..."
    expect(isValidBase64Psbt('cHNidP8BAAA=')).toBe(true);
  });
  it('rejects non-PSBT base64', () => {
    expect(isValidBase64Psbt('aGVsbG8gd29ybGQ=')).toBe(false); // "hello world"
  });
  it('rejects junk', () => {
    expect(isValidBase64Psbt('not-base64!!')).toBe(false);
  });
});

describe('slugify / psbtFilename', () => {
  it('slugifies labels', () => {
    expect(slugify('Liana 2/3 multisig')).toBe('liana-2-3-multisig');
    expect(slugify('   ')).toBe('wallet');
  });
  it('builds a filename with a txid suffix', () => {
    expect(psbtFilename('Sparrow wallet', 'abcdef1234567890')).toBe('talia-sparrow-wallet-abcdef12.psbt');
  });
  it('builds a filename without a txid', () => {
    expect(psbtFilename('Keel wallet')).toBe('talia-keel-wallet.psbt');
  });
});

describe('makePsbtExport', () => {
  it('packages a valid PSBT for all transports', () => {
    const exp = makePsbtExport(FAKE_PSBT_BASE64, 'Liana recovery', 'abcd1234');
    expect(exp.base64).toBe(FAKE_PSBT_BASE64);
    expect(exp.filename).toBe('talia-liana-recovery-abcd1234.psbt');
    expect(exp.qrPayload).toBe(FAKE_PSBT_BASE64.toUpperCase());
    expect(exp.oversized).toBe(false);
  });
  it('throws on an invalid PSBT', () => {
    expect(() => makePsbtExport('hello', 'x')).toThrow();
  });
  it('flags oversized payloads for animated-QR handling', () => {
    const big = 'cHNidP8' + 'A'.repeat(1300);
    // pad to a multiple of 4 so it decodes; magic still valid at the front
    const padded = big + '='.repeat((4 - (big.length % 4)) % 4);
    const exp = makePsbtExport(padded, 'big');
    expect(exp.oversized).toBe(true);
  });
});

describe('encodeBase64', () => {
  it('round-trips with decodeBase64 for all padding lengths', () => {
    for (const len of [1, 2, 3, 4, 20, 255]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 31 + 7) & 0xff);
      const encoded = encodeBase64(bytes);
      expect(Array.from(decodeBase64(encoded)!)).toEqual(Array.from(bytes));
    }
  });
});

describe('signer payload classification', () => {
  const psbtBytes = Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 0x01, 0x00]);
  // version 2 | segwit marker+flag | ...
  const segwitTx = Uint8Array.from([2, 0, 0, 0, 0, 1, 1, 0xaa, 0xbb, 0xcc, 0xdd]);
  // version 1 | 1 input | ...
  const legacyTx = Uint8Array.from([1, 0, 0, 0, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee]);

  it('recognises PSBT magic', () => {
    expect(looksLikePsbt(psbtBytes)).toBe(true);
    expect(looksLikePsbt(segwitTx)).toBe(false);
  });

  it('recognises raw transactions', () => {
    expect(looksLikeRawTx(segwitTx)).toBe(true);
    expect(looksLikeRawTx(legacyTx)).toBe(true);
    expect(looksLikeRawTx(psbtBytes)).toBe(false);
  });

  it('decodes pure hex BEFORE base64 (hex is a base64 subset)', () => {
    // "02000000" as hex must yield tx-version bytes, not base64 garbage
    const bytes = decodeHexOrBase64('020000000001'.toUpperCase())!;
    expect(Array.from(bytes.slice(0, 4))).toEqual([2, 0, 0, 0]);
    // base64 payloads still decode
    const b64 = decodeHexOrBase64('cHNidP8BAAA=')!;
    expect(looksLikePsbt(b64)).toBe(true);
  });
});
