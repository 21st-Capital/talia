/**
 * Replacing the hardware a key lives on (decided 2026-09-08: "changing a
 * signing device ... for any specific single or any number of keys that
 * are part of a multisig").
 *
 * What this IS: the same key, on new hardware. A device broke, or the
 * owner restored their seed words onto a different one, possibly another
 * brand. The key, and therefore the vault and every address in it, is
 * unchanged; only the answer to "which box do I hand this transaction to"
 * changes.
 *
 * What this is NOT, and the UI must never let it become: putting a
 * DIFFERENT key into the vault. A vault's coins sit at addresses derived
 * from the keys it was built with. Swapping a key would describe a
 * different wallet, whose addresses hold nothing, while the coins stay
 * where they are. That is a new vault plus a transaction, never an edit.
 * So the ceremony reads the new device's key at the SAME derivation path
 * and refuses unless the xpub matches to the character.
 *
 * The other half of getting this right is forgetting what the OLD device
 * proved. A registration record says "this physical device has been shown
 * this vault and returned a token for it". The new device has not, so the
 * record must go, or:
 *  - `ledgerFingerprintsOf` counts registration records as Ledger custody,
 *    and the signing screen checks Ledger before BitBox, so a key moved
 *    from a Ledger to a BitBox would keep routing to the Ledger flow;
 *  - the registration checklist would show a tick for a device that has
 *    never seen this vault;
 *  - a Ledger's stored policy token would be presented to a device that
 *    never issued it, failing at signing time with a device error rather
 *    than a sentence anyone can act on.
 *
 * Pure: WalletMeta in, rows and a patch out. Unit-tested.
 */
import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';
import { parseKeyOrigins, stripChecksum } from '../bitcoin/descriptor';
import { devicesFor, deviceSuitsVault } from './deviceKinds';
import { ledgerPolicyBlocker } from '../bitcoin/ledger/policy';
import { heirFingerprintsOf, isSingleSigVault } from './keyDevices';
import type { KeyDevice, WalletMeta } from './types';
import type { Network } from '../bitcoin/descriptor/types';

const base58check = createBase58check(sha256);

/**
 * Are these two strings the SAME extended public key?
 *
 * Compared on the key material, not the text: the four version bytes carry
 * the encoding (xpub, tpub, zpub, vpub) and nothing about which key it is,
 * and devices differ on which they hand back. The remaining 74 bytes are
 * depth, parent fingerprint, index, chain code and the public key, which
 * are the key. Anything that does not decode is not equal to anything,
 * never loosely equal (a substring test on base58 is a known trap).
 */
export function sameExtendedKey(a: string, b: string): boolean {
  const material = (key: string): string | null => {
    try {
      const bytes = base58check.decode(key.trim());
      if (bytes.length !== 78) return null;
      return Array.from(bytes.slice(4))
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      return null;
    }
  };
  const left = material(a);
  const right = material(b);
  return left != null && right != null && left === right;
}

/** One key of a vault, as the replace screen lists it. */
export interface ReplaceableKey {
  /** How `keyDevices` names this key: its fingerprint, or the xpub itself
   *  when the vault was imported as a bare key. */
  id: string;
  /** Lowercase master fingerprint, or null for a bare key. */
  fingerprint: string | null;
  xpub: string;
  /** The account path the new device must be asked for, without "m/". */
  originPath: string | null;
  /** The owner's name for this key, when they gave one. */
  label: string | null;
  /** The hardware Talia currently believes holds it. */
  device: KeyDevice | null;
  /** 1-based place in the descriptor, so an unnamed key is numbered the
   *  same here as everywhere else that lists this vault's keys. */
  position: number;
}

/** Case-insensitive lookup in a record keyed by fingerprint or xpub. */
function lookup<T>(map: Record<string, T> | undefined, id: string): T | null {
  const hit = Object.entries(map ?? {}).find(([k]) => k.toLowerCase() === id.toLowerCase());
  return hit ? hit[1] : null;
}

