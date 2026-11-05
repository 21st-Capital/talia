/**
 * THE key icon — the drawn key from the Policy screen, promoted to the
 * design system (decided 2026-07-17: same key icon everywhere, never emoji).
 */
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { theme } from '../theme';

export function KeyIcon({
  size = 14,
  color,
}: {
  size?: number;
  color?: string;
}): React.JSX.Element {
  const c = color ?? theme.colors.gold;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={8} cy={12} r={4.5} stroke={c} strokeWidth={2.4} fill="none" />
      <Path
        d="M12.5 12 h8 M17 12 v4 M20.5 12 v3"
        stroke={c}
        strokeWidth={2.4}
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
