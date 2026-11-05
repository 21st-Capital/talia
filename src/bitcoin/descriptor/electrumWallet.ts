/**
 * Electrum-format wallet files, which is how Sparrow exports a vault WITH
 * the names of the devices behind it (decided 2026-09-09: "can we use sparrows
 * own export instead?" Its own format is an H2 database, and Caravan is a
 * competitor, so this is the one export in that dialog that carries what
 * we need and is plain JSON).
 *
 * Shape, from Sparrow's Electrum.java: a flat object of keystores, keyed
 * `keystore` for a single-key wallet and `x1/`, `x2/` ... for a shared
 * one, plus `wallet_type` which is either "standard" or "<k>of<n>". Each
 * keystore carries `xpub`, and for a hardware key also `label` (what the
 * owner called it, usually the model), `hw_type`, `root_fingerprint` and
 * `derivation`.
 *
 * The descriptor is composed here, so two rules apply:
 *  - The SCRIPT TYPE comes from the derivation path when there is one,
 *    and only from the key's SLIP-132 header when there is not. Sparrow
 *    writes a taproot key with a plain xpub header, which reads as
 *    native segwit and would build a wallet watching the wrong addresses.
 *  - Anything ambiguous is REFUSED rather than guessed: mixed script
 *    types across keystores, a quorum that does not match the number of
 *    keys, an unreadable key. A wrong descriptor is a wallet that shows
 *    no coins while the coins sit somewhere else.
 *
 * Private material is never read. A keystore may carry `xprv` or a seed;
 * only the public half is touched here, and `importFile` warns about the
 * source separately.
 */
import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';

const base58check = createBase58check(sha256);

/** SLIP-132 version bytes → the standard version and what they imply. */
const HEADERS: Record<string, { standard: string; script: ScriptShape }> = {
  '0488b21e': { standard: '0488b21e', script: 'wpkh' }, // xpub, no hint
  '043587cf': { standard: '043587cf', script: 'wpkh' }, // tpub, no hint
  '049d7cb2': { standard: '0488b21e', script: 'sh-wpkh' }, // ypub
  '04b24746': { standard: '0488b21e', script: 'wpkh' }, // zpub
  '044a5262': { standard: '043587cf', script: 'sh-wpkh' }, // upub
  '045f1cf6': { standard: '043587cf', script: 'wpkh' }, // vpub
  '0295b43f': { standard: '0488b21e', script: 'sh-wsh' }, // Ypub, multisig
  '02aa7ed3': { standard: '0488b21e', script: 'wsh' }, // Zpub, multisig
  '024289ef': { standard: '043587cf', script: 'sh-wsh' }, // Upub, multisig
  '02575483': { standard: '043587cf', script: 'wsh' }, // Vpub, multisig
};

type ScriptShape = 'pkh' | 'sh-wpkh' | 'wpkh' | 'tr' | 'sh-wsh' | 'wsh';

