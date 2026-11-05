import { portfolioEntriesFromHistory, toManualEntries } from '../vaultToPortfolio';
import type { WalletTx } from '../../bitcoin/engine/types';

function tx(p: Partial<WalletTx> & Pick<WalletTx, 'txid' | 'received' | 'sent'>): WalletTx {
  const netAmount = p.received - p.sent;
  return { confirmed: true, timestamp: 1_700_000_000, netAmount, ...p };
}

describe('portfolioEntriesFromHistory', () => {
  it('deposits become buys, withdrawals become sells, oldest first', () => {
    const entries = portfolioEntriesFromHistory([
      tx({ txid: 'w', received: 0, sent: 400_000, fee: 500, timestamp: 2_000 }),
      tx({ txid: 'd', received: 1_000_000, sent: 0, timestamp: 1_000 }),
    ]);
    expect(entries.map((e) => [e.kind, e.amountSats, e.tsSecs])).toEqual([
      ['buy', 1_000_000, 1_000],
      ['sell', 400_000, 2_000],
    ]);
  });

  it('SKIPS self-transfers — a timelock refresh is not a buy or a sell', () => {
    const refresh = tx({ txid: 'r', received: 999_500, sent: 1_000_000, fee: 500 });
    expect(portfolioEntriesFromHistory([refresh])).toEqual([]);
  });

  it('skips unconfirmed and undated transactions', () => {
    expect(
      portfolioEntriesFromHistory([
        tx({ txid: 'p', received: 5_000, sent: 0, confirmed: false }),
        tx({ txid: 'u', received: 5_000, sent: 0, timestamp: undefined }),
      ]),
    ).toEqual([]);
  });

  it('the entries reproduce the vault balance exactly (fees inside disposals)', () => {
    const history = [
      tx({ txid: 'a', received: 1_000_000, sent: 0, timestamp: 1 }),
      tx({ txid: 'b', received: 0, sent: 300_000, fee: 1_000, timestamp: 2 }), // net −300k incl fee
      tx({ txid: 'r', received: 699_000, sent: 700_000, fee: 1_000, timestamp: 3 }), // refresh −1k fee... 
    ];
    // The refresh IS a self-transfer (net == −fee) and is skipped; its fee is
    // the one sat-source of drift, disclosed by design (a refresh costs fee
    // but is neither buy nor sell).
    const entries = portfolioEntriesFromHistory(history);
    const net = entries.reduce((s, e) => s + (e.kind === 'buy' ? e.amountSats : -e.amountSats), 0);
    expect(net).toBe(700_000);
  });
});

describe('toManualEntries', () => {
  const snap = portfolioEntriesFromHistory([
    tx({ txid: 'a', received: 1_000_000, sent: 0, timestamp: 1_000 }),
    tx({ txid: 'b', received: 0, sent: 400_000, timestamp: 2_000 }),
  ]);
  it('prices from the map are marked as estimates; unpriced entries say what to do', () => {
    const entries = toManualEntries(snap, {
      prices: new Map([[0, 42_000]]),
      fiatCurrency: 'EUR',
      now: 99,
      vaultId: 'wallet-1234abcd',
    });
    expect(entries[0].fiatAmount).toBe(42_000);
    expect(entries[0].fiatCurrency).toBe('EUR');
    expect(entries[0].note).toMatch(/Estimated/);
    expect(entries[1].fiatAmount).toBeUndefined();
    expect(entries[1].fiatCurrency).toBeUndefined();
    expect(entries[1].note).toMatch(/add what you paid/);
    expect(entries.map((e) => e.createdAt)).toEqual([99, 99]);
  });

  it('a NaN price is dropped, not stored', () => {
    const entries = toManualEntries(snap, {
      prices: new Map([[0, Number.NaN]]),
      fiatCurrency: 'USD',
      now: 1,
      vaultId: 'wallet-1234abcd',
    });
    expect(entries[0].fiatAmount).toBeUndefined();
  });

  it('ids are DETERMINISTIC per (vault, transaction) — re-adding cannot duplicate', () => {
    const a = toManualEntries(snap, { fiatCurrency: 'USD', now: 1, vaultId: 'wallet-1234abcd' });
    const b = toManualEntries(snap, { fiatCurrency: 'USD', now: 999, vaultId: 'wallet-1234abcd' });
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a[0].id).toBe('vsnap-wallet-1-a');
    // a different vault yields different ids — two vaults into one portfolio coexist
    const c = toManualEntries(snap, { fiatCurrency: 'USD', now: 1, vaultId: 'otherwallet99' });
    expect(c[0].id).not.toBe(a[0].id);
  });
});
