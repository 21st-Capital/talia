/**
 * The hardware Talia has adopted, in ONE place (decided 2026-09-22: "we will be
 * adding more and more HWWs into TALIA and all moving parts need to know
 * about newly added hardware, every part of the app needs to automatically
 * use the same library and look for all available hardware we have adopted").
 *
 * Every screen that connects to hardware starts from the DEVICE (decided
 * 2026-10-04: "we simply ASK him which device he will be using for each key.
 * That will also replace the 'method' on how we connect because we know
 * which device connects how"): the brands here say what each can do per
 * vault shape and how it connects, the models below are what every "Which
 * device?" list offers, and a vault's own records say which device to connect
 * to without asking. Adding a device is one model row (and a brand row with
 * its driver when the brand is new); the brand's method decides the step
 * after the pick, so no screen asks how a device connects.
 *
 * Pure: no native, no storage.
 */
import type { KeyDevice, WalletMeta } from './types';
import { bitboxScriptBlocker } from '../bitcoin/bitbox/policy';
import { nonRangedBlocker } from '../bitcoin/ledger/policy';

export type DeviceKind = KeyDevice['kind'];

/** How a device talks to the phone. */
export type ConnectionMethod = 'bluetooth' | 'qr';

/** The shape of vault a device is used for: one key, or shared. */
export type VaultShape = 'single' | 'multi';

/** What the connection is for. */
export type HardwarePurpose =
  /** Show a shared vault to the device, or link a single key to it. */
  | 'register'
  /** Sign a transaction. */
  | 'sign'
  /** Read a public key. */
  | 'key'
  /** Read a public key for a vault Talia is BUILDING. */
  | 'build'
  /** Show a receive address on the device's screen. */
  | 'address';

export interface DeviceKindInfo {
  kind: DeviceKind;
  /** The brand as a person says it. */
  name: string;
  methods: readonly ConnectionMethod[];
  /** What the device does, per vault shape; a shape it is absent from is
   *  one it is never offered for. */
  purposes: Readonly<Partial<Record<VaultShape, readonly HardwarePurpose[]>>>;
  /**
   * What happens ON this device, per method, once the owner has chosen how
   * to connect. One line each: only the brand knows its own ceremony, and
   * every screen renders these from here, so adopting a brand writes its
   * line once and every instruction list gains it (decided 2026-09-23, after the
   * add-a-key sheet was found still naming two brands by hand).
   */
  notes?: Readonly<Partial<Record<ConnectionMethod, string>>>;
  /**
   * Can this device be shown a TAPROOT MINISCRIPT vault and sign its script
   * paths? (reported 2026-09-24: "The foundation passport doesnt support taproot
   * ministcript! it only supports standard single and standard multisigs.")
   *
   * This is the real line, under everything else. Talia composes taproot
   * for any layered shape and for any vault holding a 21st Capital key, and
   * plain `wpkh` / `wsh(sortedmulti)` for a vault that is neither. So a
   * device without this can do exactly the two standard shapes, whoever is
   * asking and however the vault arrived.
   */
  taprootMiniscript: boolean;
  /**
   * A vault script this brand cannot be shown, with the sentence its tasks
   * refuse with, or null: a vault of one fixed address, which no BIP-388
   * template can carry (decided 2026-10-17), and
   * a script the shared translator carries but this brand cannot sign. Read
   * by `deviceSuitsVault`, so the brand is never offered for such a vault
   * and its key never counts toward Send there; the brand's own blocker
   * stays the second lock inside every task.
   */
  scriptBlocker?: (descriptor: string) => string | null;
}

const ALL_PURPOSES: readonly HardwarePurpose[] = ['register', 'sign', 'key', 'build', 'address'];

/**
 * WHAT TALIA SUPPORTS TODAY, per vault shape (decided 2026-09-24):
 *
 *   Layered multisig ................ Ledger, BitBox      (taproot only)
 *   Multisig holding a 21C key ...... Ledger, BitBox      (taproot only)
 *   Plain multisig, no 21C key ...... Ledger, BitBox, Passport
 *   Layered single-sig (our rescue
 *     key, or a timelocked heir key)  Ledger, BitBox      (taproot only)
 *   Plain single-sig ................ Ledger, BitBox, Passport (segwit only)
 *
 * Every shape but the two plain ones needs a device that can be shown a
 * policy and sign its script paths, which today means Ledger or BitBox.
 *
 * So BUILDING a vault in Talia takes a Ledger or a BitBox, full stop (decided
 * 2026-09-24: "If a user clicks to create a new vault, it should ONLY accept
 * a ledger or bitbox since these two are the only ones that can be used with
 * our keys or additional heir keys"). A one-key vault can gain a rescue key
 * or a timelocked heir key on the very next step of the same builder, and a
 * Passport cannot sign either of those: the client would finish a vault they
 * could not spend from. That is why `build` is its own purpose rather than
 * `key`, which stays open to every device.
 *
 * A Passport still comes in through "Add an existing vault", where the vault
 * already exists and its shape is known before any key is read ("The user
 * can still connect a standard foundation passport by going through the
 * 'Add existing vault' wizard").
 */

