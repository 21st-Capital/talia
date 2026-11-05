/**
 * Create a statement (decided 2026-08-28, after comparing Talia's export to how a
 * bank does it).
 *
 * The old export asked one question in a dialog and produced whatever the
 * vault held. A statement is a document about a PERIOD, so the questions a
 * bank asks are asked here: which period, which file, how to show the refresh
 * fees, and which language the document should speak.
 *
 * Nothing is generated until Generate is pressed, and the screen says what
 * the chosen period actually contains before the file is made, because an
 * empty statement is a confusing thing to receive by email.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
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
  buildStatementCsv,
  buildStatementDocument,
  presetPeriod,
  statementData,
  todayIso,
  useWallets,
  loadTxCache,
  getAllTxNotes,
  type PeriodPreset,
  type StatementLang,
  type StatementPeriod,
} from '../../wallet';
import { exportBase64ToFile, exportTextToFile } from '../../platform/files';
import { base64 as b64codec } from '@scure/base';
import { minOlderBlocks, parsePolicy, pathRequirement } from '../../bitcoin/descriptor';
import { NETWORK_LABELS } from '../../bitcoin/network';
import type { WalletTx } from '../../bitcoin/engine/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Statement'>;

type FileFormat = 'pdf' | 'csv';
/** How the day's refresh churn is presented. */
type FeeStyle = 'each' | 'daily';

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
  return label.replace(/[^\w-]+/g, '-').toLowerCase() || 'vault';
}

/** The signing rule in one short phrase, for the statement's identity block. */
function policyLabel(descriptor: string, lang: StatementLang): string {
  try {
    const policy = parsePolicy(descriptor);
    const primary = policy.paths[0];
    if (!primary) return lang === 'de' ? 'Unbekannt' : 'Unknown';
    const { needed, keys } = pathRequirement(primary);
    const recoveries = policy.paths.length - 1;
    const base =
      keys.length <= 1
        ? lang === 'de'
          ? 'Ein Schlüssel'
          : 'Single key'
        : lang === 'de'
          ? `${needed} von ${keys.length} Schlüsseln`
          : `${needed} of ${keys.length} keys`;
    if (recoveries <= 0) return base;
    const tail =
      lang === 'de'
        ? `${recoveries} ${recoveries === 1 ? 'Wiederherstellungspfad' : 'Wiederherstellungspfade'}`
        : `${recoveries} recovery ${recoveries === 1 ? 'path' : 'paths'}`;
    return `${base}, ${tail}`;
  } catch {
    return lang === 'de' ? 'Unbekannt' : 'Unknown';
  }
}

