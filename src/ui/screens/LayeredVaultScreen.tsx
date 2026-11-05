/**
 * Layered vault builder — mirrors the 21stcapital.com VAULT CONFIGURATOR
 * (structure, copy, and PRICING extracted from the site, 2026-07-17):
 *
 *   1 Basic Configuration    2-of-3 (Most Popular) · 2-of-2  (no single-sig
 *                            here — that's its own flow; decided 2026-07-17)
 *   2 Key Configuration      your keys + the co-signer: 21st Capital by
 *                            default (site behaviour) or your own key
 *   3 Inheritance Planning   optional heirs (≤5), Assisted or hardware key,
 *                            timelock 8–15 months
 *   4 Rescue Key             21st Capital key at a fixed 15-month timelock
 *   5 Elite Add-on           only when 21st Capital keys are involved —
 *                            the site's Elite upsell, moved to the end
 *   6 Summary                review + PRICING (site tiers) + test-your-vault
 *                            warning + checkout stub (backend API next)
 *
 * 21st Capital co-signer/rescue keys live ONLY on the company backend —
 * they are FETCHED into the descriptor at checkout, never typed in
 * (decided 2026-07-17). Until the issuance API ships, checkout explains that.
 * Already-onboarded clients simply import their descriptor instead.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { landOverTab } from '../navigation/landOverTab';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { useRevealFocusedField } from '../hooks/useRevealFocusedField';
import type { RootStackParamList } from '../navigation/types';
import { AppDialog, AuthSheet, BookingSheet, Button, Card, FOOTER_ROOM, Gloss, GoldChip, InfoHeading, KeySlotRow, PageGlow, RadioMark, TextField, KeyEntrySheet, HeaderBackButton, StepTransition, FadeEdge, VaultGraph, cardGlow, focusedRows, vaultGraphRows } from '../components';
import type { GraphFocus, KeySlot } from '../components';
import type { ColdcardExport } from '../../bitcoin/descriptor';
import { MinusIcon, PlusIcon, WarningIcon } from '../components/TablerIcons';
import { theme, themedStyles } from '../theme';
import { findDuplicateWallet, duplicateVaultMessage, useWallets, newHeirId } from '../../wallet';
import { MAX_NAME_LENGTH } from '../../wallet';
import { brandNamesOf, modelsFor } from '../../wallet/deviceKinds';
import type { KeyDevice } from '../../wallet/types';
import { HWW_ENABLED, PURCHASES_ENABLED, SUPPORT , TEST_TIMELOCKS_ENABLED} from '../../config';
import { STORE_COPY, vaultLimitMessage } from './storeCopy';
import { formatBlocksDuration } from '../../wallet/timelock';
import {
  composeLayeredVault,
  composeMultisig,
  composeSinglesig,
  monthsToBlocks,
  parsePolicy,
  validateForImport,
} from '../../bitcoin/descriptor';
import type { KeyOrigin, RecoveryPathSpec } from '../../bitcoin/descriptor';
import { NoVaultSlotsError, NotInPlanError, PaymentRequiredError, VaultAllocatedError, fetchKeyEntitlement, fetchNextVaultKeys, loadSession, pollKeyEntitlement, reportKeyProof } from '../../services/companyAuth';
import type { CompanySession, IssuedVaultKeys, VaultShape } from '../../services/companyAuth';
import { issuedKeysProblem } from '../../services/issuedKeyPins';
import { NETWORK_LABELS, testNetworkFor } from '../../bitcoin/network';
import { KEY_PROOF_COPY, KEY_PROOF_POLICY, keyCheckFailedTitle } from '../../services/keyAttestation';
import {
  BUILDER_COPY,
  allocatedTitle,
  alreadyOnPhoneTitle,
  assignedOptionLabel,
  builderEverydayFingerprints,
  countsAgainstOwnPlan,
  everyBuildIsPaidByOther,
  firstUnbuiltAssigned,
  issuedVaultIsOnThisPhone,
  ownPlanCap,
  ownPlanVerdict,
  pendingClaimMatches,
  rebuildableOwnVaults,
  whichVaultToBuild,
} from '../../services/vaultAllocation';
import { clearPendingClaim, pendingClaimRecordFor, savePendingClaim } from '../../services/vaultClaim';
import { isCheckoutReturnUrl } from '../../services/deepLinks';
import {
  activePlanTier,
  createVaultQuote,
  checkoutUrlWithLogin,
  entitledVaultCount,
  fetchMyPortfolio,
  fetchSubscriptions,
  fetchVaultTesting,
  hasActiveSubscription,
  isOnboardedClient,
  OnboardingRequiredError,
  PricesChangedError,
  tierVaultLimit,
} from '../../services/billing';
import type { PlanTier, VaultConfigType } from '../../services/billing';
import { fetchProfile } from '../../services/settingsApi';

/** The warning cards' icon; the body under the title indents by it. */
const WARN_ICON_SIZE = 18;
/**
 * The step bar's Continue, and the spacer that holds its place on the last
 * step, so the step label and its dots never shift between steps: wide
 * enough for "Continue".
 */
const STEP_BUTTON_MIN_WIDTH = 122;

type Props = NativeStackScreenProps<RootStackParamList, 'LayeredVault'>;

type Scheme = 'multi-2-3' | 'multi-2-2' | 'single-1-1';

/** Site copy (vaultConfigs), adjusted for the optional co-signer. */
const SCHEMES: Array<{
  key: Scheme;
  title: string;
  subtitle: string;
  description: string;
  infoText: string;
  popular?: boolean;
  userKeys: number;
  threshold: number;
}> = [
  {
    key: 'multi-2-3',
    title: 'Multi-Signature',
    subtitle: '2 of 3',
    description:
      'Three keys: you hold two, and the third is held by 21st Capital or by you. Any two signatures spend.',
    infoText: 'Enhanced security while maintaining easy access',
    popular: true,
    userKeys: 2,
    threshold: 2,
  },
  {
    key: 'multi-2-2',
    title: 'Multi-Signature',
    subtitle: '2 of 2',
    description:
      'Two keys: you hold one, and the second is held by 21st Capital or by you. Both signatures are needed to spend.',
    infoText: 'Maximum security with shared custody',
    userKeys: 1,
    threshold: 2,
  },
  {
    // Single-sig WITH a 21st Capital rescue key (decided 2026-07-27). The
    // descriptor is still layered taproot — one key spends, and the rescue
    // key alone can recover after its timelock — so it goes through the same
    // composeLayeredVault path as every other vault here.
    key: 'single-1-1',
    title: 'Single Signature',
    subtitle: '1 of 1 + rescue',
    // The path opens per coin, never once for the vault (decided 2026-09-22);
    // the same words as the rescue step. 15 months = RESCUE_MONTHS (the
    // test lock is chosen later, on our own builds only).
    description:
      'Your one key spends on its own. A 21st Capital rescue key can bring the vault back if that key is ever lost. Its path opens only for a coin left untouched for 15 months.',
    infoText: 'Simplest to use, with a safety net if your key is lost',
    userKeys: 1,
    threshold: 1,
  },
];

interface Heir {
  method: 'assisted' | 'key';
  key?: KeyOrigin;
  months: number; // 8–15 per the site
}

/**
 * Pricing (decided 2026-07-27, authoritative). The annual fee depends on BOTH the
 * vault shape and the tier; onboarding is a flat one-off that the summary
 * must always show — it was missing before.
 *
 *   single-sig + rescue   Premium  $495 once + $195/yr
 *                          Elite    $495 once + $995/yr
 *   2-of-3 multisig       Premium  $495 once + $395/yr
 *                          Elite    $495 once + $995/yr
 *   2-of-2 multisig       ELITE ONLY — $495 once + $995/yr
 *
 * NOTE: this only ever applies to vaults holding a 21st Capital key.
 * A fully self-custodial vault is free and never reaches a price at all.
 */
const ONBOARDING_FEE = 495;
const ANNUAL: Record<
  Scheme,
  { premium: { annual: number; item: string } | null; elite: { annual: number; item: string } }
> = {
  // `item` is the EXACT backend PlanItem name — the backend bills that
  // item's base_price, so the names must match reality (a single-sig
  // Premium has its own $195 item, billing migration 0030).
  'single-1-1': {
    premium: { annual: 195, item: 'Premium Single-Sig Annual' },
    elite: { annual: 995, item: 'Elite Annual' },
  },
  'multi-2-3': {
    premium: { annual: 395, item: 'Premium Annual' },
    elite: { annual: 995, item: 'Elite Annual' },
  },
  'multi-2-2': { premium: null, elite: { annual: 995, item: 'Elite Annual' } }, // Elite only
};
/** 2-of-2 has no Premium tier — the Elite add-on is not optional there. */
function eliteForced(scheme: Scheme): boolean {
  return ANNUAL[scheme].premium == null;
}
function priceFor(scheme: Scheme, elite: boolean): {
  name: string;
  annual: number;
  onboarding: number;
  /** Backend PlanItem name for the annual line. */
  item: string;
} {
  const useElite = elite || eliteForced(scheme);
  const row = useElite ? ANNUAL[scheme].elite : (ANNUAL[scheme].premium as { annual: number; item: string });
  return {
    name: useElite ? 'Elite' : 'Premium',
    annual: row.annual,
    onboarding: ONBOARDING_FEE,
    item: row.item,
  };
}
const SUPPORT_PER_REQUEST = 200;

const RESCUE_MONTHS = 15;
/** Sentinel for an heir's test timelock. Offered on a test network, and on
 *  our own builds wherever the rescue's rehearsal lock is (decided 2026-08-30 and
 *  2026-10-18): a real client must never put a minutes-long lock on real
 *  coins, which TEST_TIMELOCKS_ENABLED (TALIA_FULL) guarantees on mainnet. */
const TEST_LOCK_MONTHS = 0;
/** An heir's test lock: two blocks, about twenty minutes. ONE block less than
 *  the rescue's so the heir's path opens first, as 12 months opens before 15
 *  in a real vault (decided 2026-10-18: "add another test timelock for heir keys
 *  after 2 blocks (20 mins) which is 10 mins earlier than 3 blocks"); with
 *  equal locks the order would rest on a stable sort alone. */
const HEIR_TEST_LOCK_BLOCKS = 2;
/** The rescue key's rehearsal lock: three blocks, about half an hour
 *  (raised from one block: more room between the steps of a ceremony). */
const RESCUE_TEST_LOCK_BLOCKS = 3;
const MAX_HEIRS = 5;

type StepId = 'scheme' | 'keys' | 'inheritance' | 'rescue' | 'elite' | 'summary';
const STEP_TITLES: Record<StepId, string> = {
  scheme: 'Basic Configuration',
  keys: 'Key Configuration',
  inheritance: 'Inheritance Planning',
  rescue: 'Rescue Key',
  elite: 'Elite Add-on',
  summary: 'Summary',
};

