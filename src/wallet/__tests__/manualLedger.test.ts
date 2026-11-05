import {
  SATS_PER_BTC,
  manualBalanceSats,
  manualEntryError,
  manualRunningBalance,
  manualSummary,
  manualUnrealizedFiat,
  parseAmountToSats,
  parseFiatAmount,
  sortManualEntries,
} from '../manualLedger';
import type { ManualEntry } from '../manualLedger';

let seq = 0;
function entry(e: Partial<ManualEntry> & Pick<ManualEntry, 'kind' | 'amountSats'>): ManualEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    date: e.date ?? 1_700_000_000_000 + seq,
    createdAt: e.createdAt ?? seq,
    ...e,
  };
}

const btc = (n: number): number => Math.round(n * SATS_PER_BTC);

describe('manualBalanceSats', () => {
  it('is zero for an empty ledger', () => {
    expect(manualBalanceSats([])).toBe(0);
  });

  it('adds buys and subtracts sells', () => {
    const entries = [
      entry({ kind: 'buy', amountSats: btc(1) }),
      entry({ kind: 'buy', amountSats: btc(0.5) }),
      entry({ kind: 'sell', amountSats: btc(0.25) }),
    ];
    expect(manualBalanceSats(entries)).toBe(btc(1.25));
  });

  it('goes negative rather than clamping when sells exceed buys', () => {
    const entries = [
      entry({ kind: 'buy', amountSats: 1000 }),
      entry({ kind: 'sell', amountSats: 2500 }),
    ];
    expect(manualBalanceSats(entries)).toBe(-1500);
  });
});

describe('sortManualEntries', () => {
  it('puts the newest date first', () => {
    const older = entry({ kind: 'buy', amountSats: 1, date: 1000 });
    const newer = entry({ kind: 'buy', amountSats: 2, date: 5000 });
    expect(sortManualEntries([older, newer]).map((e) => e.id)).toEqual([newer.id, older.id]);
  });

  it('breaks same-date ties by creation order, newest first', () => {
    const first = entry({ kind: 'buy', amountSats: 1, date: 1000, createdAt: 10 });
    const second = entry({ kind: 'buy', amountSats: 2, date: 1000, createdAt: 20 });
    expect(sortManualEntries([first, second]).map((e) => e.id)).toEqual([second.id, first.id]);
  });

  it('does not mutate its input', () => {
    const entries = [
      entry({ kind: 'buy', amountSats: 1, date: 1000 }),
      entry({ kind: 'buy', amountSats: 2, date: 5000 }),
    ];
    const order = entries.map((e) => e.id);
    sortManualEntries(entries);
    expect(entries.map((e) => e.id)).toEqual(order);
  });
});

