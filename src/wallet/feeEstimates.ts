/**
 * Live fee-rate tiers for the Send flow: High, Medium and Slow priority.
 *
 * Source: mempool.space's PRECISE recommendations (api/v1/fees/precise),
 * the same figures its website shows under "Transaction fees" (decided
 * 2026-09-12: the app must match mempool.space, sub-1 sat/vB included).
 * High is their High Priority (next block, about 10 minutes), Medium their
 * Medium Priority (about 30 minutes), Slow their Low Priority (about an
 * hour). Their "No Priority" tier is not offered.
 *
 * Fallbacks, in order: the projected blocks with mempool.space's older
 * arithmetic kept fractional (it reads LOWER than their site today, which
 * is why it is no longer first), the rounded endpoint (never under 1),
 * Esplora's fee-estimates, then a static set. Cached 60s; 6-second
 * timeouts so Send never blocks on this.
 */

import { MAX_FEE_RATE } from '../bitcoin/psbt/build';

export interface FeePresets {
  /** sat/vB for the next block (about 10 minutes). */
  fast: number;
  /** sat/vB for about 30 minutes. */
  medium: number;
  /** sat/vB for about an hour. */
  slow: number;
  /** True when these came from the network rather than the fallback. */
  live: boolean;
}

export const FALLBACK_PRESETS: FeePresets = { fast: 3, medium: 2, slow: 1, live: false };

/**
 * The floor for any tier: what Bitcoin Core relays by default since v30
 * (0.1 sat/vB). Below it a payment would not travel at all.
 */
export const MIN_FEE_RATE = 0.1;

/**
 * The highest rate Talia accepts from ANY source (Send's custom field,
 * Speed up and Cancel, and the tiers below): one constant, owned by the
 * bitcoin layer so the engine enforces it too (decided 2026-09-26).
 */
export { MAX_FEE_RATE };

interface RecommendedFees {
  fastestFee?: number;
  halfHourFee?: number;
  hourFee?: number;
  economyFee?: number;
  minimumFee?: number;
}

