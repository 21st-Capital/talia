import { exchangeLinkOf, exchangeLinksOf, withExchangeLink, withoutExchangeLink } from '../exchangeLinks';

const kraken = { exchange: 'kraken' as const, connectedAt: 1 };
const coinbase = { exchange: 'coinbase' as const, connectedAt: 2, sandbox: true };

describe('exchange links', () => {
  it('reads the first build\'s single link, and prefers the list once it exists', () => {
    expect(exchangeLinksOf({})).toEqual([]);
    expect(exchangeLinksOf({ exchangeLink: kraken })).toEqual([kraken]);
    expect(exchangeLinksOf({ exchangeLink: kraken, exchangeLinks: [coinbase] })).toEqual([coinbase]);
    expect(exchangeLinkOf({ exchangeLink: kraken }, 'kraken')).toEqual(kraken);
    expect(exchangeLinkOf({ exchangeLink: kraken }, 'coinbase')).toBeUndefined();
  });

  it('adds beside, replaces the same exchange, removes one', () => {
    const both = withExchangeLink({ exchangeLink: kraken }, coinbase);
    expect(both).toEqual([kraken, coinbase]);
    expect(withExchangeLink({ exchangeLinks: both }, { ...kraken, lastSyncAt: 9 })).toEqual([coinbase, { ...kraken, lastSyncAt: 9 }]);
    expect(withoutExchangeLink({ exchangeLinks: both }, 'kraken')).toEqual([coinbase]);
    expect(withoutExchangeLink({ exchangeLink: kraken }, 'kraken')).toEqual([]);
  });
});
