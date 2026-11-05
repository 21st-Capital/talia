/**
 * Talia descriptors → BitBox wallet policies.
 *
 * The BitBox and the Ledger speak the same BIP-388 dialect: a template with
 * `@i` placeholders plus an ordered key list. The Ledger layer already
 * translates our descriptors faithfully (and refuses the shapes it cannot),
 * so this module reuses it wholesale and only changes the SHAPE of a key:
 * Ledger wants `[fingerprint/path]xpub` strings, the BitBox wants the three
 * parts separated. The scripts the Ledger takes and the BitBox does not (a
 * bare P2SH multisig, and any P2SH-wrapped `wsh(…)`) are refused here on top
 * (`bitboxScriptBlocker`).
 *
 * The one genuinely new job is the ACCOUNT KEYPATH. BitBox registration and
 * signing want the derivation path of the DEVICE'S OWN key within the policy,
 * which the Ledger API never asks for (its HMAC carries that context).
 *
 * Pure, tested. Anything device-flavoured (sessions, Bluetooth) stays in
 * platform/bitbox.ts.
 */
import { descriptorToLedgerPolicy, ledgerPolicyBlocker, nonRangedBlocker } from '../ledger/policy';

export interface BitboxPolicyKey {
  /** 8 lowercase hex chars, or null for an origin-less key. */
  rootFingerprintHex: string | null;
  /** "m/48'/1'/0'/2'" style, or null when the origin carries no path. */
  keypath: string | null;
  xpub: string;
}

export interface BitboxPolicy {
  /** ≤16 ascii chars, shown on the device during registration. */
  name: string;
  /** BIP-388 template with @i placeholders. */
  policy: string;
  keys: BitboxPolicyKey[];
}

/** `[fingerprint/path]xpub` or bare `xpub` → parts. */
export function splitKeyString(key: string): BitboxPolicyKey {
  const m = /^\[([0-9a-fA-F]{8})(\/[^\]]*)?\](.+)$/.exec(key);
  if (!m) return { rootFingerprintHex: null, keypath: null, xpub: key };
  return {
    rootFingerprintHex: m[1].toLowerCase(),
    keypath: m[2] ? `m${m[2]}` : null,
    xpub: m[3],
  };
}

/**
 * A vault script the BitBox cannot take although the shared translator can,
 * with the sentence that says so, or null.
 *
 * The BitBox's own script configs wrap P2SH only around segwit (P2WPKH-P2SH,
 * P2WSH-P2SH). A BARE `sh(multi(…))` or `sh(sortedmulti(…))` (legacy P2SH multisig, the
 * Electrum-style imports) has no output type in bitbox-api's PSBT conversion,
 * which refuses it with UnknownOutputType whichever library built the PSBT
 * (decided 2026-10-17). BIP-388, the Ledger's
 * dialect, has it, so the shared blocker let it through and the client met
 * that refusal at signing time; this says so before the device is asked
 * anything.
 *
 * A P2SH-wrapped `sh(wsh(…))` is refused for the same reason (a run on the
 * BitBox02 simulator: 7 registrations refused
 * with "invalid input"; decided 2026-10-17). The BitBox bridge
 * (bitbox-ffi `script_config`) sends the device's classic multisig config
 * only for a top-level `wsh(sortedmulti(…))`, as P2WSH, and every other vault
 * as a BIP-388 policy; the firmware's policy parser takes only `wsh(…)` and
 * `tr(…)` (policies.rs), so the sh-wrapped policy is refused at registration.
 * This refusal is for TODAY'S BRIDGE, not the device. The firmware's classic
 * multisig config has a P2WSH-P2SH type (BIP-67 sorted keys, our key at
 * m/48'/coin'/account'/1' or m/48'/coin'/account', at most 15 keys), and that
 * is exactly the vault Talia's own Electrum import writes for a nested segwit
 * multisig file (`descriptor/electrumWallet.ts`: sortedmulti, every key on the
 * 1' account; pinned in policy.test.ts). Once bitbox-ffi sends
 * `sh(wsh(sortedmulti(…)))` as that config (P2wshP2sh) and it is proven (a new
 * native library, a simulator run with keys on 1', a BitBox test on the phone), narrow
 * this to the sh(wsh) vaults that config cannot take: not sortedmulti, more
 * than 15 keys, or the BitBox's key off those paths. `sh(wsh(multi(…)))` and
 * an sh-wrapped miniscript have no BitBox config at all. P2SH around a single
 * key, `sh(wpkh(…))`, stays: the device reads it from the PSBT itself.
 *
 * The device registry reads it too (`deviceSuitsVault`), so the BitBox is
 * not offered for such a vault and its key never opens Send there. For the
 * same reason it carries the shared NON-RANGED rule first
 * (`nonRangedBlocker`): no BIP-388 device can be shown a vault of one fixed
 * address, and the registry reads this blocker, not the translator's.
 */
export function bitboxScriptBlocker(descriptor: string): string | null {
  const nonRanged = nonRangedBlocker(descriptor);
  if (nonRanged) return nonRanged;
  const body = descriptor.split('#')[0].trim();
  if (/^sh\((?!wpkh\()/.test(body)) return 'This vault type cannot be registered on a BitBox.';
  return null;
}

/** Why this descriptor cannot become a BitBox policy, or null when it can:
 *  the Ledger layer's constraints (one translator), then the BitBox's own. */
export function bitboxPolicyBlocker(descriptor: string): string | null {
  return ledgerPolicyBlocker(descriptor) ?? bitboxScriptBlocker(descriptor);
}

/** Throws with a user-readable message on anything the BitBox cannot take. */
export function descriptorToBitboxPolicy(descriptor: string, name: string): BitboxPolicy {
  const blocker = bitboxPolicyBlocker(descriptor);
  if (blocker) throw new Error(blocker);
  const ledger = descriptorToLedgerPolicy(descriptor, name);
  return {
    name: ledger.name,
    policy: ledger.descriptorTemplate,
    keys: ledger.keys.map(splitKeyString),
  };
}

/**
 * The account keypath of the device's own key inside the policy: what
 * registration and signing pass as keypath_account. Null when the device's
 * fingerprint is not among the policy's keys, which the caller must treat as
 * "this BitBox is not part of this vault".
 */
export function bitboxAccountKeypath(
  keys: readonly BitboxPolicyKey[],
  deviceFingerprint: string,
): string | null {
  const fp = deviceFingerprint.toLowerCase();
  const own = keys.find((k) => k.rootFingerprintHex === fp && k.keypath);
  return own?.keypath ?? null;
}
