/**
 * How each writer of portfolio entries starts its ids. Every writer makes its
 * ids DETERMINISTIC, so a re-sync, a second phone or a second snapshot of the
 * same record merges instead of duplicating, and an entry's id says where it
 * came from (`wallet/entryDetails.ts` `entryOrigin`).
 *
 * A leaf module on purpose: the exchange modules, the vault snapshot and the
 * entry page all read these, and none of them may import another for it.
 */

/** A Kraken trade or ledger row: `kraken-<txid|ledgerId>`. */
export const KRAKEN_ENTRY_PREFIX = 'kraken-';

/** How the Kraken sync's note starts on a bitcoin deposit and a withdrawal,
 *  the entries it writes from LEDGER rows rather than trades. */
export const KRAKEN_LEDGER_NOTES = { deposit: 'Deposit to Kraken.', withdrawal: 'Withdrawal from Kraken.' } as const;

/**
 * True for a Kraken entry written from a TRADE, the only kind bought or sold
 * at Kraken (decided 2026-10-22): a deposit or a withdrawal moved coins in or
 * out, bought elsewhere or kept elsewhere. Kraken names its trades `T…` and
 * its ledger rows `L…`, and the sync's note says deposit or withdrawal; an
 * entry either one marks as a ledger row, or anything unclear, is not a trade.
 */
export function isKrakenTradeEntry(entry: { id: string; note?: string }): boolean {
  if (!entry.id.startsWith(`${KRAKEN_ENTRY_PREFIX}T`)) return false;
  const note = entry.note ?? '';
  return !note.startsWith(KRAKEN_LEDGER_NOTES.deposit) && !note.startsWith(KRAKEN_LEDGER_NOTES.withdrawal);
}

/** A Coinbase fill: `coinbase-<entry_id>`. */
export const COINBASE_ENTRY_PREFIX = 'coinbase-';

/** A vault's transaction: `vsnap-<start of the vault's id>-<start of the txid>`. */
export const SNAPSHOT_ENTRY_PREFIX = 'vsnap-';

/** How much of the vault's id a snapshot entry's id carries. */
export const SNAPSHOT_VAULT_ID_CHARS = 8;
