/**
 * Where a rescue sends the vault, mounted (decided 2026-10-31 after a phone
 * test: an address that moves coins is pasted or scanned, never typed, and a
 * rescue moves the whole vault). The screen is opened as rescue mode opens it,
 * and what it pins is that page: nothing on it takes text, Paste and Scan read
 * a `bitcoin:` link alike, the address shows whole, a refusal is a title and
 * OK, the rules at filing still stand, and the address that lands is the one
 * filed. The screen, `AddressField`, the address reader, the network check and
 * the rescue service are real; the page's other parts, the vault, the session
 * and the server (fetch) are replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { readFileSync } from 'fs';
import { join } from 'path';

const SEGWIT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const NOT_FOUND = 'No Bitcoin address found';
const OTHER_NETWORK = 'This address is for another network';
const SEVERAL = 'More than one address found';
const OTHER_SEGWIT = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TWO_LINKS = `bitcoin:${SEGWIT}?amount=1\nbitcoin:${OTHER_SEGWIT}?amount=2`;

const mockClipboard: { read: () => Promise<string> } = { read: async () => '' };
const mockBubble: { answer: () => Promise<string | null> } = { answer: async () => null };
const mockWallets: { value: Record<string, unknown> } = { value: {} };

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  ActivityIndicator: 'ActivityIndicator',
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  Linking: { openURL: async () => undefined },
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
    StepTransition: host('StepTransition'),
    Card: host('Card'),
    Button: (p: Record<string, unknown>) => R.createElement('Button', p),
    AppDialog: (p: Record<string, unknown>) => R.createElement('AppDialog', p),
    AppModal: ({ visible, onDismiss, children }: { visible: boolean; onDismiss: () => void; children: React.ReactNode }) =>
      R.createElement('AppModal', { onDismiss }, visible ? children : null),
    AddressChunks: (p: Record<string, unknown>) => R.createElement('AddressChunks', p),
    FactRow: () => null,
    SentPage: () => null,
    PageHead: (p: { title: string }) => R.createElement('PageHead', { title: p.title }),
    ConsentCheckbox: (p: Record<string, unknown>) => R.createElement('ConsentCheckbox', p),
    ChevronRightIcon: 'ChevronRightIcon',
    InfoHeading: host('InfoHeading'),
    BookingSheet: () => null,
    CodeField: (p: Record<string, unknown>) => R.createElement('CodeField', p),
    AuthenticatorStep: host('AuthenticatorStep'),
    FeeSheet: () => null,
    feeSheetStyles: {},
    sentWords: () => ({}),
  };
});
jest.mock('../../components/TablerIcons', () => new Proxy({}, { get: () => 'Icon' }));
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../../platform/QrScanner', () => ({
  QrScanner: (p: Record<string, unknown>) => require('react').createElement('QrScanner', p),
}));
jest.mock('../../../platform/clipboard', () => ({
  readClipboard: () => mockClipboard.read(),
  pasteBubble: () => mockBubble.answer(),
}));
jest.mock('../../../wallet', () => ({
  useWallets: () => mockWallets.value,
  formatAmount: (s: number) => `${s / 1e8} BTC`,
  formatBtc: (s: number) => `${s / 1e8} BTC`,
  formatFiat: (s: number) => `$${s}`,
  formatSats: (s: number) => `${s} sats`,
  getBtcPrice: async () => null,
}));
jest.mock('../../../services/companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  authHeaders: () => ({ Authorization: 'Bearer t' }),
  loadSession: async () => ({ accessToken: 't', email: 'client@example.com' }),
}));
jest.mock('../../../services/settingsApi', () => ({ fetchProfile: async () => ({ twoFactorEnabled: false }) }));
jest.mock('@react-native-async-storage/async-storage', () => require('../../../testing/memoryAsyncStorage'));
// A vault with one rescue path, whatever its descriptor reads.
jest.mock('../../../bitcoin/descriptor', () => ({
  ...jest.requireActual('../../../bitcoin/descriptor'),
  parsePolicy: () => ({
    paths: [{ olderBlocks: 100, groups: [{ keys: [{ fingerprint: 'aabbccdd' }] }] }],
  }),
}));

import { RescueScreen } from '../RescueScreen';
import { loadPendingRescues } from '../../../services/rescue';

const storage = require('@react-native-async-storage/async-storage').default as { __clear: () => void };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;

const COIN = { txid: 'a'.repeat(64), vout: 0, valueSats: 500_000, keychain: 'external' };
const engine = {
  listUtxos: async () => [COIN],
  listTransactions: async () => [{ txid: COIN.txid, blockHeight: 1 }],
  ownsAddress: async () => false,
  getTipHeight: () => 900_000,
  getReceiveAddress: async () => ({ address: SEGWIT, index: 0 }),
  buildRescuePsbt: jest.fn(async (_: { destination: string }): Promise<{ psbtBase64: string }> => {
    throw new Error('not built');
  }),
};

const vaultOf = (id: string, label: string, network: string) => ({
  id,
  label,
  network,
  descriptor: 'tr(xpub/0/*)',
  providerKeyFingerprints: ['aabbccdd'],
});
const BITCOIN_VAULT = vaultOf('v1', 'Savings', 'bitcoin');
const TEST_VAULT = vaultOf('v2', 'Rehearsal', 'testnet');

/** What reached the server, in order. */
const posted: Array<{ url: string; body: Record<string, unknown> }> = [];

