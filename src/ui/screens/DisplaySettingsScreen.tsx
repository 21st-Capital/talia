/** The General settings page (route id stays DisplaySettings): amount unit
 *  (BTC/sats) and fiat currency. Renamed from Display on 2026-09-14. */
import React from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { SettingsStackParamList } from '../navigation/types';
import { Screen, Card, SegmentedControl, RadioMark } from '../components';
import { theme, themedStyles } from '../theme';
import { useWallets, FIAT_CURRENCIES } from '../../wallet';
import type { AmountUnit, FiatCurrency } from '../../wallet';

type Props = NativeStackScreenProps<SettingsStackParamList, 'DisplaySettings'>;

const UNIT_OPTIONS: ReadonlyArray<{ value: AmountUnit; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'btc', label: 'BTC' },
  { value: 'sats', label: 'Sats' },
];

const CURRENCY_NAMES: Record<FiatCurrency, string> = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  CHF: 'Swiss Franc',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
  JPY: 'Japanese Yen',
};

export function DisplaySettingsScreen(_props: Props): React.JSX.Element {
  const { settings, updateSettings } = useWallets();

  return (
    <Screen scroll style={styles.content}>
      <Card style={styles.group}>
        <Text style={styles.groupTitle}>Theme</Text>
        <SegmentedControl
          options={[
            { value: 'system' as const, label: 'System' },
            { value: 'light' as const, label: 'Light' },
            { value: 'dark' as const, label: 'Dark' },
          ]}
          value={settings.themeMode ?? 'system'}
          onChange={(m) => updateSettings({ themeMode: m })}
        />
      </Card>

      <Card style={styles.group}>
        <Text style={styles.groupTitle}>Home screen</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.currencyCode}>Bitcoin price chart</Text>
            <Text style={styles.currencyName}>
              Long-press the chart on Home to remove it; re-enable it here.
            </Text>
          </View>
          <Switch
            value={settings.showHomeChart !== false}
            onValueChange={(v) => updateSettings({ showHomeChart: v })}
            trackColor={{ true: theme.colors.accent, false: theme.colors.switchOff }}
        ios_backgroundColor={theme.colors.switchOff}
            thumbColor={theme.colors.switchThumb}
          />
        </View>
      </Card>

      <Card style={styles.group}>
        <Text style={styles.groupTitle}>Units</Text>
        <SegmentedControl
          options={UNIT_OPTIONS}
          value={settings.unit}
          onChange={(unit) => updateSettings({ unit })}
        />
        <Text style={styles.hint}>
          {settings.unit === 'auto'
            ? 'Large amounts in bitcoin, small ones in satoshis. Switches at 0.1 BTC.'
            : settings.unit === 'btc'
              ? 'Amounts shown in bitcoin (0.0015 BTC).'
              : 'Amounts shown in satoshis (150,000 sats).'}
        </Text>
      </Card>

      <Card style={styles.group}>
        <Text style={styles.groupTitle}>
          Fiat currency
        </Text>
        <TouchableOpacity
          style={styles.currencyRow}
          onPress={() => updateSettings({ btcOnly: true })}
          activeOpacity={0.8}>
          <View>
            <Text style={styles.currencyCode}>Bitcoin Only</Text>
            <Text style={styles.currencyName}>Amounts in BTC and sats only</Text>
          </View>
          <RadioMark on={!!settings.btcOnly} />
        </TouchableOpacity>
        {FIAT_CURRENCIES.map((c) => (
          <View key={c}>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.currencyRow}
              onPress={() => updateSettings({ fiat: c, btcOnly: false })}
              activeOpacity={0.8}>
              <View>
                <Text style={styles.currencyCode}>{c}</Text>
                <Text style={styles.currencyName}>{CURRENCY_NAMES[c]}</Text>
              </View>
              <RadioMark on={!settings.btcOnly && settings.fiat === c} />
            </TouchableOpacity>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  content: { gap: theme.spacing.lg },
  group: { gap: theme.spacing.sm },
  groupTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  hint: { ...theme.typography.caption, color: theme.colors.slate },
  divider: { height: 1, backgroundColor: theme.colors.hairline },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  switchText: { flex: 1, minWidth: 0 },
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.spacing.md,
  },
  currencyCode: { ...theme.typography.body, color: theme.colors.offWhite },
  currencyName: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 1 },
}));
