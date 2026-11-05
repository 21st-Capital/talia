/**
 * Themed screen wrapper with safe-area padding. The ground and the page glow
 * come from the stack navigator's page layout (RootNavigator), so this root
 * is transparent and draws nothing of its own.
 */
import React, { createContext, useCallback, useContext, useRef } from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, ScrollView as ScrollViewT } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme, themedStyles } from '../theme';
import { FadeEdge } from './FadeEdge';
import { FOOTER_ROOM, PageFooter } from './PageFooter';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { keyboardInsets } from '../hooks/keyboardInsets';
import { useRevealFocusedField } from '../hooks/useRevealFocusedField';

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  /** Disable horizontal padding (e.g. for full-bleed lists). */
  flush?: boolean;
  /** Ref to the inner ScrollView (tab-press scroll-to-top). */
  scrollRef?: React.RefObject<ScrollViewT | null>;
  /** Follows the scroll (a tab root feeds the dock's fold from it). */
  onScroll?: (offsetY: number) => void;
  /** False holds the page still (the address book while a card is swiped, decided 2026-11-05). */
  scrollEnabled?: boolean;
  /** Drawn over the whole page, above the scroll view (a copied flash). */
  overlay?: React.ReactNode;
  /**
   * The stack's own header sits above this page and has already taken the
   * status bar, so the page starts `UNDER_HEADER_TOP` below the header, as
   * the signing screen's does, never the status bar's height a second time.
   * Since 2026-10-05 every page under the header gets this by
   * itself, through `UnderHeaderContext` (the stack's page layout provides
   * it); the prop remains as the explicit ask the Sent page makes on every
   * screen that mounts it (decided 2026-10-02: the second inset put its mark
   * 58pt lower than on the signing screen).
   */
  underHeader?: boolean;
  /**
   * The page's actions (decided 2026-10-05): the primary, a secondary, and
   * Back / Cancel / Done last, pinned at the foot in a `PageFooter`. The
   * footer takes the safe area, rises with the keyboard and dissolves the
   * content scrolling under it; the content keeps `FOOTER_ROOM` clear.
   */
  footer?: React.ReactNode;
}

/**
 * Where a page under the stack header starts: one content padding below
 * the header. The signing screen pads its own scroll view by it, and a
 * Screen `underHeader` does too, so the Sent page sits at one height on
 * every screen.
 */
export const UNDER_HEADER_TOP = theme.spacing.lg;

/**
 * True where the stack's shared header sits above the page. The stack's page
 * layout (RootNavigator's StackPageLayout) provides it from the same
 * `headerShown` it already offsets the page glow by, so the glow and the
 * content top cannot disagree. Before 2026-10-05 the pages under
 * the header started at two heights: the `underHeader` ones 16pt below the
 * bar, the other 28 a status bar lower (Settings > Profile and Settings >
 * Display sat 55pt apart). A page that draws its own top bar (headerShown
 * false) still pads the status bar itself.
 */
export const UnderHeaderContext = createContext(false);

export function Screen({
  children,
  scroll,
  style,
  flush,
  scrollRef,
  onScroll,
  scrollEnabled = true,
  overlay,
  underHeader,
  footer,
}: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();
  const headerAbove = useContext(UnderHeaderContext);
  const innerRef = useRef<ScrollViewT | null>(null);
  const offsetY = useRef(0);
  const setRefs = useCallback(
    (r: ScrollViewT | null) => {
      innerRef.current = r;
      if (scrollRef) scrollRef.current = r;
    },
    [scrollRef],
  );
  const footed = footer != null;
  // Once the keyboard is up, the field being typed in AND the button under
  // it must both sit above the keys (decided 2026-09-18). One shared hook, so
  // every scrolling screen behaves the same. With a footer the button is
  // pinned above the keys already; only the field has to clear the fade.
  const { reveal } = useRevealFocusedField(innerRef, offsetY, !!scroll, { confirmPinned: footed });
  const pad: ViewStyle = {
    paddingTop: underHeader || headerAbove ? UNDER_HEADER_TOP : insets.top + theme.spacing.md,
    // The safe area is the footer's when there is one.
    paddingBottom: footed ? FOOTER_ROOM : insets.bottom + theme.spacing.lg,
    paddingHorizontal: flush ? 0 : theme.spacing.lg,
  };

  if (scroll) {
    return (
      <View style={styles.root}>
      <ScrollView
        ref={setRefs}
        style={styles.fill}
        contentContainerStyle={[pad, style]}
        scrollEnabled={scrollEnabled}
        keyboardShouldPersistTaps="handled"
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          offsetY.current = e.nativeEvent.contentOffset.y;
          onScroll?.(offsetY.current);
        }}
        scrollEventThrottle={32}
        // Content that appears after the first keystroke (a suggestions list)
        // pushes the confirm down again: measure again.
        onContentSizeChange={reveal}
        // Keep focused inputs and the content below them (e.g. the Validate
        // button under a long descriptor) reachable while the keyboard is up.
        // With a footer the footer's own rise shortens the scroll area by the
        // keyboard instead; an inset on top of that would leave a keyboard's
        // worth of blank under the last row, and a footer that arrives with
        // the keys up takes back the inset the automatic mode had set (found
        // 2026-10-18: it took the co-signing codes off the top of the screen;
        // hooks/keyboardInsets.ts).
        {...keyboardInsets(footed)}
        keyboardDismissMode="on-drag">
        {children}
      </ScrollView>
      {/* Whatever runs under the keyboard dissolves into it instead of being
          cut at the keys' edge (decided 2026-09-12). A footer carries its own
          fade and rises with the keys. */}
      {!footed && kbHeight > 0 && <FadeEdge bottom={kbHeight} />}
      {footed && <PageFooter>{footer}</PageFooter>}
      {overlay}
      </View>
    );
  }
  if (!footed) {
    return (
      <View style={[styles.root, pad, style]}>
        {children}
        {overlay}
      </View>
    );
  }
  return (
    <View style={styles.root}>
      <View style={[styles.fill, pad, style]}>{children}</View>
      <PageFooter>{footer}</PageFooter>
      {overlay}
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
}));
