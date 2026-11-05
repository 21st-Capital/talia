/**
 * The Address book page and the Add address page, mounted (decided
 * 2026-11-05). The book: Private Address then Exchange Address, a section
 * with no entries left out, only the sending vault's network, the gold line
 * for a Private Address found spent, a tap that answers Send, a long press
 * that renames, moves and removes, and the + to Add address. Adding: the
 * address pasted or scanned (another network refused), a capped name,
 * Private Address preselected, the check for a Private Address only and
 * never in the way of Save, one entry per address. The screens, the field,
 * the check's lines, the store (sealed, in memory here), the check and the
 * server rule are real; the server's answer and the navigation are
 * replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const SEGWIT = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const KRAKEN = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TONI = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const ROBIN = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

const mockClipboard: { read: () => Promise<string> } = { read: async () => '' };
const mockModal: { onDismiss?: () => void } = {};
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
}));
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../components/TablerIcons', () => new Proxy({}, { get: () => 'Icon' }));
jest.mock('../../components/Gloss', () => ({ Gloss: () => null, cardGlow: () => 0.3 }));
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
  return {
    ...jest.requireActual('../../components/AddressBookParts'),
    TextField: jest.requireActual('../../components/TextField').TextField,
    AddressField: jest.requireActual('../../components/AddressField').AddressField,
    AppDialog: (p: Record<string, unknown>) => R.createElement('AppDialog', p),
    AppModal: ({ visible, children, onDismiss }: { visible: boolean; children: React.ReactNode; onDismiss?: () => void }) => {
      mockModal.onDismiss = onDismiss;
      return visible ? R.createElement('AppModal', null, children) : null;
    },
    Button: (p: Record<string, unknown>) => R.createElement('Button', p),
    AddressChunks: (p: Record<string, unknown>) => R.createElement('AddressChunks', p),
    Card: host('Card'),
    HeaderIconButton: host('HeaderIconButton'),
    Screen: ({ children, footer, ...p }: { children?: React.ReactNode; footer?: React.ReactNode }) =>
      R.createElement('Screen', p, children, footer),
    SegmentedControl: (p: Record<string, unknown>) => R.createElement('SegmentedControl', p),
    SwipeRow: jest.requireActual('../../components/SwipeRow').SwipeRow,
  };
});
jest.mock('../../../platform/QrScanner', () => ({
  QrScanner: (p: Record<string, unknown>) => require('react').createElement('QrScanner', p),
}));
jest.mock('../../../platform/clipboard', () => ({
  readClipboard: () => mockClipboard.read(),
  pasteBubble: async () => null,
}));
jest.mock('../../../wallet/WalletProvider', () => ({
  useWallets: () => ({ settings: { electrumUrls: {} }, settingsLoaded: true }),
}));
jest.mock('../../../wallet/engineProvider', () => ({
  lookUpActivity: (_backend: unknown, network: string, address: string) =>
    new Promise((reply) => mockAsked.push({ network, address, answer: reply })),
}));

import { AddressBookScreen } from '../AddressBookScreen';
import { AddAddressScreen } from '../AddAddressScreen';
import { loadAddressBook, saveAddress, __resetAddressBookForTests } from '../../../wallet/addressBook';
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
const mounted: Renderer[] = [];
const nav = {
  setOptions: jest.fn(),
  navigate: jest.fn(),
  popTo: jest.fn(),
  goBack: jest.fn(),
};

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  });
}

async function mountBook(network = 'bitcoin'): Promise<Renderer> {
  const props = { navigation: nav, route: { params: { walletId: 'v1', network } } } as unknown as React.ComponentProps<
    typeof AddressBookScreen
  >;
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(<AddressBookScreen {...props} />);
  });
  mounted.push(r);
  await settle();
  return r;
}

async function mountAdd(params: Record<string, unknown> = {}): Promise<Renderer> {
  const props = { navigation: nav, route: { params: { network: 'bitcoin', ...params } } } as unknown as React.ComponentProps<
    typeof AddAddressScreen
  >;
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(<AddAddressScreen {...props} />);
  });
  mounted.push(r);
  await settle();
  return r;
}

const hosts = (r: Renderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type);
const texts = (r: Renderer) => hosts(r, 'Text').map((t) => [t.props.children].flat().join(''));
const control = (r: Renderer, label: string) =>
  hosts(r, 'TouchableOpacity').find((t) => t.props.accessibilityLabel === label);
const openDialogs = (r: Renderer) => hosts(r, 'AppDialog').filter((d) => d.props.visible);
const dialogTitled = (r: Renderer, title: string) => openDialogs(r).find((d) => d.props.title === title);
const labels = (d: TestRenderer.ReactTestInstance) => (d.props.actions as Array<{ label: string }>).map((a) => a.label);

async function press(target: TestRenderer.ReactTestInstance | undefined): Promise<void> {
  if (!target) throw new Error('nothing to press');
  await act(async () => {
    await target.props.onPress();
  });
  await settle();
}

/** An action of a dialog, as AppDialog runs it: the dialog closes, then the action. */
async function choose(r: Renderer, title: string, label: string, typed = ''): Promise<void> {
  const dialog = dialogTitled(r, title);
  if (!dialog) throw new Error(`no dialog ${title}`);
  const action = dialog.props.actions.find((a: { label: string }) => a.label === label);
  await act(async () => {
    dialog.props.onClose();
    action.onPress(typed);
  });
  await settle();
}


