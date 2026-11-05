/**
 * Coinbase, the phone side (decided 2026-09-07): the client's read-only CDP key
 * in the iOS Keychain, one freshly signed token per request, cursor paging
 * through Advanced Trade fills, and the sync into a portfolio. Same shape
 * as krakenSync.ts; the arithmetic is in exchanges/coinbase.ts.
 *
 * The key never leaves this phone and never touches 21st Capital's backend.
 * Coinbase's sandbox (api-sandbox.coinbase.com) answers the same shape with
 * static fills and no key at all, which is how the flow can be tried on a
 * phone without a Coinbase account.
 */
import { deleteSecret, getSecret, setSecret } from './keychain';
import { randomBytes } from '@noble/hashes/utils';

import {
  COINBASE_API_HOST,
  COINBASE_FILLS_PATH,
  COINBASE_KEY_PERMISSIONS_PATH,
  COINBASE_KEY_TOO_POWERFUL,
  coinbaseKeyVerdict,
  COINBASE_SANDBOX_HOST,
  coinbaseErrorMessage,
  coinbaseFillsToEntries,
  coinbaseJwt,
  coinbaseKeyProblemMessage,
  coinbaseSigningKey,
  freshDrafts,
  isCoinbaseEntry,
} from '../exchanges';
import type { CoinbaseFill, ExchangeEntryDraft } from '../exchanges';
import { getHistoricalPoint } from '../wallet/historicalPrice';
import { loadManualEntries, saveManualEntries } from '../wallet/manualEntries';
import { fiatDecimals } from '../wallet/manualEntryPricing';
import type { ManualEntry } from '../wallet/manualLedger';
import type { FiatCurrency } from '../wallet/types';
import { entryTombstoneIdsFor, recordEntryTombstone } from './virtualVaultSync';

const KEYCHAIN_SERVICE_PREFIX = 'talia-coinbase-';
const PAGE = 250;
const PAGE_GAP_MS = 400;
const REQUEST_TIMEOUT_MS = 25_000;
const OVERLAP_SECS = 3 * 24 * 3600;

export interface CoinbaseCredentials {
  keyName: string;
  /** The private key as given (PEM or bare base64); parsed on every use. */
  secret: string;
  /** True = Coinbase's sandbox, no key needed, static fills. */
  sandbox?: boolean;
}

/* ------------------------------------------------------------ credentials */

function serviceFor(walletId: string): string {
  return `${KEYCHAIN_SERVICE_PREFIX}${walletId}`;
}

export async function saveCoinbaseCredentials(walletId: string, creds: CoinbaseCredentials): Promise<void> {
  await setSecret(
    serviceFor(walletId),
    'coinbase',
    JSON.stringify({ keyName: creds.keyName.trim(), secret: creds.secret.trim(), sandbox: !!creds.sandbox }),
  );
}

export async function loadCoinbaseCredentials(walletId: string): Promise<CoinbaseCredentials | null> {
  try {
    const stored = await getSecret(serviceFor(walletId));
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<CoinbaseCredentials>;
    if (typeof parsed.keyName !== 'string' || typeof parsed.secret !== 'string') return null;
    return { keyName: parsed.keyName, secret: parsed.secret, sandbox: !!parsed.sandbox };
  } catch {
    return null;
  }
}

export async function clearCoinbaseCredentials(walletId: string): Promise<void> {
  await deleteSecret(serviceFor(walletId));
}

/* --------------------------------------------------------------- requests */

