/**
 * The figure the signing screen hands the co-sign request, the parked
 * pending record and so the Pending row (decided 2026-09-28 for Speed up and Cancel:
 * a cancel leads with the cancelled PAYMENT, and a sped-up return is the
 * same cancel; decided 2026-10-02).
 */
import { cosignAmount, isSpedUpReturn } from '../cosignAmount';

/** A payment of 0.05 BTC with 0.0295 BTC of change. */
const PAYMENT = [
  { isOwn: false, amountSats: 5_000_000 },
  { isOwn: true, amountSats: 2_950_000 },
];
/** Every coin back to the vault (a cancel, its speed-up, a refresh): 0.0799 BTC. */
const DRAIN = [{ isOwn: true, amountSats: 7_990_000 }];

describe('cosignAmount', () => {
  it('a payment leads with what the recipient gets', () => {
    expect(cosignAmount({ replaces: undefined, returnSats: null, outputs: PAYMENT })).toBe(5_000_000);
    // An output BDK did not mark is not the vault's.
    expect(cosignAmount({ replaces: undefined, returnSats: null, outputs: [{ amountSats: 1_000 }] })).toBe(1_000);
  });

  it('a refresh leads with what it moves', () => {
    expect(cosignAmount({ replaces: undefined, returnSats: null, outputs: [...DRAIN, { isOwn: true, amountSats: 10 }] })).toBe(
      7_990_010,
    );
  });

  it('a cancel leads with the payment it cancels, never the coins coming back', () => {
    const replaces = { kind: 'cancel' as const, amountSats: 5_000_000, what: 'payment' as const };
    expect(cosignAmount({ replaces, returnSats: null, outputs: DRAIN })).toBe(5_000_000);
  });

  it('a sped-up return is the same cancel: the cancelled payment, from the records', () => {
    // Speeding up a return carries no payment of its own (amountSats 0): the
    // figure is the one the cancel led with, as the Sent page's hero shows it.
    const replaces = { kind: 'speedup' as const, amountSats: 0, what: 'return' as const };
    expect(cosignAmount({ replaces, returnSats: 5_000_000, outputs: DRAIN })).toBe(5_000_000);
    // Known as a return by the records alone (a plan written before `what`).
    const unnamed = { kind: 'speedup' as const, amountSats: 0 };
    expect(cosignAmount({ replaces: unnamed, returnSats: 5_000_000, outputs: DRAIN })).toBe(5_000_000);
  });

  it('a sped-up return the records cannot price leads with nothing, never the drained total', () => {
    const replaces = { kind: 'speedup' as const, amountSats: 0, what: 'return' as const };
    expect(cosignAmount({ replaces, returnSats: null, outputs: DRAIN })).toBeNull();
    expect(cosignAmount({ replaces, returnSats: 0, outputs: DRAIN })).toBeNull();
  });

  it('other speed-ups keep their own figure', () => {
    const payment = { kind: 'speedup' as const, amountSats: 5_000_000, what: 'payment' as const };
    expect(cosignAmount({ replaces: payment, returnSats: null, outputs: PAYMENT })).toBe(5_000_000);
    // A sped-up refresh moves its coins within the vault, and says so.
    const refresh = { kind: 'speedup' as const, amountSats: 0, what: 'refresh' as const };
    expect(cosignAmount({ replaces: refresh, returnSats: null, outputs: DRAIN })).toBe(7_990_000);
  });

  it('nothing read yet is nothing shown', () => {
    expect(cosignAmount({ replaces: undefined, returnSats: null, outputs: null })).toBeNull();
    expect(cosignAmount({ replaces: undefined, returnSats: null, outputs: [] })).toBeNull();
  });
});

describe('isSpedUpReturn', () => {
  it('by the plan’s word or by the records, and only for a speed-up', () => {
    expect(isSpedUpReturn({ kind: 'speedup', amountSats: 0, what: 'return' }, null)).toBe(true);
    expect(isSpedUpReturn({ kind: 'speedup', amountSats: 0 }, 5_000_000)).toBe(true);
    expect(isSpedUpReturn({ kind: 'speedup', amountSats: 5_000_000, what: 'payment' }, null)).toBe(false);
    expect(isSpedUpReturn({ kind: 'cancel', amountSats: 5_000_000 }, 5_000_000)).toBe(false);
    expect(isSpedUpReturn(undefined, null)).toBe(false);
  });
});
