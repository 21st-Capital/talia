/**
 * The hand-built PDF primitives shared by every Talia document.
 *
 * Extracted from portfolioReport.ts (decided 2026-08-28) when the account
 * statement grew its own layout: page geometry, brand palette, WinAnsi text
 * escaping, drawing operators, the Talia lockup, and the object assembler.
 * Building the bytes by hand keeps us free of a native PDF dependency; this
 * is typesetting, not cryptography, and every document that uses it is
 * pinned by tests.
 *
 * Pure: no storage, no clock, no native.
 */

export const PAGE_W = 595; // A4 portrait, points
export const PAGE_H = 842;
export const MARGIN = 48;

// Brand (theme/colors.ts values, fixed here on purpose: a PDF is a document,
// not a themed surface — it must look identical wherever it lands).
export const GREEN = '0.071 0.290 0.220'; // #124A38
export const OFFWHITE = '0.957 0.945 0.910'; // #F4F1E8
export const GOLD = '0.882 0.655 0.235'; // #E1A73C
export const INK = '0.10 0.12 0.11';
export const FAINT = '0.45 0.47 0.46';
export const HAIRLINE = '0.85 0.85 0.84';

/** WinAnsi-encode for a PDF literal; unrepresentable glyphs degrade to '?'.
 *  German is fully covered: umlauts and sharp s live inside Latin-1, and the
 *  German quotation marks are transliterated below. */
export function pdfEscape(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`;
    else if (code === 0x20ac) out += '\\200'; // €
    else if (code === 0x2248) out += '~'; // ≈
    else if (code === 0x2212 || code === 0x2013 || code === 0x2014) out += '-';
    else if (code === 0x2018 || code === 0x2019 || code === 0x201a) out += "'";
    else if (code === 0x2026) out += '...'; // …
    else if (code === 0x201c || code === 0x201d || code === 0x201e) out += '"';
    else if (code <= 0xff) out += ch;
    else out += '?';
  }
  return out;
}

export const text = (
  x: number,
  y: number,
  size: number,
  str: string,
  color = INK,
  bold = false,
): string => `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg ${x} ${y} Td (${pdfEscape(str)}) Tj ET\n`;

export const rect = (x: number, y: number, w: number, h: number, color: string): string =>
  `${color} rg ${x} ${y} ${w} ${h} re f\n`;

export const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w: number,
  color: string,
): string => `${color} RG ${w} w ${x1} ${y1} m ${x2} ${y2} l S\n`;

const K = 0.5523; // Bézier circle constant

/** Filled circle out of four Béziers. */
export function circle(cx: number, cy: number, r: number, color: string): string {
  const k = K * r;
  return (
    `${color} rg ${cx + r} ${cy} m ` +
    `${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c ` +
    `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c ` +
    `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c ` +
    `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c f\n`
  );
}

/** Trim a computed number to something a PDF stream reads cleanly. */
const n = (v: number): string => String(Math.round(v * 1000) / 1000);

/**
 * The Talia knot + wordmark, drawn from TaliaLogo.tsx's lockup geometry
 * (design units, 70 tall), placed with its top-left at (x, yTop) scaled by
 * `s`. Round caps, brand colours — the same mark as the app header.
 *
 * The weight needs care. The app sets 600 and gets the iOS system font, whose
 * stem measures 0.1225 em; a PDF has only the standard-14 faces, and
 * Helvetica-Bold's stem is 0.1382 em as Apple's own renderer draws it, which
 * is what the first review saw ("thicker than on the phone"). Helvetica REGULAR
 * (0.0825 em) plus a measured synthetic stroke puts the weight wherever we
 * want it, and the design's letter spacing comes with it.
 *
 * Matching the app's numbers exactly was still too heavy on the page (a review,
 * same day, looking at a printed statement): a stroke drawn crisply on paper
 * reads heavier than the same stroke antialiased on a backlit screen. So the
 * whole lockup is lightened ~12% for print — knot and wordmark TOGETHER, so
 * the mark keeps the app's proportions instead of growing a heavy knot beside
 * thin letters.
 */
export function taliaLockup(x: number, yTop: number, s: number, strokeColor: string): string {
  const X = (dx: number): number => x + dx * s;
  const Y = (dy: number): number => yTop - dy * s; // design y-down → PDF y-up
  // 6.2 rather than the design's 7: the optical correction for print.
  const w = 6.2 * s;
  let ops = `1 J ${strokeColor} RG ${w} w\n`;
  // Crossbar: M8 22 h30
  ops += `${X(8)} ${Y(22)} m ${X(38)} ${Y(22)} l S\n`;
  // Stem + loop: M22 8 v34, then a 270° loop to (32,32) around (32,42).
  const k = K * 10;
  ops +=
    `${X(22)} ${Y(8)} m ${X(22)} ${Y(42)} l ` +
    `${X(22)} ${Y(42 + k)} ${X(32 - k)} ${Y(52)} ${X(32)} ${Y(52)} c ` +
    `${X(32 + k)} ${Y(52)} ${X(42)} ${Y(42 + k)} ${X(42)} ${Y(42)} c ` +
    `${X(42)} ${Y(42 - k)} ${X(32 + k)} ${Y(32)} ${X(32)} ${Y(32)} c S\n`;
  // Gold dot closing the crossbar.
  ops += circle(X(45), Y(22), 3.9 * s, GOLD);
  // "alia" completes the word (SVG: x54 y53 fontSize40 weight600 spacing3).
  // q/Q keeps the render mode and letter spacing from leaking into the text
  // drawn after the mark — both are graphics state, not per-operator.
  const size = 40 * s;
  ops +=
    `q BT /F1 ${n(size)} Tf ${strokeColor} rg ${strokeColor} RG ` +
    `${n(0.0255 * size)} w 2 Tr ${n(0.075 * size)} Tc ` +
    `${n(X(54))} ${n(Y(53))} Td (alia) Tj ET Q\n`;
  return ops;
}

/** Helvetica text width in points, from the standard-14 metrics. Used to
 *  right-align and to wrap without guessing at 4.6pt-per-character. */
const HELV_W: Readonly<Record<string, number>> = (() => {
  // AFM widths (per 1000 units) for the printable ASCII range, regular face.
  const w =
    '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 ' + // ' ' … '/'
    '556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 ' + // '0' … '?'
    '1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 ' + // '@' … 'O'
    '667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 ' + // 'P' … '_'
    '333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 ' + // '`' … 'o'
    '556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'; // 'p' … '~'
  const parts = w.split(' ').map(Number);
  const out: Record<string, number> = {};
  parts.forEach((v, i) => {
    out[String.fromCharCode(32 + i)] = v / 1000;
  });
  return out;
})();