function serve() {
  global.fetch = jest.fn((url: string, init?: { method?: string; body?: string }) => {
    const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    if (url.endsWith('/rescue/mode/')) return json({ status: 'active' });
    if (url.endsWith('/rescue/mine/')) {
      // Filed requests are listed, or the phone forgets its record of them.
      const filed = posted.filter((p) => p.url.endsWith('/rescue/requests/'));
      return json(
        filed.map(() => ({
          id: 'r1',
          vault_label: 'Savings',
          destination: '',
          amount_sats: 500_000,
          status: 'pending',
          signed_tx: '',
          created_at: '2026-10-31T09:00:00Z',
          signed_at: null,
        })),
      );
    }
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(init.body ?? '{}') });
      return json({ id: 'r1' });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
}

const realFetch = global.fetch;
afterAll(() => {
  global.fetch = realFetch;
});

function haveVaults(...vaults: Array<ReturnType<typeof vaultOf>>) {
  mockWallets.value = {
    wallets: vaults,
    syncWallet: async () => engine,
    getWallet: (id: string) => vaults.find((v) => v.id === id),
    getEngine: async () => engine,
    settings: { electrumUrls: {} },
  };
}

/** Lets the screen's reads of the mode, the list and the vaults land. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });

async function mount(params: Record<string, unknown>): Promise<Renderer> {
  const navigation = { addListener: () => () => {}, goBack: () => undefined, navigate: () => undefined };
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(
      <RescueScreen {...({ navigation, route: { params } } as unknown as React.ComponentProps<typeof RescueScreen>)} />,
    );
  });
  await settle();
  await settle();
  return r;
}

/** The vault the Spending policy sent the client to, open and ready. */
const openOn = async (vault = BITCOIN_VAULT): Promise<Renderer> => {
  haveVaults(vault);
  const r = await mount({ walletId: vault.id });
  expect(button(r, 'Request rescue')).toBeDefined();
  return r;
};

const hosts = (r: Renderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type);
const button = (r: Renderer, title: string) => hosts(r, 'Button').find((b) => b.props.title === title);
const control = (r: Renderer, label: string) =>
  hosts(r, 'TouchableOpacity').find((t) => t.props.accessibilityLabel === label);
const shown = (r: Renderer) => JSON.stringify(r.toJSON());
const dialogs = (r: Renderer) => hosts(r, 'AppDialog').map((d) => d.props.title);
const scanners = (r: Renderer) => hosts(r, 'QrScanner').length;

async function paste(r: Renderer, clipboard: string | Error): Promise<void> {
  mockClipboard.read = async () => {
    if (clipboard instanceof Error) throw clipboard;
    return clipboard;
  };
  await act(async () => control(r, 'Paste from the clipboard')?.props.onPress());
}

/** The empty field: the one touchable VoiceOver is told to look inside. */
const field = (r: Renderer) => hosts(r, 'TouchableOpacity').find((t) => t.props.accessible === false);
const tap = { nativeEvent: { pageX: 120, pageY: 240 } };

async function tapField(r: Renderer, answer: string | null): Promise<void> {
  mockBubble.answer = async () => answer;
  await act(async () => field(r)?.props.onPress(tap));
}

/** The field tapped, and the bubble's paste held back until the returned call. */
async function bubbleHeld(r: Renderer): Promise<(text: string) => Promise<void>> {
  let answer!: (text: string) => void;
  mockBubble.answer = () =>
    new Promise((resolve) => {
      answer = resolve;
    });
  await act(async () => field(r)?.props.onPress(tap));
  return (text) => act(async () => answer(text));
}

