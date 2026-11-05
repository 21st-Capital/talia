/**
 * Feed a portfolio from an ON-CHAIN vault, started from the PORTFOLIO's side
 * (decided 2026-09-07: "Sync Portfolio" lists vaults within Talia as sources).
 *
 * The vault's cached history becomes buy/sell entries with deterministic ids
 * (the same ids the vault's own "Add to portfolio" makes, so the two doors
 * lead to one room and never duplicate), the vault is LINKED so later
 * activity flows in automatically (WalletProvider.autoAppendLinked), and
 * market estimates land in the background, marked as estimates.
 *
 * WalletDetailScreen keeps its own copy of the snapshot for its
 * create-or-add flow; the arithmetic both use lives in vaultToPortfolio.ts.
 */
import { getHistoricalPoint } from './historicalPrice';
import { loadManualEntries, saveManualEntries } from './manualEntries';
import { fiatDecimals } from './manualEntryPricing';
import { loadTxCache } from './txCache';
import type { FiatCurrency } from './types';
import { portfolioEntriesFromHistory, toManualEntries } from './vaultToPortfolio';

/** The tx cache caps at this many; a longer history would make a snapshot
 *  that silently disagrees with the vault's balance. */
const TX_CACHE_CAP = 300;

export type SnapshotOutcome =
  | { ok: true; added: number }
  | { ok: false; reason: 'tooLong' | 'noHistory' | 'nothingNew' };

export async function snapshotVaultIntoPortfolio(opts: {
  vaultId: string;
  portfolioId: string;
  fiat: FiatCurrency;
  btcOnly?: boolean;
  /** Called when background estimates were written, so a screen can reload. */
  onEstimated?: () => void;
}): Promise<SnapshotOutcome> {
  const txs = (await loadTxCache(opts.vaultId)) ?? [];
  if (txs.length >= TX_CACHE_CAP) return { ok: false, reason: 'tooLong' };
  const snap = portfolioEntriesFromHistory(txs);
  if (snap.length === 0) return { ok: false, reason: 'noHistory' };

  const entries = toManualEntries(snap, { fiatCurrency: opts.fiat, now: Date.now(), vaultId: opts.vaultId });
  const existing = await loadManualEntries(opts.portfolioId);
  const have = new Set(existing.map((e) => e.id));
  const fresh = entries.filter((e) => !have.has(e.id));
  if (fresh.length === 0) return { ok: false, reason: 'nothingNew' };
  await saveManualEntries(opts.portfolioId, [...existing, ...fresh]);

  if (!opts.btcOnly) {
    const decimals = fiatDecimals(opts.fiat);
    const freshIds = new Set(fresh.map((e) => e.id));
    void (async () => {
      const priced = new Map<string, number>();
      for (let i = 0; i < snap.length; i += 1) {
        if (!freshIds.has(entries[i].id)) continue;
        const point = await getHistoricalPoint(opts.fiat, snap[i].tsSecs);
        if (point != null) priced.set(entries[i].id, Number((point.rate * (snap[i].amountSats / 1e8)).toFixed(decimals)));
      }
      if (priced.size === 0) return;
      try {
        const current = await loadManualEntries(opts.portfolioId);
        await saveManualEntries(
          opts.portfolioId,
          current.map((e) => {
            const est = priced.get(e.id);
            return est != null && e.fiatAmount == null ? { ...e, fiatAmount: est, fiatCurrency: opts.fiat } : e;
          }),
        );
        opts.onEstimated?.();
      } catch {
        // estimates are a nicety; the entries stand without them
      }
    })();
  }
  return { ok: true, added: fresh.length };
}

/** Plain words for a snapshot that added nothing. */
export function snapshotOutcomeMessage(outcome: SnapshotOutcome, vaultLabel: string): string {
  if (outcome.ok) return outcome.added === 1 ? `1 entry added from ${vaultLabel}.` : `${outcome.added} entries added from ${vaultLabel}.`;
  switch (outcome.reason) {
    case 'tooLong':
      return `${vaultLabel} has more history than a snapshot can cover accurately. New activity will still be added as it happens.`;
    case 'noHistory':
      return `Talia has no history for ${vaultLabel} yet. Open the vault once with a working connection, then try again.`;
    case 'nothingNew':
      return `Everything from ${vaultLabel} is already here. New activity will be added as it happens.`;
  }
}
