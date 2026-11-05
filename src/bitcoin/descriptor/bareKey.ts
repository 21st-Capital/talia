/**
 * Bare extended-key import (BlueWallet-style).
 *
 * Users coming from other wallets often have only an extended public key —
 * `xpub…`, or a SLIP-132 variant (`zpub`/`ypub`/`vpub`/`upub`) — rather than a
 * full output descriptor. BDK understands neither bare keys nor SLIP-132
 * version bytes, so at import time we:
 *
 *   1. decode the key (base58check, via audited @scure/@noble primitives),
 *   2. map its SLIP-132 version bytes to the script type they conventionally
 *      encode (zpub → native segwit, ypub → nested segwit),
 *   3. re-encode with the standard xpub/tpub version bytes, and
 *   4. wrap it in the corresponding descriptor with a multipath `<0;1>` spine
 *      (the engine splits that into receive/change).
 *
 * Plain xpub/tpub carry no script hint; we assume native segwit (BIP-84, the
 * modern default) and surface a warning so legacy-wallet users know to import
 * a `pkh(...)` descriptor instead. This is encoding work only — no key
 * derivation or cryptography happens here; BDK remains the wallet engine.
 */
import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';

const base58check = createBase58check(sha256);

/** Wrap styles a bare key can imply. */
type Wrap = 'wpkh' | 'sh-wpkh';

interface VersionInfo {
  /** 4-byte version prefix (hex) of this key encoding. */
  version: string;
  /** Standard version to re-encode to (undefined = already standard). */
  convertTo?: string;
  wrap: Wrap;
  /** True when the wrap is an assumption rather than encoded in the prefix. */
  wrapAssumed: boolean;
}

/** SLIP-132 single-sig version bytes. Multisig variants (Ypub/Zpub…) are rejected. */
const VERSIONS: Record<string, VersionInfo> = {
  xpub: { version: '0488b21e', wrap: 'wpkh', wrapAssumed: true },
  tpub: { version: '043587cf', wrap: 'wpkh', wrapAssumed: true },
  ypub: { version: '049d7cb2', convertTo: '0488b21e', wrap: 'sh-wpkh', wrapAssumed: false },
  zpub: { version: '04b24746', convertTo: '0488b21e', wrap: 'wpkh', wrapAssumed: false },
  upub: { version: '044a5262', convertTo: '043587cf', wrap: 'sh-wpkh', wrapAssumed: false },
  vpub: { version: '045f1cf6', convertTo: '043587cf', wrap: 'wpkh', wrapAssumed: false },
};

/** `[fingerprint/origin]` + bare key + optional derivation path — nothing else. */
const BARE_KEY_RE =
  /^(\[[0-9a-fA-F]{8}(?:\/[0-9]+['hH]?)*\])?([A-Za-z]pub[1-9A-HJ-NP-Za-km-z]{60,120})((?:\/[<>;0-9*'hH]+)+)?$/;

export interface NormalizedBareKey {
  /** A full descriptor string ready for the regular import pipeline. */
  descriptor: string;
  /** Import-UX warnings accumulated during normalization. */
  warnings: string[];
}

/**
 * If `raw` is a bare extended key (optionally with origin/path), convert it to
 * a descriptor. Returns null when the input is not a bare key (i.e. it is
 * already a descriptor or something else entirely). Throws with a
 * user-readable message when it *is* a bare key but cannot be used.
 */
export function normalizeBareKey(raw: string): NormalizedBareKey | null {
  const m = BARE_KEY_RE.exec(raw.trim().replace(/\s+/g, ''));
  if (!m) return null;
  const [, origin, key, path] = m;

  const prefix = key.slice(0, 4);
  const info = VERSIONS[prefix];
  if (!info) {
    throw new Error(
      `Unsupported extended-key prefix "${prefix}". For multisig keys (Ypub/Zpub), ` +
        'import the full wallet descriptor instead.',
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = base58check.decode(key);
  } catch {
    throw new Error('Invalid extended key. The checksum does not match, so check for typos.');
  }
  if (bytes.length !== 78) {
    throw new Error('Invalid extended key. Its length is wrong.');
  }

  const warnings: string[] = [];
  let standardKey = key;
  if (info.convertTo) {
    const converted = new Uint8Array(bytes);
    converted.set(hexToBytes(info.convertTo), 0);
    standardKey = base58check.encode(converted);
    warnings.push(`Converted ${prefix} to ${standardKey.slice(0, 4)} (same key, standard encoding).`);
  }
  if (info.wrapAssumed) {
    warnings.push(
      'Bare key imported. Talia assumed native segwit (BIP-84). If this wallet ' +
        'is legacy or nested segwit, import its full descriptor instead.',
    );
  }
  if (!origin) {
    warnings.push(
      'No key origin (fingerprint/path). Hardware signers may not recognise ' +
        'transactions built from this wallet.',
    );
  }

  const spine = path ?? '/<0;1>/*';
  const inner = `${origin ?? ''}${standardKey}${spine}`;
  const descriptor = info.wrap === 'sh-wpkh' ? `sh(wpkh(${inner}))` : `wpkh(${inner})`;
  return { descriptor, warnings };
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
