import {
  blocksUntilMined,
  etaForRate,
  etaLine,
  etaNeedsBlocks,
  etaPhraseForMinutes,
  TIER_ETA,
} from '../txEta';
import type { MempoolBlock } from '../txEta';
import { readMempoolBlocks } from '../mempoolBlocks';
import { FALLBACK_PRESETS } from '../feeEstimates';

const LIVE = { fast: 12, medium: 8.5, slow: 4.2, live: true };

/** A full projected block paying between `lo` and `hi`. */
const full = (lo: number, hi: number): MempoolBlock => ({
  blockVSize: 997_000,
  feeRange: [lo, lo + (hi - lo) * 0.1, lo + (hi - lo) * 0.25, (lo + hi) / 2, lo + (hi - lo) * 0.75, lo + (hi - lo) * 0.9, hi],
});

describe('the ETA rule (design Option A)', () => {
  it('reads the live tiers first', () => {
    expect(etaForRate(12, LIVE)).toBe('about 10 minutes');
    expect(etaForRate(30, LIVE)).toBe('about 10 minutes');
    expect(etaForRate(8.5, LIVE)).toBe('about 30 minutes');
    expect(etaForRate(4.2, LIVE)).toBe('about an hour');
    expect(etaForRate(5, LIVE)).toBe(TIER_ETA.slow);
  });

  it('says nothing offline: the static fallback tiers are not the network', () => {
    expect(etaForRate(50, FALLBACK_PRESETS)).toBeNull();
    expect(etaForRate(50, null)).toBeNull();
  });

  it('places a rate below Slow in the first projected block whose range covers it', () => {
    const blocks = [full(12, 80), full(8, 12), full(5, 8), full(4.3, 5), full(3, 4.3), full(2, 3), full(1.5, 2)];
    // 2.5 sat/vB lands in the sixth block: 60 minutes, "about an hour".
    expect(blocksUntilMined(2.5, blocks)).toBe(6);
    expect(etaForRate(2.5, LIVE, blocks)).toBe('about an hour');
    // 1.6 sat/vB: the seventh block, 70 minutes, still about an hour.
    expect(etaForRate(1.6, LIVE, blocks)).toBe('about an hour');
  });

  it('reads deep into the last block, which holds the rest of the mempool', () => {
    // mempool.space's eighth block: 30 million vB between 1 and 5 sat/vB.
    const tail: MempoolBlock = { blockVSize: 30_000_000, feeRange: [1, 1.2, 1.5, 2, 3, 4, 5] };
    const blocks = [full(20, 80), full(12, 20), full(8, 12), full(6, 8), full(5.5, 6), full(5.2, 5.5), full(5, 5.2), tail];
    // At 1.5, two sixths of the tail pay less: four sixths (20M vB, 20 full
    // blocks) are ahead, so it goes in the 21st.
    expect(blocksUntilMined(1.5, blocks)).toBe(7 + 21);
    expect(etaForRate(1.5, LIVE, blocks)).toBe('about 5 hours');
    // At the very bottom of the tail everything is ahead: 30 blocks, so the 31st.
    expect(blocksUntilMined(1, blocks)).toBe(7 + 31);
    expect(etaForRate(1, LIVE, blocks)).toBe('about 6 hours');
  });

  it('counts the landing block inside the tail the way it counts an ordinary block', () => {
    const tail: MempoolBlock = { blockVSize: 30_000_000, feeRange: [1, 1.2, 1.5, 2, 3, 4, 5] };
    const blocks = [full(20, 80), full(12, 20), full(8, 12), full(6, 8), full(5.5, 6), full(5.2, 5.5), full(5, 5.2), tail];
    // 1.55 sat/vB: 19.5M vB ahead fills 19 blocks, so the 20th.
    expect(blocksUntilMined(1.55, blocks)).toBe(7 + 20);
    // Next to nothing ahead: the first block of the tail, as an ordinary eighth block would be.
    expect(blocksUntilMined(4.99, blocks)).toBe(7 + 1);
    // Exactly one block ahead: the second.
    const small: MempoolBlock = { blockVSize: 2_000_000, feeRange: [1, 3] };
    expect(blocksUntilMined(2, [small])).toBe(2);
  });

  it('leaves the line out past the projection', () => {
    const blocks = [full(12, 80), full(8, 12), full(5, 8)];
    expect(blocksUntilMined(1, blocks)).toBeNull();
    expect(etaForRate(1, LIVE, blocks)).toBeNull();
    expect(etaForRate(1, LIVE, null)).toBeNull();
    expect(etaForRate(1, LIVE)).toBeNull();
  });

  it('is never quicker than Slow once below it', () => {
    // A projection that disagrees with the tiers (block 2) still reads an hour.
    expect(etaForRate(4, LIVE, [full(10, 20), full(3, 10)])).toBe('about an hour');
  });

  it('asks for the projection only below Slow', () => {
    expect(etaNeedsBlocks(5, LIVE)).toBe(false);
    expect(etaNeedsBlocks(4, LIVE)).toBe(true);
    expect(etaNeedsBlocks(4, FALLBACK_PRESETS)).toBe(false);
  });

  it('writes the phrases the design uses', () => {
    expect(etaPhraseForMinutes(10)).toBe('about 10 minutes');
    expect(etaPhraseForMinutes(30)).toBe('about 30 minutes');
    expect(etaPhraseForMinutes(60)).toBe('about an hour');
    expect(etaPhraseForMinutes(80)).toBe('about an hour');
    expect(etaPhraseForMinutes(180)).toBe('about 3 hours');
    expect(etaPhraseForMinutes(0)).toBeNull();
    expect(etaLine('about 3 hours')).toBe('About 3 hours at this fee');
    expect(etaLine(null)).toBeNull();
  });

  it('ignores junk rates and junk blocks', () => {
    expect(etaForRate(NaN, LIVE)).toBeNull();
    expect(etaForRate(0, LIVE)).toBeNull();
    expect(blocksUntilMined(2, [{ blockVSize: 0, feeRange: [1] }, { blockVSize: 900_000, feeRange: [] }])).toBeNull();
  });
});

