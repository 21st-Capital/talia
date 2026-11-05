/**
 * The Settings row: a glossy icon tile, a name, a line under it and a
 * chevron. One component for the Settings list and the pages it opens
 * (Elite Services, decided 2026-09-21), so they read the same.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { Gloss } from './Gloss';
import { ChevronRightIcon } from './TablerIcons';

export function MenuRow({
  icon,
  label,
  sub,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  /** Left out for a row that only states something (no tap, no chevron). */
  onPress?: () => void;
}): React.JSX.Element {
  const body = (
    <>
      <View style={styles.iconTile}>
        <Gloss size={38} radius={theme.radius.sm} />
        {icon}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
    </>
  );
  if (!onPress) return <View style={styles.row}>{body}</View>;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      {body}
      <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
    </TouchableOpacity>
  );
}

export function MenuDivider(): React.JSX.Element {
  return <View style={styles.divider} />;
}

/** The card a list of rows sits in; put <Gloss> first inside it. */
export const menuStyles = themedStyles(() =>
  StyleSheet.create({
    group: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radius.lg,
      overflow: 'hidden',
    },
  }),
);

const styles = themedStyles(() =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: theme.spacing.lg,
    },
    iconTile: {
      width: 38,
      height: 38,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowBody: { flex: 1 },
    rowLabel: { ...theme.typography.heading, color: theme.colors.offWhite },
    rowSub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 1 },
    divider: { height: 1, backgroundColor: theme.colors.hairline, marginLeft: 66 },
  }),
);
