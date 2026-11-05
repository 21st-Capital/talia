import {
  candleGeometry,
  lineGeometry,
  lineGeometryFromSamples,
  nearestIndex,
  sameShape,
  scaleFor,
  smoothPath,
  xForTime,
  yFor,
  yOnPolyline,
} from '../chartGeometry';

describe('scaleFor / yFor', () => {
  it('maps max to the top pad and min to the bottom pad', () => {
    const s = scaleFor([10, 20, 30], 100, 10);
    expect(yFor(30, s)).toBe(10);
    expect(yFor(10, s)).toBe(90);
    expect(yFor(20, s)).toBe(50);
  });
  it('centres a flat series and ignores non-finite values', () => {
    const s = scaleFor([5, 5, Number.NaN], 100, 10);
    expect(yFor(5, s)).toBe(50);
    const empty = scaleFor([], 100, 10);
    expect(empty.min).toBe(0);
    expect(empty.max).toBe(1);
  });
});

describe('xForTime', () => {
  const axis = { start: 1000, end: 2000 };
  it('maps the axis onto the width and clamps outside it', () => {
    expect(xForTime(1000, axis, 200)).toBe(0);
    expect(xForTime(1500, axis, 200)).toBe(100);
    expect(xForTime(2000, axis, 200)).toBe(200);
    expect(xForTime(3000, axis, 200)).toBe(200);
    expect(xForTime(0, axis, 200)).toBe(0);
    expect(xForTime(1500, { start: 5, end: 5 }, 200)).toBe(0);
  });
});

describe('smoothPath', () => {
  it('starts with M, has one C per segment, and never leaves the band', () => {
    const pts = [
      { x: 0, y: 50 },
      { x: 10, y: 10 },
      { x: 20, y: 90 },
      { x: 30, y: 10 },
    ];
    const d = smoothPath(pts, 10, 90);
    expect(d.startsWith('M0 50')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(3);
    const ys = d.match(/[-\d.]+ ([-\d.]+)/g)!.map((pair) => Number(pair.split(' ')[1]));
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(90);
    }
  });
  it('handles one point and none', () => {
    expect(smoothPath([{ x: 3, y: 4 }], 0, 10)).toBe('M3 4');
    expect(smoothPath([], 0, 10)).toBe('');
  });
});

describe('lineGeometry', () => {
  it('resamples to the sample count, spreads x0..x1, ends at the last value', () => {
    const scale = scaleFor([1, 5], 100, 10);
    const g = lineGeometry([1, 3, 5], 0, 200, scale, 5)!;
    expect(g.points).toHaveLength(5);
    expect(g.points[0]).toEqual({ x: 0, y: 90 });
    expect(g.end).toEqual({ x: 200, y: 10 });
    expect(g.areaPath.endsWith('L0 100 Z')).toBe(true);
    expect(g.linePath.match(/C/g)).toHaveLength(4);
  });
  it('keeps the same path structure for any input length (the morph relies on it)', () => {
    const scale = scaleFor([0, 100], 100, 10);
    const a = lineGeometry([0, 100], 0, 100, scale, 40)!;
    const b = lineGeometry(Array.from({ length: 300 }, (_, i) => i % 7), 0, 100, scale, 40)!;
    const count = (d: string): number => (d.match(/[-+]?\d*\.?\d+/g) ?? []).length;
    expect(count(a.linePath)).toBe(count(b.linePath));
  });
  it('a partial-day line stops short of the full width', () => {
    const scale = scaleFor([1, 2], 100, 10);
    const g = lineGeometry([1, 2, 1], 0, 80, scale, 10)!;
    expect(g.end.x).toBe(80);
  });
  it('draws presampled values as they are, and sameShape guards the morph', () => {
    const scale = scaleFor([0, 10], 100, 10);
    const g = lineGeometryFromSamples([0, 5, 10], 0, 100, scale)!;
    expect(g.points).toHaveLength(3);
    expect(g.points[1]).toEqual({ x: 50, y: 50 });
    expect(lineGeometryFromSamples([1], 0, 100, scale)).toBeNull();
    const a = lineGeometry([1, 2, 3], 0, 100, scale, 12)!.linePath;
    const b = lineGeometry([9, 1, 4, 4, 2], 0, 80, scale, 12)!.linePath;
    const c = lineGeometry([9, 1, 4, 4, 2], 0, 80, scale, 13)!.linePath;
    expect(sameShape(a, b)).toBe(true);
    expect(sameShape(a, c)).toBe(false);
  });
  it('needs two values and a positive span', () => {
    const scale = scaleFor([1], 100, 10);
    expect(lineGeometry([1], 0, 100, scale, 10)).toBeNull();
    expect(lineGeometry([1, 2], 50, 50, scale, 10)).toBeNull();
    expect(lineGeometry([1, 2], 0, 100, scale, 1)).toBeNull();
  });
});

describe('candleGeometry', () => {
  it('places each candle in its slot with a 65% body, coloured by direction', () => {
    const axis = { start: 0, end: 4000 };
    const scale = scaleFor([0, 100], 100, 0);
    const sticks = candleGeometry(
      [
        { t: 0, o: 20, h: 80, l: 10, c: 60 },
        { t: 2000, o: 60, h: 70, l: 30, c: 40 },
      ],
      axis,
      2000,
      400,
      scale,
    );
    expect(sticks).toHaveLength(2);
    expect(sticks[0].x).toBe(100); // centre of the first 200px slot
    expect(sticks[1].x).toBe(300);
    expect(sticks[0].w).toBe(130);
    expect(sticks[0].up).toBe(true);
    expect(sticks[1].up).toBe(false);
    expect(sticks[0].yHigh).toBe(20);
    expect(sticks[0].yLow).toBe(90);
    expect(sticks[0].yOpen).toBe(80);
    expect(sticks[0].yClose).toBe(40);
  });
  it('never draws a body thinner than 1.5px and copes with a dead axis', () => {
    const scale = scaleFor([0, 1], 10, 0);
    const many = candleGeometry(
      Array.from({ length: 500 }, (_, i) => ({ t: i, o: 1, h: 1, l: 1, c: 1 })),
      { start: 0, end: 500 },
      1,
      100,
      scale,
    );
    expect(many[0].w).toBe(1.5);
    expect(candleGeometry([{ t: 0, o: 1, h: 1, l: 1, c: 1 }], { start: 0, end: 0 }, 1, 100, scale)).toEqual([]);
  });
});

describe('nearestIndex', () => {
  const xs = [0, 10, 20, 30];
  it('returns the nearest x, either side, and clamps beyond the ends', () => {
    expect(nearestIndex(xs, 0)).toBe(0);
    expect(nearestIndex(xs, 4)).toBe(0);
    expect(nearestIndex(xs, 6)).toBe(1);
    expect(nearestIndex(xs, 25)).toBe(2); // a tie goes to the earlier point
    expect(nearestIndex(xs, 26)).toBe(3);
    expect(nearestIndex(xs, 99)).toBe(3);
    expect(nearestIndex(xs, -5)).toBe(0);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe('yOnPolyline', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 100 },
    { x: 20, y: 50 },
  ];
  it('interpolates between neighbours and clamps at the ends', () => {
    expect(yOnPolyline(pts, 5)).toBe(50);
    expect(yOnPolyline(pts, 15)).toBe(75);
    expect(yOnPolyline(pts, -1)).toBe(0);
    expect(yOnPolyline(pts, 99)).toBe(50);
    expect(yOnPolyline(pts, 10)).toBe(100);
    expect(yOnPolyline([], 3)).toBe(0);
  });
});
