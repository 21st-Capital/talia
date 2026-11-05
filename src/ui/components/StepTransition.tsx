/**
 * StepTransition — slides + cross-fades the active step of an in-screen wizard,
 * so multi-step flows (Sign, Inheritance, Send) feel like the app's screen
 * pushes instead of swapping instantly. Built-in Animated only (native driver;
 * the app has no reanimated) — this is exactly SendScreen's proven slide,
 * extracted so every flow shares it.
 *
 * Only ONE step is mounted at a time (no measuring, no dual-mount). Direction is
 * derived from `order`: a later key slides in from the right (forward), an
 * earlier key from the left (back); unknown/absent defaults to forward.
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, ViewStyle, useWindowDimensions } from 'react-native';
import { slideStarted } from './stepSlides';

interface Props {
  /** Identity of the current step (e.g. a phase string or JSON.stringify(step)). */
  stepKey: string;
  /** Optional linear order of keys — used to pick slide direction. */
  order?: readonly string[];
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  duration?: number;
}

/** How long a step slides in. The Sent page starts its mark once it has. */
export const STEP_SLIDE_MS = 260;

/**
 * How long after a slide ends the keyboard still waits (stepSlides.ts): React
 * Native syncs React's copy of the step's place in an update of its own once
 * the native slide reports its end, and the keyboard's animation must not
 * carry the stale copy. Three frames, as React Native's own sync allows.
 */
export const SLIDE_SETTLE_MS = 48;

export function StepTransition({ stepKey, order, children, style, duration = STEP_SLIDE_MS }: Props): React.JSX.Element {
  const { width } = useWindowDimensions();
  const tx = useRef(new Animated.Value(0)).current; // px offset, 0 = settled
  const op = useRef(new Animated.Value(1)).current; // opacity, 1 = settled
  const prevKey = useRef(stepKey);
  /** The running slide's "landed", for an unmount mid-slide. */
  const landed = useRef<(() => void) | null>(null);

  // useLAYOUTEffect, not useEffect: the offset must be applied BEFORE the new
  // step first paints. With useEffect the incoming step painted one settled
  // frame ("it just appears"), then jumped off-screen and slid — on heavy
  // screens the flash dominated and the slide read as a glitch (decided 2026-07-24).
  useLayoutEffect(() => {
    if (prevKey.current === stepKey) return;
    let dir = 1; // forward by default
    if (order) {
      const a = order.indexOf(prevKey.current);
      const b = order.indexOf(stepKey);
      if (a >= 0 && b >= 0) dir = b >= a ? 1 : -1;
    }
    prevKey.current = stepKey;
    // The keyboard waits until this slide has landed (stepSlides.ts). Counted
    // BEFORE the values move: moving them stops a slide still running, whose
    // own end must not let the keyboard through in between.
    const done = slideStarted();
    landed.current = done;
    tx.setValue(dir * width); // start off-screen (right=fwd, left=back)
    op.setValue(0);
    Animated.parallel([
      Animated.timing(tx, { toValue: 0, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(op, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      // Landed, or stopped by the next step (which is counted already): either
      // way this slide is over once React's copy has caught up.
      setTimeout(done, SLIDE_SETTLE_MS);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);
  // A step that goes away mid-slide never holds the keyboard.
  useEffect(() => () => landed.current?.(), []);

  return (
    <Animated.View style={[style, { opacity: op, transform: [{ translateX: tx }] }]}>
      {children}
    </Animated.View>
  );
}
