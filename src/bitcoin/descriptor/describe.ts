/**
 * The script type of a vault, in the words the app uses elsewhere.
 *
 * Lives here rather than in the UI because it is pure string classification,
 * which is exactly what this layer is for, and because it is the kind of
 * statement that must be right: an owner reading it is deciding how to
 * rebuild their vault in another wallet.
 */
import { detectScriptType, parseMultisig, stripChecksum } from './parse';
import { minOlderBlocks } from './timelock';

/** True when the descriptor carries a relative or absolute timelock. */
export function hasTimelock(body: string): boolean {
  return /\bolder\(|\bafter\(/.test(body);
}

export function describeScript(descriptor: string): string {
  const { body } = stripChecksum(descriptor);
  const script = detectScriptType(body);
  const multi = parseMultisig(body);
  const quorum = multi ? ` ${multi.threshold} of ${multi.totalKeys}` : '';
  const locked = hasTimelock(body);
  switch (script) {
    case 'tr':
      // Every vault holding one of our keys is taproot; a timelocked tree is
      // what makes it a recovery vault rather than a plain multisig.
      return locked
        ? `Taproot with timelocked recovery${quorum ? ` (primary${quorum})` : ''}`
        : multi
          ? `Taproot multisig${quorum}`
          : 'Taproot single key';
    case 'wsh':
      return locked
        ? `Native SegWit with timelocked recovery${quorum ? ` (primary${quorum})` : ''}`
        : multi
          ? `Native SegWit multisig${quorum}`
          : 'Native SegWit script';
    case 'wpkh':
      return 'HD SegWit (BIP84 Bech32 Native)';
    case 'sh-wpkh':
      return 'HD SegWit (BIP49 P2SH)';
    case 'pkh':
      return 'HD Legacy (BIP44)';
    case 'sh-wsh':
      return 'Nested SegWit script';
    case 'sh':
      return 'Legacy script';
    default:
      return 'Unrecognised script';
  }
}

/**
 * A LAYERED vault has a timelocked recovery path. That, not the script prefix,
 * is what Liana requires on import: an untimelocked taproot multisig
 * `tr(NUMS,multi_a(k,...))` looks like a Liana vault and is refused by it
 * (decided 2026-09-02, MissingRecoveryPath). Anything routing a vault to Liana
 * must ask this, never "is it taproot".
 */
export function isLayered(descriptor: string): boolean {
  return minOlderBlocks(stripChecksum(descriptor).body) != null;
}
