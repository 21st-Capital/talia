/**
 * The transaction page's status card, state by state (decided 2026-09-28, Speed
 * up and Cancel, design Option A). Every sentence a client reads there is
 * pinned here, with the house rules: no em dash, no jargon.
 */
import {
  NOT_REPLACEABLE_LINE,
  NOT_SIGNALLED_INFO,
  TOO_LATE_INFO,
  TOO_LATE_LINE,
  confirmationsLabel,
  etaInfoText,
  standInReplacement,
  standInTx,
  txNoun,
  txRecordInfo,
  txRowWords,
  txStatusView,
} from '../txStatusModel';
import type { TxReplacement } from '../../../wallet/txReplacementLogic';
import type { WalletTx } from '../../../bitcoin/engine/types';
import type { TxStatusInput, TxStatusView } from '../txStatusModel';
import type { ReplacementEligibility } from '../../../wallet/replacement';

const BOTH: ReplacementEligibility = { cannot: null, speedUp: true, cancel: true };

function input(over: Partial<TxStatusInput> = {}): TxStatusInput {
  return {
    incoming: false,
    refresh: false,
    confirmed: false,
    confirmations: 0,
    record: { kind: 'none' },
    isReturn: false,
    eligibility: BOTH,
    canSend: true,
    etaPhrase: 'about 3 hours',
    ...over,
  };
}

const HEAD = 'ab'.repeat(32);

function words(v: TxStatusView): string[] {
  return [v.title, v.sub, v.eta, v.note, v.notice?.text, v.notice?.info, v.link?.label].filter(
    (w): w is string => !!w,
  );
}

