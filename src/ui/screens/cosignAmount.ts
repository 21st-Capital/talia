/**
 * The figure a spend on the signing screen leads with BEFORE it goes out:
 * what the co-sign panel shows, what goes to 21st Capital as the request's
 * amount, what the parked pending record stores and so what the Pending
 * transactions row shows. Pure, so every case is pinned
 * (`__tests__/cosignAmount.test.ts`).
 *
 *   - a cancel: the PAYMENT it cancels (decided 2026-09-28 for Speed up and Cancel),
 *     never every coin coming back, change included;
 *   - a sped-up return, which is the same cancel (every coin goes back to
 *     the vault): the cancelled payment's amount too, from Talia's records
 *     (`returnedPayment`, the figure the Sent page's hero and the transaction
 *     page show), and nothing when the records cannot say, never the coins
 *     it moves (decided 2026-10-02);
 *   - otherwise the recipient's amount, or, when every coin stays in the
 *     vault (a refresh, a sped-up refresh), the total it moves.
 */
import type { ReplacementParams } from '../../wallet/txReplacementLogic';

type Replaces = Pick<ReplacementParams, 'kind' | 'amountSats' | 'what'> | null | undefined;

/**
 * A speed-up of a return: by the plan's own word (`what`), or because the
 * records found a cancel earlier in its chain (`returnSats` is only ever set
 * for one). The signing screen's Sent page and its co-sign figure both ask
 * this, so the two cannot disagree.
 */
export function isSpedUpReturn(replaces: Replaces, returnSats: number | null): boolean {
  return replaces?.kind === 'speedup' && (replaces.what === 'return' || returnSats != null);
}

export function cosignAmount(input: {
  replaces: Replaces;
  /** A sped-up return's cancelled payment, from the records; null otherwise or unknown. */
  returnSats: number | null;
  /** The spend's outputs, `isOwn` by BDK's isMine (unset = not the vault's); null before it is read. */
  outputs: ReadonlyArray<{ isOwn?: boolean; amountSats: number }> | null | undefined;
}): number | null {
  const { replaces, returnSats, outputs } = input;
  if (replaces?.kind === 'cancel') return replaces.amountSats;
  if (isSpedUpReturn(replaces, returnSats)) return returnSats != null && returnSats > 0 ? returnSats : null;
  const out = outputs ?? [];
  const recipient = out.find((o) => !o.isOwn);
  if (recipient) return recipient.amountSats;
  if (out.length > 0) return out.reduce((sum, o) => sum + o.amountSats, 0);
  return null;
}
