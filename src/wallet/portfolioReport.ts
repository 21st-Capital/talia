/**
 * Human-facing exports for a virtual vault (decided 2026-08-26: "a JSON file is
 * useless to clients... we should add PDF and CSV export").
 *
 * CSV: one row per entry, RFC-4180 quoting — opens in Excel/Numbers as-is.
 * PDF: a deliberately minimal hand-built document — one embedded standard
 * font (Helvetica, WinAnsi), text lines, multi-page. Building the bytes by
 * hand keeps us free of a native PDF dependency; this is typesetting, not
 * cryptography, and the output is pinned by tests.
 *
 * Pure: no storage, no native. The screen supplies the strings.
 */
import type { ManualEntry } from './manualLedger';
import { entrySourceName } from './entrySources';
import { displayNote } from './entryDetails';
import {
  FAINT,
  GOLD,
  GREEN,
  HAIRLINE,
  INK,
  MARGIN,
  OFFWHITE,
  PAGE_H,
  PAGE_W,
  assemblePdf,
  line,
  rect,
  taliaLockup,
  text,
} from './pdfKit';

// ─── CSV ─────────────────────────────────────────────────────────────────────

function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Entries as a spreadsheet, oldest first. Prices stay in the currency they
 *  were recorded in — a spreadsheet's reader can convert; inventing rates in
 *  an export would bake today's guess into a permanent file. Source is the
 *  last column (decided 2026-10-22), so every older column keeps its place. */
export function buildPortfolioCsv(entries: readonly ManualEntry[]): string {
  const header = 'Date,Type,Amount (BTC),Amount (sats),Price,Currency,Note,Source';
  const rows = [...entries]
    .sort((a, b) => a.date - b.date || a.createdAt - b.createdAt)
    .map((e) =>
      [
        isoDate(e.date),
        e.kind === 'buy' ? 'Bought' : 'Sold',
        (e.amountSats / 1e8).toFixed(8),
        String(e.amountSats),
        e.fiatAmount != null ? String(e.fiatAmount) : '',
        e.fiatCurrency ?? '',
        csvField(displayNote(e.note) ?? ''),
        csvField(entrySourceName(e) ?? ''),
      ].join(','),
    );
  return [header, ...rows].join('\r\n') + '\r\n';
}

// ─── PDF ─────────────────────────────────────────────────────────────────────
//
// A branded report, hand-built (no native PDF dependency): the Talia knot
// drawn as vector strokes straight from TaliaLogo.tsx's geometry, the brand
// palette, a summary panel and a ruled table. Standard-14 fonts only
// (Helvetica + Bold, WinAnsi), so nothing is embedded and the file stays
// tiny. Typesetting, not cryptography — sanctioned hand-rolling, pinned by
// tests.

export interface PortfolioPdfRow {
  date: string;
  type: string;
  amount: string;
  price: string;
  note: string;
  /** Small full-width second line under the row (e.g. a full transaction
   *  id) — rows carrying one are taller and pagination accounts for it. */
  sub?: string;
}

export interface PortfolioPdfData {
  vaultName: string;
  /** e.g. "26 August 2026" — the caller formats; this module has no clock. */
  generatedOn: string;
  summary: Array<{ label: string; value: string }>;
  rows: PortfolioPdfRow[];
  /** Column headings, in row-field order. Defaults to the portfolio set. */
  columnLabels?: [string, string, string, string, string];
  /** The `type` value drawn in brand green. Default: a portfolio purchase. */
  accentType?: string;
  /** Small print along the bottom of every page. */
  footerNote?: string;
}

const DEFAULT_LABELS: [string, string, string, string, string] = [
  'DATE',
  'TYPE',
  'AMOUNT',
  'PRICE',
  'NOTE',
];
const DEFAULT_FOOTER =
  'Kept by hand in Talia. Figures reflect what was entered; this is not tax advice.';

const COL = { date: MARGIN, type: 118, amount: 172, price: 315, note: 425 } as const;
const ROW_H = 17;
const SUB_H = 10;
const rowHeight = (r: PortfolioPdfRow): number => ROW_H + (r.sub ? SUB_H : 0);

