/**
 * The Vault Account Statement (decided 2026-08-28). The traps pinned here: a
 * REFRESH must never read as a payment (its net change IS the fee), a period
 * statement must open on the balance the vault already held, the running
 * balance must never go impossibly negative, the PDF and the CSV must agree
 * on every figure, and the German document must not mangle a single umlaut.
 */
import type { WalletTx } from '../../bitcoin/engine/types';
import {
  buildStatementCsv,
  buildStatementDocument,
  periodLabel,
  statementData,
  statementRows,
  txKind,
  type StatementInput,
} from '../txReport';
import { presetPeriod, splitByPeriod } from '../statementPeriod';
import { statementStrings } from '../statementText';
import { textWidth } from '../pdfKit';

const TXID_A = 'a'.repeat(64);
const TXID_B = 'b'.repeat(64);
const TXID_C = 'c'.repeat(64);

/** 2026-08-20 12:00 local. Built from parts so the test is timezone-proof. */
const at = (y: number, m: number, d: number, h = 12): number =>
  Math.floor(new Date(y, m - 1, d, h, 0, 0).getTime() / 1000);

const received: WalletTx = {
  txid: TXID_A,
  received: 100_000,
  sent: 0,
  netAmount: 100_000,
  fee: 200,
  confirmed: true,
  timestamp: at(2026, 8, 10),
};
const sent: WalletTx = {
  txid: TXID_B,
  received: 40_000,
  sent: 60_000,
  netAmount: -20_000,
  fee: 300,
  confirmed: true,
  timestamp: at(2026, 8, 20),
};
// Everything that left came back — net change is exactly the fee.
const refresh: WalletTx = {
  txid: TXID_C,
  received: 99_800,
  sent: 100_000,
  netAmount: -200,
  fee: 200,
  confirmed: true,
  timestamp: at(2026, 8, 25),
};

const base = (over: Partial<StatementInput> = {}): StatementInput => ({
  vaultName: 'Test Vault',
  policy: '2 of 3 keys',
  network: 'Bitcoin',
  txs: [received, sent, refresh],
  notes: {},
  period: { start: '', end: '' },
  today: '2026-08-28',
  generatedOn: '2026-08-28',
  lang: 'en',
  foldRefreshDays: false,
  timelocked: true,
  ...over,
});

const csvRows = (csv: string): string[][] =>
  csv
    .trim()
    .split('\r\n')
    .map((r) => r.split(','));

describe('txKind', () => {
  it('names each kind, refresh included', () => {
    expect(txKind(received, true)).toBe('Received');
    expect(txKind(sent, true)).toBe('Sent');
    expect(txKind(refresh, true)).toBe('Refresh');
  });

  it('calls a send to itself "Sent" on a vault with no clock, as the vault page does', () => {
    // Decided 2026-09-22: plain multisig and single-sig have nothing to
    // refresh, and the vault page and the transaction screen say "Sent".
    expect(txKind(refresh, false)).toBe('Sent');
    expect(txKind(received, false)).toBe('Received');
    expect(txKind(sent, false)).toBe('Sent');
  });

  it('never folds or names a refresh on a vault with no clock', () => {
    const input = base({ txs: [received, refresh], timelocked: false, foldRefreshDays: true });
    const data = statementData(input);
    expect(data.entries.every((e) => e.kind === 'tx')).toBe(true);
    // Still no money out: only the fee left the vault.
    expect(data.sent).toBe(0);
    expect(data.fees).toBe(200);
    const s = statementStrings('en');
    expect(statementRows(input).map((r) => r.type)).not.toContain(s.refresh);
    expect(csvRows(buildStatementCsv(input)).map((r) => r[2])).not.toContain(s.refresh);
  });
});

