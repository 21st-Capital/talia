/**
 * The address book's check as a screen runs it (decided 2026-11-05):
 * nothing for an Exchange Address or no address, the quiet line while the
 * server is asked, then what it found; never an earlier address's answer;
 * Try again asks once more; nothing is asked before the settings are read,
 * and a change of an unrelated setting asks nothing again.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { useAddressBookCheck } from '../useAddressBookCheck';
import type { AddressBookCheck, AddressBookCheckInput } from '../useAddressBookCheck';

type Settled = (a: { state: string; spentSeenAt?: number }) => void;
const mockAsked: Array<{ req: { address: string; network?: string; settings: unknown }; settle: Settled }> = [];
jest.mock('react-native-keychain', () => require('../../../testing/memoryKeychain'));
jest.mock('@react-native-async-storage/async-storage', () => require('../../../testing/memoryAsyncStorage'));
jest.mock('../../../wallet/engineProvider', () => ({ lookUpActivity: jest.fn() }));
jest.mock('../../../wallet/addressBookLookup', () => ({
  ...jest.requireActual('../../../wallet/addressBookLookup'),
  checkBookAddress: (req: { address: string; network?: string; settings: unknown }) =>
    new Promise((settle) => mockAsked.push({ req, settle: settle as Settled })),
}));
const mockWallets = { settings: { electrumUrls: {} as Record<string, string>, hideBalances: false }, settingsLoaded: true };
jest.mock('../../../wallet/WalletProvider', () => ({ useWallets: () => mockWallets }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const OTHER = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';

let seen: AddressBookCheck[] = [];
function Probe(props: AddressBookCheckInput): null {
  seen.push(useAddressBookCheck(props));
  return null;
}
const last = () => seen[seen.length - 1];

function mount(props: AddressBookCheckInput): TestRenderer.ReactTestRenderer {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<Probe {...props} />);
  });
  return r;
}

beforeEach(() => {
  seen = [];
  mockAsked.length = 0;
  mockWallets.settings = { electrumUrls: {}, hideBalances: false };
  mockWallets.settingsLoaded = true;
});

describe('useAddressBookCheck', () => {
  it('an Exchange Address, no address, one not saved, or one the vault cannot pay: nothing, and nothing asked', () => {
    for (const props of [
      { address: BTC, category: 'exchange' as const },
      { address: null, category: 'private' as const },
      { address: BTC, category: null },
      { address: BTC, category: 'private' as const, network: 'testnet' as const },
      { address: 'not an address', category: 'private' as const },
    ]) {
      const r = mount(props);
      expect(seen.every((s) => s.state === 'idle')).toBe(true);
      act(() => r.unmount());
    }
    expect(mockAsked).toEqual([]);
  });

  it('a Private Address: checking, then what was found', async () => {
    mount({ address: BTC.toUpperCase(), category: 'private', network: 'bitcoin' });
    expect(seen[0].state).toBe('checking');
    expect(mockAsked.map((a) => [a.req.address, a.req.network])).toEqual([[BTC, 'bitcoin']]);
    await act(async () => mockAsked[0].settle({ state: 'spent', spentSeenAt: 42 }));
    expect(last()).toMatchObject({ state: 'spent', spentSeenAt: 42 });
  });

  it('a known spent mark shows at once, nothing asked', () => {
    mount({ address: BTC, category: 'private', spentSeenAt: 5 });
    expect(seen.every((s) => s.state === 'spent' && s.spentSeenAt === 5)).toBe(true);
    expect(mockAsked).toEqual([]);
  });

  it("never an earlier address's answer", async () => {
    const r = mount({ address: BTC, category: 'private' });
    act(() => r.update(<Probe address={OTHER} category="private" />));
    expect(last().state).toBe('checking');
    await act(async () => mockAsked[0].settle({ state: 'spent', spentSeenAt: 1 }));
    expect(last().state).toBe('checking');
    await act(async () => mockAsked[1].settle({ state: 'notFound' }));
    expect(last().state).toBe('notFound');
  });

  it('switching back to Private Address asks again', async () => {
    const r = mount({ address: BTC, category: 'private' });
    await act(async () => mockAsked[0].settle({ state: 'notFound' }));
    act(() => r.update(<Probe address={BTC} category="exchange" />));
    expect(last().state).toBe('idle');
    act(() => r.update(<Probe address={BTC} category="private" />));
    expect(last().state).toBe('checking');
    expect(mockAsked).toHaveLength(2);
  });

  it('Try again asks once more after a check that could not be made', async () => {
    mount({ address: BTC, category: 'private' });
    await act(async () => mockAsked[0].settle({ state: 'unknown' }));
    expect(last().state).toBe('unknown');
    act(() => last().retry());
    expect(last().state).toBe('checking');
    await act(async () => mockAsked[1].settle({ state: 'notFound' }));
    expect(last().state).toBe('notFound');
  });

  it('before the settings are read nothing is asked and it shows as pending; once they are, it asks by itself', () => {
    mockWallets.settingsLoaded = false;
    const r = mount({ address: BTC, category: 'private' });
    // The quiet "Checking this address…", never "Could not check" with a Try again that cannot ask.
    expect(seen.every((s) => s.state === 'checking')).toBe(true);
    expect(mockAsked).toEqual([]);
    mockWallets.settingsLoaded = true;
    act(() => r.update(<Probe address={BTC} category="private" />));
    expect(last().state).toBe('checking');
    expect(mockAsked).toHaveLength(1);
  });

  it('a new Bitcoin server asks again; an unrelated setting does not', () => {
    const r = mount({ address: BTC, category: 'private' });
    mockWallets.settings = { ...mockWallets.settings, hideBalances: true };
    act(() => r.update(<Probe address={BTC} category="private" />));
    expect(mockAsked).toHaveLength(1);
    mockWallets.settings = { ...mockWallets.settings, electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } };
    act(() => r.update(<Probe address={BTC} category="private" />));
    expect(mockAsked).toHaveLength(2);
    expect(mockAsked[1].req.settings).toMatchObject({ electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } });
  });
});
