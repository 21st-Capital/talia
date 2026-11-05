/**
 * Can this vault be rescued now? (decided 2026-09-21: "only let him continue if
 * the path is active, graying out all inactive paths ... We only allow
 * sweeping the entire vault anyways, so there is no need to even show him
 * the coins that are ready. Rescue is only possible if ALL coins are
 * active.")
 *
 * A rescue moves EVERY coin of the vault through the rescue key's
 * timelocked path, so a vault is ready only when that path has opened for
 * every coin. A coin whose clock has not started (unconfirmed) counts as a
 * full window, as the countdowns elsewhere do. Pure and tested.
 */
import type { UtxoExpiry } from './timelock';

export type RescueReadiness =
  /** Every coin has reached the rescue path: the whole vault can move. */
  | { state: 'ready'; sats: number; coins: Array<{ txid: string; vout: number }> }
  /** Some coin is still locked: `blocks` until the LAST one opens. */
  | { state: 'waiting'; blocks: number }
  /** Nothing in the vault to rescue. */
  | { state: 'empty' };

export function rescueReadiness(
  utxos: ReadonlyArray<{ txid: string; vout: number; valueSats: number }>,
  expiries: ReadonlyArray<UtxoExpiry>,
  olderBlocks: number,
): RescueReadiness {
  if (utxos.length === 0) return { state: 'empty' };
  let sats = 0;
  let lastOpens = 0;
  const coins: Array<{ txid: string; vout: number }> = [];
  for (const u of utxos) {
    const e = expiries.find((x) => x.txid === u.txid && x.vout === u.vout);
    const left = e?.blocksLeft ?? olderBlocks;
    if (left > 0) lastOpens = Math.max(lastOpens, left);
    sats += u.valueSats;
    coins.push({ txid: u.txid, vout: u.vout });
  }
  if (lastOpens > 0) return { state: 'waiting', blocks: lastOpens };
  return { state: 'ready', sats, coins };
}

/** What a signed transaction says it waits for, as the network reads it. */
export interface SignedTxWaits {
  version: number;
  lockTime: number;
  inputs: ReadonlyArray<{ txid: string; vout: number; sequence: number }>;
}

/** nLockTime from here up is a Unix time, below it a block height. */
const LOCKTIME_THRESHOLD = 500_000_000;
const SEQUENCE_FINAL = 0xffffffff;
const SEQUENCE_DISABLE_FLAG = 0x80000000;
const SEQUENCE_TYPE_FLAG = 0x00400000;
const SEQUENCE_MASK = 0x0000ffff;

/**
 * Can a SIGNED spend go out now, or would the network still refuse it as
 * too early? (Decided 2026-10-07: BDK finalizes a timelocked spend
 * as soon as the signatures are there, whatever the age of its coins, so a
 * rescue assembled and the network then refused it.)
 *
 * The transaction says itself what it waits for: each input's nSequence
 * (BIP-68, a relative wait counted from its coin's block: `older(N)`) and
 * its nLockTime (an absolute block height: `after(N)`). Every coin's
 * relative wait is judged exactly as the Rescue screen judges a vault,
 * through `rescueReadiness`, so a rescue that screen calls ready is never
 * refused here.
 *
 * Only a wait that is PROVABLY not over is 'waiting': a coin whose
 * transaction the phone does not know, no chain tip, or a wait counted in
 * time rather than blocks is 'unknown', and unknown never stops a send.
 */
export function signedSpendReadiness(
  tx: SignedTxWaits,
  txs: ReadonlyArray<{ txid: string; confirmed: boolean; blockHeight?: number }>,
  tipHeight: number | undefined,
): { state: 'ready' } | { state: 'waiting'; blocks: number } | { state: 'unknown' } {
  if (tipHeight == null) return { state: 'unknown' };
  let blocks = 0;
  let unknown = false;

  // nLockTime binds unless every input opts out (0xFFFFFFFF). The next block
  // must be above it, so a height at or below the tip is final.
  if (tx.lockTime > 0 && tx.inputs.some((i) => i.sequence !== SEQUENCE_FINAL)) {
    if (tx.lockTime >= LOCKTIME_THRESHOLD) unknown = true;
    else if (tx.lockTime > tipHeight) blocks = tx.lockTime - tipHeight;
  }

  // BIP-68 binds from version 2, on inputs without the disable flag.
  if (tx.version >= 2) {
    const byWait = new Map<number, Array<{ txid: string; vout: number }>>();
    for (const i of tx.inputs) {
      if ((i.sequence & SEQUENCE_DISABLE_FLAG) !== 0) continue;
      if ((i.sequence & SEQUENCE_TYPE_FLAG) !== 0) {
        unknown = true; // 512-second units: the chain's clock, not a block count
        continue;
      }
      const wait = i.sequence & SEQUENCE_MASK;
      if (wait > 0) byWait.set(wait, [...(byWait.get(wait) ?? []), i]);
    }
    const known = new Map(txs.map((t) => [t.txid.toLowerCase(), t]));
    for (const [wait, coins] of byWait) {
      const judged = coins.filter((c) => {
        const t = known.get(c.txid.toLowerCase());
        // In the history, and either waiting for a block or in one we know.
        const readable = !!t && (!t.confirmed || typeof t.blockHeight === 'number');
        if (!readable) unknown = true;
        return readable;
      });
      const expiries = judged.map((c) => {
        const t = known.get(c.txid.toLowerCase())!;
        // A coin still waiting for its block has not started its clock:
        // rescueReadiness counts it as the full wait, as every countdown does.
        return { txid: c.txid, vout: c.vout, blocksLeft: t.confirmed ? t.blockHeight! + wait - tipHeight : null };
      });
      const verdict = rescueReadiness(
        judged.map((c) => ({ ...c, valueSats: 0 })),
        expiries,
        wait,
      );
      if (verdict.state === 'waiting') blocks = Math.max(blocks, verdict.blocks);
    }
  }

  if (blocks > 0) return { state: 'waiting', blocks };
  return unknown ? { state: 'unknown' } : { state: 'ready' };
}

