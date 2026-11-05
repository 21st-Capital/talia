/**
 * The coin list's warning is true of the coin it sits on: a small coin from
 * this vault's own payment is not bait from a stranger (decided 2026-10-31
 * after a phone test).
 */
import { mayBeBait, ownPaymentIds } from '../baitWarning';
import type { WalletTx } from '../../bitcoin/engine/types';

const tx = (txid: string, sent: number, received: number): WalletTx => ({
  txid,
  sent,
  received,
  netAmount: received - sent,
  confirmed: true,
});

const history = [
  tx('payment', 50_000, 755), // paid someone, 755 sats came back
  tx('refresh', 20_000, 19_800), // a self-spend
  tx('stranger', 0, 755), // nothing of ours went in
];
const own = ownPaymentIds(history);

describe('the vault’s own payments', () => {
  it('are the transactions that spent its coins, and only those', () => {
    expect([...own].sort()).toEqual(['payment', 'refresh']);
  });

  it('are none for a history with nothing spent, or no history', () => {
    expect(ownPaymentIds([tx('deposit', 0, 90_000)]).size).toBe(0);
    expect(ownPaymentIds([]).size).toBe(0);
  });
});

describe('a small coin', () => {
  it('from the vault’s own payment is not bait', () => {
    expect(mayBeBait({ txid: 'payment', valueSats: 755 }, own)).toBe(false);
    expect(mayBeBait({ txid: 'refresh', valueSats: 755 }, own)).toBe(false);
  });

  it('from anyone else may be', () => {
    expect(mayBeBait({ txid: 'stranger', valueSats: 755 }, own)).toBe(true);
  });

  it('whose transaction is not in the history may be: nothing proves it is ours', () => {
    expect(mayBeBait({ txid: 'unseen', valueSats: 755 }, own)).toBe(true);
    expect(mayBeBait({ txid: 'unseen', valueSats: 755 }, new Set())).toBe(true);
  });

  it('stops being small at 1000 sats', () => {
    expect(mayBeBait({ txid: 'stranger', valueSats: 999 }, own)).toBe(true);
    expect(mayBeBait({ txid: 'stranger', valueSats: 1000 }, own)).toBe(false);
  });
});
