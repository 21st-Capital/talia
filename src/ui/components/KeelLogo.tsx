/**
 * The official Keel mark (from the brand assets in 05_Marketing/01_Logos),
 * rendered via react-native-svg using the exact geometry of keel_icon.svg:
 * an off-white circle and baseline with the gold keel fin.
 */
import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { brand } from '../theme';

interface KeelLogoProps {
  size?: number;
  /**
   * 'badge' — the app-icon look: green rounded square behind the mark.
   * 'mark'  — just the circle + fin, for placement on any dark surface.
   */
  variant?: 'badge' | 'mark';
}

export function KeelLogo({ size = 96, variant = 'badge' }: KeelLogoProps): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      {variant === 'badge' && (
        <Rect x={0} y={0} width={1024} height={1024} rx={225} fill={brand.green} />
      )}
      <Circle cx={512} cy={512} r={330} fill="none" stroke={brand.offWhite} strokeWidth={34} />
      <Line
        x1={405}
        y1={694}
        x2={619}
        y2={694}
        stroke={brand.offWhite}
        strokeWidth={22}
        strokeLinecap="round"
      />
      <Path
        d="M462,672 C462,556 496,452 636,360 C572,474 546,584 562,672 Z"
        fill={brand.gold}
      />
    </Svg>
  );
}
