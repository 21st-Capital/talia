/**
 * What an entry's own page says about it (decided 2026-10-22): the price per
 * bitcoin AND the total whichever one was typed, the fee inside the total,
 * and where the entry came from.
 */
import {
  displayNote,
  entryMoney,
  entryOrigin,
  formatFiatValue,
  formatMoney,
  originVaultName,
  originWords,
  usableFee,
  usablePrice,
} from '../entryDetails';
import { coinsValueFromTotal, entryTotalFromPrice, entryTotalWithFee, pricePerBtcFromCoinsValue } from '../manualEntryPricing';
import { entryFormMoney, entryFormOpening } from '../entryForm';
import { snapshotEntryId } from '../vaultToPortfolio';
import { krakenEntryId } from '../../exchanges/kraken';
import { coinbaseEntryId } from '../../exchanges/coinbase';
import type { ManualEntry } from '../manualLedger';

const entry = (over: Partial<ManualEntry>): ManualEntry => ({
  id: 'e1',
  kind: 'buy',
  amountSats: 50_000_000,
  date: Date.UTC(2026, 2, 12, 12),
  createdAt: 1,
  ...over,
});

describe('the money, whichever number was typed', () => {
  it("a total typed with a fee: the price is worked back from what the coins came to (0.5 BTC for 50,000 + 200)", () => {
    const m = entryMoney(entry({ fiatAmount: 50_200, fiatCurrency: 'USD', feeAmount: 200 }));
    expect(m).toEqual({ currency: 'USD', total: 50_200, fee: 200, coinsValue: 50_000, pricePerBtc: 100_000, priceTyped: false });
  });

  it('a price typed is shown as typed, not as one worked back from the rounded total', () => {
    // 0.123456 BTC at 79,500 is 9,814.752, kept as 9,814.75; worked back
    // that reads 79,499.98, which is not what the client typed.
    const typed = entryTotalFromPrice({ kind: 'buy', amountSats: 12_345_600, pricePerBtc: 79_500, currency: 'USD' });
    expect(typed?.total).toBe(9_814.75);
    const e = entry({ amountSats: 12_345_600, fiatAmount: typed?.total, fiatCurrency: 'USD', pricePerBtc: 79_500 });
    expect(entryMoney(e)).toMatchObject({ total: 9_814.75, pricePerBtc: 79_500, priceTyped: true });
    // The same entry without the price on file reads the worked-back one.
    const { pricePerBtc: _p, ...withoutPrice } = e;
    expect(entryMoney(withoutPrice)).toMatchObject({ total: 9_814.75, pricePerBtc: 79_499.98, priceTyped: false });
  });

  it('both ways with a fee: price to total on a buy and a sell, and back again', () => {
    const buy = entryTotalFromPrice({ kind: 'buy', amountSats: 12_345_600, pricePerBtc: 79_500, fee: 10, currency: 'EUR' });
    expect(buy).toEqual({ total: 9_824.75, clampedAtZero: false });
    const sell = entryTotalFromPrice({ kind: 'sell', amountSats: 25_000_000, pricePerBtc: 79_500, fee: 50, currency: 'EUR' });
    expect(sell).toEqual({ total: 19_825, clampedAtZero: false });

    const buyEntry = entry({ amountSats: 12_345_600, fiatAmount: 9_824.75, fiatCurrency: 'EUR', feeAmount: 10, pricePerBtc: 79_500 });
    expect(entryMoney(buyEntry)).toMatchObject({ coinsValue: 9_814.75, fee: 10, pricePerBtc: 79_500, priceTyped: true });
    const sellEntry = entry({ kind: 'sell', amountSats: 25_000_000, fiatAmount: 19_825, fiatCurrency: 'EUR', feeAmount: 50 });
    expect(entryMoney(sellEntry)).toMatchObject({ coinsValue: 19_875, fee: 50, pricePerBtc: 79_500, priceTyped: false });

    // Total typed: the coins' value comes back out, and the price from it.
    const coins = coinsValueFromTotal('buy', 9_824.75, 10, 'EUR');
    expect(coins).toBe(9_814.75);
    expect(entryTotalWithFee('buy', coins as number, 10, 'EUR')?.total).toBe(9_824.75);
    expect(pricePerBtcFromCoinsValue(12_345_600, coins as number)).toBe(79_499.98);
  });

  it("rounds to the currency's own smallest unit: cents, and whole yen", () => {
    const usd = entryTotalFromPrice({ kind: 'buy', amountSats: 33_333_333, pricePerBtc: 100_000.01, currency: 'USD' });
    expect(usd?.total).toBe(33_333.34);
    const yen = entryTotalFromPrice({ kind: 'buy', amountSats: 1_234_567, pricePerBtc: 15_000_000, currency: 'JPY' });
    expect(yen?.total).toBe(185_185);
    const e = entry({ amountSats: 1_234_567, fiatAmount: 185_185, fiatCurrency: 'JPY', pricePerBtc: 15_000_000 });
    // Half a yen of slack, not half a cent: the typed price still stands.
    expect(entryMoney(e)).toMatchObject({ pricePerBtc: 15_000_000, priceTyped: true });
  });

  it('a price that does not make the total is set aside: the total is the truth', () => {
    // An older app changed the amount and kept the price, or a file was edited.
    const m = entryMoney(entry({ fiatAmount: 50_200, fiatCurrency: 'USD', feeAmount: 200, pricePerBtc: 90_000 }));
    expect(m).toMatchObject({ total: 50_200, pricePerBtc: 100_000, priceTyped: false });
  });

  it('an entry with no money has no price, whatever else it carries', () => {
    expect(entryMoney(entry({}))).toEqual({ priceTyped: false });
    expect(entryMoney(entry({ pricePerBtc: 79_500 }))).toEqual({ priceTyped: false });
  });

  it('a damaged price is never shown', () => {
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(entryMoney(entry({ fiatAmount: 50_000, fiatCurrency: 'USD', pricePerBtc: bad }))).toMatchObject({
        pricePerBtc: 100_000,
        priceTyped: false,
      });
    }
    expect(usablePrice('79500')).toBeUndefined();
    expect(usablePrice(0)).toBe(0);
  });
});

