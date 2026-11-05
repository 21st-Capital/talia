/**
 * Security settings: Face ID / Touch ID, app PIN, where auth is required
 * (app open, unhiding balances), and which wallet categories are hidden from
 * the home screen. All of it protects display privacy — Keel is watch-only
 * and never holds keys, so none of this gates funds.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AppModal } from '../components';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import { Gloss, Screen, Button, Card, PinPad, SegmentedControl, StepTransition, PageGlow } from '../components';
import { ChevronRightIcon, FingerprintIcon } from '../components/TablerIcons';
import { theme, themedStyles } from '../theme';
import {
  useWallets,
  allCategories,
  hiddenSectionKeys,
  withSectionHidden,
  hasAppPin,
  isValidPin,
  categoryTitleFor,
  LOCK_AFTER_CHOICES,
  lockAfterLabel,
  lockAfterSeconds,
} from '../../wallet';
import type { LockAfterSeconds } from '../../wallet';
import { clearAppPin, setAppPin } from '../../services/appPin';
import { biometricsInfo, promptBiometric, promptBiometricStrict } from '../../platform/biometrics';
import type { BiometricsInfo } from '../../platform/biometrics';
import { useRequireAuth } from '../auth/useRequireAuth';

type Props = NativeStackScreenProps<SettingsStackParamList, 'SecuritySettings'>;

function categoryTitle(c: string): string {
  return categoryTitleFor(c, 1);
}

export function SecuritySettingsScreen({ navigation }: Props): React.JSX.Element {
  const { settings, updateSettings, wallets } = useWallets();
  const { requireAuth, authModal } = useRequireAuth();

  const [bio, setBio] = useState<BiometricsInfo>({ available: false });
  const [pinModal, setPinModal] = useState<'set' | null>(null);
  const [pinStage, setPinStage] = useState<'enter' | 'confirm'>('enter');
  const [pin1, setPin1] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinReset, setPinReset] = useState(0);

  const hasPin = hasAppPin(settings);
  const hasMethod = settings.biometricsEnabled || hasPin;

  useEffect(() => {
    biometricsInfo().then(setBio);
  }, []);
  // Locked out by iOS after too many failed tries is still a phone WITH Face
  // ID: the row stays usable, the passcode brings the sensor back.
  const bioUsable = bio.available || !!bio.lockedOut;
  const bioType = bioUsable ? bio.type ?? 'Biometrics' : null;

  const toggleBiometrics = useCallback(
    async (on: boolean) => {
      if (on) {
        // Confirm the sensor ITSELF works before trusting it as a lock
        // method: biometrics only, the phone passcode is no proof of Face ID.
        let ok = await promptBiometricStrict('Enable Face ID for Talia');
        if (!ok && (await biometricsInfo()).lockedOut) {
          // iOS has locked Face ID. Its passcode sheet unlocks it; then the
          // sensor is proven the strict way like on any other phone.
          const passcode = await promptBiometric('Unlock Face ID with your passcode');
          if (passcode.ok) ok = await promptBiometricStrict('Enable Face ID for Talia');
        }
        if (ok) await updateSettings({ biometricsEnabled: true });
      } else {
        if (await requireAuth('Disable Face ID')) {
          await updateSettings({
            biometricsEnabled: false,
            requireAuthOnOpen: hasPin ? settings.requireAuthOnOpen : false,
          });
        }
      }
    },
    [updateSettings, requireAuth, hasPin, settings.requireAuthOnOpen],
  );

  const openSetPin = useCallback(async () => {
    // Adding a PIN adds a way in, so it asks whenever ANY lock is on, Face ID
    // alone included: otherwise whoever holds the open app sets their own
    // PIN and later opens the relocked app with it (decided 2026-09-30).
    if ((hasPin || settings.biometricsEnabled) && !(await requireAuth(hasPin ? 'Change PIN' : 'Set a PIN'))) return;
    setPin1('');
    setPinStage('enter');
    setPinError(null);
    setPinReset((k) => k + 1);
    setPinModal('set');
  }, [hasPin, settings.biometricsEnabled, requireAuth]);

  /** Two-stage full-screen flow: type the new 6-digit PIN, then repeat it. */
  const onPinDigit = useCallback(
    async (pin: string) => {
      if (pin.length < 6) return;
      if (pinStage === 'enter') {
        if (!isValidPin(pin)) {
          setPinError('PIN must be 4–8 digits.');
          setPinReset((k) => k + 1);
          return;
        }
        setPin1(pin);
        setPinStage('confirm');
        setPinError(null);
        setPinReset((k) => k + 1);
        return;
      }
      if (pin !== pin1) {
        setPinError("PINs don't match. Start again.");
        setPinStage('enter');
        setPin1('');
        setPinReset((k) => k + 1);
        return;
      }
      // The verifier goes to the Keychain (services/appPin, decided 2026-09-26);
      // the settings only record that a PIN exists. Setting a PIN means the
      // user WANTS the lock — enable it right away.
      try {
        await setAppPin(pin);
      } catch {
        setPinError('Could not save the PIN on this phone. Try again.');
        setPinStage('enter');
        setPin1('');
        setPinReset((k) => k + 1);
        return;
      }
      await updateSettings({ pinSet: true, pinSalt: undefined, pinHash: undefined, requireAuthOnOpen: true });
      setPinModal(null);
    },
    [pinStage, pin1, updateSettings],
  );

  const removePin = useCallback(async () => {
    if (!(await requireAuth('Remove PIN'))) return;
    await clearAppPin();
    await updateSettings({
      pinSet: false,
      pinHash: undefined,
      pinSalt: undefined,
      requireAuthOnOpen: settings.biometricsEnabled ? settings.requireAuthOnOpen : false,
    });
  }, [requireAuth, updateSettings, settings.biometricsEnabled, settings.requireAuthOnOpen]);

  /**
   * Weakening a lock asks first (decided 2026-09-26): turning a requirement OFF,
   * or waiting longer before the app locks again. Tightening never asks.
   */
  const setRequirement = useCallback(
    async (key: 'requireAuthOnOpen' | 'requireAuthToUnhide', on: boolean) => {
      if (!on && !(await requireAuth('Turn off this lock'))) return;
      await updateSettings({ [key]: on });
    },
    [requireAuth, updateSettings],
  );

  const currentLockAfter = lockAfterSeconds(settings);
  const setLockAfter = useCallback(
    async (next: LockAfterSeconds) => {
      if (next > currentLockAfter && !(await requireAuth('Change when Talia locks'))) return;
      await updateSettings({ lockAfterSeconds: next });
    },
    [currentLockAfter, requireAuth, updateSettings],
  );

  const toggleCategory = useCallback(
    async (category: string, hide: boolean) => {
      if (!hide && settings.requireAuthToUnhide && !(await requireAuth('Show hidden category'))) {
        return;
      }
      await updateSettings({ hiddenCategories: withSectionHidden(settings.hiddenCategories, category, hide) });
    },
    [settings.hiddenCategories, settings.requireAuthToUnhide, requireAuth, updateSettings],
  );

  // Virtual vaults have their own tab — hiding the on-chain 'Virtual'
  // category would be a dead toggle.
  const categories = allCategories(wallets.filter((w) => !w.manual));
  // Read through the same mapping the home screen hides by, so an old
  // 'other' entry shows Other as hidden (decided 2026-10-15).
  const hiddenKeys = hiddenSectionKeys(settings.hiddenCategories);

  return (
    <Screen scroll style={styles.content}>
      <Card style={styles.group}>
        <Text style={styles.groupTitle}>
          21st Capital account
        </Text>
        <TouchableOpacity
          style={styles.navRow}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('TwoFactor')}>
          <View style={styles.iconTile}>
            <Gloss size={38} radius={theme.radius.sm} />
            <FingerprintIcon size={20} color={theme.colors.gold} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.navLabel}>Two-factor authentication</Text>
            <Text style={styles.rowSub}>A second step at sign-in (authenticator app)</Text>
          </View>
          <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
        </TouchableOpacity>
      </Card>

      <Card style={styles.group}>
        <Text style={styles.groupTitle}>
          Unlock methods
        </Text>
        <RowSwitch
          label={bioType === 'FaceID' ? 'Face ID' : bioType === 'TouchID' ? 'Touch ID' : 'Biometrics'}
          sub={bioUsable ? 'Use the device sensor' : 'Not available on this device'}
          value={settings.biometricsEnabled}
          disabled={!bioUsable}
          onChange={toggleBiometrics}
        />
        <View style={styles.divider} />
        <View style={styles.row}>
          <View style={styles.rowBody}>
            <Text style={styles.rowLabel}>App PIN</Text>
            <Text style={styles.rowSub}>{hasPin ? 'PIN is set' : '4–8 digits'}</Text>
          </View>
          <Button title={hasPin ? 'Change' : 'Set PIN'} variant="ghost" onPress={openSetPin} style={styles.smallBtn} />
        </View>
        {hasPin && (
          // The same step down from the row above as the Network card's
          // buttons (decided 2026-09-12).
          <Button title="Remove PIN" variant="ghost" onPress={removePin} style={styles.cardAction} />
        )}
      </Card>

      <Card style={styles.group}>
        <Text style={styles.groupTitle}>Require authentication</Text>
        <RowSwitch
          label="When opening the app"
          sub={hasMethod ? 'Lock screen on opening and on coming back' : 'Set a method above first'}
          value={settings.requireAuthOnOpen}
          disabled={!hasMethod}
          onChange={(v) => void setRequirement('requireAuthOnOpen', v)}
        />
        {settings.requireAuthOnOpen && hasMethod && (
          <View style={styles.lockAfter}>
            <Text style={styles.rowLabel}>Lock again after</Text>
            <SegmentedControl
              options={LOCK_AFTER_CHOICES.map((s) => ({ value: String(s), label: lockAfterLabel(s) }))}
              value={String(currentLockAfter)}
              onChange={(v) => void setLockAfter(Number(v) as LockAfterSeconds)}
            />
          </View>
        )}
        <View style={styles.divider} />
        <RowSwitch
          label="To unhide balances"
          sub={hasMethod ? 'Applies to every hidden balance' : 'Set a method above first'}
          value={settings.requireAuthToUnhide}
          disabled={!hasMethod}
          onChange={(v) => void setRequirement('requireAuthToUnhide', v)}
        />
      </Card>

      <Card style={styles.group}>
        <Text style={styles.groupTitle}>
          Hidden categories
        </Text>
        {categories.map((c, i) => (
          <View key={c || 'other'}>
            {i > 0 && <View style={styles.divider} />}
            <RowSwitch
              label={categoryTitle(c)}
              sub={hiddenKeys.has(c) ? 'Hidden from home' : 'Visible'}
              value={hiddenKeys.has(c)}
              onChange={(v) => toggleCategory(c, v)}
            />
          </View>
        ))}
        {categories.length === 0 && <Text style={styles.hint}>No wallets yet.</Text>}
      </Card>

      <Text style={styles.footnote}>
        These settings protect what is visible on screen. Your funds never
        depend on them.
      </Text>

      {authModal}

      <AppModal visible={pinModal === 'set'} animationType="slide" onRequestClose={() => setPinModal(null)}>
        {/* A full-screen Modal sits outside the navigator's page layout, so it paints its own ground and glow. */}
        <View style={styles.pinRoot}>
          <PageGlow />
          {/* enter → confirm slides like a step, not an instant title swap. */}
          <StepTransition stepKey={pinStage} order={['enter', 'confirm']} style={styles.flexOne}>
            <PinPad
              title={pinStage === 'enter' ? 'Set Passcode' : 'Repeat Passcode'}
              subtitle={
                pinStage === 'enter'
                  ? 'Protects what is on screen, not your funds.'
                  : 'Type the same passcode again to confirm.'
              }
              error={pinError}
              onChange={onPinDigit}
              onCancel={() => setPinModal(null)}
              resetKey={pinReset}
            />
          </StepTransition>
        </View>
      </AppModal>
    </Screen>
  );
}

