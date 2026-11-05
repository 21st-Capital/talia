/**
 * Has a saved address spent coins before? The rule, pure (decided
 * 2026-11-05).
 *
 * Paying an address that already spent coins links the payment to
 * everything it did before, so a saved Private Address that has spent shows
 * a gold notice on Send and on the Add address page. The facts come from the
 * vault's own server through the bridge (`addressActivity`,
 * bitcoin/engine/types.ts `AddressActivity`); the verdict is decided here:
 *
 *   'txs'   (a history of at most 50 transactions, each read whole): SPENT
 *           if and only if some transaction in the list spends "<p>:<v>"
 *           where p is a transaction in the list and v is one of p's
 *           outputs paying the address. That covers a spend still in the
 *           mempool and a spend that pays back to the same address. A coin
 *           of p that did not pay the address is someone else's and says
 *           nothing. Otherwise 'notFound', an empty history included.
 *   'long'  (above 50: the history first, then the coins it holds): SPENT
 *           when some CONFIRMED history transaction is not among the
 *           transactions of the coins it still holds (a coin of it was
 *           spent, or it spent one); otherwise 'unknown', never 'notFound':
 *           a spend can hide behind a coin of the same transaction that is
 *           still held. A mempool entry proves nothing here, because it can
 *           be gone between the two questions.
 *   no answer, a malformed one, any error, no server: 'unknown'.
 *
 * 'notFound' is never shown as safe: a server that indexes only its owner's
 * wallets (a personal server) answers nothing for every other address, so
 * nothing found is shown as nothing at all.
 */
import type {
  AddressActivity,
  AddressActivityTx,
  AddressHistoryItem,
  AddressUnspentItem,
} from '../bitcoin/engine/types';

export type { AddressActivity, AddressActivityTx, AddressHistoryItem, AddressUnspentItem };

/** What the facts say: spent, nothing found, or nothing can be said. */
export type ActivityVerdict = 'spent' | 'notFound' | 'unknown';

const TXID = /^[0-9a-f]{64}$/i;
const OUTPOINT = /^([0-9a-f]{64}):(\d{1,10})$/i;

const isTxid = (v: unknown): v is string => typeof v === 'string' && TXID.test(v);
const isHeight = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= -1;
const isVout = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;

function isTx(t: unknown): t is AddressActivityTx {
  const o = t as Partial<AddressActivityTx> | null;
  return (
    !!o &&
    isTxid(o.txid) &&
    isHeight(o.height) &&
    Array.isArray(o.spends) &&
    o.spends.every((s) => typeof s === 'string' && OUTPOINT.test(s)) &&
    Array.isArray(o.pays) &&
    o.pays.every(isVout)
  );
}

function isHistoryItem(h: unknown): h is AddressHistoryItem {
  const o = h as Partial<AddressHistoryItem> | null;
  return !!o && isTxid(o.txid) && isHeight(o.height);
}

function isUnspentItem(u: unknown): u is AddressUnspentItem {
  const o = u as Partial<AddressUnspentItem> | null;
  return !!o && isTxid(o.txid) && isVout(o.vout) && isHeight(o.height);
}

/** Is this the bridge's answer, field by field? Anything else reads as 'unknown'. */
export function isAddressActivity(a: unknown): a is AddressActivity {
  const o = a as { kind?: unknown; txs?: unknown; history?: unknown; unspent?: unknown } | null;
  if (!o || typeof o !== 'object') return false;
  if (o.kind === 'txs') return Array.isArray(o.txs) && o.txs.every(isTx);
  if (o.kind === 'long') {
    return Array.isArray(o.history) && o.history.every(isHistoryItem) && Array.isArray(o.unspent) && o.unspent.every(isUnspentItem);
  }
  return false;
}

/** "<txid>:<vout>" in one spelling: the txid in lower case, the vout as a plain number. */
function outpointKey(txid: string, vout: number): string {
  return `${txid.toLowerCase()}:${vout}`;
}

/** The verdict on the bridge's facts (the rule above). Null or anything malformed is 'unknown'. */
export function activityVerdict(activity: AddressActivity | null | undefined): ActivityVerdict {
  if (!isAddressActivity(activity)) return 'unknown';
  if (activity.kind === 'txs') {
    const paidHere = new Set<string>();
    for (const tx of activity.txs) for (const vout of tx.pays) paidHere.add(outpointKey(tx.txid, vout));
    const spent = activity.txs.some((tx) =>
      tx.spends.some((s) => {
        const m = OUTPOINT.exec(s)!;
        return paidHere.has(outpointKey(m[1], Number(m[2])));
      }),
    );
    return spent ? 'spent' : 'notFound';
  }
  const stillHeld = new Set(activity.unspent.map((u) => u.txid.toLowerCase()));
  const spent = activity.history.some((h) => h.height > 0 && !stillHeld.has(h.txid.toLowerCase()));
  return spent ? 'spent' : 'unknown';
}
