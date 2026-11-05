/**
 * What the status card of a transaction says, in every state (decided 2026-09-28,
 * Speed up and Cancel, design Option A). `TxStatusCard` draws it; this file
 * decides it, so every state and every sentence is pinned by a test.
 *
 * One card in every state, so nothing on the page changes shape:
 *
 *   received            "Received" and its confirmations. Nothing else.
 *   sent, waiting       "Sent / Waiting for confirmation", how long it takes
 *                       at its fee, Speed up, and "Cancel payment" under it.
 *   sent, confirmed     "Sent / N confirmations". Nothing else.
 *   not replaceable     the waiting line, then why it can neither be sped up
 *                       nor cancelled (behind an info dot).
 *   replaced            "Replaced / By the same payment with a higher fee",
 *                       and the way to the new transaction.
 *   cancelled           "Cancelled / The coins are on their way back to this
 *                       vault" (or "returned" once the return confirmed), and
 *                       the way to the return.
 *   return              "Return / Waiting for confirmation", what comes back,
 *                       Speed up only (never a cancel of a cancel).
 *   cancel too late     "Sent / 1 confirmation", and in gold: "The cancel
 *                       came too late".
 *
 * Speed up and Cancel are offered only where Send is (the caller's
 * `canSend`), and only where the core says the transaction can be replaced
 * (`wallet/replacement.ts`). Plain logic, no React Native, so it can be
 * tested.
 */
import type { WalletTx } from '../../bitcoin/engine/types';
import type { CannotReplace, ReplacementEligibility } from '../../wallet/replacement';
import { etaLine } from '../../wallet/txEta';
import { earlierReplacements, replacementState } from '../../wallet/txReplacementLogic';
import type { TxReplacement } from '../../wallet/txReplacementLogic';

export type TxStatusKind = 'sent' | 'received' | 'replaced' | 'cancelled' | 'return';
/** The circle's mark: an arrow out or in, the replaced arrow, or the refresh circle. */
export type TxStatusGlyph = 'up' | 'down' | 'replaced' | 'refresh';
/** What the transaction is, in the words of its sentences. */
export type TxNoun = 'payment' | 'refresh' | 'return';

/** A line with its reasoning behind an info dot. */
export interface TxStatusNotice {
  /** Gold with the warning mark ("The cancel came too late"), or plain. */
  tone: 'warning' | 'plain';
  text: string;
  infoTitle: string;
  info: string;
}

export interface TxStatusView {
  kind: TxStatusKind;
  glyph: TxStatusGlyph;
  title: string;
  sub: string;
  /** "About 3 hours at this fee", or null when there is nothing true to say. */
  eta: string | null;
  /** One plain line under the ETA ("0.05 BTC comes back to this vault"). */
  note: string | null;
  notice: TxStatusNotice | null;
  /** "See the new transaction", "See the return". */
  link: { label: string; txid: string } | null;
  speedUp: boolean;
  cancel: boolean;
}

/** What Talia's own records say about the transaction (`replacementState`, simplified). */
export type TxRecordState =
  | { kind: 'none' }
  /**
   * It was replaced; `cancelled` when a cancel is in the chain after it, up
   * to the replacement that confirmed (`headTxid`), when one did.
   */
  | { kind: 'replaced'; cancelled: boolean; headTxid: string; headConfirmed: boolean }
  /** It was cancelled but confirmed first. */
  | { kind: 'too-late' }
  /** It replaces an earlier transaction (a return when `isReturn`). */
  | { kind: 'replacement' };

export interface TxStatusInput {
  incoming: boolean;
  /** A timelock refresh: every coin back to the vault, nothing paid out. */
  refresh: boolean;
  confirmed: boolean;
  /** Confirmations when known (0 while waiting). */
  confirmations?: number;
  record: TxRecordState;
  /** It pays the coins of a cancelled payment back (`isReturn`). */
  isReturn: boolean;
  /** The core's verdict; null while it is still being worked out. */
  eligibility: ReplacementEligibility | null;
  /** This phone can send from the vault: Speed up only where Send is. */
  canSend: boolean;
  /** "about 3 hours" (txEta), or null. */
  etaPhrase: string | null;
  /** A return's payment amount, already formatted ("0.05 BTC"). */
  returnAmount?: string | null;
}

// ---------------------------------------------------------------- the words

export const NOT_REPLACEABLE_LINE = 'Cannot be sped up or cancelled';
export const WHY_NOT = 'Why not';
export const NOT_SIGNALLED_INFO =
  'This payment was sent without the option to replace it, so it can neither be sped up nor cancelled. It confirms once the network fee catches up. Every payment Talia sends can be replaced.';

