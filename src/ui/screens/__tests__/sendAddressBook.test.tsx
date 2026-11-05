/**
 * The address book on Send's address step, mounted (decided 2026-11-05).
 * While the field is empty, one card lists at most five saved addresses the
 * vault can pay and ends with "Address book"; a row goes in as a paste does;
 * a saved address in the field (however it came) shows its name row, one
 * that is not saved the "Save address" link. A saved Private Address is
 * checked for spent coins under VERIFY ADDRESS; an Exchange Address is never
 * looked up; the check never holds Next. The screen, AddressField, the
 * address book's pieces, its store (sealed, in memory here), its check and
 * the server rule are real; the server's answer, the page's other parts and
 * the vault are replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { readFileSync } from 'fs';
import { join } from 'path';

const SEGWIT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const TAPROOT = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
const LEGACY = '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2';
const KRAKEN = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const COINBASE = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
const TONI = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
const TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

const mockClipboard: { read: () => Promise<string> } = { read: async () => '' };
const mockSettings = { value: { btcOnly: true, unit: 'btc', fiat: 'USD' } as Record<string, unknown> };
const mockVault = {
  value: { id: 'v1', label: 'Vault', descriptor: 'wpkh(xpub)', network: 'bitcoin', cachedBalanceSats: 1_000_000 } as Record<string, unknown>,
};
type Answer = (a: unknown) => void;
const mockAsked: Array<{ network: string; address: string; answer: Answer }> = [];

jest.mock('react-native-keychain', () => require('../../../testing/memoryKeychain'));
jest.mock('@react-native-async-storage/async-storage', () => require('../../../testing/memoryAsyncStorage'));
jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  TouchableOpacity: 'TouchableOpacity',
  TextInput: 'TextInput',
  ScrollView: 'ScrollView',
  PanResponder: { create: () => ({ panHandlers: {} }) },
  useWindowDimensions: () => ({ width: 402, height: 874, scale: 3, fontScale: 1 }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../components/TablerIcons', () => new Proxy({}, { get: () => 'Icon' }));
jest.mock('../../components/Card', () => {
  const R = require('react');
  return { Card: ({ children }: { children?: React.ReactNode }) => R.createElement('Card', null, children) };
});
jest.mock('../../components/AppDialog', () => {
  const R = require('react');
  return { AppDialog: (p: Record<string, unknown>) => R.createElement('AppDialog', p) };
});
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
  pasteBubble: async () => null,
}));
jest.mock('../../hooks/useProviderFingerprints', () => ({
  useProviderFingerprints: () => ({ providerFps: new Set<string>() }),
}));
jest.mock('../../../config', () => ({ SIGNING_ENABLED: true }));
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
  getBtcPrice: async () => null,
  setTxNote: async () => undefined,
  loadUtxoCache: async () => null,
  saveUtxoCache: async () => undefined,
  sendAccess: () => 'ready',
  providerKeysOf: () => [],
  vaultNumberOf: () => null,
  REFRESH_EXPLAINER: '',
}));
// The settings the check's server rule reads (WalletProvider's, once read).
jest.mock('../../../wallet/WalletProvider', () => ({
  useWallets: () => ({ settings: { electrumUrls: {} }, settingsLoaded: true }),
}));
// The one server's answer about one address: held until the test answers it.
jest.mock('../../../wallet/engineProvider', () => ({
  lookUpActivity: (_backend: unknown, network: string, address: string) =>
    new Promise((reply) => mockAsked.push({ network, address, answer: reply })),
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
jest.mock('../../../bitcoin/engine/addressCheck', () => ({
  blocksBuilding: () => false,
  isSendPaused: () => false,
  SEND_PAUSED_TITLE: 'Paused',
}));

import { SendScreen } from '../SendScreen';
import {
  loadAddressBook,
  markEntryUsed,
  saveAddress,
  __resetAddressBookForTests,
} from '../../../wallet/addressBook';
import type { AddressCategory } from '../../../wallet/addressBook';
import { __forgetAddressChecksForTests } from '../../../wallet/addressBookLookup';
import { __resetSealedStoreForTests } from '../../../wallet/sealedStore';
import { __forgetAddressBookViewForTests } from '../../hooks/useAddressBook';

const mem = require('../../../testing/memoryKeychain') as typeof import('../../../testing/memoryKeychain');
const disk = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;
const navigate = jest.fn();
const mounted: Renderer[] = [];

/** Let the store's reads and writes (several promises deep) finish. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  });
}

async function mount(params: Record<string, unknown> = {}): Promise<Renderer> {
  const props = {
    navigation: { goBack: () => undefined, navigate },
    route: { params: { walletId: 'v1', ...params } },
  } as unknown as React.ComponentProps<typeof SendScreen>;
  let renderer!: Renderer;
  await act(async () => {
    renderer = TestRenderer.create(<SendScreen {...props} />);
  });
  mounted.push(renderer);
  await settle();
  return renderer;
}

async function remount(r: Renderer, params: Record<string, unknown>): Promise<void> {
  const props = {
    navigation: { goBack: () => undefined, navigate },
    route: { params: { walletId: 'v1', ...params } },
  } as unknown as React.ComponentProps<typeof SendScreen>;
  await act(async () => r.update(<SendScreen {...props} />));
  await settle();
}

const hosts = (r: Renderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type);
const texts = (r: Renderer) => hosts(r, 'Text').map((t) => [t.props.children].flat().join(''));
const button = (r: Renderer, title: string) => hosts(r, 'Button').find((b) => b.props.title === title);
const control = (r: Renderer, label: string) =>
  hosts(r, 'TouchableOpacity').find((t) => t.props.accessibilityLabel === label);
const shown = (r: Renderer) => JSON.stringify(r.toJSON());
const openDialogs = (r: Renderer) => hosts(r, 'AppDialog').filter((d) => d.props.visible);

/** The card's saved rows, top to bottom, by the names on them. */
const cardNames = (r: Renderer): string[] => {
  const [card] = hosts(r, 'Card');
  if (!card) return [];
  return card
    .findAll((n) => (n.type as unknown) === 'TouchableOpacity' && n.props.accessibilityLabel !== 'Address book')
    .map((row) => row.findAll((n) => (n.type as unknown) === 'Text')[0].props.children);
};

