/**
 * App-level wallet and settings types. A "wallet" here is watch-only metadata:
 * the descriptor plus display/labelling info. No secrets are stored (Phase 1).
 */
import type {
  DescriptorKind,
  ImportSource,
  ImportTransport,
  Network,
} from '../bitcoin/descriptor/types';

/**
 * One Ledger's registration of one vault (BIP-388 wallet policy). The device
 * hands back a 32-byte HMAC at registration and demands the exact same
 * name/template/keys triple beside it at signing — so the triple is stored
 * verbatim here, never re-derived.
 */
export interface LedgerRegistration {
  /** ≤16-char policy name as shown on the device. */
  name: string;
  /** Descriptor template with `@i` placeholders. */
  descriptorTemplate: string;
  /** Ordered `[fingerprint/path]xpub` (or bare xpub) key strings. */
  keys: string[];
  /** The device's 32-byte registration HMAC, hex. */
  hmacHex: string;
  /** Bitcoin app version that registered it (e.g. "2.2.3"). */
  appVersion: string;
  /** Unix ms of the registration ceremony. */
  registeredAt: number;
}

/**
 * That a BitBox registration happened. The device keeps the policy itself
 * and matches it by its script alone, so a renamed vault is never registered
 * again and the device goes on showing the name it stored. `name` is that
 * name, kept when Talia itself registered the vault; absent for one
 * registered elsewhere or before the name was kept (the signing screen then
 * names no vault rather than guess from today's label).
 */
export interface BitboxRegistration {
  registeredAt: number;
  name?: string;
}

/** The physical device a key lives on. 'passport' is the Foundation
 *  Passport (decided 2026-09-08): QR only, single-sig vaults, no Bluetooth. */
export interface KeyDevice {
  kind: 'ledger' | 'bitbox' | 'passport';
  /** The model when known, one of the registry's (`wallet/deviceKinds.ts`
   *  `DEVICE_MODELS`: 'gen5', 'flex', 'stax', 'nanoX', 'nova', 'passport'),
   *  written by the device's own discovery and read by every "Which
   *  device?" step and every drawing. */
  model?: DeviceModelId;
}

/** `DeviceModel` of the registry, named here so this file imports nothing. */
export type DeviceModelId = 'gen5' | 'flex' | 'stax' | 'nanoX' | 'nova' | 'passport';

