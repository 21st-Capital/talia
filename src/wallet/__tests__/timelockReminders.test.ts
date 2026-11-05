import {
  timelockReminders,
  type ReminderKey,
} from '../timelockReminders';
import { BLOCKS_PER_DAY, BLOCKS_PER_MONTH, REFRESH_SOON_BLOCKS } from '../timelock';

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);
const WEEK = 7 * BLOCKS_PER_DAY;
const MS_PER_BLOCK = 10 * 60 * 1000;

const keys = (blocksLeft: number | null): ReminderKey[] =>
  timelockReminders({ walletId: 'w1', vaultName: 'Family Vault', blocksLeft, now: NOW }).map(
    (r) => r.key,
  );

describe('timelockReminders', () => {
  it('schedules all six when the whole window is still ahead', () => {
    // A year out: every milestone, including the two AFTER it opens.
    expect(keys(52596)).toEqual([
      'three-months-before',
      'one-month-before',
      'one-week-before',
      'opens',
      'one-week-after',
      'one-month-after',
    ]);
  });

  it('returns them soonest-first', () => {
    const rs = timelockReminders({
      walletId: 'w1', vaultName: 'V', blocksLeft: 52596, now: NOW,
    });
    const times = rs.map((r) => r.fireAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('drops milestones that have already passed', () => {
    // Two months left: the three-month reminder is behind us.
    expect(keys(2 * BLOCKS_PER_MONTH)).toEqual([
      'one-month-before',
      'one-week-before',
      'opens',
      'one-week-after',
      'one-month-after',
    ]);
  });

  it('never fires retroactively for a vault whose recovery already opened', () => {
    // Open for two weeks: "opens" and "one-week-after" are history.
    expect(keys(-2 * WEEK)).toEqual(['one-month-after']);
  });

  it('returns nothing once every milestone is behind us', () => {
    expect(keys(-2 * BLOCKS_PER_MONTH)).toEqual([]);
  });

  it('schedules nothing when no coin has started its clock', () => {
    // blocksLeft null = funding tx unconfirmed; the clock has not started.
    expect(keys(null)).toEqual([]);
  });

  it('never schedules a reminder in the past or at this instant', () => {
    for (const b of [null, -100000, -1, 0, 1, 500, 52596, 1_000_000]) {
      for (const r of timelockReminders({
        walletId: 'w1', vaultName: 'V', blocksLeft: b, now: NOW,
      })) {
        expect(r.fireAt.getTime()).toBeGreaterThan(NOW);
      }
    }
  });

  it('converts blocks to time at ten minutes per block', () => {
    // 1 000 blocks left, "opens" fires at 0 remaining => 1 000 blocks away.
    const opens = timelockReminders({
      walletId: 'w1', vaultName: 'V', blocksLeft: 1000, now: NOW,
    }).find((r) => r.key === 'opens');
    expect(opens?.fireAt.getTime()).toBe(NOW + 1000 * MS_PER_BLOCK);
  });

  it('uses the same three-month threshold as the Refresh button', () => {
    // One block past the threshold the reminder still exists; at it, it does not
    // (it would be due this instant). Keeps the notification and the in-app
    // "Refresh soon" hint from disagreeing.
    expect(keys(REFRESH_SOON_BLOCKS + 1)).toContain('three-months-before');
    expect(keys(REFRESH_SOON_BLOCKS)).not.toContain('three-months-before');
  });

  it('gives every reminder a stable id so re-syncing replaces, not duplicates', () => {
    const first = timelockReminders({
      walletId: 'w1', vaultName: 'V', blocksLeft: 52596, now: NOW,
    });
    // Same vault, later sync, fewer blocks left: ids for surviving milestones
    // must match so the scheduler overwrites them.
    const later = timelockReminders({
      walletId: 'w1', vaultName: 'V', blocksLeft: 40000, now: NOW + 5_000_000,
    });
    const firstIds = new Map(first.map((r) => [r.key, r.id]));
    for (const r of later) expect(r.id).toBe(firstIds.get(r.key));
    expect(new Set(first.map((r) => r.id)).size).toBe(first.length);
  });

  it('names the vault in the title so several vaults are distinguishable', () => {
    const rs = timelockReminders({
      walletId: 'w1', vaultName: 'Family Vault', blocksLeft: 52596, now: NOW,
    });
    for (const r of rs) expect(r.title).toContain('Family Vault');
    expect(rs.every((r) => r.body.length > 0)).toBe(true);
  });

  // Decided 2026-09-22: "a sentence that holds true in any scenario". The key
  // behind the path that opens can be an heir's or 21st Capital's rescue key,
  // so no reminder says whose key it is, and each speaks the notice's words.
  it('speaks the notice words and never says whose key opens', () => {
    const rs = timelockReminders({ walletId: 'w1', vaultName: 'V', blocksLeft: 52596, now: NOW });
    expect(rs).toHaveLength(6);
    for (const r of rs) {
      expect(r.title).toMatch(/^V: a recovery path (opens in about|is open|has been open for)/);
      // Whole words: "their clocks" is not an heir.
      expect(`${r.title} ${r.body}`).not.toMatch(/your recovery key|your key|\bheirs?\b/i);
      expect(`${r.title} ${r.body}`).not.toMatch(/[\u2013\u2014]/);
      // Decided 2026-09-22: a coin has a "clock" everywhere, never a "timer".
      expect(`${r.title} ${r.body}`).not.toMatch(/timer/i);
    }
  });

  it('scopes ids per wallet so two vaults do not overwrite each other', () => {
    const a = timelockReminders({ walletId: 'w1', vaultName: 'A', blocksLeft: 52596, now: NOW });
    const b = timelockReminders({ walletId: 'w2', vaultName: 'B', blocksLeft: 52596, now: NOW });
    const overlap = new Set(a.map((r) => r.id));
    expect(b.some((r) => overlap.has(r.id))).toBe(false);
  });
});
