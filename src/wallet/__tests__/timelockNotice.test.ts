import { REFRESH_EXPLAINER, coinTimelockChip, timelockNotice } from '../timelockNotice';
import { BLOCKS_PER_MONTH } from '../timelock';

describe('the recovery-path notice (decided 2026-09-22: one sentence, true in any scenario)', () => {
  it('home and vault page say the same thing; home adds the name', () => {
    expect(timelockNotice({ blocks: 0, vaultLabel: '2/3 family', refreshAdvised: true })).toBe(
      'A recovery path is open in “2/3 family”. Refresh recommended.',
    );
    expect(timelockNotice({ blocks: 0, refreshAdvised: true })).toBe(
      'A recovery path is open. Refresh recommended.',
    );
  });

  it("an heir's phone gets the same fact, without advice it cannot act on", () => {
    expect(timelockNotice({ blocks: -5, refreshAdvised: false })).toBe('A recovery path is open.');
    expect(timelockNotice({ blocks: 0, vaultLabel: 'Family', refreshAdvised: false })).toBe(
      'A recovery path is open in “Family”.',
    );
  });

  it('before it opens: the time to the first opening, the same words on both screens', () => {
    expect(timelockNotice({ blocks: 2 * BLOCKS_PER_MONTH, refreshAdvised: true })).toBe(
      'A recovery path opens in ≈ 2 months.',
    );
    expect(timelockNotice({ blocks: 2 * BLOCKS_PER_MONTH, vaultLabel: 'Family', refreshAdvised: false })).toBe(
      'A recovery path in “Family” opens in ≈ 2 months.',
    );
  });

  it('never guesses whose key it is, and never uses a dash', () => {
    for (const blocks of [-1, 0, 1, 500, 20000]) {
      for (const refreshAdvised of [true, false]) {
        const text = timelockNotice({ blocks, vaultLabel: 'V', refreshAdvised });
        expect(text).not.toMatch(/your key|\bheirs?\b/i);
        expect(text).not.toMatch(/[–—]/);
      }
    }
  });
});

describe('the same state on the coin list and in the refresh explainer', () => {
  it("a coin's label uses the notice words", () => {
    expect(coinTimelockChip(null, true)).toBe('Clock starts after confirmation');
    expect(coinTimelockChip(0, true)).toBe('Recovery path open, refresh recommended');
    expect(coinTimelockChip(-3, false)).toBe('Recovery path open');
    expect(coinTimelockChip(BLOCKS_PER_MONTH, true)).toBe('Recovery path opens in ≈ 1 month');
  });

  it('the refresh explainer holds for any vault: never whose keys, never a dash', () => {
    expect(REFRESH_EXPLAINER).not.toMatch(/your recovery key|\bheirs?\b|\bwallet\b/i);
    expect(REFRESH_EXPLAINER).not.toMatch(/[–—]/);
  });
});