/**
 * Adopted devices, in the order searches and lists show them. Coinkite
 * products are retired for good (decided 2026-08-27) and never appear here.
 */
export const DEVICE_KINDS: readonly DeviceKindInfo[] = [
  {
    kind: 'ledger',
    name: 'Ledger',
    methods: ['bluetooth'],
    purposes: { single: ALL_PURPOSES, multi: ALL_PURPOSES },
    taprootMiniscript: true,
    // No non-ranged vault (`xpub/0/7`, a bare `xpub`, a raw public key):
    // decided 2026-10-17. A two-list import
    // (`/0/*` beside `/1/*`) is left to the connect step, which asks for a
    // re-import in its own sentence.
    scriptBlocker: nonRangedBlocker,
    notes: { bluetooth: 'A Ledger asks to open its Bitcoin app: approve “Open app” on it.' },
  },
  {
    kind: 'bitbox',
    name: 'BitBox',
    methods: ['bluetooth'],
    // A one-key vault's address check needs the device's plain-account
    // address call, which Talia's BitBox bridge does not have yet.
    purposes: { single: ['register', 'sign', 'key', 'build'], multi: ALL_PURPOSES },
    taprootMiniscript: true,
    // No non-ranged vault, no bare P2SH multisig
    // (`sh(multi(…))`), decided 2026-10-17; and
    // no P2SH-wrapped `sh(wsh(…))`, which the device refuses to register
    // (a BitBox02 simulator run; decided 2026-10-17).
    scriptBlocker: bitboxScriptBlocker,
    notes: {
      bluetooth:
        'A BitBox asks for its password, and on the first pairing both screens show a code to confirm.',
    },
  },
  {
    // QR only, and single-sig only (decided 2026-09-08); it shows no vault and
    // has no address check.
    kind: 'passport',
    name: 'Passport',
    methods: ['qr'],
    // No `build`: a vault Talia is creating can gain a rescue key or a
    // timelocked heir key on the next step, and a Passport cannot sign
    // either (see the support matrix above). It arrives through "Add an
    // existing vault" instead, where the shape is already settled.
    purposes: { single: ['register', 'sign', 'key'] },
    // Standard scripts only: plain single-sig, and a plain multisig it was
    // shown elsewhere. Never a layered vault, and never one holding a 21st
    // Capital key, because both are taproot miniscript.
    taprootMiniscript: false,
    notes: {
      qr: 'A Passport shows it under Manage Account, then Connect Wallet, then Sparrow: choose Single-sig, then QR Code.',
    },
  },
];

// ─── The models ──────────────────────────────────────────────────────────────

/**
 * Every product Talia lists and draws, by the drawings' own ids (decided
 * 2026-10-04: "we simply ASK him which device he will be using for each key
 * ... based on that selection we show him all the animations we built for
 * each device both during SETUP and during signing! As we add more and more
 * signing devices, that list grows"). A new device is one row here, and its
 * drawing; every "Which device?" list reads this.
 */
export type DeviceModel = 'gen5' | 'flex' | 'stax' | 'nanoX' | 'nova' | 'passport';

export interface DeviceModelInfo {
  id: DeviceModel;
  kind: DeviceKind;
  /** The product as the tile names it, under the brand's mark. */
  name: string;
  /** The product with its brand, as a sentence names it. */
  fullName: string;
  /** The ids the brand's kit reports for it at discovery (none for a brand
   *  whose only Bluetooth product it is, or a device never on Bluetooth). */
  kitIds: readonly string[];
}

/**
 * In the order every list shows them. Only devices that reach a phone: the
 * Nano S and S Plus and the BitBox02 have no Bluetooth and are never found
 * (platform/ledger.ts, platform/bitbox.ts). The Passport is the product whose
 * QR flow Talia adopted (Manage Account, Connect Wallet, Sparrow); the Prime
 * is not checked and so not listed.
 */
