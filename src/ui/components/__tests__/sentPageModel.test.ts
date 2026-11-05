/**
 * The Sent page's timeline, figures and words (decided 2026-10-02, design C with
 * the sub line above Done). Every case a broadcast screen can land on.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  batchSentWords,
  CORNER,
  FAILURES_TITLE,
  failureReason,
  fiatShown,
  heroParts,
  INK_BOX,
  inOutCubic,
  isInstant,
  markHeight,
  markTuck,
  MASK_SMALL,
  mergeSentFacts,
  MIN_INK_BOX,
  outCubic,
  paidSomeoneElse,
  PEN,
  PEN_IN,
  penEase,
  penPath,
  progressAt,
  SENT_TRACK_KEYS,
  sentCardTitle,
  sentCopyText,
  sentFailureRows,
  sentHeroSats,
  sentMarkBox,
  sentRows,
  sentShareSubject,
  sentShareText,
  sentTimeline,
  sentWords,
  sessionNothingSent,
  sessionSentWords,
  shortId,
  SKETCH_MS,
  sumKnown,
} from '../sentPageModel';
import type { SentFacts } from '../sentPageModel';

const TX = '3f9a0c6e1b2d4a5f8e7c9d0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0c';
const TX2 = 'aa'.repeat(32);
const TO = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
/** BIP-84's published first receive address ("abandon ... about", m/84'/0'/0'/0/0). */
const TO2 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

const payment = (over: Partial<SentFacts> = {}): SentFacts => ({
  kind: 'payment',
  txids: [TX],
  recipients: [{ address: TO, amountSats: 1_250_000 }],
  movedSats: 340_000,
  feeSats: 1_234,
  ...over,
});

