/**
 * The style a shrink-to-fit figure is drawn with: the one it was given, minus
 * any fixed line height. See FitText for why that line has to go.
 *
 * Pure and tested (`StyleSheet.create` hands back the very objects it was
 * given, so flattening them here needs nothing from React Native).
 */
import type { StyleProp, TextStyle } from 'react-native';

export function fitStyle(style: StyleProp<TextStyle>): TextStyle {
  const flat: TextStyle = {};
  const gather = (part: unknown): void => {
    if (!part) return;
    if (Array.isArray(part)) {
      part.forEach(gather);
      return;
    }
    Object.assign(flat, part as TextStyle);
  };
  gather(style);
  delete flat.lineHeight;
  return flat;
}
