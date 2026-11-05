/**
 * Kraken, the phone side: the client's read-only API key in the iOS
 * Keychain, signed requests, paging through history without tripping
 * Kraken's rate limit, and the sync that turns records into portfolio
 * entries (decided 2026-09-07).
 *
 * The key never leaves this phone. Nothing here talks to 21st Capital's
 * backend: the only server involved is Kraken's, and the entries then travel
 * through the portfolio's own encrypted sync like any typed entry would.
 *
 * Rate limit: Kraken's private-call counter allows roughly 15 points at the
 * starter tier and refunds one point every three seconds; history calls cost
 * two. Pages are therefore spaced three seconds apart, and a "slow down" from
 * Kraken pauses fifteen seconds and retries the same page. A first import of
 * a long history takes a minute or two; the screen says so.
 */
import { deleteSecret, getSecret, setSecret } from './keychain';

import {
  KRAKEN_API_ORIGIN,
  freshKrakenDrafts,
  isKrakenEntry,
  krakenErrorMessage,
  KRAKEN_KEY_TOO_POWERFUL,
  KRAKEN_KEY_UNCHECKABLE,
  KRAKEN_PERMISSION_PROBES,
  krakenPermissionVerdict,
  krakenReadOnlyVerdict,
  describeReplyHeaders,
  krakenLedgerToEntries,
  krakenOddReplyMessage,
  krakenSignature,
  krakenTradesToEntries,
} from '../exchanges';
import type { KrakenEntryDraft, KrakenLedgerRow, KrakenPermissionVerdict, KrakenProbeRole, KrakenTrade } from '../exchanges';
import { getHistoricalPoint } from '../wallet/historicalPrice';
import { loadManualEntries, saveManualEntries } from '../wallet/manualEntries';
import { fiatDecimals } from '../wallet/manualEntryPricing';
import type { ManualEntry } from '../wallet/manualLedger';
import type { FiatCurrency } from '../wallet/types';
import { entryTombstoneIdsFor, recordEntryTombstone } from './virtualVaultSync';

const KEYCHAIN_SERVICE_PREFIX = 'talia-kraken-';
const PAGE = 50;
const PAGE_GAP_MS = 3_000;
const RATE_LIMIT_PAUSE_MS = 15_000;
const REQUEST_TIMEOUT_MS = 25_000;
/** How far back a follow-up sync re-reads, so a record that landed late at
 *  Kraken is not missed. The ids make the overlap harmless. */
const OVERLAP_SECS = 3 * 24 * 3600;

export interface KrakenCredentials {
  key: string;
  secret: string;
}

/* ------------------------------------------------------------ credentials */

function serviceFor(walletId: string): string {
  return `${KEYCHAIN_SERVICE_PREFIX}${walletId}`;
}

export async function saveKrakenCredentials(walletId: string, creds: KrakenCredentials): Promise<void> {
  await setSecret(
    serviceFor(walletId),
    'kraken',
    JSON.stringify({ key: creds.key.trim(), secret: creds.secret.trim() }),
  );
}

export async function loadKrakenCredentials(walletId: string): Promise<KrakenCredentials | null> {
  try {
    const stored = await getSecret(serviceFor(walletId));
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<KrakenCredentials>;
    if (typeof parsed.key !== 'string' || typeof parsed.secret !== 'string') return null;
    return { key: parsed.key, secret: parsed.secret };
  } catch {
    return null;
  }
}

export async function clearKrakenCredentials(walletId: string): Promise<void> {
  await deleteSecret(serviceFor(walletId));
}

/* --------------------------------------------------------------- requests */

class KrakenApiError extends Error {
  constructor(
    message: string,
    readonly rateLimited: boolean,
  ) {
    super(message);
  }
}

// Kraken needs every nonce for a key to be larger than the last; wall-clock
// milliseconds are, except within one millisecond, which this guards.
let lastNonce = 0;
function nextNonce(): string {
  const n = Math.max(Date.now(), lastNonce + 1);
  lastNonce = n;
  return String(n);
}