describe('manualSummary', () => {
  it('reports an empty ledger without inventing a price', () => {
    const s = manualSummary([], 'USD');
    expect(s.balanceSats).toBe(0);
    expect(s.avgBuyPriceFiat).toBeUndefined();
    expect(s.holdingsCostFiat).toBeUndefined();
    expect(s.oversold).toBe(false);
  });

  it('averages the price per whole BTC across priced buys', () => {
    // 0.5 BTC for $20,000 and 0.5 BTC for $30,000 => $50,000 for 1 BTC.
    const s = manualSummary(
      [
        entry({ kind: 'buy', amountSats: btc(0.5), fiatAmount: 20_000, fiatCurrency: 'USD' }),
        entry({ kind: 'buy', amountSats: btc(0.5), fiatAmount: 30_000, fiatCurrency: 'USD' }),
      ],
      'USD',
    );
    expect(s.investedFiat).toBe(50_000);
    expect(s.avgBuyPriceFiat).toBeCloseTo(50_000, 6);
    expect(s.holdingsCostFiat).toBeCloseTo(50_000, 6);
  });

  it('weights the average by size, not by number of entries', () => {
    // 0.9 BTC at $10k/BTC + 0.1 BTC at $100k/BTC = $19,000 for 1.0 BTC.
    const s = manualSummary(
      [
        entry({ kind: 'buy', amountSats: btc(0.9), fiatAmount: 9_000, fiatCurrency: 'USD' }),
        entry({ kind: 'buy', amountSats: btc(0.1), fiatAmount: 10_000, fiatCurrency: 'USD' }),
      ],
      'USD',
    );
    expect(s.avgBuyPriceFiat).toBeCloseTo(19_000, 6);
  });

  it('NEVER extrapolates the average across unpriced coins', () => {
    const s = manualSummary(
      [
        entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 40_000, fiatCurrency: 'USD' }),
        entry({ kind: 'buy', amountSats: btc(1) }), // no price recorded
      ],
      'USD',
    );
    expect(s.balanceSats).toBe(btc(2));
    expect(s.pricedBuySats).toBe(btc(1));
    expect(s.avgBuyPriceFiat).toBeCloseTo(40_000, 6);
    // Cost covers ONLY the priced BTC. Extrapolating the average across the
    // whole balance once claimed a 305k cost on a 35k portfolio (seen in a
    // phone test, 2026-08-25).
    expect(s.coveredHeldSats).toBe(btc(1));
    expect(s.uncoveredHeldSats).toBe(btc(1));
    expect(s.holdingsCostFiat).toBeCloseTo(40_000, 6);
  });

  it("REGRESSION (a phone test's EUR screenshot): a small priced entry never prices the whole vault", () => {
    // 0.01 BTC bought for €5,000 + 0.6 BTC recorded in USD, no conversion
    // available. The broken build showed cost €305,000, P/L −€256,633 (84.1%).
    const entries = [
      entry({ kind: 'buy', amountSats: btc(0.01), fiatAmount: 5_000, fiatCurrency: 'EUR' }),
      entry({ kind: 'buy', amountSats: btc(0.6), fiatAmount: 30_000, fiatCurrency: 'USD' }),
    ];
    const s = manualSummary(entries, 'EUR'); // no fx map — USD entry unconvertible
    expect(s.coveredHeldSats).toBe(btc(0.01));
    expect(s.holdingsCostFiat).toBeCloseTo(5_000, 6);
    expect(s.unconvertedEntries).toBe(1);
    // P/L is scoped to the covered 0.01 BTC at ~€79,290/BTC: ≈ −€4,207, tiny.
    expect(manualUnrealizedFiat(s, 79_290)).toBeCloseTo(0.01 * 79_290 - 5_000, 2);
    // WITH a conversion (USD→EUR ≈ 0.92 that day), everything is covered.
    const usdEntry = entries[1];
    const withFx = manualSummary(entries, 'EUR', new Map([[usdEntry.id, 27_600]]));
    expect(withFx.coveredHeldSats).toBe(btc(0.61));
    expect(withFx.uncoveredHeldSats).toBe(0);
    expect(withFx.holdingsCostFiat).toBeCloseTo(32_600, 6);
    expect(withFx.convertedEntries).toBe(1);
    expect(withFx.unconvertedEntries).toBe(0);
  });

  it('converts other-currency entries via the fx map and counts them', () => {
    const eur = entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 38_000, fiatCurrency: 'EUR' });
    const s = manualSummary(
      [entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 40_000, fiatCurrency: 'USD' }), eur],
      'USD',
      new Map([[eur.id, 41_000]]),
    );
    expect(s.convertedEntries).toBe(1);
    expect(s.unconvertedEntries).toBe(0);
    expect(s.investedFiat).toBe(81_000);
    expect(s.pricedBuySats).toBe(btc(2));
  });

  it('counts other-currency entries without a conversion instead of guessing', () => {
    const s = manualSummary(
      [
        entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 40_000, fiatCurrency: 'USD' }),
        entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 38_000, fiatCurrency: 'EUR' }),
      ],
      'USD',
    );
    expect(s.unconvertedEntries).toBe(1);
    expect(s.investedFiat).toBe(40_000);
    expect(s.pricedBuySats).toBe(btc(1));
    expect(s.balanceSats).toBe(btc(2)); // coins still count, only the fiat waits
  });

  it('converted sells feed realized proceeds', () => {
    const sell = entry({ kind: 'sell', amountSats: btc(0.5), fiatAmount: 30_000, fiatCurrency: 'EUR' });
    const s = manualSummary(
      [entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 40_000, fiatCurrency: 'USD' }), sell],
      'USD',
      new Map([[sell.id, 32_500]]),
    );
    expect(s.realizedProceedsFiat).toBe(32_500);
    expect(s.pricedSellSats).toBe(btc(0.5));
  });

  it('reduces the cost basis proportionally after a sell (average cost)', () => {
    const s = manualSummary(
      [
        entry({ kind: 'buy', amountSats: btc(2), fiatAmount: 100_000, fiatCurrency: 'USD' }),
        entry({ kind: 'sell', amountSats: btc(1), fiatAmount: 70_000, fiatCurrency: 'USD' }),
      ],
      'USD',
    );
    expect(s.balanceSats).toBe(btc(1));
    expect(s.avgBuyPriceFiat).toBeCloseTo(50_000, 6); // unchanged by the sell
    expect(s.holdingsCostFiat).toBeCloseTo(50_000, 6); // 1 BTC still held
    expect(s.realizedProceedsFiat).toBe(70_000);
    expect(s.pricedSellSats).toBe(btc(1));
  });

  it('sells consume PRICED sats first — a sold position cannot re-attach its cost to unpriced buys', () => {
    // Jan: buy 1 priced. Feb: sell it all. Mar: buy 1 with no price.
    // The broken build showed the Jan cost against the Mar coin.
    const s = manualSummary(
      [
        entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 100_000, fiatCurrency: 'USD' }),
        entry({ kind: 'sell', amountSats: btc(1) }),
        entry({ kind: 'buy', amountSats: btc(1) }), // unpriced
      ],
      'USD',
    );
    expect(s.balanceSats).toBe(btc(1));
    expect(s.coveredHeldSats).toBe(0);
    expect(s.uncoveredHeldSats).toBe(btc(1));
    expect(s.holdingsCostFiat).toBeUndefined();
    expect(manualUnrealizedFiat(s, 80_000)).toBeUndefined();
  });

  it('partial sell leaves only the unsold priced portion covered', () => {
    const s = manualSummary(
      [
        entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 100_000, fiatCurrency: 'USD' }),
        entry({ kind: 'sell', amountSats: btc(0.5) }),
        entry({ kind: 'buy', amountSats: btc(1) }), // unpriced
      ],
      'USD',
    );
    // priced 1 − sold 0.5 = 0.5 covered, at the 100k/BTC average → 50k.
    expect(s.coveredHeldSats).toBe(btc(0.5));
    expect(s.uncoveredHeldSats).toBe(btc(1));
    expect(s.holdingsCostFiat).toBeCloseTo(50_000, 6);
  });

  it('flags an oversold ledger and reports no holdings cost', () => {
    const s = manualSummary(
      [
        entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 30_000, fiatCurrency: 'USD' }),
        entry({ kind: 'sell', amountSats: btc(2) }),
      ],
      'USD',
    );
    expect(s.oversold).toBe(true);
    expect(s.balanceSats).toBe(btc(-1));
    expect(s.holdingsCostFiat).toBeUndefined();
  });

  it('reports no holdings cost when everything has been sold', () => {
    const s = manualSummary(
      [
        entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 30_000, fiatCurrency: 'USD' }),
        entry({ kind: 'sell', amountSats: btc(1) }),
      ],
      'USD',
    );
    expect(s.balanceSats).toBe(0);
    expect(s.holdingsCostFiat).toBeUndefined();
  });
});

