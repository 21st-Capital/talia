/**
 * The PIN's Keychain half (decided 2026-09-26): one this-device-only item holding
 * the verifier and the count of wrong tries; an old PIN upgraded on its
 * first right use; never a lock-out.
 */
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));

import {
  __forgetLegacyEntryForTests,
  adoptLegacyPin,
  checkPin,
  clearAppPin,
  pinStatus,
  relaxPasscodeRequirement,
  resetPinTries,
  setAppPin,
} from '../appPin';
import { PIN_FREE_TRIES, PIN_PASSCODE_AFTER, legacyPinHash } from '../../wallet/pin';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mem = require('../../testing/memoryKeychain') as typeof import('../../testing/memoryKeychain');

beforeEach(() => {
  mem.__reset();
  __forgetLegacyEntryForTests();
});

describe('a PIN in the new form', () => {
  it('lives in the Keychain, this device only, never as the PIN itself', async () => {
    await setAppPin('482915');
    const item = mem.__items().get('talia.appPin.v2');
    expect(item?.options.accessible).toBe('AccessibleWhenUnlockedThisDeviceOnly');
    expect(item?.password).not.toMatch(/482915/);
    expect((await pinStatus()).length).toBe(6);
  });

  it('opens with the right PIN and not before its last digit', async () => {
    await setAppPin('482915');
    expect((await checkPin('48291', { final: false })).kind).toBe('incomplete');
    expect(await checkPin('482915', { final: true })).toEqual({ kind: 'ok', upgraded: false });
  });

  it('counts wrong tries, then makes the person wait, and refuses to look meanwhile', async () => {
    await setAppPin('4829');
    const t0 = 1_000_000;
    for (let i = 0; i < PIN_FREE_TRIES; i++) {
      const r = await checkPin('0000', { final: true }, t0);
      expect(r.kind).toBe('wrong');
    }
    const fifth = await checkPin('0000', { final: true }, t0);
    expect(fifth.kind).toBe('wrong');
    if (fifth.kind === 'wrong') expect(fifth.status.waitMs).toBeGreaterThan(0);
    // Even the RIGHT PIN is not looked at while waiting.
    expect((await checkPin('4829', { final: true }, t0 + 1000)).kind).toBe('blocked');
    // After the wait it opens, and the count starts afresh.
    expect((await checkPin('4829', { final: true }, t0 + 60 * 60_000)).kind).toBe('ok');
    expect((await pinStatus(t0 + 60 * 60_000)).waitMs).toBe(0);
  });

  it('after too many wrong tries asks for the phone passcode, and the passcode resets it', async () => {
    await setAppPin('4829');
    let now = 1_000_000;
    for (let i = 0; i < PIN_PASSCODE_AFTER; i++) {
      await checkPin('0000', { final: true }, now);
      now += 2 * 60 * 60_000; // past every wait
    }
    expect((await pinStatus(now)).passcodeRequired).toBe(true);
    expect((await checkPin('4829', { final: true }, now)).kind).toBe('blocked');
    await resetPinTries();
    expect((await checkPin('4829', { final: true }, now)).kind).toBe('ok');
  });

  it('a phone with no passcode is never locked out: one try at a time after a long wait', async () => {
    await setAppPin('4829');
    let now = 1_000_000;
    for (let i = 0; i < PIN_PASSCODE_AFTER; i++) {
      await checkPin('0000', { final: true }, now);
      now += 2 * 60 * 60_000;
    }
    await relaxPasscodeRequirement(now);
    const st = await pinStatus(now);
    expect(st.passcodeRequired).toBe(false);
    expect(st.waitMs).toBeGreaterThan(0);
    expect((await checkPin('4829', { final: true }, now + st.waitMs)).kind).toBe('ok');
  });

  it('is gone when removed', async () => {
    await setAppPin('4829');
    await clearAppPin();
    expect((await pinStatus()).hasRecord).toBe(false);
  });
});

