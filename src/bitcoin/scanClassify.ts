/**
 * Classify an arbitrary scanned QR payload for the GLOBAL home scanner:
 * a payment address, an importable descriptor/xpub, or an unsigned PSBT.
 *
 * String routing only — real validation stays where it lives today
 * (descriptor layer for imports, BDK for addresses/PSBTs).
 */
import { parseScannedAddress } from './scanParse';
import type { ScannedAddress } from './scanParse';
import { extractImportPayload } from './descriptor';
import { decodeBase64, PSBT_MAGIC } from './psbt/export';
import { SIGNING_ENABLED } from '../config';

export type ScanClassification =
  | { kind: 'address'; parsed: ScannedAddress }
  | { kind: 'descriptor'; payload: string }
  | { kind: 'psbt'; base64: string }
  /**
   * Recognisably a PSBT, but this build cannot act on one. Watch-only v1
   * withholds the payload here, at the single choke point every scanner goes
   * through, so no caller — present or future — can hand it to the ceremony.
   */
  | { kind: 'psbtUnsupported' }
  | { kind: 'unknown' };

/** True when `s` is hex encoding bytes that start with the PSBT magic. */
function hexPsbtToBase64(s: string): string | null {
  const clean = s.replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  if (!clean.toLowerCase().startsWith('70736274ff')) return null;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  // Re-encode as base64 (dependency-free, mirrors decodeBase64).
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += ALPHA[a >> 2] + ALPHA[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : ALPHA[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : ALPHA[c & 63];
  }
  return out;
}

function isBase64Psbt(s: string): boolean {
  const bytes = decodeBase64(s);
  if (!bytes || bytes.length < PSBT_MAGIC.length) return false;
  return PSBT_MAGIC.every((b, i) => bytes[i] === b);
}

export function classifyScan(raw: string): ScanClassification {
  const text = raw.trim();
  if (!text) return { kind: 'unknown' };

  const address = parseScannedAddress(text);
  if (address) return { kind: 'address', parsed: address };

  if (isBase64Psbt(text)) {
    return SIGNING_ENABLED
      ? { kind: 'psbt', base64: text.replace(/\s+/g, '') }
      : { kind: 'psbtUnsupported' };
  }
  const fromHex = hexPsbtToBase64(text);
  if (fromHex) {
    return SIGNING_ENABLED ? { kind: 'psbt', base64: fromHex } : { kind: 'psbtUnsupported' };
  }

  // Bare extended key (xpub/zpub/… — the import flow wraps it in a
  // descriptor via bareKey normalization).
  if (/^[xyztuvYZUV](?:pub|prv)[1-9A-HJ-NP-Za-km-z]{50,120}$/.test(text)) {
    return { kind: 'descriptor', payload: text };
  }

  // Descriptor / whole export file — the import extractor knows all those
  // shapes and throws when none apply.
  try {
    extractImportPayload(text);
    return { kind: 'descriptor', payload: text };
  } catch {
    return { kind: 'unknown' };
  }
}
