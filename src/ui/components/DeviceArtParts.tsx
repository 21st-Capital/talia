/**
 * Parts every device drawing shares (design A "The courier", decided 2026-10-03):
 * the text a drawn screen prints, the turning mark the Nano X shows while it
 * works and the jumping corner the touchscreen Ledgers show, the tick and
 * the cross of the signed and refused pages (outlined on the touchscreens),
 * the Ledger mark the Gen5 and the Flex carry (four corners round an L), the
 * backspace of a PIN page, and the one-green outline that lights a device on
 * the client's turn.
 *
 * Motion is a transform or an opacity on the native driver, never a layout
 * value.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { TextProps } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { theme } from '../theme';
import { CORNER_MS, WORKING_CORNERS, cornerPath, cornerShown } from './deviceScreenLayout';

/** A value a drawing moves by: one interpolation of the press hint's clock
 *  (opacity or a transform, on the native driver), or a still number. */
export type Motion = Animated.AnimatedInterpolation<number> | Animated.Value | number;

/** A turn a drawing makes, in degrees ("-55deg"): the same clock, or a still. */
export type MotionDeg = Animated.AnimatedInterpolation<string> | string;

/**
 * The words on a drawn device's screen. They are part of the picture, set in
 * the device's own size, so they never grow with the phone's text size: on
 * a test phone (one step larger than standard) they did, and the Nova cut its
 * last line and the Nano X's words ran into its arrows (2026-10-03). Every
 * drawing prints through this, never a bare `Text`; the words the client
 * reads around the drawing still follow the phone's setting.
 */
export function ScreenText(props: TextProps): React.JSX.Element {
  return <Text {...props} allowFontScaling={false} />;
}

/** Turns its children once every `ms`, for as long as it is mounted. */
export function Spinning({ size, ms, children }: { size: number; ms: number; children: React.ReactNode }): React.JSX.Element {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(rot, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [rot, ms]);
  // One interpolation for the life of the mark, never one per redraw.
  const spin = useMemo(() => rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }), [rot]);
  return <Animated.View style={{ width: size, height: size, transform: [{ rotate: spin }] }}>{children}</Animated.View>;
}

/**
 * The touchscreen Ledgers' working mark: ONE corner bracket that jumps
 * clockwise round the corners of a small invisible box, `CORNER_MS` at each,
 * with no glide (`deviceScreenLayout.ts` `EINK_WORKING`, from a recording
 * of a Gen5). Four brackets, one clock on the native driver, and each
 * bracket's opacity a step of it: exactly one shows at a time.
 */
export function CornerMark({
  w,
  h,
  across,
  down,
  stroke,
  color,
}: {
  w: number;
  h: number;
  across: number;
  down: number;
  stroke: number;
  color: string;
}): React.JSX.Element {
  const clock = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const n = WORKING_CORNERS.length;
    const loop = Animated.loop(Animated.timing(clock, { toValue: n, duration: n * CORNER_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [clock]);
  // Built once: screen 1 redraws the drawing about twelve times a second (a
  // message each), and four new nodes a redraw would pile up for nothing.
  const shown = useMemo(() => WORKING_CORNERS.map((_, i) => clock.interpolate({ ...cornerShown(i), extrapolate: 'clamp' })), [clock]);
  return (
    <View style={{ width: w, height: h }}>
      {WORKING_CORNERS.map((c, i) => (
        <Animated.View key={c} style={[StyleSheet.absoluteFill, { opacity: shown[i] }]}>
          <Svg width={w} height={h}>
            <Path d={cornerPath(c, w, h, across, down, stroke)} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="square" />
          </Svg>
        </Animated.View>
      ))}
    </View>
  );
}

/** The tick of a signed page, in the device's own ink. */
export function TickGlyph({
  size,
  color,
  strokeWidth = 3,
  square = false,
}: {
  size: number;
  color: string;
  strokeWidth?: number;
  square?: boolean;
}): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={square ? 'M4 12.5 L10 18.5 L20 6' : 'M5 12.5 L10 17.5 L19 7'}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap={square ? 'square' : 'round'}
        strokeLinejoin={square ? 'miter' : 'round'}
      />
    </Svg>
  );
}

/** The cross of a refused page. */
export function CrossGlyph({
  size,
  color,
  strokeWidth = 3,
  square = false,
}: {
  size: number;
  color: string;
  strokeWidth?: number;
  square?: boolean;
}): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={square ? 'M6 6 L18 18 M18 6 L6 18' : 'M7 7 L17 17 M17 7 L7 17'}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap={square ? 'square' : 'round'}
      />
    </Svg>
  );
}

/**
 * The Ledger mark the Gen5 and the Flex carry on their chin, as one path in
 * units of the body's width `u`: four corner brackets centred on (cx, cy),
 * each `half` from the centre with arms `arm` long, and the L inside them
 * (reported 2026-10-04: "the L is missing in the middle of the logo"), its stem
 * down the centre and its foot to the right, read off the photo.
 */
