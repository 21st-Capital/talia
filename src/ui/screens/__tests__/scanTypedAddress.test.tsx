/**
 * What the Scan screen does with a typed address, mounted (decided 2026-10-31
 * after a phone test: an address that moves coins is pasted or scanned on
 * Send's own step, never typed). Checking whether an address belongs to a vault
 * moves no coins, so the typed form stays, but what arrived through it never
 * goes on to Send, and a scanned address still does. The screen, the scan
 * classifier and the address parser are real; the page's parts, the vaults and
 * the camera are replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const SEGWIT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const SEND_IT = 'Send funds to this address';
const SEND_ANYWAY = 'Send funds to it anyway';

const mockClipboard = { text: '' };
const mockSigning = { value: true };
const mockWallets: { value: Record<string, unknown> } = { value: {} };

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  ActivityIndicator: 'ActivityIndicator',
  TouchableOpacity: 'TouchableOpacity',
}));
jest.mock('../../components', () => {
  const R = require('react');
  return {
    Screen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) =>
      R.createElement('Screen', null, children, footer),
    Button: (p: Record<string, unknown>) => R.createElement('Button', p),
    TextField: (p: Record<string, unknown>) => R.createElement('TextField', p),
    ChevronRightIcon: 'ChevronRightIcon',
    ClipboardIcon: 'ClipboardIcon',
    DrawnIcon: () => null,
    WalletIconTile: () => null,
    walletIconFor: () => 'vault',
    Gloss: () => null,
    cardGlow: () => 0,
  };
});
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../../platform/QrScanner', () => ({
  QrScanner: (p: Record<string, unknown>) => require('react').createElement('QrScanner', p),
}));
jest.mock('../../../platform/clipboard', () => ({ readClipboard: async () => mockClipboard.text }));
jest.mock('../../../config', () => ({
  get SIGNING_ENABLED() {
    return mockSigning.value;
  },
}));
jest.mock('../../../wallet', () => ({
  useWallets: () => mockWallets.value,
  formatAmount: (s: number) => `${s} sats`,
  formatFiat: () => '',
  getBtcPrice: async () => null,
}));

import { ScanScreen } from '../ScanScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;

const FIRST = { id: 'v1', label: 'Savings', descriptor: 'wpkh(xpub)', network: 'bitcoin' };
const SECOND = { id: 'v2', label: 'Spending', descriptor: 'wpkh(xpub2)', network: 'bitcoin' };

const engine = { ownsAddress: jest.fn(async (_: string) => false) };
const navigation = {
  setOptions: () => undefined,
  goBack: () => undefined,
  replace: jest.fn(),
};

function haveVaults(...vaults: Array<typeof FIRST>) {
  mockWallets.value = {
    wallets: vaults,
    getWallet: (id: string) => vaults.find((v) => v.id === id),
    getEngine: async () => engine,
    settings: { btcOnly: true, unit: 'btc', fiat: 'USD' },
  };
}

async function mount(params?: Record<string, unknown>): Promise<Renderer> {
  const props = { navigation, route: { params } } as unknown as React.ComponentProps<typeof ScanScreen>;
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(<ScanScreen {...props} />);
  });
  return r;
}

const hosts = (r: Renderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type);
const button = (r: Renderer, title: string) => hosts(r, 'Button').find((b) => b.props.title === title);
const shown = (r: Renderer) => JSON.stringify(r.toJSON());
const press = (r: Renderer, title: string) => act(async () => button(r, title)?.props.onPress());

const scan = (r: Renderer, payload: string) => act(async () => hosts(r, 'QrScanner')[0].props.onScanned(payload));

/** From the camera's keyboard button: the form, the address in it, Check. */
async function typeOnForm(r: Renderer, text: string): Promise<void> {
  await act(async () => hosts(r, 'TextField')[0].props.onChangeText(text));
  await press(r, 'Check address');
}

async function typeIt(r: Renderer, text: string): Promise<void> {
  await act(async () => hosts(r, 'QrScanner')[0].props.onTypeInstead());
  await typeOnForm(r, text);
}

/** No way on to Send is on the page, and none went through. */
const expectNoSend = (r: Renderer) => {
  expect(button(r, SEND_IT)).toBeUndefined();
  expect(button(r, SEND_ANYWAY)).toBeUndefined();
  expect(navigation.replace).not.toHaveBeenCalledWith('Send', expect.anything());
};

