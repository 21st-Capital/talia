/**
 * A tap anywhere outside the keyboard puts it away (decided 2026-09-12).
 *
 * Wraps the whole app, and separately every sheet and dialog: a Modal is
 * its own window, so touches inside one never reach the app root. It
 * listens to the BUBBLING touch events rather than joining the responder
 * chain, so it never steals a touch from a button, a field or a scrolling
 * list (a responder wrapper around a ScrollView breaks scrolling).
 */
import React, { useCallback } from 'react';
import { Keyboard, TextInput, View, findNodeHandle } from 'react-native';
import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import { keyboardHeld, releaseKeyboardHold } from './keyboardHold';

/** The touch-end handler; put it on any View that hosts text fields. */
export function useKeyboardEscape(): (e: GestureResponderEvent) => void {
  return useCallback((e: GestureResponderEvent) => {
    const focused = TextInput.State.currentlyFocusedInput();
    if (!focused) return;
    // A switch that belongs to the focused field: the field keeps the
    // keyboard, and the mark is spent either way.
    if (keyboardHeld()) {
      releaseKeyboardHold();
      return;
    }
    // A tap inside the focused field itself moves the cursor; leave it.
    // Compared both as the host instance (Fabric) and as the node handle
    // (Paper), whichever renderer delivered the event.
    if ((e.target as unknown) === (focused as unknown)) return;
    let handle: number | null = null;
    try {
      handle = findNodeHandle(focused as unknown as React.Component);
    } catch {
      handle = null;
    }
    if (handle != null && String(e.nativeEvent.target) === String(handle)) return;
    // A tap on ANOTHER field takes the focus in a moment; only a tap that
    // moved the focus nowhere puts the keyboard away.
    setTimeout(() => {
      if (TextInput.State.currentlyFocusedInput() === focused) Keyboard.dismiss();
    }, 120);
  }, []);
}

export function KeyboardEscape({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const onTouchEnd = useKeyboardEscape();
  return (
    <View style={[styles.fill, style]} onTouchEnd={onTouchEnd}>
      {children}
    </View>
  );
}

const styles = { fill: { flex: 1 } } as const;