export const DEVICE_MODELS: readonly DeviceModelInfo[] = [
  { id: 'gen5', kind: 'ledger', name: 'Nano Gen5', fullName: 'Ledger Nano Gen5', kitIds: ['apexp'] },
  { id: 'flex', kind: 'ledger', name: 'Flex', fullName: 'Ledger Flex', kitIds: ['flex'] },
  { id: 'stax', kind: 'ledger', name: 'Stax', fullName: 'Ledger Stax', kitIds: ['stax'] },
  { id: 'nanoX', kind: 'ledger', name: 'Nano X', fullName: 'Ledger Nano X', kitIds: ['nanoX'] },
  { id: 'nova', kind: 'bitbox', name: 'BitBox02 Nova', fullName: 'BitBox02 Nova', kitIds: [] },
  { id: 'passport', kind: 'passport', name: 'Passport', fullName: 'Foundation Passport', kitIds: [] },
];

export function isDeviceModel(v: unknown): v is DeviceModel {
  return typeof v === 'string' && DEVICE_MODELS.some((m) => m.id === v);
}

export function modelInfo(id: DeviceModel): DeviceModelInfo {
  const found = DEVICE_MODELS.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown device model: ${id}`);
  return found;
}

/** "Ledger Flex", "BitBox02 Nova": the product with its brand. */
export function modelName(id: DeviceModel): string {
  return modelInfo(id).fullName;
}

/** The models of one brand, in list order. */
export function modelsOfKind(kind: DeviceKind): DeviceModel[] {
  return DEVICE_MODELS.filter((m) => m.kind === kind).map((m) => m.id);
}

/**
 * The model a found device is: a Ledger by the id its kit reports at
 * discovery ('apexp' is the Nano Gen5), null for a model Talia does not list;
 * a BitBox over Bluetooth is always a Nova (the search finds BitBoxes by the
 * Nova's own Bluetooth service, and the BitBox02 has no radio); a Passport is
 * the Passport.
 */
export function modelFromKit(kind: DeviceKind, kitId?: string | null): DeviceModel | null {
  const own = DEVICE_MODELS.filter((m) => m.kind === kind);
  if (own.length === 1 && own[0].kitIds.length === 0) return own[0].id;
  return own.find((m) => kitId != null && m.kitIds.includes(kitId))?.id ?? null;
}

/** What `keyDevices` records for a key on a device of this model. */
export function recordOf(model: DeviceModel): KeyDevice {
  return { kind: modelInfo(model).kind, model };
}

/**
 * The model a key's record names, when it names one: its own model when it is
 * a listed model of that brand; a BitBox is the Nova and a Passport the
 * Passport whether or not the record says so (a record written before models
 * were kept); a Ledger whose model was never kept is null, since four Ledgers
 * share that brand.
 */
export function modelOfRecord(rec: KeyDevice | null | undefined): DeviceModel | null {
  if (!rec || !deviceKindInfo(rec.kind)) return null;
  if (isDeviceModel(rec.model) && modelInfo(rec.model).kind === rec.kind) return rec.model;
  return modelFromKit(rec.kind, null);
}

/** The device a vault recorded for a key, by its id in either case. */
export function recordedDevice(
  wallet: Pick<WalletMeta, 'keyDevices'> | null | undefined,
  keyId: string | null | undefined,
): KeyDevice | null {
  if (!keyId) return null;
  const id = keyId.toLowerCase();
  const hit = Object.entries(wallet?.keyDevices ?? {}).find(([k]) => k.toLowerCase() === id);
  return hit?.[1] ?? null;
}

/**
 * The models a "Which device?" list offers for a step: every listed model
 * whose brand can do `purpose` for a vault of `shape` and suits THIS vault
 * (`deviceSuitsVault` on its descriptor; leave the descriptor out for a vault
 * that does not exist yet, building or importing, where only the purpose
 * decides, and the save checks the Passport against the descriptor once it
 * is known). A device reached over Bluetooth alone is listed only when the
 * build has the hardware surface (the App Store build has none).
 */
export function modelsFor(
  shape: VaultShape,
  purpose: HardwarePurpose,
  opts: { descriptor?: string | null; hardwareSurface: boolean },
): DeviceModel[] {
  return DEVICE_MODELS.filter((m) => {
    const info = deviceKindInfo(m.kind);
    if (!info || !deviceCan(m.kind, shape, purpose)) return false;
    if (opts.descriptor !== undefined && !deviceSuitsVault(m.kind, opts.descriptor)) return false;
    const bluetoothOnly = info.methods.every((method) => method === 'bluetooth');
    return !bluetoothOnly || opts.hardwareSurface;
  }).map((m) => m.id);
}

/** A key a hardware step can meet: the name every screen gives it, and what
 *  the vault recorded for it (null when nothing was). Never one of 21st
 *  Capital's: our keys are never asked about and never sit on a device. */
export interface StepKey {
  /** The key's id: its fingerprint, or the xpub itself for a bare key. */
  id: string;
  name: string;
  record: KeyDevice | null | undefined;
}

/** One row of a known vault's key list: the key, and what tapping it does. */
export interface KeyRow {
  id: string;
  name: string;
  /** The model the row connects to straight; null when the row asks. */
  model: DeviceModel | null;
  /** The brand the record names when its model was never kept (a Ledger
   *  from before models were recorded): the row asks among that brand's
   *  models. Null with a model, and for a key with no record at all. */
  kind: DeviceKind | null;
  /** What tapping a row with no model asks among. */
  ask: DeviceModel[];
}

/**
 * How a hardware step starts (decided 2026-10-04: "Other than the above
 * scenarios, the Hardware and its associated key is KNOWN and we should list
 * them instead of guessing or asking"):
 *
 *   connect   straight to the one device that can do the job
 *   keys      the vault's own keys, each with its recorded device
 *   ask       the bare list of every device Talia supports
 */
export type KeyStep = { kind: 'connect'; model: DeviceModel } | { kind: 'keys'; rows: KeyRow[] } | { kind: 'ask'; models: DeviceModel[] };

/**
 * Whether a step connects straight, lists the vault's own keys, or asks
 * among every supported device (decided 2026-10-04: "the bare list of all
 * supported devices should only be used if: 1. A vault has been imported and
 * we dont know which hardware is being used and the user wants to register
 * the keys. 2. we are building a brand new vault and we need to know which
 * device the user wants to use. 3. The user wants to replace a key with a new
 * signing device which we dont know about. Other than the above scenarios,
 * the Hardware and its associated key is KNOWN and we should list them
 * instead of guessing or asking.").
 *
 * `keys` are the keys this step can meet with what the vault recorded for
 * each, `suited` the models the step offers. No keys at all (a new box: the
 * builders, a replacement, an import, a backup to unlock) asks among every
 * suited model. Keys whose records resolve to exactly ONE suited model (one
 * key on a known device, two keys on two boxes of one model) connect
 * straight to it. Nothing recorded for any key (a vault imported before its
 * hardware was ever connected here) asks once among every suited model, and
 * the device that answers is recorded for the key it proves. A single key
 * whose record names a brand but no model asks among that brand's models.
 * Otherwise the vault KNOWS: one row per key with its recorded device, and a
 * row whose device was never recorded asks once when tapped (its device is
 * then known). A recorded device that cannot do this job (a Passport for an
 * address check) is left out. The answer only steers the DRAWING and the
 * search: discovery writes the record (`recordFromDiscovery`).
 */
export function keyStep(keys: readonly StepKey[], suited: readonly DeviceModel[]): KeyStep {
  if (keys.length === 0) return { kind: 'ask', models: [...suited] };
  const rows = keys
    .map((k): KeyRow => {
      const rec = k.record;
      const model = modelOfRecord(rec);
      if (model != null) return { id: k.id, name: k.name, model: suited.includes(model) ? model : null, kind: null, ask: suited.includes(model) ? [model] : [] };
      if (rec && deviceKindInfo(rec.kind)) return { id: k.id, name: k.name, model: null, kind: rec.kind, ask: suited.filter((m) => modelInfo(m).kind === rec.kind) };
      return { id: k.id, name: k.name, model: null, kind: null, ask: [...suited] };
    })
    .filter((r) => r.ask.length > 0);
  if (rows.length === 0) return { kind: 'ask', models: [] };
  const union = DEVICE_MODELS.map((m) => m.id).filter((id) => rows.some((r) => r.ask.includes(id)));
  if (union.length === 1) return { kind: 'connect', model: union[0] };
  // Every row asks the SAME question (each row's list is a subset of their
  // union, so equal length is the same list): ask it at once. The device
  // that answers proves which key it holds, so naming the key first adds
  // nothing. Rows asking different lists (one key a Ledger of no kept model,
  // another never connected) are the vault knowing something about its
  // keys, and it lists them (decided 2026-10-04: a 2-of-3 registered on a
  // Ledger before models were kept, its second key never connected, was
  // shown the bare Ledger / BitBox list at the address check).
  if (rows.every((r) => r.ask.length === union.length)) return { kind: 'ask', models: union };
  return { kind: 'keys', rows };
}

/**
 * What a device that just proved a key writes over the key's record: the
 * found device's record when the key had none, when it is another brand, or
 * when it names a model the record did not (a Ledger kept as a bare 'ledger',
 * a model that changed); null when the record already says it. Only a
 * device that PROVED the key writes (the no-Send-without-known-hardware rule):
 * the pick in a "Which device?" list is never written by itself.
 */
export function recordFromDiscovery(prev: KeyDevice | null | undefined, found: KeyDevice): KeyDevice | null {
  if (!prev || prev.kind !== found.kind) return found;
  if (found.model != null && prev.model !== found.model) return found;
  return null;
}

/** The brands behind these models, once each, in the registry's order. */
export function kindsOf(models: readonly DeviceModel[]): DeviceKind[] {
  const kinds = new Set(models.map((m) => modelInfo(m).kind));
  return DEVICE_KINDS.filter((d) => kinds.has(d.kind)).map((d) => d.kind);
}

/** "Ledger or BitBox": the brands behind these models, for a sentence. */
export function brandNamesOf(models: readonly DeviceModel[]): string {
  const names = kindsOf(models).map((k) => deviceName(k));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

export function deviceKindInfo(kind: DeviceKind): DeviceKindInfo | undefined {
  return DEVICE_KINDS.find((d) => d.kind === kind);
}

/** A device to name in an example, from the registry's own order. */
export function exampleDeviceName(): string {
  return DEVICE_KINDS[0]?.name ?? 'your hardware';
}

/** "Ledger", "BitBox": the brand's name, or a neutral word when unknown. */
export function deviceName(kind: DeviceKind | null | undefined): string {
  return (kind && deviceKindInfo(kind)?.name) || 'your hardware';
}

/** The devices that can do `purpose` for a vault of `shape` over `method`. */
export function devicesFor(
  shape: VaultShape,
  purpose: HardwarePurpose,
  method?: ConnectionMethod,
): DeviceKindInfo[] {
  return DEVICE_KINDS.filter(
    (d) => (d.purposes[shape] ?? []).includes(purpose) && (method == null || d.methods.includes(method)),
  );
}

/** Can a device of this kind do `purpose` for a vault of `shape`? */
export function deviceCan(kind: DeviceKind, shape: VaultShape, purpose: HardwarePurpose): boolean {
  return (deviceKindInfo(kind)?.purposes[shape] ?? []).includes(purpose);
}

/**
 * Every key fingerprint this vault has a registration record for, whichever
 * device wrote it (a Ledger's HMAC, a BitBox's marker). The one place that
 * reads the per-brand registration fields: a brand added later adds its
 * field here and every completeness question follows.
 */
export function registeredFingerprintsOf(
  wallet: Pick<WalletMeta, 'ledgerRegistrations' | 'bitboxRegistrations'>,
): Set<string> {
  return new Set(
    [...Object.keys(wallet.ledgerRegistrations ?? {}), ...Object.keys(wallet.bitboxRegistrations ?? {})].map((fp) =>
      fp.toLowerCase(),
    ),
  );
}

/**
 * Can a device of this kind be used with THIS vault?
 *
 * The descriptor decides, not the shape (decided 2026-09-24): Talia composes
 * taproot miniscript for every layered vault and for every vault holding a
 * 21st Capital key, and plain `wpkh` / `wsh(sortedmulti)` for a vault that
 * is neither. A device without taproot miniscript can do the second kind
 * and only the second kind. An IMPORTED vault can carry a script a brand
 * has no way to sign (a vault of one fixed address on a Ledger or a BitBox,
 * a bare `sh(multi)` or an `sh(wsh(…))` on the BitBox): the brand's own `scriptBlocker` says
 * no to it first.
 *
 * Unreadable or empty descriptor: false for such a device, never true. A
 * vault Talia cannot classify must not be bound to hardware that may be
 * unable to sign it, because the owner would only find out at Send.
 */
export function deviceSuitsVault(kind: DeviceKind, descriptor?: string | null): boolean {
  const info = deviceKindInfo(kind);
  if (!info) return false;
  if (descriptor && info.scriptBlocker?.(descriptor)) return false;
  if (info.taprootMiniscript) return true;
  return isStandardScript(descriptor);
}

/**
 * A plain `wpkh`, `sh(wpkh)`, `wsh(multi)` or `wsh(sortedmulti)` vault: no
 * script tree, no timelock, nothing a standard device cannot be shown.
 */
export function isStandardScript(descriptor?: string | null): boolean {
  const text = (descriptor ?? '').trim().toLowerCase();
  if (!text) return false;
  // A taproot descriptor is standard only as a bare key spend, which Talia
  // never composes for a shared vault; anything with a script tree is not.
  if (text.startsWith('tr(')) return false;
  if (/older\s*\(|after\s*\(|and_v|or_d|or_i|multi_a|thresh\s*\(/.test(text)) return false;
  return /^(wpkh|sh|wsh|pkh)\s*\(/.test(text);
}
