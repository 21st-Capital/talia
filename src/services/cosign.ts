/**
 * 21st Capital co-signing (client side), decided 2026-07-22.
 *
 * The app builds a spend, the client signs their OWN key(s) on hardware, then
 * asks 21C to co-sign: it STRIPS the PSBT to a blind request (see
 * bitcoin/psbt/cosignRequest.ts), gates the submit behind an email OTP AND an
 * authenticator code, and posts it to the backend. 21C signs it offline; the
 * client fetches the signature here, combines it into the original PSBT, and
 * broadcasts.
 *
 * The original full PSBT (with the client's signature) is kept locally so we can
 * finalise once 21C's signature returns — the backend only ever holds the blind
 * request + 21C's signature.
 */
import { sealedGetItem, sealedSetItem } from '../wallet/sealedStore';
import { unsignedTxid } from '../bitcoin/psbt';
import { COMPANY_API, authHeaders, loadSession } from './companyAuth';
import type { CompanySession } from './companyAuth';
import { fetchWithin, LIST_FETCH_MS } from './fetchWithin';
import { storeTurns } from './storeTurns';

const OTP_URL = `${COMPANY_API}/api/vaults/cosign/otp/`;
const REQUESTS_URL = `${COMPANY_API}/api/vaults/cosign/requests/`;
const BATCH_URL = `${COMPANY_API}/api/vaults/cosign/requests/batch/`;
const MINE_URL = `${COMPANY_API}/api/vaults/cosign/mine/`;
const COMPLETE_URL = (id: string) => `${COMPANY_API}/api/vaults/cosign/requests/${id}/complete/`;
const CANCEL_URL = (id: string) => `${COMPANY_API}/api/vaults/cosign/requests/${id}/cancel/`;
const PENDING_KEY = 'cosign.pending.v1';

export interface CosignServerRequest {
  id: string;
  amount_sats: number | null;
  destination: string;
  status: 'pending' | 'signed' | 'completed' | 'cancelled' | 'rejected';
  signed_psbt: string;
  /** Set when the request was part of a refresh-session batch. */
  batch_id?: string | null;
  created_at: string;
  signed_at: string | null;
  /** Set when 21st Capital turned the request down (decided 2026-08-29). */
  rejected_at?: string | null;
  /** Staff's reason, written for the client. May be empty. */
  rejection_reason?: string;
}

/** Locally-kept record so we can finalise when 21C's signature comes back. */
export interface PendingCosign {
  id: string;
  walletId: string;
  /** Full PSBT with the client's own signature — combined with 21C's later. */
  originalPsbt: string;
  amountSats: number | null;
  destination: string;
  createdAt: number;
  /**
   * What this transaction is waiting for (decided 2026-07-28). Absent on records
   * written before this existed, which were all co-sign requests.
   *
   *   'cosigner' — 21st Capital still has to co-sign.
   *   'device'   — the client's OWN next key. Their devices may be in
   *                different places, so a half-signed spend is parked here
   *                instead of trapping them in the ceremony.
   */
  awaiting?: 'cosigner' | 'device';
  /**
   * The server's status for this request the last time the phone saw it
   * (set at submission and on every Pending refresh). What decides whether
   * a new spend must leave its coins alone (wallet/pendingReservations):
   * a rejected or cancelled request can never be co-signed, so its coins
   * are free again. Absent on records written before it existed and on
   * phone-parked partials.
   */
  serverStatus?: CosignServerRequest['status'];
  /** Signature count when it was parked — shown in the list. */
  signatures?: number;
  /** How many the spending path needs in total, when we know it. */
  signaturesNeeded?: number;
  /**
   * The txid of the UNSIGNED transaction — the stable name for "this spend"
   * (decided 2026-07-29, after one payment appeared twice in the pending list).
   *
   * A record's `id` cannot do this job: the phone-parked copy is named from
   * the clock, the co-sign request is named by the server, and they are the
   * same money. The PSBT bytes cannot either — they change with every
   * signature. The unsigned transaction does not, so its hash matches the
   * parked copy, the blind request, 21C's reply and the broadcast.
   *
   * Absent on records written before this existed; anything comparing it must
   * treat `undefined` as "no opinion" rather than as a match.
   */
  txid?: string;
  /**
   * Refresh-session batch (decided 2026-08-27): every transaction of one refresh
   * authorised by a single OTP round shares this id. The pending list shows
   * a batch as ONE entry, and broadcast is one button for all of them.
   */
  batchId?: string;
  /** How many transactions the batch had at submission — for progress copy. */
  batchTotal?: number;
}

