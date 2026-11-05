/**
 * Everything the Sent page decides that needs no React Native (decided 2026-10-02,
 * design C "Sketch and ink", with the sub line moved above Done as in B).
 * `SentMark` draws the mark and `SentPage` lays the page out; this file holds
 * the timeline they run on and every word and figure they show, so each case
 * is pinned by a test (`__tests__/sentPageModel.test.ts`).
 *
 * The page, top to bottom: the drawn tick, the title, the hero amount, the
 * fiat line, the card ("Receipt" when someone outside the vault was paid,
 * "Details" otherwise), flexible space, the sub line, the actions.
 *
 * What the hero shows (sentences true in any scenario, decided 2026-09-22):
 *   - what the transaction paid OUT of the vault to others;
 *   - a cancel, and the speed-up of one (a return): the PAYMENT it cancels
 *     (decided 2026-09-28 for Speed up and Cancel), never the coins coming back;
 *   - a transaction that pays nobody else (a refresh, a sped-up refresh, a
 *     rescue back to the vault): what it moved within the vault;
 *   - several transactions: their total.
 * A figure that is not known for sure is left out, never guessed.
 */
import { formatAmount, formatBtc, formatSats, groupDigits, resolveUnit } from '../../wallet/format';
import { REFRESH_EXPLAINER } from '../../wallet/timelockNotice';
import type { AmountUnit } from '../../wallet/types';

// ------------------------------------------------------------------ timeline

/** One named track of the timeline: runs 0 -> 1 over [start, end] ms. */
export interface Track {
  start: number;
  end: number;
  easing?: (t: number) => number;
}

/** Easing.out(Easing.cubic), written out so it runs without React Native. */
export const outCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
/** Easing.inOut(Easing.cubic), the same curve React Native draws. */
export const inOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(2 - 2 * t, 3) / 2;
const linear = (t: number): number => t;

/** Where a track stands at `at` ms: what the live animation shows then. */
export function progressAt(track: Track, at: number): number {
  const d = Math.max(1, track.end - track.start);
  const p = Math.min(1, Math.max(0, (at - track.start) / d));
  return (track.easing ?? linear)(p);
}

/**
 * A track that takes no time and starts at once (Reduce Motion's words, the
 * pen it never shows) is SET, not animated: it is there from the first frame,
 * even while the page is still sliding in.
 */
export const isInstant = (track: Track): boolean => track.start === 0 && track.end - track.start <= 1;

// The tick, inside a 100 x 100 box: (22,52) -> (42,72) -> (80,30).
export const TICK_D = 'M22 52 L42 72 L80 30';
/** The same tick traced from its far end: the sketch pass. */
export const TICK_D_REV = 'M80 30 L42 72 L22 52';
/** The stroke's length, rounded up (28.28 + 56.64). */
export const TICK_LEN = 85;
/** Where the short arm ends, as a share of the whole stroke. */
export const CORNER = 28.28 / 84.92;

/** The mark's box on the page, in points, and the pen dot's size in it. */
export const INK_BOX = 220;
export const PEN = 14;
/** The smallest box a short screen draws (an iPhone SE, a page with a failures card). */
export const MIN_INK_BOX = 110;
/** The sketch traced backwards, then the ink drawn forwards over it. */
export const SKETCH_MS = 500;
export const INK_MS = 450;
const PEN_MS = SKETCH_MS + INK_MS;
const SPLIT = SKETCH_MS / PEN_MS;

/**
 * Both passes of the pen on one track: 0 -> 0.5 is the sketch (eased in and
 * out), 0.5 -> 1 the ink (eased out). The sketch line reads the first half,
 * the ink the second, and the pen dot rides the whole of it. `split` is the
 * share of the track's time the sketch takes; the "Vault built" lock's pen
 * runs on the same curve at its own split.
 */
export const penEaseAt =
  (split: number) =>
  (t: number): number =>
    t < split ? 0.5 * inOutCubic(t / split) : 0.5 + 0.5 * outCubic((t - split) / (1 - split));
/** The Sent tick's pen: sketch 500, ink 450. */
export const penEase = penEaseAt(SPLIT);

