import {
  carryNote,
  currentTxid,
  earlierReplacements,
  isReturn,
  KEEP_UNTIL_CONFIRMATIONS,
  laterReplacements,
  planFor,
  PLAN_TTL_MS,
  pruneReplacements,
  readReplacements,
  replacedBy,
  replacementParamsFromPlan,
  replacementState,
  replacing,
  readSentTimes,
  returnedPaymentSats,
  SENT_AT_TTL_MS,
  sentAtFor,
  sentInstead,
  sentTimesWithoutWallet,
  takePlan,
  withoutWallet,
  withPlan,
  withReplacement,
  withSentAt,
  withoutSiblingPlans,
} from '../txReplacementLogic';
import type { TxReplacement } from '../txReplacementLogic';
import { emptyNotes, noteFor, writeNote } from '../txNoteLogic';
import type { WalletTx } from '../../bitcoin/engine/types';

const W = 'vault-1';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const D = 'd'.repeat(64);

const rec = (oldTxid: string, newTxid: string, kind: 'speedup' | 'cancel', at = 1): TxReplacement => ({
  walletId: W,
  oldTxid,
  newTxid,
  kind,
  recipient: 'tb1qrecipient',
  amount: 5_000_000,
  at,
});

const pending = (txid: string): WalletTx => ({ txid, received: 0, sent: 1, netAmount: -1, confirmed: false });
const mined = (txid: string, blockHeight: number): WalletTx => ({
  txid,
  received: 0,
  sent: 1,
  netAmount: -1,
  confirmed: true,
  blockHeight,
});

describe('reading and saving the records', () => {
  it('keeps well-formed records and skips the rest', () => {
    const list = readReplacements([
      { ...rec(A, B, 'speedup'), note: '  Rent  ', oldFeeSats: 146, newFeeSats: 1752 },
      { ...rec(A, A, 'speedup') }, // replaces itself
      { ...rec(A, B, 'speedup'), kind: 'bump' },
      { ...rec(A, 'nope', 'cancel') },
      { ...rec(A, B, 'cancel'), amount: 'lots' },
      'junk',
      null,
    ]);
    expect(list).toEqual([{ ...rec(A, B, 'speedup'), note: 'Rent', oldFeeSats: 146, newFeeSats: 1752 }]);
    expect(readReplacements({ not: 'a list' })).toEqual([]);
  });

  it('saves the same replacement once', () => {
    let list = withReplacement([], rec(A, B, 'speedup', 1));
    list = withReplacement(list, { ...rec(A, B, 'speedup', 2), note: '  ' });
    expect(list).toHaveLength(1);
    expect(list[0].at).toBe(2);
    expect(list[0]).not.toHaveProperty('note');
  });

  it('forgets a removed vault and nothing else', () => {
    const list = [rec(A, B, 'speedup'), { ...rec(C, D, 'cancel'), walletId: 'vault-2' }];
    expect(withoutWallet(list, W)).toEqual([list[1]]);
  });
});

describe('following a chain', () => {
  // A was sped up to B, and B was then cancelled by C.
  const list = [rec(A, B, 'speedup', 1), rec(B, C, 'cancel', 2)];

  it('finds both directions', () => {
    expect(replacedBy(list, W, A)?.newTxid).toBe(B);
    expect(replacing(list, W, C)?.oldTxid).toBe(B);
    expect(replacedBy(list, W, C)).toBeUndefined();
    expect(replacedBy(list, 'vault-2', A)).toBeUndefined();
  });

  it('walks to the newest transaction and back to the first', () => {
    expect(laterReplacements(list, W, A).map((r) => r.newTxid)).toEqual([B, C]);
    expect(earlierReplacements(list, W, C).map((r) => r.oldTxid)).toEqual([B, A]);
    expect(currentTxid(list, W, A)).toBe(C);
    expect(currentTxid(list, W, D)).toBe(D);
  });

  it('knows a return, and a sped-up return, from a speed-up', () => {
    expect(isReturn(list, W, B)).toBe(false);
    expect(isReturn(list, W, C)).toBe(true);
    const spedUpReturn = [...list, rec(C, D, 'speedup', 3)];
    expect(isReturn(spedUpReturn, W, D)).toBe(true);
  });

  it('a return leads with the payment its cancel cancelled, however often it was sped up (decided 2026-09-28)', () => {
    // The cancel's record carries the PAYMENT's amount; a speed-up of the
    // return carries none worth showing (every coin comes back).
    const list2 = [rec(A, B, 'cancel', 1), { ...rec(B, C, 'speedup', 2), amount: 0 }, { ...rec(C, D, 'speedup', 3), amount: 0 }];
    expect(returnedPaymentSats(list2, W, B)).toBe(5_000_000);
    expect(returnedPaymentSats(list2, W, C)).toBe(5_000_000);
    expect(returnedPaymentSats(list2, W, D)).toBe(5_000_000);
    // Not a return: nothing.
    expect(returnedPaymentSats(list, W, B)).toBeNull();
    expect(returnedPaymentSats(list, W, A)).toBeNull();
    expect(returnedPaymentSats(list2, 'vault-2', D)).toBeNull();
  });

  it('never loops on a corrupt chain', () => {
    const loop = [rec(A, B, 'speedup'), rec(B, A, 'speedup')];
    expect(laterReplacements(loop, W, A)).toHaveLength(1);
    expect(earlierReplacements(loop, W, A)).toHaveLength(1);
  });
});

