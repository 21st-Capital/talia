/**
 * Create a portfolio statement (decided 2026-08-28: "the same export functionality
 * we built for the vaults, also for the portfolios").
 *
 * Deliberately the same screen as a vault's, minus the one question a
 * portfolio cannot answer: there are no refresh fees in a hand-kept ledger.
 * Period, file type, language, then Generate.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { VirtualStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import {
  Button,
  Card,
  DatePickerField,
  InfoHeading,
  Screen,
  SegmentedControl,
  formatIsoDate,
} from '../components';
import {
  buildPortfolioStatementCsv,
  buildPortfolioStatementDocument,
  loadManualEntries,
  portfolioStatementData,
  presetPeriod,
  todayIso,
  useWallets,
  type ManualEntry,
  type PeriodPreset,
  type StatementLang,
  type StatementPeriod,
} from '../../wallet';
import { useEntryFx } from '../hooks/useEntryFx';
import { exportBase64ToFile, exportTextToFile } from '../../platform/files';
import { base64 as b64codec } from '@scure/base';

type Props = NativeStackScreenProps<VirtualStackParamList, 'PortfolioStatement'>;

type FileFormat = 'pdf' | 'csv';

const PRESETS: Array<{ value: PeriodPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'lastQuarter', label: 'Last quarter' },
  { value: 'lastYear', label: 'Last year' },
  { value: 'all', label: 'All time' },
];

/** A filename that survives every filesystem. */
function slugName(label: string): string {
  return label.replace(/[^\w-]+/g, '-').toLowerCase() || 'portfolio';
}

