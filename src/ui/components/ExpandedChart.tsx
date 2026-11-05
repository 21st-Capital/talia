/**
 * The landscape price chart (the expand button on the price screen). The
 * app is portrait-only, so instead of rotating the phone's orientation the
 * view rotates itself: a screen-height by screen-width box turned 90
 * degrees, so the user turns the phone and gets a wide chart with the
 * notch on their left. Same chart, same scrubbing, same range row.
 */
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { AppModal } from './AppModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, themedStyles } from '../theme';
import { PriceLineChart } from './PriceLineChart';
import { PageGlow } from './PageGlow';
import type { ScrubPoint } from './PriceLineChart';
import { ChangeLine, ChartIconButton, RangeRow } from './ChartControls';
import { ArrowsDiagonalMinimizeIcon } from './TablerIcons';
import { summarize } from '../../wallet/chartSeries';
import type { Candle, ChartMode, ChartRange } from '../../wallet/chartSeries';
import { formatFiatValue } from '../../wallet/marketFormat';
import type { FiatCurrency } from '../../wallet';

// The headline block: the hero figure over the change line, measured from
// the tokens so raising either keeps the row tall enough (decided 2026-09-14).
const TOP_ROW_H = theme.typography.hero.lineHeight + theme.typography.label.lineHeight + theme.spacing.xs;
const RANGE_ROW_H = 48;
const PAD = theme.spacing.md;

interface Props {
  visible: boolean;
  onClose: () => void;
  currency: FiatCurrency;
  candles: Candle[];
  livePrice: number | null;
  range: ChartRange;
  onRange: (r: ChartRange) => void;
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
  /** The range's data is still on its way (a spinner over the canvas). */
  loading?: boolean;
  /** The range's data could not be fetched (a short line instead). */
  failed?: boolean;
}

export function ExpandedChart({
  visible,
  onClose,
  currency,
  candles,
  livePrice,
  range,
  onRange,
  mode,
  onMode,
  loading,
  failed,
}: Props): React.JSX.Element {
  const { width: portraitW, height: portraitH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [scrub, setScrub] = useState<ScrubPoint | null>(null);

  // The box is landscape-sized and turned clockwise: its left edge lands on
  // the phone's top (the notch), its right edge on the home indicator.
  const boxW = Math.max(portraitW, portraitH);
  const boxH = Math.min(portraitW, portraitH);
  const padLeft = insets.top + PAD;
  const padRight = insets.bottom + PAD;
  const chartW = Math.max(1, boxW - padLeft - padRight);
  const chartH = Math.max(1, boxH - TOP_ROW_H - RANGE_ROW_H - PAD * 3);

  const summary = useMemo(() => summarize(candles, mode), [candles, mode]);
  const shownValue = scrub ? scrub.candle.c : livePrice ?? summary?.last ?? null;

  return (
    <AppModal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar hidden />
      <View style={styles.backdrop}>
        {/* Outside the navigator's page layout: the ground and glow are painted here, and the rotated box stays transparent so the glow shows through. */}
        <PageGlow />
        <View
          style={[
            styles.box,
            {
              width: boxW,
              height: boxH,
              left: (portraitW - boxW) / 2,
              top: (portraitH - boxH) / 2,
              paddingLeft: padLeft,
              paddingRight: padRight,
            },
          ]}>
          <View style={styles.topRow}>
            <View style={styles.headline}>
              <Text style={styles.price} numberOfLines={1}>
                {shownValue != null ? formatFiatValue(shownValue, currency) : '…'}
              </Text>
              <ChangeLine summary={summary} scrub={scrub} range={range} currency={currency} align="left" />
            </View>
            <ChartIconButton icon={ArrowsDiagonalMinimizeIcon} onPress={onClose} label="Close the large chart" />
          </View>
          <View style={{ width: chartW, height: chartH }}>
            <PriceLineChart
              width={chartW}
              height={chartH}
              candles={candles}
              range={range}
              mode={mode}
              currency={currency}
              onScrub={setScrub}
            />
            {(loading || failed) && (
              <View style={styles.overlay} pointerEvents="none">
                {failed ? (
                  <Text style={styles.note}>Price history is unavailable right now.</Text>
                ) : (
                  <ActivityIndicator color={theme.colors.slate} />
                )}
              </View>
            )}
          </View>
          <View style={styles.rangeRow}>
            <RangeRow range={range} onRange={onRange} mode={mode} onMode={onMode} />
          </View>
        </View>
      </View>
    </AppModal>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: theme.colors.hull },
  box: {
    position: 'absolute',
    transform: [{ rotate: '90deg' }],
    paddingVertical: PAD,
  },
  topRow: {
    height: TOP_ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.sm,
  },
  headline: { flex: 1, paddingRight: theme.spacing.md },
  // The one hero size, as on the portrait chart (decided 2026-09-14: "fix the
  // chart price size too").
  price: { ...theme.typography.hero, color: theme.colors.offWhite },
  rangeRow: { height: RANGE_ROW_H, justifyContent: 'center', marginTop: PAD },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { ...theme.typography.body, color: theme.colors.slate },
}));
