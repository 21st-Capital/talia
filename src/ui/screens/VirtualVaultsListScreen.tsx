/**
 * The Portfolio tab's home — deliberately the SAME layout language as the
 * on-chain home (decided 2026-08-26: "match it with the vault home page with the
 * talia logo visible"): lockup top-left, round "+" top-right, tappable
 * total block, then the cards. What stays different is the label — this is
 * "Portfolio Value", hand-kept, and the P/L line the vault home doesn't have.
 *
 * Sections + Arrange (decided 2026-09-02: "the exact same arrange/delete and
 * label category structure we have for vaults, also for portfolios"): the
 * cards sit under the owner's own section labels (then Other), and a
 * long-press on a section title or a card opens ArrangeModal in portfolio
 * mode — reorder, rename, re-section, change icon, delete. Delete lives
 * THERE now, like vaults; the old long-press delete dialog is gone.
 *
 * Naming (decided 2026-08-26): the feature is "Portfolio" / "portfolios" —
 * "Virtual Vault" retired from user-facing copy. Code identifiers keep the
 * `manual`/`ManualWallet` naming, and the export wire format keeps its
 * `talia-virtual-vault` type string (compatibility).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TabRootScreenProps, VirtualTabParamList } from '../navigation/types';
import { heroFigure, heroLabel, naturalLineHeight, theme, themedStyles } from '../theme';
import { HeaderIconButton, ArrangeModal, Button, InfoHeading, TaliaLogo, WalletIconTile, PlusIcon, dockFollowScroll, dockSyncScroll, walletIconFor, Gloss, cardGlow, FitText, textEnlarged } from '../components';
import {
  convertFiatOnDate,
  formatAmount,
  formatCardAmount,
  formatFiat,
  loadManualEntries,
  manualBalanceSats,
  manualSummary,
  manualUnrealizedFiat,
  portfolioSectionsFor,
  useWallets,
} from '../../wallet';
import type { ManualEntry } from '../../wallet';
import { useLiveRate } from '../hooks/useLiveRate';
import { formatChange } from '../../wallet/marketFormat';
import { useRequireAuth } from '../auth/useRequireAuth';

type Props = TabRootScreenProps<VirtualTabParamList, 'VirtualList', 'VirtualTab'>;

const MASK = '•••••';

/** Behind the info dot on the Portfolio home (decided 2026-09-12). */
const KEPT_BY_HAND_INFO =
  '• A portfolio is a record you keep, not a vault Talia watches on the blockchain.\n' +
  '• Its entries come from what you add by hand, or from a vault or exchange you connect.\n' +
  '• Its value is not part of the total on the Vaults screen.\n' +
  '• Keep a copy: export it now and then, or turn on Portfolio Sync in Settings.';

