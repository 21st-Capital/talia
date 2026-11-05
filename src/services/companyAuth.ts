/**
 * 21st Capital account auth (email code sign-in) + inheritance-protocol access.
 *
 * Backend spec (2026-07-16):
 *   POST /api/auth/login/otp/ … (see requestOtp / verifyOtp below)
 *   POST /api/auth/token/refresh/       { refresh_token }        → rotated pair
 *   POST /api/auth/logout/              { refresh_token }        → revoke (Bearer)
 *   GET  /api/automations/inheritance-protocol/latest/pdf/       → PDF (Bearer)
 * Access tokens live 24 h and are REFRESHED transparently in loadSession()
 * (decided 2026-07-27): we had stored the 7-day refresh token from the start and
 * never spent it, so every session died at 24 h and the app looked randomly
 * logged out. The refresh token rotates — save both halves or the next
 * attempt 401s.
 *
 * Tokens are credentials → they live in the iOS Keychain (react-native-
 * keychain), never AsyncStorage. This service knows nothing about wallets;
 * it is deliberately separate from the Bitcoin layers.
 */
import { deleteSecret, getSecretStrict, setSecret } from './keychain';
import { NETWORK_LABELS } from '../bitcoin/network';

export const COMPANY_API = 'https://backend.21stcapital.com';
export const INHERITANCE_PDF_URL = `${COMPANY_API}/api/automations/inheritance-protocol/latest/pdf/`;

const KEYCHAIN_SERVICE = 'com.twentyfirstcapital.keel.companyauth';
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // spec: 24 h

export interface CompanySession {
  accessToken: string;
  refreshToken?: string;
  /** Unix ms after which the access token is assumed dead (24 h). */
  expiresAt: number;
  email?: string;
  firstName?: string;
  lastName?: string;
}

// The magic-link sign-in (a tiam://auth/callback?token=… link swapped for a
// session) is GONE from the app (decided 2026-09-26).
// Nothing in the app ever asked for a link, the backend no longer redirects
// to the app scheme, and the handler accepted ANY such link: a link to the
// attacker's own account, opened on a victim's phone, silently replaced the
// victim's session. Sign-in is the emailed code only. If links ever return,
// they must carry a single-use state this app minted, and must never replace
// a session without the person confirming whose account it is.

// ---- OTP login (live 2026-07-16) — the mobile-first flow ------------------

/** Ask the backend to email a 6-digit code (10-min expiry, single-use). */
export async function requestOtp(email: string): Promise<void> {
  const res = await fetch(`${COMPANY_API}/api/auth/login/otp/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (res.status === 429) throw new Error('Too many attempts. Please try again later.');
  if (!res.ok) throw new Error(`Could not request a code (${res.status})`);
}

export interface SignupProfile {
  /** English country name, e.g. "Germany" — REQUIRED for a complete profile
   *  (the website gates on it; incomplete profiles get bounced to a
   *  "complete your profile" page mid-checkout, found 2026-07-21). */
  country: string;
  /** Optional, 7–15 digits (backend rule). */
  phoneNumber?: string;
  /** Website referral choices: youtube-21st | youtube-other | twitter |
   *  google | instagram | friend-family | other */
  referralSource?: string;
}

/**
 * Passwordless SIGN-UP (backend 2026-07-20): create the account and email a
 * code. Returns whether the email already had an account (the backend sends
 * a sign-in code in that case, so the same verify step completes the flow).
 * Profile fields mirror the WEBSITE registration (parity, decided 2026-07-21) so
 * app-created accounts are born profile-complete.
 */
export async function requestSignupOtp(
  email: string,
  firstName: string,
  lastName: string,
  profile?: SignupProfile,
): Promise<{ existing: boolean }> {
  const res = await fetch(`${COMPANY_API}/api/auth/signup/otp/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      first_name: firstName,
      last_name: lastName,
      agree_to_terms: true,
      ...(profile?.country ? { country: profile.country } : {}),
      ...(profile?.phoneNumber ? { phone_number: profile.phoneNumber } : {}),
      ...(profile?.referralSource ? { referral_source: profile.referralSource } : {}),
    }),
  });
  if (res.status === 429) throw new Error('Too many attempts. Please try again later.');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not sign up (${res.status})`);
  }
  const body = (await res.json()) as { existing?: boolean };
  return { existing: body.existing === true };
}

export type OtpResult =
  | { kind: 'session'; session: CompanySession }
  /** Account has 2FA — finish with the authenticator code (or a recovery
   *  code) via verifyMfa/recoverMfa using this temp token. */
  | { kind: 'mfaRequired'; tempToken: string; email: string };

/** Build a CompanySession from any auth response that returns tokens. */
function sessionFromBody(body: Record<string, unknown>, fallbackEmail: string): CompanySession {
  const accessToken = (body.access_token ?? body.access) as string | undefined;
  const refreshToken = (body.refresh_token ?? body.refresh) as string | undefined;
  if (!accessToken) throw new Error('Login succeeded but no access token was returned.');
  const user = body.user as
    | { email?: string; first_name?: string; last_name?: string }
    | undefined;
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
    email: user?.email ?? fallbackEmail,
    firstName: user?.first_name || undefined,
    lastName: user?.last_name || undefined,
  };
}

/** Second factor: exchange the temp token + authenticator code for a session. */
export async function verifyMfa(
  email: string,
  tempToken: string,
  otpCode: string,
): Promise<CompanySession> {
  const res = await fetch(`${COMPANY_API}/api/auth/login/verify-mfa/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ temp_token: tempToken, otp_code: otpCode }),
  });
  if (res.status === 401 || res.status === 400)
    throw new Error('That code is not right. Check your authenticator and try again.');
  if (!res.ok) throw new Error(`Verification failed (${res.status}).`);
  // Node's fetch typings (pulled in by the UR codec's declarations) type
  // res.json() as unknown; the body is what it always was.
  const session = sessionFromBody((await res.json()) as Record<string, unknown>, email);
  await saveSession(session);
  return session;
}