/**
 * Is this record a real 21st Capital CO-SIGN REQUEST, as opposed to the
 * client's own half-signed spend parked mid-ceremony? Records written before
 * `awaiting` existed were all co-sign requests (decided 2026-07-28).
 */
export const isCosignRequest = (p: PendingCosign): boolean => p.awaiting !== 'device';

async function jsonOrEmpty(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Step 1 of the step-up: email the client a co-signing code. */
export async function sendCosignOtp(session: CompanySession): Promise<void> {
  const res = await fetch(OTP_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) {
    const b = await jsonOrEmpty(res);
    // Carry the backend's error CODE so the UI can act on it (e.g.
    // 2FA_REQUIRED → take the user to the 2FA setup, not just a message).
    const err = new Error(
      (b.message as string) || `Could not send the email code (${res.status}).`,
    ) as Error & { code?: string };
    if (typeof b.error === 'string') err.code = b.error;
    throw err;
  }
}

/** Submit the blind request. Backend verifies the email OTP AND the TOTP. */
export async function submitCosignRequest(
  session: CompanySession,
  input: {
    requestPsbt: string;
    amountSats: number | null;
    destination: string;
    emailOtp: string;
    totp: string;
    /**
     * This spend is on a vault the client never had tested (decided 2026-07-28).
     * We co-sign regardless — nobody is blocked from their own coins — but
     * the request is flagged so the team can chase the session. The request
     * is BLIND, so only the app can say this; the server cannot infer it.
     */
    vaultUntested?: boolean;
    /** Outputs returning to the vault (buildCosignRequest.ownOutputs), so
     *  the co-signing limit counts only what leaves. */
    ownOutputs?: number[];
  },
): Promise<{ id: string; rejectionReason: string | null }> {
  const res = await fetch(REQUESTS_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_psbt: input.requestPsbt,
      amount_sats: input.amountSats,
      destination: input.destination,
      email_otp: input.emailOtp.trim(),
      totp: input.totp.trim(),
      vault_untested: input.vaultUntested === true,
      ...(input.ownOutputs ? { own_outputs: input.ownOutputs } : {}),
    }),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  const body = await jsonOrEmpty(res);
  if (!res.ok) {
    // Same code plumbing as sendCosignOtp: the UI acts on codes
    // (2FA_REQUIRED → take the user to the 2FA setup).
    // A limit refusal carries the figures in `detail` (decided 2026-09-19): the
    // client reads WHY, not a bare "refused".
    const err = new Error(
      [(body.message as string) || 'Could not submit the request.', body.detail as string]
        .filter(Boolean)
        .join(' '),
    ) as Error & { code?: string };
    if (typeof body.error === 'string') err.code = body.error;
    throw err;
  }
  return { id: String(body.id), rejectionReason: rejectedWith(body) };
}

/**
 * The reason, when the server took the request and rejected it at once: a
 * request over the co-signing limit reaches 21st Capital and is rejected
 * automatically, with the reason written where staff write theirs (decided
 * 2026-09-22). Null for a request that is waiting for us.
 */
function rejectedWith(body: Record<string, unknown>): string | null {
  if (body.status !== 'rejected') return null;
  const reason = typeof body.rejection_reason === 'string' ? body.rejection_reason.trim() : '';
  return reason || 'Over your co-signing limit.';
}

/**
 * Submit a whole refresh session's blind requests under ONE OTP round
 * (decided 2026-08-27). The backend verifies the email OTP + TOTP once and
 * creates every request atomically — all or nothing.
 */
