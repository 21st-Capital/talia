/**
 * The ledger row's direction mark: a tinted circle with an arrow, the SAME on
 * a vault's history and a portfolio's (decided 2026-09-12: "use the sent and
 * received icons we use for the historic transactions on vaults also for
 * portfolio buy and sell, to stay consistent"). Green arrow down = value
 * arriving (Received, a buy); red arrow up = value leaving (Sent, a sell);
 * the refresh variant is a timelocked vault's self-spend.
 *
 * Extracted from WalletDetailScreen's TxRow unchanged, so the two pages
 * cannot drift apart again. The arrow is DRAWN (decided 2026-10-05): a "↓"
 * glyph sits where the font puts it, at the font's weight, and the status
 * card's circle drew its own; `TxArrow` is the one arrow both use.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import { Gloss } from './Gloss';
import { RefreshIcon } from './TablerIcons';

export type TxDirection = 'in' | 'out' | 'refresh';

/** The circle's diameter; rows level their first text line with its centre. */
export const TX_ICON_SIZE = 38;

/** The arrow inside the row's circle: the size of every 18pt row mark. */
const ARROW_SIZE = 18;

/** Tabler's arrow-down, arrow-up and arrow-right (outline, v3.44). */
const ARROW_PATHS = {
  down: ['M12 5l0 14', 'M18 13l-6 6', 'M6 13l6 6'],
  up: ['M12 5l0 14', 'M18 11l-6 -6', 'M6 11l6 -6'],
  right: ['M5 12l14 0', 'M13 18l6 -6', 'M13 6l6 6'],
} as const;

export type TxArrowKind = keyof typeof ARROW_PATHS | 'refresh';

/**
 * The arrow of a transaction's direction: down for value arriving, up for
 * value leaving, right for a replacement, the circular arrow for a refresh.
 */
export function TxArrow({
  kind,
  color,
  size = ARROW_SIZE,
}: {
  kind: TxArrowKind;
  color: string;
  size?: number;
}): React.JSX.Element {
  if (kind === 'refresh') return <RefreshIcon size={size} strokeWidth={2.5} color={color} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {ARROW_PATHS[kind].map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      ))}
    </Svg>
  );
}

export function TxDirectionIcon({ direction }: { direction: TxDirection }): React.JSX.Element {
  const incoming = direction === 'in';
  return (
    <View style={[styles.circle, incoming ? styles.circleIn : styles.circleOut]}>
      {/* The green / red tint is the meaning: sheen and edge only, no glow. */}
      <Gloss size={TX_ICON_SIZE} radius={TX_ICON_SIZE / 2} glow={false} />
      <TxArrow
        kind={incoming ? 'down' : direction === 'refresh' ? 'refresh' : 'up'}
        color={incoming ? theme.colors.positive : theme.colors.negative}
      />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  circle: {
    width: TX_ICON_SIZE,
    height: TX_ICON_SIZE,
    borderRadius: TX_ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The semantic Positive / Negative colours at a low alpha, as the vault
  // ledger has drawn them since the banking-style redesign.
  circleIn: { backgroundColor: 'rgba(22, 199, 132, 0.16)' },
  circleOut: { backgroundColor: 'rgba(255, 76, 76, 0.14)' },
}));