describe('replacementState: what a page shows', () => {
  it('a replaced original that is still listed: Replaced, linking to the newest', () => {
    const list = [rec(A, B, 'speedup')];
    const state = replacementState(list, W, A, [pending(A), pending(B)]);
    expect(state).toMatchObject({ kind: 'replaced', headTxid: B });
  });

  it('a replaced original the sync already forgot (the "Loading..." case)', () => {
    const list = [rec(A, B, 'cancel')];
    const state = replacementState(list, W, A, [pending(B)]);
    expect(state.kind).toBe('replaced');
    if (state.kind === 'replaced') expect(state.last.kind).toBe('cancel');
  });

  it('a cancelled payment that confirmed first: the cancel came too late', () => {
    const list = [rec(A, B, 'cancel')];
    expect(replacementState(list, W, A, [mined(A, 900_000)])).toMatchObject({ kind: 'too-late' });
  });

  it('a sped-up payment that confirmed at the old fee: nothing to say', () => {
    const list = [rec(A, B, 'speedup')];
    expect(replacementState(list, W, A, [mined(A, 900_000)])).toEqual({ kind: 'none' });
  });

  it('the replacement itself, and a return', () => {
    expect(replacementState([rec(A, B, 'speedup')], W, B, [pending(B)])).toMatchObject({
      kind: 'replacement',
      isReturn: false,
    });
    expect(replacementState([rec(A, B, 'cancel')], W, B, [pending(B)])).toMatchObject({
      kind: 'replacement',
      isReturn: true,
    });
  });

  it('a chain whose MIDDLE transaction confirmed ends there: what followed lost the race', () => {
    // Sped up to B, B cancelled by C, and the network took B.
    const sped = [rec(A, B, 'speedup', 1), rec(B, C, 'cancel', 2)];
    const s1 = replacementState(sped, W, A, [mined(B, 900_000)]);
    expect(s1).toMatchObject({ kind: 'replaced', headTxid: B });
    if (s1.kind === 'replaced') {
      expect(s1.last).toBe(sped[0]);
      expect(s1.chain).toEqual([sped[0]]);
    }
    // Cancelled by B, B sped up by C, and the network took B.
    const cancelled = [rec(A, B, 'cancel', 1), rec(B, C, 'speedup', 2)];
    const s2 = replacementState(cancelled, W, A, [mined(B, 900_000)]);
    expect(s2).toMatchObject({ kind: 'replaced', headTxid: B });
    if (s2.kind === 'replaced') expect(s2.chain.map((r) => r.kind)).toEqual(['cancel']);
    // Nothing confirmed yet: the whole chain, to its newest.
    const s3 = replacementState(sped, W, A, [pending(C)]);
    expect(s3).toMatchObject({ kind: 'replaced', headTxid: C });
    if (s3.kind === 'replaced') expect(s3.chain).toEqual(sped);
  });

  it('a replacement that lost the race sends the page to the original', () => {
    const state = replacementState([rec(A, B, 'cancel')], W, B, [mined(A, 900_000)]);
    expect(state).toMatchObject({ kind: 'lost', originalTxid: A });
  });

  it('nothing recorded', () => {
    expect(replacementState([], W, A, [pending(A)])).toEqual({ kind: 'none' });
  });
});

describe('pruneReplacements', () => {
  const list = [rec(A, B, 'speedup', 1), rec(B, C, 'cancel', 2), { ...rec(A, B, 'speedup'), walletId: 'vault-2' }];

  it('keeps the record while the original is shallow, so the page can say it came too late', () => {
    const tip = 900_000 + KEEP_UNTIL_CONFIRMATIONS - 2;
    expect(pruneReplacements(list, W, [mined(A, 900_000)], tip).dropped).toEqual([]);
  });

  it('drops a buried original with every replacement that followed it', () => {
    const tip = 900_000 + KEEP_UNTIL_CONFIRMATIONS - 1;
    const { kept, dropped } = pruneReplacements(list, W, [mined(A, 900_000)], tip);
    expect(dropped.map((r) => r.newTxid)).toEqual([B, C]);
    expect(kept).toEqual([list[2]]);
  });

  it('keeps the records of a replacement that won: the only way to the vanished original', () => {
    const { dropped } = pruneReplacements(list, W, [mined(C, 900_000)], 900_100);
    expect(dropped).toEqual([]);
  });

  it('drops nothing without a tip height', () => {
    expect(pruneReplacements(list, W, [mined(A, 1)], undefined).dropped).toEqual([]);
  });
});