describe('the timeline (design C, tracksC)', () => {
  const live = sentTimeline(false);
  const rm = sentTimeline(true);

  it('inks the tick, fires the haptic as the ink completes, and makes Done live at 1450', () => {
    expect(live.tickAt).toBe(1100);
    expect(live.tracks.pen.end).toBe(live.tickAt);
    expect(progressAt(live.tracks.pen, live.tickAt)).toBe(1);
    expect(progressAt(live.tracks.pen, live.tickAt - 1)).toBeLessThan(1);
    expect(live.doneAt).toBe(1450);
    // The sub line and the actions rise together, and are settled exactly when Done goes live.
    expect(live.tracks.text2.end).toBe(live.doneAt);
    expect(progressAt(live.tracks.text2, live.doneAt)).toBe(1);
    // The words follow the mark: the title just before the ink completes, the card after.
    expect(live.tracks.text1.start).toBe(1000);
    expect(live.tracks.text2.start).toBe(1150);
    // The pen lifts off as the ink completes.
    expect(live.tracks.penOut.start).toBe(live.tickAt);
  });

  it('sketches backwards first, then inks forwards over its own sketch', () => {
    const pen = live.tracks.pen;
    // Half of the pen's track is the sketch, reached exactly as the sketch time runs out.
    expect(progressAt(pen, pen.start + SKETCH_MS)).toBeCloseTo(0.5, 10);
    expect(progressAt(pen, pen.start + SKETCH_MS / 2)).toBeLessThan(0.5);
    expect(progressAt(pen, pen.start + SKETCH_MS + 100)).toBeGreaterThan(0.5);
    // One continuous, never-reversing curve.
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const v = penEase(i / 200);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(penEase(0)).toBe(0);
    expect(penEase(1)).toBe(1);
  });

  it('moves the pen dot along the tick: far end, corner, start, and back', () => {
    const { size, x, y } = penPath(INK_BOX);
    expect(size).toBe(PEN);
    const at = (u: number, v: number) => [u * 2.2 - PEN / 2, v * 2.2 - PEN / 2];
    const near = (got: number[], want: number[]) => got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 10));
    near([x[0], y[0]], at(80, 30));
    near([x[1], y[1]], at(42, 72));
    near([x[2], y[2]], at(22, 52));
    near([x[4], y[4]], at(80, 30));
    // It turns at the start halfway, and passes the corner where the short arm ends.
    expect(PEN_IN[2]).toBe(0.5);
    expect(PEN_IN[3]).toBeCloseTo(0.5 + 0.5 * CORNER, 10);
    expect(PEN_IN[1]).toBeCloseTo(0.5 * (1 - CORNER), 10);
  });

  it('Reduce Motion: no pen, the ink alone in 350 ms, words already there, Done and the haptic at 350', () => {
    expect(rm.tickAt).toBe(350);
    expect(rm.doneAt).toBe(350);
    expect(rm.tracks.pen.end).toBe(350);
    // The ink reads the second half of the pen track, so it starts empty and ends full.
    expect(progressAt(rm.tracks.pen, 0)).toBe(0.5);
    expect(progressAt(rm.tracks.pen, 350)).toBe(1);
    for (const k of ['penIn', 'penOut', 'text1', 'text2'] as const) expect(isInstant(rm.tracks[k])).toBe(true);
    expect(isInstant(rm.tracks.pen)).toBe(false);
  });

  it('live, nothing is instant: everything moves', () => {
    for (const k of SENT_TRACK_KEYS) expect(isInstant(live.tracks[k])).toBe(false);
  });

  it('draws React Native’s own cubic curves', () => {
    expect(outCubic(0)).toBe(0);
    expect(outCubic(0.5)).toBe(0.875);
    expect(outCubic(1)).toBe(1);
    expect(inOutCubic(0.25)).toBe(0.0625);
    expect(inOutCubic(0.5)).toBe(0.5);
    expect(inOutCubic(0.75)).toBe(0.9375);
  });

  it('the mark tucks 16 above and 24 below at the design’s 220, and scales with its box', () => {
    expect(markTuck(INK_BOX)).toEqual({ top: 16, bottom: 24 });
    expect(markHeight(INK_BOX)).toBe(180);
    expect(markHeight(110)).toBe(90);
    // The pen dot keeps its size to the stroke.
    expect(penPath(110).size).toBe(7);
    expect(penPath(110).x[2]).toBeCloseTo(22 * 1.1 - 3.5, 10);
  });

  it('a short screen draws a smaller mark, so Done ends where the page ends', () => {
    // Measured with the smallest mark: room left over goes to the mark.
    const content = (box: number, rest = 438) => rest + markHeight(box);
    // iPhone 17 Pro, the signing screen: a plain payment needs 618 with the
    // 220 box in 698 of room. The design's size, unchanged.
    expect(sentMarkBox(698, content(MIN_INK_BOX))).toBe(INK_BOX);
    // Pending transactions on the same phone (638 of room): still 220.
    expect(sentMarkBox(638, content(MIN_INK_BOX))).toBe(INK_BOX);
    // iPhone SE, the signing screen: 533 of room. Smaller, and it fits.
    const se = sentMarkBox(533, content(MIN_INK_BOX));
    expect(se).toBeGreaterThan(MIN_INK_BOX);
    expect(se).toBeLessThan(INK_BOX);
    expect(content(se)).toBeLessThanOrEqual(533);
    expect(content(se + 2)).toBeGreaterThan(533);
    // No room even at the smallest (a long failures card): the smallest, and it scrolls.
    expect(sentMarkBox(600, 640)).toBe(MIN_INK_BOX);
    expect(sentMarkBox(640, 640)).toBe(MIN_INK_BOX);
    // Whatever the room, it never grows past the design.
    expect(sentMarkBox(5_000, 100)).toBe(INK_BOX);
    // Every size it picks fits the room it was given.
    for (let room = 1; room <= 200; room += 7) {
      const box = sentMarkBox(500 + room, 500);
      expect(markHeight(box) - markHeight(MIN_INK_BOX)).toBeLessThanOrEqual(room + 1e-9);
    }
  });

  it('a track holds before its window and after it', () => {
    const t = { start: 100, end: 300 };
    expect(progressAt(t, 0)).toBe(0);
    expect(progressAt(t, 200)).toBe(0.5);
    expect(progressAt(t, 999)).toBe(1);
  });
});

