/**
 * Coldcard "Generic JSON" export (Advanced → MicroSD → Export Wallet →
 * Generic JSON, `coldcard-export.json`) — the airgapped way to hand a
 * Coldcard's PUBLIC keys to a watch-only wallet or a vault builder.
 *
 * Shape (fields we use):
 *   { "xfp": "0F056943", "xpub": "<root>",
 *     "bip84":   { "deriv": "m/84'/0'/0'",     "xpub": "xpub6C…", "name": "p2wpkh" },
 *     "bip86":   { "deriv": "m/86'/0'/0'",     "xpub": "xpub6D…", "name": "p2tr"   },
 *     "bip48_2": { "deriv": "m/48'/0'/0'/2'",  "xpub": "xpub6E…", "name": "p2wsh"  }, … }
 *
 * String classification only, like the rest of this layer — no key material
 * is validated here (BDK does that at wallet creation).
 */

import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';

const base58check = createBase58check(sha256);

export interface ColdcardAccount {
  /** Origin path without the leading m/, e.g. "84'/0'/0'". */
  originPath: string;
  xpub: string;
}

/**
 * SLIP-132 multisig version bytes → standard xpub/tpub. The Coldcard's
 * Multisig → Export XPUB file encodes its P2WSH key as Zpub (mainnet) /
 * Vpub (testnet). Same key, different dress — this is encoding, not crypto.
 */
const SLIP132_MULTISIG: Record<string, string> = {
  Zpub: '0488b21e', // → xpub
  Vpub: '043587cf', // → tpub
};

function slip132ToStandard(key: string): string | null {
  const prefix = key.slice(0, 4);
  if (/^[xt]pub$/.test(prefix)) return key; // already standard
  const to = SLIP132_MULTISIG[prefix];
  if (!to) return null; // Ypub/Upub (p2sh-p2wsh) etc. — not our shape
  try {
    const bytes = base58check.decode(key);
    if (bytes.length !== 78) return null;
    const converted = new Uint8Array(bytes);
    converted.set(
      Uint8Array.from(to.match(/../g)!.map((h) => parseInt(h, 16))),
      0,
    );
    return base58check.encode(converted);
  } catch {
    return null;
  }
}

export interface ColdcardExport {
  /** Master fingerprint, lowercase hex. */
  fingerprint: string;
  /** BIP-84 native-segwit single-sig account. */
  bip84?: ColdcardAccount;
  /** BIP-86 taproot single-sig account (firmware ≥ 5.x / Edge). */
  bip86?: ColdcardAccount;
  /** BIP-48/…/2' P2WSH multisig account. */
  bip48_2?: ColdcardAccount;
  /** BIP-44 legacy account, present in the same export. Read so a vault
   *  built on it can be matched to the device that holds it. */
  bip44?: ColdcardAccount;
  /** BIP-49 nested segwit account, same reason. */
  bip49?: ColdcardAccount;
}

const XPUB_RE = /^[xt]pub[1-9A-HJ-NP-Za-km-z]{50,120}$/;

function account(v: unknown): ColdcardAccount | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { deriv?: unknown; xpub?: unknown };
  if (typeof o.deriv !== 'string' || typeof o.xpub !== 'string') return undefined;
  if (!XPUB_RE.test(o.xpub)) return undefined;
  const originPath = o.deriv.replace(/^m\//, '');
  if (!/^[0-9'h/]+$/i.test(originPath)) return undefined;
  return { originPath, xpub: o.xpub };
}

/**
 * Parse a Coldcard Generic JSON export. Returns null when the content isn't
 * Coldcard-shaped (callers fall through to the generic import scanner).
 */
export function parseColdcardExport(content: string): ColdcardExport | null {
  const text = content.trim();
  if (!text.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  // The xfp + per-purpose accounts are the Coldcard signature; Electrum and
  // other JSON exports have neither.
  if (typeof o.xfp !== 'string' || !/^[0-9a-fA-F]{8}$/.test(o.xfp)) return null;
  const bip84 = account(o.bip84);
  const bip86 = account(o.bip86);
  const bip44 = account(o.bip44);
  const bip49 = account(o.bip49);
  let bip48_2 = account(o.bip48_2);
  // Multisig "Export XPUB" file (Settings → Multisig → Export XPUB): the
  // P2WSH key arrives SLIP-132-dressed as Zpub/Vpub with its own deriv field
  // ({ xfp, p2wsh_deriv: "m/48'/0'/0'/2'", p2wsh: "Zpub…" }).
  if (!bip48_2 && typeof o.p2wsh === 'string' && typeof o.p2wsh_deriv === 'string') {
    const xpub = slip132ToStandard(o.p2wsh.trim());
    const originPath = o.p2wsh_deriv.trim().replace(/^m\//, '');
    if (xpub && XPUB_RE.test(xpub) && /^[0-9'h/]+$/i.test(originPath)) {
      bip48_2 = { originPath, xpub };
    }
  }
  if (!bip84 && !bip86 && !bip48_2 && !bip44 && !bip49) return null;
  return {
    fingerprint: o.xfp.toLowerCase(),
    bip84,
    bip86,
    bip48_2,
    bip44,
    bip49,
  };
}