/** mempool.space's precise tiers, as its website shows them. Exported for tests. */
export function presetsFromPrecise(r: RecommendedFees): FeePresets | null {
  const vals = [r?.fastestFee, r?.halfHourFee, r?.hourFee];
  if (!vals.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null;
  const [fast, medium, slow] = (vals as number[]).map((v) => Math.max(v, MIN_FEE_RATE));
  return {
    fast: Math.max(fast, medium, slow),
    medium: Math.max(medium, slow),
    slow,
    live: true,
  };
}

/** One of mempool.space's projected blocks (api/v1/fees/mempool-blocks). */
export interface ProjectedBlock {
  blockVSize: number;
  medianFee: number;
}

/** Round UP to 0.01 sat/vB, so a tier never reads lower than the rate it was computed from. */
function up2(x: number): number {
  return Math.ceil(x * 100 - 1e-6) / 100;
}

/**
 * mempool.space's older recommendation (backend fee-api, optimizeMedianFee)
 * kept fractional: a tier is the median rate of its projected block,
 * averaged with the tier above it so the ladder never inverts, and scaled
 * down when that block is not full. Fallback only. Exported for tests.
 */
export function presetsFromBlocks(
  blocks: ProjectedBlock[],
  minimum: number = MIN_FEE_RATE,
): FeePresets | null {
  const ok = (Array.isArray(blocks) ? blocks : []).filter(
    (b) =>
      b != null &&
      typeof b.medianFee === 'number' &&
      typeof b.blockVSize === 'number' &&
      Number.isFinite(b.medianFee) &&
      Number.isFinite(b.blockVSize) &&
      b.medianFee > 0,
  );
  if (ok.length === 0) return null;
  const tier = (block: ProjectedBlock, next: ProjectedBlock | undefined, previous?: number): number => {
    const useFee = previous != null ? (block.medianFee + previous) / 2 : block.medianFee;
    if (block.blockVSize <= 500_000) return minimum;
    if (block.blockVSize <= 950_000 && next) {
      const multiplier = (block.blockVSize - 500_000) / 500_000;
      return Math.max(up2(useFee * multiplier), minimum);
    }
    return Math.max(up2(useFee), minimum);
  };
  const fast = tier(ok[0], ok[1]);
  const medium = ok[1] ? tier(ok[1], ok[2], fast) : fast;
  const slow = ok[2] ? tier(ok[2], ok[3], medium) : medium;
  return {
    fast: Math.max(fast, medium, slow),
    medium: Math.max(medium, slow),
    slow,
    live: true,
  };
}

/** The rounded endpoint (whole satoshis, never under 1): late fallback. Exported for tests. */
export function presetsFromRecommended(r: RecommendedFees): FeePresets | null {
  const fast = r.fastestFee;
  const medium = r.halfHourFee ?? r.hourFee;
  const slow = r.hourFee ?? r.economyFee;
  if (
    typeof fast !== 'number' ||
    typeof medium !== 'number' ||
    typeof slow !== 'number' ||
    fast < 1 ||
    medium < 1 ||
    slow < 1
  ) {
    return null;
  }
  // Keep the tiers ordered even if the mempool is weird.
  return {
    fast: Math.max(fast, medium),
    medium: Math.max(medium, slow),
    slow,
    live: true,
  };
}

/**
 * Esplora's fee-estimates (blocks-until-confirmation → sat/vB, from the
 * node's estimatesmartfee): reachable wherever the wallet's own sync is.
 * Exported for tests.
 */
export function presetsFromEsplora(est: Record<string, number>): FeePresets | null {
  const at = (target: number): number | null => {
    const v = est?.[String(target)];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  };
  const fast = at(2) ?? at(1);
  const medium = at(3) ?? at(4) ?? fast;
  const slow = at(6) ?? at(10) ?? medium;
  if (fast == null || medium == null || slow == null) return null;
  return {
    fast: Math.max(up2(fast), up2(medium), up2(slow), MIN_FEE_RATE),
    medium: Math.max(up2(medium), up2(slow), MIN_FEE_RATE),
    slow: Math.max(up2(slow), MIN_FEE_RATE),
    live: true,
  };
}

/** As mempool.space writes a rate: "0.6", "1", "12" (one decimal under 10 sat/vB). */
export function formatFeeRate(rate: number): string {
  if (!Number.isFinite(rate)) return '-';
  if (rate >= 10) return String(Math.round(rate));
  return String(Math.round(rate * 10) / 10);
}

let cache: { at: number; presets: FeePresets } | null = null;
const TTL_MS = 60_000;

async function fetchJson(url: string, timeoutMs = 6_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // RN's fetch typing has its own AbortSignal; the runtime object is the same.
    const res = await fetch(url, { signal: ctrl.signal } as unknown as RequestInit);
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

const SOURCES: Array<() => Promise<FeePresets | null>> = [
  async () =>
    presetsFromPrecise(
      ((await fetchJson('https://mempool.space/api/v1/fees/precise')) ?? {}) as RecommendedFees,
    ),
  async () =>
    presetsFromBlocks(
      (await fetchJson('https://mempool.space/api/v1/fees/mempool-blocks')) as ProjectedBlock[],
    ),
  async () =>
    presetsFromRecommended(
      ((await fetchJson('https://mempool.space/api/v1/fees/recommended')) ?? {}) as RecommendedFees,
    ),
  async () =>
    presetsFromEsplora(
      ((await fetchJson('https://blockstream.info/api/fee-estimates')) ?? {}) as Record<string, number>,
    ),
];

/**
 * No tier above MAX_FEE_RATE, whatever a fee source says (decided
 * 2026-09-26): a compromised or broken mempool.space answer of 20 000
 * sat/vB used to become the default High and burn most of a drain.
 * Exported for tests.
 */
export function clampPresets(p: FeePresets): FeePresets {
  const cap = (v: number) => Math.min(v, MAX_FEE_RATE);
  return { ...p, fast: cap(p.fast), medium: cap(p.medium), slow: cap(p.slow) };
}

export async function getFeePresets(): Promise<FeePresets> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.presets;
  for (const source of SOURCES) {
    try {
      const found = await source();
      const presets = found ? clampPresets(found) : null;
      if (presets) {
        cache = { at: Date.now(), presets };
        return presets;
      }
    } catch {
      // next source
    }
  }
  return cache?.presets ?? FALLBACK_PRESETS;
}
