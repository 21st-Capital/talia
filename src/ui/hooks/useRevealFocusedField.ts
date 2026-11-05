/**
 * When the keyboard opens, scroll so the field being typed in AND the button
 * that confirms it both sit above the keys.
 *
 * Found 2026-09-18: "the app is hiding Save and Create vault underneath the
 * keyboard, so if the client is done typing, he is forced to exit the
 * keyboard before he can click the confirmation."
 *
 * The first version reserved a fixed button's worth of room under the
 * field. The check that followed found nine screens with a caption, a note
 * card, a total row or a consent box BETWEEN the last field and its confirm,
 * where a guess cannot know the distance. So the hook now MEASURES: every
 * action button registers itself (see Button.tsx), and the first one below
 * the focused field, within a window's height of it, is what gets scrolled
 * clear. When none is there, the fixed room is the fallback.
 *
 * Two more things that check taught it:
 *  - it only acts when the focused field lies inside ITS scroll view, so a
 *    keyboard on one screen no longer scrolls the screens beneath it in the
 *    stack;
 *  - `reveal()` can be called again while the keyboard is up, for content
 *    that appears after the first keystroke (the country suggestions).
 *
 * Measured from the keyboard's own top edge, like useKeyboardHeight: a
 * KeyboardAvoidingView measures from its parent and came up short by the
 * header on the Send screen.
 *
 * The floor is the keys OR the scroll area's own bottom edge, whichever is
 * higher (`revealFloor`), in both modes: a page footer that rose with the
 * keys, or a sheet's foot and keyboard padding, end the scroll area above
 * the keys, and a confirm scrolled clear of the keys alone sat under them
 * (decided 2026-10-05: the key sheet's Add key under the foot's Back).
 *
 * The field is the focused input AND its extent (fieldExtent.ts, decided
 * 2026-10-18): a six-digit code's input covers the boxes alone, while its
 * Paste and the line saying why a code was refused sit under it, and the
 * client needs them above the keys too. The bound still measures from the
 * input's own top, so the boxes never leave the screen to show them.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Dimensions, Keyboard, TextInput } from 'react-native';
import type { ScrollView } from 'react-native';
import type { MutableRefObject } from 'react';
import { FADE_EDGE_H } from '../components/FadeEdge';
import { measureConfirmButtons } from '../components/Button';
import { theme } from '../theme';
import { focusedFieldExtent } from './fieldExtent';
import { overlapsHost, revealFloor, revealOverlap, revealSpan } from './revealOverlap';

/** A full-height button plus the gap above it plus the fade under it. */
export const ACTION_ROOM = 50 + theme.spacing.md + FADE_EDGE_H + 4;

type Measurable = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };
type Layoutable = Measurable & {
  measureLayout?: (relativeTo: unknown, onSuccess: (...frame: number[]) => void, onFail: () => void) => void;
};

function measure(node: Measurable | null | undefined): Promise<{ y: number; h: number } | null> {
  return new Promise((resolve) => {
    if (!node?.measureInWindow) return resolve(null);
    node.measureInWindow((_x, y, _w, h) => resolve({ y, h }));
  });
}

/**
 * Whether the focused input is inside this scroll view in the VIEW TREE:
 * Fabric's measureLayout answers only for a view the other one contains.
 * null when it cannot say (no answer within a moment), and the caller falls
 * back on the old test, the field overlapping the scroll area. That old test
 * alone took a field scrolled UNDER the footer or the keys for another
 * screen's and left it there, which is exactly the field that needs lifting
 * (decided 2026-10-18: the authenticator code arrived under the footer on an
 * iPhone SE, its Paste hidden).
 */
function contains(host: unknown, node: Layoutable | null): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (host == null || !node?.measureLayout) return resolve(null);
    const timer = setTimeout(() => resolve(null), 250);
    const answer = (inside: boolean | null) => {
      clearTimeout(timer);
      resolve(inside);
    };
    try {
      node.measureLayout(host, () => answer(true), () => answer(false));
    } catch {
      answer(null);
    }
  });
}

export function useRevealFocusedField(
  scrollRef: MutableRefObject<ScrollView | null>,
  /** The scroll view's current offset, kept by its onScroll. */
  offsetY: MutableRefObject<number>,
  enabled = true,
  options: {
    /**
     * The page's confirm is pinned in a PageFooter that rises above the keys
     * on its own (decided 2026-10-05): nothing below the field needs scrolling
     * clear, only the field itself past the footer's fade. The floor is then
     * the scroll area's own bottom edge, which the footer's rise has lifted.
     */
    confirmPinned?: boolean;
  } = {},
): { reveal: () => void } {
  const keyboardTop = useRef<number | null>(null);
  const { confirmPinned = false } = options;

  const reveal = useCallback(async () => {
    const top = keyboardTop.current;
    if (top == null) return;
    const scroller = scrollRef.current as unknown as Measurable | null;
    const input = TextInput.State.currentlyFocusedInput() as unknown as Layoutable | null;
    const [field, host, extent, inside] = await Promise.all([
      measure(input),
      measure(scroller),
      measure(focusedFieldExtent()),
      contains(scroller, input),
    ]);
    if (!field || !host) return;
    // Not our field: the keyboard belongs to a screen above this one.
    if (!(inside ?? overlapsHost(field, host))) return;

    // The input and its own controls under it (a code's Paste); the bound
    // below still keeps the input's own top on the screen.
    const fieldBottom = revealSpan(field, extent).bottom;
    // What has to be cleared: the scroll area's own edge, or the keys where
    // the area runs under them (or a footer's rise has not settled yet),
    // whichever is higher.
    const floor = revealFloor(top, host.y + host.h);
    if (confirmPinned) {
      // The field clears the fade above the footer; the footer sits above
      // the keys already.
      const overlap = revealOverlap({
        fieldTop: field.y,
        wanted: fieldBottom + FADE_EDGE_H + 4,
        keyboardTop: floor,
        hostTop: host.y,
      });
      if (overlap > 0) scrollRef.current?.scrollTo({ y: offsetY.current + overlap, animated: true });
      return;
    }
    const window = Dimensions.get('window').height;
    const buttons = await measureConfirmButtons();
    const below = buttons
      .filter((b) => b.y >= fieldBottom - 1 && b.y < fieldBottom + window)
      .sort((a, b) => a.y - b.y)[0];
    // Scroll far enough that the confirm's bottom clears the keys, or, when
    // no confirm follows, a button's worth of room under the field.
    const wanted = below ? below.y + below.h + FADE_EDGE_H + 4 : fieldBottom + ACTION_ROOM;
    // ...but never so far that the field itself leaves the screen (found
    // 2026-09-19: on the Estate Plan the nearest button sat two fields
    // lower and the page scrolled the field being typed in off the top).
    // The field stays at least FIELD_MARGIN below the scroll view's top edge;
    // the button gets whatever room is left after that.
    const overlap = revealOverlap({
      fieldTop: field.y,
      wanted,
      keyboardTop: floor,
      hostTop: host.y,
    });
    if (overlap > 0) scrollRef.current?.scrollTo({ y: offsetY.current + overlap, animated: true });
  }, [scrollRef, offsetY, confirmPinned]);

  useEffect(() => {
    if (!enabled) return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      void reveal();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTop.current = null;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled, reveal]);

  return { reveal: () => void reveal() };
}
