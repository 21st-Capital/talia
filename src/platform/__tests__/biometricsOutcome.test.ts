import { isLockoutMessage, laErrorCode, laOutcome } from '../biometricsOutcome';

// The exact text react-native-biometrics puts in its rejection: the NSError
// printed with %@ (ReactNativeBiometrics.m, simplePrompt).
const lockout =
  'Error Domain=com.apple.LocalAuthentication Code=-8 "Biometry is locked out." ' +
  'UserInfo={NSLocalizedDescription=Biometry is locked out.}';
const notAvailable =
  'Error Domain=com.apple.LocalAuthentication Code=-6 "Biometry is not available." ' +
  'UserInfo={NSLocalizedDescription=Biometry is not available.}';
const notEnrolled =
  'Error Domain=com.apple.LocalAuthentication Code=-7 "No identities are enrolled." ' +
  'UserInfo={NSLocalizedDescription=No identities are enrolled.}';
const passcodeNotSet =
  'Error Domain=com.apple.LocalAuthentication Code=-5 "Passcode not set." ' +
  'UserInfo={NSLocalizedDescription=Passcode not set.}';
const authFailed =
  'Error Domain=com.apple.LocalAuthentication Code=-1 "Application retry limit exceeded." ' +
  'UserInfo={NSLocalizedDescription=Application retry limit exceeded.}';
const userCancel =
  'Error Domain=com.apple.LocalAuthentication Code=-2 "Canceled by user." ' +
  'UserInfo={NSLocalizedDescription=Canceled by user.}';

describe('laErrorCode', () => {
  it('reads the LAError code out of the printed NSError', () => {
    expect(laErrorCode(lockout)).toBe(-8);
    expect(laErrorCode(notAvailable)).toBe(-6);
    expect(laErrorCode(authFailed)).toBe(-1);
  });

  it('tolerates spacing around the equals sign', () => {
    expect(laErrorCode('Error Domain=x Code = -8 "y"')).toBe(-8);
  });

  it('returns null when there is no code to read', () => {
    expect(laErrorCode('')).toBeNull();
    expect(laErrorCode(undefined)).toBeNull();
    expect(laErrorCode(null)).toBeNull();
    expect(laErrorCode('biometric_error')).toBeNull();
    expect(laErrorCode('Code=abc')).toBeNull();
  });

  it('does not mistake a code inside the description for the error code', () => {
    // Only the first "Code=" is the NSError's own code.
    expect(laErrorCode('Error Domain=d Code=-8 "see Code=-1 in docs"')).toBe(-8);
  });
});

describe('laOutcome', () => {
  it('maps -8 to lockout', () => {
    expect(laOutcome(lockout)).toEqual({ ok: false, reason: 'lockout' });
  });

  it('maps -5, -6 and -7 to unavailable', () => {
    expect(laOutcome(passcodeNotSet)).toEqual({ ok: false, reason: 'unavailable' });
    expect(laOutcome(notAvailable)).toEqual({ ok: false, reason: 'unavailable' });
    expect(laOutcome(notEnrolled)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('maps a user cancel that arrives as a rejection to cancel', () => {
    expect(laOutcome(userCancel)).toEqual({ ok: false, reason: 'cancel' });
  });

  it('maps every other code, and text with no code, to failed', () => {
    expect(laOutcome(authFailed)).toEqual({ ok: false, reason: 'failed' });
    expect(laOutcome('Error Domain=com.apple.LocalAuthentication Code=-4 "System cancel"')).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(laOutcome('Error Domain=com.apple.LocalAuthentication Code=-1004 "Not interactive"')).toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(laOutcome('')).toEqual({ ok: false, reason: 'failed' });
    expect(laOutcome(undefined)).toEqual({ ok: false, reason: 'failed' });
    expect(laOutcome('something went wrong')).toEqual({ ok: false, reason: 'failed' });
  });

  it('never reports ok: a rejection is always a failure of some kind', () => {
    for (const text of [lockout, notAvailable, authFailed, userCancel, '', 'Code=0']) {
      expect(laOutcome(text).ok).toBe(false);
    }
  });
});

describe('isLockoutMessage', () => {
  it('is true only for the lockout code', () => {
    expect(isLockoutMessage(lockout)).toBe(true);
    expect(isLockoutMessage(notAvailable)).toBe(false);
    expect(isLockoutMessage(undefined)).toBe(false);
    // isSensorAvailable's error field carries the same printed NSError.
    expect(isLockoutMessage('Error Domain=com.apple.LocalAuthentication Code=-8 "Biometry is locked out."')).toBe(
      true,
    );
  });
});
