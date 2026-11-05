/**
 * A refresh's fee, mounted (decided 2026-11-01 after a phone test: a refresh
 * jumps straight to Confirm, past the amount step that holds the Priority
 * field, so every refresh went out at Medium). The screen, its Priority field,
 * `FactRow` and the theme are real; the page's other parts, the vault and the
 * engine are replaced, and the sheet is a record of what it was handed. What a
 * phone draws and what a real build pays are their own to prove.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const COIN = { txid: 'aa'.repeat(32), vout: 0, valueSats: 100_000 };
const OTHER_COIN = { txid: 'bb'.repeat(32), vout: 1, valueSats: 200_000 };

const mockSettings = { btcOnly: true, unit: 'btc', fiat: 'USD' };
const mockFps = new Set<string>();
const mockVault = { id: 'v1', label: 'Vault', descriptor: 'wpkh(xpub)', network: 'bitcoin', cachedBalanceSats: 300_000 };
const mockSheet: { props: Record<string, any> | null } = { props: null };
const mockPath = { fingerprints: ['aaaaaaaa'] };
const mockEngine = { getInternalAddress: jest.fn(async () => ({ address: ADDRESS })) };
const mockBuild = jest.fn();

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  PanResponder: { create: () => ({ panHandlers: {} }) },
  useWindowDimensions: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
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
    FeeSheet: (p: Record<string, unknown>) => {
      mockSheet.props = p;
      return null;
    },
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
    getEngine: async () => mockEngine,
    syncWallet: async () => mockEngine,
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
jest.mock('../../../services/cosignLimits', () => ({
  fetchRemainingLimits: async () => ({}),
  limitRows: () => [],
}));
jest.mock('../../../bitcoin/psbt', () => ({
  buildUnsignedPsbt: (...args: unknown[]) => mockBuild(...args),
  validateBuildRequest: () => [],
}));
jest.mock('../../../bitcoin/descriptor', () => ({
  parsePolicy: () => ({ paths: [{}] }),
  pathRequirement: () => ({ keys: mockPath.fingerprints.map((fingerprint) => ({ fingerprint })) }),
}));
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;

let navigate: jest.Mock;

async function mount(params: Record<string, unknown>): Promise<Renderer> {
  const props = {
    navigation: { goBack: () => undefined, navigate },
    route: { params: { walletId: 'v1', ...params } },
  } as unknown as React.ComponentProps<typeof SendScreen>;
  let renderer!: Renderer;
  await act(async () => {
    renderer = TestRenderer.create(<SendScreen {...props} />);
  });
  return renderer;
}

const oneCoin = () => mount({ utxos: [COIN], refresh: { count: 1, separate: false } });
const twoCoins = () => mount({ utxos: [COIN, OTHER_COIN], refresh: { count: 2, separate: true } });

const words = (n: Node): string =>
  n.children.map((c) => (typeof c === 'string' ? c : words(c))).join('');
const hosts = (r: Renderer, type: string): Node[] => r.root.findAll((n) => n.type === type);
const button = (r: Renderer, title: string) => hosts(r, 'Button').find((b) => b.props.title === title);
const priorityWords = (r: Renderer): string[] =>
  hosts(r, 'Text').map(words).filter((t) => t === 'Priority');
const priorityField = (r: Renderer) => hosts(r, 'TouchableOpacity').find((t) => words(t).includes(' ≈ '));

function feeLine(r: Renderer): { value: string; sub: string } {
  const row = r.root.findAllByType(FactRow).find((f) => f.props.label === 'Network fee');
  if (!row) throw new Error('no Network fee row');
  return { value: row.props.value, sub: row.props.sub };
}

async function openSheet(r: Renderer): Promise<void> {
  await act(async () => priorityField(r)?.props.onPress());
}

async function pick(r: Renderer, key: 'fast' | 'medium' | 'slow'): Promise<void> {
  await openSheet(r);
  await act(async () => mockSheet.props?.rows.find((row: { key: string }) => row.key === key).onPress());
}

async function sign(r: Renderer): Promise<void> {
  await act(async () => button(r, 'Sign refresh')?.props.onPress());
}

const builtRates = (): number[] => mockBuild.mock.calls.map(([, request]) => request.feeRate);

beforeEach(() => {
  navigate = jest.fn();
  mockSheet.props = null;
  mockPath.fingerprints = ['aaaaaaaa'];
  mockBuild.mockReset();
  mockBuild.mockImplementation(async () => ({ psbtBase64: 'psbt', txid: 'tx', feeSats: 200 }));
  mockEngine.getInternalAddress.mockClear();
});

describe("a refresh's Confirm page", () => {
  it('holds the Priority field, on Medium until the client chooses', async () => {
    const r = await oneCoin();
    expect(priorityWords(r)).toHaveLength(1);
    expect(words(priorityField(r)!)).toContain('Medium ≈ 280 sats');
    expect(feeLine(r)).toEqual({ value: '280 sats', sub: 'Medium priority · 2 sat/vB' });
  });

  it('opens the shared sheet and closes it on a choice', async () => {
    const r = await oneCoin();
    expect(mockSheet.props?.visible).toBe(false);
    await openSheet(r);
    expect(mockSheet.props?.visible).toBe(true);
    expect(mockSheet.props?.title).toBe('Priority');
    expect(mockSheet.props?.rows.map((row: { label: string }) => row.label)).toEqual(['High', 'Medium', 'Slow']);
    await act(async () => mockSheet.props?.rows[2].onPress());
    expect(mockSheet.props?.visible).toBe(false);
  });

  it('shows the chosen tier on the field and on the fee line', async () => {
    const r = await oneCoin();
    await pick(r, 'slow');
    expect(words(priorityField(r)!)).toContain('Slow ≈ 140 sats');
    expect(feeLine(r)).toEqual({ value: '140 sats', sub: 'Slow priority · 1 sat/vB' });
  });

  it("shows the client's own rate", async () => {
    const r = await oneCoin();
    await openSheet(r);
    await act(async () => mockSheet.props?.custom.onChangeText('0.5'));
    expect(feeLine(r)).toEqual({ value: '70 sats', sub: 'Your own rate · 0.5 sat/vB' });
  });

  it('is off while Sign builds, and back after', async () => {
    let finish!: (built: unknown) => void;
    mockBuild.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const r = await oneCoin();
    expect(priorityField(r)?.props.disabled).toBe(false);
    await act(async () => {
      void button(r, 'Sign refresh')?.props.onPress();
    });
    expect(priorityField(r)?.props.disabled).toBe(true);
    await act(async () => finish({ psbtBase64: 'psbt', txid: 'tx', feeSats: 200 }));
    expect(priorityField(r)?.props.disabled).toBe(false);
  });
});

describe('the chosen rate reaches the transaction', () => {
  it('on one coin, and on the rebuild the signing page keeps', async () => {
    const r = await oneCoin();
    await pick(r, 'slow');
    await sign(r);
    expect(builtRates()).toEqual([1]);
    expect(navigate).toHaveBeenCalledWith('SignPsbt', expect.objectContaining({ rebuild: expect.objectContaining({ feeRate: 1 }) }));
  });

  it('on one coin at a rate of their own', async () => {
    const r = await oneCoin();
    await openSheet(r);
    await act(async () => mockSheet.props?.custom.onChangeText('0.5'));
    await sign(r);
    expect(builtRates()).toEqual([0.5]);
  });

  it('on several coins through the refresh session, every one of them', async () => {
    const r = await twoCoins();
    await pick(r, 'fast');
    await sign(r);
    expect(builtRates()).toEqual([3, 3]);
    expect(navigate).toHaveBeenCalledWith('RefreshSession', expect.objectContaining({ walletId: 'v1' }));
  });

  it('on several coins through the one-at-a-time queue', async () => {
    mockPath.fingerprints = [];
    const r = await twoCoins();
    await pick(r, 'slow');
    await sign(r);
    expect(builtRates()).toEqual([1, 1]);
    expect(navigate).toHaveBeenCalledWith('SignPsbt', expect.objectContaining({ psbtQueue: ['psbt', 'psbt'] }));
  });

  it('stays Medium when the client chooses nothing', async () => {
    const r = await oneCoin();
    await sign(r);
    expect(builtRates()).toEqual([2]);
  });
});

describe('a plain payment', () => {
  it('keeps the field on its amount step, and no field on Confirm', async () => {
    // Send opens on the address (decided 2026-11-04); the amount step is next.
    const r = await mount({ address: ADDRESS });
    expect(priorityWords(r)).toHaveLength(0);
    await act(async () => button(r, 'Next')?.props.onPress());
    expect(priorityWords(r)).toHaveLength(1);
    await act(async () => hosts(r, 'TextInput').find((i) => i.props.accessibilityLabel === 'Amount')?.props.onChangeText('0.001'));
    await act(async () => button(r, 'Continue')?.props.onPress());
    expect(button(r, 'Sign transaction')).toBeDefined();
    expect(feeLine(r).sub).toBe('Medium priority · 2 sat/vB');
    expect(priorityWords(r)).toHaveLength(0);
  });
});
