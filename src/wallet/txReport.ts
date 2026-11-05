/**
 * The vault's ACCOUNT STATEMENT: what the PDF and the CSV both say.
 *
 * One list of entries is built here and both formats render it, so the two
 * can never disagree about a balance again. The statement covers a chosen
 * period, opens on the balance the vault already held, and closes on the
 * balance it ends with.
 *
 * What the numbers mean, once, so every format agrees:
 *   · AMOUNT is the vault's own net change — positive received, negative
 *     sent, and for a REFRESH exactly the fee (the coins came back).
 *   · FEE is what the transaction paid the network, when the backend knows
 *     it (Electrum always does; Esplora on an unconfirmed tx may not).
 *   · BALANCE is what the vault held after that line, opening balance
 *     included — the figure an accountant reconciles against.
 *   · A refresh is named as such rather than as a payment to yourself,
 *     because that is what it is: a timelock reset. Only a vault with a
 *     clock has one; anywhere else a send to itself is "Sent", as on the
 *     vault page and the transaction screen.
 *
 * Pure — no storage, no clock, no network. The screen supplies notes, the
 * period, today's date and the language.
 */
import type { WalletTx } from '../bitcoin/engine/types';
import { isSelfTransfer } from './history';
import { buildStatementPdf, type StatementRow } from './statementPdf';
import {
  isAllTime,
  splitByPeriod,
  txDay,
  type StatementPeriod,
} from './statementPeriod';
import { statementStrings, type StatementLang } from './statementText';

export type TxKind = 'Received' | 'Sent' | 'Refresh';

/**
 * `timelocked` is minOlderBlocks(descriptor) != null. Decided 2026-09-22: the
 * statement called every send to itself a Refresh, while the vault page and
 * the transaction screen call it "Sent" on a vault with no clock (plain
 * multisig, single-sig). One transaction, one name.
 */
export function txKind(tx: WalletTx, timelocked: boolean): TxKind {
  if (timelocked && isSelfTransfer(tx)) return 'Refresh';
  return tx.netAmount >= 0 ? 'Received' : 'Sent';
}

const btc = (sats: number): string => (sats / 1e8).toFixed(8);

/** Signed BTC string: what the vault's balance did. */
const signedBtc = (sats: number): string => `${sats > 0 ? '+' : ''}${btc(sats)}`;

