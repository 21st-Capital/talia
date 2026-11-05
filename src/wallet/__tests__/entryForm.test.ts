/**
 * The entry form's money (decided 2026-10-22): what it stores for the numbers
 * typed, and what it opens on again. Saving an entry unchanged must store
 * exactly what was there, and the entry's page must read back the number the
 * client typed.
 */
import { entryFormMoney, entryFormOpening, plainNumber } from '../entryForm';
import type { EntryFormMoneyInput, MoneyAnchor } from '../entryForm';
import { entryMoney } from '../entryDetails';
import { parseFiatAmount } from '../manualLedger';
import type { ManualEntry, ManualEntryKind } from '../manualLedger';
import type { FiatCurrency } from '../types';

const base = { id: 'e1', date: Date.UTC(2026, 2, 12, 12), createdAt: 1 };

/** The entry the form saves for these fields. */
function saved(input: EntryFormMoneyInput): ManualEntry {
  const { stored } = entryFormMoney(input);
  return {
    ...base,
    kind: input.kind,
    amountSats: input.amountSats as number,
    fiatAmount: stored.fiatAmount,
    fiatCurrency: stored.fiatAmount != null ? input.currency : undefined,
    feeAmount: stored.feeAmount,
    ...(stored.pricePerBtc != null ? { pricePerBtc: stored.pricePerBtc } : {}),
  };
}

/** The same entry opened in the form and saved without a change. */
function reopenedAndSaved(entry: ManualEntry): ManualEntry {
  const o = entryFormOpening(entry);
  return saved({
    kind: entry.kind,
    amountSats: entry.amountSats,
    anchor: o.anchor,
    price: parseFiatAmount(o.price),
    coins: parseFiatAmount(o.coins),
    fee: o.fee.trim() === '' ? 0 : parseFiatAmount(o.fee),
    currency: entry.fiatCurrency,
  });
}

describe('a fee typed finer than its currency', () => {
  it('yen: the typed price stands, and an unchanged save keeps the total', () => {
    // 0.01234567 BTC at a typed 15,000,000 yen with a fee of 150.5: the coins
    // come to 185,185 and the fee is kept as 151, so the total is 185,336.
    const input: EntryFormMoneyInput = {
      kind: 'buy',
      amountSats: 1_234_567,
      anchor: 'price',
      price: 15_000_000,
      coins: null,
      fee: 150.5,
      currency: 'JPY',
    };
    expect(entryFormMoney(input).stored).toEqual({ fiatAmount: 185_336, feeAmount: 151, pricePerBtc: 15_000_000 });
    const e = saved(input);
    expect(entryMoney(e)).toMatchObject({ total: 185_336, fee: 151, coinsValue: 185_185, pricePerBtc: 15_000_000, priceTyped: true });
    expect(entryFormOpening(e)).toEqual({ anchor: 'price', price: '15000000', coins: '', fee: '151' });
    expect(reopenedAndSaved(e)).toEqual(e);
  });

  it('dollars: a three-decimal fee is kept in cents', () => {
    const input: EntryFormMoneyInput = {
      kind: 'buy',
      amountSats: 12_345_600,
      anchor: 'price',
      price: 79_500,
      coins: null,
      fee: 8.625,
      currency: 'USD',
    };
    const m = entryFormMoney(input);
    expect(m.fee).toBe(8.63);
    expect(m.stored).toEqual({ fiatAmount: 9_823.38, feeAmount: 8.63, pricePerBtc: 79_500 });
    const e = saved(input);
    expect(entryMoney(e)).toMatchObject({ pricePerBtc: 79_500, priceTyped: true, fee: 8.63 });
    expect(reopenedAndSaved(e)).toEqual(e);
  });

  it('an entry saved before the fee was rounded reopens and saves unchanged', () => {
    // An older form stored the fee as typed; the total it made is on file.
    const old: ManualEntry = { ...base, kind: 'buy', amountSats: 1_234_567, fiatAmount: 185_336, fiatCurrency: 'JPY', feeAmount: 150.5 };
    expect(entryMoney(old)).toMatchObject({ total: 185_336, fee: 151, coinsValue: 185_185, priceTyped: false });
    const again = reopenedAndSaved(old);
    expect(again.fiatAmount).toBe(185_336);
    expect(again.feeAmount).toBe(151);
  });
});

