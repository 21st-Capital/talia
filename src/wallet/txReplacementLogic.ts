/**
 * Talia's own record of a Speed up or a Cancel (decided 2026-09-28).
 *
 * Once the network takes the replacement, the next sync makes BDK forget
 * the original: the server stops reporting it, so a link to the old
 * transaction would load forever and its note would be lost. At broadcast
 * Talia writes one record {walletId, oldTxid -> newTxid, kind, recipient,
 * amount, note, at}; the original's note is carried across to the new
 * transaction; and every page resolves a txid through these records.
 *
 * A replacement is a race, not a promise: the original can still confirm
 * first. Its record then turns into "the cancel came too late" (or, after a
 * speed-up, into nothing at all: the same payment went through) and is
 * dropped once the original is buried under KEEP_UNTIL_CONFIRMATIONS
 * blocks, together with every replacement that followed it, all of which
 * the network has thrown away.
 *
 * Plain logic, no storage and no React Native, so it can be tested. The
 * storage is `txReplacements.ts`, kept the way `txNotes.ts` keeps notes.
 */
import type { WalletTx } from '../bitcoin/engine/types';
import { noteFor, writeNote } from './txNoteLogic';
import type { TxNotes } from './txNoteLogic';

export type ReplacementKind = 'speedup' | 'cancel';
/** What the replaced transaction is called in the ceremony's words. */
export type ReplacedWhat = 'payment' | 'refresh' | 'return';

export interface TxReplacement {
  walletId: string;
  /** The transaction that was replaced. */
  oldTxid: string;
  /** The transaction that replaces it. */
  newTxid: string;
  kind: ReplacementKind;
  /** Where the original payment went (a cancel's too); null when it paid nobody else. */
  recipient: string | null;
  /** What the original payment paid its recipients, in sats. */
  amount: number;
  /** The original's note when it was replaced. */
  note?: string;
  /** When the replacement was broadcast, in ms since the epoch. */
  at: number;
  /** The fee the original paid and the fee the replacement pays, in sats. */
  oldFeeSats?: number;
  newFeeSats?: number;
  /**
   * What the replacement takes out of the vault, its fee included: the
   * recipients and the fee, or the fee alone when every coin stays (a
   * cancel, a refresh). Draws the new transaction before the phone has
   * picked it up (`standInReplacement`). Absent on records written before
   * 2026-09-28.
   */
  newSentSats?: number;
  /** What the original is called ("The refresh of 13:55"); a payment when absent. */
  what?: ReplacedWhat;
}

/** A record is dropped once its original sits this deep: the page stops saying "came too late". */
export const KEEP_UNTIL_CONFIRMATIONS = 6;

const isTxid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);

/** Read whatever the phone has stored; anything malformed is skipped. */
export function readReplacements(raw: unknown): TxReplacement[] {
  if (!Array.isArray(raw)) return [];
  const out: TxReplacement[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.walletId !== 'string' || !o.walletId) continue;
    if (!isTxid(o.oldTxid) || !isTxid(o.newTxid) || o.oldTxid === o.newTxid) continue;
    if (o.kind !== 'speedup' && o.kind !== 'cancel') continue;
    if (typeof o.amount !== 'number' || !Number.isFinite(o.amount)) continue;
    if (typeof o.at !== 'number' || !Number.isFinite(o.at)) continue;
    const rec: TxReplacement = {
      walletId: o.walletId,
      oldTxid: o.oldTxid.toLowerCase(),
      newTxid: o.newTxid.toLowerCase(),
      kind: o.kind,
      recipient: typeof o.recipient === 'string' && o.recipient ? o.recipient : null,
      amount: o.amount,
      at: o.at,
    };
    if (typeof o.note === 'string' && o.note.trim()) rec.note = o.note.trim();
    if (typeof o.oldFeeSats === 'number' && Number.isFinite(o.oldFeeSats)) rec.oldFeeSats = o.oldFeeSats;
    if (typeof o.newFeeSats === 'number' && Number.isFinite(o.newFeeSats)) rec.newFeeSats = o.newFeeSats;
    if (typeof o.newSentSats === 'number' && Number.isFinite(o.newSentSats)) rec.newSentSats = o.newSentSats;
    if (o.what === 'payment' || o.what === 'refresh' || o.what === 'return') rec.what = o.what;
    out.push(rec);
  }
  return out;
}

