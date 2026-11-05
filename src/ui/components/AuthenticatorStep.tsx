/**
 * The authenticator step of a request to 21st Capital: the second code, after
 * the one from the email. Lifted out of the co-signing request (decided
 * 2026-07-24: each code step gets its own icon and tag, so the two codes are
 * never mistaken for one another) so the rescue request asks for it with the
 * very same screen (decided 2026-10-05).
 *
 * The parent owns the code, the busy state and the error: a refused code is
 * passed back as `error`, which CodeField shows under the boxes and clears
 * them for another try. It draws no button: the code submits itself, and the
 * way back is the host page's pinned footer (decided 2026-10-05, every page's
 * buttons at the bottom).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { CodeField } from './CodeField';
import { Gloss } from './Gloss';
import { DeviceMobileIcon } from './TablerIcons';

/** The icon disc beside the step's title. */
const STEP_ICON = 48;

export function AuthenticatorStep({
  tag,
  value,
  onChange,
  onComplete,
  busy,
  busyLabel = 'Submitting…',
  error,
}: {
  /** The eyebrow over the title, e.g. "STEP 2 OF 2 · AUTHENTICATOR". */
  tag: string;
  value: string;
  onChange: (v: string) => void;
  /** The sixth digit: submit with this value (the state may not have it yet). */
  onComplete: (code: string) => void;
  busy: boolean;
  busyLabel?: string;
  error?: string;
}): React.JSX.Element {
  return (
    <>
      <View style={styles.stepHeader}>
        <View style={styles.stepIcon}>
          <Gloss size={STEP_ICON} radius={theme.radius.pill} />
          <DeviceMobileIcon size={26} color={theme.colors.gold} />
        </View>
        <View style={styles.stepHeaderText}>
          <Text style={styles.stepTag}>{tag}</Text>
          <Text style={styles.stepTitle}>Now a different code</Text>
        </View>
      </View>
      <Text style={styles.body}>
        Not the emailed one. Open your <Text style={styles.strong}>authenticator
        app</Text> and enter the 6-digit code it shows now.
      </Text>
      <CodeField
        label="Code from your authenticator app"
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        oneTimeCode={false}
        busy={busy}
        busyLabel={busyLabel}
        error={error}
      />
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    body: { ...theme.typography.body, color: theme.colors.slate },
    // The emphasised words in a line of body copy.
    strong: { ...theme.typography.bodyStrong, color: theme.colors.offWhite },
    stepHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
    stepIcon: {
      width: STEP_ICON,
      height: STEP_ICON,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepHeaderText: { flex: 1, gap: 2 },
    stepTag: { ...theme.typography.label, color: theme.colors.gold, letterSpacing: 1 },
    stepTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  }),
);
