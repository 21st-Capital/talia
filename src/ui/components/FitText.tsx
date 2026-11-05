/**
 * A figure that shrinks to fit its row instead of being cut off.
 *
 * THE ONLY WAY the app asks iOS to shrink text (decided 2026-09-26: a long
 * balance came out microscopic on a vault card, drawn at about 4pt
 * beside a normal-size name and fiat figure).
 *
 * Why it has to be a component. `adjustsFontSizeToFit` and a FIXED
 * `lineHeight` cannot be combined. iOS shrinks the text until it fits the
 * box it was given, in BOTH directions, and a fixed line height keeps the
 * line box at its full size however small the glyphs get. So when the row
 * comes out even a fraction of a point shorter than that line height, no
 * size ever fits, the loop runs to its floor and the number is drawn at
 * 4pt inside a normal-height row. There is no protection against it in the
 * props: `minimumFontScale` is ignored on iOS in React Native's current
 * architecture (RCTTextLayoutManager reads `minimumFontSize`, which JS never
 * sets, and falls back to 4.0), so the floor is 4pt whatever we pass.
 * Reproduced and fixed on the simulator the same day.
 *
 * Every text token carries its own line height, so a style spread from the
 * scale always brings one. This strips it, and then the line box shrinks with
 * the glyphs and a fit is always found. Nothing else about the style changes:
 * our faces are drawn at 1.2 em of leading, which is exactly what the hero
 * token asks for (40/48), so the heroes do not move at all.
 */
import React from 'react';
import { Text, type TextProps } from 'react-native';

import { fitStyle } from './fitStyle';

/**
 * `numberOfLines` defaults to 1: a figure that shrinks is a figure on one
 * line. `minimumFontScale` is passed through for Android, where it works.
 */
export function FitText({
  style,
  numberOfLines = 1,
  minimumFontScale = 0.6,
  ...rest
}: TextProps): React.JSX.Element {
  return (
    <Text
      {...rest}
      style={fitStyle(style)}
      numberOfLines={numberOfLines}
      minimumFontScale={minimumFontScale}
      adjustsFontSizeToFit
    />
  );
}