export interface WalletMeta {
  id: string;
  label: string;
  /** External (or multipath) output descriptor — public keys only. */
  descriptor: string;
  /** Optional separate change descriptor. */
  changeDescriptor?: string;
  network: Network;
  kind: DescriptorKind;
  source: ImportSource;
  /** How the descriptor was brought in (for provenance/analytics later). */
  transport: ImportTransport;
  /** Unix ms when the wallet was added. */
  createdAt: number;
  /**
   * Display grouping on the home screen, written ONLY by Arrange: a section
   * key ('single-sig', 'multisig', 'other'), a user-written section label, or
   * the retired 'savings'/'spending' stamps. Undefined means no choice was
   * made, so the vault follows its own shape. Always read through
   * `effectiveCategory` (wallet/categories.ts), never directly.
   */
  category?: string;
  /** Frozen coins ("txid:vout") — never spent by anything Talia builds. */
  frozenUtxos?: string[];
  /** Privacy: mask this wallet's balance and exclude it from the total. */
  balanceHidden?: boolean;
  /** User-chosen wallet icon key (see ui/components/walletIcons). */
  icon?: string;
  /** User labels per key fingerprint (Policy screen; falls back to fp). */
  keyLabels?: Record<string, string>;
  /** Fingerprints of 21st Capital-issued keys (co-signer / rescue). The
   *  customer can't register the descriptor on these — exclude them from
   *  the registration wizard (decided 2026-07-20). */
  providerKeyFingerprints?: string[];
  /** Heirs named at vault creation. Email is NO LONGER collected in the
   *  configurator (decided 2026-08-27): it arrives later — typed on the
   *  heir-invite screen (saved back here for the Estate Plan pick-list) or
   *  asked for directly on the Estate Plan form. Wallets created before
   *  2026-08-27 carry email but no id; newer ones the reverse until an
   *  invite fills the email in. */
  heirs?: Array<{
    /** Stable local id (creation-stamped) — the identity keyless heirs are
     *  matched by now that email can be absent. Missing on old wallets. */
    id?: string;
    /** The heir's own name, from the Estate Plan (decided 2026-09-21). Never a
     *  key's label: `keyLabels` names the KEY, and greeting a person by it
     *  read "Hello test bitbox,". Absent until a plan names them. */
    name?: string;
    email?: string;
    /** Master fingerprint of the heir's key — absent for assisted heirs. */
    fingerprint?: string;
    /** Heir timelock in months (8–15). */
    months?: number;
  }>;
  /** ONE-WAY, creation-only gate: true ONLY for a 21st Capital-key vault
   *  created before its FIRST payment (shown locked on Home, excluded from
   *  the total). Cleared permanently the first time the plan is paid. It is
   *  NEVER set true again — Talia is self-custodial, so nothing on our side
   *  can lock or disable a vault once activated, even if the plan lapses
   *  (decided 2026-07-20). A lapsed plan is a DISCLAIMER (10% penalty to use 21C
   *  keys/services), never a lock. `updateWallet` cannot touch this field. */
  locked?: boolean;
  /** Plan details to re-open checkout for a locked vault (no email/session). */
  activationPlan?: {
    tier: string;
    tierName: string;
    /** Exact backend PlanItem name for the annual line — the backend bills
     *  that item's price, so a locked vault must remember which one it was
     *  quoted at (single-sig Premium $195 vs multisig Premium $395). */
    planItemName?: string;
    configType: 'single-1-1' | 'multi-2-2' | 'multi-2-3';
    rescue: boolean;
    inheritance: boolean;
    heirCount: number;
    annual: number;
    onboarding: number;
  };
  /** Backend Portfolio id from plan checkout — handle for testing status. */
  portfolioId?: string;
  /** The client's 21st Capital account number for THIS vault (e.g. 1041),
   *  so an account statement can print it without a network round trip.
   *  Absent for a purely self-custodial vault. Stamped at CREATION since
   *  2026-09-01 (the app now claims the number when it fetches this vault's
   *  own keys); older vaults cache it once the backend marks them tested. */
  accountNumber?: number;
  /** Which of the client's vaults this is, 1-based (vault 1 -> account
   *  block+1 ... vault 10 -> the block start). Kept beside accountNumber so a
   *  retried creation re-fetches the SAME keys instead of consuming the next
   *  number. */
  vaultNumber?: number;
  /** Whose plan PAYS for this vault when that is not its owner (decided
   *  2026-09-20: the vault is fully theirs, only the billing is shared): the
   *  payer's email. The 21st Capital keys, the number and the testing status
   *  come from that plan. Shown as "Paid for by" in the vault's advanced
   *  details and nowhere else; never on the everyday card. */
  heldOf?: string;
  /** Unix ms when the owner emailed themselves a descriptor backup from the
   *  registration walk (plain text or the encrypted .bed file). The walk's
   *  success message waits for this as well as for every device. */
  descriptorBackupEmailedAt?: number;
  /** Unix ms when staff marked the vault tested. Cached from the backend,
   *  whose tested_at is the truth. (A stored `testingBookedAt` from before
   *  2026-09-21, when the vault page had a booking banner, is ignored.) */
  vaultTestedAt?: number;
  /**
   * Every time the owner accepted the untested-vault risk to see a receive
   * address (decided 2026-07-28), newest last. An acknowledgement given on every
   * receive is only worth asking for if it is RECORDED — otherwise it is a
   * tap-through with nothing behind it. Cleared once the vault is tested.
   */
  untestedRiskAccepted?: number[];
  /** Unix ms when the user registered the descriptor on their hardware
   *  (RegisterVault completed). Absent = never — the signing ceremony warns
   *  before the first hardware signature (decided 2026-07-27). */
  vaultRegisteredAt?: number;
  /**
   * Unix ms when the owner of an IMPORTED vault said it is already
   * registered on their devices (decided 2026-09-07): Send opens without the
   * walk. Never set on a vault created in Talia, whose rules stay as they
   * were. Not a registration: a Ledger that has no record in Talia still
   * asks to see the vault once at signing time.
   */
  registrationAttestedAt?: number;
  /**
   * Ledger wallet-policy registrations, keyed by the DEVICE's master key
   * fingerprint (8-hex). Registering a vault on a Ledger returns an HMAC the
   * device demands back at signing time; the policy triple is persisted
   * VERBATIM beside it because signing must present exactly what was
   * registered — never re-derive it from the descriptor. The HMAC is not a
   * secret: it cannot spend (the Ledger still displays and requires
   * confirmation for every signature); it only spares the owner a
   * re-registration ceremony, which is why it may live here rather than in
   * the Keychain.
   */
  ledgerRegistrations?: Record<string, LedgerRegistration>;
  /** BitBox registrations, by device fingerprint. Only a marker: unlike the
   *  Ledger's HMAC the Nova keeps the policy on the device itself, so the
   *  device is the truth and this only remembers that the ceremony happened.
   *  NEVER infer registration from keyDevices: that records where a key
   *  LIVES, which is set at key entry, long before any registration (the
   *  conflation showed a "Registered" badge for a vault the device had
   *  never seen, 2026-08-31). */
  bitboxRegistrations?: Record<string, BitboxRegistration>;
  /**
   * Which physical signing device holds each key, by key fingerprint
   * (decided 2026-08-26: "we have to natively memorize which device has been
   * used for a particular key"). Drives device-appropriate actions —
   * a Ledger-bound key gets Bluetooth address checks and Bluetooth
   * signing. Extensible: BitBox/Jade land as new kinds. Changing a key's
   * hardware is a later feature once there is a second kind to change to.
   */
  keyDevices?: Record<string, KeyDevice>;
  /** True for a vault installed by UNSEALING an heir invite — the heir's
   *  view hides owner-only actions like the timelock refresh, which would
   *  push their own inheritance further away (decided 2026-07-27). */
  heirVault?: boolean;
  /** On an heir's vault: the fingerprint of THEIR own key — the only device
   *  they should ever be asked to register (decided 2026-07-27). */
  heirKeyFingerprint?: string;
  /** Soonest timelock expiry (blocks) found at last sync — home banner cache. */
  cachedExpiryBlocks?: number;
  /** Unix ms when cachedExpiryBlocks was computed. */
  cachedExpiryAt?: number;
  /**
   * A MANUAL wallet: no descriptor, nothing watched on-chain. Its balance is
   * the sum of buy/sell entries the owner typed in (see wallet/manualLedger).
   * Never handed to BDK, never synced, and deliberately EXCLUDED from the
   * home-screen total so a hand-typed number can't inflate what reads as a
   * verified balance (decided 2026-08-25).
   */
  manual?: boolean;
  /** Unix ms of the last edit to a MANUAL vault (rename, entry change) —
   *  the per-vault last-writer-wins stamp for encrypted sync. */
  manualUpdatedAt?: number;
  /**
   * This PORTFOLIO is shared with other people (decided 2026-09-12): every
   * participant holds the same portfolio key in their Keychain (never here)
   * and syncs one encrypted blob per share. The wallet id is the share's
   * portfolio id on every phone, so entries line up. Per device, like the
   * exchange links: the account blob does not carry it, and a phone that
   * receives the portfolio through account sync alone has no key.
   */
  sharedPortfolio?: SharedPortfolio;
  /** ON-CHAIN vault → linked PORTFOLIO id (decided 2026-08-26): when set, real
   *  deposits/withdrawals found at sync are appended to that portfolio
   *  automatically (deterministic snapshot ids keep it idempotent).
   *  Optional and per-device — links do not travel through portfolio sync. */
  linkedPortfolioId?: string;
  /**
   * An exchange feeding this PORTFOLIO (decided 2026-09-07, Kraken first): trades,
   * deposits and withdrawals arrive as entries with deterministic ids. The
   * API key itself lives in the iOS Keychain (services/krakenSync.ts), NEVER
   * here and never on the backend. Per device, like `linkedPortfolioId`.
   */
  exchangeLink?: ExchangeLink;
  /** Several exchanges may feed one portfolio (decided 2026-09-07, Coinbase
   *  beside Kraken). Read through `exchangeLinksOf`, which still honours
   *  the single `exchangeLink` of the first build; writes go here. */
  exchangeLinks?: ExchangeLink[];
  /** Last synced total balance (sats) — display cache for the home cards. */
  cachedBalanceSats?: number;
  /** Unix ms of the last successful sync. */
  cachedBalanceAt?: number;
}

