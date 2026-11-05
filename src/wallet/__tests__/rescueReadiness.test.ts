import { cachedRescueReadiness, oldestCoinArrival, rescueModeLapsed, rescueReadiness } from '../rescueReadiness';

const OLDER = 65_000;
const coin = (txid: string, valueSats: number) => ({ txid, vout: 0, valueSats });
const exp = (txid: string, blocksLeft: number | null) => ({ txid, vout: 0, blocksLeft });

describe('rescue readiness (decided 2026-09-21)', () => {
  it('is ready only when EVERY coin has reached the rescue path', () => {
    const r = rescueReadiness([coin('a', 1000), coin('b', 2000)], [exp('a', 0), exp('b', -5)], OLDER);
    expect(r).toEqual({ state: 'ready', sats: 3000, coins: [{ txid: 'a', vout: 0 }, { txid: 'b', vout: 0 }] });
  });

  it('waits for the LAST coin, not the first', () => {
    const r = rescueReadiness([coin('a', 1000), coin('b', 2000)], [exp('a', 0), exp('b', 4000)], OLDER);
    expect(r).toEqual({ state: 'waiting', blocks: 4000 });
    const two = rescueReadiness([coin('a', 1), coin('b', 1)], [exp('a', 100), exp('b', 9000)], OLDER);
    expect(two).toEqual({ state: 'waiting', blocks: 9000 });
  });

  it('counts a coin whose clock has not started as a full window', () => {
    expect(rescueReadiness([coin('a', 1)], [exp('a', null)], OLDER)).toEqual({ state: 'waiting', blocks: OLDER });
    expect(rescueReadiness([coin('a', 1)], [], OLDER)).toEqual({ state: 'waiting', blocks: OLDER });
  });

  it('has nothing to rescue in an empty vault', () => {
    expect(rescueReadiness([], [], OLDER)).toEqual({ state: 'empty' });
  });
});

describe('a vault whose coins a waiting rescue spent', () => {
  it('reads as empty: the engines list only unspent coins, waiting spends counted', () => {
    expect(rescueReadiness([], [], OLDER)).toEqual({ state: 'empty' });
    expect(cachedRescueReadiness([], [], 100, OLDER)).toEqual({ state: 'empty' });
  });
});

describe('when the oldest coin arrived', () => {
  const NOW = Date.parse('2026-10-05T12:00:00Z');
  const tx = (txid: string, timestamp?: number, confirmed = true) => ({ txid, confirmed, timestamp });

  it('is the earliest confirming block among the coins held now', () => {
    expect(oldestCoinArrival([{ txid: 'a' }, { txid: 'b' }], [tx('a', 2000), tx('b', 1000)], NOW)).toBe(1_000_000);
  });
  it('an unconfirmed coin arrived now', () => {
    expect(oldestCoinArrival([{ txid: 'a' }], [tx('a', undefined, false)], NOW)).toBe(NOW);
  });
  it('a coin it cannot date counts as old, so it never ends anything', () => {
    expect(oldestCoinArrival([{ txid: 'a' }, { txid: 'b' }], [tx('a', 2000)], NOW)).toBe(0);
    expect(oldestCoinArrival([{ txid: 'a' }], [tx('a')], NOW)).toBe(0);
  });
  it('an empty vault has none', () => {
    expect(oldestCoinArrival([], [], NOW)).toBeNull();
  });
});

describe('the phone resets rescue mode only when the vault was refreshed after activation (decided 2026-10-05)', () => {
  const ACTIVATED = '2026-10-05T10:00:00Z';
  const at = Date.parse(ACTIVATED);
  const ready = { state: 'ready' as const, sats: 1, coins: [] };
  const waiting = { state: 'waiting' as const, blocks: 10 };
  const empty = { state: 'empty' as const };

  it('every coin arrived after activation: the coins were refreshed', () => {
    expect(rescueModeLapsed([{ result: waiting, oldestArrival: at + 60_000 }], ACTIVATED)).toBe(true);
  });

  it('a deposit or a stranger’s dust payment leaves the old coins in place: no reset', () => {
    // The vault waits on the new coin, but its oldest coin predates activation.
    expect(rescueModeLapsed([{ result: waiting, oldestArrival: at - 86_400_000 }], ACTIVATED)).toBe(false);
  });

  it('a vault not yet open when rescue mode was switched on is not a refresh', () => {
    expect(rescueModeLapsed([{ result: waiting, oldestArrival: at - 1 }], ACTIVATED)).toBe(false);
  });

  it('a vault that is ready, or empty, is never reset', () => {
    expect(rescueModeLapsed([{ result: ready, oldestArrival: at + 1 }], ACTIVATED)).toBe(false);
    expect(rescueModeLapsed([{ result: empty, oldestArrival: null }], ACTIVATED)).toBe(false);
  });

  it('every vault rescue mode is on for must say so', () => {
    expect(
      rescueModeLapsed(
        [
          { result: waiting, oldestArrival: at + 1 },
          { result: waiting, oldestArrival: at - 1 },
        ],
        ACTIVATED,
      ),
    ).toBe(false);
  });

  it('never decides on half the answers, on nothing, or without the activation time', () => {
    expect(rescueModeLapsed([{ result: null, oldestArrival: at + 1 }], ACTIVATED)).toBe(false);
    expect(rescueModeLapsed([{ result: waiting }], ACTIVATED)).toBe(false);
    expect(rescueModeLapsed([], ACTIVATED)).toBe(false);
    expect(rescueModeLapsed([{ result: waiting, oldestArrival: at + 1 }], null)).toBe(false);
    expect(rescueModeLapsed([{ result: waiting, oldestArrival: at + 1 }], 'not a time')).toBe(false);
  });
});
