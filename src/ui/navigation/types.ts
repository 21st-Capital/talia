/**
 * Navigation types (native tabs trial, 2026-09-15).
 *
 * The app is ONE native stack at the root. Its first screen is Apple's own
 * tab bar (`Tabs`), whose three tabs each hold their root screen alone: the
 * vault list, the portfolio list and Settings. Every other screen is pushed
 * on the root stack, above the tab bar. That is React Navigation's
 * documented way to show a tab bar on some screens only, and it is how the
 * bar shows on the three roots and nowhere else.
 */
import type { CompositeScreenProps, NavigatorScreenParams, ParamListBase } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { NativeBottomTabScreenProps } from '@react-navigation/bottom-tabs/unstable';
import type { Network } from '../../bitcoin/descriptor/types';
import type { BuildPsbtRequest } from '../../bitcoin/engine/types';
import type { ReplacementParams } from '../../wallet/txReplacementLogic';
import type { AddressVerdict } from '../hww/addressCheck';

/** A Speed up or a Cancel on its way through the signing ceremony (defined
 *  beside its records, so a plan can be turned back into it). */
export type { ReplacementParams };

/** Every screen above the tab bar, whichever tab it is reached from. */
export type RootStackParamList = {
  /** The tab bar with the three tab roots under it; always the bottom of
   *  this stack. A flow lands on a tab through `resetOverTab`. */
  Tabs: NavigatorScreenParams<RootTabParamList> | undefined;

  // ---- Reached from the Vaults tab.

  /** "+": create a new vault, or add an existing one. */
  AddWallet: undefined;
  /** Pick the new vault's shape: single / multi / timelocked. */
  CreateVault: undefined;
  /** Collect keys + parameters, preview the policy, create watch-only. */
  VaultBuilder: { vaultType: 'single' | 'multi' | 'timelock' };
  /** Layered vault wizard — mirrors the 21stcapital.com configurator.
   *  `scheme` preselects the shape when the user already chose it on the
   *  previous screen, so we never ask the same question twice. */
  LayeredVault:
    | {
        scheme?: 'single-1-1' | 'multi-2-2' | 'multi-2-3';
        /** The family member's first run (decided 2026-09-20): the vault somebody
         *  else's plan pays for, already picked, so the builder never asks
         *  which vault this is. payerId is what the claim names. */
        assigned?: { payerId: number; vaultNumber: number; payerEmail: string };
      }
    | undefined;
  /** Add an existing vault (decided 2026-09-08): the screen asks first whether
   *  it is a single-key or a shared vault, then (single key) which product
   *  holds it, and only then takes the descriptor. Each step is a push of
   *  this same route so back walks the questions in reverse.
   *  prefill: descriptor/xpub payload arriving from the global scanner,
   *  which skips the questions. */
  Import:
    | {
        prefill?: string;
        kind?: 'single' | 'multi';
        /** The device picked in the hardware list (decided 2026-10-04, device
         *  first): the search draws it, and the page is named after it. */
        model?: 'gen5' | 'flex' | 'stax' | 'nanoX' | 'nova' | 'passport';
        provider?:
          | 'ledger'
          | 'bitbox'
          | 'passport'
          | 'sparrow'
          | 'liana'
          | 'bluewallet'
          | 'electrum'
          | 'talia'
          | 'other';
      }
    | undefined;
  WalletDetail: {
    walletId: string;
    /** Fresh multi-key vault: offer registration on every device right away
     *  (skippable: the banner stays as the fallback, decided 2026-08-26). */
    promptHardwareRegistration?: boolean;
    /** A single-sig vault just imported (decided 2026-09-08): ask which device
     *  signs for it, or watch only. Full app only. */
    askHardware?: boolean;
  };
  /** Native inheritance questionnaire; prefills from the vault when given.
   *  `account` preselects the vault the plan is filed for (the hub's
   *  per-vault rows and the vault screen's banner pass it). Reached from a
   *  vault and from the Estate Plan hub in Settings. */
  InheritanceSetup: { walletId?: string; account?: number } | undefined;
  /** 2FA setup — reachable mid-flow (vault creation, co-sign step-up) so the
   *  user is TAKEN there and lands right back where they were (decided 2026-07-24).
   *  `gate: true` = sent here by a MUST-gate: open the setup immediately
   *  instead of the status page (decided 2026-07-27). Settings opens it too. */
  TwoFactor: { gate?: boolean } | undefined;
  /** address/index: show a SPECIFIC address (from the Addresses list) instead
   *  of deriving. `verdict`: what the address check (VerifyAddress) found,
   *  handed back as it pops to this screen, pinned to the address it judged. */
  /** `address` without `index` (the coin list): `keychain` says where to look for it first. */
  Receive: { walletId: string; address?: string; index?: number; keychain?: 'external' | 'internal'; verdict?: AddressVerdict };
  /** The address check on its own screen (decided 2026-10-04: "open a temporary
   *  new verification screen and jump back once its done"): which device,
   *  then the address large over the device drawn checking it; the verdict
   *  goes back to Receive in its params. Full app only. */
  VerifyAddress: { walletId: string; address: string; index: number };
  /** address: prefill recipient; utxos: coin-control preselection;
   *  refresh: self-spend mode (Liana timelock reset) — `count` fresh own
   *  addresses (1 = simple, one per coin = private) are derived at BUILD
   *  time so navigation never waits on the engine. */
  Send: {
    walletId: string;
    address?: string;
    /** A scanned payment request's own amount, exact; read only with `address`. */
    amountSats?: number;
    utxos?: Array<{ txid: string; vout: number; valueSats: number }>;
    /** separate = one 1-in/1-out transaction PER coin (unlinked refresh). */
    refresh?: { count: number; separate?: boolean };
    /** A saved address picked on the Address book page, handed back as it
     *  pops to Send (decided 2026-11-05); `at` tells one pick from the next,
     *  the same address picked twice too. */
    picked?: { address: string; at: number };
  };
  /** The address book, opened from Send (decided 2026-11-05): only the
   *  entries the sending vault's `network` can pay, and a tapped card goes
   *  back to that Send (`walletId`) through its `picked` param. */
  AddressBook: { walletId: string; network: Network };
  /** Add an address to the book: from the book's + or from Send's "Save
   *  address", which hands over the `address` on Send. `network` is the
   *  sending vault's: an address of another network is refused. With
   *  `editId` it is that saved entry's own page instead, opened from Edit on
   *  a swiped card: its name and category change, its address never does
   *  (decided 2026-11-05). */
  AddAddress: { network: Network; address?: string; editId?: string };
  Addresses: { walletId: string };
  /** walletId set = verify against that wallet; unset = global check-or-send.
   *  mode 'type' opens on the typed-address form instead of the camera
   *  (address verification by text, decided 2026-09-12). */
  Scan: { walletId?: string; mode?: 'scan' | 'type' } | undefined;
  /** Full-screen Bitcoin price chart with the range selector (Bitkey-style). */
  PriceHistory: undefined;
  Utxos: { walletId: string };
  TxDetail: { walletId: string; txid: string };
  /** Review/export a PSBT scanned from outside (e.g. built on another device). */
  PsbtReview: { walletId: string; psbtBase64: string };
  /** The signing ceremony: hand the PSBT to a hardware signer over QR, file or Bluetooth,
   *  take the signatures back, finalize and broadcast. */
  SignPsbt: {
    walletId: string;
    psbtBase64: string;
    /** Separate-transactions refresh: sign+broadcast each in turn. */
    psbtQueue?: string[];
    /** When finishing a co-sign-first request: the pending record to clear
     *  (and mark completed server-side) once this signs + broadcasts. */
    pendingCosignId?: string;
    /** Sign-only: the client signs their OWN key while WAITING for 21C, so we
     *  save the partial PSBT back to the pending record instead of broadcasting
     *  (used from the Pending screen before 21C has co-signed). */
    signOnly?: boolean;
    /** The original build request, so the ceremony can REBUILD the spend on a
     *  timelocked branch when an unlocked recovery/heir key is chosen — the
     *  primary-path PSBT cannot be signed by those keys (decided 2026-07-27). */
    rebuild?: BuildPsbtRequest;
    /** A Speed up or a Cancel: the ceremony says so and records it once sent. */
    replaces?: ReplacementParams;
  };
  /** Refresh SESSION (decided 2026-08-27): a separate-transactions refresh on a
   *  vault with a 21C co-signer. One Ledger pass signs every transaction,
   *  ONE OTP round authorises the whole co-sign batch, and broadcast is one
   *  button on the Pending screen once 21C has signed. */
  RefreshSession: {
    walletId: string;
    items: Array<{
      /** Unsigned PSBT for one coin's refresh transaction. */
      psbt: string;
      /** The fresh own address the coin moves to. */
      destination: string;
      /** What arrives there (coin value minus this transaction's fee). */
      amountSats: number;
      feeSats: number;
    }>;
  };
  /** Walk the user through registering the vault descriptor on EVERY key's
   *  hardware device (fresh = arrived straight from vault creation). */
  RegisterVault: { walletId: string; fresh?: boolean };
  /** "Vault built" (decided 2026-10-02, design B at pace B2): where both vault
   *  builders land, over the new vault's page. Nothing else lands here. */
  VaultBuilt: { walletId: string };
  /** Human-readable spending-policy breakdown for one wallet. */
  Policy: { walletId: string };
  /** The key check on the testing call (decided 2026-09-07): the vault's 21st
   *  Capital keys in full, one tick per key. Full app only. */
  VerifyExternalKeys: { walletId: string };
  /** Point a vault's key at new hardware holding the SAME key (decided
   *  2026-09-08). Reachable from the vault menu; it navigates on to
   *  RegisterHardware to show a shared vault to the new device. */
  ReplaceDevice: { walletId: string };
  /** Create a Vault Account Statement for a chosen period (decided 2026-08-28). */
  Statement: { walletId: string };
  /** Show a vault to a signing device, or link a one-key vault to its
   *  device: the ONE registration screen, for every adopted device (decided
   *  2026-09-22). `fingerprint` names the key the owner came for, when a
   *  list row named one; any key of the vault is still accepted. */
  RegisterHardware: { walletId: string; fingerprint?: string };
  /** Owner side: seal an invite for a KEYED heir (the design of 2026-07-24).
   *  Opened from a vault, from the Estate Plan hub and from the
   *  questionnaire's success page ("Invite my heirs"). */
  InviteHeir: { walletId: string };
  /** Heir side: claim by code — `code` prefills from talia://invite/CODE. */
  ClaimInvite: { code?: string } | undefined;
  /** Transactions 21st Capital has co-signed — combine + broadcast. */
  PendingCosign: { walletId?: string } | undefined;

  // ---- Reached from the Portfolios tab: hand-kept portfolios, fully
  // separate from on-chain vaults (decided 2026-08-26: "not mix them with real
  // vaults").

  /** Name and create a virtual vault (hand-kept, never synced on-chain). */
  ManualWalletSetup: undefined;
  /** A virtual vault's detail screen. */
  ManualWallet: { walletId: string };
  /** Add a buy/sell, or edit `entryId` if given. `picked` is the source
   *  list's answer, handed back by `EntrySource`; `at` tells one pick from
   *  the next, so picking the same source twice still lands. */
  ManualEntry: {
    walletId: string;
    entryId?: string;
    picked?: { source: string | null; sourceName?: string; at: number };
  };
  /** One entry's page: every detail, like a transaction's (decided
   *  2026-10-22). Edit on it for the owner; a member only reads it. */
  ManualEntryDetail: { walletId: string; entryId: string };
  /** Where an entry's bitcoin was bought or sold: the exchanges, Peer to
   *  peer, Other. Answers `ManualEntry` through its `picked` param. */
  EntrySource: { walletId: string; entryId?: string; source?: string; sourceName?: string };
  /** Create a Portfolio statement for a chosen period (decided 2026-08-28). */
  PortfolioStatement: { walletId: string };
  /** Connect a Kraken read-only key to a portfolio (decided 2026-09-07). */
  KrakenConnect: { walletId: string };
  /** The portfolio's sources: vaults in Talia and exchanges (decided 2026-09-07). */
  PortfolioSync: { walletId: string };
  /** Connect a Coinbase read-only CDP key to a portfolio (decided 2026-09-07). */
  CoinbaseConnect: { walletId: string };
  /** Share a portfolio with other people, or see who it is shared with
   *  (decided 2026-09-12): invites, members, stop sharing / leave. */
  SharePortfolio: { walletId: string };
  /** Join a shared portfolio by code; `code` prefills from the
   *  talia://invite/TALIA-P-... link. Works in the watch-only build. */
  ClaimSharedPortfolio: { code?: string } | undefined;

  // ---- Reached from Settings.

  /** Account hub: 21C login, client services, inheritance PDF. */
  Inheritance: undefined;
  /** Elite Services (decided 2026-09-21): the page the Settings row opens, listing
   *  co-signing limits, vault owners and the setup meeting. */
  EliteServices: undefined;
  /** Read and change the co-signing limits of each Estate Plan (decided
   *  2026-09-19: lower now, raise after 24 hours). From a vault's own menu it
   *  carries that vault's id and shows that vault alone; from Elite Services,
   *  no id, every vault. */
  CosignLimits: { walletId?: string } | undefined;
  /** Vault owners (decided 2026-09-20): who each vault of the payer's plan is
   *  for. The route keeps its first name; the screen never says "holder". */
  VaultHolders: undefined;
  /** Support — reachable only from the (logged-in) account hub. */
  Support: undefined;
  /** Rescue ceremony — reachable from the (logged-in) account hub, from the
   *  signing ceremony's rescue-key row, and from a vault's own Spending
   *  policy once its rescue path is open (decided 2026-09-23). `walletId` opens
   *  that vault straight away instead of asking which one. */
  Rescue: { walletId?: string } | undefined;
  /** Every alert Talia can send (decided 2026-08-24). */
  NotificationSettings: undefined;
  /** E2E-encrypted virtual-vault sync through the 21C account. */
  VaultSync: undefined;
  /** Native settings (decided 2026-07-21: no website bounces). */
  GeneralInfo: undefined;
  Subscriptions: undefined;
  DeleteAccount: undefined;
  NetworkSettings: undefined;
  DisplaySettings: undefined;
  SecuritySettings: undefined;
  /** The wallet engine, this phone's engine switches, the engine report
   *  (BDK upgrade, decided 2026-10-15). Hardware-signing builds only. */
  Diagnostics: undefined;
};

