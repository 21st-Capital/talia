/**
 * A live status card: the one centred card in the app (decided 2026-10-05, after
 * a layout pass left-aligned every card, with BlueWallet's Electrum page beside
 * ours; then in a phone test: "simply delete the word 'status' above
 * 'connect', so lets go back to how that looked like before the change").
 *
 * No heading. The card is the status alone, CENTRED: the state in its pill,
 * what it is connected to in mono, and one detail line; long lines wrap
 * centred. This is the one exception to the left-aligned card
 * (docs/design-rules.md, page layout), and it lives here so every screen with a connection or sync
 * status reads the same.
 *
 * Words and colours are the caller's: the pill says "Connected", "Testing…"
 * or "Sync is on" in the same green, red or idle grey it always did.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme, themedStyles } from '../theme';
import { Card } from './Card';

/** Green for a live connection, red for a failed one, grey while unknown. */
export type StatusTone = 'ok' | 'bad' | 'idle';

export function StatusCard({
  tone,
  state,
  subject,
  detail,
  style,
}: {
  tone: StatusTone;
  /** The word in the pill: "Connected", "Not connected", "Sync is on". */
  state: string;
  /** What it is connected to, in mono: the server URL. */
  subject?: string;
  /** One line under it: the block height, the last sync, the failure. */
  detail?: string;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <Card style={[styles.card, style]}>
      <View
        style={[
          styles.pill,
          tone === 'ok' && styles.pillOk,
          tone === 'bad' && styles.pillBad,
          tone === 'idle' && styles.pillIdle,
        ]}>
        <Text style={[styles.state, tone === 'ok' && styles.stateOk, tone === 'bad' && styles.stateBad]}>
          {state}
        </Text>
      </View>
      {!!subject && <Text style={styles.subject}>{subject}</Text>}
      {!!detail && <Text style={styles.detail}>{detail}</Text>}
    </Card>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  // The whole card is the centred block, as the Network page always drew it.
  card: { alignItems: 'center', gap: theme.spacing.xs },
  pill: {
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xs,
  },
  // The tints the Network page always had: the positive and negative colours
  // at a glance, with the idle pill on the raised surface.
  pillOk: { backgroundColor: 'rgba(22, 199, 132, 0.18)' },
  pillBad: { backgroundColor: 'rgba(255, 76, 76, 0.15)' },
  pillIdle: { backgroundColor: theme.colors.surfaceRaised },
  state: { ...theme.typography.heading, color: theme.colors.slate, textAlign: 'center' },
  stateOk: { color: theme.colors.positive },
  stateBad: { color: theme.colors.negative },
  subject: { ...theme.typography.mono, color: theme.colors.offWhite, textAlign: 'center' },
  detail: { ...theme.typography.caption, color: theme.colors.slate, textAlign: 'center' },
}));
