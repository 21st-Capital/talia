/**
 * The inside of one history row, the SAME on a vault's transactions and a
 * portfolio's buys and sells: the direction mark, the title with its quiet
 * lines, the amount with its money line, and the note.
 *
 * Why it exists (decided 2026-10-22, from a client's phone with larger text
 * and Display Zoom): the amount column took its full width and the title
 * column got what was left, so "Bought" broke into "Bough / t", the date
 * wrapped onto two lines and a note was cut after a word. The rule now:
 *
 *   · Two pairs, each a wrapping row: the title with the amount, then the
 *     quiet lines (date, "Waiting for confirmation") with the money line.
 *     The two of a pair sit side by side when both fit at their natural
 *     width; when they do not, the right one moves under the left one, and
 *     STAYS at the right edge (decided 2026-10-29: one block of title and
 *     quiet lines sized the wrap, so a waiting payment's "Waiting for
 *     confirmation" pushed its amount onto a line of its own at the standard
 *     text size, and that line started at the left). The phone's own layout
 *     decides, at any text size and any screen width; nothing here guesses a
 *     width.
 *   · A word is never broken: the title and its lines wrap only at spaces,
 *     and the amount is one FitText line that shrinks only when it is wider
 *     than the whole row on its own.
 *   · The note is a line of its own under both blocks, across the row's full
 *     width, and gets two lines before it is cut.
 *
 * The amount and the money line are always at the right edge, side by side
 * or moved under, as a label's value is (the facts rows). Each history keeps the colours
 * its quiet lines and its note had (`lineColor`, `noteColor`): a vault's
 * note is bright, a portfolio's date faint.
 */
import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { naturalLineHeight, theme, themedStyles } from '../theme';
import { FitText } from './FitText';
import { TX_ICON_SIZE } from './TxDirectionIcon';
import { firstLineLift } from './ledgerRowLayout';

export function LedgerRowContent({
  icon,
  title,
  lines,
  amount,
  amountColor,
  sub,
  note,
  lineColor,
  noteColor,
}: {
  /** The direction mark (`TxDirectionIcon`). */
  icon: React.ReactNode;
  /** "Bought", "Sold", "Received", "Sent"... */
  title: string;
  /** Quiet lines under the title: the date, "Waiting for confirmation". */
  lines?: readonly string[];
  amount: string;
  amountColor: string;
  /** The line under the amount: its value in money. */
  sub?: string;
  /** The owner's note, on a line of its own. */
  note?: string;
  /** The quiet lines' colour, a theme token. */
  lineColor: string;
  /** The note's colour, a theme token. */
  noteColor: string;
}): React.JSX.Element {
  const { fontScale } = useWindowDimensions();
  const quiet = lines ?? [];
  // The first line sits level with the mark's centre at any text size.
  const lift = { paddingTop: firstLineLift(TX_ICON_SIZE, naturalLineHeight(theme.typography.heading.fontSize), fontScale) };
  return (
    <>
      <View style={styles.icon}>{icon}</View>
      <View style={[styles.body, lift]}>
        <View style={styles.pairs}>
          <View style={styles.pair}>
            <Text style={[styles.left, styles.title]}>{title}</Text>
            <View style={styles.right}>
              <FitText style={[styles.amount, { color: amountColor }]}>{amount}</FitText>
            </View>
          </View>
          {(quiet.length > 0 || sub != null) && (
            <View style={styles.pair}>
              {quiet.length > 0 && (
                <View style={[styles.left, styles.lines]}>
                  {quiet.map((line) => (
                    <Text key={line} style={[styles.line, { color: lineColor }]}>
                      {line}
                    </Text>
                  ))}
                </View>
              )}
              {sub != null && <Text style={[styles.right, styles.sub]}>{sub}</Text>}
            </View>
          )}
        </View>
        {note ? (
          <Text style={[styles.note, { color: noteColor }]} numberOfLines={2}>
            {note}
          </Text>
        ) : null}
      </View>
    </>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    icon: { alignSelf: 'flex-start' },
    body: { flex: 1, minWidth: 0, gap: theme.spacing.xs },
    pairs: { gap: 2 },
    // One wrapping row per pair: side by side when both fit, the right one
    // on the next line when they do not.
    pair: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'flex-start',
      columnGap: theme.spacing.md,
      rowGap: 2,
    },
    // Never wider than the row: alone on its line it wraps at a space.
    left: { flexShrink: 1, maxWidth: '100%' },
    // The auto margin keeps the right one at the right edge on its own line too.
    right: { marginLeft: 'auto', flexShrink: 1, maxWidth: '100%', alignItems: 'flex-end' },
    // The title sits level with the FitText amount beside it, so both take
    // the face's own leading (the one case a token's line height is dropped).
    title: { ...theme.typography.heading, lineHeight: undefined, color: theme.colors.offWhite },
    lines: { gap: 2 },
    line: { ...theme.typography.caption },
    amount: { ...theme.typography.heading },
    sub: { ...theme.typography.caption, color: theme.colors.faint, textAlign: 'right' },
    note: { ...theme.typography.caption },
  }),
);
