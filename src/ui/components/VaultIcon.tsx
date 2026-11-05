/**
 * Vault tab icon — a classic safe: rounded body, circular dial with spokes,
 * side handle, two feet. Drawn to match the reference safes provided.
 */
import React from 'react';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

export function VaultIcon({ size = 24, color = '#8FA89B' }: { size?: number; color?: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* body */}
      <Rect x={6} y={6} width={36} height={32} rx={4} stroke={color} strokeWidth={3} />
      {/* dial */}
      <Circle cx={22} cy={22} r={9} stroke={color} strokeWidth={3} />
      <Circle cx={22} cy={22} r={2} fill={color} />
      {/* dial spokes */}
      <Line x1={22} y1={13} x2={22} y2={17} stroke={color} strokeWidth={2.5} />
      <Line x1={22} y1={27} x2={22} y2={31} stroke={color} strokeWidth={2.5} />
      <Line x1={13} y1={22} x2={17} y2={22} stroke={color} strokeWidth={2.5} />
      <Line x1={27} y1={22} x2={31} y2={22} stroke={color} strokeWidth={2.5} />
      {/* handle */}
      <Line x1={37} y1={17} x2={37} y2={27} stroke={color} strokeWidth={3} strokeLinecap="round" />
      {/* feet */}
      <Rect x={10} y={38} width={7} height={4} fill={color} />
      <Rect x={31} y={38} width={7} height={4} fill={color} />
    </Svg>
  );
}
