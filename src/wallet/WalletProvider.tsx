/**
 * App-wide wallet state: the list of watch-only wallets, user settings, and a
 * lazily-created cache of live `WalletEngine` instances (one per wallet).
 *
 * Screens consume this via `useWallets()` and never touch storage or the engine
 * factory directly.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WalletEngine } from '../bitcoin/engine/types';
import type { AppSettings, KeyDevice, WalletMeta } from './types';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadWallets,
  newWalletId,
  saveSettings,
  saveWallets,
} from './storage';
import { hasOwnerSideLabels, heirSideKeyLabels } from './heirKeyLabels';
import { isSealedStoreError, startOverSealedStore } from './sealedStore';
import type { SealedStoreProblem } from './sealedStore';
import { getEngineFactory, USE_FAKE_ENGINE } from './engineProvider';
import { guardedEngine, scheduleAddressCheck } from './addressCheckStore';
import { chainServersFor, syncThroughChainServers } from './chainServers';
import { clearTxCache } from './txCache';
import { clearAddrCache } from './addrCache';
import { clearUtxoCache } from './utxoCache';
import { clearManualEntries } from './manualEntries';
import { clearCoinCosts } from './coinCosts';
import { clearTxReplacements, pruneTxReplacements } from './txReplacements';
import { orderWalletsByIds } from './walletOrder';
import { entryTombstoneIdsFor, migrateLegacyCredential, recordTombstone, runSync } from '../services/virtualVaultSync';
import { upgradeNoiseConfigProtection } from '../services/bitboxPairing';
import { sweepExportLeftovers } from '../platform/files';
import { removeShareKey, runSharedSync } from '../services/sharedPortfolio';
import { isSharedViewer } from './sharedAccess';
import { portfolioEntriesFromHistory, toManualEntries } from './vaultToPortfolio';
import { loadManualEntries, saveManualEntries } from './manualEntries';
import { getHistoricalPoint } from './historicalPrice';
import type { WalletTx } from '../bitcoin/engine/types';
import type { SyncOutcome } from '../services/virtualVaultSync';
import { AppState, Linking, InteractionManager,
} from 'react-native';
import { loadSession, onSessionSaved } from '../services/companyAuth';
import { reportSentRescues } from '../services/rescue';
import {
  loadOwnerInvites,
  maybePushReleaseAt,
  maybeReconcileClaimedInvites,
} from '../services/heirInvite';
import {
  cancelAllReminders,
  hasNotificationPermission,
  syncScheduledReminders,
} from '../platform/notifications';
import { timelockReminders, type TimelockReminder } from './timelockReminders';
import {
  fetchSubscriptions,
  hasActiveSubscription,
  pollSubscriptionActive,
} from '../services/billing';
import { isCheckoutReturnUrl } from '../services/deepLinks';

export interface NewWalletInput {
  /** Fixed id — ONLY for sync applying a vault created on another device;
   *  everything else lets the provider mint one. */
  id?: string;
  label: string;
  descriptor: string;
  changeDescriptor?: string;
  network: WalletMeta['network'];
  kind: WalletMeta['kind'];
  source: WalletMeta['source'];
  transport: WalletMeta['transport'];
  /** Home-screen section (savings/spending/custom). Unset = "Other". */
  category?: string;
  /** Wallet icon key; unset = category default. */
  icon?: string;
  /** Human names per key fingerprint (lowercase hex) — the signing ceremony
   *  speaks in these. Mandatory at creation since 2026-07-18. */
  keyLabels?: Record<string, string>;
  providerKeyFingerprints?: string[];
  /** Vault installed from an unsealed heir invite (see WalletMeta.heirVault). */
  heirVault?: boolean;
  /** The heir's OWN key on that vault — the only device they register. */
  heirKeyFingerprint?: string;
  /** Devices already proven for this vault's keys (an heir's key read over
   *  Bluetooth at activation, decided 2026-09-22). */
  keyDevices?: WalletMeta['keyDevices'];
  /** Heirs named at creation (email required for every heir, decided 2026-07-24). */
  heirs?: WalletMeta['heirs'];
  /** A manual wallet: no descriptor, never synced (see WalletMeta.manual). */
  manual?: boolean;
  /** ONLY for a portfolio joined by invite: its stamp is the shared blob's,
   *  not "now", so the first shared sync finds nothing to fight over. */
  manualUpdatedAt?: number;
  /** The share a joined portfolio belongs to (see WalletMeta.sharedPortfolio). */
  sharedPortfolio?: WalletMeta['sharedPortfolio'];
  /** Create the vault locked (21C-key vault pending payment). */
  locked?: boolean;
  activationPlan?: WalletMeta['activationPlan'];
  /** Which of the client's vaults this is, and the 21st Capital account
   *  number its keys derive from. Both are known at creation since the app
   *  claims the number when it fetches this vault's own keys (2026-09-01). */
  vaultNumber?: number;
  accountNumber?: number;
}

