/**
 * The app's small gold chip: a gold-tinted pill with a short label in gold
 * capitals ("INHERITANCE-READY", "ONE DEVICE", "MOST POPULAR"). One
 * component so every copy matches (decided 2026-09-21); it was three hand-made
 * copies whose padding had drifted. The recommended option is marked on its
 * whole card instead (RecommendedBand).
 * `tone="quiet"` is the same pill in the secondary ink on the raised surface,
 * for a tag that names something without highlighting it (an address book
 * category beside the gold spent tag, decided 2026-11-05), so the quiet tag
 * can never drift from the gold one either.
 * On its own line it sits at the card's left; in a row the caller centres it.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme, themedStyles } from '../theme';

export function GoldChip({
  label,
  tone = 'gold',
  style,
}: {
  label: string;
  tone?: 'gold' | 'quiet';
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const quiet = tone === 'quiet';
  return (
    <View style={[styles.chip, quiet && styles.chipQuiet, style]}>
      <Text style={[styles.text, quiet && styles.textQuiet]}>{label}</Text>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(242, 169, 0, 0.14)',
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  chipQuiet: { backgroundColor: theme.colors.surfaceRaised },
  text: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: theme.colors.gold },
  textQuiet: { color: theme.colors.slate },
}));
