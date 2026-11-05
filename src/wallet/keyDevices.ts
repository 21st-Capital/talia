/**
 * Which physical device holds which key (decided 2026-08-26: "we have to
 * natively memorize which device has been used for a particular key").
 *
 * Two sources of truth, merged here so callers never re-derive:
 *  - `WalletMeta.keyDevices` — written whenever a key is fetched from or
 *    registered on a device;
 *  - `WalletMeta.ledgerRegistrations` — a registration is itself proof the
 *    device holds that key, and covers vaults from before keyDevices
 *    existed.
 *
 * Pure: WalletMeta in, verdicts out. Unit-tested.
 */
import {
  parseKeyOrigins,
  parseMultisig,
  parsePolicy,
  pathRequirement,
  pathSatisfiedBy,
  primaryPath,
  stripChecksum,
} from '../bitcoin/descriptor';
import type { PolicyPath } from '../bitcoin/descriptor';
import { ledgerPolicyBlocker } from '../bitcoin/ledger/policy';
import { bitboxPolicyBlocker } from '../bitcoin/bitbox/policy';
import { ledgerWalletSpecFor } from '../bitcoin/ledger';
import type { WalletMeta, KeyDevice } from './types';
import { deviceCan, deviceSuitsVault, devicesFor, registeredFingerprintsOf } from './deviceKinds';
import type { StepKey, VaultShape } from './deviceKinds';
import { keyDisplayName } from './keyNames';

/** Key fingerprints known to live on a Ledger, lowercase hex. */
export function ledgerFingerprintsOf(wallet: WalletMeta): Set<string> {
  const out = new Set<string>();
  for (const [fp, dev] of Object.entries(wallet.keyDevices ?? {})) {
    if (dev.kind === 'ledger') out.add(fp.toLowerCase());
  }
  for (const fp of Object.keys(wallet.ledgerRegistrations ?? {})) {
    out.add(fp.toLowerCase());
  }
  return out;
}

/** Keys this vault knows live on a BitBox. Unlike the Ledger there is no
 *  registration record to consult: the Nova keeps its registrations on the
 *  device itself, so keyDevices is the whole memory. */
export function bitboxFingerprintsOf(wallet: WalletMeta): Set<string> {
  const out = new Set<string>();
  for (const [fp, dev] of Object.entries(wallet.keyDevices ?? {})) {
    if (dev.kind === 'bitbox') out.add(fp.toLowerCase());
  }
  return out;
}

/**
 * Keys this vault knows live on ANY signing device the phone can drive.
 *
 * Gate on THIS, never on one brand (decided 2026-09-18, after a BitBox vault fell
 * out of the refresh session because its gate asked for a Ledger). Adding a
 * brand means adding it here, and every capability question follows. A brand
 * check is only correct inside that brand's own connect task.
 */
export function signingDeviceFingerprintsOf(wallet: WalletMeta): Set<string> {
  const out = ledgerFingerprintsOf(wallet);
  for (const fp of bitboxFingerprintsOf(wallet)) out.add(fp);
  return out;
}

/**
 * The keys of `signingDeviceFingerprintsOf` whose device can be shown THIS
 * vault (`deviceSuitsVault`): what the Bluetooth gates count. A key recorded
 * on a Ledger in a vault of one fixed address, or on a BitBox in a bare
 * `sh(multi)` or an `sh(wsh(…))`, is where the key lives, and no ceremony on that device can
 * sign or show the vault (decided 2026-10-17: such a record opened Send and
 * the address check, and the refusal came only after the device unlocked).
 */
function suitedDeviceFingerprintsOf(wallet: WalletMeta): Set<string> {
  const out = new Set<string>();
  for (const fp of signingDeviceFingerprintsOf(wallet)) {
    const kind = deviceKindFor(wallet, fp);
    if (kind && deviceSuitsVault(kind, wallet.descriptor)) out.add(fp);
  }
  return out;
}

/** The single-sig vault's device, when it can sign THIS vault; else null. */
function suitedSingleSigDevice(wallet: WalletMeta): KeyDevice | null {
  const dev = singleSigDevice(wallet);
  return dev && deviceSuitsVault(dev.kind, wallet.descriptor) ? dev : null;
}

/**
 * The one customer key of a single-sig vault: its fingerprint when the
 * descriptor carries one, else the key itself, so a bare xpub can still
 * remember which device holds it.
 */
export function singleSigKeyId(wallet: WalletMeta): string | null {
  if (!isSingleSigVault(wallet)) return null;
  const [k] = parseKeyOrigins(stripChecksum(wallet.descriptor).body);
  return k.fingerprint ? k.fingerprint.toLowerCase() : k.xpub;
}

/**
 * A vault with ONE key and nothing else in its script: the only shape a
 * device signs without having seen the vault first. Judged on the
 * descriptor, not the stored kind alone: a timelocked single-key vault
 * carries a second key and is a shared vault to every device.
 */
export function isSingleSigVault(wallet: WalletMeta): boolean {
  if (wallet.manual || wallet.kind !== 'single-sig' || !wallet.descriptor) return false;
  return parseKeyOrigins(stripChecksum(wallet.descriptor).body).length === 1;
}

/** The vault's shape for the device lists: judged like isSingleSigVault, on
 *  the descriptor's keys, so a timelocked one-key vault counts as shared. */
export function vaultShapeOf(wallet: WalletMeta): VaultShape {
  return isSingleSigVault(wallet) ? 'single' : 'multi';
}

