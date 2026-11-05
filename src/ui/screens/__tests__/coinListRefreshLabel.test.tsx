/**
 * The coin list's Refresh pill holds its label on one line clear of its
 * rounded ends, whichever label it carries and however long the amount
 * (decided 2026-10-31 after a phone test: "Refresh 2 unfrozen coins ·
 * 0.0045192 BTC" wrapped, with "Refresh" against the edge and "BTC" alone on a
 * second line). The screen is mounted for real, with the real theme and
 * FitText; the other page components are plain hosts. Whether iOS draws it on
 * one line is its own to prove: this pins what is asked of it.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { Utxo } from '../../../bitcoin/engine/types';
import { theme } from '../../theme';

const coin = (txid: string, valueSats: number): Utxo => ({ txid, vout: 0, valueSats, keychain: 'external' });

const mockWorld = {
  wallet: { id: 'w1', descriptor: 'wsh(x)', frozenUtxos: [] as string[] },
  coins: [] as Utxo[],
};
const mockEngine = {
  listUtxos: async () => mockWorld.coins,
  listTransactions: async () => [],
  getTipHeight: () => 900_000,
};
const mockSyncWallet = async () => mockEngine;

jest.mock('react-native', () => {
  const R = require('react');
  return {
    ...require('../../__tests__/rnStub').reactNative,
    ActivityIndicator: 'ActivityIndicator',
    RefreshControl: 'RefreshControl',
    TouchableOpacity: 'TouchableOpacity',
    FlatList: (p: {
      data: unknown[];
      ListHeaderComponent: React.ReactNode;
      renderItem: (i: { item: unknown }) => React.ReactNode;
    }) =>
      R.createElement(
        'FlatList',
        null,
        p.ListHeaderComponent,
        p.data.map((item, i) => R.createElement('Row', { key: i }, p.renderItem({ item }))),
      ),
  };
});
jest.mock('../../components', () => ({
  AppDialog: () => null,
  FadeEdge: () => null,
  FADE_EDGE_H: 28,
  FitText: require('../../components/FitText').FitText,
  Gloss: () => null,
  cardGlow: () => 0,
}));
jest.mock('../../../wallet', () => ({
  ...require('../../../wallet/baitWarning'),
  useWallets: () => ({
    getWallet: () => mockWorld.wallet,
    syncWallet: mockSyncWallet,
    updateWallet: async () => undefined,
    settings: { unit: 'btc' },
  }),
  formatAmount: require('../../../wallet/format').formatAmount,
  outpointKey: (u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`,
  utxoExpiries: () => [],
  coinTimelockChip: () => '',
  loadUtxoCache: async () => null,
  saveUtxoCache: async () => undefined,
  agedTipHeight: () => undefined,
  loadTxCache: async () => null,
}));
jest.mock('../../hooks/useProviderFingerprints', () => ({
  useProviderFingerprints: () => ({ providerFps: new Set<string>() }),
}));
jest.mock('../refreshGate', () => ({ refreshOffered: () => true }));
jest.mock('../../../bitcoin/descriptor', () => ({ minOlderBlocks: () => 52_596 }));
jest.mock('../../../config', () => ({ SIGNING_ENABLED: true }));

import { UtxosScreen } from '../UtxosScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

async function mount(): Promise<TestRenderer.ReactTestRenderer> {
  let page!: TestRenderer.ReactTestRenderer;
  const props = { route: { params: { walletId: 'w1' } }, navigation: { navigate: () => undefined } };
  await act(async () => {
    page = TestRenderer.create(<UtxosScreen {...(props as unknown as React.ComponentProps<typeof UtxosScreen>)} />);
  });
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await new Promise((done) => setImmediate(done));
  });
  return page;
}

/** Taps the coin rows as a client would. */
async function choose(page: TestRenderer.ReactTestRenderer, rows: number[]): Promise<void> {
  const all = page.root.findAll((n) => (n.type as unknown) === 'Row');
  for (const row of rows) {
    const touch = all[row].findAll((n) => (n.type as unknown) === 'TouchableOpacity')[0];
    await act(async () => touch.props.onPress());
  }
}

/** The one text on the page that shrinks to fit, and the pill it sits in. */
function pillOf(page: TestRenderer.ReactTestRenderer) {
  const label = page.root.findAll((n) => (n.type as unknown) === 'Text' && !!n.props.adjustsFontSizeToFit);
  expect(label).toHaveLength(1);
  let pill = label[0];
  while ((pill.type as unknown) !== 'TouchableOpacity') pill = pill.parent as TestRenderer.ReactTestInstance;
  return { label: label[0], pill };
}

const textOf = (label: TestRenderer.ReactTestInstance): string => [label.props.children].flat().join('');

const SMALL = [coin('a', 200_000), coin('b', 251_920), coin('c', 100_000)];
const LARGE = [coin('a', 1_234_567_891), coin('b', 987_654_321), ...Array.from({ length: 10 }, (_, i) => coin(`c${i}`, 1_111_111))];

beforeEach(() => {
  mockWorld.wallet = { id: 'w1', descriptor: 'wsh(x)', frozenUtxos: [] };
  mockWorld.coins = SMALL;
});

describe('the Refresh pill', () => {
  it.each([
    ['every coin', SMALL, [], [], 'Refresh all coins · 0.0055192 BTC'],
    ['one coin frozen', SMALL, ['c:0'], [], 'Refresh 2 unfrozen coins · 0.0045192 BTC'],
    ['one coin chosen', SMALL, [], [0], 'Refresh 1 coin · 0.002 BTC'],
    ['two coins chosen', SMALL, [], [0, 1], 'Refresh 2 coins · 0.0045192 BTC'],
    ['a long count and a long amount', LARGE, ['b:0'], [], 'Refresh 11 unfrozen coins · 12.45679001 BTC'],
  ])('keeps one fitted line with %s', async (_shape, coins, frozen, rows, words) => {
    mockWorld.coins = coins;
    mockWorld.wallet.frozenUtxos = frozen;
    const page = await mount();
    await choose(page, rows);
    const { label } = pillOf(page);
    expect(textOf(label)).toBe(words);
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.style.lineHeight).toBeUndefined();
    expect(label.props.style.textAlign).toBe('center');
  });

  it('keeps its label clear of the rounded ends', async () => {
    const { pill } = pillOf(await mount());
    expect(pill.props.style.borderRadius).toBe(theme.radius.pill);
    expect(pill.props.style.paddingHorizontal).toBeGreaterThanOrEqual(pill.props.style.minHeight / 2);
  });

  it('holds its height, so a shorter line never moves the coins below', async () => {
    const { pill } = pillOf(await mount());
    expect(pill.props.style.minHeight).toBe(theme.typography.heading.lineHeight + 2 * pill.props.style.paddingVertical);
    expect(pill.props.style.justifyContent).toBe('center');
  });
});
