/**
 * Pure geometry for the full-screen price chart: a smooth (Catmull-Rom to
 * cubic Bezier) line through resampled closes, candlesticks placed on a time
 * axis, and the lookups the finger needs while scrubbing. No React or SVG
 * imports, so every mapping is unit-tested.
 *
 * The line is always drawn through a FIXED number of resampled points with
 * the same path structure, which is what lets the range switch animate one
 * path string into the next (Animated interpolates number by number).
 */
import { resampleSeries } from './sparklinePath';
import type { Candle, TimeAxis } from '../../wallet/chartSeries';

export interface XY {
  x: number;
  y: number;
}

export interface ValueScale {
  min: number;
  max: number;
  height: number;
  padY: number;
}

/** Vertical scale over `values`, with a flat series centred instead of
 *  divided by zero. Extra values (the period's open, for the dotted
 *  baseline) can be folded in so nothing draws off-canvas. */
export function scaleFor(values: number[], height: number, padY: number): ValueScale {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 1;
  }
  return { min, max, height, padY };
}

export function yFor(v: number, scale: ValueScale): number {
  const span = scale.max - scale.min;
  const usable = scale.height - scale.padY * 2;
  if (span <= 0) return round2(scale.padY + usable / 2);
  return round2(scale.padY + (1 - (v - scale.min) / span) * usable);
}

/** x of a moment on the axis, over `width` pixels. Clamped to the canvas. */
export function xForTime(tMs: number, axis: TimeAxis, width: number): number {
  const span = axis.end - axis.start;
  if (span <= 0) return 0;
  const x = ((tMs - axis.start) / span) * width;
  return round2(Math.min(width, Math.max(0, x)));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface LineGeometry {
  /** "M x y C …" through the resampled points. */
  linePath: string;
  /** The line closed down to the bottom edge, for the gradient fill. */
  areaPath: string;
  /** The resampled points the path passes through. */
  points: XY[];
  /** Where the "now" dot sits. */
  end: XY;
}

/**
 * Smooth path through `points` (Catmull-Rom converted to cubic Beziers).
 * Control points are clamped inside the vertical band so the curve never
 * overshoots the canvas at a peak or a trough.
 */
export function smoothPath(points: XY[], yMin: number, yMax: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  const clampY = (y: number): number => round2(Math.min(yMax, Math.max(yMin, y)));
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = round2(p1.x + (p2.x - p0.x) / 6);
    const c1y = clampY(p1.y + (p2.y - p0.y) / 6);
    const c2x = round2(p2.x - (p3.x - p1.x) / 6);
    const c2y = clampY(p2.y - (p3.y - p1.y) / 6);
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * The price line: `values` resampled to exactly `samples` points, spread
 * from x0 to x1 (today's line stops where the day has got to), scaled by
 * `scale`. Null when there is nothing to draw a line through.
 */
export function lineGeometry(
  values: number[],
  x0: number,
  x1: number,
  scale: ValueScale,
  samples: number,
): LineGeometry | null {
  if (values.length < 2 || x1 <= x0 || samples < 2) return null;
  return lineGeometryFromSamples(resampleSeries(values, samples), x0, x1, scale);
}

/** The same, for values that are ALREADY resampled. The chart resamples
 *  first so it can scale the canvas to the line it draws (the smoothing
 *  pass clips spikes, and a scale from the raw closes would leave a dead
 *  band above the peak), then draws through exactly those points. */
export function lineGeometryFromSamples(
  sampled: number[],
  x0: number,
  x1: number,
  scale: ValueScale,
): LineGeometry | null {
  const samples = sampled.length;
  if (samples < 2 || x1 <= x0) return null;
  const points = sampled.map((v, i) => ({
    x: round2(x0 + (i / (samples - 1)) * (x1 - x0)),
    y: yFor(v, scale),
  }));
  const linePath = smoothPath(points, scale.padY, scale.height - scale.padY);
  const areaPath = `${linePath} L${points[points.length - 1].x} ${scale.height} L${points[0].x} ${scale.height} Z`;
  return { linePath, areaPath, points, end: points[points.length - 1] };
}

/** True when two path strings carry the same number of numbers, which is
 *  what Animated needs to interpolate one into the other. */
export function sameShape(a: string, b: string): boolean {
  const count = (d: string): number => (d.match(/[-+]?\d*\.?\d+/g) ?? []).length;
  return count(a) === count(b);
}

export interface CandleGeometry {
  /** Centre x of the candle. */
  x: number;
  /** Body width. */
  w: number;
  yOpen: number;
  yClose: number;
  yHigh: number;
  yLow: number;
  up: boolean;
}

/**
 * Candlesticks on the time axis: each candle sits in its own `spanMs` slot,
 * the body takes 65% of the slot (never under 1.5px), and a flat body still
 * shows as a 1px tick so the candle does not vanish.
 */
export function candleGeometry(
  candles: Candle[],
  axis: TimeAxis,
  spanMs: number,
  width: number,
  scale: ValueScale,
): CandleGeometry[] {
  const axisSpan = axis.end - axis.start;
  if (axisSpan <= 0 || width <= 0) return [];
  const slot = (spanMs / axisSpan) * width;
  const w = Math.max(1.5, round2(slot * 0.65));
  return candles.map((k) => {
    const left = ((k.t - axis.start) / axisSpan) * width;
    const yOpen = yFor(k.o, scale);
    const yClose = yFor(k.c, scale);
    return {
      x: round2(left + slot / 2),
      w,
      yOpen,
      yClose,
      yHigh: yFor(k.h, scale),
      yLow: yFor(k.l, scale),
      up: k.c >= k.o,
    };
  });
}

/** Index of the x in `xs` (ascending) nearest to `x`. */
export function nearestIndex(xs: number[], x: number): number {
  if (xs.length === 0) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first index with xs[lo] >= x; the previous one may be nearer.
  if (lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x)) return lo - 1;
  return lo;
}

/** y of the polyline through `points` at `x` (linear between neighbours,
 *  clamped to the ends), so the scrub dot sits ON the drawn line. */
export function yOnPolyline(points: XY[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  const xs = points.map((p) => p.x);
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  const b = points[lo];
  const a = points[lo - 1] ?? b;
  const span = b.x - a.x;
  if (span <= 0) return b.y;
  const f = (x - a.x) / span;
  return round2(a.y + (b.y - a.y) * f);
}
