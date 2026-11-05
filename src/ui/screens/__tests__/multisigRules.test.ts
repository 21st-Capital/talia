import { MULTI_DEFAULT_THRESHOLD, MULTI_MIN_KEYS, multiThreshold, thresholdChoices } from '../multisigRules';

describe('plain multisig builder rules (decided 2026-09-21)', () => {
  it('needs three keys and starts at 2 of them', () => {
    expect(MULTI_MIN_KEYS).toBe(3);
    expect(MULTI_DEFAULT_THRESHOLD).toBe(2);
    expect(multiThreshold(null, 3)).toBe(2);
    expect(multiThreshold(null, 5)).toBe(2);
  });

  it('offers no choice before three keys, and never every key', () => {
    expect(thresholdChoices(2)).toEqual([]);
    expect(thresholdChoices(3)).toEqual([1, 2]);
    expect(thresholdChoices(4)).toEqual([1, 2, 3]);
  });

  it('keeps a pick within what the keys offer when one is removed', () => {
    expect(multiThreshold(3, 4)).toBe(3);
    expect(multiThreshold(3, 3)).toBe(2);
    expect(multiThreshold(1, 3)).toBe(1);
  });
});