export function StatementScreen({ route }: Props): React.JSX.Element {
  const { walletId } = route.params;
  const { getWallet } = useWallets();
  const wallet = getWallet(walletId);

  const today = useMemo(() => todayIso(), []);
  const [preset, setPreset] = useState<PeriodPreset | 'custom'>('all');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [format, setFormat] = useState<FileFormat>('pdf');
  const [feeStyle, setFeeStyle] = useState<FeeStyle>('daily');
  const [lang, setLang] = useState<StatementLang>('en');
  const [txs, setTxs] = useState<WalletTx[] | null>(null);
  const [historyRead, setHistoryRead] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Only a vault with a clock has refreshes (decided 2026-09-22): elsewhere a
  // send to itself is "Sent", as on the vault page, and the Refresh fees
  // choice has nothing to choose about.
  const timelocked = wallet != null && minOlderBlocks(wallet.descriptor) != null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await loadTxCache(walletId);
      const stored = await getAllTxNotes(walletId);
      if (cancelled) return;
      // null means this phone has never stored this vault's history, which
      // is NOT the same as a vault with no transactions (decided 2026-08-28
      // review): collapsing the two produced a statement claiming a zero
      // balance for a funded vault.
      setTxs(cached);
      setNotes(stored);
      setHistoryRead(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletId]);

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

  const preview = useMemo(() => {
    if (!txs) return null;
    return statementData({
      vaultName: wallet?.label ?? '',
      policy: '',
      network: '',
      txs,
      notes,
      period,
      today,
      generatedOn: today,
      lang,
      foldRefreshDays: feeStyle === 'daily',
      timelocked,
    });
  }, [txs, notes, period, today, lang, feeStyle, timelocked, wallet?.label]);

  const generate = (): void => {
    if (!wallet || !txs || invalidRange) return;
    setBusy(true);
    const input = {
      vaultName: wallet.label,
      policy: policyLabel(wallet.descriptor, lang),
      network: NETWORK_LABELS[wallet.network] ?? wallet.network,
      // Only a vault holding a 21st Capital key has an account with us; a
      // purely self-custodial one prints no such line (decided 2026-08-28).
      accountNumber: wallet.accountNumber != null ? String(wallet.accountNumber) : undefined,
      txs,
      notes,
      period,
      today,
      generatedOn: today,
      lang,
      foldRefreshDays: feeStyle === 'daily',
      timelocked,
    };
    const name = `${slugName(wallet.label)}-statement-${start || 'start'}-${end || today}`;
    void (async () => {
      try {
        if (format === 'pdf') {
          const pdf = buildStatementDocument(input);
          await exportBase64ToFile(`${name}.pdf`, b64codec.encode(pdf), 'application/pdf');
        } else {
          await exportTextToFile(`${name}.csv`, buildStatementCsv(input));
        }
      } catch {
        // Cancelled at the share sheet, or the file could not be written.
        // Either way there is nothing to report and nothing was sent.
      } finally {
        setBusy(false);
      }
    })();
  };

  if (!wallet) {
    return (
      <Screen>
        <Text style={styles.body}>This vault is no longer here.</Text>
      </Screen>
    );
  }

  const countLine = ((): string => {
    if (!historyRead || !preview) return 'Reading this vault’s history…';
    if (preview.count === 0) return 'No transactions in this period.';
    const n = preview.count;
    return `${n} transaction${n === 1 ? '' : 's'} in this period.`;
  })();

  /**
   * A statement is only as complete as the history behind it. Add every
   * transaction up and the total MUST be what the vault holds; if it is not,
   * the stored history is missing something and every balance on the document
   * would be wrong. Say so rather than hand over a wrong document.
   */
  const historyGap = ((): boolean => {
    if (!historyRead) return false;
    // Nothing stored at all: the vault has never been synced on this phone.
    if (txs == null) return true;
    if (wallet.cachedBalanceSats == null) return false;
    const total = txs.reduce((sum, t) => sum + t.netAmount, 0);
    return total !== wallet.cachedBalanceSats;
  })();

  return (
    <Screen
      scroll
      footer={
        <Button
          title={busy ? 'Preparing…' : 'Generate'}
          onPress={generate}
          disabled={busy || !txs || invalidRange || historyGap}
          loading={busy}
        />
      }>
      <InfoHeading
        style={[styles.heading, styles.headingSolo]}
        title="Statement period"
        text={
          'The statement covers the days you pick, and opens with the balance the vault already held on the first day. Coins that arrived earlier are not lost: they are the opening balance.\n\nA period that ends today also includes transactions that have not confirmed yet.'
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
            ? 'Every transaction this vault has ever had.'
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

      {timelocked && (
        <>
          <InfoHeading
            style={[styles.heading, styles.headingSolo]}
            title="Refresh fees"
            text={
              // The refresh sentence in timelockNotice.ts's words: a coin's
              // clock starts again once its transaction confirms.
              'A refresh moves coins to new addresses of the same vault. Only the network fee leaves the vault. Each coin\u2019s clock starts again once its transaction confirms.\n\nA vault that refreshes often can produce dozens of these lines a day, so by default each day is shown as a single line with the fees added up. Choose the other option when your accountant wants every one.'
            }>
            Refresh fees
          </InfoHeading>
          <Card style={styles.card}>
            <SegmentedControl
              options={[
                { value: 'daily', label: 'One line per day' },
                { value: 'each', label: 'Every refresh' },
              ]}
              value={feeStyle}
              onChange={setFeeStyle}
            />
          </Card>
        </>
      )}

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
      {historyGap && (
        <InfoHeading
          style={[styles.warn, styles.gapText]}
          title="Missing history"
          text={
            'Every transaction added together should equal what the vault holds today. Here it does not, which means this phone has not stored the whole history yet.\n\nA sync fetches it again. Until then a statement would show balances that do not match your vault, so Generate stays switched off.'
          }>
          Some of this vault’s history is missing, so the balances would be wrong. Open the vault
          and pull down to sync, then come back.
        </InfoHeading>
      )}
    </Screen>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    heading: {
      ...theme.typography.heading,
      color: theme.colors.offWhite,
    },
    headingSolo: {
      marginTop: theme.spacing.lg,
      marginBottom: theme.spacing.sm,
    },
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
    hint: { ...theme.typography.caption, color: theme.colors.slate },
    warn: { ...theme.typography.caption, color: theme.colors.negative, flexShrink: 1 },
    gapText: { marginBottom: theme.spacing.md },
    count: {
      ...theme.typography.body,
      color: theme.colors.slate,
      marginTop: theme.spacing.lg,
      marginBottom: theme.spacing.sm,
    },
    body: { ...theme.typography.body, color: theme.colors.offWhite },
  }),
);
