/**
 * What the Speed up and Cancel sheet says (decided 2026-09-28, design Option A).
 * The shared `FeeSheet` draws it; the core (`wallet/replacement.ts`) supplies
 * every figure; this turns the figures into the sheet's words, so they are
 * pinned by a test and never re-derived in the screen.
 *
 *   title     "Speed up" / "Cancel payment"
 *   caption   "Now 1 sat/vB · about 3 hours" / "0.05 BTC comes back to this
 *             vault" (decided 2026-09-28: a cancel leads with the PAYMENT's amount)
 *   rows      High / Medium / Slow: "{eta} · {rate} sat/vB", the right column
 *             the EXTRA fee for a speed-up ("+ €1.53" over "+ 1,606 sats"),
 *             the cancel's whole fee for a cancel; a tier at or under the
 *             minimum is muted and reads "Below the current fee"
 *   custom    placeholder = the minimum, "sat/vB · at least {min}"
 *   footer    what stays the same, and on a co-signed vault that it is signed
 *             again (decided 2026-09-28); the reasoning behind info dots
 *   button    "Speed up · + €1.53" / "Continue"
 *
 * Plain logic, no React Native.
 */
import { formatFeeRate, MAX_FEE_RATE } from '../../wallet/feeEstimates';
import type { FeePresets } from '../../wallet/feeEstimates';
import {
  customReplacementRow,
  customRateProblem,
  minimumRate,
  replacementRows,
  ReplacementError,
  speedUpShape,
} from '../../wallet/replacement';
import type { OriginalTx, ReplacementRow, TierKey } from '../../wallet/replacement';
import type { ReplacementKind } from '../../wallet/txReplacementLogic';
import { isSendPaused, SEND_PAUSED_TITLE } from '../../bitcoin/engine/addressCheck';

export type SheetChoice = TierKey | 'custom';

/** A line under the rows with its reasoning behind an info dot. */
export interface SheetLine {
  text: string;
  infoTitle: string;
  info: string;
}

export interface SheetRowText {
  key: TierKey;
  label: string;
  meta: string;
  main: string | null;
  sub: string | null;
  muted: boolean;
  on: boolean;
}

export interface ReplacementSheetText {
  title: string;
  caption: string;
  rows: SheetRowText[];
  custom: {
    placeholder: string;
    unitMeta: string;
    on: boolean;
    main: string | null;
    sub: string | null;
    bad: string | null;
  };
  footer: SheetLine[];
  button: string;
  /** The row the button acts on; null while the typed rate cannot be used. */
  selected: ReplacementRow | null;
}

// ---------------------------------------------------------------- the words

export const SAME_PAYMENT_TITLE = 'Same payment, higher fee';
export const SAME_PAYMENT_INFO =
  'The recipient and the amount do not change. Talia rebuilds the same payment with a higher fee, and the difference comes out of your change.';
export const SEND_ALL_INFO =
  'This payment sent everything, so there is no change to pay a higher fee from. The higher fee comes out of the payment, and the recipient receives that much less.';
export const CANCEL_LINE = 'Works while the payment is still waiting';
export const CANCEL_TITLE = 'Not guaranteed';
export const CANCEL_INFO =
  'A cancel is a second version of the payment that pays the coins back to this vault with a higher fee. The network keeps whichever version confirms first. While the payment is waiting, the higher fee usually wins, but it is not guaranteed.';
export const SIGNED_AGAIN_LINE = 'Signed again, like the payment';
export const SIGNED_AGAIN_TITLE = 'Signed again';
export const BELOW_MINIMUM = 'Below the current fee';
/** A rescue's speed-up: only 21st Capital signs the rescue path. */
export const RESCUE_SIGNED_AGAIN: SheetLine = {
  text: 'Signed again by 21st Capital',
  infoTitle: SIGNED_AGAIN_TITLE,
  info: 'A speed-up is a new transaction. It takes the email link and your codes again, and 21st Capital signs it again. If the rescue confirms in the meantime, there is nothing left to replace and nothing is sent.',
};

