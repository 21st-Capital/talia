/**
 * Snapshot an ON-CHAIN vault into a virtual portfolio (decided 2026-08-26).
 *
 * The vault itself is untouched — it keeps watching the real coins. What this
 * builds is the hand-kept mirror: every real deposit becomes a "Bought" entry
 * and every real withdrawal a "Sold" entry, each dated by its confirming
 * block. Self-transfers (timelock refreshes, consolidations) are SKIPPED —
 * they move coins between the vault's own addresses, and the whole reason
 * for separating portfolios from vaults is that those events are not buys or
 * sells and must never look like them.
 *
 * Amounts use the transaction's NET effect on the wallet (received − sent),
 * so the sum of all entries equals the vault's balance exactly — an outgoing
 * payment's fee counts as part of the disposal, which is what actually left.
 *
 * Prices are NOT set here: this module is pure and sync. The caller offers
 * market-on-date estimates separately (clearly noted as estimates), and the
 * owner can always edit — a snapshot's numbers are theirs to correct.
 */
import type { WalletTx } from '../bitcoin/engine/types';
import { isSelfTransfer } from './history';
import type { ManualEntry } from './manualLedger';
import { SNAPSHOT_ENTRY_PREFIX, SNAPSHOT_VAULT_ID_CHARS } from './entryIds';

export interface PortfolioSnapshotEntry {
  kind: 'buy' | 'sell';
  amountSats: number;
  /** Unix ms of the confirming block. */
  date: number;
  /** Unix secs of the confirming block — for the caller's price lookups. */
  tsSecs: number;
  /** The transaction this entry came from — the basis of its identity. */
  txid: string;
}

/** Map a vault's transaction history to portfolio entries, oldest first. */
export function portfolioEntriesFromHistory(txs: readonly WalletTx[]): PortfolioSnapshotEntry[] {
  const out: PortfolioSnapshotEntry[] = [];
  for (const tx of txs) {
    if (!tx.confirmed || tx.timestamp == null) continue; // pending = not yet real
    if (isSelfTransfer(tx)) continue; // refresh/consolidation — not a buy or sell
    if (tx.netAmount === 0) continue;
    out.push({
      kind: tx.netAmount > 0 ? 'buy' : 'sell',
      amountSats: Math.abs(tx.netAmount),
      date: tx.timestamp * 1000,
      tsSecs: tx.timestamp,
      txid: tx.txid,
    });
  }
  return out.sort((a, b) => a.date - b.date);
}

/** A snapshot entry's DETERMINISTIC id: the same vault transaction always
 *  produces the same entry id, so adding a vault to a portfolio twice — or
 *  snapshotting the same vault on two synced phones — merges instead of
 *  duplicating (decided 2026-08-26: "add a vault to an existing portfolio"). */
export function snapshotEntryId(vaultId: string, txid: string): string {
  return `${SNAPSHOT_ENTRY_PREFIX}${vaultId.slice(0, SNAPSHOT_VAULT_ID_CHARS)}-${txid.slice(0, 16)}`;
}

/** Finalize snapshot entries into ManualEntry records. `prices` maps the
 *  snapshot index to a TOTAL fiat amount (an estimate the caller looked up);
 *  entries without one stay unpriced. Estimated prices carry a note saying
 *  so — a snapshot must never masquerade as the owner's own records. */
export function toManualEntries(
  snapshot: readonly PortfolioSnapshotEntry[],
  opts: {
    prices?: ReadonlyMap<number, number>;
    fiatCurrency: ManualEntry['fiatCurrency'];
    now: number;
    /** The source vault — drives the deterministic entry ids. */
    vaultId: string;
  },
): ManualEntry[] {
  return snapshot.map((e, i) => {
    const fiatAmount = opts.prices?.get(i);
    return {
      id: snapshotEntryId(opts.vaultId, e.txid),
      kind: e.kind,
      amountSats: e.amountSats,
      date: e.date,
      fiatAmount: fiatAmount != null && Number.isFinite(fiatAmount) ? fiatAmount : undefined,
      fiatCurrency: fiatAmount != null && Number.isFinite(fiatAmount) ? opts.fiatCurrency : undefined,
      note:
        fiatAmount != null && Number.isFinite(fiatAmount)
          ? 'Estimated at that day’s market price. Edit it if you know the real amount.'
          : 'From the vault’s history. You can add what you paid if you know it.',
      createdAt: opts.now,
    };
  });
}