/** Add a record. Saving the same replacement twice keeps one. */
export function withReplacement(list: TxReplacement[], rec: TxReplacement): TxReplacement[] {
  const clean: TxReplacement = {
    ...rec,
    oldTxid: rec.oldTxid.toLowerCase(),
    newTxid: rec.newTxid.toLowerCase(),
    note: rec.note?.trim() || undefined,
  };
  if (clean.note === undefined) delete clean.note;
  const rest = list.filter((r) => !(r.walletId === clean.walletId && r.newTxid === clean.newTxid));
  return [...rest, clean];
}

const mine = (list: TxReplacement[], walletId: string) => list.filter((r) => r.walletId === walletId);
const newestFirst = (a: TxReplacement, b: TxReplacement) => b.at - a.at;

/** The record saying `txid` was replaced (the newest, should there be two). */
export function replacedBy(
  list: TxReplacement[],
  walletId: string,
  txid: string,
): TxReplacement | undefined {
  const id = txid.toLowerCase();
  return mine(list, walletId).filter((r) => r.oldTxid === id).sort(newestFirst)[0];
}

/** The record saying `txid` replaces an earlier transaction. */
export function replacing(
  list: TxReplacement[],
  walletId: string,
  txid: string,
): TxReplacement | undefined {
  const id = txid.toLowerCase();
  return mine(list, walletId).filter((r) => r.newTxid === id).sort(newestFirst)[0];
}

/** Every replacement that followed `txid`, in order (a speed-up of a speed-up is a chain). */
export function laterReplacements(list: TxReplacement[], walletId: string, txid: string): TxReplacement[] {
  const chain: TxReplacement[] = [];
  const seen = new Set<string>([txid.toLowerCase()]);
  let rec = replacedBy(list, walletId, txid);
  while (rec && !seen.has(rec.newTxid)) {
    chain.push(rec);
    seen.add(rec.newTxid);
    rec = replacedBy(list, walletId, rec.newTxid);
  }
  return chain;
}

/** Every replacement that led to `txid`, nearest first. */
export function earlierReplacements(list: TxReplacement[], walletId: string, txid: string): TxReplacement[] {
  const chain: TxReplacement[] = [];
  const seen = new Set<string>([txid.toLowerCase()]);
  let rec = replacing(list, walletId, txid);
  while (rec && !seen.has(rec.oldTxid)) {
    chain.push(rec);
    seen.add(rec.oldTxid);
    rec = replacing(list, walletId, rec.oldTxid);
  }
  return chain;
}

/** The newest transaction in `txid`'s chain: where "See the new transaction" goes. */
export function currentTxid(list: TxReplacement[], walletId: string, txid: string): string {
  const later = laterReplacements(list, walletId, txid);
  return later.length > 0 ? later[later.length - 1].newTxid : txid.toLowerCase();
}

/**
 * A RETURN: the transaction pays the coins of a cancelled payment back to
 * the vault (a cancel, or a speed-up of one). It can be sped up, never
 * cancelled.
 */
export function isReturn(list: TxReplacement[], walletId: string, txid: string): boolean {
  return earlierReplacements(list, walletId, txid).some((r) => r.kind === 'cancel');
}

/**
 * What a return leads with (decided 2026-09-28): the amount the payment its cancel
 * cancelled paid, read along the chain that led to `txid`. The same figure
 * the transaction page shows (`txRecordInfo.returnAmountSats`). Null when
 * `txid` is not a return.
 */
export function returnedPaymentSats(list: TxReplacement[], walletId: string, txid: string): number | null {
  return earlierReplacements(list, walletId, txid).find((r) => r.kind === 'cancel')?.amount ?? null;
}

export type ReplacementState =
  /** Nothing Talia knows of. */
  | { kind: 'none' }
  /**
   * `txid` was replaced and has not confirmed: the page reads "Replaced" or
   * "Cancelled" (by the kinds in `chain`) and links to `headTxid`. `chain`
   * is every replacement that followed `txid`, up to the one that confirmed
   * when one did: whatever came after that lost the race and never happened.
   * `last` is its final record, whose new transaction is `headTxid`.
   */
  | { kind: 'replaced'; record: TxReplacement; last: TxReplacement; headTxid: string; chain: TxReplacement[] }
  /** `txid` was cancelled but confirmed first: "The cancel came too late". */
  | { kind: 'too-late'; record: TxReplacement }
  /** `txid` replaces an earlier transaction; `isReturn` when it pays a cancel back. */
  | { kind: 'replacement'; record: TxReplacement; isReturn: boolean }
  /** `txid` replaced one that confirmed first: it will vanish; show `record.oldTxid`'s page. */
  | { kind: 'lost'; record: TxReplacement; originalTxid: string };

