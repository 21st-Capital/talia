/**
 * The portfolio's ACCOUNT STATEMENT (decided 2026-08-28: "the same export
 * functionality we built for the vaults, also for the portfolios").
 *
 * Same document as a vault's, same letterhead, same period questions, built
 * from a hand-kept ledger instead of the chain. One list of entries feeds both
 * the PDF and the CSV, so the two can never disagree about a balance.
 *
 * What the numbers mean, once:
 *   · AMOUNT is what the entry did to the holding: a buy adds, a sell takes
 *     away. Positive and negative, never a bare number with a word beside it.
 *   · VALUE is the TOTAL paid or received for that entry, printed in the
 *     currency it was recorded in. It is what a client has on a receipt.
 *   · BALANCE is what the portfolio held after that line, opening balance
 *     included.
 *
 * MONEY IN A CURRENCY WE CANNOT CONVERT IS NEVER GUESSED. The fiat totals
 * cover entries in the statement's own currency plus those the caller could
 * convert at the entry's own date; anything left over is disclosed in the
 * summary, never folded in at today's rate.
 *
 * Pure: no storage, no clock, no network. The screen supplies the period,
 * today's date, the language and any conversions.
 */
import { SATS_PER_BTC, type ManualEntry } from './manualLedger';
import { entrySourceName, P2P_SOURCE } from './entrySources';
import { displayNote } from './entryDetails';
import { buildStatementPdf, type StatementRow } from './statementPdf';
import { isoDay, isAllTime, type StatementPeriod } from './statementPeriod';
import { statementStrings, type StatementLang } from './statementText';

const btc = (sats: number): string => (sats / SATS_PER_BTC).toFixed(8);
const signedBtc = (sats: number): string => `${sats > 0 ? '+' : ''}${btc(sats)}`;

/** What one entry does to the holding. A buy adds, a sell takes away. */
export function entryNetSats(e: ManualEntry): number {
  return e.kind === 'buy' ? e.amountSats : -e.amountSats;
}

function entryDay(e: ManualEntry): string {
  return isoDay(new Date(e.date));
}

