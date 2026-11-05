/**
 * How far the keyboard scroller may move, as a pure function (no
 * react-native import, so it is testable in plain Node).
 *
 * Found in a phone test (2026-09-19), typing a limit on the Estate Plan: "Why is the keyboard
 * sitting so far below the field I am editing?" The scroller had found the
 * first action button below the field, two fields further down, and
 * scrolled until THAT cleared the keys, taking the field off the top. The
 * field must never leave the screen to show its button.
 */

/** The field may rise to this far below the scroll view's top, no further. */
export const FIELD_MARGIN = 24;

/**
 * The edge the field and its confirm must clear: the keyboard's top, or the
 * scroll area's own bottom edge where that ends higher. A scroll view that
 * runs under the keys ends below them, so the keys stay the floor. Under a
 * page footer that rose with the keys, or in a sheet whose foot (its Back)
 * and keyboard padding sit between the scroll area and the keys, the keys
 * are not where the content stops being visible (decided 2026-10-05: the key
 * sheet's Add key was scrolled clear of the keys and landed under the foot's
 * Back, 38 of its 50pt clipped).
 */
export function revealFloor(keyboardTop: number, hostBottom: number): number {
  return Math.min(keyboardTop, hostBottom);
}

/**
 * The fallback for "is the focused field this scroll view's?" when the view
 * tree cannot say: the field overlaps the scroll area. A field scrolled
 * wholly under a footer or the keys fails it, which is why the view tree is
 * asked first (useRevealFocusedField).
 */
export function overlapsHost(field: { y: number; h: number }, host: { y: number; h: number }): boolean {
  return field.y + field.h > host.y && field.y < host.y + host.h;
}

/**
 * What the scroller keeps clear for the focused field: from the input's own
 * top (the bound keeps THAT on the screen) down to the lower of the input's
 * bottom and its extent's, the field's own controls under it (fieldExtent.ts:
 * the code's Paste and the line saying why a code was refused). An extent
 * that measures as nothing is ignored.
 */
export function revealSpan(
  field: { y: number; h: number },
  extent: { y: number; h: number } | null,
): { top: number; bottom: number } {
  const bottom = field.y + field.h;
  if (!extent || extent.h <= 0) return { top: field.y, bottom };
  return { top: field.y, bottom: Math.max(bottom, extent.y + extent.h) };
}

export function revealOverlap(a: {
  fieldTop: number;
  /** The confirm's bottom, or the field plus a button's room. */
  wanted: number;
  keyboardTop: number;
  hostTop: number;
}): number {
  const needed = a.wanted - a.keyboardTop;
  if (needed <= 0) return 0;
  const roomAbove = a.fieldTop - (a.hostTop + FIELD_MARGIN);
  return Math.max(0, Math.min(needed, roomAbove));
}
