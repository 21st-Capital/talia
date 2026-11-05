/**
 * The portfolio statement. The traps pinned here are the ones that put a
 * WRONG NUMBER on a document a client hands to an accountant: a period that
 * forgets what came before it, a fiat total that quietly includes a currency
 * we could not convert, and a balance the two formats disagree on.
 */
import type { ManualEntry } from '../manualLedger';
import {
  buildPortfolioStatementCsv,
  buildPortfolioStatementDocument,
  portfolioStatementData,
  portfolioStatementRows,
  type PortfolioStatementInput,
} from '../portfolioStatement';

const at = (y: number, m: number, d: number): number => new Date(y, m - 1, d, 12).getTime();

const entry = (over: Partial<ManualEntry> & { id: string }): ManualEntry => ({
  kind: 'buy',
  amountSats: 1_000_000,
  date: at(2026, 6, 1),
  createdAt: at(2026, 6, 1),
  ...over,
});

const base = (over: Partial<PortfolioStatementInput> = {}): PortfolioStatementInput => ({
  portfolioName: 'Family stash',
  entries: [],
  currency: 'EUR',
  period: { start: '', end: '' },
  today: '2026-08-28',
  generatedOn: '2026-08-28',
  lang: 'en',
  ...over,
});

const HISTORY: ManualEntry[] = [
  entry({ id: 'a', date: at(2026, 5, 10), amountSats: 5_000_000, fiatAmount: 2000, fiatCurrency: 'EUR' }),
  entry({ id: 'b', date: at(2026, 7, 4), amountSats: 3_000_000, fiatAmount: 1500, fiatCurrency: 'EUR' }),
  entry({ id: 'c', date: at(2026, 7, 20), kind: 'sell', amountSats: 1_000_000, fiatAmount: 700, fiatCurrency: 'EUR' }),
  entry({ id: 'd', date: at(2026, 8, 2), amountSats: 2_000_000 }),
];

describe('portfolioStatementData', () => {
  it('opens on what the portfolio already held before the period', () => {
    const d = portfolioStatementData(
      base({ entries: HISTORY, period: { start: '2026-07-01', end: '2026-07-31' } }),
    );
    // Only the May buy precedes July.
    expect(d.openingBalance).toBe(5_000_000);
    expect(d.count).toBe(2);
    expect(d.closingBalance).toBe(5_000_000 + 3_000_000 - 1_000_000);
    expect(d.showOpening).toBe(true);
  });

  it('adds up the way the summary box invites a reader to check', () => {
    for (const period of [{ start: '', end: '' }, { start: '2026-07-01', end: '2026-08-31' }]) {
      const d = portfolioStatementData(base({ entries: HISTORY, period }));
      expect(d.openingBalance + d.boughtSats - d.soldSats).toBe(d.closingBalance);
    }
  });

  it('an all-time statement opens at zero and prints no opening line', () => {
    const d = portfolioStatementData(base({ entries: HISTORY }));
    expect(d.openingBalance).toBe(0);
    expect(d.showOpening).toBe(false);
    expect(d.closingBalance).toBe(9_000_000);
  });

  it('never counts a currency it could not convert, and says how many', () => {
    const mixed = [
      entry({ id: 'x', fiatAmount: 1000, fiatCurrency: 'EUR' }),
      entry({ id: 'y', fiatAmount: 1200, fiatCurrency: 'USD' }),
    ];
    const without = portfolioStatementData(base({ entries: mixed }));
    expect(without.paidFiat).toBe(1000);
    expect(without.unconverted).toBe(1);
    // With the day's conversion supplied, it counts and stops being disclosed.
    const withFx = portfolioStatementData(
      base({ entries: mixed, fx: new Map([['y', 1100]]) }),
    );
    expect(withFx.paidFiat).toBe(2100);
    expect(withFx.unconverted).toBe(0);
  });

  it('a sell shows as a negative amount, never a bare number', () => {
    const rows = portfolioStatementRows(base({ entries: HISTORY }));
    const sell = rows.find((r) => r.type === 'Sold')!;
    expect(sell.amount.startsWith('-')).toBe(true);
    const buy = rows.find((r) => r.type === 'Bought')!;
    expect(buy.amount.startsWith('+')).toBe(true);
  });
});

