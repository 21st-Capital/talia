/**
 * The consent checkbox — one control, used everywhere the client has to agree
 * to something (decided 2026-08-28).
 *
 * It existed five times, hand-rolled, across four screens: same 24pt box, same
 * 1.5pt border, same lime fill, same drawn tick. Being five copies, they had
 * already drifted (one box rounder than the rest) and only one of them told
 * VoiceOver it was a checkbox at all. A client agreeing to something is
 * exactly where the control must be predictable, so it lives here now.
 *
 * The tick is a DrawnIcon, never a text glyph, per the house icon rule.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme, themedStyles } from '../theme';
import { DrawnIcon } from './DrawnIcon';

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The sentence being agreed to. */
  label: string;
  disabled?: boolean;
}

export function ConsentCheckbox({ checked, onChange, label, disabled }: Props): React.JSX.Element {
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.8}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}>
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked && <DrawnIcon kind="tick" size={13} strokeWidth={4} color={theme.colors.accentInk} />}
      </View>
      <Text style={styles.label}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // Top-aligned: the label runs to several lines and the box belongs beside
    // its FIRST line, not the middle of the paragraph.
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.md },
    box: {
      width: 24,
      height: 24,
      // 6, not radius.sm (8): a 24pt box wants a tighter corner, and this is
      // the value four of the five copies already used.
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: theme.colors.hairline,
      alignItems: 'center',
      justifyContent: 'center',
      // Optical: sits the box on the label's first line.
      marginTop: 1,
    },
    boxOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    label: { ...theme.typography.body, color: theme.colors.slate, flex: 1 },
  }),
);