export function VirtualVaultsListScreen({ navigation }: Props): React.JSX.Element {
  const lastScrollY = useRef(0);
  // The dock's names fold once the list scrolls and return at the top; a tab
  // coming back into focus restates its own resting position (ui/components/dockState).
  useEffect(() => {
    dockSyncScroll(lastScrollY.current);
    return navigation.addListener('focus', () => dockSyncScroll(lastScrollY.current));
  }, [navigation]);
  const { wallets, settings, updateSettings, syncVirtualVaults } = useWallets();
  // Pull down to refresh, as on the vault list: one portfolio round, the
  // shared portfolios' changes included (decided 2026-09-14).
  const [refreshing, setRefreshing] = useState(false);
  const onPull = useCallback(async () => {
    setRefreshing(true);
    try {
      await syncVirtualVaults();
    } finally {
      setRefreshing(false);
    }
  }, [syncVirtualVaults]);
  const { requireAuth, authModal } = useRequireAuth();
  const insets = useSafeAreaInsets();
  const rate = useLiveRate(settings.fiat, !settings.btcOnly);
  const virtuals = useMemo(() => wallets.filter((w) => w.manual), [wallets]);
  const sections = useMemo(
    () => portfolioSectionsFor(virtuals, settings.portfolioCategoryOrder),
    [virtuals, settings.portfolioCategoryOrder],
  );
  const masked = settings.hideBalances;
  // Larger text: the card's money line joins the layout and the amount may
  // move under the name (textEnlarged, decided 2026-10-22).
  const enlarged = textEnlarged(useWindowDimensions().fontScale);

  // Long-press (a section title or a card) → Arrange, exactly like the
  // vault home. Deleting a portfolio happens there, behind typed DELETE.
  const [arranging, setArranging] = useState(false);

  // ── Overall value + P/L across every portfolio ────────────────────────────
  // All entries pooled through the SAME tested arithmetic as a single
  // portfolio: P/L covers priced entries only, converted into the active
  // currency at each entry's own date. The fx state is currency-tagged so a
  // stale map is never applied across a display-currency switch.
  const [allEntries, setAllEntries] = useState<ManualEntry[]>([]);
  const [balances, setBalances] = useState<Map<string, number>>(new Map());
  const [fx, setFx] = useState<{ currency: string; map: Map<string, number> }>({
    currency: settings.fiat,
    map: new Map(),
  });
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const lists = await Promise.all(virtuals.map((w) => loadManualEntries(w.id)));
        if (cancelled) return;
        // Balances straight from the entries — a portfolio that arrived via
        // sync has no cached balance until its screen is opened, and the list
        // must not show 0 next to a correct pooled P/L.
        const byVault = new Map<string, number>();
        virtuals.forEach((w, i) => byVault.set(w.id, manualBalanceSats(lists[i])));
        setBalances(byVault);
        // Pooled P/L covers what the total covers: hidden portfolios are out
        // of the header total, so their entries stay out of the P/L too.
        const entries = virtuals.flatMap((w, i) => (w.balanceHidden ? [] : lists[i]));
        setAllEntries(entries);
        const m = new Map<string, number>();
        for (const e of entries) {
          if (e.fiatAmount == null || !e.fiatCurrency || e.fiatCurrency === settings.fiat) continue;
          const v = await convertFiatOnDate(e.fiatAmount, e.fiatCurrency, settings.fiat, e.date / 1000);
          if (v != null) m.set(e.id, v);
        }
        if (!cancelled) setFx({ currency: settings.fiat, map: m });
      })();
      return () => {
        cancelled = true;
      };
    }, [virtuals, settings.fiat]),
  );
  const summary = useMemo(
    () =>
      manualSummary(allEntries, settings.fiat, fx.currency === settings.fiat ? fx.map : undefined),
    [allEntries, settings.fiat, fx],
  );
  const totalSats = virtuals
    .filter((w) => !w.balanceHidden)
    .reduce((sum, w) => sum + (balances.get(w.id) ?? w.cachedBalanceSats ?? 0), 0);
  const pnl = rate != null ? manualUnrealizedFiat(summary, rate) : undefined;
  const pnlPct =
    pnl != null && summary.holdingsCostFiat != null && summary.holdingsCostFiat > 0
      ? (pnl / summary.holdingsCostFiat) * 100
      : undefined;

  const toggleHidden = async (): Promise<void> => {
    if (masked && settings.requireAuthToUnhide) {
      if (!(await requireAuth('Show balances'))) return;
    }
    void updateSettings({ hideBalances: !masked });
  };

  // Empty state mirrors the vault home's welcome.
  if (virtuals.length === 0) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
        <TaliaLogo size={88} />
        <View style={styles.logoSpacer} />
        <Text style={styles.emptyTitle}>
          Your Portfolio
        </Text>
        <Text style={styles.emptyBody}>
          All your buys and sells in one place, from any exchange or wallet.
        </Text>
        <Button
          title="Create a portfolio"
          onPress={() => navigation.navigate('ManualWalletSetup')}
          style={styles.emptyCta}
        />
        {authModal}
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <SectionList
        sections={sections}
        keyExtractor={(w) => w.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} tintColor={theme.colors.gold} />}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.list, { paddingTop: theme.spacing.sm }]}
        scrollIndicatorInsets={{ bottom: 96 }}
        onScroll={(e) => {
          lastScrollY.current = e.nativeEvent.contentOffset.y;
          dockFollowScroll(lastScrollY.current);
        }}
        scrollEventThrottle={32}
        ListHeaderComponent={
          <View>
            <View style={styles.topBar}>
              <View style={styles.brandRow}>
                {/* As tall as the round buttons beside it (decided 2026-09-12). */}
                <TaliaLogo size={40} variant="lockup" />
              </View>
              <View style={styles.topBarSpacer} />
              <HeaderIconButton label="Create a portfolio" onPress={() => navigation.navigate('ManualWalletSetup')}>
                <PlusIcon size={20} strokeWidth={2.5} />
              </HeaderIconButton>
            </View>

            <TouchableOpacity style={styles.totalBlock} activeOpacity={0.7} onPress={() => void toggleHidden()}>
              <Text style={styles.totalLabel}>Portfolio Value</Text>
              <FitText style={styles.totalValue} minimumFontScale={0.55}>
                {masked ? MASK : formatAmount(totalSats, settings.unit)}
              </FitText>
              {!settings.btcOnly && rate != null && (
                <Text style={styles.totalFiat}>
                  {masked ? '••••' : formatFiat(totalSats, rate, settings.fiat)}
                </Text>
              )}
              {!settings.btcOnly && pnl != null && !masked && (
                <Text style={[styles.totalPnl, pnl >= 0 ? styles.pnlUp : styles.pnlDown]}>
                  {formatChange(pnl, pnlPct, settings.fiat)}
                </Text>
              )}
              {!settings.btcOnly && pnl != null && summary.uncoveredHeldSats > 0 && !masked && (
                <Text style={styles.coverageHint}>
                  On the {formatAmount(summary.coveredHeldSats, settings.unit)} with usable prices.
                </Text>
              )}
              <InfoHeading
                style={[styles.keptByHand, styles.keptByHandRow]}
                title="Kept by hand"
                text={KEPT_BY_HAND_INFO}>
                Kept by hand · separate from your vaults
              </InfoHeading>
            </TouchableOpacity>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle} onLongPress={() => setArranging(true)}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const hidden = masked || !!item.balanceHidden;
          const sats = balances.get(item.id) ?? item.cachedBalanceSats ?? 0;
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('ManualWallet', { walletId: item.id })}
              onLongPress={() => setArranging(true)}>
              <Gloss radius={theme.radius.lg} strength={cardGlow()} />
              {/* The vault card's own tile, so both lists share one card size. */}
              <WalletIconTile icon={walletIconFor(item)} />
              {/* The name/amount line sits on the icon's middle and the fiat
                  value hangs under the amount (decided 2026-09-12, the rows rule).
                  The fiat is taken out of the layout so the card keeps the
                  vault card's height. No "Kept by hand" under each name: the
                  top line says it once. */}
              <View style={styles.cardBody}>
                {/* Larger text: name and figures share the line while both
                    fit, else the figures go under the name, the history
                    rows' rule; the name is never cut. */}
                <View style={[styles.cardLine, enlarged && styles.cardLineWrap]}>
                  <Text style={[styles.cardName, enlarged && styles.cardNameWrap]} numberOfLines={enlarged ? undefined : 2}>
                    {item.label}
                  </Text>
                  <View style={[styles.cardAmount, enlarged && styles.cardAmountWrap]}>
                    <FitText style={styles.cardBalance}>
                      {hidden ? '•••' : formatCardAmount(sats, settings.unit)}
                    </FitText>
                    {!hidden && !settings.btcOnly && rate != null && (
                      <Text style={[styles.cardFiat, enlarged && styles.cardFiatInFlow]} numberOfLines={1}>
                        {formatFiat(sats, rate, settings.fiat)}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
      <ArrangeModal visible={arranging} mode="portfolios" onClose={() => setArranging(false)} />
      {authModal}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  logoSpacer: { height: theme.spacing.lg },
  emptyTitle: { ...theme.typography.title, color: theme.colors.offWhite },
  emptyBody: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    maxWidth: 320,
  },
  emptyCta: { marginTop: theme.spacing.xl, alignSelf: 'stretch' },

  list: { paddingHorizontal: theme.spacing.lg, paddingBottom: 140 },
  // Mirrors WalletListScreen's header language.
  topBar: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  topBarSpacer: { flex: 1 },
  // Same hero as the vault home (decided 2026-09-12): centred, with air above.
  totalBlock: { marginTop: theme.spacing.xxl + theme.spacing.lg, marginBottom: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.xs },
  // The one hero label (theme `heroLabel`), shared with Home, the Portfolio tab,
  // the vault page and "Vault built".
  totalLabel: heroLabel(),
  totalValue: { ...heroFigure(), paddingHorizontal: theme.spacing.md },
  totalFiat: { ...theme.typography.heroCaption, color: theme.colors.slate, textAlign: 'center' },
  totalPnl: { ...theme.typography.heading, marginTop: 2, textAlign: 'center' },
  // One green and one red for every gain and loss in the app (decided
  // 2026-09-12): the same tokens the vault history and the price screen use.
  pnlUp: { color: theme.colors.positive },
  pnlDown: { color: theme.colors.negative },
  coverageHint: { ...theme.typography.caption, color: theme.colors.faint, textAlign: 'center' },
  keptByHandRow: { marginTop: theme.spacing.xs },
  keptByHand: { ...theme.typography.caption, color: theme.colors.faint, textAlign: 'center' },
  // Section header over the cards — the same dimmed heading as the vault
  // home's section titles (WalletListScreen.sectionTitle).
  sectionTitle: {
    ...theme.typography.heading,
    color: theme.colors.faint,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },

  card: {
    flexDirection: 'row',
    // Same metrics as the vault card (decided 2026-09-12: one card size), and the
    // same raised ground with the app icon's finish (decided 2026-09-16).
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    padding: theme.spacing.lg,
    // Card pitch as on the vault home (no container gap: a SectionList's gap
    // would also pad every section header).
    marginBottom: theme.spacing.sm,
  },
  cardBody: { flex: 1, minWidth: 0 },
  // Name and amount on ONE line; the fiat value right-aligned under it.
  cardLine: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.sm },
  cardName: { ...theme.typography.heading, color: theme.colors.offWhite, flexShrink: 1 },
  cardAmount: { maxWidth: '60%', alignItems: 'flex-end' },
  cardBalance: { ...theme.typography.heading, color: theme.colors.offWhite },
  // Out of the layout, right under the amount.
  cardFiat: {
    ...theme.typography.caption,
    color: theme.colors.slate,
    position: 'absolute',
    top: naturalLineHeight(theme.typography.heading.fontSize) + 2,
    right: 0,
  },
  // Larger text (textEnlarged): one wrapping line, the money line in the
  // layout under the amount, the figures at the right on whichever line.
  cardLineWrap: { flexWrap: 'wrap', columnGap: theme.spacing.sm, rowGap: 2 },
  cardNameWrap: { maxWidth: '100%' },
  cardAmountWrap: { maxWidth: '100%', marginLeft: 'auto', flexShrink: 1 },
  cardFiatInFlow: { position: 'relative', top: 0, right: 0, marginTop: 2 },
}));
