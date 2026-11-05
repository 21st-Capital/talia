/**
 * Home — Total Balance up top, then wallets in user-defined category sections
 * (Savings / Spending / custom / Other), Aqua-ledger style: bold section
 * titles, flat rounded cards with a coin icon, wallet name + ticker on the
 * left, grouped-digit balance + fiat on the right. Pull down to re-sync.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Easing,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TabRootScreenProps, VaultsTabParamList } from '../navigation/types';
import { AppDialog, HeaderIconButton, Gloss, Button, NoticeBanner, TaliaLogo, PriceChart, WalletIconTile, walletIconFor, ArrangeModal, SatoshiIcon, PlusIcon, MinusIcon, dockFollowScroll, dockSyncScroll, cardGlow , FitText } from '../components';
import { heroFigure, heroLabel, theme, themedStyles } from '../theme';
import {
  useWallets,
  formatAmount,
  formatCardAmount,
  sectionsForWallets,
  getBtcPrice,
  formatFiat,
  saveTxCache,
  saveUtxoCache,
  visibleWallets,
  visibleTotalSats,
  resolveUnit,
} from '../../wallet';
import {
  loadVisibleClaimedInvites,
  maybeReconcileClaimedInvites,
} from '../../services/heirInvite';
import type { ClaimedInviteRecord } from '../../services/heirInvite';
import { useRequireAuth } from '../auth/useRequireAuth';
import { Linking } from 'react-native';
import { fetchKeyEntitlement, loadSession, onSessionSaved } from '../../services/companyAuth';
import { BUILDER_COPY, firstRunAssignedVault, firstRunTitle } from '../../services/vaultAllocation';
import type { AssignedVault } from '../../services/vaultAllocation';
import {
  SETUP_MEETING_COPY,
  bookedMomentFor,
  setupMeetingBookedLine,
  setupMeetingFor,
} from '../../services/setupMeeting';
import type { SetupMeetingOffer } from '../../services/setupMeeting';
import { useSetupMeetingSheet } from '../hooks/useSetupMeetingSheet';
import { sealedCardLine } from '../../wallet/sealedInviteCopy';
import {
  createVaultQuote,
  checkoutUrlWithLogin,
  OnboardingRequiredError,
  PricesChangedError,
} from '../../services/billing';
import { HWW_ENABLED, LEDGER_PREVIEW, PURCHASES_ENABLED, SIGNING_ENABLED, SUPPORT } from '../../config';
import { homeRefresh } from './homeRefresh';
import type { HomeRefresh } from './homeRefresh';


import type { WalletMeta, AmountUnit } from '../../wallet';
import {
  utxoExpiries,
  nearestExpiryBlocks,
  timelockNotice,
  REFRESH_SOON_BLOCKS,
} from '../../wallet';
import { ClockIcon, CurrencyBitcoinIcon } from '../components/TablerIcons';
import { minOlderBlocks, sigTypeLabel } from '../../bitcoin/descriptor';
import { NETWORK_TICKERS } from '../../bitcoin/network';

type Props = TabRootScreenProps<VaultsTabParamList, 'WalletList', 'VaultsTab'>;


const MASK = '•••••';
/** The red remove button that appears on the chart's corner while it is removable. */
const REMOVE_BTN = 26;

