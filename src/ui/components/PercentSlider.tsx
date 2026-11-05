/**
 * 0–100% slider (decided 2026-07-21): the heir-allocation field used to open the
 * numeric keyboard and cover the screen. Same hand-rolled track/thumb as the
 * Send screen's fee slider — no keyboard, drag or tap to set.
 */
import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';

/** The thumb's diameter, the track's height and the row the two sit in:
 *  the control's own geometry, named once (the thumb's travel is read from
 *  the same figure). */
const THUMB = 24;
const TRACK_H = 8;
const SLIDER_H = 40;

export function PercentSlider({
  label,
  value,
  onChange,
  helper,
  max = 100,
  warn = false,
}: {
  label: string;
  value: number; // 0..100
  onChange: (v: number) => void;
  helper?: string;
  /** Upper bound (e.g. remaining share across heirs). */
  max?: number;
  /** Draw the helper as a warning: the cap has left nothing to give, so the
   *  line under the track is the client's instructions, not a footnote. */
  warn?: boolean;
}): React.JSX.Element {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  widthRef.current = width;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const maxRef = useRef(max);
  maxRef.current = max;

  const setFromX = (x: number): number => {
    const w = widthRef.current;
    if (w <= 0) return 0;
    const pct = Math.min(maxRef.current, Math.round(Math.min(1, Math.max(0, x / w)) * 100));
    onChangeRef.current(pct);
    return pct;
  };

  // Once grabbed, the drag must survive the finger drifting OFF the track
  // (reported 2026-07-24: "extremely slippery"). Two things made it drop:
  //  - locationX is relative to whichever view is under the finger, so it went
  //    nonsensical the moment the touch left the slider → track by the GLOBAL
  //    horizontal delta (gestureState.dx) from the grab point instead;
  //  - the surrounding ScrollView claimed the gesture on any vertical movement
  //    → refuse termination requests while we hold the responder.
  const grantPct = useRef(0);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        grantPct.current = setFromX(e.nativeEvent.locationX);
      },
      onPanResponderMove: (_e, g) => {
        const w = widthRef.current;
        if (w <= 0) return;
        const pct = Math.round(
          Math.min(100, Math.max(0, grantPct.current + (g.dx / w) * 100)),
        );
        onChangeRef.current(Math.min(maxRef.current, pct));
      },
    }),
  ).current;

  const clamped = Math.min(100, Math.max(0, value));

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{clamped}%</Text>
      </View>
      <View
        style={styles.slider}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}>
        <View style={styles.trackBase}>
          {max < 100 && (
            <View style={[styles.trackBlocked, { left: `${max}%`, width: `${100 - max}%` }]} />
          )}
          <View style={[styles.trackFill, { width: `${clamped}%` }]} />
        </View>
        <View
          style={[styles.thumb, { left: Math.max(0, Math.min(width - THUMB, (clamped / 100) * width - THUMB / 2)) }]}
          pointerEvents="none"
        />
      </View>
      {helper ? (
        <Text style={[styles.helper, warn && styles.helperWarn]}>{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: { gap: theme.spacing.sm },
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { ...theme.typography.label, color: theme.colors.slate },
  value: { ...theme.typography.heading, color: theme.colors.offWhite },
  slider: { height: SLIDER_H, justifyContent: 'center' },
  trackBase: { height: TRACK_H, borderRadius: TRACK_H / 2, backgroundColor: theme.colors.surfaceRaised, overflow: 'hidden' },
  trackFill: { height: TRACK_H, backgroundColor: theme.colors.accent, borderRadius: TRACK_H / 2 },
  // The stretch the cap has closed: the red at 35%, as a colour of its own
  // and never an `opacity` on the view (colour, never opacity).
  trackBlocked: { position: 'absolute', top: 0, height: TRACK_H, backgroundColor: theme.colors.negative + '59' },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: theme.colors.offWhite,
    borderWidth: 2,
    borderColor: theme.colors.accent,
    top: (SLIDER_H - THUMB) / 2,
  },
  helper: { ...theme.typography.caption, color: theme.colors.faint },
  helperWarn: { color: theme.colors.gold },
}));
