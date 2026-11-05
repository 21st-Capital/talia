/**
 * The Nano X's type as the DEVICE measures it, so a page of its words is
 * split where the device splits it (decided 2026-10-04: a key paged by a
 * fixed count of characters matched a video of the device for one key of three).
 *
 * The device's firmware (NBGL on the Nano, ledger-secure-sdk) sets its small
 * text in Open Sans Regular 11px, one advance per ASCII character from the
 * font's table less the font's kerning of one pixel (`getCharWidth`), on a
 * line of AVAILABLE_WIDTH = 128 - 2 * 7 pixels, and wraps it as
 * `nbgl_getTextMaxLenInNbLines` does: a character that would take the line
 * past its width starts the next line, unless the line holds a word
 * delimiter (a space, a dash, an underscore), in which case the line ends
 * after the last one. A key has no delimiter, so its lines are cut by width
 * alone. Checked against a video of a Nano X registering a 2-of-3: the
 * 16 lines of two of its keys and its "Spending policy" sentence break where
 * this says (`__tests__/nanoFont.test.ts`).
 *
 * Pure; the table is the SDK's `nbgl_font_open_sans_regular_11.json`
 * (API_LEVEL_22), ' ' (0x20) to '~' (0x7E).
 */

/** A line of the Nano X's small text, in its pixels: the screen's 128 less seven at each edge. */
export const NANO_LINE_WIDTH = 114;

/** The font's kerning: taken off every character's advance. */
export const NANO_KERNING = 1;

const FIRST_CHAR = 0x20;

/** The font's widths before kerning, ' ' to '~'. */
const WIDTHS = [
  4, 4, 5, 8, 7, 10, 10, 3, 4, 4, 7, 7, 4, 5, 4, 5, //  !"#$%&'()*+,-./
  7, 7, 7, 7, 9, 7, 7, 7, 7, 7, 4, 4, 7, 7, 7, 6, // 0123456789:;<=>?
  11, 8, 8, 8, 9, 7, 7, 9, 9, 4, 4, 8, 7, 11, 9, 10, // @ABCDEFGHIJKLMNO
  8, 10, 8, 7, 8, 9, 8, 11, 8, 7, 7, 5, 5, 5, 7, 6, // PQRSTUVWXYZ[\]^_
  7, 7, 8, 6, 8, 7, 6, 7, 8, 4, 4, 7, 4, 11, 8, 8, // `abcdefghijklmno
  8, 8, 5, 6, 5, 8, 7, 10, 7, 7, 6, 5, 7, 5, 7, // pqrstuvwxyz{|}~
] as const;

/** NBGL's word delimiters (IS_WORD_DELIM). */
const DELIMITERS = new Set([' ', '\n', '\b', '\f', '-', '_']);

/** A character's advance on the device: its width less the kerning; nothing
 *  for a character the font does not hold (the device skips it). */
export function nanoCharWidth(ch: string): number {
  const code = ch.codePointAt(0);
  if (code == null) return 0;
  const width = WIDTHS[code - FIRST_CHAR];
  return width == null ? 0 : width - NANO_KERNING;
}

/** A line's width on the device. */
export function nanoTextWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += nanoCharWidth(ch);
  return width;
}

/**
 * The text as the device's lines: each a piece of the text (a delimiter or
 * a line feed stays at the end of the line it closes), so joined they make
 * the text again. The rule is NBGL's: the character that would take the
 * line past `maxWidth` starts the next line, or, when the line holds a
 * delimiter, the line ends after its last one; a character wider than the
 * line stands on one alone.
 */
export function nanoLines(text: string, maxWidth: number = NANO_LINE_WIDTH): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let start = 0;
  let width = 0;
  let afterDelimiter: number | null = null;
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    i += 1;
    if (DELIMITERS.has(ch)) afterDelimiter = i;
    if (ch === '\n') {
      lines.push(chars.slice(start, i).join(''));
      start = i;
      width = 0;
      afterDelimiter = null;
      continue;
    }
    const w = nanoCharWidth(ch);
    if (w === 0) continue;
    if (width + w > maxWidth) {
      const end = afterDelimiter ?? i - 1;
      if (end > start) {
        lines.push(chars.slice(start, end).join(''));
        start = end;
        i = end;
        width = 0;
        afterDelimiter = null;
        continue;
      }
    }
    width += w;
  }
  if (start < chars.length) lines.push(chars.slice(start).join(''));
  return lines;
}

/** The text over pages of `linesPerPage` of the device's lines, each page
 *  the lines joined; none for an empty text. */
export function nanoPages(text: string, linesPerPage: number, maxWidth: number = NANO_LINE_WIDTH): string[] {
  const lines = nanoLines(text, maxWidth);
  const pages: string[] = [];
  for (let at = 0; at < lines.length; at += linesPerPage) pages.push(lines.slice(at, at + linesPerPage).join(''));
  return pages;
}