export function WalletListScreen({ navigation }: Props): React.JSX.Element {


  const { wallets: allWallets, settings, loading, syncWallet, recordBalance, updateSettings, updateWallet, autoAppendLinked, planJustActivated, clearPlanActivated } = useWallets();
  // Virtual (hand-kept) vaults live on their OWN tab (decided 2026-08-26) — this
  // screen is strictly the on-chain world.
  const wallets = React.useMemo(() => allWallets.filter((w) => !w.manual), [allWallets]);




  const hidden = settings.hideBalances;
  const { requireAuth, authModal } = useRequireAuth();
  const insets = useSafeAreaInsets();

  // Tab icon press (switch OR re-tap) jumps the list to the top (decided 2026-07-18).
  const listRef = useRef<SectionList<WalletMeta>>(null);
  const lastScrollY = useRef(0);
  // The dock's names fold once the list scrolls and return at the top; a tab
  // coming back into focus restates its own resting position (ui/components/dockState).
  useEffect(() => {
    dockSyncScroll(lastScrollY.current);
    return navigation.addListener('focus', () => dockSyncScroll(lastScrollY.current));
  }, [navigation]);
  useEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    return parent.addListener('tabPress' as never, () => {
      listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: true });
    });
  }, [navigation]);

  const [refreshing, setRefreshing] = useState(false);
  // Tap a locked vault → re-open its plan checkout (deep-link unlocks it).
  // Nothing is bought inside the App Store build, so the tap offers a call
  // with 21st Capital instead (App Review guideline 3.1.1).
  /** The one sentence a refused re-activation checkout shows. */
  const [checkoutRefusal, setCheckoutRefusal] = useState<string | null>(null);
  const activateLockedVault = useCallback(async (w: WalletMeta) => {
    if (!PURCHASES_ENABLED) {
      void Linking.openURL(SUPPORT.scheduleCallUrl).catch(() => {});
      return;
    }
    const plan = w.activationPlan;
    if (!plan) return;
    try {
      const session = await loadSession();
      if (!session) return;
      const { quoteId, portfolioId } = await createVaultQuote(session, {
        ...plan,
        userEmail: session.email ?? '',
      });
      // Remember the backend portfolio — handle for the testing banner.
      if (portfolioId) void updateWallet(w.id, { portfolioId });
      // Login handoff: sign the browser in fresh before the checkout page.
      await Linking.openURL(await checkoutUrlWithLogin(session, quoteId));
    } catch (e) {
      // Best-effort; the post-creation dialog is the primary activation
      // path. A refusal the client can act on still gets its one sentence
      // (decided 2026-10-01), never a silent tap.
      if (e instanceof OnboardingRequiredError || e instanceof PricesChangedError) {
        setCheckoutRefusal(e.message);
      }
    }
  }, [updateWallet]);

  // Show a brief success when a checkout deep-link just unlocked a vault.
  useEffect(() => {
    if (!planJustActivated) return;
    const t = setTimeout(() => clearPlanActivated(), 4000);
    return () => clearTimeout(t);
  }, [planJustActivated, clearPlanActivated]);
  const [arranging, setArranging] = useState(false);
  // Long-press on the chart arms a removable state: a (-) appears top-right
  // (the force-press spec; long-press is RN's equivalent), then disarms.
  const [chartRemovable, setChartRemovable] = useState(false);
  // Apple-homescreen jiggle while the chart is removable.
  const jiggle = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!chartRemovable) {
      jiggle.stopAnimation();
      jiggle.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(jiggle, { toValue: 1, duration: 120, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(jiggle, { toValue: -1, duration: 240, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(jiggle, { toValue: 0, duration: 120, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    const t = setTimeout(() => setChartRemovable(false), 5000);
    return () => {
      loop.stop();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartRemovable]);
  const [fiatRate, setFiatRate] = useState<number | null>(null);
  // Cached expiry → banner is visible immediately, before any sync.
  const cachedExpiring = React.useMemo(() => {
    let best: { id: string; label: string; blocks: number } | null = null;
    for (const w of wallets) {
      if (w.cachedExpiryBlocks == null || w.cachedExpiryAt == null) continue;
      const elapsed = Math.floor((Date.now() - w.cachedExpiryAt) / 600_000);
      const blocks = w.cachedExpiryBlocks - elapsed;
      if (blocks < REFRESH_SOON_BLOCKS && (best == null || blocks < best.blocks)) {
        best = { id: w.id, label: w.label, blocks };
      }
    }
    return best;
  }, [wallets]);
  // ONE source, the cache every sync writes (this screen's and the vault
  // page's alike): a separate in-memory minimum only ever went down, so after
  // a refresh the home kept saying a path was open while the vault page had
  // gone quiet, and a deleted vault stayed in the banner (decided 2026-09-22).
  const shownExpiring = cachedExpiring;

  // Sealed heir invites live on the HOME screen too (decided 2026-07-26: the
  // heir must open the app and SEE the vault — just not its contents; there
  // is nothing to show until release, by design). They render under "Other"
  // so they never mix with the heir's own vault categories.
  const [sealedInvites, setSealedInvites] = useState<ClaimedInviteRecord[]>([]);
  useEffect(() => {
    // Scoped to the logged-in account: an owner must never see the sealed
    // cards an heir claimed on the same phone (decided 2026-07-26). Local first
    // (instant), then a throttled server reconcile — the release date MOVES
    // when the owner refreshes the coins, and this tile must not keep
    // claiming "ready to open" against a stale date.
    const check = () => {
      void loadSession().then((s) =>
        loadVisibleClaimedInvites(s?.email).then(setSealedInvites),
      );
      void maybeReconcileClaimedInvites().then((fresh) => {
        if (fresh) setSealedInvites(fresh);
      });
    };
    const unsub = navigation.addListener('focus', check);
    check();
    return unsub;
  }, [navigation]);

  // The family member's first run (decided 2026-09-20): somebody's plan has a
  // vault for this account, nobody has built it yet and this phone holds no
  // vault. The welcome page then says so and leads straight into the build.
  // Asked only while the list is empty and only where vaults can be built;
  // no session, no answer or an older backend leaves the ordinary welcome.
  const [assignedVault, setAssignedVault] = useState<AssignedVault | null>(null);
  // The setup meeting that goes with it (decided 2026-09-21): the same entitlement
  // answer says whether there is one to book and whether one already stands.
  const [setupOffer, setSetupOffer] = useState<SetupMeetingOffer | null>(null);
  const setupSheet = useSetupMeetingSheet();
  const canBuild = SIGNING_ENABLED || HWW_ENABLED;
  useEffect(() => {
    if (!canBuild || wallets.length > 0) {
      setAssignedVault(null);
      setSetupOffer(null);
      return;
    }
    let alive = true;
    const check = () => {
      void (async () => {
        const session = await loadSession().catch(() => null);
        const ent = session ? await fetchKeyEntitlement(session).catch(() => null) : null;
        if (!alive) return;
        const assigned = firstRunAssignedVault(ent, []);
        setAssignedVault(assigned);
        setSetupOffer(
          assigned ? setupMeetingFor(ent, { vaultNumber: assigned.vaultNumber }) : null,
        );
      })();
    };
    const unsubFocus = navigation.addListener('focus', check);
    const unsubSession = onSessionSaved(check);
    check();
    return () => {
      alive = false;
      unsubFocus();
      unsubSession();
    };
  }, [navigation, canBuild, wallets.length]);

  const shownWallets = visibleWallets(wallets, settings.hiddenCategories);
  const totalSats = visibleTotalSats(wallets, settings.hiddenCategories);
  const sections = sectionsForWallets(shownWallets, settings.categoryOrder);
  // The sealed card's only action is ClaimInvite, which watch-only v1 does
  // not register — so the heir surface stays out of the list entirely.
  if ((SIGNING_ENABLED || LEDGER_PREVIEW) && sealedInvites.length > 0) {
    const sealedItems = sealedInvites.map(
      (r) => ({ id: `sealed:${r.inviteId}`, __sealed: r }) as unknown as WalletMeta,
    );
    const other = sections.find((s) => s.key === '');
    if (other) other.data = [...other.data, ...sealedItems];
    else sections.push({ key: '', title: 'Other', data: sealedItems });
  }

  // Instant-first: this screen renders from cached balances immediately and
  // NEVER blocks on the network. The background refresh syncs wallets
  // SEQUENTIALLY (the engine's native queue is serial — parallel syncs would
  // make a user-opened wallet wait behind all of them). WHEN it runs is
  // `homeRefresh`: after a short delay at launch, so a wallet the user opens
  // always enters the queue first, at every return to the app, and on the
  // pull, one at a time (decided 2026-11-04 after a phone test).
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  const backgroundSync = useCallback(async () => {
    if (!settings.btcOnly) getBtcPrice(settings.fiat).then(setFiatRate);
    for (const w of walletsRef.current) {
      // A manual wallet has no descriptor to sync. getEngine would throw and
      // the catch below would hide it — skip it outright so the refresh does
      // not spend its pacing gap on a wallet that can never change here.
      if (w.manual) continue;
      try {
        const engine = await syncWallet(w, { force: true });
        const [bal, txs] = await Promise.all([engine.getBalance(), engine.listTransactions()]);
        recordBalance(w.id, bal.total);
        await saveTxCache(w.id, txs);
        // Linked portfolio: new real activity flows in automatically.
        void autoAppendLinked(w.id, txs);
        // Timelocked (Liana) wallets: surface the most urgent countdown.
        const older = minOlderBlocks(w.descriptor);
        if (older != null) {
          const utxos = await engine.listUtxos();
          void saveUtxoCache(w.id, utxos, engine.getTipHeight());
          const nearest = nearestExpiryBlocks(
            utxoExpiries(utxos, txs, engine.getTipHeight(), older),
            older,
          );
          // Persist so the banner shows INSTANTLY on next app open (the rule:
          // the warning must be visible without entering the vault).
          void updateWallet(w.id, {
            cachedExpiryBlocks: nearest ?? undefined,
            cachedExpiryAt: nearest != null ? Date.now() : undefined,
          });
        }
      } catch {
        // Offline or slow server — cards keep their cached values.
      }
      // No pause before the next vault (decided 2026-11-04: with many vaults
      // the 0.8 s pauses added up while the client waited). A vault the
      // client opens meanwhile still goes first: its sync joins the queue
      // while this one runs, and the native queue keeps their order.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fiat, syncWallet, recordBalance]);

  // The latest refresh (it closes over the chosen currency) for the one
  // scheduler this screen keeps for as long as it is mounted.
  const backgroundSyncRef = useRef(backgroundSync);
  backgroundSyncRef.current = backgroundSync;
  const refresher = useRef<HomeRefresh | null>(null);
  useEffect(() => {
    const r = homeRefresh(() => backgroundSyncRef.current());
    refresher.current = r;
    const sub = AppState.addEventListener('change', (next) => r.appState(next));
    return () => {
      sub.remove();
      r.dispose();
      if (refresher.current === r) refresher.current = null;
    };
  }, []);
  // The launch's refresh waits for the vault list; only its first arrival
  // counts, and a later change of the list never cancels it.
  useEffect(() => {
    if (wallets.length > 0) refresher.current?.launch();
  }, [wallets.length]);

  // Live-ish price: refetch immediately on currency change, then every 10s.
  useEffect(() => {
    setFiatRate(null); // never show the previous currency's rate
    if (settings.btcOnly) return; // Bitcoin Only: no fiat anywhere
    let cancelled = false;
    const tick = () => getBtcPrice(settings.fiat).then((r) => !cancelled && setFiatRate(r));
    tick();
    const iv = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [settings.fiat, settings.btcOnly]);

  const onPull = useCallback(async () => {
    setRefreshing(true);
    try {
      await (refresher.current?.pull() ?? backgroundSync());
    } finally {
      setRefreshing(false);
    }
  }, [backgroundSync]);


  if (loading) {
    return <View style={[styles.root, styles.centered]} />;
  }

  // A sealed heir invite counts as something to show — an heir with no
  // vaults of their own must still see their inheritance on the home
  // screen, not a welcome page (decided 2026-07-26, found on the heir phone).
  if (wallets.length === 0 && (!(SIGNING_ENABLED || LEDGER_PREVIEW) || sealedInvites.length === 0)) {
    if (assignedVault) {
      // The meeting sits under Build it, quietly: booking it is a second
      // step, and once one stands the button gives way to a plain line.
      // Reaching this branch IS the first-run card being on screen, so the
      // offer itself is the whole question.
      const bookedMs = bookedMomentFor(setupOffer, setupSheet.justBooked);
      return (
        <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
          <TaliaLogo size={88} />
          <View style={styles.logoSpacer} />
          <Text style={styles.emptyTitle}>{firstRunTitle(assignedVault.vaultNumber)}</Text>
          <View style={styles.emptyGap} />
          <Button
            title={BUILDER_COPY.buildIt}
            onPress={() =>
              navigation.navigate('LayeredVault', {
                assigned: {
                  payerId: assignedVault.payerId,
                  vaultNumber: assignedVault.vaultNumber,
                  payerEmail: assignedVault.payerEmail,
                },
              })
            }
            style={styles.emptyCta}
          />
          {setupOffer &&
            (bookedMs != null ? (
              <Text style={styles.emptyMeeting}>{setupMeetingBookedLine(bookedMs)}</Text>
            ) : (
              <Button
                title={SETUP_MEETING_COPY.button}
                variant="ghost"
                onPress={() => setupSheet.open(setupOffer)}
                style={styles.emptySecondCta}
              />
            ))}
          {setupSheet.sheet}
        </View>
      );
    }
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
        <TaliaLogo size={88} />
        <View style={styles.logoSpacer} />
        <Text style={styles.emptyTitle}>
          Welcome aboard
        </Text>
        <Text style={styles.emptyBody}>
          {SIGNING_ENABLED || HWW_ENABLED
            ? 'Create a vault with your hardware keys, or add one you already run elsewhere.'
            : 'Add a vault you already run elsewhere to watch it here.'}
        </Text>
        <Button
          title="Add a vault"
          onPress={() => navigation.navigate('AddWallet')}
          style={styles.emptyCta}
        />
      </View>
    );
  }

  return (
    // Safe-area padding lives on the NON-scrolling root: scrolled content
    // clips below the status bar instead of colliding with the clock.
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(w) => w.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[styles.list, { paddingTop: theme.spacing.sm }]}
        scrollIndicatorInsets={{ bottom: 96 }}
        onScroll={(e) => {
          lastScrollY.current = e.nativeEvent.contentOffset.y;
          dockFollowScroll(lastScrollY.current);
        }}
        scrollEventThrottle={32}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onPull} tintColor={theme.colors.gold} />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.topBar}>
              <View style={styles.brandRow}>
                {/* As tall as the round buttons beside it (decided 2026-09-12). */}
                <TaliaLogo size={40} variant="lockup" />
              </View>
              <View style={styles.topBarSpacer} />
              <HeaderIconButton label="Scan an address" onPress={() => navigation.navigate('Scan')}>
                <ScanGlyph />
              </HeaderIconButton>
              <HeaderIconButton label="Add wallet" onPress={() => navigation.navigate('AddWallet')}>
                <PlusIcon size={20} strokeWidth={2.5} />
              </HeaderIconButton>
            </View>

            <TouchableOpacity
              style={styles.totalBlock}
              activeOpacity={0.7}
              onPress={async () => {
                if (hidden && settings.requireAuthToUnhide) {
                  if (!(await requireAuth('Show balances'))) return;
                }
                void updateSettings({ hideBalances: !hidden });
              }}>
              <Text style={styles.totalLabel}>Total Balance</Text>
              <FitText style={styles.totalValue} minimumFontScale={0.55}>
                {hidden ? MASK : formatAmount(totalSats, settings.unit)}
              </FitText>
              {fiatRate != null && (
                <Text style={styles.totalFiat}>
                  {hidden ? '••••' : formatFiat(totalSats, fiatRate, settings.fiat)}
                </Text>
              )}
            </TouchableOpacity>

            {settings.showHomeChart !== false && !settings.btcOnly && (
              <View style={styles.chartBlock}>
                <Animated.View
                  style={{
                    transform: [
                      {
                        rotate: jiggle.interpolate({
                          inputRange: [-1, 1],
                          outputRange: ['-1.4deg', '1.4deg'],
                        }),
                      },
                    ],
                  }}>
                  <PriceChart
                    currency={settings.fiat}
                    onPress={() => {
                      if (chartRemovable) setChartRemovable(false);
                      else navigation.navigate('PriceHistory');
                    }}
                    onLongPress={() => setChartRemovable(true)}
                  />
                </Animated.View>
                {chartRemovable && (
                  <TouchableOpacity
                    style={styles.chartRemoveBtn}
                    onPress={() => {
                      setChartRemovable(false);
                      void updateSettings({ showHomeChart: false });
                    }}
                    accessibilityLabel="Remove chart from Home">
                    {/* No glow: the red fill means remove; white on the red. */}
                    <Gloss size={REMOVE_BTN} radius={REMOVE_BTN / 2} glow={false} />
                    <MinusIcon size={16} strokeWidth={2.5} color={theme.colors.white} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {shownExpiring && (
              <NoticeBanner
                icon={<ClockIcon size={20} color={theme.colors.gold} />}
                numberOfLines={2}
                style={styles.expiryBanner}
                onPress={() => navigation.navigate('WalletDetail', { walletId: shownExpiring.id })}>
                {/* The vault page's words too (decided 2026-09-22), true for any
                    vault; refresh is advised only to the vault's owner. */}
                {timelockNotice({
                  blocks: shownExpiring.blocks,
                  vaultLabel: shownExpiring.label,
                  refreshAdvised: !wallets.find((w) => w.id === shownExpiring.id)?.heirVault,
                })}
              </NoticeBanner>
            )}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionTitle} onLongPress={() => setArranging(true)}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => {
          const sealed = (item as unknown as { __sealed?: ClaimedInviteRecord }).__sealed;
          if (sealed) {
            return (
              <SealedInviteCard
                record={sealed}
                onPress={() => navigation.navigate('ClaimInvite')}
              />
            );
          }
          return (
            <WalletCard
              wallet={item}
              unit={settings.unit}
              fiatRate={fiatRate}
              fiat={settings.fiat}
              hidden={hidden || !!item.balanceHidden}
              onPress={() => {
                if (item.locked) {
                  void activateLockedVault(item);
                  return;
                }
                navigation.navigate('WalletDetail', { walletId: item.id });
              }}
              onLongPress={() => setArranging(true)}
            />
          );
        }}
      />
      <ArrangeModal visible={arranging} onClose={() => setArranging(false)} />
      <AppDialog
        visible={checkoutRefusal !== null}
        title={checkoutRefusal ?? ''}
        actions={[{ label: 'OK', onPress: () => setCheckoutRefusal(null) }]}
        onClose={() => setCheckoutRefusal(null)}
      />
      {planJustActivated && (
        <View style={styles.activatedToast} pointerEvents="none">
          <Text style={styles.activatedText}>Plan activated. Your vault is ready</Text>
        </View>
      )}
      {authModal}
    </View>
  );
}

/** Viewfinder-style scan glyph: four thin corners around a center line. */
function ScanGlyph(): React.JSX.Element {
  return (
    <View style={scanStyles.box}>
      <View style={[scanStyles.corner, scanStyles.tl]} />
      <View style={[scanStyles.corner, scanStyles.tr]} />
      <View style={[scanStyles.corner, scanStyles.bl]} />
      <View style={[scanStyles.corner, scanStyles.br]} />
      <View style={scanStyles.beam} />
    </View>
  );
}

const C = 6;
const scanStyles = themedStyles(() => StyleSheet.create({
  box: { width: 18, height: 18 },
  corner: {
    position: 'absolute',
    width: C,
    height: C,
    borderColor: theme.colors.offWhite,
  },
  tl: { top: 0, left: 0, borderTopWidth: 1.5, borderLeftWidth: 1.5 },
  tr: { top: 0, right: 0, borderTopWidth: 1.5, borderRightWidth: 1.5 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
  br: { bottom: 0, right: 0, borderBottomWidth: 1.5, borderRightWidth: 1.5 },
  beam: {
    position: 'absolute',
    top: 8,
    left: 2,
    right: 2,
    height: 1.5,
    backgroundColor: theme.colors.offWhite,
  },
}));

/** A sealed heir invite on the home list: the vault is VISIBLE, its
 *  contents are not — nothing exists on the device until release, by
 *  design. Tapping opens the claim screen (countdown / activate). */
function SealedInviteCard({
  record,
  onPress,
}: {
  record: ClaimedInviteRecord;
  onPress: () => void;
}): React.JSX.Element {
  // The status lives on the LEFT (like a wallet's ticker line) — a long
  // string in the right column squeezed the label to "Te…" (decided 2026-07-26).
  // A countdown only for a timelocked key (decided 2026-09-22).
  const sub = sealedCardLine(record, Date.now());
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={styles.card}>
      <Gloss radius={theme.radius.lg} strength={cardGlow()} />
      <WalletIconTile icon="users-group" />
      <View style={styles.cardLeft}>
        <Text style={[styles.cardName, styles.lockedText]} numberOfLines={2}>
          {record.vaultLabel}
        </Text>
        <Text style={[styles.cardTicker, styles.lockedText]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <View style={styles.cardRight}>
        <View style={styles.cardBalanceRow}>
          <Text style={[styles.cardBalance, styles.lockedText]} numberOfLines={1}>
            Sealed
          </Text>
        </View>
        <Text style={[styles.cardFiat, styles.lockedText]}> </Text>
      </View>
    </TouchableOpacity>
  );
}

function WalletCard({
  wallet,
  unit,
  fiatRate,
  fiat,
  hidden,
  onPress,
  onLongPress,
}: {
  wallet: WalletMeta;
  unit: AmountUnit;
  fiatRate: number | null;
  fiat: Parameters<typeof formatFiat>[2];
  hidden: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}): React.JSX.Element {
  const hasBalance = wallet.cachedBalanceSats != null;
  return (
    <TouchableOpacity onPress={onPress} onLongPress={onLongPress} activeOpacity={0.85} style={styles.card}>
      {/* The app icon's finish, so a card reads as one raised pane (decided
          2026-09-16). It brings its own top-lit edge; the card carries no
          border of its own. */}
      <Gloss radius={theme.radius.lg} strength={cardGlow()} />
      <WalletIconTile
        icon={walletIconFor(wallet)}
      />
      <View style={styles.cardLeft}>
        {/* A long name wraps to a second line rather than ending in "…"
            (decided 2026-09-07). */}
        <Text style={[styles.cardName, wallet.locked && styles.lockedText]} numberOfLines={2}>
          {wallet.label}
        </Text>
        {wallet.locked || wallet.manual ? (
          <Text style={[styles.cardTicker, wallet.locked && styles.lockedText]}>
            {wallet.locked
              ? 'Locked. Tap to activate'
              : // No descriptor to describe — and this doubles as the marker
                // explaining why this card's balance is not in the total.
                'Kept by hand'}
          </Text>
        ) : (
          <Text style={styles.cardTicker}>
            {/* The network only when it is NOT mainnet: "BTC" on every card
                said nothing, but a test vault must never be mistaken for a
                real one (decided 2026-09-09). */}
            {/* Nothing here about who pays (decided 2026-09-20): a vault somebody
                else's plan pays for reads as fully its owner's. */}
            {wallet.network === 'bitcoin'
              ? sigTypeLabel(wallet.descriptor)
              : `${NETWORK_TICKERS[wallet.network]} · ${sigTypeLabel(wallet.descriptor)}`}
          </Text>
        )}
      </View>
      <View style={styles.cardRight}>
        <View style={styles.cardBalanceRow}>
          {/* Auto mixes units across cards — each amount carries its sign
              (₿ or the satsymbol) so a glance can't misread it. */}
          {unit === 'auto' && !hidden && hasBalance &&
            (resolveUnit(wallet.cachedBalanceSats!, 'auto') === 'btc' ? (
              <CurrencyBitcoinIcon size={15} strokeWidth={2.2} color={wallet.locked ? theme.colors.faint : theme.colors.offWhite} />
            ) : (
              <SatoshiIcon size={15} strokeWidth={2.2} color={wallet.locked ? theme.colors.faint : theme.colors.offWhite} />
            ))}
          <FitText style={[styles.cardBalance, wallet.locked && styles.lockedText]}>
            {wallet.locked ? 'Locked' : hidden ? '•••' : hasBalance ? formatCardAmount(wallet.cachedBalanceSats!, unit) : '-'}
          </FitText>
        </View>
        {!hidden && hasBalance && fiatRate != null && wallet.network === 'bitcoin' ? (
          <Text style={[styles.cardFiat, wallet.locked && styles.lockedText]}>
            {formatFiat(wallet.cachedBalanceSats!, fiatRate, fiat)}
          </Text>
        ) : (
          <Text style={[styles.cardFiat, wallet.locked && styles.lockedText]}>{hidden || hasBalance ? ' ' : 'tap to sync'}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing.xl },
  // Bottom padding clears the floating nav pill (~64px + safe area) so the
  // last wallet card can always scroll fully into view.
  list: { paddingBottom: 140, paddingHorizontal: theme.spacing.lg },

  logoSpacer: { height: theme.spacing.lg },
  emptyTitle: { ...theme.typography.title, color: theme.colors.offWhite, marginBottom: theme.spacing.sm },
  emptyBody: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
  emptyCta: { alignSelf: 'stretch' },
  /** A second, quieter call to action under the first one. It sits the same
   *  distance below "Build it" as the booked line that replaces it, so the
   *  card does not jump when one gives way to the other. */
  emptySecondCta: { alignSelf: 'stretch', marginTop: theme.spacing.md },
  /** Stands in for the welcome text's bottom margin when there is no text. */
  emptyGap: { height: theme.spacing.xl - theme.spacing.sm },
  /** The plain line that replaces the setup meeting button once one stands. */
  emptyMeeting: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
    marginTop: theme.spacing.md,
  },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  brandWordmark: {
    color: theme.colors.offWhite,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 4,
  },
  topBarSpacer: { flex: 1 },

  // The hero (decided 2026-09-12, Revolut-style): air above, the balance centred
  // in the upper part of the screen, the fiat figure under it.
  totalBlock: { marginTop: theme.spacing.xxl + theme.spacing.lg, marginBottom: theme.spacing.lg, alignItems: 'center', gap: theme.spacing.xs },
  chartBlock: { marginTop: theme.spacing.md, marginBottom: theme.spacing.sm },
  chartRemoveBtn: {
    position: 'absolute',
    top: theme.spacing.md - REMOVE_BTN / 2,
    left: -REMOVE_BTN / 2,
    width: REMOVE_BTN,
    height: REMOVE_BTN,
    borderRadius: REMOVE_BTN / 2,
    backgroundColor: theme.colors.negative,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.black,
    shadowOpacity: 0.4,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  // The one hero label (theme `heroLabel`), shared with Home, the Portfolio tab,
  // the vault page and "Vault built".
  totalLabel: heroLabel(),
  totalValue: { ...heroFigure(), paddingHorizontal: theme.spacing.md },
  totalFiat: { ...theme.typography.heroCaption, color: theme.colors.slate, textAlign: 'center' },

  // The notice itself is NoticeBanner; here only its place on the page.
  expiryBanner: { marginTop: theme.spacing.md },

  // Section header over the wallet list — heading token, dimmed like the
  // Portfolios header on the Virtual tab so it reads apart from the card
  // names below it (which are also offWhite).
  sectionTitle: {
    ...theme.typography.heading,
    color: theme.colors.faint,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },

  // Flat rounded card: icon | name+ticker | balance+fiat.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    // Raised, with the app icon's finish on top (decided 2026-09-16: "make the
    // containers of the vaults and portfolios a tiny bit more bright to give
    // it a little more of a bubble effect"). The Gloss brings its own top-lit
    // edge, so the hairline border goes, and the card clips to its corners.
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  cardLeft: { flex: 1, gap: 2, minWidth: 0 },
  cardName: { ...theme.typography.heading, color: theme.colors.offWhite },
  cardTicker: { ...theme.typography.caption, color: theme.colors.slate },
  // A locked or sealed card's text (decided 2026-10-05: a state is a colour, never opacity).
  lockedText: { color: theme.colors.faint },
  activatedToast: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  activatedText: { ...theme.typography.heading, color: theme.colors.accentInk },
  cardRight: { alignItems: 'flex-end', gap: 2 },
  cardBalanceRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs, maxWidth: 170 },
  cardBalance: {
    ...theme.typography.heading,
    color: theme.colors.offWhite,
    fontVariant: ['tabular-nums'],
  },
  cardFiat: { ...theme.typography.caption, color: theme.colors.slate },

}));
