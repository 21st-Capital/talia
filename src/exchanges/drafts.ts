/**
 * What every exchange module hands the sync service: a portfolio entry as
 * the exchange described it, plus what the service still has to do with it.
 */
import type { ManualEntry } from '../wallet/manualLedger';

export interface ExchangeEntryDraft {
  entry: ManualEntry;
  /** Unix seconds of the record, for the caller's price lookup. */
  tsSecs: number;
  /** True when the record carries no fiat receipt (a trade against another
   *  coin, a deposit, a withdrawal): the caller estimates and marks it. */
  needsEstimate: boolean;
}

/**
 * Which drafts are NEW to a portfolio: not already there, and not deleted by
 * the owner (a tombstoned auto-entry stays deleted, as with linked vaults).
 */
export function freshDrafts(
  drafts: readonly ExchangeEntryDraft[],
  existing: readonly Pick<ManualEntry, 'id'>[],
  deletedIds: ReadonlySet<string>,
): ExchangeEntryDraft[] {
  const have = new Set(existing.map((e) => e.id));
  return drafts.filter((d) => !have.has(d.entry.id) && !deletedIds.has(d.entry.id));
}
