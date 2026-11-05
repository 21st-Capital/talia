/**
 * The option we want a client to take, marked on its whole card (decided
 * 2026-09-21: "something that would make the entire container a more
 * favorable choice"; option C of three was chosen): a gold frame, a warm gold
 * tint and a solid gold band across the top of the card reading RECOMMENDED.
 *
 * Two parts, because the frame is the card's own style and the band is its
 * first child after the Gloss:
 *   <View style={[styles.card, recommendedFrame()]}>
 *     <Gloss ... />
 *     <RecommendedBand inset={<the card's padding>} />
 * `inset` pulls the band out to the card's edges; the card's rounded, clipped
 * corners shape its top. The frame stays gold whether or not the card is
 * chosen: a choice card shows the choice with RadioMark, never by recolouring
 * the border (decided 2026-09-21: a chosen recommended card had turned green).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme, themedStyles } from '../theme';

export function RecommendedBand({ inset }: { inset: number }): React.JSX.Element {
  return (
    <View style={[styles.band, { marginTop: -inset, marginHorizontal: -inset }]}>
      <Text style={styles.text}>RECOMMENDED</Text>
    </View>
  );
}

/** The recommended card's frame and tint, to follow the card's own style. */
export function recommendedFrame(): StyleProp<ViewStyle> {
  return styles.frame;
}

const styles = themedStyles(() => StyleSheet.create({
  frame: {
    borderWidth: 1.5,
    borderColor: theme.colors.gold,
    backgroundColor: 'rgba(242, 169, 0, 0.10)',
  },
  band: {
    marginBottom: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
    backgroundColor: theme.colors.gold,
  },
  // Dark ink on the gold in both palettes: the light palette's deeper gold
  // reads poorly under white.
  text: { ...theme.typography.label, color: theme.colors.inkOnPaper, letterSpacing: 1.5 },
}));
