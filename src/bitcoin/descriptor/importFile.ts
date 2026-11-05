/**
 * Import-payload extraction: turn "whatever the user gives us" into one
 * descriptor string for the regular validation pipeline.
 *
 * Real-world import material is rarely a clean descriptor:
 *  - Bitcoin Core exports a text file with `#` comment lines and up to three
 *    descriptor variants (multipath + separate receive/change),
 *  - Electrum wallets are JSON with the key buried in `keystore.xpub` — and an
 *    `xprv` sitting right next to it,
 *  - users paste whole files into the text box.
 *
 * This module scans text or JSON for descriptor / extended-key candidates,
 * picks the best one (multipath first; a receive+change pair is combined into
 * a multipath descriptor), and reports warnings — including a prominent one
 * when the source material contains private-key data. Only public strings are
 * ever returned; private keys are never parsed, stored, or echoed.
 */
import { stripChecksum } from './parse';
import { normalizeBareKey } from './bareKey';
import { parseColdcardExport } from './coldcard';
import { parseElectrumWallet } from './electrumWallet';
import { parseLianaWalletBackup } from './lianaBackup';
import { composeSinglesig } from './compose';

/** A descriptor-looking token: `fn(...)` with an optional checksum. */
const DESC_RE = /^[a-z]+\(.+\)(#[a-z0-9]{8})?$/;
/** Private-key material of any extended-key flavour (xprv/tprv/zprv/…). */
const PRV_RE = /[xyztuv]prv[1-9A-HJ-NP-Za-km-z]{20,}/i;
/** SLIP-132 multisig public prefixes we can't use yet. */
const MULTISIG_SLIP132_RE = /^[YZUV]pub[1-9A-HJ-NP-Za-km-z]{60,120}/;

export interface ImportPayload {
  /** The single descriptor (or bare-key-derived descriptor) to import. */
  descriptor: string;
  warnings: string[];
  /** Names the source knew for its keys, by lowercase fingerprint: a
   *  Sparrow "Electrum" export carries the device each key lives on
   *  (decided 2026-09-09), which is a better key name than "Key 2". */
  keyLabels?: Record<string, string>;
  /** The vault name the source knew, offered at the name question: Liana's
   *  wallet backup carries the name its owner typed (decided 2026-11-05). */
  name?: string;
  /** Transaction notes the source carried, by lowercase transaction id:
   *  Liana's wallet backup holds its labels (decided 2026-11-05). */
  txNotes?: Record<string, string>;
}

/** Files that are wallet databases, not exports — with pointed guidance. */
export function unsupportedWalletFileReason(filename: string): string | null {
  if (/\.(mv\.db|db|sqlite3?|dat)$/i.test(filename)) {
    return (
      `"${filename}" is a wallet's internal database, not an export. ` +
      'In Sparrow use Settings → Output Descriptor (text or QR); in Bitcoin ' +
      'Core use listdescriptors; in Electrum use File → Export.'
    );
  }
  return null;
}

/**
 * Extract one importable descriptor from arbitrary pasted/file text.
 * Throws with a user-readable message when nothing usable is found.
 */
export function extractImportPayload(content: string): ImportPayload {
  const warnings: string[] = [];
  const trimmed = content.trim();
  if (!trimmed) throw new Error('The file is empty.');

  if (PRV_RE.test(trimmed)) {
    warnings.push(
      'This source contains PRIVATE key material. Talia imported only the ' +
        'public key. Treat the original file as highly sensitive: anyone ' +
        'who has it can spend from that wallet.',
    );
  }

  // Liana's wallet backup holds the whole vault: its descriptor, the name its
  // owner typed, the names of its keys and its labels. Read through the
  // generic scan below, only the descriptor would survive.
  const liana = parseLianaWalletBackup(trimmed);
  if (liana) {
    return {
      descriptor: liana.descriptor,
      warnings,
      keyLabels: liana.keyLabels,
      ...(liana.name ? { name: liana.name } : {}),
      txNotes: liana.txNotes,
    };
  }

  // An Electrum-format wallet (which is how Sparrow exports one with its
  // key names) describes the WHOLE wallet, quorum included. Reading it as
  // a bag of strings would pick one key and call it the wallet.
  const electrum = parseElectrumWallet(trimmed);
  if (electrum) {
    return {
      descriptor: electrum.descriptor,
      warnings: [...warnings, ...electrum.warnings],
      keyLabels: electrum.keyLabels,
    };
  }

  // Coldcard Generic JSON first — its string leaves include the ROOT xpub,
  // which the generic scanner would wrongly pick as a wallet key.
  const coldcard = parseColdcardExport(trimmed);
  if (coldcard) {
    if (coldcard.bip84) {
      // Brand-neutral on purpose: the wording is user-facing, and it must not
      // name a hardware wallet we no longer sell. The old copy also pointed at
      // vault creation, which the watch-only build does not offer.
      warnings.push(
        'Hardware wallet export detected. Added its native-segwit (BIP-84) ' +
          'account as a watch-only wallet.',
      );
      return {
        descriptor: composeSinglesig({
          fingerprint: coldcard.fingerprint,
          originPath: coldcard.bip84.originPath,
          xpub: coldcard.bip84.xpub,
        }),
        warnings,
      };
    }
    throw new Error(
      'This wallet export has no native-segwit (BIP-84) account. Export the ' +
        'Generic JSON wallet file again from your device, or import the ' +
        'descriptor instead.',
    );
  }

  // Gather candidate strings from JSON structure or comment-stripped lines.
  const tokens = looksLikeJson(trimmed) ? jsonStrings(trimmed) : textTokens(trimmed);

  const descriptors: string[] = [];
  const bareKeys: string[] = [];
  let sawMultisigSlip132 = false;

  for (const token of tokens) {
    if (DESC_RE.test(token) && !PRV_RE.test(token)) {
      descriptors.push(token);
      continue;
    }
    if (MULTISIG_SLIP132_RE.test(token)) {
      sawMultisigSlip132 = true;
      continue;
    }
    try {
      if (normalizeBareKey(token)) bareKeys.push(token);
    } catch {
      // Bare-key shaped but unusable (bad checksum / unsupported prefix) —
      // keep scanning; if nothing else is found the caller sees a clear error.
    }
  }

  const chosen = chooseDescriptor(descriptors, warnings) ?? bareKeys[0];
  if (!chosen) {
    if (sawMultisigSlip132) {
      throw new Error(
        'Only multisig SLIP-132 keys (Ypub/Zpub) were found. Those need the ' +
          "wallet's full descriptor. Export the output descriptor instead.",
      );
    }
    throw new Error('No descriptor or extended public key found.');
  }
  return { descriptor: chosen, warnings };
}

/** Pick the best descriptor: multipath > combined receive/change pair > first. */
function chooseDescriptor(descriptors: string[], warnings: string[]): string | undefined {
  if (descriptors.length === 0) return undefined;

  // Dedupe on checksum-stripped bodies (Core repeats variants of one wallet).
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const d of descriptors) {
    const body = stripChecksum(d).body;
    if (!seen.has(body)) {
      seen.add(body);
      unique.push(d);
    }
  }

  const multipath = unique.find((d) => /<\d+;\d+>/.test(d));
  if (multipath) return multipath;

  // A receive (/0/*) + change (/1/*) pair combines into one multipath string.
  if (unique.length >= 2) {
    for (const a of unique) {
      const aBody = stripChecksum(a).body;
      if (!/\/0\/\*/.test(aBody)) continue;
      const asChange = aBody.replace(/\/0\/\*/g, '/1/*');
      const b = unique.find((x) => x !== a && stripChecksum(x).body === asChange);
      if (b) {
        return aBody.replace(/\/0\/\*/g, '/<0;1>/*');
      }
    }
  }

  if (unique.length > 1) {
    warnings.push(
      `The source contained ${unique.length} different descriptors. Talia imported the first. ` +
        'Add the others as separate wallets if needed.',
    );
  }
  return unique[0];
}

function looksLikeJson(s: string): boolean {
  return s.startsWith('{') || s.startsWith('[');
}

/** All string leaves of a JSON document (order-preserving, depth-first). */
function jsonStrings(s: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return textTokens(s); // malformed JSON — fall back to text scanning
  }
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v.trim());
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(parsed);
  return out;
}

/** Non-comment, non-empty lines of a text file. */
function textTokens(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('//'));
}