interface WalletContextValue {
  wallets: WalletMeta[];
  settings: AppSettings;
  /** The vault list is not loaded yet (or cannot be: see storeProblem). */
  loading: boolean;
  /** The settings (and so the lock's configuration) are read. */
  settingsLoaded: boolean;
  /** Why the vault list is still not loaded, when waiting is not enough. */
  storeProblem: StoreProblem | null;
  /** Ask for the vault list again now. */
  retryLoad: () => void;
  /** Set aside what cannot be opened and start with an empty list. */
  startOverStore: () => Promise<void>;
  addWallet: (input: NewWalletInput) => Promise<WalletMeta>;
  /** Apply arrange-mode changes: order + category moves, atomically. */
  arrangeWallets: (ids: string[], categoryById: Record<string, string | undefined>) => Promise<void>;
  removeWallet: (id: string) => Promise<void>;
  /** Update display metadata (rename, category). */
  updateWallet: (
    id: string,
    patch: Partial<Pick<WalletMeta, 'label' | 'category' | 'balanceHidden' | 'icon' | 'keyLabels' | 'cachedExpiryBlocks' | 'cachedExpiryAt' | 'frozenUtxos' | 'linkedPortfolioId' | 'portfolioId' | 'accountNumber' | 'vaultTestedAt' | 'descriptorBackupEmailedAt' | 'vaultRegisteredAt' | 'ledgerRegistrations' | 'bitboxRegistrations' | 'keyDevices' | 'untestedRiskAccepted' | 'heirs' | 'exchangeLink' | 'exchangeLinks' | 'registrationAttestedAt' | 'sharedPortfolio'>>,
  ) => Promise<void>;
  getWallet: (id: string) => WalletMeta | undefined;
  /**
   * Replace a vault's descriptor with one describing the SAME keys more
   * fully: the origin a device connection just supplied (decided 2026-09-08,
   * "connecting means gather missing information"). The engine is rebuilt
   * on next use; addresses and history are unchanged since the keys are.
   * `keyDevices` binds the key under its new id at the same time.
   */
  upgradeDescriptor: (id: string, descriptor: string, keyDevices?: Record<string, KeyDevice>) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  /** True right after a checkout deep-link unlocked the user's vault(s). */
  planJustActivated: boolean;
  clearPlanActivated: () => void;
  /** Get (creating if needed) the live engine for a wallet. */
  getEngine: (wallet: WalletMeta) => Promise<WalletEngine>;
  /** Sync a wallet against its network backend. Skips the network when the
   *  wallet synced <60s ago unless `force` — tapping around stays instant. */
  syncWallet: (wallet: WalletMeta, opts?: { force?: boolean }) => Promise<WalletEngine>;
  /** Persist the last-synced balance so home cards can show it instantly. */
  recordBalance: (walletId: string, totalSats: number) => void;
  /** Stamp a MANUAL vault as edited and schedule an encrypted sync push. */
  touchManualVault: (walletId: string) => void;
  /** LINKED portfolios (decided 2026-08-26): append a vault's new real activity
   *  to its linked portfolio after a sync. Idempotent via deterministic
   *  snapshot ids; owner-deleted entries stay deleted (entry tombstones). */
  autoAppendLinked: (vaultId: string, txs: WalletTx[]) => Promise<void>;
  /** Run one full virtual-vault sync immediately (Settings + app start). */
  syncVirtualVaults: () => Promise<SyncOutcome>;
}

/** 'waiting': the Keychain has not answered for a while; otherwise the
 *  saved data cannot be opened on this phone (sealedStore). */
export type StoreProblem = 'waiting' | SealedStoreProblem;
/** What a sync says when the settings could not be read at all. */
export const SETTINGS_NOT_READ = 'Talia could not read its settings. Try again later';

