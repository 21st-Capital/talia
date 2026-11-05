/**
 * A frosted pane (decided 2026-09-12, the Revolut look): Apple's blur material
 * under a faint tint, clipped to the panel's corners, with the children on
 * top. Sheets, dialogs and pickers use it, so what sits behind them blurs
 * through instead of showing through. Cards and rows do NOT: on a plain
 * page ground the translucent surface colour alone reads the same, and a
 * blur per card would cost frames on a long list.
 *
 * Give it the panel's own layout style (corners, padding, border); it adds
 * overflow hidden so the material never leaks past the corners.
 *
 * Pass `radius` (the panel's own corner radius) and it also lays the app
 * icon's glass finish over the material, exactly as the copied flash does
 * (decided 2026-09-14: "make sure the ENTIRE app follows the same structure and
 * same font with the same background"). Every popup surface should pass it,
 * so no panel can be built without the finish.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { getColorScheme, theme, themedStyles } from '../theme';
import { Gloss } from './Gloss';

export function GlassPanel({
  children,
  style,
  radius,
  glow,
}: {
  /** Omit to use it as a bare glass layer (StyleSheet.absoluteFill). */
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** The panel's corner radius. Given, the glass finish is drawn on top. */
  radius?: number;
  /** Passed through to Gloss: 'light' over another company's artwork. */
  glow?: boolean | 'light';
}): React.JSX.Element {
  return (
    <View style={[style, styles.clip]}>
      <BlurView
        style={StyleSheet.absoluteFill}
        blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
        blurAmount={24}
        reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
      />
      <View style={styles.tint} pointerEvents="none" />
      {radius != null && <Gloss radius={radius} glow={glow} />}
      {children}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  clip: { overflow: 'hidden' },
  tint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.glassTint },
}));