describe('readMempoolBlocks', () => {
  it('keeps the blocks the rule can use', () => {
    const blocks = readMempoolBlocks([
      { blockSize: 1_600_000, blockVSize: 997_955, nTx: 3100, totalFees: 4_000_000, medianFee: 3.1, feeRange: [2.5, 2.8, 3, 3.1, 4, 6, 120] },
      { blockVSize: 'big', feeRange: [1] },
      { blockVSize: 50_000_000, feeRange: [1, 'x', 2] },
      null,
    ]);
    expect(blocks).toEqual([
      { blockVSize: 997_955, feeRange: [2.5, 2.8, 3, 3.1, 4, 6, 120], medianFee: 3.1 },
      { blockVSize: 50_000_000, feeRange: [1, 2], medianFee: undefined },
    ]);
  });

  it('answers null to anything else', () => {
    expect(readMempoolBlocks(null)).toBeNull();
    expect(readMempoolBlocks({})).toBeNull();
    expect(readMempoolBlocks([])).toBeNull();
  });
});

describe('getTxEta (fetch mocked)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.resetModules();
  });

  it('never throws and says nothing when mempool.space cannot be reached', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const { getTxEta } = require('../mempoolBlocks') as typeof import('../mempoolBlocks');
    await expect(getTxEta(3, 'bitcoin')).resolves.toBeNull();
  });

  it('reads the tiers, and the projection only below Slow', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn((url: string) => {
      calls.push(url);
      const body = url.endsWith('/fees/precise')
        ? { fastestFee: 12, halfHourFee: 8.5, hourFee: 4.2 }
        : url.endsWith('/fees/mempool-blocks')
          ? [full(12, 80), full(8, 12), full(5, 8), full(4.3, 5), full(3, 4.3), full(2, 3)]
          : null;
      return Promise.resolve({ ok: body != null, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;
    const { getTxEta } = require('../mempoolBlocks') as typeof import('../mempoolBlocks');
    await expect(getTxEta(9, 'bitcoin')).resolves.toBe('about 30 minutes');
    expect(calls.some((u) => u.endsWith('/fees/mempool-blocks'))).toBe(false);
    await expect(getTxEta(2.5, 'bitcoin')).resolves.toBe('about an hour');
    expect(calls.some((u) => u.endsWith('/fees/mempool-blocks'))).toBe(true);
  });

  it('says nothing on a test network, and asks mainnet nothing for it', async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ fastestFee: 12, halfHourFee: 8.5, hourFee: 4.2 }) }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { getTxEta } = require('../mempoolBlocks') as typeof import('../mempoolBlocks');
    for (const network of ['testnet', 'signet', 'regtest'] as const) {
      await expect(getTxEta(9, network)).resolves.toBeNull();
      await expect(getTxEta(1, network)).resolves.toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    // The same rate on mainnet has an answer.
    await expect(getTxEta(9, 'bitcoin')).resolves.toBe('about 30 minutes');
  });
});
