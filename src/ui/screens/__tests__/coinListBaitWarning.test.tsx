/**
 * The coin list's warning about bait from a stranger is true of every coin it
 * sits on, on every kind of vault, and shows on no coin of the vault's own
 * while the history is on its way (decided 2026-10-31 after a phone test: a
 * 755 sat change coin from the vault's own payment carried it). The screen is
 * mounted for real; the page components are plain hosts.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { Utxo, WalletTx } from '../../../bitcoin/engine/types';

const coin = (txid: string, valueSats: number, keychain: Utxo['keychain']): Utxo => ({ txid, vout: 0, valueSats, keychain });
const tx = (txid: string, sent: number, received: number): WalletTx => ({
  txid,
  sent,
  received,
  netAmount: received - sent,
  confirmed: true,
});

const COINS = [
  coin('ownpayment', 755, 'internal'), // what came back from a payment
  coin('stranger', 600, 'external'), // a stranger paid a receive address
  coin('strangerchange', 700, 'internal'), // a stranger paid a used change address
  coin('deposit', 90_000, 'external'),
];
const HISTORY = [tx('ownpayment', 50_000, 755), tx('stranger', 0, 600), tx('strangerchange', 0, 700), tx('deposit', 0, 90_000)];

const mockWorld = {
  wallet: { id: 'w1', descriptor: 'wpkh(x)', frozenUtxos: [] as string[] },
  olderBlocks: null as number | null,
  cachedCoins: null as { utxos: Utxo[] } | null,
  cachedTxs: null as WalletTx[] | null,
  sync: async (): Promise<void> => undefined,
  listTransactions: async (): Promise<WalletTx[]> => [],
};
const mockEngine = {
  listUtxos: async () => COINS,
  listTransactions: jest.fn(async () => mockWorld.listTransactions()),
  getTipHeight: () => 900_000,
};
const mockSyncWallet = jest.fn(async () => {
  await mockWorld.sync();
  return mockEngine;
});

jest.mock('react-native', () => {
  const R = require('react');
  return {
    ...require('../../__tests__/rnStub').reactNative,
    ActivityIndicator: 'ActivityIndicator',
    RefreshControl: 'RefreshControl',
    TouchableOpacity: 'TouchableOpacity',
    FlatList: (p: { data: unknown[]; renderItem: (i: { item: unknown }) => React.ReactNode }) =>
      R.createElement(
        'FlatList',
        null,
        p.data.map((item, i) => R.createElement('Row', { key: i }, p.renderItem({ item }))),
      ),
  };
});
jest.mock('../../components', () => ({
  AppDialog: () => null,
  FadeEdge: () => null,
  FADE_EDGE_H: 28,
  Gloss: () => null,
  cardGlow: () => 0,
}));
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../../wallet', () => ({
  ...require('../../../wallet/baitWarning'),
  useWallets: () => ({
    getWallet: () => mockWorld.wallet,
    syncWallet: mockSyncWallet,
    updateWallet: async () => undefined,
    settings: { unit: 'sats' },
  }),
  formatAmount: (sats: number) => `${sats} sats`,
  outpointKey: (u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`,
  utxoExpiries: () => [],
  coinTimelockChip: () => '',
  loadUtxoCache: async () => mockWorld.cachedCoins,
  saveUtxoCache: async () => undefined,
  agedTipHeight: () => undefined,
  loadTxCache: async () => mockWorld.cachedTxs,
}));
jest.mock('../../hooks/useProviderFingerprints', () => ({
  useProviderFingerprints: () => ({ providerFps: new Set<string>() }),
}));
jest.mock('../refreshGate', () => ({ refreshOffered: () => false }));
jest.mock('../../../bitcoin/descriptor', () => ({ minOlderBlocks: () => mockWorld.olderBlocks }));
jest.mock('../../../config', () => ({ SIGNING_ENABLED: true }));

import { UtxosScreen } from '../UtxosScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const settle = () =>
  act(async () => {
    for (let i = 0; i < 12; i += 1) await new Promise((done) => setImmediate(done));
  });

async function mount(): Promise<TestRenderer.ReactTestRenderer> {
  let page!: TestRenderer.ReactTestRenderer;
  const props = { route: { params: { walletId: 'w1' } }, navigation: { navigate: () => undefined } };
  await act(async () => {
    page = TestRenderer.create(<UtxosScreen {...(props as unknown as React.ComponentProps<typeof UtxosScreen>)} />);
  });
  await settle();
  return page;
}

const textOf = (row: TestRenderer.ReactTestInstance): string =>
  row
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => [n.props.children].flat().join(''))
    .join(' ');

/** The amount of every row showing the warning, and how many rows there are. */
function warnings(page: TestRenderer.ReactTestRenderer): { rows: number; warned: string[] } {
  const rows = page.root.findAll((n) => (n.type as unknown) === 'Row');
  const warned = rows
    .map(textOf)
    .filter((text) => text.includes('could be bait from a stranger'))
    .map((text) => text.match(/\d+ sats/)?.[0] ?? '?');
  return { rows: rows.length, warned };
}