/** Scans, and leaves the scanner closed with its slide still running. */
async function scan(r: Renderer, payload: string): Promise<void> {
  await act(async () => control(r, 'Scan the address')?.props.onPress());
  const [scanner] = hosts(r, 'QrScanner');
  await act(async () => scanner.props.onScanned(payload));
  expect(scanners(r)).toBe(0);
}

/** iOS's word that the scanner's slide has ended. */
const scannerGone = (r: Renderer) => act(async () => hosts(r, 'AppModal')[0].props.onDismiss());

const agree = (r: Renderer) => act(async () => hosts(r, 'ConsentCheckbox')[0].props.onChange(true));
const press = (r: Renderer, title: string) => act(async () => button(r, title)?.props.onPress());
const row = (r: Renderer, label: string) =>
  hosts(r, 'TouchableOpacity').find((t) => t.findAll((n) => n.props.children === label).length > 0);
const openRow = (r: Renderer, label: string) => act(async () => row(r, label)?.props.onPress());

/** Paste pressed, its answer held back as iOS holds it behind Allow Paste. */
async function pasteHeld(r: Renderer): Promise<(clipboard: string) => Promise<void>> {
  let answer!: (clipboard: string) => void;
  mockClipboard.read = () =>
    new Promise((resolve) => {
      answer = resolve;
    });
  await act(async () => control(r, 'Paste from the clipboard')?.props.onPress());
  return (clipboard) => act(async () => answer(clipboard));
}

/** The request's email stays unsent until the returned call. */
function holdEmail(): () => Promise<void> {
  const answered = global.fetch as unknown as (url: string, init?: object) => Promise<unknown>;
  let release!: () => void;
  const sent = new Promise<void>((resolve) => {
    release = resolve;
  });
  global.fetch = jest.fn(async (url: string, init?: object) => {
    if (url.includes('/rescue/otp')) await sent;
    return answered(url, init);
  }) as unknown as typeof fetch;
  return async () => {
    await act(async () => release());
    await settle();
    await settle();
  };
}

/** Request rescue pressed, with its email still going out. */
async function sending(r: Renderer): Promise<() => Promise<void>> {
  const release = holdEmail();
  await act(async () => {
    void button(r, 'Request rescue')?.props.onPress();
  });
  await settle();
  expect(button(r, 'Sending…')).toBeDefined();
  return release;
}

const fileCode = async (r: Renderer) => {
  await act(async () => hosts(r, 'CodeField')[0].props.onComplete('123456'));
  await settle();
};

const expectRefused = (r: Renderer, title: string) => {
  expect(dialogs(r)).toEqual([title]);
  const [dialog] = hosts(r, 'AppDialog');
  expect(dialog.props.message).toBe('');
  expect(dialog.props.actions.map((a: { label: string }) => a.label)).toEqual(['OK']);
  // Nothing landed: both ways in are still offered and nothing can be filed.
  expect(control(r, 'Paste from the clipboard')).toBeDefined();
  expect(control(r, 'Scan the address')).toBeDefined();
  expect(button(r, 'Request rescue')?.props.disabled).toBe(true);
  expect(shown(r)).not.toContain('VERIFY ADDRESS');
};

const expectAddressIn = (r: Renderer, address: string) => {
  expect(hosts(r, 'Text').some((t) => t.props.children === address)).toBe(true);
  expect(hosts(r, 'AddressChunks')[0]?.props.address).toBe(address);
  expect(control(r, 'Replace the address')).toBeDefined();
  expect(control(r, 'Paste from the clipboard')).toBeUndefined();
  expect(control(r, 'Scan the address')).toBeUndefined();
};

beforeEach(() => {
  storage.__clear();
  posted.length = 0;
  mockClipboard.read = async () => '';
  mockBubble.answer = async () => null;
  engine.buildRescuePsbt.mockClear();
  serve();
});

