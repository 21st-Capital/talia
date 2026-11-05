/**
 * Encrypted-at-rest values in AsyncStorage (decided 2026-09-26).
 *
 * AsyncStorage is a plain file under the default iOS protection class, so a
 * forensic copy of a phone unlocked once since boot reads it in the clear.
 * The records that make a client a target live there: every vault's
 * descriptor (all its keys, so every address, the balance and the history),
 * the heirs' names and emails, and half-signed payments. Those records now go
 * through this module, which seals each value with XChaCha20-Poly1305 under a
 * random 32-byte key kept in the Keychain, THIS DEVICE ONLY. The file alone,
 * or a backup, no longer says anything.
 *
 * The key is readable ONLY while the phone is unlocked ('foreground'): the
 * attack this answers is a forensic copy of a phone that is locked but was
 * unlocked once since boot, and an after-first-unlock key would be in that
 * copy too. Talia has no background modes, and the key is read once per
 * launch and then kept in memory, so the only cost is a launch while the
 * phone is locked (iOS prewarming): the first read then fails, and
 * WalletProvider waits and asks again rather than show an empty list. Every
 * rule below is about never losing the vault list:
 *
 *   - A key is minted ONLY when the Keychain answers "no such item" AND no
 *     sealed value (not even one set aside) is on disk. A Keychain that
 *     cannot answer throws; a key that is missing while sealed values exist
 *     throws SealedStoreError('key-missing'). Minting then would orphan every
 *     sealed value for good. The Keychain access group follows the Apple
 *     team and the bundle id, so a team move looks exactly like that. The
 *     owner then sees why and chooses (AuthGate's store problem screen): try
 *     again, or `startOverSealedStore`. A phone restored from a backup gets
 *     neither the key (this-device-only) nor the files (AsyncStorage keeps
 *     its folder out of every backup), so it starts empty, as it always did;
 *     a vault's backup file is the way back.
 *   - A CHECK value sealed with the key tells "this key sealed the data"
 *     apart from "another key did". A key that does not open the check first
 *     brings back what it sealed earlier (values set aside by a start over:
 *     that is how a key that comes BACK recovers its data), and otherwise
 *     throws SealedStoreError('unreadable'): nothing is moved, nothing is
 *     shown as empty.
 *   - Under a key that opens the check, a value that will not open is
 *     damaged: it is MOVED aside to `<name>.unreadable` (then
 *     `.unreadable.2` and so on, never over an earlier copy) and reads as
 *     absent. On every launch, a copy the current key opens is put back when
 *     its name is empty.
 *   - One key load at a time, so two first-time callers cannot mint two keys.
 *   - Old plaintext values still read, and are sealed in place the first
 *     time they are read. The rewrite happens inside the same per-name queue
 *     as every write, so a newer write can never be undone by the migration.
 *   - Each value is bound to its storage name (associated data), so a sealed
 *     value copied under another name does not open.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { base64 } from '@scure/base';

import { utf8ToBytes, bytesToUtf8 } from '../bitcoin/bbqr/bbqr';
import { getSecretStrict, setSecret } from '../services/keychain';

declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

export const SEALED_PREFIX = 'talia-sealed:v1:';
const KEY_SERVICE = 'talia.store.key.v1';
const NONCE_LEN = 24;
export const UNREADABLE_SUFFIX = '.unreadable';
/** A value sealed with the key, to tell whether a key sealed the data. */
export const CHECK_NAME = 'talia.sealed.check.v1';
const CHECK_TEXT = 'talia-store-key-check';

// ─── the envelope (pure) ─────────────────────────────────────────────────────

/** Seal `value` under `key`, bound to the storage `name`. */
export function sealValue(key: Uint8Array, name: string, value: string): string {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const ct = xchacha20poly1305(key, nonce, utf8ToBytes(name)).encrypt(utf8ToBytes(value));
  const out = new Uint8Array(NONCE_LEN + ct.length);
  out.set(nonce, 0);
  out.set(ct, NONCE_LEN);
  return SEALED_PREFIX + base64.encode(out);
}

/** Open what `sealValue` made; throws on a wrong key, a wrong name or damage. */
export function openValue(key: Uint8Array, name: string, sealed: string): string {
  if (!sealed.startsWith(SEALED_PREFIX)) throw new Error('Not a sealed value.');
  const bytes = base64.decode(sealed.slice(SEALED_PREFIX.length));
  if (bytes.length < NONCE_LEN + 16) throw new Error('Sealed value too short.');
  const nonce = bytes.slice(0, NONCE_LEN);
  const ct = bytes.slice(NONCE_LEN);
  return bytesToUtf8(xchacha20poly1305(key, nonce, utf8ToBytes(name)).decrypt(ct));
}

