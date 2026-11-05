/**
 * Send's address step, mounted (decided 2026-10-31 after a phone test: nobody
 * types an address, it is pasted or scanned, and typing one is bad practice).
 * Send opens on it (decided 2026-11-04: scan a checkout's QR code and pay the
 * exact amount it asks for), so what it pins is the page a client reaches
 * first: no field on it takes an address, Paste and Scan read a `bitcoin:`
 * link alike, a refused paste is a title and OK, the other ways in still
 * work, and a payment request's amount reaches the amount step exactly. The
 * screen, `AddressField`, `TextField`, the address and request readers and
 * the network check are real; the page's other parts and the vault are
 * replaced.
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
const TAPROOT = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';

const mockClipboard: { read: () => Promise<string> } = { read: async () => '' };
const mockBubble: { answer: (x: number, y: number) => Promise<string | null> } = { answer: async () => null };
const mockFontScale = { value: 1 };
const mockSettings = { value: { btcOnly: true, unit: 'btc', fiat: 'USD' } as Record<string, unknown> };
const mockRate = { value: null as number | null };
const mockVault = {
  value: {
    id: 'v1',
    label: 'Vault',
    descriptor: 'wpkh(xpub)',
    network: 'bitcoin',
    cachedBalanceSats: 1_000_000,
  } as Record<string, unknown>,
};

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  PanResponder: { create: () => ({ panHandlers: {} }) },
  useWindowDimensions: () => ({ width: 402, height: 874, scale: 3, fontScale: mockFontScale.value }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../components/TablerIcons', () => new Proxy({}, { get: () => 'Icon' }));
jest.mock('../../components', () => {
  const R = require('react');
  const host =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      R.createElement(name, p, children);
  const { TextField } = jest.requireActual('../../components/TextField');
  return {
    TextField,
    AppDialog: (p: Record<string, unknown>) => R.createElement('AppDialog', p),
    AppModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
      visible ? R.createElement('AppModal', null, children) : null,
    Button: (p: Record<string, unknown>) => R.createElement('Button', p),
    AddressChunks: (p: Record<string, unknown>) => R.createElement('AddressChunks', p),
    MarkedText: (p: { text: string }) => R.createElement('Text', null, p.text),
    PageFooter: host('PageFooter'),
    NoticeBanner: host('NoticeBanner'),
    InfoHeading: host('InfoHeading'),
    Gloss: () => null,
    FitText: host('Text'),
    FeeSheet: () => null,
    HeaderBackButton: (p: Record<string, unknown>) => R.createElement('HeaderBackButton', p),
    feeSheetStyles: {},
    cardGlow: () => 0,
    holdKeyboard: () => undefined,
    HEADER_BTN: 40,
    FOOTER_ROOM: 0,
  };
});
jest.mock('../../../platform/QrScanner', () => ({
  QrScanner: (p: Record<string, unknown>) => require('react').createElement('QrScanner', p),
}));
jest.mock('../../../platform/clipboard', () => ({
  readClipboard: () => mockClipboard.read(),
  pasteBubble: (x: number, y: number) => mockBubble.answer(x, y),
}));
jest.mock('../../hooks/useProviderFingerprints', () => ({
  useProviderFingerprints: () => ({ providerFps: new Set<string>() }),
}));
jest.mock('../../../config', () => ({ SIGNING_ENABLED: true }));
// The address book on Send is sendAddressBook.test.tsx's to pin; here it is empty.
jest.mock('../../hooks/useAddressBook', () => ({ useAddressBook: () => ({ entries: [], unreadable: false }) }));
jest.mock('../../hooks/useAddressBookCheck', () => ({ useAddressBookCheck: () => ({ state: 'idle', retry: () => undefined }) }));
jest.mock('../../../wallet/addressBook', () => ({
  categoryOf: () => 'private',
  findBookEntry: () => undefined,
  markEntryUsed: async () => null,
  sendListFor: () => [],
}));
jest.mock('../../components/AddressBookParts', () => ({
  BookCheckLines: () => null,
  SaveAddressLink: () => null,
  SavedNameRow: () => null,
  SendBookCard: () => null,
}));
jest.mock('../../../wallet', () => ({
  useWallets: () => ({
    getWallet: () => mockVault.value,
    getEngine: async () => undefined,
    syncWallet: async () => undefined,
    settings: mockSettings.value,
  }),
  formatAmount: (s: number) => `${s} sats`,
  formatSats: (s: number) => `${s} sats`,
  formatFiat: () => '',
  fiatSymbol: () => '$',
  getBtcPrice: async () => mockRate.value,
  setTxNote: async () => undefined,
  loadUtxoCache: async () => null,
  saveUtxoCache: async () => undefined,
  sendAccess: () => 'ready',
  providerKeysOf: () => [],
  vaultNumberOf: () => null,
  REFRESH_EXPLAINER: '',
}));
jest.mock('../../../wallet/feeEstimates', () => ({
  getFeePresets: async () => ({ fast: 3, medium: 2, slow: 1 }),
  FALLBACK_PRESETS: { fast: 3, medium: 2, slow: 1 },
  formatFeeRate: (r: number) => String(r),
  MIN_FEE_RATE: 0.1,
  MAX_FEE_RATE: 2000,
}));
jest.mock('../../../wallet/pendingReservations', () => ({
  HELD_ALL: '',
  HELD_SHORT: '',
  reservedOutpoints: () => [],
  reservedSats: () => 0,
}));
jest.mock('../../../wallet/addressCheckStore', () => ({
  addressCheckVerdict: () => null,
  onAddressCheck: () => () => undefined,
}));
jest.mock('../../../services/cosign', () => ({
  isCosignRequest: () => false,
  loadPendingCosigns: async () => [],
  refreshPendingServerStatuses: async () => undefined,
}));
jest.mock('../../../services/companyAuth', () => ({ loadSession: async () => null }));
jest.mock('../../../services/cosignLimits', () => ({ fetchRemainingLimits: async () => null, limitRows: () => [] }));
jest.mock('../../../bitcoin/psbt', () => ({ buildUnsignedPsbt: jest.fn(), validateBuildRequest: () => [] }));
jest.mock('../../../bitcoin/descriptor', () => ({ parsePolicy: () => ({ paths: [] }), pathRequirement: () => ({ keys: [] }) }));
jest.mock('../../../bitcoin/engine/engineError', () => ({
  classifyEngineError: () => 'OTHER',
  coinsHeldByPendingTx: () => false,
  engineErrorMessage: () => '',
}));
jest.mock('../../../bitcoin/engine/addressCheck', () => ({
  blocksBuilding: () => false,
  isSendPaused: () => false,
  SEND_PAUSED_TITLE: 'Paused',
}));

import { SendScreen } from '../SendScreen';
import { buildUnsignedPsbt } from '../../../bitcoin/psbt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;

async function mount(params: Record<string, unknown> = {}): Promise<Renderer> {
  const props = {
    navigation: { goBack: () => undefined, navigate: () => undefined },
    route: { params: { walletId: 'v1', ...params } },
  } as unknown as React.ComponentProps<typeof SendScreen>;
  let renderer!: Renderer;
  await act(async () => {
    renderer = TestRenderer.create(<SendScreen {...props} />);
  });
  return renderer;
}

const hosts = (r: Renderer, type: string) => r.root.findAll((n) => n.type === type);
const button = (r: Renderer, title: string) => hosts(r, 'Button').find((b) => b.props.title === title);
const control = (r: Renderer, label: string) =>
  hosts(r, 'TouchableOpacity').find((t) => t.props.accessibilityLabel === label);
const shown = (r: Renderer) => JSON.stringify(r.toJSON());

async function paste(r: Renderer, clipboard: string | Error): Promise<void> {
  mockClipboard.read = async () => {
    if (clipboard instanceof Error) throw clipboard;
    return clipboard;
  };
  await act(async () => control(r, 'Paste from the clipboard')?.props.onPress());
}

/** The empty field: the one touchable VoiceOver is told to look inside. */
const field = (r: Renderer) => hosts(r, 'TouchableOpacity').find((t) => t.props.accessible === false);