/** The pen dot's path: far end -> corner -> start, then back over it. */
export const PEN_IN = [0, 0.5 * (1 - CORNER), 0.5, 0.5 + 0.5 * CORNER, 1];

/**
 * The pen dot in a box of `box` points: its size (it scales with the
 * stroke, 14 at the design's 220) and where it stands at each PEN_IN step.
 */
export function penPath(box: number): { size: number; x: number[]; y: number[] } {
  const size = (PEN * box) / INK_BOX;
  const at = (u: number) => (u * box) / 100 - size / 2;
  return { size, x: [80, 42, 22, 42, 80].map(at), y: [30, 72, 52, 72, 30].map(at) };
}

/**
 * The tick fills the middle of its box, so the box tucks into the space
 * around it (design C's inkBox): 16 points above and 24 below at 220.
 */
const TUCK_TOP = 16;
const TUCK_BOTTOM = 24;
export function markTuck(box: number): { top: number; bottom: number } {
  return { top: (TUCK_TOP * box) / INK_BOX, bottom: (TUCK_BOTTOM * box) / INK_BOX };
}

/** The height the mark takes on the page: 180 at 220. */
export function markHeight(box: number): number {
  return (box * (INK_BOX - TUCK_TOP - TUCK_BOTTOM)) / INK_BOX;
}

/**
 * How big the mark is drawn, so Done ends where the page ends (decided
 * 2026-10-02: on an iPhone SE, and on a page with a failures card, the 220
 * box pushed it below the bottom edge). The page is laid out once with the
 * smallest mark, before anything on it shows: `pageH` is the height the
 * screen gives it, `contentH` what its content needs with the flexible space
 * at its minimum. The room left over goes to the mark, up to the design's
 * 220; no room leaves the smallest, and the page scrolls.
 */
export function sentMarkBox(pageH: number, contentH: number): number {
  const room = pageH - contentH;
  if (!(room > 0.5)) return MIN_INK_BOX;
  const grow = (room * INK_BOX) / markHeight(INK_BOX);
  return Math.min(INK_BOX, Math.floor(MIN_INK_BOX + grow));
}

/**
 * A page's clock (`useSentTimeline` runs it): named tracks, each 0 -> 1 over
 * its window, the haptic and the moment the actions go live. A track the
 * timeline leaves out stays at 0. The Sent page and the "Vault built" page
 * run on this one engine, each with its own tracks.
 */
export interface PageTimeline<K extends string> {
  tracks: Partial<Record<K, Track>>;
  /** The haptic: the moment the mark is complete. */
  tickAt: number;
  /** The actions become tappable, and VoiceOver reads the title. */
  doneAt: number;
}

export type SentTrackKey = 'penIn' | 'pen' | 'penOut' | 'text1' | 'text2';
export const SENT_TRACK_KEYS: readonly SentTrackKey[] = ['penIn', 'pen', 'penOut', 'text1', 'text2'];

/** The Sent page's clock: every one of its tracks moves. */
export interface SentTimeline extends PageTimeline<SentTrackKey> {
  tracks: Record<SentTrackKey, Track>;
}

/**
 * Design C's timeline (tracksC). Live: the pen appears, sketches, inks and
 * lifts off; the title, hero and fiat rise at 1000, the card, the sub line
 * and the actions at 1150; the haptic at 1100 as the ink completes; Done is
 * live at 1450. Reduce Motion: no pen and no sketch, the ink drawn in 350 ms,
 * the words already there, Done live and the haptic at 350.
 */
export function sentTimeline(reduce: boolean): SentTimeline {
  if (reduce) {
    return {
      tracks: {
        penIn: { start: 0, end: 1 },
        pen: { start: 0, end: 350, easing: (t) => 0.5 + 0.5 * outCubic(t) },
        penOut: { start: 0, end: 1 },
        text1: { start: 0, end: 1 },
        text2: { start: 0, end: 1 },
      },
      tickAt: 350,
      doneAt: 350,
    };
  }
  return {
    tracks: {
      penIn: { start: 0, end: 150, easing: outCubic },
      pen: { start: 150, end: 150 + PEN_MS, easing: penEase },
      penOut: { start: 1100, end: 1250, easing: outCubic },
      text1: { start: 1000, end: 1300, easing: outCubic },
      text2: { start: 1150, end: 1450, easing: outCubic },
    },
    tickAt: 1100,
    doneAt: 1450,
  };
}

