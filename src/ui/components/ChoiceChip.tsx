/**
 * One tappable option among a few (decided 2026-09-19: options to tap, never a
 * number to type). The chip the limit presets use, and the vault picker on
 * the Vault holders screen, so both look the same.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { theme, themedStyles } from '../theme';

export function ChoiceChip({
  label,
  on,
  onPress,
  disabled,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
      style={[chipStyles.chip, on && chipStyles.chipOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on, disabled: !!disabled }}>
      <Text style={[chipStyles.chipText, on && chipStyles.chipTextOn, disabled && chipStyles.chipTextOff]}>{label}</Text>
    </TouchableOpacity>
  );
}

export const chipStyles = themedStyles(() =>
  StyleSheet.create({
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    chip: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface,
    },
    chipOn: { backgroundColor: theme.colors.accent },
    chipText: { ...theme.typography.body, color: theme.colors.offWhite },
    chipTextOn: { color: theme.colors.accentInk },
    // A chip that cannot be tapped says so in colour, never in opacity.
    chipTextOff: { color: theme.colors.faint },
  }),
);
