import {
  SATS_PER_BTC,
  basisForCoin,
  recordCostIn,
  coinBasisError,
  coinUnrealizedFiat,
  outpointKey,
  reassignRecord,
  resolveBasis,
  vaultBasisSummary,
  vaultUnrealizedFiat,
} from '../coinBasis';
import type { CoinBasisRecord } from '../coinBasis';
import type { Utxo } from '../../bitcoin/engine/types';

const btc = (n: number): number => Math.round(n * SATS_PER_BTC);

function coin(txid: string, vout: number, valueSats: number): Utxo {
  return { txid, vout, valueSats, keychain: 'external' };
}

function rec(
  outpoint: string,
  amountSats: number,
  costFiat: number,
  extra?: Partial<CoinBasisRecord>,
): CoinBasisRecord {
  return {
    outpoint,
    amountSats,
    costFiat,
    fiatCurrency: 'USD',
    source: 'user',
    updatedAt: 1,
    ...extra,
  };
}

describe('outpointKey', () => {
  it('is txid:vout, decimal, unpadded — the format frozenUtxos already uses', () => {
    expect(outpointKey({ txid: 'ab'.repeat(32), vout: 0 })).toBe(`${'ab'.repeat(32)}:0`);
    expect(outpointKey({ txid: 'cd', vout: 17 })).toBe('cd:17');
  });
});

describe('resolveBasis / basisForCoin', () => {
  const c1 = coin('t1', 0, btc(1));
  const c2 = coin('t2', 1, btc(0.5));

  it('joins records to living coins and strands the rest', () => {
    const records = [rec('t1:0', btc(1), 40_000), rec('gone:0', btc(2), 80_000)];
    const resolved = resolveBasis(records, [c1, c2]);
    expect(resolved[0].coin).toBe(c1);
    expect(resolved[0].stranded).toBe(false);
    expect(resolved[1].coin).toBeUndefined();
    expect(resolved[1].stranded).toBe(true);
  });

  it('basisForCoin returns the record or undefined — never a made-up value', () => {
    const records = [rec('t1:0', btc(1), 40_000)];
    expect(basisForCoin(records, c1)?.costFiat).toBe(40_000);
    expect(basisForCoin(records, c2)).toBeUndefined();
  });
});

describe('vaultBasisSummary', () => {
  it('is empty-safe', () => {
    const s = vaultBasisSummary([], [], 'USD');
    expect(s.coveredSats).toBe(0);
    expect(s.uncoveredSats).toBe(0);
    expect(s.costFiat).toBe(0);
    expect(s.strandedRecords).toEqual([]);
  });

  it('splits covered from uncovered sats — pricing one coin never covers the vault', () => {
    const coins = [coin('a', 0, btc(1)), coin('b', 0, btc(3))];
    const s = vaultBasisSummary([rec('a:0', btc(1), 40_000)], coins, 'USD');
    expect(s.coveredSats).toBe(btc(1));
    expect(s.uncoveredSats).toBe(btc(3));
    expect(s.costFiat).toBe(40_000);
    expect(s.pricedCoins).toBe(1);
    expect(s.totalCoins).toBe(2);
  });

  it('the covered identity holds: with every coin priced, covered == balance and uncovered == 0', () => {
    const coins = [coin('a', 0, btc(1)), coin('b', 0, btc(2))];
    const s = vaultBasisSummary(
      [rec('a:0', btc(1), 40_000), rec('b:0', btc(2), 90_000)],
      coins,
      'USD',
    );
    expect(s.coveredSats).toBe(btc(3));
    expect(s.uncoveredSats).toBe(0);
    expect(s.costFiat).toBe(130_000);
  });

  it('uses the LIVE coin value, not the recorded one, when the two disagree', () => {
    // The record remembered 1 BTC but the living coin is the truth.
    const coins = [coin('a', 0, btc(2))];
    const s = vaultBasisSummary([rec('a:0', btc(1), 40_000)], coins, 'USD');
    expect(s.coveredSats).toBe(btc(2));
  });

  it('strands records whose coin is gone instead of counting or deleting them', () => {
    const s = vaultBasisSummary([rec('gone:0', btc(1), 40_000)], [coin('a', 0, btc(1))], 'USD');
    expect(s.coveredSats).toBe(0);
    expect(s.costFiat).toBe(0);
    expect(s.strandedRecords).toHaveLength(1);
    expect(s.strandedRecords[0].costFiat).toBe(40_000);
  });

  it('converts other-currency records via fx and counts them', () => {
    const coins = [coin('a', 0, btc(1)), coin('b', 0, btc(1))];
    const s = vaultBasisSummary(
      [rec('a:0', btc(1), 40_000), rec('b:0', btc(1), 38_000, { fiatCurrency: 'EUR' })],
      coins,
      'USD',
      new Map([['b:0', 41_000]]),
    );
    expect(s.costFiat).toBe(81_000);
    expect(s.coveredSats).toBe(btc(2));
    expect(s.convertedRecords).toBe(1);
    expect(s.unconvertedRecords).toBe(0);
  });

  it('discloses other-currency records with no conversion instead of guessing', () => {
    const coins = [coin('a', 0, btc(1)), coin('b', 0, btc(1))];
    const s = vaultBasisSummary(
      [rec('a:0', btc(1), 40_000), rec('b:0', btc(1), 38_000, { fiatCurrency: 'EUR' })],
      coins,
      'USD',
    );
    expect(s.costFiat).toBe(40_000);
    expect(s.coveredSats).toBe(btc(1));
    expect(s.unconvertedRecords).toBe(1);
    expect(s.convertedRecords).toBe(0);
  });

  it('recordCostIn: passthrough, fx lookup, or undefined — never a guess', () => {
    const usd = rec('a:0', btc(1), 40_000);
    const eur = rec('b:0', btc(1), 38_000, { fiatCurrency: 'EUR' });
    expect(recordCostIn(usd, 'USD')).toBe(40_000);
    expect(recordCostIn(eur, 'USD')).toBeUndefined();
    expect(recordCostIn(eur, 'USD', new Map([['b:0', 41_000]]))).toBe(41_000);
    expect(recordCostIn(eur, 'USD', new Map([['b:0', Number.NaN]]))).toBeUndefined();
  });

  it('rejects non-finite and negative costs at the boundary — NaN never becomes a figure', () => {
    const coins = [coin('a', 0, btc(1)), coin('b', 0, btc(1))];
    const s = vaultBasisSummary(
      [rec('a:0', btc(1), Number.NaN), rec('b:0', btc(1), -5)],
      coins,
      'USD',
    );
    expect(s.pricedCoins).toBe(0);
    expect(s.costFiat).toBe(0);
    expect(Number.isFinite(s.costFiat)).toBe(true);
  });

  it('counts one record per coin even if duplicates sneak into storage', () => {
    const coins = [coin('a', 0, btc(1))];
    const s = vaultBasisSummary([rec('a:0', btc(1), 40_000), rec('a:0', btc(1), 50_000)], coins, 'USD');
    expect(s.pricedCoins).toBe(1);
    expect(s.coveredSats).toBe(btc(1));
    expect(s.costFiat).toBe(40_000); // first record wins; editing replaces it
  });
});

