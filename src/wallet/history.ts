/**
 * Transaction-history presentation logic: date grouping (banking-ledger style)
 * and the running "balance as of this transaction" used by the scroll-linked
 * historical balance in the wallet header.
 *
 * Pure functions — no RN imports — so the maths that drives the time-travel
 * balance is unit tested.
 */
import type { Balance, Sats, WalletTx } from '../bitcoin/engine/types';

/**
 * A self-transfer (timelock "refresh"): every sat that left came back to the
 * wallet's own addresses, so the net change is exactly the fee. A normal
 * payment with change never satisfies this — its net is payment + fee.
 */
export function isSelfTransfer(tx: WalletTx): boolean {
  return tx.sent > 0 && tx.received > 0 && tx.fee != null && tx.netAmount === -tx.fee;
}

/** A wallet transaction annotated with the balance right after it happened. */
export interface LedgerTx extends WalletTx {
  /** Wallet balance (sats) immediately after this transaction. */
  balanceAfter: Sats;
}

/** One date group of the ledger. */
export interface LedgerSection {
  /** Human title: "Pending", or a formatted day like "7 June 2026". */
  title: string;
  /** Stable key: 'pending' or 'YYYY-MM-DD'. */
  key: string;
  data: LedgerTx[];
}

/**
 * Annotate transactions (newest-first) with the balance after each one.
 *
 * Walks from the present backwards: the newest transaction's balanceAfter is
 * the current total; each older transaction's is the next-newer one's minus
 * that newer transaction's net amount. Example: +1 BTC on Jan 10 and +0.5 BTC
 * on May 5 with a current total of 1.5 BTC → May 5 shows 1.5, Jan 10 shows 1.0.
 */
export function withRunningBalance(
  txsNewestFirst: WalletTx[],
  currentTotal: Sats,
): LedgerTx[] {
  let balance = currentTotal;
  return txsNewestFirst.map((tx) => {
    const annotated: LedgerTx = { ...tx, balanceAfter: balance };
    balance -= tx.netAmount;
    return annotated;
  });
}

/**
 * Relative time for activity feeds: "just now", "35 minutes ago",
 * "6 hours ago", then "Jul 11, 1:07 pm" beyond 24 hours.
 */
export function formatRelativeTime(timestampSecs: number, nowMs: number = Date.now()): string {
  const diffMs = nowMs - timestampSecs * 1000;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const d = new Date(timestampSecs * 1000);
  const month = d.toLocaleString('en-US', { month: 'short' });
  let h = d.getHours() % 12;
  if (h === 0) h = 12;
  const ampm = d.getHours() < 12 ? 'am' : 'pm';
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${month} ${d.getDate()}, ${h}:${min} ${ampm}`;
}

/** Format a unix-seconds timestamp as a ledger day title, e.g. "7 June 2026". */
export function formatDayTitle(timestampSecs: number): string {
  const d = new Date(timestampSecs * 1000);
  const day = d.getDate();
  const month = d.toLocaleString('en-GB', { month: 'long' });
  return `${day} ${month} ${d.getFullYear()}`;
}

/** Local-date key (YYYY-MM-DD) for grouping. */
export function dayKey(timestampSecs: number): string {
  const d = new Date(timestampSecs * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Group annotated transactions into date sections, newest day first.
 * Unconfirmed transactions are pinned in a leading "Pending" section.
 * Confirmed transactions without a timestamp (rare backend gap) fall into a
 * trailing "Earlier" section rather than being dropped.
 */
export function groupIntoSections(txs: LedgerTx[]): LedgerSection[] {
  const pending: LedgerTx[] = [];
  const byDay = new Map<string, LedgerTx[]>();
  const undated: LedgerTx[] = [];

  for (const tx of txs) {
    if (!tx.confirmed) {
      pending.push(tx);
    } else if (tx.timestamp) {
      const key = dayKey(tx.timestamp);
      const group = byDay.get(key);
      if (group) group.push(tx);
      else byDay.set(key, [tx]);
    } else {
      undated.push(tx);
    }
  }

  const sections: LedgerSection[] = [];
  if (pending.length > 0) {
    sections.push({ title: 'Pending', key: 'pending', data: pending });
  }
  // Map preserves insertion order; input is newest-first, so days come out
  // newest-first too.
  for (const [key, data] of byDay) {
    sections.push({ title: formatDayTitle(data[0].timestamp!), key, data });
  }
  if (undated.length > 0) {
    sections.push({ title: 'Earlier', key: 'earlier', data: undated });
  }
  return sections;
}

/** Convenience: annotate + group in one call. */
export function buildLedger(
  txsNewestFirst: WalletTx[],
  balance: Balance,
): { ledger: LedgerTx[]; sections: LedgerSection[] } {
  const ledger = withRunningBalance(txsNewestFirst, balance.total);
  return { ledger, sections: groupIntoSections(ledger) };
}