/** The share a portfolio belongs to, as seen from THIS phone. */
export interface SharedPortfolio {
  /** The share's server id, minted on the owner's phone. */
  shareId: string;
  /** Owner: this phone started the share. Member: it joined by invite. */
  role: 'owner' | 'member';
  /** Unix ms when this phone started or joined the share. */
  since: number;
  /** The server blob version this phone last merged: its base for the
   *  next push (the server refuses a push against an older base). */
  version?: number;
  /** Unix ms of the last shared sync that finished. */
  lastSyncAt?: number;
  /** Plain-language reason the last shared sync failed. */
  lastError?: string;
  /** Sharing has ended for this phone: the owner stopped it (or the share is
   *  gone), or this member left or was removed. The copy stays and syncs
   *  through the account like any portfolio; the key is removed. */
  ended?: 'stopped' | 'removed';
}

export type ExchangeKind = 'kraken' | 'coinbase';

export interface ExchangeLink {
  exchange: ExchangeKind;
  connectedAt: number;
  /** Coinbase only: the sandbox at api-sandbox.coinbase.com, static
   *  sample fills, no key. For trying the flow without an account. */
  sandbox?: boolean;
  /** Unix ms of the last sync that finished, with or without new entries. */
  lastSyncAt?: number;
  /** Unix seconds of the newest record seen; the next sync asks from a
   *  little before it (ids make the overlap harmless). */
  syncedThroughSecs?: number;
  /** Plain-language reason the last sync failed, for the portfolio screen. */
  lastError?: string;
}

