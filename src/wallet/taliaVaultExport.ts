/**
 * The vault as one Talia hands it to another (reported 2026-09-15: "why isnt the
 * TALIA export of vaults not exporting the labels of the keys and the name of
 * the vault?" and "it is also not known to the Importing TALIA that the vault
 * is already registered. Can we export that information too?").
 *
 * A descriptor alone is what every OTHER wallet reads, and it carries nothing
 * a person chose: not the vault's name, not what each key is called, not
 * which device holds which key, not the registrations those devices returned.
 * Between two Talias all of that travels as well, so the second phone knows
 * the vault's devices the moment it lands and signs over Bluetooth instead of
 * asking to register the vault again.
 *
 * Everything here is PUBLIC and cannot spend. A Ledger registration's HMAC is
 * a receipt the device checks, not a secret: a forged one only makes that
 * device refuse to sign. Everything read back is validated field by field and
 * cut to the keys the descriptor actually holds; anything else is dropped.
 *
 * Pure: no I/O. Unit-tested.
 */
import { parseKeyOrigins, stripChecksum } from '../bitcoin/descriptor';
import type { BitboxRegistration, KeyDevice, LedgerRegistration, WalletMeta } from './types';
import { MAX_NAME_LENGTH } from './vaultNames';
import { DEVICE_KINDS as ADOPTED_DEVICES, isDeviceModel, modelInfo } from './deviceKinds';

export const TALIA_VAULT_EXPORT_TYPE = 'talia-vault' as const;
export const TALIA_VAULT_EXPORT_VERSION = 1;

/** The Ledger shows at most 16 characters of a policy name. */
const LEDGER_NAME_MAX = 16;
/**
 * A KEY's name, as this payload may carry it. Nothing in the app caps one
 * (no naming field does), so this only bounds what an untrusted payload can
 * make us store. MAX_NAME_LENGTH is the VAULT name's limit, and using it
 * here cut "Ledger (PPH: test1)" down to "Ledger (PPH: t" on the way out AND
 * again on the way in (decided 2026-09-23, a vault exported from one phone to
 * another).
 */
const KEY_LABEL_MAX = 48;
const FP_RE = /^[0-9a-f]{8}$/;
const HMAC_RE = /^[0-9a-f]{64}$/i;
/** Every adopted device, read off the one registry: a brand added there
 *  travels between phones with no change here. */
const DEVICE_KINDS: ReadonlySet<string> = new Set(ADOPTED_DEVICES.map((d) => d.kind));

