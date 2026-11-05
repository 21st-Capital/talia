/**
 * The two numbers behind a history row's layout (`LedgerRow`), pure so they
 * are tested without a phone.
 */

/**
 * How far the row's first line sits below the top of the direction mark, so
 * it lines up with the mark's centre: half the room the mark has over the
 * line, at the phone's text size. Never negative: at large text the line is
 * taller than the mark and simply starts at the top.
 */
export function firstLineLift(markSize: number, lineHeight: number, fontScale: number): number {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return Math.max(0, (markSize - lineHeight * scale) / 2);
}

/**
 * How wide the docked "as of <day>" line under a vault's or a portfolio's
 * balance may be, in the balance block's own (unscaled) points: all the room
 * between the two header buttons, divided by the scale the block docks at.
 * A fixed width cut the line to "as of 28 Feb 20…" at larger text sizes
 * (decided 2026-10-22, the same client's phone).
 */
export function morphCaptionWidth(screenW: number, sideRoom: number, endScale: number): number {
  if (!(endScale > 0)) return Math.max(0, screenW - 2 * sideRoom);
  return Math.max(0, screenW - 2 * sideRoom) / endScale;
}

/**
 * The phone's text size from which a label and its value stop sharing a
 * line and stack, the label over the value, each with the full width: iOS's
 * accessibility sizes (the first is about 1.6 times the standard size; the
 * largest standard one, 1.35). Apple's own guidance for those sizes, and the
 * only way a long label is never broken inside a word at the largest of them
 * ("Receiv / ed", decided 2026-10-22).
 */
export const STACK_FROM_FONT_SCALE = 1.5;

/** The most of a row a label takes beside its value. */
export const FACT_LABEL_SHARE = '60%';

export function factsStacked(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale >= STACK_FROM_FONT_SCALE;
}

/**
 * True when the phone's text is set above the standard size. The Portfolio
 * tab's cards keep their money line out of the layout at the standard size
 * (so a portfolio card is exactly a vault card's height); above it the line
 * joins the layout and the card grows, or it lands on the amount (decided
 * 2026-10-22).
 */
export function textEnlarged(fontScale: number): boolean {
  return Number.isFinite(fontScale) && fontScale > 1.05;
}