export async function submitCosignBatch(
  session: CompanySession,
  input: {
    requests: Array<{ requestPsbt: string; amountSats: number | null; destination: string; ownOutputs?: number[] }>;
    emailOtp: string;
    totp: string;
    vaultUntested?: boolean;
  },
): Promise<{ batchId: string; ids: string[]; rejectionReason: string | null }> {
  const res = await fetch(BATCH_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: input.requests.map((r) => ({
        request_psbt: r.requestPsbt,
        amount_sats: r.amountSats,
        destination: r.destination,
        ...(r.ownOutputs ? { own_outputs: r.ownOutputs } : {}),
      })),
      email_otp: input.emailOtp.trim(),
      totp: input.totp.trim(),
      vault_untested: input.vaultUntested === true,
    }),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  const body = await jsonOrEmpty(res);
  if (!res.ok) {
    // A limit refusal carries the figures in `detail` (decided 2026-09-19): the
    // client reads WHY, not a bare "refused".
    const err = new Error(
      [(body.message as string) || 'Could not submit the requests.', body.detail as string]
        .filter(Boolean)
        .join(' '),
    ) as Error & { code?: string };
    if (typeof body.error === 'string') err.code = body.error;
    throw err;
  }
  return {
    batchId: String(body.batch_id),
    ids: Array.isArray(body.ids) ? (body.ids as unknown[]).map(String) : [],
    rejectionReason: rejectedWith(body),
  };
}

export async function fetchMyCosigns(session: CompanySession): Promise<CosignServerRequest[]> {
  // Bounded (2026-10-19): a list that never answers throws like any
  // other failure, and the screen keeps what it had. A minute, not the
  // report's 15 s: up to 200 requests with their signed PSBTs, downloaded
  // inside the limit (LIST_FETCH_MS).
  const res = await fetchWithin(MINE_URL, { headers: authHeaders(session) }, LIST_FETCH_MS);
  // THROW on failure — see fetchMyRescues: pruning needs a truthful "none".
  if (!res.ok) throw new Error('Could not load co-sign requests.');
  // A parse failure must ALSO throw (decided 2026-08-27): returning [] here
  // reads as "the server says none" and the pending screen would prune every
  // local record — deleting the only copies of the client's signed PSBTs.
  const body = (await res.json()) as CosignServerRequest[];
  if (!Array.isArray(body)) throw new Error('Could not load co-sign requests.');
  return body;
}

/** How long telling 21st Capital a co-signed spend went out may take. */
export const COMPLETE_COSIGN_MS = 15_000;

/**
 * Tell 21st Capital a co-signed spend went out. Best effort, and bounded
 * (2026-10-19): React Native's fetch has no time limit of its own, so a
 * reply lost on the way used to keep whatever awaited this waiting for
 * ever. Never throws.
 */
export async function completeCosign(session: CompanySession, id: string): Promise<void> {
  await fetchWithin(
    COMPLETE_URL(id),
    {
      method: 'POST',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: '{}',
    },
    COMPLETE_COSIGN_MS,
  ).catch(() => {});
}

/**
 * Cancel a co-sign request: marks it cancelled server-side (which emails the
 * recovery team if 21C hadn't signed it yet) and drops the local pending record.
 *
 * The local record goes ONLY once the server has the cancel (decided
 * 2026-09-26): a failed POST used to be swallowed and the phone's copy
 * deleted anyway, leaving a live request at 21st Capital that the client
 * believed withdrawn. Throws then, and the record stays. A 404 means the
 * server has no such request, so there is nothing left to withdraw there.
 */
