/**
 * The vault's Receive/Send bar (decided 2026-09-12): a floating glass pill whose
 * icons carry their names underneath, folding away as soon as the list behind
 * it scrolls (dockState.ts).
 *
 * It is BUILT TO MATCH Apple's tab bar, which is the app's main navigator
 * since 2026-09-15 (reported 2026-09-16: "you completely forgot to match the design
 * that we have for the main navigator, to the send and receive icons"). The
 * numbers below were measured off the real bar on a device: the same 60pt
 * pill, the same distance from the bottom of the screen, icons the same size
 * as the tab icons with the same small name under them, the chrome material
 * UIKit's own bars use, and no hard edge. Apple's bar LIFTS off the page (it
 * reads lighter than the ground in both palettes); a darkening tint and a 1pt
 * ink border made ours sit on the page instead, which is what the mismatch
 * looked like. Measure against the real bar again before changing any of it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getColorScheme, theme, themedStyles } from '../theme';
import { useDockFolded } from './dockState';
import { Gloss } from './Gloss';

const LABEL_H = 16;
/** A button's height with and without its name: Apple's bar is 60pt tall with
 *  its names, and the pill adds PILL_PAD twice. */
const BTN_H_FOLDED = 36;
const BTN_H_OPEN = 48;
const BTN_W_FOLDED = 56;
const BTN_W_OPEN = 78;
const PILL_PAD = 6;

/** The pill at its tallest (names shown); BottomFade sizes its dissolve to it. */
export const DOCK_H = BTN_H_OPEN + 2 * PILL_PAD + 2;

/** The gap between the pill and the bottom of the screen. Apple's bar sits
 *  23pt up on a phone with a home indicator (34pt inset), so it overlaps part
 *  of that inset rather than clearing it; a phone without one keeps md. */
export function dockBottom(insetBottom: number): number {
  return Math.max(insetBottom - 11, theme.spacing.md);
}

export interface DockItem {
  key: string;
  label: string;
  icon: (color: string) => React.ReactNode;
  onPress: () => void;
  /** The current tab on the home screens: tinted and backed. */
  active?: boolean;
  /** A button that is there but not usable right now (a watch-only Send):
   *  drawn in `faint`, icon and name, never dimmed by opacity. */
  dim?: boolean;
  /** Foreground when the item is not active; defaults to slate. */
  color?: string;
}

interface Props {
  items: DockItem[];
}

