/**
 * Words for the builds that sell nothing (PURCHASES_ENABLED off: the
 * watch-only App Store app and the signing TestFlight app), 2026-09-12.
 *
 * Apple asked what paid features the app unlocks without In-App Purchase
 * (guideline 2.1(b), letter of 2026-09-11) and photographed a screen with a
 * price, a renewal date, an auto-renewal switch, a Cancel button and a
 * penalty. In these builds the membership is shown, never sold: no price, no
 * renewal, no upgrade, no link to buy. Every such string lives here so a plain
 * Node test can check that none of them sells anything or carries an em dash.
 * The full app (TALIA_FULL) keeps its own wording and never shows these.
 */
export const STORE_COPY = {
  membershipLabel: 'Membership',
  membershipSub: 'Your 21st Capital plan',
  membershipEmpty: 'No plan on this account.',
  planFallback: '21st Capital plan',
  statusActive: 'Active',
  statusInactive: 'Not active',
  estateDialogTitle: 'The Estate Plan comes with a 21st Capital plan',
  estateTeaser: 'Included with a 21st Capital plan.',
  talkToUs: 'Talk to us',
  lapsedBody: 'Nothing is locked. Co-signing and rescue for this vault are no longer covered.',
  /** Decided 2026-09-22: "your own keys still spend without us" was false for
   *  a 2-of-2 with our co-signer and for the owner of a 2-of-3 owner, heir
   *  and 21st Capital. What holds for every shape is that the vault itself
   *  is unchanged. */
  lapsedInfo:
    'The vault itself does not change: the same keys spend it as before. Co-signing and rescue are no longer part of a plan.',
  notCoveredBody: 'Co-signing and rescue are not included for this vault.',
  keysTitle: 'Our keys come with a 21st Capital plan',
  coveredBody: 'Covered by your plan. It uses one of your plan\u2019s vault slots.',
  slotsInfo:
    'Your plan covers a set number of vaults that hold 21st Capital keys. A vault takes up a slot once you have tested it with us.',
  keySlotHint: 'Added when you create the vault.',
  coSignInfo:
    'You hold two of the three keys, so your own two can always spend without us. We hold the third and co-sign when you need us.',
  vaultLimitTitle: 'Every vault in your plan is in use',
  /** The build asks for more than the plan bought on the website covers
   *  (decided 2026-09-19). The message itself comes from the backend. */
  notInPlanTitle: 'This vault is not in your plan',
  /** The same refusal for a vault somebody else's plan pays for (decided
   *  2026-09-20): it is not the builder's plan, so never "your plan". */
  notInPlanTitleOther: 'This vault is not in the plan',
  /** Co-signing limits are an Elite feature (decided 2026-09-19). */
  limitsElite: 'Co-signing limits come with an Elite plan.',
  /**
   * The moment a client without a plan reaches the 21st Capital keys
   * (decided 2026-09-18). Nothing is sold here and nothing links out: guideline
   * 3.1.1 forbids sending a customer to a purchase outside Apple's, so the
   * app offers the two things it may offer, signing in and talking to us.
   * Somebody who already holds a plan only has to sign in for us to find it.
   */
  planNeededTitle: 'YOUR PLAN',
  planNeededSignedOut:
    'This vault uses 21st Capital keys, which come with a plan. If you already have one, sign in and we pick it up automatically.',
  planNeededSignedIn:
    'There is no plan on this account yet. Talk to us and we set it up with you.',
  signIn: 'Sign in',
} as const;

/** A membership that has run out, e.g. "Ended 3 Jan 2026". */
export function endedOn(date: string): string {
  return `Ended ${date}`;
}

/** The vault-limit dialog's one line: which tested vaults hold the slots. */
export function vaultLimitMessage(names: string): string {
  return `Remove a tested vault to make room: ${names}.`;
}

/** The Settings version line's second half. The watch-only app and the full
 *  app keep today's exact words; only the signing TestFlight app says it
 *  signs, because "watch-only" would be false there. */
/** BETA under the version in Settings, for the signing TestFlight app only
 *  (decided 2026-09-12: "Its enough to write it in the settings page under
 *  version number", never on the home screen). Drop it before the signing
 *  app goes to App Review: Apple keeps betas off the App Store (2.2). */
export function betaMark(hww: boolean, purchases: boolean): string | null {
  return hww && !purchases ? 'BETA' : null;
}

export function appKindLabel(hww: boolean, purchases: boolean): string {
  return hww && !purchases
    ? 'hardware signing \u00b7 no keys on device'
    : 'watch-only \u00b7 no keys on device';
}