/**
 * The device a single-sig vault's key lives on, or null when none is
 * recorded. A single-sig vault is NEVER registered on a device (decided
 * 2026-09-08): the device signs its own standard account without being
 * shown the vault first, so knowing WHICH device is all the ceremony
 * needs. A Ledger registration record from before this rule still counts
 * as knowing.
 */
export function singleSigDevice(wallet: WalletMeta): KeyDevice | null {
  const id = singleSigKeyId(wallet);
  return id ? deviceOfKey(wallet, id) : null;
}

/**
 * The device a vault knows for a key (by fingerprint, or by the key itself
 * for a bare single-sig): its record, else a Ledger registration made
 * before records were kept, which still proves a Ledger held the key, else
 * null. What every step reads before deciding whether to ask "Which
 * device?" (decided 2026-10-04).
 */
export function deviceOfKey(wallet: WalletMeta, keyId: string): KeyDevice | null {
  const id = keyId.toLowerCase();
  const hit = Object.entries(wallet.keyDevices ?? {}).find(([k]) => k.toLowerCase() === id);
  if (hit) return hit[1];
  if (Object.keys(wallet.ledgerRegistrations ?? {}).some((f) => f.toLowerCase() === id)) {
    return { kind: 'ledger' };
  }
  return null;
}

/**
 * One of the vault's own keys as a hardware step meets it (decided 2026-10-04:
 * the step lists the vault's OWN keys with their recorded devices instead
 * of asking which device): the name every screen gives the key, never its
 * fingerprint, and the device the vault knows for it. A single-sig vault's
 * one key is named after the vault, as the signing screen names it. Our
 * own keys are never handed to a step (`customerFingerprintsOf` leaves them
 * out), so none is ever listed with a device.
 */
export function stepKeyOf(wallet: WalletMeta, keyId: string, providerFps?: ReadonlySet<string>): StepKey {
  const id = keyId.toLowerCase();
  const name = keyDisplayName(wallet, /^[0-9a-f]{8}$/.test(id) ? id : null, providerFps) ?? (isSingleSigVault(wallet) ? wallet.label : 'Vault key');
  return { id, name, record: deviceOfKey(wallet, id) };
}

/** Every key of these as a step meets it, in the order given. */
export function stepKeysOf(wallet: WalletMeta, keyIds: readonly string[], providerFps?: ReadonlySet<string>): StepKey[] {
  return keyIds.map((id) => stepKeyOf(wallet, id, providerFps));
}

/**
 * The keys the address check can list: those whose recorded device can show
 * this vault's addresses (decided 2026-10-04: the owner's recovery key sat on
 * a Ledger the vault was never registered on, its row was listed, and the
 * tap ended in "Register this vault on your hardware first"). A Ledger shows
 * a shared vault's addresses only once it was registered on it, judged by
 * the same rule the check itself applies (`ledgerWalletSpecFor`: the
 * registration, or a standard one-key account, which needs none); a BitBox
 * registers inline, so its keys stay, unless the BitBox cannot be shown the
 * vault at all (`bitboxPolicyBlocker`: a bare `sh(multi)`, decided
 * 2026-10-17, or an `sh(wsh(…))`, a simulator run); a key with no record is asked which device and stays. A Ledger
 * registration from before records were kept is a registration.
 */
export function addressCheckKeysOf(wallet: WalletMeta, keyIds: readonly string[]): string[] {
  return keyIds.filter((raw) => {
    const id = raw.toLowerCase();
    const kind = deviceOfKey(wallet, id)?.kind;
    if (kind === 'bitbox') return bitboxPolicyBlocker(wallet.descriptor) == null;
    if (kind !== 'ledger') return true;
    const reg = Object.entries(wallet.ledgerRegistrations ?? {}).find(([fp]) => fp.toLowerCase() === id)?.[1];
    try {
      return !('blocker' in ledgerWalletSpecFor(wallet.descriptor, wallet.label, reg));
    } catch {
      return false;
    }
  });
}

/**
 * Whether Receive offers the hardware address check for this vault: a
 * shared vault bound to a Bluetooth device, or a one-key vault whose ONE
 * key carries a fingerprint and sits on a device that can show a single
 * account's address (decided 2026-10-04: a single key kept by its bare xpub
 * was offered the check, treated as a new box and failed on every device,
 * since a Ledger cannot verify a key with no origin).
 */
export function addressCheckOffered(wallet: WalletMeta, providerFps?: ReadonlySet<string>): boolean {
  if (!vaultIsLedgerBound(wallet, providerFps)) return false;
  if (vaultShapeOf(wallet) === 'multi') return true;
  const id = singleSigKeyId(wallet);
  const dev = suitedSingleSigDevice(wallet);
  return dev != null && id != null && /^[0-9a-f]{8}$/.test(id) && deviceCan(dev.kind, 'single', 'address');
}

/**
 * Fingerprints the OWNER must sign with: every keyed entry in the
 * descriptor minus 21st Capital's keys and heir keys. The NUMS internal
 * key records no fingerprint and drops out naturally.
 */
