/**
 * The little ⓘ that carries the long explanation (decided 2026-08-28).
 *
 * House rule this exists to serve: a screen says the SHORT version, and
 * anyone who wants the reasoning taps the dot. Nobody should have to read a
 * paragraph to press a button, and nobody curious should be left guessing.
 *
 * Put it beside a heading or a short line, never as the only thing on a
 * screen: what the dot holds is background, so a screen must still make
 * sense with every dot left untapped.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

import { theme, themedStyles } from '../theme';
import { AppDialog } from './AppDialog';
import { INFO_DOT, infoDotTop, lineHeightOf, splitInfoRowStyle } from './infoRowStyle';

interface Props {
  /** Dialog heading. Short: it is a label, not a sentence. */
  title: string;
  /** The detail. Plain English, no jargon, and never an em dash. */
  text: string;
  /** Accessibility label; defaults to the title. */
  label?: string;
}

export function InfoDot({ title, text, label }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label ?? `More about ${title}`}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.dot}>
        <Text style={styles.glyph}>i</Text>
      </TouchableOpacity>
      {open && <InfoDialog title={title} text={text} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The dot's dialog on its own, for a line that is itself the way to its
 * reason (the address book's spent-coins notice, decided 2026-11-05): the
 * same title, text and "Got it" as behind every dot. Mount it while open.
 */
export function InfoDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }): React.JSX.Element {
  return (
    <AppDialog
      visible
      title={title}
      message={text}
      actions={[{ label: 'Got it', variant: 'primary', onPress: () => {} }]}
      onClose={onClose}
    />
  );
}

/**
 * A line of text with the dot beside it: the ONE way to place a dot (decided
 * 2026-09-21, "check ALL pages"). The dot sits beside the FIRST line, centred
 * on it, however many lines the text wraps to and whatever spacing the
 * caller's style carries (see `splitInfoRowStyle`). Without a style it is a
 * page title.
 */
export function InfoHeading({
  children,
  style,
  ...info
}: Props & { children: React.ReactNode; style?: StyleProp<TextStyle> }): React.JSX.Element {
  const flat = (StyleSheet.flatten([styles.heading, style]) ?? {}) as Record<string, unknown>;
  const { row, text } = splitInfoRowStyle(flat);
  return (
    <View style={[styles.row, row as ViewStyle]}>
      <Text style={[text as TextStyle, styles.shrink]}>{children}</Text>
      <View style={{ marginTop: infoDotTop(lineHeightOf(text as TextStyle)) }}>
        <InfoDot {...info} />
      </View>
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    dot: {
      width: INFO_DOT,
      height: INFO_DOT,
      borderRadius: INFO_DOT / 2,
      borderWidth: 1.2,
      borderColor: theme.colors.slate,
      alignItems: 'center',
      justifyContent: 'center',
    },
    glyph: {
      fontSize: 12,
      lineHeight: 15,
      fontWeight: '700',
      fontStyle: 'italic',
      color: theme.colors.slate,
    },
    // flexShrink: inside another row (an icon beside the heading) the text
    // still wraps instead of pushing the dot off the screen.
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm, flexShrink: 1 },
    heading: { ...theme.typography.title, color: theme.colors.offWhite },
    shrink: { flexShrink: 1 },
  }),
);