export interface TaliaVaultExport {
  type: typeof TALIA_VAULT_EXPORT_TYPE;
  version: number;
  /** The vault's name on the phone it came from ('' when it had none). */
  name: string;
  descriptor: string;
  changeDescriptor?: string;
  /** What each key is called, by lowercase fingerprint. */
  keyLabels?: Record<string, string>;
  /** Which device holds each key, by lowercase fingerprint. */
  keyDevices?: Record<string, KeyDevice>;
  /** The Ledger registrations, verbatim: the device demands the exact triple. */
  ledgerRegistrations?: Record<string, LedgerRegistration>;
  /** That a BitBox registration happened, and the name it stored when Talia
   *  registered it; the Nova keeps the policy itself. */
  bitboxRegistrations?: Record<string, BitboxRegistration>;
  /** The vault's devices already know it, by ceremony or by the owner's word. */
  registered?: boolean;
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v != null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The vault's own key fingerprints, lowercase: what every map is cut to. */
export function descriptorFingerprints(descriptorText: string): Set<string> {
  const out = new Set<string>();
  for (const line of descriptorText.split('\n')) {
    const body = line.trim();
    if (!body) continue;
    try {
      for (const k of parseKeyOrigins(stripChecksum(body).body)) {
        if (k.fingerprint) out.add(k.fingerprint.toLowerCase());
      }
    } catch {
      // A line that is not a descriptor contributes no keys.
    }
  }
  return out;
}

/** The xpub of a `[fp/path]xpub/...` key string. */
function keyXpub(key: string): string {
  let s = key.trim();
  const close = s.indexOf(']');
  if (s.startsWith('[') && close > 0) s = s.slice(close + 1);
  const slash = s.indexOf('/');
  if (slash > 0) s = s.slice(0, slash);
  return s.trim();
}

function cleanName(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function cleanLabels(v: unknown, fps: ReadonlySet<string>): Record<string, string> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v)) {
    const fp = k.toLowerCase();
    const name = cleanName(raw, KEY_LABEL_MAX);
    if (FP_RE.test(fp) && fps.has(fp) && name) out[fp] = name;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanDevices(v: unknown, fps: ReadonlySet<string>): Record<string, KeyDevice> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, KeyDevice> = {};
  for (const [k, raw] of Object.entries(v)) {
    const fp = k.toLowerCase();
    if (!FP_RE.test(fp) || !fps.has(fp) || !isRecord(raw)) continue;
    if (typeof raw.kind !== 'string' || !DEVICE_KINDS.has(raw.kind)) continue;
    const device: KeyDevice = { kind: raw.kind as KeyDevice['kind'] };
    // Only a model the registry lists, and one of that brand: every drawing
    // and every "Which device?" step reads it as such.
    if (isDeviceModel(raw.model) && modelInfo(raw.model).kind === device.kind) device.model = raw.model;
    out[fp] = device;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanLedger(
  v: unknown,
  fps: ReadonlySet<string>,
  descriptorText: string,
): Record<string, LedgerRegistration> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, LedgerRegistration> = {};
  for (const [k, raw] of Object.entries(v)) {
    const fp = k.toLowerCase();
    if (!FP_RE.test(fp) || !fps.has(fp) || !isRecord(raw)) continue;
    // The triple travels VERBATIM: the device checks its HMAC against the
    // exact name, template and keys, so nothing here is trimmed or cut.
    const { name, descriptorTemplate, keys, hmacHex, appVersion, registeredAt } = raw;
    if (typeof name !== 'string' || name.length === 0 || name.length > LEDGER_NAME_MAX) continue;
    if (typeof descriptorTemplate !== 'string' || descriptorTemplate.length === 0) continue;
    if (!Array.isArray(keys) || keys.length === 0 || !keys.every((x) => typeof x === 'string')) continue;
    // A registration for some other vault is worth nothing here.
    if (!(keys as string[]).every((x) => descriptorText.includes(keyXpub(x)))) continue;
    if (typeof hmacHex !== 'string' || !HMAC_RE.test(hmacHex)) continue;
    if (typeof appVersion !== 'string' || appVersion.length > 32) continue;
    if (!isFiniteNumber(registeredAt)) continue;
    out[fp] = { name, descriptorTemplate, keys: keys as string[], hmacHex, appVersion, registeredAt };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanBitbox(
  v: unknown,
  fps: ReadonlySet<string>,
): Record<string, BitboxRegistration> | undefined {
  if (!isRecord(v)) return undefined;
  const out: Record<string, BitboxRegistration> = {};
  for (const [k, raw] of Object.entries(v)) {
    const fp = k.toLowerCase();
    if (!FP_RE.test(fp) || !fps.has(fp) || !isRecord(raw) || !isFiniteNumber(raw.registeredAt)) continue;
    out[fp] = { registeredAt: raw.registeredAt };
    // The name the device stored: the same translator names a BitBox policy
    // as a Ledger one, so the same limit. A bad name is dropped, never the
    // record (signing then shows no vault name).
    const { name } = raw;
    if (typeof name === 'string' && name.length > 0 && name.length <= LEDGER_NAME_MAX) out[fp].name = name;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The descriptor text an importer reads: receive and change on two lines. */
export function taliaExportDescriptorText(x: Pick<TaliaVaultExport, 'descriptor' | 'changeDescriptor'>): string {
  return x.changeDescriptor ? `${x.descriptor}\n${x.changeDescriptor}` : x.descriptor;
}

/** Everything one Talia hands another about this vault. */
export function taliaVaultExportOf(wallet: WalletMeta): TaliaVaultExport {
  const text = taliaExportDescriptorText(wallet);
  const fps = descriptorFingerprints(text);
  const x: TaliaVaultExport = {
    type: TALIA_VAULT_EXPORT_TYPE,
    version: TALIA_VAULT_EXPORT_VERSION,
    name: cleanName(wallet.label, MAX_NAME_LENGTH) ?? '',
    descriptor: wallet.descriptor,
  };
  if (wallet.changeDescriptor) x.changeDescriptor = wallet.changeDescriptor;
  const keyLabels = cleanLabels(wallet.keyLabels, fps);
  if (keyLabels) x.keyLabels = keyLabels;
  const keyDevices = cleanDevices(wallet.keyDevices, fps);
  if (keyDevices) x.keyDevices = keyDevices;
  const ledger = cleanLedger(wallet.ledgerRegistrations, fps, text);
  if (ledger) x.ledgerRegistrations = ledger;
  const bitbox = cleanBitbox(wallet.bitboxRegistrations, fps);
  if (bitbox) x.bitboxRegistrations = bitbox;
  if (wallet.vaultRegisteredAt != null || wallet.registrationAttestedAt != null) x.registered = true;
  return x;
}

/** Compact JSON: it rides in a QR code. */
export function serializeTaliaVaultExport(x: TaliaVaultExport): string {
  return JSON.stringify(x);
}

/**
 * Read a Talia vault export. Null when the text is not one (a descriptor, a
 * key, another app's file), so the importer tries its other readers. Throws a
 * readable message when it IS one but cannot be used.
 */
export function parseTaliaVaultExport(text: string): TaliaVaultExport | null {
  const t = text.trim();
  if (!t.startsWith('{')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.type !== TALIA_VAULT_EXPORT_TYPE) return null;
  if (!isFiniteNumber(raw.version) || raw.version > TALIA_VAULT_EXPORT_VERSION) {
    throw new Error('This vault was exported by a newer Talia. Update Talia on this phone, then scan it again.');
  }
  if (typeof raw.descriptor !== 'string' || raw.descriptor.trim().length === 0) {
    throw new Error('This Talia export has no vault in it. Export it again from the other phone.');
  }
  const x: TaliaVaultExport = {
    type: TALIA_VAULT_EXPORT_TYPE,
    version: raw.version,
    name: cleanName(raw.name, MAX_NAME_LENGTH) ?? '',
    descriptor: raw.descriptor.trim(),
  };
  if (typeof raw.changeDescriptor === 'string' && raw.changeDescriptor.trim()) {
    x.changeDescriptor = raw.changeDescriptor.trim();
  }
  const text2 = taliaExportDescriptorText(x);
  const fps = descriptorFingerprints(text2);
  const keyLabels = cleanLabels(raw.keyLabels, fps);
  if (keyLabels) x.keyLabels = keyLabels;
  const keyDevices = cleanDevices(raw.keyDevices, fps);
  if (keyDevices) x.keyDevices = keyDevices;
  const ledger = cleanLedger(raw.ledgerRegistrations, fps, text2);
  if (ledger) x.ledgerRegistrations = ledger;
  const bitbox = cleanBitbox(raw.bitboxRegistrations, fps);
  if (bitbox) x.bitboxRegistrations = bitbox;
  if (raw.registered === true) x.registered = true;
  return x;
}

/**
 * What an import writes onto the new vault beyond its name and key names.
 *
 * NOTHING that grants Send (decided 2026-09-18: "no user should be able to even
 * get to any send screen unless we KNOW the hardware"). A claim in a file is
 * never knowledge: this used to copy the other phone's device records and
 * registrations onto the new vault, so a pasted or scanned payload could
 * assert "Talia talked to the device" for hardware this phone has never
 * seen. The other phone's word survives only as `registrationAttestedAt`,
 * which hides the registration reminder and opens nothing. The second phone
 * connects the hardware once, like any other import.
 */
export function importedVaultPatch(
  x: TaliaVaultExport,
  now: number,
): Pick<WalletMeta, 'registrationAttestedAt'> {
  return { ...(x.registered ? { registrationAttestedAt: now } : {}) };
}
