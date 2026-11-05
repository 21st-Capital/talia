import { deflateRaw } from 'pako';
import { base32nopad } from '@scure/base';
import {
  encodeBbqr,
  decodeBbqrFrame,
  isBbqrFrame,
  BbqrJoiner,
} from '../bbqr';

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7 + 3) & 0xff;
  return b;
}

describe('BBQr encode', () => {
  it('single frame round-trips', () => {
    const data = bytes(123);
    const frames = encodeBbqr(data, 'P');
    expect(frames).toHaveLength(1);
    expect(frames[0].startsWith('B$2P0100')).toBe(true);
    const j = new BbqrJoiner();
    expect(j.addFrame(frames[0]).done).toBe(true);
    expect(Array.from(j.result())).toEqual(Array.from(data));
  });

  it('multi-frame round-trips out of order with duplicates', () => {
    const data = bytes(1234); // 3 frames at 500 bytes
    const frames = encodeBbqr(data, 'P');
    expect(frames).toHaveLength(3);
    const j = new BbqrJoiner();
    expect(j.addFrame(frames[2]).done).toBe(false);
    expect(j.addFrame(frames[0]).done).toBe(false);
    expect(j.addFrame(frames[0]).have).toBe(2); // duplicate ignored
    expect(j.addFrame(frames[1]).done).toBe(true);
    expect(Array.from(j.result())).toEqual(Array.from(data));
    expect(j.joinedFileType).toBe('P');
  });

  it('every frame except the last holds a multiple of 5 bytes', () => {
    const frames = encodeBbqr(bytes(1234), 'P');
    // 800 base32 chars = 500 bytes for the first two frames
    expect(frames[0].length - 8).toBe(800);
    expect(frames[1].length - 8).toBe(800);
  });
});

describe('BBQr decode', () => {
  it('parses headers', () => {
    const f = decodeBbqrFrame('B$2P0503ABCDEFGH');
    expect(f).toMatchObject({ encoding: '2', fileType: 'P', total: 5, index: 3 });
  });

  it('detects frames', () => {
    expect(isBbqrFrame('B$2P0101AAAA')).toBe(true);
    expect(isBbqrFrame('B$ZJ0A00AAAA')).toBe(true);
    expect(isBbqrFrame('cHNidP8BAH0CAAAAAA==')).toBe(false);
    expect(isBbqrFrame('bitcoin:bc1q...')).toBe(false);
  });

  it('rejects mixed transfers and bad headers', () => {
    const j = new BbqrJoiner();
    j.addFrame('B$2P0200' + base32nopad.encode(bytes(5)));
    expect(() => j.addFrame('B$2T0200' + base32nopad.encode(bytes(5)))).toThrow();
    expect(() => decodeBbqrFrame('B$2P0002AAAA')).toThrow(); // index >= total
  });

  it('inflates Z-encoded transfers (raw deflate, as COLDCARD sends)', () => {
    const data = bytes(2000);
    const compressed = deflateRaw(data, { level: 9 });
    // split compressed bytes on 5-byte boundaries into 2 frames
    const cut = Math.ceil(compressed.length / 2 / 5) * 5;
    const parts = [compressed.subarray(0, cut), compressed.subarray(cut)];
    const j = new BbqrJoiner();
    parts.forEach((p, i) =>
      j.addFrame(`B$ZP02${'0' + i}${base32nopad.encode(p)}`),
    );
    expect(j.progress().done).toBe(true);
    expect(Array.from(j.result())).toEqual(Array.from(data));
  });

  it('decodes hex-encoded transfers', () => {
    const j = new BbqrJoiner();
    j.addFrame('B$HP0100DEADBEEF');
    expect(Array.from(j.result())).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });
});

describe('BBQr against Coinkite reference vectors', () => {
  // Generated with coinkite/BBQr python split_qrs — the exact encoder the
  // COLDCARD runs — for encodings Z, 2, and H over the same payload.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vectors = require('./__fixtures__/reference_vectors.json') as Record<string, string[] | string>;
  const origHex = vectors.orig_hex as string;

  for (const enc of ['Z', '2', 'H'] as const) {
    it(`decodes reference ${enc}-encoded transfer`, () => {
      const j = new BbqrJoiner();
      // shuffle deterministically to prove order independence
      const parts = [...(vectors[enc] as string[])].reverse();
      for (const p of parts) j.addFrame(p);
      expect(j.progress().done).toBe(true);
      const hex = Array.from(j.result())
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      expect(hex).toBe(origHex);
    });
  }
});