/** The same record without any entry naming this key, whatever its case. */
function without<T>(map: Record<string, T> | undefined, id: string): Record<string, T> {
  return Object.fromEntries(
    Object.entries(map ?? {}).filter(([k]) => k.toLowerCase() !== id.toLowerCase()),
  );
}

/**
 * The keys whose hardware the OWNER can replace: every key in the
 * descriptor except 21st Capital's own (we hold those) and the heirs'
 * (they hold theirs). Order follows the descriptor, so the rows match
 * every other per-key list in the app.
 */
export function replaceableKeys(
  wallet: WalletMeta,
  /** 21C's live fingerprints: an imported vault carries no tag of its own. */
  providerFps?: ReadonlySet<string>,
): ReplaceableKey[] {
  if (wallet.manual || !wallet.descriptor) return [];
  const excluded = new Set(
    [...(wallet.providerKeyFingerprints ?? []), ...(providerFps ?? [])].map((fp) => fp.toLowerCase()),
  );
  for (const fp of heirFingerprintsOf(wallet)) excluded.add(fp);
  const rows: ReplaceableKey[] = [];
  const seen = new Set<string>();
  let keys;
  try {
    keys = parseKeyOrigins(stripChecksum(wallet.descriptor).body);
  } catch {
    return [];
  }
  // A SHARED vault only lists keys that carry a fingerprint (decided 2026-09-18:
  // "the app also shows our cosigning key as Key 1"). One of ours can sit in
  // a descriptor as a bare xpub with no [fingerprint/path] in front of it,
  // and with no fingerprint there is nothing to match it against the list of
  // our keys, so it was offered to the client as theirs to replace. A bare
  // key is useless here anyway: the screen cannot check a device against it
  // and says further down that it has no path to guess for a shared vault.
  // A one-key vault keeps bare keys, where the only key IS the client's.
  const shared = keys.length > 1;
  keys.forEach((k, index) => {
    const fingerprint = k.fingerprint?.toLowerCase() ?? null;
    if (fingerprint && excluded.has(fingerprint)) return;
    if (shared && !fingerprint) return;
    const id = fingerprint ?? k.xpub;
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({
      position: index + 1,
      id,
      fingerprint,
      xpub: k.xpub,
      originPath: k.originPath ?? null,
      label: (fingerprint ? lookup(wallet.keyLabels, fingerprint) : null) ?? null,
      device: lookup(wallet.keyDevices, id) ?? (lookupLedgerRegistration(wallet, id) ? { kind: 'ledger' } : null),
    });
  });
  return rows;
}

function lookupLedgerRegistration(wallet: WalletMeta, id: string): boolean {
  return Object.keys(wallet.ledgerRegistrations ?? {}).some((k) => k.toLowerCase() === id.toLowerCase());
}

/**
 * The change to save once a new device has PROVEN it holds this key (its
 * xpub matched). The key is bound to the new hardware and everything the
 * old hardware had proven about this vault is forgotten, because the new
 * one has proven none of it.
 *
 * `vaultRegisteredAt` and an imported vault's `registrationAttestedAt`
 * both mean "every device is ready", which stops being true the moment
 * one of them is a different box. They are cleared for a shared vault and
 * left alone for a single-key one, which is never registered on anything.
 */
export function deviceReplacementPatch(
  wallet: WalletMeta,
  keyId: string,
  device: KeyDevice,
  /** `newId`: the key is being re-named at the same time, because a vault
   *  imported as a bare key records its device under the xpub until the
   *  device supplies the fingerprint. Both names are dropped, one is
   *  written, so no orphan is left behind pointing at the old box.
   *
   *  `label`: the name the owner gave the key on its new device (decided
   *  2026-09-19: the same naming step a new vault uses, defaulting to the
   *  device's own name). Written under the key's fingerprint, where every
   *  screen reads labels from; a key with no fingerprint has no label. */
  opts?: { sharedVault?: boolean; newId?: string; label?: string },
): Partial<WalletMeta> {
  const shared = opts?.sharedVault ?? true;
  const id = (opts?.newId ?? keyId).toLowerCase();
  const patch: Partial<WalletMeta> = {
    keyDevices: { ...without(without(wallet.keyDevices, keyId), id), [id]: device },
    ledgerRegistrations: without(without(wallet.ledgerRegistrations, keyId), id),
    bitboxRegistrations: without(without(wallet.bitboxRegistrations, keyId), id),
  };
  const label = opts?.label?.trim();
  if (label && /^[0-9a-f]{8}$/.test(id)) {
    patch.keyLabels = { ...without(without(wallet.keyLabels, keyId), id), [id]: label };
  }
  if (shared) {
    patch.vaultRegisteredAt = undefined;
    patch.registrationAttestedAt = undefined;
  }
  return patch;
}