/** Build the branded portfolio report. Returns raw PDF bytes (Latin-1). */
export function buildPortfolioPdf(data: PortfolioPdfData): Uint8Array {
  // Page 1 layout: band 118pt, summary panel, table start below; continuation
  // pages: slim band 48pt, table only.
  const panelH = data.summary.length * 19 + 26;
  const firstTableTop = PAGE_H - 118 - 30 - panelH - 34;
  const contTableTop = PAGE_H - 48 - 44;
  const footerY = MARGIN + 14;

  const pagesRows: PortfolioPdfRow[][] = [];
  let remaining = [...data.rows];
  let first = true;
  do {
    const top = first ? firstTableTop : contTableTop;
    const budget = top - footerY - 24;
    const page: PortfolioPdfRow[] = [];
    let used = 0;
    while (remaining.length > 0 && (page.length === 0 || used + rowHeight(remaining[0]) <= budget)) {
      used += rowHeight(remaining[0]);
      page.push(remaining[0]);
      remaining = remaining.slice(1);
    }
    pagesRows.push(page);
    first = false;
  } while (remaining.length > 0);

  const pageCount = pagesRows.length;
  const contents: string[] = pagesRows.map((rows, p) => {
    let ops = '';
    if (p === 0) {
      // Brand band with the lockup, vault name, date.
      ops += rect(0, PAGE_H - 118, PAGE_W, 118, GREEN);
      ops += taliaLockup(MARGIN, PAGE_H - 24, 0.5, OFFWHITE);
      ops += text(MARGIN, PAGE_H - 96, 16, data.vaultName, OFFWHITE, true);
      ops += text(PAGE_W - MARGIN - data.generatedOn.length * 4.6, PAGE_H - 96, 9, data.generatedOn, OFFWHITE);
      // Summary panel.
      const panelTop = PAGE_H - 118 - 30;
      ops += rect(MARGIN, panelTop - panelH, PAGE_W - 2 * MARGIN, panelH, OFFWHITE);
      ops += rect(MARGIN, panelTop - panelH, 3, panelH, GOLD);
      data.summary.forEach((sRow, i) => {
        const y = panelTop - 22 - i * 19;
        ops += text(MARGIN + 16, y, 10, sRow.label, FAINT);
        ops += text(MARGIN + 190, y, 10, sRow.value, INK, true);
      });
    } else {
      ops += rect(0, PAGE_H - 48, PAGE_W, 48, GREEN);
      ops += taliaLockup(MARGIN, PAGE_H - 8, 0.32, OFFWHITE);
      ops += text(PAGE_W - MARGIN - 60, PAGE_H - 30, 9, '(continued)', OFFWHITE);
    }

    // Table header + rows.
    const top = p === 0 ? firstTableTop : contTableTop;
    const labels = data.columnLabels ?? DEFAULT_LABELS;
    const X = [COL.date, COL.type, COL.amount, COL.price, COL.note];
    const col5Size = 8.5;
    const col5Max = 34;
    const rowSize = 9.5;
    ops += text(X[0], top, 9, labels[0], FAINT, true);
    ops += text(X[1], top, 9, labels[1], FAINT, true);
    ops += text(X[2], top, 9, labels[2], FAINT, true);
    ops += text(X[3], top, 9, labels[3], FAINT, true);
    ops += text(X[4], top, 9, labels[4], FAINT, true);
    ops += line(MARGIN, top - 6, PAGE_W - MARGIN, top - 6, 1, GOLD);
    let y = top - 22;
    rows.forEach((r) => {
      ops += text(X[0], y, rowSize, r.date, INK);
      ops += text(X[1], y, rowSize, r.type, r.type === (data.accentType ?? 'Bought') ? GREEN : INK, true);
      ops += text(X[2], y, rowSize, r.amount, INK);
      ops += text(X[3], y, rowSize, r.price, r.price.includes('no price') ? FAINT : INK);
      ops += text(X[4], y, col5Size, r.note.slice(0, col5Max), FAINT);
      if (r.sub) {
        ops += text(X[0], y - 8.5, 6.5, r.sub, FAINT);
      }
      // Divider sits below this row's content (sub line included) and above
      // the next row's glyph tops.
      const divY = y - (r.sub ? 13 : 5);
      ops += line(MARGIN, divY, PAGE_W - MARGIN, divY, 0.5, HAIRLINE);
      y -= rowHeight(r);
    });

    // Footer.
    ops += line(MARGIN, footerY + 10, PAGE_W - MARGIN, footerY + 10, 0.5, HAIRLINE);
    ops += text(MARGIN, footerY - 4, 7.5, data.footerNote ?? DEFAULT_FOOTER, FAINT);
    ops += text(PAGE_W - MARGIN - 54, footerY - 4, 7.5, `Page ${p + 1} of ${pageCount}`, FAINT);
    return ops;
  });

  return assemblePdf(contents);
}

/** The report rows from entries, oldest first — display-ready strings. */
export function portfolioPdfRows(entries: readonly ManualEntry[]): PortfolioPdfRow[] {
  return [...entries]
    .sort((a, b) => a.date - b.date || a.createdAt - b.createdAt)
    .map((e) => ({
      date: isoDate(e.date),
      type: e.kind === 'buy' ? 'Bought' : 'Sold',
      amount: `${e.kind === 'buy' ? '+' : '-'}${(e.amountSats / 1e8).toFixed(8)} BTC`,
      price:
        e.fiatAmount != null && e.fiatCurrency
          ? `${e.fiatAmount.toLocaleString('en-US')} ${e.fiatCurrency}`
          : 'no price recorded',
      note: displayNote(e.note) ?? '',
    }));
}
