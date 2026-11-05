/**
 * The app icon's glass finish for icon tiles and round icon buttons (decided
 * 2026-09-12: "make the icons also glossy and match the design", "on every
 * page where the icons are shown"). Three layers, as in
 * assets/talia-icon.svg: the brand glow breathing up from the top edge, a
 * sheen where the light catches the top-left, and a pane edge that is
 * brightest at the top.
 *
 * Put it as the FIRST child of the tile. It fills the tile's padding box,
 * follows its corners and lets touches through. The tile keeps its own size,
 * corner radius and fill, and drops any hairline border: the edge replaces
 * it. Pass `size` for a fixed square tile (drawn on the first frame); leave
 * it out for a tile whose size changes, such as the dock's highlight, which
 * is measured. `glow="light"` over another company's artwork or colour (the
 * import flow's product logos, the exchange tiles): a soft white bloom
 * instead of the brand green, so no logo is ever tinted green (decided
 * 2026-09-12: "the glassy glow style is still missing on all these
 * icons"). `glow={false}` where the fill is a status colour (the red and
 * green transaction circles) or the live camera: sheen and edge only.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { getColorScheme, theme } from '../theme';

/** How much of the finish a CARD carries. A card is far wider than an icon
 *  tile, so it shows much more of the glow: at full strength it reads as a
 *  green wash. Both numbers were picked from side-by-side renders on
 *  2026-09-16, and they differ because the two grounds do: on the dark ground
 *  the brand glow travels, on paper it barely shows. Retune only against a
 *  render, and only the half you mean. */
export const CARD_GLOW_DARK = 0.3;
export const CARD_GLOW_LIGHT = 0.4;

/** The card glow for the palette on screen. */
export function cardGlow(): number {
  return getColorScheme() === 'dark' ? CARD_GLOW_DARK : CARD_GLOW_LIGHT;
}

export function Gloss({
  radius,
  size,
  glow = true,
  onDark = false,
  strength = 1,
}: {
  radius: number;
  size?: number;
  glow?: boolean | 'light';
  /** The tile always sits on a dark picture whatever the app's theme (the
   *  scanner's buttons over the camera): keep the dark finish. */
  onDark?: boolean;
  /** How strongly the glow and the sheen read. 1 is the icon tile's own
   *  finish. A wide surface shows far more of the gradient than a 40pt
   *  circle, so a card can want less of it (decided 2026-09-16). The edge is not
   *  scaled: it is what gives the pane its lip. */
  strength?: number;
}): React.JSX.Element {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const box = size != null ? { w: size, h: size } : measured;
  const onLayout =
    size != null
      ? undefined
      : (e: LayoutChangeEvent) => {
          const { width, height } = e.nativeEvent.layout;
          setMeasured((b) => (b && b.w === width && b.h === height ? b : { w: width, h: height }));
        };
  const dark = onDark || getColorScheme() === 'dark';
  // The light that catches the glass: the brand off-white on dark, pure
  // white on the paper ground (where `offWhite` is the dark text colour).
  const light = dark ? theme.colors.offWhite : theme.colors.white;
  const bloom = glow === 'light';
  /** Opacity scaled by `strength`, never past what a colour can carry. */
  const at = (o: number): number => Math.max(0, Math.min(1, o * strength));
  const w = box?.w ?? 0;
  const h = box?.h ?? 0;
  // SVG clamps rx and ry separately, which turns a pill into an ellipse:
  // clamp once to the shorter side.
  const r = Math.min(radius, w / 2, h / 2);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout}>
      {w > 1 && h > 1 && (
        <Svg width={w} height={h}>
          <Defs>
            <RadialGradient
              id="glossGlow"
              gradientUnits="userSpaceOnUse"
              cx={w / 2}
              cy={0}
              r={Math.max(w, h)}
              fx={w / 2}
              fy={0}>
              <Stop
                offset="0"
                stopColor={bloom ? light : theme.colors.glow}
                stopOpacity={at(bloom ? (dark ? 0.22 : 0.25) : dark ? 0.6 : 0.14)}
              />
              <Stop offset="1" stopColor={bloom ? light : theme.colors.glow} stopOpacity={0} />
            </RadialGradient>
            <LinearGradient id="glossSheen" x1="0" y1="0" x2="1" y2="1">
              {/* Over another company's artwork the paper-ground sheen is halved,
                  so a dark logo is not washed milky. */}
              <Stop offset="0" stopColor={light} stopOpacity={at(dark ? 0.16 : bloom ? 0.3 : 0.6)} />
              <Stop offset="0.5" stopColor={light} stopOpacity={at(dark ? 0.03 : bloom ? 0.08 : 0.15)} />
              <Stop offset="1" stopColor={light} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="glossEdge" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={light} stopOpacity={dark ? 0.32 : 0.95} />
              <Stop offset="1" stopColor={dark ? light : theme.colors.offWhite} stopOpacity={dark ? 0.06 : 0.12} />
            </LinearGradient>
          </Defs>
          {glow !== false && <Rect width={w} height={h} rx={r} ry={r} fill="url(#glossGlow)" />}
          <Rect width={w} height={h} rx={r} ry={r} fill="url(#glossSheen)" />
          <Rect
            x={0.5}
            y={0.5}
            width={w - 1}
            height={h - 1}
            rx={Math.max(0, r - 0.5)}
            ry={Math.max(0, r - 0.5)}
            fill="none"
            stroke="url(#glossEdge)"
            strokeWidth={1}
          />
        </Svg>
      )}
    </View>
  );
}
