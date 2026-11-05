/**
 * A manual wallet's detail screen — the stand-in for WalletDetail on holdings
 * Talia does not watch. Same shape as a real wallet (balance, value, history)
 * so it feels like the rest of the app, with every on-chain action absent
 * rather than disabled: there is no receive address, no send, no policy.
 *
 * The balance is written back to `cachedBalanceSats` via recordBalance so the
 * home-screen card renders it exactly like any other wallet, with no special
 * case in the list.
 *
 * Built like the vault page (decided 2026-09-12, "match that"): our own header
 * (back · empty middle · ⋯), an Animated list whose header block holds the
 * portfolio's own content, and ONE balance number that rests centred under
 * the name and rises into the title slot as the list scrolls. Its value
 * time-travels: the topmost visible entry dates it ("as of <day>", running
 * balance from wallet/manualLedger.ts manualRunningBalance).
 *
 * Opens instantly (decided 2026-09-12): the last known entries paint from the
 * in-memory mirror in wallet/manualEntries.ts, the figure from the wallet's
 * cachedBalanceSats until they are known, and the exchange check starts
 * only once the push animation and the first paint have landed.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  InteractionManager,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { AppModal, cardGlow , FitText } from '../components';
import type { ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { VirtualStackParamList } from '../navigation/types';
import { exportTextToFile } from '../../platform/files';
import { useEntryFx } from '../hooks/useEntryFx';
import { BlurView } from '@react-native-community/blur';
import { getColorScheme, heroLabel, theme, themedStyles } from '../theme';
import { encodeBbqr, utf8ToBytes } from '../../bitcoin/bbqr';
import { AppDialog, HeaderIconButton, HEADER_BTN, HEADER_BTN_ROW, HEADER_CAPTION_ROOM, MORPH_CAPTION_SIZE, MORPH_CAPTION_MAX_SCALE, MORPH_CAPTION_TOP, ChevronLeftIcon, ChevronRightIcon, AnimatedQr, Button, DraggableSheet, FACT_LABEL_SHARE, HeaderBackButton, TxDirectionIcon, LedgerRowContent, morphCaptionWidth, factsStacked, PageGlow, Gloss, PageFooter, FOOTER_ROOM } from '../components';
import { DotsIcon } from '../components/TablerIcons';
import { useRequireAuth } from '../auth/useRequireAuth';
import { useLiveRate } from '../hooks/useLiveRate';
import {
  isSharedViewer,
  EDITABLE_EXPORT_ACTIONS,
  mayExportEditableCopy,
  fiatSymbol,
  serializeManualVault,
  formatAmount,
  formatFiat,
  formatMoney,
  displayNote,
  exchangeLinksOf,
  formatRelativeTime,
  loadManualEntries,
  manualRunningBalance,
  manualSummary,
  manualUnrealizedFiat,
  peekManualEntries,
  useWallets,
  fiatDecimals,
} from '../../wallet';
import type { AmountUnit, FiatCurrency, ManualEntry, ManualLedgerEntry } from '../../wallet';
import { useExchangeSync } from '../hooks/useExchangeSync';
import { formatChange } from '../../wallet/marketFormat';
import { loadSession } from '../../services/companyAuth';
import { fetchMyShares } from '../../services/sharedPortfolio';

type Props = NativeStackScreenProps<VirtualStackParamList, 'ManualWallet'>;
/** A follow-up Kraken check is due when the last one is older than this. */
const KRAKEN_RECHECK_MS = 15 * 60_000;

/** What the morphing balance is currently showing. */
interface ShownBalance {
  sats: number;
  /** Day label of the topmost visible entry. */
  asOf?: string;
}

// ——— The morph's geometry, the vault page's numbers ————————————————
/** Scroll distance over which the hero number completes its journey. */
const MORPH_RANGE = 110;
/** Gap between the header band and the portfolio's name above the number:
 *  the air at the top that was asked for (decided 2026-09-12), as on the home screen. */
const HERO_GAP = 40;
/** Height reserved in the list header where the number visually rests. */
const NUMBER_BLOCK_H = 48;
/** The portfolio's name above the number, the same quiet line as a vault's. */
const NAME_BLOCK_H = 22;
/** Final scale of the 40pt number when docked in the title slot (~17pt). */
const END_SCALE = 0.425;


