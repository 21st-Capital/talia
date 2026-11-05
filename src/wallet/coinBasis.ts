/**
 * Per-coin cost basis for ON-CHAIN vaults (decided 2026-08-25): the owner records
 * what they paid against individual coins, and the vault reports profit/loss
 * at the live price.
 *
 * Design decisions, settled after an adversarial review round:
 *
 * - **Store only what the owner typed.** A record is anchored to the outpoint
 *   the owner was looking at (`txid:vout`) and is never rewritten by sync
 *   logic. Everything else — which records still have a living coin, the
 *   vault totals — is DERIVED on every call and never persisted, so an RBF,
 *   a reorg or a re-imported wallet self-heals with zero cleanup code.
 * - **Never extrapolate.** P/L is computed ONLY over coins that carry a
 *   recorded cost. Covered and uncovered sats are reported separately; the
 *   balance as a whole is not in scope of any P/L figure. (The manual-vault
 *   maths average across the whole balance — correct there, where every sat
 *   comes from an entry; catastrophically wrong here, where partial coverage
 *   is the permanent default. Do not reuse `manualSummary` on coins.)
 * - **A spent coin STRANDS its record** rather than deleting it. The owner
 *   typed that number; a timelock refresh or an outside spend must not
 *   silently destroy it. Stranded records are surfaced for reassignment to a
 *   successor coin — the owner knows where the money went better than any
 *   heuristic. (An automatic transaction-graph carry-over is a possible later
 *   increment; v1 is deliberately manual and honest.)
 * - `undefined` means unknown, never zero. Non-finite numbers are rejected at
 *   the boundary so NaN can never masquerade as a known cost.
 *
 * Pure: no storage, no native, no clock. Fully unit-tested.
 */
import type { Utxo } from '../bitcoin/engine/types';
import type { FiatCurrency } from './types';

export const SATS_PER_BTC = 100_000_000;

/** The canonical coin id, shared app-wide: `txid:vout`. */
export function outpointKey(u: { txid: string; vout: number }): string {
  return `${u.txid}:${u.vout}`;
}

/** One recorded cost: "this coin cost me this much". Immutable once written
 *  (editing replaces the record; nothing else ever rewrites it). */
export interface CoinBasisRecord {
  /** Outpoint key (`txid:vout`) of the coin the owner priced. */
  outpoint: string;
  /** The coin's value AT RECORDING TIME — lets a stranded record still say
   *  "0.25 BTC bought for $10,000" after the coin itself is gone. */
  amountSats: number;
  /** TOTAL fiat paid for this coin (not per-BTC) — what a receipt says. */
  costFiat: number;
  fiatCurrency: FiatCurrency;
  /**
   * Where the number came from:
   *  - 'user': the owner typed it (a real purchase price).
   *  - 'marketOnDate': the owner accepted the suggested market value for the
   *    coin's arrival day. A market value is NOT a purchase price — for coins
   *    moved in from elsewhere it can be far from what was really paid — so
   *    the provenance is kept and shown, never laundered into 'user'.
   */
  source: 'user' | 'marketOnDate';
  note?: string;
  /** Unix ms when the record was created/last edited. */
  updatedAt: number;
}

/** A record joined against the live coin list. */
export interface ResolvedBasis {
  record: CoinBasisRecord;
  /** The living coin, when its outpoint still exists. */
  coin?: Utxo;
  /** True when no current coin matches — spent, refreshed, or reorged out. */
  stranded: boolean;
}

export interface VaultBasisSummary {
  /** Sats of LIVING coins that carry a recorded cost. */
  coveredSats: number;
  /** Sats of living coins with no recorded cost. */
  uncoveredSats: number;
  /** Total recorded cost over covered coins, in the summary currency. */
  costFiat: number;
  /** Number of living priced coins / total living coins. */
  pricedCoins: number;
  totalCoins: number;
  /** Records whose coin no longer exists — awaiting reassignment. */
  strandedRecords: CoinBasisRecord[];
  /** Records converted from another currency at their day's rate. */
  convertedRecords: number;
  /** Records in a DIFFERENT currency with NO conversion available —
   *  excluded from `costFiat` and `coveredSats`, surfaced so the UI says
   *  the figure is partial instead of quietly under-reporting. */
  unconvertedRecords: number;
}

/** Join records to the live coin list. Order follows the records list. */
export function resolveBasis(
  records: readonly CoinBasisRecord[],
  coins: readonly Utxo[],
): ResolvedBasis[] {
  const byKey = new Map(coins.map((c) => [outpointKey(c), c]));
  return records.map((record) => {
    const coin = byKey.get(record.outpoint);
    return { record, coin, stranded: coin == null };
  });
}

/** Cost record for one coin, or undefined. Never invents a value. */
export function basisForCoin(
  records: readonly CoinBasisRecord[],
  coin: Utxo,
): CoinBasisRecord | undefined {
  const k = outpointKey(coin);
  return records.find((r) => r.outpoint === k);
}