export function customerFingerprintsOf(
  wallet: WalletMeta,
  /** 21C's live known fingerprints — an IMPORTED vault carries no
   *  providerKeyFingerprints tag, so without this a 21C key would read as
   *  the owner's own (decided 2026-08-26). */
  providerFps?: ReadonlySet<string>,
): string[] {
  if (wallet.manual || !wallet.descriptor) return [];
  const excluded = new Set(
    [
      ...(wallet.providerKeyFingerprints ?? []),
      ...(providerFps ?? []),
      ...(wallet.heirs ?? []).flatMap((h) => (h.fingerprint ? [h.fingerprint] : [])),
      ...(wallet.heirKeyFingerprint ? [wallet.heirKeyFingerprint] : []),
    ].map((fp) => fp.toLowerCase()),
  );
  const seen = new Set<string>();
  for (const k of parseKeyOrigins(stripChecksum(wallet.descriptor).body)) {
    const fp = k.fingerprint?.toLowerCase();
    if (fp && !excluded.has(fp)) seen.add(fp);
  }
  return [...seen];
}

/**
 * True when the owner can meet the vault's signing requirement with
 * Ledger-held keys — the gate for offering Bluetooth signing and address
 * checks on this vault.
 *
 * For a plain k-of-n multisig, k bound customer keys suffice: a 1-of-2 with
 * one Ledger and one desktop hot key signs fine from the phone (a
 * test vault, 2026-08-26).
 *
 * Vaults involving 21st Capital or heir keys need only the PRIMARY path's
 * customer keys registered (decided 2026-09-05, replacing the earlier strict
 * every-customer-key rule). Recovery and heir layers sit behind a timelock
 * and the phone never spends through them; a client who has handed those
 * keys to their heirs will not register the vault on the heirs' devices,
 * and must not lose Send for it. 21st Capital's key counts as satisfied on
 * that path — the co-signing ceremony supplies it. Unknown shapes stay
 * strict: fail closed, never optimistic.
 */
/**
 * On an heir's own phone (`heirVault`), can the heir's key sign here? After
 * the unseal the heir holds an ordinary vault and their key spends on its
 * own branch (decided 2026-07-24/27: "sealed card or ordinary vault, nothing
 * between"; heir-path signing). Judged on the heir's key ONLY, which this
 * phone must have seen on a supported device (decided 2026-09-18: known
 * hardware), and, for Send, registered itself. A path must hold that key
 * and be satisfiable by it plus 21st Capital's keys, which the co-signing
 * ceremony supplies; a timelocked path counts, because the signing screen's
 * countdown decides when it may actually spend. Anything the policy parser
 * cannot flatten stays shut.
 */
function heirPhoneCanSign(
  wallet: WalletMeta,
  providerFps: ReadonlySet<string> | undefined,
  needRegistration: boolean,
): boolean {
  const onDevice = suitedDeviceFingerprintsOf(wallet);
  const registered = registeredFingerprintsOf(wallet);
  const bound = ownKeysOnThisPhone(wallet, providerFps).filter(
    (fp) => onDevice.has(fp) && (!needRegistration || registered.has(fp)),
  );
  if (bound.length === 0) return false;
  try {
    const policy = parsePolicy(stripChecksum(wallet.descriptor).body);
    if (!policy.exact) return false;
    const supplied = [...bound, ...(wallet.providerKeyFingerprints ?? []), ...(providerFps ?? [])].map((fp) =>
      fp.toLowerCase(),
    );
    return policy.paths.some(
      (p) =>
        p.groups.some((g) => g.keys.some((k) => bound.includes(k.fingerprint?.toLowerCase() ?? ''))) &&
        pathSatisfiedBy(p, supplied),
    );
  } catch {
    return false;
  }
}

export function vaultIsLedgerBound(
  wallet: WalletMeta,
  providerFps?: ReadonlySet<string>,
): boolean {
  // A single-sig vault is bound to a BLUETOOTH device when its key lives on
  // one; a Passport key is bound too, but not over Bluetooth, and this
  // answer gates the Bluetooth surfaces (address check, Bluetooth signing).
  if (isSingleSigVault(wallet)) {
    const dev = suitedSingleSigDevice(wallet);
    return dev != null && dev.kind !== 'passport';
  }
  if (wallet.heirVault) return heirPhoneCanSign(wallet, providerFps, false);
  const customer = customerFingerprintsOf(wallet, providerFps);
  if (customer.length === 0) return false;
  // Any Bluetooth signing device counts as bound: a BitBox key can sign the
  // same ceremonies a Ledger key can (a Nova+Gen5 test vault, 2026-08-31).
  // Only one that can be shown THIS vault, though: a record on a device
  // that cannot sign it binds nothing.
  const onDevice = suitedDeviceFingerprintsOf(wallet);
  const bound = customer.filter((fp) => onDevice.has(fp)).length;
  if (bound === customer.length) return true;

  const descriptorFps = new Set(
    parseKeyOrigins(stripChecksum(wallet.descriptor).body).flatMap((k) =>
      k.fingerprint ? [k.fingerprint.toLowerCase()] : [],
    ),
  );
  const plainSelfCustody =
    (wallet.providerKeyFingerprints ?? []).length === 0 &&
    ![...(providerFps ?? [])].some((fp) => descriptorFps.has(fp.toLowerCase())) &&
    (wallet.heirs ?? []).length === 0 &&
    !wallet.heirKeyFingerprint;
  const body = stripChecksum(wallet.descriptor).body;
  // Every Bluetooth device counts, in every branch below. The fast path above
  // already said so; the layered branch used to count Ledger keys only, which
  // left a BitBox-held primary key on a layered vault without Send.
  const boundFps = customer.filter((fp) => onDevice.has(fp));

  if (!plainSelfCustody) {
    // 21C or heir vault: the PRIMARY path, and only that. Anything the policy
    // parser cannot flatten faithfully stays fail-closed, exactly as before.
    try {
      const policy = parsePolicy(body);
      if (!policy.exact) return false;
      const primary = primaryPath(policy);
      if (!primary) return false;
      // 21st Capital's key counts toward COMPLETING the spend, never toward
      // KNOWING the hardware (decided 2026-09-18). A vault with no client device
      // on record is watch only, whatever the co-signing ceremony could add:
      // at least one of the owner's primary-path keys must be on a supported
      // device this app has itself seen.
      const onPrimary = new Set(
        primary.groups
          .flatMap((g) => g.keys)
          .flatMap((k) => (k.fingerprint ? [k.fingerprint.toLowerCase()] : [])),
      );
      if (!boundFps.some((fp) => onPrimary.has(fp))) return false;
      const supplied = [
        ...boundFps,
        ...(wallet.providerKeyFingerprints ?? []),
        ...(providerFps ?? []),
      ].map((fp) => fp.toLowerCase());
      return pathSatisfiedBy(primary, supplied);
    } catch {
      return false;
    }
  }

  const multi = parseMultisig(body);
  if (multi != null) return bound >= multi.threshold;

  // Layered (timelocked) plain self-custody vaults: ANY path the bound keys
  // satisfy earns the Send button — the primary one for everyday spending, or
  // a recovery layer whose keys are held here (the ceremony rebuilds on that
  // branch and the countdown decides when it may actually spend). Anything
  // the policy parser cannot flatten faithfully stays fail-closed.
  try {
    const policy = parsePolicy(body);
    if (!policy.exact) return false;
    return policy.paths.some((path) => pathSatisfiedBy(path, boundFps));
  } catch {
    return false;
  }
}

