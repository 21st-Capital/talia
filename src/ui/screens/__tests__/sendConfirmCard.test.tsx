/**
 * Send's Confirm card, mounted: the page a client approves a payment on. It
 * cut an amount to "0.12345" and the end of the short address at the
 * accessibility text sizes (decided 2026-10-31 after a review, the same fault
 * a phone test found in the cancel dialog). The screen is walked from the
 * address step through the amount, so these are the rows a client reaches. The screen, `FactRow`,
 * `FitText` and the theme are real; the page's other parts and the vault are
 * replaced. Whether iOS lays them out so is its own to prove.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const SHORT = `${ADDRESS.slice(0, 12)}…${ADDRESS.slice(-6)}`;

const mockScreen = { fontScale: 1 };
const mockSettings = { btcOnly: true, unit: 'btc', fiat: 'USD' };
const mockFps = new Set<string>();
const mockVault = { id: 'v1', label: 'Vault', descriptor: 'wpkh(xpub)', network: 'bitcoin', cachedBalanceSats: 10_000_000_000 };
const mockLimits = {
  rows: [] as Array<{ label: string; value: string; sub: string; over: boolean }>,
};

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  PanResponder: { create: () => ({ panHandlers: {} }) },
  useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: mockScreen.fontScale }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../components/TablerIcons', () => new Proxy({}, { get: () => 'Icon' }));
jest.mock('../../components', () => {
  const R = require('react');
  const host =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      R.createElement(name, p, children);
  return {
    FitText: jest.requireActual('../../components/FitText').FitText,
    TextField: (p: Record<string, unknown>) => R.createElement('TextInput', p),
    AppDialog: () => null,
    AppModal: () => null,
    Button: (p: Record<string, unknown>) => R.createElement('Button', p),
    AddressChunks: () => null,
    MarkedText: () => null,
    PageFooter: host('PageFooter'),
    NoticeBanner: host('NoticeBanner'),
    InfoHeading: host('InfoHeading'),
    Gloss: () => null,
    FeeSheet: () => null,
    HeaderBackButton: () => null,
    feeSheetStyles: {},
    cardGlow: () => 0,
    holdKeyboard: () => undefined,
    HEADER_BTN: 40,
    FOOTER_ROOM: 0,
  };
});
jest.mock('../../../platform/QrScanner', () => ({ QrScanner: () => null }));
jest.mock('../../../platform/clipboard', () => ({ readClipboard: async () => '' }));
jest.mock('../../hooks/useProviderFingerprints', () => ({
  useProviderFingerprints: () => ({ providerFps: mockFps }),
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
    getWallet: () => mockVault,
    getEngine: async () => undefined,
    syncWallet: async () => undefined,
    settings: mockSettings,
  }),
  formatAmount: (s: number) => `${s} sats`,
  formatSats: (s: number) => `${s} sats`,
  formatFiat: (s: number) => `$${s / 1000}`,
  fiatSymbol: () => '$',
  getBtcPrice: async () => 100_000,
  setTxNote: async () => undefined,
  loadUtxoCache: async () => null,
  saveUtxoCache: async () => undefined,
  sendAccess: () => 'ready',
  providerKeysOf: () => [{ role: 'cosigner' }],
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
jest.mock('../../../services/companyAuth', () => ({ loadSession: async () => ({}) }));
jest.mock('../../../services/cosignLimits', () => ({
  fetchRemainingLimits: async () => ({}),
  limitRows: () => mockLimits.rows,
}));
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
import { FactRow } from '../../components/FactRow';
import { theme } from '../../theme';
import { amountEms } from '../amountFontSize';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;

async function mount(params: Record<string, unknown>): Promise<Renderer> {
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

const hosts = (r: Renderer, type: string): Node[] => r.root.findAll((n) => n.type === type);
const button = (r: Renderer, title: string) => hosts(r, 'Button').find((b) => b.props.title === title);
const texts = (n: Node): Node[] => n.findAll((c) => (c.type as unknown) === 'Text');
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(3).filter(Boolean));

/** From the address step, which Send opens on (decided 2026-11-04), to the amount. */
async function toAmount(r: Renderer): Promise<void> {
  const nextButton = button(r, 'Next');
  if (!nextButton) throw new Error('not on the address step');
  await act(async () => nextButton.props.onPress());
}

