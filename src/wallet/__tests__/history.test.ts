import { withRunningBalance, groupIntoSections, buildLedger, dayKey } from '../history';
import type { WalletTx } from '../../bitcoin/engine/types';

const BTC = 100_000_000;

function tx(partial: Partial<WalletTx> & { netAmount: number }): WalletTx {
  const { netAmount } = partial;
  return {
    txid: Math.random().toString(16).slice(2).padEnd(64, '0'),
    received: netAmount > 0 ? netAmount : 0,
    sent: netAmount < 0 ? -netAmount : 0,
    confirmed: true,
    ...partial,
  };
}

// Unix seconds for fixed dates (UTC noon avoids local-midnight edge cases).
const JAN_10 = Date.UTC(2026, 0, 10, 12) / 1000;
const MAY_5 = Date.UTC(2026, 4, 5, 12) / 1000;

describe('withRunningBalance', () => {
  it("matches the user's example: 1 BTC on Jan 10 + 0.5 BTC on May 5", () => {
    // Newest first: May 5 (+0.5), then Jan 10 (+1.0). Current total 1.5 BTC.
    const txs = [
      tx({ netAmount: 0.5 * BTC, timestamp: MAY_5 }),
      tx({ netAmount: 1 * BTC, timestamp: JAN_10 }),
    ];
    const ledger = withRunningBalance(txs, 1.5 * BTC);
    expect(ledger[0].balanceAfter).toBe(1.5 * BTC); // as of May 5
    expect(ledger[1].balanceAfter).toBe(1.0 * BTC); // as of Jan 10
  });

  it('handles outgoing transactions', () => {
    // Newest: sent 30k; before that received 100k. Current total 70k.
    const txs = [tx({ netAmount: -30_000 }), tx({ netAmount: 100_000 })];
    const ledger = withRunningBalance(txs, 70_000);
    expect(ledger[0].balanceAfter).toBe(70_000);
    expect(ledger[1].balanceAfter).toBe(100_000);
  });

  it('is empty for no transactions', () => {
    expect(withRunningBalance([], 0)).toEqual([]);
  });
});

describe('groupIntoSections', () => {
  it('groups by day, newest first, with titles', () => {
    const ledger = withRunningBalance(
      [
        tx({ netAmount: 1000, timestamp: MAY_5 }),
        tx({ netAmount: 2000, timestamp: MAY_5 }),
        tx({ netAmount: 3000, timestamp: JAN_10 }),
      ],
      6000,
    );
    const sections = groupIntoSections(ledger);
    expect(sections).toHaveLength(2);
    expect(sections[0].key).toBe(dayKey(MAY_5));
    expect(sections[0].data).toHaveLength(2);
    expect(sections[0].title).toMatch(/May 2026/);
    expect(sections[1].title).toMatch(/January 2026/);
  });

  it('pins unconfirmed transactions in a leading Pending section', () => {
    const ledger = withRunningBalance(
      [
        tx({ netAmount: -500, confirmed: false }),
        tx({ netAmount: 1000, timestamp: MAY_5 }),
      ],
      500,
    );
    const sections = groupIntoSections(ledger);
    expect(sections[0].key).toBe('pending');
    expect(sections[0].data[0].netAmount).toBe(-500);
    expect(sections[1].title).toMatch(/May/);
  });

  it('keeps confirmed-but-undated transactions in an Earlier section', () => {
    const ledger = withRunningBalance([tx({ netAmount: 1000 })], 1000);
    const sections = groupIntoSections(ledger);
    expect(sections[0].key).toBe('earlier');
  });
});

describe('buildLedger', () => {
  it('returns both the flat ledger and its sections', () => {
    const { ledger, sections } = buildLedger(
      [tx({ netAmount: 1000, timestamp: MAY_5 })],
      { confirmed: 1000, trustedPending: 0, untrustedPending: 0, spendable: 1000, total: 1000 },
    );
    expect(ledger[0].balanceAfter).toBe(1000);
    expect(sections).toHaveLength(1);
  });
});
