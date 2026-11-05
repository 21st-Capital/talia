/**
 * The pieces around the price chart that both the price screen and its
 * landscape view share: the change line under the price ("+€307.19 +0.46%
 * · Today", or the scrubbed moment), the range row with the candlestick
 * toggle, the round icon button, and the one-line source note.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { SegmentedControl } from './SegmentedControl';
import { TapArea } from './TapArea';
import { Gloss } from './Gloss';
import { ChartCandleIcon, ChartLineIcon } from './TablerIcons';
import { CHART_RANGES, RANGE_SPEC, changeAt, formatScrubTime } from '../../wallet/chartSeries';
import type { ChartMode, ChartRange, SeriesSummary } from '../../wallet/chartSeries';
import type { ChartSource } from '../../wallet/chartData';
import { formatChange, readsNegative } from '../../wallet/marketFormat';
import type { FiatCurrency } from '../../wallet';
import type { ScrubPoint } from './PriceLineChart';

const RANGE_OPTIONS = CHART_RANGES.map((r) => ({ value: r, label: r === 'ALL' ? 'All' : r }));

/** A 40pt round button on the raised surface; lime when `active`. Built on
 *  TapArea so it also works inside the rotated landscape view. */
export function ChartIconButton({
  icon: Icon,
  onPress,
  label,
  active,
}: {
  icon: (p: { size?: number; color?: string; strokeWidth?: number }) => React.JSX.Element;
  onPress: () => void;
  label: string;
  active?: boolean;
}): React.JSX.Element {
  return (
    <TapArea onPress={onPress} label={label} active={active} style={[styles.iconBtn, active && styles.iconBtnActive]}>
      {/* Lime when active: that fill means "on", so no green glow over it. */}
      <Gloss size={40} radius={20} glow={!active} />
      <Icon size={20} color={active ? theme.colors.accentInk : theme.colors.offWhite} strokeWidth={2} />
    </TapArea>
  );
}

/** 1D · 1W · 1M · 6M · 1Y · 5Y · All, and the line/candles toggle. */
export function RangeRow({
  range,
  onRange,
  mode,
  onMode,
}: {
  range: ChartRange;
  onRange: (r: ChartRange) => void;
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
}): React.JSX.Element {
  const candles = mode === 'candles';
  return (
    <View style={styles.rangeRow}>
      <View style={styles.rangeFill}>
        <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={onRange} responderTaps />
      </View>
      <ChartIconButton
        icon={candles ? ChartLineIcon : ChartCandleIcon}
        active={candles}
        label={candles ? 'Show the line chart' : 'Show candlesticks'}
        onPress={() => onMode(candles ? 'line' : 'candles')}
      />
    </View>
  );
}

/**
 * "+€307.19  +0.46% · Today". While the finger is on the chart it becomes
 * the change up to that moment and the moment itself.
 */
export function ChangeLine({
  summary,
  scrub,
  range,
  currency,
  align = 'center',
}: {
  summary: SeriesSummary | null;
  scrub: ScrubPoint | null;
  range: ChartRange;
  currency: FiatCurrency;
  align?: 'center' | 'left';
}): React.JSX.Element {
  if (!summary) return <Text style={[styles.changeLine, { textAlign: align }]}> </Text>;
  const change = scrub ? changeAt(summary.open, scrub.candle.c) : summary;
  const up = !readsNegative(change.changeAbs, currency);
  const when = scrub ? formatScrubTime(scrub.candle.t, range) : RANGE_SPEC[range].periodLabel;
  return (
    <Text style={[styles.changeLine, { textAlign: align }]} numberOfLines={1}>
      <Text style={{ color: up ? theme.colors.positive : theme.colors.negative }}>
        {formatChange(change.changeAbs, change.changePct, currency)}
      </Text>
      <Text style={styles.changeWhen}> · {when}</Text>
    </Text>
  );
}

/** One quiet line under the range row, so nobody mistakes the market price
 *  for a quote. Names the source the chart actually drew from, and how the
 *  range was converted: the long ranges at each day's ECB reference rate,
 *  today and the week at the current exchange rate (RANGE_SPEC.perDayFx). */
export function sourceNote(source: ChartSource | null, currency: FiatCurrency, range: ChartRange): string {
  if (!source) return ' ';
  if (source === 'coingecko') return 'Market price from CoinGecko. Actual buy and sell prices differ.';
  if (currency === 'USD') return 'Market price from Binance. Actual buy and sell prices differ.';
  const how = RANGE_SPEC[range].perDayFx ? "each day's ECB reference rate" : "today's exchange rate";
  return `Market price from Binance, shown in ${currency} at ${how}. Actual buy and sell prices differ.`;
}

const styles = themedStyles(() => StyleSheet.create({
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: theme.colors.accent },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rangeFill: { flex: 1 },
  changeLine: { ...theme.typography.label, marginTop: theme.spacing.xs },
  changeWhen: { color: theme.colors.slate },
}));
