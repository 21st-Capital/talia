/**
 * The gold-framed notice of the home screen ("A recovery path is open in
 * ...") as ONE component, so every notice in the app is the same container
 * (decided 2026-09-22: the Send screen's limit warning "is also not consistent
 * with how we are doing it on the home page. Please use the same container").
 * An icon on the left, the sentence, and a chevron only when it can be tapped.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme, themedStyles } from '../theme';
import { ChevronRightIcon } from './TablerIcons';

export function NoticeBanner({
  icon,
  children,
  onPress,
  numberOfLines,
  style,
}: {
  /** A 20pt gold icon: ClockIcon, WarningIcon. */
  icon: React.ReactNode;
  children: React.ReactNode;
  /** Makes the notice tappable and adds the chevron. */
  onPress?: () => void;
  numberOfLines?: number;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const body = (
    <>
      {icon}
      <Text style={styles.text} numberOfLines={numberOfLines}>
        {children}
      </Text>
      {onPress && <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />}
    </>
  );
  return onPress ? (
    <TouchableOpacity style={[styles.banner, style]} activeOpacity={0.85} onPress={onPress}>
      {body}
    </TouchableOpacity>
  ) : (
    <View style={[styles.banner, style]}>{body}</View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      backgroundColor: 'rgba(242, 169, 0, 0.10)',
      borderColor: theme.colors.goldDark,
      borderWidth: 1,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    text: { ...theme.typography.caption, color: theme.colors.offWhite, flex: 1 },
  }),
);
