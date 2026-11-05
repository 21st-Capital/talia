/**
 * 21st Capital RESCUE (client side), decided 2026-07-23.
 *
 * When a vault's recovery timelock has expired, the client can ask 21C to
 * recover the funds via the rescue key. UNLIKE co-signing, rescue shares the
 * FULL descriptor (the client consents via a mandatory disclaimer): 21C rebuilds
 * the wallet on air-gapped hardware, builds a spend of ALL timelock-expired
 * coins to the client's destination, signs it with the rescue key, and returns
 * the signed transaction for the client to broadcast.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COMPANY_API, authHeaders, loadSession } from './companyAuth';
import type { CompanySession } from './companyAuth';
import { fetchWithin, LIST_FETCH_MS } from './fetchWithin';
import { storeTurns } from './storeTurns';
import { withTimeout } from '../wallet/withTimeout';
import { rescueModeVaultFrom } from '../wallet/rescueModeVault';
import type { RescueModeVault } from '../wallet/rescueModeVault';

const REQUESTS_URL = `${COMPANY_API}/api/vaults/rescue/requests/`;
const OTP_URL = `${COMPANY_API}/api/vaults/rescue/otp/`;
const MODE_URL = `${COMPANY_API}/api/vaults/rescue/mode/`;
const MODE_SCHEDULED_URL = `${COMPANY_API}/api/vaults/rescue/mode/scheduled/`;
const MODE_CLOSE_URL = `${COMPANY_API}/api/vaults/rescue/mode/close/`;
const MINE_URL = `${COMPANY_API}/api/vaults/rescue/mine/`;
const COMPLETE_URL = (id: string) => `${COMPANY_API}/api/vaults/rescue/requests/${id}/complete/`;
const CANCEL_URL = (id: string) => `${COMPANY_API}/api/vaults/rescue/requests/${id}/cancel/`;

export interface RescueServerRequest {
  id: string;
  vault_label: string;
  destination: string;
  amount_sats: number | null;
  status: 'pending' | 'signed' | 'completed' | 'cancelled' | 'rejected';
  signed_tx: string;
  created_at: string;
  signed_at: string | null;
  /** Set when 21st Capital turned the request down (decided 2026-08-29). */
  rejected_at?: string | null;
  /** Staff's reason, written for the client. May be empty. */
  rejection_reason?: string;
  /** A speed-up: the id of the rescue it replaces. */
  replaces?: string | null;
  /** The server would take a speed-up of this rescue now. */
  can_speed_up?: boolean;
  /** A waiting request can still be signed: its rescue mode has not ended. */
  still_open?: boolean;
  /**
   * The unsigned PSBT this phone sent with the request, back from the
   * server; "" once wiped (from the moment it is signed, when `signed_tx`
   * is read instead), absent from a server that does not send it. Either
   * counts only when its unsigned txid is the phone's own `requestTxid`
   * (`wallet/rescueRequestFacts.ts`), so the server's word decides nothing.
   */
  request_psbt?: string;
}

