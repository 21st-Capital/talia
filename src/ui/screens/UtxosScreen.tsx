/**
 * UTXOs — the wallet's unspent outputs with coin control: tap coins to
 * select them, then "Send selected" hands EXACTLY that set to the Send flow
 * (BDK's manuallySelectedOnly). Long-press a row to copy its outpoint.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { refreshOffered } from './refreshGate';
import { theme, themedStyles } from '../theme';
import { AppDialog, FadeEdge, FADE_EDGE_H, FitText, Gloss, cardGlow } from '../components';
import { useWallets, formatAmount, outpointKey } from '../../wallet';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { utxoExpiries, coinTimelockChip, ownPaymentIds, mayBeBait } from '../../wallet';
import { loadUtxoCache, saveUtxoCache, agedTipHeight, loadTxCache } from '../../wallet';
import { minOlderBlocks } from '../../bitcoin/descriptor';
import { libraryProblem } from '../../bitcoin/engine/libraryProblem';
import type { WalletTx } from '../../bitcoin/engine/types';
import type { Utxo } from '../../bitcoin/engine/types';
import { SIGNING_ENABLED } from '../../config';

type Props = NativeStackScreenProps<RootStackParamList, 'Utxos'>;

export function UtxosScreen({ route, navigation }: Props): React.JSX.Element {
  const { getWallet, syncWallet, updateWallet, settings } = useWallets();
  const wallet = getWallet(route.params.walletId);
  const { providerFps: known21C } = useProviderFingerprints(wallet);
  /** Refresh is a self-spend, so it is offered exactly where Send is: the
   *  same verdict, from the same function. It used to ask a weaker question
   *  and opened the send screen for a vault whose Send was dimmed (decided
   *  2026-09-18). */
  const canRefresh = refreshOffered(wallet, known21C);

  const [utxos, setUtxos] = useState<Utxo[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expiryByKey, setExpiryByKey] = useState<Map<string, number | null>>(new Map());
  /** Null until the history has been read, which can queue behind a sync for
   *  many seconds: until then no small coin is called bait, or the vault's own
   *  would be for as long as the read takes. */
  const [ownPayments, setOwnPayments] = useState<Set<string> | null>(null);
  const olderBlocks = wallet ? minOlderBlocks(wallet.descriptor) : null;

  const keyOf = outpointKey; // the shared canonical coin id (txid:vout)
  /** Frozen coins ("txid:vout"): never spendable from inside Talia. */
  const frozen = new Set(wallet?.frozenUtxos ?? []);
  // Press-and-hold menu for one coin (freeze/unfreeze/copy).
  const [coinMenu, setCoinMenu] = useState<Utxo | null>(null);
  const setCoinFrozen = (u: Utxo, freeze: boolean) => {
    if (!wallet) return;
    const k = keyOf(u);
    const next = freeze
      ? [...new Set([...(wallet.frozenUtxos ?? []), k])]
      : (wallet.frozenUtxos ?? []).filter((f) => f !== k);
    void updateWallet(wallet.id, { frozenUtxos: next });
    if (freeze) setSelected((prev) => {
      const n = new Set(prev);
      n.delete(k);
      return n;
    });
  };
  const toggle = (u: Utxo) => {
    if (frozen.has(keyOf(u))) {
      // A frozen coin cannot be picked — offer to unfreeze instead.
      setCoinMenu(u);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(u);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  /** Countdown map from a coin list + history + tip. */
  const computeExpiries = useCallback(
    (list: Utxo[], txs: WalletTx[], tip: number | undefined) => {
      if (olderBlocks == null) return;
      const es = utxoExpiries(list, txs, tip, olderBlocks);
      setExpiryByKey(new Map(es.map((e) => [`${e.txid}:${e.vout}`, e.blocksLeft])));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [olderBlocks],
  );

  // Instant-first: paint the cached coin list (with countdowns aged by the
  // cached tip) immediately; the live engine result replaces it below. The
  // engine call can queue for many seconds behind an in-flight wallet sync —
  // the user should never wait on that just to SEE their coins.
  const liveLanded = useRef(false);
  useEffect(() => {
    if (!wallet) return;
    (async () => {
      const cache = await loadUtxoCache(wallet.id);
      if (!cache || liveLanded.current) return;
      setUtxos((prev) => (prev.length ? prev : cache.utxos));
      setLoading(false);
      const txs = await loadTxCache(wallet.id);
      if (!liveLanded.current) {
        computeExpiries(cache.utxos, txs ?? [], agedTipHeight(cache));
        if (txs) setOwnPayments(ownPaymentIds(txs));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.id]);

  const [refreshing, setRefreshing] = useState(false);
  // Must be declared BEFORE the !wallet early return (rules-of-hooks — was a
  // latent pre-existing violation, fixed 2026-08-25).
  const load = useCallback(async (opts?: { force?: boolean }) => {
    if (!wallet) return;
    setError(null);
    try {
      // syncWallet, not getEngine: a freshly created engine has an EMPTY
      // in-memory database, and painting (or worse, caching) that emptiness
      // is what showed "0 coins" on every visit in a phone test (2026-07-19). syncWallet
      // reuses a <60s-old sync, so repeat visits stay instant.
      const engine = await syncWallet(wallet, opts);
      const list = await engine.listUtxos();
      if (list.length === 0 && engine.getTipHeight() == null) {
        // The engine never reached the server — keep whatever is on screen
        // (cache) rather than claiming the wallet is empty.
        return;
      }
      liveLanded.current = true;
      setUtxos(list);
      void saveUtxoCache(wallet.id, list, engine.getTipHeight());
      // Each coin's transaction: whether it is the vault's own payment and,
      // on Liana wallets, its own recovery-path countdown.
      let txs: WalletTx[] = [];
      try {
        txs = await engine.listTransactions();
        setOwnPayments(ownPaymentIds(txs));
      } catch {
        // countdowns stay unknown
      }
      computeExpiries(list, txs, engine.getTipHeight());
    } catch (e) {
      // Only surface the failure when there is nothing better to show —
      // painted cache beats an error banner. The wallet library's own
      // sentence is shown as written (decided 2026-11-04).
      setUtxos((prev) => {
        if (prev.length === 0) setError(libraryProblem(e) ?? `Could not load coins: ${(e as Error).message}`);
        return prev;
      });
    } finally {
      // No history to read from proves nothing, so the warning stands.
      setOwnPayments((prev) => prev ?? new Set());
      setLoading(false);
    }
  }, [wallet, syncWallet, computeExpiries]);

  useEffect(() => {
    load();
  }, [load]);




  if (!wallet) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Wallet not found.</Text>
      </View>
    );
  }

  const total = utxos.reduce((s, u) => s + u.valueSats, 0);
  const chosen = utxos.filter((u) => selected.has(keyOf(u)));
  const chosenSats = chosen.reduce((s, u) => s + u.valueSats, 0);

  /**
   * Refresh = self-spend coins to reset their timelocks. With NO selection
   * the whole wallet refreshes in one tap (decided 2026-07-19: "Refresh all
   * UTXOs" as the default); selecting coins narrows it to exactly those.
   * Navigation is INSTANT: the fresh addresses are derived inside the Send
   * screen's build step, so no engine call (which can queue behind a sync)
   * stands between the tap and the confirm page.
   */
  const spendable = utxos.filter((u) => !frozen.has(keyOf(u)));
  const spendableSats = spendable.reduce((s, u) => s + u.valueSats, 0);
  const frozenCount = utxos.length - spendable.length;
  const refreshTarget = chosen.length > 0 ? chosen : spendable;
  /**
   * The button names what it refreshes (decided 2026-09-22): it said "Refresh
   * all UTXOs" with the TOTAL beside it while a frozen coin sat out of the
   * refresh. With a coin frozen it counts the unfrozen ones and their sum,
   * and with every coin frozen there is nothing to refresh, so no button.
   */
  const refreshLabel =
    chosen.length > 0
      ? `Refresh ${chosen.length} coin${chosen.length === 1 ? '' : 's'} · ${formatAmount(chosenSats, settings.unit)}`
      : frozenCount > 0
        ? `Refresh ${spendable.length} unfrozen coin${spendable.length === 1 ? '' : 's'} · ${formatAmount(spendableSats, settings.unit)}`
        : `Refresh all coins · ${formatAmount(total, settings.unit)}`;
  /**
   * A refresh is ALWAYS one transaction per coin (decided 2026-09-18). The old
   * dialog offered "one transaction, new address per coin" as well, which
   * publicly ties the coins to each other and made the signing device warn
   * about several change outputs. It was the worse answer to a question the
   * client should not have to answer, so there is no question any more: one
   * coin drains to one fresh address, several coins each get their own
   * transaction.
   */
  const startRefresh = () => {
    if (!wallet) return;
    navigation.navigate('Send', {
      walletId: wallet.id,
      utxos: refreshTarget.map((u) => ({ txid: u.txid, vout: u.vout, valueSats: u.valueSats })),
      refresh: { count: refreshTarget.length, separate: refreshTarget.length > 1 },
    });
  };

  const onRefreshPress = () => {
    void startRefresh();
  };

  return (
    <View style={styles.root}>
      <FlatList
        data={utxos}
        keyExtractor={(u) => `${u.txid}:${u.vout}`}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={theme.colors.slate}
            onRefresh={() => {
              setRefreshing(true);
              void load({ force: true }).finally(() => setRefreshing(false));
            }}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.summary}>
              {utxos.length} coin{utxos.length === 1 ? '' : 's'} · {formatAmount(total, settings.unit)}
              {frozenCount > 0 ? ` · ${frozenCount} frozen` : ''}
            </Text>
            <Text style={styles.hint}>
              {SIGNING_ENABLED
                ? 'Tap coins to choose which ones to spend. Press and hold a coin for more options.'
                : 'Press and hold a coin for more options.'}
            </Text>
            {/* A timelock refresh is a self-SPEND — not available watch-only. */}
            {canRefresh && olderBlocks != null && refreshTarget.length > 0 && (
              <TouchableOpacity style={styles.refreshTop} onPress={onRefreshPress} activeOpacity={0.9}>
                <FitText style={styles.refreshTopText}>{refreshLabel}</FitText>
              </TouchableOpacity>
            )}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={theme.colors.gold} style={styles.spinner} />
          ) : (
            <Text style={styles.muted}>
              {error ?? 'No coins in this vault yet. Pull down to check again.'}
            </Text>
          )
        }
        renderItem={({ item }) => {
          const on = selected.has(keyOf(item));
          // A frozen coin is a STATE, said in colour (its figure and chips go
          // faint), never an opacity on the row (decided 2026-09-16).
          const isFrozen = frozen.has(keyOf(item));
          return (
            <TouchableOpacity
              style={[styles.row, on && styles.rowOn]}
              activeOpacity={0.85}
              onPress={() => toggle(item)}
              onLongPress={() => setCoinMenu(item)}>
              <Gloss radius={theme.radius.md} strength={cardGlow()} />
              <View style={styles.rowTop}>
                <View style={styles.rowLeft}>
                  <View style={[styles.check, on && styles.checkOn]}>
                    {on && <View style={styles.checkDot} />}
                  </View>
                  <Text style={[styles.value, isFrozen && styles.valueFrozen]}>
                    {formatAmount(item.valueSats, settings.unit)}
                  </Text>
                </View>
                <View style={styles.chipRow}>
                  {isFrozen && (
                    <View style={[styles.chip, styles.chipFrozen]}>
                      <Text style={[styles.chipText, styles.chipTextFrozen]}>frozen</Text>
                    </View>
                  )}
                  <View style={[styles.chip, item.keychain === 'internal' && styles.chipChange]}>
                    <Text style={[styles.chipText, isFrozen && styles.chipTextFrozen]}>
                      {item.keychain === 'internal' ? 'change' : 'receive'}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.rowBelow}>
              {olderBlocks != null && expiryByKey.has(keyOf(item)) && (
                <View
                  style={[
                    styles.chip,
                    styles.chipTimer,
                    (expiryByKey.get(keyOf(item)) ?? 1) <= 0 && styles.chipExpired,
                  ]}>
                  <Text style={styles.chipText}>
                    {coinTimelockChip(expiryByKey.get(keyOf(item)), !wallet?.heirVault)}
                  </Text>
                </View>
              )}
              {ownPayments != null && mayBeBait(item, ownPayments) && !isFrozen && (
                <Text style={styles.dustHint}>
                  Unusually small, and could be bait from a stranger. Press and
                  hold to freeze it.
                </Text>
              )}
              </View>
            </TouchableOpacity>
          );
        }}
      />


      <AppDialog
        visible={coinMenu != null}
        title={coinMenu != null && frozen.has(keyOf(coinMenu)) ? 'Frozen coin' : 'Coin options'}
        message={
          coinMenu != null && frozen.has(keyOf(coinMenu))
            ? 'This coin is frozen. Talia will never spend it until you unfreeze it.'
            : 'A frozen coin is never used by payments or refreshes. Freeze coins you don\u2019t recognise: tiny payments from strangers are often bait. This applies inside Talia only.'
        }
        actions={
          coinMenu == null
            ? []
            : [
                frozen.has(keyOf(coinMenu))
                  ? {
                      label: 'Unfreeze this coin',
                      onPress: () => setCoinFrozen(coinMenu, false),
                    }
                  : {
                      label: 'Freeze this coin',
                      onPress: () => setCoinFrozen(coinMenu, true),
                    },
                ...(coinMenu.address
                  ? [
                      {
                        label: 'Show coin address',
                        variant: 'ghost' as const,
                        onPress: () => {
                          // Close this dialog BEFORE presenting the next
                          // screen — iOS can't stack modals.
                          const address = coinMenu.address!;
                          const keychain = coinMenu.keychain;
                          setTimeout(
                            () =>
                              navigation.navigate('Receive', {
                                walletId: wallet.id,
                                address,
                                keychain,
                              }),
                            450,
                          );
                        },
                      },
                    ]
                  : []),
                { label: 'Cancel', variant: 'ghost' as const, onPress: () => {} },
              ]
        }
        onClose={() => setCoinMenu(null)}
      />

      {/* Send-selected bar appears the moment a coin is picked. Watch-only v1
          keeps the selection (it drives the totals) but offers no spend. */}
      {/* Coins running under the send bar dissolve behind it (decided 2026-09-12). */}
      {SIGNING_ENABLED && chosen.length > 0 && <FadeEdge height={SEND_BAR_ZONE} fade={FADE_EDGE_H} />}
      {SIGNING_ENABLED && chosen.length > 0 && (
        <View style={styles.sendBarWrap}>
          <TouchableOpacity
            style={styles.sendBar}
            activeOpacity={0.9}
            onPress={() =>
              navigation.navigate('Send', {
                walletId: wallet.id,
                utxos: chosen.map((u) => ({
                  txid: u.txid,
                  vout: u.vout,
                  valueSats: u.valueSats,
                })),
              })
            }>
            <Text style={styles.sendBarAmount}>{formatAmount(chosenSats, settings.unit)}</Text>
            <Text style={styles.sendBarLabel}>Send selected</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}


/** The floating send bar's height (its lg padding around a heading line). */
const SEND_BAR_H = 60;
/** The floating send bar's zone: its margin, its height and the dissolve above it. */
const SEND_BAR_ZONE = theme.spacing.xl + SEND_BAR_H + FADE_EDGE_H;
/** The selection circle; what sits under the amount aligns past it. */
const CHECK_SIZE = 22;
const styles = themedStyles(() => StyleSheet.create({
  // The frozen state in colour: the figure and the chips go faint.
  valueFrozen: { color: theme.colors.faint },
  chipTextFrozen: { color: theme.colors.faint },
  dustHint: { ...theme.typography.caption, color: theme.colors.gold, marginTop: theme.spacing.xs },
  chipRow: { flexDirection: 'row', gap: theme.spacing.sm },
  chipFrozen: { borderColor: theme.colors.faint },
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The last coin scrolls clear of the send bar's zone.
  list: { padding: theme.spacing.lg, gap: theme.spacing.sm, paddingBottom: SEND_BAR_ZONE + theme.spacing.sm },
  header: { gap: theme.spacing.xs, marginBottom: theme.spacing.md },
  summary: { ...theme.typography.heading, color: theme.colors.offWhite },
  hint: { ...theme.typography.caption, color: theme.colors.slate },
  spinner: { marginTop: theme.spacing.xl },
  muted: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },

  row: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  value: { ...theme.typography.heading, color: theme.colors.offWhite },
  chip: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  chipChange: { backgroundColor: 'rgba(242, 169, 0, 0.15)' },
  chipText: { ...theme.typography.label, color: theme.colors.slate },
  rowOn: { borderColor: theme.colors.accent },
  chipTimer: { backgroundColor: 'rgba(242, 169, 0, 0.12)', alignSelf: 'flex-start' },
  chipExpired: { backgroundColor: 'rgba(255, 76, 76, 0.18)' },
  // One line clear of the rounded ends at any amount (decided 2026-10-31 after
  // a phone test). The label changes as coins are chosen and FitText's line
  // shrinks with it, so the height is held or the coins below would jump.
  refreshTop: {
    backgroundColor: theme.colors.action,
    borderRadius: theme.radius.pill,
    justifyContent: 'center',
    minHeight: theme.typography.heading.lineHeight + 2 * theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  refreshTopText: { ...theme.typography.heading, color: theme.colors.actionText, textAlign: 'center' },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  // Everything under the amount aligns WITH the amount, not the circle
  // (decided 2026-07-19: easier to read).
  rowBelow: { marginLeft: CHECK_SIZE + theme.spacing.sm, alignItems: 'flex-start', gap: theme.spacing.sm },
  check: {
    width: CHECK_SIZE,
    height: CHECK_SIZE,
    borderRadius: CHECK_SIZE / 2,
    borderWidth: 2,
    borderColor: theme.colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { borderColor: theme.colors.accent },
  checkDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent },
  sendBarWrap: {
    position: 'absolute',
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: theme.spacing.xl,
  },
  sendBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.action,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.lg,
    shadowColor: theme.colors.black,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  sendBarAmount: { ...theme.typography.heading, color: theme.colors.actionText },
  sendBarLabel: { ...theme.typography.heading, color: theme.colors.actionText },
}));