describe('presetPeriod', () => {
  it('resolves each preset as calendar windows, the way a bank does', () => {
    expect(presetPeriod('today', '2026-08-28')).toEqual({
      start: '2026-08-28',
      end: '2026-08-28',
    });
    expect(presetPeriod('yesterday', '2026-08-28')).toEqual({
      start: '2026-08-27',
      end: '2026-08-27',
    });
    expect(presetPeriod('lastMonth', '2026-08-28')).toEqual({
      start: '2026-07-01',
      end: '2026-07-31',
    });
    // Q3 today → Q2 last.
    expect(presetPeriod('lastQuarter', '2026-08-28')).toEqual({
      start: '2026-04-01',
      end: '2026-06-30',
    });
    expect(presetPeriod('lastYear', '2026-08-28')).toEqual({
      start: '2025-01-01',
      end: '2025-12-31',
    });
    expect(presetPeriod('all', '2026-08-28')).toEqual({ start: '', end: '' });
  });

  it('steps over year and quarter boundaries', () => {
    expect(presetPeriod('yesterday', '2026-01-01').start).toBe('2025-12-31');
    expect(presetPeriod('lastMonth', '2026-01-15')).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    });
    // Q1 today → Q4 of the previous year.
    expect(presetPeriod('lastQuarter', '2026-02-10')).toEqual({
      start: '2025-10-01',
      end: '2025-12-31',
    });
    // February's length is not guessed.
    expect(presetPeriod('lastMonth', '2024-03-05').end).toBe('2024-02-29');
  });
});

describe('splitByPeriod', () => {
  it('folds everything before the window into the opening balance', () => {
    const split = splitByPeriod([received, sent, refresh], {
      start: '2026-08-15',
      end: '2026-08-31',
    }, '2026-08-28');
    expect(split.openingBalance).toBe(100_000); // the 10 August receive
    expect(split.inPeriod).toHaveLength(2);
  });

  it('keeps a pending transaction only in a window that reaches today', () => {
    const pending: WalletTx = {
      txid: TXID_A,
      received: 5_000,
      sent: 0,
      netAmount: 5_000,
      confirmed: false,
    };
    const now = splitByPeriod([pending], { start: '2026-08-01', end: '2026-08-28' }, '2026-08-28');
    expect(now.inPeriod).toHaveLength(1);
    const past = splitByPeriod([pending], { start: '2026-07-01', end: '2026-07-31' }, '2026-08-28');
    expect(past.inPeriod).toHaveLength(0);
    expect(past.openingBalance).toBe(0); // it has not happened yet
  });

  it('treats a confirmed transaction with no date as already in the vault', () => {
    const undated: WalletTx = {
      txid: TXID_B,
      received: 7_000,
      sent: 0,
      netAmount: 7_000,
      confirmed: true,
    };
    const period = splitByPeriod([undated], { start: '2026-08-01', end: '2026-08-28' }, '2026-08-28');
    expect(period.openingBalance).toBe(7_000);
    expect(period.inPeriod).toHaveLength(0);
    // An all-time statement has no "before", so it belongs in the table.
    const all = splitByPeriod([undated], { start: '', end: '' }, '2026-08-28');
    expect(all.openingBalance).toBe(0);
    expect(all.inPeriod).toHaveLength(1);
  });

  it('drops transactions after the window', () => {
    const split = splitByPeriod([received, sent, refresh], {
      start: '2026-08-01',
      end: '2026-08-15',
    }, '2026-08-28');
    expect(split.inPeriod).toHaveLength(1);
    expect(split.excluded).toBe(2);
  });
});