async function paste(r: Renderer, text: string): Promise<void> {
  mockClipboard.read = async () => text;
  await act(async () => control(r, 'Paste from the clipboard')?.props.onPress());
  await settle();
}

async function tap(r: Renderer, label: string): Promise<void> {
  const target = control(r, label);
  if (!target) throw new Error(`nothing labelled ${label}`);
  await act(async () => target.props.onPress());
  await settle();
}

async function save(address: string, name: string, category: AddressCategory, at: number, spentSeenAt?: number) {
  const result = await saveAddress({ address, name, category, spentSeenAt }, at);
  if (result.kind !== 'saved') throw new Error('not saved');
  return result.entry;
}

/** The server's answer to the latest question. */
async function answer(activity: unknown): Promise<void> {
  const asked = mockAsked[mockAsked.length - 1];
  if (!asked) throw new Error('nothing was asked');
  await act(async () => asked.answer(activity));
  await settle();
}

const SPENT = {
  kind: 'txs',
  txs: [
    { txid: 'f'.repeat(64), height: 900_000, spends: [`${'e'.repeat(64)}:0`], pays: [0] },
    { txid: 'd'.repeat(64), height: 900_001, spends: [`${'f'.repeat(64)}:0`], pays: [] },
  ],
};
const NOTHING = { kind: 'txs', txs: [] };

const expectAddressIn = (r: Renderer, address: string) => {
  expect(hosts(r, 'Text').some((t) => t.props.children === address)).toBe(true);
  expect(hosts(r, 'AddressChunks')[0]?.props.address).toBe(address);
  expect(control(r, 'Replace the address')).toBeDefined();
  expect(button(r, 'Next')?.props.disabled).toBe(false);
};

beforeEach(() => {
  mem.__reset();
  disk.clear();
  __resetSealedStoreForTests();
  __resetAddressBookForTests();
  __forgetAddressBookViewForTests();
  __forgetAddressChecksForTests();
  mockVault.value = { ...mockVault.value, network: 'bitcoin' };
  mockClipboard.read = async () => '';
  navigate.mockClear();
});

afterEach(async () => {
  // Nothing left on screen, and nothing left waiting on a server, once a test is over.
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount();
  });
  for (const asked of mockAsked.splice(0)) asked.answer(null);
  await settle();
});