beforeEach(() => {
  mockWorld.wallet = { id: 'w1', descriptor: 'wpkh(x)', frozenUtxos: [] };
  mockWorld.olderBlocks = null;
  mockWorld.cachedCoins = null;
  mockWorld.cachedTxs = null;
  mockWorld.sync = async () => undefined;
  mockWorld.listTransactions = async () => HISTORY;
  jest.clearAllMocks();
});

describe('the warning about bait from a stranger', () => {
  it.each([
    ['a vault with no timelock', null],
    ['a timelocked vault', 52_596],
  ])('leaves the vault’s own small coin alone on %s, change address or not', async (_shape, olderBlocks) => {
    mockWorld.olderBlocks = olderBlocks;
    const page = await mount();
    // Not the 755 sat coin of its own payment, and a stranger's payment to a
    // change address stays warned about: the address proves nothing.
    expect(warnings(page)).toEqual({ rows: 4, warned: ['600 sats', '700 sats'] });
  });

  it('shows on no coin until the history has answered, then on the right ones', async () => {
    let answer!: (txs: WalletTx[]) => void;
    mockWorld.listTransactions = () => new Promise((resolve) => (answer = resolve));
    const page = await mount();
    expect(warnings(page)).toEqual({ rows: 4, warned: [] });
    await act(async () => answer(HISTORY));
    await settle();
    expect(warnings(page).warned).toEqual(['600 sats', '700 sats']);
  });

  it('stands on every small coin when the history cannot be read', async () => {
    mockWorld.listTransactions = async () => {
      throw new Error('no answer');
    };
    const page = await mount();
    expect(warnings(page)).toEqual({ rows: 4, warned: ['755 sats', '600 sats', '700 sats'] });
  });

  it('reads the saved history first, and a sync that fails takes nothing back', async () => {
    mockWorld.cachedCoins = { utxos: COINS };
    mockWorld.cachedTxs = HISTORY;
    mockWorld.sync = async () => {
      throw new Error('no server');
    };
    const page = await mount();
    expect(warnings(page)).toEqual({ rows: 4, warned: ['600 sats', '700 sats'] });
  });

  it('stands when a sync fails with saved coins and no saved history', async () => {
    mockWorld.cachedCoins = { utxos: COINS };
    mockWorld.sync = async () => {
      throw new Error('no server');
    };
    const page = await mount();
    expect(warnings(page)).toEqual({ rows: 4, warned: ['755 sats', '600 sats', '700 sats'] });
  });

  it('is gone from a frozen coin, as it always was', async () => {
    mockWorld.wallet.frozenUtxos = ['stranger:0'];
    const page = await mount();
    expect(warnings(page).warned).toEqual(['700 sats']);
  });
});
