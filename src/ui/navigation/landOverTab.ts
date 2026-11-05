/**
 * How a flow LANDS on a tab (decided 2026-09-16).
 *
 * `resetOverTab` (./overTab) builds the action; this is how it must be
 * dispatched. A screen's own `navigation.dispatch((state) => …)` hands over
 * the ROOT STACK's state, and at a cold launch the tab bar has not yet
 * committed its own state up into it (React Navigation skips that commit on
 * the child's first render). The reset is accepted and then silently undone:
 * the tab navigator's first upward commit rebuilds the stack from the
 * pre-reset routes, so the flow stays exactly where it was, and nothing is
 * logged, so a Release build shows no sign of it.
 *
 * It bites ONCE per launch, because that first attempt is what makes the tab
 * bar commit its state. A phone test found it on the import: a vault scanned from
 * another Talia was added but the app stayed on the import page; deleting the
 * vault and importing it again worked; after restarting the app it failed
 * again. Every other landing had the same first-time-per-launch bug: a vault
 * created, a portfolio built from a vault, a signed transaction, a refresh
 * session, a claimed invite.
 *
 * The container's own state carries the tab bar's state from the first frame,
 * so an action built from THAT lands cold as well. Deep links already did it
 * this way (`landOnInvite` in ./RootNavigator) and were the one immune caller.
 * So: never dispatch a landing from a screen's state. Call `landOverTab`.
 */
import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList, RootTabParamList } from './types';
import { resetOverTab } from './overTab';
import type { OverTabRoute } from './overTab';

/** The one container ref: RootNavigator's container and every landing. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Land on `tab` with `screens` above it (the last one is shown), from
 * anywhere: a screen, a dialog action, a deep link. Does nothing before the
 * container is ready, which is only possible before the first screen exists.
 */
export function landOverTab(tab: keyof RootTabParamList, screens: OverTabRoute[] = []): void {
  if (!navigationRef.isReady()) return;
  navigationRef.dispatch(resetOverTab(navigationRef.getRootState(), tab, screens));
}