function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** ISO day → the way the chosen language writes a date in a table cell. */
function cellDate(iso: string, lang: StatementLang): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return lang === 'de' ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Where the entry's bitcoin was bought or sold, in the statement's
 *  language (only "Peer to peer" has words of its own to translate; an
 *  exchange's name is its name, and "Other" is what the client typed). */
function sourceIn(e: ManualEntry, lang: StatementLang): string {
  if (e.source === P2P_SOURCE.key) return statementStrings(lang).peerToPeer;
  return entrySourceName(e) ?? '';
}

/** Thousands-separated money, at the precision people write prices in. */
function money(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface PortfolioStatementInput {
  portfolioName: string;
  entries: readonly ManualEntry[];
  /** The currency the SUMMARY totals are stated in. */
  currency: string;
  /**
   * Entry id → that entry's fiat total converted into `currency`, at the
   * entry's OWN date. Entries already in `currency` need no row here; those
   * missing from it are counted in BTC and disclosed in fiat.
   */
  fx?: ReadonlyMap<string, number>;
  period: StatementPeriod;
  /** Today, ISO. */
  today: string;
  /** The day the statement was produced, ISO. */
  generatedOn: string;
  lang: StatementLang;
}

interface StatementEntry {
  entry: ManualEntry;
  /** The holding after this line. */
  balance: number;
}

export interface PortfolioStatementData {
  entries: StatementEntry[];
  openingBalance: number;
  closingBalance: number;
  boughtSats: number;
  soldSats: number;
  /** Totals in the statement's currency, over entries we could state there. */
  paidFiat: number;
  receivedFiat: number;
  /** Priced entries whose currency could not be converted. */
  unconverted: number;
  count: number;
  showOpening: boolean;
}

/** The fiat total of an entry IN the statement's currency, or null when we
 *  cannot say honestly. */
function fiatIn(e: ManualEntry, input: PortfolioStatementInput): number | null {
  if (e.fiatAmount == null) return null;
  if (e.fiatCurrency === input.currency) return e.fiatAmount;
  const converted = input.fx?.get(e.id);
  return converted ?? null;
}

/**
 * Everything both formats need: the period's entries in order, each carrying
 * the running balance, plus the totals for the summary panel.
 */
export function portfolioStatementData(
  input: PortfolioStatementInput,
): PortfolioStatementData {
  const { start, end } = input.period;
  // OLDEST first. sortManualEntries is newest-first because that is how the
  // app LISTS a portfolio, but a statement reads forwards in time: taken the
  // other way round, every running balance in the table is wrong.
  const sorted = [...input.entries].sort((a, b) => a.date - b.date || a.createdAt - b.createdAt);
  let openingBalance = 0;
  const inPeriod: ManualEntry[] = [];
  for (const e of sorted) {
    const day = entryDay(e);
    if (start && day < start) {
      openingBalance += entryNetSats(e);
      continue;
    }
    if (end && day > end) continue;
    inPeriod.push(e);
  }
  let running = openingBalance;
  const entries: StatementEntry[] = [];
  let boughtSats = 0;
  let soldSats = 0;
  let paidFiat = 0;
  let receivedFiat = 0;
  let unconverted = 0;
  for (const e of inPeriod) {
    running += entryNetSats(e);
    entries.push({ entry: e, balance: running });
    const fiat = fiatIn(e, input);
    if (e.kind === 'buy') {
      boughtSats += e.amountSats;
      if (fiat != null) paidFiat += fiat;
    } else {
      soldSats += e.amountSats;
      if (fiat != null) receivedFiat += fiat;
    }
    if (e.fiatAmount != null && fiat == null) unconverted += 1;
  }
  return {
    entries,
    openingBalance,
    closingBalance: running,
    boughtSats,
    soldSats,
    paidFiat,
    receivedFiat,
    unconverted,
    count: inPeriod.length,
    // An all-time statement opens at zero by definition, so the line would
    // say nothing; a period statement always shows what it opened on.
    showOpening: !isAllTime(input.period),
  };
}

/** Display-ready statement lines, oldest first. */
export function portfolioStatementRows(
  input: PortfolioStatementInput,
  data = portfolioStatementData(input),
): StatementRow[] {
  const s = statementStrings(input.lang);
  const rows: StatementRow[] = [];
  if (data.showOpening) {
    rows.push({
      date: cellDate(input.period.start, input.lang),
      type: s.openingBalance,
      amount: '',
      fee: '',
      balance: btc(data.openingBalance),
      note: '',
      span: true,
    });
  }
  for (const { entry, balance } of data.entries) {
    const value =
      entry.fiatAmount != null
        ? `${money(entry.fiatAmount)} ${entry.fiatCurrency ?? ''}`.trim()
        : '';
    const source = sourceIn(entry, input.lang);
    rows.push({
      date: cellDate(entryDay(entry), input.lang),
      type: entry.kind === 'buy' ? s.bought : s.sold,
      amount: signedBtc(entryNetSats(entry)),
      fee: value,
      balance: btc(balance),
      note: displayNote(entry.note) ?? '',
      // The source on the row's own small second line (decided 2026-10-22).
      ...(source ? { sub: `${s.colSource}: ${source}` } : {}),
      accent: entry.kind === 'buy',
    });
  }
  rows.push({
    date: cellDate(input.period.end || input.today, input.lang),
    type: s.closingBalance,
    amount: '',
    fee: '',
    balance: btc(data.closingBalance),
    note: '',
    span: true,
  });
  return rows;
}

/** One row per entry, oldest first, with both units, the full note and the
 *  source. Source is the LAST column (decided 2026-10-22), so a sheet built
 *  on an older export still finds every other column where it was. */
export function buildPortfolioStatementCsv(
  input: PortfolioStatementInput,
  data = portfolioStatementData(input),
): string {
  const s = statementStrings(input.lang);
  const header = [
    s.colDate,
    s.colType,
    'Amount (BTC)',
    s.colAmountSats,
    'Value',
    'Currency',
    'Balance (BTC)',
    s.colBalanceSats,
    s.colNote,
    s.colSource,
  ].join(',');
  // The spreadsheet says it too, on its own first line: a CSV gets forwarded
  // on its own, without the PDF's letterhead to explain it (decided 2026-08-28).
  const preamble = csvField(s.virtualNotice);
  const rows: string[] = [];
  if (data.showOpening) {
    rows.push(
      [
        input.period.start,
        s.openingBalance,
        '',
        '',
        '',
        '',
        btc(data.openingBalance),
        String(data.openingBalance),
        '',
        '',
      ].join(','),
    );
  }
  for (const { entry, balance } of data.entries) {
    rows.push(
      [
        entryDay(entry),
        entry.kind === 'buy' ? s.bought : s.sold,
        signedBtc(entryNetSats(entry)),
        String(entryNetSats(entry)),
        entry.fiatAmount != null ? String(entry.fiatAmount) : '',
        entry.fiatCurrency ?? '',
        btc(balance),
        String(balance),
        csvField(displayNote(entry.note) ?? ''),
        csvField(sourceIn(entry, input.lang)),
      ].join(','),
    );
  }
  rows.push(
    [
      input.period.end || input.today,
      s.closingBalance,
      '',
      '',
      '',
      '',
      btc(data.closingBalance),
      String(data.closingBalance),
      '',
      '',
    ].join(','),
  );
  return [preamble, '', header, ...rows].join('\r\n') + '\r\n';
}

/** The branded portfolio statement. Returns raw PDF bytes. */
export function buildPortfolioStatementDocument(input: PortfolioStatementInput): Uint8Array {
  const s = statementStrings(input.lang);
  const data = portfolioStatementData(input);
  const summary = [
    { label: s.openingBalance, value: `${btc(data.openingBalance)} BTC` },
    { label: s.entries, value: String(data.count) },
    { label: s.totalBought, value: `${btc(data.boughtSats)} BTC` },
    { label: s.totalSold, value: `${btc(data.soldSats)} BTC` },
    ...(data.paidFiat > 0
      ? [{ label: s.totalPaid, value: `${money(data.paidFiat)} ${input.currency}` }]
      : []),
    ...(data.receivedFiat > 0
      ? [{ label: s.totalReceived, value: `${money(data.receivedFiat)} ${input.currency}` }]
      : []),
    { label: s.closingBalance, value: `${btc(data.closingBalance)} BTC`, strong: true },
  ];
  const notes = [s.keptByHand];
  if (data.unconverted > 0) notes.push(s.otherCurrencyNote(data.unconverted, input.currency));
  return buildStatementPdf({
    lang: input.lang,
    documentTitle: s.portfolioTitle,
    identity: [
      { label: s.portfolio, value: input.portfolioName },
      { label: s.kind, value: s.virtualPortfolio },
      { label: s.currency, value: input.currency },
      { label: s.costBasis, value: s.costBasisAverage },
    ],
    notice: s.virtualNotice,
    columnLabels: [s.colDate, s.colType, s.colAmount, s.colValue, s.colBalance],
    lastColumnLabel: s.colNote.toUpperCase(),
    lastColumnMode: 'text',
    periodLabel: portfolioPeriodLabel(input),
    generatedOnLabel: s.longDate(input.generatedOn),
    summary,
    rows: portfolioStatementRows(input, data),
    emptyNote: data.count === 0 ? s.noEntries : undefined,
    legalLine: s.legalLinePortfolio,
    footerNote: notes.join(' '),
  });
}

function portfolioPeriodLabel(input: PortfolioStatementInput): string {
  const s = statementStrings(input.lang);
  const { start, end } = input.period;
  if (isAllTime(input.period)) return s.allTime;
  if (start && end) {
    return start === end ? s.longDate(start) : `${s.longDate(start)} - ${s.longDate(end)}`;
  }
  if (start) return `${s.from} ${s.longDate(start)}`;
  return `${s.until} ${s.longDate(end)}`;
}
