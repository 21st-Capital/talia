/**
 * Full-screen Bitcoin price view, Revolut-style (decided 2026-09-11), with the
 * Bitcoin logo kept top-centre as asked. Top to bottom: our own header
 * (bare chevron; "BTC" and the price fade in once the big price has
 * scrolled away), the logo, the live price, the period change ("+€307.19
 * +0.46% · Today"), the chart with its expand button, the range row with
 * the candlestick toggle, one line naming the price source, and the Stats
 * card (market cap, rank, supply, 24h volume).
 *
 * LIVE: the price is the same per-second stream the home card shows
 * (useLiveRate), and the chart's last point follows it. Hold or drag on
 * the chart to read a past moment; the page stops scrolling meanwhile.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { theme, themedStyles } from '../theme';
import { BitcoinLogo, HeaderBackButton, InfoHeading, PageGlow, Gloss, cardGlow , FitText } from '../components';
import { ArrowsDiagonalIcon } from '../components/TablerIcons';
import { PriceLineChart } from '../components/PriceLineChart';
import type { ScrubPoint } from '../components/PriceLineChart';
import { ChangeLine, ChartIconButton, RangeRow, sourceNote } from '../components/ChartControls';
import { ExpandedChart } from '../components/ExpandedChart';
import { useWallets } from '../../wallet';
import { useLiveRate } from '../hooks/useLiveRate';
import { getChartSeries, peekChartSeries, prefetchChartSeries } from '../../wallet/chartData';
import type { ChartSeries } from '../../wallet/chartData';
import { RANGE_SPEC, summarize, withLiveClose } from '../../wallet/chartSeries';
import type { ChartMode, ChartRange } from '../../wallet/chartSeries';
import { getMarketStats } from '../../wallet/marketStats';
import type { MarketStats } from '../../wallet/marketStats';
import { formatCompact, formatCompactFiat, formatFiatValue } from '../../wallet/marketFormat';

const CHART_H = 300;

const STATS_INFO =
  '• Market cap: the price of one bitcoin times every coin in circulation.\n' +
  '• Market cap rank: where bitcoin stands among all cryptocurrencies by market cap.\n' +
  '• Circulating supply: the coins mined so far.\n' +
  '• Max supply: the most there will ever be.\n' +
  '• 24h trading volume: the value of bitcoin traded on exchanges in the past day.\n' +
  '\n' +
  'Figures from CoinGecko.';

type Props = NativeStackScreenProps<RootStackParamList, 'PriceHistory'>;

export function PriceHistoryScreen({ navigation }: Props): React.JSX.Element {
  const { settings } = useWallets();
  const currency = settings.fiat;
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  const [range, setRange] = useState<ChartRange>('1D');
  const [mode, setMode] = useState<ChartMode>('line');
  const [series, setSeries] = useState<ChartSeries | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [stats, setStats] = useState<MarketStats | null | 'loading'>('loading');
  const [scrub, setScrub] = useState<ScrubPoint | null>(null);
  const [expanded, setExpanded] = useState(false);
  const livePrice = useLiveRate(currency);
  const scrollY = useRef(new Animated.Value(0)).current;

  // Bitcoin Only hides every fiat figure, and this screen is nothing but
  // fiat: if it is switched on while we are open, leave.
  useEffect(() => {
    if (settings.btcOnly) navigation.goBack();
  }, [settings.btcOnly, navigation]);

  // Warm every range once, and fetch the Stats card (a failed first try is
  // retried twice, twenty seconds apart, so a busy moment on open does not
  // pin the card to "unavailable").
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let tries = 0;
    prefetchChartSeries(currency);
    setStats('loading');
    const load = (): void => {
      getMarketStats(currency).then((s) => {
        if (cancelled) return;
        setStats(s);
        if (!s && ++tries < 3) retry = setTimeout(load, 20_000);
      });
    };
    load();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [currency]);

  // The selected range: whatever is already in memory is drawn at once,
  // then the fresh series replaces it, and it is refreshed on its own
  // cadence while the screen is open (today's line grows a point every
  // five minutes). The poll runs a few seconds past the cache lifetime so
  // a slow fetch never makes it skip a cycle.
  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    const known = peekChartSeries(currency, range);
    if (known) setSeries(known);
    const load = (): void => {
      getChartSeries(currency, range).then((s) => {
        if (cancelled) return;
        if (s) setSeries(s);
        else setLoadFailed(true);
      });
    };
    load();
    const iv = setInterval(load, RANGE_SPEC[range].ttlMs + 5_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [currency, range]);

  // Only a series for THIS range and currency is drawn; in the moment
  // between a tap and its (usually cached) data the chart keeps its last
  // path and morphs from it.
  const shown = series && series.range === range && series.currency === currency ? series : null;
  const candles = useMemo(() => (shown ? withLiveClose(shown.candles, livePrice) : []), [shown, livePrice]);
  const summary = useMemo(() => summarize(candles, mode), [candles, mode]);

  const shownValue = scrub ? scrub.candle.c : livePrice ?? summary?.last ?? null;
  const priceText = shownValue != null ? formatFiatValue(shownValue, currency) : '…';

  const titleOpacity = useMemo(
    () => scrollY.interpolate({ inputRange: [90, 150], outputRange: [0, 1], extrapolate: 'clamp' }),
    [scrollY],
  );
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }),
    [scrollY],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <PageGlow fill />
        <View style={styles.headerSide}>
          <HeaderBackButton />
        </View>
        <Animated.View style={[styles.headerTitle, { opacity: titleOpacity }]} pointerEvents="none">
          <Text style={styles.headerTicker}>BTC</Text>
          <Text style={styles.headerPrice} numberOfLines={1}>
            {priceText}
          </Text>
        </Animated.View>
        <View style={styles.headerSide} />
      </View>

      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + theme.spacing.xxl }]}
        scrollEnabled={!scrub}
        scrollEventThrottle={16}
        onScroll={onScroll}>
        <View style={styles.badgeWrap}>
          <BitcoinLogo size={52} />
        </View>
        <Text style={styles.ticker}>BTC · Bitcoin</Text>
        <FitText style={styles.price}>{priceText}</FitText>
        <ChangeLine summary={summary} scrub={scrub} range={range} currency={currency} />

        <View style={styles.chartTools}>
          <ChartIconButton icon={ArrowsDiagonalIcon} onPress={() => setExpanded(true)} label="Open the large chart" />
        </View>
        <View style={styles.chartBlock}>
          <PriceLineChart
            width={screenW}
            height={CHART_H}
            candles={candles}
            range={range}
            mode={mode}
            currency={currency}
            onScrub={setScrub}
          />
          {!shown && (
            <View style={styles.chartOverlay} pointerEvents="none">
              {loadFailed ? (
                <Text style={styles.chartNote}>Price history is unavailable right now.</Text>
              ) : (
                <ActivityIndicator color={theme.colors.slate} />
              )}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <RangeRow range={range} onRange={setRange} mode={mode} onMode={setMode} />
          <Text style={styles.sourceNote}>{sourceNote(shown?.source ?? null, currency, range)}</Text>
        </View>

        <View style={styles.section}>
          <InfoHeading style={[styles.statsTitle, styles.statsHead]} title="Stats" text={STATS_INFO}>
            Stats
          </InfoHeading>
          <View style={styles.statsCard}>
            <Gloss radius={theme.radius.lg} strength={cardGlow()} />
            {stats === 'loading' ? (
              <StatRow label="Market cap" value="…" last />
            ) : stats == null ? (
              <StatRow label="Unavailable right now" value="" last />
            ) : (
              <>
                <StatRow label="Market cap" value={formatCompactFiat(stats.marketCap, currency)} />
                <StatRow label="Market cap rank" value={`#${stats.rank}`} />
                <StatRow label="Circulating supply" value={formatCompact(stats.circulatingSupply)} />
                <StatRow label="Max supply" value={stats.maxSupply != null ? formatCompact(stats.maxSupply) : '21M'} />
                <StatRow label="24h trading volume" value={formatCompactFiat(stats.volume24h, currency)} last />
              </>
            )}
          </View>
        </View>
      </Animated.ScrollView>

      <ExpandedChart
        visible={expanded}
        onClose={() => setExpanded(false)}
        currency={currency}
        candles={candles}
        livePrice={livePrice}
        range={range}
        onRange={setRange}
        mode={mode}
        onMode={setMode}
        loading={!shown && !loadFailed}
        failed={!shown && loadFailed}
      />
    </View>
  );
}

function StatRow({ label, value, last }: { label: string; value: string; last?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.statRow, !last && styles.statRowBorder]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  content: {},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
    backgroundColor: theme.colors.hull,
  },
  headerSide: { minWidth: 44, height: 44, justifyContent: 'center' },
  headerTitle: { flex: 1, alignItems: 'center' },
  headerTicker: { ...theme.typography.screenTitle, color: theme.colors.offWhite },
  headerPrice: { ...theme.typography.screenSubtitle, color: theme.colors.slate },

  badgeWrap: { alignItems: 'center', marginTop: theme.spacing.sm },
  ticker: {
    ...theme.typography.label,
    color: theme.colors.slate,
    textAlign: 'center',
    marginTop: theme.spacing.md,
  },
  // The one hero size (decided 2026-09-12: every amount figure the same).
  price: {
    ...theme.typography.hero,
    color: theme.colors.offWhite,
    textAlign: 'center',
    marginTop: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg,
  },

  chartTools: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
  },
  chartBlock: { marginTop: theme.spacing.xs },
  chartOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartNote: { ...theme.typography.body, color: theme.colors.slate, paddingHorizontal: theme.spacing.lg },

  section: { paddingHorizontal: theme.spacing.lg, marginTop: theme.spacing.xl },
  sourceNote: {
    ...theme.typography.caption,
    color: theme.colors.faint,
    marginTop: theme.spacing.md,
  },

  statsHead: { marginBottom: theme.spacing.md },
  statsTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  statsCard: {
    // The home screen's card material (decided 2026-09-16).
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    paddingHorizontal: theme.spacing.lg,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.md + 2,
    gap: theme.spacing.md,
  },
  statRowBorder: { borderBottomWidth: 1, borderBottomColor: theme.colors.hairline },
  statLabel: { ...theme.typography.body, color: theme.colors.slate, flexShrink: 1 },
  statValue: { ...theme.typography.bodyStrong, color: theme.colors.offWhite },
}));
