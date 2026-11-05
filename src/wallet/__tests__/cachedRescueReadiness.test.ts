/**
 * The rescue answer this phone can give without asking the chain.
 *
 * Found in a phone test (2026-09-23): six vaults meant six full syncs before the client learned
 * anything, and the Spending policy offered a rescue button that led to a
 * wait. The coins, their heights and the tip are cached already.
 */
import { cachedRescueReadiness } from '../rescueReadiness';

const coin = (txid: string, valueSats: number) => ({ txid, vout: 0, valueSats });

describe('the rescue answer from the cache', () => {
  const OLDER = 100;

  it('says ready when every coin has passed its clock', () => {
    const answer = cachedRescueReadiness(
      [coin('a', 1000), coin('b', 2000)],
      [
        { txid: 'a', blockHeight: 500 },
        { txid: 'b', blockHeight: 400 },
      ],
      700, // 500 + 100 and 400 + 100 are both behind us
      OLDER,
    );
    expect(answer).toEqual({
      state: 'ready',
      sats: 3000,
      coins: [
        { txid: 'a', vout: 0 },
        { txid: 'b', vout: 0 },
      ],
    });
  });

  it('waits for the LAST coin, not the first', () => {
    // The Spending policy's own countdown names the SOONEST coin; a rescue
    // moves all of them, so the newest deposit decides.
    const answer = cachedRescueReadiness(
      [coin('old', 1000), coin('new', 1000)],
      [
        { txid: 'old', blockHeight: 100 },
        { txid: 'new', blockHeight: 690 },
      ],
      700,
      OLDER,
    );
    expect(answer).toEqual({ state: 'waiting', blocks: 90 });
  });

  it('counts a coin whose clock has not started as a full window', () => {
    const answer = cachedRescueReadiness([coin('pending', 1000)], [], 700, OLDER);
    expect(answer).toEqual({ state: 'waiting', blocks: OLDER });
  });

  it('says empty for a vault holding nothing', () => {
    expect(cachedRescueReadiness([], [], 700, OLDER)).toEqual({ state: 'empty' });
  });

  it('claims nothing at all when the cache cannot answer', () => {
    // No coins cached, or no tip: a guess here would enable a button that
    // leads to a wait, which is the thing being fixed.
    expect(cachedRescueReadiness(null, [], 700, OLDER)).toBeNull();
    expect(cachedRescueReadiness(undefined, [], 700, OLDER)).toBeNull();
    expect(cachedRescueReadiness([coin('a', 1)], [], undefined, OLDER)).toBeNull();
  });
});
