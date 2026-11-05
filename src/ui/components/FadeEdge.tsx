/**
 * A short dissolve at the bottom edge of a scrolling area (decided 2026-09-12:
 * "whenever there is something behind the keyboard or another button,
 * always use the fade effect"). Content that runs under a pinned button,
 * a footer or the keyboard melts into the background instead of being
 * cut by a hard line. Touches pass through it.
 *
 * Put it as the LAST child of a view that wraps the scroll area, so it
 * sits on the scroll area's bottom edge; `bottom` lifts it (for example to
 * the top of the keyboard). Give the scroll content FADE_EDGE_H of extra
 * bottom padding so the last row can scroll clear of the fade.
 *
 * BottomFade is the taller sibling sized to the floating dock.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { theme } from '../theme';

export const FADE_EDGE_H = 28;

export function FadeEdge({
  height = FADE_EDGE_H,
  fade,
  bottom = 0,
  color,
}: {
  height?: number;
  /**
   * How much of the height dissolves; the rest below it is solid ground,
   * for a fade that runs on UNDER a floating bar. The whole height by
   * default.
   */
  fade?: number;
  /** Distance from the bottom of the parent, e.g. the keyboard's height. */
  bottom?: number;
  /** The ground to dissolve into; the page background by default. */
  color?: string;
}): React.JSX.Element {
  const ground = color ?? theme.colors.hull;
  const solidFrom = fade != null && fade < height ? fade / height : 1;
  return (
    <View style={[styles.wrap, { height, bottom }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="fadeEdge" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={ground} stopOpacity={0} />
            <Stop offset={String(solidFrom)} stopColor={ground} stopOpacity={solidFrom < 1 ? 0.96 : 1} />
            <Stop offset="1" stopColor={ground} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#fadeEdge)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0 },
});