/**
 * What Talia's records say about `txid`, read against the vault's current
 * transactions (a replaced original is usually GONE from them after the
 * next sync, which is when this matters most).
 */
export function replacementState(
  list: TxReplacement[],
  walletId: string,
  txid: string,
  txs: WalletTx[],
): ReplacementState {
  const confirmed = (id: string) => txs.some((t) => t.txid.toLowerCase() === id && t.confirmed);
  const id = txid.toLowerCase();

  const later = laterReplacements(list, walletId, id);
  if (later.length > 0) {
    if (confirmed(id)) {
      const cancel = later.find((r) => r.kind === 'cancel');
      // A speed-up that lost the race changes nothing: the payment went through.
      return cancel ? { kind: 'too-late', record: cancel } : { kind: 'none' };
    }
    // The chain ends at the first replacement that confirmed: a speed-up
    // that went through is not undone by a cancel that lost to it.
    const wonAt = later.findIndex((r) => confirmed(r.newTxid));
    const chain = wonAt >= 0 ? later.slice(0, wonAt + 1) : later;
    const last = chain[chain.length - 1];
    return { kind: 'replaced', record: chain[0], last, headTxid: last.newTxid, chain };
  }

  const earlier = earlierReplacements(list, walletId, id);
  if (earlier.length > 0) {
    const won = earlier.find((r) => confirmed(r.oldTxid));
    if (won) return { kind: 'lost', record: won, originalTxid: won.oldTxid };
    return { kind: 'replacement', record: earlier[0], isReturn: earlier.some((r) => r.kind === 'cancel') };
  }
  return { kind: 'none' };
}

/**
 * Drop the records whose ORIGINAL confirmed and now sits at least
 * KEEP_UNTIL_CONFIRMATIONS deep, with every replacement that followed it
 * (the network discarded all of them). Until then the record stays, so the
 * page can say the cancel came too late. Records whose replacement won are
 * kept: they are the only way to the vanished original.
 */
export function pruneReplacements(
  list: TxReplacement[],
  walletId: string,
  txs: WalletTx[],
  tipHeight: number | undefined,
): { kept: TxReplacement[]; dropped: TxReplacement[] } {
  if (tipHeight == null) return { kept: list, dropped: [] };
  const buried = new Set(
    txs
      .filter(
        (t) =>
          t.confirmed &&
          t.blockHeight != null &&
          tipHeight - t.blockHeight + 1 >= KEEP_UNTIL_CONFIRMATIONS,
      )
      .map((t) => t.txid.toLowerCase()),
  );
  const drop = new Set<TxReplacement>();
  for (const r of mine(list, walletId)) {
    if (!buried.has(r.oldTxid) || drop.has(r)) continue;
    drop.add(r);
    for (const next of laterReplacements(list, walletId, r.newTxid)) drop.add(next);
  }
  return {
    kept: list.filter((r) => !drop.has(r)),
    dropped: list.filter((r) => drop.has(r)),
  };
}

/** The records of every vault but this one (a removed vault leaves nothing behind). */
export function withoutWallet(list: TxReplacement[], walletId: string): TxReplacement[] {
  return list.filter((r) => r.walletId !== walletId);
}

/**
 * Carry the original's note to the replacement: the new transaction shows
 * what the old one said. The original keeps its note, since it may still
 * be the one that confirms. A note the replacement already has wins.
 */
export function carryNote(notes: TxNotes, walletId: string, oldTxid: string, newTxid: string): TxNotes {
  const note = noteFor(notes, walletId, oldTxid);
  if (!note) return notes;
  if (notes.own[walletId]?.[newTxid] !== undefined) return notes;
  return writeNote(notes, walletId, newTxid, note);
}

// ---------------------------------------------------------------- planned replacements