/** Second factor via a one-time recovery code (temp token as Bearer). */
export async function recoverMfa(
  email: string,
  tempToken: string,
  recoveryCode: string,
): Promise<CompanySession> {
  const res = await fetch(`${COMPANY_API}/api/auth/login/2fa/recover/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tempToken}` },
    body: JSON.stringify({ recovery_code: recoveryCode }),
  });
  if (res.status === 401 || res.status === 400)
    throw new Error('That recovery code is not valid.');
  if (!res.ok) throw new Error(`Recovery failed (${res.status}).`);
  // Node's fetch typings (pulled in by the UR codec's declarations) type
  // res.json() as unknown; the body is what it always was.
  const session = sessionFromBody((await res.json()) as Record<string, unknown>, email);
  await saveSession(session);
  return session;
}

/** Exchange email + code for a session (the session shape every sign-in returns). */
export async function verifyOtp(email: string, code: string): Promise<OtpResult> {
  const res = await fetch(`${COMPANY_API}/api/auth/login/verify-otp/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (res.status === 401) throw new Error('Invalid or expired code.');
  if (res.status === 429) throw new Error('Too many attempts. Please try again later.');
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const body = (await res.json()) as Record<string, unknown>;
  if (body.requires_mfa === true) {
    const tempToken = (body.temp_token ?? body.tempToken) as string | undefined;
    if (!tempToken) throw new Error('Two-factor is required but the server sent no token.');
    return { kind: 'mfaRequired', tempToken, email };
  }
  const session = sessionFromBody(body, email);
  await saveSession(session);
  return { kind: 'session', session };
}

// ---- Vault key issuance (co-signer / rescue) ------------------------------
// SPEC CONFIRMED with the backend team (2026-07-19 briefing): per-customer
// account-level keys, pre-provisioned by staff, FREE to fetch (no paywall),
// standard xpub/tpub + fingerprint + origin path per key. 204 = not
// provisioned yet (staff is paged internally); ?network=testnet4 only for
// flagged test accounts (403 otherwise, tpubs at 48'/1'/0'/2'). Keys are
// fetched into the descriptor, never typed manually (decided 2026-07-17).

export const NEXT_VAULT_KEYS_URL = `${COMPANY_API}/api/vaults/next-vault-keys/`;
export const KEY_ENTITLEMENT_URL = `${COMPANY_API}/api/vaults/entitlement/`;
export const KEY_PROOF_REPORT_URL = `${COMPANY_API}/api/vaults/key-proof/report/`;

/**
 * Would the backend hand this client keys right now? Read-only; it mirrors
 * the claim's own gate, so it is true for a card payment, a Bitcoin payment,
 * a free setup and a Lifetime Elite membership alike (2026-09-04: the app
 * used to wait for a SUBSCRIPTION row after checkout, which three of those
 * never create, and stalled on "payment still processing").
 */
export interface KeyEntitlement {
  entitled: boolean;
  reason: string | null;
  /** The paid TEMPLATE (decided 2026-09-19): the tier bought on the website, how
   *  many vaults it includes (the figure the claim caps on) and which slot
   *  numbers already hold keys. The app's own gate reads vaultsIncluded so it
   *  can never be stricter than the backend's. */
  tier: string | null;
  vaultsIncluded: number | null;
  vaultsClaimed: number[];
  /** Vaults somebody else's plan pays for that are THIS client's own (decided
   *  2026-09-20: an allocation, only the billing is shared); empty when
   *  there are none. `claimed` = they already built it (absent on an older
   *  backend = false); `payerName` is shown in Membership, the vault's
   *  advanced details and the builder's which-vault question, nowhere else. */
  holdings: Array<{
    payerId: number;
    payerEmail: string;
    payerName: string;
    vaultNumber: number;
    claimed: boolean;
    /** The owner's own setup meeting (decided 2026-09-21), booked in the app
     *  through the public link the backend names here. Absent on an older
     *  backend, and the app then offers nothing. */
    setupMeeting?: SetupMeetingInfo;
  }>;
  /** True when the client has a plan of their own (a claim without
   *  `heldOf` serves it); false when every vault they may build is paid for
   *  by somebody else. */
  ownPlan: boolean;
  /** Slots of the client's OWN plan that are for someone else: they never
   *  count as the payer's to build. Absent on an older backend = []. */
  vaultsAllocated: Array<{
    vaultNumber: number;
    email: string;
    name: string;
    status: string;
    built: boolean;
  }>;
  /** Included minus built minus assigned, never below zero; null when the
   *  backend does not say (older backend). */
  vaultsOwnFree: number | null;
  /** Has the client been onboarded before, by the CHECKOUT's own rule (decided
   *  2026-10-01): a plan that really started, a paid onboarding or Lifetime
   *  Elite. Only then may the app leave the onboarding out of an order. Null
   *  on an older backend that does not say. */
  onboarded: boolean | null;
}

/** One holding's setup meeting (decided 2026-09-21): the public link that books
 *  it and the meeting that already stands, if one does. */
export interface SetupMeetingInfo {
  /** The booking link, "" when there is nothing to book (the payer's plan is
   *  not live, or the vault has been tested already). */
  bookingUrl: string;
  /** ISO start of the meeting that stands for that vault, else null. */
  bookedAt: string | null;
  vaultNumber: number;
}

/** Read one holding's setup meeting, tolerating everything: an older backend
 *  sends nothing, and a half-filled answer is worth no less than none. */
export function parseSetupMeeting(raw: unknown, vaultNumber: number): SetupMeetingInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as { booking_url?: unknown; booked_at?: unknown; vault_number?: unknown };
  return {
    bookingUrl: typeof m.booking_url === 'string' ? m.booking_url.trim() : '',
    bookedAt: typeof m.booked_at === 'string' && m.booked_at ? m.booked_at : null,
    vaultNumber: typeof m.vault_number === 'number' ? m.vault_number : vaultNumber,
  };
}

/** Pure reader of the entitlement answer, exported for tests. Every field
 *  the 2026-09-20 backend ADDED is optional here. */
export function parseKeyEntitlement(raw: unknown): KeyEntitlement {
  const body = (raw ?? {}) as {
    entitled?: boolean;
    reason?: string | null;
    tier?: string | null;
    vaults_included?: number;
    vaults_claimed?: number[];
    holdings?: Array<{
      payer_id?: number;
      payer_email?: string;
      payer_name?: string;
      vault_number?: number;
      claimed?: boolean;
      setup_meeting?: unknown;
    }>;
    own_plan?: boolean;
    vaults_allocated?: Array<{
      vault_number?: number;
      email?: string;
      name?: string;
      status?: string;
      built?: boolean;
    }>;
    vaults_own_free?: number;
    onboarded?: boolean;
  };
  return {
    ownPlan: body.own_plan !== false,
    entitled: body.entitled === true,
    reason: body.reason ?? null,
    tier: body.tier ?? null,
    vaultsIncluded: typeof body.vaults_included === 'number' ? body.vaults_included : null,
    vaultsClaimed: Array.isArray(body.vaults_claimed)
      ? body.vaults_claimed.filter((n): n is number => typeof n === 'number')
      : [],
    holdings: Array.isArray(body.holdings)
      ? body.holdings
          .filter((h) => typeof h?.payer_id === 'number' && typeof h?.vault_number === 'number')
          .map((h) => ({
            payerId: h.payer_id as number,
            payerEmail: String(h.payer_email ?? ''),
            payerName: typeof h.payer_name === 'string' ? h.payer_name : '',
            vaultNumber: h.vault_number as number,
            claimed: h.claimed === true,
            setupMeeting: parseSetupMeeting(h.setup_meeting, h.vault_number as number),
          }))
      : [],
    vaultsAllocated: Array.isArray(body.vaults_allocated)
      ? body.vaults_allocated
          .filter((a) => typeof a?.vault_number === 'number')
          .map((a) => ({
            vaultNumber: a.vault_number as number,
            email: String(a.email ?? ''),
            name: typeof a.name === 'string' ? a.name : '',
            status: typeof a.status === 'string' ? a.status : 'invited',
            built: a.built === true,
          }))
      : [],
    vaultsOwnFree:
      typeof body.vaults_own_free === 'number' ? Math.max(0, body.vaults_own_free) : null,
    onboarded: typeof body.onboarded === 'boolean' ? body.onboarded : null,
  };
}

export async function fetchKeyEntitlement(
  session: CompanySession,
  network: 'mainnet' | 'testnet4' = 'mainnet',
): Promise<KeyEntitlement> {
  const res = await fetch(`${KEY_ENTITLEMENT_URL}?network=${network}`, {
    headers: authHeaders(session),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not check your plan (${res.status}).`);
  return parseKeyEntitlement(await res.json());
}

