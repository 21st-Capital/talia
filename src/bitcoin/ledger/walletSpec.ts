/**
 * What to PRESENT to a Ledger when acting on a vault: either one of the
 * four standard single-key shapes the device accepts without ceremony
 * (a "default wallet": derivation path + template id), or the registered
 * policy triple + HMAC from the registration ceremony.
 *
 * Pure: descriptor + stored registration in, spec out. The platform layer
 * turns the spec into the signer kit's DefaultWallet / RegisteredWallet.
 */
import { parseKeyOrigins, stripChecksum } from '../descriptor/parse';
import { descriptorToLedgerPolicy, isDefaultPolicy, ledgerPolicyBlocker } from './policy';

/** The stored registration shape (structurally = wallet's LedgerRegistration
 *  — declared here because bitcoin/ must not import the wallet layer). */
export interface StoredRegistration {
  name: string;
  descriptorTemplate: string;
  keys: string[];
  hmacHex: string;
}

export type LedgerWalletSpec =
  | {
      kind: 'default';
      /** Apostrophe-hardened origin path of the single key, no "m/". */
      derivationPath: string;
      template: 'pkh' | 'sh-wpkh' | 'wpkh' | 'tr';
    }
  | {
      kind: 'registered';
      name: string;
      descriptorTemplate: string;
      keys: string[];
      hmacHex: string;
    };

const DEFAULT_TEMPLATES: Record<string, 'pkh' | 'sh-wpkh' | 'wpkh' | 'tr'> = {
  'pkh(@0/**)': 'pkh',
  'sh(wpkh(@0/**))': 'sh-wpkh',
  'wpkh(@0/**)': 'wpkh',
  'tr(@0/**)': 'tr',
};

/**
 * Resolve how the Ledger should see this vault, or a plain-language reason
 * it can't act on it yet (needs registering, untranslatable, …).
 */
export function ledgerWalletSpecFor(
  descriptor: string,
  label: string,
  registration: StoredRegistration | undefined,
): { spec: LedgerWalletSpec } | { blocker: string } {
  if (registration) {
    return {
      spec: {
        kind: 'registered',
        name: registration.name,
        descriptorTemplate: registration.descriptorTemplate,
        keys: registration.keys,
        hmacHex: registration.hmacHex,
      },
    };
  }
  const reason = ledgerPolicyBlocker(descriptor);
  if (reason) return { blocker: reason };
  const policy = descriptorToLedgerPolicy(descriptor, label);
  if (isDefaultPolicy(policy)) {
    const template = DEFAULT_TEMPLATES[policy.descriptorTemplate];
    const key = parseKeyOrigins(stripChecksum(descriptor).body)[0];
    const path = key?.originPath?.replace(/[hH]/g, "'");
    if (template != null && path) {
      return { spec: { kind: 'default', derivationPath: path, template } };
    }
    // A default-shaped vault whose key carries no origin path cannot tell
    // the device where to derive — same remedy as a fingerprint-less vault.
    return {
      blocker:
        'That vault was added without the details saying where its key comes from, so the device cannot act on it. Import it again with the full vault description.',
    };
  }
  return { blocker: REGISTER_FIRST };
}

/** The refusal a shared vault meets on a Ledger it was never shown. The
 *  address check says it before any search when every key of the owner's
 *  sits on such a Ledger (decided 2026-10-04). */
export const REGISTER_FIRST = 'Register this vault on your hardware first: open the vault, then Tools, then Register on your Hardware.';
