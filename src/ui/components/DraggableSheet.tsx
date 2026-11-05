/**
 * A bottom sheet you can flick down to dismiss (decided 2026-07-27).
 *
 * Built on PanResponder + Animated deliberately: the app has no
 * react-native-gesture-handler, and adding one for a drag would mean a new
 * native dependency and a GestureHandlerRootView at the app root. The
 * built-ins work inside a react-native <AppModal>, which is where every sheet
 * in this app lives.
 *
 * Behaviour: downward drags follow the finger (upward is clamped), release
 * past a third of the sheet — or any quick flick — dismisses; anything less
 * springs back. Taps still reach the rows underneath because the responder
 * only claims vertical movement past a small threshold.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { AppModal } from './AppModal';
import type { StyleProp, ViewStyle } from 'react-native';
import { BlurView } from '@react-native-community/blur';
import { getColorScheme, theme, themedStyles } from '../theme';
import { useKeyboardEscape } from './KeyboardEscape';
import { Gloss } from './Gloss';

export function DraggableSheet({
  visible,
  onDismiss,
  style,
  children,
}: {
  /** Drives the reset: a re-opened sheet must start at rest. */
  visible: boolean;
  onDismiss: () => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}): React.JSX.Element {
  const translateY = useRef(new Animated.Value(0)).current;
  const height = useRef(0);
  const escapeKeyboard = useKeyboardEscape();

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim only a deliberate downward drag — a tap or a horizontal
        // swipe stays with the row it started on.
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0) translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          const travelled = g.dy > Math.max(90, height.current / 3);
          const flicked = g.vy > 0.8;
          if (travelled || flicked) {
            Animated.timing(translateY, {
              toValue: height.current || 500,
              duration: 160,
              useNativeDriver: true,
            }).start(({ finished }) => {
              // An interrupted animation must not fire the dismiss
              // (the app-wide rule from SplashIntro).
              if (finished) onDismiss();
            });
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              useNativeDriver: true,
              bounciness: 4,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [onDismiss, translateY],
  );

  return (
    <Animated.View
      style={[style, styles.clip, { transform: [{ translateY }] }]}
      onLayout={(e) => {
        height.current = e.nativeEvent.layout.height;
      }}
      {...responder.panHandlers}
      onTouchEnd={escapeKeyboard}>
      {/* Frosted (decided 2026-09-12): the page blurs through the sheet; the
          caller's translucent surface colour is the tint on top. */}
      <BlurView
        style={StyleSheet.absoluteFill}
        blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
        blurAmount={24}
        reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
      />
      <View style={styles.tint} pointerEvents="none" />
      {/* The app icon's finish, as on every other popup surface (decided
          2026-09-14). Its edge fades downward, so the sheet's off-screen
          bottom corners draw nothing worth seeing. */}
      <Gloss radius={theme.radius.lg} />
      <View style={styles.handle} accessibilityLabel="Drag down to close" />
      {children}
    </Animated.View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    clip: { overflow: 'hidden' },
    tint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.glassTint },
    handle: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.hairline,
      marginBottom: theme.spacing.md,
    },
  }),
);
