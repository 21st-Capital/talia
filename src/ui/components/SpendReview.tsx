/**
 * THE final look before money moves, shared by every broadcast surface (decided
 * 2026-09-01: the co-signed send must match the self-signed one). A facts
 * card with vault, signatures and fee, then one card per destination with
 * the full address in the Receive screen's chunked alternating colors and
 * the amount one type step above, bold, sats beneath.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AddressChunks } from './AddressChunks';
import { Card } from './Card';
import { theme, themedStyles } from '../theme';
import { formatSats } from '../../wallet';

export interface SpendReviewOutput {
  /** The card's label; "To" when absent (a cancel: "Back to this vault"). */
  label?: string;
  address: string | null;
  /** Already formatted main amount line (unit-aware). */
  amountLine: string;
  amountSats: number;
}

export function SpendReview({
  vaultLabel,
  signaturesLine,
  feeSats,
  outputs,
  refreshNote,
}: {
  vaultLabel: string;
  signaturesLine: string;
  feeSats: number | null;
  outputs: SpendReviewOutput[];
  /** Shown when no external output exists (a coin refresh). */
  refreshNote?: string;
}): React.JSX.Element {
  return (
    <>
      <Card style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.label}>Vault</Text>
          <Text style={styles.value}>{vaultLabel}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Signatures</Text>
          <Text style={styles.value}>{signaturesLine}</Text>
        </View>
        {feeSats != null && (
          <View style={styles.row}>
            <Text style={styles.label}>Network fee</Text>
            <Text style={styles.value}>{formatSats(feeSats)}</Text>
          </View>
        )}
      </Card>
      {outputs.map((o, i) => (
        <Card key={i} style={styles.card}>
          <Text style={styles.label}>{o.label ?? 'To'}</Text>
          {o.address ? (
            <AddressChunks address={o.address} />
          ) : (
            <Text style={styles.value}>unrecognised destination</Text>
          )}
          <Text style={styles.amount}>{o.amountLine}</Text>
          <Text style={styles.amountSub}>{formatSats(o.amountSats)}</Text>
        </Card>
      ))}
      {outputs.length === 0 && !!refreshNote && (
        <Card style={styles.card}>
          <Text style={styles.note}>{refreshNote}</Text>
        </Card>
      )}
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    card: { gap: theme.spacing.sm },
    row: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md },
    label: { ...theme.typography.body, color: theme.colors.slate },
    value: { ...theme.typography.body, color: theme.colors.offWhite, flexShrink: 1, textAlign: 'right' },
    note: { ...theme.typography.body, color: theme.colors.slate },
    // One clean type step per level (decided 2026-09-01): the address in the
    // Receive screen's groups, the amount one step above at title size, sats
    // a caption beneath.
    amount: {
      ...theme.typography.title,
      color: theme.colors.offWhite,
      marginTop: theme.spacing.sm,
    },
    amountSub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 2 },
  }),
);