describe('statementData', () => {
  it('opens at zero and closes on the vault balance for an all-time statement', () => {
    const data = statementData(base());
    expect(data.openingBalance).toBe(0);
    expect(data.closingBalance).toBe(100_000 - 20_000 - 200);
    expect(data.entries.map((e) => e.balance)).toEqual([100_000, 80_000, 79_800]);
  });

  it('carries the opening balance into every later balance', () => {
    const data = statementData(base({ period: { start: '2026-08-15', end: '2026-08-31' } }));
    expect(data.openingBalance).toBe(100_000);
    expect(data.showOpening).toBe(true);
    // The 10 August receive is not a row, but its money is in every balance.
    expect(data.entries.map((e) => e.balance)).toEqual([80_000, 79_800]);
    expect(data.closingBalance).toBe(79_800);
  });

  it('never counts a refresh as money in or out, only its fee', () => {
    const data = statementData(base({ txs: [refresh] }));
    expect(data.received).toBe(0);
    expect(data.sent).toBe(0);
    expect(data.fees).toBe(200);
  });

  it('never starts below zero when a same-block receive funds a send', () => {
    const stamp = at(2026, 8, 11);
    const inFirst: WalletTx = { ...received, timestamp: stamp, netAmount: 62_958, received: 62_958 };
    const outSecond: WalletTx = { ...sent, timestamp: stamp, netAmount: -12_990 };
    for (const foldRefreshDays of [false, true]) {
      const data = statementData(base({ txs: [outSecond, inFirst], foldRefreshDays }));
      expect(data.entries[0].balance).toBe(62_958);
      expect(data.entries.every((e) => e.balance >= 0)).toBe(true);
    }
  });

  it('adds up the way the summary box invites a reader to check', () => {
    // opening + received - sent - fees = closing. This failed while the fee
    // on an INCOMING payment (paid by the sender, not by this vault) was
    // counted as a fee the vault paid.
    for (const period of [
      { start: '', end: '' },
      { start: '2026-08-15', end: '2026-08-31' },
    ]) {
      for (const foldRefreshDays of [false, true]) {
        const d = statementData(base({ period, foldRefreshDays }));
        expect(d.openingBalance + d.received - d.sent - d.fees).toBe(d.closingBalance);
      }
    }
  });

  it('never drives a folded day negative before that day’s money arrives', () => {
    // A big refresh in the evening, funded by a payment that arrived at
    // midday: folding the day's fees onto its FIRST refresh charged them
    // hours early and showed a balance the vault never had.
    const refreshAt = (txid: string, ts: number, fee: number): WalletTx => ({
      txid,
      received: 1_000_000,
      sent: 1_000_000 + fee,
      netAmount: -fee,
      fee,
      confirmed: true,
      timestamp: ts,
    });
    const txs: WalletTx[] = [
      { ...received, netAmount: 60_000, received: 60_000, timestamp: at(2026, 8, 1) },
      refreshAt('b'.repeat(64), at(2026, 8, 25, 9), 2_500),
      { ...received, txid: 'c'.repeat(64), netAmount: 5_000_000, received: 5_000_000, timestamp: at(2026, 8, 25, 12) },
      refreshAt('d'.repeat(64), at(2026, 8, 25, 19), 90_000),
    ];
    const folded = statementData(base({ txs, foldRefreshDays: true }));
    expect(folded.entries.every((e) => e.balance >= 0)).toBe(true);
    // And it still closes exactly where the unfolded statement does.
    expect(folded.closingBalance).toBe(statementData(base({ txs })).closingBalance);
  });

  it('folds each day’s refreshes into one line of combined fees', () => {
    const day = (h: number): WalletTx => ({
      ...refresh,
      txid: `${h}`.repeat(64).slice(0, 64),
      timestamp: at(2026, 8, 25, h),
      netAmount: -100,
      fee: 100,
    });
    const data = statementData(base({ txs: [received, day(9), day(10), day(11)], foldRefreshDays: true }));
    const folded = data.entries.filter((e) => e.kind === 'refreshDay');
    expect(folded).toHaveLength(1);
    expect(folded[0].kind === 'refreshDay' && folded[0].group.count).toBe(3);
    expect(data.closingBalance).toBe(100_000 - 300);
    // The unfolded statement must reach the very same closing balance.
    const flat = statementData(base({ txs: [received, day(9), day(10), day(11)] }));
    expect(flat.closingBalance).toBe(data.closingBalance);
  });
});