describe('carryNote', () => {
  it('shows the original note on the replacement, and the original keeps it', () => {
    const notes = carryNote(writeNote(emptyNotes(), W, A, 'Rent'), W, A, B);
    expect(noteFor(notes, W, B)).toBe('Rent');
    expect(noteFor(notes, W, A)).toBe('Rent');
  });

  it('never overwrites a note the replacement already has', () => {
    let notes = writeNote(emptyNotes(), W, A, 'Rent');
    notes = writeNote(notes, W, B, 'Rent, faster');
    expect(noteFor(carryNote(notes, W, A, B), W, B)).toBe('Rent, faster');
  });

  it('does nothing when the original has no note', () => {
    const notes = emptyNotes();
    expect(carryNote(notes, W, A, B)).toBe(notes);
  });
});

describe('planned replacements (a co-signed vault sends later, from Pending)', () => {
  const plan = (newTxid: string, at: number) => ({ ...rec(A, newTxid, 'cancel'), at });

  it('finds the plan by the transaction it becomes, in its own vault only', () => {
    const plans = withPlan([], plan(B, 10));
    expect(planFor(plans, W, B)?.oldTxid).toBe(A);
    expect(planFor(plans, W, B.toUpperCase())?.oldTxid).toBe(A);
    expect(planFor(plans, 'vault-2', B)).toBeUndefined();
    expect(planFor(plans, W, C)).toBeUndefined();
  });

  it('keeps one plan per new transaction', () => {
    const plans = withPlan(withPlan([], plan(B, 10)), plan(B, 20));
    expect(plans).toHaveLength(1);
    expect(plans[0].at).toBe(20);
  });

  it('turns the plan into the record at the broadcast, stamped then', () => {
    // C replaces another payment (D), so it is no sibling of B.
    const plans = withPlan(withPlan([], plan(B, 10)), { ...rec(D, C, 'speedup'), at: 11 });
    const { record, rest, siblings } = takePlan(plans, W, B, 5_000);
    expect(record).toMatchObject({ oldTxid: A, newTxid: B, kind: 'cancel', at: 5_000 });
    expect(rest.map((p) => p.newTxid)).toEqual([C]);
    expect(siblings).toEqual([]);
  });

  it('once one version of a payment is out, every other unsent version goes (it could undo it)', () => {
    // A sped up as B and cancelled as C, both waiting for co-signing; C goes out.
    const plans = [
      { ...rec(A, B, 'speedup'), at: 10 },
      { ...rec(A, C, 'cancel'), at: 11 },
      { ...rec(D, 'e'.repeat(64), 'speedup'), at: 12 },
      { ...rec(A, 'f'.repeat(64), 'speedup'), walletId: 'vault-2', at: 13 },
    ];
    const { record, rest, siblings } = takePlan(plans, W, C, 5_000);
    expect(record?.newTxid).toBe(C);
    expect(siblings).toEqual([B]);
    expect(rest.map((p) => p.newTxid)).toEqual(['e'.repeat(64), 'f'.repeat(64)]);
    // Nothing planned for the broadcast: no siblings either.
    expect(takePlan(plans, W, 'e'.repeat(64).replace(/^e/, '9'), 5_000).siblings).toEqual([]);
  });

  it('without its own plan, the version that went out still retires its siblings', () => {
    const plans = [{ ...rec(A, B, 'speedup'), at: 10 }, { ...rec(A, C, 'cancel'), at: 11 }, { ...rec(D, B, 'cancel'), at: 12 }];
    const { rest, siblings } = withoutSiblingPlans(plans, W, A.toUpperCase(), C.toUpperCase());
    expect(siblings).toEqual([B]);
    expect(rest).toEqual([plans[1], plans[2]]);
  });

  it('refuses a version when another one of the same payment already went out', () => {
    const records = [rec(A, B, 'cancel', 5)];
    expect(sentInstead(records, W, A, C)?.newTxid).toBe(B);
    // The same version again, another payment, another vault: nothing to refuse.
    expect(sentInstead(records, W, A, B.toUpperCase())).toBeUndefined();
    expect(sentInstead(records, W, D, C)).toBeUndefined();
    expect(sentInstead(records, 'vault-2', A, C)).toBeUndefined();
    // A speed-up of the version that went out replaces IT, not the original.
    expect(sentInstead(records, W, B, C)).toBeUndefined();
  });

  it('answers nothing for a broadcast that was no replacement, and drops stale plans', () => {
    const plans = [plan(B, 0), plan(C, PLAN_TTL_MS)];
    const { record, rest } = takePlan(plans, W, D, PLAN_TTL_MS + 1);
    expect(record).toBeNull();
    expect(rest.map((p) => p.newTxid)).toEqual([C]);
  });
});

