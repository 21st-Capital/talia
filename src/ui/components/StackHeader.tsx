/**
 * Talia's own stack header — replaces the NATIVE header entirely so iOS 26's
 * liquid-glass circles can't wrap our bar items (decided 2026-07-17: one simple
 * bare-chevron back button everywhere, nothing crazy). Rendered via
 * native-stack's `header` option; custom headerless screens compose the
 * same HeaderBackButton.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderBackButton } from './HeaderBackButton';
import { HEADER_BTN } from './HeaderIconButton';
import { theme, themedStyles } from '../theme';
import { PageGlow } from './PageGlow';

/** The bar's height below the status bar: the side slots plus the bottom padding. */
export const STACK_HEADER_H = 50;

export function StackHeader({
  title,
  subtitle,
  canGoBack,
  right,
}: {
  title: string;
  /**
   * A second line under the title (the Speed up and Cancel ceremony names
   * its vault, decided 2026-09-28). With one, the pair sits beside the back
   * button, left-aligned, as the transaction page's own head draws its kind
   * and moment; without one the title stays centred.
   */
  subtitle?: string;
  canGoBack: boolean;
  /** Optional right-side action (a screen's `headerRight`). */
  right?: React.ReactNode;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      {/* The page glow's top slice, so the glow runs behind the bar without a seam. */}
      <PageGlow fill />
      <View style={styles.side}>{canGoBack && <HeaderBackButton />}</View>
      {subtitle != null ? (
        <View style={styles.pair}>
          <Text style={styles.kicker} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      ) : (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      )}
      <View style={styles.side}>{right}</View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.hull,
    // The buttons sit as far from the edge as the home's round buttons.
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: 6,
  },
  // minWidth, not width: a screen may put TWO actions on the right (the
  // virtual vault's rename + share). The title is flex:1 so it stays centred
  // between whatever the sides need — iOS compresses titles the same way.
  side: { minWidth: HEADER_BTN, height: 44, justifyContent: 'center' },
  title: {
    ...theme.typography.screenTitle,
    flex: 1,
    textAlign: 'center',
    color: theme.colors.offWhite,
  },
  // TxDetail's head: the pair beside the back button.
  pair: { flex: 1, minWidth: 0, marginLeft: theme.spacing.sm },
  kicker: { ...theme.typography.screenTitle, color: theme.colors.offWhite },
  subtitle: { ...theme.typography.screenSubtitle, color: theme.colors.slate, marginTop: 1 },
}));
