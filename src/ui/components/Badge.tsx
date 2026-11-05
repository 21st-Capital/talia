/** Small pill badges for wallet kind and network. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import type { DescriptorKind, Network } from '../../bitcoin/descriptor/types';

const KIND_LABEL: Record<DescriptorKind, string> = {
  'single-sig': 'Single-sig',
  multisig: 'Multisig',
  miniscript: 'Miniscript',
  unknown: 'Descriptor',
};

export function KindBadge({ kind }: { kind: DescriptorKind }): React.JSX.Element {
  return (
    <View style={[styles.badge, styles.kind]}>
      <Text style={styles.kindText}>{KIND_LABEL[kind]}</Text>
    </View>
  );
}

export function NetworkBadge({ network }: { network: Network }): React.JSX.Element {
  const isMain = network === 'bitcoin';
  return (
    <View style={[styles.badge, isMain ? styles.main : styles.test]}>
      <Text style={[styles.netText, isMain ? styles.mainText : styles.testText]}>
        {network}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  badge: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    alignSelf: 'flex-start',
  },
  kind: { backgroundColor: theme.colors.surfaceRaised },
  kindText: { color: theme.colors.offWhite, ...theme.typography.label },
  netText: { ...theme.typography.label, textTransform: 'capitalize' },
  main: { backgroundColor: theme.colors.gold },
  mainText: { color: theme.colors.hull },
  test: { backgroundColor: theme.colors.surfaceRaised },
  testText: { color: theme.colors.slate },
}));
