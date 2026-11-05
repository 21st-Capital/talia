import { orderWalletsByIds } from '../walletOrder';

const list = (...ids: string[]) => ids.map((id) => ({ id }));
const idsOf = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

describe('orderWalletsByIds', () => {
  it('puts the ranked wallets first, in the given order', () => {
    expect(idsOf(orderWalletsByIds(list('a', 'b', 'c'), ['c', 'a', 'b']))).toEqual(['c', 'a', 'b']);
  });

  it('unranked wallets keep their CURRENT relative order after the ranked ones', () => {
    // Arranging the Portfolio tab (p1, p2) must not disturb the vault order
    // (v1, v2, v3), and vice versa.
    const wallets = list('v1', 'p1', 'v2', 'p2', 'v3');
    expect(idsOf(orderWalletsByIds(wallets, ['p2', 'p1']))).toEqual(['p2', 'p1', 'v1', 'v2', 'v3']);
    expect(idsOf(orderWalletsByIds(wallets, ['v3', 'v1', 'v2']))).toEqual(['v3', 'v1', 'v2', 'p1', 'p2']);
  });

  it('arranging one tab then the other leaves both orders intact', () => {
    const once = orderWalletsByIds(list('v1', 'p1', 'v2', 'p2'), ['p2', 'p1']);
    const twice = orderWalletsByIds(once, ['v2', 'v1']);
    expect(idsOf(twice)).toEqual(['v2', 'v1', 'p2', 'p1']);
  });

  it('ignores ids that no longer exist and leaves an empty order alone', () => {
    expect(idsOf(orderWalletsByIds(list('a', 'b'), ['zombie', 'b']))).toEqual(['b', 'a']);
    expect(idsOf(orderWalletsByIds(list('a', 'b'), []))).toEqual(['a', 'b']);
  });

  it('does not mutate its input', () => {
    const wallets = list('a', 'b');
    orderWalletsByIds(wallets, ['b']);
    expect(idsOf(wallets)).toEqual(['a', 'b']);
  });
});
