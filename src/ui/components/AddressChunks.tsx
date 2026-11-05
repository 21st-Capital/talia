/**
 * An address in groups of four, alternating off-white and gold so it is easy
 * to read and to check against a device's screen: the Receive design (decided
 * 2026-07-18), drawn ONCE here for Receive and for the address check's own
 * screen (decided 2026-10-04: "show the address on a separate page for the user
 * to compare"), so the two can never drift apart.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { chunkAddress } from '../../wallet/format';

export function AddressChunks({ address }: { address: string }): React.JSX.Element {
  return (
    <View style={styles.chunks}>
      {chunkAddress(address).map((chunk, i) => (
        <Text key={`${i}-${chunk}`} style={[styles.chunk, i % 2 === 1 && styles.chunkAlt]}>
          {chunk}
        </Text>
      ))}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    chunks: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: theme.spacing.md,
      rowGap: theme.spacing.sm,
    },
    // The ONE owner of the chunk look (decided 2026-10-05): 17pt bold mono is
    // a sanctioned size of its own, so Send, Receive and the address check
    // all read the same groups from here and never draw their own.
    chunk: {
      fontFamily: 'Menlo',
      fontSize: 17,
      fontWeight: '700',
      color: theme.colors.offWhite,
      letterSpacing: 0.4,
    },
    chunkAlt: { color: theme.colors.gold },
  }),
);