/** A tap on the field, with what iOS's bubble answers. Gives where it opened. */
async function tapField(r: Renderer, answer: string | null): Promise<number[][]> {
  const opened: number[][] = [];
  mockBubble.answer = async (x, y) => {
    opened.push([x, y]);
    return answer;
  };
  mockClipboard.read = async () => {
    throw new Error('the bubble hands the text over; nothing else reads the clipboard');
  };
  await act(async () => field(r)?.props.onPress({ nativeEvent: { pageX: 120, pageY: 240 } }));
  return opened;
}

async function scan(r: Renderer, payload: string): Promise<void> {
  await act(async () => control(r, 'Scan the address')?.props.onPress());
  const [scanner] = hosts(r, 'QrScanner');
  await act(async () => scanner.props.onScanned(payload));
}

const openDialogs = (r: Renderer) => hosts(r, 'AppDialog').filter((d) => d.props.visible);

const expectRefused = (r: Renderer, title: string) => {
  const [dialog, ...others] = openDialogs(r);
  expect(others).toEqual([]);
  expect(dialog.props.title).toBe(title);
  expect(dialog.props.message).toBeUndefined();
  expect(dialog.props.children).toBeUndefined();
  expect(dialog.props.actions.map((a: { label: string }) => a.label)).toEqual(['OK']);
  // Nothing landed: both ways in are still offered and Next stays shut.
  expect(control(r, 'Paste from the clipboard')).toBeDefined();
  expect(button(r, 'Next')?.props.disabled).toBe(true);
  expect(shown(r)).not.toContain('VERIFY ADDRESS');
};

