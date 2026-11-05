/**
 * Decided 2026-09-26: price lookups sent the EXACT
 * second of each vault transaction (its block's timestamp) to mempool.space
 * and Binance, which singles the transaction out on-chain. Only the day is
 * sent now.
 */
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));
jest.mock('../ecbRate', () => ({ ecbRate: jest.fn(async () => 1) }));

import { dayNoonSecs, getHistoricalPoint } from '../historicalPrice';

const realFetch = global.fetch;
afterAll(() => {
  global.fetch = realFetch;
});

describe('price lookups send the day, never the second', () => {
  it('dayNoonSecs is the same for every moment of one local day', () => {
    const morning = new Date(2025, 2, 10, 0, 0, 5).getTime() / 1000;
    const night = new Date(2025, 2, 10, 23, 59, 50).getTime() / 1000;
    expect(dayNoonSecs(morning)).toBe(dayNoonSecs(night));
    expect(dayNoonSecs(morning)).toBe(new Date(2025, 2, 10, 12).getTime() / 1000);
  });

  it("the request carries the day's noon, not the transaction's block time", async () => {
    const urls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => ({ prices: [{ USD: 50_000, time: 1 }] }) };
    }) as unknown as typeof fetch;
    const blockTime = Math.floor(new Date(2024, 5, 3, 17, 42, 13).getTime() / 1000);
    await getHistoricalPoint('USD', blockTime);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(`timestamp=${dayNoonSecs(blockTime)}`);
    expect(urls[0]).not.toContain(String(blockTime));
  });
});
