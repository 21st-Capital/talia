/**
 * The price chart itself (decided 2026-09-11, Revolut-style redesign): a smooth
 * gold line with a gradient fill and a "now" dot, or candlesticks, over a
 * time axis; a dotted baseline at the period's open with its price at the
 * left; the period's high and low labelled where they happen; and
 * scrubbing: hold a finger on the chart, or drag sideways, and the parent
 * shows that moment's price (`onScrub`).
 *
 * Touch rules, because the chart lives inside a ScrollView: a vertical
 * swipe that starts on the chart still scrolls the page (the responder is
 * given up while scrubbing has not begun); a hold of ~180ms or a sideways
 * drag begins scrubbing, after which the parent disables its scroll until
 * the finger lifts. Sideways is judged in the chart's OWN coordinates
 * (locationX/Y), so it also holds inside the rotated landscape view, where
 * the page axes are turned. The screen also switches off the stack's
 * swipe-back gesture: a drag that starts near the left edge would otherwise
 * pop the screen instead of scrubbing (seen on the simulator).
 *
 * Used twice: on the price screen and, larger, in the landscape view.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import { aggregateCandles, candleSpanMs, summarize, timeAxis } from '../../wallet/chartSeries';
import type { Candle, ChartMode, ChartRange } from '../../wallet/chartSeries';
import { formatFiatValue } from '../../wallet/marketFormat';
import type { FiatCurrency } from '../../wallet';
import { resampleSeries } from './sparklinePath';
import {
  candleGeometry,
  lineGeometryFromSamples,
  nearestIndex,
  sameShape,
  scaleFor,
  xForTime,
  yFor,
  yOnPolyline,
} from './chartGeometry';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Fixed point count: the range switch morphs one path into the next. */
const SAMPLES = 160;
/** Room for the high and low labels inside the canvas. */
const PAD_Y = 22;
/** Keeps the halo'd "now" dot inside the canvas. */
const PAD_RIGHT = 14;
/** How long a still finger waits before scrubbing begins. */
const HOLD_MS = 180;
/** Half the width of a price label, for centring it on its point. */
const LABEL_HALF = 36;

export interface ScrubPoint {
  index: number;
  candle: Candle;
}

interface Props {
  width: number;
  height: number;
  /** Candles in the user's currency, oldest first, last close = live price. */
  candles: Candle[];
  range: ChartRange;
  mode: ChartMode;
  currency: FiatCurrency;
  onScrub?: (point: ScrubPoint | null) => void;
}

interface XY {
  x: number;
  y: number;
}

