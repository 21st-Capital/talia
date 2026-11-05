import { sparklinePath } from '../sparklinePath';

describe('sparklinePath', () => {
  it('maps a rising series onto the canvas (first low-left, last high-right)', () => {
    const g = sparklinePath([1, 2, 3], 100, 50)!;
    expect(g.linePath.startsWith('M0 ')).toBe(true);
    expect(g.end.x).toBe(100);
    // rising series → endpoint near the top (padY)
    expect(g.end.y).toBeLessThan(10);
    expect(g.areaPath.endsWith('Z')).toBe(true);
  });

  it('centers a flat series and survives short input', () => {
    const g = sparklinePath([5, 5], 100, 50)!;
    expect(g.end.y).toBeGreaterThan(0);
    expect(sparklinePath([1], 100, 50)).toBeNull();
    expect(sparklinePath([], 100, 50)).toBeNull();
  });
});

describe('resampleSeries', () => {
  const { resampleSeries } = require('../sparklinePath');

  it('returns exactly n points', () => {
    expect(resampleSeries([1, 2, 3, 4, 5, 6, 7], 4)).toHaveLength(4);
    expect(resampleSeries([1, 2], 48)).toHaveLength(48);
  });

  it('keeps endpoints exact', () => {
    const out = resampleSeries([10, 50, 20, 80], 10);
    expect(out[0]).toBe(10);
    expect(out[out.length - 1]).toBe(80);
  });

  it('interpolates monotone series monotonically', () => {
    const out = resampleSeries([0, 100], 5);
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });

  it('handles degenerate inputs', () => {
    expect(resampleSeries([], 5)).toEqual([]);
    expect(resampleSeries([7], 3)).toEqual([7, 7, 7]);
  });
});
