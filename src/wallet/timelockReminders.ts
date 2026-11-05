/**
 * When to remind the owner that a vault's recovery path is opening.
 *
 * A Liana-style vault is a dead-man's switch: the recovery keys (an heir's, or
 * the 21st Capital rescue key) become spendable `older(N)` blocks after each
 * coin last moved, and the owner pushes that back by refreshing their coins.
 * Missing the window is the failure this exists to prevent, so we remind at
 * six points (decided 2026-08-24): three months, one month and one week before, at
 * the moment it opens, and again one week and one month after.
 *
 * TWO THINGS THAT SHAPE THE DESIGN
 *
 * 1. A timelock is measured in BLOCKS, not calendar time. Every date here is
 *    an ESTIMATE at ten minutes per block, and real block rate wanders — over
 *    three months (~13 149 blocks) that drift is days, not minutes. So this
 *    is deliberately a PURE function of the CURRENT block height: call it
 *    again after every sync and replace what was scheduled. The estimate
 *    re-centres itself each time instead of being fixed at one wrong moment.
 *
 * 2. Milestones already in the past are NOT returned. A notification that
 *    fires the instant it is scheduled — announcing something that happened
 *    weeks ago — trains people to ignore the ones that matter.
 *
 * Pure and native-free on purpose: the scheduling maths is the part worth
 * testing, and it stays testable in plain Node.
 */
import { BLOCK_MINUTES, BLOCKS_PER_DAY, BLOCKS_PER_MONTH } from './timelock';

const BLOCKS_PER_WEEK = 7 * BLOCKS_PER_DAY; // 1 008
const MS_PER_BLOCK = BLOCK_MINUTES * 60 * 1000;

export type ReminderKey =
  | 'three-months-before'
  | 'one-month-before'
  | 'one-week-before'
  | 'opens'
  | 'one-week-after'
  | 'one-month-after';

export interface TimelockReminder {
  /** Stable across reschedules, so re-syncing REPLACES rather than duplicates. */
  id: string;
  walletId: string;
  key: ReminderKey;
  /** Estimated moment to fire. See the drift note above. */
  fireAt: Date;
  title: string;
  body: string;
}

/**
 * Blocks REMAINING at the moment each reminder should fire. Negative means
 * after the recovery path has already opened.
 */
const MILESTONES: ReadonlyArray<{ key: ReminderKey; at: number }> = [
  { key: 'three-months-before', at: 3 * BLOCKS_PER_MONTH }, // == REFRESH_SOON_BLOCKS
  { key: 'one-month-before', at: BLOCKS_PER_MONTH },
  { key: 'one-week-before', at: BLOCKS_PER_WEEK },
  { key: 'opens', at: 0 },
  { key: 'one-week-after', at: -BLOCKS_PER_WEEK },
  { key: 'one-month-after', at: -BLOCKS_PER_MONTH },
];

/**
 * Plain language: no "UTXO"/"outpoint" jargon. The vault notice's own
 * words (decided 2026-09-22: "a sentence that holds true in any scenario"): a
 * recovery path opens, never "your recovery keys", because the key behind it
 * can be an heir's or 21st Capital's rescue key. Owners only: heir phones get
 * no reminders. Each coin has a "clock", as on the notice, the coin chips and
 * the Spending policy; never a "timer" (decided 2026-09-22).
 */
function copyFor(key: ReminderKey, vaultName: string): { title: string; body: string } {
  switch (key) {
    case 'three-months-before':
      return {
        title: `${vaultName}: a recovery path opens in about 3 months`,
        body: 'Refresh your coins to start their clocks again.',
      };
    case 'one-month-before':
      return {
        title: `${vaultName}: a recovery path opens in about a month`,
        body: 'Refresh your coins to start their clocks again.',
      };
    case 'one-week-before':
      return {
        title: `${vaultName}: a recovery path opens in about a week`,
        body: 'Refresh your coins now to start their clocks again.',
      };
    case 'opens':
      return {
        title: `${vaultName}: a recovery path is open`,
        body: 'Refresh your coins to close it again.',
      };
    case 'one-week-after':
      return {
        title: `${vaultName}: a recovery path has been open for a week`,
        body: 'Refresh your coins to close it again.',
      };
    case 'one-month-after':
      return {
        title: `${vaultName}: a recovery path has been open for a month`,
        body: 'Refresh your coins to close it again.',
      };
  }
}

/**
 * The reminders still ahead for one vault.
 *
 * `blocksLeft` is the vault's NEAREST expiry across its coins
 * (`nearestExpiryBlocks`). `null` means no coin's clock has started — nothing
 * to remind about yet. Returns soonest first; empty when every milestone has
 * passed.
 */
export function timelockReminders(params: {
  walletId: string;
  vaultName: string;
  blocksLeft: number | null;
  now: number;
}): TimelockReminder[] {
  const { walletId, vaultName, blocksLeft, now } = params;
  if (blocksLeft == null) return [];

  const out: TimelockReminder[] = [];
  for (const m of MILESTONES) {
    const blocksUntilFire = blocksLeft - m.at;
    // Strictly in the future: 0 would fire immediately on scheduling.
    if (blocksUntilFire <= 0) continue;
    const { title, body } = copyFor(m.key, vaultName);
    out.push({
      id: `${walletId}:${m.key}`,
      walletId,
      key: m.key,
      fireAt: new Date(now + blocksUntilFire * MS_PER_BLOCK),
      title,
      body,
    });
  }
  return out.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}
