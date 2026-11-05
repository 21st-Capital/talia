/**
 * App PIN, the Keychain half (decided 2026-09-26). The rules are in wallet/pin.ts;
 * this module keeps ONE Keychain item, this device only, holding the PIN
 * verifier and the count of wrong tries, so neither can be read from, or
 * reset by, the app's ordinary files.
 *
 * The screens never compare a PIN themselves: they ask `checkPin`, which
 * refuses to even look while the person has to wait, counts a wrong try, and
 * upgrades an old-form PIN on its first successful use.
 *
 * An OLD-FORM PIN (the SHA-256 pair that used to sit in the plain settings)
 * is handled in two steps, because its length is unknown and the pad checks
 * it as the person types:
 *   - `adoptLegacyPin` moves the pair into this Keychain item at the first
 *     launch, whatever unlocks the app (Face ID users may never type the
 *     PIN), and the caller then drops it from the settings file. The pair
 *     stops being readable from the app's files at once; the PBKDF2 rewrite
 *     still happens on the next right PIN.
 *   - Every check of an old-form PIN is COUNTED before it is compared,
 *     except a check that only adds one digit to the entry checked just
 *     before (the owner still typing a longer PIN: one entry, one try). A
 *     deleted digit, a new entry, a restarted app or a submitted entry all
 *     start a new try, so guessing costs a try per guess, as with a new-form
 *     PIN (decided 2026-09-30: deleting a digit and retyping was free).
 */
import { deleteSecret, getSecretStrict, setSecret } from './keychain';
import {
  afterWrongTry,
  legacyPinMatches,
  makePinRecord,
  parsePinRecord,
  passcodeRequired,
  PIN_PASSCODE_AFTER,
  pinDelayMs,
  pinMatchesRecord,
  waitLeftMs,
} from '../wallet/pin';
import type { PinRecord, PinTries } from '../wallet/pin';

const SERVICE = 'talia.appPin.v2';

/** The pre-2026-09-26 verifier, moved here from the settings file. */
export interface LegacyPin {
  salt: string;
  hash: string;
}

interface Stored extends PinTries {
  record: PinRecord | null;
  legacy?: LegacyPin | null;
}

const EMPTY: Stored = { record: null, failures: 0, lockedUntil: 0 };

function parseLegacy(v: unknown): LegacyPin | null {
  const l = v as Partial<LegacyPin> | null | undefined;
  return l && typeof l.salt === 'string' && typeof l.hash === 'string' && l.salt && l.hash
    ? { salt: l.salt, hash: l.hash }
    : null;
}

/**
 * The old-form entry checked just before, while the owner may still be
 * typing. In memory only: a restart forgets it, so the next check counts.
 */
let legacyEntry: string | null = null;

/** Tests only. */
export function __forgetLegacyEntryForTests(): void {
  legacyEntry = null;
}