// ------------------------------------------------------------------ the facts

/** What kind of broadcast the page reports. */
export type SentKind = 'payment' | 'speedup' | 'cancel' | 'refresh' | 'rescue';

/** One output that pays an address outside the vault. */
export interface SentRecipient {
  address: string | null;
  amountSats: number;
}

/** What the screen really knows about what it just sent. */
export interface SentFacts {
  kind: SentKind;
  /** Every transaction the page reports, in the order they went out. */
  txids: string[];
  /**
   * The outputs that pay someone outside the vault, every transaction
   * together. Empty when it paid nobody else; null when the screen cannot
   * tell which outputs are the vault's own.
   */
  recipients: SentRecipient[] | null;
  /** What came back to the vault's own addresses; null when not known. */
  movedSats: number | null;
  /**
   * A speed-up of a cancel (a return). Every coin comes back to the vault,
   * so it reads as the cancel it is: it leads with the cancelled payment and
   * says the coins come back, never the coins it moved.
   */
  isReturn?: boolean;
  /** A cancel or a return: what the payment it cancels paid (decided 2026-09-28). */
  cancelledSats?: number | null;
  /** The network fee, every transaction together; null unless known for all. */
  feeSats: number | null;
}

/** A sum, or null when any part of it is unknown. */
export function sumKnown(values: ReadonlyArray<number | null | undefined>): number | null {
  let total = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) return null;
    total += v;
  }
  return total;
}

/**
 * Several transactions on one page (Send all, a refresh session): every
 * txid, every recipient, the moved total and the fee total, each null as
 * soon as one part of it is unknown. A refresh only when every one is.
 */
export function mergeSentFacts(list: ReadonlyArray<SentFacts>): SentFacts | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const recipients = list.some((f) => f.recipients == null) ? null : list.flatMap((f) => f.recipients ?? []);
  return {
    kind: list.every((f) => f.kind === 'refresh') ? 'refresh' : 'payment',
    txids: list.flatMap((f) => f.txids),
    recipients,
    movedSats: sumKnown(list.map((f) => f.movedSats)),
    feeSats: sumKnown(list.map((f) => f.feeSats)),
  };
}

/** Did this page's transaction pay someone outside the vault? Never a cancel or a return. */
export function paidSomeoneElse(f: SentFacts): boolean {
  return f.kind !== 'cancel' && !f.isReturn && f.recipients != null && f.recipients.length > 0;
}

/** The hero figure in sats, or null when it is not known for sure. */
export function sentHeroSats(f: SentFacts): number | null {
  // A cancel and a return: the payment, or nothing; never the coins coming back.
  if (f.kind === 'cancel' || f.isReturn) return f.cancelledSats != null && f.cancelledSats > 0 ? f.cancelledSats : null;
  if (f.recipients == null) return null;
  if (f.recipients.length > 0) return sumKnown(f.recipients.map((r) => r.amountSats));
  return f.movedSats != null && f.movedSats > 0 ? f.movedSats : null;
}

/** Shown wherever a balance is hidden, as the transaction page does. */
export const MASK_HERO = '•••••';
export const MASK_SMALL = '••••';

/** The hero split into the figure and the unit beside it, in the owner's unit. */
export function heroParts(sats: number, unit: AmountUnit): { figure: string; unit: string } {
  if (resolveUnit(sats, unit) === 'btc') return { figure: formatBtc(sats).replace(/ BTC$/, ''), unit: 'BTC' };
  return { figure: groupDigits(sats), unit: Math.abs(sats) === 1 ? 'sat' : 'sats' };
}