export function PriceLineChart({ width, height, candles, range, mode, currency, onScrub }: Props): React.JSX.Element {
  const gradientId = `chartFill${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const drawW = Math.max(1, width - PAD_RIGHT);
  const spanMs = candleSpanMs(range);

  // What the chart draws: raw klines as the line, folded candles as sticks.
  const items = useMemo(
    () => (mode === 'candles' ? aggregateCandles(candles, spanMs) : candles),
    [candles, mode, spanMs],
  );
  const summary = useMemo(() => summarize(candles, mode), [candles, mode]);

  const layout = useMemo(() => {
    if (items.length === 0 || !summary) return null;
    const now = Date.now();
    const axis = timeAxis(range, items, now, mode === 'candles' ? spanMs : 0);
    const xs = items.map((k) => (mode === 'candles'
      ? xForTime(k.t + spanMs / 2, axis, drawW)
      : xForTime(k.t, axis, drawW)));
    if (mode === 'candles') {
      const scale = scaleFor([summary.high, summary.low, summary.open], height, PAD_Y);
      const sticks = candleGeometry(items, axis, spanMs, drawW, scale);
      let hi = 0;
      let lo = 0;
      sticks.forEach((s, i) => {
        if (s.yHigh < sticks[hi].yHigh) hi = i;
        if (s.yLow > sticks[lo].yLow) lo = i;
      });
      return {
        axis,
        scale,
        xs,
        yOpen: yFor(summary.open, scale),
        sticks,
        line: null,
        high: sticks.length ? { x: sticks[hi].x, y: sticks[hi].yHigh } : null,
        low: sticks.length ? { x: sticks[lo].x, y: sticks[lo].yLow } : null,
        single: null,
      };
    }
    // The canvas is scaled to the line as DRAWN (resampled and lightly
    // smoothed), not to the raw closes: the smoothing clips a spike, and a
    // scale from the raw extremes would leave a dead band above the peak.
    const closes = items.map((k) => k.c);
    const sampled = closes.length >= 2 ? resampleSeries(closes, SAMPLES) : closes;
    const scale = scaleFor([...sampled, summary.open], height, PAD_Y);
    const line = sampled.length >= 2 ? lineGeometryFromSamples(sampled, xs[0], xs[xs.length - 1], scale) : null;
    let high: XY | null = null;
    let low: XY | null = null;
    if (line) {
      let hi = 0;
      let lo = 0;
      line.points.forEach((p, i) => {
        if (p.y < line.points[hi].y) hi = i;
        if (p.y > line.points[lo].y) lo = i;
      });
      high = line.points[hi];
      low = line.points[lo];
    }
    // A day that has only just begun: one point, drawn as the dot alone.
    const single = !line && items.length >= 1 ? { x: xs[0], y: yFor(items[0].c, scale) } : null;
    return { axis, scale, xs, yOpen: yFor(summary.open, scale), sticks: null, line, high, low, single };
  }, [items, summary, range, mode, spanMs, height, drawW]);

  // ---- the morph: a range switch or a live tick animates the previous
  // line into the new one instead of snapping. The "from" path is decided
  // in the same render that draws the "to" path, so the first frame already
  // interpolates from the right shape. Both strings always carry the same
  // number of numbers (fixed SAMPLES); sameShape guards it anyway, because
  // Animated only checks that in development builds.
  const linePath = layout?.line?.linePath ?? null;
  const areaPath = layout?.line?.areaPath ?? null;
  const progress = useRef(new Animated.Value(1)).current;
  const lastPathsRef = useRef<{ line: string; area: string } | null>(null);
  const morph = useMemo(() => {
    const prev = lastPathsRef.current;
    if (linePath && areaPath) lastPathsRef.current = { line: linePath, area: areaPath };
    if (!linePath || !areaPath || !prev || prev.line === linePath || !sameShape(prev.line, linePath)) return null;
    progress.setValue(0);
    return { from: prev, to: { line: linePath, area: areaPath } };
  }, [linePath, areaPath, progress]);
  useEffect(() => {
    if (!morph) return;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 350,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [morph, progress]);
  const lineD = useMemo(
    () => (morph ? progress.interpolate({ inputRange: [0, 1], outputRange: [morph.from.line, morph.to.line] }) : linePath),
    [morph, linePath, progress],
  );
  const areaD = useMemo(
    () => (morph ? progress.interpolate({ inputRange: [0, 1], outputRange: [morph.from.area, morph.to.area] }) : areaPath),
    [morph, areaPath, progress],
  );

  // ---- scrubbing -------------------------------------------------------
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const xsRef = useRef<number[]>([]);
  const itemsRef = useRef<Candle[]>([]);
  const onScrubRef = useRef(onScrub);
  const activeRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<XY>({ x: 0, y: 0 });
  const lastXRef = useRef(0);
  const lastIndexRef = useRef(-1);
  xsRef.current = layout?.xs ?? [];
  itemsRef.current = items;
  onScrubRef.current = onScrub;

  function clearTimer(): void {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }
  function begin(x: number): void {
    if (xsRef.current.length === 0) return;
    activeRef.current = true;
    lastIndexRef.current = -1;
    moveTo(x);
  }
  function moveTo(x: number): void {
    const xs = xsRef.current;
    if (xs.length === 0) return;
    const idx = nearestIndex(xs, Math.min(xs[xs.length - 1], Math.max(xs[0], x)));
    if (idx === lastIndexRef.current) return; // the finger is still on the same point
    lastIndexRef.current = idx;
    setScrubIndex(idx);
    const candle = itemsRef.current[idx];
    if (candle) onScrubRef.current?.({ index: idx, candle });
  }
  function end(): void {
    clearTimer();
    if (!activeRef.current) return;
    activeRef.current = false;
    lastIndexRef.current = -1;
    setScrubIndex(null);
    onScrubRef.current?.(null);
  }

  // Created once; the handlers reach the current data through refs.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // A page scroll may take the touch away until scrubbing has begun.
        onPanResponderTerminationRequest: () => !activeRef.current,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          startRef.current = { x: locationX, y: locationY };
          lastXRef.current = locationX;
          clearTimer();
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            begin(lastXRef.current);
          }, HOLD_MS);
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          lastXRef.current = locationX;
          if (activeRef.current) {
            moveTo(locationX);
            return;
          }
          const dx = locationX - startRef.current.x;
          const dy = locationY - startRef.current.y;
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
            clearTimer();
            begin(locationX);
          }
        },
        onPanResponderRelease: () => end(),
        onPanResponderTerminate: () => end(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Unmounting mid-scrub must not leave the parent frozen on a point.
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => () => endRef.current(), []);

  // A new series while the finger is down: keep the finger's x, not the index.
  const moveToRef = useRef(moveTo);
  moveToRef.current = moveTo;
  useEffect(() => {
    if (activeRef.current) {
      lastIndexRef.current = -1;
      moveToRef.current(lastXRef.current);
    }
  }, [layout]);

  const scrub = useMemo(() => {
    if (scrubIndex == null || !layout) return null;
    const idx = Math.min(scrubIndex, layout.xs.length - 1);
    if (idx < 0) return null;
    const x = layout.xs[idx];
    const y = layout.line ? yOnPolyline(layout.line.points, x) : yFor(items[idx].c, layout.scale);
    return { x, y };
  }, [scrubIndex, layout, items]);

  const c = theme.colors;
  const fmt = (v: number): string => formatFiatValue(v, currency);
  const a11y = summary
    ? `Price chart. Started at ${fmt(summary.open)}, now ${fmt(summary.last)}, high ${fmt(summary.high)}, low ${fmt(summary.low)}.`
    : 'Price chart';

  return (
    <View style={{ width, height }} accessible accessibilityLabel={a11y} {...pan.panHandlers}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.gold} stopOpacity={0.3} />
            <Stop offset="1" stopColor={c.gold} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {layout && (
          <Line
            x1={0}
            y1={layout.yOpen}
            x2={drawW}
            y2={layout.yOpen}
            stroke={c.slate}
            strokeWidth={1}
            strokeDasharray="2 4"
            strokeOpacity={0.8}
          />
        )}

        {layout?.line && (
          <>
            <AnimatedPath d={areaD ?? undefined} fill={`url(#${gradientId})`} />
            <AnimatedPath
              d={lineD ?? undefined}
              stroke={c.gold}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            {!scrub && (
              <>
                <Circle cx={layout.line.end.x} cy={layout.line.end.y} r={5} fill={c.gold} />
                <Circle
                  cx={layout.line.end.x}
                  cy={layout.line.end.y}
                  r={9}
                  fill="none"
                  stroke={c.gold}
                  strokeOpacity={0.35}
                  strokeWidth={2}
                />
              </>
            )}
          </>
        )}

        {layout?.single && (
          <>
            <Circle cx={layout.single.x} cy={layout.single.y} r={5} fill={c.gold} />
            <Circle cx={layout.single.x} cy={layout.single.y} r={9} fill="none" stroke={c.gold} strokeOpacity={0.35} strokeWidth={2} />
          </>
        )}

        {layout?.sticks?.map((s, i) => {
          const colour = s.up ? c.positive : c.negative;
          const top = Math.min(s.yOpen, s.yClose);
          const bodyH = Math.max(1, Math.abs(s.yOpen - s.yClose));
          return (
            <React.Fragment key={i}>
              <Line x1={s.x} y1={s.yHigh} x2={s.x} y2={s.yLow} stroke={colour} strokeWidth={1} />
              <Rect x={s.x - s.w / 2} y={top} width={s.w} height={bodyH} fill={colour} rx={s.w > 4 ? 1 : 0} />
            </React.Fragment>
          );
        })}

        {scrub && (
          <>
            <Line
              x1={scrub.x}
              y1={4}
              x2={scrub.x}
              y2={height - 4}
              stroke={c.offWhite}
              strokeWidth={1}
              strokeDasharray="3 3"
              strokeOpacity={0.7}
            />
            <Circle cx={scrub.x} cy={scrub.y} r={6} fill={c.offWhite} stroke={c.hull} strokeWidth={2} />
          </>
        )}
      </Svg>

      {/* Price labels sit on top of the canvas, in the app's own fonts. */}
      {layout && summary && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {layout.high && (
            <Text style={[styles.label, anchor(layout.high.x, drawW), { top: Math.max(0, layout.high.y - 20) }]}>
              {fmt(summary.high)}
            </Text>
          )}
          {layout.low && (
            <Text style={[styles.label, anchor(layout.low.x, drawW), { top: Math.min(height - 18, layout.low.y + 4) }]}>
              {fmt(summary.low)}
            </Text>
          )}
          <Text
            style={[
              styles.label,
              styles.openLabel,
              { top: layout.yOpen >= height / 2 ? layout.yOpen - 20 : layout.yOpen + 4 },
            ]}>
            {fmt(summary.open)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Left-anchor a label near a point in the left half, right-anchor it in
 *  the right half, so it never runs off the canvas. */
function anchor(x: number, drawW: number): { left?: number; right?: number } {
  if (x < drawW / 2) return { left: Math.max(2, x - LABEL_HALF) };
  return { right: Math.max(2, drawW - x - LABEL_HALF) };
}

const styles = themedStyles(() => StyleSheet.create({
  label: {
    position: 'absolute',
    ...theme.typography.caption,
    color: theme.colors.slate,
    backgroundColor: theme.colors.hull,
    paddingHorizontal: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },
  openLabel: { left: theme.spacing.sm },
}));