describe('the status card', () => {
  it('a waiting payment: Sent, how long, Speed up and Cancel', () => {
    const v = txStatusView(input());
    expect(v).toMatchObject({
      kind: 'sent',
      glyph: 'up',
      title: 'Sent',
      sub: 'Waiting for confirmation',
      eta: 'About 3 hours at this fee',
      speedUp: true,
      cancel: true,
      notice: null,
      link: null,
    });
  });

  it('leaves the ETA out when there is nothing true to say', () => {
    expect(txStatusView(input({ etaPhrase: null })).eta).toBeNull();
  });

  it('a confirmed payment says its confirmations and nothing else', () => {
    const v = txStatusView(input({ confirmed: true, confirmations: 7 }));
    expect(v).toMatchObject({ kind: 'sent', title: 'Sent', sub: '6+ confirmations', eta: null, speedUp: false, cancel: false });
    expect(txStatusView(input({ confirmed: true, confirmations: 1 })).sub).toBe('1 confirmation');
    expect(txStatusView(input({ confirmed: true, confirmations: 3 })).sub).toBe('3 confirmations');
    expect(txStatusView(input({ confirmed: true, confirmations: undefined })).sub).toBe('Confirmed');
  });

  it('a received payment is unchanged: no actions, no ETA', () => {
    const v = txStatusView(input({ incoming: true }));
    expect(v).toMatchObject({ kind: 'received', glyph: 'down', title: 'Received', eta: null, speedUp: false, cancel: false });
  });

  it('offers nothing where Send is not offered', () => {
    const v = txStatusView(input({ canSend: false }));
    expect(v.speedUp).toBe(false);
    expect(v.cancel).toBe(false);
    expect(v.notice).toBeNull();
    // The waiting line still tells the client how long.
    expect(v.eta).toBe('About 3 hours at this fee');
  });

  it('offers nothing while the verdict is still being worked out', () => {
    const v = txStatusView(input({ eligibility: null }));
    expect(v.speedUp || v.cancel).toBe(false);
  });

  it('follows the core: Cancel alone, or Speed up alone', () => {
    expect(
      txStatusView(input({ eligibility: { cannot: null, speedUp: false, noSpeedUp: 'batch-without-change', cancel: true } })),
    ).toMatchObject({ speedUp: false, cancel: true });
    expect(
      txStatusView(input({ eligibility: { cannot: null, speedUp: true, cancel: false, noCancel: 'self-transfer' } })),
    ).toMatchObject({ speedUp: true, cancel: false });
  });

  it('Cancel alone says why Speed up is missing; neither says why neither', () => {
    const cancelOnly = txStatusView(
      input({ eligibility: { cannot: null, speedUp: false, noSpeedUp: 'batch-without-change', cancel: true } }),
    );
    expect(cancelOnly).toMatchObject({ speedUp: false, cancel: true });
    expect(cancelOnly.notice).toMatchObject({ tone: 'plain', text: 'Cannot be sped up', infoTitle: 'Why not' });
    expect(cancelOnly.notice?.info).toMatch(/several recipients and keeps no change/);
    expect(cancelOnly.notice?.info).toMatch(/It can still be cancelled\.$/);
    // Several of the vault's own addresses and no change: neither action.
    const neither = txStatusView(
      input({
        eligibility: {
          cannot: null,
          speedUp: false,
          noSpeedUp: 'batch-without-change',
          cancel: false,
          noCancel: 'self-transfer',
        },
      }),
    );
    expect(neither).toMatchObject({ speedUp: false, cancel: false });
    expect(neither.notice).toMatchObject({ text: NOT_REPLACEABLE_LINE, infoTitle: 'Why not' });
    expect(neither.notice?.info).toMatch(/nothing to cancel either/);
    // Where Send is not offered, nothing is said about either.
    expect(
      txStatusView(input({ canSend: false, eligibility: { cannot: null, speedUp: false, noSpeedUp: 'batch-without-change', cancel: true } }))
        .notice,
    ).toBeNull();
    // Both offered: no notice.
    expect(txStatusView(input()).notice).toBeNull();
  });

  it('not replaceable: the ETA, then why not behind the dot', () => {
    const v = txStatusView(input({ eligibility: { cannot: 'not-signalled', speedUp: false, cancel: false } }));
    expect(v.eta).toBe('About 3 hours at this fee');
    expect(v.notice).toEqual({ tone: 'plain', text: NOT_REPLACEABLE_LINE, infoTitle: 'Why not', info: NOT_SIGNALLED_INFO });
    expect(v.speedUp || v.cancel).toBe(false);
  });

  it('every reason a client cannot act on has a plain sentence; missing data says nothing', () => {
    for (const cannot of ['recovery-path', 'has-child', 'foreign-coins', 'unreadable'] as const) {
      const v = txStatusView(input({ eligibility: { cannot, speedUp: false, cancel: false } }));
      expect(v.notice?.text).toBe(NOT_REPLACEABLE_LINE);
      expect(v.notice?.info.length).toBeGreaterThan(40);
    }
    expect(txStatusView(input({ eligibility: { cannot: 'missing-data', speedUp: false, cancel: false } })).notice).toBeNull();
  });

  it('a path that waits promises no speed-up: it takes this phone’s record and 21st Capital’s word (decided 2026-10-31)', () => {
    const v = txStatusView(input({ eligibility: { cannot: 'recovery-path', speedUp: false, cancel: false } }));
    expect(v.notice?.info).toContain('It confirms once the network fee catches up. A rescue sent from this phone may also be sped up on the Rescue page.');
    expect(v.notice?.info).not.toContain('A rescue can be sped up');
    expect(v.notice?.info).not.toContain('everyday payments only');
  });

  it('replaced by a speed-up: Replaced, and the way to the new transaction', () => {
    const v = txStatusView(input({ record: { kind: 'replaced', cancelled: false, headTxid: HEAD, headConfirmed: false } }));
    expect(v).toMatchObject({
      kind: 'replaced',
      glyph: 'replaced',
      title: 'Replaced',
      sub: 'By the same payment with a higher fee',
      link: { label: 'See the new transaction', txid: HEAD },
      eta: null,
      speedUp: false,
      cancel: false,
    });
  });

  it('a refresh that was sped up is a refresh, never a payment', () => {
    const v = txStatusView(
      input({ refresh: true, record: { kind: 'replaced', cancelled: false, headTxid: HEAD, headConfirmed: false } }),
    );
    expect(v.sub).toBe('By the same refresh with a higher fee');
  });

  it('cancelled: on the way back, then returned, and the way to the return', () => {
    const waiting = txStatusView(input({ record: { kind: 'replaced', cancelled: true, headTxid: HEAD, headConfirmed: false } }));
    expect(waiting).toMatchObject({
      kind: 'cancelled',
      glyph: 'refresh',
      title: 'Cancelled',
      sub: 'The coins are on their way back to this vault',
      link: { label: 'See the return', txid: HEAD },
    });
    const done = txStatusView(input({ record: { kind: 'replaced', cancelled: true, headTxid: HEAD, headConfirmed: true } }));
    expect(done.sub).toBe('The coins returned to this vault');
  });

  it('the return: what comes back, Speed up only', () => {
    const v = txStatusView(
      input({
        record: { kind: 'replacement' },
        isReturn: true,
        returnAmount: '0.05 BTC',
        eligibility: { cannot: null, speedUp: true, cancel: false, noCancel: 'is-return' },
      }),
    );
    expect(v).toMatchObject({
      kind: 'return',
      glyph: 'refresh',
      title: 'Return',
      sub: 'Waiting for confirmation',
      eta: 'About 3 hours at this fee',
      note: '0.05 BTC comes back to this vault',
      speedUp: true,
      cancel: false,
    });
  });

  it('the new transaction of a speed-up is a normal waiting payment', () => {
    const v = txStatusView(input({ record: { kind: 'replacement' } }));
    expect(v).toMatchObject({ kind: 'sent', title: 'Sent', speedUp: true, cancel: true, note: null });
  });

  it('the cancel came too late: Sent, 1 confirmation, the gold line', () => {
    const v = txStatusView(input({ confirmed: true, confirmations: 1, record: { kind: 'too-late' } }));
    expect(v).toMatchObject({ kind: 'sent', title: 'Sent', sub: '1 confirmation', speedUp: false, cancel: false, eta: null });
    expect(v.notice).toEqual({ tone: 'warning', text: TOO_LATE_LINE, infoTitle: TOO_LATE_LINE, info: TOO_LATE_INFO });
  });

  it('names what it is', () => {
    expect(txNoun({ refresh: false, isReturn: false })).toBe('payment');
    expect(txNoun({ refresh: true, isReturn: false })).toBe('refresh');
    expect(txNoun({ refresh: false, isReturn: true })).toBe('return');
  });

  it('explains the ETA with the rate it pays', () => {
    expect(etaInfoText('payment', '1.2')).toMatch(/^This payment pays 1\.2 sat\/vB\. /);
  });

  it('waiting reads the same whatever the count says', () => {
    expect(confirmationsLabel(false, undefined)).toBe('Waiting for confirmation');
    expect(confirmationsLabel(true, 0)).toBe('Waiting for confirmation');
  });

  it('never an em dash, never the jargon', () => {
    const states: TxStatusInput[] = [
      input(),
      input({ incoming: true }),
      input({ confirmed: true, confirmations: 2 }),
      input({ record: { kind: 'replaced', cancelled: false, headTxid: HEAD, headConfirmed: false } }),
      input({ record: { kind: 'replaced', cancelled: true, headTxid: HEAD, headConfirmed: true } }),
      input({ record: { kind: 'replacement' }, isReturn: true, returnAmount: '0.05 BTC' }),
      input({ confirmed: true, confirmations: 1, record: { kind: 'too-late' } }),
      ...(['not-signalled', 'recovery-path', 'has-child', 'foreign-coins', 'unreadable'] as const).map((cannot) =>
        input({ eligibility: { cannot, speedUp: false, cancel: false } }),
      ),
      input({ eligibility: { cannot: null, speedUp: false, noSpeedUp: 'batch-without-change', cancel: true } }),
      input({
        eligibility: { cannot: null, speedUp: false, noSpeedUp: 'batch-without-change', cancel: false, noCancel: 'self-transfer' },
      }),
    ];
    const all = states.flatMap((s) => words(txStatusView(s))).concat(etaInfoText('payment', '3'));
    for (const w of all) {
      expect(w).not.toMatch(/—/);
      expect(w).not.toMatch(/\b(RBF|UTXO|utxo|inputs?|outputs?|outpoint)\b/);
    }
  });
});

