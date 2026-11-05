/**
 * Stroke-drawn status icons: a tick (or X) whose stroke draws itself on
 * mount, like a pen stroke — used wherever a result "appears" (scan verify,
 * copied toasts, PSBT built) so confirmations animate in instead of popping.
 *
 * Implementation: strokeDasharray = path length, strokeDashoffset animated
 * length → 0. Path lengths are precomputed constants for the fixed geometry.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { theme } from '../theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** ✓ inside viewBox 0 0 52 52: (14,27)→(22,35)→(38,17). */
const TICK_D = 'M14 27 L22 35 L38 17';
const TICK_LEN = 36; // 11.3 + 24.1, rounded up
/** ✕ strokes: (17,17)→(35,35) and (35,17)→(17,35). */
const X1_D = 'M17 17 L35 35';
const X2_D = 'M35 17 L17 35';
const X_LEN = 26; // √(18²+18²) ≈ 25.5

interface Props {
  kind: 'tick' | 'cross';
  size?: number;
  color?: string;
  /** Draw a circle around the mark (drawn first, then the mark). */
  ring?: boolean;
  strokeWidth?: number;
}

export function DrawnIcon({
  kind,
  size = 52,
  color,
  ring = false,
  strokeWidth = 3.5,
}: Props): React.JSX.Element {
  const stroke =
    color ?? (kind === 'tick' ? theme.colors.positive : theme.colors.negative);
  const ringProgress = useRef(new Animated.Value(0)).current;
  const mark1 = useRef(new Animated.Value(0)).current;
  const mark2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    const steps = [
      ...(ring
        ? [Animated.timing(ringProgress, { toValue: 1, duration: 280, easing: ease, useNativeDriver: true })]
        : []),
      Animated.timing(mark1, { toValue: 1, duration: kind === 'tick' ? 320 : 180, easing: ease, useNativeDriver: true }),
      ...(kind === 'cross'
        ? [Animated.timing(mark2, { toValue: 1, duration: 180, easing: ease, useNativeDriver: true })]
        : []),
    ];
    if (!ring) ringProgress.setValue(1);
    Animated.sequence(steps).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const RING_LEN = 151; // 2π·24
  const dash = (v: Animated.Value, len: number) => ({
    strokeDasharray: `${len}`,
    strokeDashoffset: v.interpolate({ inputRange: [0, 1], outputRange: [len, 0] }),
  });

  return (
    <Svg width={size} height={size} viewBox="0 0 52 52">
      {ring && (
        <AnimatedCircle
          cx={26}
          cy={26}
          r={24}
          stroke={stroke}
          strokeWidth={2.5}
          fill="none"
          strokeLinecap="round"
          rotation={-90}
          originX={26}
          originY={26}
          {...dash(ringProgress, RING_LEN)}
        />
      )}
      {kind === 'tick' ? (
        <AnimatedPath
          d={TICK_D}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          {...dash(mark1, TICK_LEN)}
        />
      ) : (
        <>
          <AnimatedPath
            d={X1_D}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            {...dash(mark1, X_LEN)}
          />
          <AnimatedPath
            d={X2_D}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            {...dash(mark2, X_LEN)}
          />
        </>
      )}
    </Svg>
  );
}
