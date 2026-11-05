/** A rounded surface card on Keel's paper background. */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme, themedStyles } from '../theme';
import { cardGlow, Gloss } from './Gloss';

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View style={[styles.card, style]}>
      <Gloss radius={theme.radius.lg} strength={cardGlow()} />
      {children}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    padding: theme.spacing.lg,
  },
}));
