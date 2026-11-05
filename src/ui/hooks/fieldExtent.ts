/**
 * What belongs to a field BELOW it, for the keyboard scroller (decided
 * 2026-10-18: the code boxes AND their Paste control stay above the keys).
 *
 * useRevealFocusedField measures the focused input. A six-digit code is one
 * invisible input over the boxes (CodeField), and the control the client
 * needs next, "Paste code", and the line that says why a code was refused sit
 * UNDER that input: lifting the input alone left them behind the page's
 * footer. So a field registers its extent, the view that holds it and its own
 * controls, and the scroller keeps that whole extent clear, while the bound
 * still keeps the input itself on the screen.
 *
 * Pure (no react-native import), so the scroller's arithmetic stays testable
 * in plain Node.
 */

type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };

export interface FieldExtent {
  /** True while this field holds the keyboard. */
  focused: () => boolean;
  /** The view that holds the field and its own controls under it. */
  extent: () => Measurable | null;
}

const extents = new Set<FieldExtent>();

/** Register while mounted; call the returned function on unmount. */
export function registerFieldExtent(entry: FieldExtent): () => void {
  extents.add(entry);
  return () => {
    extents.delete(entry);
  };
}

/** The focused field's extent, or null when the focused field has none. */
export function focusedFieldExtent(): Measurable | null {
  for (const entry of extents) {
    if (entry.focused()) return entry.extent();
  }
  return null;
}
