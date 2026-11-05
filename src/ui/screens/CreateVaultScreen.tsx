/**
 * New-vault type picker (Phase 2): single-sig, multisig, or a layered
 * (timelocked) inheritance vault — kept deliberately non-technical; the
 * builder screen does the real work.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { Gloss, GoldChip, InfoHeading, RecommendedBand, cardGlow, recommendedFrame } from '../components';
import { theme, themedStyles } from '../theme';
import { HWW_ENABLED } from '../../config';

type Props = NativeStackScreenProps<RootStackParamList, 'CreateVault'>;

const TYPES: Array<{
  key: 'single' | 'multi' | 'timelock';
  title: string;
  tagline: string;
  body: string;
  recommended?: boolean;
}> = [
  // Layered (recommended), then multisig, then single-sig (decided 2026-09-21,
  // the second order of the day: "1. Layered 2. multisig 3. single sig").
  {
    key: 'timelock',
    // "Multisig + Timelock", the words most people know (decided 2026-09-21).
    // A single key with a timelocked layer is still built from Single-sig,
    // whose configurator adds the rescue key.
    title: 'Multisig + Timelock',
    tagline: 'INHERITANCE-READY',
    recommended: true,
    // The chosen one of three drafts (2026-09-21, option C), made true for every
    // backup key (decided 2026-09-22): the rescue key's wait is fixed, not
    // chosen, and a path opens only for coins left untouched.
    body: "Your keys spend as usual. A backup key (an heir's or a rescue key) can recover coins left untouched for a waiting period.",
  },
  {
    key: 'multi',
    title: 'Multisig',
    tagline: 'K OF N DEVICES',
    body: 'Several keys share control. A set number of them must sign together.',
  },
  {
    key: 'single',
    title: 'Single-sig',
    tagline: 'ONE DEVICE',
    // Three cards, one breath each, the same weight (decided 2026-09-02: the
    // page read as overwhelming). Detail lives in the steps that follow.
    body: 'One hardware key signs. Add a 21st Capital rescue key in case yours is lost.',
  },
];

export function CreateVaultScreen({ navigation }: Props): React.JSX.Element {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <InfoHeading
        title="Where the keys come from"
        text={
          HWW_ENABLED
            ? 'Keys come from your hardware devices. A device that connects over Bluetooth hands its key to Talia itself, and others export theirs as a QR code. Talia only ever receives the public part, which is why a vault can watch your coins without being able to spend them.'
            : 'Keys come from your hardware devices, which export a public key as a file or a QR code. Talia only ever receives the public part, which is why a vault can watch your coins without being able to spend them.'
        }>
        How should your new vault be protected?
      </InfoHeading>
      {TYPES.map((t) => (
        <TouchableOpacity
          key={t.key}
          style={[styles.card, t.recommended && recommendedFrame()]}
          activeOpacity={0.85}
          onPress={() =>
            // The configurator owns single-sig and layered vaults (it alone
            // offers the 21C rescue/co-signing keys, decided 2026-07-27, restored
            // to the Ledger preview 2026-08-26). Plain multisig stays with
            // the self-custodial builder.
            t.key === 'timelock'
              ? navigation.navigate('LayeredVault')
              : t.key === 'single'
                ? navigation.navigate('LayeredVault', { scheme: 'single-1-1' })
                : navigation.navigate('VaultBuilder', { vaultType: t.key })
          }>
          <Gloss radius={theme.radius.lg} strength={cardGlow()} />
          {/* The whole card marks the recommended option (decided 2026-09-21,
              option C): gold frame, warm tint, the band across the top. */}
          {t.recommended && <RecommendedBand inset={theme.spacing.xl} />}
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>{t.title}</Text>
            <GoldChip label={t.tagline} style={styles.chipInRow} />
          </View>
          <Text style={styles.cardText}>{t.body}</Text>
        </TouchableOpacity>
      ))}
      <Text style={styles.footnote}>
        Every vault starts watch-only. Your seed words never leave the device.
      </Text>
    </ScrollView>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  // The page gutter every page has (decided 2026-10-05); the cards keep
  // their own `xl` inside.
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  card: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  cardTitle: { ...theme.typography.heading, color: theme.colors.offWhite, flexShrink: 1 },
  chipInRow: { alignSelf: 'center' },
  cardText: { ...theme.typography.body, color: theme.colors.slate },
  footnote: {
    ...theme.typography.caption,
    color: theme.colors.faint,
    textAlign: 'center',
  },
}));