describe('buildStatementCsv', () => {
  it('carries both units, the full id, and a closing line', () => {
    const rows = csvRows(buildStatementCsv(base({ notes: { [TXID_A]: 'salary' } })));
    expect(rows[0].join(',')).toContain('Transaction ID');
    expect(rows[1]).toContain(TXID_A);
    expect(rows[1]).toContain('+0.00100000');
    expect(rows[1]).toContain('salary');
    // Balance columns (indexes 7 and 8) walk with the transactions.
    expect(rows.slice(1, 4).map((r) => r[7])).toEqual(['0.00100000', '0.00080000', '0.00079800']);
    const last = rows[rows.length - 1];
    expect(last[2]).toBe('Closing balance');
    expect(last[7]).toBe('0.00079800');
  });

  it('prints an opening balance line for a period statement', () => {
    const rows = csvRows(
      buildStatementCsv(base({ period: { start: '2026-08-15', end: '2026-08-31' } })),
    );
    expect(rows[1][2]).toBe('Opening balance');
    expect(rows[1][7]).toBe('0.00100000');
    expect(rows[1][0]).toBe('2026-08-15');
  });

  it('quotes a note containing a comma', () => {
    const csv = buildStatementCsv(base({ notes: { [TXID_B]: 'rent, June' } }));
    expect(csv).toContain('"rent, June"');
  });

  it('marks an unconfirmed transaction pending and leaves its date empty', () => {
    const pending: WalletTx = { ...received, confirmed: false, timestamp: undefined };
    const rows = csvRows(buildStatementCsv(base({ txs: [pending] })));
    expect(rows[1][0]).toBe('');
    expect(rows[1][9]).toBe('Pending');
  });

  it('agrees with the PDF line for line, opening and closing included', () => {
    for (const period of [
      { start: '2026-08-15', end: '2026-08-31' },
      { start: '', end: '' },
    ]) {
      for (const foldRefreshDays of [false, true]) {
        const input = base({ period, foldRefreshDays });
        const csv = csvRows(buildStatementCsv(input)).slice(1); // drop the header
        const pdf = statementRows(input);
        expect(pdf).toHaveLength(csv.length);
        pdf.forEach((row, i) => {
          expect(row.balance).toBe(csv[i][7]);
        });
      }
    }
  });
});

