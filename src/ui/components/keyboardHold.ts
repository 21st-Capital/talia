/**
 * A control that BELONGS to the field beside it: the Send screen's BTC and
 * dollar switch, the unit switch above a limit (decided 2026-09-20: "when I
 * switch from USD to BTC the send screen minimizes the keyboard, which
 * should not happen; the keyboard should only disappear if any other place
 * in the screen is touched").
 *
 * Put `onPressIn={holdKeyboard}` on such a control. The tap that follows
 * leaves the keyboard where it is, and every other tap still puts it away
 * (KeyboardEscape). Press-IN is what marks it, so the mark is always set
 * before the touch ends and the order of the two events cannot race.
 *
 * Plain logic, no React Native, so it can be tested.
 */
let heldUntil = 0;
/** Long enough for the touch to end, short enough never to outlive it. */
const HOLD_MS = 700;

export function holdKeyboard(): void {
  heldUntil = Date.now() + HOLD_MS;
}

/** Has a control just asked for the keyboard to stay? */
export function keyboardHeld(now: number = Date.now()): boolean {
  return now < heldUntil;
}

/** Forget the mark, once it has been read or between tests. */
export function releaseKeyboardHold(): void {
  heldUntil = 0;
}