describe('reading the records', () => {
  const W = 'vault-1';
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);
  const rec = (oldTxid: string, newTxid: string, kind: 'speedup' | 'cancel', at = 1): TxReplacement => ({
    walletId: W,
    oldTxid,
    newTxid,
    kind,
    recipient: 'bc1qrecipient',
    amount: 5_000_000,
    oldFeeSats: 146,
    newFeeSats: 1_606,
    at,
  });
  const waiting = (txid: string): WalletTx => ({ txid, received: 0, sent: 1, netAmount: -1, confirmed: false });
  const mined = (txid: string): WalletTx => ({ ...waiting(txid), confirmed: true, blockHeight: 100 });

  it('nothing recorded: nothing to say', () => {
    const info = txRecordInfo([], W, A, [waiting(A)]);
    expect(info).toMatchObject({ state: { kind: 'none' }, isReturn: false, earlier: null, sentAt: null, showInstead: null });
  });

  it('a sped-up original, gone from the list: replaced, with its record to draw it from', () => {
    const list = [rec(A, B, 'speedup')];
    const info = txRecordInfo(list, W, A, [waiting(B)]);
    expect(info.state).toEqual({ kind: 'replaced', cancelled: false, headTxid: B, headConfirmed: false });
    expect(info.replacedRecord?.newTxid).toBe(B);
  });

  it('the new transaction names the one it replaces, and when it was sent', () => {
    const info = txRecordInfo([rec(A, B, 'speedup', 1_700_000_000_000)], W, B, [waiting(B)]);
    expect(info.state).toEqual({ kind: 'replacement' });
    expect(info.earlier).toEqual({ label: 'Replaces', txid: A });
    expect(info.sentAt).toBe(1_700_000_000_000);
    expect(info.isReturn).toBe(false);
  });

  it('a cancel: the original is cancelled, the return says what came back', () => {
    const list = [rec(A, B, 'cancel')];
    expect(txRecordInfo(list, W, A, [waiting(B)]).state).toMatchObject({ kind: 'replaced', cancelled: true });
    expect(txRecordInfo(list, W, A, [mined(B)]).state).toMatchObject({ kind: 'replaced', headConfirmed: true });
    const ret = txRecordInfo(list, W, B, [waiting(B)]);
    expect(ret).toMatchObject({ isReturn: true, earlier: { label: 'Cancels', txid: A }, returnAmountSats: 5_000_000 });
  });

  it('a sped-up return is still a return, and its original still says cancelled', () => {
    const list = [rec(A, B, 'cancel', 1), rec(B, C, 'speedup', 2)];
    expect(txRecordInfo(list, W, A, [waiting(C)]).state).toMatchObject({ kind: 'replaced', cancelled: true, headTxid: C });
    const mid = txRecordInfo(list, W, B, [waiting(C)]);
    expect(mid.state).toMatchObject({ kind: 'replaced', cancelled: false, headTxid: C });
    expect(mid.isReturn).toBe(true);
    expect(
      txStatusView({ ...input(), record: mid.state, isReturn: mid.isReturn }).sub,
    ).toBe('By the same return with a higher fee');
    expect(txRecordInfo(list, W, C, [waiting(C)])).toMatchObject({ isReturn: true, earlier: { label: 'Replaces', txid: B } });
  });

  it('a chain whose middle transaction confirmed says what really happened', () => {
    // Sped up to B, then B cancelled by C, and the network took B: the
    // payment went through, nothing is on its way back.
    const sped = [rec(A, B, 'speedup', 1), rec(B, C, 'cancel', 2)];
    const a = txRecordInfo(sped, W, A, [mined(B)]);
    expect(a.state).toEqual({ kind: 'replaced', cancelled: false, headTxid: B, headConfirmed: true });
    expect(txStatusView({ ...input(), record: a.state })).toMatchObject({
      title: 'Replaced',
      sub: 'By the same payment with a higher fee',
      link: { label: 'See the new transaction', txid: B },
    });
    // Cancelled by B, B sped up by C, and the network took B: the coins are back.
    const cancelled = [rec(A, B, 'cancel', 1), rec(B, C, 'speedup', 2)];
    const c = txRecordInfo(cancelled, W, A, [mined(B)]);
    expect(c.state).toEqual({ kind: 'replaced', cancelled: true, headTxid: B, headConfirmed: true });
    expect(txStatusView({ ...input(), record: c.state })).toMatchObject({
      title: 'Cancelled',
      sub: 'The coins returned to this vault',
      link: { label: 'See the return', txid: B },
    });
  });

  it('the cancel came too late; its return is shown as the original instead', () => {
    const list = [rec(A, B, 'cancel')];
    expect(txRecordInfo(list, W, A, [mined(A)]).state).toEqual({ kind: 'too-late' });
    expect(txRecordInfo(list, W, B, [mined(A)]).showInstead).toBe(A);
  });

  it('a replacement the phone has not picked up yet is drawn from its record (decided 2026-09-28)', () => {
    // "See the return" two minutes after the cancel went out: the vault had
    // not synced it yet, and the page said "Loading..." forever.
    const list = [rec(A, B, 'cancel')];
    const ret = txRecordInfo(list, W, B, [waiting(A)]);
    expect(ret.state).toEqual({ kind: 'replacement' });
    expect(ret.standIn).toEqual({
      tx: { txid: B, received: 0, sent: 1_606, netAmount: -1_606, fee: 1_606, confirmed: false },
      to: null,
    });
    // The card says what the return is, and offers nothing until the real one arrives.
    expect(
      txStatusView({ ...input(), record: ret.state, isReturn: ret.isReturn, eligibility: null, etaPhrase: null, returnAmount: '0.05 BTC' }),
    ).toMatchObject({ kind: 'return', title: 'Return', sub: 'Waiting for confirmation', note: '0.05 BTC comes back to this vault', speedUp: false, cancel: false });
    // A speed-up pays the same recipient; the record says what left the vault.
    const sped = txRecordInfo([{ ...rec(A, B, 'speedup'), newSentSats: 5_001_606 }], W, B, [waiting(A)]);
    expect(sped.standIn).toEqual({
      tx: { txid: B, received: 0, sent: 5_001_606, netAmount: -5_001_606, fee: 1_606, confirmed: false },
      to: 'bc1qrecipient',
    });
    // Once the vault has it, the real transaction is shown instead.
    expect(txRecordInfo(list, W, B, [waiting(B)]).standIn).toBeNull();
    expect(txRecordInfo(list, W, B.toUpperCase(), [waiting(B)]).standIn).toBeNull();
    // Only a replacement: an original, or a txid nobody recorded, is never made up.
    expect(txRecordInfo(list, W, A, [waiting(C)]).standIn).toBeNull();
    expect(txRecordInfo(list, W, C, []).standIn).toBeNull();
  });

  it('a stand-in never claims a figure its record cannot give', () => {
    const r = rec(A, B, 'speedup');
    // Records from before newSentSats: the payment and the new fee.
    expect(standInReplacement(r, false)).toMatchObject({ sent: 5_001_606, netAmount: -5_001_606, fee: 1_606 });
    // Every coin stays (a cancel, a refresh, a return): the fee alone.
    expect(standInReplacement({ ...r, newSentSats: 9_999 }, true)).toMatchObject({ sent: 1_606, netAmount: -1_606 });
    // No new fee on record: nothing to draw from.
    const { newFeeSats: _unused, ...noFee } = r;
    expect(standInReplacement(noFee, false)).toBeNull();
  });

  it('a sped-up refresh is a refresh before and after the sync', () => {
    const refresh: TxReplacement = { ...rec(A, B, 'speedup'), recipient: null, amount: 0, what: 'refresh' };
    const next = txRecordInfo([refresh], W, B, [waiting(A)]);
    expect(next.refresh).toBe(true);
    expect(next.standIn).toEqual({
      tx: { txid: B, received: 0, sent: 1_606, netAmount: -1_606, fee: 1_606, confirmed: false },
      to: null,
    });
    expect(txRecordInfo([refresh], W, A, [waiting(B)]).refresh).toBe(true);
    // A return is a return, never a refresh.
    const back = [rec(A, B, 'cancel', 1), { ...rec(B, C, 'speedup', 2), what: 'return' as const }];
    expect(txRecordInfo(back, W, C, [waiting(A)])).toMatchObject({ isReturn: true, refresh: false });
  });

  it('the vault’s list says what the page says: Return, Cancelled, Replaced', () => {
    const cancelled = [rec(A, B, 'cancel')];
    // Before the sync: the original is still listed, and it was cancelled.
    expect(txRowWords(cancelled, W, A, [waiting(A)])).toEqual({ isReturn: false, replacedAs: 'Cancelled' });
    // After it: the return is a return, never a refresh.
    expect(txRowWords(cancelled, W, B, [waiting(B)])).toEqual({ isReturn: true, replacedAs: null });
    expect(txRowWords([rec(A, B, 'speedup')], W, A, [waiting(A)])).toEqual({ isReturn: false, replacedAs: 'Replaced' });
    // The original confirmed first: an ordinary row.
    expect(txRowWords(cancelled, W, A, [mined(A)])).toEqual({ isReturn: false, replacedAs: null });
    expect(txRowWords([], W, A, [waiting(A)])).toEqual({ isReturn: false, replacedAs: null });
  });

  it('draws a vanished original from its record', () => {
    expect(standInTx(rec(A, B, 'speedup'))).toEqual({
      txid: A,
      received: 0,
      sent: 5_000_146,
      netAmount: -5_000_146,
      fee: 146,
      confirmed: false,
    });
  });
});
