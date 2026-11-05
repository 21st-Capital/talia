import { parseManualVault, serializeManualVault } from '../manualExport';
import type { ManualEntry } from '../manualLedger';
import { MAX_SOURCE_NAME_LENGTH } from '../entrySources';

const entry: ManualEntry = {
  id: 'e1',
  kind: 'buy',
  amountSats: 1_000_000,
  date: 1_698_058_800_000,
  fiatAmount: 30_000,
  fiatCurrency: 'USD',
  note: 'Kraken',
  createdAt: 1,
};

describe('serialize → parse round-trip', () => {
  it('preserves everything: name, icon, and each entry with note, price and currency', () => {
    const out = parseManualVault(serializeManualVault('My stash', [entry], 123, 'pig-money'));
    expect(out.name).toBe('My stash');
    expect(out.icon).toBe('pig-money');
    expect(out.entries).toEqual([entry]); // note 'Kraken', $30,000, USD — all of it
    expect(out.droppedEntries).toBe(0);
  });

  it('keeps the fee beside the total it is already inside of', () => {
    const withFee: ManualEntry = { ...entry, id: 'e2', fiatAmount: 50_200, feeAmount: 200 };
    const out = parseManualVault(serializeManualVault('Fees', [withFee], 1));
    expect(out.entries).toEqual([withFee]);
    expect(out.entries[0].feeAmount).toBe(200);
  });

  it('drops a fee that contradicts its entry, and keeps the entry', () => {
    const doc = JSON.parse(serializeManualVault('Fees', [entry], 1));
    doc.entries = [
      { ...entry, id: 'buy-fee-over-total', fiatAmount: 100, feeAmount: 150 },
      { ...entry, id: 'fee-no-total', fiatAmount: undefined, fiatCurrency: undefined, feeAmount: 20 },
      // A sell whose fee equalled the sale: the form keeps that fee (decided
      // 2026-10-22), and only a fee LARGER than the sale is never stored.
      { ...entry, id: 'sell-fee-equalled-sale', kind: 'sell', fiatAmount: 0, feeAmount: 10 },
      { ...entry, id: 'zero-fee', feeAmount: 0 },
      { ...entry, id: 'fine', fiatAmount: 50_200, feeAmount: 200 },
      { ...entry, id: 'fine-sell', kind: 'sell', fiatAmount: 19_825, feeAmount: 50 },
    ];
    const out = parseManualVault(JSON.stringify(doc));
    expect(out.droppedEntries).toBe(0);
    const fee = Object.fromEntries(out.entries.map((e) => [e.id, e.feeAmount]));
    expect(fee).toEqual({
      'buy-fee-over-total': undefined,
      'fee-no-total': undefined,
      'sell-fee-equalled-sale': 10,
      'zero-fee': undefined,
      fine: 200,
      'fine-sell': 50,
    });
    expect(out.entries.find((e) => e.id === 'buy-fee-over-total')).not.toHaveProperty('feeAmount');
  });

  it('drops an entry whose fee is not a usable number', () => {
    const doc = JSON.parse(serializeManualVault('Fees', [entry], 1));
    doc.entries = [
      { ...entry, id: 'bad-neg', feeAmount: -5 },
      { ...entry, id: 'bad-str', feeAmount: '200' },
      { ...entry, id: 'ok-null', feeAmount: null },
      { ...entry, id: 'ok-none' },
    ];
    const out = parseManualVault(JSON.stringify(doc));
    expect(out.entries.map((e) => e.id)).toEqual(['ok-null', 'ok-none']);
    expect(out.droppedEntries).toBe(2);
  });

  it('icon is optional both ways', () => {
    expect(parseManualVault(serializeManualVault('V', [entry], 1)).icon).toBeUndefined();
  });

  it('handles an empty vault', () => {
    const out = parseManualVault(serializeManualVault('Empty', [], 123));
    expect(out.entries).toEqual([]);
  });
});

describe('parseManualVault rejects wrong files with a readable reason', () => {
  it('not JSON', () => {
    expect(() => parseManualVault('wpkh([aabbccdd/84h/0h/0h]xpub...)')).toThrow(/not a portfolio export/);
  });
  it('JSON but not our type — points descriptor files at the right door', () => {
    expect(() => parseManualVault('{"keystore":{"xpub":"xpub..."}}')).toThrow(/Add an existing vault/);
  });
  it('a future version asks for an app update instead of misreading it', () => {
    const doc = JSON.stringify({ type: 'talia-virtual-vault', version: 99, entries: [] });
    expect(() => parseManualVault(doc)).toThrow(/newer version/);
  });
  it('missing entries list', () => {
    const doc = JSON.stringify({ type: 'talia-virtual-vault', version: 1 });
    expect(() => parseManualVault(doc)).toThrow(/damaged/);
  });
});