/** Width of `str` at `size` points. Bold runs ~5% wider in Helvetica-Bold;
 *  the flag keeps right-aligned figures honest. */
export function textWidth(str: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of str) units += HELV_W[ch] ?? 0.556; // unknown glyph ≈ digit width
  return units * size * (bold ? 1.06 : 1);
}

/** Right-aligned text: the same operator, positioned by measured width. */
export const textRight = (
  xRight: number,
  y: number,
  size: number,
  str: string,
  color = INK,
  bold = false,
): string => text(xRight - textWidth(str, size, bold), y, size, str, color, bold);

/**
 * Cut `str` to `maxWidth`, ending in "..." when something had to go. A
 * document cell has a hard edge and the next column behind it, so text that
 * does not fit must be shortened rather than allowed to overprint.
 */
export function fitText(str: string, size: number, maxWidth: number): string {
  if (textWidth(str, size) <= maxWidth) return str;
  const ellipsis = '...';
  const budget = maxWidth - textWidth(ellipsis, size);
  if (budget <= 0) return '';
  let out = '';
  for (const ch of str) {
    if (textWidth(out + ch, size) > budget) break;
    out += ch;
  }
  return `${out.trimEnd()}${ellipsis}`;
}

/**
 * The largest of `sizes` at which `str` fits, or the smallest when none do
 * (the caller then trims with fitText). Lets a long vault name shrink a
 * little before it is cut.
 */
export function fitSize(str: string, sizes: readonly number[], maxWidth: number): number {
  for (const size of sizes) {
    if (textWidth(str, size) <= maxWidth) return size;
  }
  return sizes[sizes.length - 1];
}

/** Greedy word wrap to a pixel width, for footers and legal paragraphs. */
export function wrapText(str: string, size: number, maxWidth: number): string[] {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && textWidth(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Wrap each page's content stream into a finished PDF file. */
export function assemblePdf(contents: readonly string[]): Uint8Array {
  const objects: string[] = [];
  const pageObjIds: number[] = [];
  const firstPageObj = 5;
  contents.forEach((content, p) => {
    const pageId = firstPageObj + p * 2;
    const contentId = pageId + 1;
    pageObjIds.push(pageId);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}endstream`;
  });
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = body.length;
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) bytes[i] = body.charCodeAt(i) & 0xff;
  return bytes;
}