export const TOO_LATE_LINE = 'The cancel came too late';
export const TOO_LATE_INFO =
  'A cancel is a race between two versions of the payment, and the network took the original first. The recipient has the coins. The return was never confirmed and will disappear from the list.';

export const ETA_INFO_TITLE = 'How long it takes';

/** Behind the dot beside "About 3 hours at this fee". */
export function etaInfoText(noun: TxNoun, rateText: string): string {
  return `This ${noun} pays ${rateText} sat/vB. The estimate compares that with the fees the network is taking right now, so it changes as other payments come and go. A higher fee moves it forward.`;
}

/** Why not, for each reason the core gives that a client can do nothing about. */
function cannotInfo(reason: CannotReplace, noun: TxNoun): string | null {
  switch (reason) {
    case 'not-signalled':
      return NOT_SIGNALLED_INFO;
    case 'recovery-path':
      return `This ${noun} was spent through a path that waits, the kind an heir or the rescue key uses, so it cannot be sped up or cancelled here. It confirms once the network fee catches up. A rescue sent from this phone may also be sped up on the Rescue page.`;
    case 'has-child':
      return `A newer waiting payment of this vault spends coins that this ${noun} creates, and replacing this ${noun} would throw the newer one away. It confirms once the network fee catches up.`;
    case 'foreign-coins':
      return `This ${noun} also spends coins that are not this vault's, so Talia cannot rebuild it. It confirms once the network fee catches up.`;
    case 'unreadable':
      return `This ${noun} pays an address Talia cannot read, so Talia cannot rebuild it. It confirms once the network fee catches up.`;
    default:
      // incoming, confirmed and replaced have their own states; missing data
      // (offline) says nothing rather than something untrue.
      return null;
  }
}

export const NOT_SPED_UP_LINE = 'Cannot be sped up';

/**
 * Why Speed up alone is missing: several recipients and no change, so a
 * higher fee has nowhere to come from but one of them (the core's
 * 'batch-without-change'). Says whether it can still be cancelled.
 */
function noSpeedUpInfo(noun: TxNoun, e: ReplacementEligibility): string {
  if (e.cancel) {
    return `This ${noun} pays several recipients and keeps no change, so a higher fee would have to come out of what one of them receives. It can still be cancelled.`;
  }
  const why = `This ${noun} pays several addresses and keeps no change, so a higher fee would have to come out of what one of them receives.`;
  return e.noCancel === 'self-transfer'
    ? `${why} Every coin stays in this vault, so there is nothing to cancel either. It confirms once the network fee catches up.`
    : `${why} It confirms once the network fee catches up.`;
}

/** "Waiting for confirmation", "1 confirmation", "6+ confirmations", "Confirmed". */
export function confirmationsLabel(confirmed: boolean, confirmations?: number): string {
  if (!confirmed || confirmations === 0) return 'Waiting for confirmation';
  if (confirmations == null) return 'Confirmed';
  if (confirmations >= 6) return '6+ confirmations';
  return `${confirmations} confirmation${confirmations === 1 ? '' : 's'}`;
}

/** What the transaction is called in its sentences. */
export function txNoun(input: Pick<TxStatusInput, 'refresh' | 'isReturn'>): TxNoun {
  if (input.isReturn) return 'return';
  return input.refresh ? 'refresh' : 'payment';
}

// ---------------------------------------------------------------- the card