async function toConfirm(r: Renderer): Promise<void> {
  const continueButton = button(r, 'Continue');
  if (!continueButton) throw new Error('not on the amount step');
  await act(async () => continueButton.props.onPress());
}

/** The steps' own way to Confirm, for an address that came with the route. */
async function confirm(amount: string): Promise<Renderer> {
  const r = await mount({ address: ADDRESS });
  await toAmount(r);
  const field = hosts(r, 'TextInput').find((i) => i.props.accessibilityLabel === 'Amount');
  await act(async () => field?.props.onChangeText(amount));
  await toConfirm(r);
  return r;
}

function fact(r: Renderer, label: string) {
  const row = r.root.findAllByType(FactRow).find((f) => f.props.label === label);
  if (!row) throw new Error(`no row "${label}"`);
  const [, value, sub] = texts(row);
  return { value, sub, box: flat(row.findAll((c) => (c.type as unknown) === 'View')[0].props.style) };
}

const expectWhole = (value: Node, text: string) => {
  expect(value.props.children).toBe(text);
  expect(value.props.adjustsFontSizeToFit).toBe(true);
  expect(value.props.numberOfLines).toBe(1);
  expect(value.props.ellipsizeMode).toBeUndefined();
};

const expectWraps = (sub: Node, text: string) => {
  expect(sub.props.children).toBe(text);
  expect(sub.props.numberOfLines).toBeUndefined();
};

beforeEach(() => {
  mockScreen.fontScale = 1;
  Object.assign(mockSettings, { btcOnly: true, unit: 'btc' });
  mockLimits.rows = [];
});

