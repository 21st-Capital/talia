/**
 * The product tiles: a wrapping grid of cards, each a mark over its name, two
 * or three to a row. The import's "Where is it now?" look (decided 2026-09-08) for
 * the WALLET APPS, each with a mark of its own. Never for devices: four
 * Ledgers under one Ledger mark read as the same tile four times (decided
 * 2026-10-04: "this looks terrible!! We have to use a list view with brands
 * instead"), so every "Which device?" step is the list in `DevicePicker`.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { Gloss, cardGlow } from './Gloss';

/** The size every tile draws its mark at. */
export const PRODUCT_MARK_SIZE = 52;

export interface ProductTile {
  key: string;
  /** The product's mark (a `ProviderTile`), drawn at `PRODUCT_MARK_SIZE`. */
  mark: React.ReactNode;
  name: string;
  onPress: () => void;
}

export function ProductGrid({ tiles, columns = 2 }: { tiles: readonly ProductTile[]; columns?: 2 | 3 }): React.JSX.Element {
  return (
    <View style={styles.grid}>
      {tiles.map((t) => (
        <TouchableOpacity
          key={t.key}
          style={[styles.card, columns === 3 ? styles.third : styles.half]}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t.name}
          onPress={t.onPress}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          {t.mark}
          <Text style={styles.name} numberOfLines={1}>
            {t.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    card: {
      alignItems: 'center',
      gap: theme.spacing.sm,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
      borderRadius: theme.radius.lg,
      paddingVertical: theme.spacing.lg,
      paddingHorizontal: theme.spacing.sm,
    },
    third: { flexBasis: '30%', flexGrow: 1 },
    half: { flexBasis: '46%', flexGrow: 1 },
    name: { ...theme.typography.heading, color: theme.colors.offWhite, marginTop: theme.spacing.xs },
  }),
);
