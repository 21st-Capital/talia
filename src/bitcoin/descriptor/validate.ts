/**
 * Import-time validation and summarisation for descriptors.
 *
 * Turns a raw import (paste/file/QR) into either a rejection with a clear reason
 * or a normalised, watch-only-safe descriptor plus a human-readable summary.
 * The golden rule for Phase 1: never import private-key material.
 */
import { checksumMatches, parseDescriptor, splitTopLevel, extractBalanced } from './parse';
import { isProvablyUnspendableKey } from './unspendable';
import { normalizeBareKey } from './bareKey';
import { deadEndShape, parsePolicy } from './policy';
import { NETWORK_LABELS } from '../network';
import type {
  ImportSource,
  Network,
  ParsedDescriptor,
} from './types';

export interface ValidationOk {
  ok: true;
  parsed: ParsedDescriptor;
  /** Network to use — detected, or the caller-provided override. */
  network: Network;
  /** A one-line human summary, e.g. "2-of-3 multisig · Testnet4". */
  summary: string;
  /** A suggested wallet label. */
  suggestedLabel: string;
  /** Best guess at where this descriptor came from. */
  source: ImportSource;
  /** Non-fatal notes worth surfacing to the user. */
  warnings: string[];
  /**
   * A taproot vault with a script tree whose INTERNAL key is not proven
   * unspendable: that one key can spend every coin alone, with no wait and
   * no other key (decided 2026-09-26). The import must ask before it goes on.
   */
  keyPathSpender: boolean;
}

export interface ValidationError {
  ok: false;
  /** Machine-readable reason code. */
  code:
    | 'empty'
    | 'contains-private-keys'
    | 'no-keys'
    | 'unknown-script'
    | 'network-ambiguous'
    | 'checksum-mismatch'
    | 'parse-failed';
  message: string;
}

export type ValidationResult = ValidationOk | ValidationError;

export interface ValidateOptions {
  /**
   * Network the user picked. Required when the descriptor's key prefixes can't
   * disambiguate (e.g. tpub → testnet vs signet vs regtest).
   */
  network?: Network;
}

/**
 * Validate a raw descriptor for watch-only import. Returns a discriminated
 * union so callers can branch on `.ok`.
 */
export function validateForImport(
  raw: string,
  options: ValidateOptions = {},
): ValidationResult {
  if (!raw || !raw.trim()) {
    return { ok: false, code: 'empty', message: 'No descriptor provided.' };
  }

  // Bare xpub/zpub/ypub input (BlueWallet-style) is normalized into a proper
  // descriptor first; everything downstream sees only descriptors.
  let input = raw;
  const bareKeyWarnings: string[] = [];
  try {
    const normalized = normalizeBareKey(raw);
    if (normalized) {
      input = normalized.descriptor;
      bareKeyWarnings.push(...normalized.warnings);
    }
  } catch (e) {
    return { ok: false, code: 'parse-failed', message: (e as Error).message };
  }

  let parsed: ParsedDescriptor;
  try {
    parsed = parseDescriptor(input);
  } catch (e) {
    return {
      ok: false,
      code: 'parse-failed',
      message: `Could not parse descriptor: ${(e as Error).message}`,
    };
  }

  // BIP-380: a checksum that no longer matches its body means the string was
  // changed or damaged after it was written. Checked HERE, on the original
  // (multipath) body: BDK never sees it, because the engine splits `<0;1>`
  // and drops the checksum before BDK parses (decided 2026-09-26).
  if (!checksumMatches(input)) {
    return {
      ok: false,
      code: 'checksum-mismatch',
      message:
        'This descriptor does not match its checksum, so it was changed or damaged ' +
        'after it was exported. Export it again from the wallet that made it.',
    };
  }

  if (parsed.containsPrivateKeys) {
    return {
      ok: false,
      code: 'contains-private-keys',
      message:
        'This descriptor contains private keys. Talia is watch-only. Import ' +
        'the public (xpub) descriptor instead.',
    };
  }

  if (parsed.keys.length === 0) {
    return {
      ok: false,
      code: 'no-keys',
      message: 'No extended public keys found in the descriptor.',
    };
  }

  if (parsed.scriptType === 'unknown') {
    return {
      ok: false,
      code: 'unknown-script',
      message: 'Unrecognised descriptor script type.',
    };
  }

  // Resolve network: explicit override wins; else the detected one; else fail.
  const network = options.network ?? parsed.network;
  if (!network) {
    return {
      ok: false,
      code: 'network-ambiguous',
      message: 'Could not determine the network. Please select one.',
    };
  }

  const warnings: string[] = [...bareKeyWarnings];
  // A testnet-family prefix could be testnet, signet, or regtest. If the caller
  // picked one of those against a testnet-family descriptor, that's fine; warn
  // only on an obvious mainnet/testnet mismatch.
  if (parsed.network && !sameNetworkFamily(parsed.network, network)) {
    warnings.push(
      `Descriptor keys look like ${parsed.network}, but ${network} was selected.`,
    );
  }
  if (parsed.kind === 'miniscript' && parsed.timelocks.length > 0) {
    warnings.push(
      'Timelock/recovery policy detected. Verify the recovery path before use.',
    );
  }

  // A vault whose everyday path needs EVERY key it holds is a fund-loss trap
  // that Talia never builds (decided 2026-07-28). The import is still allowed — the
  // vault exists and its owner has to be able to see it — but it must never be
  // presented as an ordinary multisig. With a recovery path behind it, a
  // lost key ends the primary path only, so "every spend" and "for good" are
  // said only when there is none (decided 2026-09-22).
  try {
    const dead = deadEndShape(parsePolicy(parsed.raw));
    if (dead) {
      warnings.push(
        `This vault needs ALL ${dead.total} of its keys on its primary path` +
          (dead.hasRecovery
            ? '. After losing any one of them, only a recovery path can move the coins, once it opens. '
            : ', and it has no timelocked recovery path at all. Losing any one key ' +
              'would lock the coins for good. ') +
          'Talia does not build vaults in this shape. Check it against the ' +
          'wallet that created it before you put funds in.',
      );
    }
  } catch {
    // Unflattenable script — the raw-descriptor fallback already declines to
    // summarise it, so there is nothing trustworthy to warn about.
  }

  const keyPathSpender = taprootKeyPathSpendable(parsed.body);
  if (keyPathSpender) {
    warnings.push(
      'One key in this vault can spend every coin alone, without any other key or wait.',
    );
  }

  const source = guessSource(parsed);
  return {
    ok: true,
    keyPathSpender,
    parsed,
    network,
    summary: summarise(parsed, network),
    suggestedLabel: suggestLabel(parsed, source),
    source,
    warnings,
  };
}