/** A small deterministic generator, so a failure names its case. */
function generator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('every typed entry reads back as typed and saves unchanged', () => {
  const currencies: FiatCurrency[] = ['USD', 'EUR', 'JPY', 'CHF'];
  const kinds: ManualEntryKind[] = ['buy', 'sell'];
  const anchors: MoneyAnchor[] = ['price', 'coins'];

  it('over 20,000 random entries, fees with up to three decimals', () => {
    const rnd = generator(20_261_022);
    const failures: string[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      const currency = currencies[Math.floor(rnd() * currencies.length)];
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const anchor = anchors[Math.floor(rnd() * anchors.length)];
      const amountSats = 1 + Math.floor(rnd() * 300_000_000);
      const priceDecimals = Math.floor(rnd() * 3);
      const price = Number((rnd() * 150_000 * (currency === 'JPY' ? 150 : 1)).toFixed(priceDecimals));
      const coins = Number((rnd() * 50_000).toFixed(Math.floor(rnd() * 3)));
      const fee = rnd() < 0.3 ? 0 : Number((rnd() * 200).toFixed(Math.floor(rnd() * 4)));
      const input: EntryFormMoneyInput = { kind, amountSats, anchor, price, coins, fee, currency };
      const m = entryFormMoney(input);
      if (m.stored.fiatAmount == null) continue;
      const e = saved(input);
      const read = entryMoney(e);
      const tag = `${kind} ${amountSats} ${currency} ${anchor} price ${price} coins ${coins} fee ${fee}`;
      if (read.total !== m.stored.fiatAmount) failures.push(`total ${tag}`);
      if (m.stored.pricePerBtc != null && (!read.priceTyped || read.pricePerBtc !== price)) failures.push(`price ${tag}`);
      if (JSON.stringify(reopenedAndSaved(e)) !== JSON.stringify(e)) failures.push(`resave ${tag}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });
});

describe('the form', () => {
  it('works the price out of what the coins came to, and the coins out of the price', () => {
    const fromCoins = entryFormMoney({ kind: 'buy', amountSats: 50_000_000, anchor: 'coins', price: null, coins: 50_000, fee: 200, currency: 'USD' });
    expect(fromCoins).toMatchObject({ coinsValue: 50_000, pricePerBtc: 100_000, fee: 200 });
    expect(fromCoins.stored).toEqual({ fiatAmount: 50_200, feeAmount: 200, pricePerBtc: undefined });

    const fromPrice = entryFormMoney({ kind: 'sell', amountSats: 25_000_000, anchor: 'price', price: 79_500, coins: null, fee: 50, currency: 'EUR' });
    expect(fromPrice).toMatchObject({ coinsValue: 19_875, pricePerBtc: 79_500 });
    expect(fromPrice.stored).toEqual({ fiatAmount: 19_825, feeAmount: 50, pricePerBtc: 79_500 });
  });

  it('keeps neither the fee nor the price when the fee swallowed a sell', () => {
    const m = entryFormMoney({ kind: 'sell', amountSats: 1_000_000, anchor: 'price', price: 1_000, coins: null, fee: 25, currency: 'USD' });
    expect(m.total).toEqual({ total: 0, clampedAtZero: true });
    expect(m.stored).toEqual({ fiatAmount: 0, feeAmount: undefined, pricePerBtc: undefined });
  });

  it('an unreadable fee records nothing', () => {
    const m = entryFormMoney({ kind: 'buy', amountSats: 1_000_000, anchor: 'price', price: 1_000, coins: null, fee: null, currency: 'USD' });
    expect(m.fee).toBeNull();
    expect(m.total).toBeUndefined();
    expect(m.stored.fiatAmount).toBeUndefined();
  });

  it('writes a number for its field without an exponent', () => {
    expect(plainNumber(79_500)).toBe('79500');
    expect(plainNumber(300.3)).toBe('300.3');
    expect(plainNumber(1e-7)).toBe('0.0000001');
  });
});