export function isSealed(raw: string): boolean {
  return raw.startsWith(SEALED_PREFIX);
}

// ─── errors ──────────────────────────────────────────────────────────────────

/**
 * The sealed values cannot be opened on this phone, for a reason waiting
 * will not fix:
 *   'key-missing'  sealed values exist, but the Keychain has no key for them;
 *   'damaged-key'  the Keychain item is not a key;
 *   'unreadable'   the key there did not seal them.
 * A Keychain that cannot answer right now throws a plain Error instead.
 */
export type SealedStoreProblem = 'key-missing' | 'damaged-key' | 'unreadable';

export class SealedStoreError extends Error {
  readonly problem: SealedStoreProblem;
  constructor(problem: SealedStoreProblem) {
    super(
      problem === 'key-missing'
        ? 'The key for the saved data is not on this phone.'
        : problem === 'damaged-key'
          ? 'The storage key on this phone is damaged.'
          : 'The storage key on this phone did not seal the saved data.',
    );
    this.name = 'SealedStoreError';
    this.problem = problem;
  }
}

export function isSealedStoreError(e: unknown): e is SealedStoreError {
  return e instanceof SealedStoreError;
}

// ─── the disk ────────────────────────────────────────────────────────────────

/** The name a set-aside copy belongs to, or null for an ordinary name. */
export function setAsideBaseName(name: string): string | null {
  const m = /^(.*)\.unreadable(?:\.\d+)?$/.exec(name);
  return m ? m[1] : null;
}

async function allNames(): Promise<string[]> {
  return [...(await AsyncStorage.getAllKeys())];
}

/** Move `raw` (the value under `name`) to the first free copy name, then
 *  clear `name`. Never writes over an earlier copy. */
async function moveAside(name: string, raw: string, taken?: Set<string>): Promise<void> {
  const names = taken ?? new Set(await allNames());
  let target = name + UNREADABLE_SUFFIX;
  for (let n = 2; names.has(target); n += 1) target = `${name}${UNREADABLE_SUFFIX}.${n}`;
  await AsyncStorage.setItem(target, raw);
  names.add(target);
  await AsyncStorage.removeItem(name);
}

function opens(key: Uint8Array, name: string, raw: string): boolean {
  try {
    openValue(key, name, raw);
    return true;
  } catch {
    return false;
  }
}

/** Every sealed value on disk as [name, value], set-aside copies included. */
async function sealedEntries(): Promise<[string, string][]> {
  const names = await allNames();
  if (names.length === 0) return [];
  const pairs = await AsyncStorage.multiGet(names);
  return pairs.filter((p): p is [string, string] => p[1] != null && isSealed(p[1]));
}

/**
 * Put back every set-aside copy this key opens, into a name that is empty or
 * holds a value this key cannot open (that one is set aside in turn, never
 * lost). Returns true when the check came back with it.
 */
async function bringBack(key: Uint8Array): Promise<boolean> {
  const names = await allNames();
  const taken = new Set(names);
  let checkBack = false;
  for (const copy of names) {
    const base = setAsideBaseName(copy);
    if (base == null) continue;
    const raw = await AsyncStorage.getItem(copy);
    if (raw == null || !isSealed(raw) || !opens(key, base, raw)) continue;
    const current = await AsyncStorage.getItem(base);
    if (current != null && (!isSealed(current) || opens(key, base, current))) continue; // live data wins
    if (current != null) await moveAside(base, current, taken);
    await AsyncStorage.setItem(base, raw);
    await AsyncStorage.removeItem(copy);
    taken.delete(copy);
    if (base === CHECK_NAME) checkBack = true;
  }
  return checkBack;
}

// ─── the key ─────────────────────────────────────────────────────────────────

let keyLoad: Promise<Uint8Array> | null = null;

async function mintKey(): Promise<Uint8Array> {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const encoded = base64.encode(key);
  await setSecret(KEY_SERVICE, 'store-key', encoded, 'foreground');
  // Read it back: a key that did not stick must not seal anything.
  if ((await getSecretStrict(KEY_SERVICE)) !== encoded) {
    throw new Error('The phone did not keep the storage key.');
  }
  return key;
}

