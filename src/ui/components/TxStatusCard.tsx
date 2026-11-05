/**
 * The transaction page's status card (decided 2026-09-28, Speed up and Cancel,
 * design Option A). A `Card` (surface + Gloss at cardGlow()) in EVERY state,
 * so nothing on the page changes shape when a payment is replaced,
 * cancelled or confirmed. What it says is decided in `txStatusModel.ts`
 * (pure, tested); this draws it:
 *
 *   the circle + title + sub          always
 *   the clock + "About N at this fee" while waiting, when there is an answer
 *   one plain line                    a return: what comes back
 *   the notice                        gold with the warning mark ("The cancel
 *                                     came too late"), or plain ("Cannot be
 *                                     sped up or cancelled"), reasoning
 *                                     behind the info dot
 *   the row button                    "See the new transaction ›"
 *   Speed up + "Cancel payment"       the primary button, the text link under
 *                                     it (the only way in to a cancel; the
 *                                     red control is the dialog's)
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { Gloss } from './Gloss';
import { InfoHeading } from './InfoDot';
import { ChevronRightIcon, ClockIcon, WarningIcon } from './TablerIcons';
import { TxArrow } from './TxDirectionIcon';
import { ETA_INFO_TITLE } from './txStatusModel';
import type { TxStatusView } from './txStatusModel';
import { theme, themedStyles } from '../theme';

/** The arrow in the card's 40pt circle, as its refresh mark has always been. */
const STATUS_ARROW_SIZE = 20;

export function TxStatusCard({
  view,
  etaInfo,
  onSpeedUp,
  onCancel,
  onLink,
  busy,
}: {
  view: TxStatusView;
  /** Behind the dot beside the ETA line (`etaInfoText`). */
  etaInfo: string;
  onSpeedUp: () => void;
  onCancel: () => void;
  onLink: (txid: string) => void;
  /** Speed up or Cancel is checking the transaction before its sheet opens. */
  busy?: 'speedup' | 'cancel' | null;
}): React.JSX.Element {
  const titleColor =
    view.kind === 'sent'
      ? theme.colors.negative
      : view.kind === 'received'
        ? theme.colors.positive
        : theme.colors.offWhite;
  const circle =
    view.kind === 'sent'
      ? styles.circleOut
      : view.kind === 'received'
        ? styles.circleIn
        : styles.circleNeutral;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.circle, circle]}>
          {/* No glow: the green or red fill says received or sent. */}
          <Gloss size={40} radius={20} glow={false} />
          {/* The ledger row's own arrow, drawn, never a glyph. */}
          <TxArrow
            kind={view.glyph === 'replaced' ? 'right' : view.glyph}
            size={STATUS_ARROW_SIZE}
            color={theme.colors.offWhite}
          />
        </View>
        <View style={styles.headText}>
          <Text style={[styles.title, { color: titleColor }]}>{view.title}</Text>
          <Text style={styles.sub}>{view.sub}</Text>
        </View>
      </View>

      {view.eta != null && (
        <View style={styles.line}>
          <ClockIcon size={18} strokeWidth={2.25} color={theme.colors.slate} />
          <InfoHeading style={styles.lineText} title={ETA_INFO_TITLE} text={etaInfo}>
            {view.eta}
          </InfoHeading>
        </View>
      )}

      {view.note != null && <Text style={styles.note}>{view.note}</Text>}

      {view.notice != null &&
        (view.notice.tone === 'warning' ? (
          <View style={styles.line}>
            <WarningIcon size={18} strokeWidth={2.25} color={theme.colors.gold} />
            <InfoHeading
              style={[styles.lineText, styles.warningText]}
              title={view.notice.infoTitle}
              text={view.notice.info}>
              {view.notice.text}
            </InfoHeading>
          </View>
        ) : (
          <InfoHeading style={styles.lineText} title={view.notice.infoTitle} text={view.notice.info}>
            {view.notice.text}
          </InfoHeading>
        ))}

      {view.link != null && (
        <TouchableOpacity
          style={styles.linkRow}
          activeOpacity={0.8}
          accessibilityRole="button"
          onPress={() => view.link && onLink(view.link.txid)}>
          <Text style={styles.linkText}>{view.link.label}</Text>
          <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
        </TouchableOpacity>
      )}

      {view.speedUp && (
        <Button title="Speed up" onPress={onSpeedUp} loading={busy === 'speedup'} disabled={busy != null} />
      )}
      {view.cancel && (
        <TouchableOpacity
          style={styles.cancel}
          onPress={onCancel}
          disabled={busy != null}
          accessibilityRole="button"
          hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}>
          {/* Disabled while either action works, and says so in colour,
              never opacity, as the Speed up button does. */}
          <Text style={[styles.cancelText, busy != null && styles.cancelTextMuted]}>
            {busy === 'cancel' ? 'Checking…' : 'Cancel payment'}
          </Text>
        </TouchableOpacity>
      )}
    </Card>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    card: { gap: theme.spacing.md },
    head: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    headText: { flex: 1, minWidth: 0 },
    circle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    circleIn: { backgroundColor: 'rgba(22, 199, 132, 0.25)' },
    circleOut: { backgroundColor: 'rgba(255, 76, 76, 0.25)' },
    circleNeutral: { backgroundColor: 'rgba(115, 137, 131, 0.28)' },
    title: { ...theme.typography.heading },
    sub: { ...theme.typography.caption, color: theme.colors.slate, marginTop: 1 },
    line: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    lineText: { ...theme.typography.body, color: theme.colors.offWhite },
    warningText: { color: theme.colors.gold },
    note: { ...theme.typography.body, color: theme.colors.offWhite },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.colors.surfaceRaised,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    // A chevron row, like every other (MenuRow, the Estate Plan rows): the
    // headline in offWhite, the chevron faint; the link colour is for a text
    // link, not a row that opens another page (decided 2026-10-05).
    linkText: { ...theme.typography.heading, color: theme.colors.offWhite },
    cancel: { alignSelf: 'center', paddingVertical: theme.spacing.xs },
    cancelText: { ...theme.typography.label, color: theme.colors.slate },
    cancelTextMuted: { color: theme.colors.faint },
  }),
);