function encodeForm(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Kraken did not answer in time. Please try again.')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** One signed private call, Kraken's own error list returned as it came.
 *  Throws only when there was no JSON answer at all. */
async function krakenPrivateRaw<T>(
  path: string,
  params: Record<string, string>,
  creds: KrakenCredentials,
): Promise<{ error?: string[]; result?: T }> {
  const nonce = nextNonce();
  const postData = encodeForm({ nonce, ...params });
  const sign = krakenSignature({ path, nonce, postData, secretB64: creds.secret });
  let res: Response;
  try {
    res = await timeout(
      fetch(`${KRAKEN_API_ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          'API-Key': creds.key,
          'API-Sign': sign,
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
          Accept: 'application/json',
        },
        body: postData,
      }),
      REQUEST_TIMEOUT_MS,
    );
  } catch (e) {
    if (e instanceof Error && /answer in time/.test(e.message)) throw e;
    throw new Error('Could not reach Kraken. Check the connection and try again.');
  }
  // Read the text first: when the answer is not Kraken's JSON (a block page
  // from Cloudflare or a carrier), its status and first words are the only
  // clue anyone will have, and they go into the message.
  const text = await res.text();
  let body: { error?: string[]; result?: T };
  try {
    body = JSON.parse(text) as { error?: string[]; result?: T };
  } catch {
    const target = `${KRAKEN_API_ORIGIN}${path}`;
    throw new Error(
      krakenOddReplyMessage(
        res.status,
        text,
        describeReplyHeaders((n) => res.headers.get(n), res.url && res.url !== target ? res.url : undefined),
      ),
    );
  }
  return body;
}

/** One signed private call. Throws a plain-language error. */
async function krakenPrivate<T>(
  path: string,
  params: Record<string, string>,
  creds: KrakenCredentials,
): Promise<T> {
  const body = await krakenPrivateRaw<T>(path, params, creds);
  if (body.error && body.error.length > 0) {
    throw new KrakenApiError(krakenErrorMessage(body.error), /rate limit/i.test(body.error.join(' ')));
  }
  if (body.result == null) throw new Error('Kraken sent an empty answer. Please try again.');
  return body.result;
}

/**
 * Refuse a key that can trade or withdraw (decided
 * 2026-09-26). Asks Kraken the questions in KRAKEN_PERMISSION_PROBES, none
 * of which moves anything, and throws KRAKEN_KEY_TOO_POWERFUL when the key
 * got past a permission check it must not pass, or KRAKEN_KEY_UNCHECKABLE
 * when it lacks Query Funds, without which WithdrawInfo's refusal proves
 * nothing (decided 2026-09-30). `strict` (connecting a key) also refuses
 * when Kraken could not be asked; a later sync lets that pass and asks
 * again next time.
 */
export async function assertKrakenKeyReadOnly(creds: KrakenCredentials, strict: boolean): Promise<void> {
  const answers = { queryFunds: 'unknown', withdraw: 'unknown', trade: 'unknown' } as Record<
    KrakenProbeRole,
    KrakenPermissionVerdict
  >;
  for (const probe of KRAKEN_PERMISSION_PROBES) {
    try {
      answers[probe.role] = krakenPermissionVerdict((await krakenPrivateRaw<unknown>(probe.path, probe.params, creds)).error);
    } catch {
      answers[probe.role] = 'unknown';
    }
  }
  const verdict = krakenReadOnlyVerdict(answers);
  if (verdict === 'tooPowerful') throw new Error(KRAKEN_KEY_TOO_POWERFUL);
  if (verdict === 'uncheckable') throw new Error(KRAKEN_KEY_UNCHECKABLE);
  if (verdict === 'unknown' && strict) throw new Error('Could not check that this key can only read. Please try again.');
}

/** The same call, retried after Kraken's "slow down". */
async function krakenPrivatePatient<T>(
  path: string,
  params: Record<string, string>,
  creds: KrakenCredentials,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await krakenPrivate<T>(path, params, creds);
    } catch (e) {
      if (e instanceof KrakenApiError && e.rateLimited && attempt < 4) {
        await sleep(RATE_LIMIT_PAUSE_MS);
        continue;
      }
      throw e;
    }
  }
}

interface TradesHistoryResult {
  count: number;
  trades: Record<string, Omit<KrakenTrade, 'txid'>>;
}

interface LedgersResult {
  count: number;
  ledger: Record<string, Omit<KrakenLedgerRow, 'id'>>;
}

export type KrakenProgress = (message: string) => void;

async function fetchTrades(
  creds: KrakenCredentials,
  sinceSecs: number | undefined,
  onProgress?: KrakenProgress,
): Promise<KrakenTrade[]> {
  const out: KrakenTrade[] = [];
  for (let ofs = 0; ; ofs += PAGE) {
    if (ofs > 0) await sleep(PAGE_GAP_MS);
    const params: Record<string, string> = { type: 'all', trades: 'false', ofs: String(ofs) };
    if (sinceSecs != null) params.start = String(Math.max(0, Math.floor(sinceSecs)));
    const page = await krakenPrivatePatient<TradesHistoryResult>('/0/private/TradesHistory', params, creds);
    const rows = Object.entries(page.trades ?? {});
    for (const [txid, t] of rows) out.push({ ...t, txid });
    onProgress?.(`Reading trades: ${out.length}${page.count ? ` of ${page.count}` : ''}`);
    if (rows.length === 0 || out.length >= (page.count ?? 0)) break;
  }
  return out;
}

async function fetchLedger(
  creds: KrakenCredentials,
  type: 'deposit' | 'withdrawal',
  sinceSecs: number | undefined,
  onProgress?: KrakenProgress,
): Promise<KrakenLedgerRow[]> {
  const out: KrakenLedgerRow[] = [];
  for (let ofs = 0; ; ofs += PAGE) {
    await sleep(PAGE_GAP_MS);
    const params: Record<string, string> = { asset: 'XBT', type, ofs: String(ofs) };
    if (sinceSecs != null) params.start = String(Math.max(0, Math.floor(sinceSecs)));
    const page = await krakenPrivatePatient<LedgersResult>('/0/private/Ledgers', params, creds);
    const rows = Object.entries(page.ledger ?? {});
    for (const [id, r] of rows) out.push({ ...r, id });
    onProgress?.(`Reading ${type}s: ${out.length}${page.count ? ` of ${page.count}` : ''}`);
    if (rows.length === 0 || out.length >= (page.count ?? 0)) break;
  }
  return out;
}

/**
 * Can this phone reach Kraken's API at all? Public endpoint, no key: the
 * answer separates "the network in front of this phone answers for Kraken"
 * from "the key or the request is wrong". Returns a sentence either way.
 */
export async function probeKraken(): Promise<string> {
  const target = `${KRAKEN_API_ORIGIN}/0/public/Time`;
  let res: Response;
  try {
    res = await timeout(fetch(target, { headers: { Accept: 'application/json' } }), REQUEST_TIMEOUT_MS);
  } catch (e) {
    return e instanceof Error && /answer in time/.test(e.message)
      ? 'Kraken did not answer in time.'
      : 'Could not reach Kraken at all. Check the connection, any VPN, and any content filter on this phone.';
  }
  const text = await res.text();
  const headers = describeReplyHeaders((n) => res.headers.get(n), res.url && res.url !== target ? res.url : undefined);
  try {
    const body = JSON.parse(text) as { result?: { rfc1123?: string } };
    const when = body.result?.rfc1123;
    return when
      ? `Kraken reachable. Its clock says ${when}.`
      : `Kraken reachable, but answered something unexpected (status ${res.status}, ${headers}).`;
  } catch {
    return krakenOddReplyMessage(res.status, text, headers);
  }
}

/* ------------------------------------------------------------------- sync */

export interface KrakenSyncResult {
  /** Entries added to the portfolio this time. */
  added: number;
  /** Records Kraken returned (new or already known). */
  scanned: number;
  /** Newest record time seen, for the link's `syncedThroughSecs`. */
  syncedThroughSecs: number;
}

/**
 * Pull Kraken's history into the portfolio. Entries the portfolio already has
 * or the owner deleted are left alone. Records with no receipt price get a
 * market estimate at their day's rate, marked as such in the note; those
 * stay editable like any entry.
 */
export async function syncKrakenPortfolio(
  walletId: string,
  opts: {
    fiat: FiatCurrency;
    /** No market estimates when the owner keeps the app bitcoin-only. */
    btcOnly?: boolean;
    sinceSecs?: number;
    onProgress?: KrakenProgress;
  },
): Promise<KrakenSyncResult> {
  const creds = await loadKrakenCredentials(walletId);
  if (!creds) throw new Error('Kraken is not connected to this portfolio.');
  try {
    await assertKrakenKeyReadOnly(creds, false);
  } catch (e) {
    // A key connected before this check that turns out able to trade or
    // withdraw is not kept (decided 2026-09-26); the portfolio's entries stay.
    // A key that cannot be shown to be read only goes the same way.
    if (e instanceof Error && (e.message === KRAKEN_KEY_TOO_POWERFUL || e.message === KRAKEN_KEY_UNCHECKABLE)) {
      await clearKrakenCredentials(walletId);
    }
    throw e;
  }
  const since = opts.sinceSecs != null ? Math.max(0, opts.sinceSecs - OVERLAP_SECS) : undefined;
  const now = Date.now();

  const trades = await fetchTrades(creds, since, opts.onProgress);
  const deposits = await fetchLedger(creds, 'deposit', since, opts.onProgress);
  const withdrawals = await fetchLedger(creds, 'withdrawal', since, opts.onProgress);

  const drafts: KrakenEntryDraft[] = [
    ...krakenTradesToEntries(trades, now),
    ...krakenLedgerToEntries([...deposits, ...withdrawals], now),
  ].sort((a, b) => a.entry.date - b.entry.date);
  const syncedThroughSecs = drafts.reduce((m, d) => Math.max(m, d.tsSecs), opts.sinceSecs ?? 0);

  const [existing, deleted] = await Promise.all([loadManualEntries(walletId), entryTombstoneIdsFor(walletId)]);
  const fresh = freshKrakenDrafts(drafts, existing, deleted);
  if (fresh.length === 0) return { added: 0, scanned: drafts.length, syncedThroughSecs };

  let entries: ManualEntry[] = fresh.map((d) => d.entry);
  if (!opts.btcOnly) {
    const toEstimate = fresh.filter((d) => d.needsEstimate);
    const decimals = fiatDecimals(opts.fiat);
    const priced = new Map<string, number>();
    for (let i = 0; i < toEstimate.length; i += 1) {
      const d = toEstimate[i];
      opts.onProgress?.(`Looking up prices: ${i + 1} of ${toEstimate.length}`);
      const point = await getHistoricalPoint(opts.fiat, d.tsSecs);
      if (point != null) priced.set(d.entry.id, Number((point.rate * (d.entry.amountSats / 1e8)).toFixed(decimals)));
    }
    entries = entries.map((e) => {
      const est = priced.get(e.id);
      return est != null ? { ...e, fiatAmount: est, fiatCurrency: opts.fiat } : e;
    });
  }

  opts.onProgress?.('Saving');
  // Re-read right before writing: the owner may have typed an entry while
  // Kraken was being paged, and a stale list would drop it.
  const current = await loadManualEntries(walletId);
  const have = new Set(current.map((e) => e.id));
  const toAdd = entries.filter((e) => !have.has(e.id));
  await saveManualEntries(walletId, [...current, ...toAdd]);
  return { added: toAdd.length, scanned: drafts.length, syncedThroughSecs };
}

/**
 * Take every Kraken-made entry out of the portfolio, recording a tombstone
 * for each so the portfolio's own sync does not bring it back from another
 * phone. Entries the owner typed are untouched.
 */
export async function removeKrakenEntries(walletId: string): Promise<number> {
  const current = await loadManualEntries(walletId);
  const gone = current.filter(isKrakenEntry);
  if (gone.length === 0) return 0;
  await saveManualEntries(
    walletId,
    current.filter((e) => !isKrakenEntry(e)),
  );
  const at = Date.now();
  for (const e of gone) await recordEntryTombstone(walletId, e.id, at);
  return gone.length;
}