/**
 * After the checkout deep link fires, settlement may still be in flight
 * (a Stripe webhook, a Bitcoin confirmation): poll the entitlement probe,
 * 2 s apart for up to 30 s, until the backend says yes.
 */
export async function pollKeyEntitlement(
  session: CompanySession,
  network: 'mainnet' | 'testnet4' = 'mainnet',
  opts?: { intervalMs?: number; timeoutMs?: number },
): Promise<boolean> {
  const interval = opts?.intervalMs ?? 2_000;
  const deadline = Date.now() + (opts?.timeoutMs ?? 30_000);
  for (;;) {
    try {
      if ((await fetchKeyEntitlement(session, network)).entitled) return true;
    } catch {
      // transient: keep polling until the deadline
    }
    if (Date.now() + interval > deadline) return false;
    await new Promise<void>((r) => setTimeout(() => r(), interval));
  }
}

/** One 21st Capital key as next-vault-keys serves it. `proof` is the
 *  device-signed per-key proof, kept RAW (null when the server sent none) so
 *  keyAttestation.ts alone decides what it is (decided 2026-09-26). */
export interface IssuedVaultKey {
  fingerprint: string;
  originPath: string;
  xpub: string;
  proof: unknown;
}

export interface IssuedVaultKeys {
  coSigner?: IssuedVaultKey;
  rescue?: IssuedVaultKey;
  /** True when the backend answered 204: assignment pending, staff paged. */
  provisioning?: boolean;
  /** With `provisioning`: the keys exist but are held back until their
   *  device proof is in (backend serve mode enforce). Takes no vault slot. */
  proofPending?: boolean;
  /** Which of the client's vaults these keys belong to (1-based), and the
   *  account number they derive from. Present only on the per-vault fetch. */
  vaultNumber?: number;
  account?: number;
  /** The PAID backend portfolio this vault now belongs to (decided 2026-09-03:
   *  one purchase, N vaults; the app no longer mints a portfolio per
   *  build). Absent for a client without one, e.g. a test account. */
  portfolioId?: string;
  /** Whose plan this vault belongs to when the signed-in client holds it
   *  as a family member (decided 2026-09-19): the payer's email. */
  heldOf?: string;
  /** One of the builder's everyday keys is already an everyday key in
   *  another person's vault of the same plan (decided 2026-09-20, answer 9:
   *  allowed, warned about, flagged for our team; never refused). Absent on
   *  an older backend. */
  sameDevice?: SameDeviceNotice;
}