describe('vaultUnrealizedFiat', () => {
  it('is P/L over covered coins only', () => {
    const coins = [coin('a', 0, btc(1)), coin('b', 0, btc(9))]; // 9 BTC unpriced
    const s = vaultBasisSummary([rec('a:0', btc(1), 40_000)], coins, 'USD');
    // 1 BTC covered, cost 40k, price 60k → +20k. The 9 unpriced BTC are NOT
    // in the number — pricing one coin must never claim a vault-wide profit.
    expect(vaultUnrealizedFiat(s, 60_000)).toBeCloseTo(20_000, 6);
  });

  it('is negative when the price fell', () => {
    const s = vaultBasisSummary([rec('a:0', btc(1), 40_000)], [coin('a', 0, btc(1))], 'USD');
    expect(vaultUnrealizedFiat(s, 25_000)).toBeCloseTo(-15_000, 6);
  });

  it('is undefined with nothing priced, an empty vault, or a garbage price', () => {
    const empty = vaultBasisSummary([], [coin('a', 0, btc(1))], 'USD');
    expect(vaultUnrealizedFiat(empty, 60_000)).toBeUndefined();
    const s = vaultBasisSummary([rec('a:0', btc(1), 40_000)], [coin('a', 0, btc(1))], 'USD');
    expect(vaultUnrealizedFiat(s, Number.NaN)).toBeUndefined();
    expect(vaultUnrealizedFiat(s, 0)).toBeUndefined();
  });
});

describe('coinUnrealizedFiat', () => {
  const c = coin('a', 0, btc(0.5));
  it('prices one coin against its converted cost', () => {
    expect(coinUnrealizedFiat(20_000, c, 60_000)).toBeCloseTo(10_000, 6);
  });
  it('refuses garbage inputs', () => {
    expect(coinUnrealizedFiat(Number.NaN, c, 60_000)).toBeUndefined();
    expect(coinUnrealizedFiat(20_000, c, Number.NaN)).toBeUndefined();
  });
});

describe('coinBasisError', () => {
  it('rejects negative, NaN; accepts zero (a gift genuinely cost nothing)', () => {
    expect(coinBasisError({ costFiat: -1, amountSats: 100 })).toMatch(/plain amount/);
    expect(coinBasisError({ costFiat: Number.NaN, amountSats: 100 })).toMatch(/plain amount/);
    expect(coinBasisError({ costFiat: 0, amountSats: 100 })).toBeNull();
    expect(coinBasisError({ costFiat: 500, amountSats: 100 })).toBeNull();
  });
  it('rejects a valueless coin', () => {
    expect(coinBasisError({ costFiat: 10, amountSats: 0 })).toMatch(/no value/);
  });
});

describe('reassignRecord', () => {
  it('moves the anchor and refreshes the amount; cost, source and note travel unchanged', () => {
    const stranded = rec('old:0', btc(1), 40_000, { note: 'Kraken buy', source: 'user' });
    const successor = coin('new', 2, btc(0.98)); // refresh paid a fee
    const moved = reassignRecord(stranded, successor, 999);
    expect(moved.outpoint).toBe('new:2');
    expect(moved.amountSats).toBe(btc(0.98));
    expect(moved.costFiat).toBe(40_000); // same money, same cost
    expect(moved.note).toBe('Kraken buy');
    expect(moved.source).toBe('user');
    expect(moved.updatedAt).toBe(999);
    // and the original is untouched
    expect(stranded.outpoint).toBe('old:0');
  });
});
