/**
 * Splitting a message into paragraphs and hanging list rows (decided 2026-09-08).
 *
 * Pure on purpose: Jest runs in plain Node with no React Native preset, so
 * the logic lives here and `MarkedText.tsx` only draws it.
 */
/** One block of a message: a plain paragraph, or a list row and its marker. */
export interface MarkedLine {
  /** "1." or "•" when the line is a list row, null for a paragraph. */
  marker: string | null;
  text: string;
}

/**
 * A list marker at the START of a line: 1. 2) • · ‣ ▪ or a dash, followed
 * by a space. Mid-sentence characters are never markers, which is why the
 * separator dot in "Heir · sealed" is left alone.
 */
const MARKER = /^(\d{1,2}[.)]|[•·‣▪*-])\s+/;

/**
 * Split a message into rows, ONE per line as the author typed it: a line
 * opening with a marker becomes a hanging row, every other line stays a
 * paragraph of its own, and a blank line becomes a spacer (text `''`).
 * Lines are never merged: a message that breaks a line on purpose keeps
 * that break, exactly as a single `<Text>` used to render it.
 */
export function markedLines(message: string): MarkedLine[] {
  const out: MarkedLine[] = [];
  for (const block of message.split('\n')) {
    const line = block.trim();
    if (!line) {
      // One spacer per run of blank lines; never lead with one.
      const last = out[out.length - 1];
      if (out.length > 0 && !(last.marker === null && last.text === '')) {
        out.push({ marker: null, text: '' });
      }
      continue;
    }
    const found = MARKER.exec(line);
    out.push(
      found
        ? { marker: found[1], text: line.slice(found[0].length) }
        : { marker: null, text: line },
    );
  }
  // A trailing spacer would render as a gap at the end of the message.
  while (out.length > 0 && out[out.length - 1].marker === null && out[out.length - 1].text === '') {
    out.pop();
  }
  return out;
}
