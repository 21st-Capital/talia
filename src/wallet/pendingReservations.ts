/**
 * Coins already committed to a signed spend that has not gone out yet
 * (decided 2026-09-26).
 *
 * A pending co-sign request or a parked half-signed spend carries the
 * client's signature, and once 21st Capital co-signs it is a complete,
 * broadcastable transaction that exists outside this phone. Building a
 * second spend of the same coins made two valid conflicting transactions
 * and a race. So a new build leaves those coins alone unless the client
 * picks them by hand (coin control), which is an explicit choice.
 *
 * Only a request that 21st Capital may still co-sign, or already has,
 * holds its coins (decided after that fix). A request the server rejected or
 * cancelled can never become a co-signed transaction, and a completed one
 * has spent its coins already, so their coins are free again: an
 * over-limit request is created and rejected at once, and a smaller payment
 * straight after it must still be possible. A spend parked on this phone
 * alone (awaiting the client's own next key) never holds anything; the
 * client finishes or discards it themselves.
 *
 * Pure: the caller loads the records.
 */
import { psbtTxShape } from '../bitcoin/psbt/broadcastCheck';

export interface PendingSpendRecord {
  walletId: string;
  originalPsbt: string;
  /** 'device' = parked on this phone for the client's own next key. */
  awaiting?: 'cosigner' | 'device';
  /** The server's last known status (absent = not known yet). */
  serverStatus?: string;
}

/** Statuses after which 21st Capital's signature can no longer appear. */
const SETTLED = new Set(['rejected', 'cancelled', 'completed']);

/** Does this record keep its coins out of a new spend? */
export function recordHoldsCoins(p: PendingSpendRecord): boolean {
  if (p.awaiting === 'device') return false;
  return !(p.serverStatus && SETTLED.has(p.serverStatus));
}

/** Every `txid:vout` a pending record of this vault holds, lowercase. */
export function reservedOutpoints(
  pending: PendingSpendRecord[],
  walletId: string,
): Array<{ txid: string; vout: number }> {
  const seen = new Set<string>();
  const out: Array<{ txid: string; vout: number }> = [];
  for (const p of pending) {
    if (p.walletId !== walletId || !recordHoldsCoins(p)) continue;
    const shape = psbtTxShape(p.originalPsbt);
    for (const i of shape?.inputs ?? []) {
      const key = `${i.txid.toLowerCase()}:${i.vout}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ txid: i.txid.toLowerCase(), vout: i.vout });
    }
  }
  return out;
}

/**
 * How much of the vault's balance those coins are: what Send takes off the
 * amount it offers, so the client is never offered money a build then
 * refuses. Coins the vault no longer has count nothing.
 */
export function reservedSats(
  reserved: Array<{ txid: string; vout: number }>,
  utxos: Array<{ txid: string; vout: number; valueSats: number }>,
): number {
  const held = new Set(reserved.map((r) => `${r.txid.toLowerCase()}:${r.vout}`));
  return utxos.reduce(
    (sum, u) => (held.has(`${u.txid.toLowerCase()}:${u.vout}`) ? sum + u.valueSats : sum),
    0,
  );
}

/** Send's notice when every coin is held for a pending transaction. */
export const HELD_ALL = 'Your coins are held by a pending transaction.';
/** Send's notice when what is left after the held coins is not enough. */
export const HELD_SHORT =
  'Not enough BTC free for this payment. Some coins are held by a pending transaction.';
