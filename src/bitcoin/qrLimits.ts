/**
 * Size limits for data scanned from a QR code (decided
 * 2026-09-26). A QR code is untrusted input: anyone can show one to the
 * camera or leave one in the photo library.
 *
 * Two decoders trusted sizes the code itself declared. A UR part's
 * sequence header ("ur:crypto-psbt/5000001-5000000/...") made the fountain
 * decoder allocate and shuffle arrays of that length on the first part,
 * and a BBQr "Z" transfer inflated with no ceiling, so one small code could
 * freeze or crash the app in the middle of a signing or a rescue.
 *
 * The limits are far above anything Talia sends or receives: a PSBT
 * spending hundreds of coins is a few hundred kilobytes, which at the
 * 200-byte parts Talia and the signers use is about a thousand UR parts.
 */
import { Inflate } from 'pako';

/** The most parts a UR transfer may declare. */
export const MAX_UR_PARTS = 2000;

/** The most bytes a scanned transfer may decode to (after inflating). */
export const MAX_QR_PAYLOAD_BYTES = 4 * 1024 * 1024;

/**
 * The declared part count of a multi-part UR string ("ur:type/7-12/...")
 * and whether it is within the limit. A single-part UR has no sequence
 * header and is bounded by the QR code itself.
 *
 * The string is split exactly the way the bc-ur decoder splits it
 * (lower-cased, "/" separated), so what is checked here is what the
 * decoder reads. The decoder turns the counts into numbers with Number(),
 * which also reads "5e6", "0x4c4b40" and "5000000.0"; here only plain
 * digits pass, and anything that is not recognisably a single-part code
 * is refused rather than waved through.
 */
export function urSequenceWithinLimit(part: string): boolean {
  const lower = part.trim().toLowerCase();
  if (!lower.startsWith('ur:')) return false;
  const components = lower.slice(3).split('/');
  // [type, body] is a single-part code.
  if (components.length === 2) return true;
  // [type, seq, fragment] is one part of a sequence; anything else is
  // refused by the decoder anyway.
  if (components.length !== 3) return false;
  const m = /^(\d{1,10})-(\d{1,4})$/.exec(components[1]);
  if (!m) return false;
  const seqNum = Number(m[1]);
  const seqLen = Number(m[2]);
  return seqLen >= 1 && seqLen <= MAX_UR_PARTS && seqNum >= 1 && seqNum <= 0xffffffff;
}

/**
 * Raw-inflate with a ceiling on the output: the decoder stops as soon as
 * the output passes `max` bytes instead of allocating whatever the stream
 * asks for (a deflate "bomb" expands a few kilobytes to gigabytes).
 */
export function inflateRawBounded(bytes: Uint8Array, max = MAX_QR_PAYLOAD_BYTES): Uint8Array {
  const inflater = new Inflate({ raw: true, chunkSize: 64 * 1024 });
  const chunks: Uint8Array[] = [];
  let total = 0;
  inflater.onData = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > max) throw new Error('The scanned code holds more data than Talia accepts.');
    chunks.push(chunk);
  };
  inflater.push(bytes, true);
  if (inflater.err) throw new Error(inflater.msg || 'The scanned code could not be unpacked.');
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
