/**
 * The signing ceremony's stage machine (design A "The courier", decided
 * 2026-10-03): which screen the client sees, fed by what the phone can
 * actually see of the device.
 */
import {
  BAR_CAP,
  NAME_BEFORE_MESSAGES,
  QUIET_MS,
  RESUME_MS,
  advanceCeremony,
  asksNameFirst,
  backShown,
  ceremonyFeed,
  ceremonyViewChanged,
  failureSignal,
  legKey,
  legOrder,
  pathFor,
  readEstimate,
  signEstimate,
  startCeremony,
} from '../signingCeremony';
import type { CeremonyConfig, CeremonyLeg, CeremonySignal, CeremonyState, SigningBrand } from '../signingCeremony';
import { DECLINED_ON_LEDGER, ledgerErrorMessage } from '../../../bitcoin/ledger/errors';

const LEDGER: CeremonyConfig = { brand: 'ledger', readEstimate: 200, signEstimate: 40, nameFirst: false };
const OLD_APP: CeremonyConfig = { ...LEDGER, nameFirst: true };
const BITBOX: CeremonyConfig = { brand: 'bitbox', readEstimate: 0, signEstimate: 0, nameFirst: false };

/** Run signals through, from a fresh ceremony at t=0. */
function run(cfg: CeremonyConfig, signals: CeremonySignal[]): CeremonyState {
  return signals.reduce((s, sig) => advanceCeremony(s, sig, cfg), startCeremony(0));
}

/** `n` messages, one every 80 ms from `from` (the Ledger's pace), then the time after. */
function chatter(start: number, n: number, from = 0): { signals: CeremonySignal[]; end: number } {
  const signals: CeremonySignal[] = [];
  let at = from;
  for (let i = 1; i <= n; i++) {
    at += 80;
    signals.push({ type: 'messages', count: start + i, at });
  }
  return { signals, end: at };
}

describe('today’s estimate', () => {
  it('sizes the legs by the coins, as calibrated on the 7-coin spend', () => {
    expect(readEstimate(7, 2)).toBe(50 + 350 + 20);
    expect(signEstimate(7)).toBe(10 + 105);
    // Never zero: a missing count still gives the bar something to fill.
    expect(readEstimate(0, 0)).toBe(110);
    expect(signEstimate(0)).toBe(25);
  });
});

describe('screen 1: messages flowing', () => {
  it('fills toward the device against the estimate, capped until the device goes quiet', () => {
    const a = run(LEDGER, chatter(0, 100).signals);
    expect(a.leg).toBe('send');
    expect(a.fill).toBeCloseTo(0.5);
    const b = run(LEDGER, chatter(0, 400).signals);
    expect(b.leg).toBe('send');
    expect(b.fill).toBe(BAR_CAP);
  });

  it('never moves backward on its own', () => {
    let s = run(LEDGER, chatter(0, 100).signals);
    // A late, lower count (out of order) leaves the bar where it was.
    s = advanceCeremony(s, { type: 'messages', count: 50, at: 9000 }, LEDGER);
    expect(s.fill).toBeCloseTo(0.5);
  });
});

describe('screen 2: the device has gone quiet', () => {
  it('opens after 1.5 s without a message once at least 20 went', () => {
    const { signals, end } = chatter(0, 30);
    const early = run(LEDGER, [...signals, { type: 'tick', at: end + QUIET_MS - 100 }]);
    expect(early.leg).toBe('send');
    const quiet = run(LEDGER, [...signals, { type: 'tick', at: end + QUIET_MS + 100 }]);
    expect(quiet.leg).toBe('approve');
    expect(quiet.asks).toBe('review');
    expect(quiet.turn).toBe(1);
  });

  it('a pause in the first 20 messages is not the client’s turn (today’s rule)', () => {
    const { signals, end } = chatter(0, 15);
    expect(run(LEDGER, [...signals, { type: 'tick', at: end + 5000 }]).leg).toBe('send');
  });

  it('messages again: the signatures are on their way back (screen 3)', () => {
    const { signals, end } = chatter(0, 30);
    const back = chatter(30, 10, end + 4000);
    const s = run(LEDGER, [...signals, { type: 'tick', at: end + 2000 }, ...back.signals, { type: 'tick', at: back.end + 100 }]);
    expect(s.leg).toBe('return');
    // The way back has its own bar, from nothing, against the signing estimate.
    expect(s.fill).toBe(0);
    const more = advanceCeremony(s, { type: 'messages', count: 60, at: back.end + 200 }, LEDGER);
    expect(more.fill).toBeCloseTo(20 / 40);
  });

  it('stays the client’s turn while the device is quiet', () => {
    const { signals, end } = chatter(0, 30);
    const s = run(LEDGER, [...signals, { type: 'tick', at: end + 2000 }, { type: 'tick', at: end + 60_000 }]);
    expect(s.leg).toBe('approve');
  });
});