beforeEach(() => {
  mockSigning.value = true;
  mockClipboard.text = '';
  navigation.replace.mockClear();
  engine.ownsAddress.mockReset();
  engine.ownsAddress.mockImplementation(async () => false);
  haveVaults(FIRST, SECOND);
});

describe('a typed address is checked and goes no further', () => {
  it('is checked at once, with no question that has one answer', async () => {
    const r = await mount();
    await typeIt(r, SEGWIT);
    expect(engine.ownsAddress).toHaveBeenCalledWith(SEGWIT);
    expect(button(r, 'Verify ownership')).toBeUndefined();
    expect(shown(r)).not.toContain('What would you like to do with it?');
  });

  it('offers no Send on the not-owned result', async () => {
    const r = await mount();
    await typeIt(r, SEGWIT);
    expect(shown(r)).toContain('Not verified');
    expectNoSend(r);
    expect(hosts(r, 'Button').map((b) => b.props.title)).toEqual(['Check another', 'Close']);
  });

  it('reports the vault that owns it', async () => {
    engine.ownsAddress.mockImplementation(async () => true);
    const r = await mount();
    await typeIt(r, SEGWIT);
    expect(shown(r)).toContain('Address verified');
    expectNoSend(r);
  });

  it('holds on one vault too, where Send would open without asking which', async () => {
    haveVaults(FIRST);
    const r = await mount();
    await typeIt(r, SEGWIT);
    expectNoSend(r);
  });

  it('holds when the screen opens on the form', async () => {
    const r = await mount({ mode: 'type' });
    await typeOnForm(r, SEGWIT);
    expect(shown(r)).toContain('Not verified');
    expectNoSend(r);
  });

  it('holds for what Paste put in the form, which can be edited before Check', async () => {
    mockClipboard.text = SEGWIT;
    const r = await mount({ mode: 'type' });
    await act(async () => hosts(r, 'TextField')[0].props.trailing.props.onPress());
    await press(r, 'Check address');
    expect(engine.ownsAddress).toHaveBeenCalledWith(SEGWIT);
    expectNoSend(r);
  });

  it('holds through Check another', async () => {
    const r = await mount();
    await typeIt(r, SEGWIT);
    await press(r, 'Check another');
    await typeOnForm(r, SEGWIT);
    expect(shown(r)).toContain('Not verified');
    expectNoSend(r);
  });

  it('keeps the typed form and its checks on a vault of its own', async () => {
    const r = await mount({ walletId: FIRST.id, mode: 'type' });
    await typeOnForm(r, SEGWIT);
    expect(shown(r)).toContain('Not from this wallet');
    expectNoSend(r);
  });
});

describe('a scanned address still goes on to Send', () => {
  it('offers both on the question, and Send opens with it', async () => {
    haveVaults(FIRST);
    const r = await mount();
    await scan(r, SEGWIT);
    expect(button(r, 'Verify ownership')).toBeDefined();
    await press(r, SEND_IT);
    expect(navigation.replace).toHaveBeenCalledWith('Send', { walletId: FIRST.id, address: SEGWIT });
  });

  it('offers Send on the not-owned result, through the vault picker', async () => {
    const r = await mount();
    await scan(r, SEGWIT);
    await press(r, 'Verify ownership');
    await press(r, SEND_ANYWAY);
    expect(shown(r)).toContain('Send from');
    const [row] = hosts(r, 'TouchableOpacity');
    await act(async () => row.props.onPress());
    expect(navigation.replace).toHaveBeenCalledWith('Send', { walletId: FIRST.id, address: SEGWIT });
  });

  it('gets it back after Scan instead on the form', async () => {
    const r = await mount({ mode: 'type' });
    await press(r, 'Scan instead');
    await scan(r, SEGWIT);
    expect(button(r, SEND_IT)).toBeDefined();
  });
});

describe('a build that cannot sign', () => {
  it('offers Send for neither', async () => {
    mockSigning.value = false;
    const scanned = await mount();
    await scan(scanned, SEGWIT);
    expect(shown(scanned)).toContain('Not verified');
    expectNoSend(scanned);

    const typed = await mount();
    await typeIt(typed, SEGWIT);
    expect(shown(typed)).toContain('Not verified');
    expectNoSend(typed);
  });
});
