/**
 * The radio circle on a choice card (the vault builder's scheme cards). It
 * shows which card is chosen, so a card's border is free to say something
 * else: on a recommended card it stays the gold frame (reported 2026-09-21: "why
 * is the second container green while the first one is orange???", when a
 * chosen recommended card had turned its frame green). The heir invite step
 * went on to use a switch per question instead.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { theme, themedStyles } from '../theme';

export function RadioMark({ on }: { on: boolean }): React.JSX.Element {
  return (
    <View style={[styles.radio, on && styles.radioOn]}>
      {on && <View style={styles.dot} />}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.colors.faint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: theme.colors.accent },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent },
}));