describe('manualUnrealizedFiat', () => {
  it('is the gain over the recorded cost', () => {
    const s = manualSummary(
      [entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 40_000, fiatCurrency: 'USD' })],
      'USD',
    );
    expect(manualUnrealizedFiat(s, 60_000)).toBeCloseTo(20_000, 6);
  });

  it('is negative when the price fell', () => {
    const s = manualSummary(
      [entry({ kind: 'buy', amountSats: btc(1), fiatAmount: 40_000, fiatCurrency: 'USD' })],
      'USD',
    );
    expect(manualUnrealizedFiat(s, 25_000)).toBeCloseTo(-15_000, 6);
  });

  it('is undefined with no recorded cost — never a fabricated 100% gain', () => {
    const s = manualSummary([entry({ kind: 'buy', amountSats: btc(1) })], 'USD');
    expect(manualUnrealizedFiat(s, 60_000)).toBeUndefined();
  });

  it('is undefined for an empty wallet', () => {
    expect(manualUnrealizedFiat(manualSummary([], 'USD'), 60_000)).toBeUndefined();
  });
});

describe('manualEntryError', () => {
  const held = [entry({ kind: 'buy', amountSats: btc(1) })];

  it('rejects zero and negative amounts', () => {
    expect(manualEntryError([], { kind: 'buy', amountSats: 0 })).toMatch(/greater than zero/);
    expect(manualEntryError([], { kind: 'buy', amountSats: -5 })).toMatch(/greater than zero/);
  });

  it('rejects non-finite and fractional sats', () => {
    expect(manualEntryError([], { kind: 'buy', amountSats: Number.NaN })).toMatch(/greater than zero/);
    expect(manualEntryError([], { kind: 'buy', amountSats: 1.5 })).toMatch(/whole satoshis/);
  });

  it('accepts a buy of any size', () => {
    expect(manualEntryError([], { kind: 'buy', amountSats: btc(21) })).toBeNull();
  });

  it('refuses a sell larger than the balance', () => {
    expect(manualEntryError(held, { kind: 'sell', amountSats: btc(2) })).toMatch(/more than this portfolio holds/);
  });

  it('allows selling exactly the whole balance', () => {
    expect(manualEntryError(held, { kind: 'sell', amountSats: btc(1) })).toBeNull();
  });

  it('refuses any sell from an empty wallet', () => {
    expect(manualEntryError([], { kind: 'sell', amountSats: 1 })).toMatch(/more than this portfolio holds/);
  });
});