describe('the Confirm card', () => {
  it.each([[1], [1.35], [1.64], [3.12]])('shows the amount and the fee whole at text size %s', async (fontScale) => {
    mockScreen.fontScale = fontScale;
    const r = await confirm('0.12345678');
    expectWhole(fact(r, 'Sending').value, '0.12345678 BTC');
    expectWhole(fact(r, 'Network fee').value, '280 sats');
  });

  it.each([[1], [1.35], [1.64], [3.12]])('shows the end of the address at text size %s', async (fontScale) => {
    mockScreen.fontScale = fontScale;
    const r = await confirm('0.001');
    expectWhole(fact(r, 'To').value, SHORT);
  });

  it('keeps the address the size of every other value, in the mono face', async () => {
    const { value } = fact(await confirm('0.001'), 'To');
    expect(flat(value.props.style).fontFamily).toBe('Menlo');
    expect(flat(value.props.style).fontSize).toBe(theme.typography.heading.fontSize);
  });

  it.each([
    [1, 'row'],
    [1.35, 'row'],
    [1.64, 'column'],
    [3.12, 'column'],
  ])('at text size %s lays each row out as a %s', async (fontScale, direction) => {
    mockScreen.fontScale = fontScale;
    const r = await confirm('0.001');
    for (const label of ['Sending', 'To', 'Network fee']) expect(fact(r, label).box.flexDirection).toBe(direction);
  });

  it('draws no value on a Text that can cut it', async () => {
    mockLimits.rows = [{ label: 'Monthly limit', value: '12% used', sub: '0.0088 of 0.01 BTC left', over: false }];
    const r = await confirm('0.001');
    const limited = r.root
      .findAllByType(FactRow)
      .flatMap((row) => texts(row))
      .filter((t) => t.props.numberOfLines != null && !t.props.adjustsFontSizeToFit)
      .map((t) => t.props.children);
    expect(limited).toEqual([]);
  });

  it('says how the fee was set under it, and that line wraps', async () => {
    const { sub } = fact(await confirm('0.001'), 'Network fee');
    expect(sub.props.children).toContain('priority · ');
    expect(sub.props.numberOfLines).toBeUndefined();
  });

  it('shows the other unit under an amount entered in money', async () => {
    Object.assign(mockSettings, { btcOnly: false });
    const r = await confirm('50');
    const { value, sub } = fact(r, 'Sending');
    expectWhole(value, '$50');
    expectWraps(sub, '0.00050000 BTC');
  });

  it('shows money under an amount read in sats', async () => {
    Object.assign(mockSettings, { btcOnly: false, unit: 'sats' });
    const r = await confirm('50');
    const { value, sub } = fact(r, 'Sending');
    expectWhole(value, '50000 sats');
    expectWraps(sub, '$50');
  });

  it('shows no second line on a Bitcoin only amount', async () => {
    expect(fact(await confirm('0.001'), 'Sending').sub).toBeUndefined();
  });

  it('says Max for a send of everything', async () => {
    const r = await mount({ address: ADDRESS });
    await toAmount(r);
    const useAll = hosts(r, 'TouchableOpacity').find((t) => texts(t).some((x) => [x.props.children].flat().includes('Use all')));
    await act(async () => useAll?.props.onPress());
    await toConfirm(r);
    expectWhole(fact(r, 'Sending').value, 'Max (drain)');
  });

  it('shows a limit whole, in red when the payment is over it', async () => {
    mockLimits.rows = [{ label: 'Monthly limit', value: 'Over the limit', sub: '0.0001 of 0.01 BTC left', over: true }];
    const { value, sub } = fact(await confirm('0.001'), 'Monthly limit');
    expectWhole(value, 'Over the limit');
    expectWraps(sub, '0.0001 of 0.01 BTC left');
    expect(flat(value.props.style).color).toBe(theme.colors.negative);
  });

  it('leaves a limit within reach in the card\'s own colour', async () => {
    mockLimits.rows = [{ label: 'Monthly limit', value: '12% used', sub: '0.0088 of 0.01 BTC left', over: false }];
    const { value } = fact(await confirm('0.001'), 'Monthly limit');
    expect(flat(value.props.style).color).toBe(theme.colors.offWhite);
  });

  it('wraps a refresh\'s destination, which is words', async () => {
    const utxos = [{ txid: 'a'.repeat(64), vout: 0, valueSats: 50_000 }];
    const r = await mount({ refresh: { separate: true, count: 2 }, utxos });
    expectWhole(fact(r, 'Refreshing').value, '0.00049720 BTC');
    expect(r.root.findAllByType(FactRow).some((f) => f.props.label === 'To')).toBe(false);
    const words = hosts(r, 'Text').find((t) => [t.props.children].flat().join('').includes('separate transactions'));
    expect(words?.props.numberOfLines).toBeUndefined();
  });
});

// A phone test, 2026-11-04: at the "extra large" text size a payment
// request's 0.00005107 read 0.0000510 on the amount step, though Confirm
// showed it whole. The field is drawn at its size times the text size.
describe('a payment request\'s amount on the amount step', () => {
  it.each([1, 1.12, 1.35, 3.12])('is drawn whole in a 201pt row at text size %d', async (fontScale) => {
    mockScreen.fontScale = fontScale;
    const r = await mount({ address: ADDRESS, amountSats: 5107 });
    await toAmount(r);
    const amount = () => hosts(r, 'TextInput').find((i) => i.props.accessibilityLabel === 'Amount');
    await act(async () => amount()?.props.onLayout({ nativeEvent: { layout: { width: 201 } } }));
    expect(amount()?.props.value).toBe('0.00005107');
    const size = flat(amount()?.props.style).fontSize as number;
    const drawn = size * fontScale * amountEms('0.00005107') + 0.2 * 10 * fontScale;
    expect(drawn).toBeLessThanOrEqual(201);
  });
});
