/**
 * When a waiting payment began to wait, as far as this phone knows (decided
 * 2026-10-29: a payment waiting for days showed no time at all): the send
 * stamp of a payment sent from this phone, else the first time the vault's
 * list showed it waiting.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

import { noteWaiting, saveSentAt, clearTxReplacements } from '../txReplacements';
import { SENT_AT_TTL_MS, withFirstSeen } from '../txReplacementLogic';
import { waitingLine, waitingMoment } from '../../ui/components/txStatusModel';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const DAY = 24 * 60 * 60 * 1000;

describe('the first-seen record', () => {
  it('stamps what it had not seen, and never moves a stamp later', () => {
    const one = withFirstSeen({}, 'w1', [A], 1000);
    const two = withFirstSeen(one, 'w1', [A, B], 5000);
    expect(two).toEqual({ [`w1:${A}`]: 1000, [`w1:${B}`]: 5000 });
  });

  it('keeps vaults apart, skips anything that is not a txid, and forgets after the sent stamps\' month', () => {
    const t = withFirstSeen({}, 'w1', [A, 'not-a-txid'], 1000);
    expect(withFirstSeen(t, 'w2', [A], 2000)).toEqual({ [`w1:${A}`]: 1000, [`w2:${A}`]: 2000 });
    expect(withFirstSeen(t, 'w1', [], 1000 + SENT_AT_TTL_MS)).toEqual({});
  });

  it('noteWaiting stamps once, keeps the first time, and gives the send stamp where there is one', async () => {
    await saveSentAt('w1', B, 100);
    const first = await noteWaiting('w1', [A, B], 2000);
    expect(first[A]).toEqual({ sentAt: null, firstSeen: 2000 });
    expect(first[B]).toEqual({ sentAt: 100, firstSeen: 2000 });
    const later = await noteWaiting('w1', [A], 9000);
    expect(later[A]).toEqual({ sentAt: null, firstSeen: 2000 });
  });

  it('a removed vault leaves no first-seen times behind', async () => {
    await noteWaiting('gone', [A], 3000);
    await clearTxReplacements('gone');
    expect((await noteWaiting('gone', [A], 7000))[A].firstSeen).toBe(7000);
  });
});

describe('the line under a waiting payment', () => {
  const now = new Date(2026, 9, 29, 18, 30).getTime();

  it('a payment sent from this phone: waiting since the moment it was sent', () => {
    expect(waitingLine({ sentAt: new Date(2026, 9, 29, 14, 3).getTime(), firstSeen: null }, now)).toBe('Waiting since 14:03');
    expect(waitingLine({ sentAt: new Date(2026, 9, 26, 9, 5).getTime(), firstSeen: now }, now)).toBe('Waiting since 26 Oct, 09:05');
  });

  it('any other: first seen, never "since", because it may have waited longer', () => {
    expect(waitingLine({ sentAt: null, firstSeen: new Date(2026, 9, 27, 21, 40).getTime() }, now)).toBe('Waiting, first seen 27 Oct, 21:40');
  });

  it('nothing known: as before', () => {
    expect(waitingLine(undefined, now)).toBe('Waiting for confirmation');
    expect(waitingLine({ sentAt: null, firstSeen: null }, now)).toBe('Waiting for confirmation');
  });

  it('names the year only when it is not this one', () => {
    expect(waitingMoment(new Date(2025, 11, 30, 23, 59).getTime(), now)).toBe('30 Dec 2025, 23:59');
    expect(waitingMoment(now - 3 * DAY, now)).toBe('26 Oct, 18:30');
  });

  it('plain words: no dashes', () => {
    for (const t of [{ sentAt: now, firstSeen: null }, { sentAt: null, firstSeen: now - DAY }]) {
      expect(waitingLine(t, now)).not.toMatch(/[—–]/);
    }
  });
});
