/**
 * The height buckets of the shadow week's engine reports (decided
 * 2026-10-28). Nothing writes one since the old engine's removal (decided
 * 2026-11-04); a report written before is still read, and its buckets must
 * be six of the fixed words, never a value.
 */
import { HEIGHT_BUCKET_WORDS, isHeightBucket } from '../heightBucket';

describe('a report\'s height bucket is six fixed words', () => {
  it('accepts every place\'s words in order', () => {
    expect(HEIGHT_BUCKET_WORDS).toHaveLength(6);
    expect(isHeightBucket('new.gap1.conf6plus.reorgYes.newOnChain.oldOnce')).toBe(true);
    expect(isHeightBucket('oldOnly.gapNa.confUnknown.reorgNa.newNa.oldUnknown')).toBe(true);
  });

  it('refuses a value, a word in the wrong place, and the wrong number of places', () => {
    expect(isHeightBucket('new.gap1.conf6plus.reorgYes.newOnChain')).toBe(false);
    expect(isHeightBucket('gap1.new.conf6plus.reorgYes.newOnChain.oldOnce')).toBe(false);
    expect(isHeightBucket('new.903117.conf6plus.reorgYes.newOnChain.oldOnce')).toBe(false);
    expect(isHeightBucket('new.gap1.conf6plus.reorgYes.newOnChain.oldOnce.extra')).toBe(false);
  });
});