describe('parseAmountToSats', () => {
  it('parses whole BTC', () => {
    expect(parseAmountToSats('1', 'btc')).toBe(100_000_000);
    expect(parseAmountToSats('21', 'btc')).toBe(2_100_000_000);
  });

  it('parses fractional BTC EXACTLY, where float maths would drift', () => {
    // parseFloat('0.1') * 1e8 === 10000000.000000002
    expect(parseAmountToSats('0.1', 'btc')).toBe(10_000_000);
    expect(parseAmountToSats('0.00000001', 'btc')).toBe(1);
    expect(parseAmountToSats('1.23456789', 'btc')).toBe(123_456_789);
    expect(parseAmountToSats('.5', 'btc')).toBe(50_000_000);
  });

  it('accepts a comma decimal separator and stray spaces', () => {
    expect(parseAmountToSats('0,5', 'btc')).toBe(50_000_000);
    expect(parseAmountToSats(' 1.5 ', 'btc')).toBe(150_000_000);
    expect(parseAmountToSats('1 000', 'sats')).toBe(1000);
  });

  it('rejects amounts finer than a satoshi', () => {
    expect(parseAmountToSats('0.000000001', 'btc')).toBeNull();
  });

  it('parses sats and rejects fractional sats', () => {
    expect(parseAmountToSats('1000', 'sats')).toBe(1000);
    expect(parseAmountToSats('1000.5', 'sats')).toBeNull();
  });

  it('rejects junk instead of guessing', () => {
    for (const junk of ['', '.', 'abc', '1.2.3', '-1', '1e8', '0x10']) {
      expect(parseAmountToSats(junk, 'btc')).toBeNull();
    }
  });

  it('treats an empty whole part as zero', () => {
    expect(parseAmountToSats('0', 'btc')).toBe(0);
  });
});