describe('the card on Send while the field is empty', () => {
  it('lists at most five addresses the vault can pay, the most recently used first, then the newest', async () => {
    await save(SEGWIT, 'Segwit', 'private', 1);
    await save(TAPROOT, 'Taproot', 'private', 2);
    await save(LEGACY, 'Legacy', 'private', 3);
    await save(KRAKEN, 'Kraken', 'exchange', 4);
    await save(COINBASE, 'Coinbase', 'exchange', 5);
    await save(TONI, 'Toni', 'private', 6);
    await save(TESTNET, 'Test coins', 'private', 7);
    await markEntryUsed(SEGWIT, 10);
    const r = await mount();
    expect(texts(r)).toContain('ADDRESS BOOK');
    // Used first, then the newest; the sixth Bitcoin address waits on the book page.
    expect(cardNames(r)).toEqual(['Segwit', 'Toni', 'Coinbase', 'Kraken', 'Legacy']);
    expect(shown(r)).not.toContain('Test coins');
    expect(shown(r)).not.toContain('Taproot');
  });

  it('lists only the test network\'s addresses for a Testnet4 vault', async () => {
    mockVault.value = { ...mockVault.value, network: 'testnet' };
    await save(SEGWIT, 'Segwit', 'private', 1);
    await save(TESTNET, 'Test coins', 'private', 2);
    const r = await mount();
    expect(cardNames(r)).toEqual(['Test coins']);
  });

  it('shows each row\'s name, its address whole for the middle cut, its category and the spent tag', async () => {
    await save(KRAKEN, 'Kraken', 'exchange', 1, 50);
    await save(TONI, 'Toni', 'private', 2, 60);
    await save(SEGWIT, 'Sam', 'private', 3);
    const r = await mount();
    const [card] = hosts(r, 'Card');
    const rows = card.findAll((n) => (n.type as unknown) === 'TouchableOpacity');
    const rowTexts = rows.map((row) => row.findAll((n) => (n.type as unknown) === 'Text').map((t) => t.props.children));
    expect(rowTexts).toEqual([
      ['Sam', SEGWIT, 'PRIVATE ADDRESS'],
      ['Toni', TONI, 'PRIVATE ADDRESS', 'HAS SPENT COINS BEFORE'],
      // An Exchange Address never carries the spent mark, even with one on record.
      ['Kraken', KRAKEN, 'EXCHANGE ADDRESS'],
      ['Address book'],
    ]);
    const address = rows[0].findAll((n) => (n.type as unknown) === 'Text')[1];
    expect(address.props).toMatchObject({ numberOfLines: 1, ellipsizeMode: 'middle' });
    expect(rows[1].props.accessibilityLabel).toBe('Toni, Private Address, Has spent coins before');
  });

  it('holds only the "Address book" row with nothing saved for the vault\'s network', async () => {
    await save(TESTNET, 'Test coins', 'private', 1);
    const r = await mount();
    expect(texts(r)).toContain('ADDRESS BOOK');
    expect(cardNames(r)).toEqual([]);
    expect(control(r, 'Address book')).toBeDefined();
  });

  it('opens the Address book page for the sending vault from its last row', async () => {
    const r = await mount();
    await tap(r, 'Address book');
    expect(navigate).toHaveBeenCalledWith('AddressBook', { walletId: 'v1', network: 'bitcoin' });
  });

  it('is gone once an address is in the field, and back after Replace', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mount();
    await paste(r, SEGWIT);
    expect(hosts(r, 'Card')).toEqual([]);
    expect(texts(r)).not.toContain('ADDRESS BOOK');
    await tap(r, 'Replace the address');
    expect(cardNames(r)).toEqual(['Toni']);
  });
});

