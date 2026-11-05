/**
 * A soft glow at the top of a page (decided 2026-09-12, the Revolut ground):
 * the brand green breathing up from behind the hero, fading into the
 * page colour by mid-screen, so the glass containers have something to
 * show through. Sits behind everything; touches pass through it.
 *
 * The gradient is drawn in absolute points from the top of the WINDOW, so
 * a screen that sits under the shared stack header passes the header's
 * height as `offsetTop` and its glow continues the slice the header draws
 * (`fill`) without a seam.
 */
import React, { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { getColorScheme, theme } from '../theme';

/** How far down the window the glow reaches, in points. */
const GLOW_R = 520;

export function PageGlow({
  offsetTop = 0,
  fill = false,
  anchor = 'top',
}: {
  /**
   * How far below the top of the window this view's parent starts: the
   * shared header's height for a Screen under it, 0 for a page that draws
   * its own bar (that bar covers the glow's top and draws the same slice).
   */
  offsetTop?: number;
  /** Cover the parent (the header bar) instead of the glow's own height. */
  fill?: boolean;
  /**
   * Which edge the glow breathes from. 'top' is the page's own, measured
   * in points down from the WINDOW. 'bottom' fills the PARENT and rises
   * from its lower edge: the page glow has run out by mid-screen, so
   * anything pinned to the bottom of a page otherwise floats on the bare
   * hull, which is near black in the dark palette (decided 2026-09-25, on the
   * docked vault graph: "there is a black background behind the green
   * sticky round container"). Same brand green, same three stops, so the
   * two ends of a page are lit by one recipe.
   *
   * It is LINEAR where the top one is radial, on purpose. A radial wash
   * scaled to its box turns into a visible ellipse once the box is tall,
   * and the docked graph's panel grows with every heir: at five lanes the
   * edge of that ellipse read as a seam across the panel (found in a phone test: "the fade on
   * the container breaks as soon as there more than 3 heirs"). A linear
   * wash is even across the width and only stretches with height.
   */
  anchor?: 'top' | 'bottom';
}): React.JSX.Element | null {
  const { width } = useWindowDimensions();
  const dark = getColorScheme() === 'dark';
  if (anchor === 'bottom') return <BottomGlow dark={dark} />;
  const height = Math.max(0, GLOW_R - offsetTop);
  if (!fill && height === 0) return null;
  return (
    <View style={fill ? StyleSheet.absoluteFill : [styles.wrap, { height }]} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient
            id="pageGlow"
            gradientUnits="userSpaceOnUse"
            cx={width / 2}
            cy={-offsetTop}
            r={GLOW_R}
            fx={width / 2}
            fy={-offsetTop}>
            <Stop offset="0" stopColor={theme.colors.glow} stopOpacity={dark ? 0.55 : 0.14} />
            <Stop offset="0.55" stopColor={theme.colors.glow} stopOpacity={dark ? 0.16 : 0.05} />
            <Stop offset="1" stopColor={theme.colors.glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#pageGlow)" />
      </Svg>
    </View>
  );
}

/**
 * The glow that rises from a parent's lower edge, drawn in MEASURED points
 * rather than percentages.
 *
 * Percentages looked right and were not: an `Svg` at `height="100%"` sizes
 * its gradient's box on first layout and keeps it when the parent GROWS,
 * so the wash ended where the panel used to end and the rest stayed flat.
 * It never showed in a render that started tall, only when the client
 * ADDED heirs one at a time and the panel grew under it (decided 2026-09-25:
 * "on your screenshot it looks fixed but as I add more heirs, the fade
 * stops at the level of the third heir"). Measuring re-renders the Svg
 * with new coordinates every time the parent changes height.
 */
function BottomGlow({ dark }: { dark: boolean }): React.JSX.Element {
  const [h, setH] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setH((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {h > 0 && (
        <Svg width="100%" height={h}>
          <Defs>
            {/* Its own id: two gradients called the same thing on one
                screen resolve to whichever mounted last. */}
            <LinearGradient id="pageGlowUp" gradientUnits="userSpaceOnUse" x1={0} y1={h} x2={0} y2={0}>
              <Stop offset="0" stopColor={theme.colors.glow} stopOpacity={dark ? 0.55 : 0.14} />
              <Stop offset="0.55" stopColor={theme.colors.glow} stopOpacity={dark ? 0.16 : 0.05} />
              <Stop offset="1" stopColor={theme.colors.glow} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height={h} fill="url(#pageGlowUp)" />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0 },
});
