/**
 * Notification settings — one page for every alert Talia can send.
 *
 * Its own screen rather than a block on the Settings page (decided 2026-08-24):
 * more alert types are coming, and each needs room for a plain explanation of
 * what it does and when it fires.
 *
 * Everything here is a LOCAL notification, scheduled on the phone. Push would
 * need Apple's paid Developer Program, and — more importantly — a server that
 * knows about your coins. Nothing here sends anything anywhere.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import { Screen, Card } from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets } from '../../wallet';
import { openAppSettings } from '../../platform/permissions';
import {
  hasNotificationPermission,
  notificationsAvailable,
  requestNotificationPermission,
  sendTestNotification,
} from '../../platform/notifications';

type Props = NativeStackScreenProps<SettingsStackParamList, 'NotificationSettings'>;

export function NotificationsSettingsScreen(_props: Props): React.JSX.Element {
  const { settings, updateSettings } = useWallets();
  const [denied, setDenied] = useState(false);
  const [testState, setTestState] = useState<'idle' | 'sent' | 'failed'>('idle');

  // If the user granted permission in iOS Settings after refusing us once, the
  // hint should stop nagging the next time they open this page.
  useEffect(() => {
    void (async () => {
      if (settings.timelockRemindersEnabled && !(await hasNotificationPermission())) {
        setDenied(true);
      }
    })();
  }, [settings.timelockRemindersEnabled]);

  /** Turning ON asks iOS first: without permission a scheduled reminder is
   *  silently dropped, so the switch must reflect what will really happen. */
  const onToggle = async (on: boolean): Promise<void> => {
    if (!on) {
      setDenied(false);
      await updateSettings({ timelockRemindersEnabled: false });
      return;
    }
    const granted = await requestNotificationPermission();
    setDenied(!granted);
    await updateSettings({ timelockRemindersEnabled: granted });
  };

  const onTest = async (): Promise<void> => {
    const granted = (await hasNotificationPermission()) || (await requestNotificationPermission());
    if (!granted) {
      setDenied(true);
      setTestState('failed');
      return;
    }
    setTestState((await sendTestNotification(15)) ? 'sent' : 'failed');
  };

  if (!notificationsAvailable()) {
    return (
      <Screen>
        <Card>
          <Text style={styles.body}>
            Notifications are not available in this build.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen scroll style={styles.content}>
      <Card>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.rowLabel}>
              Timelock reminders
            </Text>
            <Text style={styles.rowSub}>
              When a recovery path of one of your vaults is about to open, and while it stays open.
            </Text>
          </View>
          <Switch
            value={settings.timelockRemindersEnabled === true}
            onValueChange={(v) => void onToggle(v)}
            trackColor={{ true: theme.colors.accent, false: theme.colors.switchOff }}
            ios_backgroundColor={theme.colors.switchOff}
            thumbColor={theme.colors.switchThumb}
          />
        </View>
        {denied && (
          <>
            <Text style={styles.warn}>
              Notifications are turned off for Talia. Turn them on in your phone's
              settings, then switch this back on.
            </Text>
            {/* One tap to the switch itself (decided 2026-09-26): a permission the
                system will not ask about again is only undone in Settings. */}
            <TouchableOpacity
              onPress={() => void openAppSettings()}
              style={styles.settingsLink}
              activeOpacity={0.7}>
              <Text style={styles.settingsLinkText}>Open Settings</Text>
            </TouchableOpacity>
          </>
        )}
      </Card>

      <Card>
        {/* A real reminder is months away, so without this the first proof
            delivery works would be a client's actual deadline. */}
        {/* No flex:1 wrapper here. switchText is flex:1, which is right inside
            the ROW above but collapses to zero height in this column-direction
            container — the text rendered with no room and the card looked
            empty (found in a phone test, 2026-08-24). */}
        <TouchableOpacity style={styles.testRow} onPress={() => void onTest()} activeOpacity={0.8}>
          <Text style={styles.rowLabel}>Send a test notification</Text>
          <Text style={styles.rowSub}>
            {testState === 'sent'
              ? 'Scheduled. Lock your phone to see it in about 15 seconds.'
              : testState === 'failed'
                ? 'Could not schedule it. Check notifications are allowed for Talia.'
                : 'Arrives in about 15 seconds, exactly like a real reminder.'}
          </Text>
        </TouchableOpacity>
      </Card>
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    content: { gap: theme.spacing.lg },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.md,
    },
    testRow: { paddingVertical: theme.spacing.md },
    switchText: { flex: 1 },
    rowLabel: { ...theme.typography.heading, color: theme.colors.offWhite },
    rowSub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 2 },
    body: { ...theme.typography.body, color: theme.colors.offWhite },
    warn: {
      ...theme.typography.caption,
      color: theme.colors.gold,
    },
    settingsLink: { marginTop: theme.spacing.sm, alignSelf: 'flex-start' },
    settingsLinkText: { ...theme.typography.label, color: theme.colors.accentText },
    note: {
      ...theme.typography.caption,
      color: theme.colors.slate,
      paddingHorizontal: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
  }),
);
