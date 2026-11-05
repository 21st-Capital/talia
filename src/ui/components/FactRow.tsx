/**
 * One fact: a label, and its value at the right. The value is never cut
 * (decided 2026-10-31 after a phone test: the cancel dialog read "Comes back
 * to this vault" beside "0.00005 B…").
 *
 * Side by side while both fit, the label taking at most FACT_LABEL_SHARE of
 * the row and wrapping at its spaces. When the value does not fit beside it,
 * it moves under the label as a whole, still at the right, and shrinks only if
 * it is wider than the whole row. At the accessibility text sizes they stack,
 * each with the full width (`factsStacked`).
 *
 * For a figure or a short value. A value in words has to wrap instead, as the
 * portfolio entry page's does.
 */
import React from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { theme, themedStyles } from '../theme';
import { FitText } from './FitText';
import { FACT_LABEL_SHARE, factsStacked } from './ledgerRowLayout';

export function FactRow({
  label,
  value,
  sub,
  mono,
  valueStyle,
}: {
  label: string;
  value: string;
  /** A quiet line under the value, at its side of the row. It wraps. */
  sub?: string;
  /** Drawn in the mono face (an address, a transaction id). */
  mono?: boolean;
  valueStyle?: StyleProp<TextStyle>;
}): React.JSX.Element {
  const stacked = factsStacked(useWindowDimensions().fontScale);
  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      <Text style={[styles.label, stacked && styles.labelStacked]}>{label}</Text>
      <FitText style={[styles.value, mono && styles.mono, valueStyle, stacked && styles.valueStacked]}>{value}</FitText>
      {!!sub && <Text style={[styles.sub, stacked && styles.subStacked]}>{sub}</Text>}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    // On the baseline: FitText's line has no fixed height, so a label on its
    // token's own leading would otherwise sit lower than the value beside it.
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: theme.spacing.md, rowGap: 2 },
    rowStacked: { flexDirection: 'column', alignItems: 'flex-start' },
    label: { ...theme.typography.body, color: theme.colors.slate, flexShrink: 1, maxWidth: FACT_LABEL_SHARE },
    labelStacked: { maxWidth: '100%' },
    // marginLeft auto: at the right edge on whichever line it lands.
    value: { ...theme.typography.body, color: theme.colors.offWhite, textAlign: 'right', flexShrink: 1, maxWidth: '100%', marginLeft: 'auto' },
    valueStacked: { marginLeft: 0, textAlign: 'left' },
    mono: { ...theme.typography.mono },
    // The whole width: a line of its own under the value.
    sub: { ...theme.typography.caption, color: theme.colors.slate, textAlign: 'right', width: '100%' },
    subStacked: { textAlign: 'left' },
  }),
);
