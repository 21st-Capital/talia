/**
 * Minimalist thin diagonal arrows for the wallet actions — ↙ receive (value
 * arriving), ↗ send (value leaving). Drawn as strokes (not glyphs) so the
 * weight stays hairline-thin at any size, per the reference design.
 */
import React from 'react';
import Svg, { Line } from 'react-native-svg';
import { theme } from '../theme';

interface Props {
  direction: 'receive' | 'send';
  size?: number;
  color?: string;
}

export function ActionArrow({
  direction,
  size = 25,
  color = theme.colors.offWhite,
}: Props): React.JSX.Element {
  const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="6 6 20 20">
      {direction === 'send' ? (
        <>
          {/* ↗ shaft + head */}
          <Line x1={7} y1={25} x2={25} y2={7} {...stroke} />
          <Line x1={12.5} y1={7} x2={25} y2={7} {...stroke} />
          <Line x1={25} y1={7} x2={25} y2={19.5} {...stroke} />
        </>
      ) : (
        <>
          {/* ↙ shaft + head */}
          <Line x1={25} y1={7} x2={7} y2={25} {...stroke} />
          <Line x1={7} y1={12.5} x2={7} y2={25} {...stroke} />
          <Line x1={7} y1={25} x2={19.5} y2={25} {...stroke} />
        </>
      )}
    </Svg>
  );
}
