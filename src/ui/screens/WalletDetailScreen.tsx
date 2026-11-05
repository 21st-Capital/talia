/**
 * Wallet screen — banking-style ledger with one continuously-morphing balance.
 *
 * The navigation header is transparent and title-less; the balance is a single
 * animated element that starts large at the hero position and, as the user
 * scrolls, travels smoothly (scroll-driven, native transforms) up into the
 * header's title slot — shrinking and centering between the back button and
 * the ⋯ menu. Its value time-travels: the topmost visible transaction sets
 * "as of <day>" (running balance from wallet/history.ts).
 *
 * Sync is automatic on open and via pull-to-refresh. Wallet management
 * (rename / category / addresses / UTXOs / remove) lives in the ⋯ menu.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Animated,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  ViewToken,
} from 'react-native';
import { AppModal, NoticeBanner, cardGlow , FitText } from '../components';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { landOverTab } from '../navigation/landOverTab';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { HeaderIconButton, HEADER_BTN, HEADER_BTN_ROW, HEADER_CAPTION_ROOM, MORPH_CAPTION_SIZE, MORPH_CAPTION_MAX_SCALE, MORPH_CAPTION_TOP, ActionArrow, ChevronLeftIcon, ChevronRightIcon, AnimatedQr, BottomFade, Button, Dock, DraggableSheet, QrImage, HeaderBackButton, AppDialog, InfoHeading, TxDirectionIcon, LedgerRowContent, morphCaptionWidth, dockFollowScroll, dockSyncScroll, PageGlow, Gloss } from '../components';
import { deferFirstVaultSecurity, resumeFirstVaultSecurity } from '../components/FirstVaultSecurity';
import type { DockItem } from '../components';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { base64 as b64codec } from '@scure/base';
import { exportBase64ToFile, pickBinaryFile, shareText } from '../../platform/files';
import { BlurView } from '@react-native-community/blur';
import { getColorScheme, heroLabel, theme, themedStyles } from '../theme';
import {
  isSharedViewer,
  useWallets,
  formatSats,
  formatAmount,
  formatSignedAmount,
  buildLedger,
  getBtcPrice,
  formatFiat,
  loadTxCache,
  saveTxCache,
  saveUtxoCache,
  getHistoricalRate,
  getAllTxNotes,
  addTxNotes,
  readLabelsFile,
  notesForHistory,
  labelsImportTitle,
  isSelfTransfer,
  vaultWasImported,
  sendAccess,
  registrationWalk,
  providerKeysOf,
  isSingleSigVault,
  singleSigDevice,
  canReplaceDevice,
  getTxReplacements,
  noteWaiting,
  syncProblemNote,
} from '../../wallet';
import { txRowWords, waitingLine } from '../components/txStatusModel';
import type { TxRowWords } from '../components/txStatusModel';
import type { TxReplacement } from '../../wallet/txReplacementLogic';
import type { AmountUnit, LabelsImportOutcome, WaitingTimes, WalletMeta } from '../../wallet';
import {
  descriptorPaths,
  encryptBackup,
  serializeTaliaVaultExport,
  taliaVaultExportOf,
  getHistoricalPoint,
  loadTxCache as loadTxCacheForSnapshot,
  loadManualEntries as loadManualEntriesForSnapshot,
  portfolioEntriesFromHistory,
  saveManualEntries,
  toManualEntries,
} from '../../wallet';
import { compatibilityNote, emailDescriptorToSelf, readerAppList, readerApps, shareDescriptor, shareEncryptedBackup } from '../../services/vaultBackup';
import { encodeBbqr, utf8ToBytes } from '../../bitcoin/bbqr';
import {
  utxoExpiries,
  nearestExpiryBlocks,
  timelockNotice,
  REFRESH_SOON_BLOCKS,
} from '../../wallet';
import { DotsIcon, ClockIcon } from '../components/TablerIcons';
import { deviceName } from '../../wallet/deviceKinds';
import { deadEndShape, minOlderBlocks, parseKeyOrigins, parsePolicy, sigTypeLabel } from '../../bitcoin/descriptor';
import { NETWORK_TICKERS } from '../../bitcoin/network';
import { useRequireAuth } from '../auth/useRequireAuth';
import { loadSession } from '../../services/companyAuth';
import { copySecret } from '../../platform/clipboard';
import {
  entitledVaultCount,
  fetchMyPortfolio,
  fetchSubscriptions,
  fetchVaultAccounts,
  hasActiveSubscription,
  payerPlanEnded,
} from '../../services/billing';
import { checkVaultTested, vaultTestingQuery } from '../../services/vaultTesting';
import { OWNERS_COPY } from '../../services/vaultHolders';
import { fetchProfile } from '../../services/settingsApi';
import { fetchEstatePlanOverview, fetchFiledPlanHeirs, fetchInheritanceStatus } from '../../services/inheritance';
import { heirName, inviteNeedsPlanFirst, withFiledNames } from '../../wallet/heirNames';
import { fetchMyCosigns, isCosignRequest, loadPendingCosigns } from '../../services/cosign';
import type { LedgerSection, LedgerTx } from '../../wallet';
import type { Balance, WalletEngine, WalletTx } from '../../bitcoin/engine/types';
import { HWW_ENABLED, LEDGER_PREVIEW, PURCHASES_ENABLED, SIGNING_ENABLED } from '../../config';
import { STORE_COPY } from './storeCopy';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { useWatchWhileWaiting } from '../hooks/useWatchWhileWaiting';
import { refreshOffered } from './refreshGate';

type Props = NativeStackScreenProps<RootStackParamList, 'WalletDetail'>;

/** What the morphing balance is currently showing. */
interface ShownBalance {
  sats: number;
  /** Day label of the topmost visible transaction. */
  asOf?: string;
}

/** Scroll distance over which the hero number completes its journey. */
const MORPH_RANGE = 110;
/** Gap between the header band and the vault's name above the number:
 *  air at the top, as on the home screen (decided 2026-09-12). */
const HERO_GAP = 40;
/** Height reserved in the list header where the number visually rests:
 *  the hero figure's own line box, so the line under it sits as close as on
 *  the chart page (decided 2026-09-12). */
const NUMBER_BLOCK_H = 48;
/** The vault's name above the number (decided 2026-09-07: "so the user knows
 *  which vault he is in"), the same quiet line as Home's "Total Balance". */
const NAME_BLOCK_H = 22;
/** The buttons' own bottom padding in a page's top bar: the part of
 *  HEADER_BTN_ROW that is not the circle (HeaderIconButton names it). */
const HEADER_BAR_PAD = HEADER_BTN_ROW - HEADER_BTN;
/** Final scale of the 32pt number when docked in the title slot (~17pt). */
const END_SCALE = 0.425; // 40pt at rest, ~17pt docked
// The docked "as of" caption's size and seat come from HeaderIconButton
// (MORPH_CAPTION_SIZE, MORPH_CAPTION_TOP), shared with the portfolio page.

