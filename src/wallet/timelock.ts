/**
 * Per-UTXO timelock countdowns for Liana-style wallets.
 *
 * A coin's recovery path opens `olderBlocks` after ITS confirmation height,
 * so every UTXO has its own expiry. Confirmation heights come from the
 * wallet's transaction list (a UTXO's funding tx is always in it); the
 * remaining time is blocksLeft × 10 minutes.
 */
import type { Utxo, WalletTx } from '../bitcoin/engine/types';

export interface UtxoExpiry {
  txid: string;
  vout: number;
  /** Blocks until the recovery path opens; <= 0 means it is OPEN. Null when
   *  the funding tx is unconfirmed (clock hasn't started). */
  blocksLeft: number | null;
}

export const BLOCK_MINUTES = 10;
export const BLOCKS_PER_DAY = (24 * 60) / BLOCK_MINUTES; // 144
// Liana's humanisation uses CALENDAR-AVERAGE units, not 30-day months:
// a month is 365.25/12 = 30.4375 days (4 383 blocks), a year 365.25 days
// (52 596 blocks). Matching them keeps both apps showing the same countdown
// (found via a 3-day drift spotted in a phone test, 2026-07-16).
export const BLOCKS_PER_MONTH = 4383;
const BLOCKS_PER_YEAR = 52596;
/** "Less than 3 months away" per the spec. */
export const REFRESH_SOON_BLOCKS = 3 * BLOCKS_PER_MONTH; // 13 149

export function utxoExpiries(
  utxos: Utxo[],
  txs: WalletTx[],
  tipHeight: number | undefined,
  olderBlocks: number,
): UtxoExpiry[] {
  const heightByTxid = new Map<string, number | undefined>();
  for (const t of txs) heightByTxid.set(t.txid, t.blockHeight);
  return utxos.map((u) => {
    const h = heightByTxid.get(u.txid);
    if (h == null || tipHeight == null) {
      return { txid: u.txid, vout: u.vout, blocksLeft: null };
    }
    return { txid: u.txid, vout: u.vout, blocksLeft: h + olderBlocks - tipHeight };
  });
}

/** The soonest expiry across the wallet's coins (unconfirmed coins are
 *  treated as a full window since their clock hasn't started). */
export function nearestExpiryBlocks(expiries: UtxoExpiry[], olderBlocks: number): number | null {
  if (expiries.length === 0) return null;
  return Math.min(...expiries.map((e) => e.blocksLeft ?? olderBlocks));
}

/** Ten minutes, the block rate every countdown here assumes. */
const MS_PER_BLOCK = BLOCK_MINUTES * 60 * 1000; // 600 000

/**
 * The persisted nearest-expiry cache, aged to `now`: one block comes off for
 * every ten minutes since it was computed, so a screen can show a countdown
 * the instant it opens instead of waiting on a sync. Null when the cache is
 * missing (never synced, or a vault with no coins).
 */
export function agedExpiryBlocks(
  cachedExpiryBlocks?: number,
  cachedExpiryAt?: number,
  now: number = Date.now(),
): number | null {
  if (cachedExpiryBlocks == null || cachedExpiryAt == null) return null;
  const elapsed = Math.floor((now - cachedExpiryAt) / MS_PER_BLOCK);
  return cachedExpiryBlocks - elapsed;
}

/**
 * The nearest expiry of ANOTHER timelocked path, given the nearest expiry of
 * the smallest-older path. Per coin blocksLeft = height + older − tip, so
 * every path's countdown is the smallest path's shifted by the difference in
 * their locks; the soonest coin is the same coin for all of them. Null (no
 * clock running) passes through.
 */
export function pathExpiryBlocks(
  nearestMinBlocks: number | null,
  minOlder: number,
  pathOlder: number,
): number | null {
  if (nearestMinBlocks == null) return null;
  return nearestMinBlocks + (pathOlder - minOlder);
}

/**
 * A recovery path's wait, in MONTHS (decided 2026-07-28): months are how a vault
 * is configured, and mixing units ("15 months" in one place, "1 year, 2
 * months, 28 days" in another) made one fact look like two. A lock shorter
 * than a month is only the rehearsal lock, which keeps the exact wording.
 * The Spending policy card and the "Vault built" page's Keys card say it
 * through this one function.
 */
export function formatWaitMonths(blocks: number): string {
  const months = Math.round(blocks / BLOCKS_PER_MONTH);
  if (months < 1) return formatBlocksDuration(blocks);
  return `${months} month${months === 1 ? '' : 's'}`;
}

/** "1 year, 1 month, 15 days" — Liana-identical humanised block countdown. */
export function formatBlocksDuration(blocks: number): string {
  if (blocks <= 0) return 'now';
  const parts: string[] = [];
  let rest = blocks;
  const years = Math.floor(rest / BLOCKS_PER_YEAR);
  if (years > 0) {
    parts.push(`${years} year${years === 1 ? '' : 's'}`);
    rest -= years * BLOCKS_PER_YEAR;
  }
  const months = Math.floor(rest / BLOCKS_PER_MONTH);
  if (months > 0) {
    parts.push(`${months} month${months === 1 ? '' : 's'}`);
    rest -= months * BLOCKS_PER_MONTH;
  }
  const days = Math.floor(rest / BLOCKS_PER_DAY);
  if (days > 0 || parts.length === 0) {
    if (days < 1) {
      // Sub-hour locks (e.g. the 10-minute heir TEST lock) say minutes —
      // "1 hour" for a 1-block lock misled a phone test (2026-07-26).
      const mins = rest * BLOCK_MINUTES;
      if (mins < 60) return `${Math.max(1, mins)} minutes`;
      const hours = Math.max(1, Math.round(mins / 60));
      return `${hours} hour${hours === 1 ? '' : 's'}`;
    }
    parts.push(`${days} day${days === 1 ? '' : 's'}`);
  }
  return parts.join(', ');
}
