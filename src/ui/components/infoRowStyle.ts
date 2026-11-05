/**
 * Where an ⓘ sits beside its text (decided 2026-09-21: the dot beside "Invite an
 * heir" is right; "Where is this key now?" had it low and "WHAT IT TAKES TO
 * OPEN IT" had it high). Pure, so it is tested without React Native.
 */

/** The dot's diameter. */
export const INFO_DOT = 20;

/**
 * How far below the top of a line box the dot starts so its centre sits on
 * that line's centre. Negative for a line shorter than the dot, which is fine.
 */
export function infoDotTop(lineHeight: number): number {
  return (lineHeight - INFO_DOT) / 2;
}

/** The line box of a text style: its lineHeight, else the font's usual 1.3. */
export function lineHeightOf(style: { lineHeight?: number; fontSize?: number }): number {
  return style.lineHeight ?? Math.round((style.fontSize ?? 17) * 1.3);
}

/** Spacing and placement belong to the ROW, never to the text beside the dot. */
export const ROW_KEYS = [
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'marginStart',
  'marginEnd',
  'padding',
  'paddingTop',
  'paddingBottom',
  'paddingVertical',
  'alignSelf',
] as const;

/**
 * Splits a FLAT text style into what stays on the text and what moves to the
 * row. Both wrong screens carried a margin on the text ("Where is this key
 * now?" below it, "WHAT IT TAKES TO OPEN IT" above it), and a dot centred on
 * the text plus its margin sat low on one and high on the other. Vertical
 * padding would push the letters down past the dot the same way.
 */
export function splitInfoRowStyle<T extends Record<string, unknown>>(
  flat: T,
): { row: Record<string, unknown>; text: Record<string, unknown> } {
  const text: Record<string, unknown> = { ...flat };
  const row: Record<string, unknown> = {};
  for (const k of ROW_KEYS) {
    if (text[k] !== undefined) {
      row[k] = text[k];
      delete text[k];
    }
  }
  // A centred line keeps its dot beside it, in the middle.
  if (text.textAlign === 'center') row.justifyContent = 'center';
  return { row, text };
}