export async function cancelCosign(session: CompanySession, id: string): Promise<void> {
  const res = await fetch(CANCEL_URL(id), {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok && res.status !== 404) {
    throw new Error('The request could not be withdrawn at 21st Capital. Please try again.');
  }
  await removePendingCosign(id);
}

/**
 * Cancel EVERY locally-pending request — called on explicit sign-out. Once
 * signed out the app can't fetch 21C's signature to finish a co-sign, and 21C
 * shouldn't sign a request the client has walked away from, so we cancel them
 * all (backend + local) while the session is still valid. Best-effort per item.
 */
export async function cancelAllPendingCosigns(session: CompanySession): Promise<void> {
  const pending = await loadPendingCosigns();
  // ONLY the records the backend actually knows about. A phone-parked partial
  // has a local `partial-…` id, so cancelling it POSTs an id the server has
  // never seen (404, swallowed) and then deletes the record locally — i.e.
  // signing out silently threw away a half-signed spend the client may have
  // travelled to a second location to produce (found 2026-07-29).
  // Settled, not all: one failure must not stop the others, and a request
  // that could not be withdrawn keeps its record (cancelCosign).
  await Promise.allSettled(pending.filter(isCosignRequest).map((p) => cancelCosign(session, p.id)));
}

// ---- local pending store -----------------------------------------------------

// Sealed at rest (decided 2026-09-26): these records carry half-signed payments.

/** The stored list; THROWS when it cannot be read, so a writer never saves
 *  a shortened list over the real one. */
async function readPendingCosigns(): Promise<PendingCosign[]> {
  const s = await sealedGetItem(PENDING_KEY);
  if (!s) return [];
  try {
    return JSON.parse(s) as PendingCosign[];
  } catch {
    return [];
  }
}

async function writePendingCosigns(list: PendingCosign[]): Promise<void> {
  await sealedSetItem(PENDING_KEY, JSON.stringify(list));
}

/** One change to the stored list at a time (services/storeTurns.ts). */
const inTurn = storeTurns();

export async function loadPendingCosigns(): Promise<PendingCosign[]> {
  try {
    return await readPendingCosigns();
  } catch {
    return [];
  }
}

export function savePendingCosign(p: PendingCosign): Promise<void> {
  return inTurn(() => savePendingCosignNow(p));
}

async function savePendingCosignNow(p: PendingCosign): Promise<void> {
  const all = await readPendingCosigns();

  // Same spend already here under a DIFFERENT id? Merge instead of appending.
  // This is the duplicate a phone test found: a half-signed spend parked (id from the
  // clock), then the co-signature requested (id from the server), and the
  // list showed one payment twice.
  //
  // THE CO-SIGN RECORD ALWAYS WINS, whichever arrives second. Its id is the
  // one the backend knows: lose it and the "co-signed — ready to send" button
  // never appears, Discard leaves the request live on our side, and the vault
  // banner vanishes. So a device partial merges INTO a co-sign request, never
  // over it.
  const sameSpend = p.txid
    ? all.find((x) => x.txid === p.txid && x.id !== p.id)
    : undefined;

  if (sameSpend && isCosignRequest(sameSpend) && !isCosignRequest(p)) {
    // Keep the server record; take the fresher signing progress from the copy
    // the client just parked.
    const merged: PendingCosign = {
      ...sameSpend,
      originalPsbt: p.originalPsbt,
      signatures: p.signatures ?? sameSpend.signatures,
      signaturesNeeded: p.signaturesNeeded ?? sameSpend.signaturesNeeded,
    };
    const next = [merged, ...all.filter((x) => x.id !== sameSpend.id && x.id !== p.id)];
    await writePendingCosigns(next);
    return;
  }

  // Otherwise the incoming record stands, and any other record for the same
  // spend is folded away (this is the co-sign request superseding an earlier
  // device partial: the common case, and that phone test's exact sequence).
  const next = [
    p,
    ...all.filter((x) => x.id !== p.id && !(p.txid && x.txid === p.txid)),
  ];
  await writePendingCosigns(next);
}

/**
 * Clear every record for a spend, by its unsigned txid — used once it is
 * broadcast. Removing only the id that happened to do the sending is what left
 * a phone with a permanent "needs your next key" row for money that had already
 * gone (2026-07-29).
 */
export async function removePendingCosignsForTxid(txid: string): Promise<void> {
  if (!txid) return;
  await inTurn(async () => {
    const all = await readPendingCosigns();
    await writePendingCosigns(all.filter((x) => x.txid !== txid));
  });
}

/**
 * Withdraw every pending record of these spends (by unsigned txid), because
 * another version of the same payment was sent (a sibling Speed up or
 * Cancel, decided 2026-09-28): an older version left sendable could undo it.
 * The rows go at once, before this returns; a co-sign request is then also
 * cancelled at 21st Capital (in the background, never holding up the page),
 * so its signed copy cannot be fetched and sent later. A phone-parked
 * partial exists only here. Never throws.
 */
export async function withdrawPendingForTxids(txids: string[]): Promise<void> {
  const ids = new Set(txids.filter(Boolean).map((t) => t.toLowerCase()));
  if (ids.size === 0) return;
  try {
    const gone = await inTurn(async () => {
      const all = await readPendingCosigns();
      const leaving = all.filter((p) => !!p.txid && ids.has(p.txid.toLowerCase()));
      if (leaving.length > 0) await writePendingCosigns(all.filter((p) => !leaving.includes(p)));
      return leaving;
    });
    if (gone.length === 0) return;
    const requests = gone.filter(isCosignRequest);
    if (requests.length === 0) return;
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        for (const p of requests) await cancelCosign(session, p.id).catch(() => {});
      } catch {
        // best effort: the rows are already gone from this phone
      }
    })();
  } catch {
    // best effort
  }
}

