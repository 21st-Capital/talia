/**
 * The lock screen itself, drawn from the LockModel AuthGate provides. The
 * root shows it over the navigator, and AppModal shows it inside any open
 * modal, so nothing stays readable or tappable above the lock (decided 2026-09-26).
 * Imports its parts from their own files, never the components barrel,
 * because AppModal (in that barrel) imports this file.
 *
 * Every root is `accessibilityViewIsModal`, and what it covers is hidden
 * from accessibility (lockState's `hiddenWhileLocked`), so VoiceOver cannot
 * read the vaults behind the lock (decided 2026-09-30).
 *
 * The page's buttons sit in its pinned footer (decided 2026-10-05): Unlock under
 * the centred title, and the phone-passcode way out under the PIN pad. The
 * pad itself keeps its own drawing.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { TaliaLogo } from '../components/TaliaLogo';
import { PinPad } from '../components/PinPad';
import { PageFooter } from '../components/PageFooter';
import { PageGlow } from '../components/PageGlow';
import { HeaderIconButton } from '../components/HeaderIconButton';
import { FaceIdIcon } from '../components/TablerIcons';
import { theme, themedStyles } from '../theme';
import type { LockModel } from './lockState';

export function LockScreen({ model }: { model: LockModel }): React.JSX.Element {
  if (model.coverOnly) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.root, styles.centered]} accessibilityViewIsModal>
        <PageGlow />
        <TaliaLogo size={84} />
      </View>
    );
  }

  if (model.pinFirst) {
    return (
      <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
        <PageGlow />
        <View style={styles.pinHeader}>
          <TaliaLogo size={64} />
          {model.biometricsEnabled && (
            <HeaderIconButton label="Unlock with Face ID" onPress={model.tryBiometric}>
              <FaceIdIcon size={20} color={theme.colors.gold} />
            </HeaderIconButton>
          )}
        </View>
        <PinPad
          title="Enter your PIN"
          subtitle="Talia is locked."
          error={model.pinError}
          onChange={model.onPinChange}
          resetKey={model.pinReset}
        />
        {model.offerPasscode && (
          <PageFooter>
            <Button title="Use phone passcode" variant="ghost" onPress={model.openWithPasscode} />
          </PageFooter>
        )}
      </View>
    );
  }

  // No app PIN: the one locked screen. Unlock brings Face ID back, or the
  // phone passcode sheet when iOS has locked Face ID.
  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      <PageGlow />
      <View style={styles.body}>
        <TaliaLogo size={84} />
        <Text style={styles.title}>Talia is locked</Text>
      </View>
      {model.biometricsEnabled && model.bioFailed && (
        <PageFooter>
          <Button title="Unlock" onPress={model.tryBiometric} />
          {model.bioUnavailable && (
            <Text style={styles.caption}>Face ID is off for Talia in iOS Settings</Text>
          )}
        </PageFooter>
      )}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.hull },
  centered: { alignItems: 'center', justifyContent: 'center' },
  // The logo and the title: a hero block, centred; the footer takes the safe area.
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.lg,
  },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  caption: { ...theme.typography.caption, color: theme.colors.faint, textAlign: 'center' },
  pinHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xl,
    paddingTop: 70,
  },
}));
