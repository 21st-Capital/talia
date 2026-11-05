/**
 * The technical facts about a vault, folded away (decided 2026-09-01, modelled on
 * BlueWallet's "Advanced" card).
 *
 * COLLAPSED BY DEFAULT AND SILENT UNTIL OPENED. The Spending policy screen
 * exists to answer "how can money leave this vault" in plain language; script
 * types and derivation paths answer a different question that most owners
 * never ask. Folding them away keeps the screen readable while giving an
 * advanced owner everything they need to rebuild this vault elsewhere.
 *
 * BlueWallet shows one fingerprint and one path because it describes a
 * single-signature wallet. A Talia vault has several keys, so the same facts
 * appear once per key, plus the descriptor itself, which is the only thing
 * that truly reconstructs the vault.
 */
import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native';

import { Button } from './Button';
import { Card } from './Card';
import { ChevronRightIcon } from './TablerIcons';
import { copySecret } from '../../platform/clipboard';
import { theme, themedStyles } from '../theme';
import { describeScript, parseKeyOrigins, stripChecksum } from '../../bitcoin/descriptor';
import { keyDisplayName } from '../../wallet/keyNames';
import { ownKeysFirst } from '../../wallet/keyOrder';
import type { Network } from '../../bitcoin/descriptor';
import { NETWORK_LABELS } from '../../bitcoin/network';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}


export function AdvancedVaultDetails({
  descriptor,
  network,
  keyLabels,
  accountNumber,
  vaultNumber,
  paidForBy,
  isProviderKey,
}: {
  descriptor: string;
  network: Network;
  keyLabels?: Record<string, string>;
  /** 21st Capital account number for this vault, when known. */
  accountNumber?: number;
  vaultNumber?: number;
  /** Who pays for this vault when it is somebody else's plan (decided 2026-09-20).
   *  Said here and in Membership, never on the everyday vault card. */
  paidForBy?: string | null;
  isProviderKey?: (fingerprint?: string) => boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const keys = useMemo(() => {
    try {
      // De-duplicated by fingerprint+path: a multipath descriptor names the
      // same key in the receive and change branches, and listing it twice
      // reads as two devices.
      const seen = new Set<string>();
      const unique = parseKeyOrigins(stripChecksum(descriptor).body).filter((k) => {
        const id = `${k.fingerprint ?? ''}:${k.originPath ?? ''}:${k.xpub}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      // The client's own keys first, 21st Capital's last (decided 2026-09-21).
      return ownKeysFirst(unique, (k) => !!isProviderKey?.(k.fingerprint));
    } catch {
      return [];
    }
  }, [descriptor, isProviderKey]);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((v) => !v);
  };

  return (
    <Card style={styles.card}>
      <TouchableOpacity
        style={styles.head}
        activeOpacity={0.8}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Advanced vault details">
        <Text style={styles.title}>Advanced</Text>
        <View style={open ? styles.chevronOpen : styles.chevron}>
          <ChevronRightIcon size={18} color={theme.colors.slate} />
        </View>
      </TouchableOpacity>

      {open && (
        <View style={styles.body}>
          <Row label="Type" value={describeScript(descriptor)} />
          {/* "Bitcoin" or "Testnet4", the names the vault configurator uses: the
              real network is simply Bitcoin (decided 2026-09-23: "I dont want
              client to see mainnet written anywhere"). */}
          <Row label="Network" value={NETWORK_LABELS[network] ?? network} />
          {accountNumber != null && (
            <Row
              label="21st Capital account"
              value={
                vaultNumber != null
                  ? `${accountNumber} (vault ${vaultNumber})`
                  : String(accountNumber)
              }
            />
          )}
          {!!paidForBy && <Row label="Paid for by" value={paidForBy} />}

          <Text style={styles.section}>DESCRIPTOR</Text>
          <Text style={styles.descriptor} selectable>
            {descriptor}
          </Text>
          <Button
            title={copied ? 'Copied' : 'Copy descriptor'}
            variant="ghost"
            onPress={() => {
              copySecret(descriptor, 'vaultKeys');
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          />
          <Text style={styles.note}>
            The descriptor is the whole vault: with it, any descriptor-native
            wallet can rebuild this vault and watch its balance. It holds no
            private keys, so it cannot move coins on its own.
          </Text>

          {keys.length > 0 && (
            <>
              <Text style={styles.section}>KEYS</Text>
              {keys.map((k, i) => {
                const fp = k.fingerprint;
                // The vault's own name for this key, else the number every
                // screen gives it (decided 2026-09-26): this card used to count
                // its own rows, which are sorted with our keys last, so its
                // number could differ from the one the Sign screen showed.
                const label = keyDisplayName({ descriptor, keyLabels }, fp, (f) => isProviderKey?.(f) === true);
                const ours = isProviderKey?.(fp) === true;
                return (
                  <View key={`${fp ?? 'k'}:${i}`} style={styles.keyRow}>
                    <Text style={styles.keyName}>
                      {ours ? label ?? '21st Capital' : label ?? `Key ${i + 1}`}
                    </Text>
                    <Text style={styles.mono} selectable>
                      {fp ? fp.toUpperCase() : 'no fingerprint'}
                    </Text>
                    <Text style={styles.monoDim} selectable>
                      {k.originPath ? `m/${k.originPath}` : 'no derivation path'}
                    </Text>
                  </View>
                );
              })}
            </>
          )}

        </View>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    card: { gap: 0, paddingVertical: theme.spacing.md },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 34,
    },
    title: { ...theme.typography.heading, color: theme.colors.offWhite },
    chevron: { transform: [{ rotate: '90deg' }] },
    chevronOpen: { transform: [{ rotate: '270deg' }] },

    body: { gap: theme.spacing.sm, marginTop: theme.spacing.md },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: theme.spacing.md,
      alignItems: 'flex-start',
    },
    rowLabel: { ...theme.typography.body, color: theme.colors.slate },
    rowValue: {
      ...theme.typography.body,
      color: theme.colors.offWhite,
      flexShrink: 1,
      textAlign: 'right',
    },

    section: {
      ...theme.typography.label,
      color: theme.colors.slate,
      letterSpacing: 1.1,
      marginTop: theme.spacing.sm,
    },
    keyRow: { gap: 1 },
    keyName: { ...theme.typography.bodyStrong, color: theme.colors.offWhite },
    mono: { ...theme.typography.mono, color: theme.colors.gold },
    monoDim: { ...theme.typography.mono, color: theme.colors.slate },

    descriptor: { ...theme.typography.mono, color: theme.colors.slate },
    note: { ...theme.typography.caption, color: theme.colors.faint },
  }),
);