/** A fiat line only where the app shows fiat at all: the main network, not Bitcoin Only. */
export function fiatShown(network: string, btcOnly: boolean | undefined): boolean {
  return network === 'bitcoin' && !btcOnly;
}

/** "bc1qxy2k…hx0wlh": the start and the end, as the design draws it. */
export const shortId = (s: string): string => (s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);

export function sentCardTitle(f: SentFacts): 'Receipt' | 'Details' {
  return paidSomeoneElse(f) ? 'Receipt' : 'Details';
}

export interface SentRow {
  label: string;
  value: string;
  /** Drawn in the mono face (an address, a transaction id). */
  mono?: boolean;
  /** A line under the row, across the card (why a coin did not go out). */
  note?: string;
}

/**
 * The card's rows. To: one recipient's address shortened, several = "N
 * recipients", never for a transaction that pays nobody else. One
 * transaction: its id; several: how many. The fee when it is known, as dots
 * when balances are hidden.
 */
export function sentRows(f: SentFacts, masked: boolean): SentRow[] {
  const rows: SentRow[] = [];
  if (paidSomeoneElse(f)) {
    const recipients = f.recipients ?? [];
    const named = [...new Set(recipients.map((r) => r.address).filter((a): a is string => !!a))];
    const unnamed = recipients.filter((r) => !r.address).length;
    const count = named.length + unnamed;
    if (count === 1 && named.length === 1) rows.push({ label: 'To', value: shortId(named[0]), mono: true });
    else rows.push({ label: 'To', value: `${count} recipient${count === 1 ? '' : 's'}` });
  }
  if (f.txids.length === 1) rows.push({ label: 'Transaction ID', value: shortId(f.txids[0]), mono: true });
  else if (f.txids.length > 1) rows.push({ label: 'Transactions', value: String(f.txids.length) });
  if (f.feeSats != null) rows.push({ label: 'Network fee', value: masked ? MASK_SMALL : formatSats(f.feeSats) });
  return rows;
}

/** One coin that did not go out, as the screen that sent it knows it. */
export interface SentFailure {
  /** Its place in what was sent: "Coin 2". */
  coin: number;
  /** What it carries; null when the screen does not know. */
  amountSats: number | null;
  /** What went wrong, as the network or the phone said it. */
  reason: string;
}

/** The heading of the card that lists what did not go out. */
export const FAILURES_TITLE = 'Could not send';

/**
 * A reason as the card shows it: the words the network or the phone gave,
 * kept as they are (they are what is true), with a capital first letter and
 * never an em or en dash, which no client text carries. Empty says so.
 */
