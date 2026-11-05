/**
 * A page head with an icon over its title and line: CENTRED (decided 2026-10-05,
 * from screenshots of the Rescue page and Support after a layout pass left-aligned
 * them, beside the older centred versions: "the two attached screens look
 * super awkward if the icons are on the left, please bring them back to the
 * center").
 *
 * The one piece for that shape, so the pages cannot drift apart again: the
 * icon (a drawn icon, the Talia logo, a company logo, a step's disc), an
 * optional tag over the title ("EMAIL CODE"), the title with its ⓘ beside it
 * when it has one, and the line under it, every piece centred and wrapping
 * centred. `md` between them, as between any title, its line and the first
 * card. What follows the head (the cards, the lists, the fields) is the
 * page's own and stays left-aligned; a title WITHOUT an icon is not this
 * piece and stays left too (docs/design-rules.md, page layout).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { theme, themedStyles } from '../theme';
import { InfoHeading } from './InfoDot';

export function PageHead({
  icon,
  tag,
  title,
  info,
  line,
  style,
}: {
  /** The icon over the title; its size and colour are the caller's. */
  icon: React.ReactNode;
  /** A label over the title, in the label token: "EMAIL CODE". */
  tag?: string;
  title: string;
  /** The ⓘ beside the title: its dialog's title and text. */
  info?: { title: string; text: string };
  /** The line under the title; a node when a word in it is bold. */
  line?: React.ReactNode;
  /** The head's own margins, when the page needs them: tokens only. */
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  return (
    <View style={[styles.head, style]}>
      {icon}
      {!!tag && <Text style={styles.tag}>{tag}</Text>}
      {info ? (
        <InfoHeading title={info.title} text={info.text} style={styles.title}>
          {title}
        </InfoHeading>
      ) : (
        <Text style={styles.title}>{title}</Text>
      )}
      {line != null && line !== '' && <Text style={styles.line}>{line}</Text>}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  head: { alignItems: 'center', gap: theme.spacing.md },
  tag: { ...theme.typography.label, color: theme.colors.gold, textAlign: 'center' },
  // A centred title keeps its dot beside it (InfoHeading centres the row).
  title: { ...theme.typography.title, color: theme.colors.offWhite, textAlign: 'center' },
  line: { ...theme.typography.body, color: theme.colors.slate, textAlign: 'center' },
}));
