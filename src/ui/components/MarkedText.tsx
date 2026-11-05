/**
 * Lists that hang (decided 2026-09-08: "please make sure the sentences do not
 * continue on the second line from the beginning of the bullet point or
 * number but rather where the sentence above started").
 *
 * A marker and its sentence in ONE `<Text>` wrap back to the left margin,
 * so the second line sits under the number and the eye loses the column.
 * Here the marker gets its own fixed column and the sentence its own
 * block, which is what a hanging indent is.
 *
 * `markedLines` is the pure half: it splits a message into paragraphs and
 * list rows, so a string typed with "1." or "• " lines needs no special
 * handling at the call site. Every dialog, info sheet and step list runs
 * through here.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { theme, themedStyles } from '../theme';
import { markedLines } from './markedLines';
export { markedLines } from './markedLines';
export type { MarkedLine } from './markedLines';

/** One row: the marker in its own column, the sentence beside it. */
function Row({
  marker,
  text,
  style,
}: {
  marker: string;
  text: string;
  style?: StyleProp<TextStyle>;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text style={[style, styles.marker]}>{marker}</Text>
      <Text style={[style, styles.body]}>{text}</Text>
    </View>
  );
}

/**
 * A message where any line starting with a number or a bullet becomes a
 * hanging row. `style` is the caller's text style and applies to both
 * columns, so nothing about the type changes.
 */
export function MarkedText({
  text,
  style,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
}): React.JSX.Element {
  const lines = markedLines(text);
  if (!lines.some((l) => l.marker)) {
    // Nothing to hang: one Text, exactly as before, so paragraphs keep
    // their own line breaks.
    return <Text style={style}>{text}</Text>;
  }
  return (
    <View style={styles.stack}>
      {lines.map((l, i) =>
        l.marker ? (
          <Row key={i} marker={l.marker} text={l.text} style={style} />
        ) : l.text ? (
          <Text key={i} style={style}>
            {l.text}
          </Text>
        ) : (
          // A blank line the author typed: air, not an empty line box.
          <View key={i} style={styles.spacer} />
        ),
      )}
    </View>
  );
}

/**
 * A numbered list from an array of steps, hanging. `start` lets a screen
 * continue a count across two blocks.
 */
export function StepList({
  steps,
  style,
  start = 1,
}: {
  steps: readonly string[];
  style?: StyleProp<TextStyle>;
  start?: number;
}): React.JSX.Element {
  return (
    <View style={styles.stack}>
      {steps.map((step, i) => (
        <Row key={i} marker={`${i + start}.`} text={step} style={style} />
      ))}
    </View>
  );
}

/** A bulleted list from an array, hanging. */
export function BulletList({
  items,
  style,
}: {
  items: readonly string[];
  style?: StyleProp<TextStyle>;
}): React.JSX.Element {
  return (
    <View style={styles.stack}>
      {items.map((item, i) => (
        <Row key={i} marker="•" text={item} style={style} />
      ))}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    stack: { gap: theme.spacing.sm },
    row: { flexDirection: 'row', alignItems: 'flex-start' },
    // Wide enough for "10." at body size; the sentence starts at the same
    // x on every row, which is the whole point.
    marker: { width: 22 },
    spacer: { height: theme.spacing.xs },
    body: { flex: 1 },
  }),
);