describe('Bitcoin app 2.2.1 to 2.4.1: the vault’s name first', () => {
  it('is asked only by those versions, and only for a registered vault', () => {
    expect(asksNameFirst('2.2.1', true)).toBe(true);
    expect(asksNameFirst('2.3.0', true)).toBe(true);
    expect(asksNameFirst('2.4.1', true)).toBe(true);
    expect(asksNameFirst('2.4.2', true)).toBe(false);
    expect(asksNameFirst('2.5.0', true)).toBe(false);
    expect(asksNameFirst('2.2.0', true)).toBe(false);
    expect(asksNameFirst('2.3.0', false)).toBe(false);
    expect(asksNameFirst(undefined, true)).toBe(false);
  });

  it('the first quiet a few messages in is the name; then back to sending; then the review', () => {
    const first = chatter(0, 4);
    let s = run(OLD_APP, [...first.signals, { type: 'tick', at: first.end + QUIET_MS + 100 }]);
    expect(s.leg).toBe('approve');
    expect(s.asks).toBe('name');
    const fillAtName = s.fill;
    // The client approved the name: the transaction itself is still on its way.
    const resumedAt = first.end + 5000;
    s = advanceCeremony(s, { type: 'messages', count: 5, at: resumedAt }, OLD_APP);
    s = advanceCeremony(s, { type: 'tick', at: resumedAt + 100 }, OLD_APP);
    expect(s.leg).toBe('send');
    // The bar picks up where it stopped, never backward.
    expect(s.fill).toBeGreaterThanOrEqual(fillAtName);
    const rest = chatter(5, 59, resumedAt);
    s = rest.signals.reduce((x, sig) => advanceCeremony(x, sig, OLD_APP), s);
    expect(s.fill).toBeCloseTo(64 / 200);
    // The second quiet is the review, and the name is never asked twice.
    s = advanceCeremony(s, { type: 'tick', at: rest.end + QUIET_MS + 100 }, OLD_APP);
    expect(s.leg).toBe('approve');
    expect(s.asks).toBe('review');
    expect(s.turn).toBe(2);
  });

  it('the name is any quiet before the first coin is read, past the 20-message rule too', () => {
    const late = chatter(0, NAME_BEFORE_MESSAGES - 1);
    const s = run(OLD_APP, [...late.signals, { type: 'tick', at: late.end + QUIET_MS + 100 }]);
    expect(s).toMatchObject({ leg: 'approve', asks: 'name' });
    const past = chatter(0, NAME_BEFORE_MESSAGES);
    expect(run(OLD_APP, [...past.signals, { type: 'tick', at: past.end + QUIET_MS + 100 }])).toMatchObject({
      leg: 'approve',
      asks: 'review',
    });
  });

  it('a name approved inside the quiet window is missed, and the review is then the review, never the name', () => {
    // Messages 1 to 5, the name on the device, approved in under QUIET_MS:
    // the ticks never see a quiet long enough.
    const first = chatter(0, 5);
    let s = run(OLD_APP, [...first.signals, { type: 'tick', at: first.end + 400 }, { type: 'tick', at: first.end + 800 }]);
    expect(s.leg).toBe('send');
    const resumed = chatter(5, 250, first.end + QUIET_MS - 200);
    s = [...resumed.signals, { type: 'tick', at: resumed.end + QUIET_MS + 100 } as CeremonySignal].reduce(
      (x, sig) => advanceCeremony(x, sig, OLD_APP),
      s,
    );
    // The device shows the payment: the whole card, not the name alone.
    expect(s.leg).toBe('approve');
    expect(s.asks).toBe('review');
    // Hold to sign: the messages resume and that is the way back, not "Sending".
    s = advanceCeremony(s, { type: 'messages', count: 256, at: resumed.end + 5000 }, OLD_APP);
    s = advanceCeremony(s, { type: 'tick', at: resumed.end + 5100 }, OLD_APP);
    expect(s.leg).toBe('return');
  });

  it('a newer app never shows the name page, even on an early pause', () => {
    const first = chatter(0, 4);
    expect(run(LEDGER, [...first.signals, { type: 'tick', at: first.end + 5000 }]).leg).toBe('send');
  });
});

describe('the fuller form', () => {
  it('restarts the way there from nothing, and says so', () => {
    const { signals, end } = chatter(0, 120);
    let s = run(LEDGER, [...signals, { type: 'tick', at: end + 2000 }]);
    expect(s.leg).toBe('approve');
    s = advanceCeremony(s, { type: 'restart' }, LEDGER);
    expect(s).toMatchObject({ leg: 'send', fill: 0, restarted: true, signed: false });
    // Counted from the restart, not from the first attempt.
    s = advanceCeremony(s, { type: 'messages', count: 220, at: end + 3000 }, LEDGER);
    expect(s.fill).toBeCloseTo(100 / 200);
  });
});

