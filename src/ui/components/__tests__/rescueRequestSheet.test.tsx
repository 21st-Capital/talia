/**
 * The details sheet of a filed rescue request (decided 2026-11-03): title,
 * the rows (Vault, Sending to in groups of four with Copy, Amount, Network
 * fee, Leaves the vault, Coins, Asked on), one line when the figures cannot
 * be shown, and Done. Mounted with the real theme, FactRow and the address
 * groups; the sheet's shell, the card and the button are plain hosts.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockCopy = jest.fn();

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  ActivityIndicator: 'ActivityIndicator',
  ScrollView: 'ScrollView',
  TouchableOpacity: 'TouchableOpacity',
}));
jest.mock('../AppModal', () => ({ AppModal: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('../DraggableSheet', () => {
  const R = require('react');
  return {
    DraggableSheet: ({ children }: { children: React.ReactNode }) => R.createElement('DraggableSheet', null, children),
  };
});
jest.mock('../Card', () => {
  const R = require('react');
  return { Card: ({ children }: { children: React.ReactNode }) => R.createElement('Card', null, children) };
});
jest.mock('../Button', () => {
  const R = require('react');
  return { Button: (p: { title: string; onPress: () => void }) => R.createElement('Button', p) };
});
jest.mock('../CopiedFlash', () => {
  const R = require('react');
  return { CopiedFlash: (p: { visible: boolean; label: string }) => R.createElement('CopiedFlash', p) };
});
jest.mock('../TablerIcons', () => ({ CopyIcon: 'CopyIcon' }));
jest.mock('../../../platform/clipboard', () => ({ copyToClipboard: (t: string) => mockCopy(t) }));

import { RescueRequestSheet } from '../RescueRequestSheet';
import type { RescueRequestFacts } from '../../../wallet/rescueRequestFacts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const DEST = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const FIGURES: RescueRequestFacts = {
  kind: 'figures',
  destination: DEST,
  arrivesSats: 100_200,
  feeSats: 800,
  leavesSats: 101_000,
  coins: 2,
};

function mount(facts: RescueRequestFacts | null, extra: { masked?: boolean; destination?: string | null } = {}) {
  const onClose = jest.fn();
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(
      <RescueRequestSheet
        visible
        title="Waiting for 21st Capital…"
        vaultName="Real test"
        destination={extra.destination === undefined ? DEST : extra.destination}
        askedOn="3 Nov, 20:30"
        facts={facts}
        unit="btc"
        masked={extra.masked ?? false}
        onClose={onClose}
      />,
    );
  });
  return { r, onClose };
}

/** Every string drawn, in order. */
const texts = (r: TestRenderer.ReactTestRenderer): string[] =>
  r.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => [n.props.children].flat().join(''))
    .filter((t) => t !== '');

beforeEach(() => {
  jest.useFakeTimers();
  mockCopy.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('RescueRequestSheet', () => {
  it('shows the title, the rows in order and Done', () => {
    const { r, onClose } = mount(FIGURES);
    expect(texts(r)).toEqual([
      'Waiting for 21st Capital…',
      'Vault',
      'Real test',
      'Sending to',
      'bc1q',
      'w508',
      'd6qe',
      'jxtd',
      'g4y5',
      'r3za',
      'rvar',
      'y0c5',
      'xw7k',
      'v8f3',
      't4',
      'Amount',
      '0.001002 BTC',
      '100,200 sats',
      'Network fee',
      '800 sats',
      'Leaves the vault',
      '0.00101 BTC',
      '101,000 sats',
      'Coins',
      '2',
      'Asked on',
      '3 Nov, 20:30',
    ]);
    const done = r.root.findAll((n) => (n.type as unknown) === 'Button');
    expect(done.map((b) => b.props.title)).toEqual(['Done']);
    act(() => done[0].props.onPress());
    expect(onClose).toHaveBeenCalled();
  });

  it('copies the recorded address with the app’s flash, which then clears', () => {
    const { r } = mount(FIGURES);
    const copy = r.root.findAll((n) => (n.type as unknown) === 'TouchableOpacity' && n.props.accessibilityLabel === 'Copy address')[0];
    act(() => copy.props.onPress());
    expect(mockCopy).toHaveBeenCalledWith(DEST);
    const flash = () => r.root.findAll((n) => (n.type as unknown) === 'CopiedFlash')[0];
    expect(flash().props).toMatchObject({ visible: true, label: 'Address copied' });
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(flash().props.visible).toBe(false);
  });

  it('a tap on the sheet itself is no tap on the backdrop', () => {
    const { r } = mount(FIGURES);
    const backdrop = r.root.findAll((n) => (n.type as unknown) === 'TouchableOpacity' && n.props.accessibilityLabel === 'Close')[0];
    // The backdrop is a layer of its own, holding nothing.
    expect(backdrop.children).toEqual([]);
  });

  it('shows a line instead of figures, and no amount rows', () => {
    const { r } = mount({ kind: 'unchecked', destination: DEST, reason: 'no-transaction' });
    const t = texts(r);
    expect(t).not.toContain('Amount');
    expect(t).not.toContain('Network fee');
    expect(t[t.length - 1]).toBe('Amount and fee not shown: there is no transaction to check.');
  });

  it('warns instead of showing figures when the transaction pays anyone else', () => {
    const { r } = mount({ kind: 'pays-elsewhere', destination: DEST, others: [1] });
    const t = texts(r);
    expect(t).not.toContain('Amount');
    expect(t[t.length - 1]).toBe('This transaction pays an address other than the one you chose.');
  });

  it('draws no address when the phone kept none', () => {
    const { r } = mount({ kind: 'unchecked', destination: null, reason: 'no-record' }, { destination: null });
    expect(texts(r)).not.toContain('Sending to');
    expect(r.root.findAll((n) => n.props.accessibilityLabel === 'Copy address')).toEqual([]);
  });

  it('hides every figure while balances are hidden, the address stays', () => {
    const { r } = mount(FIGURES, { masked: true });
    const t = texts(r);
    expect(t).toContain('bc1q');
    expect(t).not.toContain('0.001002 BTC');
    expect(t).not.toContain('800 sats');
    expect(t.filter((x) => x === '••••')).toHaveLength(3);
  });

  it('shows a spinner where the figures go while they are read', () => {
    const { r } = mount(null);
    expect(r.root.findAll((n) => (n.type as unknown) === 'ActivityIndicator')).toHaveLength(1);
    expect(texts(r)).toContain('Asked on');
  });
});