/**
 * Fingerprints the vault records as SOMEONE ELSE's heir keys, lowercase. On
 * an heir's own phone (`heirVault`) the heir key is the phone owner's own
 * (decided 2026-09-22: the heir was asked to register the vault owner's keys and
 * never their own), so it is not counted here there.
 */
export function heirFingerprintsOf(wallet: WalletMeta): Set<string> {
  return new Set(
    [
      ...(wallet.heirs ?? []).flatMap((h) => (h.fingerprint ? [h.fingerprint] : [])),
      ...(wallet.heirKeyFingerprint && !wallet.heirVault ? [wallet.heirKeyFingerprint] : []),
    ].map((fp) => fp.toLowerCase()),
  );
}

/**
 * The keys whose devices belong to the person holding THIS phone: the
 * vault's customer keys, or on an heir's phone their one key. What the
 * registration list, its card and its walk ask about.
 */
export function ownKeysOnThisPhone(wallet: WalletMeta, providerFps?: ReadonlySet<string>): string[] {
  if (wallet.heirVault) {
    const fp = wallet.heirKeyFingerprint?.toLowerCase();
    return fp ? [fp] : [];
  }
  return customerFingerprintsOf(wallet, providerFps);
}

/**
 * The devices other vaults on this phone have already proven for these keys
 * (by fingerprint). A new vault built on a key Talia has seen on a device
 * starts out knowing that device, as an import does.
 */
export function knownDevicesFor(
  fingerprints: readonly string[],
  wallets: ReadonlyArray<Pick<WalletMeta, 'keyDevices'>>,
): Record<string, KeyDevice> {
  const out: Record<string, KeyDevice> = {};
  for (const raw of fingerprints) {
    const fp = raw.toLowerCase();
    for (const w of wallets) {
      const entry = Object.entries(w.keyDevices ?? {}).find(([k]) => k.toLowerCase() === fp);
      if (entry) {
        out[fp] = entry[1];
        break;
      }
    }
  }
  return out;
}

export interface HardwareRegistrationItem {
  /** The device brand, or 'unknown' when no device is recorded for the key:
   *  the registration then searches for every adopted device (decided
   *  2026-09-22), never one brand by default. */
  kind: KeyDevice['kind'] | 'unknown';
  /** The owner's name tag for that device's key, when known. */
  label: string | null;
  /** The key fingerprint this device holds — the handle for ceremonies
   *  that target ONE device (the Receive address check). Null only on the
   *  legacy row, which stands for keys with no recorded device. */
  fingerprint: string | null;
  registered: boolean;
  /** The key on this device is an heir's. The walk still lists it (decided
   *  2026-08-31: "show all HWWs... including timelocked keys" — in a
   *  rehearsal the owner holds it and registers it like any other), but a
   *  standing nag must not hinge on it: a real heir takes their device
   *  home, and no ceremony the owner can run will ever tick that row. */
  heir: boolean;
}

/**
 * A vault the owner brought INTO Talia (paste, file, QR, NFC, an heir's
 * claim), as opposed to one Talia composed. Decided 2026-09-07: an imported vault
 * already has a backup wherever it came from, and its devices may already
 * know it, so the post-creation rules (backup step, Send hidden until every
 * device is registered here) do not apply to it. Portfolios are neither.
 */
export function vaultWasImported(wallet: Pick<WalletMeta, 'transport' | 'manual'>): boolean {
  return !wallet.manual && wallet.transport !== 'created';
}

/**
 * The customer keys that sign EVERYDAY spends: on a 21C or heir vault the
 * keys of the primary path (never a recovery layer's), on a plain vault
 * every customer key. Fail-closed: a policy the parser cannot flatten, or
 * one with no primary path, yields every customer key.
 */