describe('the signatures back, and the broadcast', () => {
  it('holds the bar near its end until the network answers', () => {
    const { signals, end } = chatter(0, 30);
    let s = run(LEDGER, [...signals, { type: 'tick', at: end + 2000 }]);
    s = advanceCeremony(s, { type: 'signed' }, LEDGER);
    expect(s).toMatchObject({ leg: 'return', signed: true, fill: BAR_CAP, sending: false });
    s = advanceCeremony(s, { type: 'sending' }, LEDGER);
    expect(s.sending).toBe(true);
    expect(s.fill).toBe(BAR_CAP);
    // Further chatter or ticks never move it on its own.
    s = advanceCeremony(s, { type: 'messages', count: 999, at: end + 9000 }, LEDGER);
    expect(s.fill).toBe(BAR_CAP);
    expect(advanceCeremony(s, { type: 'tick', at: end + 99_000 }, LEDGER).leg).toBe('return');
  });

  it('signatures before the quiet was noticed still land on the way back', () => {
    const s = run(LEDGER, [...chatter(0, 10).signals, { type: 'signed' }]);
    expect(s.leg).toBe('return');
  });
});

describe('the endings', () => {
  it('the decline is exact: the mapped 6985 sentence and the BitBox’s own abort', () => {
    expect(failureSignal(new Error(DECLINED_ON_LEDGER))).toEqual({ type: 'declined' });
    expect(failureSignal(new Error(ledgerErrorMessage({ errorCode: '6985' })))).toEqual({ type: 'declined' });
    expect(failureSignal(new Error('bitbox error: aborted by the user'))).toEqual({ type: 'declined' });
    const gone = 'The Ledger disconnected. Bring it close to the phone and reconnect.';
    expect(failureSignal(new Error(gone))).toEqual({ type: 'failed', message: gone });
    expect(failureSignal(new Error('Declined'))).toMatchObject({ type: 'failed' });
  });

  it('an ending is final: late signals change nothing', () => {
    const declined = run(LEDGER, [...chatter(0, 30).signals, { type: 'declined' }]);
    expect(declined.leg).toBe('declined');
    for (const sig of [{ type: 'signed' }, { type: 'restart' }, { type: 'tick', at: 1e9 }] as CeremonySignal[]) {
      expect(advanceCeremony(declined, sig, LEDGER)).toBe(declined);
    }
    const failed = run(LEDGER, [{ type: 'failed', message: 'x' }]);
    expect(failed).toMatchObject({ leg: 'failed', failure: 'x' });
  });

  it('a failure while sending clears the held Back', () => {
    const s = run(LEDGER, [{ type: 'signed' }, { type: 'sending' }, { type: 'failed', message: 'x' }]);
    expect(s.sending).toBe(false);
  });
});

describe('the BitBox: no messages to count, no bars', () => {
  it('a short beat, then its turn, until the one call answers', () => {
    let s = startCeremony(0);
    // Its clock does nothing: the BitBox has no conversation to read.
    s = advanceCeremony(s, { type: 'tick', at: 60_000 }, BITBOX);
    expect(s.leg).toBe('send');
    s = advanceCeremony(s, { type: 'handedOver' }, BITBOX);
    expect(s.leg).toBe('approve');
    s = advanceCeremony(s, { type: 'signed' }, BITBOX);
    expect(s.leg).toBe('return');
  });
});

describe('the path between the phone and the device', () => {
  const LEGS: CeremonyLeg[] = ['send', 'approve', 'return', 'declined', 'failed'];
  const BRANDS: SigningBrand[] = ['ledger', 'bitbox'];

  it('never a bar on the BitBox, never a bar on the client’s turn', () => {
    for (const brand of BRANDS) {
      for (const leg of LEGS) {
        const p = pathFor(brand, leg);
        if (brand === 'bitbox' || leg === 'approve') expect({ brand, leg, kind: p.kind }).not.toEqual({ brand, leg, kind: 'bar' });
      }
    }
    expect(pathFor('ledger', 'approve').kind).toBe('chevrons');
    expect(pathFor('bitbox', 'approve').kind).toBe('chevrons');
  });

  it('a Ledger’s legs are one bar each way; the BitBox’s one pulse each way', () => {
    expect(pathFor('ledger', 'send')).toEqual({ kind: 'bar', towardPhone: false });
    expect(pathFor('ledger', 'return')).toEqual({ kind: 'bar', towardPhone: true });
    expect(pathFor('bitbox', 'send')).toEqual({ kind: 'pulse', towardPhone: false });
    expect(pathFor('bitbox', 'return')).toEqual({ kind: 'pulse', towardPhone: true });
    expect(pathFor('ledger', 'declined').kind).toBe('dead');
  });
});

