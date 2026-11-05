/**
 * The Vault Account Statement, laid out the way a bank lays one out
 * (decided 2026-08-28, after comparing ours to a Wise statement).
 *
 * The order a reader expects, top to bottom: who issued it, what the document
 * is, which period it covers, which account it belongs to, what the balance
 * did, then the transactions, then the small print. The identity block is the
 * one place we deliberately differ: Talia does no KYC, so there is no account
 * holder to name. A vault is identified by its own reference and its signing
 * policy instead, which is what a reader actually needs to check.
 *
 * Layout only. The caller computes every string, so this module has no clock,
 * no storage and no opinion about Bitcoin.
 */
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
  fitSize,
  fitText,
  taliaLockup,
  text,
  textRight,
  textWidth,
  wrapText,
} from './pdfKit';
import { ISSUER, statementStrings, type StatementLang } from './statementText';

export interface StatementRow {
  date: string;
  type: string;
  amount: string;
  fee: string;
  balance: string;
  /** Fifth column: the full transaction id, or a description for a folded row. */
  note: string;
  /** Small second line under the row (the owner's own note). */
  sub?: string;
  /** Drawn in brand green: money that came in. */
  accent?: boolean;
  /** A balance line (brought forward / carried out) rather than a payment.
   *  Its label is long and its amount cells are empty, so it is allowed to
   *  run across them and is left out of the column measuring. */
  span?: boolean;
}

export interface StatementSummaryItem {
  label: string;
  value: string;
  /** Ruled off above and drawn heavier: the closing balance. */
  strong?: boolean;
}

export interface StatementPdfInput {
  lang: StatementLang;
  /** The document's own name, e.g. "Vault account statement". */
  documentTitle: string;
  /**
   * The facts printed under the title, three to a row. Whatever the subject
   * is, these must be things the reader can CHECK: a vault prints its name,
   * account number, network and signing rule; a portfolio prints its name,
   * currency and how its cost is worked out. Never an invented reference.
   */
  identity: Array<{ label: string; value: string }>;
  /** Headings for the five measured columns, in row-field order. */
  columnLabels: [string, string, string, string, string];
  /** The last column: a transaction id for a vault, a note for a portfolio. */
  lastColumnLabel: string;
  /**
   * How the last column behaves. 'id' shrinks the type until all 64
   * characters of a transaction id fit, because a truncated id is worthless;
   * 'text' keeps the type size and trims with an ellipsis, because a
   * half-shown note is still readable.
   */
  lastColumnMode?: 'id' | 'text';
  /** "1 August 2026 - 28 August 2026", or the all-time label. */
  periodLabel: string;
  generatedOnLabel: string;
  summary: StatementSummaryItem[];
  rows: StatementRow[];
  /** Shown in place of the table when the period holds nothing. */
  emptyNote?: string;
  /** Small print under the table, when the document needs its own. */
  footerNote?: string;
  /** Overrides the standing legal paragraph (a portfolio is not on-chain). */
  legalLine?: string;
  /**
   * A line the reader must not miss, drawn in brand gold under the identity
   * block: what this document is NOT. A portfolio statement says it is not an
   * on-chain vault, so nobody mistakes a hand-kept record for custody.
   */
  notice?: string;
}

const ROW_SIZE = 8.5;
const HEAD_SIZE = 9;
const TXID_SIZE = 6.9;
const TXID_MIN_SIZE = 5.8;
const TXID_MAX = 64;
const ROW_H = 17;
const SUB_H = 10;
/** Breathing room between two columns. */
const GAP = 9;

/**
 * Column positions measured from the content itself, never guessed.
 *
 * The first version pinned x-positions by hand and the German edition ran
 * its own words into the next column ("Auffrischung" is half again as long
 * as "Refresh"). Measuring means any language, and any future wording, lays
 * itself out correctly. The transaction id takes whatever is left and its
 * type size is scaled so all 64 characters still fit untruncated.
 */
