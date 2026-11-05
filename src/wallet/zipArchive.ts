/**
 * A minimal ZIP writer and reader, for carrying the encrypted vault backup
 * through mail apps (decided 2026-09-02).
 *
 * WHY A ZIP AT ALL. The backup is a `.bed` file, and Gmail's share extension
 * refuses it with "File can't be attached", even once Talia declares the type
 * in Info.plist: Gmail attaches only file types it knows. A zip is one every
 * mail app takes. Liana users unzip on the desktop; Talia opens the zip itself
 * (ImportScreen), so a restore from the email is still one pick.
 *
 * Scope, deliberately small: STORED entries when writing (the payload is
 * ciphertext, incompressible), stored or deflated when reading (a user may
 * re-zip with compression), one disk, no encryption, no zip64. The reader
 * walks the central directory, so a data-descriptor zip and a macOS
 * `__MACOSX/` folder are handled; callers pick the entry they want.
 *
 * Pure: no I/O, no native code. Tested.
 */
import { deflateRaw } from 'pako';
import { inflateRawBounded } from '../bitcoin/qrLimits';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
/** General-purpose flag bit 11: file names are UTF-8. */
const FLAG_UTF8 = 0x0800;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

// ─── CRC-32 (IEEE 802.3, as zip requires) ────────────────────────────────────

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;
  u16(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]));
  }
  u32(v: number): void {
    this.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]));
  }
  push(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

// ─── writer ──────────────────────────────────────────────────────────────────

/**
 * Build a zip. Entries are STORED unless `deflate` is set (used by the tests
 * to exercise the reader's deflate branch; the app never needs it).
 */
export function buildZip(
  entries: readonly ZipEntry[],
  opts: { deflate?: boolean; now?: Date } = {},
): Uint8Array {
  const w = new Writer();
  const { time, date } = dosDateTime(opts.now ?? new Date());
  const central: Array<() => void> = [];

  for (const e of entries) {
    const name = utf8.encode(e.name);
    const method = opts.deflate ? METHOD_DEFLATE : METHOD_STORE;
    const payload = opts.deflate ? deflateRaw(e.data) : e.data;
    const crc = crc32(e.data);
    const offset = w.length;

    w.u32(SIG_LOCAL);
    w.u16(20); // version needed: 2.0
    w.u16(FLAG_UTF8);
    w.u16(method);
    w.u16(time);
    w.u16(date);
    w.u32(crc);
    w.u32(payload.length);
    w.u32(e.data.length);
    w.u16(name.length);
    w.u16(0); // extra
    w.push(name);
    w.push(payload);

    central.push(() => {
      w.u32(SIG_CENTRAL);
      w.u16(20); // version made by
      w.u16(20); // version needed
      w.u16(FLAG_UTF8);
      w.u16(method);
      w.u16(time);
      w.u16(date);
      w.u32(crc);
      w.u32(payload.length);
      w.u32(e.data.length);
      w.u16(name.length);
      w.u16(0); // extra
      w.u16(0); // comment
      w.u16(0); // disk number start
      w.u16(0); // internal attributes
      w.u32(0); // external attributes
      w.u32(offset);
      w.push(name);
    });
  }

  const cdStart = w.length;
  for (const write of central) write();
  const cdSize = w.length - cdStart;

  w.u32(SIG_EOCD);
  w.u16(0); // this disk
  w.u16(0); // disk with the central directory
  w.u16(entries.length);
  w.u16(entries.length);
  w.u32(cdSize);
  w.u32(cdStart);
  w.u16(0); // comment
  return w.bytes();
}

// ─── reader ──────────────────────────────────────────────────────────────────

/** Does this look like a zip? (Local header or empty-archive signature.) */
export function isZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const sig = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  return (sig >>> 0) === SIG_LOCAL || (sig >>> 0) === SIG_EOCD;
}

/**
 * The entries of a zip, directories omitted. Returns null when the bytes are
 * not a zip this reader understands (no central directory, an unsupported
 * compression method, a CRC that does not match). Never throws on bad input.
 */
export function unzip(bytes: Uint8Array): ZipEntry[] | null {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // The end-of-central-directory record sits at the very end, before an
    // optional comment of up to 65 535 bytes.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
      if (view.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return null;
    const count = view.getUint16(eocd + 10, true);
    const cdOffset = view.getUint32(eocd + 16, true);

    const out: ZipEntry[] = [];
    let p = cdOffset;
    for (let n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== SIG_CENTRAL) return null;
      const flags = view.getUint16(p + 8, true);
      const method = view.getUint16(p + 10, true);
      const crc = view.getUint32(p + 16, true);
      const csize = view.getUint32(p + 20, true);
      const usize = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      const localOffset = view.getUint32(p + 42, true);
      const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;

      // Names are UTF-8 when the flag says so, else CP437; every name we
      // care about is ASCII, which both agree on.
      const name = utf8Decoder.decode(nameBytes);
      void flags;
      if (name.endsWith('/')) continue; // a directory

      if (view.getUint32(localOffset, true) !== SIG_LOCAL) return null;
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const payload = bytes.subarray(dataStart, dataStart + csize);

      let data: Uint8Array;
      if (method === METHOD_STORE) data = new Uint8Array(payload);
      // Bounded by the size the entry declares (and 32 MB at most): a
      // picked file is as untrusted as a scanned code (decided 2026-09-26).
      else if (method === METHOD_DEFLATE) data = inflateRawBounded(payload, Math.min(usize, 32 * 1024 * 1024));
      else return null;
      if (data.length !== usize || crc32(data) !== crc) return null;
      out.push({ name, data });
    }
    return out;
  } catch {
    return null;
  }
}
