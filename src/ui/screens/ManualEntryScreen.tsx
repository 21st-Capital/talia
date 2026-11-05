/**
 * Add — or correct — one buy/sell in a manual wallet.
 *
 * Correcting matters more here than anywhere else in the app: these numbers
 * come from a person's memory and a receipt, not from a chain, so every entry
 * stays editable and removable for as long as the wallet exists.
 *
 * The price paid is OPTIONAL by design (decided 2026-08-25). Someone who just wants
 * a running balance should never be blocked by a field they don't care about,
 * and a guessed price is worse than none — it would quietly skew the average
 * cost of everything else.
 *
 * Three money fields since 2026-09-07 (decided after the single "Total
 * received" field misled in a phone test: selling 0.25 BTC at 79,500, the
 * price was typed, the app stored it as the total, and the portfolio claimed
 * $79,500 received). The user types whichever number they know — the price per
 * bitcoin or what the coins came to — and the other fills in; the fee is added
 * on a buy and taken off on a sell; the resulting total is shown before it is
 * saved. The entry STORES the total (`fiatAmount`) exactly as before, so the
 * ledger arithmetic is untouched, plus the fee (`feeAmount`, decided 2026-09-07) so
 * that reopening shows the fee and the true price. See
 * wallet/manualEntryPricing.ts.
 *
 * Since 2026-10-22 an entry whose PRICE was typed also keeps that price
 * (`pricePerBtc`) beside the total it produced, so it reopens on the price
 * the client typed rather than one worked back from a rounded total; an
 * entry whose amount was typed reopens on the amount, as before. It also
 * records where the bitcoin was bought or sold (`source`, picked on the
 * EntrySource screen). Reached from the entry's own page (Edit) or from
 * the portfolio (Add a buy or sell).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VirtualStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import { AppDialog, Button, ChevronRightIcon, DatePickerField, InfoHeading, Screen, SegmentedControl, TextField } from '../components';
import {
  isSharedViewer,
  displayNote,
  entryFormMoney,
  entryFormOpening,
  entrySourceFields,
  entrySourceName,
  formatMoney,
  plainNumber,
  sourceFieldsToStore,
  fiatDecimals,
  fiatSymbol,
  loadManualEntries,
  manualEntryError,
  newManualEntryId,
  parseAmountToSats,
  parseFiatAmount,
  saveManualEntries,
  useWallets,
} from '../../wallet';
import type { EntrySourceFields, ManualEntry, ManualEntryKind, MoneyAnchor } from '../../wallet';
import { recordEntryTombstone } from '../../services/virtualVaultSync';

type Props = NativeStackScreenProps<VirtualStackParamList, 'ManualEntry'>;
type AmountUnitChoice = 'btc' | 'sats';

export function ManualEntryScreen({ route, navigation }: Props): React.JSX.Element {
  const { walletId, entryId } = route.params;
  const { settings, touchManualVault, getWallet } = useWallets();

  const [entries, setEntries] = useState<ManualEntry[] | null>(null);
  const [kind, setKind] = useState<ManualEntryKind>('buy');
  const [unit, setUnit] = useState<AmountUnitChoice>('btc');
  const [amount, setAmount] = useState('');
  /** Price per bitcoin, as typed. Only authoritative while `anchor` is 'price'. */
  const [price, setPrice] = useState('');
  /** What the coins came to before any fee, as typed. Authoritative while
   *  `anchor` is 'coins'; an existing entry opens anchored here, on its total. */
  const [coins, setCoins] = useState('');
  const [fee, setFee] = useState('');
  const [anchor, setAnchor] = useState<MoneyAnchor>('price');
  const [note, setNote] = useState('');
  /** Where the bitcoin was bought or sold: the stored pair, or nothing. */
  const [source, setSource] = useState<EntrySourceFields>({});
  const [dateText, setDateText] = useState(todayIso());
  /** The currency this entry's price is IN. A new entry uses the display
   *  currency; an EXISTING entry keeps the currency of its receipt — the
   *  original build re-stamped it to the display currency on every save, so
   *  opening a $30,000 entry under EUR just to add a note silently turned it
   *  into €30,000 (caught in the 2026-08-25 adversarial review). */
  const [entryCurrency, setEntryCurrency] = useState(settings.fiat);
  const [error, setError] = useState<string | undefined>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load once; prefill when editing.
  React.useEffect(() => {
    let cancelled = false;
    void loadManualEntries(walletId).then((loaded) => {
      if (cancelled) return;
      setEntries(loaded);
      const existing = entryId ? loaded.find((e) => e.id === entryId) : undefined;
      if (existing) {
        setKind(existing.kind);
        setUnit('btc');
        setAmount(satsToBtcText(existing.amountSats));
        // The total on file already holds the fee, so the fee comes back out
        // of it: the coin value is what the coins came to before the fee and
        // the price derives from THAT; an entry whose price was typed reopens
        // on that price. An entry from before fees were kept opens with the
        // fee empty and its total as the coin value. Either way, saving
        // unchanged stores the same total (`entryFormOpening`, the same
        // reading the entry's page shows). A fee that contradicts its total
        // is ignored rather than trusted (`usableFee`).
        const opening = entryFormOpening(existing);
        setAnchor(opening.anchor);
        setPrice(opening.price);
        setCoins(opening.coins);
        setFee(opening.fee);
        if (existing.fiatCurrency) setEntryCurrency(existing.fiatCurrency);
        setNote(displayNote(existing.note) ?? '');
        // The source the entry's page shows: the stored one, or for an
        // exchange-sync trade from before sources, that exchange.
        setSource(entrySourceFields(existing));
        setDateText(isoFromMs(existing.date));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [walletId, entryId]);

  // The source list's answer (EntrySource hands it back through the route).
  const picked = route.params.picked;
  useEffect(() => {
    if (!picked) return;
    setSource(picked.source ? { source: picked.source, sourceName: picked.sourceName } : {});
    // `at` is a new number for every pick, the same source picked twice too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.at]);
  const sourceShown = source.source ? entrySourceName({ id: '', ...source }) : undefined;

  /** The ledger this entry is validated against — itself excluded when editing,
   *  or correcting a sell downward would be judged against its own old value. */
  const others = useMemo(
    () => (entries ?? []).filter((e) => e.id !== entryId),
    [entries, entryId],
  );

  /**
   * The money side, derived rather than stored: the field the user did NOT
   * type last is computed from the one they did, and the total from both plus
   * the fee (`entryFormMoney`, which also says what the entry stores).
   * Recomputes on every keystroke and on any amount or buy/sell change, so
   * what is on screen is always what would be saved.
   */
  const money = useMemo(() => {
    const decimals = fiatDecimals(entryCurrency);
    const computed = entryFormMoney({
      kind,
      amountSats: parseAmountToSats(amount, unit),
      anchor,
      price: parseFiatAmount(price),
      coins: parseFiatAmount(coins),
      fee: fee.trim() === '' ? 0 : parseFiatAmount(fee),
      currency: entryCurrency,
    });
    const priceText =
      anchor === 'price' ? price : computed.pricePerBtc != null ? plainNumber(computed.pricePerBtc) : '';
    const coinsText =
      anchor === 'coins' ? coins : computed.coinsValue != null ? computed.coinsValue.toFixed(decimals) : '';
    return {
      priceText,
      coinsText,
      coinsValue: computed.coinsValue,
      feeValue: computed.fee,
      total: computed.total,
      stored: computed.stored,
      decimals,
    };
  }, [amount, unit, price, coins, fee, anchor, kind, entryCurrency]);

  const paidWord = kind === 'buy' ? 'paid' : 'received';
  const symbol = fiatSymbol(entryCurrency);
  /** "0.00", or "0" for a currency with no decimals. */
  const zeroPlaceholder = `${symbol}${(0).toFixed(money.decimals)}`;

  const save = async (): Promise<void> => {
    setError(undefined);
    const amountSats = parseAmountToSats(amount, unit);
    if (amountSats == null) {
      setError(
        unit === 'btc'
          ? 'Enter an amount in bitcoin, for example 0.25.'
          : 'Enter a whole number of satoshis.',
      );
      return;
    }
    const validation = manualEntryError(others, { kind, amountSats });
    if (validation) {
      setError(validation);
      return;
    }
    const date = msFromIso(dateText);
    if (date == null) {
      setError('Choose a date.');
      return;
    }
    // Every money field is optional, but a typed one has to be readable:
    // an unreadable price silently recorded as nothing would drag the
    // average cost basis without a trace.
    if (anchor === 'price' && price.trim() !== '' && parseFiatAmount(price) == null) {
      setError('That price is not a number. Leave it empty if you would rather not record it.');
      return;
    }
    if (anchor === 'coins' && coins.trim() !== '' && parseFiatAmount(coins) == null) {
      setError(
        `That amount is not a number. Leave it empty if you would rather not record what was ${kind === 'buy' ? 'paid' : 'received'}.`,
      );
      return;
    }
    if (fee.trim() !== '' && money.feeValue == null) {
      setError('That fee is not a number. Leave it empty if there was none.');
      return;
    }
    if (money.coinsValue == null && money.feeValue != null && money.feeValue > 0) {
      setError(`Add the price or what you ${paidWord}, or clear the fee.`);
      return;
    }
    // The fee is remembered beside the total it is already inside of, so the
    // entry reopens showing it; nothing downstream reads it. The price, when
    // it was the number typed, is kept beside the total it produced (decided
    // 2026-10-22), so the entry reopens on it. Neither when the fee swallowed
    // a sell (total held at zero): that fee is NOT inside the total, and the
    // total did not come from the price (`entryFormMoney`).
    const { fiatAmount, feeAmount, pricePerBtc } = money.stored;

    const id = entryId ?? newManualEntryId();
    const trimmedNote = note.trim() || undefined;
    const entry: ManualEntry = {
      id,
      kind,
      amountSats,
      date,
      fiatAmount,
      fiatCurrency: fiatAmount != null ? entryCurrency : undefined,
      feeAmount,
      ...(pricePerBtc != null ? { pricePerBtc } : {}),
      // "No source" on a synced entry is stored, or its id would name the
      // exchange again (`sourceFieldsToStore`).
      ...sourceFieldsToStore({ id, note: trimmedNote }, source),
      note: trimmedNote,
      createdAt: entries?.find((e) => e.id === entryId)?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    setBusy(true);
    try {
      // The screen is unreachable for a member; this is the backstop that
      // keeps a stray navigation from writing into someone else's portfolio.
      if (isSharedViewer(getWallet(walletId))) throw new Error('Only the owner can change this shared portfolio.');
      await saveManualEntries(walletId, [...others, entry]);
      touchManualVault(walletId);
      navigation.goBack();
    } catch {
      // saveManualEntries THROWS on purpose — this data exists nowhere else,
      // so a failed write must never look like a success.
      setError('Could not save this entry. Nothing was recorded, so please try again.');
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    try {
      if (isSharedViewer(getWallet(walletId))) throw new Error('Only the owner can change this shared portfolio.');
      await saveManualEntries(walletId, others);
      if (entryId) {
        // The deletion must survive a two-phone merge — record it.
        await recordEntryTombstone(walletId, entryId, Date.now());
      }
      touchManualVault(walletId);
      // Back to the portfolio: the entry's own page under this one would
      // only say the entry is gone.
      navigation.popTo('ManualWallet', { walletId });
    } catch {
      setError('Could not remove this entry. Please try again.');
      setBusy(false);
    }
  };

  return (
    <Screen
      scroll
      // The page's actions, pinned at the foot (decided 2026-10-05): save first,
      // taking the entry out last and quiet.
      footer={
        <>
          <Button
            title={entryId ? 'Save changes' : 'Add to portfolio'}
            onPress={() => void save()}
            loading={busy}
            disabled={busy || entries == null}
          />
          {entryId && (
            <Button
              title="Remove this entry"
              variant="ghost"
              onPress={() => setConfirmDelete(true)}
              disabled={busy}
            />
          )}
        </>
      }>
      <View style={styles.body}>
        <SegmentedControl
          options={[
            { value: 'buy', label: 'Bought' },
            { value: 'sell', label: 'Sold' },
          ]}
          value={kind}
          onChange={setKind}
        />

        <View style={styles.amountBlock}>
          <SegmentedControl
            options={[
              { value: 'btc', label: 'BTC' },
              { value: 'sats', label: 'sats' },
            ]}
            value={unit}
            onChange={(u) => {
              // Carry the value across the unit switch instead of clearing it.
              const sats = parseAmountToSats(amount, unit);
              setUnit(u);
              if (sats != null) setAmount(u === 'btc' ? satsToBtcText(sats) : String(sats));
            }}
          />
          <TextField
            label={`Amount ${kind === 'buy' ? 'bought' : 'sold'}`}
            value={amount}
            onChangeText={setAmount}
            placeholder={unit === 'btc' ? '0.25' : '25000000'}
            keyboardType="numeric"
            monospace
          />
        </View>

        {/* Picked, never typed: this was a text field asking for YYYY-MM-DD
            behind a numeric keyboard, which has no "-" key — it could not be
            filled in at all (found in a phone test, 2026-08-25). */}
        <DatePickerField
          label={kind === 'buy' ? 'Date bought' : 'Date sold'}
          value={dateText}
          onChange={setDateText}
          minYear={2009}
          disallowFuture
          yearTitle={kind === 'buy' ? 'Year bought' : 'Year sold'}
        />

        {!settings.btcOnly && (
          <View style={styles.moneyBlock}>
            <TextField
              label={`Price per bitcoin in ${entryCurrency} (optional)`}
              value={money.priceText}
              onChangeText={(t) => {
                setAnchor('price');
                setPrice(t);
              }}
              placeholder={zeroPlaceholder}
              keyboardType="numeric"
            />
            <TextField
              label={`${kind === 'buy' ? 'Paid' : 'Received'} for the coins in ${entryCurrency} (optional)`}
              value={money.coinsText}
              onChangeText={(t) => {
                setAnchor('coins');
                setCoins(t);
              }}
              placeholder={zeroPlaceholder}
              keyboardType="numeric"
            />
            <TextField
              label={`Fee in ${entryCurrency} (optional)`}
              value={fee}
              onChangeText={setFee}
              placeholder={zeroPlaceholder}
              keyboardType="numeric"
            />
            {/* The number that will be recorded, in front of the user before
                they save: 0.25 BTC at 79,500 reads 19,875 here, and a typo
                that would read 318,000 per bitcoin is obvious. */}
            {money.total != null && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total {paidWord}</Text>
                <Text style={styles.totalValue}>
                  {symbol}
                  {formatMoney(money.total.total, money.decimals)}
                </Text>
              </View>
            )}
            {money.total?.clampedAtZero && (
              <Text style={styles.warn}>The fee is more than the sale.</Text>
            )}
          </View>
        )}
        {entryCurrency !== settings.fiat && (
          <Text style={styles.hint}>
            This entry stays in {entryCurrency}. Talia shows it in {settings.fiat} at
            the rate on its date.
          </Text>
        )}

        {/* Picked from a list, never typed (decided 2026-10-22): the
            exchanges, Peer to peer, or Other with a name. */}
        <View style={styles.fieldWrap}>
          <Text style={styles.fieldLabel}>Source (optional)</Text>
          <TouchableOpacity
            style={styles.field}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Source: ${sourceShown ?? 'none'}`}
            onPress={() =>
              navigation.navigate('EntrySource', {
                walletId,
                entryId,
                source: source.source,
                sourceName: source.sourceName,
              })
            }>
            <Text style={[styles.fieldValue, !sourceShown && styles.fieldPlaceholder]}>
              {sourceShown ?? 'Exchange, peer to peer or other'}
            </Text>
            <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
          </TouchableOpacity>
        </View>

        <TextField
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Who it is for, a reminder…"
          autoCapitalize="sentences"
        />

        {error && <Text style={styles.error}>{error}</Text>}

        {!settings.btcOnly && (
          <InfoHeading
            title="Price, fee and total"
            style={styles.hint}
            text={`Type the price per bitcoin or the amount ${paidWord} for the coins, and Talia fills in the other. On a buy the fee is added to the total paid. On a sell it is taken off the total received. Talia records that total, so it can show what your coins cost and how they have done since. Leave the money out and it simply tracks the amount of bitcoin.`}>
            The price and the amount {paidWord} are optional.
          </InfoHeading>
        )}
      </View>

      <AppDialog
        visible={confirmDelete}
        title="Remove this entry?"
        message="The portfolio's balance will change to match. This cannot be undone."
        actions={[
          { label: 'Cancel', variant: 'ghost', onPress: () => setConfirmDelete(false) },
          {
            label: 'Remove',
            destructive: true,
            onPress: () => {
              setConfirmDelete(false);
              void remove();
            },
          },
        ]}
        onClose={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

/** Sats as a plain BTC string with no trailing zero noise ("0.25", not "0.25000000"). */
function satsToBtcText(sats: number): string {
  const s = (sats / 100_000_000).toFixed(8);
  return s.replace(/\.?0+$/, '') || '0';
}

function todayIso(): string {
  return isoFromMs(Date.now());
}

function isoFromMs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse YYYY-MM-DD as LOCAL midday — midnight UTC lands on the previous day
 *  for anyone west of Greenwich, which would silently shift every date. */
function msFromIso(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  // Rejects impossible dates like 2026-02-31, which Date would roll forward.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

const styles = themedStyles(() => StyleSheet.create({
  // The Screen keeps the footer's room clear; no bottom padding of its own.
  body: { gap: theme.spacing.lg },
  amountBlock: { gap: theme.spacing.sm },
  moneyBlock: { gap: theme.spacing.sm },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: theme.spacing.xs,
  },
  totalLabel: { ...theme.typography.label, color: theme.colors.slate },
  totalValue: { ...theme.typography.heading, color: theme.colors.offWhite },
  warn: { ...theme.typography.caption, color: theme.colors.negative },
  error: { ...theme.typography.caption, color: theme.colors.negative },
  hint: { ...theme.typography.caption, color: theme.colors.faint },
  // The source field: TextField's label and box, a chevron for the list.
  fieldWrap: { gap: theme.spacing.xs },
  fieldLabel: { ...theme.typography.label, color: theme.colors.slate },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  fieldValue: { ...theme.typography.body, color: theme.colors.offWhite, flex: 1 },
  fieldPlaceholder: { color: theme.colors.faint },
}));