/**
 * Write the server's current status onto each local co-sign record it
 * lists (found after the server-first cancel: a rejected request used to keep holding
 * its coins, so a smaller payment after an over-limit refusal could not be
 * built). Records the server does not list are left as they are; pruning
 * them is shouldDropPendingRecord's job. Writes only when something changed.
 */
export async function recordServerStatuses(server: CosignServerRequest[]): Promise<void> {
  const byId = new Map(server.map((s) => [s.id, s.status]));
  await inTurn(async () => {
    // The strict read: a sealed list that cannot be opened right now throws
    // here rather than be rewritten from an empty copy.
    const all = await readPendingCosigns();
    let changed = false;
    const next = all.map((p) => {
      const status = byId.get(p.id);
      if (!status || !isCosignRequest(p) || p.serverStatus === status) return p;
      changed = true;
      return { ...p, serverStatus: status };
    });
    if (changed) await writePendingCosigns(next);
  });
}

/**
 * Best effort: ask the server for the current status of this phone's
 * co-sign requests and record it. Never throws; without a session or a
 * connection the stored statuses stand.
 */
export async function refreshPendingServerStatuses(): Promise<void> {
  try {
    const session = await loadSession();
    if (!session) return;
    await recordServerStatuses(await fetchMyCosigns(session));
  } catch {
    // the last known statuses stand
  }
}

export function removePendingCosign(id: string): Promise<void> {
  return inTurn(async () => {
    const all = await readPendingCosigns();
    await writePendingCosigns(all.filter((x) => x.id !== id));
  });
}

/**
 * Replace a pending record's stored PSBT — used when the client signs their OWN
 * key while WAITING for 21C, so the saved `originalPsbt` now carries their
 * signature and combining with 21C's later finalises straight away.
 */
export async function updatePendingCosignPsbt(
  id: string,
  originalPsbt: string,
  /** Fresh signature count, when the caller knows it. Without it the list
   *  kept saying "1 of 2" after the second key signed (decided 2026-09-01). */
  signatures?: number,
  /** What the path the spend is on needs, counted the same way (the leaf hazard). */
  signaturesNeeded?: number,
): Promise<void> {
  await inTurn(async () => {
    const all = await loadPendingCosigns();
    const p = all.find((x) => x.id === id);
    if (!p) return;
    // Stamp the identity on the way through, so records written before it
    // existed gain one the first time they are touched.
    await savePendingCosignNow({
      ...p,
      originalPsbt,
      ...(signatures != null ? { signatures } : {}),
      ...(signaturesNeeded != null ? { signaturesNeeded } : {}),
      txid: p.txid ?? unsignedTxid(originalPsbt) ?? undefined,
    });
  });
}

/**
 * Record that the client accepted an UNTESTED vault's risk before a receive
 * address was shown (decided 2026-07-28). The phone keeps its own copy, but a
 * record that a reinstall erases is no use as evidence — so it is written on
 * the 21st Capital side too.
 *
 * Best-effort and silent by design: this must NEVER stand between a client
 * and their own address. Carries nothing about the vault's contents — the
 * portfolio we already issued and the name they chose.
 */
export async function recordUntestedVaultAck(
  session: CompanySession,
  input: { portfolioId?: string; vaultLabel: string },
): Promise<void> {
  try {
    await fetch(`${COMPANY_API}/api/vaults/untested-acknowledgement/`, {
      method: 'POST',
      headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        portfolio_id: input.portfolioId ?? '',
        vault_label: input.vaultLabel,
      }),
    });
  } catch {
    // Offline, or the server is unreachable — the on-device record stands.
  }
}
