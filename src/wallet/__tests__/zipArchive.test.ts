import { buildZip, crc32, isZip, unzip } from '../zipArchive';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('crc32', () => {
  it('matches the reference vector', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
  });
  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('buildZip / unzip', () => {
  const now = new Date(2026, 8, 2, 16, 58, 30);

  it('round-trips a stored entry', () => {
    const payload = new Uint8Array([0x42, 0x45, 0x42, 1, 0, 5, 200, 255, 0, 17]);
    const zip = buildZip([{ name: 'talia-backup-Vault-2026-09-02.bed', data: payload }], { now });
    expect(isZip(zip)).toBe(true);
    const entries = unzip(zip);
    expect(entries).not.toBeNull();
    expect(entries!).toHaveLength(1);
    expect(entries![0].name).toBe('talia-backup-Vault-2026-09-02.bed');
    expect(Array.from(entries![0].data)).toEqual(Array.from(payload));
  });

  it('writes the signatures and sizes zip readers expect', () => {
    const zip = buildZip([{ name: 'a.bin', data: new Uint8Array([1, 2, 3]) }], { now });
    // Local header at 0, central directory after 30 + 5 + 3 bytes, EOCD last.
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0); // stored
    expect(view.getUint32(18, true)).toBe(3); // compressed size
    expect(view.getUint32(22, true)).toBe(3); // uncompressed size
    expect(view.getUint32(38, true)).toBe(0x02014b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1); // entries
    expect(view.getUint32(zip.length - 22 + 16, true)).toBe(38); // cd offset
  });

  it('reads a deflated entry, as a user re-zipping with compression would make', () => {
    const payload = bytes('hello hello hello hello hello hello hello');
    const zip = buildZip([{ name: 'note.txt', data: payload }], { deflate: true, now });
    const view = new DataView(zip.buffer);
    expect(view.getUint16(8, true)).toBe(8); // deflate
    const entries = unzip(zip);
    expect(entries).not.toBeNull();
    expect(text(entries![0].data)).toBe(text(payload));
  });

  it('skips directory entries and keeps several files', () => {
    const zip = buildZip(
      [
        { name: '__MACOSX/', data: new Uint8Array() },
        { name: '__MACOSX/._x.bed', data: bytes('junk') },
        { name: 'x.bed', data: bytes('the one') },
      ],
      { now },
    );
    const names = unzip(zip)!.map((e) => e.name);
    expect(names).toEqual(['__MACOSX/._x.bed', 'x.bed']);
  });

  it('returns null for anything that is not a zip', () => {
    expect(isZip(bytes('BEB'))).toBe(false);
    expect(unzip(bytes('definitely not a zip file at all'))).toBeNull();
    expect(unzip(new Uint8Array())).toBeNull();
  });

  it('returns null when a CRC does not match', () => {
    const zip = buildZip([{ name: 'a', data: bytes('abc') }], { now });
    zip[30 + 1] ^= 0xff; // flip a payload byte after the 30-byte header + 1-char name
    expect(unzip(zip)).toBeNull();
  });
});