describe('buildStatementDocument', () => {
  const render = (over: Partial<StatementInput> = {}): string =>
    Buffer.from(buildStatementDocument(base(over))).toString('latin1');

  it('is a valid PDF naming the issuer, the vault and the period', () => {
    const text = render();
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('Test Vault');
    expect(text).toContain('Vault account statement');
    // The company behind Talia, as published on its legal page.
    expect(text).toContain('Twenty First Capital Cyber Security Consultancy L.L.C');
    expect(text).toContain('Dubai, UAE');
    expect(text).toContain('1466284');
    expect(text).toContain('powered by 21st Capital');
    expect(text).toContain('2 of 3 keys');
  });

  it('shows the summary box with opening and closing balance', () => {
    const text = render({ period: { start: '2026-08-15', end: '2026-08-31' } });
    expect(text).toContain('STATEMENT SUMMARY');
    expect(text).toContain('Opening balance');
    expect(text).toContain('Closing balance');
    expect(text).toContain('0.00100000 BTC'); // opening
    expect(text).toContain('0.00079800 BTC'); // closing
  });

  it('prints the full transaction ids, unmangled', () => {
    const text = render();
    expect(text).toContain(TXID_A);
    expect(text).toContain(TXID_C);
    // The ONLY question marks a statement may contain are the ones we wrote.
    expect(text.match(/\?/g) ?? []).toHaveLength(1); // "Need help?"
  });

  it('says so plainly when the period holds nothing', () => {
    const text = render({ period: { start: '2026-01-01', end: '2026-01-31' } });
    expect(text).toContain('No transactions in this period.');
  });

  it('renders German without mangling a single umlaut', () => {
    const text = render({ lang: 'de' });
    expect(text).toContain('Kontoauszug des Vaults');
    expect(text).toContain('Anfangsbestand');
    expect(text).toContain('Endbestand');
    expect(text).toContain('GEBÜHR');
    expect(text).toContain('Netzwerkgebühren');
    expect(text).toContain('Gewerbelizenz-Nr.');
    // Nothing degraded to a '?': the only one is the help line's own.
    expect(text.match(/\?/g) ?? []).toHaveLength(1); // "Fragen?"
  });

  // Decided 2026-09-21: one German word for what a client owns, "Vault".
  it('says Vault in German, never Tresor', () => {
    const de = statementStrings('de');
    // Several entries are functions that build a whole sentence, which is
    // exactly where the old word is likeliest to come back. Call them, so
    // what a client reads is what the scan sees.
    const args: Record<string, unknown[]> = {
      refreshDay: [2],
      otherCurrencyNote: [2, 'EUR'],
      page: [1, 3],
      longDate: ['2026-09-21'],
    };
    for (const [key, value] of Object.entries(de)) {
      const text =
        typeof value === 'function'
          ? (value as (...a: unknown[]) => string)(...(args[key] ?? []))
          : value;
      expect(typeof text).toBe('string');
      expect(text).not.toMatch(/Tresor/);
    }
    expect(de.refreshDay(1)).toContain('Auffrischung');
    expect(de.longDate('2026-09-21')).toBe('21. September 2026');
    expect(de.vault).toBe('Vault');
    expect(de.title).toBe('Kontoauszug des Vaults');
  });

  it('carries umlauts in a vault name straight through to the document', () => {
    const text = render({ vaultName: 'Großmutters Tresor für Übergabe' });
    expect(text).toContain('Großmutters Tresor für Übergabe');
  });

  it('writes German dates the German way in the table', () => {
    const rows = statementRows(base({ lang: 'de' }));
    expect(rows[0].date).toBe('10.08.2026');
    expect(statementRows(base()).at(0)?.date).toBe('2026-08-10');
  });

  it('stays one page for a long history rather than truncating rows', () => {
    const many: WalletTx[] = Array.from({ length: 120 }, (_, i) => ({
      ...received,
      txid: String(i).padStart(64, '0'),
      timestamp: at(2026, 8, 10) + i * 3600,
    }));
    const text = render({ txs: many });
    expect(text).toContain(String(119).padStart(64, '0'));
    expect((text.match(/\/Type \/Page[^s]/g) ?? []).length).toBeGreaterThan(1);
  });
});

describe('periodLabel', () => {
  it('reads as a document heading in both languages', () => {
    expect(periodLabel({ start: '', end: '' }, 'en')).toBe('All time');
    expect(periodLabel({ start: '', end: '' }, 'de')).toBe('Gesamter Zeitraum');
    expect(periodLabel({ start: '2026-08-01', end: '2026-08-28' }, 'en')).toBe(
      '1 August 2026 - 28 August 2026',
    );
    expect(periodLabel({ start: '2026-03-01', end: '2026-03-31' }, 'de')).toBe(
      '1. März 2026 - 31. März 2026',
    );
    // A one-day statement says the day once.
    expect(periodLabel({ start: '2026-08-28', end: '2026-08-28' }, 'en')).toBe('28 August 2026');
  });

  it('says a half-open window is open, instead of looking like one day', () => {
    // These two used to render identically, so an open-ended statement was
    // indistinguishable from a single day's.
    expect(periodLabel({ start: '2026-08-01', end: '' }, 'en')).toBe('From 1 August 2026');
    expect(periodLabel({ start: '', end: '2026-08-15' }, 'en')).toBe('Until 15 August 2026');
    expect(periodLabel({ start: '2026-08-01', end: '' }, 'de')).toBe('Ab 1. August 2026');
    expect(periodLabel({ start: '', end: '2026-08-15' }, 'de')).toBe('Bis 15. August 2026');
    expect(periodLabel({ start: '2026-08-01', end: '' }, 'en')).not.toBe(
      periodLabel({ start: '2026-08-01', end: '2026-08-01' }, 'en'),
    );
  });
});

