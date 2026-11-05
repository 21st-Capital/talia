/**
 * Shared auth gate for privacy actions (unhiding balances, unlocking the app).
 *
 * Order of preference: biometrics (when enabled) → app PIN (when set) → allow.
 * Screens call `requireAuth(reason)` and must render `authModal` once in their
 * tree; the hook owns the PIN-entry modal state.
 *
 * The PIN is checked by services/appPin.ts (decided 2026-09-26): wrong tries are
 * counted and slow down, and after too many only the phone passcode passes.
 */
import React, { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { AppModal } from '../components';
import { Button, GlassPanel, TextField } from '../components';
import { theme, themedStyles } from '../theme';
import { hasAppPin, useWallets, waitMessage } from '../../wallet';
import { promptBiometric } from '../../platform/biometrics';
import { checkPin, pinStatus, relaxPasscodeRequirement, resetPinTries } from '../../services/appPin';

export function useRequireAuth(): {
  requireAuth: (reason: string) => Promise<boolean>;
  authModal: React.JSX.Element;
} {
  const { settings, updateSettings } = useWallets();
  const [pinVisible, setPinVisible] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  /** Too many wrong tries (or no verifier): offer the phone passcode. */
  const [offerPasscode, setOfferPasscode] = useState(false);
  const [checking, setChecking] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const askPin = useCallback((): Promise<boolean> => {
    setPin('');
    setPinError(null);
    setOfferPasscode(false);
    setPinVisible(true);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const requireAuth = useCallback(
    async (reason: string): Promise<boolean> => {
      const hasPin = hasAppPin(settings);
      if (settings.biometricsEnabled) {
        const outcome = await promptBiometric(reason);
        if (outcome.ok) return true;
        // Cancelled, failed, locked out or unavailable alike: the app PIN is
        // the fallback when set (the prompt itself already offered the phone
        // passcode).
        return hasPin ? askPin() : false;
      }
      if (hasPin) return askPin();
      return true; // no auth configured
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.biometricsEnabled, settings.pinSet, settings.pinHash, settings.pinSalt, askPin],
  );

  const submitPin = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      const result = await checkPin(pin, {
        legacy: settings.pinHash && settings.pinSalt ? { salt: settings.pinSalt, hash: settings.pinHash } : undefined,
        final: true,
      });
      if (result.kind === 'ok') {
        if (result.upgraded) await updateSettings({ pinSet: true, pinHash: undefined, pinSalt: undefined });
        setPinVisible(false);
        resolver.current?.(true);
        return;
      }
      if (result.kind === 'incomplete') {
        setPinError('Wrong PIN. Try again.');
      } else {
        const st = result.status;
        setOfferPasscode(st.passcodeRequired || st.waitMs > 0 || !st.hasVerifier);
        setPinError(
          st.passcodeRequired
            ? 'Use your phone passcode instead.'
            : st.waitMs > 0
              ? waitMessage(st.waitMs)
              : 'Wrong PIN. Try again.',
        );
      }
      setPin('');
    } finally {
      setChecking(false);
    }
  }, [checking, pin, settings.pinHash, settings.pinSalt, updateSettings]);

  const openWithPhonePasscode = useCallback(async () => {
    const outcome = await promptBiometric('Use your phone passcode');
    if (!outcome.ok) {
      if (outcome.reason !== 'unavailable') return;
      // No passcode on this phone. With no PIN verifier either, nothing
      // could ever pass: never shut the owner out of their own app.
      const st = await pinStatus();
      if (st.hasVerifier || settings.pinHash) {
        await relaxPasscodeRequirement();
        setOfferPasscode(false);
        const wait = (await pinStatus()).waitMs;
        setPinError(wait > 0 ? waitMessage(wait) : null);
        return;
      }
    }
    await resetPinTries();
    setPinVisible(false);
    resolver.current?.(true);
  }, [settings.pinHash]);

  const cancelPin = useCallback(() => {
    setPinVisible(false);
    resolver.current?.(false);
  }, []);

  const authModal = (
    <AppModal visible={pinVisible} transparent animationType="fade" onRequestClose={cancelPin}>
      {/* Lifts the card so Unlock is never under the keyboard (decided 2026-09-18). */}
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <GlassPanel style={styles.card} radius={theme.radius.lg}>
          <Text style={styles.title}>Enter your PIN</Text>
          <TextField
            label=""
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 8))}
            keyboardType="numeric"
            placeholder="••••"
            error={pinError ?? undefined}
          />
          <View style={styles.row}>
            <Button title="Cancel" variant="ghost" onPress={cancelPin} style={styles.btn} />
            <Button title="Unlock" onPress={() => void submitPin()} loading={checking} style={styles.btn} />
          </View>
          {offerPasscode && (
            <Button title="Use phone passcode" variant="ghost" onPress={() => void openWithPhonePasscode()} />
          )}
        </GlassPanel>
      </KeyboardAvoidingView>
    </AppModal>
  );

  return { requireAuth, authModal };
}

const styles = themedStyles(() => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  card: {
    alignSelf: 'stretch',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.offWhite + '2E',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  // A dialog title, the same size as every other dialog's (decided 2026-09-14).
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  row: { flexDirection: 'row', gap: theme.spacing.md },
  btn: { flex: 1 },
}));
