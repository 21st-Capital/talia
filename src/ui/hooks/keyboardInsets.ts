/**
 * The keyboard props of a page's ScrollView whose actions sit in a pinned
 * PageFooter, a footer that can come and go with the page's steps. Pure (no
 * react-native import), so it is testable in plain Node.
 *
 * Found in a phone test on 2026-10-18, the co-signing request's authenticator step: "The
 * authenticator code request moves all the way up beyond the screen when the
 * key pad spaces are clicked so the user doesnt see the numbers anymore!"
 *
 * The cause, reproduced on the simulator: React Native's
 * `automaticallyAdjustKeyboardInsets` writes the keyboard's height into the
 * scroll view's bottom inset when the keys come up, and switching the prop
 * off does NOT take that inset back. The emailed code has no footer (it
 * submits itself) and the authenticator code under it has Back, so the page
 * switched the prop off at the very moment the footer arrived, with the keys
 * still up. The inset stayed (308pt on an iPhone 17), on a page the footer's
 * rise had already shortened: a keyboard's worth of room past the end of the
 * page. The page scrolled into it (the signing screen went to its end on
 * every keyboard, and iOS scrolls a focused field into what the inset leaves
 * of the view) and the code boxes left the top of the screen, with only the
 * end of the error line and Back above the keys.
 *
 * React Native writes the `contentInset` prop onto the scroll view only when
 * the prop CHANGES. So a page with a footer asks for a bottom inset of one
 * point, `FOOTED_INSET`, where a page without one asks for none: the footer
 * arriving changes the prop, React Native writes it, and whatever its
 * automatic mode had put there is gone. One point of extra scroll under a
 * footer's fade is never seen. A page without a footer keeps React Native's
 * automatic inset exactly as before, which also lifts the field being typed
 * in above the keys as they rise and lowers it with them.
 */

/** The bottom inset of a page with a footer: not 0, so that arriving is a change. */
export const FOOTED_INSET = 1;

/** iOS's edge insets, as the ScrollView props take them. */
export interface EdgeInsets {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Spread onto the page's ScrollView: `<ScrollView {...keyboardInsets(footed)}>`. */
export interface KeyboardInsetProps {
  automaticallyAdjustKeyboardInsets: boolean;
  contentInset: EdgeInsets;
  scrollIndicatorInsets: EdgeInsets;
}

/** @param footed the page shows a PageFooter right now (it rises with the keys) */
export function keyboardInsets(footed: boolean): KeyboardInsetProps {
  const inset: EdgeInsets = { top: 0, left: 0, bottom: footed ? FOOTED_INSET : 0, right: 0 };
  return {
    // The footer's rise shortens the scroll area by the keyboard; an inset on
    // top of that is the keyboard's worth of blank this is all about.
    automaticallyAdjustKeyboardInsets: !footed,
    contentInset: inset,
    scrollIndicatorInsets: inset,
  };
}