describe('a ceremony resumed from Pending transactions (no route param)', () => {
  const plan: TxReplacement = {
    ...rec(A, B, 'cancel', 1_000),
    oldFeeSats: 146,
    newFeeSats: 1_606,
    note: 'Rent',
    what: 'payment',
  };

  it('rebuilds the ceremony’s words and record from the plan', () => {
    // Found by the half-signed copy's unsigned txid, which is the plan's newTxid.
    const found = planFor(withPlan([], plan), W, B);
    expect(found).toBeDefined();
    const params = replacementParamsFromPlan(found as TxReplacement, 1_700_000_000_000);
    expect(params).toEqual({
      kind: 'cancel',
      txid: A,
      oldFeeSats: 146,
      amountSats: 5_000_000,
      sentAt: 1_700_000_000,
      what: 'payment',
      record: {
        walletId: W,
        oldTxid: A,
        newTxid: B,
        kind: 'cancel',
        recipient: 'tb1qrecipient',
        amount: 5_000_000,
        note: 'Rent',
        oldFeeSats: 146,
        newFeeSats: 1_606,
        what: 'payment',
      },
    });
    // The record is stamped when it is SENT, never with the plan's build time.
    expect('at' in params.record).toBe(false);
  });

  it('leaves out what it does not know', () => {
    const bare = replacementParamsFromPlan(rec(A, B, 'speedup'), null);
    expect(bare.sentAt).toBeUndefined();
    expect(bare.what).toBeUndefined();
    expect(bare.kind).toBe('speedup');
  });

  it('keeps what the original is called through storage', () => {
    const [read] = readReplacements([{ ...rec(A, B, 'speedup'), what: 'refresh' }]);
    expect(read.what).toBe('refresh');
    expect(readReplacements([{ ...rec(A, B, 'speedup'), what: 'bonus' }])[0].what).toBeUndefined();
  });

  it('keeps what the replacement took out of the vault through storage', () => {
    expect(readReplacements([{ ...rec(A, B, 'speedup'), newSentSats: 5_001_606 }])[0].newSentSats).toBe(5_001_606);
    expect(readReplacements([{ ...rec(A, B, 'speedup'), newSentSats: 'lots' }])[0].newSentSats).toBeUndefined();
    expect(readReplacements([rec(A, B, 'speedup')])[0].newSentSats).toBeUndefined();
  });
});

describe('when Talia sent it (a waiting transaction has no block time)', () => {
  it('stamps a broadcast and finds it again, whatever the case of the txid', () => {
    const times = withSentAt({}, W, A.toUpperCase(), 1_700_000_000_000);
    expect(sentAtFor(times, W, A)).toBe(1_700_000_000_000);
    expect(sentAtFor(times, 'vault-2', A)).toBeNull();
    expect(sentAtFor(times, W, B)).toBeNull();
  });

  it('keeps a month, then lets a stamp go', () => {
    let times = withSentAt({}, W, A, 1_000);
    times = withSentAt(times, W, B, 1_000 + SENT_AT_TTL_MS - 1);
    expect(sentAtFor(times, W, A)).toBe(1_000);
    times = withSentAt(times, W, C, 1_000 + SENT_AT_TTL_MS);
    expect(sentAtFor(times, W, A)).toBeNull();
    expect(sentAtFor(times, W, B)).not.toBeNull();
  });

  it('reads what the phone stored, skipping anything malformed', () => {
    const times = readSentTimes({
      [`${W}:${A.toUpperCase()}`]: 5,
      [`${W}:nope`]: 6,
      [`${W}:${B}`]: 'soon',
      [`:${C}`]: 7,
      [`${W}:${D}`]: -1,
    });
    expect(times).toEqual({ [`${W}:${A}`]: 5 });
    expect(readSentTimes(null)).toEqual({});
    expect(readSentTimes([1, 2])).toEqual({});
  });

  it('forgets a removed vault and nothing else', () => {
    const times = withSentAt(withSentAt(withSentAt({}, W, A, 1), 'vault-2', A, 2), `${W}:x`, B, 3);
    const kept = sentTimesWithoutWallet(times, W);
    expect(sentAtFor(kept, W, A)).toBeNull();
    expect(sentAtFor(kept, 'vault-2', A)).toBe(2);
    expect(sentAtFor(kept, `${W}:x`, B)).toBe(3);
  });
});