async function save(address: string, name: string, category: AddressCategory, at: number, spentSeenAt?: number) {
  await act(async () => {
    await saveAddress({ address, name, category, spentSeenAt }, at);
  });
}

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

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
  mem.__reset();
  disk.clear();
  __resetSealedStoreForTests();
  __resetAddressBookForTests();
  __forgetAddressBookViewForTests();
  __forgetAddressChecksForTests();
  mockClipboard.read = async () => '';
  for (const f of Object.values(nav)) f.mockClear();
});

afterEach(async () => {
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount();
  });
  for (const asked of mockAsked.splice(0)) asked.answer(null);
  await settle();
  jest.useRealTimers();
});

describe('the Address book page', () => {
  it('draws Private Address then Exchange Address, each entry its own card, for the vault\'s network only', async () => {
    await save(KRAKEN, 'Kraken', 'exchange', 1);
    await save(TONI, 'Toni', 'private', 2);
    await save(ROBIN, 'Robin', 'private', 3, 40);
    await save(TESTNET, 'Test coins', 'private', 4);
    const r = await mountBook();
    expect(texts(r)).toEqual([
      'Private Address',
      'Robin',
      'bc1p5cyxnu…xqkedrcr',
      'Has spent coins before',
      'Toni',
      'bc1qcr8te4…8z306fyu',
      'Exchange Address',
      'Kraken',
      'bc1qw508d6…7kv8f3t4',
    ]);
    expect(hosts(r, 'Card')).toHaveLength(3);
    // The start and the end whole, never cut by the line (the picked design's form).
    const address = hosts(r, 'Text').find((t) => t.props.children === 'bc1qcr8te4…8z306fyu')!;
    expect(address.props.numberOfLines).toBeUndefined();
  });

  it('leaves out a section with no entries, and an Exchange Address never shows the spent line', async () => {
    await save(KRAKEN, 'Kraken', 'exchange', 1, 40);
    const r = await mountBook();
    expect(texts(r)).toEqual(['Exchange Address', 'Kraken', 'bc1qw508d6…7kv8f3t4']);
  });

  it('says one quiet line with nothing saved, and one true for the vault with entries for another network only', async () => {
    expect(texts(await mountBook('testnet'))).toEqual(['No saved addresses yet']);
    await save(SEGWIT, 'Sam', 'private', 1);
    expect(texts(await mountBook('testnet'))).toEqual(['No saved addresses for Testnet4 yet']);
    await save(TESTNET, 'Test coins', 'private', 2);
    expect(texts(await mountBook('bitcoin'))).toEqual(['Private Address', 'Sam', 'bc1qar0srr…zzwf5mdq']);
  });

  it('claims nothing when the book on this phone cannot be read', async () => {
    disk.set('talia.addressBook.v1', 'not a book');
    const r = await mountBook();
    expect(texts(r)).toEqual(['The address book could not be read']);
  });

  it('puts a tapped card on Send and goes back there', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mountBook();
    await press(control(r, 'Toni, Private Address'));
    expect(nav.popTo).toHaveBeenCalledWith('Send', { walletId: 'v1', picked: { address: TONI, at: expect.any(Number) } }, { merge: true });
  });

  it('opens Add address for the same network from the round + in the bar', async () => {
    await mountBook('testnet');
    const right = nav.setOptions.mock.calls.map((c) => c[0]).filter((o) => o.headerRight).pop().headerRight;
    const plus = right() as React.ReactElement<{ label: string; onPress: () => void }>;
    expect(plus.props.label).toBe('Add address');
    plus.props.onPress();
    expect(nav.navigate).toHaveBeenCalledWith('AddAddress', { network: 'testnet' });
  });

  /** The swipe rows of the page, each with its card's label. */
  const rows = (r: Renderer) =>
    r.root.findAll((n) => typeof n.type === 'function' && (n.type as { name?: string }).name === 'SwipeRow');
  const rowOf = (r: Renderer, card: string) =>
    rows(r).find((row) => row.findAll((n) => n.props.accessibilityLabel === card).length > 0)!;
  const tile = (r: Renderer, card: string, action: string) =>
    rowOf(r, card).findAll((n) => (n.type as unknown) === 'TouchableOpacity' && n.props.accessibilityLabel === action)[0];

  it('a card swiped to the left shows Edit, then Remove in red (decided 2026-11-05, in place of the long press)', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mountBook();
    const row = rowOf(r, 'Toni, Private Address');
    expect(row.props.actions.map((a: { label: string }) => a.label)).toEqual(['Edit', 'Remove']);
    expect(row.props.actions.map((a: { destructive?: boolean }) => !!a.destructive)).toEqual([false, true]);
    expect(control(r, 'Toni, Private Address')!.props.onLongPress).toBeUndefined();
    expect(openDialogs(r)).toEqual([]);
  });

  it('one card is open at a time, and while one is, a tap on any card closes it instead of picking', async () => {
    await save(TONI, 'Toni', 'private', 1);
    await save(KRAKEN, 'Kraken', 'exchange', 2);
    const r = await mountBook();
    await act(async () => rowOf(r, 'Toni, Private Address').props.onOpen());
    expect(rowOf(r, 'Toni, Private Address').props.open).toBe(true);
    await act(async () => rowOf(r, 'Kraken, Exchange Address').props.onOpen());
    expect(rowOf(r, 'Toni, Private Address').props.open).toBe(false);
    expect(rowOf(r, 'Kraken, Exchange Address').props.open).toBe(true);
    await press(control(r, 'Toni, Private Address'));
    expect(nav.popTo).not.toHaveBeenCalled();
    expect(rows(r).map((row) => row.props.open)).toEqual([false, false]);
    await press(control(r, 'Kraken, Exchange Address'));
    expect(nav.popTo).toHaveBeenCalledTimes(1);
  });

  it('a card takes a full swipe, and an open card turns the page\'s swipe back off until it closes (decided 2026-11-05)', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mountBook();
    expect(rowOf(r, 'Toni, Private Address').props.fullSwipe).toBe(true);
    expect(nav.setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
    await act(async () => rowOf(r, 'Toni, Private Address').props.onOpen());
    expect(nav.setOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
    await act(async () => rowOf(r, 'Toni, Private Address').props.onClose());
    expect(nav.setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });

  it('the page holds still while a card is swiped and while one is open (decided 2026-11-05 after a phone test)', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mountBook();
    const page = () => hosts(r, 'Screen')[0];
    expect(page().props.scrollEnabled).toBe(true);
    await act(async () => rowOf(r, 'Toni, Private Address').props.onSwipeStart());
    expect(page().props.scrollEnabled).toBe(false);
    await act(async () => {
      rowOf(r, 'Toni, Private Address').props.onSwipeEnd();
      rowOf(r, 'Toni, Private Address').props.onOpen();
    });
    expect(page().props.scrollEnabled).toBe(false);
    await act(async () => rowOf(r, 'Toni, Private Address').props.onClose());
    expect(page().props.scrollEnabled).toBe(true);
  });

  it("Edit opens the entry's own page for the same network, and closes the card", async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mountBook();
    await act(async () => rowOf(r, 'Toni, Private Address').props.onOpen());
    await press(tile(r, 'Toni, Private Address', 'Edit'));
    const id = (await loadAddressBook())[0].id;
    expect(nav.navigate).toHaveBeenCalledWith('AddAddress', { network: 'bitcoin', editId: id });
    expect(rowOf(r, 'Toni, Private Address').props.open).toBe(false);
  });

  it('removes only after its own confirm, "Remove <name>?"', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mountBook();
    await press(tile(r, 'Toni, Private Address', 'Remove'));
    expect(await loadAddressBook()).toHaveLength(1);
    const confirm = dialogTitled(r, 'Remove Toni?')!;
    expect(labels(confirm)).toEqual(['Remove', 'Cancel']);
    expect(confirm.props.actions[0].destructive).toBe(true);
    expect(confirm.props.message).toBeUndefined();
    await choose(r, 'Remove Toni?', 'Cancel');
    expect(await loadAddressBook()).toHaveLength(1);

    await press(tile(r, 'Toni, Private Address', 'Remove'));
    await choose(r, 'Remove Toni?', 'Remove');
    expect(await loadAddressBook()).toEqual([]);
    expect(texts(r)).toEqual(['No saved addresses yet']);
  });

  it("VoiceOver offers Edit and Remove as the card's own actions", async () => {
    await save(TONI, 'Toni', 'private', 1);
    const r = await mountBook();
    const card = control(r, 'Toni, Private Address')!;
    expect(card.props.accessibilityActions.map((a: { label: string }) => a.label)).toEqual(['Edit', 'Remove']);
    await act(async () => card.props.onAccessibilityAction({ nativeEvent: { actionName: 'remove' } }));
    expect(dialogTitled(r, 'Remove Toni?')).toBeDefined();
    await choose(r, 'Remove Toni?', 'Cancel');
    await act(async () => card.props.onAccessibilityAction({ nativeEvent: { actionName: 'edit' } }));
    expect(nav.navigate).toHaveBeenCalledWith('AddAddress', expect.objectContaining({ editId: expect.any(String) }));
  });
});

