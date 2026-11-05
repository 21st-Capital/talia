/**
 * The Sent page's drawn mark and its timeline (decided 2026-10-02, design C,
 * "Sketch and ink"). No circle and no container: a pen dot appears at the far
 * end of the tick, traces it backwards as a thin faint sketch, turns at the
 * start and inks the thick green stroke forwards over its own sketch, then
 * lifts off.
 *
 * `useSentTimeline` runs the whole page: each named track is an
 * Animated.Value that goes 0 -> 1 over its window on the NATIVE driver
 * (stroke offsets, opacity and transforms only, never a layout value: the
 * fold-flash lesson). The haptic and the moment Done becomes live are timers
 * at fixed points of the same clock, never an animation's completion
 * callback. The numbers live in `sentPageModel.ts`, tested. It takes its
 * tracks, so the "Vault built" page runs on this same engine with its own
 * (`vaultBuiltModel.ts`); there is no second copy of it.
 *
 * The small `DrawnIcon` stays for its own uses (checkboxes, the copied flash,
 * the PSBT built card, the co-sign "requested" states).
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import {
  INK_BOX,
  isInstant,
  markTuck,
  PEN_IN,
  penPath,
  TICK_D,
  TICK_D_REV,
  TICK_LEN,
} from './sentPageModel';
import type { PageTimeline, SentTrackKey } from './sentPageModel';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type SentValues = Record<SentTrackKey, Animated.Value>;

/**
 * The page's clock. `keys` names every track the page draws from (a module
 * constant: the values are made once); `timeline` is null until the page may
 * start (Reduce Motion known, the mark's size settled), and the clock starts
 * `startAfterMs` after it arrives (the slide the page comes in on). A track
 * the timeline leaves out stays at 0. `onInked` fires at `tickAt` (the
 * haptic), `onLive` at `doneAt`, when the actions may be tapped.
 */
export function useSentTimeline<K extends string>(
  keys: readonly K[],
  timeline: PageTimeline<K> | null,
  startAfterMs: number,
  onInked: () => void,
  onLive: () => void,
): Record<K, Animated.Value> {
  const values = useRef(
    Object.fromEntries(keys.map((k) => [k, new Animated.Value(0)])) as Record<K, Animated.Value>,
  ).current;
  const marks = useRef({ onInked, onLive });
  marks.current = { onInked, onLive };

  useEffect(() => {
    if (timeline == null) return;
    const { tracks, tickAt, doneAt } = timeline;
    const runs: Animated.CompositeAnimation[] = [];
    for (const k of keys) {
      const tr = tracks[k];
      if (!tr) continue;
      if (isInstant(tr)) {
        values[k].setValue(1);
        continue;
      }
      runs.push(
        Animated.timing(values[k], {
          toValue: 1,
          duration: Math.max(1, tr.end - tr.start),
          delay: startAfterMs + tr.start,
          easing: tr.easing,
          useNativeDriver: true,
        }),
      );
    }
    // No completion callback: everything with a side effect is a timer below.
    const all = Animated.parallel(runs, { stopTogether: false });
    all.start();
    const inked = setTimeout(() => marks.current.onInked(), startAfterMs + tickAt);
    const live = setTimeout(() => marks.current.onLive(), startAfterMs + doneAt);
    return () => {
      all.stop();
      clearTimeout(inked);
      clearTimeout(live);
    };
    // Once per page: the clock starts when its timeline is handed over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline]);

  return values;
}

function Stroke({
  d,
  box,
  width,
  color,
  offset,
}: {
  d: string;
  box: number;
  width: number;
  color: string;
  offset: Animated.AnimatedInterpolation<number>;
}): React.JSX.Element {
  return (
    <Svg width={box} height={box} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <AnimatedPath
        d={d}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray={`${TICK_LEN}`}
        strokeDashoffset={offset}
      />
    </Svg>
  );
}

/**
 * The mark itself. Decoration only: VoiceOver reads the page's title.
 * `box` is the design's 220 unless the screen is short (`sentMarkBox`); the
 * strokes draw in a 0-100 box, so only the box, its tuck and the pen scale.
 */
export function SentMark({
  values,
  reduce,
  box = INK_BOX,
}: {
  values: SentValues;
  reduce: boolean;
  box?: number;
}): React.JSX.Element {
  const { pen, penIn, penOut } = values;
  // Built once per size: the values never change, and the page re-renders
  // when Done goes live.
  const drawn = useMemo(() => {
    const path = penPath(box);
    const tuck = markTuck(box);
    return {
      frame: { width: box, height: box, marginTop: -tuck.top, marginBottom: -tuck.bottom },
      dot: { width: path.size, height: path.size, borderRadius: path.size / 2 },
      sketch: pen.interpolate({ inputRange: [0, 0.5], outputRange: [TICK_LEN, 0], extrapolate: 'clamp' }),
      ink: pen.interpolate({ inputRange: [0.5, 1], outputRange: [TICK_LEN, 0], extrapolate: 'clamp' }),
      penX: pen.interpolate({ inputRange: PEN_IN, outputRange: path.x }),
      penY: pen.interpolate({ inputRange: PEN_IN, outputRange: path.y }),
      penScale: Animated.multiply(penIn, penOut.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
    };
  }, [box, pen, penIn, penOut]);
  return (
    <View style={drawn.frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {!reduce && (
        <Stroke
          d={TICK_D_REV}
          box={box}
          width={1}
          color={theme.colors.faint}
          offset={drawn.sketch}
        />
      )}
      <Stroke
        d={TICK_D}
        box={box}
        width={6}
        color={theme.colors.positive}
        offset={drawn.ink}
      />
      {!reduce && (
        <Animated.View
          style={[
            styles.pen,
            drawn.dot,
            {
              transform: [
                { translateX: drawn.penX },
                { translateY: drawn.penY },
                { scale: drawn.penScale },
              ],
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // Its size, and the box's tuck into the space around the tick, come with
    // the box (`drawn.dot`, `drawn.frame`).
    pen: {
      position: 'absolute',
      left: 0,
      top: 0,
      backgroundColor: theme.colors.offWhite,
    },
  }),
);