describe('a saved address on Send', () => {
  it('goes in from a row exactly as a paste would, and moves to the top of the card', async () => {
    await save(KRAKEN, 'Kraken', 'exchange', 1);
    await save(TONI, 'Toni', 'exchange', 2);
    const r = await mount();
    await tap(r, 'Kraken, Exchange Address');
    expectAddressIn(r, KRAKEN);
    const pasted = await mount();
    await paste(pasted, KRAKEN);
    expect(shown(r)).toBe(shown(pasted));
    expect((await loadAddressBook()).find((e) => e.address === KRAKEN)?.lastUsedAt).toEqual(expect.any(Number));
    await tap(r, 'Replace the address');
    expect(cardNames(r)).toEqual(['Kraken', 'Toni']);
  });

  it('comes back from the Address book page through the route, read as a paste', async () => {
    await save(TONI, 'Toni', 'exchange', 1);
    const r = await mount();
    await remount(r, { picked: { address: TONI, at: 1 } });
    expectAddressIn(r, TONI);
    expect(texts(r)).toContain('Toni');
    // A second pick of another address takes the first one's place.
    await act(async () => {
      await save(KRAKEN, 'Kraken', 'exchange', 2);
    });
    await remount(r, { picked: { address: KRAKEN, at: 2 } });
    expectAddressIn(r, KRAKEN);
  });

  it('takes the same address picked twice: each pick lands, told apart by its moment', async () => {
    await save(TONI, 'Toni', 'exchange', 1);
    const r = await mount();
    await remount(r, { picked: { address: TONI, at: 1 } });
    expectAddressIn(r, TONI);
    await tap(r, 'Replace the address');
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    await remount(r, { picked: { address: TONI, at: 2 } });
    expectAddressIn(r, TONI);
  });

  it('is refused from the route as a paste of it is: another network\'s address never lands', async () => {
    const r = await mount();
    await remount(r, { picked: { address: TESTNET, at: 1 } });
    const [dialog, ...others] = openDialogs(r);
    expect(others).toEqual([]);
    expect(dialog.props.title).toBe('This address is for another network');
    expect(control(r, 'Paste from the clipboard')).toBeDefined();
    expect(button(r, 'Next')?.props.disabled).toBe(true);
  });

  it('shows its name and category under the field however it came, matched on the normalised address', async () => {
    await save(SEGWIT, 'Sam', 'exchange', 1);
    for (const text of [SEGWIT, SEGWIT.toUpperCase(), `bitcoin:${SEGWIT}?amount=0.001`]) {
      const r = await mount();
      await paste(r, text);
      const row = control(r, 'Sam, Exchange Address');
      expect(row).toBeDefined();
      expect(row!.findAll((n) => (n.type as unknown) === 'Text').map((t) => t.props.children)).toEqual(['Sam', 'Exchange Address']);
      expect(control(r, 'Save address')).toBeUndefined();
    }
  });

  it('opens the Address book page from its name row', async () => {
    await save(SEGWIT, 'Sam', 'exchange', 1);
    const r = await mount();
    await paste(r, SEGWIT);
    await tap(r, 'Sam, Exchange Address');
    expect(navigate).toHaveBeenCalledWith('AddressBook', { walletId: 'v1', network: 'bitcoin' });
  });
});

describe('an address on Send that is not saved', () => {
  it('offers "Save address", which opens Add address with it filled in for this vault\'s network', async () => {
    const r = await mount();
    await paste(r, `bitcoin:${SEGWIT}?amount=0.001`);
    await tap(r, 'Save address');
    expect(navigate).toHaveBeenCalledWith('AddAddress', { network: 'bitcoin', address: SEGWIT });
    expect(mockAsked).toEqual([]);
  });

  it('shows its name row as soon as it is saved, and the link goes', async () => {
    const r = await mount();
    await paste(r, SEGWIT);
    expect(control(r, 'Save address')).toBeDefined();
    await act(async () => {
      await saveAddress({ address: SEGWIT, name: 'Sam', category: 'exchange' });
    });
    await settle();
    expect(control(r, 'Sam, Exchange Address')).toBeDefined();
    expect(control(r, 'Save address')).toBeUndefined();
  });
});

