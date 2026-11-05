import {
  presetsFromPrecise,
  presetsFromRecommended,
  presetsFromBlocks,
  presetsFromEsplora,
  formatFeeRate,
  FALLBACK_PRESETS,
  MIN_FEE_RATE,
  clampPresets,
  MAX_FEE_RATE as CAP,
} from '../feeEstimates';
import { validateBuildRequest } from '../../bitcoin/psbt/build';

describe('presetsFromPrecise (what mempool.space shows)', () => {
  it('reads their High, Medium and Low Priority as High, Medium and Slow', () => {
    // api/v1/fees/precise, sampled 2026-09-12 14:45 while their site showed
    // High 1, Medium 0.6, Low 0.3 and No Priority 0.2.
    const p = presetsFromPrecise({ fastestFee: 1, halfHourFee: 0.577, hourFee: 0.284, economyFee: 0.2, minimumFee: 0.1 })!;
    expect(p).toEqual({ fast: 1, medium: 0.577, slow: 0.284, live: true });
    expect([formatFeeRate(p.fast), formatFeeRate(p.medium), formatFeeRate(p.slow)]).toEqual(['1', '0.6', '0.3']);
  });
  it('floors at the relay minimum and keeps the ladder ordered', () => {
    const p = presetsFromPrecise({ fastestFee: 0.05, halfHourFee: 0.3, hourFee: 0.2 })!;
    expect(p.slow).toBeCloseTo(0.2, 5);
    expect(p.medium).toBeCloseTo(0.3, 5);
    expect(p.fast).toBeGreaterThanOrEqual(p.medium);
  });
  it('rejects junk', () => {
    expect(presetsFromPrecise({})).toBeNull();
    expect(presetsFromPrecise({ fastestFee: 1, halfHourFee: 0, hourFee: 0.2 })).toBeNull();
    expect(presetsFromPrecise(null as unknown as {})).toBeNull();
  });
});

describe('presetsFromBlocks (mempool.space projected blocks, kept fractional)', () => {
  const full = (medianFee: number) => ({ blockVSize: 997_900, medianFee });

  it('reads under 1 sat/vB when the mempool does', () => {
    // Sampled 2026-09-12 13:35: the whole mempool sat between 0.2 and 0.4.
    const p = presetsFromBlocks([full(0.354), full(0.318), full(0.242), full(0.22)])!;
    expect(p.live).toBe(true);
    expect(p.fast).toBeCloseTo(0.36, 2);
    // Averaged with the tier above, then rounded up to 0.01.
    expect(p.medium).toBeCloseTo(0.34, 2);
    expect(p.slow).toBeCloseTo(0.3, 2);
    expect(p.fast).toBeGreaterThanOrEqual(p.medium);
    expect(p.medium).toBeGreaterThanOrEqual(p.slow);
  });

  it('never rounds a tier below the rate it came from', () => {
    const p = presetsFromBlocks([full(1.001), full(1.001), full(1.001)])!;
    expect(p.fast).toBeCloseTo(1.01, 2);
  });

  it('floors at the relay minimum and treats a half-empty next block as the floor', () => {
    const p = presetsFromBlocks([{ blockVSize: 400_000, medianFee: 5 }])!;
    expect(p.fast).toBe(MIN_FEE_RATE);
    expect(p.medium).toBe(MIN_FEE_RATE);
    expect(p.slow).toBe(MIN_FEE_RATE);
  });

  it('scales a partly full block down, as mempool.space does', () => {
    // 725k of 1M vbytes: multiplier 0.45.
    const p = presetsFromBlocks([{ blockVSize: 725_000, medianFee: 10 }, full(2)])!;
    expect(p.fast).toBeCloseTo(4.5, 2);
  });

  it('keeps the ladder ordered when later blocks pay more', () => {
    const p = presetsFromBlocks([full(1), full(3), full(2)])!;
    expect(p.fast).toBeGreaterThanOrEqual(p.medium);
    expect(p.medium).toBeGreaterThanOrEqual(p.slow);
  });

  it('rejects junk', () => {
    expect(presetsFromBlocks([])).toBeNull();
    expect(presetsFromBlocks(null as unknown as [])).toBeNull();
    expect(presetsFromBlocks([{ blockVSize: NaN, medianFee: 0 }])).toBeNull();
  });
});

describe('presetsFromEsplora', () => {
  it('maps confirmation targets to tiers', () => {
    const p = presetsFromEsplora({ '1': 2.5, '2': 2, '3': 1.5, '6': 1.2, '144': 1 })!;
    expect(p).toEqual({ fast: 2, medium: 1.5, slow: 1.2, live: true });
  });
  it('rejects an empty answer', () => {
    expect(presetsFromEsplora({})).toBeNull();
  });
});

describe('formatFeeRate', () => {
  it('writes rates the way mempool.space does: one decimal under 10 sat/vB', () => {
    expect(formatFeeRate(0.354)).toBe('0.4');
    expect(formatFeeRate(0.577)).toBe('0.6');
    expect(formatFeeRate(1.5)).toBe('1.5');
    expect(formatFeeRate(1)).toBe('1');
    expect(formatFeeRate(12.4)).toBe('12');
  });
});

describe('presetsFromRecommended', () => {
  it('maps mempool.space fields to tiers', () => {
    // Medium is about 30 minutes (halfHourFee), Slow about an hour (hourFee).
    expect(
      presetsFromRecommended({ fastestFee: 12, halfHourFee: 8, hourFee: 5, economyFee: 2 }),
    ).toEqual({ fast: 12, medium: 8, slow: 5, live: true });
  });

  it('falls back to economyFee for Slow when hourFee is missing', () => {
    expect(presetsFromRecommended({ fastestFee: 10, halfHourFee: 6, economyFee: 2 })).toEqual({
      fast: 10,
      medium: 6,
      slow: 2,
      live: true,
    });
  });

  it('keeps tiers ordered when the mempool inverts', () => {
    const p = presetsFromRecommended({ fastestFee: 2, hourFee: 5, economyFee: 3 })!;
    expect(p.fast).toBeGreaterThanOrEqual(p.medium);
    expect(p.medium).toBeGreaterThanOrEqual(p.slow);
  });

  it('rejects junk payloads', () => {
    expect(presetsFromRecommended({})).toBeNull();
    expect(presetsFromRecommended({ fastestFee: 0, hourFee: 0, economyFee: 0 })).toBeNull();
  });

  it('fallback presets are sane', () => {
    expect(FALLBACK_PRESETS.fast).toBeGreaterThanOrEqual(FALLBACK_PRESETS.medium);
    expect(FALLBACK_PRESETS.medium).toBeGreaterThanOrEqual(FALLBACK_PRESETS.slow);
    expect(FALLBACK_PRESETS.live).toBe(false);
  });
});

describe('the fee ceiling (decided 2026-09-26)', () => {
  it('no tier from a fee source goes above MAX_FEE_RATE', () => {
    const p = clampPresets({ fast: 20000, medium: 5000, slow: 3, live: true });
    expect(p).toEqual({ fast: CAP, medium: CAP, slow: 3, live: true });
  });

  it('a build request above the ceiling is refused, whatever proposed the rate', () => {
    const issues = validateBuildRequest({
      recipients: [{ address: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', amountSats: 10_000 }],
      feeRate: CAP + 1,
    });
    expect(issues.some((i) => i.field === 'feeRate')).toBe(true);
  });
});