async function read(): Promise<Stored> {
  const raw = await getSecretStrict(SERVICE);
  if (!raw) return { ...EMPTY };
  try {
    const doc = JSON.parse(raw) as Partial<Stored>;
    return {
      record: parsePinRecord(doc.record),
      legacy: parseLegacy(doc.legacy),
      failures: typeof doc.failures === 'number' && doc.failures >= 0 ? doc.failures : 0,
      lockedUntil: typeof doc.lockedUntil === 'number' ? doc.lockedUntil : 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

async function write(s: Stored): Promise<void> {
  await setSecret(SERVICE, 'app-pin', JSON.stringify(s));
}

export interface PinStatus {
  /** Digits in the PIN when known (a PIN in the new form). */
  length: number | null;
  /** A new-form verifier exists on this phone. */
  hasRecord: boolean;
  /** Some verifier (new form, or an old one moved here) exists. */
  hasVerifier: boolean;
  waitMs: number;
  /** Too many wrong tries: only the phone passcode opens the app now. */
  passcodeRequired: boolean;
}

export async function pinStatus(now: number = Date.now()): Promise<PinStatus> {
  try {
    const s = await read();
    return statusOf(s, now);
  } catch {
    // The Keychain cannot answer: say nothing is known; checkPin will refuse
    // and the pad offers the phone passcode.
    return { length: null, hasRecord: false, hasVerifier: false, waitMs: 0, passcodeRequired: false };
  }
}

function statusOf(s: Stored, now: number): PinStatus {
  return {
    length: s.record?.length ?? null,
    hasRecord: s.record != null,
    hasVerifier: s.record != null || s.legacy != null,
    waitMs: waitLeftMs(s, now),
    passcodeRequired: passcodeRequired(s),
  };
}

/**
 * Move an old-form verifier out of the settings file into the Keychain.
 * Returns true when the settings copy may be dropped: the pair is stored
 * here (read back), or a new-form PIN already replaced it. Never throws.
 */
export async function adoptLegacyPin(legacy: LegacyPin): Promise<boolean> {
  try {
    const s = await read();
    if (s.record) return true;
    if (s.legacy && s.legacy.salt === legacy.salt && s.legacy.hash === legacy.hash) return true;
    await write({ ...s, legacy: { salt: legacy.salt, hash: legacy.hash } });
    const back = await read();
    return back.legacy?.hash === legacy.hash && back.legacy?.salt === legacy.salt;
  } catch {
    return false;
  }
}

export type PinCheck =
  /** Right. `upgraded`: it was an old-form PIN, now rewritten; the caller
   *  drops any old hash left in the settings. */
  | { kind: 'ok'; upgraded: boolean }
  | { kind: 'wrong'; status: PinStatus }
  /** Not looked at: the person has to wait, or use the phone passcode. */
  | { kind: 'blocked'; status: PinStatus }
  /** Not a whole PIN yet: keep typing. For an old-form PIN the try has
   *  already been counted (see the header). */
  | { kind: 'incomplete' };

/**
 * Check a typed PIN.
 *
 * `legacy` is the old SHA-256 pair when the settings still hold one (before
 * `adoptLegacyPin` ran); the pair in the Keychain wins. `final` says the
 * entry is complete (submitted, or at the pad's last digit): a miss then
 * answers 'wrong' and the next entry is a new try.
 */
export async function checkPin(
  pin: string,
  opts: { legacy?: LegacyPin; final: boolean },
  now: number = Date.now(),
): Promise<PinCheck> {
  let s: Stored;
  try {
    s = await read();
  } catch {
    return {
      kind: 'blocked',
      status: { length: null, hasRecord: false, hasVerifier: false, waitMs: 0, passcodeRequired: true },
    };
  }

  if (s.record) {
    if (passcodeRequired(s) || waitLeftMs(s, now) > 0) return { kind: 'blocked', status: statusOf(s, now) };
    if (pin.length < s.record.length) return { kind: 'incomplete' };
    if (pinMatchesRecord(s.record, pin)) {
      if (s.failures !== 0 || s.lockedUntil !== 0) await write({ ...s, failures: 0, lockedUntil: 0 });
      return { kind: 'ok', upgraded: false };
    }
    const next = { ...s, ...afterWrongTry(s, now) };
    await write(next);
    return { kind: 'wrong', status: statusOf(next, now) };
  }

  const legacy = s.legacy ?? opts.legacy ?? null;
  if (!legacy) {
    // A PIN is set but its verifier is not on this phone: nothing typed can
    // match. The phone passcode is the way in (never a lock-out).
    return { kind: 'blocked', status: { ...statusOf(s, now), passcodeRequired: true } };
  }

  // One more digit on the entry checked just before is the same try.
  const sameTry =
    legacyEntry != null && pin.length === legacyEntry.length + 1 && pin.startsWith(legacyEntry);
  let current = s;
  if (!sameTry) {
    legacyEntry = null;
    if (passcodeRequired(s) || waitLeftMs(s, now) > 0) return { kind: 'blocked', status: statusOf(s, now) };
    // Counted BEFORE the comparison, so no answer is ever free.
    current = { ...s, legacy, ...afterWrongTry(s, now) };
    await write(current);
  }
  if (legacyPinMatches(pin, legacy.salt, legacy.hash)) {
    legacyEntry = null;
    await write({ record: makePinRecord(pin), failures: 0, lockedUntil: 0, legacy: null });
    return { kind: 'ok', upgraded: true };
  }
  if (opts.final || pin.length >= 8) {
    legacyEntry = null;
    return { kind: 'wrong', status: statusOf(current, now) };
  }
  legacyEntry = pin;
  return { kind: 'incomplete' };
}

/** Set (or change) the PIN. Clears the count of wrong tries. */
export async function setAppPin(pin: string): Promise<void> {
  legacyEntry = null;
  await write({ record: makePinRecord(pin), failures: 0, lockedUntil: 0, legacy: null });
}

export async function clearAppPin(): Promise<void> {
  legacyEntry = null;
  await deleteSecret(SERVICE);
}

/**
 * The phone has no passcode, so "use the phone passcode" cannot be offered.
 * The PIN stays the way in: one try at a time, each after the longest wait.
 */
export async function relaxPasscodeRequirement(now: number = Date.now()): Promise<void> {
  try {
    const s = await read();
    if (!passcodeRequired(s)) return;
    await write({ ...s, failures: PIN_PASSCODE_AFTER - 1, lockedUntil: now + pinDelayMs(PIN_PASSCODE_AFTER) });
  } catch {
    // nothing to relax
  }
}

/** The phone passcode opened the app: the PIN starts afresh. */
export async function resetPinTries(): Promise<void> {
  try {
    const s = await read();
    if (s.failures !== 0 || s.lockedUntil !== 0) await write({ ...s, failures: 0, lockedUntil: 0 });
  } catch {
    // the next right PIN resets it too
  }
}
