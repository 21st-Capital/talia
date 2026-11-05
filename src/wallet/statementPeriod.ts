/**
 * Statement periods (decided 2026-08-28, copying how a bank does it): the client
 * picks today, yesterday, a past calendar month/quarter/year, or their own
 * two dates, and the statement covers exactly that window.
 *
 * The hard part is not the filtering, it is the OPENING BALANCE. A period
 * statement that starts its running balance at zero would lie about a vault
 * that already held coins, so everything dated before the window is folded
 * into one opening figure and the table walks on from there.
 *
 * Three kinds of transaction have to be placed:
 *   · timestamped        → the day it happened decides, in the owner's own
 *                          time zone (a bank statement is read locally).
 *   · confirmed, no time → it happened at some unknown past point, so it
 *                          counts toward the opening balance. Its money is
 *                          real and must not vanish from the closing figure.
 *   · pending            → it is happening NOW, so it belongs to a window
 *                          that reaches today and to no other.
 *
 * Pure: no clock. The caller passes today's date, which keeps this testable
 * and keeps device-clock surprises out of the maths.
 */
import type { WalletTx } from '../bitcoin/engine/types';

export type PeriodPreset =
  | 'today'
  | 'yesterday'
  | 'lastMonth'
  | 'lastQuarter'
  | 'lastYear'
  | 'all';

export interface StatementPeriod {
  /** ISO YYYY-MM-DD, or '' for "since the vault began". */
  start: string;
  /** ISO YYYY-MM-DD, or '' for "up to now". */
  end: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** A Date → local ISO day. Local on purpose: the owner's midnight, not UTC's. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Unix seconds → local ISO day, or '' when the transaction carries no time. */
export function txDay(tx: WalletTx): string {
  return tx.timestamp ? isoDay(new Date(tx.timestamp * 1000)) : '';
}

/** Today as the app sees it. The one place a clock is read. */
export function todayIso(): string {
  return isoDay(new Date());
}

/** The window a preset means, resolved against a given day. Calendar-based,
 *  the way a bank statement is: "last month" is the whole previous month, not
 *  the last thirty days. */
export function presetPeriod(preset: PeriodPreset, today: string): StatementPeriod {
  const [y, m, d] = today.split('-').map(Number);
  const day = (yy: number, mm: number, dd: number): string => `${yy}-${pad(mm)}-${pad(dd)}`;
  const lastOf = (yy: number, mm: number): number => new Date(yy, mm, 0).getDate();
  switch (preset) {
    case 'today':
      return { start: today, end: today };
    case 'yesterday': {
      const t = new Date(y, m - 1, d - 1);
      const iso = isoDay(t);
      return { start: iso, end: iso };
    }
    case 'lastMonth': {
      const mm = m === 1 ? 12 : m - 1;
      const yy = m === 1 ? y - 1 : y;
      return { start: day(yy, mm, 1), end: day(yy, mm, lastOf(yy, mm)) };
    }
    case 'lastQuarter': {
      // Quarter containing this month, stepped back one.
      const q = Math.floor((m - 1) / 3); // 0..3
      const prevQ = q === 0 ? 3 : q - 1;
      const yy = q === 0 ? y - 1 : y;
      const startM = prevQ * 3 + 1;
      const endM = startM + 2;
      return { start: day(yy, startM, 1), end: day(yy, endM, lastOf(yy, endM)) };
    }
    case 'lastYear':
      return { start: day(y - 1, 1, 1), end: day(y - 1, 12, 31) };
    case 'all':
    default:
      return { start: '', end: '' };
  }
}

export interface PeriodSplit {
  /** Transactions inside the window, unsorted (the report sorts). */
  inPeriod: WalletTx[];
  /** Net change of everything before the window: the balance it opens on. */
  openingBalance: number;
  /** Number of transactions that fell outside the window entirely. */
  excluded: number;
}

/** True when the period has no bounds at all: the vault's whole life. */
export function isAllTime(period: StatementPeriod): boolean {
  return !period.start && !period.end;
}

/**
 * Place every transaction: inside the window, before it (opening balance), or
 * outside it altogether. `today` decides where a pending transaction lands.
 */
export function splitByPeriod(
  txs: readonly WalletTx[],
  period: StatementPeriod,
  today: string,
): PeriodSplit {
  const { start, end } = period;
  // A window that reaches today (or beyond) is the only one that can hold
  // transactions which have not confirmed yet.
  const holdsPending = !end || end >= today;
  const inPeriod: WalletTx[] = [];
  let openingBalance = 0;
  let excluded = 0;
  for (const tx of txs) {
    const day = txDay(tx);
    if (!day) {
      if (!tx.confirmed) {
        // Happening now.
        if (holdsPending) inPeriod.push(tx);
        else excluded += 1;
        continue;
      }
      // Confirmed but undated: real money from an unknown past moment. In an
      // all-time statement it is simply part of the history; otherwise it is
      // already in the vault when the window opens.
      if (isAllTime(period)) inPeriod.push(tx);
      else openingBalance += tx.netAmount;
      continue;
    }
    if (start && day < start) {
      openingBalance += tx.netAmount;
      continue;
    }
    if (end && day > end) {
      excluded += 1;
      continue;
    }
    inPeriod.push(tx);
  }
  return { inPeriod, openingBalance, excluded };
}