export function primaryPathCustomerFingerprints(
  wallet: WalletMeta,
  providerFps?: ReadonlySet<string>,
): string[] {
  const customer = customerFingerprintsOf(wallet, providerFps);
  // Does this vault hold a key of OURS, or an heir's? Judged from BOTH
  // sources, the creation-time tag and the live fingerprint set, exactly as
  // customerFingerprintsOf judges it (decided 2026-09-23). An IMPORTED vault
  // carries no tag, so reading the tag alone called a 2-of-2 with our
  // co-signer "plain self custody", kept every key of the descriptor, and
  // asked the owner to register the next device for a recovery key they may
  // not even hold. The client's own device count on the primary path was
  // one.
  const ours = new Set(
    [...(wallet.providerKeyFingerprints ?? []), ...(providerFps ?? [])].map((fp) =>
      fp.toLowerCase(),
    ),
  );
  const holdsOurKey =
    !!wallet.descriptor &&
    parseKeyOrigins(stripChecksum(wallet.descriptor).body).some((k) => {
      const fp = k.fingerprint?.toLowerCase();
      return !!fp && ours.has(fp);
    });
  const plainSelfCustody =
    !holdsOurKey && (wallet.heirs ?? []).length === 0 && !wallet.heirKeyFingerprint;
  if (plainSelfCustody) return customer;
  try {
    const policy = parsePolicy(stripChecksum(wallet.descriptor).body);
    if (!policy.exact) return customer;
    const primary = primaryPath(policy);
    if (!primary) return customer;
    const onPath = new Set(
      primary.groups
        .flatMap((g) => g.keys)
        .map((k) => k.fingerprint?.toLowerCase())
        .filter((f): f is string => !!f),
    );
    const kept = customer.filter((fp) => onPath.has(fp));
    return kept.length > 0 ? kept : customer;
  } catch {
    return customer;
  }
}

/**
 * Has EVERY customer key on the primary path a registration record here
 * (Ledger HMAC or BitBox policy)? Stricter than vaultIsLedgerBound, which
 * asks whether enough keys are bound to meet the threshold: the rule of 2026-09-07
 * wants an imported vault to keep asking about registration until every
 * primary key is done, not just enough of them.
 */
export function primaryPathFullyRegistered(wallet: WalletMeta, providerFps?: ReadonlySet<string>): boolean {
  const keys = primaryPathCustomerFingerprints(wallet, providerFps);
  if (keys.length === 0) return false;
  const registered = registeredFingerprintsOf(wallet);
  return keys.every((fp) => registered.has(fp));
}

/** What it takes to broadcast from THIS phone, on one spending path. */
export interface SigningReach {
  /** Signatures the path needs in total. */
  needed: number;
  /** The owner's keys on that path this phone can sign with today: their
   *  device is on record here and it can sign THIS vault. */
  ready: string[];
  /** The owner's keys on that path with no usable device on record here. */
  missing: string[];
  /** 21st Capital's keys on that path. The co-signing ceremony supplies
   *  them, so they count toward the THRESHOLD and never toward knowing the
   *  hardware. */
  ours: string[];
  /** How many more of the owner's devices this phone has to meet before the
   *  path can be signed; 0 when it can be signed today, null when Talia
   *  cannot read the vault's policy and therefore cannot say. */
  shortBy: number | null;
  /** The path can be signed from this phone today. */
  canBroadcast: boolean;
}

const NO_REACH: SigningReach = {
  needed: 0,
  ready: [],
  missing: [],
  ours: [],
  shortBy: null,
  canBroadcast: false,
};

/** The device this vault has on record for a key, whatever wrote the record. */
function deviceKindFor(wallet: WalletMeta, fp: string): KeyDevice['kind'] | null {
  const entry = Object.entries(wallet.keyDevices ?? {}).find(([k]) => k.toLowerCase() === fp);
  if (entry) return entry[1].kind;
  if (Object.keys(wallet.ledgerRegistrations ?? {}).some((k) => k.toLowerCase() === fp)) return 'ledger';
  if (Object.keys(wallet.bitboxRegistrations ?? {}).some((k) => k.toLowerCase() === fp)) return 'bitbox';
  return null;
}

/**
 * Can this phone sign with that key today? The device has to be one Talia
 * itself recorded (decided 2026-09-18: the owner's word is not knowledge), of a
 * kind that signs this SHAPE of vault, and able to be shown THIS descriptor
 * (a Passport cannot be shown a taproot miniscript vault, so its key counts
 * for nothing there, however well we know the device).
 */
function keyCanSignHere(wallet: WalletMeta, fp: string): boolean {
  const kind = deviceKindFor(wallet, fp);
  if (!kind) return false;
  return deviceCan(kind, vaultShapeOf(wallet), 'sign') && deviceSuitsVault(kind, wallet.descriptor);
}

function reachOnPath(
  path: PolicyPath,
  ownOnPath: string[],
  ready: ReadonlySet<string>,
  ours: ReadonlySet<string>,
): SigningReach {
  let shortBy = 0;
  for (const group of path.groups) {
    const have = group.keys.filter((k) => {
      const fp = k.fingerprint?.toLowerCase();
      return !!fp && (ready.has(fp) || ours.has(fp));
    }).length;
    shortBy += Math.max(0, group.threshold - have);
  }
  const readyHere = ownOnPath.filter((fp) => ready.has(fp));
  const oursHere = path.groups
    .flatMap((g) => g.keys)
    .flatMap((k) => (k.fingerprint && ours.has(k.fingerprint.toLowerCase()) ? [k.fingerprint.toLowerCase()] : []));
  return {
    needed: pathRequirement(path).needed,
    ready: readyHere,
    missing: ownOnPath.filter((fp) => !ready.has(fp)),
    ours: [...new Set(oursHere)],
    shortBy,
    // Our own key never opens Send by itself (decided 2026-09-18): at least one
    // of the owner's keys must be on hardware this app has seen.
    canBroadcast: shortBy === 0 && readyHere.length > 0,
  };
}

