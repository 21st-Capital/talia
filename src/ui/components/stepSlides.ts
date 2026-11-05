/**
 * The step slides running now, so the keyboard can wait for them to land.
 *
 * Found 2026-10-18, the co-signing request: the emailed code pasted ("Paste
 * code", then iOS's "Allow Paste") left the authenticator step INVISIBLE, its
 * Back alone over the keys, until the request was left. Main did it too, and
 * so did every build of this fix, until the keyboard's animation was taken
 * out: then the step showed every time (simulator, iPhone 17, scripted runs).
 *
 * What happens: `StepTransition` slides a step in on the NATIVE driver, so
 * React's copy of the step's place and opacity stays at the slide's start
 * (off to the side, transparent) until the slide ends and React Native syncs
 * it. The keyboard's height changes are animated with
 * `LayoutAnimation.configureNext`, which animates EVERYTHING the next update
 * of the screen carries. When the phone is busy (the paste prompt going away)
 * the step's own change reaches the screen late, inside the keyboard's
 * animation, and Fabric then puts React's copy, the slide's start, back onto
 * the step once the slide is over, where nothing moves it again. On the JS
 * driver, whose copy is never stale, the step showed every time too, but the
 * slides stay on the native driver (`hwwSigning.test.ts`).
 *
 * So a keyboard change that arrives while a step slides waits, and lands when
 * the slide has (hooks/useKeyboardHeight.ts). Pure module state: the slides
 * report themselves, the keyboard asks.
 */

/** How many step slides are running now. */
let running = 0;
/** What waits for every slide to land, run once when the last one has. */
const waiting = new Set<() => void>();

/**
 * A step started sliding in. Returns the one call that says it landed; it
 * may be called more than once (a slide that is interrupted AND unmounted),
 * and counts once.
 */
export function slideStarted(): () => void {
  running += 1;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    running -= 1;
    if (running > 0) return;
    const ready = [...waiting];
    waiting.clear();
    for (const fn of ready) fn();
  };
}

/** Whether a step is sliding in right now. */
export function slidesRunning(): boolean {
  return running > 0;
}

/**
 * Runs `fn` once no step is sliding: at once when none is. Returns a cancel,
 * for a caller that goes away before then.
 */
export function whenSlidesLand(fn: () => void): () => void {
  if (running === 0) {
    fn();
    return () => undefined;
  }
  waiting.add(fn);
  return () => {
    waiting.delete(fn);
  };
}
