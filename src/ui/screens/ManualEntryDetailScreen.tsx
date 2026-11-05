/**
 * One portfolio entry's page (decided 2026-10-22, a client's request: "the
 * user should be able to open each entry and see all the details", like a
 * transaction on a vault).
 *
 * Built like the transaction page (`TxDetailScreen`): the kind and the day
 * beside the back button, the amount as the hero with its money under it,
 * then a Details card listing every fact the entry holds. The price per
 * bitcoin AND the total are both shown, whichever the client typed: the
 * other is worked out (`wallet/entryDetails.ts` `entryMoney`), and the total
 * stays the number every figure in the app reads.
 *
 * Changing the entry is the owner's: Edit, pinned at the foot, opens the
 * entry form, where it can also be removed. A member of a shared portfolio
 * reads the same page with no Edit (`isSharedViewer`, the one rule).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VirtualStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import { Button, Card, FACT_LABEL_SHARE, FitText, HeaderBackButton, Screen, factsStacked } from '../components';
import {
  convertFiatOnDate,
  displayNote,
  entryMoney,
  entryOrigin,
  entrySourceName,
  formatAmount,
  formatFiatValue,
  isSharedViewer,
  loadManualEntries,
  originVaultName,
  originWords,
  peekManualEntries,
  useWallets,
} from '../../wallet';
import type { ManualEntry } from '../../wallet';

type Props = NativeStackScreenProps<VirtualStackParamList, 'ManualEntryDetail'>;

/** What a fact the entry does not hold reads. */
const NOT_RECORDED = 'Not recorded';