/** Quiet tries before the owner is told the list is not loading. */
const STORE_TRIES_BEFORE_TELLING = 4;

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  // Live engines are cached per wallet id for the app session.
  const engines = useRef<Map<string, WalletEngine>>(new Map());
  /** Engines being made, so two callers at once share one (`getEngine`). */
  const enginesBeingMade = useRef<Map<string, Promise<WalletEngine>>>(new Map());
  /** When each vault's engine last finished a sync (`syncWallet`). */
  const lastSyncAt = useRef<Map<string, number>>(new Map());
  /** The sync running for each vault, which a caller with no `force` joins (`syncWallet`). */
  const syncsRunning = useRef<Map<string, { engine: WalletEngine; done: Promise<WalletEngine> }>>(new Map());
  /** Moves when the client changes servers: a sync that began before says nothing about the new ones. */
  const serverChoice = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Mutations read the CURRENT list from this ref, not captured state —
  // back-to-back addWallet calls must not overwrite each other.
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  // What stands between the app and its vault list (decided 2026-09-26): null while
  // it loads normally or once it has; 'waiting' after several tries at a
  // Keychain that does not answer; a SealedStoreProblem when the saved data
  // cannot be opened on this phone at all. AuthGate shows the lock first and
  // then this, never the app, while the list is not loaded.
  const [storeProblem, setStoreProblem] = useState<StoreProblem | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Settles once the settings were read (true) or could not be (false).
  // Every sync waits for it (`syncWallet`): until then `settingsRef` holds
  // the defaults, and a sync started then (the release upkeep starts once
  // the vault list is in, which can be first) would take a Bitcoin vault
  // whose client chose their own node to the public server (decided 2026-10-18:
  // never to any other node).
  const settingsRead = useRef<{ ready: Promise<boolean>; settle: (read: boolean) => void } | null>(null);
  if (!settingsRead.current) {
    let settle: (read: boolean) => void = () => undefined;
    const ready = new Promise<boolean>((done) => {
      settle = done;
    });
    settingsRead.current = { ready, settle };
  }
  const loadNow = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    // Exports an earlier run left on disk (decided 2026-09-26). At mount, before
    // any export of THIS run can be in the share sheet.
    void sweepExportLeftovers();
    let cancelled = false;
    let done = false;
    let running = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Settings are plain and load on their own, so the lock (which they
    // configure) shows even while the vault list cannot be read.
    // The ref first, so a sync waiting on `settingsRead` reads THESE.
    void loadSettings().then(
      (s) => {
        if (cancelled) return;
        settingsRef.current = s;
        setSettings(s);
        setSettingsLoaded(true);
        settingsRead.current?.settle(true);
      },
      () => {
        // The store did not answer: nothing is known, so nothing syncs (and
        // the lock shows its cover, AuthGate).
        if (!cancelled) settingsRead.current?.settle(false);
      },
    );

    const tryLoad = async (): Promise<void> => {
      if (cancelled || done || running) return;
      running = true;
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        const loaded = await loadWallets();
        done = true;
        if (cancelled) return;
        // An heir's copy claimed before 2026-09-22 carries the owner-side
        // key names ("Your key"): rename them once, as the claim now does.
        const w = loaded.map((x) =>
          x.heirVault && hasOwnerSideLabels(x.keyLabels) ? { ...x, keyLabels: heirSideKeyLabels(x.keyLabels) } : x,
        );
        if (w.some((x, i) => x !== loaded[i])) void saveWallets(w);
        walletsRef.current = w;
        setWallets(w);
        setStoreProblem(null);
        setLoading(false);
      } catch (e) {
        attempt += 1;
        if (cancelled) return;
        if (isSealedStoreError(e)) {
          // Waiting will not fix this: the owner chooses (AuthGate).
          setStoreProblem(e.problem);
        } else {
          // The Keychain did not answer (a launch while the phone is
          // locked). Ask again soon, and as soon as the app is in front.
          if (attempt >= STORE_TRIES_BEFORE_TELLING) setStoreProblem('waiting');
          timer = setTimeout(() => void tryLoad(), Math.min(10_000, 500 * 2 ** Math.min(attempt, 5)));
        }
      } finally {
        running = false;
      }
    };
    loadNow.current = tryLoad;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tryLoad();
    });
    void tryLoad();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  const retryLoad = useCallback(() => void loadNow.current(), []);
  const startOverStore = useCallback(async () => {
    await startOverSealedStore();
    await loadNow.current();
  }, []);

  // STRICT-INVITE RELEASE UPKEEP (2026-07-26 forensics): the server can only
  // learn the heir countdown from the OWNER's logged-in app, and before this
  // it only rode on accidental screen syncs: in a test a vault was funded, the
  // owner logged out, and the date never landed. Guaranteed triggers now: app start, every
  // foreground, and the moment a session is saved (in-app login fires no
  // AppState event). force:true so the 60s sync throttle can't eat the push.
  const lastUpkeepAt = useRef(0);
  const releaseUpkeep = useCallback(async () => {
    if (Date.now() - lastUpkeepAt.current < 5 * 60_000) return;
    lastUpkeepAt.current = Date.now();
    try {
      const session = await loadSession();
      if (!session) return;
      // A rescue this phone sent whose report never reached 21st Capital
      // (2026-10-19): told again, so the request does not stay "Signed"
      // there. Nothing at all unless such a record exists; bounded.
      void reportSentRescues(session);
      // HEIR side of the same coin: pull the current release dates for this
      // account's sealed cards (they move when the owner refreshes coins).
      void maybeReconcileClaimedInvites(0);
      const email = session.email?.toLowerCase();
      const strictWalletIds = new Set(
        (await loadOwnerInvites())
          .filter(
            (r) => r.mode === 'strict' && (!r.ownerEmail || !email || r.ownerEmail === email),
          )
          .map((r) => r.walletId),
      );
      if (strictWalletIds.size === 0) return;
      for (const w of walletsRef.current.filter((x) => strictWalletIds.has(x.id))) {
        try {
          await syncWallet(w, { force: true });
        } catch {
          // one unreachable backend must not stop the others
        }
      }
    } catch {
      // best-effort — the next trigger tries again
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (loading) return;
    void releaseUpkeep();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void releaseUpkeep();
    });
    // A fresh login must push immediately — reset the throttle first.
    const unsubSession = onSessionSaved(() => {
      lastUpkeepAt.current = 0;
      void releaseUpkeep();
    });
    return () => {
      sub.remove();
      unsubSession();
    };
  }, [loading, releaseUpkeep]);

  // GLOBAL checkout-return handler (decided 2026-07-20): the website deep-links
  // tiam://checkout/complete after payment. Wherever the user is, confirm the
  // plan is now active (poll — the Stripe webhook may lag) and UNLOCK every
  // locked 21C-key vault. Lives here, not on a screen, so it survives the
  // browser round-trip. Also runs a check on cold-start via getInitialURL.
  const [planJustActivated, setPlanJustActivated] = useState(false);
  useEffect(() => {
    const onCheckoutReturn = async (url: string | null) => {
      if (!isCheckoutReturnUrl(url)) return; // exact shape only (./deepLinks, decided 2026-09-26)
      const session = await loadSession();
      if (!session) return;
      const active = await pollSubscriptionActive(session);
      if (!active) return;
      const locked = walletsRef.current.filter((w) => w.locked);
      if (locked.length === 0) return;
      const next = walletsRef.current.map((w) => (w.locked ? { ...w, locked: false } : w));
      walletsRef.current = next;
      setWallets(next);
      await saveWallets(next);
      setPlanJustActivated(true);
    };
    const sub = Linking.addEventListener('url', ({ url }) => void onCheckoutReturn(url));
    void Linking.getInitialURL().then((url) => void onCheckoutReturn(url));

    // FOREGROUND FALLBACK (decided 2026-07-21): the user often returns from the
    // browser by hand (app switcher) and the deep link never fires. Whenever
    // the app becomes active while a locked vault exists, check the plan once
    // (single fetch, 15s throttle — not the 30s poll) and unlock on success.
    let lastCheck = 0;
    const onAppStateChange = async (state: string) => {
      if (state !== 'active') return;
      if (!walletsRef.current.some((w) => w.locked)) return;
      if (Date.now() - lastCheck < 15_000) return;
      lastCheck = Date.now();
      try {
        const session = await loadSession();
        if (!session) return;
        if (!hasActiveSubscription(await fetchSubscriptions(session))) return;
        const next = walletsRef.current.map((w) => (w.locked ? { ...w, locked: false } : w));
        walletsRef.current = next;
        setWallets(next);
        await saveWallets(next);
        setPlanJustActivated(true);
      } catch {
        // best-effort — the deep link and the next foreground remain
      }
    };
    const appStateSub = AppState.addEventListener('change', (s) => void onAppStateChange(s));

    return () => {
      sub.remove();
      appStateSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addWallet = useCallback(async (input: NewWalletInput): Promise<WalletMeta> => {
    const meta: WalletMeta = {
      createdAt: Date.now(),
      // A manual vault is born with its sync stamp.
      ...(input.manual ? { manualUpdatedAt: Date.now() } : null),
      ...input,
      id: input.id ?? newWalletId(),
    };
    const next = [meta, ...walletsRef.current];
    walletsRef.current = next;
    setWallets(next);
    await saveWallets(next);
    // No automatic copy anywhere (decided 2026-09-26):
    // a dormant iCloud path here would have uploaded every new vault's
    // descriptor in the clear the moment a native module was linked. Backups
    // are the owner's own act, and the file one is sealed (vaultBackup.ts).
    return meta;
  }, []);

  const removeWallet = useCallback(async (id: string): Promise<void> => {
    engines.current.delete(id);
    enginesBeingMade.current.delete(id);
    lastSyncAt.current.delete(id);
    const dying = walletsRef.current.find((w) => w.id === id);
    if (dying?.manual) {
      // Any vault linked to this portfolio loses its link.
      const unlinked = walletsRef.current.map((w) =>
        w.linkedPortfolioId === id ? { ...w, linkedPortfolioId: undefined } : w,
      );
      walletsRef.current = unlinked;
      // The deletion must beat the vault's own stamp on other devices. A copy
      // shared WITH this phone never sat in the account, and it carries the
      // OWNER's portfolio id: a tombstone under that id would later delete a
      // copy the member is told they keep (decided 2026-09-14).
      if (!isSharedViewer(dying)) void recordTombstone(id, Date.now()).then(() => scheduleManualSync());
      // A shared portfolio's key goes with it: without the wallet there is
      // nothing on this phone the key could open.
      if (dying.sharedPortfolio) void removeShareKey(dying.sharedPortfolio.shareId);
    }
    // scheduleManualSync is stable ([]-dep chain) — safe to omit.
    void clearTxCache(id);
    void clearAddrCache(id);
    void clearUtxoCache(id);
    void clearManualEntries(id);
    void clearCoinCosts(id);
    void clearTxReplacements(id);
    const next = walletsRef.current.filter((w) => w.id !== id);
    walletsRef.current = next;
    setWallets(next);
    await saveWallets(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Apply an arrangement atomically: new order AND category moves in one
   *  functional update (separate updates raced and clobbered each other).
   *  `ids` covers ONE tab's wallets (on-chain vaults or portfolios); the
   *  rest keep their current relative order (orderWalletsByIds). */
  const arrangeWallets = useCallback(
    async (ids: string[], categoryById: Record<string, string | undefined>): Promise<void> => {
      setWallets((prev) => {
        const next = orderWalletsByIds(
          prev.map((w) =>
            w.id in categoryById && (w.category ?? undefined) !== categoryById[w.id]
              ? { ...w, category: categoryById[w.id] }
              : w,
          ),
          ids,
        );
        walletsRef.current = next;
        void saveWallets(next);
        return next;
      });
    },
    [],
  );

  const getWallet = useCallback(
    (id: string) => wallets.find((w) => w.id === id),
    [wallets],
  );

  const updateWallet = useCallback(
    async (id: string, patch: Partial<Pick<WalletMeta, 'label' | 'category' | 'balanceHidden' | 'icon' | 'keyLabels' | 'cachedExpiryBlocks' | 'cachedExpiryAt' | 'frozenUtxos' | 'linkedPortfolioId' | 'portfolioId' | 'accountNumber' | 'vaultTestedAt' | 'descriptorBackupEmailedAt' | 'vaultRegisteredAt' | 'ledgerRegistrations' | 'bitboxRegistrations' | 'keyDevices' | 'untestedRiskAccepted' | 'heirs' | 'exchangeLink' | 'exchangeLinks' | 'registrationAttestedAt' | 'sharedPortfolio'>>): Promise<void> => {
      // Outside the updater, as every other mutator does. React only runs an
      // updater eagerly while the fiber has no pending work, so a patch that
      // followed another update in the same turn left the ref stale until the
      // next render: joining a shared portfolio wrote the member marker and
      // then read walletsRef.current in the same turn, and that one sync
      // treated the copy as an ordinary portfolio (decided 2026-09-14).
      const next = walletsRef.current.map((w) => (w.id === id ? { ...w, ...patch } : w));
      walletsRef.current = next;
      setWallets(next);
      await saveWallets(next);
    },
    [],
  );

  const upgradeDescriptor = useCallback(
    async (id: string, descriptor: string, keyDevices?: Record<string, KeyDevice>): Promise<void> => {
      engines.current.delete(id);
      enginesBeingMade.current.delete(id);
      // The sync on record was the old engine's: "fresh enough" would hand
      // Receive a new engine that has synced nothing (decided 2026-10-30).
      lastSyncAt.current.delete(id);
      // Ref first, outside the updater, like updateWallet (decided 2026-09-19):
      // a caller that upgrades and then patches in the same turn (Replace
      // signing device learning a bare key's origin) read a stale ref and
      // its patch dropped the upgrade whenever React deferred the updater.
      const next = walletsRef.current.map((w) =>
        w.id === id
          ? {
              ...w,
              descriptor,
              ...(keyDevices ? { keyDevices: { ...(w.keyDevices ?? {}), ...keyDevices } } : {}),
            }
          : w,
      );
      walletsRef.current = next;
      setWallets(next);
      await saveWallets(next);
    },
    [],
  );

  const updateSettings = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    const next = { ...settingsRef.current, ...patch };
    // A sync running now may be asking a server the client has just left:
    // the next caller asks the servers as they are from here on.
    syncsRunning.current.clear();
    // And a sync that finished on it is no answer from the new one, which may
    // know of a payment the old one had not seen (decided 2026-10-30).
    if ('electrumUrls' in patch || 'bitcoinServerHold' in patch) {
      lastSyncAt.current.clear();
      serverChoice.current += 1;
    }
    setSettings(next);
    await saveSettings(next);
  }, []);

  const getEngine = useCallback(async (wallet: WalletMeta): Promise<WalletEngine> => {
    // A manual wallet has no descriptor and nothing to watch. Fail loudly here
    // rather than letting an empty string reach BDK, where it surfaces as an
    // unrelated parse error a long way from the actual mistake.
    if (wallet.manual) {
      throw new Error('This wallet is kept by hand. There is nothing to sync.');
    }
    const existing = engines.current.get(wallet.id);
    if (existing) return existing;
    // One engine per vault (decided 2026-10-30): two callers at once share the
    // one being made, or each would hold an engine with its own memory of the
    // chain, and the second to finish would replace the first.
    const making = enginesBeingMade.current.get(wallet.id);
    if (making) return making;
    const made = (async () => {
      const created = await (await getEngineFactory()).create({
        descriptor: wallet.descriptor,
        changeDescriptor: wallet.changeDescriptor,
        network: wallet.network,
        // A sync the engine makes on its own (after its library recreated a
        // wallet; until the old engine's removal also the shadow's sync of the new engine) asks this
        // vault's servers as the settings choose them at that moment, the same
        // rule as `syncWallet` below: never a server the client has left, and
        // none at all before the settings were read.
        chainServers: async () =>
          (await settingsRead.current?.ready) ? chainServersFor(wallet.network, settingsRef.current) : [],
      });
      // The independent address check (decided 2026-10-15). Only QUEUED here: it runs
      // when the app is idle, one address at a time, never on the launch path.
      // Receive reads its verdict and checks the address it shows itself; a
      // build waits for it and is refused on a mismatch (guardedEngine). Not on
      // the fake engine, whose canned addresses are no vault's.
      let engine = created;
      if (!USE_FAKE_ENGINE) {
        const checked = { id: wallet.id, descriptor: wallet.descriptor, changeDescriptor: wallet.changeDescriptor, network: wallet.network };
        engine = guardedEngine(created, checked);
        void scheduleAddressCheck(checked, created).catch(() => null);
      }
      return engine;
    })();
    enginesBeingMade.current.set(wallet.id, made);
    try {
      const engine = await made;
      // Kept only while it is still the one wanted: a descriptor upgraded or a
      // vault removed meanwhile took it off the list.
      if (enginesBeingMade.current.get(wallet.id) === made) engines.current.set(wallet.id, engine);
      return engine;
    } finally {
      if (enginesBeingMade.current.get(wallet.id) === made) enginesBeingMade.current.delete(wallet.id);
    }
  }, []);

  const syncWallet = useCallback(
    async (wallet: WalletMeta, opts?: { force?: boolean }): Promise<WalletEngine> => {
      const engine = await getEngine(wallet);
      const last = lastSyncAt.current.get(wallet.id);
      if (!opts?.force && last && Date.now() - last < 60_000) {
        return engine; // fresh enough — no network round-trip
      }
      // A caller that needs a finished sync waits for the one running, or a
      // page would queue a second behind it on the one native queue (decided
      // 2026-10-30). A `force` follows something that just happened, which
      // the running sync may have missed, so it always runs its own.
      const running = syncsRunning.current.get(wallet.id);
      if (!opts?.force && running?.engine === engine) return running.done;
      const done = (async () => {
        // Not before the settings are read: until then nothing says which
        // server the client chose, and the defaults would mean the public one.
        if (!(await settingsRead.current?.ready)) throw new Error(SETTINGS_NOT_READ);
        // Through the vault's servers (./chainServers): a Bitcoin vault's one
        // server, the saved one or the default, and never another in its
        // place; a Testnet4 vault's built-in list, the next one after a
        // failure. Each attempt has its watchdog (90 s in all): big first
        // syncs are slow, but a hung server must not leave screens spinning.
        const choice = serverChoice.current;
        await syncThroughChainServers(wallet.network, settingsRef.current, (backend) => engine.sync(backend));
        // Only for the vault's engine now: a descriptor upgraded or a vault
        // removed during this sync took this one off the list, and its stamp
        // would call the next engine fresh with nothing synced (decided
        // 2026-10-30). The same for servers the client has left meanwhile.
        if (engines.current.get(wallet.id) === engine && choice === serverChoice.current) {
          lastSyncAt.current.set(wallet.id, Date.now());
        }
        // Speed up and Cancel records whose original is buried under six
        // blocks have nothing left to say (txReplacements); best effort.
        void engine
          .listTransactions()
          .then((txs) => pruneTxReplacements(wallet.id, txs, engine.getTipHeight()))
          .catch(() => {});
        // Strict-mode heir invites: the server's release date is only as fresh
        // as the owner's app makes it — refresh it on every real sync
        // (fire-and-forget; a no-op unless this vault has strict invites).
        void maybePushReleaseAt(wallet, engine);
        return engine;
      })();
      syncsRunning.current.set(wallet.id, { engine, done });
      try {
        return await done;
      } finally {
        if (syncsRunning.current.get(wallet.id)?.done === done) syncsRunning.current.delete(wallet.id);
      }
    },
    [getEngine],
  );

  // ── Virtual-vault sync (decided 2026-08-26) ────────────────────────────────────
  // The provider owns WHEN: a debounced push after every manual edit, plus a
  // pull at startup. services/virtualVaultSync owns HOW (E2E crypto + merge).
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // At most ONE sync in flight — overlapping applies were proven to insert
  // duplicate wallet rows (2026-08-26 review). A request during a run queues
  // exactly one follow-up.
  const syncInFlight = useRef(false);
  const syncQueued = useRef(false);

  const syncVirtualVaults = useCallback(async (): Promise<SyncOutcome> => {
    if (syncInFlight.current) {
      syncQueued.current = true;
      return { kind: 'skipped', reason: 'disabled' };
    }
    syncInFlight.current = true;
    try {
      let outcome = await doRunSync();
      while (syncQueued.current) {
        syncQueued.current = false;
        outcome = await doRunSync();
      }
      return outcome;
    } finally {
      syncInFlight.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doRunSync = useCallback(async (): Promise<SyncOutcome> => {
    const outcome = await runSync(
      // A portfolio shared WITH this phone stays out of the account sync: it
      // mirrors its owner's copy, and a second phone would otherwise receive
      // it as a plain, editable portfolio with no sharing marker on it
      // (decided 2026-09-14). Each phone joins the share by its own invite.
      walletsRef.current.filter((w) => w.manual && !isSharedViewer(w)),
      {
        // Applying REMOTE changes bypasses the user-facing paths on purpose:
        // no re-stamping (the remote stamp is the truth), no re-scheduling.
        createManual: async (v) => {
          if (walletsRef.current.some((w) => w.id === v.id)) {
            // Already here (an earlier apply landed it) — treat as update.
            const next = walletsRef.current.map((w) =>
              w.id === v.id && (w.manualUpdatedAt ?? 0) < v.updatedAt
                ? { ...w, label: v.label, icon: v.icon, manualUpdatedAt: v.updatedAt }
                : w,
            );
            walletsRef.current = next;
            setWallets(next);
            await saveWallets(next);
            return;
          }
          const meta: WalletMeta = {
            id: v.id,
            label: v.label,
            icon: v.icon,
            descriptor: '',
            network: 'bitcoin',
            kind: 'unknown',
            source: 'generic',
            transport: 'created',
            manual: true,
            // No category: portfolio sections are per device (the sync
            // payload carries label + icon only), and a missing category
            // reads as "Other" through portfolioCategory().
            createdAt: Date.now(),
            manualUpdatedAt: v.updatedAt,
          };
          const next = [meta, ...walletsRef.current];
          walletsRef.current = next;
          setWallets(next);
          await saveWallets(next);
        },
        updateManual: async (v) => {
          const next = walletsRef.current.map((w) =>
            // Guard against the CURRENT stamp, not a snapshot: an edit that
            // landed while this sync was on the network must not be undone.
            w.id === v.id && (w.manualUpdatedAt ?? 0) < v.updatedAt
              ? { ...w, label: v.label, icon: v.icon, manualUpdatedAt: v.updatedAt }
              : w,
          );
          walletsRef.current = next;
          setWallets(next);
          await saveWallets(next);
        },
        removeManual: async (id) => {
          void clearManualEntries(id);
          const gone = walletsRef.current.find((w) => w.id === id);
          if (gone?.sharedPortfolio) void removeShareKey(gone.sharedPortfolio.shareId);
          const next = walletsRef.current.filter((w) => w.id !== id);
          walletsRef.current = next;
          setWallets(next);
          await saveWallets(next);
        },
      },
      // The ids shared WITH this phone: dropped from the remote account
      // state too, so a copy pushed before view-only leaves the blob.
      new Set(walletsRef.current.filter((w) => isSharedViewer(w)).map((w) => w.id)),
    );

    // SHARED portfolios (decided 2026-09-12): one small loop per active share,
    // sequentially, inside the same single flight, so nothing applies over
    // the account loop. It needs a session and the share key, not account
    // sync being on: a member who never enabled account sync still syncs.
    const patchShare = async (id: string, patch: Partial<NonNullable<WalletMeta['sharedPortfolio']>>) => {
      const current = walletsRef.current.find((w) => w.id === id)?.sharedPortfolio;
      if (!current) return;
      const merged = { ...current, ...patch };
      if (JSON.stringify(merged) === JSON.stringify(current)) return;
      const next = walletsRef.current.map((w) => (w.id === id ? { ...w, sharedPortfolio: merged } : w));
      walletsRef.current = next;
      setWallets(next);
      await saveWallets(next);
    };
    for (const shared of walletsRef.current.filter((w) => w.manual && w.sharedPortfolio && !w.sharedPortfolio.ended)) {
      // Re-read: an earlier share's apply, or the account loop, may have
      // changed this wallet since the list was taken.
      const fresh = walletsRef.current.find((w) => w.id === shared.id);
      if (!fresh?.sharedPortfolio || fresh.sharedPortfolio.ended) continue;
      await runSharedSync(fresh, {
        updateMeta: async (v) => {
          // The same guard as the account loop's updateManual: never undo
          // an edit that landed while this sync was on the network.
          const next = walletsRef.current.map((w) =>
            // A member mirrors the owner's name and icon whatever its own stamp

            // says; the owner keeps the mid-sync-edit guard.

            w.id === v.id && (isSharedViewer(w) || (w.manualUpdatedAt ?? 0) < v.updatedAt)
              ? { ...w, label: v.label, icon: v.icon, manualUpdatedAt: v.updatedAt }
              : w,
          );
          walletsRef.current = next;
          setWallets(next);
          await saveWallets(next);
        },
        updateShare: patchShare,
        ended: async (id, how) => {
          await patchShare(id, { ended: how, lastError: undefined });
          // The copy is the member's own from here: a fresh stamp so it joins
          // the account sync ahead of any old tombstone under its id. Written
          // directly, the way patchShare writes, so this callback stays free
          // of hook-bound helpers.
          const now = Date.now();
          const stamped = walletsRef.current.map((w) => (w.id === id ? { ...w, manualUpdatedAt: now } : w));
          walletsRef.current = stamped;
          setWallets(stamped);
          await saveWallets(stamped);
        },
      });
    }
    return outcome;
  }, []);

  const scheduleManualSync = useCallback((): void => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    // Debounced so a burst of entries becomes one push.
    syncTimer.current = setTimeout(() => {
      syncTimer.current = null;
      void syncVirtualVaults();
    }, 4_000);
  }, [syncVirtualVaults]);

  const autoAppendLinked = useCallback(
    async (vaultId: string, txs: WalletTx[]): Promise<void> => {
      const vault = walletsRef.current.find((w) => w.id === vaultId);
      const pid = vault?.linkedPortfolioId;
      if (!vault || !pid) return;
      const portfolio = walletsRef.current.find((w) => w.id === pid);
      // Nothing feeds a portfolio this phone only reads (decided 2026-09-14).
      if (portfolio && isSharedViewer(portfolio)) return;
      if (!portfolio?.manual) {
        // The linked portfolio is gone — retire the link quietly.
        const next = walletsRef.current.map((w) =>
          w.id === vaultId ? { ...w, linkedPortfolioId: undefined } : w,
        );
        walletsRef.current = next;
        setWallets(next);
        void saveWallets(next);
        return;
      }
      try {
        const snap = portfolioEntriesFromHistory(txs);
        if (snap.length === 0) return;
        const candidate = toManualEntries(snap, {
          fiatCurrency: settingsRef.current.fiat,
          now: Date.now(),
          vaultId,
        });
        const [existing, deleted] = await Promise.all([
          loadManualEntries(pid),
          entryTombstoneIdsFor(pid),
        ]);
        const have = new Set(existing.map((e) => e.id));
        const fresh = candidate
          .filter((e) => !have.has(e.id) && !deleted.has(e.id))
          .map((e) => ({ ...e, note: `From ${vault.label}. Added automatically.` }));
        if (fresh.length === 0) return;
        await saveManualEntries(pid, [...existing, ...fresh]);
        touchManualVaultRef.current?.(pid);
        // Best-effort market estimates for the new entries, in the background.
        if (!settingsRef.current.btcOnly) {
          const bySnapIndex = new Map(candidate.map((e, i) => [e.id, snap[i]]));
          void (async () => {
            const priced = new Map<string, number>();
            for (const e of fresh) {
              const sn = bySnapIndex.get(e.id);
              if (!sn) continue;
              const point = await getHistoricalPoint(settingsRef.current.fiat, sn.tsSecs);
              if (point != null) priced.set(e.id, point.rate * (sn.amountSats / 1e8));
            }
            if (priced.size === 0) return;
            const current = await loadManualEntries(pid);
            const updated = current.map((e) => {
              const est = priced.get(e.id);
              return est != null && e.fiatAmount == null
                ? {
                    ...e,
                    fiatAmount: Math.round(est * 100) / 100,
                    fiatCurrency: settingsRef.current.fiat,
                  }
                : e;
            });
            try {
              await saveManualEntries(pid, updated);
              touchManualVaultRef.current?.(pid);
            } catch {
              // estimates are a nicety
            }
          })();
        }
      } catch {
        // Auto-append is best-effort — the next sync tries again, and the
        // deterministic ids make a retry safe.
      }
    },
    [],
  );

  // touchManualVault is declared below; the appender reaches it via a ref to
  // keep both callbacks dependency-stable.
  const touchManualVaultRef = useRef<((id: string) => void) | null>(null);

  const touchManualVault = useCallback(
    (walletId: string): void => {
      setWallets((prev) => {
        const next = prev.map((w) =>
          w.id === walletId && w.manual ? { ...w, manualUpdatedAt: Date.now() } : w,
        );
        walletsRef.current = next;
        void saveWallets(next);
        return next;
      });
      scheduleManualSync();
    },
    [scheduleManualSync],
  );
  touchManualVaultRef.current = touchManualVault;

  // Pull at startup AND whenever the app returns to the foreground — a phone
  // resident in the app switcher for days otherwise edits against stale state
  // (the exact setup of a data-loss scenario found on 2026-08-26).
  useEffect(() => {
    if (loading) return;
    const launchAt = Date.now();
    // Startup sync stays deferred past the splash; runSync itself is cheap
    // now (the KDF ran once at enablement — see crypto/vaultSync.ts for the
    // 12-second lesson).
    const timer = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => void syncVirtualVaults());
    }, 4_000);
    // Legacy enablements (password stored without the derived key) pay the
    // ~11s KDF exactly ONCE — far from boot, after interactions.
    const migrate = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        void migrateLegacyCredential().then((did) => {
          if (did) void syncVirtualVaults();
        });
        // Secrets written before every item went this-device-only.
        void upgradeNoiseConfigProtection();
      });
    }, 15_000);
    const sub = AppState.addEventListener('change', (state) => {
      // iOS fires 'active' ~2-3s into a COLD launch too — that path used to
      // run the KDF straight into the splash window. The startup timer owns
      // boot; this listener only handles real foregrounds.
      if (state === 'active' && Date.now() - launchAt > 15_000) {
        void syncVirtualVaults();
      }
    });
    return () => {
      clearTimeout(timer);
      clearTimeout(migrate);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const recordBalance = useCallback((walletId: string, totalSats: number): void => {
    setWallets((prev) => {
      const next = prev.map((w) =>
        w.id === walletId
          ? { ...w, cachedBalanceSats: totalSats, cachedBalanceAt: Date.now() }
          : w,
      );
      void saveWallets(next);
      return next;
    });
  }, []);

  // ── Timelock reminders ────────────────────────────────────────────────────
  // Rescheduled from the CURRENT block count rather than set once: a timelock
  // is measured in blocks, so its calendar date drifts as real block rate
  // wanders. Re-deriving after each sync keeps the estimate honest, and the
  // stable ids in timelockReminders.ts mean this REPLACES rather than stacks.
  const reminderSignature = useMemo(
    () =>
      wallets
        .map((w) => `${w.id}:${w.label}:${w.cachedExpiryBlocks ?? ''}`)
        .join('|'),
    [wallets],
  );

  useEffect(() => {
    if (!settings.timelockRemindersEnabled) {
      void cancelAllReminders();
      return;
    }
    void (async () => {
      // Never prompt from here — the toggle owns that (see notifications.ts).
      if (!(await hasNotificationPermission())) return;
      const now = Date.now();
      const due: TimelockReminder[] = [];
      for (const w of wallets) {
        // An heir's copy is skipped: for them the path OPENING is the point,
        // and "refresh your coins to reset the timer" is the owner's action,
        // not theirs. Heir-facing copy is a separate decision.
        if (w.heirVault) continue;
        if (w.cachedExpiryBlocks == null || w.cachedExpiryAt == null) continue;
        // Age the cached count forward at ten minutes per block, exactly as
        // WalletDetailScreen does for its banner.
        const elapsed = Math.floor((now - w.cachedExpiryAt) / 600_000);
        due.push(
          ...timelockReminders({
            walletId: w.id,
            vaultName: w.label,
            blocksLeft: w.cachedExpiryBlocks - elapsed,
            now,
          }),
        );
      }
      await syncScheduledReminders(due);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderSignature, settings.timelockRemindersEnabled]);

  const value = useMemo<WalletContextValue>(
    () => ({
      wallets,
      settings,
      loading,
      settingsLoaded,
      storeProblem,
      retryLoad,
      startOverStore,
      addWallet,
      arrangeWallets,
      removeWallet,
      updateWallet,
      getWallet,
      upgradeDescriptor,
      updateSettings,
      getEngine,
      syncWallet,
      recordBalance,
      touchManualVault,
      autoAppendLinked,
      syncVirtualVaults,
      planJustActivated,
      clearPlanActivated: () => setPlanJustActivated(false),
    }),
    [wallets, settings, loading, settingsLoaded, storeProblem, retryLoad, startOverStore, addWallet, arrangeWallets, removeWallet, updateWallet, getWallet, upgradeDescriptor, updateSettings, getEngine, syncWallet, recordBalance, touchManualVault, autoAppendLinked, syncVirtualVaults, planJustActivated],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallets(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallets must be used within a WalletProvider');
  return ctx;
}