/** The screens reached from Settings are on the root stack too; the old
 *  name stays so their imports do. */
export type SettingsStackParamList = RootStackParamList;
/** Likewise for the screens reached from the Portfolios tab. */
export type VirtualStackParamList = RootStackParamList;

/** Each tab's own one-screen stack: its root screen alone. */
export type VaultsTabParamList = { WalletList: undefined };
export type VirtualTabParamList = { VirtualList: undefined };
export type SettingsTabParamList = { Settings: undefined };

/** Apple's tab bar (`createNativeBottomTabNavigator`). */
export type RootTabParamList = {
  VaultsTab: NavigatorScreenParams<VaultsTabParamList> | undefined;
  VirtualTab: NavigatorScreenParams<VirtualTabParamList> | undefined;
  SettingsTab: NavigatorScreenParams<SettingsTabParamList> | undefined;
};

/** Props of a tab's root screen: its one-screen stack, inside a tab of the
 *  tab bar, inside the root stack. `navigation.navigate` reaches every
 *  screen on the root stack; `getParent()` is the tab (for `tabPress`). */
export type TabRootScreenProps<
  ParamList extends ParamListBase,
  RouteName extends keyof ParamList & string,
  Tab extends keyof RootTabParamList,
> = CompositeScreenProps<
  NativeStackScreenProps<ParamList, RouteName>,
  CompositeScreenProps<
    NativeBottomTabScreenProps<RootTabParamList, Tab>,
    NativeStackScreenProps<RootStackParamList, 'Tabs'>
  >
>;
