/**
 * THE pinned bottom area of a page (decided 2026-10-05: "move all the buttons to
 * the bottom of the page. Currently, some pages show the cancel or back
 * button in the middle and some at the bottom").
 *
 * A page's actions live here and nowhere else in the flow of the page: the
 * primary first, a secondary under it, and Back / Cancel / Done / Later
 * last, every one a full-width `Button`, `sm` apart. `Screen` mounts it from
 * its `footer` prop; a page that draws its own frame (its own ScrollView)
 * mounts it as the LAST child of a full-height column, after the scroll
 * area.
 *
 * What it does on its own, so no page repeats it:
 *   - stands above the home indicator (the safe area is the footer's, not
 *     the content's);
 *   - rises with the keyboard, so the field being typed in AND its button
 *     both sit above the keys (decided 2026-09-18), the way the Send screen's
 *     Continue does: the keyboard's own measured height, never a
 *     KeyboardAvoidingView;
 *   - dissolves whatever scrolls under it (decided 2026-09-12, fade under
 *     anything pinned): the `FadeEdge` hangs off its top edge, over the
 *     scroll area's last FADE_EDGE_H points. The scroll content pads its
 *     bottom by `FOOTER_ROOM` so its last row can clear the fade.
 *
 * It paints no ground of its own (nothing opaque over the glow). A link
 * that belongs to the content it sits under ("Reconnect") stays in the
 * content; the hardware step's Back is handed here by the step
 * (`HardwareConnect`'s `onFooterBack`); dialogs and sheets keep their own
 * foot.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, themedStyles } from '../theme';
import { FADE_EDGE_H, FadeEdge } from './FadeEdge';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

/**
 * Extra bottom padding for the scroll content above a PageFooter: the fade's
 * height plus a breath, so the last row can scroll clear of the dissolve.
 */
export const FOOTER_ROOM = FADE_EDGE_H + theme.spacing.sm;

export function PageFooter({ children }: { children: React.ReactNode }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();
  // Keyboard up: the keys replace the home indicator as the floor, and the
  // buttons sit one `md` above them (the Send screen's measure).
  const paddingBottom = kbHeight > 0 ? kbHeight + theme.spacing.md : insets.bottom + theme.spacing.lg;
  return (
    <View style={[styles.footer, { paddingBottom }]}>
      <View style={styles.fadeHost} pointerEvents="none">
        <FadeEdge />
      </View>
      {children}
    </View>
  );
}

const styles = themedStyles(() =>
  StyleSheet.create({
    footer: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    // The dissolve sits ABOVE the footer, on the scroll area's bottom edge.
    fadeHost: { position: 'absolute', top: -FADE_EDGE_H, left: 0, right: 0, height: FADE_EDGE_H },
  }),
);