export function ManualEntryDetailScreen({ route, navigation }: Props): React.JSX.Element {
  const { walletId, entryId } = route.params;
  const { getWallet, wallets, settings } = useWallets();
  const wallet = getWallet(walletId);
  // Paints at once from the portfolio's last known entries, then reads the
  // store; again on every return (after Edit) and whenever a sync or a
  // shared portfolio's round stamps the portfolio.
  const [entries, setEntries] = useState<ManualEntry[] | null>(() => peekManualEntries(walletId) ?? null);
  const reload = useCallback(() => {
    let cancelled = false;
    void loadManualEntries(walletId).then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [walletId]);
  useFocusEffect(reload);
  const stamp = wallet?.manualUpdatedAt;
  const seenStamp = useRef(stamp);
  useEffect(() => {
    if (stamp === seenStamp.current) return;
    seenStamp.current = stamp;
    return reload();
  }, [stamp, reload]);

  const entry = entries?.find((e) => e.id === entryId);
  const money = entry ? entryMoney(entry) : undefined;

  // An entry in another currency also reads in the display currency, at the
  // rate of its own day (never today's), as the portfolio's rows do.
  const [converted, setConverted] = useState<{ key: string; value: number } | null>(null);
  const convertKey = entry && money?.total != null && money.currency ? `${entry.id}:${money.total}:${money.currency}:${settings.fiat}:${entry.date}` : null;
  useEffect(() => {
    if (!entry || !convertKey || money?.total == null || !money.currency || money.currency === settings.fiat || settings.btcOnly) return;
    let cancelled = false;
    void convertFiatOnDate(money.total, money.currency, settings.fiat, entry.date / 1000)
      .then((v) => {
        if (!cancelled && v != null) setConverted({ key: convertKey, value: v });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // The key holds everything the conversion reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convertKey]);

  if (!wallet || !entry || !money) {
    return (
      <Screen style={styles.content}>
        <View style={styles.headRow}>
          <HeaderBackButton />
        </View>
        <Text style={styles.muted}>
          {!wallet ? 'Portfolio not found.' : entries == null ? 'Loading…' : 'This entry is no longer in this portfolio.'}
        </Text>
      </Screen>
    );
  }

  const viewer = isSharedViewer(wallet);
  // Hidden on the portfolio: hidden here too, as on a transaction's page.
  const masked = settings.hideBalances || !!wallet.balanceHidden;
  const buy = entry.kind === 'buy';
  const kindWord = buy ? 'Bought' : 'Sold';
  const day = longDay(entry.date);
  const showMoney = !settings.btcOnly;
  const currency = money.currency;
  const fiat = (n: number | undefined): string =>
    n == null || !currency ? NOT_RECORDED : masked ? '••••' : formatFiatValue(n, currency);
  const origin = entryOrigin(entry);
  const source = entrySourceName(entry);
  const convertedValue = converted && converted.key === convertKey ? converted.value : null;

  return (
    <Screen
      scroll
      style={styles.content}
      footer={
        viewer ? undefined : (
          <Button title="Edit" onPress={() => navigation.navigate('ManualEntry', { walletId, entryId })} />
        )
      }>
      {/* The transaction page's head: the kind and the day beside the back
          button, which leaves the whole width to the amount below. The day
          wraps at a space rather than cut at large text (decided
          2026-10-22), as on the transaction page. */}
      <View style={styles.headRow}>
        <HeaderBackButton />
        <View style={styles.headText}>
          <Text style={styles.kicker} numberOfLines={1}>
            {kindWord}
          </Text>
          <Text style={styles.when}>{day}</Text>
        </View>
      </View>

      <View style={styles.amountBlock}>
        <FitText style={[styles.amount, { color: buy ? theme.colors.positive : theme.colors.offWhite }]}>
          {masked ? '•••••' : `${buy ? '+' : '−'}${formatAmount(entry.amountSats, settings.unit)}`}
        </FitText>
        {showMoney && money.total != null && currency && (
          <Text style={styles.money}>{fiat(money.total)}</Text>
        )}
      </View>

      <Card style={styles.details}>
        <View style={styles.detailHeaderRow}>
          <Text style={styles.detailTitle}>Details</Text>
        </View>
        <DetailRow label="Type" value={kindWord} />
        <DetailRow label="Date" value={day} />
        <DetailRow label="Amount" value={masked ? '••••' : formatAmount(entry.amountSats, settings.unit)} />
        {showMoney && (
          <>
            {/* Hidden with the other money: with the amount it gives the
                total away, and the portfolio hides its average price too. */}
            <DetailRow label="Price per bitcoin" value={fiat(money.pricePerBtc)} quiet={money.pricePerBtc == null} />
            {money.fee != null && <DetailRow label="Fee" value={fiat(money.fee)} />}
            <DetailRow
              label={buy ? 'Total paid' : 'Total received'}
              value={fiat(money.total)}
              quiet={money.total == null}
            />
            {convertedValue != null && (
              <DetailRow label={`In ${settings.fiat}`} value={masked ? '••••' : `≈${formatFiatValue(convertedValue, settings.fiat)}`} />
            )}
          </>
        )}
        <DetailRow label="Source" value={source ?? NOT_RECORDED} quiet={source == null} />
        <DetailRow label="Added" value={originWords(origin, originVaultName(origin, wallets))} />
        {entry.note ? (
          <View style={styles.noteBlock}>
            <Text style={styles.noteLabel}>Note</Text>
            <Text style={styles.noteText}>{displayNote(entry.note)}</Text>
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}

/** "12 March 2026": an entry has a day, not a time. */
function longDay(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * One fact: the label, and its value at the right; when both do not fit on
 * one line (large text, a narrow screen) the value moves under the label as
 * a whole, still at the right, never cut and never broken inside a word. The
 * label takes at most FACT_LABEL_SHARE of the row beside a value. The
 * portfolio page's summary rows follow the same rule.
 */
function DetailRow({ label, value, quiet }: { label: string; value: string; quiet?: boolean }): React.JSX.Element {
  // At the accessibility text sizes the value goes under its label, each
  // with the whole width (factsStacked).
  const stacked = factsStacked(useWindowDimensions().fontScale);
  return (
    <View style={[styles.row, stacked && styles.rowStacked]}>
      <Text style={[styles.rowLabel, stacked && styles.rowLabelStacked]}>{label}</Text>
      <Text style={[styles.rowValue, quiet && styles.rowQuiet, stacked && styles.rowValueStacked]}>{value}</Text>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    muted: { ...theme.typography.body, color: theme.colors.slate },
    content: { gap: theme.spacing.lg },

    // The transaction page's head, to the same measures.
    headRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    headText: { flex: 1, minWidth: 0 },
    kicker: { ...theme.typography.screenTitle, color: theme.colors.offWhite },
    when: { ...theme.typography.screenSubtitle, color: theme.colors.slate, marginTop: 1 },

    amountBlock: { gap: theme.spacing.xs, marginTop: theme.spacing.xl },
    // The one hero size (decided 2026-09-12).
    amount: { ...theme.typography.hero },
    // The line under a figure, as every page draws it.
    money: { ...theme.typography.heroCaption, color: theme.colors.slate },

    details: { gap: theme.spacing.md, overflow: 'hidden' },
    // The transaction page's band: bleeds to the card's edges.
    detailHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surfaceRaised,
      marginHorizontal: -theme.spacing.lg,
      marginTop: -theme.spacing.lg,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderBottomWidth: 1,
      borderColor: theme.colors.hairline,
    },
    detailTitle: { ...theme.typography.heading, color: theme.colors.offWhite },

    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      columnGap: theme.spacing.md,
      rowGap: 2,
    },
    rowLabel: { ...theme.typography.body, color: theme.colors.slate, flexShrink: 1, maxWidth: FACT_LABEL_SHARE },
    // marginLeft auto: at the right edge on whichever line it lands.
    rowValue: { ...theme.typography.body, color: theme.colors.offWhite, flexShrink: 1, maxWidth: '100%', marginLeft: 'auto', textAlign: 'right' },
    // The note's label stands alone over the note.
    noteLabel: { ...theme.typography.body, color: theme.colors.slate },
    rowQuiet: { color: theme.colors.faint },
    rowStacked: { flexDirection: 'column' },
    rowLabelStacked: { maxWidth: '100%' },
    rowValueStacked: { marginLeft: 0, textAlign: 'left' },

    noteBlock: { gap: theme.spacing.xs },
    noteText: { ...theme.typography.body, color: theme.colors.offWhite },
  }),
);
