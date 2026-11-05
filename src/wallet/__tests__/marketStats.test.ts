import { parseMarketRow } from '../marketStats';

describe('parseMarketRow', () => {
  const row = {
    id: 'bitcoin',
    market_cap: 1334316063853,
    market_cap_rank: 1,
    total_volume: 25296380002,
    circulating_supply: 20082718.0,
    max_supply: 21000000.0,
    current_price: 66427,
  };

  it('lifts the five Stats figures out of a CoinGecko markets row', () => {
    expect(parseMarketRow(row, 'EUR', 5)).toEqual({
      currency: 'EUR',
      marketCap: 1334316063853,
      rank: 1,
      circulatingSupply: 20082718,
      maxSupply: 21000000,
      volume24h: 25296380002,
      fetchedAt: 5,
    });
  });

  it('tolerates a missing max supply but not a missing core figure', () => {
    expect(parseMarketRow({ ...row, max_supply: null }, 'USD', 1)?.maxSupply).toBeNull();
    expect(parseMarketRow({ ...row, market_cap: 'big' }, 'USD', 1)).toBeNull();
    expect(parseMarketRow({ ...row, market_cap_rank: undefined }, 'USD', 1)).toBeNull();
    expect(parseMarketRow(null, 'USD', 1)).toBeNull();
    expect(parseMarketRow('bitcoin', 'USD', 1)).toBeNull();
  });
});
