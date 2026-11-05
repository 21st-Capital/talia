import {
  FRAME,
  FrameReader,
  MAX_FRAMES_PER_WRITE,
  chunkForWrite,
  padToFrame,
  writeChunkSize,
} from '../framing';

describe('writeChunkSize', () => {
  it('rounds the ATT payload DOWN to whole frames', () => {
    // 185 is a common iOS MTU: payload 182, which holds two whole frames.
    expect(writeChunkSize(185)).toBe(2 * FRAME);
  });

  it('caps at the vendor limit of five frames', () => {
    expect(writeChunkSize(4096)).toBe(MAX_FRAMES_PER_WRITE * FRAME);
  });

  it('never returns zero, however small the link claims to be', () => {
    // A zero-size write would loop forever with nothing sent.
    for (const mtu of [0, 3, 23, 66, null, undefined, -1]) {
      expect(writeChunkSize(mtu)).toBeGreaterThanOrEqual(FRAME);
    }
  });

  it('always returns a whole number of frames', () => {
    for (const mtu of [23, 100, 185, 247, 512, 4096]) {
      expect(writeChunkSize(mtu) % FRAME).toBe(0);
    }
  });
});

describe('padToFrame', () => {
  it('rounds a partial payload up, zero filled', () => {
    const out = padToFrame(new Uint8Array([1, 2, 3]));
    expect(out.length).toBe(FRAME);
    expect(out[0]).toBe(1);
    expect(out[63]).toBe(0);
  });

  it('leaves an exact multiple alone', () => {
    const exact = new Uint8Array(128).fill(7);
    expect(padToFrame(exact)).toBe(exact);
  });

  it('turns nothing into one empty frame, never zero bytes', () => {
    expect(padToFrame(new Uint8Array(0)).length).toBe(FRAME);
  });
});

describe('chunkForWrite', () => {
  it('splits a long payload into whole-frame writes', () => {
    const bytes = new Uint8Array(64 * 12).fill(9);
    const chunks = chunkForWrite(bytes, 185); // 2 frames per write
    expect(chunks).toHaveLength(6);
    for (const c of chunks) expect(c.length).toBe(2 * FRAME);
  });

  it('every chunk is a multiple of the frame size, always', () => {
    // The rule the device enforces by silently dropping anything else.
    for (const len of [1, 63, 64, 65, 200, 640, 1000]) {
      for (const mtu of [23, 185, 247, 4096]) {
        for (const c of chunkForWrite(new Uint8Array(len), mtu)) {
          expect(c.length % FRAME).toBe(0);
        }
      }
    }
  });

  it('loses no bytes: the payload survives reassembly', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 251);
    const joined = chunkForWrite(bytes, 247).reduce<number[]>((a, c) => a.concat([...c]), []);
    expect(joined.slice(0, 300)).toEqual([...bytes]);
  });
});

describe('FrameReader', () => {
  it('yields whole frames and holds the remainder back', () => {
    const r = new FrameReader();
    expect(r.push(new Uint8Array(30))).toHaveLength(0);
    expect(r.pending).toBe(30);
    expect(r.push(new Uint8Array(34))).toHaveLength(1); // 30 + 34 = 64
    expect(r.pending).toBe(0);
  });

  it('splits a coalesced notification into several frames', () => {
    const r = new FrameReader();
    expect(r.push(new Uint8Array(64 * 3))).toHaveLength(3);
  });

  it('reassembles bytes in order across arbitrary splits', () => {
    const source = Uint8Array.from({ length: 64 * 4 }, (_, i) => i % 256);
    const r = new FrameReader();
    const got: number[] = [];
    // Deliberately awkward split sizes, none of them frame-aligned.
    for (const size of [7, 100, 3, 60, 46, 40]) {
      const start = got.length + r.pending;
      for (const f of r.push(source.subarray(start, start + size))) got.push(...f);
    }
    expect(got).toEqual([...source.subarray(0, got.length)]);
    expect(got.length % FRAME).toBe(0);
  });

  it('forgets its buffer on reset, so a reconnect cannot inherit half a frame', () => {
    const r = new FrameReader();
    r.push(new Uint8Array(10));
    r.reset();
    expect(r.pending).toBe(0);
  });
});