function signedAgainInfo(kind: ReplacementKind): string {
  const what = kind === 'cancel' ? 'A cancel' : 'A speed-up';
  return `${what} is a new transaction, so it is signed again the way the payment was. Where 21st Capital co-signs, that means the email codes and our co-signature again. If the payment confirms in the meantime, there is nothing left to replace and nothing is sent.`;
}

/** "2", "2.5": a rate typed with a comma is read as a decimal. NaN when it is not a number. */
export function readRate(text: string): number {
  const t = text.trim().replace(',', '.');
  if (t === '' || !/^\d*\.?\d*$/.test(t)) return NaN;
  return parseFloat(t);
}

/** The row a fresh sheet opens on: High, unless even High is under the minimum. */
export function defaultChoice(rows: ReplacementRow[]): SheetChoice {
  const first = rows.find((r) => !r.belowMinimum);
  return (first?.key as TierKey | undefined) ?? 'custom';
}

export function replacementSheet(args: {
  kind: ReplacementKind;
  orig: OriginalTx;
  presets: Pick<FeePresets, TierKey>;
  choice: SheetChoice;
  /** The custom rate as typed; empty means the minimum. */
  customText: string;
  /** "about 3 hours", the payment's own wait at its fee; null when unknown. */
  etaPhrase: string | null;
  /** 21st Capital co-signs this vault's everyday path (decided 2026-09-28). */
  cosigned: boolean;
  /** A line of its own about the signing, in place of the co-signing one. */
  signedAgain?: SheetLine;
  /** The row's first figure: in the client's currency, or sats when there is none. */
  money: (sats: number) => string;
  /** The row's second figure (sats), or null when the first already is sats. */
  moneySub: ((sats: number) => string) | null;
  /** An amount as the app shows amounts ("0.05 BTC"). */
  amount: (sats: number) => string;
}): ReplacementSheetText {
  const { kind, orig, choice, customText } = args;
  const minRate = minimumRate(orig.feeRate);
  const minText = formatFeeRate(minRate);
  const all = replacementRows(orig, kind, args.presets);
  const plus = kind === 'speedup' ? '+ ' : '';

  const rows: SheetRowText[] = all.map((r) => ({
    key: r.key as TierKey,
    label: r.label,
    meta: r.belowMinimum ? BELOW_MINIMUM : `${r.eta} · ${formatFeeRate(r.rate)} sat/vB`,
    // A muted row's figures would be the minimum's, not its own: none.
    main: r.belowMinimum ? null : `${plus}${args.money(r.costSats)}`,
    sub: r.belowMinimum || !args.moneySub ? null : `${plus}${args.moneySub(r.costSats)}`,
    muted: r.belowMinimum,
    on: choice === r.key && !r.belowMinimum,
  }));

  const typed = customText.trim() !== '';
  const customShown = typed || choice === 'custom';
  const typedRate = readRate(customText);
  const customRate = typed ? typedRate : minRate;
  const problem = typed ? customRateProblem(typedRate, minRate) : null;
  const customRow = problem ? null : customReplacementRow(orig, kind, customRate);
  const bad =
    problem === 'below-minimum'
      ? `At least ${minText}`
      : problem != null
        ? `${minText} to ${MAX_FEE_RATE}`
        : null;

  const selected =
    choice === 'custom'
      ? customRow
      : all.find((r) => r.key === choice && !r.belowMinimum) ?? null;

  const footer: SheetLine[] = [];
  if (kind === 'speedup') {
    const shape = speedUpShape(orig);
    if (shape === 'self') {
      footer.push({
        text: 'The coins still come back to this vault',
        infoTitle: 'Same transaction, higher fee',
        info: 'Talia rebuilds the same transaction with a higher fee. Every coin still comes back to this vault, less the higher fee.',
      });
    } else if (shape === 'send-all') {
      // A send-all always pays the recipient less (decided 2026-09-28), whatever is
      // typed: while the typed rate cannot be used, the figure is the
      // minimum's, the rate the placeholder shows.
      const row = selected ?? customReplacementRow(orig, kind, minRate);
      footer.push({
        text: row
          ? `Recipient receives ${args.amount(row.recipientSats)} instead of ${args.amount(orig.paymentSats)}`
          : `Recipient receives less than ${args.amount(orig.paymentSats)}`,
        infoTitle: SAME_PAYMENT_TITLE,
        info: SEND_ALL_INFO,
      });
    } else {
      footer.push({
        text: `Recipient still receives ${args.amount(orig.paymentSats)}`,
        infoTitle: SAME_PAYMENT_TITLE,
        info: SAME_PAYMENT_INFO,
      });
    }
  } else {
    footer.push({ text: CANCEL_LINE, infoTitle: CANCEL_TITLE, info: CANCEL_INFO });
  }
  if (args.signedAgain) {
    footer.push(args.signedAgain);
  } else if (args.cosigned) {
    footer.push({ text: SIGNED_AGAIN_LINE, infoTitle: SIGNED_AGAIN_TITLE, info: signedAgainInfo(kind) });
  }

  const nowRate = `Now ${formatFeeRate(orig.feeRate)} sat/vB`;
  return {
    title: kind === 'speedup' ? 'Speed up' : 'Cancel payment',
    caption:
      kind === 'speedup'
        ? args.etaPhrase
          ? `${nowRate} · ${args.etaPhrase}`
          : nowRate
        : `${args.amount(orig.paymentSats)} comes back to this vault`,
    rows,
    // Custom's figures once it is picked or typed: an untouched field is a
    // placeholder, not a choice.
    custom: {
      placeholder: minText,
      unitMeta: `sat/vB · at least ${minText}`,
      on: choice === 'custom',
      main: customRow && customShown ? `${plus}${args.money(customRow.costSats)}` : null,
      sub: customRow && customShown && args.moneySub ? `${plus}${args.moneySub(customRow.costSats)}` : null,
      bad,
    },
    footer,
    button:
      kind === 'speedup'
        ? selected
          ? `Speed up · + ${args.money(selected.extraSats)}`
          : 'Speed up'
        : 'Continue',
    selected,
  };
}

