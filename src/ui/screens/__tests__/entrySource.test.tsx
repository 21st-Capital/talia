/**
 * The source list, mounted (decided 2026-10-22): the exchanges in the list's
 * order, then Peer to peer and Other; a search that keeps those two; every
 * row's name free to wrap at its spaces, so a larger text size never cuts
 * it; "No source" only when there is one to take away.
 *
 * The screen's own wiring and the pure source list are real; the page
 * components are plain hosts that keep their props.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
}));
jest.mock('../../components', () => {
  const R = require('react');
  const host =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      R.createElement(name, p, children);
  return {
    Screen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) =>
      R.createElement('Screen', null, children, R.createElement('Footer', null, footer)),
    AppDialog: host('AppDialog'),
    Button: (p: { title: string; onPress: () => void }) => R.createElement('Button', { title: p.title, onPress: p.onPress }),
    DeviceListRow: host('DeviceListRow'),
    TextField: host('TextField'),
  };
});
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: (_t, key) => ({ name: String(key) }) }) };
});
jest.mock('../../../wallet', () => jest.requireActual('../../../wallet/entrySources'));

import { EntrySourceScreen } from '../EntrySourceScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];
afterEach(async () => {
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount();
  });
});

async function mount(params: { source?: string; sourceName?: string } = {}) {
  const popTo = jest.fn();
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <EntrySourceScreen route={{ params: { walletId: 'w', entryId: 'e', ...params } } as any} navigation={{ popTo } as any} />,
    );
  });
  mounted.push(r);
  return { r, popTo };
}

const rows = (r: Renderer) => r.root.findAll((n) => (n.type as unknown) === 'DeviceListRow');
const names = (r: Renderer) => rows(r).map((n) => n.props.name as string);
const buttons = (r: Renderer) => r.root.findAll((n) => (n.type as unknown) === 'Button').map((n) => n.props.title as string);

describe('the source list', () => {
  it('lists the twenty exchanges in order, then Peer to peer and Other, every name free to wrap', async () => {
    const { r } = await mount();
    const n = names(r);
    expect(n).toHaveLength(22);
    expect(n.slice(0, 3)).toEqual(['Binance', 'Coinbase', 'Kraken']);
    expect(n.slice(-2)).toEqual(['Peer to peer', 'Other']);
    // Never cut at a larger text size ("Peer to…" on an iPhone SE).
    for (const row of rows(r)) expect(row.props.wrap).toBe(true);
  });

  it('a search keeps Peer to peer and Other', async () => {
    const { r } = await mount();
    const field = r.root.find((n) => (n.type as unknown) === 'TextField');
    await act(async () => field.props.onChangeText('gate io'));
    expect(names(r)).toEqual(['Gate.io', 'Peer to peer', 'Other']);
    await act(async () => field.props.onChangeText('Revolut'));
    expect(names(r)).toEqual(['Peer to peer', 'Other']);
  });

  it('a pick goes back to the form', async () => {
    const { r, popTo } = await mount();
    const kraken = rows(r).find((n) => n.props.name === 'Kraken');
    await act(async () => kraken?.props.onPress());
    expect(popTo).toHaveBeenCalledWith(
      'ManualEntry',
      expect.objectContaining({ picked: expect.objectContaining({ source: 'kraken', sourceName: 'Kraken' }) }),
      { merge: true },
    );
  });

  it('offers "No source" only when there is a source, and marks the current one', async () => {
    const none = await mount();
    expect(buttons(none.r)).toEqual([]);
    const chosen = await mount({ source: 'other', sourceName: 'Bisq' });
    expect(buttons(chosen.r)).toEqual(['No source']);
    expect(rows(chosen.r).find((n) => n.props.name === 'Other')?.props.sub).toBe('Chosen: Bisq');
  });
});
