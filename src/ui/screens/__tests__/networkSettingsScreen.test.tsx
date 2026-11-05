/**
 * Settings → Network, mounted (decided 2026-10-18: "remove the testnet settings
 * completely and just have testnet vaults sync automatically to public
 * nodes"). The page edits the Bitcoin server and nothing else: no network
 * rows, no Testnet4 anywhere, and Save and Reset touch the Bitcoin server
 * alone. A server the client saved is shown exactly as saved, and one Talia
 * once suggested that was renamed or retired says so.
 *
 * The screen's own wiring is real, the certificate rule and the note
 * included; the connection test, the settings store and the app's page
 * components (plain hosts here) are replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockProbe = jest.fn(async (_backend: { url: string }) => 903_117);
const mockUpdateSettings = jest.fn(async (_patch: Record<string, unknown>) => undefined);
const mockSettings: { value: Record<string, unknown> } = { value: {} };

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  Switch: 'Switch',
  TouchableOpacity: 'TouchableOpacity',
}));
jest.mock('../../components', () => {
  const R = require('react');
  const host =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      R.createElement(name, p, children);
  return {
    Screen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) =>
      R.createElement('Screen', null, children, footer),
    Card: host('Card'),
    Button: (p: { title: string; onPress: () => void }) => R.createElement('Button', { title: p.title, onPress: p.onPress }),
    StatusCard: (p: { state: string; subject: string; detail: string }) =>
      R.createElement('StatusCard', { state: p.state, subject: p.subject, detail: p.detail }),
    TextField: (p: { label: string; value: string; onChangeText: (t: string) => void }) =>
      R.createElement('TextField', { label: p.label, value: p.value, onChangeText: p.onChangeText }),
    RadioMark: (p: { on: boolean }) => R.createElement('RadioMark', { on: p.on }),
  };
});
jest.mock('../../../wallet', () => ({
  useWallets: () => ({ settings: mockSettings.value, updateSettings: mockUpdateSettings }),
  chainServerNote: jest.requireActual('../../../wallet/chainServers').chainServerNote,
  serverHold: jest.requireActual('../../../wallet/chainServers').serverHold,
}));
jest.mock('../../../bitcoin/engine', () => ({
  testBackendConnection: (b: { url: string }) => mockProbe(b),
}));

import { NetworkSettingsScreen } from '../NetworkSettingsScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;

const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });

const mounted: Renderer[] = [];

async function mount(settings: Record<string, unknown>): Promise<Renderer> {
  mockSettings.value = { backendType: 'electrum', defaultNetwork: 'bitcoin', ...settings };
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(<NetworkSettingsScreen {...({} as React.ComponentProps<typeof NetworkSettingsScreen>)} />);
  });
  mounted.push(r);
  await settle();
  return r;
}

afterEach(async () => {
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount();
  });
});

beforeEach(() => {
  mockProbe.mockClear();
  mockUpdateSettings.mockClear();
});

/** Every string the page shows, in order. */
function words(r: Renderer): string[] {
  return r.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => [n.props.children].flat().join(''));
}

const field = (r: Renderer, label: string) =>
  r.root.find((n) => (n.type as unknown) === 'TextField' && n.props.label === label);
const button = (r: Renderer, title: string) =>
  r.root.find((n) => (n.type as unknown) === 'Button' && n.props.title === title);
const status = (r: Renderer) => r.root.find((n) => (n.type as unknown) === 'StatusCard');

