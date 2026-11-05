/**
 * App PIN, the pure half (tested). The Keychain half is services/appPin.ts.
 *
 * The PIN guards the app on the phone (what is on screen, and the live 21st
 * Capital session inside it), never funds: the hardware signs. Until
 * 2026-09-26 it was ONE SHA-256 over a salt
 * from a non-cryptographic generator, stored in AsyncStorage beside the settings, with no
 * limit on tries: a 4 to 8 digit PIN fell to anyone who read the settings
 * file, instantly, and to anyone holding the phone, by patience.
 *
 * Now:
 *   - the verifier is PBKDF2-SHA256 over a 16-byte salt from the system's
 *     random source, and it lives in the Keychain (this device only), not
 *     in AsyncStorage;
 *   - wrong tries are counted in the Keychain and slow down (`pinDelayMs`),
 *     and after PIN_PASSCODE_AFTER wrong tries only the phone's own passcode
 *     opens the app. It never locks anyone out for good: the phone passcode
 *     is always the way through;
 *   - an old SHA-256 PIN still opens the app once, and that unlock rewrites
 *     it in the new form (`legacyPinMatches`).
 *
 * Iterations: noble's PBKDF2 runs about 210 times slower on Hermes than on
 * Node (scrypt 2^15 measured 11.3s on a phone against 54ms on Node), so
 * PIN_KDF_ITERATIONS is set for roughly a third of a second on a phone. The
 * count is stored in each record, so it can be raised later without breaking
 * a PIN already set. The Keychain custody is the main protection; the KDF is
 * the second wall if a Keychain item were ever copied off the phone.
 */
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';

declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

export const PIN_KDF_ITERATIONS = 2500;
const SALT_BYTES = 16;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Equal-time comparison of two byte strings. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** 4–8 digits. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

// ─── the record (v2) ─────────────────────────────────────────────────────────

export interface PinRecord {
  v: 2;
  alg: 'pbkdf2-sha256';
  iterations: number;
  saltB64: string;
  hashB64: string;
  /** How many digits the PIN has, so the pad checks once, at the last
   *  digit, instead of at every length (each check is a counted try). */
  length: number;
}

function derive(pin: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, utf8ToBytes(pin), salt, { c: iterations, dkLen: 32 });
}

export function makePinRecord(pin: string, iterations: number = PIN_KDF_ITERATIONS): PinRecord {
  if (!isValidPin(pin)) throw new Error('PIN must be 4 to 8 digits.');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return {
    v: 2,
    alg: 'pbkdf2-sha256',
    iterations,
    saltB64: base64.encode(salt),
    hashB64: base64.encode(derive(pin, salt, iterations)),
    length: pin.length,
  };
}

export function pinMatchesRecord(record: PinRecord, pin: string): boolean {
  if (pin.length !== record.length) return false;
  const expected = base64.decode(record.hashB64);
  return sameBytes(derive(pin, base64.decode(record.saltB64), record.iterations), expected);
}

export function parsePinRecord(value: unknown): PinRecord | null {
  const r = value as Partial<PinRecord> | null;
  if (!r || r.v !== 2 || r.alg !== 'pbkdf2-sha256') return null;
  if (typeof r.iterations !== 'number' || r.iterations < 1) return null;
  if (typeof r.saltB64 !== 'string' || typeof r.hashB64 !== 'string') return null;
  if (typeof r.length !== 'number' || r.length < 4 || r.length > 8) return null;
  return r as PinRecord;
}

// ─── the old form (read only) ────────────────────────────────────────────────

/** The pre-2026-09-26 verifier: sha256(salt ":" pin), hex. Kept ONLY to let
 *  an existing PIN open the app once and be rewritten. */
export function legacyPinHash(pin: string, salt: string): string {
  return toHex(sha256(utf8ToBytes(`${salt}:${pin}`)));
}

export function legacyPinMatches(pin: string, salt: string, expectedHash: string): boolean {
  return sameBytes(utf8ToBytes(legacyPinHash(pin, salt)), utf8ToBytes(expectedHash));
}

// ─── tries ───────────────────────────────────────────────────────────────────

/** Wrong tries before the pad starts making the person wait. */
export const PIN_FREE_TRIES = 4;
/** Wrong tries after which only the phone passcode opens the app. */
export const PIN_PASSCODE_AFTER = 10;

/** How long to wait after `failures` wrong tries in a row. */
export function pinDelayMs(failures: number): number {
  if (failures <= PIN_FREE_TRIES) return 0;
  const steps = [30_000, 60_000, 5 * 60_000, 15 * 60_000];
  return steps[failures - PIN_FREE_TRIES - 1] ?? 60 * 60_000;
}

export interface PinTries {
  failures: number;
  /** Unix ms before which no try is taken. */
  lockedUntil: number;
}

/** The state after one more wrong try at `now`. */
export function afterWrongTry(tries: PinTries, now: number): PinTries {
  const failures = tries.failures + 1;
  return { failures, lockedUntil: now + pinDelayMs(failures) };
}

export function passcodeRequired(tries: PinTries): boolean {
  return tries.failures >= PIN_PASSCODE_AFTER;
}

/** Milliseconds left before another try, 0 when one may be taken now. */
export function waitLeftMs(tries: PinTries, now: number): number {
  return Math.max(0, tries.lockedUntil - now);
}

/** "Try again in 30 seconds" / "in 5 minutes". Plain words, no dashes. */
export function waitMessage(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `Too many tries. Try again in ${s} second${s === 1 ? '' : 's'}.`;
  const m = Math.ceil(s / 60);
  return `Too many tries. Try again in ${m} minute${m === 1 ? '' : 's'}.`;
}

/** A PIN is set when the settings say so, in the new form or the old one. */
export function hasAppPin(settings: { pinSet?: boolean; pinHash?: string; pinSalt?: string }): boolean {
  return settings.pinSet === true || (!!settings.pinHash && !!settings.pinSalt);
}
