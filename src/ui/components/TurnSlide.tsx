/**
 * The slide between the device's steps (decided 2026-10-05: "when any of the
 * ledgers are connected after the pin entry, swipe the screen to another
 * page and show the Open App prompt on the device. The reason is because its
 * not always clear that the user needs to now press something again on the
 * ledger and its not fully visible that its time to take another action";
 * then "do the same to the bitbox screens"). The two connection flows wrap
 * every page they draw in it, and a change of PAGE (`slideKey`: the PIN or
 * the side, the app or the password, the vault to register, the address to
 * verify) slides the new page in on the app's own slide (`StepTransition`,
 * native driver): from the right for a later page, from the left when the
 * device asks an earlier one again (its PIN after the app was open). The job
 * is keyed by WHICH job, not its number alone, so the address check that
 * follows a registration on the same device slides in too, although both are
 * "3." (decided 2026-10-05). A page with no step of its own (the line while
 * the key is read, the pairing code, a failure) holds the key shown last, so
 * it swaps in place as it always did and nothing slides twice; the unlock
 * page carried from the search into the connection is a fresh mount of the
 * same page and does not slide either. The drawing of the page that lands is
 * started afresh by `DeviceTurn`, so the next prompt ("Open app?") is on the
 * drawn device as the slide lands. Mounted and tested in
 * `__tests__/turnSlide.test.tsx`.
 */
import React, { useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StepTransition } from './StepTransition';
import { STEP_ORDER, slideKey } from '../hww/deviceSteps';
import type { TurnStep } from '../hww/deviceSteps';
import type { DeviceAsk } from '../hww/deviceTurns';

export function TurnSlide({
  step,
  ask,
  children,
  style,
}: {
  /** The step of the page on show, or null for a page with no step of its own. */
  step: TurnStep | null;
  /** What the device asks on that page, which tells the job's pages apart. */
  ask: DeviceAsk | null;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  // The key shown last, held through the pages that have none.
  const held = useRef<string>(STEP_ORDER[0]);
  if (step != null && ask != null) held.current = slideKey(step, ask);
  return (
    <StepTransition stepKey={held.current} order={STEP_ORDER} style={style}>
      {children}
    </StepTransition>
  );
}
