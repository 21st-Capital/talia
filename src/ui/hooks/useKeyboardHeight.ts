/**
 * The keyboard's height while it is up, 0 when it is down. The change
 * animates with the keyboard itself, so whatever follows it (a pinned
 * button, a fade) slides in step with the keys.
 *
 * Measured from the keyboard, not from the view: a KeyboardAvoidingView
 * measures from its parent and came up short by the header on the Send
 * screen (decided 2026-09-12), leaving Continue behind the keyboard.
 *
 * A view that MOUNTS while the keys are up starts where they are (decided
 * 2026-10-18): the co-signing request's authenticator step brings its
 * footer with it while the keyboard stays up from the emailed code, and a
 * footer that started at 0 sat under the keys until the next keyboard event
 * and the code's Paste was measured against a scroll area that had not
 * shortened yet. The did-show and did-hide events back the will-events up
 * for a view that mounts between the two.
 *
 * The keyboard's animation is configured ONLY for a height that changes
 * (decided 2026-10-18). LayoutAnimation.configureNext applies to the next
 * render of the whole app, whatever it is: a will-event that sets the height
 * a view already has renders nothing, so the animation stayed pending and
 * landed on the next, unrelated, render (the first digit, the error line,
 * the next step). A footer that mounts at the keyboard's height gets exactly
 * that will-event when the next field takes focus.
 *
 * And it WAITS while a step slides in (decided 2026-10-18, components/stepSlides.ts):
 * its animation carried the sliding step's stale start onto the screen and
 * left the co-signing request's authenticator step invisible after a pasted
 * code. A change that arrives during a slide is held, the latest one wins,
 * and it lands when the slide has, on what is left of the keyboard's own
 * curve, so the view meets the keys where they stop. The keys dipping and
 * coming back between two code steps then moves nothing at all.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform } from 'react-native';
import type { KeyboardEvent } from 'react-native';
import { slidesRunning, whenSlidesLand } from '../components/stepSlides';

/** A curve shorter than this is not worth animating: the height is set. */
const MIN_GLIDE_MS = 16;
/** The longest a keyboard change waits for a slide, should one never report its end. */
export const SLIDE_HOLD_CAP_MS = 1500;

/** The keyboard's height right now, for a view mounting while it is up. */
function heightNow(): number {
  return Keyboard.isVisible() ? Keyboard.metrics()?.height ?? 0 : 0;
}

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(heightNow);
  /** The height this view has, read by the listeners (a state would be stale in them). */
  const current = useRef(height);
  useEffect(() => {
    /** Sets `next`; with the keyboard's curve over `glideMs` only when it is a move. */
    const apply = (next: number, glideMs: number | null) => {
      if (glideMs != null && next !== current.current) {
        LayoutAnimation.configureNext({
          duration: glideMs,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
      current.current = next;
      setHeight(next);
    };
    /** The change held while a step slides: the latest, and when its keys stop. */
    let held: { height: number; endsAt: number } | null = null;
    let stopWaiting: (() => void) | null = null;
    let cap: ReturnType<typeof setTimeout> | null = null;
    const land = () => {
      stopWaiting?.();
      stopWaiting = null;
      if (cap != null) clearTimeout(cap);
      cap = null;
      const change = held;
      held = null;
      if (!change) return;
      const left = change.endsAt - Date.now();
      apply(change.height, left >= MIN_GLIDE_MS ? left : null);
    };
    /** Moves to `next`: the will-events on the keyboard's curve, the did-events at once. */
    const moveTo = (next: number, e?: KeyboardEvent) => {
      const glideMs = e ? e.duration || 250 : null;
      if (!slidesRunning() && held == null) {
        apply(next, glideMs);
        return;
      }
      held = { height: next, endsAt: Date.now() + (glideMs ?? 0) };
      if (stopWaiting == null) {
        stopWaiting = whenSlidesLand(land);
        cap = setTimeout(land, SLIDE_HOLD_CAP_MS);
      }
    };
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => moveTo(e.endCoordinates.height, e),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (e) => moveTo(0, e),
    );
    // A view mounted after a will-event and before its did-event missed the
    // first: the second sets the same value without an animation of its own.
    const shown = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidShow', (e) => moveTo(e.endCoordinates.height)) : null;
    const hidden = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidHide', () => moveTo(0)) : null;
    // The keys may have moved between the first render and this subscription.
    moveTo(heightNow());
    return () => {
      show.remove();
      hide.remove();
      shown?.remove();
      hidden?.remove();
      stopWaiting?.();
      if (cap != null) clearTimeout(cap);
    };
  }, []);
  return height;
}
