/**
 * How long a waiting transaction is likely to take, at the fee it pays
 * (decided 2026-09-28, the Speed up and Cancel design, Option A).
 *
 * The rule compares the transaction's fee rate (its fee over its REAL
 * virtual size) with the live tiers from mempool.space's precise
 * recommendations, the same ones Send offers:
 *
 *   at or above High    "about 10 minutes"
 *   at or above Medium  "about 30 minutes"
 *   at or above Slow    "about an hour"
 *   below Slow          the first projected block (api/v1/fees/mempool-blocks)
 *                       whose fee range covers the rate, times 10 minutes,
 *                       rounded to hours ("about 3 hours")
 *
 * Past the projection, or with no live figures (offline, the static
 * fallback tiers), there is no answer and the screen leaves the line out.
 *
 * mempool.space projects eight blocks and the eighth holds EVERYTHING left
 * in the mempool, often many blocks' worth. A rate that lands in that last
 * block is placed inside it by the block's own fee range (seven fee rates,
 * lowest to highest, evenly spaced through its transactions) and the block's
 * size, so a payment deep in the backlog reads "about 5 hours" rather than
 * "about 80 minutes".
 *
 * Plain logic, no fetch and no React Native, so it can be tested. The fetch
 * is `mempoolBlocks.ts`.
 */
import type { FeePresets } from './feeEstimates';

/** One projected block as mempool.space's api/v1/fees/mempool-blocks returns it. */
export interface MempoolBlock {
  /** Virtual size of the block in vB. The last block can be far over 1,000,000. */
  blockVSize: number;
  /** Fee rates in sat/vB, lowest to highest (mempool.space sends seven). */
  feeRange: number[];
  medianFee?: number;
}

/** The phrase for each of Send's priorities, as the fee sheet's rows show it. */
export const TIER_ETA = {
  fast: 'about 10 minutes',
  medium: 'about 30 minutes',
  slow: 'about an hour',
} as const;

/** A full block, in vB (4,000,000 weight units). */
const BLOCK_VSIZE = 1_000_000;
const MINUTES_PER_BLOCK = 10;

/** The phrase for a wait of this many minutes, on the tiers' own steps. */
export function etaPhraseForMinutes(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes <= 10) return TIER_ETA.fast;
  if (minutes <= 30) return TIER_ETA.medium;
  const hours = Math.round(minutes / 60);
  if (hours <= 1) return TIER_ETA.slow;
  return `about ${hours} hours`;
}

/** Keep only well-formed blocks: a size and at least one fee rate. */
function usable(blocks: MempoolBlock[] | null | undefined): MempoolBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter(
    (b) =>
      b != null &&
      Number.isFinite(b.blockVSize) &&
      b.blockVSize > 0 &&
      Array.isArray(b.feeRange) &&
      b.feeRange.length > 0 &&
      b.feeRange.every((f) => Number.isFinite(f)),
  );
}

/**
 * Of this block's transactions, the share paying MORE than `rate`, read off
 * its fee range (the points are evenly spaced through the block's
 * transactions, lowest fee first). 1 when the rate is under the block's
 * lowest fee, 0 at or over its highest.
 */
function shareAbove(feeRange: number[], rate: number): number {
  const f = [...feeRange].sort((a, b) => a - b);
  if (f.length === 1) return rate >= f[0] ? 0 : 1;
  if (rate < f[0]) return 1;
  if (rate >= f[f.length - 1]) return 0;
  const steps = f.length - 1;
  for (let k = 0; k < steps; k++) {
    if (rate < f[k + 1]) {
      const span = f[k + 1] - f[k];
      const within = span > 0 ? (rate - f[k]) / span : 1;
      return 1 - (k + within) / steps;
    }
  }
  return 0;
}

/**
 * Blocks until a transaction paying `rate` is likely mined, from the
 * projection; null when the rate is below everything projected.
 */
export function blocksUntilMined(rate: number, blocks: MempoolBlock[] | null | undefined): number | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const ok = usable(blocks);
  for (let i = 0; i < ok.length; i++) {
    const b = ok[i];
    const lowest = Math.min(...b.feeRange);
    if (rate < lowest) continue;
    if (b.blockVSize <= BLOCK_VSIZE) return i + 1;
    // The catch-all block: the block inside it where the rate lands. The
    // space ahead (everything paying more) fills whole blocks first, so the
    // rate goes in the next one, counted from 1 as the ordinary blocks are.
    // The nudge keeps a float a hair under a whole number on that number.
    const ahead = shareAbove(b.feeRange, rate) * b.blockVSize;
    return i + 1 + Math.floor(ahead / BLOCK_VSIZE + 1e-9);
  }
  return null;
}

/**
 * "about 10 minutes", "about an hour", "about 3 hours", or null when there
 * is nothing true to say (offline, or past the projection).
 *
 * @param rate      the transaction's fee over its REAL virtual size, sat/vB
 * @param presets   Send's live tiers (`getFeePresets`); the static fallback
 *                  (`live: false`) means offline and gives null
 * @param blocks    the projected blocks, needed only below Slow
 */
export function etaForRate(
  rate: number,
  presets: FeePresets | null | undefined,
  blocks?: MempoolBlock[] | null,
): string | null {
  if (!presets || !presets.live || !Number.isFinite(rate) || rate <= 0) return null;
  if (rate >= presets.fast) return TIER_ETA.fast;
  if (rate >= presets.medium) return TIER_ETA.medium;
  if (rate >= presets.slow) return TIER_ETA.slow;
  const n = blocksUntilMined(rate, blocks);
  if (n == null) return null;
  // Below Slow is never quicker than Slow's own promise.
  return etaPhraseForMinutes(Math.max(n * MINUTES_PER_BLOCK, 60));
}

/** True when a rate this low needs the projected blocks to be placed. */
export function etaNeedsBlocks(rate: number, presets: FeePresets | null | undefined): boolean {
  return !!presets && presets.live && Number.isFinite(rate) && rate > 0 && rate < presets.slow;
}

/** The status card's line: "About 3 hours at this fee". Null stays null. */
export function etaLine(phrase: string | null | undefined): string | null {
  if (!phrase) return null;
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} at this fee`;
}
