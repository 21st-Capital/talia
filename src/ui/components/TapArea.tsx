/**
 * A tap target driven by the raw responder callbacks instead of
 * TouchableOpacity or Pressable.
 *
 * Why it exists (2026-09-11): inside the landscape price chart, whose whole
 * box is rotated 90 degrees, a TouchableOpacity never fired its onPress on
 * the simulator, while the chart's PanResponder in the same box received
 * every touch with correct coordinates. Pressable decides a press from a
 * measured screen rectangle; the responder callbacks only need the touch
 * itself. So the buttons that can live in that box use this, everywhere,
 * so the two chart screens behave the same.
 *
 * A press counts when the finger lifts inside the view (plus `slop`), read
 * from locationX/Y, which are in the view's own space even when rotated.
 * pointerEvents="box-only" keeps the touch target on this view, never a
 * child, so those coordinates are always relative to this box.
 */
import React, { useRef, useState } from 'react';
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

interface Props {
  onPress: () => void;
  label: string;
  active?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Extra points around the view that still count as a press. */
  slop?: number;
  /** Run the moment the finger lands, before the touch ends. */
  onPressIn?: () => void;
  children: React.ReactNode;
}

export function TapArea({ onPress, label, active, disabled, style, slop = 12, onPressIn, children }: Props): React.JSX.Element {
  const [pressed, setPressed] = useState(false);
  const size = useRef({ w: 0, h: 0 });
  return (
    <View
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      onLayout={(e) => {
        size.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height };
      }}
      onStartShouldSetResponder={() => !disabled}
      onResponderGrant={() => {
        setPressed(true);
        onPressIn?.();
      }}
      onResponderTerminationRequest={() => true}
      onResponderTerminate={() => setPressed(false)}
      onResponderRelease={(e) => {
        setPressed(false);
        const { locationX, locationY } = e.nativeEvent;
        const { w, h } = size.current;
        const inside =
          locationX >= -slop && locationY >= -slop && locationX <= w + slop && locationY <= h + slop;
        if (inside && !disabled) onPress();
      }}
      pointerEvents="box-only"
      style={[style, pressed && styles.pressed]}>
      {children}
    </View>
  );
}

const styles = { pressed: { opacity: 0.7 } } as const;