function decodeKey(stored: string): Uint8Array | null {
  try {
    const key = base64.decode(stored);
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

async function writeCheck(key: Uint8Array): Promise<void> {
  await AsyncStorage.setItem(CHECK_NAME, sealValue(key, CHECK_NAME, CHECK_TEXT));
}

async function loadKey(): Promise<Uint8Array> {
  const stored = await getSecretStrict(KEY_SERVICE); // throws when the Keychain cannot answer
  if (stored == null) {
    if ((await sealedEntries()).length > 0) throw new SealedStoreError('key-missing');
    const key = await mintKey();
    await writeCheck(key);
    return key;
  }
  const key = decodeKey(stored);
  if (!key) throw new SealedStoreError('damaged-key');
  const check = await AsyncStorage.getItem(CHECK_NAME);
  if (check != null && opens(key, CHECK_NAME, check)) {
    await bringBack(key);
    return key;
  }
  if (check == null) {
    // Sealed before the check existed (or nothing sealed yet): the key is
    // the right one unless live sealed values exist and it opens none.
    const live = (await sealedEntries()).filter(([n]) => setAsideBaseName(n) == null);
    if (live.length === 0 || live.some(([n, v]) => opens(key, n, v))) {
      await writeCheck(key);
      await bringBack(key);
      return key;
    }
  }
  // Another key sealed what is here. If THIS key sealed data that was set
  // aside earlier, it is back: restore that data.
  if (await bringBack(key)) return key;
  throw new SealedStoreError('unreadable');
}

function storeKey(): Promise<Uint8Array> {
  if (!keyLoad) {
    keyLoad = loadKey().catch((e) => {
      keyLoad = null; // a failed load is retried by the next caller
      throw e;
    });
  }
  return keyLoad;
}

/**
 * The owner's way forward when the saved data cannot be opened
 * (SealedStoreError): every sealed value the key on this phone cannot open
 * is set aside (kept, numbered, never deleted), a key is minted when there
 * is none or it is damaged, and the store starts empty. If the old key ever
 * comes back (the Keychain group returns), the next launch puts its data
 * back. Throws, changing nothing, when the Keychain cannot answer.
 */
export async function startOverSealedStore(): Promise<void> {
  keyLoad = null;
  const stored = await getSecretStrict(KEY_SERVICE);
  let key = stored != null ? decodeKey(stored) : null;
  const names = await allNames();
  const taken = new Set(names);
  for (const name of names) {
    if (setAsideBaseName(name) != null) continue;
    const raw = await AsyncStorage.getItem(name);
    if (raw == null || !isSealed(raw)) continue;
    if (key && opens(key, name, raw)) continue;
    await moveAside(name, raw, taken);
  }
  if (!key) key = await mintKey();
  await writeCheck(key);
  keyLoad = Promise.resolve(key);
}

/** Tests only: forget the cached key. */
export function __resetSealedStoreForTests(): void {
  keyLoad = null;
}

// ─── one queue per name ──────────────────────────────────────────────────────

const queues = new Map<string, Promise<unknown>>();

function serial<T>(name: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(name) ?? Promise.resolve();
  const next = prev.then(job, job);
  const settled = next.catch(() => undefined);
  queues.set(name, settled);
  void settled.then(() => {
    if (queues.get(name) === settled) queues.delete(name);
  });
  return next;
}

// ─── the store ───────────────────────────────────────────────────────────────

/**
 * The value stored under `name`, opened; null when there is none (or when a
 * sealed value was damaged and set aside). THROWS when the Keychain cannot
 * answer, or a SealedStoreError when the saved data cannot be opened on this
 * phone: the caller must treat neither as "empty" and write over the real
 * value.
 */
export function sealedGetItem(name: string): Promise<string | null> {
  return serial(name, async () => {
    const key = await storeKey();
    const raw = await AsyncStorage.getItem(name);
    if (raw == null) return null;
    if (!isSealed(raw)) {
      // Written before sealing existed: seal it now, in this same queue, so
      // no write can land between the read and this rewrite.
      await AsyncStorage.setItem(name, sealValue(key, name, raw));
      return raw;
    }
    try {
      return openValue(key, name, raw);
    } catch {
      // The key opens the check, so it is the right key: this one value is
      // damaged. Keep its bytes (numbered, never over an earlier copy).
      await moveAside(name, raw);
      return null;
    }
  });
}

/** Seal and store `value` under `name`. Throws when it cannot be sealed:
 *  nothing is ever written in the clear. */
export function sealedSetItem(name: string, value: string): Promise<void> {
  return serial(name, async () => {
    const key = await storeKey();
    await AsyncStorage.setItem(name, sealValue(key, name, value));
  });
}

export function sealedRemoveItem(name: string): Promise<void> {
  return serial(name, () => AsyncStorage.removeItem(name));
}
