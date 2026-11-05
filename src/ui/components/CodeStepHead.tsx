/**
 * The head of a one-time-code step: the badge, the tag and the title the
 * sign-in sheet shows over its email and authenticator codes. ONE component
 * so every code step reads the same (decided 2026-09-22: the co-signing limit
 * codes "look different than the login OTP screens. Please match them").
 * The two badges differ on purpose, so the second code screen is never
 * mistaken for the first (decided 2026-07-24).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { Gloss } from './Gloss';
import { DeviceMobileIcon, MailIcon } from './TablerIcons';

export function CodeStepHead({
  kind,
  title,
  tag,
}: {
  kind: 'email' | 'authenticator';
  title: string;
  /** Defaults to "EMAIL CODE" / "AUTHENTICATOR CODE". */
  tag?: string;
}): React.JSX.Element {
  return (
    <View style={styles.head}>
      <View style={styles.icon}>
        <Gloss size={48} radius={theme.radius.pill} />
        {kind === 'email' ? (
          <MailIcon size={26} color={theme.colors.gold} />
        ) : (
          <DeviceMobileIcon size={26} color={theme.colors.gold} />
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.tag}>{tag ?? (kind === 'email' ? 'EMAIL CODE' : 'AUTHENTICATOR CODE')}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    text: { flex: 1, gap: 2 },
    icon: {
      width: 48,
      height: 48,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tag: { ...theme.typography.label, color: theme.colors.gold, letterSpacing: 1 },
    title: { ...theme.typography.title, color: theme.colors.offWhite },
  }),
);
