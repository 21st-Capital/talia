import { visibleWallets, visibleTotalSats, allCategories } from '../categories';
import type { WalletMeta } from '../types';
import { SPARROW_SINGLE_SIG } from '../../bitcoin/descriptor/__fixtures__/descriptors';

// Labels a person CHOSE on the Arrange screen: the auto-stamps 'savings'
// and 'spending' are read as unset now, so a test about hiding sections
// has to use real ones (decided 2026-09-09).
function w(id: string, category: string | undefined, sats: number, balanceHidden = false): WalletMeta {
  return {
    id, label: id, descriptor: SPARROW_SINGLE_SIG, network: 'testnet', kind: 'single-sig',
    source: 'generic', transport: 'paste', createdAt: 0,
    category, cachedBalanceSats: sats, balanceHidden,
  };
}

describe('visibility', () => {
  const wallets = [
    w('a', 'Cold storage', 100),
    w('b', 'Daily', 50),
    w('c', undefined, 25),
    w('d', 'Cold storage', 10, true),
  ];
  it('filters hidden categories from home', () => {
    expect(visibleWallets(wallets, ['Cold storage']).map((x) => x.id)).toEqual(['b', 'c']);
    // 'c' has no chosen label, so its section is the one its shape gives it.
    expect(visibleWallets(wallets, ['single-sig']).map((x) => x.id)).toEqual(['a', 'b', 'd']);
  });
  it('total excludes hidden categories AND individually hidden wallets', () => {
    expect(visibleTotalSats(wallets, [])).toBe(175); // d hidden individually
    expect(visibleTotalSats(wallets, ['Cold storage'])).toBe(75);
  });
  it('lists all categories in use', () => {
    expect(allCategories(wallets).sort()).toEqual(['Cold storage', 'Daily', 'single-sig']);
  });
});