export function ManualWalletScreen({ route, navigation }: Props): React.JSX.Element {
  const walletId = route.params.walletId;
  const { wallets, getWallet, settings, recordBalance, updateWallet, removeWallet, syncVirtualVaults } = useWallets();
  const { requireAuth, authModal } = useRequireAuth();
  const wallet = getWallet(walletId);
  // Instant open: whatever the mirror already knows paints on the first
  // frame; `entriesKnown` stays false only on the first open after launch
  // when nothing has read this portfolio yet, so the empty state and the
  // hints cannot flash before the storage read lands.
  const [entries, setEntries] = useState<ManualEntry[]>(() => peekManualEntries(walletId) ?? []);
  const [entriesKnown, setEntriesKnown] = useState<boolean>(() => peekManualEntries(walletId) != null);
  const [exportStep, setExportStep] = useState<'qr' | null>(null);
  // The ⋯ menu, the same sheet a vault has (decided 2026-09-07: "just like the
  // one we have for vaults"): Sync portfolio, then Export as a second level.
  // Rename and delete live on the Arrange screen, as for vaults.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuMode, setMenuMode] = useState<'main' | 'export'>('main');
  const links = wallet ? exchangeLinksOf(wallet) : [];
  const hasEntries = entries.length > 0;
  const { width: screenW } = useWindowDimensions();
  // The docked "as of" caption keeps a width of its own, never the
  // number's (decided 2026-09-07: the number's width folded it into three tiny
  // lines): all the room between the header buttons, in the block's unscaled
  // points, so a larger text size still fits the day (decided 2026-10-22).
  const captionW = morphCaptionWidth(screenW, theme.spacing.lg + HEADER_BTN + theme.spacing.sm, END_SCALE);
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;

  // The SAME live feed as the home-screen ticker — one tick per second. The
  // first version fetched its own REST spot, which failed on a phone
  // while the home price visibly ticked ("we are already fetching the fiat
  // price into the app!", after a phone test on 2026-08-25).
  const rate = useLiveRate(settings.fiat, !settings.btcOnly);
  // Conversions for entries recorded in ANOTHER currency (decided 2026-08-25:
  // "must work across ALL supported fiat currencies"): each converts at the
  // exchange rate on ITS OWN date, from the same cached historical feed the
  // ledger already uses. Unconvertible entries are disclosed, never guessed.
  // One hook, shared with the statement screen, so the two cannot drift.
  const fxMap = useEntryFx(entries, settings.fiat);

  const reloadEntries = useCallback(() => {
    void loadManualEntries(walletId).then((loaded) => {
      setEntries(loaded);
      setEntriesKnown(true);
    });
  }, [walletId]);

  // Reload on focus: the entry screen pushes on top of this one, so returning
  // from it must show the new entry without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadManualEntries(walletId).then((loaded) => {
        if (cancelled) return;
        setEntries(loaded);
        setEntriesKnown(true);
      });
      return () => {
        cancelled = true;
      };
    }, [walletId]),
  );

  // The provider's loops (a linked vault's fresh activity, a shared
  // portfolio's round) write entries while this screen is open and stamp
  // the wallet; follow the stamp so they show without leaving and coming
  // back. The mount value is skipped: the focus reload already covers it.
  const stamp = wallet?.manualUpdatedAt;
  const seenStamp = useRef(stamp);
  useEffect(() => {
    if (stamp === seenStamp.current) return;
    seenStamp.current = stamp;
    reloadEntries();
  }, [stamp, reloadEntries]);

  // Exchanges (decided 2026-09-07): one automatic check per visit and per
  // exchange when its last one is old enough; Sync now and Disconnect live
  // on the Sync portfolio screen.
  const kraken = useExchangeSync(wallet, 'kraken', reloadEntries);
  const coinbase = useExchangeSync(wallet, 'coinbase', reloadEntries);
  const syncsRef = useRef({ kraken: kraken.runSync, coinbase: coinbase.runSync });
  syncsRef.current = { kraken: kraken.runSync, coinbase: coinbase.runSync };
  // Read at focus time through a ref: the callback below is only rebuilt
  // when an exchange is connected or removed, and a closure over `links`
  // would keep the lastSyncAt from before the check that just ran, so
  // every return to the screen would check again inside the window.
  const linksRef = useRef(links);
  linksRef.current = links;
  const linkStamp = links.map((l) => `${l.exchange}:${l.connectedAt}`).join(',');
  useFocusEffect(
    useCallback(() => {
      const due = linksRef.current.filter(
        (l) => l.lastSyncAt == null || Date.now() - l.lastSyncAt >= KRAKEN_RECHECK_MS,
      );
      if (due.length === 0) return;
      // The entries already on screen come first (decided 2026-09-12): the check
      // starts once the push animation and the first paint have landed, the
      // way a vault's sync waits, and the list updates when it lands.
      const task = InteractionManager.runAfterInteractions(() => {
        for (const l of due) void syncsRef.current[l.exchange](true);
      });
      return () => task.cancel();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkStamp]),
  );
  // Pull down to refresh (decided 2026-09-14: a shared portfolio only updated
  // for the others once they closed and reopened the app). One pull runs
  // the portfolio round (the shared portfolio's changes included) and every
  // connected exchange, then re-reads the entries.
  const [refreshing, setRefreshing] = useState(false);
  const onPull = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        syncVirtualVaults(),
        ...linksRef.current.map((l) => syncsRef.current[l.exchange](true)),
      ]);
      reloadEntries();
    } finally {
      setRefreshing(false);
    }
  }, [syncVirtualVaults, reloadEntries]);
  const anySyncing = kraken.syncing || coinbase.syncing;
  const syncNote = kraken.note ?? coinbase.note ?? links.find((l) => l.lastError)?.lastError;
  const lastChecked = links.reduce<number | undefined>(
    (m, l) => (l.lastSyncAt != null && (m == null || l.lastSyncAt < m) ? l.lastSyncAt : m),
    undefined,
  );
  // Vaults feeding this portfolio (their link points here).
  const feedingVaults = useMemo(
    () => wallets.filter((w) => !w.manual && w.linkedPortfolioId === walletId),
    [wallets, walletId],
  );

  // Shared portfolio (decided 2026-09-12): how many OTHER people are in it, for
  // the caption under the header. One check per visit, at most once a minute.
  const share = wallet?.sharedPortfolio;
  const shareActive = !!share && !share.ended;
  // Joined by invite: this phone shows the owner's portfolio and changes
  // nothing in it (decided 2026-09-14).
  const viewer = isSharedViewer(wallet);
  // The owner stopped sharing, or this phone was removed from the share: the
  // copy is announced and then removed, never silently kept (decided 2026-09-14).
  const sharingEnded = !!share && share.role === 'member' && !!share.ended;
  const shareId = share?.shareId;
  const [shareCount, setShareCount] = useState<number | null>(null);
  const shareCheckedAt = useRef(0);
  useFocusEffect(
    useCallback(() => {
      if (!shareActive || !shareId) return;
      if (Date.now() - shareCheckedAt.current < 60_000) return;
      let cancelled = false;
      void (async () => {
        try {
          const session = await loadSession();
          if (!session) return;
          const mine = (await fetchMyShares(session)).find((s) => s.shareId === shareId);
          if (cancelled || !mine) return;
          shareCheckedAt.current = Date.now();
          const me = session.email?.toLowerCase();
          setShareCount(mine.members.filter((m) => m.email.toLowerCase() !== me).length);
        } catch {
          // offline: the caption stays generic
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [shareActive, shareId]),
  );
  const shareLine = !share
    ? undefined
    : share.ended
      ? // The server cannot tell a member whether the owner stopped sharing or
        // removed them, so the caption says what holds either way.
        share.role === 'owner'
        ? 'Sharing has stopped'
        : 'No longer shared with you'
      : share.role === 'member'
        ? 'Shared with you · view only'
      : shareCount == null
        ? 'Shared portfolio'
        : shareCount === 0
          ? 'Shared, nobody has joined yet'
          : `Shared with ${shareCount} ${shareCount === 1 ? 'person' : 'people'}`;

  const summary = useMemo(
    () => manualSummary(entries, settings.fiat, fxMap),
    [entries, settings.fiat, fxMap],
  );
  // Newest first, each row carrying the balance as of that entry.
  const ledger = useMemo(() => manualRunningBalance(entries), [entries]);

  // Until the entries are known, the figure is the one the home card shows,
  // so the first frame never reads 0 for a portfolio that holds coins.
  const balance = entriesKnown ? summary.balanceSats : wallet?.cachedBalanceSats ?? 0;
  // Keep the home card in step with the ledger.
  const recorded = wallet?.cachedBalanceSats;
  useEffect(() => {
    if (!entriesKnown || !wallet) return;
    if (recorded !== balance) recordBalance(wallet.id, balance);
  }, [entriesKnown, wallet, recorded, balance, recordBalance]);

  // Time-travel: the topmost visible entry dates the balance. Only its id is
  // remembered, so a reload (a sync landing, an edit) re-derives the figure
  // from the fresh ledger instead of showing a stale one.
  const [topEntryId, setTopEntryId] = useState<string | null>(null);
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems.find(
        (v) => v.item && typeof (v.item as ManualLedgerEntry).balanceAfter === 'number',
      );
      if (!first) return;
      const id = (first.item as ManualLedgerEntry).id;
      setTopEntryId((prev) => (prev === id ? prev : id));
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;
  const shown = useMemo<ShownBalance>(() => {
    const top = topEntryId != null ? ledger.find((e) => e.id === topEntryId) : undefined;
    return top ? { sats: top.balanceAfter, asOf: dayLabelFor(top.date) } : { sats: balance };
  }, [ledger, topEntryId, balance]);

  const openMenu = useCallback(() => {
    setMenuMode('main');
    setMenuOpen(true);
  }, []);

  const onMenuAction = useCallback(
    (action: string): void => {
      if (!wallet) return;
      // A member never takes an EDITABLE copy (decided 2026-09-14): the Talia QR
      // and the backup file both re-import as an ordinary portfolio, which
      // would outlive the share the owner is free to end and survive the copy
      // this phone deletes when it does. The account statement is a document
      // to read, so it stays. The menu already hides these two rows; this is
      // the backstop, as everywhere else a viewer is kept out.
      if (EDITABLE_EXPORT_ACTIONS.has(action) && !mayExportEditableCopy(wallet)) {
        setMenuOpen(false);
        return;
      }
      switch (action) {
        case 'back':
          setMenuMode('main');
          break;
        case 'exportMenu':
          setMenuMode('export');
          break;
        case 'sync':
          setMenuOpen(false);
          // The sheet is a Modal: let it dismiss before the push, or the push
          // is swallowed (the repo's known iOS modal-stacking trap).
          setTimeout(() => navigation.navigate('PortfolioSync', { walletId: wallet.id }), 400);
          break;
        case 'share':
          setMenuOpen(false);
          setTimeout(() => navigation.navigate('SharePortfolio', { walletId: wallet.id }), 400);
          break;
        case 'qr':
          setMenuOpen(false);
          setTimeout(() => setExportStep('qr'), 400);
          break;
        case 'statement':
          setMenuOpen(false);
          setTimeout(() => navigation.navigate('PortfolioStatement', { walletId: wallet.id }), 400);
          break;
        case 'backup':
          setMenuOpen(false);
          // Back by request (decided 2026-08-26): the file people keep as a
          // BACKUP; it is what "Import from a file" restores.
          setTimeout(() => {
            void exportTextToFile(
              `${slugName(wallet.label)}.talia-vault.json`,
              serializeManualVault(wallet.label, entries, Date.now(), wallet.icon),
            ).catch(() => {});
          }, 400);
          break;
      }
    },
    [wallet, entries, navigation],
  );

  // ——— The morph ———————————————————————————————————————————————
  // The number rests below the header and docks exactly into its empty
  // centre. It is centred both at rest and in the title slot (the vault
  // page's rule since 2026-09-12), so it only rises and shrinks: the
  // container spans the width and scales about its centre.
  const headerTop = insets.top + theme.spacing.xs;
  const numberRestTop = headerTop + HEADER_BTN_ROW + HERO_GAP + NAME_BLOCK_H;
  const restCenterY = numberRestTop + NUMBER_BLOCK_H / 2;
  const dockCenterY = headerTop + HEADER_BTN_ROW / 2 - 7; // sit slightly high in the slot
  const translateYEnd = dockCenterY - restCenterY;
  const morphY = scrollY.interpolate({
    inputRange: [0, MORPH_RANGE * 0.65],
    outputRange: [0, translateYEnd],
    extrapolate: 'clamp',
  });
  const morphScale = scrollY.interpolate({
    inputRange: [0, MORPH_RANGE],
    outputRange: [1, END_SCALE],
    extrapolate: 'clamp',
  });
  const captionOpacity = scrollY.interpolate({
    inputRange: [MORPH_RANGE * 0.5, MORPH_RANGE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const subOpacity = scrollY.interpolate({
    inputRange: [0, MORPH_RANGE * 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  // The name scrolls with the list while the number stays pinned: on an
  // overscroll the name fades before it can slide up behind the digits.
  const nameOpacity = scrollY.interpolate({
    inputRange: [-12, 0],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  if (!wallet) {
    return (
      <View style={styles.root}>
        <View style={[styles.customHeader, { paddingTop: headerTop }]}>
        <PageGlow fill />
          <HeaderBackButton />
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.muted}>Portfolio not found.</Text>
      </View>
    );
  }

  const unrealized = rate != null ? manualUnrealizedFiat(summary, rate) : undefined;
  const showFiat = !settings.btcOnly && rate != null;
  // Same privacy contract as an on-chain vault (decided 2026-08-25): the global
  // hide-balances switch and the per-wallet flag both mask, tapping the
  // balance toggles, and unhiding honours require-auth-to-unhide.
  const masked = settings.hideBalances || !!wallet.balanceHidden;
  const toggleHidden = async (): Promise<void> => {
    if (wallet.balanceHidden && settings.requireAuthToUnhide) {
      if (!(await requireAuth('Show this balance'))) return;
    }
    void updateWallet(wallet.id, { balanceHidden: !wallet.balanceHidden });
  };
  // P/L headline against the live price (decided 2026-08-25). Only over entries
  // that carry a price — no cost recorded means no P/L, never a made-up one.
  const pnlPct =
    unrealized != null && summary.holdingsCostFiat != null && summary.holdingsCostFiat > 0
      ? (unrealized / summary.holdingsCostFiat) * 100
      : undefined;

  const decimals = fiatDecimals(settings.fiat);
  const money = (n: number): string => formatMoney(n, decimals);
  // Anything a row reads besides its own entry: the list is pure and would
  // otherwise keep stale rows when one of these changes.
  const rowExtra = { masked, fxMap, unit: settings.unit, fiat: settings.fiat, btcOnly: settings.btcOnly, decimals };

  const listHeader = (
    <View style={styles.hero}>
      <View style={styles.heroCentre}>
        {/* The number itself is the animated overlay; reserve its resting
            space under the name. */}
        <View style={styles.nameBlock}>
          <Animated.Text style={[styles.heroName, { opacity: nameOpacity }]} numberOfLines={1}>
            {wallet.label}
          </Animated.Text>
        </View>
        <Animated.View style={[styles.heroSub, { opacity: subOpacity }]}>
          {showFiat && (
            <Text style={styles.fiat}>
              {masked ? '••••' : formatFiat(balance, rate, settings.fiat)}
            </Text>
          )}
          {/* No priced entries yet = no P/L to show. Say WHY instead of
              silently omitting the number that was asked for. */}
          {entriesKnown && showFiat && unrealized == null && balance > 0 && !masked && (
            <Text style={styles.pnlHint}>
              {summary.unconvertedEntries > 0
                ? // Their prices ARE recorded — telling them to record prices
                  // would be wrong. The conversion just hasn't landed.
                  'Your recorded prices are in another currency and could not be converted yet.'
                : 'Record what you paid on your buys to see your profit or loss.'}
            </Text>
          )}
          {showFiat && unrealized != null && (
            <Text style={[styles.pnl, unrealized >= 0 ? styles.toneGood : styles.toneBad]}>
              {masked
                ? '••••'
                : formatChange(unrealized, pnlPct, settings.fiat)}
            </Text>
          )}
          {/* When prices don't cover the whole balance, the P/L is scoped to
              what they DO cover — and the scope is part of the figure. */}
          {showFiat && unrealized != null && summary.uncoveredHeldSats > 0 && !masked && (
            <Text style={styles.pnlHint}>
              {summary.unconvertedEntries > 0
                ? // The missing part IS priced — in another currency, awaiting
                  // conversion. "Has none" would send them re-typing prices.
                  `On the ${formatAmount(summary.coveredHeldSats, settings.unit)} counted so far. ${formatAmount(summary.uncoveredHeldSats, settings.unit)} is waiting on a currency conversion or has no recorded price.`
                : `On the ${formatAmount(summary.coveredHeldSats, settings.unit)} with recorded prices. ${formatAmount(summary.uncoveredHeldSats, settings.unit)} has none.`}
            </Text>
          )}
        </Animated.View>
        {shareLine && (
          <TouchableOpacity
            style={styles.shareLine}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('SharePortfolio', { walletId: wallet.id })}
            accessibilityRole="button"
            accessibilityLabel="Shared with">
            <Text style={styles.shareText}>{shareLine}</Text>
            {shareActive && share?.lastError ? (
              <Text style={styles.shareNote}>{share.lastError}</Text>
            ) : null}
          </TouchableOpacity>
        )}
      </View>

      {summary.oversold && (
        <View style={styles.warn}>
          <Gloss radius={theme.radius.md} strength={cardGlow()} />
          <Text style={styles.warnTitle}>This portfolio is short</Text>
          <Text style={styles.warnText}>
            The sells add up to more than the buys, so the balance has gone below
            zero. One entry below is probably wrong.{viewer ? ' Only the owner can correct it.' : ' Tap it to correct or remove it.'}
          </Text>
        </View>
      )}

      {showFiat && (summary.avgBuyPriceFiat != null || summary.unconvertedEntries > 0) && !masked && (
        <View style={styles.card}>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          {summary.avgBuyPriceFiat != null && (
          // One line (decided 2026-09-12): the label and the price, nothing after it.
          <Row
            label="Average price"
            value={`${fiatSymbol(settings.fiat)}${money(summary.avgBuyPriceFiat)}`}
          />
          )}
          {summary.holdingsCostFiat != null && (
            <Row
              label={
                summary.uncoveredHeldSats > 0
                  ? `What the priced ${formatAmount(summary.coveredHeldSats, settings.unit)} cost`
                  : 'What these coins cost'
              }
              value={`${fiatSymbol(settings.fiat)}${money(summary.holdingsCostFiat)}`}
            />
          )}
          {unrealized != null && (
            <Row
              label={unrealized >= 0 ? 'Up by' : 'Down by'}
              value={`${fiatSymbol(settings.fiat)}${money(Math.abs(unrealized))}`}
              tone={unrealized >= 0 ? 'good' : 'bad'}
            />
          )}
          {summary.realizedProceedsFiat > 0 && (
            <Row
              label="Received from sells"
              value={`${fiatSymbol(settings.fiat)}${money(summary.realizedProceedsFiat)}`}
            />
          )}
          {/* No note about converted entries here (decided 2026-09-12): each entry
              says so on its own screen. Entries that could NOT be converted
              still get a line, because they are left out of these sums. */}
          {summary.unconvertedEntries > 0 && (
            <Text style={styles.cardNote}>
              {summary.unconvertedEntries === 1
                ? 'One entry is in another currency and could not be converted yet, so it is not counted.'
                : `${summary.unconvertedEntries} entries are in other currencies and could not be converted yet, so they are not counted.`}
            </Text>
          )}
        </View>
      )}

      {!viewer && (links.length > 0 || feedingVaults.length > 0) && (
        <TouchableOpacity
          style={styles.sources}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('PortfolioSync', { walletId: wallet.id })}
          accessibilityRole="button"
          accessibilityLabel="Sync portfolio">
          <Text style={styles.sourcesText} numberOfLines={2}>
            {sourcesLine(
              links.map((l) => (l.exchange === 'kraken' ? 'Kraken' : 'Coinbase')),
              feedingVaults.map((v) => v.label),
            )}
            {links.length > 0 && (
              <Text style={styles.sourcesStatus}>
                {anySyncing ? '  ·  Checking' : lastChecked != null ? `  ·  synced ${formatRelativeTime(lastChecked / 1000)}` : ''}
              </Text>
            )}
          </Text>
          {syncNote && !anySyncing && <Text style={styles.sourcesNote}>{syncNote}</Text>}
        </TouchableOpacity>
      )}

      {hasEntries && <Text style={styles.listTitle}>History</Text>}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={[styles.customHeader, { paddingTop: headerTop }]}>
        <PageGlow fill />
        <HeaderBackButton />
        <View style={styles.headerSpacer} />
        <HeaderIconButton label="Portfolio menu" onPress={openMenu}>
          <DotsIcon size={20} strokeWidth={2.5} color={theme.colors.offWhite} />
        </HeaderIconButton>
      </View>
      <Animated.FlatList
        data={ledger}
        keyExtractor={(e: ManualLedgerEntry) => e.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPull} tintColor={theme.colors.gold} />}
        // Above the pinned footer the list ends at the footer's fade; a
        // viewer's page has no footer, so its list takes the safe area.
        contentContainerStyle={[styles.list, { paddingBottom: viewer ? insets.bottom + theme.spacing.lg : FOOTER_ROOM }]}
        ListHeaderComponent={listHeader}
        ItemSeparatorComponent={RowGap}
        renderItem={({ item }: { item: ManualLedgerEntry }) => (
          <EntryRow
            entry={item}
            masked={masked}
            unit={settings.unit}
            fiat={settings.fiat}
            btcOnly={settings.btcOnly}
            fx={fxMap?.get(item.id)}
            decimals={decimals}
            // Every entry opens its own page, a member's too: the page reads
            // the same for both, and only the owner's has Edit (decided
            // 2026-10-22).
            onPress={() => navigation.navigate('ManualEntryDetail', { walletId: wallet.id, entryId: item.id })}
          />
        )}
        extraData={rowExtra}
        ListEmptyComponent={
          // Nothing until the first read has answered: "nothing recorded"
          // must never flash over a portfolio that is about to show entries.
          entriesKnown ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing recorded yet</Text>
              <Text style={styles.emptyText}>
                {viewer
                  ? 'The owner has not recorded a buy or sell yet. Their entries appear here as they add them.'
                  : 'Add each buy as you make it, or sync from a vault or an exchange with the menu above. Talia keeps the total and its value.'}
              </Text>
            </View>
          ) : null
        }
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
      />

      {/* The page's one action, pinned at the foot (decided 2026-10-05). A member
          of a shared portfolio reads it: only the owner adds entries (decided
          2026-09-14), so a viewer's page has no footer at all. */}
      {!viewer && (
        <PageFooter>
          <Button
            title="Add a buy or sell"
            onPress={() => navigation.navigate('ManualEntry', { walletId: wallet.id })}
          />
        </PageFooter>
      )}

      {/* The exchange check runs behind the page: a small spinner in the
          header band, the entries and the figure already on screen. */}
      {anySyncing && (
        <View
          pointerEvents="none"
          style={[styles.syncFloat, { top: headerTop, height: HEADER_BTN_ROW }]}>
          <ActivityIndicator color={theme.colors.gold} accessibilityLabel="Checking the exchange" />
        </View>
      )}

      {/* The one balance number — travels from hero to the title slot. */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.morph,
          {
            top: numberRestTop,
            transform: [{ translateY: morphY }, { scale: morphScale }],
          },
        ]}>
        <FitText
          style={[styles.morphNumber, { maxWidth: screenW - theme.spacing.lg * 2 }]}
          minimumFontScale={0.5}
          onPress={() => void toggleHidden()}
          suppressHighlighting>
          {masked ? '•••••' : formatAmount(shown.sats, settings.unit)}
        </FitText>
        <Animated.Text
          style={[
            styles.morphCaption,
            // Centred under the number whatever its width: the caption has
            // a width of its own, and the container is the screen.
            { opacity: captionOpacity, width: captionW, left: (screenW - captionW) / 2 },
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={MORPH_CAPTION_MAX_SCALE}>
          {shown.asOf ? `as of ${shown.asOf}` : ' '}
        </Animated.Text>
      </Animated.View>

      <AppModal
        visible={menuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setMenuOpen(false)}>
          <DraggableSheet visible={menuOpen} onDismiss={() => setMenuOpen(false)} style={styles.sheet}>
            {menuMode === 'export' && <Text style={styles.sheetTitle}>Export</Text>}
            {(menuMode === 'main'
              ? [
                  // A member neither feeds this portfolio nor shares it on;
                  // "Shared with you" opens the same screen to leave it.
                  ...(viewer
                    ? [{ key: 'share', label: 'Shared with you' }]
                    : [
                        { key: 'sync', label: 'Sync portfolio' },
                        { key: 'share', label: shareActive ? 'Shared with' : 'Share portfolio' },
                      ]),
                  // A row that opens another list carries a drawn chevron,
                  // never a › in its words.
                  ...(hasEntries ? [{ key: 'exportMenu', label: 'Export', submenu: true }] : []),
                ]
              : [
                  { key: 'back', label: 'All options', back: true },
                  // A member keeps the statement, a document to read, and
                  // loses the two that re-import as an editable portfolio
                  // (decided 2026-09-14).
                  ...(viewer ? [] : [{ key: 'qr', label: 'Export to Talia' }]),
                  { key: 'statement', label: 'Account statement' },
                  ...(viewer ? [] : [{ key: 'backup', label: 'Backup file' }]),
                ]
            ).map((item, i, arr) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.sheetRow, i < arr.length - 1 && styles.sheetDivider]}
                onPress={() => onMenuAction(item.key)}>
                {(item as { back?: boolean }).back && (
                  <ChevronLeftIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                )}
                <Text style={styles.sheetText}>{item.label}</Text>
                {(item as { submenu?: boolean }).submenu && (
                  <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                )}
              </TouchableOpacity>
            ))}
          </DraggableSheet>
        </TouchableOpacity>
      </AppModal>

      <AppModal
        visible={exportStep === 'qr'}
        transparent
        animationType="fade"
        onRequestClose={() => setExportStep(null)}>
        <View style={styles.qrBackdrop}>
          <View style={styles.qrCard}>
            {/* Frosted, like every other popup (decided 2026-09-12). */}
            <BlurView
              style={StyleSheet.absoluteFill}
              blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
              blurAmount={24}
              reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
            />
            <View style={styles.glassTint} pointerEvents="none" />
            <Gloss radius={theme.radius.lg} />
            <Text style={styles.qrTitle}>{wallet.label}</Text>
            <AnimatedQr
              frames={encodeBbqr(
                utf8ToBytes(serializeManualVault(wallet.label, entries, Date.now(), wallet.icon)),
                'J',
              )}
            />
            <Text style={styles.qrHint}>
              On the other phone: Portfolio tab → + → Scan a portfolio QR. Hold it
              up to this screen until it finishes.
            </Text>
            <Button title="Done" variant="ghost" onPress={() => setExportStep(null)} />
          </View>
        </View>
      </AppModal>

      {/* Sharing ended for a copy this phone only read: the entries are the
          owner's, so the copy goes with the share rather than becoming an
          editable portfolio of someone else's money (decided 2026-09-14). The
          button says what happens; the title says why (the minimal-dialog rule). */}
      <AppDialog
        visible={sharingEnded}
        title="Portfolio no longer shared"
        actions={[
          {
            label: 'Remove from this phone',
            variant: 'primary',
            onPress: () => {
              const id = wallet.id;
              navigation.goBack();
              void removeWallet(id);
            },
          },
        ]}
        onClose={() => {
          const id = wallet.id;
          navigation.goBack();
          void removeWallet(id);
        }}
      />

      {authModal}
    </View>
  );
}

/** One history row: the vault ledger's direction mark, then the entry, laid
 *  out by the one rule both histories share (`LedgerRowContent`). */
function EntryRow({
  entry,
  masked,
  unit,
  fiat,
  btcOnly,
  fx,
  decimals,
  onPress,
}: {
  entry: ManualLedgerEntry;
  masked: boolean;
  unit: AmountUnit;
  fiat: FiatCurrency;
  btcOnly?: boolean;
  /** The entry's fiat amount converted into `fiat` at its own date, when
   *  it was recorded in another currency and the conversion has landed. */
  fx: number | undefined;
  decimals: number;
  onPress: () => void;
}): React.JSX.Element {
  const e = entry;
  // Everything reads in the ACTIVE currency (decided 2026-08-25),
  // converted at the entry's own date; ≈ marks a converted figure. Until the
  // conversion lands, the original receipt shows rather than nothing.
  const money =
    e.fiatAmount != null && e.fiatCurrency && !btcOnly
      ? masked
        ? '••••'
        : e.fiatCurrency === fiat
          ? `${fiatSymbol(fiat)}${formatMoney(e.fiatAmount, decimals)}`
          : fx != null
            ? `≈${fiatSymbol(fiat)}${formatMoney(fx, decimals)}`
            : `${fiatSymbol(e.fiatCurrency)}${formatMoney(e.fiatAmount, fiatDecimals(e.fiatCurrency))}`
      : undefined;
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button">
      <Gloss radius={theme.radius.md} strength={cardGlow()} />
      {/* A buy is coins arriving, a sell coins leaving: the same marks as
          Received and Sent on a vault (decided 2026-09-12). As on the vault's
          history, a buy (money in) is the app's green and a sell the plain
          primary text; never lime here. */}
      <LedgerRowContent
        icon={<TxDirectionIcon direction={e.kind === 'buy' ? 'in' : 'out'} />}
        title={e.kind === 'buy' ? 'Bought' : 'Sold'}
        lines={[formatDate(e.date)]}
        amount={masked ? '••••' : `${e.kind === 'buy' ? '+' : '−'}${formatAmount(e.amountSats, unit)}`}
        amountColor={e.kind === 'buy' ? theme.colors.positive : theme.colors.offWhite}
        sub={money}
        note={displayNote(e.note)}
        // The portfolio's own colours: the date faint, the note quiet.
        lineColor={theme.colors.faint}
        noteColor={theme.colors.slate}
      />
    </TouchableOpacity>
  );
}

function RowGap(): React.JSX.Element {
  return <View style={styles.rowGap} />;
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'bad';
}): React.JSX.Element {
  // At the accessibility text sizes the figure goes under its label, each
  // with the whole width (factsStacked).
  const stacked = factsStacked(useWindowDimensions().fontScale);
  return (
    <View style={[styles.summaryRow, stacked && styles.factsStacked]}>
      <Text style={[styles.summaryLabel, stacked && styles.factLabelStacked]}>{label}</Text>
      {/* A figure is one line: it moves under its label rather than break
          ("$107,64 / 4.02" at large text, decided 2026-10-22). */}
      <FitText
        style={[
          styles.summaryValue,
          tone === 'good' && styles.toneGood,
          tone === 'bad' && styles.toneBad,
          stacked && styles.factValueStacked,
        ]}>
        {value}
      </FitText>
    </View>
  );
}

/** "Kept up to date from Kraken, Coinbase and Savings vault", in plain words. */
function sourcesLine(exchangeNames: string[], vaultLabels: string[]): string {
  const names = [...exchangeNames, ...vaultLabels];
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Kept up to date from ${list}`;
}

function slugName(label: string): string {
  return label.replace(/[^\w-]+/g, '-').toLowerCase() || 'virtual-vault';
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Short day label for the "as of" caption, the vault page's format. */
function dayLabelFor(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  muted: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
  },
  list: { paddingHorizontal: theme.spacing.lg },

  // The vault page's header band, character for character.
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    // The buttons' 4pt, plus the room the docked "as of" line hangs in.
    paddingBottom: theme.spacing.xs + HEADER_CAPTION_ROOM,
    backgroundColor: theme.colors.hull,
    zIndex: 2,
  },
  headerSpacer: { flex: 1 },
  syncFloat: {
    position: 'absolute',
    // Left of the menu button (lg padding + the button + a small gap).
    right: theme.spacing.lg + HEADER_BTN + theme.spacing.sm,
    justifyContent: 'center',
    // Above the morphing balance: a bar control stays on top, the number
    // slides beneath it.
    zIndex: 4,
  },

  morph: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  // The one hero size (decided 2026-09-12); no lineHeight, the block heights
  // above were measured on the font's own.
  morphNumber: {
    ...theme.typography.hero,
    lineHeight: undefined,
    color: theme.colors.offWhite,
    fontVariant: ['tabular-nums'],
  },
  // Absolutely positioned so the (often wider) caption never widens the
  // container and shifts the resting number. The vault page's twin, to the
  // same measures and face (HeaderIconButton names them for both).
  morphCaption: {
    position: 'absolute',
    top: MORPH_CAPTION_TOP,
    textAlign: 'center',
    fontFamily: theme.typography.heroCaption.fontFamily,
    fontSize: MORPH_CAPTION_SIZE,
    color: theme.colors.slate,
  },

  hero: {
    // The name block starts HERO_GAP below the BUTTONS (the header's own
    // bottom padding, the caption's room included, is already on screen), so
    // the resting hero sits exactly where it did before the band grew.
    paddingTop: HERO_GAP - theme.spacing.xs - HEADER_CAPTION_ROOM,
    gap: theme.spacing.lg,
  },
  // The portfolio's own header content, centred with air above as before
  // (decided 2026-09-12); the cards and the button below it stretch.
  // The chart page's 4pt between the figure and the line under it (decided 2026-09-12).
  heroCentre: { alignItems: 'center', gap: theme.spacing.xs},
  nameBlock: { height: NAME_BLOCK_H + NUMBER_BLOCK_H, alignSelf: 'stretch' },
  // The one hero label (theme `heroLabel`), as on the vault page beside it.
  heroName: heroLabel(),
  heroSub: { alignItems: 'center', gap: theme.spacing.xs },
  // The line under the hero figure: the one token every page uses for it.
  fiat: { ...theme.typography.heroCaption, color: theme.colors.slate, textAlign: 'center' },
  pnl: { ...theme.typography.heading, marginTop: 2, textAlign: 'center' },
  pnlHint: { ...theme.typography.caption, color: theme.colors.faint, marginTop: 2, textAlign: 'center' },
  shareLine: { alignItems: 'center', gap: 2, marginTop: theme.spacing.xs },
  shareText: { ...theme.typography.caption, color: theme.colors.slate, textAlign: 'center' },
  shareNote: { ...theme.typography.caption, color: theme.colors.faint, textAlign: 'center' },

  sources: { gap: theme.spacing.xs, alignItems: 'center', paddingVertical: theme.spacing.xs },
  sourcesText: { ...theme.typography.caption, color: theme.colors.slate, textAlign: 'center' },
  sourcesStatus: { color: theme.colors.faint },
  sourcesNote: { ...theme.typography.caption, color: theme.colors.faint, textAlign: 'center' },

  sheetBackdrop: { flex: 1, backgroundColor: theme.colors.scrim, justifyContent: 'flex-end' },
  // One sheet recipe: the glass, tint and finish come from DraggableSheet,
  // so no extra ground here (decided 2026-09-14).
  sheet: {
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
    borderTopWidth: 1,
    borderColor: theme.colors.offWhite + '2E',
  },
  sheetTitle: { ...theme.typography.label, color: theme.colors.slate, paddingVertical: theme.spacing.sm },
  // A menu row: its words, and a drawn chevron where it leads to another list
  // (trailing) or back to the first (leading); the vault page's twin.
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.lg },
  sheetDivider: { borderBottomWidth: 1, borderBottomColor: theme.colors.hairline },
  sheetText: { ...theme.typography.heading, color: theme.colors.offWhite, flex: 1 },

  warn: {
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.gold,
    padding: theme.spacing.lg,
  },
  warnTitle: { ...theme.typography.heading, color: theme.colors.gold },
  warnText: { ...theme.typography.caption, color: theme.colors.slate },

  card: {
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
  },
  cardNote: {
    ...theme.typography.caption,
    color: theme.colors.faint,
    marginTop: 2,
  },
  // Label and figure side by side while both fit, the label taking at most
  // FACT_LABEL_SHARE of the row and wrapping at its spaces; when the figure
  // does not fit beside it, the figure moves under it as a whole, still at
  // the right (decided 2026-10-22, the entry page's rows the same).
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Label sits on the FIRST line of its value, not centred against the
    // block (decided 2026-08-28). Matches SendScreen infoRow / CosignRequestPanel row.
    alignItems: 'flex-start',
    columnGap: theme.spacing.md,
    rowGap: 2,
  },
  // The label on the body token's own leading (decided 2026-10-05: a token's
  // line height is overridden only to sit level with a FitText figure).
  summaryLabel: { ...theme.typography.body, color: theme.colors.slate, flexShrink: 1, maxWidth: FACT_LABEL_SHARE },
  summaryValue: { ...theme.typography.heading, color: theme.colors.offWhite, textAlign: 'right', flexShrink: 1, maxWidth: '100%', marginLeft: 'auto' },
  factsStacked: { flexDirection: 'column' },
  factLabelStacked: { maxWidth: '100%' },
  factValueStacked: { marginLeft: 0, textAlign: 'left' },
  // The app's one green and one red for gains and losses (decided 2026-09-12).
  toneGood: { color: theme.colors.positive },
  toneBad: { color: theme.colors.negative },

  empty: { alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xxl },
  emptyTitle: { ...theme.typography.title, color: theme.colors.offWhite },
  emptyText: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
    maxWidth: 300,
  },

  // The hero's gap (lg) plus this gives the History title the xl it had
  // above the list.
  // The vault page's "Transactions" title: 32pt below the hero (the hero's
  // lg gap plus lg here) and sm above the first row.
  listTitle: {
    ...theme.typography.heading,
    color: theme.colors.faint,
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
  },
  rowGap: { height: theme.spacing.sm },
  // The card; what is inside it is LedgerRowContent's (decided 2026-10-22).
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },

  qrBackdrop: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  glassTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.glassTint },
  qrCard: {
    overflow: 'hidden',
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.offWhite + '2E',
    padding: theme.spacing.xl,
  },
  // The popup's own title, the same size as every dialog's (decided 2026-09-14).
  qrTitle: { ...theme.typography.title, color: theme.colors.offWhite },
  qrHint: {
    ...theme.typography.caption,
    color: theme.colors.slate,
    textAlign: 'center',
  },
}));
