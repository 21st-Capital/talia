/**
 * The plain multisig builder's rules for keys and signatures (decided 2026-09-21:
 * "Show space for 3 keys ... As soon as all three are added, make the
 * default policy a 2/3. Let the user edit the policy as he adds more than 3
 * keys"). Pure, tested in __tests__/multisigRules.test.ts.
 */

/** A plain multisig needs at least three keys; the screen shows that many
 *  spaces from the start and no policy until they are filled. */
export const MULTI_MIN_KEYS = 3;

/** 2 of N until the owner picks another number. */
export const MULTI_DEFAULT_THRESHOLD = 2;

/** The signature counts on offer for `keyCount` keys: 1 up to one less than
 *  the keys. "Every key signs" is never offered, because the composer refuses
 *  it (compose.ts assertNotDeadEnd: losing one key would lock the funds). */
export function thresholdChoices(keyCount: number): number[] {
  if (keyCount < MULTI_MIN_KEYS) return [];
  return Array.from({ length: keyCount - 1 }, (_, i) => i + 1);
}

/** The signatures required now: the owner's pick, else the default, kept
 *  within what `keyCount` keys offer, so removing a key can never leave an
 *  every-key vault behind. */
export function multiThreshold(picked: number | null, keyCount: number): number {
  const max = Math.max(1, keyCount - 1);
  return Math.max(1, Math.min(picked ?? MULTI_DEFAULT_THRESHOLD, max));
}