export function failureReason(raw: string): string {
  const s = raw.replace(/\s*[\u2014\u2013]\s*/g, ', ').trim();
  if (!s) return 'Not sent';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The failures card's rows, in the receipt's own shape: "Coin 2" and its
 * amount in the owner's unit (`formatAmount`, as the hero), dots when
 * balances are hidden, nothing when the amount is unknown; the reason under
 * the row.
 */
export function sentFailureRows(list: ReadonlyArray<SentFailure>, masked: boolean, unit: AmountUnit): SentRow[] {
  return list.map((f) => ({
    label: `Coin ${f.coin}`,
    value: f.amountSats == null ? '' : masked ? MASK_SMALL : formatAmount(f.amountSats, unit),
    note: failureReason(f.reason),
  }));
}

/** What Copy puts on the clipboard: the transaction id, several one per line. */
export const sentCopyText = (f: SentFacts): string => f.txids.join('\n');

/**
 * The receipt shared with a recipient, or null when there is nobody to share
 * it with: only a transaction that paid someone outside the vault, and only
 * one transaction. "Bitcoin payment sent" is true for a payment and a
 * speed-up; a rescue moves the owner's own coins to the destination they
 * chose, so it says "Bitcoin sent". A cancel and a refresh are never shared.
 * No transaction id line when there is a tracking link: the link carries it
 * (decided 2026-09-21).
 */
export function sentShareText(
  f: SentFacts,
  link: string | null,
  amount: (sats: number) => string,
): string | null {
  if (!paidSomeoneElse(f) || f.txids.length !== 1) return null;
  const lines: string[] = [f.kind === 'rescue' ? 'Bitcoin sent' : 'Bitcoin payment sent'];
  for (const r of f.recipients ?? []) {
    if (r.address) lines.push(`To: ${r.address}`);
    lines.push(`Amount: ${amount(r.amountSats)}`);
  }
  lines.push(link ? `Track it: ${link}` : `Transaction: ${f.txids[0]}`);
  return lines.join('\n');
}

/** The share sheet's subject (an email's subject line), true for its case. */
export const sentShareSubject = (f: SentFacts): string =>
  f.kind === 'rescue' ? 'Bitcoin sent' : 'Payment confirmation';

// ------------------------------------------------------------------ the words

export interface SentWords {
  title: string;
  /** The ⓘ beside the title, when the title needs one. */
  titleInfo?: { title: string; text: string };
  sub: string;
}

const PENDING_SUB = 'On its way. It shows as pending in the vault until it confirms.';
const CANCEL_SUB = 'On its way. The coins come back to this vault once it confirms.';
const NEXT_SUB = 'On its way. The next coin has its own transaction. Sign it the same way.';
const REFRESH_INFO = { title: 'What a refresh does', text: REFRESH_EXPLAINER };

/**
 * One transaction: the signing screen (`queue` = its place in a refresh of
 * several coins) and a co-signed one sent from Pending transactions.
 * A refresh says "refreshed", never "sent" (decided 2026-07-26: nothing leaves
 * the vault); a cancel says its coins come back, and so does the speed-up
 * of one (`isReturn`).
 */
export function sentWords(
  kind: SentKind,
  queue?: { index: number; total: number },
  isReturn = false,
): SentWords {
  const several = queue != null && queue.total > 1;
  const more = queue != null && queue.index + 1 < queue.total;
  switch (kind) {
    case 'cancel':
      return { title: 'Cancel sent', sub: CANCEL_SUB };
    case 'speedup':
      return { title: 'Sped up', sub: isReturn ? CANCEL_SUB : PENDING_SUB };
    case 'refresh':
      return {
        title: several ? `Coin ${queue!.index + 1} of ${queue!.total} refreshed` : 'Refreshed',
        titleInfo: REFRESH_INFO,
        sub: more ? NEXT_SUB : PENDING_SUB,
      };
    case 'rescue':
      return { title: 'Rescue sent', sub: 'Your coins are on their way to the destination you chose.' };
    case 'payment':
    default:
      return {
        title: several ? `Transaction ${queue!.index + 1} of ${queue!.total} sent` : 'Sent',
        sub: more ? NEXT_SUB : PENDING_SUB,
      };
  }
}

/** "Send all" of a refresh session from Pending transactions. */
export function batchSentWords(sent: number, failed: number): SentWords {
  return {
    title: failed === 0 ? 'Refresh sent' : `${sent} of ${sent + failed} sent`,
    sub:
      sent === 1
        ? '1 transaction on the way. It shows as pending in the vault until it confirms.'
        : `${sent} transactions on the way. They show as pending in the vault until they confirm.`,
  };
}

/**
 * The refresh session sending itself. Partly sent: the coins that did not go
 * out are listed on the card above the sub line. None sent is not a Sent
 * page at all (`sessionNothingSent`).
 */
export function sessionSentWords(sent: number, total: number): SentWords {
  if (sent >= total) {
    return {
      title: 'Refresh sent',
      sub:
        total === 1
          ? 'On its way. The coin’s clock starts again once its transaction confirms.'
          : `All ${total} transactions are on their way. Each coin’s clock starts again once its transaction confirms.`,
    };
  }
  return {
    title: 'Partly sent',
    sub: `${sent} of ${total} went out. The rest are listed above with what the network said.`,
  };
}

/** The refresh session when nothing went out: no tick, the reasons listed below. */
export function sessionNothingSent(total: number): SentWords {
  return {
    title: 'Not sent',
    sub:
      total === 1
        ? 'It did not go out. What the network said is below.'
        : `None of the ${total} went out. Each is listed below with what the network said.`,
  };
}