/** A record's cost expressed in `currency`, or undefined when it cannot be:
 *  same-currency records pass through; other currencies need an `fx` value
 *  (record outpoint → cost in `currency` at that day's rate, computed by the
 *  UI via wallet/fxRate.ts — this module stays pure and sync). */
export function recordCostIn(
  record: CoinBasisRecord,
  currency: FiatCurrency,
  fx?: ReadonlyMap<string, number>,
): number | undefined {
  const raw = record.fiatCurrency === currency ? record.costFiat : fx?.get(record.outpoint);
  // Boundary guard: a corrupt or unconverted record reads as absent, never
  // as $NaN — NaN passes every `!= null` check downstream.
  if (raw == null || !Number.isFinite(raw) || raw < 0) return undefined;
  return raw;
}

/**
 * Roll the vault up in `currency`. Other-currency records convert via `fx`;
 * anything without a conversion is counted and disclosed, never guessed.
 */
export function vaultBasisSummary(
  records: readonly CoinBasisRecord[],
  coins: readonly Utxo[],
  currency: FiatCurrency,
  fx?: ReadonlyMap<string, number>,
): VaultBasisSummary {
  const resolved = resolveBasis(records, coins);
  const priced = new Set<string>();
  let coveredSats = 0;
  let costFiat = 0;
  let convertedRecords = 0;
  let unconvertedRecords = 0;
  const strandedRecords: CoinBasisRecord[] = [];

  for (const { record, coin, stranded } of resolved) {
    if (stranded) {
      strandedRecords.push(record);
      continue;
    }
    const cost = recordCostIn(record, currency, fx);
    if (cost == null) {
      if (record.fiatCurrency !== currency) unconvertedRecords += 1;
      continue;
    }
    if (priced.has(record.outpoint)) continue; // one record per coin
    priced.add(record.outpoint);
    if (record.fiatCurrency !== currency) convertedRecords += 1;
    coveredSats += coin!.valueSats;
    costFiat += cost;
  }

  const totalLiveSats = coins.reduce((s, c) => s + c.valueSats, 0);
  return {
    coveredSats,
    uncoveredSats: totalLiveSats - coveredSats,
    costFiat,
    pricedCoins: priced.size,
    totalCoins: coins.length,
    strandedRecords,
    convertedRecords,
    unconvertedRecords,
  };
}

/**
 * Unrealized P/L over COVERED coins only, at the live price. Undefined when
 * nothing is priced — a P/L with no recorded cost behind it is fiction.
 * The uncovered part of the balance is deliberately not in scope: pricing
 * one coin must never produce a headline about the whole vault.
 */
export function vaultUnrealizedFiat(
  summary: VaultBasisSummary,
  btcPriceFiat: number,
): number | undefined {
  if (summary.pricedCoins === 0 || summary.coveredSats <= 0) return undefined;
  if (!Number.isFinite(btcPriceFiat) || btcPriceFiat <= 0) return undefined;
  const valueNow = btcPriceFiat * (summary.coveredSats / SATS_PER_BTC);
  const pnl = valueNow - summary.costFiat;
  return Number.isFinite(pnl) ? pnl : undefined;
}

/** P/L for ONE priced coin at the live price — the per-row chip.
 *  `costFiat` must already be in the price's currency (see recordCostIn). */
export function coinUnrealizedFiat(
  costFiat: number,
  coin: Utxo,
  btcPriceFiat: number,
): number | undefined {
  if (!Number.isFinite(costFiat) || costFiat < 0) return undefined;
  if (!Number.isFinite(btcPriceFiat) || btcPriceFiat <= 0) return undefined;
  const pnl = btcPriceFiat * (coin.valueSats / SATS_PER_BTC) - costFiat;
  return Number.isFinite(pnl) ? pnl : undefined;
}

/** Why a proposed record cannot be saved, or null when it is fine. */
export function coinBasisError(proposed: {
  costFiat: number;
  amountSats: number;
}): string | null {
  if (!Number.isFinite(proposed.costFiat) || proposed.costFiat < 0) {
    return 'Enter what you paid as a plain amount, like 12500.';
  }
  if (!Number.isFinite(proposed.amountSats) || proposed.amountSats <= 0) {
    return 'This coin has no value to price.';
  }
  return null;
}

/**
 * Reassign a stranded record to a living coin: the honest manual carry-over
 * after a refresh or consolidation. Returns a NEW record (the old anchor is
 * replaced; cost, currency, source and note travel unchanged — the money is
 * the same money, so what it cost does not change).
 */
export function reassignRecord(
  record: CoinBasisRecord,
  to: Utxo,
  now: number,
): CoinBasisRecord {
  return {
    ...record,
    outpoint: outpointKey(to),
    amountSats: to.valueSats,
    updatedAt: now,
  };
}