describe('the Edit address page (Edit on a swiped card, decided 2026-11-05)', () => {
  const button = (r: Renderer) => hosts(r, 'Button')[0];
  const nameField = (r: Renderer) => hosts(r, 'TextInput').find((i) => i.props.placeholder === 'Name')!;
  const segments = (r: Renderer) => hosts(r, 'SegmentedControl')[0];
  const idOf = async (address: string) => (await loadAddressBook()).find((e) => e.address === address)!.id;

  it('is titled Edit address, holds the address as it is, and fills in the name and category', async () => {
    await save(KRAKEN, 'Kraken', 'exchange', 1);
    const r = await mountAdd({ editId: await idOf(KRAKEN) });
    expect(nav.setOptions).toHaveBeenCalledWith({ title: 'Edit address' });
    expect(hosts(r, 'AddressChunks')[0].props.address).toBe(KRAKEN);
    expect(control(r, 'Replace the address')!.props.disabled).toBe(true);
    expect(nameField(r).props.value).toBe('Kraken');
    expect(segments(r).props.value).toBe('exchange');
    expect(button(r).props.title).toBe('Save');
    expect(button(r).props.disabled).toBe(false);
  });

  it('saves the name and the category at once, keeps what the check found, and goes back', async () => {
    await save(TONI, 'Toni', 'private', 1, 40);
    const r = await mountAdd({ editId: await idOf(TONI) });
    await act(async () => nameField(r).props.onChangeText('Toni Studio'));
    await act(async () => segments(r).props.onChange('exchange'));
    await press(button(r));
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    expect(await loadAddressBook()).toEqual([
      expect.objectContaining({ address: TONI, name: 'Toni Studio', category: 'exchange', spentSeenAt: 40 }),
    ]);
  });

  it('judges the check by the category chosen here: none as an Exchange Address, asked as a Private Address', async () => {
    await save(KRAKEN, 'Kraken', 'exchange', 1);
    const r = await mountAdd({ editId: await idOf(KRAKEN) });
    expect(mockAsked).toEqual([]);
    await act(async () => segments(r).props.onChange('private'));
    await settle();
    expect(mockAsked.map((a) => a.address)).toEqual([KRAKEN]);
  });

  it('an entry removed meanwhile cannot be saved: a title and OK, and the page stays', async () => {
    await save(TONI, 'Toni', 'private', 1);
    const id = await idOf(TONI);
    const r = await mountAdd({ editId: id });
    await act(async () => {
      await (require('../../../wallet/addressBook') as typeof import('../../../wallet/addressBook')).removeEntry(id);
    });
    await settle();
    await press(button(r));
    expect(nav.goBack).not.toHaveBeenCalled();
    expect(dialogTitled(r, 'The address book could not be saved')).toBeDefined();
  });
});

