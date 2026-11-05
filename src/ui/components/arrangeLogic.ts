/**
 * Pure drop math for arrange mode (ArrangeModal). Extracted so the
 * gesture-driven mutations are unit-testable — the simulator can't drag.
 */

export interface ArrangeBlock {
  key: string; // category key ('' = Other)
  walletIds: string[];
  /** Made with the "New section" button during this Arrange session, so it
   *  stays on screen while empty for something to be dragged into it. An
   *  emptied section that was NOT fresh disappears, as before; a fresh one
   *  still empty at Done is simply not persisted. */
  fresh?: boolean;
}

export type ArrangeRow =
  | { type: 'header'; blockIdx: number; id: string }
  | { type: 'wallet'; blockIdx: number; walletId: string; id: string };

export function rowsForBlocks(blocks: ArrangeBlock[]): ArrangeRow[] {
  const out: ArrangeRow[] = [];
  blocks.forEach((b, bi) => {
    out.push({ type: 'header', blockIdx: bi, id: `h:${b.key}` });
    b.walletIds.forEach((wid) =>
      out.push({ type: 'wallet', blockIdx: bi, walletId: wid, id: `w:${wid}` }),
    );
  });
  return out;
}

/**
 * Apply a drop: `row` was released so it would insert BEFORE `rows[slot]`
 * (slot may equal rows.length = end). Returns the new blocks.
 */
export function applyArrangeDrop(
  blocks: ArrangeBlock[],
  rows: ArrangeRow[],
  row: ArrangeRow,
  slot: number,
): ArrangeBlock[] {
  if (row.type === 'header') {
    let targetBlock = 0;
    for (let i = 0; i < Math.min(slot, rows.length); i++) {
      const r = rows[i];
      if (r.type === 'header' && r.blockIdx !== row.blockIdx) targetBlock++;
    }
    const next = [...blocks];
    const [moved] = next.splice(row.blockIdx, 1);
    next.splice(Math.min(targetBlock, next.length), 0, moved);
    return next;
  }
  let targetBlock = -1;
  let posInBlock = 0;
  for (let i = 0; i < Math.min(slot, rows.length); i++) {
    const r = rows[i];
    if (r.type === 'header') {
      targetBlock = r.blockIdx;
      posInBlock = 0;
    } else if (!(r.type === 'wallet' && r.walletId === row.walletId)) {
      posInBlock++;
    }
  }
  if (targetBlock === -1) return blocks; // dropped above everything
  const next = blocks.map((b) => ({ ...b, walletIds: [...b.walletIds] }));
  const src = next[row.blockIdx];
  const idx = src.walletIds.indexOf(row.walletId);
  if (idx >= 0) src.walletIds.splice(idx, 1);
  const dst = next[targetBlock];
  dst.walletIds.splice(Math.min(posInBlock, dst.walletIds.length), 0, row.walletId);
  return next;
}
