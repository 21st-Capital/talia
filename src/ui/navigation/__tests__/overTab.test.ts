/**
 * resetOverTab: how a flow lands on a tab from above the native tab bar
 * (native tabs trial, 2026-09-15). The module imports types only, so this
 * runs in plain Node like the rest of the suite.
 *
 * The fixture is a RENDERED tab bar: three keyed tabs in a full (stale:
 * false) state, which is what getRootState() and a dispatch callback hand
 * over. An empty tab list would never reach the path that chooses the tab
 * inside that state, and the tests would guard nothing (decided 2026-09-15).
 */
import { resetOverTab } from '../overTab';

type RootState = Parameters<typeof resetOverTab>[0];

type TabState = {
  key: string;
  index: number;
  routeNames: string[];
  routes: Array<{ key: string; name: string }>;
  history?: Array<{ type: string; key: string }>;
  type: string;
  stale: boolean;
};

type Payload = {
  index: number;
  routes: Array<{ key?: string; name: string; params?: object; state?: TabState }>;
};

const payloadOf = (action: ReturnType<typeof resetOverTab>): Payload => action.payload as Payload;

const TAB_ROUTES = [
  { key: 'VaultsTab-a', name: 'VaultsTab' },
  { key: 'VirtualTab-b', name: 'VirtualTab' },
  { key: 'SettingsTab-c', name: 'SettingsTab' },
];

// The tab bar is showing Settings, and the user is two screens deep from it.
const tabs = {
  key: 'Tabs-k1',
  name: 'Tabs',
  params: { screen: 'SettingsTab' },
  state: {
    key: 'tab-k2',
    index: 2,
    routeNames: ['VaultsTab', 'VirtualTab', 'SettingsTab'],
    routes: TAB_ROUTES,
    history: [
      { type: 'route', key: 'VaultsTab-a' },
      { type: 'route', key: 'SettingsTab-c' },
    ],
    type: 'tab',
    stale: false,
  } as TabState,
};

const root = {
  key: 'stack-root',
  routes: [tabs, { key: 'Inheritance-k3', name: 'Inheritance' }, { key: 'Rescue-k4', name: 'Rescue' }],
} as unknown as RootState;

describe('resetOverTab', () => {
  it('resets the root stack to the tab bar with the screens above it, aimed at the root stack', () => {
    const action = resetOverTab(root, 'VaultsTab', [{ name: 'WalletDetail', params: { walletId: 'w1' } }]);
    expect(action.type).toBe('RESET');
    expect(action.target).toBe('stack-root');
    const payload = payloadOf(action);
    expect(payload.index).toBe(1);
    expect(payload.routes.map((r) => r.name)).toEqual(['Tabs', 'WalletDetail']);
    expect(payload.routes[1]).toEqual({ name: 'WalletDetail', params: { walletId: 'w1' } });
  });

  it('shows the last screen, with every earlier one beneath it', () => {
    const payload = payloadOf(
      resetOverTab(root, 'VaultsTab', [
        { name: 'WalletDetail', params: { walletId: 'w1' } },
        { name: 'PendingCosign', params: { walletId: 'w1' } },
      ]),
    );
    expect(payload.index).toBe(2);
    expect(payload.routes.map((r) => r.name)).toEqual(['Tabs', 'WalletDetail', 'PendingCosign']);
  });

  it('switches the tab INSIDE the tab bar state, which is what actually moves the bar', () => {
    const [bar] = payloadOf(resetOverTab(root, 'VirtualTab')).routes;
    expect(bar.state?.index).toBe(1);
    expect(bar.state?.routes[bar.state.index].name).toBe('VirtualTab');
  });

  it('writes the history the tab router keeps: the first tab, then the chosen one', () => {
    const [toPortfolios] = payloadOf(resetOverTab(root, 'VirtualTab')).routes;
    expect(toPortfolios.state?.history).toEqual([
      { type: 'route', key: 'VaultsTab-a' },
      { type: 'route', key: 'VirtualTab-b' },
    ]);
    const [toVaults] = payloadOf(resetOverTab(root, 'VaultsTab')).routes;
    expect(toVaults.state?.index).toBe(0);
    expect(toVaults.state?.history).toEqual([{ type: 'route', key: 'VaultsTab-a' }]);
  });

  it('keeps the tab bar route key and every tab key, so the tabs are not rebuilt', () => {
    const [bar] = payloadOf(resetOverTab(root, 'VaultsTab')).routes;
    expect(bar.key).toBe('Tabs-k1');
    expect(bar.state?.key).toBe('tab-k2');
    expect(bar.state?.routes).toEqual(TAB_ROUTES);
    expect(bar.params).toEqual({ screen: 'VaultsTab' });
  });

  it('leaves the original state untouched', () => {
    resetOverTab(root, 'VirtualTab');
    expect(tabs.state.index).toBe(2);
    expect(tabs.state.history).toHaveLength(2);
  });

  it('falls back to params alone when the tab bar has no full state yet (a cold start)', () => {
    const partial = {
      key: 'stack-root',
      routes: [{ key: 'Tabs-k1', name: 'Tabs', state: { routes: [{ name: 'VaultsTab' }], stale: true } }],
    } as unknown as RootState;
    const [bar] = payloadOf(resetOverTab(partial, 'VirtualTab')).routes;
    expect(bar.params).toEqual({ screen: 'VirtualTab' });
    expect(bar.state).toEqual({ routes: [{ name: 'VaultsTab' }], stale: true });
  });

  it('builds the tab bar route when the state has none', () => {
    const bare = { key: 'stack-root', routes: [] } as unknown as RootState;
    expect(payloadOf(resetOverTab(bare, 'VaultsTab')).routes).toEqual([
      { name: 'Tabs', params: { screen: 'VaultsTab' } },
    ]);
  });
});