/**
 * Is there hardware to replace? Only when a key of this vault already has
 * a device recorded.
 *
 * Decided 2026-09-09: "these two options should actually never coexist, because
 * the wallet is either connected to a hardware already and the device can
 * be replaced or it has never been connected and the user can click on
 * connect to hardware". This reads the same two sources as
 * `singleSigDevice` (keyDevices, then an old Ledger registration), so for
 * a one-key vault it is exactly the opposite of the connect case and the
 * menu can never show both.
 */
export function canReplaceDevice(wallet: WalletMeta, providerFps?: ReadonlySet<string>): boolean {
  return replaceableKeys(wallet, providerFps).some((k) => k.device != null);
}


/**
 * Does this vault still need to be shown to the new device? Only a shared
 * vault is ever registered, and only when the key that moved sits on a
 * device that registers at all (a Passport is never shown a vault).
 */
export function needsReRegistration(sharedVault: boolean, device: KeyDevice): boolean {
  // Asked of the device registry, never a brand list (decided 2026-09-22): a
  // brand that registers shared vaults is listed there once.
  return sharedVault && devicesFor('multi', 'register').some((d) => d.kind === device.kind);
}

/**
 * Should the vault the owner came from be shown to the new device straight
 * after the replacement? Nobody is asked (decided 2026-09-19: "a device with the
 * same seed almost never has the descriptor registered, and there is no need
 * to ask the user"): the registration is assumed missing and simply done.
 * ONLY that vault (decided the same day: "not all shared vaults, only the vault from
 * which the user clicked to replace the key"); the other vaults holding the
 * key keep their own device binding and label. A single-key vault is never
 * registered and a Passport is never shown a vault. A vault whose shape the
 * brand cannot take (imported as separate receive and change lists) is not
 * sent into a ceremony that can only fail; the vault screen explains that
 * blocker itself, as it does after a normal build.
 */
export function registersAfterReplacement(wallet: WalletMeta, device: KeyDevice): boolean {
  if (!needsReRegistration(!isSingleSigVault(wallet), device)) return false;
  // Every adopted device shares the Ledger's translator, so its blocker
  // speaks for all of them; a script one brand cannot sign (the BitBox and a
  // bare sh(multi) or an sh(wsh(...))) is the registry's to say.
  return ledgerPolicyBlocker(wallet.descriptor) == null && deviceSuitsVault(device.kind, wallet.descriptor);
}

/**
 * Does this device hold exactly this key? The device is asked for the
 * extended public key at the key's own origin path (or, for a key recorded
 * with no path, at the standard account paths) and it must match to the
 * byte (decided 2026-09-26). A matching FINGERPRINT proves nothing:
 * a descriptor can name the client's real fingerprint over somebody else's
 * xpub, and linking it would open Send for addresses the device cannot
 * sign. Device errors propagate: a lost connection is not "a different key".
 */
export async function deviceHoldsKey(
  device: { xpub: (path: string, network: Network) => Promise<string> },
  key: { xpub: string; originPath?: string },
  network: Network,
  standardPaths: ReadonlyArray<string> = [],
): Promise<boolean> {
  const recorded = key.originPath?.replace(/^m\//, '');
  const paths = recorded ? [recorded] : standardPaths;
  for (const path of paths) {
    if (sameExtendedKey(await device.xpub(path, network), key.xpub)) return true;
  }
  return false;
}
