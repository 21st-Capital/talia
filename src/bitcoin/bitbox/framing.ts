/**
 * How bytes are cut up for the Nova's Bluetooth link.
 *
 * Three facts force this, and none of them are ours to argue with:
 *
 *   1. The device speaks in 64-byte frames. `bitbox-api` hands a transport
 *      whole U2F-HID frames of exactly 64 bytes.
 *   2. A write to the device must be a MULTIPLE of 64 bytes, at most five
 *      frames at a time, sized against what the link will actually carry.
 *      Write something else and the device drops the frame in silence.
 *   3. react-native-ble-plx does NO chunking on iOS: it base64-decodes what
 *      JS hands it and passes the whole buffer straight to CoreBluetooth. So
 *      the cutting has to happen here.
 *
 * iOS never exposes maximumWriteValueLength directly through ble-plx, but its
 * `device.mtu` IS that value plus three, so the vendor's sizing rule is
 * recoverable. Pure and tested, because getting it wrong produces a device
 * that simply stops answering with nothing to read in a log.
 */

/** The device's frame size. Not configurable, not negotiable. */
export const FRAME = 64;

/** The vendor writes at most five frames per Bluetooth write. */
export const MAX_FRAMES_PER_WRITE = 5;

/**
 * How many bytes one write may carry, given the negotiated MTU.
 *
 * `mtu - 3` is the ATT payload; we round DOWN to whole frames and cap at five.
 * A link that cannot carry even one frame still gets one: a short write is
 * refused by the device, but a zero-length one would spin forever, and iOS in
 * practice negotiates far above 64.
 */
export function writeChunkSize(mtu: number | null | undefined): number {
  const payload = typeof mtu === 'number' && mtu > 3 ? mtu - 3 : 0;
  const frames = Math.floor(payload / FRAME);
  const capped = Math.min(frames, MAX_FRAMES_PER_WRITE);
  return Math.max(1, capped) * FRAME;
}

/**
 * Cut `bytes` into writes, each a whole number of frames.
 *
 * The payload is padded up to a frame boundary first: the device reads frames,
 * so a trailing 37 bytes is not a short frame, it is a malformed one.
 */
export function chunkForWrite(bytes: Uint8Array, mtu: number | null | undefined): Uint8Array[] {
  const size = writeChunkSize(mtu);
  const padded = padToFrame(bytes);
  const out: Uint8Array[] = [];
  for (let i = 0; i < padded.length; i += size) {
    out.push(padded.subarray(i, Math.min(i + size, padded.length)));
  }
  return out;
}

/** Round a payload up to a whole number of 64-byte frames, zero-filled. */
export function padToFrame(bytes: Uint8Array): Uint8Array {
  const remainder = bytes.length % FRAME;
  if (remainder === 0 && bytes.length > 0) return bytes;
  const target = bytes.length === 0 ? FRAME : bytes.length + (FRAME - remainder);
  const out = new Uint8Array(target);
  out.set(bytes);
  return out;
}

/**
 * Reassemble notifications into whole frames.
 *
 * The device notifies in 64-byte chunks, but a subscription may deliver them
 * coalesced or split, so the reader keeps a buffer and yields only complete
 * frames. Anything left over stays for the next notification.
 */
export class FrameReader {
  private buf = new Uint8Array(0);

  /** Feed a notification; returns whatever whole frames that completed. */
  push(chunk: Uint8Array): Uint8Array[] {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    const whole = Math.floor(merged.length / FRAME);
    const frames: Uint8Array[] = [];
    for (let i = 0; i < whole; i++) {
      frames.push(merged.subarray(i * FRAME, (i + 1) * FRAME));
    }
    this.buf = merged.subarray(whole * FRAME);
    return frames;
  }

  /** Bytes held back because they do not yet complete a frame. */
  get pending(): number {
    return this.buf.length;
  }

  reset(): void {
    this.buf = new Uint8Array(0);
  }
}
