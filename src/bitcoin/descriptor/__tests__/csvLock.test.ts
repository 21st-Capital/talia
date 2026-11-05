/**
 * Decided 2026-09-26: BIP-68 time-based relative locks
 * (bit 22) were read as block counts, so older(4194560), about 36 hours,
 * read as about 80 years. csvLock is the one reader.
 */
import { csvLock, minOlderBlocks } from '../timelock';
import { fallbackWitnessAllowed, parsePolicy } from '../policy';
import { NUMS_TPUB, TPUB_A, TPUB_B } from '../__fixtures__/descriptors';

describe('csvLock', () => {
  it('reads a block lock exactly', () => {
    expect(csvLock(65535)).toEqual({ blocks: 65535, time: false });
    expect(csvLock(144)).toEqual({ blocks: 144, time: false });
  });

  it('reads a time lock as time, estimated conservatively in blocks', () => {
    // 256 units × 512 s = 131 072 s ≈ 219 blocks, plus the median-time margin.
    const lock = csvLock(4194560)!;
    expect(lock.time).toBe(true);
    expect(lock.blocks).toBe(Math.ceil((256 * 512) / 600) + 6);
    expect(lock.blocks).toBeLessThan(300);
  });

  it('refuses what older() cannot hold', () => {
    expect(csvLock(0)).toBeNull();
    expect(csvLock(2 ** 31)).toBeNull();
    expect(csvLock(1.5)).toBeNull();
  });
});

const TIME_VAULT =
  `tr(${NUMS_TPUB}/<0;1>/*,{pk([73c5da0a/86'/1'/0']${TPUB_A}/<0;1>/*),` +
  `and_v(v:pk([a1b2c3d4/86'/1'/0']${TPUB_B}/<0;1>/*),older(4194560))})`;

describe('every reader goes through it', () => {
  it('parsePolicy marks the path as time and gives a sane estimate', () => {
    const p = parsePolicy(TIME_VAULT);
    const recovery = p.paths.find((x) => x.olderBlocks != null)!;
    expect(recovery.olderIsTime).toBe(true);
    expect(recovery.olderBlocks).toBeLessThan(300);
  });

  it('minOlderBlocks agrees', () => {
    expect(minOlderBlocks(TIME_VAULT)).toBe(csvLock(4194560)!.blocks);
  });

  it('the fallback finaliser does not refuse a time lock on a block count', () => {
    const p = parsePolicy(TIME_VAULT);
    expect(fallbackWitnessAllowed(p, ['a1b2c3d4'], 1).allowed).toBe(true);
  });
});

describe('after() with a Unix time (the same rule, absolute twin)', () => {
  const { parsePolicy: pp } = require('../policy') as typeof import('../policy');
  it('a value of 500 000 000 or more is a moment, not a block height', () => {
    const X = 'tpubD6NzVbkrYhZ4XgiXtGrdW5XDAPFCL9h7we1vwNCpn8tGbBcgfVYjXyhWo4E1xkh56hjod1RhGjxbaTLV3X4FyWuejifB9jusQ46QzG87VKp';
    const p = pp(`wsh(and_v(v:pk([a1b2c3d4/48'/1'/0'/2']${X}/0/*),after(1700000000)))`);
    expect(p.paths[0].afterHeight).toBe(1_700_000_000);
    expect(p.paths[0].afterIsTime).toBe(true);
    const h = pp(`wsh(and_v(v:pk([a1b2c3d4/48'/1'/0'/2']${X}/0/*),after(900000)))`);
    expect(h.paths[0].afterIsTime).toBeUndefined();
  });
});
