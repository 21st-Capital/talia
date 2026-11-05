/**
 * A filed rescue request, opened from its card on the Rescue page (decided
 * 2026-11-03): a rescue is done by hand and confirmed with the client on a
 * video call, so the client can read back every detail they sent. Title, the
 * rows of the Sent page's card (FactRow, the same card), one line when the
 * figures cannot be shown, and Done.
 *
 * What it shows is decided in `wallet/rescueRequestFacts.ts`, from the
 * phone's own transaction and never from the server's word; the address is
 * the phone's own record, in groups of four so it can be read aloud, with
 * Copy. Hidden balances hide the figures, as on the Sent page.
 *
 * The backdrop is a layer of its own behind the sheet, not a wrapper around
 * it, so a tap on the address or a row never closes the sheet.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme, themedStyles } from '../theme';
import { copyToClipboard } from '../../platform/clipboard';
import { rescueFigureRows, rescueRequestLine } from '../../wallet/rescueRequestFacts';
import type { RescueRequestFacts } from '../../wallet/rescueRequestFacts';
import type { AmountUnit } from '../../wallet/types';
import { AddressChunks } from './AddressChunks';
import { AppModal } from './AppModal';
import { Button } from './Button';
import { Card } from './Card';
import { CopiedFlash } from './CopiedFlash';
import { DraggableSheet } from './DraggableSheet';
import { FactRow } from './FactRow';
import { MASK_SMALL } from './sentPageModel';
import { CopyIcon } from './TablerIcons';

/** How long "Address copied" stays, as on Receive. */
const COPIED_MS = 900;

export function RescueRequestSheet({
  visible,
  title,
  vaultName,
  destination,
  askedOn,
  facts,
  unit,
  masked,
  onClose,
}: {
  visible: boolean;
  /** The request's state, as its card says it. */
  title: string;
  vaultName: string;
  /** The address this phone recorded when it filed; null when it kept none. */
  destination: string | null;
  /** When it was asked, in the phone's words; null when not known. */
  askedOn: string | null;
  /** Null while the phone is still reading them. */
  facts: RescueRequestFacts | null;
  unit: AmountUnit;
  masked: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const onCopy = () => {
    if (!destination) return;
    copyToClipboard(destination);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const rows = facts ? rescueFigureRows(facts, unit, masked ? MASK_SMALL : null) : [];
  const line = facts ? rescueRequestLine(facts) : null;

  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.window}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
        <DraggableSheet visible={visible} onDismiss={onClose} style={styles.sheet}>
          {/* Taller than the screen (the largest text sizes), the rows
              scroll and Done stays in view. */}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} alwaysBounceVertical={false}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Card style={styles.card}>
              <FactRow label="Vault" value={vaultName} />
              {destination != null && (
                <View style={styles.addressBlock}>
                  <View style={styles.addressHead}>
                    <Text style={styles.addressLabel}>Sending to</Text>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel="Copy address"
                      hitSlop={HIT}
                      style={styles.iconTap}
                      onPress={onCopy}>
                      <CopyIcon size={18} strokeWidth={2} color={theme.colors.slate} />
                    </TouchableOpacity>
                  </View>
                  <AddressChunks address={destination} />
                </View>
              )}
              {facts == null ? (
                <ActivityIndicator color={theme.colors.gold} style={styles.reading} />
              ) : (
                rows.map((r) => <FactRow key={r.label} label={r.label} value={r.value} sub={r.sub} />)
              )}
              {askedOn != null && <FactRow label="Asked on" value={askedOn} />}
            </Card>
            {line != null && (
              <Text style={[styles.line, line.tone === 'warning' && styles.warning, line.tone === 'alarm' && styles.alarm]}>
                {line.text}
              </Text>
            )}
          </ScrollView>
          <Button title="Done" onPress={onClose} />
        </DraggableSheet>
        {/* Inside the modal's own window, over the sheet: the page's flash
            would sit under it. */}
        <CopiedFlash visible={copied} label="Address copied" />
      </View>
    </AppModal>
  );
}

const HIT = { top: 8, bottom: 8, left: 8, right: 8 };

const styles = themedStyles(() =>
  StyleSheet.create({
    window: { flex: 1, justifyContent: 'flex-end' },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.scrim },
    // One sheet recipe: the glass, tint and finish come from DraggableSheet,
    // so no extra ground here (decided 2026-09-14).
    sheet: {
      maxHeight: '94%',
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.xxl,
      borderTopWidth: 1,
      borderColor: theme.colors.offWhite + '2E',
    },
    scroll: { flexShrink: 1 },
    content: { gap: theme.spacing.md, paddingBottom: theme.spacing.lg },
    title: { ...theme.typography.title, color: theme.colors.offWhite },
    // The Sent page's card: its rows, its gap.
    card: { gap: theme.spacing.sm },
    addressBlock: { gap: theme.spacing.sm },
    addressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    // FactRow's label, so the block reads as one of the rows.
    addressLabel: { ...theme.typography.body, color: theme.colors.slate },
    iconTap: { padding: theme.spacing.xs, margin: -theme.spacing.xs },
    reading: { alignSelf: 'flex-start' },
    line: { ...theme.typography.body, color: theme.colors.slate },
    warning: { color: theme.colors.gold },
    alarm: { color: theme.colors.negative },
  }),
);