describe('where a rescue sends the vault', () => {
  it('cannot be typed: nothing on the step takes text, before or after an address lands', async () => {
    const r = await openOn();
    expect(hosts(r, 'TextInput').length).toBe(0);
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(control(r, 'Scan the address')).toBeDefined();
    await paste(r, SEGWIT);
    expect(hosts(r, 'TextInput').length).toBe(0);
  });

  it('holds the screen to that in its source too', () => {
    const page = readFileSync(join(__dirname, '..', 'RescueScreen.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(page).not.toMatch(/\bTextField\b|\bTextInput\b/);
    expect(page).not.toMatch(/onChangeText=\{setDestination\}/);
  });

  it('shows a pasted address read only and whole, with Replace', async () => {
    const r = await openOn();
    await paste(r, SEGWIT);
    expectAddressIn(r, SEGWIT);
    expect(shown(r)).toContain('VERIFY ADDRESS');
    expect(dialogs(r)).toEqual([]);
  });

  it('reads a bitcoin: link the same pasted as scanned', async () => {
    const link = `bitcoin:${SEGWIT}?amount=0.5&label=shop`;
    const pasted = await openOn();
    await paste(pasted, link);
    const scanned = await openOn();
    await scan(scanned, link);
    await scannerGone(scanned);
    expectAddressIn(pasted, SEGWIT);
    expectAddressIn(scanned, SEGWIT);
    expect(shown(pasted)).toBe(shown(scanned));
  });

  it('asks the camera for a Bitcoin address', async () => {
    const r = await openOn();
    await act(async () => control(r, 'Scan the address')?.props.onPress());
    expect(hosts(r, 'QrScanner')[0].props.hint).toBe('Scan a Bitcoin address');
    await act(async () => hosts(r, 'QrScanner')[0].props.onCancel());
    expect(scanners(r)).toBe(0);
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
  });

  it('gives Replace back both ways in, with nothing left of the address', async () => {
    const r = await openOn();
    await paste(r, SEGWIT);
    await agree(r);
    expect(button(r, 'Request rescue')?.props.disabled).toBe(false);
    await act(async () => control(r, 'Replace the address')?.props.onPress());
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(control(r, 'Scan the address')).toBeDefined();
    expect(button(r, 'Request rescue')?.props.disabled).toBe(true);
    expect(shown(r)).not.toContain(SEGWIT);
  });

  it('keeps Request rescue shut until the address and the consent are both in', async () => {
    const r = await openOn();
    expect(button(r, 'Request rescue')?.props.disabled).toBe(true);
    await agree(r);
    expect(button(r, 'Request rescue')?.props.disabled).toBe(true);
    await paste(r, SEGWIT);
    expect(button(r, 'Request rescue')?.props.disabled).toBe(false);
  });

  it.each([
    ['an empty clipboard', ''],
    ['other text', 'see you at eight'],
    ['a broken address', `${SEGWIT.slice(0, -1)}p`],
    ['an address only its checksum holds up', 'bc1qwjqcaxagkhpvlh8f7cp3q8f2xaz9zhntptysaqp'],
    ['a paste iOS was not allowed to read', new Error('denied')],
  ])('refuses %s with one title and OK', async (_name, clipboard) => {
    const r = await openOn();
    await paste(r, clipboard);
    expectRefused(r, NOT_FOUND);
  });

  it('takes neither of two addresses, pasted or scanned', async () => {
    const pasted = await openOn();
    await paste(pasted, TWO_LINKS);
    expectRefused(pasted, SEVERAL);

    const scanned = await openOn();
    await scan(scanned, TWO_LINKS);
    await scannerGone(scanned);
    expectRefused(scanned, SEVERAL);
  });

  it('refuses a test network address on a Bitcoin vault, and the reverse', async () => {
    const r = await openOn();
    await paste(r, TESTNET);
    expectRefused(r, OTHER_NETWORK);

    const other = await openOn(TEST_VAULT);
    await paste(other, SEGWIT);
    expectRefused(other, OTHER_NETWORK);
  });

  it('says a refused scan with the same title and OK, once the scanner has closed', async () => {
    const r = await openOn();
    await scan(r, 'not an address');
    expect(dialogs(r)).toEqual([]);
    await scannerGone(r);
    expectRefused(r, NOT_FOUND);

    await act(async () => hosts(r, 'AppDialog')[0].props.onClose());
    await scan(r, TESTNET);
    expect(dialogs(r)).toEqual([]);
    await scannerGone(r);
    expectRefused(r, OTHER_NETWORK);
  });

  it('says nothing when the scanner closes on a good scan or on Cancel', async () => {
    const r = await openOn();
    await act(async () => control(r, 'Scan the address')?.props.onPress());
    await act(async () => hosts(r, 'QrScanner')[0].props.onCancel());
    await scannerGone(r);
    expect(dialogs(r)).toEqual([]);

    await scan(r, SEGWIT);
    await scannerGone(r);
    expect(dialogs(r)).toEqual([]);
    expectAddressIn(r, SEGWIT);
  });

  it('closes a refusal on OK and takes the next paste', async () => {
    const r = await openOn();
    await paste(r, 'nothing useful');
    await act(async () => hosts(r, 'AppDialog')[0].props.onClose());
    expect(dialogs(r)).toEqual([]);
    await paste(r, SEGWIT);
    expectAddressIn(r, SEGWIT);
  });

  it('takes an address from iOS\'s own bubble as it takes one from the icon', async () => {
    const r = await openOn();
    await tapField(r, `bitcoin:${SEGWIT}`);
    expectAddressIn(r, SEGWIT);
    expect(field(r)).toBeUndefined();
  });

  it.each([
    ['other text', 'nothing useful', NOT_FOUND],
    ['an address of another network', TESTNET, OTHER_NETWORK],
    ['two addresses', TWO_LINKS, SEVERAL],
  ])('refuses %s from the bubble with the same title and OK', async (_name, text, title) => {
    const r = await openOn();
    await tapField(r, text);
    expectRefused(r, title);
  });

  it('changes nothing when the bubble closes with no paste', async () => {
    const r = await openOn();
    await tapField(r, null);
    expect(dialogs(r)).toEqual([]);
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(shown(r)).not.toContain('VERIFY ADDRESS');
  });

  it('files the address that landed: the build, the request and the phone’s record', async () => {
    const r = await openOn();
    await paste(r, `bitcoin:${SEGWIT}`);
    await agree(r);
    await press(r, 'Request rescue');
    await settle();
    await act(async () => hosts(r, 'CodeField')[0].props.onComplete('123456'));
    await settle();

    expect(engine.buildRescuePsbt.mock.calls[0][0].destination).toBe(SEGWIT);
    expect(posted.at(-1)?.body.destination).toBe(SEGWIT);
    expect((await loadPendingRescues()).map((p) => p.destination)).toEqual([SEGWIT]);
  });

  it('still stops at Request an address left in the field from a vault on another network', async () => {
    haveVaults(TEST_VAULT, BITCOIN_VAULT);
    const r = await mount({});

    await openRow(r, 'Rehearsal');
    await paste(r, TESTNET);
    await press(r, 'Back');
    await openRow(r, 'Savings');
    expectAddressIn(r, TESTNET);
    await agree(r);
    await press(r, 'Request rescue');
    await settle();

    const [dialog] = hosts(r, 'AppDialog');
    expect(dialog.props.title).toBe(OTHER_NETWORK);
    expect(dialog.props.message).toBe('');
    expect(posted).toEqual([]);
    expect(hosts(r, 'CodeField').length).toBe(0);
  });

  it('offers no field while rescue mode is off', async () => {
    global.fetch = jest.fn((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => (url.endsWith('/rescue/mode/') ? { status: 'none' } : []),
      }),
    ) as unknown as typeof fetch;
    haveVaults(BITCOIN_VAULT);
    const r = await mount({ walletId: BITCOIN_VAULT.id });
    expect(button(r, 'Schedule the rescue meeting')).toBeDefined();
    expect(control(r, 'Paste from the clipboard')).toBeUndefined();
    expect(control(r, 'Scan the address')).toBeUndefined();
  });
});

describe('the address stays as it stands once the request is under way', () => {
  it('locks the address and the way back while Request rescue is sending', async () => {
    const r = await openOn();
    await paste(r, SEGWIT);
    await agree(r);
    const release = await sending(r);

    expect(control(r, 'Replace the address')?.props.disabled).toBe(true);
    expect(button(r, 'Back')?.props.disabled).toBe(true);
    expectAddressIn(r, SEGWIT);

    await release();
    await fileCode(r);
    expect(engine.buildRescuePsbt.mock.calls[0][0].destination).toBe(SEGWIT);
    expect(posted.at(-1)?.body.destination).toBe(SEGWIT);
    expect((await loadPendingRescues()).map((p) => p.destination)).toEqual([SEGWIT]);
  });

  it('gives the address back when the email could not be sent', async () => {
    const r = await openOn();
    await paste(r, SEGWIT);
    await agree(r);
    const answered = global.fetch;
    global.fetch = jest.fn(async (url: string, init?: object) => {
      if (url.includes('/rescue/otp')) throw new Error('offline');
      return (answered as unknown as (u: string, i?: object) => unknown)(url, init);
    }) as unknown as typeof fetch;
    await press(r, 'Request rescue');
    await settle();

    expect(dialogs(r)).toEqual(['Could not send the email']);
    expect(control(r, 'Replace the address')?.props.disabled).toBe(false);
    expect(button(r, 'Back')?.props.disabled).toBe(false);
  });

  it('opens it again on the way back from the code', async () => {
    const r = await openOn();
    await paste(r, SEGWIT);
    await agree(r);
    await press(r, 'Request rescue');
    await settle();
    await press(r, 'Back');
    expect(control(r, 'Replace the address')?.props.disabled).toBe(false);
  });

  it('drops a paste that answers once the request has started', async () => {
    const r = await openOn();
    const late = await pasteHeld(r);
    await paste(r, SEGWIT);
    await agree(r);
    const release = await sending(r);

    await late(OTHER_SEGWIT);
    expectAddressIn(r, SEGWIT);

    await release();
    await fileCode(r);
    expect(posted.at(-1)?.body.destination).toBe(SEGWIT);
  });

  it.each([
    ['an address', OTHER_SEGWIT],
    ['a refusal', 'not an address'],
  ])('drops %s from a paste that answers on the code step', async (_name, clipboard) => {
    const r = await openOn();
    const late = await pasteHeld(r);
    await paste(r, SEGWIT);
    await agree(r);
    await press(r, 'Request rescue');
    await settle();
    expect(hosts(r, 'CodeField').length).toBe(1);

    await late(clipboard);
    expect(dialogs(r)).toEqual([]);
    await fileCode(r);
    expect(posted.at(-1)?.body.destination).toBe(SEGWIT);
  });

  it.each([
    ['an address', SEGWIT],
    ['a refusal', 'not an address'],
  ])('drops %s from a paste that answers after Back', async (_name, clipboard) => {
    haveVaults(BITCOIN_VAULT);
    const r = await mount({});
    await openRow(r, 'Savings');
    const late = await pasteHeld(r);
    await press(r, 'Back');

    await late(clipboard);
    expect(dialogs(r)).toEqual([]);
    await openRow(r, 'Savings');
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(shown(r)).not.toContain(SEGWIT);
  });

  it('drops a paste meant for another vault', async () => {
    haveVaults(TEST_VAULT, BITCOIN_VAULT);
    const r = await mount({});
    await openRow(r, 'Rehearsal');
    const late = await pasteHeld(r);
    await press(r, 'Back');
    await openRow(r, 'Savings');

    await late(SEGWIT);
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(dialogs(r)).toEqual([]);
  });

  it('takes no tap on the field while the page holds it', async () => {
    const r = await openOn();
    await paste(r, SEGWIT);
    await act(async () => control(r, 'Replace the address')?.props.onPress());
    expect(field(r)?.props.disabled).toBe(false);
    await paste(r, SEGWIT);
    await agree(r);
    const release = await sending(r);
    expect(field(r)).toBeUndefined();
    await release();
  });

  it.each([
    ['an address', OTHER_SEGWIT],
    ['a refusal', 'not an address'],
  ])('drops %s from a bubble that answers on the code step', async (_name, text) => {
    const r = await openOn();
    const late = await bubbleHeld(r);
    await paste(r, SEGWIT);
    await agree(r);
    await press(r, 'Request rescue');
    await settle();
    expect(hosts(r, 'CodeField').length).toBe(1);

    await late(text);
    expect(dialogs(r)).toEqual([]);
    await fileCode(r);
    expect(posted.at(-1)?.body.destination).toBe(SEGWIT);
  });

  it('drops a bubble meant for another vault', async () => {
    haveVaults(TEST_VAULT, BITCOIN_VAULT);
    const r = await mount({});
    await openRow(r, 'Rehearsal');
    const late = await bubbleHeld(r);
    await press(r, 'Back');
    await openRow(r, 'Savings');

    await late(SEGWIT);
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(dialogs(r)).toEqual([]);
  });

  it('closes the scanner when the step moves and drops what it still reads', async () => {
    haveVaults(BITCOIN_VAULT);
    const r = await mount({});
    await openRow(r, 'Savings');
    await act(async () => control(r, 'Scan the address')?.props.onPress());
    const { onScanned } = hosts(r, 'QrScanner')[0].props;

    // A rescue going out behind the scanner moves the step the same way.
    await press(r, 'Back');
    expect(scanners(r)).toBe(0);

    await act(async () => onScanned(SEGWIT));
    await openRow(r, 'Savings');
    expect(scanners(r)).toBe(0);
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(shown(r)).not.toContain(SEGWIT);
  });
});