class CoinbaseApiError extends Error {
  constructor(
    message: string,
    readonly rateLimited: boolean,
  ) {
    super(message);
  }
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Coinbase did not answer in time. Please try again.')), ms);
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

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** One signed GET. The token is minted for THIS path with a fresh nonce. */
async function coinbaseGet<T>(creds: CoinbaseCredentials, path: string, query: string): Promise<T> {
  const host = creds.sandbox ? COINBASE_SANDBOX_HOST : COINBASE_API_HOST;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (!creds.sandbox) {
    const key = coinbaseSigningKey(creds.secret);
    if (!('scalar' in key)) throw new Error(coinbaseKeyProblemMessage(key.problem));
    headers.Authorization = `Bearer ${coinbaseJwt({
      keyName: creds.keyName,
      scalar: key.scalar,
      method: 'GET',
      host,
      path,
      nowSecs: Math.floor(Date.now() / 1000),
      nonceHex: hexOf(randomBytes(16)),
    })}`;
  }
  let res: Response;
  try {
    res = await timeout(fetch(`https://${host}${path}${query ? `?${query}` : ''}`, { headers }), REQUEST_TIMEOUT_MS);
  } catch (e) {
    if (e instanceof Error && /answer in time/.test(e.message)) throw e;
    throw new Error('Could not reach Coinbase. Check the connection and try again.');
  }
  const text = await res.text();
  if (!res.ok) throw new CoinbaseApiError(coinbaseErrorMessage(res.status, text), res.status === 429);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Coinbase answered with status ${res.status} instead of data. Please try again.`);
  }
}

async function coinbaseGetPatient<T>(creds: CoinbaseCredentials, path: string, query: string): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await coinbaseGet<T>(creds, path, query);
    } catch (e) {
      if (e instanceof CoinbaseApiError && e.rateLimited && attempt < 4) {
        await sleep(10_000);
        continue;
      }
      throw e;
    }
  }
}

interface FillsResponse {
  fills?: CoinbaseFill[];
  cursor?: string;
  proof_token_required?: boolean;
}

export type CoinbaseProgress = (message: string) => void;

async function fetchFills(creds: CoinbaseCredentials, sinceSecs: number | undefined, onProgress?: CoinbaseProgress): Promise<CoinbaseFill[]> {
  const out: CoinbaseFill[] = [];
  let cursor = '';
  for (let page = 0; ; page += 1) {
    if (page > 0) await sleep(PAGE_GAP_MS);
    const params = [`limit=${PAGE}`];
    if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
    if (sinceSecs != null) params.push(`start_sequence_timestamp=${encodeURIComponent(new Date(Math.max(0, sinceSecs) * 1000).toISOString())}`);
    const res = await coinbaseGetPatient<FillsResponse>(creds, COINBASE_FILLS_PATH, params.join('&'));
    if (res.proof_token_required) {
      throw new Error('Coinbase asks for an extra confirmation on this account (EU rules). Talia cannot give it yet; the history export is the way in for now.');
    }
    const rows = res.fills ?? [];
    out.push(...rows);
    onProgress?.(`Reading trades: ${out.length}`);
    if (rows.length === 0 || !res.cursor) break;
    cursor = res.cursor;
    if (page > 200) break; // a runaway cursor must not spin forever
  }
  return out;
}

/**
 * Refuse a key that can trade or move funds (decided 2026-09-26),
 * by Coinbase's own answer about the key. `strict` (connecting
 * a key) also refuses when that answer could not be had; a later sync lets
 * it pass and asks again next time. The sandbox has no key to check.
 */
export async function assertCoinbaseKeyReadOnly(creds: CoinbaseCredentials, strict: boolean): Promise<void> {
  if (creds.sandbox) return;
  let verdict: ReturnType<typeof coinbaseKeyVerdict>;
  try {
    verdict = coinbaseKeyVerdict(await coinbaseGet<unknown>(creds, COINBASE_KEY_PERMISSIONS_PATH, ''));
  } catch {
    verdict = 'unknown';
  }
  if (verdict === 'tooPowerful') throw new Error(COINBASE_KEY_TOO_POWERFUL);
  if (verdict === 'unknown' && strict) throw new Error('Could not check that this key can only read. Please try again.');
}

/** Can this phone reach Coinbase, and does the key (if any) open the door? */
export async function probeCoinbase(creds: CoinbaseCredentials | null): Promise<string> {
  const target = creds ?? { keyName: '', secret: '', sandbox: true };
  try {
    const res = await coinbaseGet<FillsResponse>(target, COINBASE_FILLS_PATH, 'limit=1');
    const n = res.fills?.length ?? 0;
    return target.sandbox
      ? `Coinbase's sandbox reachable. It answered with ${n} sample trade${n === 1 ? '' : 's'}.`
      : `Coinbase reachable and the key works. ${n === 0 ? 'No trades yet.' : 'Trades found.'}`;
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not reach Coinbase.';
  }
}

/* ------------------------------------------------------------------- sync */

export interface CoinbaseSyncResult {
  added: number;
  scanned: number;
  syncedThroughSecs: number;
}

export async function syncCoinbasePortfolio(
  walletId: string,
  opts: { fiat: FiatCurrency; btcOnly?: boolean; sinceSecs?: number; onProgress?: CoinbaseProgress },
): Promise<CoinbaseSyncResult> {
  const creds = await loadCoinbaseCredentials(walletId);
  if (!creds) throw new Error('Coinbase is not connected to this portfolio.');
  try {
    await assertCoinbaseKeyReadOnly(creds, false);
  } catch (e) {
    // A key connected before this check that turns out able to trade or
    // move funds is not kept (decided 2026-09-26); the portfolio's entries stay.
    if (e instanceof Error && e.message === COINBASE_KEY_TOO_POWERFUL) await clearCoinbaseCredentials(walletId);
    throw e;
  }
  const since = opts.sinceSecs != null ? Math.max(0, opts.sinceSecs - OVERLAP_SECS) : undefined;
  const now = Date.now();

  const fills = await fetchFills(creds, since, opts.onProgress);
  const drafts: ExchangeEntryDraft[] = coinbaseFillsToEntries(fills, now);
  const syncedThroughSecs = drafts.reduce((m, d) => Math.max(m, d.tsSecs), opts.sinceSecs ?? 0);

  const [existing, deleted] = await Promise.all([loadManualEntries(walletId), entryTombstoneIdsFor(walletId)]);
  const fresh = freshDrafts(drafts, existing, deleted);
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
  const current = await loadManualEntries(walletId);
  const have = new Set(current.map((e) => e.id));
  const toAdd = entries.filter((e) => !have.has(e.id));
  await saveManualEntries(walletId, [...current, ...toAdd]);
  return { added: toAdd.length, scanned: drafts.length, syncedThroughSecs };
}

export async function removeCoinbaseEntries(walletId: string): Promise<number> {
  const current = await loadManualEntries(walletId);
  const gone = current.filter(isCoinbaseEntry);
  if (gone.length === 0) return 0;
  await saveManualEntries(walletId, current.filter((e) => !isCoinbaseEntry(e)));
  const at = Date.now();
  for (const e of gone) await recordEntryTombstone(walletId, e.id, at);
  return gone.length;
}