/**
 * A replacement that is built but not yet sent. On a co-signed vault it is
 * not broadcast from the signing screen at all: the client's part ends at
 * the co-sign request, and the payment goes out later from Pending
 * transactions, where the route's own record is long gone. So the record is
 * written the moment the replacement is BUILT, keyed by the transaction it
 * will become (the unsigned txid, which is the final txid of a segwit or
 * taproot spend), and whichever screen broadcasts it turns the plan into the
 * record (`takePlan`). A plan nobody sends is dropped after PLAN_TTL_MS.
 */
export const PLAN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Add a plan; a second plan for the same new transaction replaces the first. */
export function withPlan(plans: TxReplacement[], plan: TxReplacement): TxReplacement[] {
  return withReplacement(plans, plan);
}

/** The plan that becomes `txid` once broadcast, if any. */
export function planFor(
  plans: TxReplacement[],
  walletId: string,
  txid: string,
): TxReplacement | undefined {
  const id = txid.toLowerCase();
  return plans.find((p) => p.walletId === walletId && p.newTxid === id);
}

/**
 * The broadcast of `txid` happened: its plan, stamped with the moment it
 * went out, and the plans that remain. Plans past PLAN_TTL_MS go too.
 *
 * `siblings` are the OTHER unsent replacements of the same payment (a
 * speed-up and a cancel both built, say, while the first waited for
 * co-signing). Once one version is out, an older one must never be sent
 * over it: it could undo a cancel (decided 2026-09-28). Their plans are
 * dropped here; the caller withdraws their Pending rows by these txids.
 */
export function takePlan(
  plans: TxReplacement[],
  walletId: string,
  txid: string,
  now: number,
): { record: TxReplacement | null; rest: TxReplacement[]; siblings: string[] } {
  const plan = planFor(plans, walletId, txid);
  const sibling = (p: TxReplacement) =>
    !!plan && p !== plan && p.walletId === walletId && p.oldTxid === plan.oldTxid;
  const rest = plans.filter((p) => p !== plan && !sibling(p) && now - p.at < PLAN_TTL_MS);
  return {
    record: plan ? { ...plan, at: now } : null,
    rest,
    siblings: plans.filter(sibling).map((p) => p.newTxid),
  };
}

/**
 * `keepTxid` went out as the replacement of `oldTxid`, and its own plan was
 * not there to say so: every other plan for `oldTxid` is a sibling (see
 * `takePlan`). The plans that remain, and the siblings' txids.
 */
export function withoutSiblingPlans(
  plans: TxReplacement[],
  walletId: string,
  oldTxid: string,
  keepTxid: string,
): { rest: TxReplacement[]; siblings: string[] } {
  const old = oldTxid.toLowerCase();
  const keep = keepTxid.toLowerCase();
  const sibling = (p: TxReplacement) => p.walletId === walletId && p.oldTxid === old && p.newTxid !== keep;
  return { rest: plans.filter((p) => !sibling(p)), siblings: plans.filter(sibling).map((p) => p.newTxid) };
}

/**
 * Another version of the same payment already went out: the record saying
 * `oldTxid` was replaced by something other than `newTxid`. Sending
 * `newTxid` then could undo it (a speed-up over a cancel sends the cancelled
 * payment after all), so it is refused (decided 2026-09-28).
 */
export function sentInstead(
  records: TxReplacement[],
  walletId: string,
  oldTxid: string,
  newTxid: string,
): TxReplacement | undefined {
  const rec = replacedBy(records, walletId, oldTxid);
  return rec && rec.newTxid !== newTxid.toLowerCase() ? rec : undefined;
}

/**
 * A Speed up or a Cancel on its way through the signing ceremony (decided
 * 2026-09-28, design A): SignPsbt's `replaces` route param. The ceremony's
 * words ("Speed up" / "Cancel payment", the Replaces or Cancels row, "{new}
 * sats, was {old} sats") and its bookkeeping after the broadcast (the record,
 * the note carried across) come from here; the PSBT is the rebuilt one.
 */
export interface ReplacementParams {
  kind: ReplacementKind;
  /** The transaction being replaced. */
  txid: string;
  /** What it paid the network. */
  oldFeeSats: number;
  /** What the payment paid its recipients: "The payment of 0.05 BTC". */
  amountSats: number;
  /** When it was sent (unix seconds), when Talia knows: "The payment of 13:55". */
  sentAt?: number;
  /** What it is called: a payment, a refresh or a return (a cancel's). */
  what?: ReplacedWhat;
  /** The record to write once it is broadcast (`replacementRecord`). */
  record: Omit<TxReplacement, 'at'>;
}