/**
 * When the OLDEST coin the vault holds now arrived (ms since 1970), to tell
 * a refresh from a deposit. A coin still unconfirmed arrived `now`; one
 * whose transaction the history does not have, or whose block carries no
 * time, counts as old (0), so what cannot be read never ends anything.
 * Null for an empty vault.
 */
export function oldestCoinArrival(
  utxos: ReadonlyArray<{ txid: string }>,
  txs: ReadonlyArray<{ txid: string; confirmed?: boolean; timestamp?: number }>,
  now: number = Date.now(),
): number | null {
  if (utxos.length === 0) return null;
  const byTxid = new Map(txs.map((t) => [t.txid, t]));
  let oldest = Number.POSITIVE_INFINITY;
  for (const u of utxos) {
    const t = byTxid.get(u.txid);
    const at = !t ? 0 : t.confirmed === false ? now : typeof t.timestamp === 'number' ? t.timestamp * 1000 : 0;
    oldest = Math.min(oldest, at);
  }
  return oldest;
}

/**
 * The phone switches rescue mode off by itself only when the vault it is on
 * for was REFRESHED after it was switched on (decided 2026-07-24: the emergency
 * is over): the vault is not ready, and EVERY coin it holds arrived after
 * activation, so the coins that needed rescuing were moved by the client's
 * own keys.
 *
 * A deposit, or a stranger's small payment to an address they know, leaves
 * the old coins in place and never counts (decided 2026-10-05): since then
 * only an administrator can switch rescue mode back on, which restarts the
 * 48 hours and refuses the pending request, so a false reset is costly.
 *
 * `checks` are this phone's vaults rescue mode is on for; every one must
 * say so. Nothing is decided on an empty list, a check that did not come
 * back, an empty vault, or an activation time the server did not give.
 */
export function rescueModeLapsed(
  checks: ReadonlyArray<{ result: RescueReadiness | null; oldestArrival?: number | null }>,
  activatedAt: string | null | undefined,
): boolean {
  const at = activatedAt ? Date.parse(activatedAt) : Number.NaN;
  if (Number.isNaN(at) || checks.length === 0) return false;
  return checks.every(
    (c) => c.result?.state === 'waiting' && c.oldestArrival != null && c.oldestArrival > at,
  );
}

/**
 * The same answer from what this phone already has on disk (decided 2026-09-23:
 * "it should not take that long to know the timelock is expired", and "the
 * button should ONLY be clickable if the vault is fully ready").
 *
 * Asking the chain took a full sync per vault, so a client with six vaults
 * watched six spinners before learning anything, and the Spending policy
 * offered a rescue button that led to a wait. The coins, their funding
 * heights and the chain tip are all cached already: this reads them and
 * answers at once. The live check still runs behind it and replaces this,
 * because a cached answer is last-known, not now.
 *
 * `null` when the cache cannot answer: no coins cached and no tip height, so
 * nothing is claimed either way. A caller that gates a button on this treats
 * null as not ready, which is the safe reading.
 */
export function cachedRescueReadiness(
  utxos: ReadonlyArray<{ txid: string; vout: number; valueSats: number }> | null | undefined,
  txs: ReadonlyArray<{ txid: string; blockHeight?: number }> | null | undefined,
  tipHeight: number | undefined,
  olderBlocks: number,
): RescueReadiness | null {
  if (!utxos) return null;
  if (utxos.length === 0) return { state: 'empty' };
  // Without a tip there is no clock, and every coin would read as a full
  // window: that is a guess, not an answer.
  if (tipHeight == null) return null;
  const height = new Map<string, number | undefined>();
  for (const t of txs ?? []) height.set(t.txid, t.blockHeight);
  const expiries = utxos.map((u) => {
    const h = height.get(u.txid);
    return {
      txid: u.txid,
      vout: u.vout,
      blocksLeft: h == null ? null : h + olderBlocks - tipHeight,
    };
  });
  return rescueReadiness(utxos, expiries, olderBlocks);
}