describe('parseFiatAmount', () => {
  it('parses plain and decimal amounts', () => {
    expect(parseFiatAmount('40000')).toBe(40_000);
    expect(parseFiatAmount('40000.50')).toBe(40_000.5);
    expect(parseFiatAmount('0')).toBe(0);
  });

  it('accepts a comma decimal separator', () => {
    expect(parseFiatAmount('1234,56')).toBe(1234.56);
  });

  it('rejects junk rather than reading it as zero', () => {
    for (const junk of ['', '.', 'abc', '-5', '1.2.3']) {
      expect(parseFiatAmount(junk)).toBeNull();
    }
  });
});

describe('manualRunningBalance', () => {
  it('is empty for an empty ledger', () => {
    expect(manualRunningBalance([])).toEqual([]);
  });

  it("matches the vault ledger's example: buys add, sells subtract, newest first", () => {
    // Jan 10: buy 1. May 5: buy 0.5. Jun 1: sell 0.25. Given in any order.
    const jan = entry({ kind: 'buy', amountSats: btc(1), date: Date.UTC(2026, 0, 10) });
    const jun = entry({ kind: 'sell', amountSats: btc(0.25), date: Date.UTC(2026, 5, 1) });
    const may = entry({ kind: 'buy', amountSats: btc(0.5), date: Date.UTC(2026, 4, 5) });
    const ledger = manualRunningBalance([jun, jan, may]);
    expect(ledger.map((e) => e.id)).toEqual([jun.id, may.id, jan.id]);
    expect(ledger.map((e) => e.balanceAfter)).toEqual([btc(1.25), btc(1.5), btc(1)]);
  });

  it("agrees with the ledger's total on the newest entry and with itself on the oldest", () => {
    const entries = [
      entry({ kind: 'buy', amountSats: 70_000, date: 1000 }),
      entry({ kind: 'sell', amountSats: 30_000, date: 2000 }),
      entry({ kind: 'buy', amountSats: 5_000, date: 3000 }),
    ];
    const ledger = manualRunningBalance(entries);
    expect(ledger[0].balanceAfter).toBe(manualBalanceSats(entries));
    // The oldest entry's balance is just that entry.
    expect(ledger[ledger.length - 1].balanceAfter).toBe(70_000);
  });

  it('breaks same-day ties by creation order, like the sort it shares', () => {
    const first = entry({ kind: 'buy', amountSats: 100, date: 5000, createdAt: 1 });
    const second = entry({ kind: 'buy', amountSats: 200, date: 5000, createdAt: 2 });
    const ledger = manualRunningBalance([first, second]);
    expect(ledger.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(ledger.map((e) => e.balanceAfter)).toEqual([300, 100]);
  });

  it('goes negative where an oversold ledger goes negative, never clamped', () => {
    const buy = entry({ kind: 'buy', amountSats: 1000, date: 1000 });
    const sell = entry({ kind: 'sell', amountSats: 2500, date: 2000 });
    const later = entry({ kind: 'buy', amountSats: 500, date: 3000 });
    const ledger = manualRunningBalance([buy, sell, later]);
    expect(ledger.map((e) => e.balanceAfter)).toEqual([-1000, -1500, 1000]);
  });

  it('keeps every field of the entry beside the running figure', () => {
    const e = entry({ kind: 'buy', amountSats: 10, fiatAmount: 1.5, fiatCurrency: 'EUR', note: 'n' });
    const [annotated] = manualRunningBalance([e]);
    expect(annotated).toEqual({ ...e, balanceAfter: 10 });
  });

  it('leaves the input untouched', () => {
    const entries = [
      entry({ kind: 'buy', amountSats: 1, date: 1000 }),
      entry({ kind: 'buy', amountSats: 2, date: 2000 }),
    ];
    const before = entries.map((e) => ({ ...e }));
    manualRunningBalance(entries);
    expect(entries).toEqual(before);
  });
});