/** Whose vault already uses the device, as the backend names them. */
export interface SameDeviceNotice {
  vaultNumber: number | null;
  /** The other person's first name, else their email; may be empty. */
  name: string;
}

/** Pure reader of the claim answer's "same_device"; null or anything
 *  malformed reads as no notice. Exported for tests. */
export function parseSameDevice(raw: unknown): SameDeviceNotice | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const o = raw as { vault_number?: unknown; name?: unknown };
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const vaultNumber = typeof o.vault_number === 'number' ? o.vault_number : null;
  if (!name && vaultNumber == null) return undefined;
  return { vaultNumber, name };
}

/** The fingerprints sent with a claim: lower-case 8 hex, one of each, and
 *  nothing else ever reaches the backend. Exported for tests. */
export function cleanOwnerFingerprints(fps: ReadonlyArray<string | undefined | null>): string[] {
  const out = new Set<string>();
  for (const fp of fps) {
    const v = (fp ?? '').trim().toLowerCase();
    if (/^[0-9a-f]{8}$/.test(v)) out.add(v);
  }
  return [...out];
}

/** How the vault is built, reported with the claim so the backend records
 *  the vault's shape on the paid portfolio (staff testing, estate plan). */
export interface VaultShape {
  configType: 'single-1-1' | 'multi-2-2' | 'multi-2-3';
  companyCosigner: boolean;
  rescue: boolean;
  /** Months of each heir holding their OWN key; assisted heirs are not
   *  part of the descriptor and are left out. */
  heirTimelocks: number[];
}