describe('a PIN set before the upgrade', () => {
  const salt = 'abcd1234abcd1234';
  const legacy = { salt, hash: legacyPinHash('123456', salt) };

  it('opens once in the old form and is rewritten in the new', async () => {
    expect((await checkPin('1234', { legacy, final: false })).kind).toBe('incomplete');
    expect(await checkPin('123456', { legacy, final: false })).toEqual({ kind: 'ok', upgraded: true });
    const st = await pinStatus();
    expect(st.hasRecord).toBe(true);
    expect(st.length).toBe(6);
    // From now on the new form answers, whatever the settings still hold.
    expect((await checkPin('123456', { final: true })).kind).toBe('ok');
  });

  it('a complete wrong old-form entry answers wrong', async () => {
    expect((await checkPin('1111', { legacy, final: false })).kind).toBe('incomplete');
    expect((await checkPin('11111111', { legacy, final: true })).kind).toBe('wrong');
  });

  it('typing a longer PIN digit by digit is ONE try', async () => {
    const t0 = 1_000_000;
    expect((await checkPin('1234', { legacy, final: false }, t0)).kind).toBe('incomplete');
    expect((await checkPin('12345', { legacy, final: false }, t0)).kind).toBe('incomplete');
    expect(await checkPin('123456', { legacy, final: false }, t0)).toEqual({ kind: 'ok', upgraded: true });
    expect((await pinStatus(t0)).waitMs).toBe(0);
  });

  it('deleting a digit and typing another is a new, counted try (decided 2026-09-30)', async () => {
    // The attack: 4 digits, delete one, try again, forever, with nothing counted.
    const t0 = 1_000_000;
    let blockedAt = -1;
    for (let guess = 0; guess < 50; guess++) {
      const pin = String(1000 + guess);
      const r = await checkPin(pin, { legacy, final: false }, t0);
      if (r.kind === 'blocked') {
        blockedAt = guess;
        break;
      }
    }
    // Four free tries, then the fifth makes the person wait.
    expect(blockedAt).toBe(PIN_FREE_TRIES + 1);
    expect((await pinStatus(t0)).waitMs).toBeGreaterThan(0);
  });

  it('a restarted app forgets the entry, so the next check counts again', async () => {
    const t0 = 1_000_000;
    await checkPin('9999', { legacy, final: false }, t0);
    __forgetLegacyEntryForTests(); // the app was killed
    await checkPin('99999', { legacy, final: false }, t0);
    const st = await pinStatus(t0);
    expect(st.hasVerifier).toBe(true);
    // Two tries counted: 99999 was not "one more digit" of a live entry.
    for (let i = 2; i < PIN_FREE_TRIES; i++) await checkPin(String(5000 + i), { legacy, final: false }, t0);
    const r = await checkPin('5999', { legacy, final: false }, t0);
    expect(r.kind).toBe('incomplete'); // the 5th try is taken...
    expect((await pinStatus(t0)).waitMs).toBeGreaterThan(0); // ...and now there is a wait
  });

  it('moves out of the settings into the Keychain at launch, without the PIN being typed', async () => {
    expect(await adoptLegacyPin(legacy)).toBe(true);
    const item = mem.__items().get('talia.appPin.v2');
    expect(item?.options.accessible).toBe('AccessibleWhenUnlockedThisDeviceOnly');
    const st = await pinStatus();
    expect(st.hasVerifier).toBe(true);
    expect(st.hasRecord).toBe(false);
    // With the settings copy gone, the PIN still opens and is then rewritten.
    expect(await checkPin('123456', { final: true })).toEqual({ kind: 'ok', upgraded: true });
    expect((await pinStatus()).hasRecord).toBe(true);
    expect(JSON.parse(mem.__items().get('talia.appPin.v2')!.password).legacy).toBeNull();
  });

  it('adopting never overwrites a PIN already in the new form', async () => {
    await setAppPin('4829');
    expect(await adoptLegacyPin(legacy)).toBe(true);
    expect((await checkPin('4829', { final: true })).kind).toBe('ok');
  });

  it('adopting reports failure when the Keychain cannot answer, so the settings copy is kept', async () => {
    mem.__failNextRead();
    expect(await adoptLegacyPin(legacy)).toBe(false);
  });
});

describe('never a lock-out', () => {
  it('a PIN set but with no verifier on this phone asks for the phone passcode', async () => {
    const r = await checkPin('1234', { final: true });
    expect(r.kind).toBe('blocked');
    if (r.kind === 'blocked') expect(r.status.passcodeRequired).toBe(true);
  });

  it('a Keychain that cannot answer asks for the phone passcode instead of failing', async () => {
    await setAppPin('4829');
    mem.__failNextRead();
    const r = await checkPin('4829', { final: true });
    expect(r.kind).toBe('blocked');
  });
});