describe('a sell that came to nothing', () => {
  it('the fee equalled the sale: the fee and the typed price both stand, and save unchanged', () => {
    // 0.01 BTC sold at a typed 1,000 with a fee of 10: nothing came back.
    const e = entry({ kind: 'sell', amountSats: 1_000_000, fiatAmount: 0, fiatCurrency: 'USD', feeAmount: 10, pricePerBtc: 1_000 });
    expect(entryMoney(e)).toEqual({ currency: 'USD', total: 0, fee: 10, coinsValue: 10, pricePerBtc: 1_000, priceTyped: true });
    expect(entryFormOpening(e)).toEqual({ anchor: 'price', price: '1000', coins: '', fee: '10' });
    const again = entryFormMoney({ kind: 'sell', amountSats: 1_000_000, anchor: 'price', price: 1_000, coins: null, fee: 10, currency: 'USD' });
    expect(again.stored).toEqual({ fiatAmount: 0, feeAmount: 10, pricePerBtc: 1_000 });
  });

  it('the fee swallowed the sale: no price is shown, not a price of zero', () => {
    // The form keeps neither the fee nor the price of such a sell.
    const swallowed = entryFormMoney({ kind: 'sell', amountSats: 1_000_000, anchor: 'price', price: 1_000, coins: null, fee: 25, currency: 'USD' });
    expect(swallowed.stored).toEqual({ fiatAmount: 0, feeAmount: undefined, pricePerBtc: undefined });
    const e = entry({ kind: 'sell', amountSats: 1_000_000, fiatAmount: 0, fiatCurrency: 'USD' });
    expect(entryMoney(e)).toEqual({ currency: 'USD', total: 0, fee: undefined, coinsValue: 0, pricePerBtc: undefined, priceTyped: false });
    // It still reopens on what it recorded, and an unchanged save keeps it.
    expect(entryFormOpening(e)).toEqual({ anchor: 'coins', price: '', coins: '0', fee: '' });
  });

  it('a buy of nothing still reads a price of zero: that is what was typed', () => {
    expect(entryMoney(entry({ fiatAmount: 0, fiatCurrency: 'USD' }))).toMatchObject({ pricePerBtc: 0 });
  });
});