/**
 * CAN THIS PHONE REACH A BROADCAST? (decided 2026-09-26.)
 *
 * "Let users send after registering the vault on one single hardware, as long
 * as we can reach any successful broadcast threshold. A 2-of-2 without us
 * means both devices. A 2-of-3 with us as co-signer means one device is
 * enough. A 2-of-3 without us needs two."
 *
 * Take a vault imported from Liana: a 2-of-3 with a Ledger Nano X, a Ledger
 * Nano S and our co-signer. The Nano X takes the vault; the Nano S cannot be
 * shown it at all. Asking for every key on the everyday path to be
 * registered would refuse the whole vault, though the Nano X plus our
 * co-signature is a complete spend. That is what this counts
 * instead:
 *
 *   ready    the owner's keys on the path whose device Talia has met AND
 *            which can sign this vault (see keyCanSignHere)
 *   ours     21st Capital's keys on that path: the co-signing ceremony
 *            supplies a signature, so they count toward the threshold. They
 *            never count toward knowing the hardware, so a vault with no
 *            device of the owner's on record stays watch only whatever we
 *            could add.
 *
 * Which path is judged:
 *  - a vault holding a key of ours or an heir's: the EVERYDAY path only.
 *    Its other layers are timelocked and hold keys the owner may have handed
 *    to their heirs, or our rescue key, which the phone cannot ask for.
 *  - a plain self-custody vault: any path its own keys can satisfy, the
 *    everyday one first. A recovery layer the owner holds is a real way to
 *    spend, and the signing screen's countdown decides when it may.
 *
 * Fail closed: a policy Talia cannot flatten faithfully reaches nothing,
 * except for a plain k-of-n, which `parseMultisig` reads exactly.
 */
export function signingReach(wallet: WalletMeta, providerFps?: ReadonlySet<string>): SigningReach {
  if (wallet.manual || !wallet.descriptor) return NO_REACH;
  const own = (wallet.heirVault ? ownKeysOnThisPhone(wallet, providerFps) : customerFingerprintsOf(wallet, providerFps)).map(
    (fp) => fp.toLowerCase(),
  );
  const ready = new Set(own.filter((fp) => keyCanSignHere(wallet, fp)));
  const ours = new Set(
    [...(wallet.providerKeyFingerprints ?? []), ...(providerFps ?? [])].map((fp) => fp.toLowerCase()),
  );
  const body = stripChecksum(wallet.descriptor).body;

  // A one-key vault has no policy to flatten and no path to choose.
  if (isSingleSigVault(wallet)) {
    const id = singleSigKeyId(wallet);
    const here = !!id && keyCanSignHere(wallet, id.toLowerCase());
    return {
      needed: 1,
      ready: here && id ? [id.toLowerCase()] : [],
      missing: here || !id ? [] : [id.toLowerCase()],
      ours: [],
      shortBy: here ? 0 : 1,
      canBroadcast: here,
    };
  }

  const descriptorFps = new Set(
    parseKeyOrigins(body).flatMap((k) => (k.fingerprint ? [k.fingerprint.toLowerCase()] : [])),
  );
  const plainSelfCustody =
    ![...ours].some((fp) => descriptorFps.has(fp)) &&
    (wallet.heirs ?? []).length === 0 &&
    !wallet.heirKeyFingerprint;

  let paths: PolicyPath[] = [];
  try {
    const policy = parsePolicy(body);
    if (policy.exact) {
      if (plainSelfCustody) {
        const first = primaryPath(policy);
        paths = first ? [first, ...policy.paths.filter((p) => p !== first)] : policy.paths;
      } else {
        const primary = primaryPath(policy);
        paths = primary ? [primary] : [];
      }
    }
  } catch {
    paths = [];
  }
  if (paths.length === 0) {
    // A plain k-of-n is read exactly without the policy parser; anything else
    // stays shut.
    const multi = parseMultisig(body);
    if (multi == null) return NO_REACH;
    paths = [
      {
        groups: [
          {
            threshold: multi.threshold,
            keys: parseKeyOrigins(body),
          },
        ],
      },
    ];
  }

  let best: SigningReach | null = null;
  for (const path of paths) {
    const onPath = path.groups
      .flatMap((g) => g.keys)
      .flatMap((k) => (k.fingerprint ? [k.fingerprint.toLowerCase()] : []))
      .filter((fp) => own.includes(fp));
    const reach = reachOnPath(path, [...new Set(onPath)], ready, ours);
    if (reach.canBroadcast) return reach;
    if (best == null || (reach.shortBy ?? Infinity) < (best.shortBy ?? Infinity)) best = reach;
  }
  return best ?? NO_REACH;
}

export type SendAccess = 'ready' | 'hidden' | 'disabled';

