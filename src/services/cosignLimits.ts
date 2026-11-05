/**
 * Co-signing limits the client reads and changes themselves (decided 2026-09-19:
 * "lower now, raise after 24 hours"). ONE ROW PER VAULT since 2026-09-23:
 * limits are a feature of their own, with or without an Estate Plan, and the
 * list comes from OUR records, so a vault that has never been imported onto
 * this phone is there too. A lowered limit applies at once; a raised one
 * waits 24 hours and can be cancelled until then. The backend decides which.
 */
import { COMPANY_API, authHeaders } from './companyAuth';
import type { CompanySession } from './companyAuth';
import { LIMIT_UNIT } from './limitPresets';
import { formatBtc } from '../wallet/format';
import type { VaultNumber } from '../wallet/providerKeyRoles';

export const COSIGN_LIMITS_URL = `${COMPANY_API}/api/vaults/cosign/limits/`;
export const COSIGN_LIMITS_REMAINING_URL = `${COMPANY_API}/api/vaults/cosign/limits/remaining/`;

/** A plan's two limits, in BTC ("" = no limit). Monthly and yearly only (decided
 *  2026-09-21); the server's answer still carries "daily" (always empty) and
 *  "unit" (always BTC) for installed apps, and both are ignored here. */
export interface LimitSet {
  monthly: string;
  yearly: string;
}

export interface PendingLimits extends LimitSet {
  requestedAt: string;
  effectiveAt: string;
}

/** One vault of the client's, and the limit it carries. */
export interface VaultLimits {
  /** 21st Capital's own number for this vault, from our key's path. */
  account: number;
  network: string;
  /** The client's own 1-based number: "Vault 2". */
  vaultNumber: number;
  limits: LimitSet;
  pending: PendingLimits | null;
}

export interface CosignLimitsPage {
  elite: boolean;
  vaults: VaultLimits[];
}

function parseLimitSet(v: unknown): LimitSet {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    monthly: typeof o.monthly === 'string' ? o.monthly : '',
    yearly: typeof o.yearly === 'string' ? o.yearly : '',
  };
}

function parsePending(v: unknown): PendingLimits | null {
  const o = v as Record<string, unknown> | null | undefined;
  if (!o || typeof o.effective_at !== 'string') return null;
  return {
    ...parseLimitSet(o),
    requestedAt: typeof o.requested_at === 'string' ? o.requested_at : '',
    effectiveAt: o.effective_at,
  };
}

function parseVault(v: unknown): VaultLimits | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.account !== 'number' || typeof o.network !== 'string') return null;
  return {
    account: o.account,
    network: o.network,
    vaultNumber: typeof o.vault_number === 'number' ? o.vault_number : o.account % 10,
    limits: parseLimitSet(o.limits),
    pending: parsePending(o.pending),
  };
}

async function fail(res: Response, fallback: string): Promise<never> {
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  // The code travels with the words, so a code step can tell a wrong email
  // code (INVALID_EMAIL_OTP) from a wrong authenticator code (INVALID_TOTP).
  const err = new Error(body.message ?? `${fallback} (${res.status}).`) as Error & { code?: string };
  if (typeof body.error === 'string') err.code = body.error;
  throw err;
}

/**
 * The limit of one vault, from the list of all of them (decided 2026-10-28:
 * the limits opened from one vault's menu listed every vault). A vault is
 * matched on its number AND its chain, because the same number exists on
 * both. A vault whose number cannot be read has no row here.
 */
export function limitsOfVault(vaults: VaultLimits[], vault: VaultNumber | null): VaultLimits[] {
  if (!vault) return [];
  return vaults.filter((v) => v.account === vault.account && v.network === vault.network);
}

export async function fetchCosignLimits(session: CompanySession): Promise<CosignLimitsPage> {
  const res = await fetch(COSIGN_LIMITS_URL, { headers: authHeaders(session) });
  if (!res.ok) return fail(res, 'Could not load your limits');
  const body = (await res.json()) as { elite?: boolean; vaults?: unknown[] };
  return {
    elite: body.elite === true,
    vaults: (body.vaults ?? []).map(parseVault).filter((v): v is VaultLimits => v != null),
  };
}

export interface LimitChangeResult {
  status: 'applied' | 'scheduled';
  limits: LimitSet;
  pending: PendingLimits | null;
  effectiveAt: string | null;
}

/** Step 1 of a change: the backend emails a code (decided 2026-09-19: "request
 *  an email OTP and an authenticator OTP to make a change to any limit"). */
export async function requestCosignLimitsOtp(session: CompanySession): Promise<void> {
  const res = await fetch(`${COSIGN_LIMITS_URL}otp/`, { method: 'POST', headers: authHeaders(session) });
  if (!res.ok) return fail(res, 'Could not send the email code');
}

export interface StepUpCodes {
  /** The code from the email. */
  emailOtp: string;
  /** The code from the authenticator app. */
  totp: string;
}

