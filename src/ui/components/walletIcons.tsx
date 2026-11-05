/**
 * Wallet icon library — Tabler outline (MIT, v3.44) rendered via
 * react-native-svg. Users can assign any of these to a wallet; category
 * defaults were picked: savings → pig-money, spending → wallet,
 * other → currency-bitcoin (thin-line ₿).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { theme, themedStyles } from '../theme';
import { Gloss } from './Gloss';
import { CATEGORY_MULTISIG, CATEGORY_SINGLE_SIG, effectiveCategory } from '../../wallet';
import type { WalletMeta } from '../../wallet';

/** Icon keys, in picker display order. */
export const WALLET_ICON_KEYS = [
  'pig-money',
  'building-bank',
  'moneybag',
  'wallet',
  'credit-card',
  'cash',
  'coins',
  'shield',
  'briefcase',
  'umbrella',
  'rocket',
  'anchor',
  'home',
  'users-group',
  'users',
  'heart-handshake',
  'gift',
  'star',
  'plane',
  'beach',
  'diamond',
  'crown',
  'heart',
  'currency-bitcoin',
] as const;

export type WalletIconKey = (typeof WALLET_ICON_KEYS)[number];

const PATHS: Record<WalletIconKey, string[]> = {
  'pig-money': ['M15 11v.01', 'M5.173 8.378a3 3 0 1 1 4.656 -1.377', 'M16 4v3.803a6.019 6.019 0 0 1 2.658 3.197h1.341a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-1.342c-.336 .95 -.907 1.8 -1.658 2.473v2.027a1.5 1.5 0 0 1 -3 0v-.583a6.04 6.04 0 0 1 -1 .083h-4a6.04 6.04 0 0 1 -1 -.083v.583a1.5 1.5 0 0 1 -3 0v-2l0 -.027a6 6 0 0 1 4 -10.473h2.5l4.5 -3'],
  'building-bank': ['M3 21l18 0', 'M3 10l18 0', 'M5 6l7 -3l7 3', 'M4 10l0 11', 'M20 10l0 11', 'M8 14l0 3', 'M12 14l0 3', 'M16 14l0 3'],
  'moneybag': ['M9.5 3h5a1.5 1.5 0 0 1 1.5 1.5a3.5 3.5 0 0 1 -3.5 3.5h-1a3.5 3.5 0 0 1 -3.5 -3.5a1.5 1.5 0 0 1 1.5 -1.5', 'M4 17v-1a8 8 0 1 1 16 0v1a4 4 0 0 1 -4 4h-8a4 4 0 0 1 -4 -4'],
  'wallet': ['M17 8v-3a1 1 0 0 0 -1 -1h-10a2 2 0 0 0 0 4h12a1 1 0 0 1 1 1v3m0 4v3a1 1 0 0 1 -1 1h-12a2 2 0 0 1 -2 -2v-12', 'M20 12v4h-4a2 2 0 0 1 0 -4h4'],
  'credit-card': ['M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -8', 'M3 10l18 0', 'M7 15l.01 0', 'M11 15l2 0'],
  'cash': ['M7 15h-3a1 1 0 0 1 -1 -1v-8a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v3', 'M7 10a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -8', 'M12 14a2 2 0 1 0 4 0a2 2 0 0 0 -4 0'],
  'coins': ['M9 14c0 1.657 2.686 3 6 3s6 -1.343 6 -3s-2.686 -3 -6 -3s-6 1.343 -6 3', 'M9 14v4c0 1.656 2.686 3 6 3s6 -1.344 6 -3v-4', 'M3 6c0 1.072 1.144 2.062 3 2.598s4.144 .536 6 0c1.856 -.536 3 -1.526 3 -2.598c0 -1.072 -1.144 -2.062 -3 -2.598s-4.144 -.536 -6 0c-1.856 .536 -3 1.526 -3 2.598', 'M3 6v10c0 .888 .772 1.45 2 2', 'M3 11c0 .888 .772 1.45 2 2'],
  'shield': ['M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3'],
  'briefcase': ['M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9', 'M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2', 'M12 12l0 .01', 'M3 13a20 20 0 0 0 18 0'],
  'umbrella': ['M4 12a8 8 0 0 1 16 0l-16 0', 'M12 12v6a2 2 0 0 0 4 0'],
  'rocket': ['M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3', 'M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3', 'M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'],
  'anchor': ['M12 9v12m-8 -8a8 8 0 0 0 16 0m1 0h-2m-14 0h-2', 'M9 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'],
  'home': ['M5 12l-2 0l9 -9l9 9l-2 0', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7', 'M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6'],
  // Tabler "users-group" — a family/heirs mark; the inheritance default
  // (decided 2026-07-27: a gift box was the wrong idea for inheritance).
  'users-group': [
    'M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1',
    'M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M17 10h2a2 2 0 0 1 2 2v1',
    'M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M3 13v-1a2 2 0 0 1 2 -2h2',
  ],
  'users': [
    'M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0',
    'M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2',
    'M16 3.13a4 4 0 0 1 0 7.75',
    'M21 21v-2a4 4 0 0 0 -3 -3.85',
  ],
  'heart-handshake': [
    'M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572',
    'M12 6l-3.293 3.293a1 1 0 0 0 0 1.414l.543 .543c.69 .69 1.81 .69 2.5 0l1 -1a3.182 3.182 0 0 1 4.5 0l2.25 2.25',
    'M12.5 15.5l2 2',
    'M15 13l2 2',
  ],
  'gift': ['M3 9a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -2', 'M12 8l0 13', 'M19 12v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-7', 'M7.5 8a2.5 2.5 0 0 1 0 -5a4.8 8 0 0 1 4.5 5a4.8 8 0 0 1 4.5 -5a2.5 2.5 0 0 1 0 5'],
  'star': ['M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245'],
  'plane': ['M16 10h4a2 2 0 0 1 0 4h-4l-4 7h-3l2 -7h-4l-2 2h-3l2 -4l-2 -4h3l2 2h4l-2 -7h3l4 7'],
  'beach': ['M17.553 16.75a7.5 7.5 0 0 0 -10.606 0', 'M18 3.804a6 6 0 0 0 -8.196 2.196l10.392 6a6 6 0 0 0 -2.196 -8.196', 'M16.732 10c1.658 -2.87 2.225 -5.644 1.268 -6.196c-.957 -.552 -3.075 1.326 -4.732 4.196', 'M15 9l-3 5.196', 'M3 19.25a2.4 2.4 0 0 1 1 -.25a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 2 1a2.4 2.4 0 0 0 2 1a2.4 2.4 0 0 0 2 -1a2.4 2.4 0 0 1 2 -1a2.4 2.4 0 0 1 1 .25'],
  'crown': ['M12 6l4 6l5 -4l-2 10h-14l-2 -10l5 4l4 -6'],
  'diamond': ['M6 5h12l3 5l-8.5 9.5a.7 .7 0 0 1 -1 0l-8.5 -9.5l3 -5', 'M10 12l-2 -2.2l.6 -1'],
  'heart': ['M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572'],
  'currency-bitcoin': ['M6 6h8a3 3 0 0 1 0 6a3 3 0 0 1 0 6h-8', 'M8 6l0 12', 'M8 12l6 0', 'M9 3l0 3', 'M13 3l0 3', 'M9 18l0 3', 'M13 18l0 3'],
};

/** Default icon per SECTION key; custom labels and Other fall back to ₿. */
export function defaultIconFor(category?: string): WalletIconKey {
  if (category === CATEGORY_SINGLE_SIG) return 'wallet';
  if (category === CATEGORY_MULTISIG) return 'users-group';
  return 'currency-bitcoin';
}

/**
 * The icon a wallet SHOWS, on every screen that draws one: the owner's pick,
 * else the default for the section it shows under.
 *
 * The default reads `effectiveCategory`, never the stored category. Nothing is
 * written at creation (decided 2026-09-09), so a vault read its default off an
 * empty field and showed the bitcoin sign under "Single-sig" until the first
 * Done on Arrange stamped a shape key and flipped it to the wallet or group
 * icon. The change of 2026-09-09 meant the defaults to follow the sections, and this is the one
 * place that decides it (decided 2026-10-07). Portfolios keep the coin stack their
 * own tab draws them with.
 */
export function walletIconFor(w: WalletMeta): WalletIconKey {
  return walletIconInSection(w, effectiveCategory(w));
}

/**
 * The same rule for a wallet sitting in the section keyed `sectionKey`, which
 * need not be the one it is saved under yet. Arrange moves a vault in its own
 * list and saves only at Done, so a row asks with the section it is in NOW;
 * reading the saved one kept the wallet icon on a vault just moved under
 * Other or Multisig until Done (decided 2026-10-15).
 */
export function walletIconInSection(w: WalletMeta, sectionKey: string): WalletIconKey {
  if (isWalletIconKey(w.icon)) return w.icon;
  if (w.manual) return 'coins';
  return defaultIconFor(sectionKey);
}

export function isWalletIconKey(k: string | undefined): k is WalletIconKey {
  return !!k && (WALLET_ICON_KEYS as readonly string[]).includes(k);
}

export function WalletIconGlyph({
  icon,
  size = 22,
  color = theme.colors.gold,
}: {
  icon: WalletIconKey;
  size?: number;
  color?: string;
}): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {PATHS[icon].map((d, i) => (
        <Path
          key={i}
          d={d}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </Svg>
  );
}

/** The rounded tile used on wallet cards and pickers. */
export function WalletIconTile({
  icon,
  size = 42,
  selected = false,
}: {
  icon: WalletIconKey;
  size?: number;
  selected?: boolean;
}): React.JSX.Element {
  const radius = Math.round(size * 0.26);
  // The selected ring is 2pt of border, so the glass sits 2pt inside it.
  const inset = selected ? 2 : 0;
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: radius },
        selected && styles.tileSelected,
      ]}>
      <Gloss size={size - 2 * inset} radius={radius - inset} />
      <WalletIconGlyph icon={icon} size={Math.round(size * 0.55)} />
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  tile: {
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileSelected: { borderColor: theme.colors.accent, borderWidth: 2 },
}));
