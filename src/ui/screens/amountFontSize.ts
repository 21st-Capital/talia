/**
 * The size the Send amount is drawn at.
 *
 * A TextInput cannot shrink itself the way a Text does (adjustsFontSizeToFit
 * is a Text prop), so the size is computed from what fits in the row, and the
 * figure gets smaller as digits are added (decided 2026-09-20: "the font size of
 * the amount needs to become much smaller as the digits increase so it cannot
 * be cut off").
 *
 * The widths are MEASURED from the face the hero size uses,
 * BricolageGrotesque-Bold (1000 units per em): the widest digit is the zero at
 * 0.665 em, the full stop 0.233, the comma 0.196. Every digit is modelled as
 * the WIDEST one, so the estimate depends on the number of characters alone:
 * the size never jumps between keystrokes, and the drawn figure is never wider
 * than the estimate. The first version modelled a digit at 0.62 em, the font's
 * tabular width, while the input drew proportional digits, so an amount of
 * zeros was drawn 7 percent wider than it was measured and its last digit was
 * cut (a phone screenshot, 2026-09-20). The input now also asks for tabular
 * figures, which are narrower still and hold their place while typing.
 *
 * Letter spacing is a flat 0.2pt per character at any size, so it comes off
 * the width before the size is solved.
 *
 * The phone's text size enlarges the input's font: React Native draws it at
 * `size × fontScale`. So the size is solved for the DRAWN figure and handed
 * back divided by the scale (decided 2026-11-04 after a phone test: at the
 * "extra large" text size a payment request's 0.00005107 read 0.0000510,
 * because a field nobody is typing in shows its start and drops what does
 * not fit). At the standard size nothing changes.
 *
 * Pure and tested.
 */
import { theme } from '../theme';

export const HERO_SIZE = theme.typography.hero.fontSize ?? 40;
export const MIN_AMOUNT_SIZE = 18;
/** Measured advance widths, in em, BricolageGrotesque-Bold. */
const DIGIT_EM = 0.665;
const DOT_EM = 0.233;
const COMMA_EM = 0.196;
const LETTER_SPACING = theme.typography.hero.letterSpacing ?? 0;
/** A hair of room so a rounded size and the caret never touch the edge. */
const SAFETY = 0.97;

/** The width of `text` in em at the hero face, by the measured advances. */
export function amountEms(text: string): number {
  let total = 0;
  for (const ch of text) {
    total += ch === '.' ? DOT_EM : ch === ',' ? COMMA_EM : DIGIT_EM;
  }
  return Math.max(total, DIGIT_EM);
}

export function amountFontSize(text: string, availableWidth: number, fontScale = 1): number {
  const chars = Math.max(1, text.length);
  if (availableWidth <= 0) return HERO_SIZE;
  const scale = fontScale > 0 ? fontScale : 1;
  // Letter spacing is counted at the larger text size too: if it does not
  // grow with it, the figure is a hair smaller than it could be, never cut.
  const room = availableWidth * SAFETY - LETTER_SPACING * chars * scale;
  const drawn = Math.floor(room / amountEms(text));
  return Math.max(MIN_AMOUNT_SIZE, Math.min(HERO_SIZE * scale, drawn)) / scale;
}