/** The shape a BIP-44 style purpose implies, which beats the key's header. */
function shapeFromPath(path: string): ScriptShape | null {
  const purpose = /^m?\/?(\d+)['h]/i.exec(path.trim());
  if (!purpose) return null;
  switch (purpose[1]) {
    case '44':
      return 'pkh';
    case '49':
      return 'sh-wpkh';
    case '84':
      return 'wpkh';
    case '86':
      return 'tr';
    case '48': {
      // 48'/coin'/account'/script': 1' is p2sh-p2wsh, 2' is p2wsh.
      const script = /\/(\d+)['h]\s*$/i.exec(path.trim());
      if (script?.[1] === '1') return 'sh-wsh';
      if (script?.[1] === '2') return 'wsh';
      return null;
    }
    case '45':
      return null; // legacy multisig, ambiguous without more
    default:
      return null;
  }
}

export interface ElectrumWalletKey {
  /** Standard-encoded extended public key (xpub/tpub). */
  xpub: string;
  /** Lowercase master fingerprint, when the file records one. */
  fingerprint: string | null;
  /** Origin path without a leading "m/", when the file records one. */
  originPath: string | null;
  /** What the owner called this key, usually the device model. */
  label: string | null;
  /** The device type the file names, e.g. "ledger", "bitbox02". */
  device: string | null;
}

export interface ElectrumWallet {
  descriptor: string;
  threshold: number;
  keys: ElectrumWalletKey[];
  /** Key label per lowercase fingerprint, ready for `WalletMeta.keyLabels`. */
  keyLabels: Record<string, string>;
  warnings: string[];
}

/** Decode an extended key and say which standard encoding it really is. */
function normalizeKey(raw: string): { xpub: string; script: ScriptShape } | null {
  let bytes: Uint8Array;
  try {
    bytes = base58check.decode(raw.trim());
  } catch {
    return null;
  }
  if (bytes.length !== 78) return null;
  const version = Array.from(bytes.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const header = HEADERS[version];
  if (!header) return null;
  const out = new Uint8Array(bytes);
  out.set(
    (header.standard.match(/../g) ?? []).map((h) => parseInt(h, 16)),
    0,
  );
  return { xpub: base58check.encode(out), script: header.script };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Read an Electrum-format wallet file. Returns null when the text is not
 * one; THROWS with a plain sentence when it is one Talia must not guess
 * at, so the import can say why rather than falling through to a generic
 * "no descriptor found".
 */
export function parseElectrumWallet(content: string): ElectrumWallet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.trim());
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const walletType = parsed.wallet_type;
  if (typeof walletType !== 'string') return null;

  // The keystores, in the order Electrum names them.
  const entries: Array<[string, Record<string, unknown>]> = [];
  for (const [key, value] of Object.entries(parsed)) {
    if ((key === 'keystore' || /^x\d+\/$/.test(key)) && isRecord(value)) {
      entries.push([key, value]);
    }
  }
  if (entries.length === 0) return null;
  entries.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

  let threshold: number;
  if (walletType === 'standard') {
    threshold = 1;
  } else {
    const quorum = /^(\d+)of(\d+)$/.exec(walletType);
    if (!quorum) throw new Error(`This Electrum wallet is a "${walletType}", which Talia cannot read.`);
    threshold = Number(quorum[1]);
    if (Number(quorum[2]) !== entries.length) {
      throw new Error('This file says how many keys the wallet has, and does not carry that many.');
    }
  }
  if (threshold < 1 || threshold > entries.length) {
    throw new Error('This file asks for more signatures than it has keys.');
  }

  const warnings: string[] = [];
  const keys: ElectrumWalletKey[] = [];
  const shapes = new Set<ScriptShape>();
  for (const [name, ks] of entries) {
    const raw = typeof ks.xpub === 'string' ? ks.xpub : null;
    if (!raw) throw new Error(`Key "${name}" in this file has no public key, so the wallet cannot be rebuilt.`);
    const key = normalizeKey(raw);
    if (!key) throw new Error(`Key "${name}" in this file is not an extended public key Talia understands.`);
    const originPath =
      typeof ks.derivation === 'string' && /^m?\/?[0-9'h/]+$/i.test(ks.derivation.trim())
        ? ks.derivation.trim().replace(/^m\//, '').replace(/[hH]/g, "'")
        : null;
    shapes.add((originPath ? shapeFromPath(originPath) : null) ?? key.script);
    const fingerprintRaw =
      (typeof ks.root_fingerprint === 'string' && ks.root_fingerprint) ||
      (typeof ks.ckcc_xfp === 'string' && ks.ckcc_xfp) ||
      null;
    const fingerprint =
      fingerprintRaw && /^[0-9a-fA-F]{8}$/.test(fingerprintRaw) ? fingerprintRaw.toLowerCase() : null;
    keys.push({
      xpub: key.xpub,
      fingerprint,
      originPath,
      label: typeof ks.label === 'string' && ks.label.trim() ? ks.label.trim() : null,
      device: typeof ks.hw_type === 'string' && ks.hw_type.trim() ? ks.hw_type.trim() : null,
    });
  }

  if (shapes.size > 1) {
    throw new Error('The keys in this file are for different address types, so Talia cannot rebuild the wallet.');
  }
  const shape = [...shapes][0] as ScriptShape;
  const multi = entries.length > 1;
  if (multi && (shape === 'wpkh' || shape === 'sh-wpkh' || shape === 'pkh' || shape === 'tr')) {
    throw new Error('This file holds several keys but describes a single-key address type.');
  }
  if (!multi && (shape === 'wsh' || shape === 'sh-wsh')) {
    throw new Error('This file holds one key but describes a shared address type.');
  }
  if (keys.some((k) => !k.fingerprint || !k.originPath)) {
    warnings.push(
      'Some keys in this file carry no fingerprint or path. Talia imported them as they are; a hardware wallet may not recognise transactions until you connect it.',
    );
  }

  const keyText = (k: ElectrumWalletKey): string =>
    `${k.fingerprint && k.originPath ? `[${k.fingerprint}/${k.originPath}]` : ''}${k.xpub}/<0;1>/*`;
  const inner = multi
    ? `sortedmulti(${threshold},${keys.map(keyText).join(',')})`
    : keyText(keys[0]);
  const descriptor =
    shape === 'wsh'
      ? `wsh(${inner})`
      : shape === 'sh-wsh'
        ? `sh(wsh(${inner}))`
        : shape === 'sh-wpkh'
          ? `sh(wpkh(${inner}))`
          : shape === 'pkh'
            ? `pkh(${inner})`
            : shape === 'tr'
              ? `tr(${inner})`
              : `wpkh(${inner})`;

  const keyLabels: Record<string, string> = {};
  for (const k of keys) {
    if (k.fingerprint && k.label) keyLabels[k.fingerprint] = k.label;
  }
  return { descriptor, threshold, keys, keyLabels, warnings };
}