describe('layout under hostile content', () => {
  /** Every string the PDF draws, with the x it starts at and its size. */
  const draws = (bytes: Uint8Array): Array<{ x: number; y: number; size: number; str: string }> => {
    const text = Buffer.from(bytes).toString('latin1');
    const out: Array<{ x: number; y: number; size: number; str: string }> = [];
    const re = /\/F\d ([\d.]+) Tf [^(]*?([\d.]+) ([\d.]+) Td \((.*?)\) Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ size: Number(m[1]), x: Number(m[2]), y: Number(m[3]), str: m[4] });
    }
    return out;
  };
  const hostile = {
    vaultName: 'Familie Beispiel langfristige Bitcoin-Ersparnisse Kaltlager 2026',
    policy: '15 von 15 Schlüsseln, 14 Wiederherstellungspfade',
  };

  it('keeps every drawn string inside the page, however long the content', () => {
    for (const lang of ['en', 'de'] as const) {
      const bytes = buildStatementDocument(
        base({
          ...hostile,
          lang,
          notes: { [TXID_A]: 'x'.repeat(300) },
          txs: [received, sent, refresh],
        }),
      );
      for (const d of draws(bytes)) {
        // Every string is emitted with x as its LEFT edge (right-aligned
        // text is positioned by measured width before it is drawn), so the
        // invariant is simply: nothing crosses the page's right margin.
        expect(d.x).toBeGreaterThanOrEqual(0);
        expect(d.x + textWidth(d.str, d.size)).toBeLessThanOrEqual(595 - 48 + 0.5);
      }
    }
  });

  it('never lets an identity cell run into the value beside it', () => {
    for (const lang of ['en', 'de'] as const) {
      const bytes = buildStatementDocument(base({ ...hostile, lang }));
      const all = draws(bytes);
      // The grid rows are the only 5 cells drawn at 7-8.5pt above the panel.
      const byRow = new Map<number, Array<{ x: number; size: number; str: string }>>();
      for (const d of all) {
        if (d.size > 8.5 || d.y < 560) continue;
        const row = byRow.get(d.y) ?? [];
        row.push(d);
        byRow.set(d.y, row);
      }
      for (const row of byRow.values()) {
        const sorted = [...row].sort((a, b) => a.x - b.x);
        for (let i = 0; i + 1 < sorted.length; i++) {
          const endsAt = sorted[i].x + textWidth(sorted[i].str, sorted[i].size);
          expect(endsAt).toBeLessThanOrEqual(sorted[i + 1].x);
        }
      }
    }
  });
});

// The account number is a made-up placeholder.
describe('the 21st Capital account number', () => {
  it('appears only when the vault has one', () => {
    const withNumber = Buffer.from(
      buildStatementDocument(base({ accountNumber: 'P-000000' })),
    ).toString('latin1');
    expect(withNumber).toContain('Account number');
    expect(withNumber).toContain('P-000000');
    // A purely self-custodial vault has no account with us, and the line is
    // left out rather than filled with something invented (decided 2026-08-28).
    const without = Buffer.from(buildStatementDocument(base())).toString('latin1');
    expect(without).not.toContain('Account number');
  });

  it('says it in German too, and still fits its column', () => {
    const bytes = buildStatementDocument(
      base({ lang: 'de', accountNumber: 'P-000000', vaultName: 'Familie Beispiel Kaltlager' }),
    );
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).toContain('Kontonummer');
    expect(text).toContain('P-000000');
  });
});