describe('Back at the foot', () => {
  it('on the travelling screens, held once the transaction is on its way, never on the client’s turn', () => {
    const s = startCeremony(0);
    expect(backShown(s)).toBe('live');
    expect(backShown({ ...s, leg: 'approve' })).toBe('none');
    expect(backShown({ ...s, leg: 'return', signed: true })).toBe('live');
    expect(backShown({ ...s, leg: 'return', signed: true, sending: true })).toBe('held');
    // The endings have their own two buttons.
    expect(backShown({ ...s, leg: 'declined' })).toBe('none');
  });
});

describe('the feed', () => {
  it('tells the screen only what it can see: a leg, a whole percent of bar', () => {
    const feed = ceremonyFeed();
    let calls = 0;
    const off = feed.subscribe(() => {
      calls += 1;
    });
    feed.push({ type: 'messages', count: 1, at: 1 }); // nothing started: ignored
    expect(calls).toBe(0);
    feed.start(LEDGER, 0);
    expect(calls).toBe(1);
    feed.push({ type: 'tick', at: 100 }); // nothing visible changed
    expect(calls).toBe(1);
    feed.push({ type: 'messages', count: 1, at: 80 }); // 0.5% of the bar: rounds to 1
    feed.push({ type: 'messages', count: 2, at: 160 }); // 1%: the same whole percent
    expect(calls).toBe(2);
    feed.push({ type: 'declined' });
    expect(feed.get()?.leg).toBe('declined');
    feed.reset();
    expect(feed.get()).toBeNull();
    off();
    feed.start(LEDGER, 0);
    expect(calls).toBe(4);
  });

  it('a fresh start redraws even when the last attempt ended on the same leg', () => {
    expect(ceremonyViewChanged(null, startCeremony(0))).toBe(true);
    expect(ceremonyViewChanged(startCeremony(0), startCeremony(5))).toBe(false);
    expect(RESUME_MS).toBeLessThan(QUIET_MS);
  });
});

describe('several transactions in one visit (the refresh session, decided 2026-10-05)', () => {
  it('a ceremony starts with its place in the batch, carried in the state so one signal moves the leg and the count together', () => {
    expect(startCeremony(0).batch).toBeNull();
    expect(startCeremony(0, { index: 2, count: 3 }).batch).toEqual({ index: 2, count: 3 });
    const feed = ceremonyFeed();
    feed.start({ ...LEDGER, batch: { index: 2, count: 3 } }, 0);
    expect(feed.get()).toMatchObject({ leg: 'send', batch: { index: 2, count: 3 } });
    // The place is kept through every leg.
    feed.push({ type: 'signed' });
    expect(feed.get()).toMatchObject({ leg: 'return', batch: { index: 2, count: 3 } });
    // The next transaction is a fresh start on the same feed.
    feed.start({ ...LEDGER, batch: { index: 3, count: 3 } }, 0);
    expect(feed.get()).toMatchObject({ leg: 'send', fill: 0, batch: { index: 3, count: 3 } });
  });

  it('a change of place is a change the screen must draw', () => {
    const one = startCeremony(0, { index: 1, count: 3 });
    expect(ceremonyViewChanged(one, { ...one, batch: { index: 2, count: 3 } })).toBe(true);
    expect(ceremonyViewChanged(one, { ...one, batch: { index: 1, count: 4 } })).toBe(true);
    expect(ceremonyViewChanged(one, { ...one })).toBe(false);
  });

  it('the slide is keyed by the place and the leg, so the next transaction comes in as a new page, not as a step back', () => {
    const first = startCeremony(0, { index: 1, count: 2 });
    const second = startCeremony(0, { index: 2, count: 2 });
    expect(legKey({ ...first, leg: 'return' })).toBe('1:return');
    expect(legKey(second)).toBe('2:send');
    // Within one transaction the legs keep their order (the name approved
    // sends the client back from approve to send, from the left).
    expect(legOrder(first)).toEqual(['1:send', '1:approve', '1:return', '1:declined', '1:failed']);
    // The last leg of the one before is not among the next one's keys, which
    // is what makes StepTransition slide it in from the right.
    expect(legOrder(second)).not.toContain(legKey({ ...first, leg: 'return' }));
    // A payment of one keys as before, in the legs' order.
    expect(legKey(startCeremony(0))).toBe('0:send');
    expect(legOrder(startCeremony(0))).toEqual(['0:send', '0:approve', '0:return', '0:declined', '0:failed']);
  });
});
