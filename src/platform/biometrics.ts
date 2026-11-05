/**
 * Biometric auth (Face ID / Touch ID), isolated behind a tiny wrapper so
 * screens never import the native module directly. All prompts are local to
 * the device; nothing leaves it.
 *
 * Two native instances, on purpose (decided 2026-09-12: after iOS used up the
 * Face ID tries the app only ever showed a Face ID retry, which fails at
 * once, and the amounts stayed hidden until Face ID was reset outside the
 * app):
 *   - STRICT (biometrics only) reports what the phone has and proves the
 *     sensor when the user turns Face ID on. The phone passcode must never
 *     count as that proof.
 *   - UNLOCK (biometrics with the phone passcode behind them) is every
 *     unlock. iOS offers the passcode after a failed try and goes straight
 *     to it once Face ID is locked out; a successful passcode also unlocks
 *     Face ID again.
 */
import ReactNativeBiometrics from 'react-native-biometrics';
import { isLockoutMessage, laOutcome } from './biometricsOutcome';
import type { BiometricOutcome } from './biometricsOutcome';

export type { BiometricFailReason, BiometricOutcome } from './biometricsOutcome';

const strict = new ReactNativeBiometrics({ allowDeviceCredentials: false });
const unlock = new ReactNativeBiometrics({ allowDeviceCredentials: true });

export interface BiometricsInfo {
  available: boolean;
  /** 'FaceID' | 'TouchID' | 'Biometrics' when known. */
  type?: string;
  /**
   * iOS has locked Face ID after too many failed tries. The sensor is there
   * and enrolled; the phone passcode brings it back. Settings keeps the row
   * usable instead of saying the phone has no Face ID.
   */
  lockedOut?: boolean;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : String(e ?? '');
}

export async function biometricsInfo(): Promise<BiometricsInfo> {
  try {
    const { available, biometryType, error } = await strict.isSensorAvailable();
    if (available) return { available, type: biometryType ?? undefined };
    if (!isLockoutMessage(error)) return { available: false };
    // Locked out: the strict check cannot name the sensor, the passcode-backed
    // one still can (best effort, the label falls back to "Biometrics").
    let type: string | undefined;
    try {
      const withPasscode = await unlock.isSensorAvailable();
      if (withPasscode.available) type = withPasscode.biometryType ?? undefined;
    } catch {
      // keep type unknown
    }
    return { available: false, lockedOut: true, type };
  } catch {
    return { available: false };
  }
}

/**
 * The system unlock prompt: Face ID first, the phone passcode as the way
 * through when Face ID fails or is locked out. Never throws.
 */
export async function promptBiometric(reason: string): Promise<BiometricOutcome> {
  try {
    const { success } = await unlock.simplePrompt({
      promptMessage: reason,
      fallbackPromptMessage: 'Use passcode',
      cancelButtonText: 'Cancel',
    });
    return success ? { ok: true } : { ok: false, reason: 'cancel' };
  } catch (e) {
    return laOutcome(errorText(e));
  }
}

/**
 * Biometrics only, no passcode button: proves the sensor itself before the
 * app trusts it as a lock method. Resolves true only when Face ID or Touch
 * ID succeeded.
 */
export async function promptBiometricStrict(reason: string): Promise<boolean> {
  try {
    const { success } = await strict.simplePrompt({ promptMessage: reason });
    return success;
  } catch {
    return false;
  }
}