/** Pure parser for the issued-keys body — exported for tests. */
export function parseIssuedVaultKeys(body: Record<string, unknown>): IssuedVaultKeys {
  const parseKey = (v: unknown): IssuedVaultKey | undefined => {
    const o = v as { fingerprint?: string; origin_path?: string; xpub?: string; proof?: unknown } | undefined;
    return o?.fingerprint && o?.xpub
      ? {
          fingerprint: o.fingerprint.toLowerCase(),
          originPath: o.origin_path ?? '',
          xpub: o.xpub,
          proof: o.proof ?? null,
        }
      : undefined;
  };
  return { coSigner: parseKey(body.co_signer), rescue: parseKey(body.rescue) };
}

/** What the app tells our team about a 21C key whose proof did not verify:
 *  where and what, never the key itself (no xpub, no fingerprint). */
export interface KeyProofReport {
  network: 'mainnet' | 'testnet4';
  account: number | null;
  purpose: 'cosigner' | 'rescue';
  status: string;
  code: string | null;
  /** True when this proof refused the build (enforce), so the team's record
   *  says the client was turned away, not that the key was used. */
  refused: boolean;
}

/** Pure body of the report; exported for tests. */
export function keyProofReportBody(r: KeyProofReport): Record<string, unknown> {
  return {
    network: r.network,
    account: r.account,
    purpose: r.purpose,
    status: r.status,
    code: r.code,
    refused: r.refused === true,
  };
}

/**
 * Tell our team a proof did not verify (report and enforce modes only).
 * Best effort: it never throws and nothing waits on it, and a backend
 * without the endpoint simply answers 404.
 */
export async function reportKeyProof(session: CompanySession, report: KeyProofReport): Promise<void> {
  try {
    await fetch(KEY_PROOF_REPORT_URL, {
      method: 'POST',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: JSON.stringify(keyProofReportBody(report)),
    });
  } catch {
    // The log line already holds it.
  }
}

/**
 * REMOVED 2026-09-01: fetchIssuedVaultKeys.
 *
 * It fetched /api/vaults/issued-keys/, which serves the ONE globally flagged
 * co-signer and rescue key. Every vault the app built with it, for every
 * client, therefore carried the same 21st Capital key, so any ordinary spend
 * published it and one client's vault could be recognised from another's.
 * Per-vault keys replaced it (fetchNextVaultKeys below). The function is gone
 * rather than merely unused: leaving it callable is how a vault would quietly
 * end up back on the shared key.
 */

/** Raised when the client has already built every vault they paid for. */
export class NoVaultSlotsError extends Error {}

/** The build asks for more than the plan the client paid for on the website
 *  (decided 2026-09-19: the website sells a template, the app builds into it). A
 *  2-of-2 on a Premium plan, our keys on a Starter plan. Nothing was
 *  claimed; the message is the backend's, written for the client and never
 *  pointing at a purchase (guideline 3.1.1). */