export async function changeCosignLimits(
  session: CompanySession,
  vault: Pick<VaultLimits, 'account' | 'network'>,
  limits: LimitSet,
  codes: StepUpCodes,
): Promise<LimitChangeResult> {
  const res = await fetch(`${COSIGN_LIMITS_URL}${vault.account}/${vault.network}/`, {
    method: 'PUT',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    // No daily field: the server refuses a daily amount and reads a
    // missing one as none. The unit is always BTC.
    body: JSON.stringify({
      monthlyLimit: limits.monthly,
      yearlyLimit: limits.yearly,
      limitUnit: LIMIT_UNIT,
      email_otp: codes.emailOtp.trim(),
      totp: codes.totp.trim(),
    }),
  });
  if (!res.ok) return fail(res, 'Could not change your limits');
  const body = (await res.json()) as Record<string, unknown>;
  return {
    status: body.status === 'scheduled' ? 'scheduled' : 'applied',
    limits: parseLimitSet(body.limits),
    pending: parsePending(body.pending),
    effectiveAt: typeof body.effective_at === 'string' ? body.effective_at : null,
  };
}

export async function cancelCosignLimitsChange(
  session: CompanySession,
  vault: Pick<VaultLimits, 'account' | 'network'>,
): Promise<LimitSet> {
  const res = await fetch(`${COSIGN_LIMITS_URL}${vault.account}/${vault.network}/`, {
    method: 'DELETE',
    headers: authHeaders(session),
  });
  if (!res.ok) return fail(res, 'Could not cancel the change');
  const body = (await res.json()) as Record<string, unknown>;
  return parseLimitSet(body.limits);
}

export interface RemainingWindow {
  window: 'monthly' | 'yearly';
  limitSats: number | null;
  usedSats: number;
  leftSats: number | null;
}

export interface RemainingLimits {
  mode: 'none' | 'manual' | 'limits';
  note: string;
  windows: RemainingWindow[];
}

function parseWindow(w: Record<string, unknown>): RemainingWindow | null {
  // Monthly and yearly only; a daily window from an older server is dropped.
  if (w.window !== 'monthly' && w.window !== 'yearly') return null;
  return {
    window: w.window,
    limitSats: typeof w.limit_sats === 'number' ? w.limit_sats : null,
    usedSats: typeof w.used_sats === 'number' ? w.used_sats : 0,
    leftSats: typeof w.left_sats === 'number' ? w.left_sats : null,
  };
}

/**
 * What is left of the limits, for ONE vault when we can name it.
 *
 * A client's vaults carry their own limits, and the request is judged
 * against the vault's (decided 2026-09-23). Without the vault the server answers
 * for the client, as it did before vaults had numbers.
 */
export async function fetchRemainingLimits(
  session: CompanySession,
  vault?: VaultNumber | null,
): Promise<RemainingLimits> {
  const url = vault
    ? `${COSIGN_LIMITS_REMAINING_URL}?account=${vault.account}&network=${vault.network}`
    : COSIGN_LIMITS_REMAINING_URL;
  const res = await fetch(url, { headers: authHeaders(session) });
  if (!res.ok) return fail(res, 'Could not check your limits');
  const body = (await res.json()) as { mode?: string; note?: string; windows?: Array<Record<string, unknown>> };
  const mode = body.mode === 'manual' || body.mode === 'limits' ? body.mode : 'none';
  return {
    mode,
    note: typeof body.note === 'string' ? body.note : '',
    windows: (body.windows ?? []).map(parseWindow).filter((w): w is RemainingWindow => w != null),
  };
}

/** One co-signing limit on the Send screen's summary. */
export interface LimitRow {
  label: string;
  /** "12% used", or "Over the limit" when this send does not fit. */
  value: string;
  /** "0.044 of 0.05 BTC left". */
  sub: string;
  /** This send is more than what is left: 21st Capital rejects it. */
  over: boolean;
}

/** "0%", "<1%", "12%": the share of a limit already requested. */
export function usedPercent(usedSats: number, limitSats: number): string {
  if (limitSats <= 0 || usedSats <= 0) return '0%';
  const pct = (usedSats / limitSats) * 100;
  if (pct < 1) return '<1%';
  return `${Math.min(100, Math.round(pct))}%`;
}

/**
 * The Send screen's co-signing limit rows (decided 2026-09-22: "0.05 from 0.05
 * left says nothing ... use a percentage number to show how much from his
 * limit has been already used ... show the full content of the limit
 * left"). One row per limit that is set, monthly first. `sendSats` is what
 * this send moves out; a send over what is left is marked, because 21st
 * Capital rejects a co-sign request over the limit (the same day).
 */
export function limitRows(r: RemainingLimits, sendSats: number): LimitRow[] {
  if (r.mode === 'manual') {
    return [{ label: 'Co-signing limit', value: 'Checked by hand', sub: 'Your vaults carry different limits', over: false }];
  }
  if (r.mode !== 'limits') return [];
  return (['monthly', 'yearly'] as const).flatMap((window) => {
    const w = r.windows.find((x) => x.window === window);
    if (!w || w.limitSats == null || w.limitSats <= 0) return [];
    const left = w.leftSats ?? Math.max(0, w.limitSats - w.usedSats);
    const over = sendSats > left;
    return [
      {
        label: window === 'monthly' ? 'Monthly limit' : 'Yearly limit',
        value: over ? 'Over the limit' : `${usedPercent(w.usedSats, w.limitSats)} used`,
        sub: `${formatBtc(left).replace(/ BTC$/, '')} of ${formatBtc(w.limitSats)} left`,
        over,
      },
    ];
  });
}