function columnLayout(input: StatementPdfInput): { x: number[]; txidSize: number } {
  const heads = input.columnLabels;
  const widths = heads.map((h) => textWidth(h, HEAD_SIZE, true));
  for (const r of input.rows) {
    const cells = [r.date, r.type, r.amount, r.fee, r.balance];
    cells.forEach((cell, i) => {
      // A balance line's long label deliberately overflows the empty amount
      // and fee cells beside it, so it must not stretch the TYPE column.
      if (r.span && i === 1) return;
      widths[i] = Math.max(widths[i], textWidth(cell, ROW_SIZE, i === 1));
    });
  }
  const x: number[] = [];
  let cursor = MARGIN;
  for (const w of widths) {
    x.push(cursor);
    cursor += w + GAP;
  }
  const available = PAGE_W - MARGIN - cursor;
  if ((input.lastColumnMode ?? 'id') === 'text') {
    // A note is prose: keep it at the row's own size and let fitText trim it.
    return { x: [...x, cursor], txidSize: ROW_SIZE };
  }
  const perPoint = textWidth('a'.repeat(TXID_MAX), 1);
  const txidSize = Math.max(TXID_MIN_SIZE, Math.min(TXID_SIZE, available / perPoint));
  return { x: [...x, cursor], txidSize };
}

const BAND_H = 118;
const CONT_BAND_H = 48;

const rowHeight = (r: StatementRow): number => ROW_H + (r.sub ? SUB_H : 0);

/** Everything below the table: legal paragraph, help line, rule, reference. */
function footerBlock(input: StatementPdfInput, page: number, pageCount: number): {
  ops: string;
  top: number;
} {
  const s = statementStrings(input.lang);
  const width = PAGE_W - 2 * MARGIN;
  const legal = wrapText(input.legalLine ?? s.legalLine, 6.8, width);
  const ruleY = 84;
  const helpY = 96;
  const legalTop = helpY + 12 + (legal.length - 1) * 9;
  let ops = '';
  legal.forEach((l, i) => {
    ops += text(MARGIN, legalTop - i * 9, 6.8, l, FAINT);
  });
  ops += text(MARGIN, helpY, 7.2, s.help, FAINT);
  ops += line(MARGIN, ruleY, PAGE_W - MARGIN, ruleY, 0.5, HAIRLINE);
  ops += text(MARGIN, ruleY - 14, 6.5, `${ISSUER.brand} - ${ISSUER.web}`, FAINT);
  ops += textRight(PAGE_W - MARGIN, ruleY - 14, 6.5, s.page(page + 1, pageCount), FAINT);
  // A document's own small print sits ABOVE the standing legal block, and
  // the table has to stop above that in turn.
  let noteTop = legalTop;
  if (input.footerNote) {
    const noteLines = wrapText(input.footerNote, 7, PAGE_W - 2 * MARGIN);
    noteTop = legalTop + 12 + (noteLines.length - 1) * 9;
    noteLines.forEach((l, i) => {
      ops += text(MARGIN, noteTop - i * 9, 7, l, FAINT);
    });
  }
  // Where the table must stop.
  return { ops, top: noteTop + 14 };
}

/** The green letterhead: the mark, who stands behind it, and the issuer's
 *  registered details, the way a bank prints them above everything else. */
function letterhead(): string {
  let ops = rect(0, PAGE_H - BAND_H, PAGE_W, BAND_H, GREEN);
  ops += taliaLockup(MARGIN, PAGE_H - 24, 0.5, OFFWHITE);
  ops += text(MARGIN, PAGE_H - 78, 8, ISSUER.poweredBy, GOLD, true);
  const right = PAGE_W - MARGIN;
  ops += textRight(right, PAGE_H - 38, 7.6, ISSUER.legalName, OFFWHITE, true);
  ops += textRight(right, PAGE_H - 50, 7, ISSUER.addressLine1, OFFWHITE);
  ops += textRight(right, PAGE_H - 60, 7, ISSUER.addressLine2, OFFWHITE);
  ops += textRight(right, PAGE_H - 70, 7, ISSUER.country, OFFWHITE);
  ops += textRight(
    right,
    PAGE_H - 82,
    7,
    `${statementStrings('en').licenseLabel} ${ISSUER.licenseNo}`,
    OFFWHITE,
  );
  return ops;
}

