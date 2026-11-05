/**
 * Pure PSBT export/validation helpers.
 *
 * No native dependencies: these run in tests and on-device identically. Actual
 * PSBT *construction* is BDK's job (see build.ts / bdkWalletEngine.ts); this module
 * only validates and packages the resulting base64 for file/QR export.
 */

/** BIP-174 magic bytes: ASCII "psbt" followed by 0xff. */
export const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff] as const;

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < B64_ALPHABET.length; i++) m[B64_ALPHABET[i]] = i;
  return m;
})();

/**
 * Minimal, dependency-free base64 → bytes decoder. Returns null on malformed
 * input. (RN has no global `atob`; this keeps the helper environment-neutral.)
 */
export function decodeBase64(input: string): Uint8Array | null {
  const s = input.replace(/\s+/g, '');
  if (s.length === 0 || s.length % 4 !== 0) return null;
  const clean = s.replace(/=+$/, '');
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const val = B64_LOOKUP[ch];
    if (val === undefined) return null;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Encode bytes as standard base64 (RN has no Buffer; this is encoding, not crypto). */
export function encodeBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[a >> 2];
    out += B64_ALPHABET[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[c & 63] : '=';
  }
  return out;
}

/** True when the bytes start with the BIP-174 magic. */
export function looksLikePsbt(bytes: Uint8Array): boolean {
  return bytes.length > 5 && PSBT_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Heuristic: a consensus-encoded bitcoin transaction — 4-byte LE version
 * (1 or 2), then either the segwit marker (0x00 0x01) or a plausible
 * input count. Enough to route a signer's output; the engine's real parser
 * has the final say.
 */
export function looksLikeRawTx(bytes: Uint8Array): boolean {
  if (bytes.length < 10) return false;
  const version = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  if (version !== 1 && version !== 2) return false;
  const isSegwit = bytes[4] === 0x00 && bytes[5] === 0x01;
  return isSegwit || (bytes[4] > 0 && bytes[4] < 0xfd);
}

/**
 * Decode a signer's TEXT payload into bytes: pure-hex first (hex chars are a
 * subset of base64, so trying base64 first would "succeed" with garbage —
 * the COLDCARD shows finalized transactions as hex), then base64.
 */
export function decodeHexOrBase64(text: string): Uint8Array | null {
  const s = text.trim();
  if (/^[0-9A-Fa-f]+$/.test(s) && s.length % 2 === 0) {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) {
      out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
  }
  return decodeBase64(s);
}

/** True if `s` is base64 that decodes to something starting with the PSBT magic. */
export function isValidBase64Psbt(s: string): boolean {
  const bytes = decodeBase64(s);
  if (!bytes || bytes.length < PSBT_MAGIC.length) return false;
  return PSBT_MAGIC.every((b, i) => bytes[i] === b);
}

/** Make a filesystem-safe slug from an arbitrary label. */
export function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'wallet'
  );
}

/**
 * Produce a stable export filename, e.g. `talia-liana-2of3-a1b2c3d4.psbt`.
 * `txid` is optional; when present its first 8 chars disambiguate exports.
 */
export function psbtFilename(walletLabel: string, txid?: string): string {
  const base = `talia-${slugify(walletLabel)}`;
  const suffix = txid ? `-${txid.slice(0, 8)}` : '';
  return `${base}${suffix}.psbt`;
}

export interface PsbtExport {
  /** The PSBT as base64 (BIP-174), for file contents and clipboard. */
  base64: string;
  /** Suggested filename for a `.psbt` file export. */
  filename: string;
  /**
   * Payload for QR display. Uppercased base64 is widely accepted by air-gapped
   * signers. Large PSBTs may exceed a single QR's capacity — animated QR
   * (BBQr/UR) is a Phase 2 addition; `oversized` flags that case for the UI.
   */
  qrPayload: string;
  oversized: boolean;
}

/** Rough single-QR capacity ceiling (alphanumeric mode, high-ish density). */
const SINGLE_QR_CHAR_LIMIT = 1200;

/** Package a base64 PSBT for the various export transports. */
export function makePsbtExport(
  psbtBase64: string,
  walletLabel: string,
  txid?: string,
): PsbtExport {
  if (!isValidBase64Psbt(psbtBase64)) {
    throw new Error('Not a valid base64 PSBT');
  }
  return {
    base64: psbtBase64,
    filename: psbtFilename(walletLabel, txid),
    qrPayload: psbtBase64.toUpperCase(),
    oversized: psbtBase64.length > SINGLE_QR_CHAR_LIMIT,
  };
}