/** The cancel dialog's two facts (decided 2026-09-28): the payment's amount, then the fee. */
export function cancelFacts(
  orig: OriginalTx,
  row: ReplacementRow,
  amount: (sats: number) => string,
  fee: (sats: number) => string,
): Array<{ label: string; value: string }> {
  return [
    { label: 'Comes back to this vault', value: amount(orig.paymentSats) },
    { label: 'Network fee', value: fee(row.feeSats) },
  ];
}

/**
 * A failed rebuild, in the page's terms: a title and OK, never a paragraph
 * (house rule), and never the engine's own words, which can be raw BDK text
 * full of jargon (decided 2026-09-28).
 */
export function replacementBuildNotice(e: unknown, kind: ReplacementKind): { title: string } {
  // The independent address check found the vault's addresses differ: Speed
  // up and Cancel pause with Send (option (b), approved 2026-10-17).
  if (isSendPaused(e)) return { title: SEND_PAUSED_TITLE };
  if (e instanceof ReplacementError) {
    switch (e.code) {
      case 'insufficient-funds':
        return { title: 'Not enough left for a higher fee' };
      case 'coins-unavailable':
        return { title: 'Talia could not use the coins of this payment' };
      case 'not-eligible':
        return { title: kind === 'speedup' ? 'This cannot be sped up' : 'This cannot be cancelled' };
      default:
        // Built something other than the replacement asked for: never signed.
        return { title: 'Could not rebuild this payment' };
    }
  }
  return { title: kind === 'speedup' ? 'Could not speed it up' : 'Could not cancel it' };
}
