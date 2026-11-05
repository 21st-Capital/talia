/**
 * The app PIN (decided 2026-09-26): a slow salted
 * verifier from the system's random source, a count of wrong tries with
 * growing waits, and the old SHA-256 form read only to upgrade it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PIN_FREE_TRIES,
  PIN_KDF_ITERATIONS,
  PIN_PASSCODE_AFTER,
  afterWrongTry,
  hasAppPin,
  isValidPin,
  legacyPinHash,
  legacyPinMatches,
  makePinRecord,
  parsePinRecord,
  passcodeRequired,
  pinDelayMs,
  pinMatchesRecord,
  waitLeftMs,
  waitMessage,
} from '../pin';

describe('the PIN record', () => {
  const record = makePinRecord('482915', 50); // few iterations: tests stay fast

  it('matches the right PIN only', () => {
    expect(pinMatchesRecord(record, '482915')).toBe(true);
    expect(pinMatchesRecord(record, '482916')).toBe(false);
    expect(pinMatchesRecord(record, '48291')).toBe(false);
  });

  it('knows its length, so the pad checks once', () => {
    expect(record.length).toBe(6);
  });

  it('uses a fresh 16-byte random salt each time', () => {
    const a = makePinRecord('1234', 10);
    const b = makePinRecord('1234', 10);
    expect(a.saltB64).not.toBe(b.saltB64);
    expect(a.hashB64).not.toBe(b.hashB64);
    expect(Buffer.from(a.saltB64, 'base64')).toHaveLength(16);
  });

  it('is a real KDF by default, and the count travels with the record', () => {
    expect(PIN_KDF_ITERATIONS).toBeGreaterThanOrEqual(2000);
    expect(makePinRecord('1234').iterations).toBe(PIN_KDF_ITERATIONS);
  });

  it('parses back and refuses anything malformed', () => {
    expect(parsePinRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(parsePinRecord({ ...record, v: 1 })).toBeNull();
    expect(parsePinRecord({ ...record, length: 3 })).toBeNull();
    expect(parsePinRecord(null)).toBeNull();
  });

  it('refuses to make a record for an invalid PIN', () => {
    expect(() => makePinRecord('12a4')).toThrow();
  });

  it('salts from the system random source, never Math.random', () => {
    const src = readFileSync(join(__dirname, '..', 'pin.ts'), 'utf8');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).toMatch(/getRandomValues/);
  });
});

describe('the old SHA-256 form (read once, to upgrade)', () => {
  it('still recognises a PIN set before the upgrade', () => {
    const salt = 'abcd1234abcd1234';
    const hash = legacyPinHash('123456', salt);
    expect(hash).toHaveLength(64);
    expect(legacyPinMatches('123456', salt, hash)).toBe(true);
    expect(legacyPinMatches('654321', salt, hash)).toBe(false);
  });
});

describe('tries', () => {
  it('lets the first few wrong tries through at once, then makes you wait longer each time', () => {
    for (let f = 0; f <= PIN_FREE_TRIES; f++) expect(pinDelayMs(f)).toBe(0);
    const waits = [5, 6, 7, 8, 9].map(pinDelayMs);
    expect(waits[0]).toBeGreaterThan(0);
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual(waits[i - 1]);
  });

  it('counts a wrong try and sets the wait from now', () => {
    let t = { failures: 0, lockedUntil: 0 };
    for (let i = 0; i < PIN_FREE_TRIES + 1; i++) t = afterWrongTry(t, 1000);
    expect(t.failures).toBe(PIN_FREE_TRIES + 1);
    expect(waitLeftMs(t, 1000)).toBe(pinDelayMs(PIN_FREE_TRIES + 1));
    expect(waitLeftMs(t, 1000 + pinDelayMs(PIN_FREE_TRIES + 1))).toBe(0);
  });

  it('after enough wrong tries only the phone passcode opens the app', () => {
    expect(passcodeRequired({ failures: PIN_PASSCODE_AFTER - 1, lockedUntil: 0 })).toBe(false);
    expect(passcodeRequired({ failures: PIN_PASSCODE_AFTER, lockedUntil: 0 })).toBe(true);
  });

  it('says how long in plain words, no dashes', () => {
    expect(waitMessage(30_000)).toBe('Too many tries. Try again in 30 seconds.');
    expect(waitMessage(5 * 60_000)).toBe('Too many tries. Try again in 5 minutes.');
    expect(waitMessage(1000)).toBe('Too many tries. Try again in 1 second.');
    expect(waitMessage(90_000)).not.toMatch(/[–—]/);
  });
});

describe('hasAppPin', () => {
  it('reads the new flag and the old pair alike', () => {
    expect(hasAppPin({ pinSet: true })).toBe(true);
    expect(hasAppPin({ pinHash: 'h', pinSalt: 's' })).toBe(true);
    expect(hasAppPin({})).toBe(false);
    expect(hasAppPin({ pinSet: false })).toBe(false);
  });
});

describe('isValidPin', () => {
  it('validates 4-8 digit PINs only', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('12ab')).toBe(false);
  });
});
