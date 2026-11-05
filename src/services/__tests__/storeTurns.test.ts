/**
 * The phone's lists of co-sign and rescue requests are each kept whole under
 * one key: every writer reads all of it and writes all of it back. Since the
 * Sent page stopped waiting for the bookkeeping behind it (2026-10-19),
 * those writers overlap: Send all reports its coins side by side, and a
 * rescue's report, the list's prune and the app-start retry can meet. Decided
 * 2026-10-19: two at once lost one change, so a coin already sent came back
 * as ready to send. They now take turns (services/storeTurns.ts).
 */
import { storeTurns, STORE_TURN_WAIT_MS } from '../storeTurns';
import {
  loadPendingCosigns,
  recordServerStatuses,
  removePendingCosign,
  removePendingCosignsForTxid,
  savePendingCosign,
  type PendingCosign,
} from '../cosign';
import { loadPendingRescues, markRescueSent, removePendingRescue, savePendingRescue } from '../rescue';

/** The sealed store, slow as a Keychain-backed one can be: each read and
 *  write takes a few milliseconds, so two writers' steps interleave. */
const mockSealed = new Map<string, string>();
const mockLater = <T>(ms: number, f: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(f()), ms));
jest.mock('../../wallet/sealedStore', () => ({
  sealedGetItem: (k: string) => mockLater(5, () => mockSealed.get(k) ?? null),
  sealedSetItem: (k: string, v: string) => mockLater(5, () => void mockSealed.set(k, v)),
}));
jest.mock('../companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  authHeaders: () => ({}),
  loadSession: async () => null,
}));
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));
const memory = require('../../testing/memoryAsyncStorage') as { __clear: () => void };

const record = (id: string, txid: string, over: Partial<PendingCosign> = {}): PendingCosign => ({
  id,
  walletId: 'w1',
  originalPsbt: `psbt-${id}`,
  amountSats: 1_000,
  destination: 'tb1q',
  createdAt: 1,
  txid,
  ...over,
});

beforeEach(async () => {
  mockSealed.clear();
  memory.__clear();
  // Three coins of one refresh session, each its own co-sign request.
  for (const [id, t] of [
    ['c1', 'a1'],
    ['c2', 'a2'],
    ['c3', 'a3'],
  ]) {
    await savePendingCosign(record(id, t.repeat(32), { batchId: 'b1' }));
  }
});

describe('co-sign records: overlapping writers each keep their change', () => {
  it('two coins sent side by side are both removed (the batch’s bookkeeping)', async () => {
    await Promise.all([removePendingCosign('c1'), removePendingCosign('c2')]);
    expect((await loadPendingCosigns()).map((p) => p.id)).toEqual(['c3']);
  });

  it('a removal, a removal by txid and a refresh writing statuses, all at once', async () => {
    await Promise.all([
      removePendingCosign('c1'),
      removePendingCosignsForTxid('a2'.repeat(32)),
      recordServerStatuses([{ id: 'c3', status: 'signed' } as never]),
    ]);
    const left = await loadPendingCosigns();
    expect(left.map((p) => p.id)).toEqual(['c3']);
    expect(left[0].serverStatus).toBe('signed');
  });

  it('a save beside a removal keeps both', async () => {
    await Promise.all([removePendingCosign('c1'), savePendingCosign(record('c4', 'a4'.repeat(32)))]);
    expect((await loadPendingCosigns()).map((p) => p.id).sort()).toEqual(['c2', 'c3', 'c4']);
  });
});

describe('rescue records: the mark and the prune do not undo each other', () => {
  beforeEach(async () => {
    await savePendingRescue({ id: 'r1', walletId: 'w1', vaultLabel: 'One', createdAt: 1 });
    await savePendingRescue({ id: 'r2', walletId: 'w2', vaultLabel: 'Two', createdAt: 2 });
  });

  it('marking one sent while another is forgotten keeps the mark', async () => {
    await Promise.all([markRescueSent('r1', 'ab'.repeat(32)), removePendingRescue('r2')]);
    expect(await loadPendingRescues()).toEqual([expect.objectContaining({ id: 'r1', sentTxid: 'ab'.repeat(32) })]);
  });

  it('two forgotten at once are both gone', async () => {
    await Promise.all([removePendingRescue('r1'), removePendingRescue('r2')]);
    expect(await loadPendingRescues()).toEqual([]);
  });
});

describe('a turn', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs in the order asked', async () => {
    const inTurn = storeTurns();
    const order: string[] = [];
    const slow = inTurn(() => new Promise<void>((r) => setTimeout(() => (order.push('first'), r()), 100)));
    const quick = inTurn(async () => void order.push('second'));
    await jest.advanceTimersByTimeAsync(100);
    await Promise.all([slow, quick]);
    expect(order).toEqual(['first', 'second']);
  });

  it('a write that never ends holds the next one for STORE_TURN_WAIT_MS at most, never for good', async () => {
    const inTurn = storeTurns();
    void inTurn(() => new Promise<void>(() => {}));
    const ran = jest.fn();
    const next = inTurn(async () => ran());
    await jest.advanceTimersByTimeAsync(STORE_TURN_WAIT_MS - 1);
    expect(ran).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await next;
    expect(ran).toHaveBeenCalled();
  });

  it('a change that fails does not stop the ones after it', async () => {
    const inTurn = storeTurns();
    const failed = inTurn(async () => {
      throw new Error('could not write');
    });
    await expect(failed).rejects.toThrow('could not write');
    await expect(inTurn(async () => 'next')).resolves.toBe('next');
  });
});
