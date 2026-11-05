/**
 * Talia's records of Speed up and Cancel, stored locally in AsyncStorage the
 * way `txNotes.ts` stores notes: display metadata, never sent anywhere.
 * `txReplacementLogic.ts` holds the rules (and the tests).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { WalletEngine, WalletTx } from '../bitcoin/engine/types';
import { pendingChildNow } from './replacement';
import { carryTxNote, getTxNote } from './txNotes';
import {
  planFor,
  pruneReplacements,
  readReplacements,
  readSentTimes,
  withFirstSeen,
  replacementState,
  returnedPaymentSats,
  sentAtFor,
  sentInstead,
  sentTimesWithoutWallet,
  takePlan,
  withoutWallet,
  withPlan,
  withReplacement,
  withSentAt,
  withoutSiblingPlans,
} from './txReplacementLogic';
import type { ReplacementState, TxReplacement } from './txReplacementLogic';

const KEY = 'keel.txreplacements.v1';
/** Replacements built but not yet sent (see `withPlan`). */
const PLAN_KEY = 'keel.txreplacements.planned.v1';
/** When Talia broadcast each transaction (see `SentTimes`). */
const SENT_KEY = 'keel.txsentat.v1';
const SEEN_KEY = 'keel.txfirstseen.v1';

export async function loadTxReplacements(): Promise<TxReplacement[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? readReplacements(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

async function saveAll(list: TxReplacement[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

/** This vault's records. */
export async function getTxReplacements(walletId: string): Promise<TxReplacement[]> {
  return (await loadTxReplacements()).filter((r) => r.walletId === walletId);
}

/**
 * `txid` is a return (a cancel, or a speed-up of one): what the payment it
 * cancelled paid, from the records (`returnedPaymentSats`). Null when it is
 * not a return or the records cannot say. Never throws.
 */
export async function returnedPayment(walletId: string, txid: string): Promise<number | null> {
  return returnedPaymentSats(await getTxReplacements(walletId), walletId, txid);
}

/**
 * Record a replacement right after its broadcast, and carry the original's
 * note to the new transaction (unless it already has one). Throws when the
 * phone cannot write: call it AFTER the broadcast and never let a failure
 * here stand in the way of the "sent" state, the payment is already out.
 */
export async function saveTxReplacement(
  rec: Omit<TxReplacement, 'at'> & { at?: number },
): Promise<TxReplacement> {
  const note = rec.note?.trim() || (await getTxNote(rec.walletId, rec.oldTxid)) || undefined;
  const full: TxReplacement = { ...rec, note, at: rec.at ?? Date.now() };
  await saveAll(withReplacement(await loadTxReplacements(), full));
  await carryTxNote(rec.walletId, rec.oldTxid, rec.newTxid);
  return full;
}

/** What the records say about `txid` in this vault (see `replacementState`). */
export async function getReplacementState(
  walletId: string,
  txid: string,
  txs: WalletTx[],
): Promise<ReplacementState> {
  return replacementState(await loadTxReplacements(), walletId, txid, txs);
}

/**
 * After a sync: drop the records whose original confirmed and is buried
 * (see `pruneReplacements`). Best effort; returns what was dropped.
 */
export async function pruneTxReplacements(
  walletId: string,
  txs: WalletTx[],
  tipHeight: number | undefined,
): Promise<TxReplacement[]> {
  try {
    const list = await loadTxReplacements();
    const { kept, dropped } = pruneReplacements(list, walletId, txs, tipHeight);
    if (dropped.length > 0) await saveAll(kept);
    return dropped;
  } catch {
    return [];
  }
}

/** Forget a removed vault's records, its plans and its sent times. */
export async function clearTxReplacements(walletId: string): Promise<void> {
  try {
    const list = await loadTxReplacements();
    const kept = withoutWallet(list, walletId);
    if (kept.length !== list.length) await saveAll(kept);
    const plans = await loadPlans();
    const keptPlans = withoutWallet(plans, walletId);
    if (keptPlans.length !== plans.length) await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(keptPlans));
    const times = await loadSentTimes();
    const keptTimes = sentTimesWithoutWallet(times, walletId);
    if (Object.keys(keptTimes).length !== Object.keys(times).length) {
      await AsyncStorage.setItem(SENT_KEY, JSON.stringify(keptTimes));
    }
    const seen = await loadTimes(SEEN_KEY);
    const keptSeen = sentTimesWithoutWallet(seen, walletId);
    if (Object.keys(keptSeen).length !== Object.keys(seen).length) {
      await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(keptSeen));
    }
  } catch {
    // best effort, like the other caches
  }
}

// ---------------------------------------------------------------- planned

async function loadPlans(): Promise<TxReplacement[]> {
  try {
    const raw = await AsyncStorage.getItem(PLAN_KEY);
    return raw ? readReplacements(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/**
 * Remember a replacement the moment it is built, so it is recorded whichever
 * screen finally sends it (a co-signed vault sends from Pending
 * transactions). Best effort: the signing screen writes the record from its
 * own route too.
 */
export async function planTxReplacement(rec: Omit<TxReplacement, 'at'>): Promise<void> {
  try {
    const plans = withPlan(await loadPlans(), { ...rec, at: Date.now() });
    await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(plans));
  } catch {
    // the signing screen's own record still covers the direct path
  }
}

/** The planned replacement that `txid` is, if any: its kind words a failed send. */
export async function plannedReplacement(walletId: string, txid: string): Promise<TxReplacement | null> {
  return planFor(await loadPlans(), walletId, txid) ?? null;
}

/**
 * `txid` was just broadcast: when it is a planned replacement, record it
 * (and carry the note) exactly as the signing screen does, and drop the
 * plans of every other unsent version of the same payment. Returns the
 * record, and those siblings' txids: the caller withdraws their Pending
 * rows (`withdrawPendingForTxids`), so none can be sent over this one.
 * Never throws; the payment is already out.
 */
export async function recordIfReplacement(
  walletId: string,
  txid: string,
): Promise<{ record: TxReplacement | null; siblings: string[] }> {
  let siblings: string[] = [];
  try {
    const taken = takePlan(await loadPlans(), walletId, txid, Date.now());
    siblings = taken.siblings;
    await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(taken.rest));
    if (!taken.record) return { record: null, siblings };
    return { record: await saveTxReplacement(taken.record), siblings };
  } catch {
    return { record: null, siblings };
  }
}

/**
 * `keepTxid` went out as the replacement of `oldTxid` without a plan to say
 * so (the signing screen's own record): drop every other plan for
 * `oldTxid` and return their txids (see `recordIfReplacement`). Never throws.
 */
export async function dropSiblingPlans(walletId: string, oldTxid: string, keepTxid: string): Promise<string[]> {
  try {
    const { rest, siblings } = withoutSiblingPlans(await loadPlans(), walletId, oldTxid, keepTxid);
    if (siblings.length > 0) await AsyncStorage.setItem(PLAN_KEY, JSON.stringify(rest));
    return siblings;
  } catch {
    return [];
  }
}

export type ReplacementSendVerdict =
  /** Send it. */
  | 'ok'
  /** Another version of the same payment went out first: never send this one over it. */
  | 'already-replaced'
  /** A waiting payment of the vault now spends from the original: it would be thrown away. */
  | 'has-child'
  /** A waiting payment of the vault could not be read: a child cannot be ruled out. */
  | 'unknown';

/**
 * Right before a Speed up or a Cancel of `oldTxid` is broadcast, whichever
 * screen sends it: is it still safe to send (decided 2026-09-28)? Pass an
 * engine synced just before, and `newTxid` (the unsigned txid) when known.
 * Never throws.
 */
export async function replacementSendCheck(
  engine: WalletEngine,
  walletId: string,
  oldTxid: string,
  newTxid: string | null,
): Promise<ReplacementSendVerdict> {
  if (newTxid && sentInstead(await loadTxReplacements(), walletId, oldTxid, newTxid)) return 'already-replaced';
  const child = await pendingChildNow(engine, oldTxid);
  return child === true ? 'has-child' : child == null ? 'unknown' : 'ok';
}

// ---------------------------------------------------------------- sent times

async function loadTimes(key: string): Promise<Record<string, number>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? readSentTimes(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

const loadSentTimes = () => loadTimes(SENT_KEY);

/**
 * Stamp `txid` as broadcast now. Call it right after every broadcast of
 * the everyday path; never throws, the payment is already out.
 */
/** Stamps are written one after another: each is a read-modify-write of one
 *  key, and a refresh session broadcasts several in a row without waiting,
 *  so two overlapping writes would drop one (decided 2026-09-28). */
let sentAtQueue: Promise<void> = Promise.resolve();

export function saveSentAt(walletId: string, txid: string, ms = Date.now()): Promise<void> {
  sentAtQueue = sentAtQueue.then(async () => {
    try {
      await AsyncStorage.setItem(SENT_KEY, JSON.stringify(withSentAt(await loadSentTimes(), walletId, txid, ms)));
    } catch {
      // display metadata only
    }
  });
  return sentAtQueue;
}

/** When Talia broadcast `txid` from this vault (ms), or null when it does not know. */
export async function getSentAt(walletId: string, txid: string): Promise<number | null> {
  return sentAtFor(await loadSentTimes(), walletId, txid);
}

/** When a waiting transaction was sent from this phone, and when this phone first saw it waiting (ms, or null). */
export interface WaitingTimes {
  sentAt: number | null;
  firstSeen: number | null;
}

/** First-seen stamps go one after another, as the sent stamps do. */
let firstSeenQueue: Promise<unknown> = Promise.resolve();

/**
 * Stamp every one of `pending` this phone had not seen waiting yet with the
 * time now, and give back the times known for each of them. Never throws:
 * display metadata only, a failure just shows no time.
 */
export function noteWaiting(walletId: string, pending: readonly string[], now = Date.now()): Promise<Record<string, WaitingTimes>> {
  const run = firstSeenQueue.then(async () => {
    let seen = await loadTimes(SEEN_KEY);
    const next = withFirstSeen(seen, walletId, pending, now);
    if (JSON.stringify(next) !== JSON.stringify(seen)) {
      try {
        await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next));
        seen = next;
      } catch {
        // the times shown are this run's; nothing is kept
        seen = next;
      }
    }
    const sent = await loadSentTimes();
    const out: Record<string, WaitingTimes> = {};
    for (const txid of pending) out[txid] = { sentAt: sentAtFor(sent, walletId, txid), firstSeen: sentAtFor(seen, walletId, txid) };
    return out;
  });
  firstSeenQueue = run.catch(() => undefined);
  return run.catch(() => ({}));
}
