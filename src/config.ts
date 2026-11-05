/** App-level configuration constants. */

/**
 * Build flags, set at BUILD time rather than by editing this file.
 *
 *   ./scripts/ios-device.sh <udid> Release                 the watch-only app
 *   TALIA_FULL=1 ./scripts/ios-device.sh <udid> Release    the signing app
 *
 * One branch produces both (decided 2026-09-05). The signing app used to live on
 * its own branch with these gates deleted, so every fix had to be made twice
 * and three of them were stranded there while main moved on. Nothing is
 * deleted now and nothing diverges: the same commit builds either app.
 *
 * Unset means false, so a plain build is always the App Store one. The
 * substitution happens in babel-plugin-talia-flags.js; TALIA_FULL turns on
 * everything, or turn on one surface at a time.
 */
const flag = (name: 'TALIA_FULL' | 'TALIA_HWW' | 'TALIA_PURCHASES'): boolean => {
  switch (name) {
    case 'TALIA_FULL':
      return process.env.TALIA_FULL === '1';
    case 'TALIA_HWW':
      return process.env.TALIA_HWW === '1';
    default:
      return process.env.TALIA_PURCHASES === '1';
  }
};

const FULL = flag('TALIA_FULL');

/**
 * Master switch for the whole spend/creation surface.
 *
 * The FIRST App Store release ships strictly watch-only: import a descriptor,
 * sync, show balance/history, receive. Everything that could put a signature
 * on a transaction — Send, the signing ceremony, vault creation, heir invites,
 * rescue, RBF — is gated behind this ONE constant so nothing had to be
 * deleted. The Phase 2 code is intact underneath.
 *
 * Flip to `true` to restore the full surface; the Bluetooth signer transports
 * (Ledger / BitBox Nova / Jade Plus) build on top of the same flag. Every gate
 * is additive, so flipping it back is the only step required.
 *
 * Typed `boolean` on purpose: a literal `false` would let TypeScript narrow
 * every gated branch away and report the Phase 2 code as unreachable.
 */
export const SIGNING_ENABLED: boolean = false;

/**
 * The hardware surface while SIGNING_ENABLED stays off (flipping the master
 * switch would resurrect the whole retired Coldcard surface): Register on
 * your hardware, Send and the signing ceremony for vaults whose customer
 * keys sit on a device Talia recorded (vaultIsLedgerBound gates the Send
 * button per vault; every adopted brand counts, not only the Ledger the
 * flag is named after), the Bluetooth signing method, and the Receive
 * screen's address check. It is a UI gate only: the ENGINE's spend
 * methods follow the build-time flags (HWW_ENABLED / SIGNING_ENABLED)
 * (decided 2026-09-26), and the watch-only build finishes a rescue
 * through its own narrow, checked engine methods. Remove this flag when the
 * BLE signing surface replaces the Coldcard one.
 */
export const LEDGER_PREVIEW: boolean = true;

/**
 * The hardware SIGNING DEVICE surface: pairing a Ledger or BitBox over
 * Bluetooth, registering a vault on it, checking an address on its screen,
 * and signing with it.
 *
 * OFF for the first App Store release. Apple's reviewer has no hardware
 * wallet, so none of it can be demonstrated, and a Bluetooth permission for
 * a feature nobody can reach only invites questions.
 *
 * It ALSO gates building a vault (decided 2026-09-04). A vault composed without a
 * device on the table is one nobody has proven they can sign for, and funding
 * that loses the coins, so "Set up a new vault" and the three creation
 * screens are hidden here. Watch-only builds import a descriptor instead.
 *
 * What stays under LEDGER_PREVIEW and ships regardless: the Estate Plan,
 * heir invites, claiming an invite, portfolios, receiving, backups, rescue.
 * Flip this to `true` for the version that adds signing, and creation and
 * the hardware surface both come back together.
 */
export const HWW_ENABLED: boolean = FULL || flag('TALIA_HWW');

/**
 * Buying a plan from inside the app.
 *
 * OFF for the first App Store release. App Review guideline 3.1.1 forbids
 * buttons or links that send a customer to a purchasing mechanism other than
 * Apple's own, and the vault plan is bought on the website through Stripe.
 * 21st Capital's service is human onboarding, hardware keys, co-signing and a
 * legal document, which is a real-world service and arguably exempt, but that
 * argument costs review rounds on a first submission. Clients buy on the
 * website exactly as they do today, and the app offers a call instead.
 *
 * While this is off: the checkout never opens, the Elite upsell step is
 * skipped, and no label mentions paying. Flip to `true` to restore all of it.
 */
