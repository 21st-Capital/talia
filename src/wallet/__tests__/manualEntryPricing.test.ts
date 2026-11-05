import { SATS_PER_BTC } from '../manualLedger';
import {
  coinsValueFromPrice,
  coinsValueFromTotal,
  entryTotalFromPrice,
  entryTotalWithFee,
  pricePerBtcFromCoinsValue,
} from '../manualEntryPricing';

const btc = (n: number): number => Math.round(n * SATS_PER_BTC);

describe('price and fee to the stored total', () => {
  it("the phone test's sell: 0.25 BTC at 79,500 is 19,875 received, not 79,500", () => {
    expect(entryTotalFromPrice({ kind: 'sell', amountSats: btc(0.25), pricePerBtc: 79_500 }))
      .toEqual({ total: 19_875, clampedAtZero: false });
  });

  it("the phone test's buy: 0.5 BTC for 50,000 is a price of 100,000, and a fee adds to what was paid", () => {
    expect(pricePerBtcFromCoinsValue(btc(0.5), 50_000)).toBe(100_000);
    expect(entryTotalFromPrice({ kind: 'buy', amountSats: btc(0.5), pricePerBtc: 100_000, fee: 100 }))
      .toEqual({ total: 50_100, clampedAtZero: false });
  });

  it('a sell takes the fee off what came back', () => {
    expect(entryTotalFromPrice({ kind: 'sell', amountSats: btc(0.25), pricePerBtc: 79_500, fee: 50 }))
      .toEqual({ total: 19_825, clampedAtZero: false });
  });

  it('a fee can never push a sell below zero', () => {
    expect(entryTotalFromPrice({ kind: 'sell', amountSats: 1_000, pricePerBtc: 60_000, fee: 5 }))
      .toEqual({ total: 0, clampedAtZero: true });
    // The same fee on a buy is simply paid.
    expect(entryTotalFromPrice({ kind: 'buy', amountSats: 1_000, pricePerBtc: 60_000, fee: 5 }))
      .toEqual({ total: 5.6, clampedAtZero: false });
  });

  it('rounds to the currency: cents by default, whole yen', () => {
    // 0.333 × 12,345.67 = 4,111.10811
    expect(coinsValueFromPrice(btc(0.333), 12_345.67)).toBe(4_111.11);
    expect(coinsValueFromPrice(btc(0.333), 12_345.67, 'JPY')).toBe(4_111);
    expect(entryTotalWithFee('buy', 4_111.11, 0.004)).toEqual({ total: 4_111.11, clampedAtZero: false });
    expect(entryTotalWithFee('buy', 4_111, 0.6, 'JPY')).toEqual({ total: 4_112, clampedAtZero: false });
  });

  it('a sat is not lost to floating point: 0.1 BTC at 30,000 is exactly 3,000', () => {
    expect(coinsValueFromPrice(btc(0.1), 30_000)).toBe(3_000);
    expect(coinsValueFromPrice(btc(0.3), 33_333.33)).toBe(10_000);
  });

  it('large holdings stay exact', () => {
    expect(coinsValueFromPrice(btc(1_000), 100_000)).toBe(100_000_000);
    expect(coinsValueFromPrice(21_000_000 * SATS_PER_BTC, 1_000_000)).toBe(21_000_000_000_000);
  });

  it('refuses unusable numbers rather than recording zero', () => {
    expect(entryTotalFromPrice({ kind: 'buy', amountSats: 0, pricePerBtc: 100 })).toBeUndefined();
    expect(entryTotalFromPrice({ kind: 'buy', amountSats: -5, pricePerBtc: 100 })).toBeUndefined();
    expect(entryTotalFromPrice({ kind: 'buy', amountSats: 100, pricePerBtc: NaN })).toBeUndefined();
    expect(entryTotalFromPrice({ kind: 'buy', amountSats: 100, pricePerBtc: -1 })).toBeUndefined();
    expect(entryTotalFromPrice({ kind: 'buy', amountSats: 100, pricePerBtc: 100, fee: -1 })).toBeUndefined();
    expect(entryTotalFromPrice({ kind: 'buy', amountSats: 100, pricePerBtc: Infinity })).toBeUndefined();
    expect(entryTotalWithFee('sell', NaN, 0)).toBeUndefined();
    expect(entryTotalWithFee('sell', 10, Infinity)).toBeUndefined();
  });

  it('a price of zero is a gift, not an error', () => {
    expect(entryTotalFromPrice({ kind: 'buy', amountSats: btc(1), pricePerBtc: 0, fee: 2 }))
      .toEqual({ total: 2, clampedAtZero: false });
  });
});

