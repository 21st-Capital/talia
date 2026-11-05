/**
 * A soft fade over the bottom of a scrolling home list (decided 2026-09-12,
 * Revolut-style): cards that run under the floating tab bar dissolve into
 * the background instead of being cut off or hidden behind a "See all",
 * and scrolling brings them up out of the fade. Sits UNDER the dock (the
 * tab bar on the home screens, Receive/Send on a vault), touches pass
 * through it.
 *
 * It is a gradient to the background colour, not a lens blur: the dock is
 * the glass, the ground under it simply dissolves.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { DOCK_H, dockBottom } from './Dock';

/** How tall the dissolve is above the pill. */
const FADE_H = 72;

export function BottomFade(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const height = dockBottom(insets.bottom) + DOCK_H + FADE_H;
  const ground = theme.colors.hull;
  return (
    <View style={[styles.wrap, { height }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={ground} stopOpacity={0} />
            <Stop offset={String(FADE_H / height)} stopColor={ground} stopOpacity={0.96} />
            <Stop offset="1" stopColor={ground} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bottomFade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