/**
 * The ceremony's `replaces`, rebuilt from the plan written when the
 * replacement was built. A Speed up or a Cancel resumed from Pending
 * transactions (a parked half-signed spend, "Sign with another key") comes
 * back to the signing screen without the route's own, and every one of its
 * outputs is the vault's for a cancel: without this the ceremony would call
 * it a refresh (decided 2026-09-28). `sentAtMs` is when the original went out,
 * when Talia stamped it.
 */
export function replacementParamsFromPlan(plan: TxReplacement, sentAtMs?: number | null): ReplacementParams {
  const record: Partial<TxReplacement> = { ...plan };
  delete record.at;
  return {
    kind: plan.kind,
    txid: plan.oldTxid,
    oldFeeSats: plan.oldFeeSats ?? 0,
    amountSats: plan.amount,
    ...(sentAtMs ? { sentAt: Math.floor(sentAtMs / 1000) } : {}),
    ...(plan.what ? { what: plan.what } : {}),
    record: record as Omit<TxReplacement, 'at'>,
  };
}

// ---------------------------------------------------------------- when Talia sent it

/**
 * When Talia broadcast each transaction, in ms, keyed `walletId:txid`. A
 * waiting transaction has no block time and BDK keeps no first-seen time,
 * so without this a plain payment's Speed up could only say "The payment of
 * 0.05 BTC", never the design's "The payment of 13:55", and its page had no
 * date (decided 2026-09-28). Display metadata only, never sent anywhere.
 */
export type SentTimes = Record<string, number>;

/** Kept this long: a payment still waiting after a month has other problems. */
export const SENT_AT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sentKey = (walletId: string, txid: string) => `${walletId}:${txid.toLowerCase()}`;

/** Read whatever the phone has stored; anything malformed is skipped. */
export function readSentTimes(raw: unknown): SentTimes {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: SentTimes = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    const at = k.lastIndexOf(':');
    if (at <= 0 || !isTxid(k.slice(at + 1))) continue;
    out[k.slice(0, at) + ':' + k.slice(at + 1).toLowerCase()] = v;
  }
  return out;
}

/** Stamp `txid` as sent at `ms`, dropping stamps older than SENT_AT_TTL_MS (measured from `now`). */
export function withSentAt(times: SentTimes, walletId: string, txid: string, ms: number, now = ms): SentTimes {
  const out: SentTimes = {};
  for (const [k, v] of Object.entries(times)) if (now - v < SENT_AT_TTL_MS) out[k] = v;
  out[sentKey(walletId, txid)] = ms;
  return out;
}

/** When Talia sent `txid` from this vault, or null when it does not know. */
export function sentAtFor(times: SentTimes, walletId: string, txid: string): number | null {
  return times[sentKey(walletId, txid)] ?? null;
}

/**
 * When this phone first saw each waiting transaction, in the same shape as
 * the sent times (decided 2026-10-29: a payment waiting for days showed no
 * time at all, unless it had been sent from this phone and its page was
 * opened). A transaction someone else sent, or one sent from another
 * device, has no send stamp; the first time the vault's list showed it
 * waiting is the next best thing, and the words say "first seen", never
 * "since", because it may have been waiting before the app was opened.
 * Display metadata only, never sent anywhere.
 */
export type SeenTimes = SentTimes;

/** `txids` stamped `now` unless already seen; stamps older than SENT_AT_TTL_MS dropped. Never moves a stamp later. */
export function withFirstSeen(times: SeenTimes, walletId: string, txids: readonly string[], now: number): SeenTimes {
  const out: SeenTimes = {};
  for (const [k, v] of Object.entries(times)) if (now - v < SENT_AT_TTL_MS) out[k] = v;
  for (const txid of txids) {
    if (!isTxid(txid)) continue;
    const key = sentKey(walletId, txid);
    if (out[key] == null) out[key] = now;
  }
  return out;
}

/** Every vault's stamps but this one's (a removed vault leaves nothing behind). */
export function sentTimesWithoutWallet(times: SentTimes, walletId: string): SentTimes {
  const prefix = `${walletId}:`;
  const out: SentTimes = {};
  for (const [k, v] of Object.entries(times)) {
    // The txid after the last colon is fixed-length, so the id is everything before it.
    if (!(k.startsWith(prefix) && k.length === prefix.length + 64)) out[k] = v;
  }
  return out;
}
