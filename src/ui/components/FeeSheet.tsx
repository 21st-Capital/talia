/**
 * The fee sheet: High, Medium and Slow, each with its waiting time and its
 * fee, then the client's own rate. ONE sheet for Send's Priority and for
 * Speed up and Cancel on a waiting transaction (decided 2026-09-28, design A:
 * lifted out of SendScreen so both use the same one, never a copy).
 *
 * The caller decides the rows and what a tap does (Send closes the sheet on
 * a tier; Speed up and Cancel keep it open under their own button); this
 * draws them. A row a client cannot pick (a tier at or under what a
 * replacement must pay) is MUTED IN COLOUR, never with opacity, and says why
 * in its own meta line.
 *
 * The sheet rides on the keyboard: the custom rate field is its last row,
 * and the number pad covered exactly what was being typed (decided 2026-09-16).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { AppModal } from './AppModal';
import { DraggableSheet } from './DraggableSheet';
import { FitText } from './FitText';
import { factsStacked } from './ledgerRowLayout';
import { RadioMark } from './RadioMark';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { theme, themedStyles } from '../theme';

export interface FeeSheetRow {
  key: string;
  /** "High", "Medium", "Slow". */
  label: string;
  /** "about 10 minutes · 12 sat/vB", or why the row cannot be picked. */
  meta: string;
  /** The right column's first line (the fee in the client's currency). */
  main?: string | null;
  /** The right column's second line (the same fee in sats). */
  sub?: string | null;
  /** Drawn in the faint colour and not tappable. */
  muted?: boolean;
  on: boolean;
  onPress?: () => void;
}

export interface FeeSheetCustom {
  /** The rate as typed. */
  value: string;
  onChangeText: (text: string) => void;
  onFocus?: () => void;
  /** A tap on the row outside the field (Speed up and Cancel pick it at its placeholder). */
  onPress?: () => void;
  placeholder: string;
  /** Beside the field: "sat/vB", or "sat/vB · at least 2". */
  unitMeta: string;
  on: boolean;
  main?: string | null;
  sub?: string | null;
  /** A typed rate that cannot be used, said in the negative colour. */
  bad?: string | null;
}

export function FeeSheet({
  visible,
  onClose,
  title,
  caption,
  rows,
  custom,
  footer,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** One quiet line under the title ("Now 1 sat/vB · about 3 hours"). */
  caption?: string | null;
  rows: FeeSheetRow[];
  custom?: FeeSheetCustom;
  /** Under the rows, above a hairline: the info lines. */
  footer?: React.ReactNode;
  /** Last: a primary button, when the sheet has one. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const kbHeight = useKeyboardHeight();
  // At the accessibility text sizes a row's words and its amounts stack: side
  // by side the amounts took the row and the tier's name went to nothing
  // (decided 2026-10-31 after a phone test of the cancel dialog's row).
  const stacked = factsStacked(useWindowDimensions().fontScale);
  const content = (
    <>
      {/* DraggableSheet draws the grab handle itself. */}
      <Text style={styles.title}>{title}</Text>
      {!!caption && <Text style={styles.caption}>{caption}</Text>}
      {rows.map((r) => (
        <FeeRow key={r.key} row={r} stacked={stacked} />
      ))}
      {custom && <CustomRow custom={custom} stacked={stacked} />}
      {footer != null && <View style={styles.footer}>{footer}</View>}
    </>
  );
  return (
    <AppModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <DraggableSheet
          visible={visible}
          onDismiss={onClose}
          style={[styles.sheet, stacked && styles.sheetStacked, kbHeight > 0 && { paddingBottom: theme.spacing.md + kbHeight }]}>
          {/* Taller than the screen, the rows scroll: a tier past the top of
              the screen could be neither read nor picked. The button stays. */}
          {stacked ? (
            <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
              {content}
            </ScrollView>
          ) : (
            content
          )}
          {children}
        </DraggableSheet>
      </TouchableOpacity>
    </AppModal>
  );
}

function Amounts({
  main,
  sub,
  muted,
  stacked,
  children,
}: {
  main?: string | null;
  sub?: string | null;
  muted?: boolean;
  stacked: boolean;
  children?: React.ReactNode;
}) {
  // Stacked, each amount has the row to itself, one line that fits it.
  const Line = stacked ? FitText : Text;
  return (
    <View style={[styles.amounts, stacked && styles.amountsStacked]}>
      {main != null && <Line style={[styles.fee, muted && styles.mutedText]}>{main}</Line>}
      {sub != null && <Line style={[styles.meta, muted && styles.mutedText]}>{sub}</Line>}
      {children}
    </View>
  );
}

