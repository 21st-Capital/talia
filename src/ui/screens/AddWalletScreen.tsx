/**
 * "+" entry point: create a brand-new vault with your hardware keys, or add
 * one that already exists elsewhere (Liana, Sparrow, a descriptor backup, a
 * descriptor QR) — always watch-only.
 *
 * In the watch-only build the create door is hidden (HWW_ENABLED): a vault
 * built with no device present is one nobody has proven they can sign for.
 * Importing and claiming an heir invite both stay.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { HWW_ENABLED, LEDGER_PREVIEW, SIGNING_ENABLED } from '../../config';
import { theme, themedStyles } from '../theme';
import { ChevronRightIcon, DownloadIcon, Gloss, VaultIcon, WalletIconGlyph, cardGlow } from '../components';

type Props = NativeStackScreenProps<RootStackParamList, 'AddWallet'>;

export function AddWalletScreen({ navigation }: Props): React.JSX.Element {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      {/* Intent-based doors (confirmed 2026-07-18): "design a policy" vs
          "it already exists somewhere" — never tell a user "wrong door". */}
      {/* Building a vault is offered ONLY when a signing device can be on the
          table (decided 2026-09-04). Without one, a client could compose a vault
          from a pasted key nobody has proven they can sign with, fund it, and
          be unable to move the coins. Watch-only builds import instead. */}
      {(SIGNING_ENABLED || HWW_ENABLED) && (
        <ChoiceCard
          icon={<VaultIcon size={26} color={theme.colors.gold} />}
          title="Set up a new vault"
          body={
            HWW_ENABLED
              ? 'Choose how many keys protect it, then connect your hardware.'
              : 'Choose how many keys protect it, then add the public key from each of your devices.'
          }
          onPress={() => navigation.navigate('CreateVault')}
        />
      )}
      <ChoiceCard
        icon={<DownloadIcon size={26} strokeWidth={2} color={theme.colors.gold} />}
        title="Add an existing vault"
        body="Single key or shared, from a hardware wallet or a wallet app."
        onPress={() => navigation.navigate('Import')}
      />
      {(SIGNING_ENABLED || LEDGER_PREVIEW) && (
        <ChoiceCard
          icon={<WalletIconGlyph icon="users-group" size={26} />}
          title="Claim an heir invite"
          // Not every invite is sealed: a keyless one opens at once
          // (decided 2026-09-22).
          body="Enter the code from your invite email to see the vault you were invited to."
          onPress={() => navigation.navigate('ClaimInvite')}
        />
      )}
      <Text style={styles.footnote}>
        Talia never holds your keys. Signing happens on your hardware device.
      </Text>
    </ScrollView>
  );
}

function ChoiceCard({
  icon,
  title,
  body,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress}>
      <Gloss radius={theme.radius.lg} strength={cardGlow()} />
      <View style={styles.cardIcon}>
        <Gloss size={52} radius={theme.radius.md} />
        {icon}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardText}>{body}</Text>
      </View>
      <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  // The page gutter every page has (decided 2026-10-05); the cards keep
  // their own `xl` inside.
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.lg,
    // One card recipe with the home screen (decided 2026-09-16, on seeing this
    // ground and this finish side by side): the glass finish brings its own
    // top-lit edge, so no hairline border, and the card clips to its corners.
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    padding: theme.spacing.xl,
  },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0, gap: theme.spacing.xs },
  cardTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  cardText: { ...theme.typography.caption, color: theme.colors.slate },
  footnote: {
    ...theme.typography.caption,
    color: theme.colors.faint,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
  },
}));