/** Title, period, generation date, and the vault identity grid. Returns the
 *  y the summary panel starts from. */
function documentHead(input: StatementPdfInput): { ops: string; bottom: number } {
  const s = statementStrings(input.lang);
  let ops = letterhead();
  // The title sat ~10pt under the band and read cramped (decided 2026-08-28).
  const titleY = PAGE_H - BAND_H - 42;
  ops += text(MARGIN, titleY, 19, input.documentTitle, INK, true);
  ops += text(MARGIN, titleY - 22, 10.5, input.periodLabel, INK, true);
  ops += text(MARGIN, titleY - 38, 8.5, `${s.generatedOn}: ${input.generatedOnLabel}`, FAINT);
  const ruleY = titleY - 50;
  ops += line(MARGIN, ruleY, PAGE_W - MARGIN, ruleY, 0.5, HAIRLINE);

  // Identity block: three facts about the vault, and nothing invented.
  //
  // Where a bank prints an account holder and an account number, Talia has
  // neither: it does no KYC, and a reference the client cannot look up
  // anywhere is decoration (reported 2026-08-28: "completely useless to the
  // client"). What is left is what a reader can actually check.
  //
  // Every cell is fitted to its column: a long vault name or a German policy
  // ("10 von 15 Schlüsseln, 12 Wiederherstellungspfade") used to run straight
  // over the value beside it. It shrinks a little first, and is trimmed only
  // when even that will not do.
  const colW = (PAGE_W - 2 * MARGIN) / 3;
  const cellW = colW - 12; // gutter
  const cells = input.identity;
  // Three to a row; a fourth fact starts a second row.
  const rows = Math.ceil(cells.length / 3);
  cells.forEach((c, i) => {
    const y = ruleY - 18 - Math.floor(i / 3) * 30;
    const x = MARGIN + (i % 3) * colW;
    ops += text(x, y, 8, fitText(c.label, 8, cellW), INK, true);
    const size = fitSize(c.value, [8.5, 8, 7.5, 7], cellW);
    ops += text(x, y - 12, size, fitText(c.value, size, cellW), FAINT);
  });
  let gridBottom = ruleY - 18 - (rows - 1) * 30 - 22;
  if (input.notice) {
    // Gold, and above the rule rather than in the footnotes: a reader must
    // not be able to finish the header without having read it.
    const lines = wrapText(input.notice, 8, PAGE_W - 2 * MARGIN);
    lines.forEach((l, i) => {
      ops += text(MARGIN, gridBottom - 4 - i * 11, 8, l, GOLD, true);
    });
    gridBottom -= 4 + lines.length * 11;
  }
  ops += line(MARGIN, gridBottom, PAGE_W - MARGIN, gridBottom, 0.5, HAIRLINE);
  return { ops, bottom: gridBottom };
}

/** The summary panel: the titled box that was asked for, carrying the balance
 *  the period opened and closed on. */
function summaryPanel(input: StatementPdfInput, top: number): { ops: string; bottom: number } {
  const s = statementStrings(input.lang);
  const items = input.summary;
  const panelH = items.length * 19 + 26 + 18;
  const panelTop = top - 16;
  let ops = rect(MARGIN, panelTop - panelH, PAGE_W - 2 * MARGIN, panelH, OFFWHITE);
  ops += rect(MARGIN, panelTop - panelH, 3, panelH, GOLD);
  ops += text(MARGIN + 16, panelTop - 20, 9, s.summaryTitle, GREEN, true);
  items.forEach((item, i) => {
    const y = panelTop - 40 - i * 19;
    if (item.strong) {
      ops += line(MARGIN + 16, y + 13, PAGE_W - MARGIN - 16, y + 13, 0.5, HAIRLINE);
    }
    ops += text(MARGIN + 16, y, 10, item.label, item.strong ? INK : FAINT, !!item.strong);
    ops += text(MARGIN + 190, y, 10, item.value, INK, true);
  });
  return { ops, bottom: panelTop - panelH };
}

