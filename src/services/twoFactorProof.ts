/**
 * What proves the second factor when two-factor is turned OFF (backend
 * decided 2026-09-26): a current code from the authenticator app or
 * one of the recovery codes. Six digits is an authenticator code; anything
 * else is taken as a recovery code (those are eight letters and digits,
 * shown in capitals, and may be typed with spaces or dashes).
 */
export type TwoFactorProof = { otp_code: string } | { recovery_code: string };

export function twoFactorProof(typed: string): TwoFactorProof | null {
  const clean = typed.replace(/[\s-]/g, '');
  if (!clean) return null;
  if (/^\d{6}$/.test(clean)) return { otp_code: clean };
  return { recovery_code: clean.toUpperCase() };
}

/** The backend's answer when turning two-factor off needs a code. */
export const TWO_FA_CODE_REQUIRED = 'TWO_FA_CODE_REQUIRED';
