/** A simple segmented control for small option sets (network, backend type). */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { holdKeyboard } from './keyboardHold';
import { cardGlow, Gloss } from './Gloss';
import { TapArea } from './TapArea';

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  /** Drive taps through the raw responder callbacks (TapArea) instead of
   *  TouchableOpacity. Needed where the control sits inside a rotated box
   *  (the landscape price chart), where a TouchableOpacity never fires. */
  responderTaps?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  responderTaps,
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Gloss radius={theme.radius.md} strength={cardGlow()} />
      {options.map((opt) => {
        const active = opt.value === value;
        if (responderTaps) {
          return (
            <TapArea
              key={opt.value}
              onPress={() => onChange(opt.value)}
              onPressIn={holdKeyboard}
              label={opt.label}
              active={active}
              slop={4}
              style={[styles.segment, active && styles.active]}>
              <Text style={[styles.text, active && styles.activeText]}>{opt.label}</Text>
            </TapArea>
          );
        }
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => onChange(opt.value)}
            // A unit switch sits beside the field it belongs to (the limit
            // amounts, a manual entry): switching it keeps the keyboard.
            onPressIn={holdKeyboard}
            activeOpacity={0.8}
            style={[styles.segment, active && styles.active]}>
            <Text style={[styles.text, active && styles.activeText]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    padding: theme.spacing.xs,
  },
  segment: {
    flex: 1,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    borderRadius: theme.radius.sm,
  },
  active: { backgroundColor: theme.colors.accent },
  text: { ...theme.typography.label, color: theme.colors.slate },
  activeText: { color: theme.colors.accentInk },
}));