describe('the statement reads forwards in time', () => {
  it('lists the oldest entry first and walks the balance from there', () => {
    // sortManualEntries is NEWEST-first because that is how the app lists a
    // portfolio. Taken that way round, every running balance is wrong: the
    // first render of this document opened at -0.01 BTC on a portfolio that
    // never went negative.
    const rows = portfolioStatementRows(base({ entries: HISTORY })).filter((r) => !r.span);
    const dates = rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
    const balances = rows.map((r) => Number(r.balance));
    expect(balances.every((b) => b >= 0)).toBe(true);
    // Each balance is the one before it plus that row's amount.
    let running = 0;
    rows.forEach((r) => {
      running += Number(r.amount);
      expect(Number(r.balance)).toBeCloseTo(running, 8);
    });
  });

  it('closes on the balance the last row leaves behind', () => {
    const rows = portfolioStatementRows(base({ entries: HISTORY }));
    const last = rows[rows.length - 1];
    const lastEntry = rows.filter((r) => !r.span).pop()!;
    expect(last.span).toBe(true);
    expect(last.balance).toBe(lastEntry.balance);
  });
});

describe('the two formats agree', () => {
  it('closes on the same balance in the PDF and the CSV', () => {
    const input = base({ entries: HISTORY, period: { start: '2026-07-01', end: '2026-08-31' } });
    const data = portfolioStatementData(input);
    const csv = buildPortfolioStatementCsv(input);
    const lastCsv = csv.trim().split('\r\n').pop()!;
    expect(lastCsv).toContain((data.closingBalance / 1e8).toFixed(8));
    const pdf = Buffer.from(buildPortfolioStatementDocument(input)).toString('latin1');
    expect(pdf).toContain((data.closingBalance / 1e8).toFixed(8));
  });

  it('carries the value in the currency it was recorded in', () => {
    const input = base({ entries: HISTORY });
    const csv = buildPortfolioStatementCsv(input);
    expect(csv).toContain('2000,EUR');
    const rows = portfolioStatementRows(input);
    expect(rows.some((r) => r.fee === '2,000.00 EUR')).toBe(true);
    // An entry with no price recorded leaves the cell empty rather than 0.
    expect(rows.some((r) => r.fee === '')).toBe(true);
  });
});

describe('it says what it is', () => {
  it('states on the document that this is not an on-chain vault', () => {
    const text = Buffer.from(
      buildPortfolioStatementDocument(base({ entries: HISTORY })),
    ).toString('latin1');
    expect(text).toContain('not an on-chain vault');
    expect(text).toContain('Virtual portfolio');
    // And in German.
    const de = Buffer.from(
      buildPortfolioStatementDocument(base({ entries: HISTORY, lang: 'de' })),
    ).toString('latin1');
    expect(de).toContain('kein On-Chain-Vault');
  });

  it('says it on the spreadsheet too, before the header', () => {
    // A CSV gets forwarded on its own, with no letterhead to explain it.
    const csv = buildPortfolioStatementCsv(base({ entries: HISTORY }));
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('not an on-chain vault');
    // The header still starts the table, so a spreadsheet reads the columns.
    expect(lines[2].startsWith('DATE')).toBe(true);
  });
});

