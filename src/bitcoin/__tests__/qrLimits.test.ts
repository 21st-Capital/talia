/**
 * Decided 2026-09-26: one scanned QR code could freeze
 * or crash the app, through a UR part declaring millions of parts or a
 * BBQr deflate bomb.
 */
import { deflateRaw } from 'pako';
import { base32nopad } from '@scure/base';
import { MAX_UR_PARTS, MAX_QR_PAYLOAD_BYTES, inflateRawBounded, urSequenceWithinLimit } from '../qrLimits';
import { UrJoiner } from '../ur/ur';
import { BbqrJoiner } from '../bbqr/bbqr';

describe('UR part counts', () => {
  it('a declared count above the limit is refused before the decoder sees it', () => {
    expect(urSequenceWithinLimit('ur:crypto-psbt/5000001-5000000/lpadaxcfaxhlcy')).toBe(false);
    const joiner = new UrJoiner();
    expect(() => joiner.addPart('ur:crypto-psbt/5000001-5000000/lpadaxcfaxhlcy')).toThrow('larger than Talia accepts');
  });

  it('normal transfers and single-part codes pass', () => {
    expect(urSequenceWithinLimit('ur:crypto-psbt/1-12/lpadbbcfaxhlcy')).toBe(true);
    expect(urSequenceWithinLimit(`ur:crypto-psbt/7-${MAX_UR_PARTS}/lpad`)).toBe(true);
    expect(urSequenceWithinLimit('ur:crypto-psbt/hdosjojkidjyzmadaejs')).toBe(true);
    expect(urSequenceWithinLimit('UR:CRYPTO-PSBT/3-12/LPADBBCFAXHLCY')).toBe(true);
  });

  // And: bc-ur reads the counts with Number(),
  // which also accepts exponent, hex and decimal forms.
  it.each(['1-5e6', '1-0x4c4b40', '1-5000000.0', '1-3e7', '1-+5000000', '1- 12', '0x1-12', '1-12-3', '1-'])(
    'a count written as %s is refused, not treated as a single part',
    (seq) => {
      expect(urSequenceWithinLimit(`ur:crypto-psbt/${seq}/lpadaxcfaxhlcy`)).toBe(false);
    },
  );

  it('extra path components and non-UR text are refused', () => {
    expect(urSequenceWithinLimit('ur:crypto-psbt/1-12/lpad/extra')).toBe(false);
    expect(urSequenceWithinLimit('ur:crypto-psbt')).toBe(false);
    expect(urSequenceWithinLimit('hello')).toBe(false);
  });

  it('a real fountain part declaring 30 million parts in exponent form never reaches the decoder', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FountainEncoderPart } = require('@ngraveio/bc-ur/dist/fountainEncoder');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bytewords = require('@ngraveio/bc-ur/dist/bytewords').default;
    const part = new FountainEncoderPart(1, 30_000_000, 100, 12345, Buffer.from('hello world'));
    const words = bytewords.encode(part.cbor().toString('hex'), bytewords.STYLES.MINIMAL);
    const joiner = new UrJoiner();
    expect(() => joiner.addPart(`ur:crypto-psbt/1-3e7/${words}`)).toThrow('larger than Talia accepts');
    expect(joiner.progress().total).toBe(0);
  });
});

describe('bounded inflate', () => {
  const bomb = deflateRaw(new Uint8Array(MAX_QR_PAYLOAD_BYTES + 1024 * 1024));

  it('stops a deflate bomb instead of allocating it', () => {
    expect(bomb.length).toBeLessThan(20_000);
    expect(() => inflateRawBounded(bomb)).toThrow('more data than Talia accepts');
  });

  it('a BBQr Z transfer holding one is refused', () => {
    const joiner = new BbqrJoiner();
    joiner.addFrame(`B$ZP0100${base32nopad.encode(bomb)}`);
    expect(joiner.progress().done).toBe(true);
    expect(() => joiner.result()).toThrow('more data than Talia accepts');
  });

  it('ordinary data inflates to the same bytes', () => {
    const data = Uint8Array.from({ length: 5000 }, (_, i) => i % 251);
    expect(Array.from(inflateRawBounded(deflateRaw(data)))).toEqual(Array.from(data));
  });
});