describe('the fee', () => {
  it('counts only when it sits inside a total', () => {
    expect(usableFee({ kind: 'buy', fiatAmount: 100, feeAmount: 5 })).toBe(5);
    expect(usableFee({ kind: 'buy', fiatAmount: 100, feeAmount: 101 })).toBeUndefined();
    // A sell whose fee equalled the sale: the form kept it, so it counts.
    expect(usableFee({ kind: 'sell', fiatAmount: 0, feeAmount: 5 })).toBe(5);
    expect(usableFee({ kind: 'sell', fiatAmount: 10, feeAmount: 50 })).toBe(50);
    expect(usableFee({ kind: 'buy', feeAmount: 5 })).toBeUndefined();
    expect(usableFee({ kind: 'buy', fiatAmount: 100, feeAmount: 0 })).toBeUndefined();
  });

  it("is read at its currency's own precision, like the total", () => {
    expect(usableFee({ kind: 'buy', fiatAmount: 185_336, feeAmount: 150.5, fiatCurrency: 'JPY' })).toBe(151);
    expect(usableFee({ kind: 'buy', fiatAmount: 100, feeAmount: 8.625, fiatCurrency: 'USD' })).toBe(8.63);
    // Less than the currency's smallest unit is no fee at all.
    expect(usableFee({ kind: 'buy', fiatAmount: 100, feeAmount: 0.3, fiatCurrency: 'JPY' })).toBeUndefined();
  });
});

describe('where the entry came from', () => {
  it('typed, an exchange sync, or a vault', () => {
    expect(entryOrigin({ id: 'mgx-1' })).toEqual({ kind: 'typed' });
    expect(entryOrigin({ id: krakenEntryId('TX1') })).toEqual({ kind: 'exchange', exchange: 'kraken' });
    expect(entryOrigin({ id: coinbaseEntryId('f1') })).toEqual({ kind: 'exchange', exchange: 'coinbase' });
    expect(entryOrigin({ id: snapshotEntryId('w_mgabcd_9z', 'ab'.repeat(32)) })).toEqual({ kind: 'vault', vaultIdStart: 'w_mgabcd' });
  });

  it('names the vault only when exactly one vault on the phone matches', () => {
    const origin = entryOrigin({ id: snapshotEntryId('w_mgabcd_9z', 'ab'.repeat(32)) });
    expect(originVaultName(origin, [{ id: 'w_mgabcd_9z', label: 'Savings' }, { id: 'w_other_1', label: 'Daily' }])).toBe('Savings');
    expect(originVaultName(origin, [{ id: 'w_mgabcd_1', label: 'A' }, { id: 'w_mgabcd_2', label: 'B' }])).toBeUndefined();
    // A portfolio is never the vault an entry came from.
    expect(originVaultName(origin, [{ id: 'w_mgabcd_9z', label: 'Mine', manual: true }])).toBeUndefined();
    expect(originVaultName(origin, [])).toBeUndefined();
  });

  it('in plain words', () => {
    expect(originWords({ kind: 'typed' })).toBe('Typed in by hand');
    expect(originWords({ kind: 'exchange', exchange: 'kraken' })).toBe('Kraken sync');
    expect(originWords({ kind: 'exchange', exchange: 'coinbase' })).toBe('Coinbase sync');
    expect(originWords({ kind: 'vault', vaultIdStart: 'w_x' }, 'Savings')).toBe('From the vault Savings');
    expect(originWords({ kind: 'vault', vaultIdStart: 'w_x' })).toBe('From a vault');
  });
});

describe('money on screen', () => {
  it('always carries its cents, and yen none', () => {
    expect(formatMoney(27_786)).toBe('27,786.00');
    expect(formatMoney(1_234_567.891, 2)).toBe('1,234,567.89');
    expect(formatFiatValue(19_875, 'EUR')).toBe('€19,875.00');
    expect(formatFiatValue(3_000_000, 'JPY')).toBe('¥3,000,000');
    expect(formatFiatValue(1_234.5, 'CHF')).toBe('CHF 1,234.50');
  });
});

describe('the note', () => {
  it('Talia\'s own old notes read in the words it writes now, with no em dash', () => {
    expect(displayNote('From Savings — added automatically.')).toBe('From Savings. Added automatically.');
    expect(displayNote('Estimated at that day’s market price — edit if you know the real amount.')).toBe(
      'Estimated at that day’s market price. Edit it if you know the real amount.',
    );
    expect(displayNote('From the vault’s history — add what you paid if you know it.')).toBe(
      'From the vault’s history. You can add what you paid if you know it.',
    );
  });

  it('a note the client wrote is never touched, dash or not', () => {
    expect(displayNote('Birthday gift — for Toni')).toBe('Birthday gift — for Toni');
    expect(displayNote('From Savings — added automatically. And more')).toBe('From Savings — added automatically. And more');
    expect(displayNote(undefined)).toBeUndefined();
    expect(displayNote('')).toBe('');
  });
});