export function PortfolioStatementScreen({ route }: Props): React.JSX.Element {
  const { walletId } = route.params;
  const { getWallet, settings } = useWallets();
  const wallet = getWallet(walletId);

  const today = useMemo(() => todayIso(), []);
  const [preset, setPreset] = useState<PeriodPreset | 'custom'>('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [format, setFormat] = useState<FileFormat>('pdf');
  const [lang, setLang] = useState<StatementLang>('en');
  const [entries, setEntries] = useState<ManualEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Reload on focus: an entry added on the screen behind this one must be in
  // the statement.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadManualEntries(walletId).then((loaded) => {
        if (!cancelled) setEntries(loaded);
      });
      return () => {
        cancelled = true;
      };
    }, [walletId]),
  );

  const fx = useEntryFx(entries ?? [], settings.fiat);

  /** Choosing a preset fills the two date fields, so the window is always
   *  visible: nobody should have to trust a chip. */
  const choosePreset = (p: PeriodPreset): void => {
    setPreset(p);
    const window = presetPeriod(p, today);
    setStart(window.start);
    setEnd(window.end);
  };

  const period: StatementPeriod = useMemo(() => ({ start, end }), [start, end]);
  const invalidRange = !!start && !!end && start > end;

  const input = useMemo(
    () => ({
      portfolioName: wallet?.label ?? '',
      entries: entries ?? [],
      currency: settings.fiat,
      fx,
      period,
      today,
      generatedOn: today,
      lang,
    }),
    [wallet?.label, entries, settings.fiat, fx, period, today, lang],
  );

  const preview = useMemo(
    () => (entries ? portfolioStatementData(input) : null),
    [entries, input],
  );

  const generate = (): void => {
    if (!wallet || !entries || invalidRange) return;
    setBusy(true);
    const name = `${slugName(wallet.label)}-statement-${start || 'start'}-${end || today}`;
    void (async () => {
      try {
        if (format === 'pdf') {
          const pdf = buildPortfolioStatementDocument(input);
          await exportBase64ToFile(`${name}.pdf`, b64codec.encode(pdf), 'application/pdf');
        } else {
          await exportTextToFile(`${name}.csv`, buildPortfolioStatementCsv(input));
        }
      } catch {
        // Cancelled at the share sheet, or the file could not be written.
      } finally {
        setBusy(false);
      }
    })();
  };

  if (!wallet) {
    return (
      <Screen>
        <Text style={styles.hint}>This portfolio is no longer here.</Text>
      </Screen>
    );
  }

  const countLine = ((): string => {
    if (!preview) return 'Reading this portfolio…';
    if (preview.count === 0) return 'No entries in this period.';
    const n = preview.count;
    return `${n} ${n === 1 ? 'entry' : 'entries'} in this period.`;
  })();

  return (
    <Screen
      scroll
      footer={
        <Button
          title={busy ? 'Preparing…' : 'Generate'}
          onPress={generate}
          disabled={busy || !entries || invalidRange}
          loading={busy}
        />
      }>
      <InfoHeading
        style={[styles.heading, styles.headingSolo]}
        title="Statement period"
        text={
          'The statement covers the days you pick, and opens with what the portfolio already held on the first day. Coins bought earlier are not lost: they are the opening balance.'
        }>
        Statement period
      </InfoHeading>
      <Card style={styles.card}>
        <View style={styles.chips}>
          {PRESETS.map((p) => {
            const active = preset === p.value;
            return (
              <TouchableOpacity
                key={p.value}
                onPress={() => choosePreset(p.value)}
                activeOpacity={0.8}
                style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <DatePickerField
          label="Start date"
          value={start}
          onChange={(iso) => {
            setStart(iso);
            setPreset('custom');
          }}
          minYear={2009}
          disallowFuture
        />
        <DatePickerField
          label="End date"
          value={end}
          onChange={(iso) => {
            setEnd(iso);
            setPreset('custom');
          }}
          minYear={2009}
          disallowFuture
        />
        <Text style={styles.hint}>
          {!start && !end
            ? 'Every entry this portfolio has ever had.'
            : `${start ? formatIsoDate(start) : 'the beginning'} to ${end ? formatIsoDate(end) : 'today'}`}
        </Text>
        {invalidRange && <Text style={styles.warn}>The start date is after the end date.</Text>}
      </Card>

      <Text style={[styles.heading, styles.headingSolo]}>File type</Text>
      <Card style={styles.card}>
        <SegmentedControl
          options={[
            { value: 'pdf', label: 'PDF' },
            { value: 'csv', label: 'CSV (spreadsheet)' },
          ]}
          value={format}
          onChange={setFormat}
        />
      </Card>

      <Text style={[styles.heading, styles.headingSolo]}>Language</Text>
      <Card style={styles.card}>
        <SegmentedControl
          options={[
            { value: 'en', label: 'English' },
            { value: 'de', label: 'Deutsch' },
          ]}
          value={lang}
          onChange={setLang}
        />
        <Text style={styles.hint}>The document, not the app.</Text>
      </Card>

      <Text style={styles.count}>{countLine}</Text>
      {!!preview?.unconverted && (
        <InfoHeading
          style={[styles.hint, styles.gapText]}
          title="Another currency"
          text={
            'An entry keeps the currency you recorded it in. To add it to a total in another currency, Talia converts it at the rate of the day it happened, never today’s rate.\n\nWhen that day’s rate cannot be fetched, the entry is left out of the money totals and the statement says so, rather than showing a figure that was guessed.'
          }>
          {preview.unconverted} {preview.unconverted === 1 ? 'entry is' : 'entries are'} in
          another currency and could not be converted, so {preview.unconverted === 1 ? 'it is' : 'they are'}{' '}
          left out of the {settings.fiat} totals. The coins are still counted.
        </InfoHeading>
      )}
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    heading: { ...theme.typography.heading, color: theme.colors.offWhite },
    headingSolo: { marginTop: theme.spacing.lg, marginBottom: theme.spacing.sm },
    card: { gap: theme.spacing.md, marginTop: theme.spacing.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
    chip: {
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      borderWidth: 1,
      borderColor: theme.colors.hairline,
    },
    chipActive: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    chipText: { ...theme.typography.body, color: theme.colors.offWhite },
    chipTextActive: { ...theme.typography.bodyStrong, color: theme.colors.accentInk },
    hint: { ...theme.typography.caption, color: theme.colors.slate, flexShrink: 1 },
    warn: { ...theme.typography.caption, color: theme.colors.negative, flexShrink: 1 },
    gapText: { marginBottom: theme.spacing.md },
    count: {
      ...theme.typography.body,
      color: theme.colors.slate,
      marginTop: theme.spacing.lg,
      marginBottom: theme.spacing.sm,
    },
  }),
);
