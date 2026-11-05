/**
 * BBQr — Coinkite's "Better Bitcoin QR" multi-frame QR format, used by the
 * COLDCARD Q for PSBTs and wallet exports (spec: bbqr.org).
 *
 * Frame layout (all ASCII, QR alphanumeric-friendly):
 *   `B$` <encoding> <filetype> <total:2 base36> <index:2 base36> <payload>
 *
 * Encodings: `H` hex, `2` base32 (RFC 4648, no padding), `Z` raw-deflate
 * (wbits −10) then base32. We ENCODE with `2` (no compressor needed on the
 * phone; the COLDCARD accepts all three) and DECODE all three, since the
 * COLDCARD compresses its own exports when it helps.
 *
 * Split rule: raw bytes are divided so every frame except the last holds a
 * multiple of 5 bytes — each base32 frame then decodes independently with no
 * cross-frame bit alignment.
 */
import { base32nopad, hex } from '@scure/base';
import { inflateRawBounded } from '../qrLimits';

/** BBQr file types we care about (spec defines more). */
export const BBQR_FILETYPES = {
  P: 'psbt',
  T: 'transaction',
  J: 'json',
  U: 'unicode-text',
} as const;
export type BbqrFileType = keyof typeof BBQR_FILETYPES;

export interface BbqrFrame {
  encoding: 'H' | '2' | 'Z';
  fileType: BbqrFileType;
  total: number;
  index: number;
  payload: string;
}

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function toB36(n: number): string {
  if (n < 0 || n >= 36 * 36) throw new Error('BBQr frame count out of range');
  return B36[Math.floor(n / 36)] + B36[n % 36];
}

function fromB36(s: string): number {
  const hi = B36.indexOf(s[0]);
  const lo = B36.indexOf(s[1]);
  if (hi < 0 || lo < 0) throw new Error('Bad base36 in BBQr header');
  return hi * 36 + lo;
}

/**
 * Raw bytes per frame when encoding. 500 bytes → 800 base32 chars → a QR
 * around version 17 at level L: dense enough to keep frame counts low,
 * sparse enough for a hardware wallet's camera at phone brightness.
 * Must stay a multiple of 5 (see split rule above).
 */
const FRAME_BYTES = 500;

/** Encode raw bytes as BBQr base32 frames, ready for an animated QR. */
export function encodeBbqr(data: Uint8Array, fileType: BbqrFileType): string[] {
  if (data.length === 0) throw new Error('Nothing to encode');
  const total = Math.max(1, Math.ceil(data.length / FRAME_BYTES));
  if (total >= 36 * 36) throw new Error('Data too large for BBQr');
  const frames: string[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = data.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES);
    frames.push(`B$2${fileType}${toB36(total)}${toB36(i)}${base32nopad.encode(chunk)}`);
  }
  return frames;
}

/** True if a scanned string looks like a BBQr frame. */
export function isBbqrFrame(text: string): boolean {
  return /^B\$[H2Z][A-Z][0-9A-Z]{4}/.test(text);
}

/** Parse one frame's header + payload (no payload decoding yet). */
export function decodeBbqrFrame(text: string): BbqrFrame {
  if (!isBbqrFrame(text)) throw new Error('Not a BBQr frame');
  const encoding = text[2] as BbqrFrame['encoding'];
  const fileType = text[3] as BbqrFileType;
  const total = fromB36(text.slice(4, 6));
  const index = fromB36(text.slice(6, 8));
  if (total === 0 || index >= total) throw new Error('Inconsistent BBQr header');
  return { encoding, fileType, total, index, payload: text.slice(8) };
}

export interface BbqrJoinProgress {
  have: number;
  total: number;
  done: boolean;
}

/**
 * Accumulates scanned BBQr frames (any order, duplicates fine) and yields the
 * reassembled raw bytes once every part has arrived.
 */
export class BbqrJoiner {
  private frames = new Map<number, string>();
  private encoding: BbqrFrame['encoding'] | null = null;
  private fileType: BbqrFileType | null = null;
  private total = 0;

  /** Feed one scanned string. Returns progress; ignores non-BBQr text. */
  addFrame(text: string): BbqrJoinProgress {
    const f = decodeBbqrFrame(text);
    if (this.encoding == null) {
      this.encoding = f.encoding;
      this.fileType = f.fileType;
      this.total = f.total;
    } else if (
      f.encoding !== this.encoding ||
      f.fileType !== this.fileType ||
      f.total !== this.total
    ) {
      throw new Error('Frame belongs to a different BBQr transfer');
    }
    this.frames.set(f.index, f.payload);
    return this.progress();
  }

  progress(): BbqrJoinProgress {
    return {
      have: this.frames.size,
      total: this.total,
      done: this.total > 0 && this.frames.size === this.total,
    };
  }

  get joinedFileType(): BbqrFileType | null {
    return this.fileType;
  }

  /** Reassemble. Only valid once `progress().done`. */
  result(): Uint8Array {
    if (!this.progress().done || this.encoding == null) {
      throw new Error('BBQr transfer incomplete');
    }
    const parts: Uint8Array[] = [];
    for (let i = 0; i < this.total; i++) {
      const payload = this.frames.get(i)!;
      parts.push(
        this.encoding === 'H'
          ? hex.decode(payload.toLowerCase())
          : base32nopad.decode(payload),
      );
    }
    let bytes = concat(parts);
    if (this.encoding === 'Z') {
      // Bounded (decided 2026-09-26): a deflate bomb in a scanned
      // code must not freeze or crash the app.
      bytes = inflateRawBounded(bytes);
    }
    return bytes;
  }
}

/** Encode a string as UTF-8 bytes (Hermes lacks TextEncoder). */
export function utf8ToBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Decode UTF-8 bytes to a string (Hermes lacks TextDecoder). */
export function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