const expectAddressIn = (r: Renderer, address: string) => {
  expect(hosts(r, 'Text').some((t) => t.props.children === address)).toBe(true);
  expect(hosts(r, 'AddressChunks')[0]?.props.address).toBe(address);
  expect(control(r, 'Replace the address')).toBeDefined();
  expect(control(r, 'Paste from the clipboard')).toBeUndefined();
  expect(control(r, 'Scan the address')).toBeUndefined();
  expect(button(r, 'Next')?.props.disabled).toBe(false);
};

beforeEach(() => {
  mockVault.value = { ...mockVault.value, network: 'bitcoin' };
  mockSettings.value = { btcOnly: true, unit: 'btc', fiat: 'USD' };
  mockRate.value = null;
  mockClipboard.read = async () => '';
  mockBubble.answer = async () => null;
  mockFontScale.value = 1;
});

describe('the address on Send', () => {
  it('cannot be typed: the one text field on the step is the note', async () => {
    const r = await mount();
    const before = hosts(r, 'TextInput');
    expect(before.map((i) => i.props.placeholder)).toEqual(['Note to Self']);
    await paste(r, SEGWIT);
    expectAddressIn(r, SEGWIT);
    expect(hosts(r, 'TextInput').map((i) => i.props.placeholder)).toEqual(['Note to Self']);
    expect(hosts(r, 'TextInput').some((i) => i.props.value === SEGWIT)).toBe(false);
  });

  it('holds the page to that in its source too', () => {
    const code = (path: string) =>
      readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const page = code(join(__dirname, '..', 'SendScreen.tsx'));
    expect(page).not.toMatch(/onChangeText=\{setAddress\}/);
    expect(page).not.toMatch(/value=\{address\b/);
    expect(code(join(__dirname, '..', '..', 'components', 'AddressField.tsx'))).not.toMatch(/\bTextInput\b|\bTextField\b/);
  });

  it('reads a bitcoin: link the same pasted as scanned', async () => {
    const link = `bitcoin:${SEGWIT}?amount=0.5&label=shop`;
    const pasted = await mount();
    await paste(pasted, link);
    const scanned = await mount();
    await scan(scanned, link);
    expectAddressIn(pasted, SEGWIT);
    expectAddressIn(scanned, SEGWIT);
    expect(shown(pasted)).toBe(shown(scanned));
  });

  it('gives Replace back both ways in, with nothing left of the address', async () => {
    const r = await mount();
    await paste(r, SEGWIT);
    await act(async () => control(r, 'Replace the address')?.props.onPress());
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(control(r, 'Scan the address')).toBeDefined();
    expect(button(r, 'Next')?.props.disabled).toBe(true);
    expect(shown(r)).not.toContain(SEGWIT);
  });

  it.each([
    ['an empty clipboard', ''],
    ['other text', 'see you at eight'],
    ['a broken address', `${SEGWIT.slice(0, -1)}p`],
    ['an address only its checksum holds up', 'bc1qwjqcaxagkhpvlh8f7cp3q8f2xaz9zhntptysaqp'],
    ['a paste iOS was not allowed to read', new Error('denied')],
  ])('refuses %s with one title and OK', async (_name, clipboard) => {
    const r = await mount();
    await paste(r, clipboard);
    expectRefused(r, NOT_FOUND);
  });

  it('takes neither of two addresses, and says so pasted and scanned', async () => {
    const two = `bitcoin:${SEGWIT}?amount=1\nbitcoin:${TAPROOT}?amount=2`;
    const r = await mount();
    await paste(r, two);
    expectRefused(r, SEVERAL);
    await act(async () => openDialogs(r)[0].props.onClose());

    await scan(r, two);
    expect(shown(r)).toContain(SEVERAL);
    expect(shown(r)).not.toContain('not a Bitcoin address');
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
  });

  it('refuses a test network address on a Bitcoin vault, and the reverse', async () => {
    const r = await mount();
    await paste(r, TESTNET);
    expectRefused(r, OTHER_NETWORK);

    mockVault.value = { ...mockVault.value, network: 'testnet' };
    const other = await mount();
    await paste(other, SEGWIT);
    expectRefused(other, OTHER_NETWORK);
  });

  it('closes a refusal on OK and takes the next paste', async () => {
    const r = await mount();
    await paste(r, 'nothing useful');
    await act(async () => openDialogs(r)[0].props.onClose());
    expect(openDialogs(r)).toEqual([]);
    await paste(r, SEGWIT);
    expectAddressIn(r, SEGWIT);
  });

  it('keeps a scan\'s refusal on its line under the note, and says when the network is wrong', async () => {
    const r = await mount();
    await scan(r, 'not an address');
    expect(shown(r)).toContain('The scanned QR code is not a Bitcoin address.');
    await scan(r, TESTNET);
    expect(shown(r)).toContain('This is a test network address.');
    expect(openDialogs(r)).toEqual([]);
    await scan(r, SEGWIT);
    expectAddressIn(r, SEGWIT);
    expect(shown(r)).not.toContain('test network');
  });

  it('asks the camera for a Bitcoin address', async () => {
    const r = await mount();
    await act(async () => control(r, 'Scan the address')?.props.onPress());
    expect(hosts(r, 'QrScanner')[0].props.hint).toBe('Scan a Bitcoin address');
  });

  it('shows an address handed in by the route read only, with Replace', async () => {
    const r = await mount({ address: SEGWIT });
    expectAddressIn(r, SEGWIT);
    expect(hosts(r, 'TextInput').map((i) => i.props.placeholder)).toEqual(['Note to Self']);
  });

  it('stacks the address over Replace at the accessibility text sizes', async () => {
    const stackedAt = async (fontScale: number) => {
      mockFontScale.value = fontScale;
      const r = await mount({ address: SEGWIT });
      return !!control(r, 'Replace the address')?.props.style[1];
    };
    expect(await stackedAt(1)).toBe(false);
    expect(await stackedAt(1.35)).toBe(false);
    expect(await stackedAt(1.5)).toBe(true);
  });

  it('leaves the note typed', async () => {
    const r = await mount();
    const [note] = hosts(r, 'TextInput');
    await act(async () => note.props.onChangeText('For the shop'));
    expect(hosts(r, 'TextInput')[0].props.value).toBe('For the shop');
  });

  it('opens iOS\'s own bubble where the field was tapped, and its address lands as Paste\'s does', async () => {
    const r = await mount();
    expect(await tapField(r, SEGWIT)).toEqual([[120, 240]]);
    expectAddressIn(r, SEGWIT);
  });

  it('reads the bubble\'s text as it reads the icon\'s', async () => {
    const link = `bitcoin:${SEGWIT}?amount=0.5&label=shop`;
    const icon = await mount();
    await paste(icon, link);
    const bubble = await mount();
    await tapField(bubble, link);
    expect(shown(bubble)).toBe(shown(icon));
  });

  it.each([
    ['other text', 'see you at eight', NOT_FOUND],
    ['an address of another network', TESTNET, OTHER_NETWORK],
    ['two addresses', `bitcoin:${SEGWIT}?amount=1\nbitcoin:${TAPROOT}?amount=2`, SEVERAL],
  ])('refuses %s from the bubble with the same title and OK', async (_name, text, title) => {
    const r = await mount();
    await tapField(r, text);
    expectRefused(r, title);
  });

  it('changes nothing when the bubble closes with no paste, or none could show', async () => {
    const r = await mount();
    await tapField(r, null);
    expect(openDialogs(r)).toEqual([]);
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(button(r, 'Next')?.props.disabled).toBe(true);
  });

  it('keeps the field out of VoiceOver\'s way, with no press dim, and the icons as they were', async () => {
    const r = await mount();
    expect(field(r)?.props.activeOpacity).toBe(1);
    expect(field(r)?.props.accessibilityLabel).toBeUndefined();
    expect(field(r)?.props.disabled).toBe(false);
    await paste(r, SEGWIT);
    expectAddressIn(r, SEGWIT);
  });

  it('takes no tap once an address is in', async () => {
    const r = await mount();
    await paste(r, SEGWIT);
    expect(field(r)).toBeUndefined();
  });

  it('never shows a refresh the address step', async () => {
    const utxos = [{ txid: 'a'.repeat(64), vout: 0, valueSats: 50_000 }];
    const r = await mount({ refresh: { count: 1 }, utxos });
    expect(button(r, 'Sign refresh')).toBeDefined();
    expect(control(r, 'Paste from the clipboard')).toBeUndefined();
    expect(shown(r)).toContain('a new address of this vault');
  });
});

describe('the order of Send, and a payment request\'s amount (decided 2026-11-04)', () => {
  const amountField = (r: Renderer) => hosts(r, 'TextInput').find((i) => i.props.accessibilityLabel === 'Amount');
  const unitShown = (r: Renderer) =>
    hosts(r, 'Text').find((t) => t.props.children === 'BTC' || t.props.children === 'USD')?.props.children;
  const build = buildUnsignedPsbt as jest.Mock;

  async function press(r: Renderer, title: string): Promise<void> {
    const b = button(r, title);
    if (!b) throw new Error(`no ${title} on this step`);
    await act(async () => b.props.onPress());
  }

  /** What Sign hands the build: the satoshis that would really be sent. */
  async function sentSats(r: Renderer): Promise<number> {
    build.mockClear();
    build.mockResolvedValue({ psbtBase64: 'cHNidP8=', txid: 'a'.repeat(64) });
    await press(r, 'Sign transaction');
    expect(build).toHaveBeenCalledTimes(1);
    return build.mock.calls[0][1].recipients[0].amountSats;
  }

  it('opens on the recipient, then asks the amount, then confirms', async () => {
    const r = await mount();
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(amountField(r)).toBeUndefined();
    expect(button(r, 'Next')?.props.disabled).toBe(true);
    await paste(r, SEGWIT);
    await press(r, 'Next');
    expect(amountField(r)).toBeDefined();
    expect(control(r, 'Paste from the clipboard')).toBeUndefined();
    expect(amountField(r)?.props.autoFocus).toBe(true);
    expect(button(r, 'Continue')?.props.disabled).toBe(true);
    await act(async () => amountField(r)?.props.onChangeText('0.001'));
    await press(r, 'Continue');
    expect(button(r, 'Sign transaction')).toBeDefined();
    expect(await sentSats(r)).toBe(100_000);
  });

  it('walks back from the amount to the address, which is still in', async () => {
    const r = await mount();
    await paste(r, SEGWIT);
    await press(r, 'Next');
    await act(async () => hosts(r, 'HeaderBackButton')[0].props.onPress());
    expectAddressIn(r, SEGWIT);
    expect(amountField(r)).toBeUndefined();
  });

  it('fills the amount from a pasted request, exactly, with no keyboard over it', async () => {
    const r = await mount();
    await paste(r, `bitcoin:${SEGWIT}?amount=0.00012345&label=Shop`);
    expectAddressIn(r, SEGWIT);
    await press(r, 'Next');
    expect(amountField(r)?.props.value).toBe('0.00012345');
    expect(amountField(r)?.props.autoFocus).toBe(false);
    expect(button(r, 'Continue')?.props.disabled).toBe(false);
    await press(r, 'Continue');
    expect(await sentSats(r)).toBe(12_345);
  });

  it('fills it the same from a scanned request, a QR code in capitals included', async () => {
    const pasted = await mount();
    await paste(pasted, `bitcoin:${SEGWIT}?amount=0.0015`);
    await press(pasted, 'Next');
    const scanned = await mount();
    await scan(scanned, `BITCOIN:${SEGWIT.toUpperCase()}?AMOUNT=0.0015`);
    expect(hosts(scanned, 'QrScanner')).toEqual([]);
    await press(scanned, 'Next');
    expect(amountField(scanned)?.props.value).toBe('0.0015');
    expect(shown(scanned)).toBe(shown(pasted));
  });

  it('shows the request in bitcoin to a client who sends in money, and never sends a rounded amount', async () => {
    mockSettings.value = { btcOnly: false, unit: 'btc', fiat: 'USD' };
    mockRate.value = 50_000;
    const r = await mount();
    await paste(r, `bitcoin:${SEGWIT}?amount=0.00012345`);
    await press(r, 'Next');
    expect(unitShown(r)).toBe('BTC');
    expect(amountField(r)?.props.value).toBe('0.00012345');
    // In dollars the field reads 6.17, which is 12,340 satoshis; the request is 12,345.
    await act(async () => control(r, 'Switch unit')?.props.onPress());
    expect(unitShown(r)).toBe('USD');
    expect(amountField(r)?.props.value).toBe('6.17');
    await press(r, 'Continue');
    expect(await sentSats(r)).toBe(12_345);
  });

  it('starts an ordinary send in money as before', async () => {
    mockSettings.value = { btcOnly: false, unit: 'btc', fiat: 'USD' };
    mockRate.value = 50_000;
    const r = await mount();
    await paste(r, SEGWIT);
    await press(r, 'Next');
    expect(unitShown(r)).toBe('USD');
    expect(amountField(r)?.props.value).toBe('');
  });

  it('lets typing take over from the request\'s amount', async () => {
    const r = await mount();
    await paste(r, `bitcoin:${SEGWIT}?amount=0.00012345`);
    await press(r, 'Next');
    await act(async () => amountField(r)?.props.onChangeText('0.000123456'));
    expect(amountField(r)?.props.value).toBe('0.00012345');
    await act(async () => amountField(r)?.props.onChangeText('0.002'));
    await press(r, 'Continue');
    expect(await sentSats(r)).toBe(200_000);
  });

  it('lets Use all take over from it too', async () => {
    const r = await mount();
    await paste(r, `bitcoin:${SEGWIT}?amount=0.00012345`);
    await press(r, 'Next');
    const useAll = hosts(r, 'TouchableOpacity').find((t) =>
      t.findAll((n) => (n.type as unknown) === 'Text').some((x) => [x.props.children].flat().includes('Use all')),
    );
    expect(useAll).toBeDefined();
    await act(async () => useAll?.props.onPress());
    await press(r, 'Continue');
    build.mockClear();
    build.mockResolvedValue({ psbtBase64: 'cHNidP8=', txid: 'a'.repeat(64) });
    await press(r, 'Sign transaction');
    expect(build.mock.calls[0][1]).toMatchObject({ drain: true, recipients: [{ address: SEGWIT, amountSats: 0 }] });
  });

  it('takes the amount away with the address on Replace', async () => {
    const r = await mount();
    await paste(r, `bitcoin:${SEGWIT}?amount=0.00012345`);
    await act(async () => control(r, 'Replace the address')?.props.onPress());
    await paste(r, TAPROOT);
    await press(r, 'Next');
    expect(amountField(r)?.props.value).toBe('');
    expect(amountField(r)?.props.autoFocus).toBe(true);
  });

  it('starts the amount again in money once Replace takes a request away, with nothing typed carried over', async () => {
    mockSettings.value = { btcOnly: false, unit: 'btc', fiat: 'USD' };
    mockRate.value = 50_000;
    const r = await mount();
    await paste(r, SEGWIT);
    await press(r, 'Next');
    await act(async () => amountField(r)?.props.onChangeText('100'));
    await act(async () => hosts(r, 'HeaderBackButton')[0].props.onPress());
    await act(async () => control(r, 'Replace the address')?.props.onPress());
    await paste(r, `bitcoin:${SEGWIT}?amount=0.0015`);
    await act(async () => control(r, 'Replace the address')?.props.onPress());
    await paste(r, TAPROOT);
    await press(r, 'Next');
    // The 100 was dollars; it must never come back as 100 bitcoin.
    expect(unitShown(r)).toBe('USD');
    expect(amountField(r)?.props.value).toBe('');
  });

  it('keeps an amount the client typed when a plain address replaces the one it was for', async () => {
    const r = await mount();
    await paste(r, SEGWIT);
    await press(r, 'Next');
    await act(async () => amountField(r)?.props.onChangeText('0.003'));
    await act(async () => hosts(r, 'HeaderBackButton')[0].props.onPress());
    await act(async () => control(r, 'Replace the address')?.props.onPress());
    await paste(r, TAPROOT);
    await press(r, 'Next');
    expect(amountField(r)?.props.value).toBe('0.003');
  });

  it('says plainly when a request asks for more than the vault holds', async () => {
    const r = await mount();
    await paste(r, `bitcoin:${SEGWIT}?amount=0.5`);
    await press(r, 'Next');
    expect(button(r, 'Continue')).toBeUndefined();
    expect(hosts(r, 'NoticeBanner')[0]?.props.children).toBe('Not enough BTC to cover the amount plus the network fee.');
  });

  it.each([
    ['a Lightning invoice', 'lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq', 'Lightning payments are not supported'],
    ['a link with Lightning alone', 'bitcoin:?lightning=lnbc1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypq', 'Lightning payments are not supported'],
    ['a req- parameter', `bitcoin:${SEGWIT}?amount=0.001&req-pop=1`, 'This payment request is not supported'],
    ['an amount that is no bitcoin amount', `bitcoin:${SEGWIT}?amount=0,001`, 'The amount in this request is not valid'],
    ['a request for the other network', `bitcoin:${TESTNET}?amount=0.001`, OTHER_NETWORK],
  ])('refuses %s pasted with one title and OK, and scanned on its line', async (_name, text, title) => {
    const pasted = await mount();
    await paste(pasted, text);
    expectRefused(pasted, title);

    const scanned = await mount();
    await scan(scanned, text);
    expect(openDialogs(scanned)).toEqual([]);
    expect(shown(scanned)).toContain(title === OTHER_NETWORK ? 'This is a test network address.' : title);
    expect(button(scanned, 'Next')?.props.disabled).toBe(true);
  });

  it('lands the global scanner\'s address and amount on the address step, to be checked there', async () => {
    const r = await mount({ address: SEGWIT, amountSats: 12_345 });
    expectAddressIn(r, SEGWIT);
    await press(r, 'Next');
    expect(amountField(r)?.props.value).toBe('0.00012345');
    await press(r, 'Continue');
    expect(await sentSats(r)).toBe(12_345);
  });

  it('takes no amount from the route without an address', async () => {
    const r = await mount({ amountSats: 12_345 });
    await paste(r, SEGWIT);
    await press(r, 'Next');
    expect(amountField(r)?.props.value).toBe('');
  });
});