describe('the hero: what it paid out of the vault, never a guess', () => {
  it('a payment: what the recipients got, all of them together', () => {
    expect(sentHeroSats(payment())).toBe(1_250_000);
    expect(
      sentHeroSats(payment({ recipients: [{ address: TO, amountSats: 100 }, { address: TO2, amountSats: 50 }] })),
    ).toBe(150);
  });

  it('a speed-up: the payment it carries', () => {
    expect(sentHeroSats(payment({ kind: 'speedup' }))).toBe(1_250_000);
  });

  it('a cancel: the PAYMENT it cancels, never the drained total (decided 2026-09-28)', () => {
    const cancel = payment({ kind: 'cancel', recipients: [], movedSats: 1_499_670, cancelledSats: 1_250_000 });
    expect(sentHeroSats(cancel)).toBe(1_250_000);
    // Not known: left out, never the coins coming back.
    expect(sentHeroSats({ ...cancel, cancelledSats: null })).toBeNull();
    expect(sentHeroSats({ ...cancel, cancelledSats: 0 })).toBeNull();
  });

  it('a refresh, a sped-up refresh, a rescue back to the vault: what it moved within the vault', () => {
    expect(sentHeroSats(payment({ kind: 'refresh', recipients: [], movedSats: 50_000_000 }))).toBe(50_000_000);
    expect(sentHeroSats(payment({ kind: 'speedup', recipients: [], movedSats: 49_000_000 }))).toBe(49_000_000);
    expect(sentHeroSats(payment({ kind: 'rescue', recipients: [], movedSats: 7_000 }))).toBe(7_000);
  });

  it('a sped-up return reads as the cancel it is: the cancelled PAYMENT, never the coins coming back (decided 2026-09-28)', () => {
    // A 0.0125 BTC payment from a 1 BTC coin, cancelled, then the cancel sped up.
    const ret = payment({ kind: 'speedup', isReturn: true, recipients: [], movedSats: 98_765_000, cancelledSats: 1_250_000 });
    expect(sentHeroSats(ret)).toBe(1_250_000);
    // Not known: left out, never the drained total.
    expect(sentHeroSats({ ...ret, cancelledSats: null })).toBeNull();
    expect(sentHeroSats({ ...ret, cancelledSats: undefined })).toBeNull();
    expect(sentHeroSats({ ...ret, cancelledSats: 0 })).toBeNull();
    // Its words are the cancel's: the coins come back.
    expect(sentWords('speedup', undefined, true)).toEqual({
      title: 'Sped up',
      sub: 'On its way. The coins come back to this vault once it confirms.',
    });
    // Details, no To, never shared.
    expect(paidSomeoneElse(ret)).toBe(false);
    expect(sentCardTitle(ret)).toBe('Details');
    expect(sentShareText(ret, null, (n) => String(n))).toBeNull();
  });

  it('a rescue to the chosen destination: what left the vault', () => {
    expect(sentHeroSats(payment({ kind: 'rescue', recipients: [{ address: TO, amountSats: 9_900 }] }))).toBe(9_900);
  });

  it('when the screen cannot tell which coins are the vault’s, no hero', () => {
    expect(sentHeroSats(payment({ recipients: null }))).toBeNull();
    expect(sentHeroSats(payment({ kind: 'refresh', recipients: [], movedSats: null }))).toBeNull();
  });

  it('several transactions: their total', () => {
    const merged = mergeSentFacts([
      { kind: 'refresh', txids: [TX], recipients: [], movedSats: 100, feeSats: 10 },
      { kind: 'refresh', txids: [TX2], recipients: [], movedSats: 200, feeSats: 20 },
    ])!;
    expect(sentHeroSats(merged)).toBe(300);
    expect(merged.feeSats).toBe(30);
    expect(merged.kind).toBe('refresh');
    expect(merged.txids).toEqual([TX, TX2]);
  });
});

