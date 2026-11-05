/**
 * Which coins the coin list calls possible bait from a stranger (decided
 * 2026-10-31 after a phone test: a 755 sat change coin from the vault's own
 * payment carried the warning).
 *
 * The coin's transaction decides, never its address. A transaction that spent
 * this vault's coins was signed with this vault's keys, so nothing it created
 * came from a stranger. A change address proves nothing: it is public once it
 * has been paid, and anyone can pay it again.
 */
import type { Utxo, WalletTx } from '../bitcoin/engine/types';

/** Below this a coin is unusually small. */
const SMALL_COIN_SATS = 1000;

/** The vault's own payments: the transactions that spent its coins. */
export function ownPaymentIds(txs: WalletTx[]): Set<string> {
  return new Set(txs.filter((t) => t.sent > 0).map((t) => t.txid));
}

/**
 * A small coin this vault's own payments do not explain. A coin whose
 * transaction is not in the history stays in: "could be" is all that is known
 * of it, and hiding the warning from real bait costs more than showing it.
 */
export function mayBeBait(
  coin: Pick<Utxo, 'txid' | 'valueSats'>,
  ownPayments: ReadonlySet<string>,
): boolean {
  return coin.valueSats < SMALL_COIN_SATS && !ownPayments.has(coin.txid);
}