function FeeRow({ row, stacked }: { row: FeeSheetRow; stacked: boolean }): React.JSX.Element {
  const body = (
    <>
      <View style={[styles.figures, stacked && styles.figuresStacked]}>
        <View style={[styles.body, stacked && styles.bodyStacked]}>
          <Text style={[styles.label, row.muted && styles.mutedText]}>{row.label}</Text>
          <Text style={[styles.meta, row.muted && styles.mutedText]}>{row.meta}</Text>
        </View>
        <Amounts main={row.main} sub={row.sub} muted={row.muted} stacked={stacked} />
      </View>
      <RadioMark on={row.on} />
    </>
  );
  if (!row.onPress || row.muted) {
    return (
      <View
        style={styles.row}
        accessibilityRole="radio"
        accessibilityState={{ selected: row.on, disabled: true }}>
        {body}
      </View>
    );
  }
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={row.onPress}
      activeOpacity={0.8}
      accessibilityRole="radio"
      accessibilityState={{ selected: row.on }}>
      {body}
    </TouchableOpacity>
  );
}

function CustomRow({ custom, stacked }: { custom: FeeSheetCustom; stacked: boolean }): React.JSX.Element {
  const body = (
    <>
      <View style={[styles.figures, stacked && styles.figuresStacked]}>
        <View style={[styles.body, stacked && styles.bodyStacked]}>
          <Text style={styles.label}>Custom</Text>
          <View style={[styles.customRow, stacked && styles.customRowStacked]}>
            <TextInput
              style={styles.customInput}
              value={custom.value}
              onChangeText={custom.onChangeText}
              onFocus={custom.onFocus}
              keyboardType="decimal-pad"
              placeholder={custom.placeholder}
              placeholderTextColor={theme.colors.faint}
              maxLength={7}
              accessibilityLabel="Your own fee rate, in satoshis per virtual byte"
            />
            <Text style={styles.meta}>{custom.unitMeta}</Text>
          </View>
        </View>
        <Amounts main={custom.main} sub={custom.sub} stacked={stacked}>
          {!!custom.bad && <Text style={styles.bad}>{custom.bad}</Text>}
        </Amounts>
      </View>
      <RadioMark on={custom.on} />
    </>
  );
  // Send's row is not a button: typing a usable number is what picks it, and
  // the sheet stays open because the number is not finished until they stop.
  if (!custom.onPress) return <View style={styles.row}>{body}</View>;
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={custom.onPress}
      activeOpacity={0.8}
      accessibilityRole="radio"
      accessibilityState={{ selected: custom.on }}>
      {body}
    </TouchableOpacity>
  );
}

/** For the caller's footer lines, so they match the rows. */
export const feeSheetStyles = themedStyles(() =>
  StyleSheet.create({
    meta: { ...theme.typography.caption, color: theme.colors.slate },
    /** Send's "Acceleration (RBF) · Always on": text left, value right. */
    footerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
  }),
);

const styles = themedStyles(() =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: theme.colors.scrim,
      justifyContent: 'flex-end',
    },
    // One sheet recipe: the glass, tint and finish come from DraggableSheet,
    // so no extra ground here (decided 2026-09-14).
    sheet: {
      borderTopLeftRadius: theme.radius.lg,
      borderTopRightRadius: theme.radius.lg,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.xxl + theme.spacing.md,
      borderTopWidth: 1,
      borderColor: theme.colors.offWhite + '2E',
    },
    sheetStacked: { maxHeight: '94%' },
    scroll: { flexShrink: 1 },
    title: { ...theme.typography.title, color: theme.colors.offWhite, marginBottom: theme.spacing.sm },
    caption: { ...theme.typography.caption, color: theme.colors.slate, marginBottom: theme.spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingVertical: theme.spacing.md,
      borderTopWidth: 1,
      borderColor: theme.colors.hairline,
    },
    figures: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
    figuresStacked: { flexDirection: 'column', alignItems: 'stretch', gap: theme.spacing.xs },
    body: { flex: 1, minWidth: 0, gap: 2 },
    bodyStacked: { flex: 0 },
    label: { ...theme.typography.heading, color: theme.colors.offWhite },
    meta: { ...theme.typography.caption, color: theme.colors.slate },
    mutedText: { color: theme.colors.faint },
    amounts: { alignItems: 'flex-end', gap: 2 },
    amountsStacked: { alignItems: 'flex-start' },
    fee: { ...theme.typography.heading, color: theme.colors.offWhite },
    customRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs },
    customRowStacked: { flexWrap: 'wrap' },
    // Wide enough for "1000.5" without moving the amounts beside it.
    customInput: {
      ...theme.typography.heading,
      color: theme.colors.offWhite,
      minWidth: 68,
      paddingVertical: 2,
      paddingHorizontal: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.colors.surfaceRaised,
    },
    bad: { ...theme.typography.caption, color: theme.colors.negative },
    footer: {
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.md,
      borderTopWidth: 1,
      borderColor: theme.colors.hairline,
    },
  }),
);