describe('mergeSentFacts', () => {
  it('one part unknown makes the whole unknown', () => {
    const merged = mergeSentFacts([
      { kind: 'refresh', txids: [TX], recipients: [], movedSats: 100, feeSats: null },
      { kind: 'refresh', txids: [TX2], recipients: null, movedSats: 200, feeSats: 20 },
    ])!;
    expect(merged.feeSats).toBeNull();
    expect(merged.recipients).toBeNull();
    expect(sentHeroSats(merged)).toBeNull();
  });

  it('nothing, or one', () => {
    expect(mergeSentFacts([])).toBeNull();
    const one = payment();
    expect(mergeSentFacts([one])).toBe(one);
  });

  it('is a refresh only when every transaction is', () => {
    expect(
      mergeSentFacts([
        { kind: 'refresh', txids: [TX], recipients: [], movedSats: 1, feeSats: 1 },
        payment({ txids: [TX2] }),
      ])!.kind,
    ).toBe('payment');
  });

  it('sumKnown', () => {
    expect(sumKnown([1, 2, 3])).toBe(6);
    expect(sumKnown([])).toBe(0);
    expect(sumKnown([1, null])).toBeNull();
    expect(sumKnown([1, undefined])).toBeNull();
  });
});

describe('the card', () => {
  it('a payment: "Receipt", To (shortened), the transaction, the fee', () => {
    expect(sentCardTitle(payment())).toBe('Receipt');
    expect(sentRows(payment(), false)).toEqual([
      { label: 'To', value: 'bc1qxy2k…hx0wlh', mono: true },
      { label: 'Transaction ID', value: '3f9a0c6e…8b9a0c', mono: true },
      { label: 'Network fee', value: '1,234 sats' },
    ]);
  });

  it('several recipients read as a count; one address paid twice is one recipient', () => {
    const two = payment({ recipients: [{ address: TO, amountSats: 1 }, { address: TO2, amountSats: 2 }] });
    expect(sentRows(two, false)[0]).toEqual({ label: 'To', value: '2 recipients' });
    const twice = payment({ recipients: [{ address: TO, amountSats: 1 }, { address: TO, amountSats: 2 }] });
    expect(sentRows(twice, false)[0]).toEqual({ label: 'To', value: 'bc1qxy2k…hx0wlh', mono: true });
  });

  it('a cancel, a refresh, a rescue home: "Details", and no To', () => {
    for (const f of [
      payment({ kind: 'cancel', recipients: [], cancelledSats: 5 }),
      payment({ kind: 'refresh', recipients: [] }),
      payment({ kind: 'rescue', recipients: [] }),
      // A cancel never reads as a payment, whatever its outputs say.
      payment({ kind: 'cancel', cancelledSats: 5 }),
    ]) {
      expect(sentCardTitle(f)).toBe('Details');
      expect(sentRows(f, false).map((r) => r.label)).toEqual(['Transaction ID', 'Network fee']);
    }
  });

  it('several transactions: how many, never one id', () => {
    const f = payment({ kind: 'refresh', txids: [TX, TX2], recipients: [] });
    expect(sentRows(f, false)).toEqual([
      { label: 'Transactions', value: '2' },
      { label: 'Network fee', value: '1,234 sats' },
    ]);
  });

  it('hidden balances: the fee as dots; an unknown fee is left off', () => {
    expect(sentRows(payment(), true).find((r) => r.label === 'Network fee')?.value).toBe(MASK_SMALL);
    expect(sentRows(payment({ feeSats: null }), false).map((r) => r.label)).toEqual(['To', 'Transaction ID']);
  });

  it('Copy: the id, several one per line', () => {
    expect(sentCopyText(payment())).toBe(TX);
    expect(sentCopyText(payment({ txids: [TX, TX2] }))).toBe(`${TX}\n${TX2}`);
  });

  it('shortId keeps a short value whole', () => {
    expect(shortId('abc')).toBe('abc');
    expect(shortId(TO)).toBe('bc1qxy2k…hx0wlh');
  });
});