export function LayeredVaultScreen({ navigation, route }: Props): React.JSX.Element {
  const { addWallet, updateWallet, wallets, settings } = useWallets();

  // A shape chosen on the previous screen means step 1 is already answered
  // (decided 2026-07-27: never ask the same question twice).
  const [stepIndex, setStepIndex] = useState(route.params?.scheme ? 1 : 0);
  const [scheme, setScheme] = useState<Scheme | null>(route.params?.scheme ?? null);
  /**
   * The network this vault is BUILT on — explicit and visible (decided
   * 2026-08-27: the Ledger read silently followed Settings → Network while
   * a test account's 21C keys are testnet, so a mainnet-defaulted phone
   * mixed a mainnet Ledger key with testnet co-signer keys). One choice up
   * front now drives the Ledger's Bitcoin app, the derivation coin type,
   * AND which 21C keys are fetched.
   */
  const [vaultNetwork, setVaultNetwork] = useState<'bitcoin' | 'test'>(
    (settings.defaultNetwork ?? 'bitcoin') === 'bitcoin' ? 'bitcoin' : 'test',
  );
  /** The concrete test network: Testnet4, the only one Talia offers (decided
   *  2026-10-18: "remove signet, keep only bitcoin and testnet4"). */
  const testNetwork = testNetworkFor(settings.defaultNetwork);
  const activeNetwork = vaultNetwork === 'bitcoin' ? 'bitcoin' : testNetwork;

  /** The visible network chooser — on the scheme step, and again on the keys
   *  step for entries that skipped straight to a preset shape. Hidden once a
   *  key is placed: switching networks under collected keys is a footgun. */
  const netChooser = (
    <>
      <View style={styles.netRow}>
        {(
          [
            { key: 'bitcoin', label: NETWORK_LABELS.bitcoin },
            { key: 'test', label: NETWORK_LABELS.testnet },
          ] as const
        ).map((n) => (
          <TouchableOpacity
            key={n.key}
            style={[
              styles.netChip,
              n.key === 'test' && styles.netChipTest,
              vaultNetwork === n.key && styles.netChipOn,
            ]}
            onPress={() => {
              setVaultNetwork(n.key);
              // A heir's test lock chosen on a test network must NOT survive a
              // switch to mainnet where the chip is not offered: it would sit
              // selected and invisible on a real vault (decided 2026-08-30). Our own
              // builds offer it on mainnet too, so there it stays.
              if (n.key === 'bitcoin' && !TEST_TIMELOCKS_ENABLED) {
                setHeirs((prev) =>
                  prev.map((h) => (h.months === TEST_LOCK_MONTHS ? { ...h, months: 12 } : h)),
                );
              }
            }}>
            <Text style={[styles.monthText, vaultNetwork === n.key && styles.monthTextOn]}>
              {n.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {vaultNetwork === 'test' && (
        <InfoHeading
          title={NETWORK_LABELS.testnet}
          text="Nothing here is real money. Your hardware runs its test app, and test versions of the 21st Capital keys are used, so you can practise the whole setup safely."
          style={styles.testLockHint}>
          The coins here are worthless practice coins.
        </InfoHeading>
      )}
    </>
  );
  const [userKeys, setUserKeys] = useState<KeyOrigin[]>([]);
  /** Third/second key: 21st Capital (site default) or the user's own. */
  const [coSignerMode, setCoSignerMode] = useState<'21c' | 'self'>('21c');
  const [coSignerKey, setCoSignerKey] = useState<KeyOrigin | null>(null);
  const [inheritance, setInheritance] = useState<boolean | null>(null);
  const [heirs, setHeirs] = useState<Heir[]>([{ method: 'key', months: 12 }]);
  /** The ONE way to change one heir. */
  const editHeir = (i: number, change: (h: Heir) => Heir) => {
    setHeirs((prev) => prev.map((h, j) => (j === i ? change(h) : h)));
  };
  const [rescue, setRescue] = useState<boolean | null>(null);
  /** The rescue key's lock shrunk to three blocks, for a mainnet rehearsal of
   *  the rescue path. Offered only on our own builds (TEST_TIMELOCKS_ENABLED)
   *  and never carried into a client's vault by default. */
  const [rescueTestLock, setRescueTestLock] = useState(false);
  const [rescueKey, setRescueKey] = useState<KeyOrigin | null>(null);
  // Fingerprints of the 21C-issued keys placed via fetch — the customer
  // never registers the descriptor on 21C's hardware (decided 2026-07-20).
  const providerFps = useRef<Set<string>>(new Set());
  // Inline sign-up / sign-in — a not-logged-in user auths in place and the
  // fetch continues, no bouncing to the website (decided 2026-07-20).
  const [authOpen, setAuthOpen] = useState(false);
  // The field being typed in and the button under it both stay above the
  // keyboard (decided 2026-09-18). Create is pinned in the step bar, which rises
  // above the keys on its own (below), so only the vault-name field has to
  // scroll clear of the fade.
  const revealScrollRef = useRef<ScrollView | null>(null);
  const revealOffsetY = useRef(0);
  useRevealFocusedField(revealScrollRef, revealOffsetY, true, { confirmPinned: true });
  const insets = useSafeAreaInsets();
  const kbHeight = useKeyboardHeight();

  const [eliteAddon, setEliteAddon] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<{
    title: string;
    message: string;
    /** A mandatory dialog can't be dismissed by tapping the backdrop — the
     *  2FA gate is a MUST, not a suggestion (decided 2026-07-27). */
    mandatory?: boolean;
    actions: Array<{ label: string; variant?: 'primary' | 'ghost'; destructive?: boolean; onPress: () => void }>;
  } | null>(null);
  const [fetchingKeys, setFetchingKeys] = useState(false);
  /** Which vault slot this build claimed, and the account number behind it.
   *  Refs, not state: they must survive a re-render mid-creation, and a retry
   *  must re-fetch the SAME vault instead of consuming the next number. */
  const claimedVaultNumber = useRef<number | null>(null);
  const claimedAccount = useRef<number | null>(null);
  /** The network the last key claim asked for, so the post-checkout poll
   *  asks the entitlement probe about the same one. */
  const claimNetworkRef = useRef<'mainnet' | 'testnet4'>('mainnet');
  /** The PAID portfolio the backend attached this vault to at claim time
   *  (decided 2026-09-03): the app never mints a portfolio per build any more. */
  const claimedPortfolioId = useRef<string | null>(null);
  /** Whose plan the claimed keys belong to when this client holds the vault
   *  as a family member (decided 2026-09-19). */
  const claimedHeldOf = useRef<string | null>(null);
  /** Which vault is being built: undefined = nobody has said yet, null = a
   *  vault of the client's own plan, a number = the payer of a vault that
   *  is for this client (its number in claimHeldVault). The family
   *  member's first run arrives with it already picked (route `assigned`). */
  const claimHeldOf = useRef<number | null | undefined>(route.params?.assigned?.payerId);
  const claimHeldVault = useRef<number | undefined>(route.params?.assigned?.vaultNumber);
  /** That payer's email, which is what a vault on this phone records
   *  (`heldOf`): '' for the client's own plan, undefined while unknown. */
  const claimHeldEmail = useRef<string | undefined>(route.params?.assigned?.payerEmail);
  /** This build is a vault somebody else pays for (decided 2026-09-20): its
   *  owner is never shown a price, a plan card, an upgrade or a checkout.
   *  State beside the refs above because the steps and the summary draw
   *  from it. Known from the start on the family member's first run. */
  const [paidByOther, setPaidByOther] = useState(route.params?.assigned != null);

  const [keyTarget, setKeyTarget] = useState<
    // A user slot names the index it replaces when the tap was on a key
    // already there (decided 2026-09-25: "he can simply click the key").
    { kind: 'user'; replaceIndex?: number } | { kind: 'coSigner' } | { kind: 'heir'; index: number } | null
  >(null);

  const spec = SCHEMES.find((s) => s.key === scheme);
  /** Only shapes with threshold > 1 have a second-signer slot AT ALL. A
   *  single-sig vault must never inherit the co-signer default — that
   *  phantom co-signer was a bug caught on a screenshot (2026-07-27). */
  const hasCoSignerSlot = !!spec && spec.threshold > 1;
  // 2-of-2 requires the rescue key ONLY when no heir key stands behind it
  // (decided 2026-07-24, reconfirmed 2026-07-27): a bare 2-of-2 can blow up with
  // no recovery at all, but a keyed heir IS a recovery path.
  const hasKeyedHeir = inheritance === true && heirs.some((h) => h.method === 'key');
  /**
   * The derivation rule (decided 2026-07-27, absolute): the single-sig account
   * (86') is allowed ONLY when the vault has no timelock whatsoever. The
   * moment ANY timelock exists — the rescue key OR a keyed heir — every key
   * must come from the multisig account (48'/2') to stay Liana-compatible.
   */
  const needsMultisigKey = scheme !== 'single-1-1' || rescue === true || hasKeyedHeir;
  /**
   * A PLAIN one-key vault takes the BIP-84 native-segwit account (decided
   * 2026-07-27): p2wpkh/HD is the standard among the single-sig apps people
   * actually use — BlueWallet, Sparrow — and it gives proper wallet
   * discovery later. Taproot is for the layered and multisig shapes, which
   * take the 48'/2' account anyway.
   */
  const keyAccount: 'bip84' | 'bip86' | 'bip48_2' = needsMultisigKey ? 'bip48_2' : 'bip84';
  const isMultiAccount = (k: KeyOrigin) => /^48['h]/.test(k.originPath ?? '');
  /**
   * The rescue key turns a single-sig vault into a taproot multisig, which
   * needs the 48'/2' account instead of 86'. The Coldcard's Generic JSON
   * export already contains BOTH, so when we still hold the export we just
   * swap the account — the client is never asked to export again. Only a
   * pasted bare xpub (no export to draw on) needs a fresh one.
   */
  useEffect(() => {
    // BOTH directions (decided 2026-07-27): rescue/heir toggled ON swaps 86'→48',
    // toggled back OFF swaps 48'→86' — one-way left a wpkh vault composed on
    // the multisig account. Export-backed keys swap silently; only a pasted
    // bare xpub (nothing to draw on) leaves a mismatch for the user to fix.
    if (userKeys.length === 0) return;
    const fits = (k: KeyOrigin) =>
      needsMultisigKey ? isMultiAccount(k) : !isMultiAccount(k);
    if (userKeys.every(fits)) return;
    let swappedAll = true;
    const next = userKeys.map((k) => {
      if (fits(k)) return k;
      const cc = k.fingerprint ? exportsByFp.current[k.fingerprint.toLowerCase()] : undefined;
      const acct = needsMultisigKey ? cc?.bip48_2 : cc?.bip84 ?? cc?.bip86;
      if (!cc || !acct) {
        swappedAll = false;
        return k;
      }
      return { fingerprint: cc.fingerprint, originPath: acct.originPath, xpub: acct.xpub };
    });
    if (swappedAll) setUserKeys(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsMultisigKey]);

  /** A key on the WRONG account for the current shape that we could not
   *  swap automatically — must be re-exported (checked both directions). */
  const keyAccountMismatch = useMemo(() => {
    if (userKeys.length === 0) return false;
    return needsMultisigKey
      ? !userKeys.every(isMultiAccount)
      : userKeys.some(isMultiAccount);
  }, [userKeys, needsMultisigKey]);

  // TESTING ONLY (decided 2026-07-26, 2026-10-18): TEST_LOCK_MONTHS is an heir's
  // 20-minute test lock, older(2), one block before the rescue's rehearsal
  // lock, so the whole heir-invite ceremony (incl. the strict-mode release)
  // and a two-path rescue can be exercised end-to-end without waiting months.
  // Remove or testnet-gate this before real clients configure vaults.
  const heirOlderBlocks = (months: number): number =>
    months === TEST_LOCK_MONTHS ? HEIR_TEST_LOCK_BLOCKS : monthsToBlocks(months);
  /** The rescue key's own lock: 15 months, or the test lock when this build
   *  offers it and the client picked it (decided 2026-09-16, a mainnet rehearsal
   *  of the rescue path). Both the descriptor and the summary read it here,
   *  so the screen can never say one thing and build another. */
  const rescueBlocks = rescueTestLock ? RESCUE_TEST_LOCK_BLOCKS : monthsToBlocks(RESCUE_MONTHS);
  /** Whether an heir may take the test lock: on a test network, and on our
   *  own builds (TALIA_FULL) wherever the rescue's rehearsal lock is offered,
   *  so a mainnet rehearsal can open the heir's path before the rescue's. */
  const heirTestLockOffered = vaultNetwork !== 'bitcoin' || TEST_TIMELOCKS_ENABLED;
  /** "15 months", or what the test lock really means, for the copy. */
  const rescueOpensIn = rescueTestLock ? 'about 30 minutes' : '15 months';
  // Only a bare 2-of-2 truly needs it: BOTH keys are required to spend, so
  // losing either would lock the funds. A single-key vault loses nothing by
  // declining — the rescue key is an OPTIONAL upgrade there (decided 2026-07-27).
  const rescueMandatory = scheme === 'multi-2-2' && !hasKeyedHeir;
  // Guarantee it stays on for 2-of-2 even if the user came via a back-nav —
  // and RELEASE it when the obligation lifts (a keyed heir added later), so
  // the machine's answer is never mistaken for the client's consent to a
  // paid service (decided 2026-07-27).
  const rescueWasForced = useRef(false);
  React.useEffect(() => {
    if (rescueMandatory && rescue !== true) {
      rescueWasForced.current = true;
      setRescue(true);
    } else if (!rescueMandatory && rescueWasForced.current) {
      rescueWasForced.current = false;
      setRescue(null);
      setRescueKey(null);
    }
  }, [rescueMandatory, rescue]);
  /** 21st Capital actually CO-SIGNS this vault (a real second-signer slot,
   *  assigned to us). Distinct from uses21C: a rescue-only vault is ours to
   *  protect but priced by the SERVICE, not the shape (decided 2026-07-27). */
  const cosigns21C = hasCoSignerSlot && coSignerMode === '21c';
  // The rule: as long as none of our keys are selected, the app is free
  // and fully self-custodial. The co-signer default can never leak into a
  // shape that has no co-signer slot.
  const uses21C = cosigns21C || rescue === true;

  // The client's CURRENT plan tier (decided 2026-07-26): an Elite/Elite Plus
  // subscriber must not be pitched the Elite upsell they already pay for.
  const [currentTier, setCurrentTier] = useState<PlanTier | null>(null);
  /** null while unknown: signed out, or signed in with no plan on file. */
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  /** The client has been through onboarding, so the $495 fee is left out
   *  (once per client, decided 2026-07-27). The server's answer decides
   *  (isOnboardedClient): a PENDING or FAILED checkout, or a plan somebody
   *  else pays for, is no history, and the checkout refuses such an order. */
  const [returningClient, setReturningClient] = useState(false);
  /** Re-read the client's plan. Called on mount AND after any in-flow
   *  sign-in: creation is designed to work logged out (the free rule), so
   *  mount time is exactly when we usually know nothing (decided 2026-07-27). */
  const refreshPlanContext = useCallback(async () => {
    try {
      const session = await loadSession();
      // null until we have looked. A plan of null means two different things
      // and the client needs different words for each (decided 2026-09-18).
      setSignedIn(!!session);
      if (!session) return;
      const [subs, profile, ent] = await Promise.all([
        fetchSubscriptions(session),
        fetchProfile(session).catch(() => null),
        fetchKeyEntitlement(session).catch(() => null),
      ]);
      // A Lifetime Elite member IS Elite (no subscription row): never
      // pitched the Elite upsell they already hold (decided 2026-09-04).
      const tier = activePlanTier(subs, new Date(), profile?.lifetimeElite === true);
      setCurrentTier(tier);
      setReturningClient(
        isOnboardedClient(ent?.onboarded, subs, profile?.lifetimeElite === true),
      );
      if (tier === 'elite' || tier === 'elite-plus') setEliteAddon(true);
      // A person with no plan of their own who owns an assigned vault came
      // in through "+": whatever they build with our keys is paid for by
      // somebody else, so nothing here is priced or sold to them.
      if (claimHeldOf.current === undefined) {
        if (everyBuildIsPaidByOther(ent)) setPaidByOther(true);
      }
    } catch {
      // best-effort — an unknown tier just shows the normal flow
    }
  }, []);
  useEffect(() => {
    void refreshPlanContext();
  }, [refreshPlanContext]);
  const alreadyElite = currentTier === 'elite' || currentTier === 'elite-plus';

  // The Elite step only exists when 21st Capital services are involved —
  // and never for a client whose active plan already includes Elite.
  const steps: StepId[] = useMemo(
    () =>
      // No Elite step when: no 21C keys (free vault), the client is already
      // Elite, or the PRICED shape has no Premium tier to choose from —
      // note a rescue-only vault prices as single-sig, so it always has the
      // Premium/Elite choice even on a 2-of-2 shape (decided 2026-07-27).
      // The Elite step is an upsell, so it is skipped entirely while nothing
      // can be bought in the app (App Store build).
      // Never for a vault somebody else pays for: its owner is sold nothing.
      PURCHASES_ENABLED &&
      uses21C &&
      !alreadyElite &&
      !paidByOther &&
      !(cosigns21C && scheme && eliteForced(scheme))
        ? ['scheme', 'keys', 'inheritance', 'rescue', 'elite', 'summary']
        : ['scheme', 'keys', 'inheritance', 'rescue', 'summary'],
    [uses21C, alreadyElite, paidByOther, cosigns21C, scheme],
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  // The vault name is the summary step's one field and its LAST row (found
  // 2026-10-15: "The name field of the vault at the last screen on the vault
  // setup falls behind the vault creation button"). The reveal above measures
  // once, as the keyboard lands; the step bar's rise could still cover the
  // field after that. With the keys up on that step the page simply ends at
  // the bar: scrolled to its end, the field and its room sit just above
  // Create, whatever was measured first.
  useEffect(() => {
    if (step !== 'summary' || kbHeight <= 0) return;
    const toEnd = () => revealScrollRef.current?.scrollToEnd({ animated: true });
    const early = setTimeout(toEnd, 80);
    const settled = setTimeout(toEnd, 360);
    return () => {
      clearTimeout(early);
      clearTimeout(settled);
    };
  }, [step, kbHeight]);
  // The list can shrink under the client (the Elite step goes once the
  // build turns out to be a vault somebody else pays for): keep the index
  // on a real step, or the next Back press would do nothing.
  useEffect(() => {
    setStepIndex((i) => Math.min(i, steps.length - 1));
  }, [steps.length]);

  const allKeys = useMemo(() => {
    const keys = [...userKeys];
    // A co-signer key can only belong to a shape that HAS a co-signer slot —
    // anything else is stale state from a scheme change or a stray fetch.
    if (coSignerKey && hasCoSignerSlot) keys.push(coSignerKey);
    heirs.forEach((h) => h.key && keys.push(h.key));
    if (rescueKey) keys.push(rescueKey);
    return keys;
  }, [userKeys, coSignerKey, hasCoSignerSlot, heirs, rescueKey]);

  // MANDATORY labels (decided 2026-07-18): every self-provided key gets a human
  // name before it lands in the vault — the ceremony speaks in these.
  const [userKeyLabels, setUserKeyLabels] = useState<Record<string, string>>({});

  // ONE label per key fingerprint, shared by the policy summary and the
  // created wallet (the ceremony and registration wizard speak in these).
  // User-chosen labels win; contextual fallbacks cover keys that never went
  // through the label prompt (21C-issued, heirs).
  const keyLabelByFp = useMemo(() => {
    const labels: Record<string, string> = {};
    const tag = (k: KeyOrigin | null | undefined, label: string) => {
      const fp = k?.fingerprint?.toLowerCase();
      if (fp && !labels[fp]) labels[fp] = label;
    };
    for (const [fp, label] of Object.entries(userKeyLabels)) {
      if (!labels[fp]) labels[fp] = label;
    }
    userKeys.forEach((k, i) => tag(k, userKeys.length > 1 ? `Your key ${i + 1}` : 'Your key'));
    // The same slot name the key step and the graph use for it.
    tag(coSignerKey, coSignerMode === '21c' ? '21st Capital co-signer' : 'Your extra key');
    heirs.forEach((h, i) =>
      tag(h.key, `Heir ${i + 1}`),
    );
    tag(rescueKey, '21st Capital rescue key');
    return labels;
  }, [userKeyLabels, userKeys, coSignerKey, coSignerMode, heirs, rescueKey]);
  const [pendingLabel, setPendingLabel] = useState<{
    target: NonNullable<typeof keyTarget>;
    key: KeyOrigin;
    warnings: string[];
  } | null>(null);
  /** What each device called itself when it handed its key over, by
   *  fingerprint: the label prompt opens with it rather than empty (decided
   *  2026-09-09, the same rule the import follows). */
  const deviceNamesRef = useRef<Record<string, string>>({});

  /** Full Coldcard exports, by fingerprint: they carry every account, so
   *  turning the rescue key on can switch a single-sig key to the multisig
   *  one WITHOUT asking for another export (decided 2026-07-27). */
  const exportsByFp = useRef<Record<string, ColdcardExport>>({});
  /** Keys proven to live on a Ledger during THIS build — written to the
   *  vault as keyDevices after creation so Bluetooth signing/co-signing
   *  and address checks light up immediately (decided 2026-08-26). */
  const bleBoundRef = useRef<Record<string, KeyDevice>>({});
  /** WHICH physical device (BLE id) each fetched key came from, so the
   *  search list can mark a device already spent on this vault instead of
   *  letting it be picked again just to hit the same-key gate (decided
   *  2026-08-31). Session-only; never persisted. */
  const bleIdsRef = useRef<Record<string, string>>({});
  /** BLE ids of devices whose key currently sits in the build. Derived per
   *  call so removing or replacing a key frees its device again. */
  const usedDeviceIds = (): ReadonlySet<string> => {
    const placedFps = new Set(
      [
        ...userKeys,
        // A slot-less co-signer key is stale state from a scheme change and
        // never reaches the descriptor — its device is NOT spent.
        ...(hasCoSignerSlot ? [coSignerKey] : []),
        rescueKey,
        ...heirs.map((h) => h.key),
      ]
        .map((k) => k?.fingerprint?.toLowerCase())
        .filter((fp): fp is string => !!fp),
    );
    return new Set(
      Object.entries(bleIdsRef.current)
        .filter(([fp]) => placedFps.has(fp))
        .map(([, id]) => id),
    );
  };
  const placeKey = (key: KeyOrigin, warnings: string[], fullExport?: ColdcardExport) => {
    if (fullExport && key.fingerprint) {
      exportsByFp.current[key.fingerprint.toLowerCase()] = fullExport;
    }
    if (!keyTarget) return;
    // The derivation rule at the door: a co-signer key joins a multisig by
    // definition, an heir key implies a timelock — both must be the 48'
    // account. Swap silently from the export when we hold it; otherwise
    // refuse with directions rather than let a wrong key poison the vault.
    const mustBeMulti = keyTarget.kind !== 'user' || needsMultisigKey;
    if (mustBeMulti && !key.fingerprint) {
      setError(
        'This vault needs the key WITH its fingerprint. Export the Generic ' +
          'JSON from the device rather than pasting a bare xpub. We read ' +
          'the right part automatically.',
      );
      setKeyTarget(null);
      return;
    }
    // A missing origin fails the rule too: we cannot prove it is the 48'
    // account, and an unproven key in a timelocked vault is unsignable.
    if (mustBeMulti && !/^48['h]/.test(key.originPath ?? '')) {
      const cc =
        fullExport ??
        (key.fingerprint ? exportsByFp.current[key.fingerprint.toLowerCase()] : undefined);
      if (cc?.bip48_2) {
        key = { fingerprint: cc.fingerprint, originPath: cc.bip48_2.originPath, xpub: cc.bip48_2.xpub };
      } else {
        setError(
          "That's the single-signature key. This vault needs the multi-key " +
            'account, so export the Generic JSON from the device and we pick ' +
            'the right key automatically.',
        );
        setKeyTarget(null);
        return;
      }
    }
    // And the reverse: a plain single-sig vault (no timelock anywhere) takes
    // the ordinary account, never the multisig one.
    if (!mustBeMulti && /^48['h]/.test(key.originPath ?? '')) {
      const cc =
        fullExport ??
        (key.fingerprint ? exportsByFp.current[key.fingerprint.toLowerCase()] : undefined);
      const solo = cc?.bip84 ?? cc?.bip86;
      if (cc && solo) {
        key = { fingerprint: cc.fingerprint, originPath: solo.originPath, xpub: solo.xpub };
      } else {
        setError(
          "That's the multi-key account. Without a timelocked layer this " +
            "vault uses your device's ordinary single-signature key. Export " +
            'the Generic JSON and we pick the right one.',
        );
        setKeyTarget(null);
        return;
      }
    }
    // An heir's (or a self-held co-signer's) key must live on a DIFFERENT
    // device than the owner's own keys — same device, same seed, no extra
    // safety. Catch it by FINGERPRINT: a different account on the same
    // device would slip past an xpub comparison (decided 2026-08-26). The
    // test-lock rehearsal exception was RETIRED the day it shipped (decided
    // 2026-08-31): with a third Bluetooth device on the desk, a drill heir
    // gets a real device too, so the rule is absolute again.
    if (
      keyTarget.kind !== 'user' &&
      key.fingerprint &&
      userKeys.some((k) => k.fingerprint?.toLowerCase() === key.fingerprint?.toLowerCase())
    ) {
      setError(
        keyTarget.kind === 'heir'
          ? 'That is the same device as one of your own keys. An heir’s key must live on a different device.'
          : 'That is the same device as one of your own keys. A second signature is only real if it comes from a different device.',
      );
      setKeyTarget(null);
      return;
    }
    if (allKeys.some((k) => k.xpub === key.xpub)) {
      // A vault's keys must be genuinely different devices/seeds — the same
      // device at the same account always yields the SAME key, which would
      // make a 2-of-3 no safer than a 1-of-1 (decided 2026-08-26).
      setError(
        'That key is already part of this vault. Each key must come from a ' +
          'different device. Use another device for this slot, or the ' +
          'same one unlocked with a different passphrase.',
      );
      setKeyTarget(null);
      return;
    }
    setError(null);
    // The key sheet's modal must finish dismissing before the label dialog
    // can present (iOS modal-stacking rule).
    const target = keyTarget;
    setKeyTarget(null);
    setTimeout(() => setPendingLabel({ target, key, warnings }), 450);
  };

  const commitLabeledKey = (label: string) => {
    if (!pendingLabel) return;
    // A device used in another person's vault is never raised with the
    // client (decided 2026-09-21: "its enough that we already notify staff on the
    // staff dashboard"); the claim still sends the builder's fingerprints
    // and the backend flags the repeat for our team.
    placeLabeledKey(pendingLabel, label);
  };

  const placeLabeledKey = (held: NonNullable<typeof pendingLabel>, label: string) => {
    const { target, key, warnings } = held;
    const fp = key.fingerprint?.toLowerCase();
    if (fp) setUserKeyLabels((prev) => ({ ...prev, [fp]: label.trim() }));
    if (target.kind === 'user') {
      const at = target.replaceIndex;
      setUserKeys((prev) => {
        if (at != null && at < prev.length) {
          const next = [...prev];
          next[at] = key;
          return next;
        }
        return [...prev, key];
      });
    }
    else if (target.kind === 'coSigner') setCoSignerKey(key);
    else {
      const i = target.index;
      editHeir(i, (h) => ({ ...h, key }));
    }
    setPendingLabel(null);
    if (warnings.length > 0) {
      setTimeout(
        () =>
          setDialog({
            title: 'Heads up',
            message: warnings.join('\n\n'),
            actions: [{ label: 'OK', onPress: () => {} }],
          }),
        450,
      );
    }
  };

  const keyedHeirs = useMemo(
    () => (inheritance ? heirs.filter((h) => h.method === 'key') : []),
    [inheritance, heirs],
  );

  /** 21st Capital keys the backend still needs to issue (no manual entry).
   *  The co-signer clause exists ONLY for shapes with a co-signer slot —
   *  without the guard a free single-sig could never reach its Create
   *  button (a bug found 2026-07-27). */
  const pendingIssuance =
    (hasCoSignerSlot && coSignerMode === '21c' && !coSignerKey) ||
    (rescue === true && !rescueKey);

  /** Assisted heirs are a 21st Capital estate service — they need a 21C key
   *  in the vault. Declining the rescue key on an otherwise self-custodial
   *  vault would leave the assisted heir with nothing to act on (R7). */
  const assistedNeeds21C =
    inheritance === true &&
    heirs.some((h) => h.method === 'assisted') &&
    !cosigns21C &&
    rescue === false;

  const stepValid = (() => {
    switch (step) {
      case 'scheme':
        return scheme !== null;
      case 'keys':
        return (
          !!spec &&
          userKeys.length === spec.userKeys &&
          // Single-sig has no second signer at all.
          (spec.threshold === 1 || coSignerMode !== 'self' || !!coSignerKey)
        );
      case 'rescue':
        // Three gates: the rescue question must be ANSWERED (a silent
        // default is not consent); the keys must be on the account the
        // shape needs (the derivation rule); and an assisted heir — a 21C
        // service — can't ride a vault holding no 21C key.
        return rescue !== null && !keyAccountMismatch && !assistedNeeds21C;
      case 'inheritance':
        return (
          inheritance !== null &&
          (!inheritance ||
            heirs.every((h) => h.method === 'assisted' || !!h.key))
        );
      case 'elite':
        return eliteAddon !== null;
      default:
        return true;
    }
  })();

  const rescueRecommended = inheritance === false || (inheritance === true && keyedHeirs.length === 0);

  // Price follows the SERVICE taken, not just the shape (decided 2026-07-27):
  // when 21C co-signs, the shape's rate applies (2-of-2 is Elite-only); when
  // the ONLY 21C key is the rescue key — whatever the shape — it is the
  // rescue rate ($195), same as single-sig + rescue. And the $495 onboarding
  // is once per CLIENT: a returning client (any subscription history) never
  // pays it again.
  const priceScheme: Scheme | null = !scheme ? null : cosigns21C ? scheme : 'single-1-1';
  const tier =
    uses21C && priceScheme
      ? (() => {
          const base = priceFor(priceScheme, eliteAddon === true);
          return returningClient ? { ...base, onboarding: 0 } : base;
        })()
      : null;

  /** The vault these keys compose into: the ONE composer the real preview
   *  and the summary's display-only picture share. `coSigner` is null only
   *  for a lone-key vault; `rescueK` null means no rescue path. */
  const composeVaultWith = (
    coSigner: KeyOrigin | null,
    rescueK: KeyOrigin | null,
    fps: Set<string>,
  ): string => {
    const soloPrimary = spec!.threshold === 1;
    const primaryKeys = soloPrimary ? [...userKeys] : [...userKeys, coSigner!];
    const recoveries: RecoveryPathSpec[] = keyedHeirs
      .filter((h) => h.key)
      .map((h) => ({ threshold: 1, keys: [h.key!], olderBlocks: heirOlderBlocks(h.months) }));
    if (rescue && rescueK) {
      recoveries.push({ threshold: 1, keys: [rescueK], olderBlocks: rescueBlocks });
    }
    // A PLAIN multisig that holds none of our keys is built the standard
    // way — wsh(sortedmulti), which Sparrow, Nunchuk and the COLDCARD read
    // natively (decided 2026-07-28). The moment one of OUR keys is in it, it must
    // stay taproot: blind co-signing signs script paths. Anything layered
    // (timelocked) is the Liana taproot tree either way.
    return recoveries.length === 0
      ? // No rescue key and no heir keys: a lone key is a plain
        // single-sig vault, not a 1-of-1 "multisig" (which would throw).
        soloPrimary
        ? composeSinglesig(primaryKeys[0])
        : composeMultisig(spec!.threshold, primaryKeys, {
            script: cosigns21C ? 'tr' : 'wsh',
            providerFingerprints: fps,
          })
      : composeLayeredVault({ threshold: spec!.threshold, keys: primaryKeys }, recoveries);
  };

  const preview = useMemo(() => {
    // A single-sig vault's primary path is the user's key ALONE — there is
    // no second signer to wait for (decided 2026-07-27).
    const soloPrimary = spec?.threshold === 1;
    if (!spec || userKeys.length !== spec.userKeys || (!soloPrimary && !coSignerKey)) return null;
    // A chosen rescue key that has not ARRIVED yet is not "no rescue key": for
    // a 2-of-2 that distinction is the difference between a legal vault and a
    // dead end the composer refuses, so wait rather than preview an error the
    // user cannot act on (decided 2026-07-28).
    if (rescue === true && !rescueKey) return null;
    try {
      const descriptor = composeVaultWith(coSignerKey, rescueKey, providerFps.current);
      return { descriptor, policy: parsePolicy(descriptor), issue: null as string | null };
    } catch (e) {
      return { descriptor: null, policy: null, issue: (e as Error).message };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, userKeys, coSignerKey, cosigns21C, keyedHeirs, rescue, rescueKey, rescueBlocks]);

  /**
   * The vault overview, grown one step at a time (decided 2026-09-25): the same
   * lanes the Estate Plan draws, from the draft as it stands. Empty slots
   * are drawn empty, our keys as stand-ins until creation, and a question
   * not answered yet as an outline. Display only: creation uses `preview`.
   */
  const graph = useMemo(
    () =>
      spec
        ? vaultGraphRows({
            ownKeys: spec.userKeys,
            threshold: spec.threshold,
            userKeys,
            coSignerMode,
            coSignerKey,
            inheritance,
            heirs,
            rescue,
            rescueKey,
            rescueMonths: RESCUE_MONTHS,
            rescueTestLock,
            testLockMonths: TEST_LOCK_MONTHS,
            keyLabels: keyLabelByFp,
          })
        : null,
    [spec, userKeys, coSignerMode, coSignerKey, inheritance, heirs, rescue, rescueKey, rescueTestLock, keyLabelByFp],
  );
  // One step, one path (decided 2026-09-25): the key step draws the primary
  // path alone, the heirs step the heir lanes, the rescue step the rescue
  // lane, and the summary everything coming together. A step with nothing
  // of its own to draw (inheritance declined) shows no graph.
  const graphFocus: GraphFocus =
    step === 'keys' ? 'primary' : step === 'inheritance' ? 'heirs' : step === 'rescue' ? 'rescue' : 'all';
  // On the key step the graph IS the key section (decided 2026-09-25: "we can
  // build the add key section inside the graph itself"): an outline row
  // adds its key, a filled row replaces it in place, and the extra key's
  // holder is picked between two rows shown together.
  const graphActions =
    step === 'keys'
      ? {
          onAdd: (slot: KeySlot) => setKeyTarget(slot.kind === 'user' ? { kind: 'user' } : { kind: 'coSigner' }),
          onReplace: (slot: KeySlot) =>
            setKeyTarget(slot.kind === 'user' ? { kind: 'user', replaceIndex: slot.index } : { kind: 'coSigner' }),
          onPickHolder: (which: 'ours' | 'own') => {
            const mode = which === 'ours' ? '21c' : 'self';
            if (mode === coSignerMode) return;
            setCoSignerMode(mode);
            setCoSignerKey(null);
          },
        }
      : undefined;
  // WHERE it sits, one rule for every step (decided 2026-09-25: "please move the
  // overview graph on the page to the bottom. It confuses the user a bit
  // when inheritance is enabled because everythoing start to move down"):
  // ABOVE the controls only where the graph IS the thing being made, which
  // is the key step (its rows are the controls) and the summary (it is the
  // answer). On a step that ASKS something, the graph is a picture of the
  // answer and it is DOCKED to the bottom edge (decided the same day: "yes, make it
  // stick to the bottom edge while scrolling"), outside the scroll view and
  // above the footer, so the answer is always in view and the choices never
  // move when one is made. The form scrolls behind it and dissolves into it.
  // The docked picture shows EVERY lane of the step, and the client folds
  // it away when the form needs the screen (decided 2026-09-25: "Please use the
  // sticky with all heirs however, let the user collapse the window down
  // and bring it back up if he needs more space"). Showing one heir at a
  // time was tried first and rejected: the picture is the whole
  // plan, and the room is the client's to reclaim, not ours to decide.
  // NOTHING is docked until the step's own question is answered YES (decided
  // 2026-09-25: "please dont show anything before the client has not picked
  // yes or no. Only show the bar as soon as he clicks yes"). Before that the
  // card was an outlined "Not chosen yet" lane, taking room from the two
  // choices it belongs to and saying nothing the choices do not. A "no"
  // draws nothing either, because there is then no path to draw.
  const graphDocked =
    step === 'elite' ||
    (step === 'inheritance' && inheritance === true) ||
    (step === 'rescue' && rescue === true);
  const graphCard = graph ? (
    <VaultGraph
      rows={focusedRows(graph.rows, graphFocus)}
      focus={graphFocus}
      actions={graphActions}
      foldable={graphDocked}
    />
  ) : null;

  /** The shape is fully described and every key of the client's is in: what
   *  the Create button needs before it fetches our keys. */
  const draftComplete =
    !!spec &&
    userKeys.length === spec.userKeys &&
    (spec.threshold === 1 || !!coSignerKey || coSignerMode === '21c');

  /** One button does it all (decided 2026-08-31): Create fetches the 21st
   *  Capital keys, then falls straight through to the test-vault warning
   *  and creation. Armed by the button; fires when the fetched keys make
   *  the real preview compose. Cleared when a fetch ends with keys still
   *  missing, so a later unrelated compose never creates by surprise. */
  const [createAfterFetch, setCreateAfterFetch] = useState(false);
  const onCreateRef = useRef<null | (() => void)>(null);
  useEffect(() => {
    if (!createAfterFetch) return;
    // Wait for the fetch to SETTLE. Mid-fetch renders already hold the
    // placed keys, but the plan-checkout decision has not happened yet:
    // deciding then would let the offer dialog land on top of the
    // test-vault warning. A test account never shows the offer (decided
    // 2026-08-31) — only paying clients would have hit this.
    if (fetchingKeys) return;
    setCreateAfterFetch(false);
    // Only a SILENT fetch falls through: when the fetch itself put up a
    // dialog (the checkout offer, a missing key), the owner answers it
    // and taps Create again. A compose refusal already renders as the
    // red issue text.
    if (preview?.descriptor && dialog == null) onCreateRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createAfterFetch, preview, fetchingKeys]);
  // Any step navigation disarms the pending auto-create: a Create tapped
  // on the summary must never fire after the owner walked away to edit
  // keys mid-fetch (decided 2026-08-31).
  useEffect(() => {
    setCreateAfterFetch(false);
  }, [stepIndex]);

  // "Talk to us" in the builds that sell nothing (2026-09-12) is a call
  // booked IN THE APP, the same scheduler as support: the plan is shown,
  // never sold. Every caller already holds a session; without one, or
  // without the booking link's token, the booking page opens instead, as
  // the support screen does.
  const [booking, setBooking] = useState(false);
  const [bookingSession, setBookingSession] = useState<CompanySession | null>(null);
  const bookingToken = useMemo(() => {
    const m = /\/book-appointment\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i.exec(
      SUPPORT.scheduleCallUrl,
    );
    return m ? m[1] : null;
  }, []);
  const openBooking = async () => {
    const s = await loadSession();
    if (!s || !bookingToken) {
      void Linking.openURL(SUPPORT.scheduleCallUrl).catch(() => {});
      return;
    }
    setBookingSession(s);
    // The dialog that offered the call must finish dismissing before the
    // sheet presents (iOS modal-stacking rule).
    setTimeout(() => setBooking(true), 350);
  };

  /** Create the per-user quote and open the website checkout page. Shared by
   *  the "activate plan" prompt and the post-fetch offer. When the vault
   *  already exists, its id lets us remember the backend portfolio, the
   *  handle for the vault's tested state. */
  const startPlanCheckout = async (
    session: Awaited<ReturnType<typeof loadSession>>,
    walletId?: string,
  ) => {
    if (!session) return;
    // Nothing is bought inside the app while purchases are off: the plan is
    // arranged with 21st Capital on a call booked right here.
    if (!PURCHASES_ENABLED) {
      void openBooking();
      return;
    }
    try {
      setDialog({
        title: 'Preparing your checkout…',
        message: 'Creating a secure checkout page for your plan.',
        actions: [],
      });
      if (!scheme) return;
      const configType: VaultConfigType = scheme;
      const { quoteId, portfolioId } = await createVaultQuote(session, {
        tier: tier?.name === 'Elite' ? 'elite' : 'premium',
        tierName: tier?.name ?? 'Premium',
        planItemName: tier?.item,
        configType,
        userEmail: session.email ?? '',
        rescue: rescue === true,
        inheritance: inheritance === true,
        heirCount: heirs.length,
        annual: tier?.annual ?? 0,
        onboarding: tier?.onboarding ?? 0,
        // What the plan includes (Elite is two vaults), so the portfolio
        // records the purchase honestly; the backend floors by tier too.
        vaultCount: tierVaultLimit(tier?.name, tier?.item),
        // The vault's shape on the checkout row as well (the claim after
        // payment rewrites it with the final build anyway).
        companyCosigner: cosigns21C,
        heirTimelocks:
          inheritance === true
            ? heirs.filter((h) => h.method === 'key').map((h) => h.months)
            : [],
      });
      if (walletId && portfolioId) {
        void updateWallet(walletId, { portfolioId });
      }
      // Route through the login handoff — the browser's own website session
      // is usually expired, which broke Stripe checkout behind a generic error.
      await Linking.openURL(await checkoutUrlWithLogin(session, quoteId));
      setDialog(null);
    } catch (e) {
      // The server has no earlier plan of this client's on file: the price
      // shown from here on includes the onboarding (decided 2026-10-01).
      if (e instanceof OnboardingRequiredError) setReturningClient(false);
      // A refusal the client can act on is one sentence, as the title, with
      // no paragraph under it (decided 2026-09-02).
      const plain = e instanceof OnboardingRequiredError || e instanceof PricesChangedError;
      setDialog({
        title: plain ? (e as Error).message : 'Could not start checkout',
        message: plain ? '' : (e as Error).message,
        actions: [{ label: 'OK', onPress: () => {} }],
      });
    }
  };

  const doCreate = async () => {
    if (!preview?.descriptor || !name.trim()) return;
    setError(null);
    setCreating(true);
    // Plan cap (reworked 2026-07-26): the ENTITLEMENT comes from the
    // backend portfolio (what was actually configured and paid), with the
    // tier constant as the floor. A vault only CONSUMES a slot once its
    // portfolio is VAULT-TESTED (decided: half-finished and never-tested setups
    // must not block a new vault); `vaultTestedAt` is the app's cache of
    // that server state. Deleting a counted vault frees its slot at once.
    // The dialog names the counted vaults so the client can see exactly
    // what is using the plan. (An onboarding client with no active plan
    // yet is allowed — they pay after.)
    // A vault somebody else's plan pays for (decided 2026-09-20) is no business
    // of this gate: it sits in the payer's count, and the backend decided it
    // when it issued the keys.
    if (uses21C && !claimedHeldOf.current) {
      try {
        const session = await loadSession();
        if (session) {
          const [subs, portfolio, profile, entitlement] = await Promise.all([
            fetchSubscriptions(session),
            fetchMyPortfolio(session).catch(() => null),
            fetchProfile(session).catch(() => null),
            fetchKeyEntitlement(session).catch(() => null),
          ]);
          // Lifetime Elite (no subscription row) opens the whole block
          // (decided 2026-09-04); the backend's claim gate says the same. And
          // never STRICTER than the backend (decided 2026-09-19): the portfolio
          // read here is the latest one only, while the claim sums every
          // paid portfolio, so a client with two one-vault purchases was
          // stopped at one. vaultsIncluded is the claim's own figure.
          const limit = Math.max(
            entitledVaultCount(subs, portfolio, new Date(), profile?.lifetimeElite === true),
            entitlement?.vaultsIncluded ?? 0,
          );
          // LIVE tested state (decided 2026-07-26): ask the backend at the gate
          // instead of trusting the screen-visit cache. A slot is consumed
          // only by a vault whose OWN portfolio is tested — vaults without a
          // portfolioId never count (the old code let them borrow the
          // account's latest portfolio's tested badge), a stale cache on
          // such a vault is ignored, and two wallets sharing one purchase
          // consume ONE slot. Unreachable status = untested (the error only
          // ever lands in the generous direction).
          // A vault is identified by its NUMBER since 2026-09-03 (one paid
          // portfolio holds every vault built with our keys), or by its
          // portfolio for older vaults.
          // Never a vault somebody else pays for: countsAgainstOwnPlan.
          const candidates = wallets.filter(countsAgainstOwnPlan);
          const tested = (
            await Promise.all(
              candidates.map(async (w) => {
                if (w.vaultTestedAt) return w;
                try {
                  const st = await fetchVaultTesting(session, w.portfolioId, w.vaultNumber);
                  if (st.testedAt) {
                    void updateWallet(w.id, {
                      vaultTestedAt: Date.parse(st.testedAt) || Date.now(),
                    });
                    return w;
                  }
                } catch {
                  // status unreachable → treat as untested
                }
                return null;
              }),
            )
          ).filter((w): w is (typeof candidates)[number] => !!w);
          // One slot per VAULT (its account number), not per portfolio:
          // several vaults now share one portfolio (decided 2026-09-03).
          const seen = new Set<string>();
          const counted = tested.filter((w) => {
            const key =
              w.accountNumber != null ? `account:${w.accountNumber}` : `portfolio:${w.portfolioId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          // The slots that are for someone else are not the client's to
          // build (decided 2026-09-20): the cap is what the plan includes minus
          // those.
          const ownCap = ownPlanCap(limit, entitlement?.vaultsAllocated ?? []);
          const verdict = ownPlanVerdict(limit, entitlement?.vaultsAllocated ?? [], counted.length);
          if (verdict === 'allAssigned') {
            setCreating(false);
            setDialog({
              title: BUILDER_COPY.allAssignedTitle,
              message: '',
              actions: [
                { label: BUILDER_COPY.ok, variant: 'primary', onPress: () => setDialog(null) },
                { label: STORE_COPY.talkToUs, variant: 'ghost', onPress: () => void openBooking() },
              ],
            });
            return;
          }
          if (verdict === 'full') {
            setCreating(false);
            const names = counted.map((w) => `“${w.label}”`).join(', ');
            if (!PURCHASES_ENABLED) {
              // Shown, never sold: which vaults hold the slots, and a call.
              setDialog({
                title: STORE_COPY.vaultLimitTitle,
                message: vaultLimitMessage(names),
                actions: [
                  { label: STORE_COPY.talkToUs, variant: 'primary', onPress: () => void openBooking() },
                  { label: 'OK', variant: 'ghost', onPress: () => setDialog(null) },
                ],
              });
              return;
            }
            // Lifetime Elite already holds the hard maximum of ten vaults:
            // nothing to upgrade or extend, so the message ends at freeing a
            // slot (2026-09-12).
            const lifetime = profile?.lifetimeElite === true;
            const cta =
              activePlanTier(subs) === 'elite-plus'
                ? 'contact us to extend your plan'
                : 'upgrade your plan on the website';
            setDialog({
              title: 'Vault limit reached',
              message:
                `Your plan covers ${ownCap} vault${ownCap > 1 ? 's' : ''}${ownCap < limit ? ' of your own' : ''} with 21st Capital keys, ` +
                `currently used by your tested vault${counted.length > 1 ? 's' : ''} ${names}. ` +
                (lifetime
                  ? 'Remove one of them to free its slot.'
                  : `Remove one of them to free its slot, or ${cta} to add another.`),
              actions: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(null) }],
            });
            return;
          }
        }
      } catch {
        // Best-effort — never block creation on a plan-check network hiccup.
      }
    }
    try {
      // Mainnet keys → mainnet; test-family keys land on Testnet4
      // (testNetworkFor) so the configurator is testable end-to-end.
      const detected = validateForImport(preview.descriptor, {});
      const net =
        detected.ok && detected.network !== 'bitcoin' ? testNetwork : ('bitcoin' as const);
      const validated = validateForImport(preview.descriptor, { network: net });
      if (!validated.ok) throw new Error(validated.message);
      const dup = findDuplicateWallet(validated.parsed.raw, wallets);
      if (dup) throw new Error(duplicateVaultMessage(dup));
      // PAYWALL: a vault holding any 21st Capital key is created LOCKED until
      // the client has an active plan — 21C only cosigns/rescues for paying
      // clients, so the vault is useless unless activated (decided 2026-07-20).
      // providerFps is an accumulate-only record of every 21C key ever FETCHED
      // in this session — but the user may have backed up and dropped a key
      // since (skip rescue after an heir was added, switch co-signer to self).
      // Only fingerprints of keys ACTUALLY in the final vault count, or a
      // fully self-custodied vault would be paywalled and carry phantom 21C
      // metadata (decided 2026-07-24).
      // Only keys ACTUALLY in the composed descriptor count — allKeys can
      // hold leftovers from a scheme change or a stray fetch, and one stray
      // 21C fingerprint would paywall a free vault (decided 2026-07-27).
      const descriptorKeys = allKeys.filter((k) => preview.descriptor!.includes(k.xpub));
      const finalFps = new Set(
        descriptorKeys.map((k) => k.fingerprint?.toLowerCase()).filter(Boolean) as string[],
      );
      const effectiveProviderFps = [...providerFps.current].filter((fp) => finalFps.has(fp));
      const uses21CKeys = effectiveProviderFps.length > 0;
      // The BACKEND decides entitlement when it issues the keys (payment at
      // the end of the build, decided 2026-09-01): a refusal never reaches this
      // point, so keys in hand mean the plan is covered. Asking the
      // subscriptions list here as well locked every vault of a Lifetime
      // Elite member and of a test account, neither of which has a
      // subscription row (decided 2026-09-03).
      const planPaid = uses21CKeys;
      const locked = uses21CKeys && !planPaid;
      // Same labels the summary showed — one source of truth (keyLabelByFp),
      // but only for keys that are actually IN the vault.
      const labels: Record<string, string> = {};
      for (const [fp, label] of Object.entries(keyLabelByFp)) {
        if (finalFps.has(fp)) labels[fp] = label;
      }
      const wallet = await addWallet({
        label: name.trim(),
        descriptor: validated.parsed.raw,
        network: validated.network,
        kind: validated.parsed.kind,
        source: validated.source,
        transport: 'created',
        // No category at creation (decided 2026-09-09): a vault's section
        // follows its own shape, and a stored label means the owner chose
        // one on the Arrange screen.
        keyLabels: labels,
        providerKeyFingerprints: effectiveProviderFps,
        // Which of the client's vaults this is, and the account number its
        // 21C keys derive from. Known at CREATION now that the app claims the
        // number when it fetches this vault's own keys (decided 2026-09-01).
        // Gated on the key actually being IN this descriptor: keys fetched and
        // then dropped (the client switched to a self-custodial setup) belong
        // to no vault, and stamping the number here would attach it to one
        // that does not hold it.
        ...(uses21CKeys && claimedAccount.current != null
          ? { accountNumber: claimedAccount.current }
          : {}),
        ...(uses21CKeys && claimedVaultNumber.current != null
          ? { vaultNumber: claimedVaultNumber.current }
          : {}),
        // The paid portfolio this vault joined (decided 2026-09-03): the handle
        // for the testing banner, straight from the claim.
        ...(uses21CKeys && claimedHeldOf.current ? { heldOf: claimedHeldOf.current } : {}),
        ...(uses21CKeys && claimedPortfolioId.current
          ? { portfolioId: claimedPortfolioId.current }
          : {}),
        heirs: inheritance
          ? heirs.map((h) => ({
              // Email is NOT collected here any more (decided 2026-08-27): it is
              // asked for on the heir-invite screen (and the Estate Plan form
              // asks directly when still missing). The id gives keyless heirs
              // an identity of their own for those flows to match on.
              id: newHeirId(),
              fingerprint: h.key?.fingerprint?.toLowerCase(),
              months: h.months,
            }))
          : undefined,
        locked,
        activationPlan: locked
          ? {
              tier: tier?.name === 'Elite' ? 'elite' : 'premium',
              tierName: tier?.name ?? 'Premium',
              planItemName: tier?.item,
              configType: scheme ?? 'multi-2-3',
              rescue: rescue === true,
              inheritance: inheritance === true,
              heirCount: heirs.length,
              annual: tier?.annual ?? 0,
              onboarding: tier?.onboarding ?? 0,
            }
          : undefined,
      });
      createdRef.current = true; // vault exists — release the back guard
      // The claimed number now belongs to a real vault, so it is no longer
      // pending: the NEXT build should draw the next number, not this one.
      if (uses21CKeys && claimedVaultNumber.current != null) {
        void clearPendingClaim();
      }
      // Keys fetched over Bluetooth carry proof of WHICH device holds them —
      // persist the bindings so Send/co-sign/address checks light up without
      // a separate linking step (decided 2026-08-26). finalFps (above) is the set
      // of fingerprints actually in the composed descriptor. EVERY read key
      // is recorded, timelocked layers included (decided 2026-08-31: "show all
      // HWWs that are part of the vault"): the owner just held that device,
      // and the registration walk must list it. The 2026-08-26 owner-only
      // filter hid the heir-layer Ledger from registration entirely.
      const bleBound = Object.fromEntries(
        Object.entries(bleBoundRef.current).filter(([fp]) => finalFps.has(fp)),
      );
      if (Object.keys(bleBound).length > 0) {
        await updateWallet(wallet.id, { keyDevices: bleBound });
      }
      // No portfolio is minted here any more (decided 2026-09-03). Every vault
      // built with our keys used to POST a one-vault portfolio with no
      // checkout behind it, which stayed DRAFT forever and hid the vault
      // from staff testing and the estate plan. The backend now attaches
      // the vault to the client's PAID portfolio when it issues the keys,
      // and its id was stamped above.
      if (locked) {
        // 21C-key vault, plan not yet paid: it is saved LOCKED and shown on
        // Home, unusable until activation. Offer to pay now; the checkout
        // deep-link unlocks it on return (handled globally).
        setCreating(false);
        const session = await loadSession();
        setDialog({
          title: 'Vault saved. Activate to use it',
          message:
            'Your vault includes 21st Capital keys. We only co-sign and rescue ' +
            'while your plan is active, so the vault stays locked until you ' +
            'activate it.',
          actions: [
            {
              label: PURCHASES_ENABLED ? 'Activate my plan' : STORE_COPY.talkToUs,
              onPress: () => void startPlanCheckout(session, wallet.id),
            },
            {
              label: 'Later',
              variant: 'ghost',
              onPress: () =>
                landOverTab('VaultsTab'),
            },
          ],
        });
        return;
      }
      // Land on "Vault built" (decided 2026-10-02, design B at pace B2), with the
      // new vault directly beneath it and Home beneath that: back must go to
      // the wallet list, not the creation wizard (decided 2026-07-18). The page's
      // button takes the next step this landing used to take itself: a vault
      // a device must be shown first goes on to registration, a plain single
      // key opens the vault (VaultBuiltScreen decides, with the vault page's
      // own rule).
      landOverTab('VaultsTab', [
        { name: 'WalletDetail', params: { walletId: wallet.id } },
        { name: 'VaultBuilt', params: { walletId: wallet.id } },
      ]);
    } catch (e) {
      setError(`Could not create the vault: ${(e as Error).message}`);
      setCreating(false);
    }
  };

  /**
   * Straight to creation (decided 2026-09-18). The "test it before you fund it"
   * warning used to live here and on the last page of the wizard. It is said
   * twice already, at the moments it can actually be acted on: the testing
   * banner on the vault right after it is created, and the warning the first
   * time Receive is opened. Saying it a third time, before the vault even
   * exists, only added a confirmation to tap through.
   */
  const onCreate = () => {
    void doCreate();
  };

  /**
   * Checkout: the co-signer/rescue keys are FETCHED from the 21st Capital
   * backend into the descriptor — after login (and, once the payment API
   * ships, after payment). Nothing is ever typed in manually.
   */
  // The header back must behave EXACTLY like the footer back: one step back,
  // never dumping the whole configuration (decided 2026-07-24). Only from step 0
  // does back actually leave the screen — and once the vault is CREATED the
  // wizard is done, so every removal is allowed (decided 2026-07-24).
  const createdRef = useRef(false);
  React.useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (createdRef.current) return; // vault exists — the wizard is over
      if (e.data.action.type !== 'GO_BACK' && e.data.action.type !== 'POP') return;
      if (stepIndex === 0) return; // first step — allow leaving
      e.preventDefault();
      setStepIndex((i) => Math.max(0, i - 1));
    });
    return sub;
  }, [navigation, stepIndex]);

  // Sent to 2FA setup mid-flow? Come back and CONTINUE the key fetch
  // automatically — the configurator is still mounted underneath, so all
  // the user's choices are intact (decided 2026-07-27: "bring them right back
  // to the same place").
  const resumeAfter2FA = useRef(false);
  /** Set when the client was sent to checkout mid-build: the moment payment
   *  confirms we come straight back and finish, keys and all. */
  const resumeAfterCheckout = useRef(false);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      if (!resumeAfter2FA.current) return;
      void (async () => {
        try {
          const session = await loadSession();
          if (!session) return;
          const profile = await fetchProfile(session);
          if (!profile.twoFactorEnabled) {
            resumeAfter2FA.current = false; // they backed out — the gate stands
            return;
          }
          resumeAfter2FA.current = false;
          // Let the TwoFactor screen finish popping before anything modal
          // presents (the iOS rule this app already follows elsewhere).
          setTimeout(() => {
            // Same re-arm as the checkout resume: coming back from the 2FA
            // detour should finish the build, not merely fetch the keys.
            setCreateAfterFetch(true);
            void onCheckoutRef.current?.();
          }, 400);
        } catch {
          // offline — the next attempt re-checks
        }
      })();
    });
    return unsub;
  }, [navigation]);

  const onCheckoutRef = useRef<null | (() => Promise<void>)>(null);
  const onCheckout = async () => {
    setFetchingKeys(true);
    try {
      const session = await loadSession();
      if (!session) {
        // Not logged in: open the inline auth sheet. After it succeeds we
        // resume the fetch automatically — the user never leaves this screen.
        setFetchingKeys(false);
        setAuthOpen(true);
        return;
      }
      // 2FA is a MUST before a 21C vault exists (decided 2026-07-24): the co-sign
      // and rescue ceremonies both step up through the authenticator, so a
      // vault without 2FA would dead-end later. Enforced on explicit "off";
      // a profile-endpoint hiccup doesn't block (the backend still enforces
      // at every step-up).
      // MANDATORY (decided 2026-07-27): a vault carrying 21st Capital keys cannot
      // exist without two-factor — every co-sign and rescue step-up runs
      // through the authenticator, so an unprotected vault dead-ends later.
      // There is no "not now": the only way on is to set it up. We TAKE the
      // user there and resume this exact action when they come back
      // (resumeAfter2FA + the focus listener below).
      // NOTE: this gate exists ONLY because 21C keys are involved —
      // a fully self-custodial vault never reaches it and stays free.
      try {
        const profile = await fetchProfile(session);
        if (!profile.twoFactorEnabled) {
          setFetchingKeys(false);
          setDialog({
            mandatory: true,
            title: 'Two-factor is required',
            message:
              'Every co-signature and rescue on this vault is confirmed with ' +
              'your authenticator app. Set two-factor up now and we bring you ' +
              'straight back here to finish your vault.',
            actions: [
              {
                label: 'Set up two-factor',
                variant: 'primary',
                onPress: () => {
                  // AppDialog's own close() routes through onClose, which a
                  // mandatory dialog ignores — clear it explicitly or it is
                  // still sitting here when they come back.
                  setDialog(null);
                  resumeAfter2FA.current = true;
                  navigation.navigate('TwoFactor', { gate: true });
                },
              },
              {
                // Mandatory must not mean trapped: leaving abandons vault
                // creation. A plain goBack() would be eaten by the wizard's
                // beforeRemove guard (it rewinds ONE step), so reset home.
                label: 'Cancel vault setup',
                variant: 'ghost',
                onPress: () => {
                  setDialog(null);
                  createdRef.current = true; // release the back guard
                  landOverTab('VaultsTab');
                },
              },
            ],
          });
          return;
        }
      } catch {
        // We could NOT confirm two-factor. The issued-keys endpoint has no
        // server-side 2FA check, so proceeding here would hand out 21C keys
        // to an unprotected account — fail CLOSED instead (decided: it's a MUST).
        setFetchingKeys(false);
        setDialog({
          title: 'Could not check your two-factor status',
          message:
            'We could not reach your 21st Capital account just now. Your ' +
            'vault includes our keys, so two-factor has to be confirmed ' +
            'first. Check your connection and try again.',
          actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
        });
        return;
      }
      // THIS vault's own keys, not the shared pair (decided 2026-09-01). Each vault
      // draws a different co-signer and rescue key at its own account number,
      // so one vault's key can never identify another's on-chain. The backend
      // owns the numbering; claimedVaultNumber makes a retry re-fetch the SAME
      // vault rather than consume the next number.
      const sampleXpub = [...userKeys, coSignerKey, rescueKey].find((k) => k?.xpub)?.xpub;
      const wantsTestnet = sampleXpub
        ? sampleXpub.startsWith('tpub')
        : vaultNetwork !== 'bitcoin';
      const claimNetwork = wantsTestnet ? 'testnet4' : 'mainnet';
      claimNetworkRef.current = claimNetwork;
      // A slot claimed by an EARLIER attempt (this screen, or a previous app
      // launch) must be re-used, not abandoned: fetching keys consumes one of
      // the client's ten numbers and nothing gives it back.
      // A remembered claim is re-used only when it is for the vault being
      // built now: a family member sent here to build the vault assigned to
      // them must never be served a number remembered from their own plan.
      const remembered = await pendingClaimRecordFor(session.email ?? '', claimNetwork);
      const pendingRecord = pendingClaimMatches(remembered, claimHeldOf.current, claimHeldVault.current)
        ? remembered
        : undefined;
      const pending = claimedVaultNumber.current ?? pendingRecord?.vaultNumber;
      if (pendingRecord?.heldOf != null && claimHeldOf.current === undefined) {
        claimHeldOf.current = pendingRecord.heldOf;
        claimHeldVault.current = pendingRecord.vaultNumber;
        setPaidByOther(true);
      }
      // Which vault is being built? (decided 2026-09-20: a vault of a plan can be
      // for someone else, who builds it with their own keys.) Asked ONLY of
      // a client who has something of their own plan to build AND a vault
      // somebody else pays for; one assigned vault and nothing else is
      // served without a question. whichVaultToBuild holds the rule.
      if (claimHeldOf.current === undefined && pending == null && claimNetwork === 'mainnet') {
        const ent = await fetchKeyEntitlement(session, claimNetwork).catch(() => null);
        const which = ent ? whichVaultToBuild(ent, wallets) : ({ kind: 'own' } as const);
        if (which.kind === 'none') {
          // No plan of their own, and the vault that is theirs is on this
          // phone already: a claim now would be answered with THAT vault's
          // keys again, and a second vault must never be built on them.
          setFetchingKeys(false);
          setDialog({
            title: alreadyOnPhoneTitle(which.vault.vaultNumber),
            message: '',
            actions: [
              { label: BUILDER_COPY.ok, variant: 'primary', onPress: () => {} },
              { label: STORE_COPY.talkToUs, variant: 'ghost', onPress: () => void openBooking() },
            ],
          });
          return;
        }
        if (which.kind === 'assigned') {
          claimHeldOf.current = which.vault.payerId;
          claimHeldVault.current = which.vault.vaultNumber;
          claimHeldEmail.current = which.vault.payerEmail;
          setPaidByOther(true);
        } else if (which.kind === 'ask') {
          setFetchingKeys(false);
          const pick = (payerId: number | null, vaultNumber?: number, payerEmail?: string) => {
            claimHeldOf.current = payerId;
            claimHeldVault.current = vaultNumber;
            claimHeldEmail.current = payerEmail ?? '';
            setPaidByOther(payerId != null);
            setTimeout(() => void onCheckoutRef.current?.(), 400);
          };
          const several = which.vaults.length > 1;
          setDialog({
            title: BUILDER_COPY.whichVaultTitle,
            message: '',
            actions: [
              ...(which.own
                ? [{ label: BUILDER_COPY.ownOption, variant: 'ghost' as const, onPress: () => pick(null) }]
                : []),
              // The vault waiting for them comes first and is the marked one.
              ...which.vaults.map((h, i) => ({
                label: assignedOptionLabel(h, several),
                variant: (i === 0 ? 'primary' : 'ghost') as 'ghost' | 'primary',
                onPress: () => pick(h.payerId, h.vaultNumber, h.payerEmail),
              })),
              { label: BUILDER_COPY.cancel, variant: 'ghost' as const, onPress: () => {} },
            ],
          });
          return;
        } else {
          claimHeldEmail.current = '';
        }
      }
      const heldOf = claimHeldOf.current ?? undefined;
      const heldVault = heldOf != null ? claimHeldVault.current : undefined;
      // The builder's own everyday keys, sent with every claim so the
      // backend can tell our team when one device sits in two people's
      // vaults of a plan. Never an heir's key, never one of ours.
      const ownerFingerprints = builderEverydayFingerprints({
        userKeys,
        coSignerKey,
        coSignerIsOwn: hasCoSignerSlot && coSignerMode === 'self',
        providerFps: providerFps.current,
      });
      let issued: IssuedVaultKeys;
      try {
        // How this vault is built, so the backend records it on the paid
        // portfolio (staff testing, estate plan): quorum, whether we co-sign,
        // the rescue path, and the timelocks of heirs holding their OWN key.
        // Assisted heirs are not in the descriptor.
        const shape: VaultShape | undefined = scheme
          ? {
              configType: scheme,
              companyCosigner: cosigns21C,
              rescue: rescue === true,
              heirTimelocks:
                inheritance === true
                  ? heirs.filter((h) => h.method === 'key').map((h) => h.months)
                  : [],
            }
          : undefined;
        issued = await fetchNextVaultKeys(
          session,
          claimNetwork,
          pending ?? heldVault,
          shape,
          heldOf,
          ownerFingerprints,
        );
      } catch (e) {
        if (e instanceof VaultAllocatedError) {
          // The number asked for is somebody else's vault now (decided
          // 2026-09-20). Forget it, or every later attempt would ask for the
          // same number again, and say whose it is. Nothing was claimed.
          if (claimedVaultNumber.current === e.vaultNumber) claimedVaultNumber.current = null;
          if (remembered && remembered.heldOf == null && remembered.vaultNumber === e.vaultNumber) {
            void clearPendingClaim();
          }
          const ent = await fetchKeyEntitlement(session, claimNetwork).catch(() => null);
          setDialog({
            title: allocatedTitle(e.vaultNumber, ent?.vaultsAllocated ?? [], e.message),
            message: '',
            actions: [
              { label: BUILDER_COPY.ok, variant: 'primary', onPress: () => {} },
              { label: STORE_COPY.talkToUs, variant: 'ghost', onPress: () => void openBooking() },
            ],
          });
          return;
        }
        if (e instanceof PaymentRequiredError) {
          // PAYMENT COMES AT THE END OF THE BUILD (decided 2026-09-01): the client
          // configures everything for free, and pays only when our keys are
          // actually needed. The BACKEND is what decides whether they have
          // paid, because it counts things the app cannot see (a lifetime
          // membership, a lapsed plan, a paid quote, a Bitcoin onboarding
          // payment). Asking it and reacting to the refusal is the only way
          // the two can never disagree. Nothing is claimed on a refusal, so
          // no account number is spent by asking.
          if (heldOf != null) {
            // Somebody else's plan pays for this vault (decided 2026-09-20): its
            // owner is never sold a plan for it, and never sent to a checkout.
            setDialog({
              title: BUILDER_COPY.planNotActiveTitle,
              message: '',
              actions: [
                { label: BUILDER_COPY.ok, variant: 'primary', onPress: () => {} },
                { label: STORE_COPY.talkToUs, variant: 'ghost', onPress: () => void openBooking() },
              ],
            });
            return;
          }
          resumeAfterCheckout.current = true;
          if (!PURCHASES_ENABLED) {
            // Shown, never sold: the keys come with a plan, arranged on a call.
            setDialog({
              title: STORE_COPY.keysTitle,
              message: '',
              actions: [
                { label: STORE_COPY.talkToUs, variant: 'primary', onPress: () => void openBooking() },
                { label: 'Not now', variant: 'ghost', onPress: () => {} },
              ],
            });
            return;
          }
          setDialog({
            title: 'Activate your plan to get your keys',
            message: tier
              ? `Your vault is configured. Your ${tier.name} protection plan ` +
                `($${tier.annual}/year${tier.onboarding > 0 ? ` plus $${tier.onboarding} onboarding` : ''}) ` +
                'covers the 21st Capital keys in it. Once payment is through, your keys ' +
                'are issued and your vault is built.'
              : 'Your vault is configured. Activating your plan issues the 21st Capital ' +
                'keys it needs, and your vault is built right after.',
            actions: [
              {
                label: PURCHASES_ENABLED ? 'Activate my plan (pay securely)' : 'How to activate',
                variant: 'primary',
                onPress: () => void startPlanCheckout(session),
              },
              { label: 'Not now', variant: 'ghost', onPress: () => {} },
            ],
          });
          return;
        }
        if (e instanceof NotInPlanError) {
          // The website sold a smaller template than this build (decided
          // 2026-09-19): say so in the backend's words and offer a
          // conversation. Nothing links out and nothing is sold here.
          setDialog({
            // Never "your plan" when somebody else's plan pays for the vault.
            // The backend words its sentence for the PAYER ("Your Premium
            // plan..."), so the owner of an assigned vault reads the title
            // and the buttons alone.
            title: heldOf != null ? STORE_COPY.notInPlanTitleOther : STORE_COPY.notInPlanTitle,
            message: heldOf != null ? '' : e.message,
            actions: [
              { label: STORE_COPY.talkToUs, variant: 'primary', onPress: () => void openBooking() },
              { label: 'OK', variant: 'ghost', onPress: () => {} },
            ],
          });
          return;
        }
        if (e instanceof NoVaultSlotsError) {
          // Every bought slot already holds keys. A slot whose vault is NOT
          // on this phone (a reinstall, a deleted draft) can be built again
          // on the same keys: naming its number is the backend's idempotent
          // path, and the entitlement probe says which numbers are held
          // (decided 2026-09-19: no dead ends). Explicit, never silent: the
          // backend refuses to hand an old slot to "my next vault" on its
          // own, so the client chooses here, told the keys are the same.
          // Only for the client's OWN plan, and never a number that is for
          // someone else: its owner builds it (rebuildableOwnVaults).
          const ent =
            heldOf == null
              ? await fetchKeyEntitlement(session, claimNetwork).catch(() => null)
              : null;
          const rebuildable = ent ? rebuildableOwnVaults(ent, wallets) : [];
          if (rebuildable.length > 0) {
            const n = rebuildable[rebuildable.length - 1];
            setDialog({
              title: STORE_COPY.vaultLimitTitle,
              message: `Vault ${n} was built before and is not on this phone. Build it again with the same keys?`,
              actions: [
                {
                  label: `Rebuild vault ${n}`,
                  variant: 'primary',
                  onPress: () => {
                    claimedVaultNumber.current = n;
                    setTimeout(() => void onCheckoutRef.current?.(), 300);
                  },
                },
                { label: STORE_COPY.talkToUs, variant: 'ghost', onPress: () => void openBooking() },
                { label: 'OK', variant: 'ghost', onPress: () => {} },
              ],
            });
            return;
          }
          // What is left of the plan is somebody else's to build: say whose
          // it is rather than "in use", which it is not yet.
          const theirs = ent ? firstUnbuiltAssigned(ent) : null;
          if (ent && theirs) {
            setDialog({
              title: allocatedTitle(theirs.vaultNumber, ent.vaultsAllocated),
              message: '',
              actions: [
                { label: BUILDER_COPY.ok, variant: 'primary', onPress: () => {} },
                { label: STORE_COPY.talkToUs, variant: 'ghost', onPress: () => void openBooking() },
              ],
            });
            return;
          }
          if (!PURCHASES_ENABLED) {
            // The server's words invite adding a vault to the plan; these
            // builds name the limit and offer a call instead.
            setDialog({
              title: STORE_COPY.vaultLimitTitle,
              message: '',
              actions: [
                { label: STORE_COPY.talkToUs, variant: 'primary', onPress: () => void openBooking() },
                { label: 'OK', variant: 'ghost', onPress: () => {} },
              ],
            });
            return;
          }
          setDialog({
            title: 'All your vaults are in use',
            message: String(e.message),
            actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
          });
          return;
        }
        throw e;
      }
      // The backstop to whichVaultToBuild's 'none': the backend answered with
      // a vault somebody else pays for that is ALREADY on this phone (a claim
      // that names nobody is served the person's first vault again). Its keys
      // are never placed into a second vault, and nothing is remembered.
      if (issuedVaultIsOnThisPhone(issued, wallets)) {
        setDialog({
          title: alreadyOnPhoneTitle(issued.vaultNumber),
          message: '',
          actions: [
            { label: BUILDER_COPY.ok, variant: 'primary', onPress: () => {} },
            { label: STORE_COPY.talkToUs, variant: 'ghost', onPress: () => void openBooking() },
          ],
        });
        return;
      }
      if (issued.vaultNumber != null) {
        claimedVaultNumber.current = issued.vaultNumber;
        // Survive an abandoned build: the next attempt asks for this number
        // again rather than consuming another one. The payer is remembered
        // whenever the claim NAMED one: the "keys are being prepared" answer
        // carries no payer, and a number remembered without it would later be
        // claimed on the person's own plan.
        void savePendingClaim({
          vaultNumber: issued.vaultNumber,
          account: issued.account,
          network: claimNetwork,
          email: session.email ?? '',
          ...(heldOf != null ? { heldOf } : {}),
        });
      }
      if (issued.account != null) claimedAccount.current = issued.account;
      if (issued.portfolioId) claimedPortfolioId.current = issued.portfolioId;
      // The backend's word decides whose plan the keys belong to. Only the
      // "being prepared" answer, which names nobody, keeps the payer asked for.
      claimedHeldOf.current =
        issued.heldOf ??
        (issued.provisioning && heldOf != null ? claimHeldEmail.current || null : null);
      // Somebody else pays for this vault: no price, no plan offer, no
      // checkout from here on, whatever the subscriptions list says.
      const otherPays = heldOf != null || !!issued.heldOf;
      if (otherPays) setPaidByOther(true);
      if (issued.provisioning) {
        // Keys held back until their device proof is in (backend enforce)
        // DO exist, so that answer never says they were not assigned.
        if (issued.proofPending) console.warn('21C keys held back: proof pending');
        setDialog({
          title: 'Keys are being prepared',
          message: issued.proofPending
            ? KEY_PROOF_COPY.en.proofPendingMessage
            : 'Your personal keys have not been assigned yet. The 21st Capital ' +
              'team has been notified and will set them up shortly. Check back ' +
              'here in a little while.',
          actions: [{ label: 'OK', onPress: () => {} }],
        });
        return;
      }
      // Checked before either key goes near the descriptor (decided
      // 2026-09-26): the wrong seed, a swapped role or a key of another
      // network stops this vault from being built on it. The device-signed
      // proof of each key is checked in the same call,
      // for the account the backend named, as the switches in
      // keyAttestationPins.ts say. This is the ONE gate for every build: a
      // new vault, a rebuild of a slot, a vault held of another plan.
      // Title and buttons; the title is today's until the proof check is
      // enforced for this network (nothing a client reads changes before that).
      const keyProblem = issuedKeysProblem(
        issued,
        claimNetwork,
        issued.account ?? null,
        KEY_PROOF_POLICY,
        (note) => {
          console.warn(`21C key proof: ${note.text}`);
          void reportKeyProof(session, {
            network: claimNetwork,
            account: issued.account ?? null,
            purpose: note.purpose,
            status: note.status,
            code: note.code,
            refused: note.refused,
          });
        },
      );
      if (keyProblem) {
        console.warn(`21C keys refused: ${keyProblem}`);
        setDialog({
          title: keyCheckFailedTitle(claimNetwork, KEY_PROOF_POLICY),
          message: '',
          actions: [
            { label: BUILDER_COPY.ok, variant: 'primary', onPress: () => {} },
            { label: STORE_COPY.talkToUs, variant: 'ghost', onPress: () => void openBooking() },
          ],
        });
        return;
      }
      let placed = 0;
      if (hasCoSignerSlot && coSignerMode === '21c' && !coSignerKey && issued.coSigner) {
        setCoSignerKey(issued.coSigner);
        if (issued.coSigner.fingerprint) providerFps.current.add(issued.coSigner.fingerprint.toLowerCase());
        placed++;
      }
      if (rescue === true && !rescueKey && issued.rescue) {
        setRescueKey(issued.rescue);
        if (issued.rescue.fingerprint) providerFps.current.add(issued.rescue.fingerprint.toLowerCase());
        placed++;
      }
      // What is STILL missing after placement — one key arriving while the
      // other did not must not read as "keys received" (decided 2026-08-26):
      // the summary would invite creating a vault without its rescue key.
      const stillCoSigner =
        hasCoSignerSlot && coSignerMode === '21c' && !coSignerKey && !issued.coSigner;
      const stillRescue = rescue === true && !rescueKey && !issued.rescue;
      const missingNames = [
        ...(stillCoSigner ? ['the co-signing key'] : []),
        ...(stillRescue ? ['the rescue key'] : []),
      ];
      // The same device in two people's vaults is flagged for our team by
      // the backend and never raised with the client (decided 2026-09-21).
      // Plan status is separate from keys: gate nothing, but offer the web
      // checkout when there is no active subscription. The website owns
      // pricing and payment; it deep-links back when done.
      let planActive = false;
      // A Lifetime Elite member holds no subscription row yet is fully
      // covered, so is never offered a checkout for the keys (2026-09-12).
      // The profile is asked on its own, so a failed subscriptions call
      // cannot lose the lifetime flag and bring the offer back.
      const lifetimeProfile = fetchProfile(session).catch(() => null);
      try {
        planActive = hasActiveSubscription(await fetchSubscriptions(session));
      } catch {
        // Billing check is best-effort — key placement already succeeded.
      }
      if ((await lifetimeProfile)?.lifetimeElite === true) planActive = true;
      const openCheckout = {
        label: PURCHASES_ENABLED ? 'Activate my plan (pay securely)' : STORE_COPY.talkToUs,
        onPress: () => void startPlanCheckout(session),
      };
      // A clean fetch with an active plan says nothing at all (decided
      // 2026-08-31: "just silently fetch the key"): the keys appear in
      // their slots, and the only popup left before creation is the
      // test-your-vault warning. Dialogs remain for what needs words —
      // a missing key, no keys yet, or the plan checkout offer. With
      // purchases off there is no checkout to offer, so every key in hand
      // is always the silent case.
      if (
        placed > 0 &&
        missingNames.length === 0 &&
        (otherPays || planActive || !tier || !PURCHASES_ENABLED)
      ) {
        return;
      }
      setDialog(
        placed > 0 && missingNames.length > 0
          ? {
              // Partial issuance: say exactly which key is still missing so
              // the vault is never created half-configured.
              title: 'One key is still missing',
              message:
                `We placed what was ready, but ${missingNames.join(' and ')} ` +
                'has not been issued to your account yet. The 21st Capital ' +
                'team has been notified. Come back in a little while and tap ' +
                'the same button to finish the vault.',
              actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
            }
          : placed > 0
          ? {
              title: 'Keys received',
              message:
                'Your 21st Capital keys are in the vault. Review who can ' +
                'spend, then create it.' +
                (planActive || !tier || otherPays
                  ? ''
                  : `

Your ${tier.name} protection plan ($${tier.annual}/year${tier.onboarding > 0 ? ` + $${tier.onboarding} onboarding` : ''}) is activated on our website.`),
              actions:
                planActive || !tier || otherPays
                  ? [{ label: 'OK', onPress: () => {} }]
                  : [openCheckout, { label: 'Later', variant: 'ghost', onPress: () => {} }],
            }
          : {
              title: 'Keys not available yet',
              message:
                'Your account has no issued vault keys yet. The 21st Capital ' +
                'team assigns them during onboarding.',
              actions: [{ label: 'OK', onPress: () => {} }],
            },
      );
    } catch (e) {
      // Everything in the try can fail — fetching the keys, reading the
      // plan, the session expiring. Framing all of it as "Checkout" with a
      // price attached mis-tells the story: a testnet account that is not
      // flagged for test keys was being quoted a plan (decided 2026-08-26).
      setDialog({
        title: 'Could not get your 21st Capital keys',
        message: (e as Error).message,
        actions: [{ label: 'OK', variant: 'primary', onPress: () => {} }],
      });
    } finally {
      setFetchingKeys(false);
    }
  };
  useEffect(() => {
    onCheckoutRef.current = onCheckout;
    onCreateRef.current = onCreate;
  });

  // The website deep-links tiam://checkout/complete after payment; the
  // Stripe webhook may lag, so poll (2s × 30s per the backend brief) before
  // announcing the plan.
  React.useEffect(() => {
    const handle = async (url: string | null) => {
      if (!isCheckoutReturnUrl(url)) return; // exact shape only (./deepLinks, decided 2026-09-26)
      const session = await loadSession();
      if (!session) return;
      setDialog({
        title: 'Finishing checkout…',
        message: 'Confirming your payment with 21st Capital.',
        actions: [],
      });
      // ENTITLEMENT, not a subscription row (2026-09-04): a free setup, a
      // Bitcoin payment and a Lifetime Elite membership all entitle a
      // client without one, and the build stalled on "payment still
      // processing" for every one of them. The probe mirrors the claim's
      // own gate, so this resumes exactly when the keys would be issued.
      const active = await pollKeyEntitlement(session, claimNetworkRef.current);
      if (active && resumeAfterCheckout.current) {
        // They were mid-build when we sent them to pay. Carry straight on and
        // finish it (decided 2026-09-01) rather than announcing the plan and
        // making them find the same button again: the configurator is still
        // mounted underneath with every choice intact.
        resumeAfterCheckout.current = false;
        setDialog(null);
        setTimeout(() => {
          // Re-ARM the auto-create, exactly as the Create button does. Without
          // this the resumed run fetches the keys and stops, so a client who
          // just paid watches the button spin and land back where it started,
          // with no vault and no word that the payment worked. Both updates
          // land in one render with fetchingKeys true, so the effect that
          // disarms it bails on its own guard.
          setCreateAfterFetch(true);
          void onCheckoutRef.current?.();
        }, 400);
        return;
      }
      setDialog(
        active
          ? {
              title: 'Plan active',
              message:
                'Welcome aboard. Your protection plan is live. Fetch your ' +
                'keys and create your vault whenever you are ready.',
              actions: [{ label: 'OK', onPress: () => {} }],
            }
          : {
              title: 'Payment still processing',
              message:
                'Your payment went through, but the plan has not activated ' +
                'yet. It usually lands within a minute, so check back shortly.',
              actions: [{ label: 'OK', onPress: () => {} }],
            },
      );
    };
    const sub = Linking.addEventListener('url', ({ url }) => void handle(url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A key slot, in the app's ONE key container (decided 2026-09-26: "Please
   * match the key container to our new key container standard we chose").
   * The row is the control, so the "Add key" pill and the ✕ are gone: an
   * empty slot adds its key, a filled one replaces it. Clearing an heir's
   * key is still reachable, by choosing "Assisted by 21st Capital" for that
   * heir, which is what clearing it meant anyway.
   */
  const keyRow = (key: KeyOrigin | undefined, label: string, onAdd: () => void) => {
    // The user's mandatory key label leads; the slot name becomes context.
    const fp = key?.fingerprint?.toLowerCase();
    const userLabel = fp ? userKeyLabels[fp] : undefined;
    return (
      <KeySlotRow
        name={key ? (userLabel ? `${userLabel} · ${label}` : label) : label}
        trailing={key ? (key.fingerprint ?? 'no origin') : undefined}
        filled={!!key}
        addable={!key}
        onPress={onAdd}
        accessibilityLabel={key ? `Replace ${label}` : `Add key: ${label}`}
      />
    );
  };

  /** 21st Capital key slot: fetched from the backend, never typed in. */

  // The panel is drawn only when there is a graph to dock in it; otherwise
  // the footer stands on its own exactly as it always has.
  const docked = graphDocked && !!graphCard;
  // The step bar is the wizard's one pinned bottom area (decided 2026-10-05):
  // every button of the page lives in it. It takes the safe area and rises
  // above the keyboard (the keys' own measured height plus md, PageFooter's
  // measure), so on the summary step the vault-name field and Create are
  // both above the keys.
  const footerBottom = kbHeight > 0 ? kbHeight + theme.spacing.md : insets.bottom + theme.spacing.lg;
  const footer = (
    <View style={[styles.footer, { paddingBottom: footerBottom }, docked && styles.footerInPanel]}>
      {/* ONE button (decided 2026-08-31): with 21st Capital keys still to come,
          Create fetches them silently, then the test-vault warning takes it
          from there. Keys are free to fetch (backend decision 2026-07-19);
          the plan checkout is offered separately after placement. Full width
          above the step row: its titles are too long for Continue's slot,
          which would have squeezed the step label and its dots. */}
      {step === 'summary' && (
        <Button
          title={
            creating
              ? 'Creating…'
              : fetchingKeys
                ? 'Contacting 21st Capital…'
                : 'Create watch-only vault'
          }
          variant="accent"
          onPress={() => {
            if (pendingIssuance) {
              setCreateAfterFetch(true);
              void onCheckout();
            } else {
              onCreate();
            }
          }}
          disabled={
            (pendingIssuance ? !draftComplete : !preview?.descriptor) ||
            !name.trim() ||
            creating ||
            fetchingKeys
          }
          loading={creating || fetchingKeys}
        />
      )}
      <View style={styles.footerRow}>
        <HeaderBackButton
          onPress={() => (stepIndex === 0 ? navigation.goBack() : setStepIndex((s) => s - 1))}
        />
        <View style={styles.footerCenter}>
          <Text style={styles.footerStep}>
            Step {stepIndex + 1}: {STEP_TITLES[step]}
          </Text>
          <View style={styles.dots}>
            {steps.map((_, i) => (
              <View key={i} style={[styles.dot, i === stepIndex && styles.dotOn]} />
            ))}
          </View>
        </View>
        {step !== 'summary' ? (
          <Button
            title="Continue"
            variant="accent"
            onPress={() => setStepIndex((s) => s + 1)}
            disabled={!stepValid}
            style={styles.footerContinue}
          />
        ) : (
          // Continue's width, so the step label sits where it did on every
          // step before; Create is the full-width button above this row.
          <View style={styles.footerContinue} />
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.scrollWrap}>
      <ScrollView
        ref={revealScrollRef}
        onScroll={(e) => {
          revealOffsetY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
        contentContainerStyle={styles.content}
        // The vault-name field sits low on the summary step. The step bar,
        // Create in it, rises above the keys on its own, so the scroll view
        // takes no keyboard inset (an inset on top of the rise would leave a
        // keyboard's worth of blank); the hook above scrolls the field clear
        // of the fade.
        keyboardShouldPersistTaps="handled">
        <StepTransition
          stepKey={step}
          order={steps}
          style={styles.stepWrap}>
        {step === 'scheme' && (
          <>
            <Text style={styles.heading}>Choose your configuration</Text>
            {netChooser}
            {SCHEMES.map((s) => (
              <TouchableOpacity
                key={s.key}
                style={[styles.schemeCard, scheme === s.key && styles.schemeCardOn]}
                activeOpacity={0.85}
                onPress={() => {
                  if (scheme !== s.key) {
                    // Changing the scheme changes what the rescue key MEANS —
                    // re-ask instead of carrying a forced answer over
                    // (decided 2026-07-24). The mandatory effect re-forces it
                    // for a bare 2-of-2 anyway. (No device is remembered
                    // across slots since 2026-10-04: every slot asks.)
                    setRescue(null);
                    setRescueKey(null);
                    rescueWasForced.current = false;
                  }
                  setScheme(s.key);
                }}>
                <Gloss radius={theme.radius.lg} strength={cardGlow()} />
                {s.popular && (
                  <GoldChip label="MOST POPULAR" />
                )}
                <View style={styles.schemeHead}>
                  <Text style={styles.schemeTitle}>
                    {s.title} <Text style={styles.schemeSub}>{s.subtitle}</Text>
                  </Text>
                  <RadioMark on={scheme === s.key} />
                </View>
                <Text style={styles.schemeBody}>{s.description}</Text>
                <Text style={styles.schemeInfo}>ⓘ {s.infoText}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {step === 'keys' && spec && (
          <>
            <Text style={styles.heading}>
              Configure your main keys
            </Text>
            {graphCard}
            <Text style={styles.rowHint}>
              {HWW_ENABLED
                ? // BUILD, not 'key': the Passport is a key device in general
                  // but not for a vault Talia is CREATING, because the next
                  // steps can add a rescue key or a timelocked heir key and
                  // a Passport can sign neither (deviceKinds' own reason for
                  // leaving `build` off it). Asking the wrong purpose put it
                  // in this sentence, where a phone test caught it (2026-09-26:
                  // "passport cant be used to at the 'creation' wizard").
                  `From your ${brandNamesOf(modelsFor(needsMultisigKey ? 'multi' : 'single', 'build', { hardwareSurface: true }))}.`
                : 'From your signing device: export file, key QR, or paste.'}
            </Text>
            {/* The network is a property of the vault, not of a key, so it
                stays outside the graph; under it, so nothing above moves
                when it goes once the first key is placed. */}
            {userKeys.length === 0 && !coSignerKey && netChooser}
          </>
        )}

        {step === 'inheritance' && (
          <>
            {/* True for every heir (decided 2026-09-22): a keyless heir has
                no path and no period, and the clock runs per coin, so moving
                some coins never keeps the others' paths closed. */}
            <InfoHeading
              title="How inheritance works"
              text="Each heir who holds a key gets a recovery path of their own. Every coin has its own clock, and moving or refreshing a coin starts it again, so an heir's path opens only for a coin left untouched for the period you choose. An heir without a key is helped by 21st Capital instead."
              style={styles.heading}>
              Inheritance Planning
            </InfoHeading>
            <Text style={styles.subheading}>
              Choose whether heirs can inherit this vault, and how each one gets access.
            </Text>
            <ChoiceCard
              title="Yes, enable Inheritance"
              selected={inheritance === true}
              onPress={() => setInheritance(true)}
            />
            <ChoiceCard
              title="No, Skip Inheritance"
              selected={inheritance === false}
              onPress={() => setInheritance(false)}
            />

            {inheritance && (
              <>
                <Card style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>
                    HOW MANY HEIRS?
                  </Text>
                  <View style={styles.stepperRow}>
                    <Text style={styles.stepperValue}>
                      {heirs.length} heir{heirs.length === 1 ? '' : 's'}
                    </Text>
                    <View style={styles.stepper}>
                      <TouchableOpacity
                        style={styles.stepBtn}
                        onPress={() => setHeirs((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}>
                        <Gloss radius={theme.radius.md} />
                        <MinusIcon size={18} strokeWidth={2.5} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.stepBtn}
                        onPress={() =>
                          setHeirs((prev) =>
                            prev.length < MAX_HEIRS ? [...prev, { method: 'key', months: 12 }] : prev,
                          )
                        }>
                        <Gloss radius={theme.radius.md} />
                        <PlusIcon size={18} strokeWidth={2.5} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </Card>

                {heirs.map((heir, i) => (
                  <Card key={i} style={styles.sectionCard}>
                    <Text style={styles.sectionTitle}>HEIR #{i + 1}</Text>
                    <Text style={styles.rowHint}>
                      Choose how this heir gets access.
                    </Text>
                    <ChoiceCard
                      compact
                      title="Assisted by 21st Capital"
                      body="No key for the heir. We help them get access when the time comes."
                      selected={heir.method === 'assisted'}
                      onPress={() => editHeir(i, (h) => ({ ...h, method: 'assisted', key: undefined }))}
                    />
                    <ChoiceCard
                      compact
                      title="Hardware wallet key"
                      body="The heir holds their own hardware key, separate from your day-to-day keys."
                      selected={heir.method === 'key'}
                      onPress={() => editHeir(i, (h) => ({ ...h, method: 'key' }))}
                    />
                    {heir.method === 'key' && (
                      <>
                        {keyRow(heir.key, `Heir ${i + 1} key`, () =>
                          setKeyTarget({ kind: 'heir', index: i }),
                        )}
                        <Text style={styles.sectionTitle}>TIMELOCK DURATION</Text>
                        <Text style={styles.rowHint}>
                          {heirTestLockOffered
                            ? 'How long a coin must sit untouched before this heir’s path opens for it: 8 to 15 months, or the 20-minute test lock.'
                            : 'How long a coin must sit untouched before this heir’s path opens for it: 8 to 15 months.'}
                        </Text>
                        <View style={styles.monthRow}>
                          {[8, 9, 10, 11, 12, 13, 14, 15, TEST_LOCK_MONTHS]
                            .filter((m) => m !== TEST_LOCK_MONTHS || heirTestLockOffered)
                            .map((m) => (
                            <TouchableOpacity
                              key={m}
                              style={[
                                styles.monthChip,
                                m === 0 && styles.monthChipTest,
                                heir.months === m && styles.monthChipOn,
                              ]}
                              onPress={() => editHeir(i, (h) => ({ ...h, months: m }))}>
                              <Text style={[styles.monthText, heir.months === m && styles.monthTextOn]}>
                                {m === 0 ? 'Test' : m}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        {heir.months === 0 ? (
                          <Text style={styles.testLockHint}>
                            TESTING ONLY: this heir's path opens for a coin left untouched
                            for 2 blocks, about 20 minutes. Never use this for a real vault.
                          </Text>
                        ) : (
                          <Text style={styles.rowHint}>
                            {heir.months} months ≈ {formatBlocksDuration(monthsToBlocks(heir.months))} of
                            untouched coins.
                          </Text>
                        )}
                      </>
                    )}
                  </Card>
                ))}
              </>
            )}
          </>
        )}

        {step === 'rescue' && (
          <>
            {/* The explanation sits on the title, so it can be read BEFORE
                the yes/no choice (decided 2026-09-02). */}
            <InfoHeading
              title="How the rescue key works"
              text={`The 21st Capital rescue key can bring the vault back if your keys are lost. We never have your vault’s descriptor, so we can use the rescue key only when you request a rescue and share the descriptor with us. Its path opens only for a coin left untouched for ${rescueOpensIn}: every coin has its own clock, and moving or refreshing a coin starts it again. If you skip it, the vault has your keys only, with no way back should they be lost.`}>
              Rescue Key Configuration
            </InfoHeading>
            {keyAccountMismatch && (
              <Card style={styles.warnCard}>
                <View style={styles.warnHead}>
                  <WarningIcon size={WARN_ICON_SIZE} color={theme.colors.gold} />
                  <Text style={styles.warnTitle}>One more read from your device</Text>
                </View>
                <Text style={styles.warnBody}>
                  {needsMultisigKey
                    ? 'This vault now needs a different key from the same device. Connect it once more, and everything else you have chosen stays.'
                    : "This vault needs your device's ordinary single-key account. Connect it once more to read the right key."}
                </Text>
                <Button
                  title="Read the key again"
                  onPress={() => {
                    setUserKeys([]);
                    // Back to the step that OWNS the keys: emptying the list
                    // from here left the wizard walkable with zero keys and
                    // a silently dead Create button (decided 2026-07-27).
                    setStepIndex(steps.indexOf('keys'));
                    setTimeout(() => setKeyTarget({ kind: 'user' }), 300);
                  }}
                />
              </Card>
            )}
            {assistedNeeds21C && (
              <Card style={styles.warnCard}>
                <View style={styles.warnHead}>
                  <WarningIcon size={WARN_ICON_SIZE} color={theme.colors.gold} />
                  <Text style={styles.warnTitle}>Your assisted heir needs us in the vault</Text>
                </View>
                <Text style={styles.warnBody}>
                  Assisting your heirs only works when a 21st Capital key is in
                  the vault. Include the rescue key, or go back and give the
                  heir their own hardware key.
                </Text>
              </Card>
            )}
            {/* One wording for the rescue path, per coin, in both shapes
                (decided 2026-09-22: "a about 30 minutes timelock", and a key
                that "opens"). */}
            <Text style={styles.subheading}>
              {scheme === 'single-1-1'
                ? `A 21st Capital rescue key can bring the vault back if your key is ever lost. Its path opens only for a coin left untouched for ${rescueOpensIn}.`
                : `21st Capital holds the rescue key. Its path opens only for a coin left untouched for ${rescueOpensIn}.`}
            </Text>
            {/* Our own builds only (TEST_TIMELOCKS_ENABLED = TALIA_FULL): the
                rescue path rehearsed on mainnet inside one sitting, instead of
                waiting fifteen months to find out (decided 2026-09-16). */}
            {TEST_TIMELOCKS_ENABLED && rescue === true && (
              <>
                <Text style={styles.sectionTitle}>TIMELOCK DURATION</Text>
                <View style={styles.monthRow}>
                  {[false, true].map((test) => (
                    <TouchableOpacity
                      key={String(test)}
                      style={[
                        styles.monthChip,
                        test && styles.monthChipTest,
                        rescueTestLock === test && styles.monthChipOn,
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: rescueTestLock === test }}
                      onPress={() => setRescueTestLock(test)}>
                      <Text style={[styles.monthText, rescueTestLock === test && styles.monthTextOn]}>
                        {test ? 'Test' : '15'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {rescueTestLock && (
                  <Card style={styles.warnCard}>
                    <View style={styles.warnHead}>
                      <WarningIcon size={WARN_ICON_SIZE} color={theme.colors.gold} />
                      <Text style={styles.warnTitle}>Test vault, not a vault</Text>
                    </View>
                    <Text style={styles.warnBody}>
                      The rescue key alone can take everything about 30 minutes
                      after a payment confirms, and refreshing cannot outrun it.
                      Put in only what you are willing to lose.
                    </Text>
                  </Card>
                )}
              </>
            )}
            {rescueMandatory ? (
              <Card style={styles.mandatoryCard}>
                <Text style={styles.mandatoryTitle}>
                  Rescue Key required for 2-of-2
                </Text>
                {/* The wait is said once, per coin, in the subheading above
                    (decided 2026-09-22: the key "opens after"). */}
                <Text style={styles.rowHint}>
                  Both keys are needed to spend, so losing either one would lock
                  the funds for good. The 21st Capital rescue key is included as
                  the way back.
                </Text>
                <Text style={styles.rowHint}>
                  Because we hold it, this vault runs on a plan and needs a 21st
                  Capital account with two-factor. Give an heir their own key
                  instead and the vault stays free.
                </Text>
              </Card>
            ) : (
              <>
                {rescueRecommended && (
                  <Card style={styles.mandatoryCard}>
                    <Text style={styles.mandatoryTitle}>
                      {scheme === 'single-1-1'
                        ? 'One key means no way back'
                        : 'Rescue Key recommended'}
                    </Text>
                    <Text style={styles.rowHint}>
                      {scheme === 'single-1-1'
                        ? 'If your key is lost or destroyed, nothing can recover this vault. The rescue key is your safety net. Declining keeps the vault entirely yours, free of any plan.'
                        : 'With no heir holding a key, the rescue key is your only way back if your own keys are ever lost.'}
                    </Text>
                  </Card>
                )}
                <ChoiceCard
                  title="Yes, Include Rescue Key"
                  selected={rescue === true}
                  onPress={() => setRescue(true)}
                />
                <ChoiceCard
                  title="No, Skip Rescue Key"
                  selected={rescue === false}
                  onPress={() => {
                    setRescue(false);
                    setRescueKey(null);
                  }}
                />
              </>
            )}
          </>
        )}

        {step === 'elite' && (
          <>
            <Text style={styles.heading}>Upgrade to Elite Support and Co-signing?</Text>
            <Text style={styles.subheading}>
              Elite adds unlimited 1-on-1 video and chat support, plus a
              complimentary hardware wallet.
            </Text>
            <ChoiceCard
              title={`Upgrade to Elite ($${priceScheme ? ANNUAL[priceScheme].elite.annual : 0}/year)`}
              body={`${cosigns21C ? 'Unlimited video and chat support, free co-signing whenever you need us, and a complimentary hardware wallet.' : 'Unlimited video and chat support, priority help with your rescue key, and a complimentary hardware wallet.'}${returningClient ? '' : ` Plus a one-time $${ONBOARDING_FEE} onboarding.`}`}
              selected={eliteAddon === true}
              onPress={() => setEliteAddon(true)}
            />
            <ChoiceCard
              title={`Continue with Premium ($${(priceScheme && ANNUAL[priceScheme].premium?.annual) ?? 0}/year)`}
              body={`${cosigns21C ? `Support and co-signing billed per request ($${SUPPORT_PER_REQUEST} each).` : `Support billed per request ($${SUPPORT_PER_REQUEST} each).`}${returningClient ? '' : ` Plus a one-time $${ONBOARDING_FEE} onboarding.`}`}
              selected={eliteAddon === false}
              onPress={() => setEliteAddon(false)}
            />
          </>
        )}

        {step === 'summary' && spec && (
          <>
            <Text style={styles.heading}>Configuration Summary</Text>
            <Text style={styles.subheading}>
              Check it over before creating the vault.
            </Text>
            {/* The finished picture: the same graph the steps grew, and the
                one the Estate Plan prints. Once our keys are fetched their
                fingerprints appear on it; until then they say so. */}
            {graphCard}
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>VAULT CONFIGURATION</Text>
              <SummaryRow
                label="Signature Scheme"
                value={
                  spec.key === 'single-1-1'
                    ? rescue
                      ? '1 of 1 + rescue · Single Signature'
                      : '1 of 1 · Single Signature'
                    : `${spec.subtitle} ${spec.title}`
                }
              />
              <SummaryRow label="Your keys" value={`${userKeys.length}`} />
              {/* Only shapes with a co-signer slot have a second signer —
                  a single-sig vault has NO co-signer, ever (decided 2026-07-27). */}
              {hasCoSignerSlot && (
                <SummaryRow
                  label={spec.userKeys === 2 ? 'Third key' : 'Second key'}
                  value={coSignerMode === 'self' ? 'Your own key' : '21stcapital Cosigner'}
                />
              )}
              <SummaryRow
                label="Rescue Key"
                value={rescue ? '21stcapital Rescue' : 'Disabled'}
              />
            </Card>
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>INHERITANCE</Text>
              {/* What the row measures, true for every choice (decided 2026-09-22,
                  the website's configurator says the same): an heir with a
                  key gets a timelocked path; an assisted heir does not, and
                  the rescue key's path is its own row above. */}
              <SummaryRow label="Timelocked heir paths" value={hasKeyedHeir ? 'Enabled' : 'Disabled'} />
              {inheritance && <SummaryRow label="Number of Heirs" value={`${heirs.length}`} />}
              {inheritance &&
                heirs.map((h, i) => (
                  <SummaryRow
                    key={i}
                    label={`Heir #${i + 1}`}
                    value={
                      h.method === 'assisted'
                        ? 'Assisted by 21st Capital'
                        : h.months === TEST_LOCK_MONTHS
                          ? 'Hardware key · test lock, about 20 minutes'
                          : `Hardware key · ${h.months} months`
                    }
                  />
                ))}
            </Card>

            {tier && paidByOther ? (
              // A vault somebody else pays for (decided 2026-09-20): no plan
              // card, no price, never "your plan". One neutral line.
              <Card style={styles.sectionCard}>
                <Text style={styles.rowHint}>{BUILDER_COPY.nothingToPay}</Text>
              </Card>
            ) : tier && alreadyElite ? (
              <Card style={styles.sectionCard}>
                <InfoHeading
                  title="Vault slots"
                  text={
                    PURCHASES_ENABLED
                      ? 'Your plan covers a set number of vaults that hold 21st Capital keys. A vault takes up a slot once you have tested it with us. If every slot is in use, we offer you an extension when you create this one.'
                      : STORE_COPY.slotsInfo
                  }
                  style={styles.sectionTitle}>
                  {`YOUR PLAN · ${currentTier === 'elite-plus' ? 'ELITE PLUS' : 'ELITE'}`}
                </InfoHeading>
                <Text style={styles.rowHint}>
                  {PURCHASES_ENABLED
                    ? "Covered by your active plan, with no new charge. It uses one of your plan's vault slots."
                    : STORE_COPY.coveredBody}
                </Text>
              </Card>
            ) : tier && !PURCHASES_ENABLED ? (
              // Shown, never sold: no price while purchases are off. A 2-of-2
              // with our co-signer is Elite only, so a Premium plan is never
              // told it covers one (decided 2026-09-12). Without a plan there is
              // no card at all: "our keys come with a plan" told the user
              // nothing they needed (decided 2026-09-14).
              currentTier && !(currentTier === 'premium' && tier.name === 'Elite') ? (
                <Card style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>
                    {`YOUR PLAN · ${
                      currentTier === 'elite-plus'
                        ? 'ELITE PLUS'
                        : currentTier === 'elite'
                          ? 'ELITE'
                          : 'PREMIUM'
                    }`}
                  </Text>
                  <Text style={styles.rowHint}>{STORE_COPY.coveredBody}</Text>
                </Card>
              ) : signedIn === null ? null : (
                // No plan on file. Two different people reach this: one who
                // has a plan but is signed out, and one who has none at all.
                // Sign in for the first, a meeting for the second. No price
                // and no way out to a checkout, deliberately.
                <Card style={styles.sectionCard}>
                  <Text style={styles.sectionTitle}>{STORE_COPY.planNeededTitle}</Text>
                  <Text style={styles.rowHint}>
                    {signedIn ? STORE_COPY.planNeededSignedIn : STORE_COPY.planNeededSignedOut}
                  </Text>
                  {/* The card's own ways to get a plan (the step bar's slot
                      is Create's): the card's gap spaces them. */}
                  {!signedIn && (
                    <Button
                      title={STORE_COPY.signIn}
                      onPress={() => setAuthOpen(true)}
                    />
                  )}
                  <Button
                    title={STORE_COPY.talkToUs}
                    variant={signedIn ? 'primary' : 'ghost'}
                    onPress={() => void openBooking()}
                  />
                </Card>
              )
            ) : tier ? (
              <Card style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>YOUR PLAN · {tier.name.toUpperCase()}</Text>
                <SummaryRow label="Annual subscription" value={`$${tier.annual}`} />
                {tier.onboarding > 0 ? (
                  <SummaryRow label="Onboarding (1-on-1)" value={`$${tier.onboarding}`} />
                ) : (
                  <Text style={styles.rowHint}>
                    No onboarding fee. You have already onboarded with us.
                  </Text>
                )}
                <View style={styles.divider} />
                <SummaryRow label="Total first year" value={`$${tier.annual + tier.onboarding}`} />
                <SummaryRow label="Then yearly" value={`$${tier.annual}`} />
                {tier.name !== 'Elite' && (
                  <Text style={styles.rowHint}>
                    Support and co-signing billed per request (${SUPPORT_PER_REQUEST}).
                  </Text>
                )}
                {tier.name === 'Elite' && scheme && eliteForced(scheme) && cosigns21C && (
                  <Text style={styles.rowHint}>
                    A 2-of-2 vault is offered on Elite only. Unlimited support
                    and co-signing are included.
                  </Text>
                )}
              </Card>
            ) : (
              <Card style={styles.sectionCard}>
                <Text style={styles.sectionTitle}>YOUR PLAN</Text>
                <Text style={styles.rowHint}>
                  No 21st Capital services selected, so there is no
                  subscription. Your vault is fully self-custodied and free.
                </Text>
                {/* Offer at the end, never force (decided 2026-07-27). */}
                {rescue !== true && (
                  <>
                    {/* The rescue step's words, and its lock: the button
                        below builds with rescueBlocks (decided 2026-09-22).
                        With no 21C service a multisig's extra key is the
                        client's own, so only single-sig has one key. */}
                    <Text style={styles.rowHint}>
                      Want a safety net? A 21st Capital rescue key can bring
                      the vault back if your {scheme === 'single-1-1' ? 'key is' : 'keys are'} ever
                      lost. Its path opens only for a coin left untouched
                      for {rescueOpensIn}.
                    </Text>
                    <Button
                      title="Add the rescue key"
                      variant="ghost"
                      onPress={() => {
                        // Back to the rescue step, not a silent flip: that
                        // step owns the derivation gate and the rescue card,
                        // and adding a 21C service can grow the step list
                        // under us (decided 2026-07-27).
                        setRescue(true);
                        setStepIndex(steps.indexOf('rescue'));
                      }}
                    />
                  </>
                )}
              </Card>
            )}

            {keyAccountMismatch && (
              <Card style={styles.warnCard}>
                <View style={styles.warnHead}>
                  <WarningIcon size={WARN_ICON_SIZE} color={theme.colors.gold} />
                  <Text style={styles.warnTitle}>One more read from your device</Text>
                </View>
                <Text style={styles.warnBody}>
                  This vault needs a different key from the same device. Export
                  once more the way you did before, and we take the right part
                  automatically.
                </Text>
                <Button
                  title="Read the key again"
                  onPress={() => setStepIndex(steps.indexOf('keys'))}
                />
              </Card>
            )}
            {!!spec && userKeys.length !== spec.userKeys && (
              <Text style={styles.errorText}>
                Add your key on the Key Configuration step to finish this vault.
              </Text>
            )}
            {preview?.issue && <Text style={styles.errorText}>{preview.issue}</Text>}

            <TextField
              label="Vault name (required)"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Family vault"
              autoCapitalize="sentences"
              maxLength={MAX_NAME_LENGTH}
              hint={name.length >= MAX_NAME_LENGTH ? `Up to ${MAX_NAME_LENGTH} characters` : undefined}
            />
            {error && <Text style={styles.errorText}>{error}</Text>}
            {/* Create is the step bar's, pinned under the form (decided 2026-10-05). */}
          </>
        )}
        </StepTransition>

        {error && step !== 'summary' && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
      {/* Steps running under the footer dissolve (decided 2026-09-12) — but NOT
          where the graph is docked (decided 2026-09-25: "remove the fade around
          the lower sticky container on this page. It diturbs the area
          behind it and space is scarce here"): there the scroll area ends
          at the card rather than running under it, and 28pt of dissolve ate
          into the heir card above it. */}
      {!docked && <FadeEdge />}
      </View>

      {/* THE LOWER PANEL (decided 2026-09-25: "lets make the entire lower part
          green with round edges"). A translucent card pinned over the form
          showed the page through its own rounded corners, so wherever a
          heir card sat right behind it the corners read as black notches.
          Nothing translucent can avoid that, so the bottom of the page IS
          the container: ONE opaque green block with rounded top corners,
          holding the graph and the footer, and the form simply disappears
          behind it. The glow rides on top of the opaque ground so the block
          is the page's green rather than the bare hull, and the graph
          inside draws no card of its own, because this IS the card. */}
      {docked ? (
        <View style={styles.lowerPanel}>
          <PageGlow anchor="bottom" />
          <View style={styles.graphDock}>{graphCard}</View>
          {footer}
        </View>
      ) : (
        footer
      )}

      <KeyEntrySheet
        // Remount per slot: the sheet remembers the device it was told
        // about, and an HEIR's slot must never inherit the owner's Ledger —
        // it would auto-read the OWNER's key into the heir's place
        // (decided 2026-08-26).
        key={keyTarget ? `${keyTarget.kind}-${'index' in keyTarget ? keyTarget.index : ''}` : 'none'}
        visible={keyTarget !== null}
        // A vault built HERE can hold our rescue key or a timelocked heir
        // key, which only a Ledger or a BitBox can sign (decided 2026-09-24).
        building
        coldcardAccount={keyAccount}
        // Both accounts in the first read (decided 2026-09-22): the segwit key
        // for a plain one-key vault, the multi-key one for any timelocked
        // layer; the swap below picks whichever the choices ask for.
        readBothAccounts
        network={activeNetwork}
        usedDeviceIds={usedDeviceIds()}
        // Which device will hold THIS key, asked for every slot (decided
        // 2026-10-04, device first): two keys of the owner's can sit on two
        // devices, so no slot inherits another's answer.
        question="Which device will hold this key?"
        intro="We'll show you where to find it on your device. Talia only ever needs the PUBLIC key, never your seed words."
        onLedgerKey={(fp, dev, deviceId, name) => {
          bleBoundRef.current[fp.toLowerCase()] = dev;
          // A Passport has no Bluetooth id to spend on this build.
          if (deviceId) bleIdsRef.current[fp.toLowerCase()] = deviceId;
          if (name) deviceNamesRef.current[fp.toLowerCase()] = name;
        }}
        onAdd={placeKey}
        onClose={() => setKeyTarget(null)}
        onError={setError}
      />

      <AuthSheet
        visible={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthed={() => {
          // Signed in without leaving the flow — resume the key fetch right
          // where the user tapped, no restart (decided 2026-07-20). Re-read the
          // plan FIRST: until now we had no session, so an existing Elite
          // client was being priced as brand new (decided 2026-07-27).
          setAuthOpen(false);
          void refreshPlanContext();
          setTimeout(() => void onCheckout(), 350);
        }}
      />

      {/* The call offered in place of a purchase while purchases are off.
          BookingSheet shows its own "Meeting booked" step and closes from
          its Done button, so onBooked opens nothing: two stacked Modals are
          fragile on iOS. */}
      <BookingSheet
        visible={booking}
        token={bookingToken ?? ''}
        title="Talk to 21st Capital"
        subtitle="Pick a time and we'll send you the meeting link."
        contact={{
          firstName:
            bookingSession?.firstName || (bookingSession?.email ?? '').split('@')[0] || 'Talia',
          lastName: bookingSession?.lastName || '(Talia app)',
          email: bookingSession?.email ?? '',
        }}
        details="Vault plan call (booked in the Talia app configurator)"
        onClose={() => setBooking(false)}
        onBooked={() => {}}
      />

      {/* Mandatory key label — the ceremony speaks in these names. */}
      <AppDialog
        visible={pendingLabel !== null}
        title="Name this key"
        message={
          pendingLabel
            ? `Fingerprint ${(pendingLabel.key.fingerprint ?? 'unknown').toUpperCase()}. Pick a name you'll recognise when signing, like "Office device".`
            : ''
        }
        input={{
          label: 'Key label (required)',
          placeholder: 'e.g. Office device',
          autoCapitalize: 'sentences',
          defaultValue: pendingLabel?.key.fingerprint
            ? (deviceNamesRef.current[pendingLabel.key.fingerprint.toLowerCase()] ?? '')
            : '',
        }}
        actions={[
          {
            label: 'Save key',
            variant: 'primary',
            requiresInput: true,
            onPress: (label) => commitLabeledKey(label),
          },
          { label: 'Cancel', variant: 'ghost', onPress: () => setPendingLabel(null) },
        ]}
        onClose={() => setPendingLabel(null)}
      />

      <AppDialog
        visible={dialog !== null}
        title={dialog?.title ?? ''}
        message={dialog?.message}
        actions={(dialog?.actions ?? []).map((a) => ({
          label: a.label,
          variant: a.variant,
          destructive: a.destructive,
          onPress: () => a.onPress(),
        }))}
        onClose={() => {
          if (!dialog?.mandatory) setDialog(null);
        }}
      />
    </View>
  );
}



function ChoiceCard({
  title,
  body,
  selected,
  onPress,
  compact,
}: {
  title: string;
  /** Omit when the title says it all (the rescue yes/no, decided 2026-09-02). */
  body?: string;
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={[styles.choiceCard, compact && styles.choiceCardCompact, selected && styles.schemeCardOn]}
      activeOpacity={0.85}
      onPress={onPress}>
      <Gloss radius={theme.radius.lg} strength={cardGlow()} />
      <View style={styles.schemeHead}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <RadioMark on={selected} />
      </View>
      {body ? <Text style={styles.schemeBody}>{body}</Text> : null}
    </TouchableOpacity>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  scrollWrap: { flex: 1 },
  // The step bar is a sibling below the scroll area, so the content ends at
  // the bar's fade: the same room every footed page keeps.
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg, paddingBottom: FOOTER_ROOM },
  /**
   * The lower panel: opaque, so nothing of the form behind shows through
   * its rounded corners, and rounded at the top alone because it runs to
   * the bottom of the screen. `surfaceSolid` is the design system's own
   * opaque card colour, for "the few places that must not be see-through",
   * which is exactly this one.
   */
  lowerPanel: {
    backgroundColor: theme.colors.surfaceSolid,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    overflow: 'hidden',
  },
  // The docked picture: the content's own side padding (the page gutter, the
  // step bar's too), so it lines up with the cards that scroll above it.
  graphDock: { paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md },
  /** Inside the panel the footer has no ground and no edge of its own. */
  footerInPanel: { backgroundColor: theme.colors.transparent, borderTopWidth: 0 },
  stepWrap: { gap: theme.spacing.lg },

  heading: { ...theme.typography.title, color: theme.colors.offWhite },
  subheading: { ...theme.typography.body, color: theme.colors.slate },

  schemeCard: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  schemeCardOn: { borderColor: theme.colors.accent },
  schemeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  schemeTitle: { ...theme.typography.heading, color: theme.colors.offWhite, flexShrink: 1 },
  // The "2 of 3" beside a scheme's name: an eyebrow, in gold.
  schemeSub: { ...theme.typography.label, color: theme.colors.gold },
  schemeBody: { ...theme.typography.body, color: theme.colors.slate },
  schemeInfo: { ...theme.typography.caption, color: theme.colors.faint },


  choiceCard: {
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    borderRadius: theme.radius.lg,
    padding: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  // Nested inside a Card (keys/heirs steps) it keeps the tighter inset,
  // so a card inside a card is not padded twice.
  choiceCardCompact: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  choiceTitle: { ...theme.typography.heading, color: theme.colors.offWhite, flexShrink: 1 },

  sectionCard: { gap: theme.spacing.md },
  sectionTitle: { ...theme.typography.label, color: theme.colors.slate, letterSpacing: 1.1 },
  rowHint: { ...theme.typography.caption, color: theme.colors.slate },


  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  stepperValue: { ...theme.typography.heading, color: theme.colors.offWhite },
  stepper: { flexDirection: 'row', gap: theme.spacing.sm },
  stepBtn: {
    width: 40,
    height: 36,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },

  monthRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  monthChip: {
    width: 44,
    height: 40,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthChipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  monthChipTest: { borderColor: theme.colors.gold, borderStyle: 'dashed' },
  netRow: { flexDirection: 'row', gap: theme.spacing.sm },
  netChip: {
    flex: 1,
    height: 40,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  netChipTest: { borderColor: theme.colors.gold, borderStyle: 'dashed' },
  netChipOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  monthText: { ...theme.typography.body, color: theme.colors.offWhite },
  testLockHint: { ...theme.typography.caption, color: theme.colors.gold },
  monthTextOn: { ...theme.typography.bodyStrong, color: theme.colors.accentInk },

  mandatoryCard: {
    borderColor: theme.colors.goldDark,
    backgroundColor: 'rgba(242, 169, 0, 0.08)',
    gap: theme.spacing.xs,
  },
  mandatoryTitle: { ...theme.typography.heading, color: theme.colors.gold },

  warnCard: {
    borderColor: theme.colors.goldDark,
    backgroundColor: 'rgba(242, 169, 0, 0.1)',
    gap: theme.spacing.xs,
  },
  // A title beside an icon must WRAP inside its card, never run past the
  // right edge, and the body under it shares the title's left edge
  // (decided 2026-07-27).
  warnHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm },
  warnTitle: { ...theme.typography.heading, color: theme.colors.gold, flex: 1 },
  warnBody: {
    ...theme.typography.body,
    color: theme.colors.offWhite,
    // The icon + the head's gap: the body lines up under the title.
    paddingLeft: WARN_ICON_SIZE + theme.spacing.sm,
  },

  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    // Label sits on the FIRST line of a value that wraps, never centred
    // against the block: the body and heading tokens' leadings are a point
    // apart, so their first lines sit level.
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  summaryLabel: { ...theme.typography.body, color: theme.colors.slate },
  summaryValue: {
    ...theme.typography.heading,
    color: theme.colors.offWhite,
    flexShrink: 1,
    textAlign: 'right',
  },
  divider: { height: 1, backgroundColor: theme.colors.hairline, marginVertical: theme.spacing.xs },

  errorText: { ...theme.typography.body, color: theme.colors.negative },

  // The step bar: the page gutter, the safe area (or the keyboard) under it,
  // set at render.
  footer: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  footerCenter: { flex: 1, alignItems: 'center', gap: theme.spacing.xs },
  footerStep: { ...theme.typography.caption, color: theme.colors.slate },
  dots: { flexDirection: 'row', gap: theme.spacing.xs },
  dot: { width: 14, height: 3, borderRadius: 2, backgroundColor: theme.colors.surfaceRaised },
  dotOn: { backgroundColor: theme.colors.accent },
  footerContinue: { minWidth: STEP_BUTTON_MIN_WIDTH },
}));
