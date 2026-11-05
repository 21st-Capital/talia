import { ELITE_COPY, eliteSummary } from '../eliteServicesCopy';

describe('Elite Services wording (decided 2026-09-21)', () => {
  it('names what the page holds, in one plain line', () => {
    expect(eliteSummary(['Co-signing limits'])).toBe('Co-signing limits');
    expect(eliteSummary(['Co-signing limits', 'Setup meeting'])).toBe('Co-signing limits and setup meeting');
    expect(eliteSummary(['Co-signing limits', 'Vault owners', 'Setup meeting'])).toBe(
      'Co-signing limits, vault owners and setup meeting',
    );
    expect(eliteSummary([])).toBe('');
  });

  it('never an em dash', () => {
    for (const s of Object.values(ELITE_COPY)) expect(s).not.toContain('—');
  });

  it('limits are monthly and yearly, in BTC (decided 2026-09-21)', () => {
    for (const s of Object.values(ELITE_COPY)) expect(s).not.toMatch(/per day|daily|\bEUR\b|\bUSD\b|€|\$/i);
  });
});