describe('buildPortfolioStatementDocument', () => {
  it('is the same document as a vault statement, with the portfolio name', () => {
    const text = Buffer.from(
      buildPortfolioStatementDocument(base({ entries: HISTORY })),
    ).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Portfolio statement');
    expect(text).toContain('Family stash');
    expect(text).toContain('STATEMENT SUMMARY');
    expect(text).toContain('powered by 21st Capital');
    expect(text).toContain('Twenty First Capital Cyber Security Consultancy L.L.C');
    // Nothing mangled into '?' by the Latin-1 encoder. The help line has a
    // real question mark in it, so it is excluded rather than the check
    // being dropped.
    expect(text.replace('Need help?', '')).not.toContain('?');
  });

  it('speaks German when asked, umlauts intact', () => {
    const text = Buffer.from(
      buildPortfolioStatementDocument(base({ entries: HISTORY, lang: 'de' })),
    ).toString('latin1');
    expect(text).toContain('Portfolio-Kontoauszug');
    expect(text).toContain('Gekauft');
    expect(text).toContain('W\xe4hrung');
    expect(text).toContain('Gezahlt insgesamt');
    expect(text.replace('Fragen?', '')).not.toContain('?');
  });

  it('says so plainly when the period holds nothing', () => {
    const text = Buffer.from(
      buildPortfolioStatementDocument(
        base({ entries: HISTORY, period: { start: '2026-01-01', end: '2026-01-31' } }),
      ),
    ).toString('latin1');
    expect(text).toContain('No entries in this period.');
  });
});

describe('the source of each entry (decided 2026-10-22)', () => {
  const SOURCED: ManualEntry[] = [
    entry({ id: 's1', date: at(2026, 7, 1), source: 'bitpanda', sourceName: 'Bitpanda' }),
    entry({ id: 's2', date: at(2026, 7, 2), source: 'p2p', sourceName: 'Peer to peer' }),
    entry({ id: 's3', date: at(2026, 7, 3), source: 'other', sourceName: 'ATM, Zurich' }),
    entry({ id: 'kraken-T1', date: at(2026, 7, 4) }),
    entry({ id: 's5', date: at(2026, 7, 5) }),
  ];

  it('is the last column of the CSV, so every older column keeps its place', () => {
    const lines = buildPortfolioStatementCsv(base({ entries: SOURCED, period: { start: '2026-07-01', end: '' } })).trim().split('\r\n');
    const header = lines[2].split(',');
    expect(header[header.length - 1]).toBe('Source');
    expect(header.slice(0, -1)).toEqual([
      'DATE', 'TYPE', 'Amount (BTC)', 'Amount (sats)', 'Value', 'Currency', 'Balance (BTC)', 'Balance (sats)', 'Note',
    ]);
    const body = lines.slice(3);
    // Opening balance, five entries, closing balance: one cell per column.
    expect(body).toHaveLength(7);
    expect(body[0].split(',')).toHaveLength(header.length);
    expect(body[1].endsWith(',Bitpanda')).toBe(true);
    expect(body[2].endsWith(',Peer to peer')).toBe(true);
    expect(body[3].endsWith(',"ATM, Zurich"')).toBe(true);
    expect(body[4].endsWith(',Kraken')).toBe(true);
    expect(body[5].endsWith(',,')).toBe(true);
    expect(body[6].split(',')).toHaveLength(header.length);
  });

  it('is a line of its own under the entry on the PDF, in the statement\'s language', () => {
    const en = portfolioStatementRows(base({ entries: SOURCED })).filter((r) => !r.span);
    expect(en.map((r) => r.sub)).toEqual(['Source: Bitpanda', 'Source: Peer to peer', 'Source: ATM, Zurich', 'Source: Kraken', undefined]);
    const de = portfolioStatementRows(base({ entries: SOURCED, lang: 'de' })).filter((r) => !r.span);
    expect(de.map((r) => r.sub)).toEqual(['Quelle: Bitpanda', 'Quelle: Peer-to-Peer', 'Quelle: ATM, Zurich', 'Quelle: Kraken', undefined]);
    const pdf = Buffer.from(buildPortfolioStatementDocument(base({ entries: SOURCED }))).toString('latin1');
    expect(pdf).toContain('Source: Bitpanda');
  });
});