export function Dock({ items }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const folded = useDockFolded();
  // The highlight is ONE pill that travels to the tab you pick, rather than
  // one per tab blinking on and off (decided 2026-09-14: "the selected and active
  // menu looks as if it slips to the other when you select the other
  // options"). Each button reports its box; the pill springs to it.
  const [boxes, setBoxes] = useState<Record<string, { x: number; w: number }>>({});
  const activeKey = items.find((i) => i.active)?.key;
  // Two edges, not a position and a width: the edge leading the move springs
  // faster than the one trailing it, so the highlight stretches out of the old
  // tab and gathers into the new one the way a drop of liquid would (decided
  // 2026-09-14, with a frame caught mid-transition in WhatsApp).
  const edgeL = useRef(new Animated.Value(0)).current;
  const edgeR = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  const from = useRef<{ x: number; w: number } | null>(null);
  // The bubble: the highlight swells as it leaves and settles back down (decided
  // 2026-09-14: "whatsapp has some kind of a bubble effect when you transition
  // it"). 0 at rest, 1 at the top of the swell.
  const swell = useRef(new Animated.Value(0)).current;
  const open = useRef(new Animated.Value(folded ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(open, {
      toValue: folded ? 0 : 1,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [folded, open]);

  const target = activeKey ? boxes[activeKey] : undefined;
  const targetX = target?.x;
  const targetW = target?.w;
  useEffect(() => {
    if (targetX == null || targetW == null) return;
    const left = targetX;
    const right = targetX + targetW;
    if (!placed.current) {
      // The first paint must not slide in from the left edge.
      edgeL.setValue(left);
      edgeR.setValue(right);
      placed.current = true;
      from.current = { x: targetX, w: targetW };
      return;
    }
    const rightwards = from.current ? targetX > from.current.x : true;
    from.current = { x: targetX, w: targetW };
    // The leading edge arrives first; the trailing edge is slower and softer,
    // which is what makes the shape lengthen while it travels and settle once
    // both edges land. About a third of a second, no bounce.
    const lead = { damping: 20, stiffness: 260, mass: 0.7 };
    const trail = { damping: 22, stiffness: 120, mass: 0.8 };
    Animated.parallel([
      Animated.spring(edgeL, { toValue: left, useNativeDriver: false, ...(rightwards ? trail : lead) }),
      Animated.spring(edgeR, { toValue: right, useNativeDriver: false, ...(rightwards ? lead : trail) }),
      Animated.sequence([
        Animated.timing(swell, { toValue: 1, duration: 80, useNativeDriver: false }),
        Animated.timing(swell, { toValue: 0, duration: 190, useNativeDriver: false }),
      ]),
    ]).start();
  }, [targetX, targetW, edgeL, edgeR, swell]);

  // Never negative, however the springs cross.
  const slideW = Animated.subtract(edgeR, edgeL).interpolate({
    inputRange: [0, 1000],
    outputRange: [0, 1000],
    extrapolate: 'clamp',
  });

  const btnHeight = open.interpolate({ inputRange: [0, 1], outputRange: [BTN_H_FOLDED, BTN_H_OPEN] });
  const btnWidth = open.interpolate({ inputRange: [0, 1], outputRange: [BTN_W_FOLDED, BTN_W_OPEN] });
  const labelHeight = open.interpolate({ inputRange: [0, 1], outputRange: [0, LABEL_H] });

  return (
    <View style={[styles.wrap, { bottom: dockBottom(insets.bottom) }]} pointerEvents="box-none">
      {/* The shadow lives on an outer view: the pill clips (overflow hidden)
          so the glass stays inside its rounded edge. */}
      <View style={styles.shadow}>
        <View style={styles.pill}>
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType={getColorScheme() === 'dark' ? 'chromeMaterialDark' : 'chromeMaterialLight'}
            blurAmount={24}
            reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
          />
          <View style={styles.tint} pointerEvents="none" />
          {/* The app icon's glass finish over the WHOLE pill, the same as
              every other glass container (decided 2026-09-16: "make the glassy
              background on the entire container with the send and receive
              icons"), not a finish per icon. */}
          <Gloss radius={theme.radius.pill} />
          {target && (
            <Animated.View
              style={[
                styles.slider,
                {
                  left: edgeL,
                  width: slideW,
                  height: btnHeight,
                  transform: [{ scaleY: swell.interpolate({ inputRange: [0, 1], outputRange: [1, 1.13] }) }],
                },
              ]}
              pointerEvents="none">
              {/* The highlight carries the icon tiles' glass finish. */}
              <Gloss radius={theme.radius.pill} />
              {/* A breath of light at the top of the swell, so the bubble
                  reads as one even at a glance. */}
              <Animated.View
                style={[styles.swellSheen, { opacity: swell.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] }) }]}
              />
            </Animated.View>
          )}
          {items.map((item) => {
            // accentText, not accent: lime is unreadable on the light glass.
            // A dimmed button says so in colour (decided 2026-10-05).
            const color = item.active
              ? theme.colors.accentText
              : item.dim
                ? theme.colors.faint
                : item.color ?? theme.colors.slate;
            return (
              <TouchableOpacity
                key={item.key}
                onLayout={(e) => {
                  const { x, width } = e.nativeEvent.layout;
                  setBoxes((prev) =>
                    prev[item.key]?.x === x && prev[item.key]?.w === width
                      ? prev
                      : { ...prev, [item.key]: { x, w: width } },
                  );
                }}
                onPress={item.onPress}
                accessibilityRole="button"
                accessibilityState={item.active ? { selected: true } : {}}
                accessibilityLabel={item.label}
                activeOpacity={0.8}>
                <Animated.View style={[styles.btn, { height: btnHeight, minWidth: btnWidth }]}>
                  {item.icon(color)}
                  <Animated.View style={[styles.labelClip, { height: labelHeight, opacity: open }]}>
                    <Text style={[styles.label, { color }]} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </Animated.View>
                </Animated.View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    shadow: {
      borderRadius: theme.radius.pill,
      shadowColor: theme.colors.black,
      // Apple's bar casts a soft, shallow shadow; ours used to sit on a dark
      // halo that made the pill look heavier than the tab bar.
      shadowOpacity: 0.14,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    pill: {
      flexDirection: 'row',
      gap: theme.spacing.xs,
      borderRadius: theme.radius.pill,
      overflow: 'hidden',
      padding: PILL_PAD,
      // The faintest light edge, which is what Apple's bar catches, in WHITE:
      // `offWhite` is the dark ink on paper, so an offWhite edge drew a dark
      // outline around the pill in light mode.
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.white + '1F',
    },
    // A LIFT, not a tint: the bar must read lighter than the page in both
    // palettes, the way Apple's does. `glassTint` darkens, which is right
    // under a popup and wrong here.
    tint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.white + '14' },
    btn: {
      borderRadius: theme.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      // Room either side of the name inside the highlight (decided 2026-09-12:
      // "Portfolios" ran to the highlight's edges).
      paddingHorizontal: theme.spacing.md,
    },
    swellSheen: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.offWhite,
    },
    // The travelling highlight, behind the buttons.
    slider: {
      position: 'absolute',
      top: PILL_PAD,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.offWhite + '24',
    },
    // A breath between the icon and its name (decided 2026-09-16).
    labelClip: { overflow: 'hidden', alignItems: 'center', marginTop: 3 },
    // One size under the caption (decided 2026-09-12: a little smaller).
    label: { ...theme.typography.label, fontSize: 11, lineHeight: LABEL_H, letterSpacing: 0 },
  }),
);