/** Build the statement. Returns raw PDF bytes. */
export function buildStatementPdf(input: StatementPdfInput): Uint8Array {
  // Page 1 reserves the head and the panel; continuation pages carry a slim
  // band and the table alone.
  const col = columnLayout(input);
  const head = documentHead(input);
  const panel = summaryPanel(input, head.bottom);
  const firstTableTop = panel.bottom - 34;
  const contTableTop = PAGE_H - CONT_BAND_H - 44;
  // The footer's height depends on how many lines the legal paragraph wraps
  // to, which is language-dependent; measure it once against page 1.
  const footerTop = footerBlock(input, 0, 1).top;

  const pagesRows: StatementRow[][] = [];
  let remaining = [...input.rows];
  let first = true;
  do {
    const top = first ? firstTableTop : contTableTop;
    const budget = top - footerTop - 24;
    const page: StatementRow[] = [];
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
  const contents = pagesRows.map((rows, p) => {
    let ops = '';
    if (p === 0) {
      ops += head.ops;
      ops += panel.ops;
    } else {
      ops += rect(0, PAGE_H - CONT_BAND_H, PAGE_W, CONT_BAND_H, GREEN);
      ops += taliaLockup(MARGIN, PAGE_H - 8, 0.32, OFFWHITE);
      ops += textRight(PAGE_W - MARGIN, PAGE_H - 30, 8, `${input.documentTitle} (${input.periodLabel})`, OFFWHITE);
    }

    const top = p === 0 ? firstTableTop : contTableTop;
    const heads = [...input.columnLabels, input.lastColumnLabel];
    heads.forEach((h, i) => {
      ops += text(col.x[i], top, HEAD_SIZE, h, FAINT, true);
    });
    ops += line(MARGIN, top - 6, PAGE_W - MARGIN, top - 6, 1, GOLD);

    let y = top - 22;
    rows.forEach((r) => {
      ops += text(col.x[0], y, ROW_SIZE, r.date, INK);
      ops += text(col.x[1], y, ROW_SIZE, r.type, r.accent ? GREEN : INK, true);
      ops += text(col.x[2], y, ROW_SIZE, r.amount, INK);
      ops += text(col.x[3], y, ROW_SIZE, r.fee, INK);
      ops += text(col.x[4], y, ROW_SIZE, r.balance, INK);
      ops += text(
        col.x[5],
        y,
        col.txidSize,
        // Fitted, not just capped: with very wide amounts the id column can
        // be squeezed past the point where 64 characters fit at its smallest
        // size, and a transaction id running off the page is worse than a
        // trimmed one (the CSV always carries it whole).
        fitText(r.note.slice(0, TXID_MAX), col.txidSize, PAGE_W - MARGIN - col.x[5]),
        FAINT,
      );
      if (r.sub) {
        // The owner's own note, trimmed to the page: the CSV carries it whole.
        ops += text(col.x[0], y - 8.5, 6.5, fitText(r.sub, 6.5, PAGE_W - 2 * MARGIN), FAINT);
      }
      const divY = y - (r.sub ? 13 : 5);
      ops += line(MARGIN, divY, PAGE_W - MARGIN, divY, 0.5, HAIRLINE);
      y -= rowHeight(r);
    });
    // A quiet period still shows the balance it carried, so the note goes
    // BELOW those lines rather than replacing them (a bank does the same).
    if (input.emptyNote && p === pageCount - 1) {
      ops += text(MARGIN, y - 8, 9, input.emptyNote, FAINT);
    }

    ops += footerBlock(input, p, pageCount).ops;
    return ops;
  });

  return assemblePdf(contents);
}
