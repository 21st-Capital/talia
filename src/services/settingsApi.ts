/**
 * Native account settings (decided 2026-07-21: full in-app experience — the
 * website's Profile Settings, rebuilt in Talia). Same endpoints the website
 * calls; plain Bearer auth (no CSRF needed outside session-cookie auth).
 * 2FA management ships in a later increment together with TOTP login.
 */
import { COMPANY_API, authHeaders } from './companyAuth';
import type { CompanySession } from './companyAuth';
import type { TwoFactorProof } from './twoFactorProof';

const PROFILE_URL = `${COMPANY_API}/api/auth/user/profile/`;
const BASIC_INFO_URL = `${COMPANY_API}/api/auth/user/basic-info/`;
const PROFILE_UPDATE_URL = `${COMPANY_API}/api/auth/user/profile/update/`;
const REQUEST_DELETION_URL = `${COMPANY_API}/api/auth/user/account/request-deletion/`;
const TFA_GENERATE_URL = `${COMPANY_API}/api/auth/2fa/generate-secret/`;
const TFA_VERIFY_SETUP_URL = `${COMPANY_API}/api/auth/2fa/verify-setup/`;
const TFA_ENABLE_URL = `${COMPANY_API}/api/auth/2fa/enable/`;
const TFA_TOGGLE_URL = `${COMPANY_API}/api/auth/toggle-2fa/`;
const SUBSCRIPTION_CANCEL_URL = (id: string) =>
  `${COMPANY_API}/api/billing/subscriptions/${id}/cancel/`;
const SUBSCRIPTION_AUTORENEW_URL = (id: string) =>
  `${COMPANY_API}/api/billing/subscriptions/${id}/toggle-auto-renew/`;

export interface UserProfile {
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  country: string;
  twoFactorEnabled: boolean;
  /** The date of birth 21st Capital already holds (YYYY-MM-DD), empty when
   *  there is none: the Estate Plan stops asking when we have it. */
  dateOfBirth: string;
  /** Staff-assigned Lifetime Elite membership: full Elite access with no
   *  subscription row, honoured by every backend gate (decided 2026-08-05). */
  lifetimeElite: boolean;
}

export async function fetchProfile(session: CompanySession): Promise<UserProfile> {
  const res = await fetch(PROFILE_URL, { headers: authHeaders(session) });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not load your profile (${res.status}).`);
  const body = (await res.json()) as {
    profile?: {
      email?: string;
      first_name?: string;
      last_name?: string;
      phone_number?: string | null;
      country?: string | null;
      two_factor_enabled?: boolean;
      date_of_birth?: string | null;
      lifetime_elite?: boolean;
    };
  };
  const p = body.profile ?? {};
  return {
    email: p.email ?? '',
    firstName: p.first_name ?? '',
    lastName: p.last_name ?? '',
    phoneNumber: p.phone_number ?? '',
    country: p.country ?? '',
    twoFactorEnabled: p.two_factor_enabled === true,
    dateOfBirth: p.date_of_birth ?? '',
    lifetimeElite: p.lifetime_elite === true,
  };
}

/** Save name + phone + country (two PATCHes, mirroring the website). */
export async function updateProfile(
  session: CompanySession,
  patch: { firstName: string; lastName: string; phoneNumber: string; country: string },
): Promise<void> {
  const headers = { ...authHeaders(session), 'Content-Type': 'application/json' };
  const basic = await fetch(BASIC_INFO_URL, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ first_name: patch.firstName, last_name: patch.lastName }),
  });
  if (basic.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!basic.ok) throw new Error(`Could not save your name (${basic.status}).`);
  const prof = await fetch(PROFILE_UPDATE_URL, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      phone_number: patch.phoneNumber || null,
      country: patch.country || null,
    }),
  });
  if (!prof.ok) throw new Error(`Could not save your details (${prof.status}).`);
}

export async function cancelSubscription(
  session: CompanySession,
  subscriptionId: string,
): Promise<void> {
  const res = await fetch(SUBSCRIPTION_CANCEL_URL(subscriptionId), {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not cancel the subscription (${res.status}).`);
}