describe('per-entry validation', () => {
  it('drops malformed entries and COUNTS them', () => {
    const doc = JSON.stringify({
      type: 'talia-virtual-vault',
      version: 1,
      name: 'V',
      entries: [
        entry,
        { id: 'bad', kind: 'buy', amountSats: 'lots' }, // wrong types
        { ...entry, id: 'neg', amountSats: -5 }, // negative
        { ...entry, id: 'frac', amountSats: 1.5 }, // fractional sats
      ],
    });
    const out = parseManualVault(doc);
    expect(out.entries.map((e) => e.id)).toEqual(['e1']);
    expect(out.droppedEntries).toBe(3);
  });

  it('a NaN price cannot survive JSON — it arrives as null and reads as unpriced', () => {
    // JSON.stringify(NaN) === 'null', so the wire format itself launders NaN
    // into "no price recorded" — the honest reading.
    const doc = JSON.stringify({
      type: 'talia-virtual-vault',
      version: 1,
      entries: [{ ...entry, fiatAmount: Number.NaN }],
    });
    const out = parseManualVault(doc);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].fiatAmount).toBeNull();
  });

  it('accepts entries without a price (price is optional by design)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fiatAmount: _fa, fiatCurrency: _fc, ...unpriced } = entry;
    const doc = JSON.stringify({ type: 'talia-virtual-vault', version: 1, entries: [unpriced] });
    expect(parseManualVault(doc).entries).toHaveLength(1);
  });

  it('falls back to a default name', () => {
    const doc = JSON.stringify({ type: 'talia-virtual-vault', version: 1, entries: [] });
    expect(parseManualVault(doc).name).toBe('Virtual vault');
  });
});

describe('the price typed and the source (decided 2026-10-22)', () => {
  const priced: ManualEntry = {
    ...entry,
    id: 'p1',
    amountSats: 12_345_600,
    fiatAmount: 9_814.75,
    pricePerBtc: 79_500,
    source: 'other',
    sourceName: 'Bitcoin ATM',
  };

  it('round-trip whole', () => {
    const out = parseManualVault(serializeManualVault('Mine', [priced, { ...entry, id: 'p2', source: 'kraken', sourceName: 'Kraken' }], 1));
    expect(out.entries).toEqual([priced, { ...entry, id: 'p2', source: 'kraken', sourceName: 'Kraken' }]);
    expect(out.droppedEntries).toBe(0);
  });

  it('keep the file at version 1, so every older app still opens it', () => {
    // An app refuses a version above its own: a bump for an optional field
    // would lock the older apps out of a file they read perfectly well.
    const doc = JSON.parse(serializeManualVault('Mine', [priced], 1));
    expect(doc.version).toBe(1);
    expect(doc.entries[0]).toMatchObject({ pricePerBtc: 79_500, source: 'other', sourceName: 'Bitcoin ATM' });
  });

  it('a file from before them reads as it always did', () => {
    const old = JSON.stringify({ type: 'talia-virtual-vault', version: 1, name: 'Old', entries: [entry] });
    const out = parseManualVault(old);
    expect(out.entries).toEqual([entry]);
    expect(out.entries[0].source).toBeUndefined();
    expect(out.entries[0].pricePerBtc).toBeUndefined();
  });

  it('a field this app does not know yet rides along untouched', () => {
    const doc = JSON.parse(serializeManualVault('Mine', [entry], 1));
    doc.entries[0].somethingNewer = { kept: true };
    const out = parseManualVault(JSON.stringify(doc));
    expect(out.droppedEntries).toBe(0);
    expect((out.entries[0] as unknown as Record<string, unknown>).somethingNewer).toEqual({ kept: true });
  });

  it('damaged ones are dropped and the entry kept', () => {
    const doc = JSON.parse(serializeManualVault('Mine', [entry], 1));
    doc.entries = [
      { ...entry, id: 'bad-price', pricePerBtc: 'lots' },
      { ...entry, id: 'negative-price', pricePerBtc: -5 },
      { ...entry, id: 'price-no-total', fiatAmount: undefined, fiatCurrency: undefined, pricePerBtc: 79_500 },
      { ...entry, id: 'bad-source', source: 'Kraken Pro!', sourceName: 'x' },
      { ...entry, id: 'other-no-name', source: 'other' },
      { ...entry, id: 'long-name', source: 'other', sourceName: 'y'.repeat(300) },
    ];
    const out = parseManualVault(JSON.stringify(doc));
    expect(out.droppedEntries).toBe(0);
    const byId = new Map(out.entries.map((e) => [e.id, e]));
    for (const id of ['bad-price', 'negative-price', 'price-no-total']) expect(byId.get(id)?.pricePerBtc).toBeUndefined();
    for (const id of ['bad-source', 'other-no-name']) {
      expect(byId.get(id)?.source).toBeUndefined();
      expect(byId.get(id)?.sourceName).toBeUndefined();
    }
    expect(byId.get('long-name')?.sourceName).toHaveLength(MAX_SOURCE_NAME_LENGTH);
    // The amounts are untouched by any of it.
    for (const e of out.entries) expect(e.amountSats).toBe(entry.amountSats);
  });
});
