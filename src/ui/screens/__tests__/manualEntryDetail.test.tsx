/**
 * One portfolio entry's page, mounted (decided 2026-10-22, a client's
 * request: open each entry and see every detail, as on a transaction).
 *
 * The page lists every fact the entry holds: kind, day, amount, the price per
 * bitcoin AND the total whichever one was typed, the fee, the source and
 * where the entry came from. The owner gets Edit; a member of a shared
 * portfolio reads the same page with no Edit (`isSharedViewer`, the one
 * rule).
 *
 * The screen's own wiring and the pure entry modules are real; the stored
 * entries, the wallet list, the conversion feed and the page components
 * (plain hosts) are replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { ManualEntry } from '../../../wallet/manualLedger';

const mockEntries: { value: ManualEntry[] } = { value: [] };
const mockState: { wallets: Array<Record<string, unknown>>; settings: Record<string, unknown> } = {
  wallets: [],
  settings: {},
};
const mockConvert = jest.fn(async (): Promise<number | null> => null);
/** The phone's text size, as iOS reports it. */
const mockText = { fontScale: 1 };

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  TouchableOpacity: 'TouchableOpacity',
  useWindowDimensions: () => ({ width: 375, height: 667, scale: 2, fontScale: mockText.fontScale }),
}));
jest.mock('@react-navigation/native', () => {
  const R = require('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => R.useEffect(effect, [effect]) };
});
jest.mock('../../components', () => {
  const R = require('react');
  const host =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      R.createElement(name, p, children);
  return {
    Screen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) =>
      R.createElement('Screen', null, children, R.createElement('Footer', null, footer)),
    Card: host('Card'),
    FitText: ({ children }: { children: React.ReactNode }) => R.createElement('Text', null, children),
    HeaderBackButton: () => R.createElement('HeaderBackButton'),
    Button: (p: { title: string; onPress: () => void }) => R.createElement('Button', { title: p.title, onPress: p.onPress }),
    factsStacked: jest.requireActual('../../components/ledgerRowLayout').factsStacked,
    FACT_LABEL_SHARE: jest.requireActual('../../components/ledgerRowLayout').FACT_LABEL_SHARE,
  };
});
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  // Each style is named after its key, so a test can see which ones apply.
  return { theme: deep, themedStyles: () => new Proxy({}, { get: (_t, key) => ({ name: String(key) }) }) };
});
jest.mock('../../../wallet', () => ({
  ...jest.requireActual('../../../wallet/entryDetails'),
  ...jest.requireActual('../../../wallet/entrySources'),
  formatAmount: jest.requireActual('../../../wallet/format').formatAmount,
  isSharedViewer: jest.requireActual('../../../wallet/sharedAccess').isSharedViewer,
  useWallets: () => ({
    wallets: mockState.wallets,
    settings: mockState.settings,
    getWallet: (id: string) => mockState.wallets.find((w) => w.id === id),
  }),
  loadManualEntries: async () => mockEntries.value,
  peekManualEntries: () => undefined,
  convertFiatOnDate: () => mockConvert(),
}));

import { ManualEntryDetailScreen } from '../ManualEntryDetailScreen';

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

const OWNER = { id: 'w_port', label: 'Mine', manual: true };
const MEMBER = {
  id: 'w_port',
  label: 'Family',
  manual: true,
  sharedPortfolio: { shareId: 's1', role: 'member', joinedAt: 1 },
};
const SAVINGS = { id: 'w_mgabcd_9z', label: 'Savings' };

const DAY = new Date(2026, 2, 12, 12).getTime();
/** 0.123456 BTC at a typed 79,500 plus a 10 fee: 9,814.75 + 10. */
const PRICE_TYPED: ManualEntry = {
  id: 'e-price',
  kind: 'buy',
  amountSats: 12_345_600,
  date: DAY,
  createdAt: 1,
  fiatAmount: 9_824.75,
  fiatCurrency: 'USD',
  feeAmount: 10,
  pricePerBtc: 79_500,
  source: 'other',
  sourceName: 'Bitcoin ATM',
  note: 'Birthday',
};

async function mount(entries: ManualEntry[], entryId: string, wallet: Record<string, unknown> = OWNER, settings: Record<string, unknown> = {}) {
  mockEntries.value = entries;
  mockState.wallets = [wallet, SAVINGS];
  mockState.settings = { fiat: 'USD', unit: 'btc', ...settings };
  const navigate = jest.fn();
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(
      <ManualEntryDetailScreen
        {...({ route: { params: { walletId: 'w_port', entryId } }, navigation: { navigate } } as unknown as React.ComponentProps<typeof ManualEntryDetailScreen>)}
      />,
    );
  });
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
  mounted.push(r);
  return { r, navigate };
}

/** Every string the page shows, in order. */
function words(r: Renderer): string[] {
  return r.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => [n.props.children].flat().join(''));
}

/** The Details card as label → value. */
function facts(r: Renderer): Record<string, string> {
  const card = r.root.find((n) => (n.type as unknown) === 'Card');
  const texts = card.findAll((n) => (n.type as unknown) === 'Text').map((n) => [n.props.children].flat().join(''));
  const out: Record<string, string> = {};
  // The band's "Details", then label/value pairs, then the note's pair.
  for (let i = 1; i + 1 < texts.length; i += 2) out[texts[i]] = texts[i + 1];
  return out;
}

const editButton = (r: Renderer) => r.root.findAll((n) => (n.type as unknown) === 'Button' && n.props.title === 'Edit');