function RowSwitch({
  label,
  sub,
  value,
  disabled,
  onChange,
}: {
  label: string;
  sub: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}): React.JSX.Element {
  // A row that cannot be switched says so in colour, never with opacity.
  return (
    <View style={styles.row}>
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, disabled && styles.textDisabled]}>{label}</Text>
        <Text style={[styles.rowSub, disabled && styles.textDisabled]}>{sub}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: theme.colors.accent, false: theme.colors.switchOff }}
        ios_backgroundColor={theme.colors.switchOff}
        thumbColor={theme.colors.switchThumb}
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  content: { gap: theme.spacing.lg },
  flexOne: { flex: 1 },
  pinRoot: { flex: 1, backgroundColor: theme.colors.hull },
  group: { gap: theme.spacing.sm },
  cardAction: { marginTop: theme.spacing.md },
  groupTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  hint: { ...theme.typography.caption, color: theme.colors.slate },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.xs },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm },
  textDisabled: { color: theme.colors.faint },
  lockAfter: { gap: theme.spacing.sm, paddingVertical: theme.spacing.xs },
  rowBody: { flex: 1 },
  rowLabel: { ...theme.typography.body, color: theme.colors.offWhite },
  navLabel: { ...theme.typography.heading, color: theme.colors.offWhite },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowSub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 1 },
  smallBtn: { minHeight: 38, paddingHorizontal: theme.spacing.md },
  divider: { height: 1, backgroundColor: theme.colors.hairline },
  footnote: { ...theme.typography.caption, color: theme.colors.faint, textAlign: 'center' },
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  modalCard: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  rowButtons: { flexDirection: 'row', gap: theme.spacing.md },
  flex: { flex: 1 },
}));
