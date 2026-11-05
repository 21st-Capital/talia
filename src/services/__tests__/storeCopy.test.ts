/**
 * Store-build copy never sells (Apple's guideline 2.1(b) letter of 2026-09-11,
 * guideline 3.1.1).
 *
 * The watch-only App Store app and the signing TestFlight app show the
 * membership and never sell it. Every word those builds show in place of a
 * price, a renewal or a purchase link lives in storeCopy.ts, which imports
 * nothing, so this plain Node test reads all of it: no em dash (decided 2026-08-28)
 * and no word that prices, renews, cancels or points at a purchase.
 */
import {
  STORE_COPY,
  appKindLabel,
  endedOn,
  vaultLimitMessage, betaMark } from '../../ui/screens/storeCopy';

/** Anything that prices, sells, renews or manages a subscription. */
const SELLS =
  /\$|%|website|upgrade|renew|activat|\bpay|price|purchase|checkout|subscri|cancel|penalty|\bfee\b/i;

const FLAG_PAIRS: Array<[boolean, boolean]> = [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
];

function everyStoreString(): string[] {
  return [
    ...Object.values(STORE_COPY),
    endedOn('3 Jan 2026'),
    vaultLimitMessage('“A”, “B”'),
    ...FLAG_PAIRS.map(([hww, purchases]) => appKindLabel(hww, purchases)),
  ];
}

describe('store-build copy never sells', () => {
  it('the pattern catches what Apple photographed', () => {
    // Guard the guard: a broken pattern would pass every string below.
    for (const s of [
      '$0 / year',
      'renews: unknown',
      'Auto-renewal',
      'Cancel',
      'carries a 10% penalty under our terms',
      'Upgrade your plan on the website',
      'Activate my plan (pay securely)',
      'Onboarding fee',
    ]) {
      expect(s).toMatch(SELLS);
    }
  });

  it('reads every string', () => {
    expect(Object.keys(STORE_COPY).length).toBeGreaterThan(10);
    for (const s of everyStoreString()) {
      expect(typeof s).toBe('string');
      expect(s.trim().length).toBeGreaterThan(0);
    }
  });

  it('never an em dash (decided 2026-08-28)', () => {
    for (const s of everyStoreString()) expect(s).not.toContain('—');
  });

  it('no price, renewal, cancellation or purchase word', () => {
    expect(everyStoreString().filter((s) => SELLS.test(s))).toEqual([]);
  });

  it("the version line keeps today's words in the watch-only and full apps", () => {
    expect(appKindLabel(false, false)).toBe('watch-only · no keys on device');
    expect(appKindLabel(true, true)).toBe('watch-only · no keys on device');
  });

  it('the signing TestFlight app says it signs, never that it only watches', () => {
    const label = appKindLabel(true, false);
    expect(label).toContain('hardware signing');
    expect(label).not.toMatch(/watch/i);
  });
});

describe('betaMark', () => {
  it('marks only the signing TestFlight app, never the watch-only or full app', () => {
    expect(betaMark(true, false)).toBe('BETA');
    expect(betaMark(false, false)).toBeNull();
    expect(betaMark(true, true)).toBeNull();
    expect(betaMark(false, true)).toBeNull();
  });
});