/** testnet/signet/regtest share key prefixes; mainnet stands alone. */
function sameNetworkFamily(a: Network, b: Network): boolean {
  const fam = (n: Network) => (n === 'bitcoin' ? 'main' : 'test');
  return fam(a) === fam(b);
}

/** Heuristic guess of the export origin, for labelling and hints. */
export function guessSource(parsed: ParsedDescriptor): ImportSource {
  if (parsed.kind === 'miniscript') return 'liana'; // Liana is the timelock case
  // Sparrow single-sig exports are multipath wpkh/tr/sh-wpkh with an origin.
  if (parsed.kind === 'single-sig' && parsed.keys.some((k) => k.fingerprint)) {
    return 'sparrow';
  }
  return 'generic';
}

/** One-line summary for import confirmation (Import's "Name this vault"
 *  dialog), so the network goes by its shared name, never the stored key. */
export function summarise(parsed: ParsedDescriptor, network: Network): string {
  const net = NETWORK_LABELS[network] ?? network;
  switch (parsed.kind) {
    case 'single-sig':
      return `Single-sig (${scriptLabel(parsed.scriptType)}) · ${net}`;
    case 'multisig':
      return `${parsed.threshold ?? '?'}-of-${parsed.totalKeys ?? '?'} multisig · ${net}`;
    case 'miniscript': {
      const locks = parsed.timelocks
        .map((t) => (t.type === 'relative' ? `older(${t.value})` : `after(${t.value})`))
        .join(', ');
      return `Miniscript / timelock${locks ? ` (${locks})` : ''} · ${net}`;
    }
    default:
      return `Descriptor · ${net}`;
  }
}

function scriptLabel(s: ParsedDescriptor['scriptType']): string {
  switch (s) {
    case 'wpkh':
      return 'native segwit';
    case 'sh-wpkh':
      return 'nested segwit';
    case 'pkh':
      return 'legacy';
    case 'tr':
      return 'taproot';
    default:
      return s;
  }
}

/** Suggested default wallet label. */
export function suggestLabel(parsed: ParsedDescriptor, source: ImportSource): string {
  const prefix =
    source === 'liana' ? 'Liana' : source === 'sparrow' ? 'Sparrow' : 'Talia';
  switch (parsed.kind) {
    case 'multisig':
      return `${prefix} ${parsed.threshold ?? ''}/${parsed.totalKeys ?? ''} multisig`.trim();
    case 'miniscript':
      return `${prefix} recovery wallet`;
    case 'single-sig':
      return `${prefix} wallet`;
    default:
      return `${prefix} wallet`;
  }
}

/**
 * True for `tr(KEY,{tree})` whose internal KEY is not proven unspendable
 * (isProvablyUnspendableKey): that key alone spends through the key path,
 * whatever the tree says. A `tr(KEY)` with no tree is an ordinary one-key
 * wallet and is not flagged. The same predicate decides parsePolicy's
 * key-path row, so the import and the Spending policy never disagree.
 */
export function taprootKeyPathSpendable(body: string): boolean {
  if (!body.startsWith('tr(')) return false;
  const parts = splitTopLevel(extractBalanced(body, 2) ?? '');
  return parts.length > 1 && !isProvablyUnspendableKey(parts[0]);
}