/**
 * What the Send button does for this vault.
 *
 * THE RULE (decided 2026-09-18): "No user should be able to even get to any send
 * screen unless we KNOW the hardware and we can support signing with the
 * hardware. If the user imports a vault and chooses watch only, that means
 * that it is WATCH ONLY."
 *
 * Known means Talia itself recorded the device: a keyDevices entry, or a
 * registration this app wrote after talking to the hardware. The client
 * SAYING a vault is already registered is not knowledge, and it used to be
 * enough. It bought a send screen for a vault whose key might be on hardware
 * we cannot drive, or in another country, and no ceremony rescues that: the
 * honest place to stop is before the screen.
 *
 * AND THE THRESHOLD IS WHAT COUNTS (decided 2026-09-26): one device is enough
 * wherever one device plus our co-signature is a complete spend. It used to
 * take EVERY key of the everyday path, which refused a client his own 2-of-3
 * because his second Ledger could not be shown the vault at all. `signingReach`
 * holds that rule and the scenarios it covers; the registration walk still
 * asks for the remaining devices, and "later" now costs nothing.
 *
 *  'ready'    this phone can reach a broadcast: Send opens.
 *  'hidden'   a multisig created in Talia with no device of the owner's on
 *             record yet (the registration card leads the way), or a
 *             portfolio.
 *  'disabled' watch only: no key of the owner's is on a device Talia knows,
 *             or too few are. The button stays, dimmed, and the tap offers to
 *             connect the hardware.
 */
export function sendAccess(wallet: WalletMeta, providerFps?: ReadonlySet<string>): SendAccess {
  if (wallet.manual) return 'hidden';
  if (isSingleSigVault(wallet)) {
    // Known AND able to sign this vault: a key kept on a Ledger in a vault
    // of one fixed address is watch only (decided 2026-10-17).
    return suitedSingleSigDevice(wallet) ? 'ready' : 'disabled';
  }
  // The heir's phone: the heir's own key on a device this app has met
  // (decided 2026-09-22: judged on the owner's keys, Send stayed dimmed after
  // the heir registered and the tap sent them back to a registration they had
  // finished). A keyless heir (opened by code) holds nothing that signs: no
  // Send at all.
  if (wallet.heirVault) {
    if (ownKeysOnThisPhone(wallet, providerFps).length === 0) return 'hidden';
    return heirPhoneCanSign(wallet, providerFps, false) ? 'ready' : 'disabled';
  }
  if (signingReach(wallet, providerFps).canBroadcast) return 'ready';
  // Nothing signs here yet. A vault built in Talia points at its registration
  // card instead of a dimmed button; an imported one is watch only until a
  // device is connected.
  return vaultWasImported(wallet) ? 'disabled' : 'hidden';
}

/**
 * One row per hardware DEVICE the vault keeps a key on (two Ledgers are two
 * rows, each named by its own key's tag), with whether THIS vault is
 * registered on it yet. Drives the post-creation walk (decided 2026-08-31): the
 * owner picks the order, each finished device earns its tick, and the list
 * keeps returning until every row has one.
 *
 * Registration proof is per key fingerprint and never inferred from
 * keyDevices alone (that records key custody, not registration; the badge
 * lied once): `registeredFingerprintsOf` reads every brand's own record.
 *
 * Keys of the phone's owner with NO recorded device share one row of kind
 * 'unknown' that demands ALL of them (decided 2026-09-22): it used to be a
 * Ledger row, so an heir holding a BitBox was sent to a Ledger-only search.
 * Registering opens the search for every adopted device, and whichever one
 * answers with a key of the vault is registered for that key. The row reads
 * the DESCRIPTOR (ownKeysOnThisPhone), never a brand's registrations, which
 * would make the demand self-satisfying (decided 2026-08-31).
 */
/** The name stored for a key (fingerprint in any case), or null: never a
 *  stand-in such as "Key 2", which the row's own fallback words replace. */
function storedKeyLabel(wallet: WalletMeta, fp: string): string | null {
  const labels = wallet.keyLabels ?? {};
  const want = fp.toLowerCase();
  if (labels[want] !== undefined) return labels[want];
  const hit = Object.keys(labels).find((k) => k.toLowerCase() === want);
  return hit !== undefined ? labels[hit] : null;
}