describe('Settings → Network', () => {
  it('shows the Bitcoin server alone: no network rows, no Testnet4', async () => {
    const r = await mount({ defaultNetwork: 'testnet', electrumUrls: { testnet: 'ssl://10.0.0.5:50002' } });
    const shown = words(r).join(' | ');
    expect(shown).not.toMatch(/testnet|signet/i);
    // The old "Network" card with its Bitcoin and Testnet4 rows is gone: the
    // only radio marks left are the four suggested servers'.
    expect(words(r)).not.toContain('Network');
    expect(words(r)).not.toContain('Bitcoin');
    expect(r.root.findAll((n) => (n.type as unknown) === 'RadioMark')).toHaveLength(4);
    expect(words(r)).toContain('Preferred server');
    expect(words(r)).toContain('Your Bitcoin vaults use only this server. Make sure you trust the server you pick.');
    // The fields hold the Bitcoin default, whatever the old radio row said.
    expect(field(r, 'Host').props.value).toBe('electrum.blockstream.info');
    expect(field(r, 'Port').props.value).toBe('50002');
    // The suggested servers are Bitcoin's.
    expect(words(r)).toEqual(
      expect.arrayContaining(['electrum.blockstream.info', 'mainnet-0.foundation.xyz', 'electrum2.bluewallet.io', 'electrum.acinq.co']),
    );
    // One probe on entry, of the Bitcoin server.
    expect(mockProbe.mock.calls.map(([b]) => b.url)).toEqual(['ssl://electrum.blockstream.info:50002']);
  });

  it('a home node is shown exactly as saved', async () => {
    const r = await mount({ electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } });
    expect(field(r, 'Host').props.value).toBe('10.0.0.20');
    expect(status(r).props.subject).toBe('ssl://10.0.0.20:50002');
    expect(mockProbe.mock.calls[0][0]).toMatchObject({ url: 'ssl://10.0.0.20:50002', validateDomain: false });
  });

  it('a retired or renamed server keeps its saved name and says so', async () => {
    const retired = await mount({ electrumUrls: { bitcoin: 'ssl://bitcoin.lu.ke:50002' } });
    expect(field(retired, 'Host').props.value).toBe('bitcoin.lu.ke');
    expect(words(retired)).toContain('This server can no longer be checked as safe. Choose another one.');
    const renamed = await mount({ electrumUrls: { bitcoin: 'ssl://mainnet.foundationdevices.com:50002' } });
    expect(field(renamed, 'Host').props.value).toBe('mainnet.foundationdevices.com');
    expect(words(renamed)).toContain('This server now goes by mainnet-0.foundation.xyz.');
    // Nothing to say for a server typed by hand.
    const own = await mount({ electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } });
    expect(words(own).join(' ')).not.toMatch(/goes by|checked as safe/);
  });

  it('Save writes the Bitcoin server alone, and never the network choice', async () => {
    const r = await mount({ electrumUrls: { regtest: 'tcp://127.0.0.1:60401' } });
    await act(async () => {
      field(r, 'Host').props.onChangeText('10.0.0.20');
    });
    await act(async () => {
      button(r, 'Save & test').props.onPress();
    });
    await settle();
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      backendType: 'electrum',
      electrumUrls: { regtest: 'tcp://127.0.0.1:60401', bitcoin: 'ssl://10.0.0.20:50002' },
    });
    for (const [patch] of mockUpdateSettings.mock.calls) expect(patch).not.toHaveProperty('defaultNetwork');
  });

  it('Save keeps the default server as the client\'s choice too, so it is never swapped for another', async () => {
    const r = await mount({ electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } });
    // The suggested default, tapped and saved.
    const row = r.root.find(
      (n) =>
        (n.type as unknown) === 'TouchableOpacity' &&
        n.findAll((c) => (c.type as unknown) === 'Text' && c.props.children === 'electrum.blockstream.info').length > 0,
    );
    await act(async () => {
      row.props.onPress();
    });
    await act(async () => {
      button(r, 'Save & test').props.onPress();
    });
    await settle();
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    const [patch] = mockUpdateSettings.mock.calls[0];
    expect(patch).toEqual({ backendType: 'electrum', electrumUrls: { bitcoin: 'ssl://electrum.blockstream.info:50002' } });
    // Saved, it is the chosen server: the one the vault uses, and no other
    // service (the transaction page's block explorer) is asked on its behalf.
    const chosen = { electrumUrls: patch.electrumUrls as Record<string, string> };
    const { chosenServer, chainServersFor } = jest.requireActual('../../../wallet/chainServers');
    expect(chosenServer('bitcoin', chosen)).toBe('ssl://electrum.blockstream.info:50002');
    expect(chainServersFor('bitcoin', chosen).map((b: { url: string }) => b.url)).toEqual([
      'ssl://electrum.blockstream.info:50002',
    ]);
    const { explorerApiFor } = jest.requireActual('../../../services/txPrevouts');
    expect(explorerApiFor('bitcoin', chosen)).toBeNull();
  });

  it('Save with nothing changed, on a phone with no server saved, saves the default as chosen', async () => {
    const r = await mount({ electrumUrls: {} });
    await act(async () => {
      button(r, 'Save & test').props.onPress();
    });
    await settle();
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      backendType: 'electrum',
      electrumUrls: { bitcoin: 'ssl://electrum.blockstream.info:50002' },
    });
  });

  it('a server held back starts on its own name, is not probed, says so, and Save releases it', async () => {
    const r = await mount({ electrumUrls: {}, bitcoinServerHold: { reason: 'esplora', host: 'umbrel.local:3006' } });
    expect(field(r, 'Host').props.value).toBe('umbrel.local');
    expect(words(r)).toContain(
      'Talia can no longer use umbrel.local:3006, the server you chose, as it was set up. Enter it again and tap Save & test.',
    );
    // Neither the default nor a guessed address is tried on entry.
    expect(mockProbe).not.toHaveBeenCalled();
    expect(status(r).props.state).toBe('Not tested');
    await act(async () => {
      field(r, 'Port').props.onChangeText('50001');
    });
    await act(async () => {
      button(r, 'Save & test').props.onPress();
    });
    await settle();
    const [patch] = mockUpdateSettings.mock.calls[0];
    expect(patch).toEqual({ backendType: 'electrum', electrumUrls: { bitcoin: 'ssl://umbrel.local:50001' } });
    expect(patch).toHaveProperty('bitcoinServerHold', undefined);
  });

  it('settings that could not be read start empty, are not probed, say so, and Save needs a host', async () => {
    const r = await mount({ electrumUrls: {}, bitcoinServerHold: { reason: 'unreadable' } });
    expect(field(r, 'Host').props.value).toBe('');
    expect(words(r)).toContain(
      'Talia could not read its network settings. Enter your server and tap Save & test, or tap Reset to default server.',
    );
    expect(mockProbe).not.toHaveBeenCalled();
    expect(status(r).props.state).toBe('Not tested');
    await act(async () => {
      button(r, 'Save & test').props.onPress();
    });
    await settle();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(status(r).props.detail).toBe("Enter the server's address first.");
    await act(async () => {
      field(r, 'Host').props.onChangeText('10.0.0.20');
    });
    await act(async () => {
      button(r, 'Save & test').props.onPress();
    });
    await settle();
    const [patch] = mockUpdateSettings.mock.calls[0];
    expect(patch).toEqual({ backendType: 'electrum', electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } });
    expect(patch).toHaveProperty('bitcoinServerHold', undefined);
  });

  it('Reset to default server releases a held server too: the client\'s own choice', async () => {
    const r = await mount({ electrumUrls: {}, bitcoinServerHold: { reason: 'esplora', host: 'umbrel.local:3006' } });
    await act(async () => {
      button(r, 'Reset to default server').props.onPress();
    });
    await settle();
    const [patch] = mockUpdateSettings.mock.calls[0];
    expect(patch).toHaveProperty('bitcoinServerHold', undefined);
    expect(patch.electrumUrls).toEqual({});
  });

  it('Reset to default server drops the Bitcoin server alone', async () => {
    const r = await mount({ electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002', regtest: 'tcp://127.0.0.1:60401' } });
    await act(async () => {
      button(r, 'Reset to default server').props.onPress();
    });
    await settle();
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      backendType: 'electrum',
      electrumUrls: { regtest: 'tcp://127.0.0.1:60401' },
    });
    expect(field(r, 'Host').props.value).toBe('electrum.blockstream.info');
    expect(mockProbe.mock.calls.at(-1)?.[0].url).toBe('ssl://electrum.blockstream.info:50002');
  });
});
