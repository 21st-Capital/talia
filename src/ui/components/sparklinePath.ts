/**
 * Pure geometry for the price sparkline: map a numeric series onto an SVG
 * polyline path scaled to (width × height). Kept free of React/SVG imports so
 * the mapping is unit-testable.
 */

export interface SparklineGeometry {
  /** SVG path ("M x y L x y …") for the price line. */
  linePath: string;
  /** Same path closed down to the bottom edge, for a gradient area fill. */
  areaPath: string;
  /** Endpoint of the line — where the "current price" dot sits. */
  end: { x: number; y: number };
}

export function sparklinePath(
  values: number[],
  width: number,
  height: number,
  padY = 4,
): SparklineGeometry | null {
  if (values.length < 2 || width <= 0 || height <= 0) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1; // flat series → centered line
  const usable = height - padY * 2;

  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = padY + (1 - (v - min) / span) * usable;
    return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  });

  const linePath = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
    .join(' ');
  const last = pts[pts.length - 1];
  const areaPath = `${linePath} L${width} ${height} L0 ${height} Z`;
  return { linePath, areaPath, end: last };
}

/**
 * Resample a series to EXACTLY n points (linear interpolation) with a light
 * 3-point smooth. Two purposes: a Bitkey-style soft line at any source
 * granularity, and — because every range renders with the same point count
 * and path structure — the range-switch animation can interpolate one SVG
 * path string into the next.
 */
export function resampleSeries(values: number[], n: number): number[] {
  if (values.length === 0 || n <= 0) return [];
  if (values.length === 1) return Array(n).fill(values[0]);

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(values.length - 1, lo + 1);
    const frac = pos - lo;
    out.push(values[lo] * (1 - frac) + values[hi] * frac);
  }
  // Light smoothing pass (keep endpoints exact — the last point is "now").
  return out.map((v, i) =>
    i === 0 || i === out.length - 1 ? v : (out[i - 1] + v + out[i + 1]) / 3,
  );
}