describe('an entry’s page', () => {
  it('lists every fact, the price as typed and the total it made', async () => {
    const { r } = await mount([PRICE_TYPED], 'e-price');
    expect(words(r).slice(0, 4)).toEqual(['Bought', '12 March 2026', '+0.123456 BTC', '$9,824.75']);
    expect(facts(r)).toEqual({
      Type: 'Bought',
      Date: '12 March 2026',
      Amount: '0.123456 BTC',
      'Price per bitcoin': '$79,500.00',
      Fee: '$10.00',
      'Total paid': '$9,824.75',
      Source: 'Bitcoin ATM',
      Added: 'Typed in by hand',
      Note: 'Birthday',
    });
  });

  it('works the price out when the total was typed, and says what was not recorded', async () => {
    const totalTyped: ManualEntry = { id: 'e-total', kind: 'sell', amountSats: 25_000_000, date: DAY, createdAt: 1, fiatAmount: 19_825, fiatCurrency: 'EUR', feeAmount: 50 };
    const bare: ManualEntry = { id: 'e-bare', kind: 'buy', amountSats: 1_000_000, date: DAY, createdAt: 1 };
    const sold = await mount([totalTyped], 'e-total');
    expect(facts(sold.r)).toMatchObject({
      Type: 'Sold',
      'Price per bitcoin': '€79,500.00',
      Fee: '€50.00',
      'Total received': '€19,825.00',
      Source: 'Not recorded',
    });
    const plain = await mount([bare], 'e-bare');
    expect(facts(plain.r)).toMatchObject({ 'Price per bitcoin': 'Not recorded', 'Total paid': 'Not recorded', Source: 'Not recorded' });
    expect(facts(plain.r)).not.toHaveProperty('Fee');
  });

  it('names where an entry came from: an exchange sync, a vault', async () => {
    const kraken: ManualEntry = { id: 'kraken-T1', kind: 'buy', amountSats: 1_000_000, date: DAY, createdAt: 1 };
    const snap: ManualEntry = { id: 'vsnap-w_mgabcd-0123456789abcdef', kind: 'buy', amountSats: 1_000_000, date: DAY, createdAt: 1, note: 'From Savings — added automatically.' };
    const k = await mount([kraken], 'kraken-T1');
    expect(facts(k.r)).toMatchObject({ Source: 'Kraken', Added: 'Kraken sync' });
    // The owner took that source away: it stays away.
    const cleared = await mount([{ ...kraken, source: 'none' }], 'kraken-T1');
    expect(facts(cleared.r)).toMatchObject({ Source: 'Not recorded', Added: 'Kraken sync' });
    const v = await mount([snap], snap.id);
    // An old automatic note reads without its em dash.
    expect(facts(v.r)).toMatchObject({ Source: 'Not recorded', Added: 'From the vault Savings', Note: 'From Savings. Added automatically.' });
  });

  it('gives the owner Edit, which opens the entry form on this entry', async () => {
    const { r, navigate } = await mount([PRICE_TYPED], 'e-price');
    const [edit] = editButton(r);
    expect(edit).toBeDefined();
    edit.props.onPress();
    expect(navigate).toHaveBeenCalledWith('ManualEntry', { walletId: 'w_port', entryId: 'e-price' });
  });

  it('reads the same for a member of a shared portfolio, with no Edit', async () => {
    const { r, navigate } = await mount([PRICE_TYPED], 'e-price', MEMBER);
    expect(editButton(r)).toHaveLength(0);
    expect(r.root.findAll((n) => (n.type as unknown) === 'Button')).toHaveLength(0);
    expect(facts(r)).toMatchObject({ 'Price per bitcoin': '$79,500.00', 'Total paid': '$9,824.75', Source: 'Bitcoin ATM' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('hides the amounts when the balance is hidden', async () => {
    const { r } = await mount([PRICE_TYPED], 'e-price', OWNER, { hideBalances: true });
    expect(words(r).slice(2, 4)).toEqual(['•••••', '••••']);
    expect(facts(r)).toMatchObject({ Amount: '••••', 'Price per bitcoin': '••••', Fee: '••••', 'Total paid': '••••' });
    expect(words(r).join(' ')).not.toContain('$');
  });

  it('shows no money at all in Bitcoin-only mode', async () => {
    const { r } = await mount([PRICE_TYPED], 'e-price', OWNER, { btcOnly: true });
    const f = facts(r);
    expect(f).not.toHaveProperty('Price per bitcoin');
    expect(f).not.toHaveProperty('Total paid');
    expect(words(r)).not.toContain('$9,824.75');
  });

  it('an entry in another currency also reads in the display currency, at its own day’s rate', async () => {
    mockConvert.mockResolvedValueOnce(9_000);
    const { r } = await mount([PRICE_TYPED], 'e-price', OWNER, { fiat: 'EUR' });
    expect(facts(r)).toMatchObject({ 'Total paid': '$9,824.75', 'In EUR': '≈€9,000.00' });
  });

  it('stacks each value under its label at the accessibility text sizes, never at the standard ones', async () => {
    const rowStyles = (r: Renderer) =>
      r.root
        .findAll((n) => (n.type as unknown) === 'View' && [n.props.style].flat().some((st: { name?: string } | false) => st && st.name === 'row'))
        .map((n) => [n.props.style].flat().filter(Boolean).map((st: { name: string }) => st.name));
    mockText.fontScale = 1.35;
    const standard = await mount([PRICE_TYPED], 'e-price');
    expect(rowStyles(standard.r).every((names) => !names.includes('rowStacked'))).toBe(true);
    mockText.fontScale = 1.95;
    const large = await mount([PRICE_TYPED], 'e-price');
    const rows = rowStyles(large.r);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.every((names) => names.includes('rowStacked'))).toBe(true);
    mockText.fontScale = 1;
  });

  it('says so when the entry is gone', async () => {
    const { r } = await mount([], 'e-price');
    expect(words(r)).toEqual(['This entry is no longer in this portfolio.']);
  });
});
