/**
 * The icon a wallet shows: the owner's pick, else the coin stack for a
 * portfolio, else the default of its section. `walletIconInSection` asks with
 * the section a wallet sits in on Arrange before Done saves it, and
 * `walletIconFor` is the same rule for the section it is saved under.
 */
import {
  CATEGORY_MULTISIG,
  CATEGORY_OTHER,
  CATEGORY_SINGLE_SIG,
} from '../../../wallet/categories';
import type { WalletMeta } from '../../../wallet/types';
import { MULTISIG_2_OF_3, SPARROW_SINGLE_SIG } from '../../../bitcoin/descriptor/__fixtures__/descriptors';
import { walletIconFor, walletIconInSection } from '../walletIcons';

jest.mock('react-native', () => require('../../__tests__/rnStub').reactNative);
jest.mock('react-native-svg', () => require('../../__tests__/rnStub').svg);
// The wallet barrel pulls in the provider and native storage; the icon rule
// needs only the section logic behind it.
jest.mock('../../../wallet', () => require('../../../wallet/categories'));

function w(id: string, extra: Partial<WalletMeta> = {}): WalletMeta {
  return {
    id,
    label: id,
    descriptor: SPARROW_SINGLE_SIG,
    network: 'bitcoin',
    kind: 'single-sig',
    source: 'generic',
    transport: 'paste',
    createdAt: 0,
    ...extra,
  };
}

describe('a vault\'s icon follows the section it sits in (decided 2026-10-15)', () => {
  it('a never-arranged single-sig moved on Arrange takes its new section\'s icon at once', () => {
    const vault = w('a');
    expect(walletIconFor(vault)).toBe('wallet');
    expect(walletIconInSection(vault, CATEGORY_MULTISIG)).toBe('users-group');
    expect(walletIconInSection(vault, '')).toBe('currency-bitcoin');
    expect(walletIconInSection(vault, 'Cold storage')).toBe('currency-bitcoin');
  });

  it('the saved Other marker and the section key draw the same icon', () => {
    expect(walletIconFor(w('a', { category: CATEGORY_OTHER }))).toBe('currency-bitcoin');
    expect(walletIconInSection(w('a'), CATEGORY_OTHER)).toBe('currency-bitcoin');
  });

  it('walletIconFor is the same rule asked with the saved section', () => {
    const shared = w('b', { descriptor: MULTISIG_2_OF_3 });
    expect(walletIconFor(shared)).toBe('users-group');
    expect(walletIconFor(w('c', { category: CATEGORY_SINGLE_SIG, descriptor: MULTISIG_2_OF_3 }))).toBe('wallet');
  });

  it('a picked icon and a portfolio\'s coins never move with the section', () => {
    const picked = w('a', { icon: 'rocket' });
    expect(walletIconInSection(picked, CATEGORY_MULTISIG)).toBe('rocket');
    expect(walletIconInSection(picked, '')).toBe('rocket');
    const portfolio = w('p', { manual: true, descriptor: '' });
    expect(walletIconInSection(portfolio, '')).toBe('coins');
    expect(walletIconInSection(portfolio, 'Family')).toBe('coins');
    // An icon key that no longer exists falls back to the section's default.
    expect(walletIconInSection(w('d', { icon: 'gone' }), CATEGORY_MULTISIG)).toBe('users-group');
  });
});
