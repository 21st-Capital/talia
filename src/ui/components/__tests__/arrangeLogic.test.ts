import { applyArrangeDrop, rowsForBlocks } from '../arrangeLogic';
import type { ArrangeBlock } from '../arrangeLogic';

const blocks: ArrangeBlock[] = [
  { key: 'savings', walletIds: ['a', 'b'] },
  { key: 'spending', walletIds: ['c'] },
  { key: '', walletIds: ['d'] },
];

const rows = rowsForBlocks(blocks);
// rows: 0 h:savings, 1 w:a, 2 w:b, 3 h:spending, 4 w:c, 5 h:, 6 w:d

describe('applyArrangeDrop', () => {
  it('reorders wallets within a category', () => {
    const row = rows[1]; // wallet a
    const out = applyArrangeDrop(blocks, rows, row, 3); // before spending header
    expect(out[0].walletIds).toEqual(['b', 'a']);
  });

  it('moves a wallet to another category', () => {
    const row = rows[1]; // wallet a → into spending, before c
    const out = applyArrangeDrop(blocks, rows, row, 4);
    expect(out[0].walletIds).toEqual(['b']);
    expect(out[1].walletIds).toEqual(['a', 'c']);
  });

  it('drops a wallet into a section that is still empty (made with "New section")', () => {
    const withFresh: ArrangeBlock[] = [...blocks, { key: 'Family', walletIds: [], fresh: true }];
    const rws = rowsForBlocks(withFresh);
    // rows: …, 5 h:, 6 w:d, 7 h:Family
    const row = rws[6]; // wallet d, released below the Family header
    const out = applyArrangeDrop(withFresh, rws, row, rws.length);
    expect(out[2].walletIds).toEqual([]);
    expect(out[3]).toEqual({ key: 'Family', walletIds: ['d'], fresh: true });
  });

  it('moves a wallet to the very end (Other)', () => {
    const row = rows[1];
    const out = applyArrangeDrop(blocks, rows, row, rows.length);
    expect(out[2].walletIds).toEqual(['d', 'a']);
  });

  it('moves a category block down', () => {
    const row = rows[0]; // savings header → after spending
    const out = applyArrangeDrop(blocks, rows, row, 5);
    expect(out.map((b) => b.key)).toEqual(['spending', 'savings', '']);
  });

  it('moves a category block up', () => {
    const row = rows[5]; // Other header → to the top
    const out = applyArrangeDrop(blocks, rows, row, 0);
    expect(out.map((b) => b.key)).toEqual(['', 'savings', 'spending']);
  });

  it('no-op when a wallet is dropped above all headers', () => {
    const row = rows[4]; // wallet c
    expect(applyArrangeDrop(blocks, rows, row, 0)).toBe(blocks);
  });

  it('keeps a dragged wallet stable when dropped on itself', () => {
    const row = rows[2]; // wallet b dropped right before itself
    const out = applyArrangeDrop(blocks, rows, row, 2);
    expect(out[0].walletIds).toEqual(['a', 'b']);
  });
});