async function jsonOrEmpty(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Email the consent LINK for a rescue code (decided 2026-08-28). The page asks the
 * client to confirm they verified the destination — a rescue sweeps the WHOLE
 * vault there — and only then shows the 6-digit code the create call needs.
 */
export async function sendRescueOtp(session: CompanySession, replaces?: string): Promise<void> {
  const res = await fetch(OTP_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    // A speed-up names the rescue it replaces: its rescue mode has closed.
    body: replaces ? JSON.stringify({ replaces }) : '{}',
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) {
    const b = await jsonOrEmpty(res);
    // The backend's error CODE rides along, as co-signing's does, so the
    // screen can act on it (RESCUE_MODE_REQUIRED: the activation ended).
    const err = new Error(
      (b.message as string) || `Could not send the email (${res.status}).`,
    ) as Error & { code?: string };
    if (typeof b.error === 'string') err.code = b.error;
    throw err;
  }
}

/** What the rescue request sends. */
export interface RescueRequestInput {
  descriptor: string;
  destination: string;
  amountSats: number | null;
  vaultLabel: string;
  /** Unsigned rescue-path PSBT built by the app (base64) — the signer only
   *  has to sign it. Optional: a build failure never blocks a rescue. */
  requestPsbt?: string;
  /** The consent-gated email code — mandatory (decided 2026-08-28). */
  emailOtp: string;
  /**
   * The authenticator code (decided 2026-10-05), under the name co-signing
   * uses. Only for an account with two-factor set up; a client without it
   * goes on with the email code alone, so an empty code is not sent at all.
   */
  totp?: string;
  /** A speed-up: the id of the signed rescue this request replaces. */
  replaces?: string;
}

/** The JSON body of POST rescue/requests/. Pure, for the tests. */
export function rescueRequestBody(input: RescueRequestInput): Record<string, unknown> {
  const totp = (input.totp ?? '').trim();
  return {
    descriptor: input.descriptor,
    destination: input.destination,
    amount_sats: input.amountSats,
    vault_label: input.vaultLabel,
    request_psbt: input.requestPsbt ?? '',
    email_otp: input.emailOtp.trim(),
    ...(totp ? { totp } : {}),
    ...(input.replaces ? { replaces: input.replaces } : {}),
  };
}

export async function submitRescueRequest(
  session: CompanySession,
  input: RescueRequestInput,
): Promise<{ id: string }> {
  const res = await fetch(REQUESTS_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify(rescueRequestBody(input)),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  const body = await jsonOrEmpty(res);
  if (!res.ok) {
    // Same code plumbing as co-signing: the screen acts on codes
    // (rescueRefusal), not on the words.
    const err = new Error(
      (body.message as string) || 'Could not submit the rescue request.',
    ) as Error & { code?: string };
    if (typeof body.error === 'string') err.code = body.error;
    throw err;
  }
  return { id: String(body.id) };
}

/**
 * What the rescue screen does with a refused request (decided 2026-10-05).
 *
 * The codes are handled the way co-signing handles them: a wrong or
 * missing code is said under the code field of its own step, and the field
 * clears for another try. The server checks the authenticator before the
 * email code is used, so neither TOTP_REQUIRED nor INVALID_TOTP costs the
 * client the code they already hold.
 *
 *   'totp'  — the account has two-factor: ask for the authenticator code.
 *   'code'  — say `message` under the field of `step`.
 *   'mode'  — rescue mode no longer covers this request (switched on for
 *             another vault, or ended: 7 days passed, the client cancelled
 *             it from the email, or our team closed it). A title-only
 *             dialog, and the code steps are left. `wrongVault` when the
 *             server said it is on for another vault: the screen remembers
 *             that for this vault and stops offering it.
 *   'fee'   — the server would not take the fee (above its cap, or one it
 *             cannot read): a title-only dialog, back on the page where the
 *             fee is chosen. Nothing was filed and the code was not used.
 *   'speed-up' — a speed-up the server refused, for a reason that is not the
 *             fee or a code. A title-only dialog, and the code steps are left.
 *   'open'  — the vault already has a rescue request on its way, waiting
 *             for 21st Capital or signed and not yet sent (decided
 *             2026-11-04: one rescue per vault at a time). A title-only
 *             dialog, back to the list, which shows that request.
 *   'other' — anything else, as before.
 */
export type RescueRefusal =
  | { kind: 'totp' }
  | { kind: 'code'; step: 'email' | 'totp'; message: string }
  | { kind: 'mode'; title: string; wrongVault: boolean }
  | { kind: 'fee'; title: string }
  | { kind: 'speed-up'; title: string }
  | { kind: 'open'; title: string }
  | { kind: 'other'; message: string };

export const RESCUE_WRONG_VAULT_TITLE = 'Rescue mode is on for another vault';
export const RESCUE_MODE_ENDED_TITLE = 'Rescue mode has ended';
export const RESCUE_FEE_REFUSED_TITLE = '21st Capital cannot accept this fee';
export const RESCUE_ALREADY_REPLACED_TITLE = 'This rescue was already sped up';
export const RESCUE_NOT_REPLACED_TITLE = 'This rescue cannot be sped up';
export const RESCUE_ALREADY_OPEN_TITLE = 'This vault already has a rescue request';
/** A cancel that came too late: 21st Capital signed it meanwhile. */
export const RESCUE_ALREADY_SIGNED_TITLE = 'This rescue was already signed';

export function rescueRefusal(
  e: { code?: string; message?: string } | null | undefined,
  /** The step the client was on when the request went out. */
  at: 'email' | 'totp',
): RescueRefusal {
  const said = (e?.message ?? '').trim();
  switch (e?.code) {
    case 'TOTP_REQUIRED':
      return { kind: 'totp' };
    case 'INVALID_TOTP':
      return { kind: 'code', step: 'totp', message: said || 'That authenticator code is not right.' };
    case 'INVALID_EMAIL_OTP':
      return { kind: 'code', step: 'email', message: said || 'That email code is wrong or has expired.' };
    case 'TOO_MANY_ATTEMPTS':
      return { kind: 'code', step: at, message: said || 'Too many wrong codes. Please wait an hour and try again.' };
    case 'RESCUE_WRONG_VAULT':
      return { kind: 'mode', title: RESCUE_WRONG_VAULT_TITLE, wrongVault: true };
    case 'RESCUE_MODE_REQUIRED':
      return { kind: 'mode', title: RESCUE_MODE_ENDED_TITLE, wrongVault: false };
    case 'FEE_NOT_SANE':
    case 'REPLACEMENT_FEE_NOT_HIGHER':
      return { kind: 'fee', title: RESCUE_FEE_REFUSED_TITLE };
    case 'RESCUE_ALREADY_REPLACED':
      return { kind: 'speed-up', title: RESCUE_ALREADY_REPLACED_TITLE };
    case 'RESCUE_ALREADY_OPEN':
      return { kind: 'open', title: RESCUE_ALREADY_OPEN_TITLE };
    case 'RESCUE_NOT_REPLACEABLE':
    case 'REPLACEMENT_DIFFERENT_COINS':
    case 'REPLACEMENT_DIFFERENT_DESTINATION':
    case 'REPLACEMENT_SEQUENCE_CHANGED':
      return { kind: 'speed-up', title: RESCUE_NOT_REPLACED_TITLE };
    default:
      return { kind: 'other', message: said || 'Could not submit the rescue request.' };
  }
}

/**
 * How long the report that a rescue was sent may take, and the session it
 * needs (2026-10-19). It no longer stands between the client and the
 * Sent page, but a call that never ends would keep the record from being
 * retried. The list has longer (`LIST_FETCH_MS`): it is bigger.
 */
export const RESCUE_SERVER_MS = 15_000;

export async function fetchMyRescues(session: CompanySession): Promise<RescueServerRequest[]> {
  const res = await fetchWithin(MINE_URL, { headers: authHeaders(session) }, LIST_FETCH_MS);
  // THROW on failure — an empty array must mean "the server says none", or
  // callers can't safely prune finished/deleted requests (decided 2026-07-24:
  // a staff-deleted request lingered as "Waiting for 21st Capital…").
  if (!res.ok) throw new Error('Could not load rescue requests.');
  return (await res.json()) as RescueServerRequest[];
}

/**
 * Tell 21st Capital the signed rescue went out, so the request reads
 * Completed and the signed transaction is wiped from the server. Answers
 * whether that is settled: true once the server has it (200, also when it
 * already had it: the call may be repeated), or can never take it (404: no
 * such request; 409: it was never signed). False when it should be asked
 * again later: no answer within `RESCUE_SERVER_MS`, no connection, a
 * session the server refused, or a server error. Never throws.
 */
export async function completeRescue(session: CompanySession, id: string): Promise<boolean> {
  try {
    const res = await fetchWithin(
      COMPLETE_URL(id),
      {
        method: 'POST',
        headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
        body: '{}',
      },
      RESCUE_SERVER_MS,
    );
    return res.ok || res.status === 404 || res.status === 409;
  } catch {
    return false;
  }
}

/**
 * Where a request stands after asking 21st Capital to withdraw it: the
 * server's own status ('cancelled' or 'rejected': nothing will be signed;
 * 'signed' or 'completed': too late, ALREADY_SIGNED), 'not_found' when the
 * server has no such request, or null when it could not be asked.
 */
export type CancelOutcome = RescueServerRequest['status'] | 'not_found' | null;

const REQUEST_STATUSES: ReadonlyArray<RescueServerRequest['status']> = [
  'pending',
  'signed',
  'completed',
  'cancelled',
  'rejected',
];

export async function cancelRescue(session: CompanySession, id: string): Promise<CancelOutcome> {
  let res: Response;
  try {
    res = await fetch(CANCEL_URL(id), {
      method: 'POST',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    return null;
  }
  if (res.status === 404) return 'not_found';
  // 200 {status} once withdrawn (or already cancelled or rejected), 409
  // ALREADY_SIGNED {status} when it was signed meanwhile.
  if (!res.ok && res.status !== 409) return null;
  const st = (await jsonOrEmpty(res)).status;
  return REQUEST_STATUSES.includes(st as RescueServerRequest['status'])
    ? (st as RescueServerRequest['status'])
    : null;
}

/**
 * May the phone forget its own record of a request (decided 2026-10-05)?
 * Only once the server says nothing will be signed. The record holds the
 * destination and the request's txid the signed rescue is checked against
 * before it goes out (decided 2026-09-26), so a request that was signed meanwhile,
 * or one the server could not be asked about, keeps it.
 */
export function forgetAfterCancel(outcome: CancelOutcome): boolean {
  return outcome === 'cancelled' || outcome === 'rejected';
}

/** A request as the Rescue page holds it: the phone's record, and the
 *  server's row when the server could be asked. */
export interface RescueRequestState {
  walletId: string;
  pending?: Pick<PendingRescue, 'replaces'>;
  server?: Pick<RescueServerRequest, 'status' | 'still_open'> & { signed_tx?: string };
}

/**
 * A waiting request that can never be signed any more: its rescue mode ended
 * (7 days passed, it was cancelled from the email, or our team closed it).
 * Only on the server's word, never because it could not be asked (`mode`
 * null). A speed-up outlives the mode its rescue's signature closed, so the
 * server says for that one (`still_open`).
 */
export function requestLapsed(
  r: RescueRequestState,
  mode: Pick<RescueModeStatus, 'status'> | null,
): boolean {
  if (r.server?.status !== 'pending') return false;
  return r.pending?.replaces ? r.server.still_open === false : mode != null && mode.status !== 'active';
}

/**
 * Is this request still on its way (decided 2026-11-04: one rescue per
 * vault at a time)? Waiting for 21st Capital and still signable, or signed
 * with its transaction still held for this phone to send. A record the
 * server could not be asked about counts as open: the phone knows it sent
 * one and cannot know it ended. Cancelled, rejected and completed requests
 * are not, nor a waiting one whose rescue mode ended, nor a signed one whose
 * transaction the server no longer holds (14 days after signing): nothing
 * can send it any more. Nor a signed one once rescue mode is on again for
 * its vault (`modeCoversVault`): a signature closes the mode, so it is on
 * again only because 21st Capital switched it on after the signature, which
 * is how they take a rescue that will not be sent out of the way. The
 * server refuses a second request on the same rule (RESCUE_ALREADY_OPEN).
 */
export function requestOpen(
  r: RescueRequestState,
  mode: Pick<RescueModeStatus, 'status'> | null,
  modeCoversVault = false,
): boolean {
  const st = r.server?.status;
  if (st === undefined) return true;
  if (st === 'signed') return !!r.server?.signed_tx && !(mode?.status === 'active' && modeCoversVault);
  if (st === 'pending') return !requestLapsed(r, mode);
  return false;
}

/** The vaults that have a request on its way: the Rescue page does not
 *  offer them for another until it is cancelled or ends. */
export function vaultsWithOpenRequest(
  requests: ReadonlyArray<RescueRequestState>,
  mode: Pick<RescueModeStatus, 'status'> | null,
  /** Whether rescue mode, when on, is on for this vault. */
  modeCovers: (walletId: string) => boolean = () => false,
): Set<string> {
  return new Set(requests.filter((r) => requestOpen(r, mode, modeCovers(r.walletId))).map((r) => r.walletId));
}

// ---- local pending store (so we can broadcast against the right wallet) ------

const PENDING_KEY = 'rescue.pending.v1';

export interface PendingRescue {
  id: string;
  walletId: string;
  vaultLabel: string;
  createdAt: number;
  /**
   * The destination the client typed when filing, kept on THIS phone
   * (decided 2026-09-26). The signed rescue must pay it (or the
   * vault itself) and nothing else; the server's copy is never trusted for
   * this. Absent on requests filed before it was recorded: the client then
   * confirms the address on screen before anything goes out.
   */
  destination?: string;
  /** Unsigned txid of the request PSBT the app sent, when it sent one: the
   *  signed rescue must be exactly that transaction. */
  requestTxid?: string;
  /**
   * Set once THIS phone broadcast the rescue (the network answered with
   * this txid, or the txid was found on the chain): it went out, so the
   * request is never offered for broadcast again. The record stays until the
   * transaction is in a block (decided 2026-10-31): a rescue that waits can
   * be sped up, and this record is what a speed-up is checked against.
   */
  sentTxid?: string;
  /** When this phone marked it sent, ms since 1970. */
  sentAt?: number;
  /** 21st Capital has heard it went out (`reportSentRescues`). */
  reported?: boolean;
  /**
   * A speed-up: the rescue it replaces, and that rescue's coins as this phone
   * read them when it filed the speed-up. They are spent while that rescue
   * waits, so the vault no longer lists them, and the signed speed-up is
   * checked against them before it goes out (`replacedCoins`).
   */
  replaces?: { id: string; txid: string; coins: Array<{ txid: string; vout: number; valueSats: number }> };
}

export async function loadPendingRescues(): Promise<PendingRescue[]> {
  try {
    const s = await AsyncStorage.getItem(PENDING_KEY);
    return s ? (JSON.parse(s) as PendingRescue[]) : [];
  } catch {
    return [];
  }
}

/** One change to the stored list at a time (services/storeTurns.ts): the
 *  report after a broadcast, the list's prune and the app-start retry can
 *  meet, and a lost mark would offer a sent rescue for broadcast again. */
const inTurn = storeTurns();

export function savePendingRescue(p: PendingRescue): Promise<void> {
  return inTurn(async () => {
    const all = await loadPendingRescues();
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify([p, ...all.filter((x) => x.id !== p.id)]));
  });
}

export function removePendingRescue(id: string): Promise<void> {
  return inTurn(async () => {
    const all = await loadPendingRescues();
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(all.filter((x) => x.id !== id)));
  });
}

/** Mark the phone's record of a request as sent, with the txid that went out. */
export function markRescueSent(id: string, txid: string): Promise<void> {
  return inTurn(async () => {
    const all = await loadPendingRescues();
    if (!all.some((x) => x.id === id)) return;
    await AsyncStorage.setItem(
      PENDING_KEY,
      JSON.stringify(all.map((x) => (x.id === id ? { ...x, sentTxid: txid, sentAt: x.sentAt ?? Date.now() } : x))),
    );
  });
}

function markRescueReported(id: string): Promise<void> {
  return inTurn(async () => {
    const all = await loadPendingRescues();
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(all.map((x) => (x.id === id ? { ...x, reported: true } : x))));
  });
}

/**
 * Tell 21st Capital about every rescue this phone sent that the server has
 * not heard of yet (2026-10-19). `only` limits it to those ids. Runs right
 * after a broadcast, when the Rescue list loads and at every app start and
 * return to the front, so a report lost on the way is sent again until it
 * lands. Never throws; every call is bounded (`RESCUE_SERVER_MS`).
 */
export async function reportSentRescues(session: CompanySession, only?: readonly string[]): Promise<void> {
  try {
    const sent = (await loadPendingRescues()).filter(
      (p) => p.sentTxid && !p.reported && (!only || only.includes(p.id)),
    );
    for (const p of sent) {
      if (await completeRescue(session, p.id)) await markRescueReported(p.id);
    }
  } catch {
    // the next run tries again
  }
}

/** How long a sent rescue the vault never lists stays on this phone. */
export const SENT_RECORD_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * May the phone forget a sent rescue the vault does not list? It may simply
 * not have reached the server this vault asks, so only long after it went
 * out. An older record with no time says nothing, and goes.
 */
export function sentRecordExpired(p: Pick<PendingRescue, 'sentAt'>, now: number = Date.now()): boolean {
  return p.sentAt == null || now - p.sentAt > SENT_RECORD_KEEP_MS;
}

/**
 * Everything that follows a rescue that went out, after the Sent page is
 * on screen and never in its way: the record marked sent on this phone,
 * then 21st Capital told. A report that does not land stays marked and is
 * retried later (`reportSentRescues`). Never throws; bounded.
 */
export async function settleSentRescue(id: string, txid: string): Promise<void> {
  try {
    await withTimeout(markRescueSent(id, txid), RESCUE_SERVER_MS, 'Saving the rescue');
    const session = await withTimeout(loadSession(), RESCUE_SERVER_MS, 'Signing in');
    if (session) await reportSentRescues(session, [id]);
  } catch {
    // marked or not, the list never offers it again in this run, and the
    // next report tries again
  }
}


export interface RescueModeStatus {
  status: 'none' | 'scheduled' | 'active';
  bookingUrl: string;
  /** Shareable-link token for the IN-APP scheduler. */
  bookingToken: string;
  /**
   * The ONE vault rescue mode is on for (decided 2026-10-05); only it may ask
   * for a rescue. Filled only while active. Null while active only from a
   * server older than the one-vault rule, which decides for itself.
   */
  vault: RescueModeVault | null;
  /** ISO times, filled only while active: switched on, when 21st Capital
   *  may first sign (48 hours later, nothing overrides it), and when it
   *  switches itself off (7 days later). */
  activatedAt: string | null;
  signableAfter: string | null;
  expiresAt: string | null;
  /** The waiting period is over, as the server saw it. */
  signableNow: boolean;
}

const isoOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() && !Number.isNaN(Date.parse(v)) ? v : null;

/** GET rescue/mode/'s answer, read defensively. Pure, for the tests. An
 *  ended or cancelled activation already reads "none" on the server. */
export function parseRescueMode(body: Record<string, unknown>): RescueModeStatus {
  const raw = body.status;
  const status: RescueModeStatus['status'] = raw === 'scheduled' || raw === 'active' ? raw : 'none';
  const active = status === 'active';
  return {
    status,
    bookingUrl: String(body.booking_url ?? ''),
    bookingToken: String(body.booking_token ?? ''),
    vault: active ? rescueModeVaultFrom(body.vault) : null,
    activatedAt: active ? isoOrNull(body.activated_at) : null,
    signableAfter: active ? isoOrNull(body.signable_after) : null,
    expiresAt: active ? isoOrNull(body.expires_at) : null,
    signableNow: active && body.signable_now === true,
  };
}

/** Where this account stands in the rescue protocol (meeting-gated, decided 2026-07-24). */
export async function fetchRescueMode(session: CompanySession): Promise<RescueModeStatus> {
  const res = await fetch(MODE_URL, { headers: authHeaders(session) });
  if (!res.ok) throw new Error('Could not check the rescue status.');
  return parseRescueMode(await jsonOrEmpty(res));
}

/** "7 Oct, 14:00" in the phone's own words; null for a time it cannot read. */
export function rescueWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * The one line a rescue status may carry about the 48-hour wait: when 21st
 * Capital can sign, while that is still ahead. Null once it can, or when
 * the mode does not say. Only for the vault rescue mode is on for; the
 * caller decides that.
 */
export function signableLine(
  mode: Pick<RescueModeStatus, 'status' | 'signableAfter' | 'signableNow'> | null,
  now: number = Date.now(),
  when: (iso: string) => string | null = rescueWhen,
): string | null {
  if (!mode || mode.status !== 'active' || mode.signableNow || !mode.signableAfter) return null;
  const at = Date.parse(mode.signableAfter);
  if (Number.isNaN(at) || at <= now) return null;
  const text = when(mode.signableAfter);
  return text ? `21st Capital can sign from ${text}.` : null;
}

/** The client confirms they booked the rescue meeting. */
export async function markRescueMeetingScheduled(session: CompanySession): Promise<void> {
  const res = await fetch(MODE_SCHEDULED_URL, { method: 'POST', headers: authHeaders(session) });
  if (!res.ok) {
    const body = await jsonOrEmpty(res);
    throw new Error((body.message as string) || 'Could not confirm the meeting.');
  }
}

/** Auto-reset: the app detected the coins were refreshed — the emergency
 *  is over. True only when the server took it; the screen then reads the
 *  mode again rather than assuming (decided 2026-10-05). */
export async function closeRescueMode(session: CompanySession): Promise<boolean> {
  try {
    const res = await fetch(MODE_CLOSE_URL, { method: 'POST', headers: authHeaders(session) });
    return res.ok;
  } catch {
    // best-effort — the server gate re-checks at submit anyway
    return false;
  }
}

// ---- vaults the server refused under the current rescue mode ----------------

/**
 * A vault the server answered RESCUE_WRONG_VAULT for, under one activation
 * of rescue mode (decided 2026-10-05). The phone reads the vault the way the
 * server does, but should they ever disagree, the review page would offer
 * the same request again and again: a new email, a new code, the same
 * refusal. So the server's word is kept, per activation (a new activation
 * may be for this vault), and the vault is not offered again under it.
 */
export interface RefusedVault {
  walletId: string;
  /** The activation it was refused under: GET rescue/mode/'s activated_at. */
  activatedAt: string | null;
}

const REFUSED_KEY = 'rescue.wrongVault.v1';

export async function loadRefusedVaults(): Promise<RefusedVault[]> {
  try {
    const s = await AsyncStorage.getItem(REFUSED_KEY);
    const all = s ? (JSON.parse(s) as unknown) : [];
    return Array.isArray(all)
      ? all.filter(
          (r): r is RefusedVault =>
            !!r && typeof r.walletId === 'string' && (r.activatedAt === null || typeof r.activatedAt === 'string'),
        )
      : [];
  } catch {
    return [];
  }
}

/** Remember the refusal. Refusals under any other activation are over and
 *  are dropped. Returns what is now kept. */
export async function rememberRefusedVault(walletId: string, activatedAt: string | null): Promise<RefusedVault[]> {
  const kept = (await loadRefusedVaults()).filter((r) => r.activatedAt === activatedAt && r.walletId !== walletId);
  const next = [...kept, { walletId, activatedAt }];
  try {
    await AsyncStorage.setItem(REFUSED_KEY, JSON.stringify(next));
  } catch {
    // Kept for this visit at least: the screen holds what is returned.
  }
  return next;
}

/** Did the server refuse this vault under THIS activation? */
export function refusedUnder(
  refused: ReadonlyArray<RefusedVault>,
  walletId: string,
  activatedAt: string | null | undefined,
): boolean {
  return refused.some((r) => r.walletId === walletId && r.activatedAt === (activatedAt ?? null));
}

/** What a vault rescue mode is NOT on for says, on its row and its page:
 *  the vault it is on for, by name when there is one. */
export function otherVaultLine(boundName: string | null): string {
  return boundName ? `Rescue mode is on for ${boundName}` : RESCUE_WRONG_VAULT_TITLE;
}