/**
 * OFF EVERYWHERE since 2026-09-18: "we are not able to sell anything
 * inside the app unless we pay 30% to Apple, which makes no sense at all.
 * We have to assume that the user will have to buy their subscription on our
 * website configurator first before they build the vault in the app. There
 * should be no prices written in Talia at all."
 *
 * So this is a constant now, not a flag: the full app on our own phones must
 * show exactly what the App Store app shows, or we would be testing a screen
 * no client ever sees. The gates all stay where they are, and storeCopy.ts
 * holds the words that replace the selling ones. Setting this back to true
 * would put prices and a checkout back into every build, which is the thing
 * Apple photographed and asked about under guideline 2.1(b).
 */
export const PURCHASES_ENABLED: boolean = false;

/**
 * Timelocks measured in minutes instead of months, so a recovery path can be
 * watched opening on MAINNET inside one sitting (decided 2026-09-16, after the
 * co-signing spend was proven end to end: "Please add a test rescue path for
 * 3 blocks (30 mins) so I can test that on main net as well").
 *
 * The gate is TALIA_FULL alone, deliberately. The network cannot be the gate,
 * because the whole point is a mainnet rehearsal, and HWW_ENABLED cannot be
 * either: it is true on the TestFlight build clients use. TALIA_FULL is true
 * only for the copy built onto our own phones over the cable, and both build
 * scripts read it back and refuse an archive that carries it.
 *
 * A vault built this way is NOT a vault: its rescue key can take everything
 * about half an hour after each payment confirms, and refreshing cannot
 * outrun it. Test amounts only.
 */
export const TEST_TIMELOCKS_ENABLED: boolean = FULL;

/**
 * The build flavour, from the flags the build already inlines: TALIA_FULL is
 * the phone app (Talia Test), TALIA_HWW without it TestFlight's signing app,
 * neither the App Store's watch-only app.
 *
 * Every flavour runs the one wallet engine, bdk-ffi 3.1.1 behind the app's
 * own bridge (bitcoin/engine/bdkWalletEngine.ts), since the removal
 * (decided 2026-11-04) of the old engine (bdk 0.28 behind the
 * bdk-ffi 0.30 fork) with its per-flavour constants, the phone's engine
 * switches, the per-vault preflight and the shadow checks. The flavour still
 * decides the signing rounds (bitcoin/engine/signingRounds.ts), the engine
 * report (wallet/engineReport.ts: the App Store app keeps none) and
 * Diagnostics.
 */
export type BuildFlavour = 'full' | 'signing' | 'store';

/** The flavour a build's flags make: TALIA_FULL wins, then TALIA_HWW. */
export function buildFlavourOf(flags: { full: boolean; hww: boolean }): BuildFlavour {
  return flags.full ? 'full' : flags.hww ? 'signing' : 'store';
}

/** This build's flavour. */
export const BUILD_FLAVOUR: BuildFlavour = buildFlavourOf({ full: FULL, hww: HWW_ENABLED });

/**
 * What the Settings page shows as the version.
 *
 * Apple's own source of truth is the Xcode project: MARKETING_VERSION is the
 * version a client sees on the App Store, CURRENT_PROJECT_VERSION is the build
 * behind it, and they are what TestFlight testers quote back to support. These
 * two constants are the JS copy, and `src/__tests__/version.test.ts` fails the
 * moment they disagree with the Xcode project or with package.json — the
 * previous hand-kept constant said 0.1.0 while the app built 1.0.0.
 *
 * Bumping a build for an upload therefore means changing it in BOTH places.
 * The test names the file and the value when it catches you.
 */
export const APP_VERSION = '1.2.1';
export const APP_BUILD = '26';

/**
 * Support links open in the system browser — the app deliberately has no
 * backend integration (scheduling happens behind the website's own login).
 * Update these URLs when the website routes are final.
 */
export const SUPPORT = {
  /** Live chat with 21st Capital (decided 2026-07-19). */
  chatUrl: 'https://21stcapital.com/support',
  /** Schedule a call — direct booking link (decided 2026-07-19). */
  scheduleCallUrl:
    'https://21stcapital.com/book-appointment/ca663fbb-4e29-4338-9fe2-94a00c07dc5d',
  /** General website. */
  websiteUrl: 'https://21stcapital.com',
} as const;

/** How many upcoming unused receive addresses the Addresses screen shows. */
export const UNUSED_ADDRESS_COUNT = 10;

/** 21st Capital official links (settings footer). Confirmed 2026-07-15. */
export const COMPANY_LINKS = {
  website: 'https://21stcapital.com',
  x: 'https://x.com/21stcap',
  instagram: 'https://www.instagram.com/21stcapital/',
  telegram: 'https://t.me/btc21stcap',
  terms: 'https://21stcapital.com/terms-and-conditions',
  privacy: 'https://21stcapital.com/privacy-policy',
} as const;