export function txStatusView(input: TxStatusInput): TxStatusView {
  const sub = confirmationsLabel(input.confirmed, input.confirmations);
  const quiet = {
    eta: null,
    note: null,
    notice: null,
    link: null,
    speedUp: false,
    cancel: false,
  };

  if (input.incoming) {
    return { ...quiet, kind: 'received', glyph: 'down', title: 'Received', sub };
  }

  const { record } = input;
  const noun = txNoun(input);

  if (record.kind === 'replaced') {
    if (record.cancelled) {
      return {
        ...quiet,
        kind: 'cancelled',
        glyph: 'refresh',
        title: 'Cancelled',
        sub: record.headConfirmed
          ? 'The coins returned to this vault'
          : 'The coins are on their way back to this vault',
        link: { label: 'See the return', txid: record.headTxid },
      };
    }
    return {
      ...quiet,
      kind: 'replaced',
      glyph: 'replaced',
      title: 'Replaced',
      sub: `By the same ${noun} with a higher fee`,
      link: { label: 'See the new transaction', txid: record.headTxid },
    };
  }

  const { isReturn } = input;
  const kind: TxStatusKind = isReturn ? 'return' : 'sent';
  const glyph: TxStatusGlyph = isReturn || input.refresh ? 'refresh' : 'up';
  const title = isReturn ? 'Return' : input.refresh ? 'Refresh' : 'Sent';

  if (record.kind === 'too-late') {
    return {
      ...quiet,
      kind,
      glyph,
      title,
      sub,
      notice: { tone: 'warning', text: TOO_LATE_LINE, infoTitle: TOO_LATE_LINE, info: TOO_LATE_INFO },
    };
  }

  if (input.confirmed) {
    return { ...quiet, kind, glyph, title, sub };
  }

  // Waiting.
  const view: TxStatusView = {
    ...quiet,
    kind,
    glyph,
    title,
    sub,
    eta: etaLine(input.etaPhrase),
    note: isReturn && input.returnAmount ? `${input.returnAmount} comes back to this vault` : null,
  };
  const e = input.eligibility;
  if (!input.canSend || !e) return view;
  if (e.cannot) {
    const info = cannotInfo(e.cannot, noun);
    if (info) {
      view.notice = {
        tone: 'plain',
        text: isReturn ? NOT_SPED_UP_LINE : NOT_REPLACEABLE_LINE,
        infoTitle: WHY_NOT,
        info,
      };
    }
    return view;
  }
  view.speedUp = e.speedUp;
  view.cancel = e.cancel;
  // Speed up missing for a reason of its own: the card says why, where the
  // button would be, so a lone "Cancel payment" (or nothing) never stands
  // unexplained.
  if (!e.speedUp && e.noSpeedUp === 'batch-without-change') {
    view.notice = {
      tone: 'plain',
      text: e.cancel || isReturn ? NOT_SPED_UP_LINE : NOT_REPLACEABLE_LINE,
      infoTitle: WHY_NOT,
      info: noSpeedUpInfo(noun, e),
    };
  }
  return view;
}

// ---------------------------------------------------------------- the records

/** What the page needs from Talia's records about one transaction. */
export interface TxRecordInfo {
  state: TxRecordState;
  isReturn: boolean;
  /** The Details row naming the transaction this one replaced. */
  earlier: { label: 'Replaces' | 'Cancels'; txid: string } | null;
  /** When this transaction was sent (ms), when a record says so. */
  sentAt: number | null;
  /** A return: what the cancelled payment paid (the words lead with it, decided 2026-09-28). */
  returnAmountSats: number | null;
  /** The record saying this transaction was replaced (a vanished one is drawn from it). */
  replacedRecord: TxReplacement | null;
  /**
   * A Speed up or a Cancel Talia sent that the phone has not picked up from
   * the network yet: drawn from its record until it has (`standInReplacement`),
   * so "See the return" never opens on an empty "Loading..." (decided 2026-09-28).
   * `to` is where it pays, when the record knows (never for a return).
   */
  standIn: { tx: WalletTx; to: string | null } | null;
  /** The records say it is a refresh (or the speed-up of one), whatever its numbers say. */
  refresh: boolean;
  /**
   * It replaced one that confirmed first and will vanish: the page shows the
   * original instead, which says what happened.
   */
  showInstead: string | null;
}

/**
 * Read Talia's records for `txid` against the vault's transactions as the
 * last sync left them (a replaced original is usually GONE from them).
 */
export function txRecordInfo(
  list: TxReplacement[],
  walletId: string,
  txid: string,
  txs: WalletTx[],
): TxRecordInfo {
  const st = replacementState(list, walletId, txid, txs);
  const earlierChain = earlierReplacements(list, walletId, txid);
  const nearest = earlierChain[0];
  const cancel = earlierChain.find((r) => r.kind === 'cancel');
  const info: TxRecordInfo = {
    state: { kind: 'none' },
    isReturn: !!cancel,
    earlier: nearest ? { label: nearest.kind === 'cancel' ? 'Cancels' : 'Replaces', txid: nearest.oldTxid } : null,
    sentAt: nearest?.at ?? null,
    returnAmountSats: cancel?.amount ?? null,
    replacedRecord: null,
    standIn: null,
    refresh: false,
    showInstead: null,
  };
  const listed = txs.some((t) => t.txid.toLowerCase() === txid.toLowerCase());
  switch (st.kind) {
    case 'replaced': {
      const head = st.headTxid.toLowerCase();
      info.state = {
        kind: 'replaced',
        cancelled: st.chain.some((r) => r.kind === 'cancel'),
        headTxid: st.headTxid,
        headConfirmed: txs.some((t) => t.txid.toLowerCase() === head && t.confirmed),
      };
      info.replacedRecord = st.record;
      info.refresh = !info.isReturn && st.record.what === 'refresh';
      break;
    }
    case 'too-late':
      info.state = { kind: 'too-late' };
      break;
    case 'replacement': {
      info.state = { kind: 'replacement' };
      // A speed-up of a refresh is a refresh; a cancel's return is a return.
      info.refresh = !info.isReturn && st.record.what === 'refresh';
      if (!listed) {
        const tx = standInReplacement(st.record, info.isReturn || keepsEveryCoin(st.record));
        const payee = info.isReturn || info.refresh ? null : st.record.recipient;
        if (tx) info.standIn = { tx, to: payee };
      }
      break;
    }
    case 'lost':
      info.showInstead = st.originalTxid;
      break;
    default:
      break;
  }
  return info;
}

