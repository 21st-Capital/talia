/**
 * Launch splash, Bitkey-grade (decided 2026-07-18: smoother — study the video).
 *
 * Sequence: the knot badge eases in centered → brief settle → the badge
 * glides left while "alia" slides out from behind it through a fixed
 * window, the knot doubling as the t of talia → the gold dot springs in as
 * the full stop → hold → the overlay dissolves into the app.
 *
 * The word used to be revealed by a hull-coloured cover sliding off static
 * text. Nothing may PAINT the ground here: the page glow behind the splash
 * is a gradient, so a flat cover showed as a block, dark on the green and
 * white in light mode (reported 2026-09-16: "the animation that reveals the Talia
 * logo carries a black background"). The window is the reveal now: the clip
 * shows a fixed width and the text travels inside it, so only the letters
 * move and the ground is never covered.
 *
 * Every animated property is a TRANSFORM or OPACITY on the NATIVE driver —
 * zero JS-driven layout work — so the motion stays 60fps even while the
 * app is still booting on the JS thread. (The old version animated `width`
 * on the JS driver, which stuttered at startup.)
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { TaliaLogo } from './TaliaLogo';
import { PageGlow } from './PageGlow';

const BADGE = 84;
const GAP = 16;

export function SplashIntro({ onDone }: { onDone: () => void }): React.JSX.Element {
  // Measured once from a hidden twin; the whole choreography derives from it.
  const [wordWidth, setWordWidth] = useState<number | null>(null);

  /** 0→1 badge entrance (opacity + scale). */
  const entrance = useRef(new Animated.Value(0)).current;
  /** 0→1 the glide: the badge slides left, the word out from behind it. */
  const slide = useRef(new Animated.Value(0)).current;
  /** Overlay opacity for the final dissolve. */
  const fade = useRef(new Animated.Value(1)).current;
  /** 0→1 the gold full-stop pop after the wordmark lands. */
  const dot = useRef(new Animated.Value(0)).current;

  const started = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (wordWidth == null || started.current) return;
    started.current = true;
    // Interrupted starts fire with finished:false — never end early, and a
    // hard fallback guarantees the overlay can't overstay either.
    const fallback = setTimeout(() => doneRef.current(), 4200);
    Animated.sequence([
      Animated.timing(entrance, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(260),
      Animated.timing(slide, {
        toValue: 1,
        duration: 680,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(dot, {
        toValue: 1,
        friction: 5,
        tension: 140,
        useNativeDriver: true,
      }),
      Animated.delay(640),
      Animated.timing(fade, {
        toValue: 0,
        duration: 400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        clearTimeout(fallback);
        doneRef.current();
      }
    });
    return () => clearTimeout(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordWidth]);

  // Final layout is STATIC and centered: [badge][gap][word]. The badge
  // starts shifted right so it sits alone at screen center, then glides to
  // its final slot; the word starts hidden behind it and slides out.
  const shift = wordWidth != null ? (wordWidth + GAP) / 2 : 0;
  const badgeX = slide.interpolate({ inputRange: [0, 1], outputRange: [shift, 0] });
  // The letters travel from wholly behind the badge to their place.
  const wordX = slide.interpolate({ inputRange: [0, 1], outputRange: [-(wordWidth ?? 0), 0] });
  const wordOpacity = slide.interpolate({
    inputRange: [0, 0.05, 1],
    outputRange: [0, 1, 1],
  });

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} pointerEvents="none">
      {/* The same glow as every page, so the first frame already looks like the app (decided 2026-09-12). */}
      <PageGlow />
      {wordWidth != null && (
        <View style={styles.row}>
          <Animated.View
            style={{
              opacity: entrance,
              transform: [
                { translateX: badgeX },
                {
                  scale: entrance.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.88, 1],
                  }),
                },
              ],
            }}>
            <TaliaLogo size={BADGE} variant="badge" />
          </Animated.View>
          <Animated.View style={[styles.clip, { width: wordWidth, opacity: wordOpacity }]}>
            <Animated.Text
              style={[styles.word, { transform: [{ translateX: wordX }] }]}
              numberOfLines={1}>
              alia
            </Animated.Text>
          </Animated.View>
          <Animated.View
            style={[styles.dot, { opacity: dot, transform: [{ scale: dot }] }]}
          />
        </View>
      )}
      {/* Hidden twin: measures the wordmark once, before anything animates. */}
      <Text
        style={[styles.word, styles.measure]}
        numberOfLines={1}
        onLayout={(e) => {
          const w = Math.ceil(e.nativeEvent.layout.width);
          if (w > 0) setWordWidth((prev) => prev ?? w);
        }}>
        alia
      </Text>
    </Animated.View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.colors.hull,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: GAP },
  clip: { overflow: 'hidden' },
  word: {
    fontSize: 54,
    fontWeight: '600',
    letterSpacing: 4,
    color: theme.colors.offWhite,
    fontFamily: 'Bricolage Grotesque',
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: theme.colors.gold,
    alignSelf: 'flex-end',
    marginBottom: 14,
    // Pull inside the word's trailing letter-spacing so the full stop
    // sits tight against the final a.
    marginLeft: -6,
  },
  measure: { position: 'absolute', opacity: 0 },
}));