function isoDateTime(seconds?: number): { date: string; time: string } {
  if (!seconds) return { date: '', time: '' };
  const d = new Date(seconds * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** ISO day → the way the chosen language writes a date in a table cell. */
function cellDate(iso: string, lang: StatementLang): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return lang === 'de' ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

function csvField(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Oldest first — an accounting export reads forwards in time. */
function chronological(txs: readonly WalletTx[]): WalletTx[] {
  return [...txs].sort(
    (a, b) =>
      (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity) ||
      // Same timestamp (one block): money in before money out, or the
      // running balance shows an impossible negative (decided 2026-08-28).
      b.netAmount - a.netAmount,
  );
}

// ─── Folding a day's refreshes ───────────────────────────────────────────────

/**
 * The folded view (decided 2026-08-28): real sends and receives stay one row each,
 * but the refresh churn collapses into ONE row per day carrying that day's
 * combined fees. Ten refreshes across two days become two rows.
 */
export interface RefreshDayGroup {
  /** ISO day, or '' for refreshes still pending. */
  day: string;
  count: number;
  /** Total fees the day's refreshes paid (sats). */
  feeSats: number;
  confirmed: boolean;
  /** Ordering key: the day's earliest refresh. */
  timestamp?: number;
}

export type SummaryEntry =
  | { kind: 'tx'; tx: WalletTx }
  | { kind: 'refreshDay'; group: RefreshDayGroup };

export function summarizeTxs(txs: readonly WalletTx[], timelocked: boolean): SummaryEntry[] {
  const groups = new Map<string, RefreshDayGroup>();
  const singles: WalletTx[] = [];
  for (const t of txs) {
    if (txKind(t, timelocked) !== 'Refresh') {
      singles.push(t);
      continue;
    }
    const day = t.confirmed ? txDay(t) : '';
    const g = groups.get(day) ?? {
      day,
      count: 0,
      feeSats: 0,
      confirmed: day !== '',
      timestamp: t.timestamp,
    };
    g.count += 1;
    g.feeSats += t.fee ?? Math.abs(t.netAmount);
    // The day's LAST refresh, not its first: the folded line carries the
    // whole day's fees, so placing it early charged them before that day's
    // receives had arrived and could drive the running balance negative for
    // a day that never went negative.
    if (t.timestamp != null && (g.timestamp == null || t.timestamp > g.timestamp)) {
      g.timestamp = t.timestamp;
    }
    groups.set(day, g);
  }
  const entries: SummaryEntry[] = [
    ...singles.map((tx) => ({ kind: 'tx' as const, tx })),
    ...[...groups.values()].map((group) => ({ kind: 'refreshDay' as const, group })),
  ];
  return entries.sort((a, b) => {
    const ta = a.kind === 'tx' ? a.tx.timestamp ?? Infinity : a.group.timestamp ?? Infinity;
    const tb = b.kind === 'tx' ? b.tx.timestamp ?? Infinity : b.group.timestamp ?? Infinity;
    if (ta !== tb) return ta - tb;
    // Same timestamp (one block): money in before money out, or the running
    // balance shows an impossible negative (decided 2026-08-28 — the folded view
    // had its own sort and missed the detailed export's tie-break).
    const na = a.kind === 'tx' ? a.tx.netAmount : -a.group.feeSats;
    const nb = b.kind === 'tx' ? b.tx.netAmount : -b.group.feeSats;
    return nb - na;
  });
}

// ─── The statement itself ────────────────────────────────────────────────────

export interface StatementInput {
  vaultName: string;
  /** Plain-language signing rule, e.g. "2 of 3 keys". */
  policy: string;
  /** "Bitcoin", "Signet"… */
  network: string;
  /** The client's 21st Capital account number, when the vault has one. */
  accountNumber?: string;
  txs: readonly WalletTx[];
  notes?: Readonly<Record<string, string>>;
  period: StatementPeriod;
  /** Today, ISO — decides where pending transactions belong. */
  today: string;
  /** The day the statement was produced, ISO. */
  generatedOn: string;
  lang: StatementLang;
  /** Fold each day's refreshes into a single line of combined fees. */
  foldRefreshDays: boolean;
  /** The vault has a clock (minOlderBlocks != null): only then is a send to
   *  itself a Refresh (decided 2026-09-22). */
  timelocked: boolean;
}

/** One line of the statement, with the balance it leaves behind. */
type Entry =
  | { kind: 'tx'; tx: WalletTx; balance: number }
  | { kind: 'refreshDay'; group: RefreshDayGroup; balance: number };

export interface StatementData {
  entries: Entry[];
  openingBalance: number;
  closingBalance: number;
  received: number;
  sent: number;
  fees: number;
  /** How many transactions the period holds (folded rows still count each). */
  count: number;
  /** True when an opening balance line should be printed. */
  showOpening: boolean;
}

/**
 * Everything both formats need: the period's transactions in order, each
 * carrying the running balance, plus the totals for the summary panel.
 */
export function statementData(input: StatementInput): StatementData {
  const split = splitByPeriod(input.txs, input.period, input.today);
  const inPeriod = split.inPeriod;
  let running = split.openingBalance;
  const entries: Entry[] = [];
  if (input.foldRefreshDays) {
    for (const e of summarizeTxs(inPeriod, input.timelocked)) {
      if (e.kind === 'tx') {
        running += e.tx.netAmount;
        entries.push({ kind: 'tx', tx: e.tx, balance: running });
      } else {
        running -= e.group.feeSats;
        entries.push({ kind: 'refreshDay', group: e.group, balance: running });
      }
    }
  } else {
    for (const tx of chronological(inPeriod)) {
      running += tx.netAmount;
      entries.push({ kind: 'tx', tx, balance: running });
    }
  }
  let received = 0;
  let sent = 0;
  let fees = 0;
  for (const t of inPeriod) {
    const kind = txKind(t, input.timelocked);
    // A refresh is not money in or out — nothing entered or left the vault,
    // only the fee did.
    if (kind === 'Received') {
      received += t.netAmount;
      // The fee on an incoming payment was paid by the SENDER. Counting it
      // here overstated "network fees paid" and broke the one sum a reader
      // does in their head: opening + in - out - fees = closing.
      continue;
    }
    if (kind === 'Sent') sent += Math.abs(t.netAmount + (t.fee ?? 0));
    fees += t.fee ?? 0;
  }
  return {
    entries,
    openingBalance: split.openingBalance,
    closingBalance: running,
    received,
    sent,
    fees,
    count: inPeriod.length,
    // An all-time statement starts from nothing by definition; any other
    // window has to say what the vault already held.
    showOpening: !isAllTime(input.period) || split.openingBalance !== 0,
  };
}

/** The period as the statement prints it. */
export function periodLabel(period: StatementPeriod, lang: StatementLang): string {
  const s = statementStrings(lang);
  if (isAllTime(period)) return s.allTime;
  if (period.start && period.end) {
    return period.start === period.end
      ? s.longDate(period.start)
      : `${s.longDate(period.start)} - ${s.longDate(period.end)}`;
  }
  // A window open at one end must SAY so: printing the single date it has
  // made an open-ended statement look like a one-day one.
  if (period.start) return `${s.from} ${s.longDate(period.start)}`;
  return `${s.until} ${s.longDate(period.end)}`;
}

function typeLabel(kind: TxKind, lang: StatementLang): string {
  const s = statementStrings(lang);
  return kind === 'Received' ? s.received : kind === 'Sent' ? s.sent : s.refresh;
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/**
 * One row per line of the statement, oldest first. Carries the FULL
 * transaction id and both units — a spreadsheet is where completeness
 * belongs, and a truncated id in an accounting file is worthless. Dates stay
 * ISO whatever the language: a spreadsheet sorts them, a human reads the PDF.
 */
export function buildStatementCsv(input: StatementInput): string {
  const s = statementStrings(input.lang);
  const data = statementData(input);
  const header = [
    s.colDate,
    s.colTime,
    s.colType,
    'Amount (BTC)',
    s.colAmountSats,
    'Fee (BTC)',
    s.colFeeSats,
    'Balance (BTC)',
    s.colBalanceSats,
    s.colStatus,
    'Transaction ID',
    s.colNote,
  ]
    .map(csvField)
    .join(',');
  const rows: string[] = [];
  if (data.showOpening) {
    rows.push(
      [
        input.period.start,
        '',
        s.openingBalance,
        '',
        '',
        '',
        '',
        btc(data.openingBalance),
        String(data.openingBalance),
        '',
        '',
        '',
      ].join(','),
    );
  }
  for (const e of data.entries) {
    if (e.kind === 'tx') {
      const t = e.tx;
      const { date, time } = isoDateTime(t.timestamp);
      rows.push(
        [
          date,
          time,
          typeLabel(txKind(t, input.timelocked), input.lang),
          signedBtc(t.netAmount),
          String(t.netAmount),
          t.fee != null ? btc(t.fee) : '',
          t.fee != null ? String(t.fee) : '',
          btc(e.balance),
          String(e.balance),
          t.confirmed ? s.confirmed : s.pending,
          t.txid,
          csvField(input.notes?.[t.txid] ?? ''),
        ].join(','),
      );
    } else {
      rows.push(
        [
          e.group.day,
          '',
          s.refresh,
          signedBtc(-e.group.feeSats),
          String(-e.group.feeSats),
          btc(e.group.feeSats),
          String(e.group.feeSats),
          btc(e.balance),
          String(e.balance),
          e.group.confirmed ? s.confirmed : s.pending,
          '',
          csvField(s.refreshDay(e.group.count)),
        ].join(','),
      );
    }
  }
  rows.push(
    [
      input.period.end || input.generatedOn,
      '',
      s.closingBalance,
      '',
      '',
      '',
      '',
      btc(data.closingBalance),
      String(data.closingBalance),
      '',
      '',
      '',
    ].join(','),
  );
  return [header, ...rows].join('\r\n') + '\r\n';
}

// ─── PDF ─────────────────────────────────────────────────────────────────────

/** Display-ready statement lines, oldest first. */
export function statementRows(input: StatementInput, data = statementData(input)): StatementRow[] {
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
  for (const e of data.entries) {
    if (e.kind === 'refreshDay') {
      rows.push({
        date: e.group.confirmed ? cellDate(e.group.day, input.lang) : s.pending,
        type: s.refresh,
        amount: signedBtc(-e.group.feeSats),
        fee: btc(e.group.feeSats),
        balance: btc(e.balance),
        note: s.refreshDay(e.group.count),
      });
      continue;
    }
    const t = e.tx;
    const kind = txKind(t, input.timelocked);
    const note = (input.notes?.[t.txid] ?? '').trim();
    rows.push({
      date: t.confirmed ? cellDate(txDay(t), input.lang) || '-' : s.pending,
      type: typeLabel(kind, input.lang),
      amount: signedBtc(t.netAmount),
      fee: t.fee != null ? btc(t.fee) : '-',
      balance: btc(e.balance),
      // The FULL id as its own COLUMN (decided 2026-08-28): columns are narrowed
      // so 64 characters fit untruncated.
      note: t.txid,
      // The owner's note (rare) rides on the small sub-line when present.
      sub: note || undefined,
      accent: kind === 'Received',
    });
  }
  // The table closes on the same line the CSV ends with, so the two
  // documents can be read side by side.
  rows.push({
    date: cellDate(input.period.end || input.generatedOn, input.lang),
    type: s.closingBalance,
    amount: '',
    fee: '',
    balance: btc(data.closingBalance),
    note: '',
    span: true,
  });
  return rows;
}

/** The branded Vault Account Statement. Returns raw PDF bytes. */
export function buildStatementDocument(input: StatementInput): Uint8Array {
  const s = statementStrings(input.lang);
  const data = statementData(input);
  const summary = [
    { label: s.openingBalance, value: `${btc(data.openingBalance)} BTC` },
    { label: s.transactions, value: String(data.count) },
    { label: s.moneyIn, value: `${btc(data.received)} BTC` },
    { label: s.moneyOut, value: `${btc(data.sent)} BTC` },
    { label: s.fees, value: `${btc(data.fees)} BTC` },
    { label: s.closingBalance, value: `${btc(data.closingBalance)} BTC`, strong: true },
  ];
  return buildStatementPdf({
    lang: input.lang,
    documentTitle: s.title,
    identity: [
      { label: s.vault, value: input.vaultName },
      ...(input.accountNumber
        ? [{ label: s.accountNumber, value: input.accountNumber }]
        : []),
      { label: s.network, value: input.network },
      { label: s.policy, value: input.policy },
    ],
    columnLabels: [s.colDate, s.colType, s.colAmount, s.colFee, s.colBalance],
    lastColumnLabel: s.colTxid,
    lastColumnMode: 'id',
    periodLabel: periodLabel(input.period, input.lang),
    generatedOnLabel: s.longDate(input.generatedOn),
    summary,
    rows: statementRows(input, data),
    // Said only when the period truly holds nothing; the opening balance
    // line is not a transaction.
    emptyNote: data.count === 0 ? s.noTransactions : undefined,
  });
}