describe('total back to price when editing', () => {
  it('derives the price from the total on file', () => {
    expect(pricePerBtcFromCoinsValue(btc(0.25), 19_875)).toBe(79_500);
    expect(pricePerBtcFromCoinsValue(btc(1), 65_432.1)).toBe(65_432.1);
    expect(pricePerBtcFromCoinsValue(btc(2), 1)).toBe(0.5);
  });

  it('the derived price reproduces the stored total, so an unchanged edit cannot nudge it', () => {
    const cases: Array<[number, number]> = [
      [btc(0.333), 100],
      [btc(0.00012345), 7.77],
      [btc(3.14159265), 250_000],
      [12_345_678, 9_876.54],
      [btc(1), 0.01],
    ];
    for (const [amountSats, total] of cases) {
      const price = pricePerBtcFromCoinsValue(amountSats, total);
      expect(price).toBeDefined();
      expect(coinsValueFromPrice(amountSats, price!)).toBe(total);
    }
  });

  it('prefers the shortest price that still round-trips', () => {
    // 100 / 0.333 = 300.3003003..., two decimals already round-trip to the cent.
    expect(pricePerBtcFromCoinsValue(btc(0.333), 100)).toBe(300.3);
    // 12,345.67 / 10 = 1,234.567; two decimals would give 12,345.70 back, so a third is needed.
    expect(pricePerBtcFromCoinsValue(btc(10), 12_345.67)).toBe(1_234.567);
  });

  it('refuses an entry with no usable amount or total', () => {
    expect(pricePerBtcFromCoinsValue(0, 100)).toBeUndefined();
    expect(pricePerBtcFromCoinsValue(-1, 100)).toBeUndefined();
    expect(pricePerBtcFromCoinsValue(100, NaN)).toBeUndefined();
    expect(pricePerBtcFromCoinsValue(100, -1)).toBeUndefined();
  });

  it('a stored total of zero is a price of zero', () => {
    expect(pricePerBtcFromCoinsValue(btc(1), 0)).toBe(0);
  });
});

describe('an entry reopening with its fee on file', () => {
  it("the phone test's buy: total 50,200 with a 200 fee is 50,000 for the coins, a price of 100,000", () => {
    expect(coinsValueFromTotal('buy', 50_200, 200)).toBe(50_000);
    expect(pricePerBtcFromCoinsValue(btc(0.5), 50_000)).toBe(100_000);
  });

  it('a sell puts the fee back on: 19,825 received with a 50 fee was 19,875 for the coins', () => {
    expect(coinsValueFromTotal('sell', 19_825, 50)).toBe(19_875);
    expect(pricePerBtcFromCoinsValue(btc(0.25), 19_875)).toBe(79_500);
  });

  it('round-trips through the screen: fee and price in, total out, fee and price back', () => {
    const cases: Array<['buy' | 'sell', number, number, number]> = [
      ['buy', btc(0.5), 100_000, 200],
      ['sell', btc(0.25), 79_500, 50],
      ['sell', btc(3.14159265), 250_000, 0],
    ];
    for (const [kind, amountSats, pricePerBtc, fee] of cases) {
      const stored = entryTotalFromPrice({ kind, amountSats, pricePerBtc, fee })!;
      const coinsAgain = coinsValueFromTotal(kind, stored.total, fee)!;
      expect(coinsAgain).toBe(coinsValueFromPrice(amountSats, pricePerBtc));
      expect(pricePerBtcFromCoinsValue(amountSats, coinsAgain)).toBe(pricePerBtc);
    }
  });

  it('when the coin value had to be rounded to cents, the TOTAL still round-trips exactly', () => {
    // 0.333 × 12,345.67 = 4,111.10811, stored as 4,111.11; the price that comes
    // back is 12,345.68, a cent away, but re-saving it reproduces the same
    // coin value and therefore the same total on file.
    const stored = entryTotalFromPrice({ kind: 'buy', amountSats: btc(0.333), pricePerBtc: 12_345.67, fee: 9.99 })!;
    expect(stored.total).toBe(4_121.1);
    const coinsAgain = coinsValueFromTotal('buy', stored.total, 9.99)!;
    expect(coinsAgain).toBe(4_111.11);
    const priceAgain = pricePerBtcFromCoinsValue(btc(0.333), coinsAgain)!;
    expect(priceAgain).toBe(12_345.68);
    expect(coinsValueFromPrice(btc(0.333), priceAgain)).toBe(4_111.11);
    expect(entryTotalWithFee('buy', coinsValueFromPrice(btc(0.333), priceAgain)!, 9.99)!.total).toBe(stored.total);
  });

  it('no fee on file means the total IS the coin value', () => {
    expect(coinsValueFromTotal('buy', 19_875)).toBe(19_875);
    expect(coinsValueFromTotal('sell', 19_875, 0)).toBe(19_875);
  });

  it('a damaged record whose fee exceeds its buy total opens at zero, never negative', () => {
    expect(coinsValueFromTotal('buy', 100, 150)).toBe(0);
  });

  it('rounds to the currency and refuses unusable numbers', () => {
    expect(coinsValueFromTotal('sell', 1_000, 0.004)).toBe(1_000);
    expect(coinsValueFromTotal('sell', 1_000, 0.6, 'JPY')).toBe(1_001);
    expect(coinsValueFromTotal('buy', NaN, 1)).toBeUndefined();
    expect(coinsValueFromTotal('buy', -1, 1)).toBeUndefined();
    expect(coinsValueFromTotal('buy', 10, -1)).toBeUndefined();
    expect(coinsValueFromTotal('buy', 10, Infinity)).toBeUndefined();
  });
});