describe('the card of what did not go out', () => {
  // Pending transactions' "N of M sent" and the refresh session's Partly
  // sent (decided 2026-10-02): the receipt's heading and rows, the amount in
  // the owner's unit as the hero writes it, never raw "(7,500,000 sats)".
  const failures = [
    { coin: 2, amountSats: 7_500_000, reason: 'the network refused it: min relay fee not met' },
    { coin: 3, amountSats: 25_000_000, reason: 'not co-signed yet' },
  ];

  it('heads itself like the Details card', () => {
    expect(FAILURES_TITLE).toBe('Could not send');
  });

  it('writes each coin’s amount in the owner’s unit, the reason under it', () => {
    expect(sentFailureRows(failures, false, 'btc')).toEqual([
      { label: 'Coin 2', value: '0.075 BTC', note: 'The network refused it: min relay fee not met' },
      { label: 'Coin 3', value: '0.25 BTC', note: 'Not co-signed yet' },
    ]);
    expect(sentFailureRows(failures, false, 'sats').map((r) => r.value)).toEqual(['7,500,000 sats', '25,000,000 sats']);
    // Auto: below 0.1 BTC in sats, from it in BTC, as every amount in the app.
    expect(sentFailureRows(failures, false, 'auto').map((r) => r.value)).toEqual(['7,500,000 sats', '0.25 BTC']);
  });

  it('hides the amounts with the balance, and leaves out one it does not know', () => {
    expect(sentFailureRows(failures, true, 'btc').map((r) => r.value)).toEqual([MASK_SMALL, MASK_SMALL]);
    expect(sentFailureRows([{ coin: 1, amountSats: null, reason: 'x' }], false, 'btc')[0].value).toBe('');
    // The reason is not an amount: it shows either way.
    expect(sentFailureRows(failures, true, 'btc')[1].note).toBe('Not co-signed yet');
  });

  it('keeps the reason as it was said, plain: a capital, no em or en dash, never empty', () => {
    expect(failureReason('could not be assembled for sending')).toBe('Could not be assembled for sending');
    expect(failureReason('Server said \u2014 try later')).toBe('Server said, try later');
    expect(failureReason('one \u2013 two')).toBe('One, two');
    expect(failureReason('   ')).toBe('Not sent');
    for (const r of sentFailureRows(failures, false, 'btc')) {
      expect(`${r.label} ${r.value} ${r.note}`).not.toMatch(/[\u2014\u2013]/);
    }
  });
});

describe('Share', () => {
  const amount = (s: number) => `${s} sats`;
  const link = `https://mempool.space/tx/${TX}`;

  it('a payment: today’s receipt, line for line', () => {
    expect(sentShareText(payment(), link, amount)).toBe(
      ['Bitcoin payment sent', `To: ${TO}`, 'Amount: 1250000 sats', `Track it: ${link}`].join('\n'),
    );
    expect(sentShareSubject(payment())).toBe('Payment confirmation');
  });

  it('a speed-up is the same payment', () => {
    expect(sentShareText(payment({ kind: 'speedup' }), link, amount)).toMatch(/^Bitcoin payment sent\n/);
  });

  it('no explorer: the transaction id instead of a link', () => {
    expect(sentShareText(payment(), null, amount)).toMatch(new RegExp(`\\nTransaction: ${TX}$`));
  });

  it('every recipient of a payment to several', () => {
    const two = payment({ recipients: [{ address: TO, amountSats: 1 }, { address: TO2, amountSats: 2 }] });
    expect(sentShareText(two, link, amount)).toBe(
      ['Bitcoin payment sent', `To: ${TO}`, 'Amount: 1 sats', `To: ${TO2}`, 'Amount: 2 sats', `Track it: ${link}`].join('\n'),
    );
  });

  it('never for a cancel, a refresh, several transactions or an unknown', () => {
    expect(paidSomeoneElse(payment({ kind: 'cancel', cancelledSats: 1 }))).toBe(false);
    expect(sentShareText(payment({ kind: 'cancel', recipients: [], cancelledSats: 1 }), link, amount)).toBeNull();
    expect(sentShareText(payment({ kind: 'cancel', cancelledSats: 1 }), link, amount)).toBeNull();
    expect(sentShareText(payment({ kind: 'refresh', recipients: [] }), link, amount)).toBeNull();
    expect(sentShareText(payment({ txids: [TX, TX2] }), link, amount)).toBeNull();
    expect(sentShareText(payment({ recipients: null }), link, amount)).toBeNull();
  });

  it('a rescue to the chosen destination says what is true: bitcoin sent, not a payment', () => {
    const rescue = payment({ kind: 'rescue' });
    expect(sentShareText(rescue, link, amount)).toMatch(/^Bitcoin sent\n/);
    expect(sentShareSubject(rescue)).toBe('Bitcoin sent');
  });
});

