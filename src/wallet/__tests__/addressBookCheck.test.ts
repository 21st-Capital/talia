/**
 * Has a saved address spent coins before? The rule on the server's facts
 * (decided 2026-11-05): with the whole history read ('txs'), spent if and only
 * if a transaction in it spends a coin that a transaction in it paid to the
 * address; with a long history ('long'), spent when a confirmed history
 * transaction holds no coin the address still holds, and otherwise unknown,
 * never "nothing found". Anything else is unknown.
 */
import { activityVerdict, isAddressActivity } from '../addressBookCheck';
import type { AddressActivity, AddressActivityTx } from '../addressBookCheck';

const id = (c: string) => c.repeat(64);
const A = id('a');
const B = id('b');
const C = id('c');
const OTHER = id('e');

const tx = (txid: string, height: number, spends: string[], pays: number[]): AddressActivityTx => ({ txid, height, spends, pays });
const txs = (...list: AddressActivityTx[]): AddressActivity => ({ kind: 'txs', txs: list });

describe("the whole history ('txs')", () => {
  it('never used: nothing found', () => {
    expect(activityVerdict(txs())).toBe('notFound');
  });

  it('received only: nothing found', () => {
    expect(activityVerdict(txs(tx(A, 800_000, [`${OTHER}:0`], [0])))).toBe('notFound');
    // Two payments to it, neither spent.
    expect(activityVerdict(txs(tx(A, 800_000, [`${OTHER}:0`], [1]), tx(B, 800_010, [`${OTHER}:1`], [0, 2])))).toBe(
      'notFound',
    );
  });

  it('spent: a later transaction spends the coin paid to it', () => {
    expect(activityVerdict(txs(tx(A, 800_000, [`${OTHER}:0`], [1]), tx(B, 800_005, [`${A}:1`], [])))).toBe('spent');
  });

  it('a spend that pays back to the same address is still a spend', () => {
    expect(activityVerdict(txs(tx(A, 800_000, [`${OTHER}:0`], [0]), tx(B, 800_001, [`${A}:0`], [1])))).toBe('spent');
  });

  it('two coins to it, one spent by a transaction paying it again', () => {
    expect(
      activityVerdict(txs(tx(A, 800_000, [`${OTHER}:3`], [0, 1]), tx(B, 800_002, [`${A}:1`, `${OTHER}:4`], [0]))),
    ).toBe('spent');
  });

  it('a spend still in the mempool counts (height 0 or -1)', () => {
    expect(activityVerdict(txs(tx(A, 800_000, [`${OTHER}:0`], [0]), tx(B, 0, [`${A}:0`], [])))).toBe('spent');
    expect(activityVerdict(txs(tx(A, 0, [`${OTHER}:0`], [0]), tx(B, -1, [`${A}:0`], [])))).toBe('spent');
  });

  it('a receive still in the mempool is nothing found', () => {
    expect(activityVerdict(txs(tx(A, 0, [`${OTHER}:0`], [0])))).toBe('notFound');
    expect(activityVerdict(txs(tx(A, 800_000, [`${OTHER}:0`], [0]), tx(B, -1, [`${OTHER}:1`], [2])))).toBe('notFound');
  });

  it("a coin of the same transaction that did not pay the address is someone else's", () => {
    // A paid the address at 0; its change at 1 was the sender's, spent by B,
    // which paid the address again.
    expect(activityVerdict(txs(tx(A, 800_000, [`${OTHER}:0`], [0]), tx(B, 800_001, [`${A}:1`], [0])))).toBe('notFound');
  });

  it('a spend of a coin outside the list says nothing', () => {
    expect(activityVerdict(txs(tx(A, 800_000, [`${C}:0`], [0])))).toBe('notFound');
  });

  it('reads txids in either case', () => {
    expect(activityVerdict(txs(tx(A, 800_000, [`${OTHER}:0`], [0]), tx(B, 800_001, [`${A.toUpperCase()}:0`], [])))).toBe(
      'spent',
    );
  });
});

describe("a long history ('long')", () => {
  const long = (history: Array<[string, number]>, unspent: Array<[string, number, number]>): AddressActivity => ({
    kind: 'long',
    history: history.map(([txid, height]) => ({ txid, height })),
    unspent: unspent.map(([txid, vout, height]) => ({ txid, vout, height })),
  });

  it('spent when a confirmed history transaction holds no coin it still holds', () => {
    expect(activityVerdict(long([[A, 800_000], [B, 800_001]], [[A, 0, 800_000]]))).toBe('spent');
  });

  it('otherwise unknown, never nothing found', () => {
    expect(activityVerdict(long([[A, 800_000], [B, 800_001]], [[A, 0, 800_000], [B, 1, 800_001]]))).toBe('unknown');
    expect(activityVerdict(long([], []))).toBe('unknown');
  });

  it('a mempool history entry missing from the coins proves nothing', () => {
    expect(activityVerdict(long([[A, 800_000], [B, 0], [C, -1]], [[A, 0, 800_000]]))).toBe('unknown');
  });
});

describe('anything else is unknown', () => {
  it('no answer (an older bridge, an error) is unknown', () => {
    expect(activityVerdict(null)).toBe('unknown');
    expect(activityVerdict(undefined)).toBe('unknown');
  });

  it('an answer that is not the bridge\'s shape is unknown, field by field', () => {
    const bad: unknown[] = [
      {},
      { kind: 'other' },
      { kind: 'txs' },
      { kind: 'txs', txs: [{ txid: 'zz', height: 1, spends: [], pays: [] }] },
      { kind: 'txs', txs: [{ txid: A, height: 1.5, spends: [], pays: [] }] },
      { kind: 'txs', txs: [{ txid: A, height: 1, spends: ['nope'], pays: [] }] },
      { kind: 'txs', txs: [{ txid: A, height: 1, spends: [], pays: [-1] }] },
      { kind: 'txs', txs: [{ txid: A, height: -2, spends: [], pays: [] }] },
      { kind: 'long', history: [{ txid: A, height: 1 }] },
      { kind: 'long', history: [{ txid: A, height: 1 }], unspent: [{ txid: A, height: 1 }] },
      'spent',
      42,
    ];
    for (const b of bad) {
      expect([b, isAddressActivity(b)]).toEqual([b, false]);
      expect(activityVerdict(b as AddressActivity)).toBe('unknown');
    }
  });
});
