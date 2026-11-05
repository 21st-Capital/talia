import { buildPortfolioCsv, buildPortfolioPdf, portfolioPdfRows } from '../portfolioReport';
import type { ManualEntry } from '../manualLedger';

const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

const buy: ManualEntry = {
  id: 'a', kind: 'buy', amountSats: 60_000_000, date: Date.UTC(2023, 9, 23, 12),
  fiatAmount: 30_000, fiatCurrency: 'USD', note: 'Kraken, "spot"', createdAt: 1,
};
const sell: ManualEntry = {
  id: 'b', kind: 'sell', amountSats: 10_000_000, date: Date.UTC(2024, 0, 5, 12), createdAt: 2,
};

describe('buildPortfolioCsv', () => {
  it('emits RFC-4180 rows, oldest first, quoting the note', () => {
    const csv = buildPortfolioCsv([sell, buy]);
    const lines = csv.trim().split('\r\n');
    // Source is the last column, so every older column keeps its place.
    expect(lines[0]).toBe('Date,Type,Amount (BTC),Amount (sats),Price,Currency,Note,Source');
    expect(lines[1]).toBe('2023-10-23,Bought,0.60000000,60000000,30000,USD,"Kraken, ""spot""",');
    expect(lines[2]).toBe('2024-01-05,Sold,0.10000000,10000000,,,,');
  });

  it("names each entry's source: a pick, peer to peer, a typed name, an old exchange-sync entry", () => {
    const at = (day: number) => Date.UTC(2024, 0, day, 12);
    const csv = buildPortfolioCsv([
      { id: 'p', kind: 'buy', amountSats: 1, date: at(1), createdAt: 1, source: 'bitvavo', sourceName: 'Bitvavo' },
      { id: 'q', kind: 'buy', amountSats: 1, date: at(2), createdAt: 1, source: 'p2p', sourceName: 'Peer to peer' },
      { id: 'r', kind: 'buy', amountSats: 1, date: at(3), createdAt: 1, source: 'other', sourceName: 'Bisq, the DEX' },
      // Written by the Kraken sync before entries carried a source.
      { id: 'kraken-T1', kind: 'buy', amountSats: 1, date: at(4), createdAt: 1 },
      { id: 's', kind: 'buy', amountSats: 1, date: at(5), createdAt: 1 },
    ]);
    const rows = csv.trim().split('\r\n').slice(1);
    expect(rows[0].endsWith(',,Bitvavo')).toBe(true);
    expect(rows[1].endsWith(',,Peer to peer')).toBe(true);
    expect(rows[2].endsWith(',,"Bisq, the DEX"')).toBe(true);
    expect(rows[3].endsWith(',,Kraken')).toBe(true);
    expect(rows[4].endsWith(',,,')).toBe(true);
  });
});

describe('buildPortfolioPdf', () => {
  const data = {
    vaultName: 'My Portfolio',
    generatedOn: '26 August 2026',
    summary: [
      { label: 'Balance', value: '0.61 BTC' },
      { label: 'Value now', value: '\u20ac48,295.48' },
    ],
    rows: portfolioPdfRows([sell, buy]),
  };

  it('is a structurally valid two-font branded PDF', () => {
    const text = latin1(buildPortfolioPdf(data));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/BaseFont /Helvetica-Bold');
    expect(text).toContain('(My Portfolio) Tj');
    expect(text).toContain('(alia) Tj'); // the wordmark
    expect(text).toContain('0.071 0.290 0.220 rg'); // brand green band
    expect(text).toContain('(\\200'); // € via WinAnsi in the summary
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xref, xref + 4)).toBe('xref');
  });

  it('paginates and marks continuation pages', () => {
    const many = { ...data, rows: Array.from({ length: 90 }, (_, i) => ({
      date: '2024-01-01', type: 'Bought', amount: `+${i}`, price: 'x', note: '',
    })) };
    const text = latin1(buildPortfolioPdf(many));
    expect(text).toContain('/Count 3');
    expect(text).toContain('(\\(continued\\)) Tj');
    expect(text).toContain('(Page 3 of 3) Tj');
  });

  it('rows carry price or the honest absence', () => {
    const text = latin1(buildPortfolioPdf(data));
    expect(text).toContain('(30,000 USD) Tj');
    expect(text).toContain('(no price recorded) Tj');
  });
});
