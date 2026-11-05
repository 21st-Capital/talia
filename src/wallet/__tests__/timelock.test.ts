import {
  utxoExpiries,
  nearestExpiryBlocks,
  formatBlocksDuration,
  agedExpiryBlocks,
  pathExpiryBlocks,
  REFRESH_SOON_BLOCKS,
} from '../timelock';
import type { Utxo, WalletTx } from '../../bitcoin/engine/types';

const utxo = (txid: string, vout = 0): Utxo => ({
  txid,
  vout,
  valueSats: 1000,
  keychain: 'external',
});
const tx = (txid: string, blockHeight?: number): WalletTx =>
  ({ txid, received: 1000, sent: 0, netAmount: 1000, confirmed: blockHeight != null, blockHeight } as WalletTx);

describe('utxoExpiries', () => {
  it('computes blocks left per coin from its confirmation height', () => {
    const out = utxoExpiries(
      [utxo('a'), utxo('b')],
      [tx('a', 900_000), tx('b', 890_000)],
      905_000,
      52_560,
    );
    expect(out[0].blocksLeft).toBe(900_000 + 52_560 - 905_000);
    expect(out[1].blocksLeft).toBe(890_000 + 52_560 - 905_000);
  });

  it('null for unconfirmed funding txs and unknown tip', () => {
    expect(utxoExpiries([utxo('a')], [tx('a', undefined)], 905_000, 100)[0].blocksLeft).toBeNull();
    expect(utxoExpiries([utxo('a')], [tx('a', 900_000)], undefined, 100)[0].blocksLeft).toBeNull();
  });

  it('negative when the recovery path is already open', () => {
    const out = utxoExpiries([utxo('a')], [tx('a', 800_000)], 905_000, 1_000);
    expect(out[0].blocksLeft).toBeLessThan(0);
  });
});

describe('nearestExpiryBlocks', () => {
  it('picks the soonest coin', () => {
    const es = utxoExpiries(
      [utxo('a'), utxo('b')],
      [tx('a', 900_000), tx('b', 890_000)],
      905_000,
      52_560,
    );
    expect(nearestExpiryBlocks(es, 52_560)).toBe(890_000 + 52_560 - 905_000);
  });

  it('treats unconfirmed coins as a full window', () => {
    const es = utxoExpiries([utxo('a')], [tx('a', undefined)], 905_000, 52_560);
    expect(nearestExpiryBlocks(es, 52_560)).toBe(52_560);
  });

  it('null with no coins', () => {
    expect(nearestExpiryBlocks([], 52_560)).toBeNull();
  });
});

describe('formatBlocksDuration (Liana-identical units)', () => {
  it("matches Liana's month length — the observed 8mo13d case", () => {
    // An observed vault: Liana showed '8 months, 13 days'; the old 30-day
    // month math rendered the SAME blocks as '8 months, 16 days'.
    expect(formatBlocksDuration(8 * 4383 + 13 * 144)).toBe('8 months, 13 days');
  });
  it("matches Liana's year style — '1 year, 1 month, 15 days'", () => {
    expect(formatBlocksDuration(52596 + 4383 + 15 * 144)).toBe('1 year, 1 month, 15 days');
  });
  it('plain months / days / hours / now', () => {
    expect(formatBlocksDuration(4383)).toBe('1 month');
    expect(formatBlocksDuration(5 * 144)).toBe('5 days');
    expect(formatBlocksDuration(12)).toBe('2 hours');
    expect(formatBlocksDuration(1)).toBe('10 minutes'); // the heir TEST lock
    expect(formatBlocksDuration(5)).toBe('50 minutes');
    expect(formatBlocksDuration(0)).toBe('now');
    expect(formatBlocksDuration(-10)).toBe('now');
  });
});

describe('agedExpiryBlocks', () => {
  const at = 1_700_000_000_000;

  it('null when the cache is missing', () => {
    expect(agedExpiryBlocks(undefined, undefined, at)).toBeNull();
    expect(agedExpiryBlocks(5_000, undefined, at)).toBeNull();
    expect(agedExpiryBlocks(undefined, at, at)).toBeNull();
  });

  it('is the cached value at the moment it was computed', () => {
    expect(agedExpiryBlocks(5_000, at, at)).toBe(5_000);
  });

  it('takes one block off per ten minutes, whole blocks only', () => {
    expect(agedExpiryBlocks(5_000, at, at + 599_999)).toBe(5_000);
    expect(agedExpiryBlocks(5_000, at, at + 600_000)).toBe(4_999);
    expect(agedExpiryBlocks(5_000, at, at + 60 * 60_000)).toBe(4_994);
    expect(agedExpiryBlocks(5_000, at, at + 24 * 60 * 60_000)).toBe(5_000 - 144);
  });

  it('goes past zero once the cached expiry has been overtaken', () => {
    expect(agedExpiryBlocks(2, at, at + 5 * 600_000)).toBe(-3);
  });

  it('defaults `now` to the wall clock', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(at + 3 * 600_000);
    try {
      expect(agedExpiryBlocks(5_000, at)).toBe(4_997);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('pathExpiryBlocks', () => {
  it('is the nearest expiry itself for the smallest-older path', () => {
    expect(pathExpiryBlocks(1_234, 52_560, 52_560)).toBe(1_234);
  });

  it('shifts a longer path by the difference in locks', () => {
    // Coin confirmed at h, tip t: shortest path h + 52 560 − t, longer path
    // h + 65 700 − t. The gap between them is the gap between the locks.
    expect(pathExpiryBlocks(1_234, 52_560, 65_700)).toBe(1_234 + 13_140);
  });

  it('a shorter path can be open while a longer one is still closed', () => {
    expect(pathExpiryBlocks(-100, 4_383, 52_596)).toBe(-100 + 48_213);
    expect(pathExpiryBlocks(-100, 4_383, 52_596)).toBeGreaterThan(0);
  });

  it('agrees with the per-coin maths', () => {
    const short = nearestExpiryBlocks(
      utxoExpiries([utxo('a'), utxo('b')], [tx('a', 900_000), tx('b', 890_000)], 905_000, 4_383),
      4_383,
    );
    const long = nearestExpiryBlocks(
      utxoExpiries([utxo('a'), utxo('b')], [tx('a', 900_000), tx('b', 890_000)], 905_000, 52_596),
      52_596,
    );
    expect(pathExpiryBlocks(short, 4_383, 52_596)).toBe(long);
  });

  it('null passes through', () => {
    expect(pathExpiryBlocks(null, 4_383, 52_596)).toBeNull();
  });
});

describe('REFRESH_SOON_BLOCKS', () => {
  it('is three calendar-average months of blocks', () => {
    expect(REFRESH_SOON_BLOCKS).toBe(13_149);
  });
});
