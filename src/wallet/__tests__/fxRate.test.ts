import { crossConvert } from '../fxRate';

describe('crossConvert', () => {
  it('converts via the BTC-price ratio: amount × (to ÷ from)', () => {
    // BTC = $60,000 = €55,200 that day → $30,000 = €27,600.
    expect(crossConvert(30_000, 60_000, 55_200)).toBeCloseTo(27_600, 6);
  });

  it('is identity when both legs are equal', () => {
    expect(crossConvert(1234.56, 50_000, 50_000)).toBeCloseTo(1234.56, 6);
  });

  it('round-trips within float precision', () => {
    const eur = crossConvert(30_000, 60_000, 55_200)!;
    expect(crossConvert(eur, 55_200, 60_000)).toBeCloseTo(30_000, 6);
  });

  it('refuses garbage instead of producing it', () => {
    expect(crossConvert(Number.NaN, 60_000, 55_200)).toBeNull();
    expect(crossConvert(30_000, 0, 55_200)).toBeNull();
    expect(crossConvert(30_000, -1, 55_200)).toBeNull();
    expect(crossConvert(30_000, 60_000, Number.NaN)).toBeNull();
    expect(crossConvert(Number.POSITIVE_INFINITY, 60_000, 55_200)).toBeNull();
  });

  it('handles zero amount (a gift cost nothing in every currency)', () => {
    expect(crossConvert(0, 60_000, 55_200)).toBe(0);
  });
});
