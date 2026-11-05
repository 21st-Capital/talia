/**
 * Exchange marks for the Sync portfolio screen (decided 2026-09-07: "use their
 * logo instead of just their name"). Drawn in-app with react-native-svg so
 * no image asset ships: Kraken's brand purple tile with the kraken mark as
 * supplied, traced as one path.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { themedStyles } from '../theme';
import { Gloss } from './Gloss';

export type ExchangeKey = 'kraken' | 'coinbase';

const BRAND: Record<ExchangeKey, { name: string; tile: string; ink: string }> = {
  kraken: { name: 'Kraken', tile: '#5741D9', ink: '#FFFFFF' },
  coinbase: { name: 'Coinbase', tile: '#0052FF', ink: '#FFFFFF' },
};

export function exchangeName(key: ExchangeKey): string {
  return BRAND[key].name;
}

/**
 * Kraken's mark as supplied (2026-09-07): a half-disc whose lower edge
 * is cut into four rounded legs by three round-topped notches. Drawn from
 * that image: dome radius 46 on a 100-wide box, legs 14 wide, notches 12
 * wide reaching just above the equator, leg ends rounded.
 */
const KRAKEN_PATH =
  'M4 46 A46 46 0 0 1 96 46 L96 75 A7 7 0 0 1 82 75 L82 46 A6 6 0 0 0 70 46 L70 75 A7 7 0 0 1 56 75 L56 46 A6 6 0 0 0 44 46 L44 75 A7 7 0 0 1 30 75 L30 46 A6 6 0 0 0 18 46 L18 75 A7 7 0 0 1 4 75 Z';

function KrakenMark({ size, color }: { size: number; color: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size * 0.82} viewBox="0 0 100 82">
      <Path d={KRAKEN_PATH} fill={color} />
    </Svg>
  );
}

/** Coinbase's mark: a ring with a bar through its middle, on their blue. */
function CoinbaseMark({ size, color }: { size: number; color: string }): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        d="M24 4C13 4 4 13 4 24s9 20 20 20 20-9 20-20S35 4 24 4zm0 8.5c6.4 0 11.5 5.1 11.5 11.5S30.4 35.5 24 35.5 12.5 30.4 12.5 24 17.6 12.5 24 12.5z"
        fill={color}
        fillRule="evenodd"
      />
      <Path d="M19.5 20.5h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z" fill={color} />
    </Svg>
  );
}

export function ExchangeTile({ exchange, size = 44 }: { exchange: ExchangeKey; size?: number }): React.JSX.Element {
  const brand = BRAND[exchange];
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.28, backgroundColor: brand.tile }]}>
      {/* A brand's own colour: a light bloom, never the brand green over it. */}
      <Gloss size={size} radius={size * 0.28} glow="light" />
      {exchange === 'kraken' && <KrakenMark size={size * 0.62} color={brand.ink} />}
      {exchange === 'coinbase' && <CoinbaseMark size={size * 0.72} color={brand.ink} />}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    tile: { alignItems: 'center', justifyContent: 'center' },
  }),
);