describe('the spent-coins check on Send', () => {
  it('never looks up an Exchange Address', async () => {
    await save(KRAKEN, 'Kraken', 'exchange', 1);
    const r = await mount();
    await tap(r, 'Kraken, Exchange Address');
    await paste(await mount(), KRAKEN);
    expect(mockAsked).toEqual([]);
    expect(texts(r)).not.toContain('Checking this address…');
    expect(shown(r)).not.toContain('NoticeBanner');
  });

  it('never looks up an address that is not saved', async () => {
    const r = await mount();
    await paste(r, SEGWIT);
    expect(mockAsked).toEqual([]);
    expect(texts(r)).not.toContain('Checking this address…');
  });

  it('asks the vault\'s own network about a saved Private Address, with a quiet line under VERIFY ADDRESS and Next open', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mount();
    await tap(r, 'Toni, Private Address');
    expect(mockAsked.map((a) => [a.network, a.address])).toEqual([['bitcoin', TONI]]);
    const all = texts(r);
    expect(all.indexOf('Checking this address…')).toBeGreaterThan(all.indexOf('VERIFY ADDRESS'));
    expect(button(r, 'Next')?.props.disabled).toBe(false);
  });

  it('shows the gold notice for a spent Private Address, its reason behind its tap, and keeps Next open', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mount();
    await tap(r, 'Toni, Private Address');
    await answer(SPENT);
    const notices = r.root.findAll((n) => (n.type as unknown) === 'TouchableOpacity' && n.findAll((t) => (t.type as unknown) === 'Text').some((t) => t.props.children === 'This address has spent coins before. Ask for a new one.'));
    expect(notices.length).toBeGreaterThan(0);
    expect(texts(r)).not.toContain('Checking this address…');
    expect(button(r, 'Next')?.props.disabled).toBe(false);
    // The reason, the app's info pattern: its title, the sentence, Got it.
    await act(async () => notices[notices.length - 1].props.onPress());
    const [why] = openDialogs(r);
    expect(why.props.title).toBe('Has spent coins before');
    expect(why.props.message).toBe(
      'Paying an address that has already spent coins links your payment to everything it did before. Ask the receiver for a new address.',
    );
    expect(why.props.actions.map((a: { label: string }) => a.label)).toEqual(['Got it']);
    // Remembered in the book, and never asked about again.
    expect((await loadAddressBook())[0].spentSeenAt).toEqual(expect.any(Number));
    const again = await mount();
    await paste(again, TONI);
    expect(mockAsked).toHaveLength(1);
    expect(texts(again)).toContain('This address has spent coins before. Ask for a new one.');
  });

  it('shows the notice at once for a Private Address already found spent, and asks nothing', async () => {
    await save(TONI, 'Toni', 'private', 1, 99);
    const r = await mount();
    await paste(r, TONI);
    expect(mockAsked).toEqual([]);
    expect(texts(r)).toContain('This address has spent coins before. Ask for a new one.');
  });

  it('shows nothing at all when nothing was found, never a safe claim, and stores nothing', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mount();
    await paste(r, TONI);
    const before = texts(r);
    await answer(NOTHING);
    const after = texts(r);
    expect(after).not.toContain('Checking this address…');
    expect(after).not.toContain('This address has spent coins before. Ask for a new one.');
    expect(after).not.toContain('Could not check this address');
    expect(after.length).toBe(before.length - 1);
    expect((await loadAddressBook())[0].spentSeenAt).toBeUndefined();
  });

  it('says when the server could not be asked, with Try again, and asks again', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mount();
    await paste(r, TONI);
    await answer(null);
    expect(texts(r)).toContain('Could not check this address');
    expect(button(r, 'Next')?.props.disabled).toBe(false);
    await tap(r, 'Try again');
    expect(mockAsked).toHaveLength(2);
    expect(texts(r)).toContain('Checking this address…');
    await answer(SPENT);
    expect(texts(r)).toContain('This address has spent coins before. Ask for a new one.');
  });

  it('lets Next through while checking and with a spent answer, to the amount step', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const checking = await mount();
    await paste(checking, TONI);
    await act(async () => button(checking, 'Next')?.props.onPress());
    expect(hosts(checking, 'TextInput').some((i) => i.props.accessibilityLabel === 'Amount')).toBe(true);

    const spent = await mount();
    await paste(spent, TONI);
    await answer(SPENT);
    await act(async () => button(spent, 'Next')?.props.onPress());
    expect(hosts(spent, 'TextInput').some((i) => i.props.accessibilityLabel === 'Amount')).toBe(true);
  });

  it('asks nothing for a saved Private Address a Testnet4 vault cannot pay', async () => {
    mockVault.value = { ...mockVault.value, network: 'testnet' };
    await save(P2SH, 'Old', 'private', 1);
    const r = await mount();
    await paste(r, P2SH);
    expect(openDialogs(r)[0]?.props.title).toBe('This address is for another network');
    expect(mockAsked).toEqual([]);
  });
});

describe('the address book\'s words on Send', () => {
  it('come from the one words module, with no dash a client reads', () => {
    const code = (path: string) =>
      readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const files = [
      join(__dirname, '..', 'SendScreen.tsx'),
      join(__dirname, '..', 'AddressBookScreen.tsx'),
      join(__dirname, '..', 'AddAddressScreen.tsx'),
      join(__dirname, '..', '..', 'components', 'AddressBookParts.tsx'),
    ];
    for (const file of files) {
      const src = code(file);
      expect([file, /[–—]/.test(src)]).toEqual([file, false]);
      for (const word of ['Private Address', 'Exchange Address', 'Address book', 'Save address', 'Has spent coins before', 'Checking this address', 'Try again']) {
        expect([file, word, src.includes(`'${word}`) || src.includes(`"${word}`) || src.includes(`>${word}`)]).toEqual([file, word, false]);
      }
    }
  });
});