export function bracketMarkPath(m: { cx: number; cy: number; half: number; arm: number }, u: number): string {
  const corner = (dx: number, dy: number) =>
    `M${(m.cx + dx * m.half) * u} ${(m.cy + dy * (m.half - m.arm)) * u} L${(m.cx + dx * m.half) * u} ${(m.cy + dy * m.half) * u} L${(m.cx + dx * (m.half - m.arm)) * u} ${(m.cy + dy * m.half) * u}`;
  const l = MARK_L;
  const ell = `M${(m.cx - l.stem * m.half) * u} ${(m.cy - l.top * m.half) * u} L${(m.cx - l.stem * m.half) * u} ${(m.cy + l.foot * m.half) * u} L${(m.cx + l.right * m.half) * u} ${(m.cy + l.foot * m.half) * u}`;
  return `${corner(-1, -1)} ${corner(1, -1)} ${corner(1, 1)} ${corner(-1, 1)} ${ell}`;
}

/**
 * The L inside the mark, in units of `half`: its stem this far left of the
 * centre, from `top` above to `foot` below it, the foot reaching `right`.
 * CENTRED between the corners (reported 2026-10-04: "the 'L' is not centered.
 * There is less distance to the edge on the right side than on the left"):
 * the stem sits as far left of the centre as the foot reaches right, and the
 * top as far up as the foot sits down, so with the square caps the L's box
 * sits on the centre, as on the photos of the Gen5's chin (`hwwSigning.test`
 * pins the symmetry).
 */
export const MARK_L = { stem: 0.24, top: 0.42, foot: 0.42, right: 0.24 } as const;

/**
 * The touchscreen Ledgers' signed and rejected pages (decided 2026-10-04, from a
 * recording): an OUTLINED circle holding the tick or the cross, in the
 * device's ink, never a filled disc.
 */
export function OutlinedDone({ size, stroke, ok, color }: { size: number; stroke: number; ok: boolean; color: string }): React.JSX.Element {
  const glyph = size * 0.56;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={(size - stroke) / 2} stroke={color} strokeWidth={stroke} fill="none" />
      </Svg>
      {ok ? <TickGlyph size={glyph} color={color} strokeWidth={2.6} /> : <CrossGlyph size={glyph} color={color} strokeWidth={2.6} />}
    </View>
  );
}

/** The gear in the box at the top right of the touch Ledgers' app home (the
 *  Gen5 video): eight teeth round a ring, one path with a hole. */
export function GearGlyph({ size, color }: { size: number; color: string }): React.JSX.Element {
  const c = 12;
  const teeth = 8;
  const pts: string[] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const a = ((i + 0.5) / (teeth * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 10 : 7.6;
    pts.push(`${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`);
  }
  const hole = 'M15.2 12 A3.2 3.2 0 1 0 8.8 12 A3.2 3.2 0 1 0 15.2 12 Z';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={`M${pts.join(' L')} Z ${hole}`} fill={color} fillRule="evenodd" />
    </Svg>
  );
}

/** The QR button beside the touch Ledgers' Confirm on their address page
 *  (the Gen5 video): three finder squares and a few modules, one path. */
export function QrGlyph({ size, color }: { size: number; color: string }): React.JSX.Element {
  const finder = (x: number, y: number) => `M${x} ${y} h8 v8 h-8 Z M${x + 2} ${y + 2} h4 v4 h-4 Z M${x + 3} ${y + 3} h2 v2 h-2 Z`;
  const modules = [
    [13, 1],
    [13, 5],
    [15, 3],
    [1, 13],
    [5, 13],
    [3, 15],
    [13, 13],
    [15, 15],
    [13, 17],
    [17, 13],
  ]
    .map(([x, y]) => `M${x} ${y} h2 v2 h-2 Z`)
    .join(' ');
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Path d={`${finder(1, 1)} ${finder(11, 1)} ${finder(1, 11)} ${modules}`} fill={color} fillRule="evenodd" />
    </Svg>
  );
}

/** The backspace key of a PIN page (Tabler's outline, filled as the devices draw it). */
export function BackspaceGlyph({ size, color, ink }: { size: number; color: string; ink: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size * 0.75} viewBox="0 0 24 18">
      <Path d="M21 2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-11.5l-6.3 -6.3a1 1 0 0 1 0 -1.4l6.3 -6.3z" fill={color} />
      <Path d="M12.5 6l6 6m0 -6l-6 6" stroke={ink} strokeWidth={1.8} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** The one green around a device on the client's turn (an SVG child). */
export function LitOutline({ x = 0, y = 0, w, h, r }: { x?: number; y?: number; w: number; h: number; r: number }): React.JSX.Element {
  return (
    <Rect x={x + 0.75} y={y + 0.75} width={w - 1.5} height={h - 1.5} rx={r} fill="none" stroke={theme.colors.accent} strokeWidth={1.5} />
  );
}