export class NotInPlanError extends Error {
  detail?: string;
  paidTier?: string;
  neededTier?: string;
  constructor(message: string, detail?: string, paidTier?: string, neededTier?: string) {
    super(message);
    this.detail = detail;
    this.paidTier = paidTier;
    this.neededTier = neededTier;
  }
}

/** The vault the claim named is for someone else (decided 2026-09-20): the payer
 *  assigned it, so its owner builds it in their own Talia. Nothing was
 *  claimed. The message is the backend's; the dialog shows a title only. */
export class VaultAllocatedError extends Error {
  vaultNumber: number | null;
  constructor(message: string, vaultNumber: number | null) {
    super(message);
    this.vaultNumber = vaultNumber;
  }
}

/** Raised when keys cannot be issued until the plan is paid for. THE
 *  authority on this is the backend, which counts far more than an active
 *  subscription (a lifetime membership, a lapsed plan, a paid quote or
 *  portfolio, a Bitcoin onboarding payment), so the app must never decide
 *  this for itself. */
export class PaymentRequiredError extends Error {}

/**
 * The 21st Capital keys for the vault being built RIGHT NOW — a DIFFERENT
 * co-signer and rescue key per vault, derived at this client's own account
 * number (decided 2026-09-01).
 *
 * Replaces `fetchIssuedVaultKeys` for vault creation. That endpoint serves one
 * globally shared key, so every vault the app ever built carried the same
 * co-signer: every ordinary spend published it, and one client could find
 * another's vault on-chain. The account rule lives on the backend (block 1000
 * gives vault 1 = 1001 ... vault 9 = 1009, vault 10 = 1000); the app just asks
 * for its next vault and records which one it got.
 *
 * Pass `vaultNumber` to re-fetch a specific vault's keys — idempotent, so a
 * retry after a failed creation reuses the same number instead of burning the
 * next one.
 */
export async function fetchNextVaultKeys(
  session: CompanySession,
  network: 'mainnet' | 'testnet4' = 'mainnet',
  vaultNumber?: number,
  shape?: VaultShape,
  /** The payer's id when this build is for a vault the client HOLDS of
   *  somebody else's plan (decided 2026-09-19); the backend then serves that
   *  vault's slot instead of the client's own plan. */
  heldOf?: number,
  /** Master fingerprints of the BUILDER's own everyday keys (never an
   *  heir's, never ours), so the backend can flag a device that is already
   *  used in another person's vault of the same plan. */
  ownerFingerprints?: ReadonlyArray<string>,
): Promise<IssuedVaultKeys> {
  const ownerFps = cleanOwnerFingerprints(ownerFingerprints ?? []);
  const res = await fetch(NEXT_VAULT_KEYS_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      network,
      ...(vaultNumber != null ? { vault_number: vaultNumber } : {}),
      ...(heldOf != null ? { held_of: heldOf } : {}),
      ...(ownerFps.length > 0 ? { owner_fingerprints: ownerFps } : {}),
      ...(shape
        ? {
            config_type: shape.configType,
            company_cosigner: shape.companyCosigner,
            rescue: shape.rescue,
            heir_timelocks: shape.heirTimelocks,
          }
        : {}),
    }),
  });
  if (res.status === 204) return { provisioning: true };
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new NoVaultSlotsError(
      body.message ??
        'Every vault included in your plan already has its keys. Add a vault ' +
          'to your plan to build another one.',
    );
  }
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (body.error === '2FA_REQUIRED') {
      throw new Error(
        'Turn on two-factor authentication in your 21st Capital account ' +
          'before fetching your keys.',
      );
    }
    if (body.error === 'TESTNET_NOT_PERMITTED') {
      throw new Error(
        'Test keys are only issued to flagged test accounts. Ask 21st Capital ' +
          `to mark your account for testing, or build this vault on ${NETWORK_LABELS.bitcoin}.`,
      );
    }
    // The backend's own wording for these two is written for staff ("Allocate
    // deliberately if this is a special case"), so the app says it in the
    // client's terms instead (decided 2026-09-01).
    if (body.error === 'NO_PAYMENT') {
      throw new PaymentRequiredError(
        'Your plan is not active yet, so your keys cannot be issued.',
      );
    }
    if (body.error === 'NOT_A_HOLDER') {
      throw new Error('No vault of that plan is yours.');
    }
    if (body.error === 'ALLOCATED') {
      const b = body as { message?: string; vault_number?: unknown };
      throw new VaultAllocatedError(
        b.message ?? 'This vault is for someone else. They build it in their own Talia.',
        typeof b.vault_number === 'number' ? b.vault_number : vaultNumber ?? null,
      );
    }
    if (body.error === 'NOT_IN_PLAN') {
      const b = body as { message?: string; detail?: string; paid_tier?: string; needed_tier?: string };
      throw new NotInPlanError(
        b.message ??
          (heldOf != null
            ? 'The plan does not cover this vault. Talk to us and we adjust it.'
            : 'Your plan does not cover this vault. Talk to us and we adjust it.'),
        b.detail,
        b.paid_tier,
        b.needed_tier,
      );
    }
    if (body.error === 'TEST_ACCOUNT') {
      // Since 2026-09-02 a test account IS served keys, on Testnet4 only;
      // this now means the vault was set to Bitcoin. The sentence names the
      // builder's chip as it reads.
      throw new Error(
        'This is a test account, so it gets test keys only. Go back and set ' +
          `this vault to ${NETWORK_LABELS.testnet}.`,
      );
    }
    throw new Error(
      body.message ??
        'Your 21st Capital keys are not available for this account yet.',
    );
  }
  if (!res.ok) throw new Error(`Could not fetch your keys (${res.status}).`);
  const body = (await res.json()) as Record<string, unknown>;
  const keys = parseIssuedVaultKeys(body);
  return {
    ...keys,
    // "Being prepared" arrives as a 200 that still NAMES the waiting vault,
    // so a retry asks for that same number instead of consuming the next one.
    provisioning: body.provisioning === true ? true : undefined,
    proofPending: body.provisioning === true && body.proof_pending === true ? true : undefined,
    vaultNumber: typeof body.vault_number === 'number' ? body.vault_number : undefined,
    account: typeof body.account === 'number' ? body.account : undefined,
    portfolioId: typeof body.portfolio_id === 'string' && body.portfolio_id ? body.portfolio_id : undefined,
    heldOf: typeof body.held_of === 'string' && body.held_of ? body.held_of : undefined,
    sameDevice: parseSameDevice(body.same_device),
  };
}