/** Electrum only: a saved Esplora setting moves to the default Electrum
 *  server at start (wallet/settingsMigration.ts, decided 2026-10-07). */
export type BackendType = 'electrum';

/**
 * Why Bitcoin vaults have no server (`AppSettings.bitcoinServerHold`).
 * 'esplora': the client's own Esplora server, saved before 2026-07 with no
 * Electrum server beside it (wallet/settingsMigration.ts `moveOffEsplora`);
 * `host` is how that server was named, for the note. 'unreadable': the
 * stored settings, or the saved server in them, could not be read
 * (wallet/storage.ts `loadSettings`), so which server the client chose is
 * not known.
 */
export type BitcoinServerHold = { reason: 'esplora'; host: string } | { reason: 'unreadable' };

/** Display unit for amounts. */
export type AmountUnit = 'btc' | 'sats' | 'auto';

/** Fiat currencies supported by the mempool.space price feed. */
export type FiatCurrency = 'USD' | 'EUR' | 'GBP' | 'CHF' | 'CAD' | 'AUD' | 'JPY';

export interface AppSettings {
  /** Home-screen category order (arrange mode). */
  categoryOrder?: string[];
  /** Portfolio-tab section order (its own arrange mode). Kept APART from
   *  `categoryOrder`: a label used for both a vault section and a portfolio
   *  section must never share one order. Per device, like `categoryOrder`. */
  portfolioCategoryOrder?: string[];
  /** Colour scheme: follow the phone, or force light/dark. */
  themeMode?: 'system' | 'light' | 'dark';
  /** Network preselected on the import screen. */
  defaultNetwork: Network;
  /** Chain backend used for syncing. */
  backendType: BackendType;
  /** Optional per-network Electrum URL overrides (else public defaults). */
  electrumUrls: Partial<Record<Network, string>>;
  /** Bitcoin vaults use NO server until the client saves one in Settings →
   *  Network (or taps Reset to default server), because the server they
   *  chose cannot be used as it was saved and the public default must not
   *  take its place (decided 2026-10-18; wallet/chainServers.ts `serverHold`).
   *  Ignored once a Bitcoin server is saved; Save and Reset clear it. */
  bitcoinServerHold?: BitcoinServerHold;
  /** Preferred display unit. */
  unit: AmountUnit;
  /** Preferred fiat currency for converted values. */
  fiat: FiatCurrency;
  /** Bitcoin-only display: hide every fiat conversion (and the price chart). */
  btcOnly?: boolean;
  /** Privacy: mask all balances (toggled by tapping the home balance). */
  hideBalances: boolean;
  /** Show the Bitcoin price chart on Home (removable via long-press). */
  showHomeChart?: boolean;
  /** Local reminders before a vault's recovery path opens (opt-in: iOS only
   *  ever shows the permission prompt once, so we ask when the user asks). */
  timelockRemindersEnabled?: boolean;
  /** Unix ms when the inheritance protocol was SUBMITTED from this app —
   *  clears the post-testing prompt instantly (server status is the truth,
   *  this is the offline-friendly cache). */
  inheritanceSubmittedAt?: number;
  /** Security: unlock with Face ID / Touch ID. */
  biometricsEnabled: boolean;
  /** Security: an app PIN is set. Its verifier lives in the Keychain
   *  (services/appPin.ts, decided 2026-09-26), never here. */
  pinSet?: boolean;
  /** LEGACY app PIN (SHA-256, before 2026-09-26): read once to upgrade the
   *  PIN on its next successful use, then removed. Never written. */
  pinHash?: string;
  pinSalt?: string;
  /** Lock again after the app has been away this long (seconds; see
   *  wallet/appLock.ts). Absent = the default. */
  lockAfterSeconds?: number;
  /** Require auth when the app opens. */
  requireAuthOnOpen: boolean;
  /** Require auth to unhide any balance. */
  requireAuthToUnhide: boolean;
  /** Categories hidden from the home screen (managed in Settings). */
  hiddenCategories: string[];
}
