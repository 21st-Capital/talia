/**
 * mempool.space's projected blocks (api/v1/fees/mempool-blocks), for the
 * "About N at this fee" line on a waiting transaction (`txEta.ts` holds the
 * rule). Same pattern as `feeEstimates.ts`: a 6-second timeout, a 60-second
 * cache, and it never throws; no answer is null and the line is left out.
 */
import type { Network } from '../bitcoin/descriptor/types';
import { getFeePresets } from './feeEstimates';
import { etaForRate, etaNeedsBlocks } from './txEta';
import type { MempoolBlock } from './txEta';

const URL = 'https://mempool.space/api/v1/fees/mempool-blocks';
const TTL_MS = 60_000;
const TIMEOUT_MS = 6_000;

let cache: { at: number; blocks: MempoolBlock[] } | null = null;

/** Keep what the rule can use from the endpoint's answer. Exported for tests. */
export function readMempoolBlocks(json: unknown): MempoolBlock[] | null {
  if (!Array.isArray(json)) return null;
  const blocks: MempoolBlock[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const blockVSize = o.blockVSize;
    const feeRange = o.feeRange;
    if (typeof blockVSize !== 'number' || !Number.isFinite(blockVSize) || blockVSize <= 0) continue;
    if (!Array.isArray(feeRange)) continue;
    const fees = feeRange.filter((f): f is number => typeof f === 'number' && Number.isFinite(f) && f >= 0);
    if (fees.length === 0) continue;
    blocks.push({
      blockVSize,
      feeRange: fees,
      medianFee: typeof o.medianFee === 'number' && Number.isFinite(o.medianFee) ? o.medianFee : undefined,
    });
  }
  return blocks.length > 0 ? blocks : null;
}

/** The projected blocks, or null when mempool.space cannot be reached. Never throws. */
export async function getMempoolBlocks(): Promise<MempoolBlock[] | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.blocks;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // RN's fetch typing has its own AbortSignal; the runtime object is the same.
    const res = await fetch(URL, { signal: ctrl.signal } as unknown as RequestInit);
    if (!res.ok) return cache?.blocks ?? null;
    const blocks = readMempoolBlocks(await res.json());
    if (blocks) cache = { at: Date.now(), blocks };
    return blocks ?? cache?.blocks ?? null;
  } catch {
    return cache?.blocks ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The phrase for a transaction paying `rate` sat/vB ("about 3 hours"), or
 * null when there is nothing true to say. Asks for the projected blocks only
 * when the rate is below Slow. Never throws.
 *
 * Mainnet only: every source it reads (the tiers and the projection) is
 * mainnet's mempool, which says nothing about a testnet or signet vault's
 * chain. There the line is left out, never borrowed (decided 2026-09-28).
 */
export async function getTxEta(rate: number, network: Network): Promise<string | null> {
  if (network !== 'bitcoin') return null;
  try {
    const presets = await getFeePresets();
    if (!etaNeedsBlocks(rate, presets)) return etaForRate(rate, presets);
    return etaForRate(rate, presets, await getMempoolBlocks());
  } catch {
    return null;
  }
}
