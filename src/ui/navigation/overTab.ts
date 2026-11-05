/**
 * Land a flow on a tab (native tabs trial, 2026-09-15).
 *
 * Every screen but the three tab roots lives on the root stack, above the
 * tab bar. A flow that used to reset its tab's own stack ("the vault list,
 * then the vault") resets the ROOT stack instead: the tab bar at the bottom
 * showing `tab`, and `screens` above it, so Back walks them down to that
 * tab's list.
 *
 * Use it wherever a screen used to name a tab root in a reset, jump tabs
 * through getParent(), or pop to the top to reach the vault list. From above
 * the tab bar none of those reach anything, and React Navigation drops them
 * without a word in a Release build: the button is simply dead.
 *
 * The tab bar's route keeps its key and its tabs' keys, so the three tabs are
 * not rebuilt; the tab shown is chosen inside its state. The action is aimed at the
 * root stack by key, so it lands the same from a screen and from the
 * container's ref (the invite deep links). It is the same RESET object
 * `CommonActions.reset` builds, spelled out so this module imports types
 * only and its test runs in plain Node.
 */
import type { NavigationAction, NavigationState } from '@react-navigation/native';
import type { RootStackParamList, RootTabParamList } from './types';

type AboveTabs = Exclude<keyof RootStackParamList, 'Tabs'>;

/** A screen to stack above the tab bar, its params typed by its route. */
export type OverTabRoute = {
  [Name in AboveTabs]: undefined extends RootStackParamList[Name]
    ? { name: Name; params?: RootStackParamList[Name] }
    : { name: Name; params: RootStackParamList[Name] };
}[AboveTabs];

/**
 * A reset of the root stack to the tab bar showing `tab`, with `screens`
 * above it in order (the last one is shown). `rootState` is the ROOT stack's
 * state: a screen on the root stack passes the state its `dispatch` callback
 * receives (or `navigation.getState()`), the container passes
 * `getRootState()`.
 */
export function resetOverTab(
  rootState: Readonly<Pick<NavigationState, 'key' | 'routes'>>,
  tab: keyof RootTabParamList,
  screens: OverTabRoute[] = [],
): NavigationAction {
  const tabs = rootState.routes.find((r) => r.name === 'Tabs');
  // A rendered tab bar carries its own full state, and React Navigation
  // (core 7.21) treats a changed nested state as "start from this state" and
  // quietly drops params.screen: the claim opened, but the bar stayed on the
  // tab it was on (found in the trial, 2026-09-15). So the tab is chosen IN
  // that state, with the history TabRouter keeps for its default back
  // behaviour ('firstRoute'); params.screen still does the work when there is
  // no nested state yet (a cold start).
  const nested = tabs?.state;
  const full = nested && nested.stale === false ? nested : null;
  const i = full ? full.routes.findIndex((r) => r.name === tab) : -1;
  const bar =
    tabs && full && i >= 0
      ? {
          ...tabs,
          params: { screen: tab },
          state: {
            ...full,
            index: i,
            history:
              i === 0
                ? [{ type: 'route' as const, key: full.routes[0].key }]
                : [
                    { type: 'route' as const, key: full.routes[0].key },
                    { type: 'route' as const, key: full.routes[i].key },
                  ],
          },
        }
      : { ...(tabs ?? { name: 'Tabs' }), params: { screen: tab } };
  return {
    type: 'RESET',
    payload: { index: screens.length, routes: [bar, ...screens] },
    target: rootState.key,
  };
}