describe('the hero figure and the fiat line', () => {
  it('in the owner’s unit, with the unit beside it', () => {
    expect(heroParts(1_250_000, 'btc')).toEqual({ figure: '0.0125', unit: 'BTC' });
    expect(heroParts(1_250_000, 'sats')).toEqual({ figure: '1,250,000', unit: 'sats' });
    expect(heroParts(1, 'sats')).toEqual({ figure: '1', unit: 'sat' });
    // Auto: BTC from 0.1 BTC up, as everywhere else.
    expect(heroParts(1_250_000, 'auto')).toEqual({ figure: '1,250,000', unit: 'sats' });
    expect(heroParts(50_000_000, 'auto')).toEqual({ figure: '0.5', unit: 'BTC' });
  });

  it('fiat only on the main network and never in Bitcoin Only', () => {
    expect(fiatShown('bitcoin', false)).toBe(true);
    expect(fiatShown('bitcoin', undefined)).toBe(true);
    expect(fiatShown('bitcoin', true)).toBe(false);
    for (const n of ['testnet', 'signet', 'regtest']) expect(fiatShown(n, false)).toBe(false);
  });
});

describe('the words, true in any scenario', () => {
  it('the signing screen and Pending transactions, one transaction', () => {
    expect(sentWords('payment')).toEqual({
      title: 'Sent',
      sub: 'On its way. It shows as pending in the vault until it confirms.',
    });
    expect(sentWords('speedup').title).toBe('Sped up');
    // A cancel says its coins come back.
    expect(sentWords('cancel')).toEqual({
      title: 'Cancel sent',
      sub: 'On its way. The coins come back to this vault once it confirms.',
    });
    // A refresh says refreshed, never sent, with what a refresh does behind its ⓘ.
    const refresh = sentWords('refresh');
    expect(refresh.title).toBe('Refreshed');
    expect(refresh.titleInfo?.title).toBe('What a refresh does');
    expect(sentWords('rescue')).toEqual({
      title: 'Rescue sent',
      sub: 'Your coins are on their way to the destination you chose.',
    });
  });

  it('a refresh of several coins, coin by coin', () => {
    expect(sentWords('refresh', { index: 0, total: 3 })).toMatchObject({
      title: 'Coin 1 of 3 refreshed',
      sub: 'On its way. The next coin has its own transaction. Sign it the same way.',
    });
    expect(sentWords('refresh', { index: 2, total: 3 })).toMatchObject({
      title: 'Coin 3 of 3 refreshed',
      sub: 'On its way. It shows as pending in the vault until it confirms.',
    });
    expect(sentWords('payment', { index: 1, total: 2 }).title).toBe('Transaction 2 of 2 sent');
    expect(sentWords('refresh', { index: 0, total: 1 }).title).toBe('Refreshed');
  });

  it('Send all from Pending transactions', () => {
    expect(batchSentWords(3, 0)).toEqual({
      title: 'Refresh sent',
      sub: '3 transactions on the way. They show as pending in the vault until they confirm.',
    });
    expect(batchSentWords(2, 1).title).toBe('2 of 3 sent');
    expect(batchSentWords(1, 0).sub).toBe('1 transaction on the way. It shows as pending in the vault until it confirms.');
  });

  it('the refresh session', () => {
    expect(sessionSentWords(3, 3).title).toBe('Refresh sent');
    expect(sessionSentWords(3, 3).sub).toMatch(/^All 3 transactions are on their way\./);
    expect(sessionSentWords(1, 1).sub).toMatch(/^On its way\./);
    // The failures sit on the card ABOVE the sub line now.
    expect(sessionSentWords(2, 3)).toEqual({
      title: 'Partly sent',
      sub: '2 of 3 went out. The rest are listed above with what the network said.',
    });
    expect(sessionNothingSent(3).title).toBe('Not sent');
  });

  it('no em dash and no jargon in anything a client reads', () => {
    const src = readFileSync(join(__dirname, '..', 'sentPageModel.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const strings = src.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
    expect(strings.length).toBeGreaterThan(20);
    expect(strings.filter((s) => /[—–]/.test(s))).toEqual([]);
    expect(strings.filter((s) => /\b(inputs?|outputs?|outpoints?|UTXOs?)\b/i.test(s))).toEqual([]);
  });
});