export async function toggleAutoRenew(
  session: CompanySession,
  subscriptionId: string,
  autoRenew: boolean,
): Promise<boolean> {
  const res = await fetch(SUBSCRIPTION_AUTORENEW_URL(subscriptionId), {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ auto_renew: autoRenew }),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not update auto-renewal (${res.status}).`);
  const body = (await res.json()) as { auto_renew?: boolean };
  return body.auto_renew === true;
}

// ---- Two-factor authentication (TOTP) -------------------------------------

/** Start setup: returns the secret + a QR image URL (server-generated). */
export async function generate2faSecret(
  session: CompanySession,
): Promise<{ secret: string; qrCodeUrl: string; otpauthUrl: string }> {
  const res = await fetch(TFA_GENERATE_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not start 2FA setup (${res.status}).`);
  const body = (await res.json()) as {
    secret?: string;
    qr_code_url?: string;
    otpauth_url?: string;
  };
  // otpauth_url is the SAME string the QR encodes. Opening it hands the
  // authenticator exactly what scanning would, through the OS instead of
  // the camera (decided 2026-09-02).
  return {
    secret: body.secret ?? '',
    qrCodeUrl: body.qr_code_url ?? '',
    otpauthUrl: body.otpauth_url ?? '',
  };
}

/** Verify the first code + enable; returns one-time backup/recovery codes. */
export async function enable2fa(
  session: CompanySession,
  secret: string,
  otpCode: string,
): Promise<string[]> {
  const headers = { ...authHeaders(session), 'Content-Type': 'application/json' };
  const verify = await fetch(TFA_VERIFY_SETUP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ otp_code: otpCode, secret }),
  });
  if (verify.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!verify.ok) throw new Error('That code is not right. Check your authenticator.');
  // The recovery codes come back from VERIFY-SETUP — the moment the server
  // stores them. (They used to be read from the enable call below, which
  // never carried them: the recovery-codes screen showed an empty box, and
  // nothing was stored for token-authed clients. Found 2026-08-27.)
  const verifyBody = (await verify.json()) as { backup_codes?: string[] };
  const verifyCodes = verifyBody.backup_codes ?? [];
  let enable: Response;
  try {
    enable = await fetch(TFA_ENABLE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ secret, otp_code: otpCode }),
    });
  } catch (e) {
    // Verify-setup has already switched two-factor on and stored these
    // codes, and they are never shown again: show them rather than fail.
    if (verifyCodes.length > 0) return verifyCodes;
    throw e;
  }
  if (!enable.ok) {
    if (verifyCodes.length > 0) return verifyCodes;
    if (enable.status === 401) throw new Error('Your session has expired. Please log in again.');
    throw new Error(`Could not enable 2FA (${enable.status}).`);
  }
  const enableBody = (await enable.json().catch(() => ({}))) as { backup_codes?: string[] };
  return verifyCodes.length > 0 ? verifyCodes : enableBody.backup_codes ?? [];
}

/**
 * Turn two-factor OFF. Returns the state the SERVER reports afterwards —
 * never assume success means off (decided 2026-07-27): the endpoint has been a
 * blind toggle, so a retry after a request that actually landed would turn
 * 2FA back ON while the app showed "Off". Trust the response.
 */
export async function disable2fa(
  session: CompanySession,
  proof?: TwoFactorProof | null,
): Promise<boolean> {
  // The server asks for a current authenticator code or a recovery code
  // (decided 2026-09-26); without one it answers 400
  // TWO_FA_CODE_REQUIRED, carried below as err.code.
  const res = await fetch(TFA_TOGGLE_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false, ...(proof ?? {}) }),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) {
    // The server has a real reason and states it plainly (a staff account may
    // never switch two-factor off). Throwing a bare status code hid that and
    // left the screen telling people to try again, which could never work
    // (decided 2026-08-28). Carry the message AND the code.
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    const err = new Error(
      body.message || `Could not turn off 2FA (${res.status}).`,
    ) as Error & { code?: string };
    if (typeof body.error === 'string') err.code = body.error;
    throw err;
  }
  try {
    const body = (await res.json()) as { two_factor_enabled?: boolean };
    if (typeof body.two_factor_enabled === 'boolean') return body.two_factor_enabled;
  } catch {
    // no/!json body — fall back to the optimistic assumption
  }
  return false;
}

/** Email-confirmation deletion flow (same as the website — the link in the
 *  email finishes the deletion; nothing is deleted from the app directly). */
export async function requestAccountDeletion(session: CompanySession): Promise<void> {
  const res = await fetch(REQUEST_DELETION_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not start account deletion (${res.status}).`);
}