export function hardwareRegistrationChecklist(
  wallet: WalletMeta,
  /** 21C's live fingerprints — see customerFingerprintsOf. */
  providerFps?: ReadonlySet<string>,
): HardwareRegistrationItem[] {
  // Nothing to register on a single-sig vault (decided 2026-09-08): the device
  // signs its own standard account; only a shared vault must be shown to
  // each device once. No rows, so no card, no walk, no prompt.
  if (isSingleSigVault(wallet)) return [];
  const registered = registeredFingerprintsOf(wallet);
  const items: HardwareRegistrationItem[] = [];
  const assigned = new Set<string>();
  const heirFps = heirFingerprintsOf(wallet);
  // Every adopted device that shows a vault to itself, in the registry's
  // order; within a brand, the order keys were recorded. A brand added to
  // the registry is listed here with no change to this function.
  for (const { kind } of devicesFor('multi', 'register')) {
    // A brand that cannot be shown THIS vault (a BitBox and a bare
    // `sh(multi)` or an `sh(wsh(…))`) gets no row: its key is known to live there, and no
    // ceremony on it can ever tick the row (decided 2026-10-17: the card
    // stayed and "Register now" opened an empty device list). The key is
    // still assigned, so it does not fall into the brand-unknown row either.
    const suits = deviceSuitsVault(kind, wallet.descriptor);
    for (const [fpRaw, dev] of Object.entries(wallet.keyDevices ?? {})) {
      if (dev.kind !== kind) continue;
      const fp = fpRaw.toLowerCase();
      assigned.add(fp);
      if (!suits) continue;
      items.push({
        kind,
        label: wallet.keyLabels?.[fp] ?? wallet.keyLabels?.[fpRaw] ?? null,
        fingerprint: fp,
        registered: registered.has(fp),
        heir: heirFps.has(fp),
      });
    }
  }
  // Keys whose device this phone has never seen: ONE row, brand unknown,
  // which searches for every adopted device (decided 2026-09-22). It used to be
  // typed 'ledger' and opened a Ledger-only search.
  // The PRIMARY path's keys, the same set Send is gated on
  // (primaryPathFullyRegistered). A recovery key sits behind a timelock and
  // this phone never spends through it, so asking to register it blocks an
  // import for a device the owner may not hold (decided 2026-09-23: "a 2/2 with
  // us as the cosigner means the client only has one device"). An heir's
  // vault still asks about the heir's own key, which ownKeysOnThisPhone
  // answers.
  const mine = wallet.heirVault
    ? ownKeysOnThisPhone(wallet, providerFps)
    : primaryPathCustomerFingerprints(wallet, providerFps);
  const unassigned = mine.filter((fp) => !assigned.has(fp));
  if (unassigned.length > 0) {
    const only = unassigned.length === 1 ? unassigned[0] : null;
    items.unshift({
      kind: 'unknown',
      // A row that stands for ONE key carries that key's name, as a
      // recorded device's row does (decided 2026-11-05 after a phone test: a
      // vault imported with its key names offered "Your hardware" for a key
      // named "Office Ledger", beside its other keys' names). A row for several
      // keys has no one name.
      label: only ? storedKeyLabel(wallet, only) : null,
      fingerprint: only,
      registered: unassigned.every((fp) => registered.has(fp)),
      heir: false,
    });
  }
  return items;
}

/**
 * The registration walk the vault page offers ("Register on your hardware",
 * one device at a time): the checklist above, or nothing when no adopted
 * device can be shown this vault's shape at all (`ledgerPolicyBlocker`; the
 * BitBox shares the Ledger's translator). One rule for the vault page and
 * for the "Vault built" page, which says "register it on your hardware" only
 * when this walk has something to ask (decided 2026-10-02: a vault whose keys
 * need no registration is never told to register).
 */
export function registrationWalk(
  wallet: WalletMeta,
  /** 21C's fingerprints — see customerFingerprintsOf. */
  providerFps?: ReadonlySet<string>,
): HardwareRegistrationItem[] {
  return ledgerPolicyBlocker(wallet.descriptor) == null ? hardwareRegistrationChecklist(wallet, providerFps) : [];
}

/**
 * The keys the registration screen still has to meet, one per key (decided
 * 2026-10-04: a step lists the vault's OWN keys with their recorded devices;
 * the checklist's brand-neutral row stands for several keys at once and
 * cannot be listed that way): every key the checklist asks about that has
 * no registration yet. The owner's everyday keys in the descriptor's order
 * (on an heir's phone the heir's own key), then any other key on a recorded
 * device, as the checklist counts them; heir keys are never the owner's to
 * register, and neither are ours (decided 2026-10-04: the address check
 * records ANY vault key a device proves, so a record under one of our
 * fingerprints can exist, and it must never become a row with a device
 * tile and a ceremony). Empty for a single-sig vault, as the checklist is.
 */
export function ownKeysToRegister(wallet: WalletMeta, providerFps?: ReadonlySet<string>): string[] {
  if (isSingleSigVault(wallet)) return [];
  const registered = registeredFingerprintsOf(wallet);
  const heirFps = heirFingerprintsOf(wallet);
  const ours = new Set([...(wallet.providerKeyFingerprints ?? []), ...(providerFps ?? [])].map((fp) => fp.toLowerCase()));
  const registering = new Set(devicesFor('multi', 'register').map((d) => d.kind));
  // A key recorded on a device that cannot be shown this vault is left out,
  // as the checklist leaves it out (decided 2026-10-17).
  const unsuited = new Set(
    Object.entries(wallet.keyDevices ?? {})
      .filter(([, dev]) => registering.has(dev.kind) && !deviceSuitsVault(dev.kind, wallet.descriptor))
      .map(([fp]) => fp.toLowerCase()),
  );
  const mine = wallet.heirVault ? ownKeysOnThisPhone(wallet, providerFps) : primaryPathCustomerFingerprints(wallet, providerFps);
  const recorded = Object.entries(wallet.keyDevices ?? {})
    .filter(([, dev]) => registering.has(dev.kind))
    .map(([fp]) => fp.toLowerCase())
    .filter((fp) => !heirFps.has(fp) && !mine.includes(fp) && !ours.has(fp));
  return [...mine, ...recorded].filter((fp) => !registered.has(fp) && !unsuited.has(fp));
}

/**
 * The NAME the owner gave the key living on a device of this kind, for
 * dialogs that ask "which device?". A person recognizes "BBNOVA TEST" faster
 * than a brand word (decided 2026-08-31); the brand is the fallback for imported
 * vaults whose labels never existed.
 */
export function deviceKeyLabel(wallet: WalletMeta, kind: KeyDevice['kind']): string | null {
  for (const [fp, dev] of Object.entries(wallet.keyDevices ?? {})) {
    if (dev.kind !== kind) continue;
    const label = wallet.keyLabels?.[fp.toLowerCase()] ?? wallet.keyLabels?.[fp];
    if (label) return label;
  }
  return null;
}