/** How the vault's list names a transaction Talia's records know: the page's own words. */
export interface TxRowWords {
  /** It pays a cancelled payment's coins back: "Return", with the refresh mark, never "Refresh". */
  isReturn: boolean;
  /** It was replaced and has not confirmed: said where the row says "Waiting for confirmation". */
  replacedAs: 'Cancelled' | 'Replaced' | null;
}

export function txRowWords(list: TxReplacement[], walletId: string, txid: string, txs: WalletTx[]): TxRowWords {
  const info = txRecordInfo(list, walletId, txid, txs);
  const st = info.state;
  return {
    isReturn: info.isReturn,
    replacedAs: st.kind === 'replaced' ? (st.cancelled ? 'Cancelled' : 'Replaced') : null,
  };
}

/** The replaced transaction kept every coin in the vault (a refresh or a return). */
function keepsEveryCoin(rec: TxReplacement): boolean {
  return rec.what === 'refresh' || rec.what === 'return';
}

/**
 * A Speed up or a Cancel Talia sent that the phone has not picked up yet,
 * drawn from its record: it takes `newSentSats` out of the vault (its fee
 * alone when every coin stays) and it has not confirmed. Records from
 * before `newSentSats` say it from the payment: the payment and the new fee
 * (a send-all speed-up then reads its old fee too high, until the sync).
 * Null when the record does not know the new fee.
 */
export function standInReplacement(rec: TxReplacement, keepsCoins: boolean): WalletTx | null {
  if (rec.newFeeSats == null) return null;
  const fee = rec.newFeeSats;
  const sent = keepsCoins ? fee : rec.newSentSats ?? rec.amount + fee;
  return {
    txid: rec.newTxid,
    received: 0,
    sent,
    netAmount: -sent,
    fee,
    confirmed: false,
  };
}

/**
 * A replaced transaction the sync already forgot, drawn from its record: it
 * paid `amount` and its fee, and it never confirmed.
 */
export function standInTx(rec: TxReplacement): WalletTx {
  const fee = rec.oldFeeSats ?? 0;
  const sent = rec.amount + fee;
  return {
    txid: rec.oldTxid,
    received: 0,
    sent,
    netAmount: -sent,
    ...(rec.oldFeeSats != null ? { fee: rec.oldFeeSats } : {}),
    confirmed: false,
  };
}

/**
 * A short moment for a waiting payment's line: the time alone today, the day
 * and time this year, the full date before that ("14:03", "26 Oct, 14:03",
 * "26 Oct 2025, 14:03"), in the phone's own time zone.
 */
export function waitingMoment(ms: number, now = Date.now()): string {
  const at = new Date(ms);
  const today = new Date(now);
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (at.toDateString() === today.toDateString()) return time;
  const day = at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
  return `${day}, ${time}`;
}

/**
 * The quiet line under a waiting payment in the vault's list (decided
 * 2026-10-29: a payment waiting for days showed no time at all). Sent from
 * this phone: "Waiting since <when>", the moment Talia broadcast it. Any
 * other (received, or sent from another device): "Waiting, first seen
 * <when>", the first time this phone's list showed it waiting, which may be
 * later than it began to wait, so it never says "since". Neither known:
 * "Waiting for confirmation", as before.
 */
export function waitingLine(times: { sentAt: number | null; firstSeen: number | null } | undefined, now = Date.now()): string {
  if (times?.sentAt != null) return `Waiting since ${waitingMoment(times.sentAt, now)}`;
  if (times?.firstSeen != null) return `Waiting, first seen ${waitingMoment(times.firstSeen, now)}`;
  return 'Waiting for confirmation';
}