export function WalletDetailScreen({ navigation, route }: Props): React.JSX.Element {
  const {
    getWallet,
    getEngine,
    syncWallet,
    updateWallet,
    recordBalance,
    settings,
    updateSettings,
    wallets,
    addWallet,
    touchManualVault,
  } = useWallets();
  const wallet = getWallet(route.params.walletId);
  const unit = settings.unit;
  const { requireAuth, authModal } = useRequireAuth();
  // The vault's back button AND the swipe-back gesture must ALWAYS return to the
  // home list — never to a half-finished flow screen (a co-sign "Sent" card, the
  // signer, Send…) that an earlier navigation may have left underneath us. If the
  // screen directly below isn't the tab bar, we intercept and land on the Vaults
  // tab's list instead. When the stack is already clean we let the default happen (so the
  // normal WalletList→WalletDetail swipe stays smooth).
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      const type = e.data.action.type;
      if (type !== 'GO_BACK' && type !== 'POP') return;
      const state = navigation.getState();
      const below = state.routes[state.index - 1]?.name;
      if (below == null || below === 'Tabs') return;
      e.preventDefault();
      landOverTab('VaultsTab');
    });
    return unsub;
  }, [navigation]);
  // Self-custody: an activated 21C vault (has our keys, not locked) is the
  // client's forever — a lapsed plan NEVER locks it. It only shows a
  // disclaimer that using 21st Capital keys/services now costs a 10% penalty
  // (decided 2026-07-20). Checked live; failure = assume active (never nag wrongly).
  const [planLapsed, setPlanLapsed] = useState(false);
  // Not covered (decided 2026-07-26): the plan is active but MORE tested 21C
  // vaults exist than the plan covers — the extras get a warning, never a
  // lock. Oldest tested vaults fill the covered slots first; the joined id
  // string keeps the effect from refiring on balance-cache writes.
  const [notCovered, setNotCovered] = useState(false);
  const testedVaultIds = useMemo(() => {
    // A slot is consumed only by a vault whose OWN portfolio is tested —
    // same rule as the creation gate: portfolioId required, one slot per
    // purchase, oldest first.
    const seen = new Set<string>();
    return wallets
      .filter(
        (w) =>
          !w.locked &&
          !!w.vaultTestedAt &&
          !!w.portfolioId &&
          // A vault somebody else's plan pays for takes no slot of this
          // client's own plan (decided 2026-09-20).
          !w.heldOf &&
          (w.providerKeyFingerprints?.length ?? 0) > 0,
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .filter((w) => {
        if (seen.has(w.portfolioId!)) return false;
        seen.add(w.portfolioId!);
        return true;
      })
      .map((w) => w.id)
      .join(',');
  }, [wallets]);
  useEffect(() => {
    // OWNER-ONLY (decided 2026-07-27): an heir has no subscription of their own —
    // the plan sits under the owner's account — so "your plan has lapsed" and
    // "not covered" are both FALSE statements on an inherited vault.
    const uses21C =
      (wallet?.providerKeyFingerprints?.length ?? 0) > 0 &&
      !wallet?.locked &&
      !wallet?.heirVault;
    if (!uses21C) {
      setPlanLapsed(false);
      setNotCovered(false);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        const [subs, portfolio, profile] = await Promise.all([
          fetchSubscriptions(session),
          fetchMyPortfolio(session).catch(() => null),
          fetchProfile(session).catch(() => null),
        ]);
        if (!live) return;
        // A Lifetime Elite member has no subscription row and no lapse:
        // never the "plan has lapsed" note for them (decided 2026-09-04).
        const lifetime = profile?.lifetimeElite === true;
        if (wallet!.heldOf) {
          // Somebody else's plan pays for this vault (decided 2026-09-20): THAT
          // plan decides the note, never this client's own cheaper plan, and
          // the vault is no "extra" of a plan it does not belong to.
          setPlanLapsed(!lifetime && payerPlanEnded(subs, wallet!.heldOf));
          setNotCovered(false);
          return;
        }
        const active = hasActiveSubscription(subs) || lifetime;
        setPlanLapsed(!active);
        if (active) {
          const limit = entitledVaultCount(subs, portfolio, new Date(), lifetime);
          const pos = testedVaultIds.split(',').indexOf(wallet!.id);
          setNotCovered(limit > 0 && pos >= limit);
        } else {
          setNotCovered(false); // the lapsed banner already covers it
        }
      } catch {
        // network/best-effort — never show the penalty note on uncertainty
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.id, wallet?.locked, wallet?.heldOf, wallet?.providerKeyFingerprints, testedVaultIds]);
  // Vault testing (decided 2026-07-21): a STAFF member marks the vault tested on
  // the backend, after the setup meeting the client books in the
  // configurator. There is no booking banner here any more (decided 2026-09-21:
  // "the only thing we need to remove is the meeting banner"); the tested
  // state still drives Verify external keys and the Receive warning. It is
  // cached on the wallet but re-asked on every open (decided 2026-09-07): staff
  // can set a vault BACK to not tested, and the cache used to make that
  // invisible here for good. Which vault to ask about, including an
  // IMPORTED one that remembers no number (decided 2026-09-28), is
  // vaultTestingQuery's decision.
  useEffect(() => {
    if (!wallet || !vaultTestingQuery(wallet)) return;
    let live = true;
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        const patch = await checkVaultTested(session, wallet);
        if (live && patch) void updateWallet(wallet.id, patch);
      } catch {
        // best-effort — nothing changes on uncertainty
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.id, wallet?.locked, wallet?.vaultTestedAt, wallet?.portfolioId, wallet?.vaultNumber, wallet?.accountNumber, wallet?.providerKeyFingerprints, wallet?.descriptor]);
  // The vault's 21st Capital account number, cached once so an account
  // statement can print it offline (decided 2026-08-28). Only a vault holding a
  // 21C key has one, the backend only issues it once the vault is tested,
  // and it never changes afterwards — so this asks once and stops.
  useEffect(() => {
    const uses21C = (wallet?.providerKeyFingerprints?.length ?? 0) > 0 && !wallet?.heirVault;
    if (!uses21C || !wallet?.portfolioId || wallet.accountNumber != null) return;
    let live = true;
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        const accounts = await fetchVaultAccounts(session);
        if (!live) return;
        // A portfolio can hold more than one vault, and the app cannot tell
        // which of them this wallet is. One match is this vault's number;
        // several is an ambiguity, and printing a neighbouring vault's
        // account number on a statement would be worse than printing none.
        const mine = accounts.filter((a) => a.portfolioId === wallet.portfolioId);
        if (mine.length === 1 && mine[0].account != null) {
          void updateWallet(wallet.id, { accountNumber: mine[0].account });
        }
      } catch {
        // best-effort: a statement simply leaves the line out until we know.
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.id, wallet?.portfolioId, wallet?.accountNumber, wallet?.providerKeyFingerprints]);

  // Inheritance prompt (decided 2026-07-21): the NEXT step after testing. Shows in
  // the same banner slot, but only once the vault is TESTED (testing banner
  // gone) and the client hasn't submitted a protocol yet. Skippable — it
  // simply stays until they do. Server status is the truth; the settings
  // timestamp is the instant local cache.
  const [inheritancePrompt, setInheritancePrompt] = useState(false);
  /** Per-vault progress for the banner copy: null until some plan exists. */
  const [planProgress, setPlanProgress] = useState<{ covered: number; total: number } | null>(
    null,
  );
  // A 21C co-signature request in progress for this vault (decided 2026-07-22) →
  // banner to the Pending co-signatures screen; refresh when the screen focuses.
  const [pendingCosign, setPendingCosign] = useState<null | 'waiting' | 'ready' | 'rejected'>(null);
  const checkCosignRef = useRef<null | (() => Promise<void>)>(null);
  useEffect(() => {
    let live = true;
    /**
     * The banner tracks the SPEND, not the request (decided 2026-08-27: it used
     * to vanish the moment 21C signed — exactly when the client's own action
     * is needed — and read as "money sent" when nothing had been broadcast).
     * Two states now: 'waiting' (submitted, 21C hasn't signed) and 'ready'
     * (co-signed, the client still has to press Send). It clears only when
     * the records do — at broadcast or cancel. Half-signed spends parked on
     * the client's own next key still never raise it (decided 2026-07-28).
     */
    const check = async () => {
      const mine = (await loadPendingCosigns()).filter(
        (x) => x.walletId === route.params.walletId && isCosignRequest(x),
      );
      if (mine.length === 0) {
        if (live) setPendingCosign(null);
        return;
      }
      try {
        const session = await loadSession();
        if (!session) {
          if (live) setPendingCosign(null);
          return;
        }
        const byId = new Map((await fetchMyCosigns(session)).map((r) => [r.id, r]));
        const rows = mine.map((p) => ({ p, status: byId.get(p.id)?.status }));
        // A single request is ready when signed. A refresh-session batch is
        // ready only when EVERY transaction of it is — its one Send button
        // waits for the full set.
        const singlesReady = rows.some((r) => !r.p.batchId && r.status === 'signed');
        const batchTally = new Map<string, { signed: number; total: number }>();
        for (const r of rows) {
          if (!r.p.batchId) continue;
          const b = batchTally.get(r.p.batchId) ?? { signed: 0, total: 0 };
          b.total += 1;
          if (r.status === 'signed') b.signed += 1;
          batchTally.set(r.p.batchId, b);
        }
        const batchReady = [...batchTally.values()].some((b) => b.total > 0 && b.signed === b.total);
        const waiting = rows.some((r) => r.status === 'pending');
        // A rejection outranks a still-waiting sibling: it is the one state
        // the client has to act on, and it is the answer they were owed
        // (decided 2026-08-29).
        const rejected = rows.some((r) => r.status === 'rejected');
        if (live) {
          setPendingCosign(
            singlesReady || batchReady
              ? 'ready'
              : rejected
                ? 'rejected'
                : waiting
                  ? 'waiting'
                  : null,
          );
        }
      } catch {
        // Server unreachable: trust the local record rather than flapping.
        if (live) setPendingCosign('waiting');
      }
    };
    const unsub = navigation.addListener('focus', () => void check());
    void check();
    checkCosignRef.current = check;
    return () => {
      live = false;
      checkCosignRef.current = null;
      unsub();
    };
  }, [navigation, route.params.walletId]);
  // While a request is out with 21st Capital, keep looking for the signature
  // so the banner turns into "Finish sending" without the client leaving the
  // screen (decided 2026-08-28).
  useWatchWhileWaiting(
    pendingCosign === 'waiting',
    useCallback(() => void checkCosignRef.current?.(), []),
    navigation,
  );
  useEffect(() => {
    const uses21C =
      (wallet?.providerKeyFingerprints?.length ?? 0) > 0 &&
      !wallet?.locked &&
      !wallet?.heirVault; // the Estate Plan is the OWNER's document
    if (!uses21C || !wallet?.vaultTestedAt) {
      setInheritancePrompt(false);
      return;
    }
    // ONE plan is only "done" for a one-vault client. With several vaults the
    // client files one plan per vault (decided 2026-09-01), so the offline stamp
    // may only short-circuit when there is nothing else to cover; otherwise
    // the per-vault overview decides.
    const eligibleLocal = wallets.filter(
      (w) => (w.providerKeyFingerprints?.length ?? 0) > 0 && !w.locked && !w.heirVault,
    ).length;
    if (settings.inheritanceSubmittedAt && eligibleLocal <= 1) {
      setInheritancePrompt(false);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        // Per-vault truth first: the same overview the website dashboard
        // reads. A tested vault without a plan keeps the invitation alive,
        // however many plans exist already.
        try {
          const ov = await fetchEstatePlanOverview(session);
          if (!live) return;
          if (ov.activeVaults > 0) {
            if (ov.hasOutstanding) {
              setPlanProgress(
                ov.coveredVaults > 0
                  ? { covered: ov.coveredVaults, total: ov.activeVaults }
                  : null,
              );
              setInheritancePrompt(true);
            } else {
              void updateSettings({ inheritanceSubmittedAt: Date.now() });
            }
            return;
          }
          // The account has no tested mainnet vault (e.g. a test-family
          // vault): the overview cannot speak for this one — global check.
        } catch {
          // overview unreachable — fall back to the coarse global check
        }
        if (settings.inheritanceSubmittedAt) return;
        const status = await fetchInheritanceStatus(session);
        if (!live) return;
        if (status.hasAny) {
          void updateSettings({ inheritanceSubmittedAt: Date.now() });
        } else {
          setInheritancePrompt(true);
        }
      } catch {
        // best-effort — no prompt on uncertainty
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.id, wallet?.locked, wallet?.vaultTestedAt, settings.inheritanceSubmittedAt]);
  const masked = settings.hideBalances || !!wallet?.balanceHidden;

  const toggleWalletHidden = useCallback(async () => {
    if (!wallet) return;
    if (wallet.balanceHidden && settings.requireAuthToUnhide) {
      if (!(await requireAuth('Show this balance'))) return;
    }
    void updateWallet(wallet.id, { balanceHidden: !wallet.balanceHidden });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, settings.requireAuthToUnhide, requireAuth]);

  const { width: screenW } = useWindowDimensions();
  // The docked "as of" caption keeps a width of its own, never the
  // number's (decided 2026-09-07: the number's width folded it into three tiny
  // lines): all the room between the header buttons, in the block's unscaled
  // points, so a larger text size still fits the day (decided 2026-10-22).
  const captionW = morphCaptionWidth(screenW, theme.spacing.lg + HEADER_BTN + theme.spacing.sm, END_SCALE);
  const insets = useSafeAreaInsets();

  const [balance, setBalance] = useState<Balance | null>(null);
  const [sections, setSections] = useState<LedgerSection[]>([]);
  const [syncing, setSyncing] = useState(false);
  /** Speed up and Cancel records: the list names a return and a replaced
   *  payment as their own pages do (decided 2026-09-28). */
  const [replacements, setReplacements] = useState<TxReplacement[]>([]);
  // The last sync's failure, as thrown: `syncProblemNote` decides what the page says about it.
  const [syncError, setSyncError] = useState<unknown>(null);
  const [shown, setShown] = useState<ShownBalance | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** 21C's keys from BOTH sources — an imported vault has no tag, and
   *  without the live set a 21C key would count as the owner's own when
   *  deciding whether this vault can sign from the phone. */
  const { providerFps: known21C, settled: known21CSettled } = useProviderFingerprints(wallet);
  /** The 21st Capital keys in this vault by the LIVE set: an imported vault
   *  carries no tag, and the key check (decided 2026-09-07) is for those too. */
  const ourKeys = useMemo(
    () => (wallet && !wallet.manual ? providerKeysOf(wallet.descriptor, known21C) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallet?.descriptor, wallet?.manual, known21C],
  );
  /** Signed in to 21st Capital? The key check needs an account behind it,
   *  so the menu entry only shows with one. Re-checked on every focus, which
   *  is how a sign-in on the Settings tab reaches this screen. */
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    let live = true;
    const check = () => {
      void loadSession().then((s) => {
        if (live) setHasSession(!!s);
      });
    };
    check();
    const unsub = navigation.addListener('focus', check);
    return () => {
      live = false;
      unsub();
    };
  }, [navigation]);
  /** Fresh multi-key vault: offer registration RIGHT AWAY, skippable — the
   *  banner stays as the fallback for "Later" (decided 2026-08-26). ONE chooser
   *  listing every hardware device by its key's name tag; the owner picks
   *  the order. After each ceremony the same list returns with the finished
   *  device carrying a green tick, until every device is registered or he
   *  says Later (decided 2026-08-31). */
  const [regWalkOpen, setRegWalkOpen] = useState(false);
  /** Send on an IMPORTED vault nobody has vouched for (decided 2026-09-07): the
   *  button shows, and the tap asks "register now, or already done?". */
  /** Every device has seen the vault: say so, rather than landing the
   *  client back on the vault with no word (decided 2026-09-02). */
  const [regDoneOpen, setRegDoneOpen] = useState(false);
  /** The backup-format chooser inside the walk (plain text vs the encrypted
   *  .bed file, the same one the export menu saves). */
  const [backupChooserOpen, setBackupChooserOpen] = useState(false);
  /** Who opened the chooser: the walk continues afterwards (tick, next step
   *  or the success dialog); the export menu just returns to the vault. */
  const [backupChooserSource, setBackupChooserSource] = useState<'walk' | 'export'>('walk');
  /** "Save to Files / Share" asks which form first (decided 2026-09-02). */
  const [shareChooserOpen, setShareChooserOpen] = useState(false);
  const backupDone = (w: WalletMeta | undefined) => !!w?.descriptorBackupEmailedAt;
  /** A failure inside the chooser, shown IN the chooser rather than behind
   *  the reopened walk (decided 2026-09-02). */
  const [backupError, setBackupError] = useState<string | null>(null);
  /** Liana only opens layered (timelocked) vaults; offering its file for a
   *  plain multisig promised a restore path that does not exist. */
  const lianaCanOpen = !!wallet && readerAppList(wallet.kind, wallet.descriptor).includes('Liana');
  /**
   * After a backup lands: if every device is registered too, the walk is
   * finished and says so; otherwise it reopens with the new tick. Done here
   * because no focus event follows a mail composer (decided 2026-09-02: the
   * success dialog never fired when the backup was the last step). The
   * short delay lets the composer finish dismissing first, the same 450 ms
   * this screen already gives the menu, so the next dialog is not swallowed.
   */
  const afterBackup = (w: WalletMeta, source: 'walk' | 'export') => {
    const next = { ...w, descriptorBackupEmailedAt: Date.now() };
    void updateWallet(w.id, { descriptorBackupEmailedAt: next.descriptorBackupEmailedAt });
    // From the export menu the backup is simply done; the walk is not open.
    if (source !== 'walk') return;
    const items = regChecklist(w);
    const complete = items.every((i) => i.registered);
    setTimeout(() => {
      if (complete) {
        regWalkArmedRef.current = false;
        setRegDoneOpen(true);
      } else {
        setRegWalkOpen(true);
      }
    }, 450);
  };
  /** The walk survives navigating into a ceremony: while armed, regaining
   *  focus re-opens the list (or ends the walk when all devices are done). */
  const regWalkArmedRef = useRef(false);
  /** An imported vault has its backup wherever it came from (decided 2026-09-07):
   *  the walk drops the Email backup row and finishes on the devices alone. */
  const imported = !!wallet && vaultWasImported(wallet);
  /** The owner of an imported vault vouching that their devices already
   *  know it: Send opens, the registration card goes. A Ledger with no
   *  record here still asks to see the vault once when it signs. */
  const attestRegistered = useCallback(() => {
    if (!wallet) return;
    void updateWallet(wallet.id, { registrationAttestedAt: Date.now() });
  }, [wallet, updateWallet]);
  /** Devices this vault could register on. Every adopted device takes the
   *  same vault shapes (the BitBox shares the Ledger's translator), so a
   *  shape no device can register lists nothing, whatever the brand. */
  const regChecklist = useCallback((w: WalletMeta) => registrationWalk(w, known21C), [known21C]);
  /** "Connect to hardware" (decided 2026-09-08): a vault whose key is on no
   *  known device. Asked once after an import, and always in the menu. The
   *  shared screen (RegisterHardware) asks how the device connects and
   *  finds it, whatever its brand; watch only leaves Send dimmed. */
  const [hardwareChooserOpen, setHardwareChooserOpen] = useState(false);
  const singleSigUnbound =
    !!wallet && !SIGNING_ENABLED && LEDGER_PREVIEW && HWW_ENABLED && isSingleSigVault(wallet) && !singleSigDevice(wallet);
  /** The hardware step is under way (a device screen or the Passport scan):
   *  the first-vault Face ID prompt waits until this screen has focus again
   *  or the scan is done, instead of landing on top of the question. */
  const hardwareFlowRef = useRef(false);
  useEffect(() => {
    if (!route.params.askHardware || !wallet) return;
    navigation.setParams({ askHardware: undefined });
    if (!singleSigUnbound) return;
    deferFirstVaultSecurity();
    hardwareFlowRef.current = true;
    setTimeout(() => setHardwareChooserOpen(true), 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.askHardware]);
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        // Back from the Ledger or BitBox screen: the hardware step is over.
        if (hardwareFlowRef.current && !hardwareChooserOpen) {
          hardwareFlowRef.current = false;
          resumeFirstVaultSecurity();
        }
      }),
    [navigation, hardwareChooserOpen],
  );
  useEffect(() => {
    if (!route.params.promptHardwareRegistration || !wallet) return;
    // One-shot: consume the param so back-navigation never re-asks.
    navigation.setParams({ promptHardwareRegistration: undefined });
    // The "Vault built" page hands its held Face ID offer over to this walk
    // (it defers the offer while it plays); with no walk to run, hand it
    // straight back, or the offer would wait for a resume that never comes.
    if (!(!SIGNING_ENABLED && LEDGER_PREVIEW) || regChecklist(wallet).length === 0) {
      resumeFirstVaultSecurity();
      return;
    }
    regWalkArmedRef.current = true;
    // The first-vault Face ID prompt waits until the walk is over (decided
    // 2026-09-08: "after a multisig is registered on all HWWs"): every
    // device done, or Later.
    deferFirstVaultSecurity();
    setRegWalkOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.promptHardwareRegistration]);
  const walletForFocusRef = useRef(wallet);
  walletForFocusRef.current = wallet;
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (!regWalkArmedRef.current) return;
        const w = walletForFocusRef.current;
        const items = w ? regChecklist(w) : [];
        if (items.length === 0 || (items.every((i) => i.registered) && (backupDone(w) || (w != null && vaultWasImported(w))))) {
          regWalkArmedRef.current = false;
          // Every device done AND the backup emailed. The walk used to end
          // in silence on the vault, which read as "did that work?" (decided
          // 2026-09-02). Close it with a clear word, but only when there was
          // a walk to close.
          if (items.length > 0) setRegDoneOpen(true);
          return;
        }
        setRegWalkOpen(true);
      }),
    [navigation, regChecklist],
  );
  // Two submenus keep the main sheet short (decided 2026-08-28): everything that
  // ACTS on the coins under Tools, everything that leaves the app under
  // Export. Rename + category moved to the Arrange screen, beside delete.
  const [menuMode, setMenuMode] = useState<'main' | 'tools' | 'export' | 'icon'>('main');
  const [fiatRate, setFiatRate] = useState<number | null>(null);
  const [histFiat, setHistFiat] = useState<Record<string, string>>({});
  const [txNotes, setTxNotes] = useState<Record<string, string>>({});
  const [numberWidth, setNumberWidth] = useState(0);
  // Liana timelock countdown (null = not a timelocked descriptor / not yet
  // known). Seeded INSTANTLY from the persisted cache — blocks age at ~1 per
  // 10 minutes — so the clock never waits on the network; the live sync
  // refines it moments later.
  const [nearestBlocks, setNearestBlocks] = useState<number | null>(() => {
    if (!wallet || wallet.cachedExpiryBlocks == null || wallet.cachedExpiryAt == null) {
      return null;
    }
    const elapsed = Math.floor((Date.now() - wallet.cachedExpiryAt) / 600_000);
    return wallet.cachedExpiryBlocks - elapsed;
  });
  const olderBlocks = useMemo(
    () => (wallet ? minOlderBlocks(wallet.descriptor) : null),
    [wallet],
  );

  useEffect(() => {
    const walletId = route.params.walletId;
    const load = () => void getAllTxNotes(walletId).then(setTxNotes);
    load();
    return navigation.addListener('focus', load);
  }, [navigation, route.params.walletId]);

  const scrollY = useRef(new Animated.Value(0)).current;
  const lastScrollY = useRef(0);
  // The dock's names fold once the history scrolls and return at the top;
  // coming back to this screen restates its resting position (ui/components/dockState).
  useEffect(() => {
    dockSyncScroll(lastScrollY.current);
    return navigation.addListener('focus', () => dockSyncScroll(lastScrollY.current));
  }, [navigation]);
  const [pulled, setPulled] = useState(false);

  /**
   * The recovery-path countdown after a sync: the soonest opening across the
   * coins, persisted for the next open and for the home banner, which reads
   * only this cache (decided 2026-09-22: a pull-down used to leave it stale,
   * so both kept saying a path was open after the coins were refreshed).
   */
  const updateCountdown = useCallback(
    async (engine: WalletEngine, history: WalletTx[]) => {
      if (!wallet || olderBlocks == null) return;
      try {
        const utxos = await engine.listUtxos();
        void saveUtxoCache(wallet.id, utxos, engine.getTipHeight());
        const nearest = nearestExpiryBlocks(
          utxoExpiries(utxos, history, engine.getTipHeight(), olderBlocks),
          olderBlocks,
        );
        setNearestBlocks(nearest);
        void updateWallet(wallet.id, {
          cachedExpiryBlocks: nearest ?? undefined,
          cachedExpiryAt: nearest != null ? Date.now() : undefined,
        });
      } catch {
        // banner just stays as it was
      }
    },
    [wallet, olderBlocks, updateWallet],
  );

  const sync = useCallback(async () => {
    if (!wallet) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const engine = await syncWallet(wallet);
      const [bal, history] = await Promise.all([
        engine.getBalance(),
        engine.listTransactions(),
      ]);
      setBalance(bal);
      setSections(buildLedger(history, bal).sections);
      recordBalance(wallet.id, bal.total);
      setShown({ sats: bal.total });
      void saveTxCache(wallet.id, history);
      void getTxReplacements(wallet.id).then(setReplacements, () => {});
      // Liana timelock countdown: soonest recovery-path opening across coins.
      await updateCountdown(engine, history);
    } catch (e) {
      setSyncError(e);
    } finally {
      setSyncing(false);
    }
  }, [wallet, syncWallet, recordBalance, updateCountdown]);

  // Fiat rate follows the currency setting (fixes stale-rate bug) + 45s ticker.
  useEffect(() => {
    setFiatRate(null);
    if (wallet?.network !== 'bitcoin' || settings.btcOnly) return;
    let cancelled = false;
    const tick = () => getBtcPrice(settings.fiat).then((r) => !cancelled && setFiatRate(r));
    tick();
    const iv = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.fiat, wallet?.network, settings.btcOnly]);

  useEffect(() => {
    (async () => {
      // Instant-first: paint the last known ledger before any network work.
      if (wallet && wallet.cachedBalanceSats != null) {
        const cached = await loadTxCache(wallet.id);
        if (cached && cached.length > 0) {
          const total = wallet.cachedBalanceSats;
          const pseudo: Balance = {
            confirmed: total,
            trustedPending: 0,
            untrustedPending: 0,
            spendable: total,
            total,
          };
          // Only adopt the cache if the live sync hasn't already landed.
          setBalance((prev) => prev ?? pseudo);
          setSections((prev) => (prev.length ? prev : buildLedger(cached, pseudo).sections));
          setShown((prev) => prev ?? { sats: total });
        }
      }
    })();
    // Let the navigation transition and first paint land before any engine
    // work — the cached ledger is already on screen.
    const task = InteractionManager.runAfterInteractions(() => sync());
    return () => task.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPull = useCallback(async () => {
    setPulled(true);
    try {
      await syncWallet(wallet!, { force: true }).then(async (engine) => {
        const [bal, history] = await Promise.all([engine.getBalance(), engine.listTransactions()]);
        setBalance(bal);
        setSections(buildLedger(history, bal).sections);
        recordBalance(wallet!.id, bal.total);
        void saveTxCache(wallet!.id, history);
        void getTxReplacements(wallet!.id).then(setReplacements, () => {});
        await updateCountdown(engine, history);
      });
      // A pull that worked clears the failure an earlier sync left on the page.
      setSyncError(null);
    } catch (e) {
      setSyncError(e);
    } finally {
      setPulled(false);
    }
  }, [syncWallet, wallet, recordBalance, updateCountdown]);

  // Coming back to the vault: read the engine's own copy again, with no
  // network call. A page above may have synced the vault meanwhile (a
  // return's page does, decided 2026-09-28), and the list must not go on
  // showing a payment that sync replaced. A cold engine has nothing to say
  // yet, and a sync in flight paints its own result.
  const busyRef = useRef(false);
  busyRef.current = syncing || pulled;
  useEffect(() => {
    if (!wallet || wallet.manual) return;
    return navigation.addListener('focus', () => {
      void (async () => {
        try {
          const list = await getTxReplacements(wallet.id);
          setReplacements(list);
          if (busyRef.current) return;
          const engine = await getEngine(wallet);
          if (engine.getTipHeight() == null) return;
          const [bal, history] = await Promise.all([engine.getBalance(), engine.listTransactions()]);
          if (busyRef.current) return;
          setBalance(bal);
          setSections(buildLedger(history, bal).sections);
          recordBalance(wallet.id, bal.total);
          void saveTxCache(wallet.id, history);
        } catch {
          // the list stays as it was
        }
      })();
    });
  }, [navigation, wallet, getEngine, recordBalance]);

  /** The list's words for the transactions Talia's records know. */
  const rowWords = useMemo(() => {
    const out: Record<string, TxRowWords> = {};
    if (!wallet || replacements.length === 0) return out;
    const txs = sections.flatMap((sec) => sec.data);
    for (const t of txs) {
      const w = txRowWords(replacements, wallet.id, t.txid, txs);
      if (w.isReturn || w.replacedAs) out[t.txid] = w;
    }
    return out;
  }, [replacements, sections, wallet]);
  // When each waiting payment began to wait, as far as this phone knows
  // (decided 2026-10-29): its send stamp, or the first time this list
  // showed it waiting, which is stamped here.
  const [waitingTimes, setWaitingTimes] = useState<Record<string, WaitingTimes>>({});
  const pendingKey = useMemo(
    () =>
      sections
        .flatMap((sec) => sec.data)
        .filter((t) => !t.confirmed)
        .map((t) => t.txid)
        .join(','),
    [sections],
  );
  const walletId = wallet?.id;
  useEffect(() => {
    if (!walletId || !pendingKey) {
      setWaitingTimes({});
      return;
    }
    let alive = true;
    void noteWaiting(walletId, pendingKey.split(',')).then((times) => alive && setWaitingTimes(times));
    return () => {
      alive = false;
    };
  }, [walletId, pendingKey]);
  const listExtra = useMemo(() => ({ masked, rowWords, waitingTimes }), [masked, rowWords, waitingTimes]);

  // Time-travel: the topmost visible transaction dates the balance. There is
  // no "current" state — every running balance belongs to a moment in history.
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const firstTx = viewableItems.find(
        (v) => v.item && typeof (v.item as LedgerTx).balanceAfter === 'number',
      );
      if (!firstTx) return;
      const tx = firstTx.item as LedgerTx;
      setShown((prev) => {
        const next: ShownBalance = { sats: tx.balanceAfter, asOf: dayLabelFor(tx) };
        return prev?.sats === next.sats && prev?.asOf === next.asOf ? prev : next;
      });
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;

  // Item value at the time it happened — fiat under each row. Rates are
  // permanently cached per day; fetches trickle in the background and rows
  // fill in as they land. Mainnet only (test coins have no price).
  useEffect(() => {
    if (settings.btcOnly) {
      setHistFiat((prev) => (Object.keys(prev).length > 0 ? {} : prev));
      return;
    }
    if (!wallet || wallet.network !== 'bitcoin' || sections.length === 0) return;
    let cancelled = false;
    (async () => {
      const txs = sections
        .flatMap((sec) => sec.data)
        .filter((t) => t.confirmed && t.timestamp)
        .slice(0, 80);
      const found: Record<string, string> = {};
      let batch = 0;
      for (const t of txs) {
        if (cancelled) return;
        const rate = await getHistoricalRate(settings.fiat, t.timestamp!);
        if (rate != null) {
          found[t.txid] = formatFiat(t.netAmount, rate, settings.fiat);
          batch++;
          if (batch % 6 === 0) setHistFiat((prev) => ({ ...prev, ...found }));
        }
      }
      if (!cancelled) setHistFiat((prev) => ({ ...prev, ...found }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, settings.fiat, wallet?.network, settings.btcOnly]);

  const openMenu = useCallback(() => {
    setMenuMode('main');
    setMenuOpen(true);
  }, []);

  /** Snapshot this vault into a portfolio: real deposits → buys, real
   *  withdrawals → sells, refreshes skipped, prices prefilled with
   *  clearly-noted market estimates. The vault is untouched.
   *  `targetId` = an EXISTING portfolio to add into (decided 2026-08-26: "let
   *  him choose"); null = create a new one. Snapshot entry ids are
   *  deterministic per (vault, transaction), so adding the same vault twice
   *  merges instead of duplicating, and the owner's price edits survive. */
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [portfolioChooser, setPortfolioChooser] = useState(false);
  /** After a successful add: offer to LINK the vault so future activity
   *  flows in automatically (optional, decided 2026-08-26). */
  const [linkPrompt, setLinkPrompt] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  /** The labels file's answer, the dialog's whole text (decided 2026-11-05). */
  const [labelsResult, setLabelsResult] = useState<string | null>(null);
  /** Liana's labels file, or its wallet backup of THIS vault, adds notes to
   *  the transactions that have none (wallet/labelsImport.ts holds the rule). */
  const importLabelsFile = useCallback(async (): Promise<void> => {
    if (!wallet) return;
    let outcome: LabelsImportOutcome;
    try {
      const file = await pickBinaryFile();
      if (!file) return;
      const content = new TextDecoder().decode(b64codec.decode(file.base64.replace(/\s+/g, '')));
      const reading = readLabelsFile(content, wallet);
      if (reading.kind !== 'notes') {
        outcome = reading;
      } else {
        const history = await loadTxCache(wallet.id);
        const mine = notesForHistory(reading.notes, history?.map((t) => t.txid) ?? null);
        if (!history) outcome = { kind: 'historyNotRead' };
        else if (Object.keys(mine).length === 0) outcome = { kind: 'noMatch' };
        else {
          const added = await addTxNotes(wallet.id, mine);
          outcome = added > 0 ? { kind: 'added', count: added } : { kind: 'nothingNew' };
          if (added > 0) setTxNotes(await getAllTxNotes(wallet.id));
        }
      }
    } catch {
      outcome = { kind: 'none' };
    }
    setLabelsResult(labelsImportTitle(outcome));
  }, [wallet]);
  const createPortfolioSnapshot = useCallback(async (targetId: string | null): Promise<void> => {
    if (!wallet || snapshotBusy) return;
    setSnapshotBusy(true);
    try {
      const txs = (await loadTxCacheForSnapshot(wallet.id)) ?? [];
      if (txs.length >= 300) {
        // The tx cache caps at 300 — a longer history would make a snapshot
        // that silently disagrees with the vault's balance. Refuse honestly.
        setSnapshotError(
          'This vault has more history than a snapshot can cover accurately. Create a portfolio by hand instead.',
        );
        return;
      }
      const snap = portfolioEntriesFromHistory(txs);
      if (snap.length === 0) {
        setSnapshotError(
          'Talia has no history for this vault yet. Open it once with a working connection, then try again.',
        );
        return;
      }
      // Create + navigate IMMEDIATELY with unpriced entries — the market
      // estimates need one network lookup per distinct day, and seconds of
      // silence after the tap reads as "nothing happens" (decided 2026-08-26).
      const entries = toManualEntries(snap, {
        fiatCurrency: settings.fiat,
        now: Date.now(),
        vaultId: wallet.id,
      });
      let portfolioId: string;
      if (targetId != null) {
        // Add into the chosen portfolio: only entries this vault hasn't
        // contributed before (deterministic ids make this exact).
        const existing = await loadManualEntriesForSnapshot(targetId);
        const have = new Set(existing.map((e) => e.id));
        const fresh = entries.filter((e) => !have.has(e.id));
        if (fresh.length === 0) {
          setSnapshotError(
            'Everything from this vault is already in that portfolio. Nothing new to add.',
          );
          return;
        }
        await saveManualEntries(targetId, [...existing, ...fresh]);
        touchManualVault(targetId);
        portfolioId = targetId;
      } else {
        const portfolio = await addWallet({
          label: `${wallet.label} portfolio`,
          descriptor: '',
          network: 'bitcoin',
          kind: 'unknown',
          source: 'generic',
          transport: 'created',
          manual: true,
          icon: wallet.icon,
        });
        await saveManualEntries(portfolio.id, entries);
        touchManualVault(portfolio.id);
        portfolioId = portfolio.id;
      }
      if (wallet.linkedPortfolioId == null) {
        // Offer the link BEFORE leaving — optional by design.
        setLinkPrompt(portfolioId);
      } else {
        // The portfolio opens with the Portfolios tab beneath it, so Back
        // ends on the portfolio list, as it did when this jumped tabs.
        landOverTab('VirtualTab', [{ name: 'ManualWallet', params: { walletId: portfolioId } }]);
      }
      // Estimates land in the background; the vault screen reloads on focus,
      // so they appear when ready. Entries the owner has already edited are
      // left alone (matched by id — nothing else touches these yet).
      if (!settings.btcOnly) {
        void (async () => {
          const priced = new Map<string, number>();
          for (let i = 0; i < snap.length; i++) {
            const point = await getHistoricalPoint(settings.fiat, snap[i].tsSecs);
            if (point != null) priced.set(entries[i].id, point.rate * (snap[i].amountSats / 1e8));
          }
          if (priced.size === 0) return;
          const current = await loadManualEntriesForSnapshot(portfolioId);
          const updated = current.map((e) => {
            const est = priced.get(e.id);
            return est != null && e.fiatAmount == null
              ? { ...e, fiatAmount: Math.round(est * 100) / 100, fiatCurrency: settings.fiat }
              : e;
          });
          try {
            await saveManualEntries(portfolioId, updated);
            touchManualVault(portfolioId);
          } catch {
            // estimates are a nicety — the portfolio stands without them
          }
        })();
      }
    } catch {
      setSnapshotError('Could not create the portfolio. Please try again.');
    } finally {
      setSnapshotBusy(false);
    }
  }, [wallet, snapshotBusy, settings.btcOnly, settings.fiat, addWallet, touchManualVault]);
  // (wallets is intentionally not a dep of the menu callback — the chooser
  // reads it at render time.)

  const onMenuAction = useCallback(
    (action: string) => {
      if (!wallet) return;
      switch (action) {
        case 'back':
          setMenuMode('main');
          break;
        case 'tools':
          setMenuMode('tools'); // second level, same sheet
          break;
        case 'exportMenu':
          setMenuMode('export');
          break;
        case 'verify':
          setMenuOpen(false);
          navigation.navigate('Scan', { walletId: wallet.id });
          break;
        case 'policy':
          setMenuOpen(false);
          navigation.navigate('Policy', { walletId: wallet.id });
          break;
        case 'limits':
          setMenuOpen(false);
          navigation.navigate('CosignLimits', { walletId: wallet.id });
          break;
        case 'addresses':
          setMenuOpen(false);
          navigation.navigate('Addresses', { walletId: wallet.id });
          break;
        case 'utxos':
        // A refresh IS the coin list — same screen, named the way owners
        // look for it (decided 2026-08-28).
        case 'refresh':
          setMenuOpen(false);
          navigation.navigate('Utxos', { walletId: wallet.id });
          break;
        case 'importLabels':
          setMenuOpen(false);
          // The sheet is a Modal: let it dismiss before the file picker opens.
          setTimeout(() => void importLabelsFile(), 400);
          break;
        case 'statement':
          setMenuOpen(false);
          // The sheet is a Modal — let it dismiss before navigating, or the
          // push is swallowed (the repo's known iOS modal-stacking trap).
          setTimeout(() => {
            navigation.navigate('Statement', { walletId: wallet.id });
          }, 400);
          break;
        case 'toPortfolio':
          setMenuOpen(false);
          // The sheet is a Modal — let it fully dismiss first, or the next
          // dialog/navigate is swallowed (the repo's known iOS
          // modal-stacking trap; found live 2026-08-26).
          setTimeout(() => {
            if (wallets.some((w) => w.manual && !isSharedViewer(w))) setPortfolioChooser(true);
            else void createPortfolioSnapshot(null);
          }, 450);
          break;
        case 'unlinkPortfolio':
          setMenuOpen(false);
          setTimeout(() => setConfirmUnlink(true), 450);
          break;
        case 'register':
          setMenuOpen(false);
          navigation.navigate('RegisterHardware', { walletId: wallet.id });
          break;
        case 'registerHardware': {
          setMenuOpen(false);
          // Route by what the vault actually holds (decided 2026-08-31: one entry
          // for either brand). Several devices → the same ticked walk the
          // post-creation flow uses; one → go straight to its ceremony.
          const items = regChecklist(wallet);
          if (items.length > 1) {
            regWalkArmedRef.current = true;
            // The sheet is a Modal — let it fully dismiss first, or the
            // dialog is swallowed (the repo's known iOS modal-stacking
            // trap; found live 2026-08-26).
            setTimeout(() => setRegWalkOpen(true), 450);
          } else {
            // The one registration screen, for every adopted device (decided
            // 2026-09-22); never a brand screen picked by a guess.
            navigation.navigate('RegisterHardware', {
              walletId: wallet.id,
              fingerprint: items[0]?.fingerprint ?? undefined,
            });
          }
          break;
        }
        case 'inviteHeir': {
          setMenuOpen(false);
          // Invites follow the Estate Plan (decided 2026-09-21: "yes, same for
          // the vault menu"): while no plan names this vault's heirs, the
          // plan opens first, and its success page offers the invites.
          const toInvite = () => navigation.navigate('InviteHeir', { walletId: wallet.id });
          // Named here already (a plan filed on this phone): no need to ask.
          if ((wallet.heirs ?? []).some((h) => heirName(h))) {
            toInvite();
            break;
          }
          void (async () => {
            try {
              const session = await loadSession();
              // Signed out: the invite screen asks them to sign in.
              if (!session) return toInvite();
              const [filed, overview] = await Promise.all([
                fetchFiledPlanHeirs(session),
                fetchEstatePlanOverview(session).catch(() => null),
              ]);
              const planHere = !!overview?.vaults.some(
                (v) => v.account === wallet.accountNumber && v.plan != null,
              );
              if (inviteNeedsPlanFirst(wallet.heirs ?? [], filed, planHere)) {
                navigation.navigate('InheritanceSetup', {
                  walletId: wallet.id,
                  account: wallet.accountNumber,
                });
                return;
              }
              const named = withFiledNames(wallet.heirs ?? [], filed);
              if (named.changed) await updateWallet(wallet.id, { heirs: named.heirs });
              toInvite();
            } catch {
              // Unsure whether a plan exists: never send them to file a
              // second one. The invite screen reads the names itself.
              toInvite();
            }
          })();
          break;
        }
        case 'verifyKeys':
          setMenuOpen(false);
          navigation.navigate('VerifyExternalKeys', { walletId: wallet.id });
          break;
        case 'replaceDevice':
          setMenuOpen(false);
          navigation.navigate('ReplaceDevice', { walletId: wallet.id });
          break;
        case 'connectHardware':
          setMenuOpen(false);
          setTimeout(() => setHardwareChooserOpen(true), 450);
          break;
        case 'pending':
          setMenuOpen(false);
          navigation.navigate('PendingCosign', { walletId: wallet.id });
          break;
        case 'export':
          setMenuOpen(false);
          // The menu modal must finish dismissing before ANOTHER modal (or
          // the native share sheet) can present — same iOS rule that broke
          // the key scanner. Sequence with a short delay.
          setTimeout(() => setExportOpen(true), 400);
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallet, navigation, updateWallet, createPortfolioSnapshot, importLabelsFile],
  );

  const [exportOpen, setExportOpen] = useState(false);
  /** After picking PDF/CSV: every transaction, or refreshes grouped per day
   *  (decided 2026-08-28). */
  /** Export QR target — the instructions differ per app, and a plain
   *  one-key vault only ever needs these three (decided 2026-07-27). */
  const [exportQr, setExportQr] = useState<
    'sparrow' | 'liana' | 'bluewallet' | 'xpub' | 'descriptor' | 'talia' | null
  >(
    null,
  );
  /** "Copy" under the account key answers the tap for a moment (decided
   *  2026-09-08: no confirmation, unlike the address copy). */
  const [xpubCopied, setXpubCopied] = useState(false);
  const [backupNote, setBackupNote] = useState<null | { title: string; message: string }>(
    null,
  );
  /** What "Export Vault" shares: the public descriptor(s), nothing else. */
  /**
   * The vault sealed so only a keyholder can open it (decided 2026-08-29). Byte
   * compatible with Liana's .bed, so a client can recover in either app.
   * Null when the descriptor has no key a backup could be locked to.
   */
  const encryptedBackup = useMemo(() => {
    if (!wallet) return null;
    // 21st Capital's keys never open a client's backup (decided 2026-09-26). Until
    // the live list of our keys has answered, an imported vault's keys are
    // not known for sure, so no backup is offered for that moment.
    if (!known21CSettled) return null;
    try {
      // Record where each key came from. Liana's decrypt-with-a-device flow
      // asks the hardware wallet for xpubs ONLY at the paths the file
      // records, so a backup without them cannot be opened there with a
      // Ledger (found by testing, 2026-08-29).
      return encryptBackup(wallet.descriptor, {
        decoys: true,
        paths: descriptorPaths(wallet.descriptor),
        excludeFingerprints: known21C,
      });
    } catch {
      return null;
    }
  }, [wallet, known21C, known21CSettled]);

  /**
   * What "Export to Talia" carries (reported 2026-09-15: "it only exported the naked
   * vault without any labels or names"): the vault with its name, key names,
   * devices and registrations, so the other phone signs over Bluetooth at
   * once. Sealed like the backup, so only a keyholder opens it. The FILE
   * backup above stays a plain descriptor, because Liana has to open it.
   */
  const taliaExport = useMemo(
    () => (wallet ? serializeTaliaVaultExport(taliaVaultExportOf(wallet)) : ''),
    [wallet],
  );

  const exportPayload = useMemo(
    () =>
      wallet
        ? wallet.changeDescriptor
          ? `${wallet.descriptor}\n${wallet.changeDescriptor}`
          : wallet.descriptor
        : '',
    [wallet],
  );
  /** A PLAIN one-key wallet: the export menu is deliberately short for these
   *  — no multisig to reconstruct, so the useful actions are "open it in the
   *  two apps people use" and "share the account key" (decided 2026-07-27). */
  /**
   * A STORED vault in the shape we refuse to build (decided 2026-07-28). Creation
   * guards and import warnings never fire for a vault already on the phone, so
   * this is the only place its owner can learn about it.
   */
  const deadEnd = useMemo(() => {
    if (!wallet) return null;
    try {
      return deadEndShape(parsePolicy(wallet.descriptor));
    } catch {
      return null; // a banner must never take the wallet screen down
    }
  }, [wallet]);

  const singleSigVault = wallet?.kind === 'single-sig';
  /** A standard multisig — Sparrow, Nunchuk and the COLDCARD read it. */
  const plainMultisigVault = !!wallet?.descriptor.trim().startsWith('wsh(');
  const isTestnetVault = !!wallet && wallet.network !== 'bitcoin';
  /** The bare account key, for "Share xpub". */
  const accountXpub = useMemo(() => {
    if (!wallet) return null;
    try {
      return parseKeyOrigins(wallet.descriptor)[0]?.xpub ?? null;
    } catch {
      return null;
    }
  }, [wallet]);
  /** What the QR actually carries: the descriptor for a wallet import, the
   *  bare account key when the user asked to share the xpub. */
  const qrPayload =
    exportQr === 'talia'
      ? taliaExport
      : exportQr === 'xpub'
        ? accountXpub ?? exportPayload
        : exportPayload;

  // ——— The morph ———————————————————————————————————————————————
  // Our own header (back pill · empty middle · ⋯) means the title slot is
  // ours: the number rests below the header and docks exactly into its empty
  // center. Vertical travel finishes early, horizontal eases in later — the
  // number visibly rises first, then settles into the slot.
  // Everything measures from the BUTTONS' row, not the whole band: the band
  // also carries the caption's room underneath, and the number docks beside
  // the buttons, not under them.
  const headerTop = insets.top + theme.spacing.xs;
  const numberRestTop = headerTop + HEADER_BTN_ROW + HERO_GAP + NAME_BLOCK_H;
  const restCenterY = numberRestTop + NUMBER_BLOCK_H / 2;
  const dockCenterY = headerTop + HEADER_BTN_ROW / 2 - 7; // sit slightly high in the slot
  const translateYEnd = dockCenterY - restCenterY;
  // The number is centred both at rest (decided 2026-09-12: the vault page
  // matches the home screen) and in the title slot, so it only rises and
  // shrinks; the container spans the width and scales about its centre.

  const morphY = scrollY.interpolate({
    inputRange: [0, MORPH_RANGE * 0.65],
    outputRange: [0, translateYEnd],
    extrapolate: 'clamp',
  });
  const morphScale = scrollY.interpolate({
    inputRange: [0, MORPH_RANGE],
    outputRange: [1, END_SCALE],
    extrapolate: 'clamp',
  });
  const captionOpacity = scrollY.interpolate({
    inputRange: [MORPH_RANGE * 0.5, MORPH_RANGE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const subOpacity = scrollY.interpolate({
    inputRange: [0, MORPH_RANGE * 0.6],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  // The name scrolls with the list while the number stays pinned, so a pull
  // to sync would slide the name up behind the digits (decided 2026-09-07):
  // it fades out in the first few points of a pull and returns when the
  // content settles.
  const nameOpacity = scrollY.interpolate({
    inputRange: [-12, 0],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  /** ONE line about the vault's server and its last sync (decided
   *  2026-10-29): the chosen server renamed, retired or held back, a server
   *  that could not be reached (the chosen one, the default one, or every
   *  Testnet4 one), or, for any other failure, the library's own text. */
  const syncNote = useMemo(
    () => (wallet ? syncProblemNote(wallet.network, settings, syncError) : null),
    [wallet, settings, syncError],
  );

  const listHeader = useMemo(() => {
    if (!wallet) return null;
    return (
      <View style={styles.hero}>
        {/* The number itself is the animated overlay; reserve its resting space.
            The sync spinner now lives in the header (it was hidden behind the
            balance number here). */}
        <View style={{ height: NAME_BLOCK_H + NUMBER_BLOCK_H }}>
          <Animated.Text style={[styles.heroName, { opacity: nameOpacity }]} numberOfLines={1}>
            {wallet.label}
          </Animated.Text>
        </View>
        {balance && (
          // Pulled up by 4 so the figure and its fiat line sit 4pt apart, the
          // chart page's spacing (decided 2026-09-12), while the blocks below keep
          // their 8pt of air.
          <Animated.View style={{ opacity: subOpacity, marginTop: -theme.spacing.xs }}>
            {/* Only the fiat value under the number, as on the portfolio page
                (decided 2026-09-12): no sats or BTC equivalent. */}
            {fiatRate != null && wallet.network === 'bitcoin' && (
              <Text style={styles.heroSats}>
                {masked ? '••••' : formatFiat(balance.total, fiatRate, settings.fiat)}
              </Text>
            )}
            {/* The home card's line, from the same shared ticker: a test
                vault reads "tBTC", never the stored network key. */}
            <Text style={styles.heroType}>
              {wallet.network === 'bitcoin'
                ? sigTypeLabel(wallet.descriptor)
                : `${NETWORK_TICKERS[wallet.network]} · ${sigTypeLabel(wallet.descriptor)}`}
            </Text>
            {balance.total !== balance.confirmed && (
              <Text style={styles.heroPending}>
                {masked ? '••••' : formatSats(balance.confirmed)} confirmed
              </Text>
            )}
          </Animated.View>
        )}
        {syncNote != null && (
          <Text style={syncNote.tone === 'error' ? styles.error : styles.serverNote}>{syncNote.text}</Text>
        )}
        {syncing && <Text style={styles.syncNote}>{balance ? 'Updating…' : 'Syncing…'}</Text>}
        {/* The clock stays off the vault screen until it matters, three
            months before the first opening (decided 2026-09-12). The full
            countdown always lives on the Spending policy screen. */}
        {olderBlocks != null && nearestBlocks != null && nearestBlocks < REFRESH_SOON_BLOCKS && (
          // The home screen's notice, in the home screen's words (decided
          // 2026-09-22: "a sentence that holds true in any scenario is always
          // better"). It used to guess the open path was the heir's key and
          // told an heir on the everyday path that "your key" could spend,
          // when the path that opened was the rescue key. Tapping it opens
          // the coins to refresh, the way the home notice opens the vault;
          // on an heir's phone, or watch only, it is information.
          <NoticeBanner
            icon={<ClockIcon size={20} color={theme.colors.gold} />}
            style={styles.timelockNotice}
            onPress={
              refreshOffered(wallet, known21C) ? () => navigation.navigate('Utxos', { walletId: wallet.id }) : undefined
            }>
            {timelockNotice({ blocks: nearestBlocks, refreshAdvised: !wallet.heirVault })}
          </NoticeBanner>
        )}
        {deadEnd && (
          // With a recovery path behind it, a lost key ends the primary path
          // only: "forever" and "every spend" were false there (decided
          // 2026-09-22), and a vault can hold several recovery paths.
          <View style={styles.penaltyCard}>
            <InfoHeading
              style={styles.penaltyTitle}
              title="Why this shape is risky"
              text={`${
                deadEnd.hasRecovery
                  ? `Every one of the ${deadEnd.total} keys has to sign on the primary path, so losing or destroying a single one closes that path for good. After that, only a recovery path can move the coins, once it opens, with the keys that path needs.`
                  : `Every one of the ${deadEnd.total} keys has to sign, so losing or destroying a single one locks the coins away forever.`
              } Talia does not build vaults this way. While you still hold every key, moving the funds to a 2-of-3 vault is straightforward.`}>
              This vault’s primary path needs all {deadEnd.total} keys
            </InfoHeading>
            <Text style={styles.penaltyText}>
              {deadEnd.hasRecovery
                ? 'If one key is ever lost, only a recovery path can move the coins, once it opens.'
                : 'If one key is ever lost, the coins can never be moved again.'}{' '}
              Talk to us before you add funds.
            </Text>
          </View>
        )}
        {planLapsed && wallet.heldOf && (
          // Somebody else's plan pays for this vault and it has ended (decided
          // 2026-09-20). The note never names them and offers no renewal:
          // the plan is not this client's to renew.
          <View style={styles.penaltyCard}>
            <InfoHeading
              style={styles.penaltyTitle}
              title={OWNERS_COPY.lapsedInfoTitle}
              text={OWNERS_COPY.lapsedInfo}>
              {OWNERS_COPY.lapsedTitle}
            </InfoHeading>
            <Text style={styles.penaltyText}>{OWNERS_COPY.lapsedBody}</Text>
          </View>
        )}
        {planLapsed && !wallet.heldOf && (
          <View style={styles.penaltyCard}>
            <InfoHeading
              style={styles.penaltyTitle}
              title="What lapsing changes"
              text={
                // The builds that sell nothing name no penalty and no renewal
                // (Apple 2.1(b), 2026-09-11); the full app keeps its words.
                PURCHASES_ENABLED
                  ? "This vault is fully yours and stays completely usable. Nothing is locked and nothing stops working. The one change is that using 21st Capital's co-signing or rescue service now costs a 10% penalty on your balance, as set out in our terms."
                  : STORE_COPY.lapsedInfo
              }>
              Your 21st Capital plan has lapsed
            </InfoHeading>
            <Text style={styles.penaltyText}>
              {PURCHASES_ENABLED
                ? 'Nothing is locked. But co-signing and rescue now cost a 10% penalty on your balance, per our terms. Renew your plan to avoid it.'
                : STORE_COPY.lapsedBody}
            </Text>
          </View>
        )}
        {notCovered && !planLapsed && (
          <View style={styles.penaltyCard}>
            <InfoHeading
              style={styles.penaltyTitle}
              title="Why this vault is an extra"
              text="You have more vaults with 21st Capital keys than your plan includes, and this is one of the extras. It stays fully yours and fully usable. Only co-signing and rescue for it sit outside your plan.">
              This vault is not covered by your plan
            </InfoHeading>
            <Text style={styles.penaltyText}>
              {PURCHASES_ENABLED
                ? 'Co-signing and rescue for this vault are not included. Upgrade your plan on the website, or remove a vault you no longer use.'
                : STORE_COPY.notCoveredBody}
            </Text>
          </View>
        )}
        {(SIGNING_ENABLED || LEDGER_PREVIEW) && inheritancePrompt && !!wallet.vaultTestedAt && (
          <View style={styles.testingCard}>
            <Gloss radius={theme.radius.lg} strength={cardGlow()} />
            <Text style={styles.testingTitle}>
              Secure your legacy
            </Text>
            <Text style={styles.testingText}>
              {planProgress
                ? `${planProgress.covered} of your ${planProgress.total} vaults ${
                    planProgress.covered === 1 ? 'has' : 'have'
                  } an Estate Plan. File one for the next vault; it takes about ten minutes.`
                : 'Your vault is tested. One step remains: your Estate Plan. It takes about ten minutes.'}
            </Text>
            <TouchableOpacity
              style={styles.testingBtn}
              onPress={() =>
                navigation.navigate('InheritanceSetup', {
                  walletId: wallet.id,
                  account: wallet.accountNumber,
                })
              }
              activeOpacity={0.85}>
              <Text style={styles.testingBtnText}>
                {planProgress ? 'File the next Estate Plan' : 'Set up my Estate Plan'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {(SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED && sendAccess(wallet, known21C) === 'ready')) && pendingCosign != null && (
          <View style={styles.testingCard}>
            <Gloss radius={theme.radius.lg} strength={cardGlow()} />
            <Text style={styles.testingTitle}>
              {pendingCosign === 'ready'
                ? 'Co-signed: one step left'
                : pendingCosign === 'rejected'
                  ? 'A co-signing request was not approved'
                  : 'Co-signature in progress'}
            </Text>
            <Text style={styles.testingText}>
              {pendingCosign === 'ready'
                ? 'Your co-signature is here, but the money has NOT moved yet. Open the transaction and press Send to finish.'
                : pendingCosign === 'rejected'
                  ? 'No money has moved and your coins are where they were. Open it to see why, and start a new request whenever you want.'
                  : 'You asked 21st Capital to co-sign a transaction. Once they have, finish sending it here.'}
            </Text>
            <TouchableOpacity
              style={styles.testingBtn}
              onPress={() => navigation.navigate('PendingCosign', { walletId: wallet.id })}
              activeOpacity={0.85}>
              <Text style={styles.testingBtnText}>
                {pendingCosign === 'ready'
                  ? 'Finish sending'
                  : pendingCosign === 'rejected'
                    ? 'See why'
                    : 'Open pending co-signatures'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        {!SIGNING_ENABLED &&
          LEDGER_PREVIEW &&
          HWW_ENABLED &&
          !wallet.manual &&
          wallet.kind !== 'single-sig' &&
          // Heir rows never gate the standing card: a real heir takes their
          // device home, and no ceremony the owner can run would ever clear
          // it. The walk itself still lists them.
          regChecklist(wallet).some((i) => !i.registered && !i.heir) &&
          !(imported && wallet.registrationAttestedAt != null) && (
            <View style={styles.testingCard}>
              <Gloss radius={theme.radius.lg} strength={cardGlow()} />
              <InfoHeading
                style={styles.testingTitle}
                title="Why registering is needed"
                text="A shared vault has to be shown to each signing device once. The device displays every key in the vault on its own screen so you can check them, and from then on it will sign for this vault.">
                Register this vault on your hardware
              </InfoHeading>
              <Text style={styles.testingText}>
                Each device holding one of this vault's keys has to see it once before it
                can sign for it.
              </Text>
              <TouchableOpacity
                style={styles.testingBtn}
                onPress={() => {
                  // The same walk the post-creation prompt runs: several
                  // devices get the ticked list, a single one goes straight
                  // to its ceremony (decided 2026-08-31). No menu sheet is up
                  // here, so the dialog can present immediately.
                  const items = regChecklist(wallet);
                  if (items.length > 1) {
                    regWalkArmedRef.current = true;
                    setRegWalkOpen(true);
                  } else {
                    navigation.navigate('RegisterHardware', {
                      walletId: wallet.id,
                      fingerprint: items[0]?.fingerprint ?? undefined,
                    });
                  }
                }}
                activeOpacity={0.85}>
                <Text style={styles.testingBtnText}>Register now</Text>
              </TouchableOpacity>
              {imported && (
                // Hides the reminder, nothing more (decided 2026-09-18). It used
                // to say "it is already registered" and that ALSO opened
                // Send, on the owner's word about hardware this app has
                // never seen. Send now waits until a device is connected
                // here, so this link must not imply otherwise.
                <TouchableOpacity onPress={attestRegistered} style={styles.testingLink} activeOpacity={0.7}>
                  <Text style={styles.testingLinkText}>Hide this reminder</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        <Text style={styles.sectionHint}>Transactions</Text>
      </View>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, balance, syncNote, fiatRate, unit, settings.fiat, subOpacity, nameOpacity, olderBlocks, nearestBlocks, planLapsed, notCovered, inheritancePrompt, pendingCosign, regChecklist, masked]);

  if (!wallet) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Wallet not found.</Text>
      </View>
    );
  }

  const dockItems: DockItem[] = [
    {
      key: 'receive',
      label: 'Receive',
      color: theme.colors.offWhite,
      icon: (color: string) => <ActionArrow direction="receive" size={18} color={color} />,
      onPress: () => navigation.navigate('Receive', { walletId: wallet.id }),
    },
  ];
  // Watch-only v1: Receive is the whole dock, and the pill shrinks around it.
  if (SIGNING_ENABLED || (LEDGER_PREVIEW && HWW_ENABLED && sendAccess(wallet, known21C) !== 'hidden')) {
    dockItems.push({
      key: 'send',
      label: 'Send',
      color: theme.colors.offWhite,
      // A single-sig on no known device is watch only for now (decided 2026-09-08):
      // the button stays, dimmed, and the tap offers to connect a device.
      dim: sendAccess(wallet, known21C) === 'disabled',
      icon: (color: string) => <ActionArrow direction="send" size={18} color={color} />,
      onPress: () => {
        // Watch only until Talia has seen the hardware (decided 2026-09-18). The
        // tap offers to connect it; it no longer offers to take the owner's
        // word that the vault is registered somewhere else.
        if (!SIGNING_ENABLED && sendAccess(wallet, known21C) === 'disabled') {
          setHardwareChooserOpen(true);
        } else {
          navigation.navigate('Send', { walletId: wallet.id });
        }
      },
    });
  }

  return (
    <View style={styles.root}>
      <View style={[styles.customHeader, { paddingTop: headerTop }]}>
        {/* The glow's top slice, so it runs from the top of the screen (decided 2026-09-12). */}
        <PageGlow fill />
        <HeaderBackButton />
        <View style={styles.headerSpacer} />
        <HeaderIconButton label="Wallet menu" onPress={openMenu}>
          <DotsIcon size={20} strokeWidth={2.5} color={theme.colors.offWhite} />
        </HeaderIconButton>
      </View>
      <Animated.SectionList
        sections={sections}
        keyExtractor={(t: LedgerTx) => t.txid}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={listHeader}
        renderSectionHeader={({ section }: { section: LedgerSection }) => (
          <View style={styles.dayHeader}>
            <Text style={styles.dayTitle}>{section.title}</Text>
          </View>
        )}
        extraData={listExtra}
        renderItem={({ item }: { item: LedgerTx }) => (
          <TxRow
            tx={item}
            unit={unit}
            masked={masked}
            refreshLabel={olderBlocks != null && isSelfTransfer(item) && !rowWords[item.txid]?.isReturn}
            returnLabel={!!rowWords[item.txid]?.isReturn}
            replacedAs={rowWords[item.txid]?.replacedAs ?? null}
            waitingText={waitingLine(waitingTimes[item.txid])}
            fiatAtTime={histFiat[item.txid]}
            note={txNotes[item.txid]}
            onPress={() =>
              navigation.navigate('TxDetail', { walletId: wallet.id, txid: item.txid })
            }
          />
        )}
        ListEmptyComponent={
          !syncing ? (
            <Text style={styles.muted}>
              No transactions yet. Pull down to sync, or receive some sats.
            </Text>
          ) : null
        }
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            lastScrollY.current = e.nativeEvent.contentOffset.y;
            dockFollowScroll(lastScrollY.current);
          },
        })}
        scrollEventThrottle={16}
        refreshControl={
          // progressViewOffset pushes the pull spinner BELOW the pinned
          // balance overlay: the number does not scroll during a pull, so at
          // the default position the spinner appeared behind its digits
          // (decided 2026-08-28, second sighting after the header spinner moved).
          <RefreshControl
            refreshing={pulled}
            onRefresh={onPull}
            tintColor={theme.colors.gold}
            progressViewOffset={NAME_BLOCK_H + NUMBER_BLOCK_H + HERO_GAP + 24}
          />
        }
      />


      {syncing && (
        <View
          pointerEvents="none"
          style={[styles.syncFloat, { top: headerTop, height: HEADER_BTN_ROW }]}>
          <ActivityIndicator color={theme.colors.gold} accessibilityLabel="Syncing wallet" />
        </View>
      )}

      {/* The one balance number — travels from hero to the title slot. */}
      {balance && shown && (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.morph,
            {
              top: numberRestTop,
              transform: [{ translateY: morphY }, { scale: morphScale }],
            },
          ]}>
          <FitText
            style={[styles.morphNumber, { maxWidth: screenW - theme.spacing.lg * 2 }]}
            minimumFontScale={0.5}
            onPress={toggleWalletHidden}
            suppressHighlighting
            onLayout={(e) => {
              const w = Math.round(e.nativeEvent.layout.width);
              if (w > 0 && Math.abs(w - numberWidth) > 1) setNumberWidth(w);
            }}>
            {masked ? '•••••' : formatAmount(shown.sats, unit)}
          </FitText>
          <Animated.Text
            style={[
              styles.morphCaption,
              // Centred under the number whatever its width: the caption
              // has a width of its own, and the container is the screen.
              { opacity: captionOpacity, width: captionW, left: (screenW - captionW) / 2 },
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={MORPH_CAPTION_MAX_SCALE}>
            {shown.asOf === 'pending' ? 'includes pending' : shown.asOf ? `as of ${shown.asOf}` : ' '}
          </Animated.Text>
        </Animated.View>
      )}

      <BottomFade />
      {/* The same glass dock as the home tab bar (ui/components/Dock); the
          names fold away as the history scrolls. */}
      <Dock items={dockItems} />

      <AppModal
        visible={menuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setMenuOpen(false)}>
          <DraggableSheet
            visible={menuOpen}
            onDismiss={() => setMenuOpen(false)}
            style={styles.sheet}>
            {menuMode === 'tools' && <Text style={styles.sheetTitle}>Tools</Text>}
            {menuMode === 'export' && <Text style={styles.sheetTitle}>Export</Text>}
            {(menuMode === 'main'
              ? [
                  { key: 'policy', label: 'Spending policy' },
                  { key: 'addresses', label: 'Addresses' },
                  // A row that opens another list carries a drawn chevron,
                  // never a › in its words.
                  { key: 'tools', label: 'Tools', submenu: true },
                  { key: 'exportMenu', label: 'Export', submenu: true },
                  // The key check on the testing call (decided 2026-09-07): full
                  // app only, signed in, a vault holding one of our keys, and
                  // only until staff mark it tested (it returns if they set
                  // the vault back).
                  ...(!SIGNING_ENABLED && LEDGER_PREVIEW && HWW_ENABLED && hasSession &&
                  ourKeys.length > 0 && !wallet.heirVault && !wallet.locked && !wallet.vaultTestedAt
                    ? [{ key: 'verifyKeys', label: 'Verify external keys' }]
                    : []),
                  // Heir invites are a 21st Capital service (decided 2026-07-27):
                  // only vaults holding a 21C key get them — a purely
                  // self-custodial vault manages its heirs itself.
                  //
                  // ANY named heir can be invited (decided 2026-08-29). This used
                  // to require an heir with a fingerprint, which predated
                  // keyless invites: a plan whose heirs are all keyless could
                  // be filed and then had no way here to invite anybody. A
                  // keyless heir gets the code-only, full-visibility invite
                  // the invite screen already builds for them.
                  ...((SIGNING_ENABLED || LEDGER_PREVIEW) &&
                  (wallet.providerKeyFingerprints?.length ?? 0) > 0 &&
                  (wallet.heirs ?? []).length > 0
                    ? [{ key: 'inviteHeir', label: 'Invite an heir' }]
                    : []),
                  // This vault's own co-signing limit (decided 2026-09-23: set it
                  // "from both the app and the website", and from the vault's
                  // own page as well as Settings). Only where 21st Capital
                  // co-signs the vault, because there is nothing to limit
                  // otherwise, and only for its owner: an heir may ask us to
                  // co-sign and may not raise the cap.
                  ...(hasSession && ourKeys.length > 0 && !wallet.heirVault
                    ? [{ key: 'limits', label: 'Co-signing limits' }]
                    : []),
                  // Pending co-signatures end in finalise + broadcast.
                  ...(SIGNING_ENABLED ||
                  (LEDGER_PREVIEW && HWW_ENABLED && sendAccess(wallet, known21C) === 'ready')
                    ? [{ key: 'pending', label: 'Pending transactions' }]
                    : []),
                  // Rename, category and delete all live on the Arrange
                  // screen now (decided 2026-07-21 / 2026-08-28).
                ]
              : menuMode === 'tools'
                ? [
                    { key: 'back', label: 'All options', back: true },
                    { key: 'verify', label: 'Verify an address' },
                    { key: 'utxos', label: 'Coins' },
                    // Same destination as UTXOs — the refresh starts from the
                    // coin list, and naming it here is how owners look for it.
                    // Only where the coin list can refresh (never on an
                    // heir's phone): anywhere else it led to a list with
                    // nothing to press.
                    ...(refreshOffered(wallet, known21C) ? [{ key: 'refresh', label: 'Refresh coins' }] : []),
                    // Moved here from the first level (decided 2026-09-22): the
                    // portfolio link and the hardware set-up are tools, not
                    // everyday entries. Connect sits with Replace: the two
                    // never show together and answer the same question.
                    // Snapshot into a hand-kept portfolio on the Virtual tab
                    // (decided 2026-08-26). The vault itself is untouched.
                    { key: 'toPortfolio', label: 'Add to portfolio' },
                    ...(wallet.linkedPortfolioId != null
                      ? [{ key: 'unlinkPortfolio', label: 'Unlink from portfolio' }]
                      : []),
                    // Notes from Liana's labels file or wallet backup, for a
                    // vault added without them (decided 2026-11-05).
                    { key: 'importLabels', label: 'Import labels' },
                    // Registering a descriptor on a device only matters when
                    // that device is going to sign. Under the Ledger preview
                    // the ceremony lives on the Signing device screen.
                    ...(SIGNING_ENABLED && wallet.kind !== 'single-sig'
                      ? [{ key: 'register', label: 'Register on hardware' }]
                      : []),
                    // Only when at least one device COULD complete the
                    // ceremony — a shape the devices refuse would send the
                    // owner through pairing just to hear no (decided
                    // 2026-08-31).
                    ...(!SIGNING_ENABLED && LEDGER_PREVIEW && HWW_ENABLED && wallet.kind !== 'single-sig' && !wallet.manual &&
                    regChecklist(wallet).length > 0
                      ? [{ key: 'registerHardware', label: 'Register on your Hardware' }]
                      : []),
                    // A single-sig on no known device (decided 2026-09-08): the same
                    // list the import asked, any time.
                    ...(singleSigUnbound ? [{ key: 'connectHardware', label: 'Connect to hardware' }] : []),
                    // A device broke or the seed moved to another box (decided
                    // 2026-09-08). Offered once there is something to move:
                    // a shared vault's keys, or a single key that already has
                    // a device (with none, "Connect to hardware" above is the
                    // same question asked forward).
                    // Only when there IS hardware to replace. "Connect to
                    // hardware" above covers a vault that has never been on a
                    // device, and the two never coexist (decided 2026-09-09).
                    ...(!SIGNING_ENABLED && LEDGER_PREVIEW && HWW_ENABLED && !wallet.manual &&
                    !wallet.heirVault && !wallet.locked && canReplaceDevice(wallet, known21C)
                      ? [{ key: 'replaceDevice', label: 'Replace signing device' }]
                      : []),
                  ]
                : [
                    { key: 'back', label: 'All options', back: true },
                    {
                      key: 'export',
                      // Miniscript (timelocked) vaults export a descriptor a
                      // recovery tool needs by that exact name.
                      label: olderBlocks != null ? 'Vault descriptor' : 'Vault',
                    },
                    // One entry, because the format is now one of the
                    // questions the statement screen asks (decided 2026-08-28).
                    { key: 'statement', label: 'Account statement' },
                  ]
            ).map((item, i, arr) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.sheetRow, i < arr.length - 1 && styles.sheetDivider]}
                onPress={() => onMenuAction(item.key)}>
                {(item as { back?: boolean }).back && (
                  <ChevronLeftIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                )}
                <Text
                  style={[
                    styles.sheetText,
                    (item as { destructive?: boolean }).destructive && styles.sheetDestructive,
                  ]}>
                  {item.label}
                </Text>
                {(item as { submenu?: boolean }).submenu && (
                  <ChevronRightIcon size={18} strokeWidth={2.5} color={theme.colors.faint} />
                )}
              </TouchableOpacity>
            ))}
          </DraggableSheet>
        </TouchableOpacity>
      </AppModal>

      <AppDialog
        visible={regWalkOpen}
        title="Register on your Hardware"
        message="Each device holding one of this vault's keys has to see the vault once. It shows the vault's name and keys for you to approve, then it can sign. You can also do this later."
        actions={[
          ...regChecklist(wallet).map((item) => ({
            // The key's own name, else its device's brand, else no brand at
            // all: a key with no device on record is "Your hardware".
            label: item.label ?? (item.kind === 'unknown' ? 'Your hardware' : deviceName(item.kind)),
            checked: item.registered,
            onPress: () => {
              // AppDialog runs onClose (which disarms) BEFORE onPress:
              // re-arm here so the return from the ceremony re-opens the
              // list with this device's tick on it.
              regWalkArmedRef.current = true;
              navigation.navigate('RegisterHardware', {
                walletId: wallet.id,
                fingerprint: item.fingerprint ?? undefined,
              });
            },
          })),
          // Right under the devices (decided 2026-09-02): a vault the client
          // cannot rebuild is not backed up, whatever the hardware says. Not
          // for an IMPORTED vault (decided 2026-09-07): its backup is wherever it
          // came from.
          ...(imported
            ? []
            : [
                {
                  label: 'Email backup',
                  checked: backupDone(wallet),
                  onPress: () => {
                    regWalkArmedRef.current = true;
                    setBackupChooserSource('walk');
                    setBackupError(null);
                    setBackupChooserOpen(true);
                  },
                },
              ]),
          {
            label: 'Later',
            variant: 'ghost' as const,
            onPress: () => {
              regWalkArmedRef.current = false;
              setTimeout(resumeFirstVaultSecurity, 450);
            },
          },
        ]}
        onClose={() => {
          regWalkArmedRef.current = false;
          setRegWalkOpen(false);
          // Dismissed without a choice: the walk is over. A device row
          // re-arms the walk right after this, and then the prompt keeps
          // waiting for the walk's end.
          setTimeout(() => {
            if (!regWalkArmedRef.current) resumeFirstVaultSecurity();
          }, 500);
        }}
      />
      <AppDialog
        visible={backupChooserOpen}
        title="Email yourself a backup"
        // Title and buttons say it all; an explanation would only be read as
        // clutter (decided 2026-09-02: "we humans do not like to read much"). The
        // one text worth showing is a failure.
        message={backupError ?? undefined}
        actions={[
          ...(encryptedBackup
            ? [
                {
                  label: 'Backup file (Encrypted)',
                  onPress: () => {
                    // AppDialog closes its Modal BEFORE running this, and the
                    // fade takes ~300 ms; the sheet waits the same 450 ms this
                    // screen gives every native sheet after a dialog.
                    const source = backupChooserSource;
                    setTimeout(() => void (async () => {
                      try {
                        // The share sheet, not Apple's composer: the client's
                        // OWN mail app must send it (decided 2026-09-02), and iOS
                        // offers no other route to a third-party mail app with
                        // an attachment. Only a FINISHED activity counts.
                        const outcome = await shareEncryptedBackup(wallet.label, encryptedBackup, {
                          forEmail: true,
                        });
                        if (outcome.completed) {
                          setBackupError(null);
                          afterBackup(wallet, source);
                          return;
                        }
                        // Dismissed: nothing went anywhere, so no tick. Back
                        // to the walk, untouched.
                        if (source === 'walk') setTimeout(() => setRegWalkOpen(true), 450);
                      } catch (e) {
                        setBackupError((e as Error).message);
                        setTimeout(() => setBackupChooserOpen(true), 450);
                      }
                    })(), 450);
                  },
                },
              ]
            : []),
          {
            label: 'Plain text in the email',
            onPress: () => {
              const source = backupChooserSource;
              setTimeout(() => void (async () => {
                try {
                  // mailto: hands the draft to the mail app and can report
                  // nothing back, so opening it is the best signal there is.
                  await emailDescriptorToSelf({
                    label: wallet.label,
                    descriptor: wallet.descriptor,
                    changeDescriptor: wallet.changeDescriptor,
                    kind: wallet.kind,
                  });
                  setBackupError(null);
                  afterBackup(wallet, source);
                } catch (e) {
                  // The only thing that can reject here is Linking.openURL,
                  // and its wording differs by platform (iOS "Unable to open
                  // URL", Android "Could not open URL ... No Activity found",
                  // the latter embedding the whole encoded body). Neither is
                  // for a client: say the one thing that is true.
                  void e;
                  setBackupError(
                    'No mail app is set up on this phone. Set one up in Settings, then try again.',
                  );
                  setTimeout(() => setBackupChooserOpen(true), 450);
                }
              })(), 450);
            },
          },
          {
            label: 'Cancel',
            variant: 'ghost' as const,
            onPress: () => {
              setBackupError(null);
              if (backupChooserSource === 'walk') setTimeout(() => setRegWalkOpen(true), 450);
            },
          },
        ]}
        onClose={() => {
          // Backdrop and Android back behave like the walk's own backdrop:
          // the client stepped away, so nothing pops up uninvited later.
          regWalkArmedRef.current = false;
          setBackupError(null);
          setBackupChooserOpen(false);
        }}
      />
      <AppDialog
        visible={shareChooserOpen}
        title="Save to Files / Share"
        actions={[
          ...(encryptedBackup
            ? [
                {
                  label: 'Encrypted backup file',
                  onPress: () =>
                    setTimeout(() => {
                      void shareEncryptedBackup(wallet.label, encryptedBackup).catch(() => {});
                    }, 450),
                },
              ]
            : []),
          {
            label: 'Plain text',
            variant: (encryptedBackup ? 'ghost' : 'primary') as 'ghost' | 'primary',
            onPress: () =>
              setTimeout(() => {
                void shareDescriptor(wallet).catch(() => {});
              }, 450),
          },
          { label: 'Cancel', variant: 'ghost' as const, onPress: () => {} },
        ]}
        onClose={() => setShareChooserOpen(false)}
      />
      <AppDialog
        visible={hardwareChooserOpen}
        title="Connect to hardware"
        actions={[
          // One way in for every adopted device and method (decided 2026-09-22):
          // the shared screen asks how the hardware connects, then looks for
          // it. There used to be one button per brand here.
          {
            label: 'Connect my hardware',
            onPress: () => {
              hardwareFlowRef.current = true;
              setTimeout(() => navigation.navigate('RegisterHardware', { walletId: wallet.id }), 450);
            },
          },
          {
            label: 'Watch only',
            variant: 'ghost' as const,
            onPress: () => {
              hardwareFlowRef.current = false;
              setTimeout(resumeFirstVaultSecurity, 450);
            },
          },
        ]}
        onClose={() => {
          setHardwareChooserOpen(false);
          // Dismissed without a choice: nothing more is coming; the
          // Face ID prompt may run. A choice runs its onPress right after
          // this and sets the flag back before the check below.
          hardwareFlowRef.current = false;
          setTimeout(() => {
            if (!hardwareFlowRef.current) resumeFirstVaultSecurity();
          }, 500);
        }}
      />
      
      <AppDialog
        visible={regDoneOpen}
        title="Your vault is registered"
        message={
          imported
            ? 'Every device holding one of this vault\u2019s keys has approved it and can now sign. This vault is ready.'
            : 'Every device holding one of this vault\u2019s keys has approved it and can now sign, and you have a backup in your own mailbox. This vault is ready.'
        }
        actions={[{ label: 'Done', onPress: () => {} }]}
        onClose={() => {
          setRegDoneOpen(false);
          // Every device done: the Face ID prompt may run now.
          setTimeout(resumeFirstVaultSecurity, 450);
        }}
      />
      <AppDialog
        visible={portfolioChooser}
        title="Add to portfolio"
        message="Add this vault's history to one of your portfolios, or start a new one. The vault itself is untouched."
        actions={[
          ...wallets
            // Not one shared WITH this phone: only its owner writes to it
            // (decided 2026-09-14).
            .filter((w) => w.manual && !isSharedViewer(w))
            .map((w) => ({
              label: w.label,
              variant: 'ghost' as const,
              onPress: () => {
                setPortfolioChooser(false);
                // Let this dialog dismiss before any follow-up dialog
                // (instant errors would otherwise collide with it).
                setTimeout(() => void createPortfolioSnapshot(w.id), 450);
              },
            })),
          {
            label: 'New portfolio',
            onPress: () => {
              setPortfolioChooser(false);
              setTimeout(() => void createPortfolioSnapshot(null), 450);
            },
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => setPortfolioChooser(false) },
        ]}
        onClose={() => setPortfolioChooser(false)}
      />

      <AppDialog
        visible={linkPrompt != null}
        title="Keep them in sync?"
        message="Talia will add this vault's future deposits and withdrawals to the portfolio for you. You can still edit or delete any entry, and unlink any time from this vault's menu."
        actions={[
          {
            label: 'Link and open',
            onPress: () => {
              const pid = linkPrompt!;
              setLinkPrompt(null);
              void updateWallet(wallet!.id, { linkedPortfolioId: pid });
              landOverTab('VirtualTab', [{ name: 'ManualWallet', params: { walletId: pid } }]);
            },
          },
          {
            label: 'Just open',
            variant: 'ghost',
            onPress: () => {
              const pid = linkPrompt!;
              setLinkPrompt(null);
              landOverTab('VirtualTab', [{ name: 'ManualWallet', params: { walletId: pid } }]);
            },
          },
        ]}
        onClose={() => setLinkPrompt(null)}
      />

      <AppDialog
        visible={confirmUnlink}
        title="Unlink this vault?"
        message="New activity stops flowing into the portfolio. Everything already added stays."
        actions={[
          { label: 'Cancel', variant: 'ghost', onPress: () => setConfirmUnlink(false) },
          {
            label: 'Unlink',
            onPress: () => {
              setConfirmUnlink(false);
              void updateWallet(wallet!.id, { linkedPortfolioId: undefined });
            },
          },
        ]}
        onClose={() => setConfirmUnlink(false)}
      />

      <AppDialog
        visible={labelsResult != null}
        title={labelsResult ?? ''}
        actions={[{ label: 'OK', onPress: () => setLabelsResult(null) }]}
        onClose={() => setLabelsResult(null)}
      />

      <AppDialog
        visible={snapshotError != null}
        title="Portfolio not created"
        message={snapshotError ?? ''}
        actions={[{ label: 'OK', onPress: () => setSnapshotError(null) }]}
        onClose={() => setSnapshotError(null)}
      />
      {authModal}


      {wallet && (
        <AppDialog
          visible={exportOpen}
          title={olderBlocks != null ? 'Back up / export vault' : 'Back up / export vault'}
          message={
            singleSigVault
              ? 'Watch this wallet in another app, or keep a copy of its backup. No private keys are involved, so none of this can spend.'
              : 'This backup holds NO private keys, but it can rebuild the vault for recovery. Keep a copy safe. We never receive it unless you send it.\n\n' +
                compatibilityNote(wallet)
          }
          actions={
            singleSigVault
              ? [
                  // A one-key wallet needs no multisig reconstruction, so the
                  // useful actions are the apps people actually use plus the
                  // account key (decided 2026-07-27). Talia Desktop led here until
                  // it was taken out of this version (decided 2026-08-28): the app
                  // that can open the vault TODAY leads.
                  {
                    label: 'Export to Sparrow',
                    variant: 'primary' as const,
                    onPress: () => setTimeout(() => setExportQr('sparrow'), 400),
                  },
                  {
                    // Phone to phone, always the plain code (decided 2026-09-21:
                    // "drop the encrypted option from Talia to Talia"): the
                    // owner is looking at both screens.
                    label: 'Export to Talia',
                    variant: 'ghost' as const,
                    onPress: () => setTimeout(() => setExportQr('talia'), 400),
                  },
                  {
                    label: 'Export to BlueWallet',
                    variant: 'ghost' as const,
                    onPress: () => setTimeout(() => setExportQr('bluewallet'), 400),
                  },
                  {
                    label: 'Share xpub',
                    variant: 'ghost' as const,
                    onPress: () => setTimeout(() => setExportQr('xpub'), 400),
                  },
                  { label: 'Cancel', variant: 'ghost' as const, onPress: () => {} },
                ]
              : [
                  // The app that suits THIS shape leads — Sparrow for a
                  // standard multisig, Liana for a layered one. Talia Desktop
                  // is out of this version until it ships (decided 2026-08-28):
                  // offering a recovery route that does not exist yet is the
                  // wrong thing to put first on a backup screen. Same rule
                  // for Liana itself (decided 2026-09-02): a co-signer vault
                  // with no rescue or heir layer is a bare taproot multisig
                  // Liana refuses, so it gets NO third-party lead at all,
                  // matching the note above it. lianaCanOpen is the one
                  // predicate the walk chooser also uses.
                  ...(plainMultisigVault
                    ? [
                        {
                          label: 'Export to Sparrow',
                          variant: 'primary' as const,
                          onPress: () => setTimeout(() => setExportQr('sparrow'), 400),
                        },
                      ]
                    : lianaCanOpen
                      ? [
                          {
                            label: 'Export to Liana',
                            variant: 'primary' as const,
                            onPress: () => setTimeout(() => setExportQr('liana'), 400),
                          },
                        ]
                      : []),
                  {
                    // Phone to phone: the same vault, watched on a second
                    // device (decided 2026-08-28), always the plain code (decided
                    // 2026-09-21: "drop the encrypted option from Talia to
                    // Talia").
                    label: 'Export to Talia',
                    variant: 'ghost' as const,
                    onPress: () => setTimeout(() => setExportQr('talia'), 400),
                  },
                  {
                    // The same two forms as the walk's chooser (decided 2026-09-02):
                    // the encrypted file, or the plain text, each to oneself.
                    label: 'Email a copy to myself',
                    variant: 'ghost' as const,
                    onPress: () =>
                      setTimeout(() => {
                        setBackupChooserSource('export');
                        setBackupError(null);
                        setBackupChooserOpen(true);
                      }, 400),
                  },
                  {
                    // "Share…" and "Save to Files" opened the SAME iOS sheet —
                    // one entry, honestly named (decided 2026-07-28). It asks which
                    // form first (decided 2026-09-02).
                    label: 'Save to Files / Share',
                    variant: 'ghost' as const,
                    onPress: () => setTimeout(() => setShareChooserOpen(true), 400),
                  },
                  { label: 'Cancel', variant: 'ghost' as const, onPress: () => {} },
                ]
          }
          onClose={() => setExportOpen(false)}
        />
      )}

      {backupNote != null && (
        <AppDialog
          visible
          title={backupNote.title}
          message={backupNote.message}
          actions={[{ label: 'OK', variant: 'primary', onPress: () => {} }]}
          onClose={() => setBackupNote(null)}
        />
      )}

      {/* Export QR — the SAME descriptor QR serves Sparrow and BlueWallet;
          only the instructions differ. "Share xpub" shows the account key
          itself, as a QR and as text (decided 2026-07-27). */}
      <AppModal
        visible={exportQr !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setExportQr(null)}>
        <View style={styles.exportQrBackdrop}>
          <ScrollView
            contentContainerStyle={styles.exportQrScroll}
            showsVerticalScrollIndicator={false}>
            <View style={styles.exportQrCard}>
              {/* Frosted, like every other popup (decided 2026-09-12). */}
              <BlurView
                style={StyleSheet.absoluteFill}
                blurType={getColorScheme() === 'dark' ? 'thinMaterialDark' : 'thinMaterialLight'}
                blurAmount={24}
                reducedTransparencyFallbackColor={theme.colors.surfaceSolid}
              />
              <View style={styles.glassTint} pointerEvents="none" />
              <Gloss radius={theme.radius.lg} />
              {exportQr === 'talia' ? (
                // What the code gives away lives behind the dot, not in a
                // paragraph above it (reported 2026-09-21: "way too many options,
                // this is not proper UI"; the dialog rule of 2026-09-02).
                <InfoHeading
                  style={styles.exportQrTitle}
                  title="Export to Talia"
                  text="Anyone who sees this code can watch this vault and every address it has used. It holds no private keys and cannot spend.">
                  Export to Talia
                </InfoHeading>
              ) : (
              <Text style={styles.exportQrTitle}>
                {exportQr === 'liana'
                  ? 'Export to Liana'
                  : exportQr === 'sparrow'
                    ? 'Export to Sparrow'
                  : exportQr === 'bluewallet'
                    ? 'Export to BlueWallet'
                    : exportQr === 'xpub'
                      ? 'Your account key'
                      : olderBlocks != null
                        ? 'Vault descriptor'
                        : 'Vault export'}
              </Text>
              )}
              {exportQr === 'liana' && (
                <>
                  <Text style={styles.exportQrSteps}>
                    Liana cannot scan a code. Send the encrypted file to the computer
                    running Liana, by AirDrop, a cloud drive, or email to yourself.
                  </Text>
                  <Text style={styles.exportQrSteps}>
                    Then in Liana: create a new wallet, choose to import a backup, and
                    open the file. Liana asks the hardware wallet holding one of this
                    vault&apos;s keys to unlock it.
                  </Text>
                </>
              )}
              {exportQr === 'talia' && (
                <Text style={styles.exportQrSteps}>
                  On the other phone, add an existing vault, choose Talia and scan
                  this code.
                </Text>
              )}
              {exportQr === 'sparrow' && (
                <>
                  <Text style={styles.exportQrSteps}>
                    In Sparrow: File → Import Wallet → scroll to “Output
                    descriptor” → Scan QR, then point it at this code.
                  </Text>
                  {plainMultisigVault && (
                    <Text style={styles.exportQrSteps}>
                      Prefer a file? Choose “Save to Files / Share” on the
                      export screen, send the descriptor to that computer, and
                      load it in the same Import Wallet dialog.
                    </Text>
                  )}
                </>
              )}
              {exportQr === 'bluewallet' && (
                <Text style={styles.exportQrSteps}>
                  In BlueWallet: + Add wallet → Import wallet → Scan QR, then
                  point it at this code.
                </Text>
              )}
              {exportQr === 'xpub' && (
                <Text style={styles.exportQrSteps}>
                  Your wallet's PUBLIC account key. It shows balances and
                  addresses. It can never spend.
                </Text>
              )}
              {/* Liana has no scanner — text and a file are its routes. */}
              {exportQr !== 'liana' &&
                (qrPayload.length > 1000 ? (
                  <AnimatedQr frames={encodeBbqr(utf8ToBytes(qrPayload), 'U')} size={240} />
                ) : (
                  <QrImage value={qrPayload} size={240} />
                ))}
              {/* No descriptor preview (decided 2026-08-28): a wall of base58 says
                  nothing a human can check — the two actions are the point. */}
              {exportQr === 'liana' && !!wallet && (
                <>
                  {encryptedBackup && (
                    <Button
                      title="Export encrypted file"
                      variant="ghost"
                      onPress={() => {
                        void exportBase64ToFile(
                          `${slugName(wallet.label)}.bed`,
                          b64codec.encode(encryptedBackup),
                          'application/octet-stream',
                        ).catch(() => {});
                      }}
                    />
                  )}
                  <Button
                    title="Save to Files / Share"
                    variant="ghost"
                    onPress={() => void shareDescriptor(wallet).catch(() => {})}
                  />
                </>
              )}
              {exportQr === 'xpub' && (
                <>
                  <Text selectable style={styles.exportQrMono}>
                    {accountXpub ?? qrPayload}
                  </Text>
                </>
              )}
              {exportQr === 'bluewallet' && isTestnetVault && (
                <Text style={styles.exportQrSteps}>
                  This is a test-network wallet. Open it in Sparrow, which
                  supports the test networks.
                </Text>
              )}
              {(exportQr === 'descriptor' || exportQr === 'sparrow') && (
                <Text style={styles.exportQrHint}>
                  Works in {readerApps(wallet?.kind, wallet?.descriptor, 'and')}.
                </Text>
              )}
              {/* One row closes every export sheet: at most one action
                  beside Done, both the same width (decided 2026-09-21: "copy as
                  text and share as text are almost the same thing"; the
                  iPhone's share sheet already offers Copy). */}
              <View style={styles.exportActions}>
                {exportQr === 'talia' && !!qrPayload && (
                  <Button
                    title="Share"
                    variant="ghost"
                    style={styles.exportAction}
                    accessibilityLabel="Share the vault export as text"
                    onPress={() => void shareText(qrPayload, 'Talia vault export').catch(() => {})}
                  />
                )}
                {exportQr === 'xpub' && (
                  <Button
                    title={xpubCopied ? 'Copied' : 'Copy'}
                    variant="ghost"
                    style={styles.exportAction}
                    accessibilityLabel="Copy the account key"
                    onPress={() => {
                      copySecret(accountXpub ?? qrPayload, 'vaultKeys');
                      setXpubCopied(true);
                      setTimeout(() => setXpubCopied(false), 1800);
                    }}
                  />
                )}
                <Button title="Done" variant="ghost" style={styles.exportAction} onPress={() => setExportQr(null)} />
              </View>
            </View>
          </ScrollView>
        </View>
      </AppModal>

    </View>
  );
}

/** A filename that survives every filesystem. */
function slugName(label: string): string {
  return label.replace(/[^\w-]+/g, '-').toLowerCase() || 'vault';
}

/** Short day label for the "as of" caption. */
function dayLabelFor(tx: LedgerTx): string {
  if (!tx.confirmed || !tx.timestamp) return 'pending';
  const d = new Date(tx.timestamp * 1000);
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })} ${d.getFullYear()}`;
}

function TxRow({
  tx,
  unit,
  masked,
  refreshLabel,
  returnLabel,
  replacedAs,
  waitingText,
  fiatAtTime,
  note,
  onPress,
}: {
  tx: LedgerTx;
  unit: AmountUnit;
  /** The vault's balance is hidden: amounts read as dots, the direction
   *  (Received / Sent) stays, as on a Portfolio's rows (decided 2026-09-07). */
  masked?: boolean;
  /** Timelocked vault + pure self-spend → present as "Refresh", not "Sent". */
  refreshLabel?: boolean;
  /** A cancelled payment's coins coming back: "Return", as its page says. */
  returnLabel?: boolean;
  /** Replaced and not confirmed: "Cancelled" or "Replaced" instead of "Waiting for confirmation". */
  replacedAs?: string | null;
  /** A waiting payment's line: since when, or first seen when (`waitingLine`). */
  waitingText: string;
  fiatAtTime?: string;
  note?: string;
  onPress: () => void;
}): React.JSX.Element {
  const incoming = tx.netAmount >= 0;
  const waiting = replacedAs ?? waitingText;
  return (
    <TouchableOpacity style={styles.txRow} onPress={onPress} activeOpacity={0.75} accessibilityRole="button">
      {/* The same mark and the same layout rule as a portfolio's buy and
          sell rows (ui/components LedgerRow, decided 2026-10-22): the
          amount moves under the title when both do not fit, and the note
          takes a full line of its own. */}
      <LedgerRowContent
        icon={<TxDirectionIcon direction={incoming ? 'in' : refreshLabel || returnLabel ? 'refresh' : 'out'} />}
        title={incoming ? 'Received' : returnLabel ? 'Return' : refreshLabel ? 'Refresh' : 'Sent'}
        lines={tx.confirmed ? undefined : [waiting]}
        amount={masked ? '••••' : formatSignedAmount(tx.netAmount, unit)}
        amountColor={incoming ? theme.colors.positive : theme.colors.offWhite}
        sub={fiatAtTime != null ? (masked ? '••••' : fiatAtTime) : undefined}
        note={note}
        // The vault's own colours: the note bright, "Waiting" quiet.
        lineColor={theme.colors.slate}
        noteColor={theme.colors.offWhite}
      />
    </TouchableOpacity>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  exportQrBackdrop: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  glassTint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.glassTint },
  exportQrCard: {
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.offWhite + '2E',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  exportQrTitle: { ...theme.typography.title, color: theme.colors.offWhite },
  // Step text is LEFT-aligned even inside a centre-aligned card: centred
  // multi-line instructions are hard to follow (decided 2026-07-27); the hint
  // under the code reads with the steps.
  exportQrHint: { ...theme.typography.caption, color: theme.colors.slate, alignSelf: 'stretch', textAlign: 'left' },
  exportQrSteps: {
    ...theme.typography.body,
    color: theme.colors.offWhite,
    alignSelf: 'stretch',
    textAlign: 'left',
  },
  exportQrMono: {
    ...theme.typography.mono,
    color: theme.colors.offWhite,
    alignSelf: 'stretch',
    textAlign: 'left',
  },
  exportQrScroll: { flexGrow: 1, justifyContent: 'center', paddingVertical: theme.spacing.xl },
  exportActions: { flexDirection: 'row', gap: theme.spacing.sm, alignSelf: 'stretch' },
  exportAction: { flex: 1, paddingHorizontal: theme.spacing.md },
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Room for the dock and the fade under the last row.
  list: { paddingBottom: 160 },

  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    // The buttons' own padding, plus the room the docked "as of" line hangs in.
    paddingBottom: HEADER_BAR_PAD + HEADER_CAPTION_ROOM,
    backgroundColor: theme.colors.hull,
    zIndex: 2,
  },
  headerSpacer: { flex: 1 },
  syncFloat: {
    position: 'absolute',
    // Left of the menu button (lg padding + the button + a small gap).
    right: theme.spacing.lg + HEADER_BTN + theme.spacing.sm,
    justifyContent: 'center',
    // Above the morphing balance (zIndex 3): a bar control stays on top,
    // the number slides beneath it (decided 2026-08-28: the spinner kept hiding
    // behind the balance).
    zIndex: 4,
  },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    justifyContent: 'flex-end',
  },
  // One sheet recipe: the glass, tint and finish come from DraggableSheet,
  // so no extra ground here (decided 2026-09-14).
  sheet: {
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
    borderTopWidth: 1,
    borderColor: theme.colors.offWhite + '2E',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.faint,
    marginBottom: theme.spacing.md,
  },
  sheetTitle: {
    ...theme.typography.label,
    color: theme.colors.slate,
    paddingVertical: theme.spacing.sm,
  },
  // A menu row: its words, and a drawn chevron where it leads to another list
  // (trailing) or back to the first (leading).
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.lg },
  sheetDivider: { borderBottomWidth: 1, borderBottomColor: theme.colors.hairline },
  sheetText: { ...theme.typography.heading, color: theme.colors.offWhite, flex: 1 },
  sheetDestructive: { color: theme.colors.negative },

  morph: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 3,
  },
  // The one hero figure; FitText strips the token's line height.
  morphNumber: {
    ...theme.typography.hero,
    color: theme.colors.offWhite,
    fontVariant: ['tabular-nums'],
  },
  // Absolutely positioned so the (often wider) caption never widens the
  // container and shifts the resting number off the left edge.
  morphCaption: {
    position: 'absolute',
    top: MORPH_CAPTION_TOP,
    textAlign: 'center',
    fontFamily: theme.typography.heroCaption.fontFamily,
    fontSize: MORPH_CAPTION_SIZE,
    color: theme.colors.slate,
  },

  hero: {
    paddingHorizontal: theme.spacing.lg,
    // The name block starts HERO_GAP below the BUTTONS (the header's own
    // bottom padding, the caption's room included, is already on screen), so
    // the resting hero sits exactly where it did before the band grew.
    paddingTop: HERO_GAP - HEADER_BAR_PAD - HEADER_CAPTION_ROOM,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  // The one hero label (theme `heroLabel`), shared with Home, the Portfolio tab,
  // the vault page and "Vault built".
  heroName: heroLabel(),
  heroSats: { ...theme.typography.heroCaption, color: theme.colors.slate, textAlign: 'center' },
  heroType: { ...theme.typography.caption, color: theme.colors.faint, marginTop: theme.spacing.xs, textAlign: 'center' },
  heroPending: { ...theme.typography.caption, color: theme.colors.gold, marginTop: 2, textAlign: 'center' },
  error: { ...theme.typography.caption, color: theme.colors.negative, textAlign: 'center' },
  serverNote: { ...theme.typography.caption, color: theme.colors.gold, textAlign: 'center' },
  syncNote: { ...theme.typography.caption, color: theme.colors.slate, textAlign: 'center' },
  // The list title: the home's section titles, character for character, with
  // a full breath (xl on top of the hero's own sm) between the hero and the
  // list (reported 2026-09-12: "too narrow apart").
  sectionHint: {
    ...theme.typography.heading,
    color: theme.colors.faint,
    marginTop: theme.spacing.xl,
  },

  // Day labels sit on the page glow like everything else: no band and no
  // rule. The opaque ground and the hairline were for sticky headers, which
  // are off, and against the glow they read as a hard-edged stripe (decided
  // 2026-09-12: "the edges are too harsh").
  dayHeader: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xs,
  },
  dayTitle: { ...theme.typography.caption, color: theme.colors.slate },

  txRow: {
    flexDirection: 'row',
    // The inside is LedgerRowContent's: "Received" and the amount share the
    // first line when they fit, the fiat beneath (decided 2026-09-12).
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  // The notice is NoticeBanner; here only its place in the hero.
  timelockNotice: { marginTop: theme.spacing.md },
  penaltyCard: {
    // The warning colour at 10%: the theme's gold in either scheme.
    backgroundColor: theme.colors.gold + '1A',
    borderWidth: 1,
    borderColor: theme.colors.gold,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  penaltyTitle: { ...theme.typography.heading, color: theme.colors.gold },
  penaltyText: { ...theme.typography.caption, color: theme.colors.slate },
  testingCard: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  testingTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  testingText: { ...theme.typography.caption, color: theme.colors.slate },
  testingLink: { alignSelf: 'center', paddingVertical: theme.spacing.sm },
  testingLinkText: { ...theme.typography.label, color: theme.colors.slate },
  testingBtn: {
    backgroundColor: theme.colors.action,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    alignSelf: 'flex-start',
  },
  testingBtnText: { ...theme.typography.heading, color: theme.colors.actionText },
  // The first line (Received, Sent) sits level with the icon's centre; the
  // fiat value and a note go under it (decided 2026-09-12).

  muted: {
    ...theme.typography.body,
    color: theme.colors.slate,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.xl,
  },

  // Tether-style floating action container: a compact centered pill holding
  // the thin diagonal Receive/Send arrows with small labels beneath.

  modalBackdrop: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  modalCard: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  modalTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  modalRow: { flexDirection: 'row', gap: theme.spacing.md },
  modalBtn: { flex: 1 },
}));