/**
 * Does this account have an inheritance protocol on file? Existing clients
 * see the protocol entry; everyone else shouldn't even see the option
 * (decided 2026-07-16). 404/403 → not a protocol customer.
 */
export async function hasInheritanceProtocol(session: CompanySession): Promise<boolean> {
  try {
    const res = await fetch(INHERITANCE_PDF_URL, { headers: authHeaders(session) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Listeners fired after every successful session save (login / re-login).
 *  WalletProvider uses this to run the strict-invite release-date upkeep the
 *  MOMENT the owner logs back in — an AppState transition never fires for an
 *  in-app login, so without this hook the date only landed on the next
 *  accidental sync (2026-07-26 forensics, hole 1). */
type SessionSavedListener = () => void;
const sessionSavedListeners = new Set<SessionSavedListener>();
export function onSessionSaved(cb: SessionSavedListener): () => void {
  sessionSavedListeners.add(cb);
  return () => sessionSavedListeners.delete(cb);
}

export async function saveSession(session: CompanySession): Promise<void> {
  await setSecret(KEYCHAIN_SERVICE, 'company-session', JSON.stringify(session));
  sessionSavedListeners.forEach((cb) => {
    try {
      cb();
    } catch {
      // a listener must never break login
    }
  });
}

/** What one refresh attempt proved. Only `rejected` (the server refused the
 *  refresh token) is a reason to forget the session; a network failure or a
 *  server error is not (decided 2026-09-26: an offline refresh
 *  used to log people out). */
export type RefreshOutcome =
  | { kind: 'ok'; session: CompanySession }
  | { kind: 'rejected' }
  | { kind: 'unavailable' };

/** The refresh endpoint's status, read: 400/401/403 = this refresh token is
 *  dead; anything else that is not a success = try again later. Pure. */
export function refreshStatusVerdict(status: number): 'ok' | 'rejected' | 'unavailable' {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 400 || status === 401 || status === 403) return 'rejected';
  return 'unavailable';
}

/**
 * Exchange the stored refresh token for a fresh access token.
 *
 * We had been storing the refresh token since day one and never spending it,
 * so every session simply died at 24 h and the app looked randomly logged
 * out — which is what made the Two-factor screen bounce (decided 2026-07-27).
 * The refresh token ROTATES: the one we submit is blacklisted immediately, so
 * both halves of the response must be saved or the next attempt 401s.
 */
async function refreshSession(session: CompanySession): Promise<RefreshOutcome> {
  if (!session.refreshToken) return { kind: 'rejected' };
  try {
    const res = await fetch(`${COMPANY_API}/api/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    const verdict = refreshStatusVerdict(res.status);
    if (verdict !== 'ok') return { kind: verdict };
    const body = (await res.json()) as Record<string, unknown>;
    const accessToken = (body.access_token ?? body.access) as string | undefined;
    if (!accessToken) return { kind: 'unavailable' };
    const refreshToken =
      ((body.refresh_token ?? body.refresh) as string | undefined) ?? session.refreshToken;
    const next: CompanySession = {
      ...session,
      accessToken,
      refreshToken,
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
    };
    await saveSession(next);
    return { kind: 'ok', session: next };
  } catch {
    return { kind: 'unavailable' }; // offline: "cannot refresh", never "logged out"
  }
}

async function readStoredSession(): Promise<CompanySession | null> {
  const raw = await getSecretStrict(KEYCHAIN_SERVICE);
  if (!raw) return null;
  return JSON.parse(raw) as CompanySession;
}

async function loadSessionOnce(): Promise<CompanySession | null> {
  try {
    const session = await readStoredSession();
    if (!session) return null;
    if (!session.accessToken) {
      await clearSession();
      return null;
    }
    if (session.expiresAt > Date.now()) return session;
    const outcome = await refreshSession(session);
    if (outcome.kind === 'ok') return outcome.session;
    if (outcome.kind === 'unavailable') return null; // keep it; try again later
    // Rejected. If something else saved a newer session meanwhile (a fresh
    // sign-in), that one stands; only the dead one is forgotten.
    const current = await readStoredSession();
    if (current && current.refreshToken !== session.refreshToken && current.expiresAt > Date.now()) {
      return current;
    }
    await clearSession();
    return null;
  } catch {
    return null;
  }
}

/** One load at a time. Every foreground handler asks for the session at
 *  once; with a single-use rotating refresh token, two refreshes in parallel
 *  burned it and the loser wiped the winner's fresh session (decided
 *  2026-09-26). */
let inflightLoad: Promise<CompanySession | null> | null = null;

/** Stored session, or null when absent/expired. An expired session is
 *  REFRESHED when we hold a refresh token, and only purged when the server
 *  refuses that token. */
export function loadSession(): Promise<CompanySession | null> {
  if (!inflightLoad) {
    inflightLoad = loadSessionOnce().finally(() => {
      inflightLoad = null;
    });
  }
  return inflightLoad;
}

export async function clearSession(): Promise<void> {
  await deleteSecret(KEYCHAIN_SERVICE);
}

/** How long sign-out waits for the server before it signs out locally. */
const LOGOUT_TIMEOUT_MS = 8_000;

/**
 * Sign out: ask the backend to revoke this session's refresh token, then
 * forget the session on this phone (decided 2026-09-26). The revocation is best
 * effort by design: offline, a timeout, or an older backend without it (404)
 * must never keep anyone signed in, so every answer is ignored and the
 * local session goes regardless.
 */
export async function signOut(session: CompanySession | null): Promise<void> {
  if (session?.accessToken) {
    const body = session.refreshToken
      ? JSON.stringify({ refresh_token: session.refreshToken })
      : '{}';
    let stopTimer = (): void => {};
    try {
      await Promise.race([
        fetch(`${COMPANY_API}/api/auth/logout/`, {
          method: 'POST',
          headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
          body,
        }),
        new Promise((resolve) => {
          const timer = setTimeout(resolve, LOGOUT_TIMEOUT_MS);
          stopTimer = () => clearTimeout(timer);
        }),
      ]);
    } catch {
      // offline or refused: signing out locally is what matters
    } finally {
      stopTimer();
    }
  }
  await clearSession();
}

/** Auth header for the user-scoped PDF endpoints (strict "Bearer " prefix). */
export function authHeaders(session: CompanySession): Record<string, string> {
  return { Authorization: `Bearer ${session.accessToken}` };
}
