/**
 * Bitcoin price card, Bitkey-style: soft off-white line on the dark card, a
 * gold "now" dot, and the rolling 24h change up top. Tapping the card opens
 * the FULL-SCREEN chart (PriceHistoryScreen) where the range selector lives.
 *
 * REAL TIME (decided 2026-07-18): the price streams every second over a shared
 * Binance WebSocket (no polling). Non-USD currencies multiply the live USD
 * price by a fiat ratio refreshed each minute. The chart's endpoint follows
 * the live price, so the line's tail genuinely moves tick by tick.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import { cardGlow, Gloss } from './Gloss';
import { getPriceSeries, get24hChangePct } from '../../wallet/priceHistory';
import { getBtcPrice } from '../../wallet';
import { subscribeLiveUsdPrice } from '../../wallet/livePrice';
import type { PricePoint } from '../../wallet/priceHistory';
import type { FiatCurrency } from '../../wallet';
import { sparklinePath, resampleSeries } from './sparklinePath';
import { formatChange, readsNegative } from '../../wallet/marketFormat';

const CHART_H = 64;
/** Match the full-screen chart's sampling so the line shapes agree. */
const SAMPLES = 48;

const SYMBOL: Record<FiatCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  CHF: 'CHF ',
  CAD: 'C$',
  AUD: 'A$',
  JPY: '¥',
};

export function PriceChart({
  currency,
  onPress,
  onLongPress,
}: {
  currency: FiatCurrency;
  onPress?: () => void;
  onLongPress?: () => void;
}): React.JSX.Element | null {
  const [series, setSeries] = useState<PricePoint[] | null>(null);
  const [pct24, setPct24] = useState<number | null>(null);
  const [spot, setSpot] = useState<number | null>(null);
  const { width: screenW } = useWindowDimensions();
  const chartW = screenW - theme.spacing.lg * 4; // screen padding + card padding

  // Fiat conversion for the live USD stream (1 for USD). Fiat pairs drift
  // slowly, so a per-minute refresh keeps the stream honest.
  const ratioRef = useRef(1);

  useEffect(() => {
    let cancelled = false;
    getPriceSeries(currency, '1M').then((s) => {
      if (!cancelled && s) setSeries(s);
    });
    get24hChangePct(currency).then((p) => {
      if (!cancelled) setPct24(p);
    });

    // Seed with the REST spot immediately (covers the moment before the
    // socket's first tick), and keep the fiat/USD ratio fresh.
    const seed = () => getBtcPrice(currency).then((r) => !cancelled && r != null && setSpot((prev) => prev ?? r));
    seed();
    const refreshRatio = async () => {
      if (currency === 'USD') {
        ratioRef.current = 1;
        return;
      }
      const [fiat, usd] = await Promise.all([getBtcPrice(currency), getBtcPrice('USD')]);
      if (!cancelled && fiat != null && usd != null && usd > 0) {
        ratioRef.current = fiat / usd;
      }
    };
    void refreshRatio();
    const ratioIv = setInterval(() => void refreshRatio(), 60_000);

    // The real-time feed: one price per second, pushed — not polled.
    const unsubscribe = subscribeLiveUsdPrice((usd) => {
      if (!cancelled) setSpot(usd * ratioRef.current);
    });

    return () => {
      cancelled = true;
      clearInterval(ratioIv);
      unsubscribe();
    };
  }, [currency]);

  const geometry = useMemo(() => {
    if (!series) return null;
    // The endpoint follows the LIVE price — the tail of the line moves with
    // every tick instead of freezing on the last daily sample.
    const values = series.map((p) => p.p);
    if (spot != null && values.length > 0) values[values.length - 1] = spot;
    // -5: keep the endpoint dot (r=4) inside the canvas instead of clipping.
    return sparklinePath(resampleSeries(values, SAMPLES), chartW - 5, CHART_H);
  }, [series, chartW, spot]);

  if (!series || !geometry) return null;

  const last = spot ?? series[series.length - 1].p;
  const prevDay = series.length >= 2 ? series[series.length - 2].p : last;
  const changePct = pct24 ?? ((last - prevDay) / prevDay) * 100;
  const changeAbs = last - last / (1 + changePct / 100);
  const up = !readsNegative(changeAbs, currency);
  const digits = currency === 'JPY' ? 0 : 2;
  const fmt = (v: number) =>
    `${SYMBOL[currency]}${v.toLocaleString('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}`;

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={onPress} onLongPress={onLongPress}>
      <Gloss radius={theme.radius.lg} strength={cardGlow()} />
      <View style={styles.headerRow}>
        <View>
          <View style={styles.labelRow}>
            <Text style={styles.label}>Bitcoin Price</Text>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <Text style={styles.price}>{fmt(last)}</Text>
        </View>
        {/* Decided 2026-09-12: the 24h change written exactly as on the chart
            screen ("+$23.99  +0.03%"), on the price's own row; the line
            above it stays empty. Standard green and red. */}
        <View style={styles.changeBlock}>
          <Text style={[styles.change, { color: up ? theme.colors.positive : theme.colors.negative }]} numberOfLines={1}>
            {formatChange(changeAbs, changePct, currency)}
          </Text>
        </View>
      </View>
      <Svg width={chartW} height={CHART_H}>
        <Defs>
          <LinearGradient id="cardfill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={theme.colors.gold} stopOpacity={0.28} />
            <Stop offset="1" stopColor={theme.colors.gold} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={geometry.areaPath} fill="url(#cardfill)" />
        <Path
          d={geometry.linePath}
          stroke={theme.colors.gold}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Circle cx={geometry.end.x} cy={geometry.end.y} r={4} fill={theme.colors.gold} />
      </Svg>
      <Text style={styles.caption}>Last 30 days · tap for more</Text>
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  card: {
    // The same raised ground and finish as the vault and portfolio cards
    // (decided 2026-09-16): one card look on the home screen. The Gloss brings its
    // own top-lit edge, so the hairline border goes.
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'stretch',
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
  label: { ...theme.typography.caption, color: theme.colors.slate },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent },
  liveText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: theme.colors.accentText },
  // The unit's size beside a hero figure: the card's price is the small figure.
  price: { ...theme.typography.heroUnit, color: theme.colors.offWhite },
  // Bottom-aligned so the change sits level with the price, not the label.
  changeBlock: { alignItems: 'flex-end', justifyContent: 'flex-end', paddingBottom: theme.spacing.xs },
  change: { ...theme.typography.label },
  caption: { ...theme.typography.caption, color: theme.colors.faint },
}));