describe('the Add address page', () => {
  const button = (r: Renderer) => hosts(r, 'Button').find((b) => b.props.title === 'Save address')!;
  const nameField = (r: Renderer) => hosts(r, 'TextInput').find((i) => i.props.placeholder === 'Name')!;
  const segments = (r: Renderer) => hosts(r, 'SegmentedControl')[0];

  async function name(r: Renderer, text: string): Promise<void> {
    await act(async () => nameField(r).props.onChangeText(text));
  }

  it('opens with the address Send handed over, Private Address chosen, and no field to type an address in', async () => {
    const r = await mountAdd({ address: SEGWIT });
    expect(hosts(r, 'TextInput').map((i) => i.props.placeholder)).toEqual(['Name']);
    expect(hosts(r, 'AddressChunks')[0].props.address).toBe(SEGWIT);
    expect(texts(r)).toContain('VERIFY ADDRESS');
    expect(segments(r).props.value).toBe('private');
    expect(segments(r).props.options.map((o: { label: string }) => o.label)).toEqual(['Private Address', 'Exchange Address']);
    expect(nameField(r).props.maxLength).toBe(14);
  });

  it('turns Save on once an address and a name are in', async () => {
    const r = await mountAdd();
    expect(button(r).props.disabled).toBe(true);
    mockClipboard.read = async () => SEGWIT;
    await press(control(r, 'Paste from the clipboard'));
    expect(button(r).props.disabled).toBe(true);
    await name(r, '  ');
    expect(button(r).props.disabled).toBe(true);
    await name(r, 'Sam');
    expect(button(r).props.disabled).toBe(false);
  });

  it('saves the entry and goes back where it came from', async () => {
    const r = await mountAdd({ address: SEGWIT });
    await name(r, 'Sam');
    await act(async () => segments(r).props.onChange('exchange'));
    await press(button(r));
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    expect(await loadAddressBook()).toEqual([expect.objectContaining({ address: SEGWIT, name: 'Sam', category: 'exchange' })]);
  });

  it('refuses an address already in the book at Save, a title and OK, and stays', async () => {
    await save(SEGWIT.toUpperCase(), 'Sam', 'private', 1);
    const r = await mountAdd({ address: SEGWIT });
    await name(r, 'Other');
    await press(button(r));
    const [dialog, ...others] = openDialogs(r);
    expect(others).toEqual([]);
    expect(dialog.props.title).toBe('This address is already saved');
    expect(dialog.props.message).toBeUndefined();
    expect(labels(dialog)).toEqual(['OK']);
    expect(nav.goBack).not.toHaveBeenCalled();
    expect(await loadAddressBook()).toHaveLength(1);
  });

  it('refuses a paste and a scan of another network\'s address with Send\'s own title', async () => {
    const r = await mountAdd();
    mockClipboard.read = async () => TESTNET;
    await press(control(r, 'Paste from the clipboard'));
    expect(openDialogs(r).map((d) => d.props.title)).toEqual(['This address is for another network']);
    await choose(r, 'This address is for another network', 'OK');

    await press(control(r, 'Scan the address'));
    const [scanner] = hosts(r, 'QrScanner');
    await act(async () => scanner.props.onScanned(TESTNET));
    // Said once the scanner has closed, never over it.
    expect(openDialogs(r)).toEqual([]);
    await act(async () => mockModal.onDismiss?.());
    expect(openDialogs(r).map((d) => d.props.title)).toEqual(['This address is for another network']);
    expect(hosts(r, 'AddressChunks')).toEqual([]);
  });

  it('takes a scanned address for the vault\'s network', async () => {
    const r = await mountAdd();
    await press(control(r, 'Scan the address'));
    await act(async () => hosts(r, 'QrScanner')[0].props.onScanned(`bitcoin:${TONI}?amount=1`));
    expect(hosts(r, 'AddressChunks')[0].props.address).toBe(TONI);
  });

  it('checks a Private Address as soon as it is in, and again when Private Address is chosen back', async () => {
    const r = await mountAdd({ address: TONI });
    expect(mockAsked.map((a) => [a.network, a.address])).toEqual([['bitcoin', TONI]]);
    expect(texts(r)).toContain('Checking this address…');
    expect(button(r).props.disabled).toBe(true);
    await name(r, 'Toni');
    // Checking never holds Save.
    expect(button(r).props.disabled).toBe(false);
    await act(async () => segments(r).props.onChange('exchange'));
    expect(texts(r)).not.toContain('Checking this address…');
    await act(async () => segments(r).props.onChange('private'));
    await settle();
    expect(mockAsked).toHaveLength(2);
  });

  it('never looks up an Exchange Address', async () => {
    const r = await mountAdd();
    await act(async () => segments(r).props.onChange('exchange'));
    mockClipboard.read = async () => KRAKEN;
    await press(control(r, 'Paste from the clipboard'));
    expect(hosts(r, 'AddressChunks')[0].props.address).toBe(KRAKEN);
    expect(mockAsked).toEqual([]);
    expect(texts(r)).not.toContain('Checking this address…');
  });

  it('never looks up an address the book holds as an Exchange Address, whatever is picked on the page', async () => {
    await save(KRAKEN, 'Kraken', 'exchange', 1);
    // Pasted after the book's +, with Private Address still preselected.
    const r = await mountAdd();
    mockClipboard.read = async () => KRAKEN.toUpperCase();
    await press(control(r, 'Paste from the clipboard'));
    expect(hosts(r, 'AddressChunks')[0].props.address).toBe(KRAKEN);
    expect(segments(r).props.value).toBe('private');
    expect(mockAsked).toEqual([]);
    expect(texts(r)).not.toContain('Checking this address…');
    // Handed over by Send too.
    await mountAdd({ address: KRAKEN });
    expect(mockAsked).toEqual([]);
    // Save still refuses it, title and OK, and the saved entry is untouched.
    await name(r, 'Other');
    await press(button(r));
    expect(openDialogs(r).map((d) => d.props.title)).toEqual(['This address is already saved']);
    expect(await loadAddressBook()).toEqual([expect.objectContaining({ category: 'exchange', name: 'Kraken' })]);
    expect((await loadAddressBook())[0].spentSeenAt).toBeUndefined();
  });

  it('an address the book holds as a spent Private Address shows the notice at once and asks nothing', async () => {
    await save(ROBIN, 'Robin', 'private', 1, 5);
    const r = await mountAdd({ address: ROBIN });
    expect(mockAsked).toEqual([]);
    expect(texts(r)).toContain('This address has spent coins before. Ask for a new one.');
  });

  it('asks nothing while the book cannot be read', async () => {
    disk.set('talia.addressBook.v1', 'not a sealed book');
    await mountAdd({ address: TONI });
    expect(mockAsked).toEqual([]);
  });

  it('shows the gold notice for a spent Private Address, saves anyway, and keeps what it found', async () => {
    const r = await mountAdd({ address: ROBIN });
    await answer(SPENT);
    expect(texts(r)).toContain('This address has spent coins before. Ask for a new one.');
    await name(r, 'Robin');
    expect(button(r).props.disabled).toBe(false);
    await press(button(r));
    expect(nav.goBack).toHaveBeenCalledTimes(1);
    expect((await loadAddressBook())[0]).toMatchObject({ address: ROBIN, category: 'private', spentSeenAt: expect.any(Number) });
  });

  it('keeps what the check found when the address is saved as an Exchange Address after all', async () => {
    const r = await mountAdd({ address: ROBIN });
    await answer(SPENT);
    await name(r, 'Robin');
    await act(async () => segments(r).props.onChange('exchange'));
    expect(texts(r)).not.toContain('This address has spent coins before. Ask for a new one.');
    await press(button(r));
    expect((await loadAddressBook())[0]).toMatchObject({ category: 'exchange', spentSeenAt: expect.any(Number) });
  });
});
