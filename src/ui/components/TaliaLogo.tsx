/**
 * The Talia mark, "the knot" (picked 2026-07-19 from the logo
 * directions): a lowercase t whose stem ties itself into a loop, with a
 * brand-gold dot closing the crossbar. Drawn strokes only, like every icon
 * in the app. `variant="mark"` renders bare strokes for headers;
 * `variant="lockup"` completes the word — the knot is the t of "talia";
 * the default renders the mark on a rounded tile.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import { theme } from '../theme';
import { Gloss } from './Gloss';

export function TaliaLogo({
  size = 64,
  variant = 'badge',
}: {
  size?: number;
  variant?: 'badge' | 'mark' | 'lockup';
}): React.JSX.Element {
  if (variant === 'lockup') {
    // The knot is the t; "alia" completes the word. `size` = height;
    // viewBox cropped to the artwork so the lockup centres correctly
    // (same crop method as the TIAM lockup, decided 2026-07-16).
    const w = Math.round(size * (134 / 70));
    return (
      <Svg width={w} height={size} viewBox="0 0 134 70">
        <Path d="M8 22 h30" stroke={theme.colors.offWhite} strokeWidth={7} strokeLinecap="round" fill="none" />
        <Path
          d="M22 8 v34 a10 10 0 1 0 10 -10"
          stroke={theme.colors.offWhite}
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
        />
        <Circle cx={45} cy={22} r={4} fill={theme.colors.gold} />
        <SvgText
          x={54}
          y={53}
          fontSize={40}
          fontWeight="600"
          letterSpacing={3}
          fill={theme.colors.offWhite}>
          alia
        </SvgText>
      </Svg>
    );
  }
  const mark = (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Path
        d="M31 44 h50"
        stroke={theme.colors.offWhite}
        strokeWidth={10}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M54 22 v56 a17 17 0 1 0 17 -17"
        stroke={theme.colors.offWhite}
        strokeWidth={10}
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx={93} cy={44} r={6} fill={theme.colors.gold} />
    </Svg>
  );
  if (variant !== 'badge') return mark;
  // The badge is a TILE, so it carries the app icon's finish like every other
  // tile in the app (reported 2026-09-16: "the logo on this screen is also not
  // updated yet to our new glossy version"). The tile's own ground and corner
  // radius come from the artwork (26 of 120), and the mark sits on top.
  const radius = Math.round((size * 26) / 120);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: theme.colors.surfaceSolid,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Gloss size={size} radius={radius} />
      {mark}
    </View>
  );
}
