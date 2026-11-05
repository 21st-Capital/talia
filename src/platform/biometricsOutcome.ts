/**
 * Pure mapping of the native biometric prompt's failure text to an outcome
 * the screens can act on. Kept apart from `biometrics.ts` so the node test
 * graph can import it without the native module.
 *
 * react-native-biometrics rejects with the NSError printed as text, e.g.
 *   Error Domain=com.apple.LocalAuthentication Code=-8 "Biometry is locked out." ...
 * and `isSensorAvailable` returns the same text in its `error` field. The
 * LAError code inside is the only stable part of that string.
 */

export type BiometricFailReason = 'cancel' | 'lockout' | 'unavailable' | 'failed';

export type BiometricOutcome = { ok: true } | { ok: false; reason: BiometricFailReason };

/** LAError codes that matter here (LocalAuthentication/LAError.h). */
export const LA_ERROR = {
  authenticationFailed: -1,
  userCancel: -2,
  passcodeNotSet: -5,
  biometryNotAvailable: -6,
  biometryNotEnrolled: -7,
  biometryLockout: -8,
} as const;

/** The LAError code inside a native error text, or null when there is none. */
export function laErrorCode(message: string | undefined | null): number | null {
  if (!message) return null;
  const m = /Code\s*=\s*(-?\d+)/.exec(message);
  if (!m) return null;
  const code = Number(m[1]);
  return Number.isFinite(code) ? code : null;
}

/** True when the text says iOS has locked biometry after too many failed tries. */
export function isLockoutMessage(message: string | undefined | null): boolean {
  return laErrorCode(message) === LA_ERROR.biometryLockout;
}

/**
 * Outcome for a REJECTED prompt (a resolved `success: false` is the user's
 * own cancel and never reaches this). Lockout and "no biometry to use" are
 * told apart so the app can go straight to its own PIN instead of showing a
 * Face ID retry that can only fail again.
 */
export function laOutcome(message: string | undefined | null): BiometricOutcome {
  switch (laErrorCode(message)) {
    case LA_ERROR.biometryLockout:
      return { ok: false, reason: 'lockout' };
    case LA_ERROR.passcodeNotSet:
    case LA_ERROR.biometryNotAvailable:
    case LA_ERROR.biometryNotEnrolled:
      return { ok: false, reason: 'unavailable' };
    case LA_ERROR.userCancel:
      return { ok: false, reason: 'cancel' };
    default:
      return { ok: false, reason: 'failed' };
  }
}
