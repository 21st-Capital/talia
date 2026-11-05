/**
 * A row that slides to the left to show its actions, as in Google's
 * authenticator app (decided 2026-11-05 after a phone test: the address
 * book's long press became a swipe with Edit and Remove).
 *
 * The row and its actions move together: the actions wait just past the
 * row's right edge, outside the clip, so nothing of them shows through a
 * glass card at rest, and swiping pulls them into view. A swipe is claimed
 * only when the finger moves clearly sideways (`isSwipe`), so the page
 * still scrolls and a tap still taps. Which row is open is the caller's
 * state (`open`, `onOpen`, `onClose`), so one row at a time can be open and
 * a tap on an open row can close it instead of acting. Each action is an
 * icon tile in the app's glass finish; a destructive one is filled in the
 * one red.
 *
 * With `fullSwipe` (decided 2026-11-05 after a phone test: "if the address
 * is swiped all the way until the end to the left, then select delete"),
 * the row follows the finger on past its actions; the LAST action (the
 * destructive one) stretches across the room it leaves, the hand feels one
 * tick as the row crosses `fullSwipeAt` (and another if it comes back), and
 * letting go past it runs that action and closes the row. The action asks
 * first, so a full swipe never removes anything by itself.
 *
 * The page's own swipe back must be off while a row is open, or a swipe to
 * close it takes the page back instead: the caller sets that (the address
 * book sets `gestureEnabled` from its open row). And the page must not scroll
 * while a row is being swiped (decided 2026-11-05 after a phone test: it
 * moved under the finger): `onSwipeStart` and `onSwipeEnd` tell the caller,
 * which holds its scroll view still between them. The rules are pure in
 * `swipeRowModel.ts`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, StyleSheet, TouchableOpacity, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { cardGlow, Gloss } from './Gloss';
import {
  dragOffset,
  fullSwipeAt,
  isSwipe,
  pastFullSwipe,
  settlesOpen,
  swipeOpenWidth,
  SWIPE_ACTION_W,
  SWIPE_GAP,
} from './swipeRowModel';
import { swipeTick } from '../../platform/haptics';

export interface SwipeAction {
  /** What VoiceOver says for the tile, and the row's own accessibility action. */
  label: string;
  icon: React.ReactNode;
  destructive?: boolean;
  onPress: () => void;
}

const SETTLE_MS = 200;

export function SwipeRow({
  open,
  onOpen,
  onClose,
  actions,
  fullSwipe = false,
  onSwipeStart,
  onSwipeEnd,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  actions: readonly SwipeAction[];
  /** Dragged all the way, the last action runs (it must ask first). */
  fullSwipe?: boolean;
  /** A finger has started swiping this row (the page should stop scrolling). */
  onSwipeStart?: () => void;
  /** That finger has let go, or the swipe was taken away. */
  onSwipeEnd?: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const openWidth = swipeOpenWidth(actions.length);
  const [rowWidth, setRowWidth] = useState(0);
  const fullAt = fullSwipe && rowWidth > 0 ? fullSwipeAt(rowWidth, openWidth) : null;
  const x = useRef(new Animated.Value(0)).current;
  /** Where the row is, in points (0 closed, -openWidth open), kept beside the value. */
  const at = useRef(0);
  const from = useRef(0);
  /** Whether the row was past the full swipe at the last move, for the tick. */
  const wasPast = useRef(false);
  // The latest of what the caller handed over, for handlers made once.
  const latest = useRef({ open, onOpen, onClose, openWidth, fullAt, rowWidth, actions, onSwipeStart, onSwipeEnd });
  latest.current = { open, onOpen, onClose, openWidth, fullAt, rowWidth, actions, onSwipeStart, onSwipeEnd };

  const settle = (to: number) => {
    at.current = to;
    Animated.timing(x, { toValue: to, duration: SETTLE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  };

  useEffect(() => {
    settle(open ? -openWidth : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openWidth]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claimed in the capture phase, so the card's own tap gives way.
        onMoveShouldSetPanResponderCapture: (_e, g) => isSwipe(g.dx, g.dy),
        onPanResponderGrant: () => {
          x.stopAnimation();
          from.current = at.current;
          wasPast.current = false;
          latest.current.onSwipeStart?.();
        },
        onPanResponderMove: (_e, g) => {
          const l = latest.current;
          const v = dragOffset(from.current, g.dx, l.openWidth, l.fullAt, l.rowWidth);
          at.current = v;
          x.setValue(v);
          const past = pastFullSwipe(v, l.fullAt);
          if (past !== wasPast.current) {
            wasPast.current = past;
            swipeTick();
          }
        },
        onPanResponderRelease: (_e, g) => {
          const l = latest.current;
          l.onSwipeEnd?.();
          if (pastFullSwipe(at.current, l.fullAt)) {
            settle(0);
            l.onClose();
            l.actions[l.actions.length - 1]?.onPress();
            return;
          }
          const willOpen = settlesOpen(at.current, g.vx, l.openWidth);
          settle(willOpen ? -l.openWidth : 0);
          if (willOpen) l.onOpen();
          else l.onClose();
        },
        onPanResponderTerminate: () => {
          latest.current.onSwipeEnd?.();
          settle(latest.current.open ? -latest.current.openWidth : 0);
        },
        onPanResponderTerminationRequest: () => false,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Past the actions, the last one stretches across the room the row leaves.
  const stretch = fullSwipe && rowWidth > openWidth;
  const lastWidth = stretch
    ? x.interpolate({
        inputRange: [-rowWidth, -openWidth, 0],
        outputRange: [SWIPE_ACTION_W + rowWidth - openWidth, SWIPE_ACTION_W, SWIPE_ACTION_W],
        extrapolate: 'clamp',
      })
    : SWIPE_ACTION_W;

  return (
    <View style={styles.clip} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={{ transform: [{ translateX: x }] }} {...pan.panHandlers}>
        {children}
        {/* Anchored at the row's right edge, so a stretching last action grows into the room the row leaves. */}
        <View style={styles.actions}>
          {actions.map((a, i) => {
            const last = i === actions.length - 1;
            return (
              <Animated.View key={a.label} style={[styles.tileBox, { width: last ? lastWidth : SWIPE_ACTION_W }]}>
                <TouchableOpacity
                  style={[styles.tile, a.destructive && styles.tileDestructive]}
                  onPress={a.onPress}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}>
                  {a.destructive ? (
                    <Gloss radius={theme.radius.lg} glow={false} />
                  ) : (
                    <Gloss radius={theme.radius.lg} strength={cardGlow()} />
                  )}
                  {a.icon}
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    clip: { overflow: 'hidden' },
    actions: { position: 'absolute', top: 0, bottom: 0, left: '100%', flexDirection: 'row', paddingLeft: SWIPE_GAP, gap: SWIPE_GAP },
    tileBox: { height: '100%' },
    tile: {
      flex: 1,
      borderRadius: theme.radius.lg,
      overflow: 'hidden',
      backgroundColor: theme.colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tileDestructive: { backgroundColor: theme.colors.negative },
  }),
);
