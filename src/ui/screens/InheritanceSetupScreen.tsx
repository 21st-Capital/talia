/**
 * Inheritance protocol — native questionnaire (decided 2026-07-21).
 *
 * Mirrors the website tool's data contract exactly (same POST payload, same
 * backend review → PDF pipeline) but grouped into Talia-style steps and
 * PRE-FILLED from the vault it was launched from (key labels, config) —
 * the website can't do that, the app knows the vault.
 *
 * Offered AFTER a vault is created, paid and tested (the WalletDetail banner
 * slot). Skippable — the banner brings the client back until submitted.
 * Submission lands as "pending"; staff reviews and approves; the PDF then
 * appears under Account (and the client is emailed).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { landOverTab } from '../navigation/landOverTab';
import { useRevealFocusedField } from '../hooks/useRevealFocusedField';
import { AppDialog, AuthSheet, BirthDatePicker, Button, Card, DrawnIcon, FOOTER_ROOM, InfoHeading, PageFooter, PercentSlider, PolicyOverview, StepTransition, TextField } from '../components';
import { NO_KEY_ACCESS, heirEmailRequired, heirEmailOk } from '../../wallet/heirEmailRule';
import { exampleDeviceName } from '../../wallet/deviceKinds';
import { theme, themedStyles } from '../theme';
import { keyDisplayName, useWallets, newHeirId } from '../../wallet';
import { mergePlanHeirsIntoVault } from '../../wallet/planHeirs';
import { useProviderFingerprints } from '../hooks/useProviderFingerprints';
import { BLOCKS_PER_MONTH, parseKeyOrigins, parsePolicy, pathRequirement } from '../../bitcoin/descriptor';
import { formatBlocksDuration } from '../../wallet/timelock';
import { loadSession } from '../../services/companyAuth';
import type { CompanySession } from '../../services/companyAuth';
import { fetchProfile } from '../../services/settingsApi';
import {
  RELATIONSHIP_OPTIONS,
  VAULT_CONFIG_OPTIONS,
  keyCountFor,
  fetchEstatePlanScopeOptions,
  submitInheritanceProtocol, fetchInheritanceStatus } from '../../services/inheritance';
import type {
  EstateScopeOptions,
  InheritanceHeir,
  InheritanceLegacyPath,
  InheritancePayload,
} from '../../services/inheritance';
import { shareEstatePlanPdf } from '../../services/estatePlanShare';
import {
  pruneSubstitutes,
  remainingFor,
  shareIssues,
  substituteCandidates,
} from '../../wallet/heirShares';
import type { ShareHeir } from '../../wallet/heirShares';

type Props = NativeStackScreenProps<RootStackParamList, 'InheritanceSetup'>;

const TWENTY_FIRST = '21st Capital';


type Step =
  | 'details'
  | 'keys'
  | 'primary'
  | 'heirsCount'
  | { heir: number }
  | 'pathsCount'
  | { path: number }
  | 'review';

interface HeirDraft {
  /** Stable identity WITHIN this form, so one heir can point at another
   *  without depending on array position (which the count chips reslice). */
  uid: string;
  /** wallet.heirs id of the seeded heir — lets a KEYLESS heir's plan-typed
   *  email find its way back onto the vault entry (decided 2026-08-27). */
  heirId?: string;
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  keyLabel: string;
  /** Fingerprint of the key this heir holds ('' when they hold none). */
  keyFingerprint?: string;
  relationship: string;
  relationshipOther: string;
  percentage: string; // text input; parsed on submit
  /**
   * `uid` of the heir this person STANDS IN FOR, or '' when they inherit
   * directly (decided 2026-08-30: "many clients want to give everything to one
   * person, their spouse usually, and add their kids as well however only if
   * their spouse is also gone or incapacitated" — the substitute heir, or
   * Ersatzerbe). A stand-in's `percentage` is a share of THAT person's
   * portion, not of the estate, so naming one takes nothing from anyone else.
   * One level only: a stand-in cannot itself be stood in for.
   */
  substituteForUid: string;
}

interface PathDraft {
  config: string;
  otpEmail: string;
  keyHolder: string;
  /** Fingerprints travel BESIDE the labels, never inside them: two 21st
   *  Capital keys share one label, so a label→fingerprint lookup could not
   *  tell them apart (decided 2026-07-27). */
  keyHolderFp?: string;
  keyHoldersMultisig: string[];
  keyHoldersMultisigFps?: string[];
  timelockDuration: string;
  isRescuePath: boolean;
}

/** Form-local, monotonic: a draft's identity only has to outlive this screen. */
let heirUidSeq = 0;

const emptyHeir = (): HeirDraft => ({
  uid: `h${++heirUidSeq}`,
  firstName: '',
  lastName: '',
  dob: '',
  email: '',
  keyLabel: NO_KEY_ACCESS,
  keyFingerprint: '',
  relationship: '',
  relationshipOther: '',
  percentage: '',
  substituteForUid: '',
});

/**
 * What the slider says under itself. The dead-end case matters most: a tester filled
 * in a second heir, found Continue grey with no reason given, and had to ask
 * why (2026-08-30). A cap the client cannot see the cause of has to explain
 * itself and name the way out.
 */
function shareHelper(
  h: HeirDraft,
  remaining: number,
  targetName: string,
  canStandIn: boolean,
): string {
  if (h.substituteForUid) {
    return remaining === 0
      ? `The other stand-ins already take all of ${targetName}'s portion. Lower one of them to give this person a share.`
      : `Out of ${targetName}'s portion. The stand-ins for ${targetName} should add up to 100% between them.`;
  }
  if (remaining === 0) {
    return canStandIn
      ? 'Your other heirs already account for the whole estate. Lower one of their shares, or set this person to stand in for one of them instead.'
      : 'Your other heirs already account for the whole estate. Lower one of their shares to give this person one.';
  }
  if (remaining < 100) return `Up to ${remaining}% left after the other heirs.`;
  return 'Drag to set how much of the estate this heir receives.';
}

const emptyPath = (): PathDraft => ({
  config: '',
  otpEmail: '',
  keyHolder: '',
  keyHolderFp: '',
  keyHoldersMultisigFps: [],
  keyHoldersMultisig: [],
  timelockDuration: '12',
  isRescuePath: false,
});

const rescuePath = (): PathDraft => ({
  ...emptyPath(),
  config: 'Single Signature',
  keyHolder: TWENTY_FIRST,
  timelockDuration: '15',
  isRescuePath: true,
});

/**
 * A recovered path's REAL wait, from its own older() (decided 2026-09-22):
 * the plan used to clamp every path into 8 to 15 months and write 15 for any
 * rescue path, so a 3-month backup path or a test lock read "8 months" or
 * "15 months" in the document while this wizard's Vault overview said ≈ 3.
 * `wholeMonths` is the number the payload's month fields carry (the PDF's
 * timeline and the staff dashboard read a number); `waitWords` says it the
 * way PolicyOverview does, whole months or the exact time under a month.
 */
const wholeMonths = (blocks: number): string => String(Math.round(blocks / BLOCKS_PER_MONTH));
const waitWords = (blocks: number): string => {
  const m = Math.round(blocks / BLOCKS_PER_MONTH);
  return m < 1 ? formatBlocksDuration(blocks) : `${m} month${m === 1 ? '' : 's'}`;
};

/** Loose date sanity: YYYY-MM-DD, not in the future. */
function dateOk(v: string, requireAdult = false): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || d.getTime() > Date.now()) return false;
  if (requireAdult) {
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (age < 18) return false;
  }
  return true;
}

const emailOk = (v: string) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * How many vaults one Estate Plan covers (decided 2026-07-27). The plan is written
 * for the CLIENT, not per vault, so it speaks for every 21st Capital vault
 * they hold — two today, matching the Elite ceiling. Raise this when Elite
 * Plus clients start writing plans for three.
 */
const MAX_COVERED_VAULTS = 2;

export function InheritanceSetupScreen({ route, navigation }: Props): React.JSX.Element {
  const { getWallet, wallets, updateSettings, updateWallet } = useWallets();
  const wallet = route.params?.walletId ? getWallet(route.params.walletId) : undefined;
  // ---- Plan scope: the website's rule, mirrored exactly (decided 2026-09-01) ----
  // The server decides whether to ask "one plan for all vaults, or one per
  // vault?" (only with two or more tested vaults) and whether "all" may even
  // be offered (only when the vaults are the same vault on-chain). No
  // answer = the question was not asked and the plan files unscoped, which
  // the backend accepts exactly as it always has.
  const [scopeOptions, setScopeOptions] = useState<EstateScopeOptions | null>(null);
  const [scopeChoice, setScopeChoice] = useState<'' | 'account'>('');
  /** The chosen vault(s), by account number. One files a single-vault
   *  plan; several file one plan covering them all (decided 2026-09-04). */
  const [scopeAccounts, setScopeAccounts] = useState<number[]>([]);
  /** The vault this wizard was opened FOR (hub row, vault banner), read once:
   *  the mount effect below applies it when the backend offers the account. */
  const wantedAccount = useRef<number | undefined>(route.params?.account);
  /** '' | 'self' | 'other' | 'same:<submissionId>' — who the scoped vault
   *  belongs to (one subscription can cover several family members). */
  /** Every chosen vault is this client's OWN vault that somebody else's plan
   *  pays for (decided 2026-09-20): they are its owner, so "who does this vault
   *  belong to?" is answered "me" without asking, and nothing on this form
   *  names the payer. */
  /**
   * The vaults a plan can be scoped TO, from the app's own knowledge.
   *
   * The app does not need the backend to count vaults (decided 2026-09-01): it
   * knows which descriptors carry our keys, and since the per-vault key
   * change every vault it builds also carries the account number its keys
   * derive from. That number is the only identity the backend accepts for a
   * per-vault plan, so a vault without one cannot be named yet: those are
   * older vaults whose number is cached only once the backend marks them
   * tested.
   */
  const scopableVaults = useMemo(() => {
    // Only the vaults without a plan are offered (decided 2026-09-04); one already
    // ticked stays visible (the hub can preselect a staff-reopened one).
    const offered = scopeOptions?.accounts
      .filter((a) => !a.hasPlan || scopeAccounts.includes(a.account))
      .map((a) => a.account);
    // A vault this phone does not hold still has to be shown when it is the
    // one the wizard was opened for, or the chosen vault is invisible and
    // the form looks like it chose something else (decided 2026-09-24).
    const rows = wallets
      .filter(
        (w) =>
          (w.providerKeyFingerprints?.length ?? 0) > 0 &&
          !w.locked &&
          !w.heirVault &&
          w.accountNumber != null &&
          // When the backend has told us which accounts it will accept, trust
          // it over our cache: a number it does not list would be refused.
          (!offered || offered.includes(w.accountNumber)),
      )
      .map((w) => ({
        id: w.id,
        label: w.label,
        account: w.accountNumber as number,
        vaultNumber: w.vaultNumber ?? null,
        shape: scopeOptions?.accounts.find((a) => a.account === w.accountNumber)?.shape ?? null,
      }));
    const chosen = scopeAccounts[0];
    if (chosen != null && !rows.some((v) => v.account === chosen)) {
      const row = scopeOptions?.accounts.find((a) => a.account === chosen);
      rows.unshift({
        id: `account-${chosen}`,
        label: row?.vaultNumber != null ? `Vault ${row.vaultNumber}` : `Account ${chosen}`,
        account: chosen,
        vaultNumber: row?.vaultNumber ?? null,
        shape: row?.shape ?? null,
      });
    }
    return rows;
  }, [wallets, scopeOptions, scopeAccounts]);
  /** The server's remaining vaults (no plan yet); null until it has answered. */
  const remainingVaults = useMemo(
    () => (scopeOptions ? scopeOptions.accounts.filter((a) => !a.hasPlan) : null),
    [scopeOptions],
  );
  const singleRemaining = remainingVaults?.length === 1;
  /** The wizard was opened FROM a vault, so which vault is not a question. */
  /**
   * The wizard was opened FROM a vault, so which vault is not a question.
   *
   * Known from the route, NOT from the server's answer (reported 2026-09-25: "the
   * app show[s] the question ... and half a second later it switches"). It
   * used to wait for the scope options before it could say the account was
   * chosen, so the asking card was drawn for exactly as long as that fetch
   * took, then replaced. Nothing about it was ever a question.
   */
  const vaultIsKnown = wantedAccount.current != null;
  /** That vault, as the client knows it: their own name for it when this
   *  phone holds it, else the number we gave it. The local vault is read
   *  from the route too, so the name is there on the first frame. */
  const chosenVaultName = (() => {
    const account = scopeAccounts[0] ?? wantedAccount.current;
    const local =
      (account != null ? scopableVaults.find((v) => v.account === account) : undefined) ??
      (wallet ? { label: wallet.label } : undefined);
    if (local) return local.label;
    if (account == null) return 'this vault';
    const row = scopeOptions?.accounts.find((a) => a.account === account);
    return row?.vaultNumber != null ? `Vault ${row.vaultNumber}` : `account ${account}`;
  })();
  const vaultNumberFor = (account: number): number | null =>
    scopableVaults.find((v) => v.account === account)?.vaultNumber ??
    scopeOptions?.accounts.find((a) => a.account === account)?.vaultNumber ??
    null;
  /**
   * Ask whenever the CLIENT holds more than one vault with us, whether or not
   * the backend has caught up. The server's own answer still counts, so an
   * account whose vaults live on another device is not missed.
   */
  const eligibleLocalVaults = useMemo(
    () =>
      wallets.filter(
        (w) =>
          (w.providerKeyFingerprints?.length ?? 0) > 0 && !w.locked && !w.heirVault,
      ),
    [wallets],
  );
  const askScope = eligibleLocalVaults.length > 1 || scopeOptions?.askScope === true;
  /** Can a plan name ONE vault? Only if some vault has an account number,
   *  which is the sole identity the backend files a per-vault plan under. */
  const canScopeToOne =
    scopableVaults.length > 0 || (scopeOptions?.accounts.length ?? 0) > 0;
  /** What to TELL the client they hold: whichever source knows about more. */
  const vaultsWithUs = Math.max(
    eligibleLocalVaults.length,
    scopeOptions?.accounts.length ?? 0,
  );
  /**
   * May one plan cover everything? Only when the vaults really are the same
   * vault, because the document names the quorum, the devices and the
   * timelocked paths, and one that spans a 2-of-2 and a 2-of-3 is false for
   * one of them. The server decides when it has spoken; otherwise the app
   * compares the shapes itself, which it can do from the descriptors.
   */
  // "All" is the server's call (offered while no vault has a plan; the
  // same-setup rule was dropped, decided 2026-09-04). False until it
  // answers, so an option about to be withdrawn never flashes.
  // If the options arrive (or refresh) saying "all" is no longer offerable
  // (a plan exists), an "all vaults" answer chosen a moment earlier must go
  // rather than be submitted for the server to refuse.
  useEffect(() => {
  }, [scopeChoice, scopeOptions]);
  // Same for a chosen VAULT the server does not list. A client who starts the
  // wizard logged out picks from the app's own cache; once the server answers,
  // a vault it will not accept (not tested yet) must stop looking chosen,
  // rather than surviving all the way to a refused submission.
  useEffect(() => {
    if (scopeOptions == null) return;
    setScopeAccounts((prev) => {
      const kept = prev.filter((acc) => scopeOptions.accounts.some((a) => a.account === acc));
      return kept.length === prev.length ? prev : kept;
    });
  }, [scopeOptions]);
  // Exactly one vault left without a plan: it is the answer, so the vault
  // question is not asked; only "who does it belong to" follows.
  useEffect(() => {
    if (wantedAccount.current != null) return;  // the caller named one
    if (!askScope || !singleRemaining || scopeChoice || !remainingVaults) return;
    setScopeChoice('account');
    setScopeAccounts([remainingVaults[0].account]);
  }, [askScope, singleRemaining, scopeChoice, remainingVaults]);
  // "All" withdrawn and several vaults left: ticking vaults is the only way,
  // so no option card is shown and the chips appear at once.
  useEffect(() => {
    if (!askScope || !scopeOptions || !canScopeToOne || scopeChoice) return;
    setScopeChoice('account');
  }, [askScope, scopeOptions, canScopeToOne, scopeChoice]);
  /**
   * Which vaults the plan describes. Unscoped (question not asked, or "all"):
   * every vault held with us, the wizard's original behavior. Scoped to one
   * account: the plan describes ONE vault, so only the lead vault (the one
   * the wizard was opened from) prefills it. The vault the wizard was opened
   * from leads; the others follow. Purely self-custodial vaults are never
   * covered: the plan is a 21st Capital service.
   */
  const coveredVaults = useMemo(() => {
    const eligible = wallets.filter(
      (w) =>
        (w.providerKeyFingerprints?.length ?? 0) > 0 &&
        !w.locked &&
        // An INHERITED vault belongs to someone else: the Estate Plan is the
        // OWNER's document, and pulling one in would put another family's
        // heirs into this client's plan (decided 2026-07-27).
        !w.heirVault,
    );
    // The lead vault only leads if it is itself eligible — a locked or
    // self-custodial vault must never enter the plan, however we got here.
    const lead = wallet && eligible.some((w) => w.id === wallet.id) ? wallet : undefined;
    const ordered = lead ? [lead, ...eligible.filter((w) => w.id !== lead.id)] : eligible;
    // Scoped to ONE account: the plan describes the vault the client picked,
    // not the one they happened to open the wizard from (decided 2026-09-01).
    if (askScope && scopeChoice === 'account') {
      const picked =
        scopeAccounts.length > 0
          ? ordered.find((w) => w.accountNumber === scopeAccounts[0])
          : undefined;
      return picked ? [picked] : ordered.slice(0, 1);
    }
    return ordered.slice(0, MAX_COVERED_VAULTS);
  }, [wallets, wallet, askScope, scopeChoice, scopeAccounts]);
  /** How many the client actually has — "all your vaults" must not be
   *  claimed when the cap silently dropped one (decided 2026-07-27). */
  const eligibleVaultCount = useMemo(
    () =>
      wallets.filter(
        (w) =>
          (w.providerKeyFingerprints?.length ?? 0) > 0 && !w.locked && !w.heirVault,
      ).length,
    [wallets],
  );
  const coversEverything = coveredVaults.length === eligibleVaultCount;

  // The tag must span every covered vault: each vault gets its OWN issued
  // rescue key, so the lead vault's tag alone would leave vault 2's 21C key
  // unrecognised — and its rescue path would be written into the plan as a
  // stranger's key (decided 2026-07-27).
  const providerTagSource = useMemo(
    () => ({
      providerKeyFingerprints: coveredVaults.flatMap((v) => v.providerKeyFingerprints ?? []),
    }),
    [coveredVaults],
  );
  const { providerFps: allProviderFps, isProviderKey } = useProviderFingerprints(providerTagSource);
  // ---- Prefill from the vault(s) (the app's advantage over the website) ----
  /** A key's label, wherever it is recorded — paths and heirs must resolve
   *  the SAME fingerprint to the SAME string, or the plan can't link an heir
   *  to the path that is theirs (decided 2026-07-27). */
  const labelForFp = useCallback(
    (fp: string): string => {
      const id = fp.toLowerCase();
      for (const v of coveredVaults) {
        const l = keyDisplayName(v, id);
        if (l) return l;
      }
      return id.toUpperCase();
    },
    [coveredVaults],
  );

  const prefill = useMemo(() => {
    const blank = {
      labels: [] as string[],
      labelFps: [] as string[],
      config: '',
      selected: [] as string[],
      selectedFps: [] as string[],
      recovered: [] as PathDraft[],
      register: [] as NonNullable<InheritancePayload['allKeys']>,
      registerWaits: [] as string[],
    };
    if (coveredVaults.length === 0) return blank;
    // Live set + tag: a legacy 21C key must not be prefilled as one of the
    // client's OWN hardware keys in their Estate Plan (decided 2026-07-27).
    const providerFps = allProviderFps;
    const labels: string[] = [];
    const labelFps: string[] = [];
    const selected: string[] = [];
    const selectedFps: string[] = [];
    /** Every key, every vault — the register the heirs read. Keyed on
     *  fingerprint+vault because labels collide ('Key', '21st Capital'). */
    const register: NonNullable<InheritancePayload['allKeys']> = [];
    /** Index-parallel to `register`: the path's wait in words, '' on the
     *  everyday path (the payload's `months` is a bare number). */
    const registerWaits: string[] = [];
    const seenRegister = new Set<string>();
    const remember = (
      fp: string | undefined,
      label: string,
      vault: string,
      role: 'primary' | 'recovery' | 'rescue',
      olderBlocks?: number,
    ) => {
      const id = `${fp ?? '?'}@${vault}`;
      if (seenRegister.has(id)) return;
      seenRegister.add(id);
      register.push({
        fingerprint: (fp ?? '').toUpperCase(),
        label,
        vault,
        role,
        months: olderBlocks == null ? '' : wholeMonths(olderBlocks),
      });
      registerWaits.push(olderBlocks == null ? '' : waitWords(olderBlocks));
    };
    let config = '';
    // The single vaultConfig/primary-keys pair describes the vault the plan
    // was opened from; the OTHER vaults contribute their keys and recovery
    // paths, which is what the heirs actually need to act on.
    const lead = coveredVaults[0];
    try {
      const policy = parsePolicy(lead.descriptor);
      const primary = policy.paths[0];
      // EVERY AND-ed group (decided 2026-07-28): reading groups[0] described a
      // 3-of-3 vault as "Single Signature" and named only one of its keys — in
      // the document the heirs and the lawyer act on.
      const req = primary ? pathRequirement(primary) : null;
      if (req && req.keys.length > 0) {
        const total = req.keys.length;
        config = total === 1 ? 'Single Signature' : `${req.needed}/${total} Multisig`;
        for (const k of req.keys) {
          const fp = k.fingerprint?.toLowerCase();
          if (!fp) continue;
          if (providerFps.has(fp)) {
            selected.push(TWENTY_FIRST);
            selectedFps.push(fp);
            remember(fp, `${TWENTY_FIRST} (co-signer)`, lead.label, 'primary');
          } else {
            const label = keyDisplayName(lead, fp, providerFps) ?? fp.toUpperCase();
            if (!labels.includes(label)) {
              labels.push(label);
              labelFps.push(fp);
            }
            selected.push(label);
            selectedFps.push(fp);
            remember(fp, label, lead.label, 'primary');
          }
        }
      }
    } catch {
      // fall through to blank form
    }
    // Recovery paths are ON-CHAIN facts — read them from the descriptor
    // instead of asking (decided 2026-07-21). Timelocks round to months; the
    // single-21C-key path is the rescue path. Each path keeps its OWN wait,
    // the rescue path's too: no 8-to-15 clamp and no written-in 15, which
    // are the manual questions' chips, not facts about this vault (decided
    // 2026-09-22).
    const recovered: PathDraft[] = [];
    const seenPaths = new Set<string>();
    for (const v of coveredVaults) {
    try {
      const policy = parsePolicy(v.descriptor);
      for (const path of policy.paths.slice(1)) {
        const g = path.groups.length > 0 ? pathRequirement(path) : null;
        if (!g || path.olderBlocks == null) continue;
        const olderBlocks = path.olderBlocks;
        const months = wholeMonths(olderBlocks);
        const keyLabels = g.keys.map((k) => {
          const fp = k.fingerprint?.toLowerCase();
          if (fp && providerFps.has(fp)) return TWENTY_FIRST;
          return fp ? labelForFp(fp) : 'Key';
        });
        // Two vaults commonly share the same rescue path — list it once.
        // Keyed on the FINGERPRINTS: display labels can collide ('Key') and
        // shift once the live provider set arrives (decided 2026-07-27).
        const sig = `${g.needed}/${g.keys.length}:${g.keys
          .map((k) => k.fingerprint?.toLowerCase() ?? '?')
          .sort()
          .join(',')}:${path.olderBlocks}`;
        if (seenPaths.has(sig)) continue;
        seenPaths.add(sig);
        const single = g.keys.length === 1;
        const isRescue = single && keyLabels[0] === TWENTY_FIRST;
        const pathFps = g.keys.map((k) => k.fingerprint?.toLowerCase() ?? '');
        keyLabels.forEach((l, i) =>
          remember(
            pathFps[i],
            l === TWENTY_FIRST ? `${TWENTY_FIRST} (rescue)` : l,
            v.label,
            isRescue ? 'rescue' : 'recovery',
            olderBlocks,
          ),
        );
        recovered.push({
          config: single ? 'Single Signature' : `${g.needed}/${g.keys.length} Multisig`,
          otpEmail: '',
          keyHolder: single ? keyLabels[0] : '',
          keyHolderFp: single ? pathFps[0] : '',
          keyHoldersMultisig: single ? [] : keyLabels,
          keyHoldersMultisigFps: single ? [] : pathFps,
          timelockDuration: months,
          isRescuePath: isRescue,
        });
      }
    } catch {
      // no recovered paths — the manual questions remain available
    }
    }
    return { labels, labelFps, config, selected, selectedFps, recovered, register, registerWaits };
  }, [coveredVaults, allProviderFps, labelForFp]);

  /**
   * The heirs the client already named when setting up their vault(s) — one
   * entry per person across every covered vault, carrying the label of the
   * key they hold where they hold one (decided 2026-07-27). These PREFILL the
   * plan: the client should never re-type what the app already knows.
   */
  const knownHeirs = useMemo(() => {
    // Identity: email when known, else the heir's creation id / fingerprint.
    // An heir WITHOUT an email (possible since 2026-08-27: the
    // configurator no longer collects one) still counts and still seeds a
    // draft; the form's own mandatory email field then asks for the address.
    // ONE entry per person. Keyed heirs are identified by their KEY
    // fingerprint — the same hardware key on both covered vaults is the same
    // person (decided 2026-08-27: keying on per-vault ids counted them twice
    // and inflated the mandatory heir floor of a legal document). Keyless
    // heirs fall back to email, then their creation id, then position.
    const byId = new Map<
      string,
      { heirId?: string; email: string; keyLabel: string; keyFingerprint: string }
    >();
    for (const v of coveredVaults) {
      (v.heirs ?? []).forEach((h, idx) => {
        const email = (h.email ?? '').trim();
        const fp = h.fingerprint?.toLowerCase();
        const id = fp ? `fp:${fp}` : email ? email.toLowerCase() : h.id ?? `${v.id}:${idx}`;
        const label = fp ? labelForFp(fp) : undefined;
        const seen = byId.get(id);
        if (!seen) {
          byId.set(id, {
            heirId: h.id,
            email,
            keyLabel: label ?? NO_KEY_ACCESS,
            keyFingerprint: fp ?? '',
          });
        } else {
          // Same person seen again — keep the richer half of each fact.
          if (!seen.email && email) seen.email = email;
          if (!seen.heirId && h.id) seen.heirId = h.id;
          if (label && seen.keyLabel === NO_KEY_ACCESS) {
            seen.keyLabel = label;
            seen.keyFingerprint = fp ?? '';
          }
        }
      });
    }
    // Second pass: an EMAIL names a person, so entries sharing one are the
    // same heir however many keys they hold — the same person keyed with a
    // DIFFERENT device on each vault must not raise the mandatory heir floor
    // of a legal document (decided 2026-08-27), and a keyless twin
    // of a keyed entry collapses into it the same way.
    const entries = [...byId.values()];
    const byEmail = new Map<string, (typeof entries)[number]>();
    const out: typeof entries = [];
    for (const e of entries) {
      const em = e.email.toLowerCase();
      if (!em) {
        out.push(e);
        continue;
      }
      const seen = byEmail.get(em);
      if (!seen) {
        byEmail.set(em, e);
        out.push(e);
        continue;
      }
      // Keep the survivor's key facts if it had none.
      if (seen.keyLabel === NO_KEY_ACCESS && e.keyLabel !== NO_KEY_ACCESS) {
        seen.keyLabel = e.keyLabel;
        seen.keyFingerprint = e.keyFingerprint;
      }
      if (!seen.heirId && e.heirId) seen.heirId = e.heirId;
    }
    return out;
  }, [coveredVaults, labelForFp]);
  const knownHeirEmails = useMemo(
    () => knownHeirs.map((h) => h.email.toLowerCase()).filter(Boolean),
    [knownHeirs],
  );
  // No floor and no ceiling on the count: the heirs named at vault setup
  // only PREFILL the drafts below (decided 2026-09-01: the plan is the client's
  // document and their wishes may have changed since setup — and across
  // several vaults the app cannot even know whether two named heirs are the
  // same person).

  // ---- Form state ----
  const [step, setStep] = useState<Step>('details');
  /** What we hold about the client, shown back for correction on step 1
   *  (decided 2026-09-25). Prefilled from the account; edits update it. */
  const [clientFirstName, setClientFirstName] = useState('');
  const [clientLastName, setClientLastName] = useState('');
  const [protocolName, setProtocolName] = useState('');
  /**
   * A name to start from, which the client keeps or changes (decided 2026-09-25:
   * "Estate Plan for <Vault Name from the app>").
   *
   * Written ONCE, and never over something already there: a name the client
   * typed is theirs, and a plan opened to be amended keeps its own.
   */
  const namedOnce = useRef(false);
  useEffect(() => {
    if (namedOnce.current || protocolName.trim()) return;
    if (!vaultIsKnown || chosenVaultName === 'this vault') return;
    namedOnce.current = true;
    setProtocolName(`Estate Plan for ${chosenVaultName}`);
  }, [protocolName, vaultIsKnown, chosenVaultName]);
  /** The date of birth 21st Capital already has on record, if any. */
  const [dob, setDob] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [hwLabels, setHwLabels] = useState<string[]>(
    prefill.labels.length ? prefill.labels : [''],
  );
  /** Index-parallel to hwLabels — '' for a key the client typed by hand. */
  const [hwFingerprints, setHwFingerprints] = useState<string[]>(prefill.labelFps);
  const [vaultConfig, setVaultConfig] = useState(prefill.config);
  const [primaryKeys, setPrimaryKeys] = useState<string[]>(prefill.selected);
  // Two co-signing limits, monthly and yearly, both in BTC (decided 2026-09-21:
  // no daily limit, no other currency).

  /** Monthly <= yearly, or the sentence saying they clash. */
  const [numHeirs, setNumHeirs] = useState<number | null>(null);
  const [heirs, setHeirs] = useState<HeirDraft[]>([]);
  /**
   * Wallets load from AsyncStorage and the 21C fingerprint set from the
   * network, so NOTHING is knowable at mount — but `knownVault` is derived
   * live from `prefill`, and once it flips true the wizard stops asking for
   * the keys and recovery paths. Without these seeds a plan could be
   * submitted with no vault config and no recovery paths at all
   * (decided 2026-07-27). Seed once, never overwrite what the client typed.
   */
  const vaultSeeded = useRef(false);
  useEffect(() => {
    if (vaultSeeded.current) return;
    if (!prefill.config || prefill.labels.length === 0) return;
    vaultSeeded.current = true;
    setHwLabels((p) => (p.length === 0 || (p.length === 1 && !p[0].trim()) ? prefill.labels : p));
    setHwFingerprints((p) => (p.length > 0 ? p : prefill.labelFps));
    setVaultConfig((p) => p || prefill.config);
    setPrimaryKeys((p) => (p.length > 0 ? p : prefill.selected));
    setPaths((p) => (p.length > 0 ? p : prefill.recovered));
    setNumPaths((p) => p ?? prefill.recovered.length);
  }, [prefill]);

  /**
   * The active heirs as the share maths sees them. Everything about pools,
   * caps and warnings is derived from this one projection, so the slider, the
   * review summary and the submitted document can never disagree.
   */
  const shareHeirs = useMemo<ShareHeir[]>(
    () =>
      heirs.slice(0, numHeirs ?? 0).map((h) => ({
        uid: h.uid,
        name: `${h.firstName} ${h.lastName}`.trim(),
        percentage: parseInt(h.percentage, 10) || 0,
        substituteForUid: h.substituteForUid ?? '',
      })),
    [heirs, numHeirs],
  );

  const planIssues = useMemo(() => shareIssues(shareHeirs), [shareHeirs]);

  /** Same for the heirs the client named at vault setup. */
  const heirsSeeded = useRef(false);
  useEffect(() => {
    if (heirsSeeded.current || knownHeirs.length === 0) return;
    heirsSeeded.current = true;
    // MERGE, never replace: a client who reached this step before the data
    // landed would otherwise lose the prefill entirely, or their typing.
    setHeirs((prev) => [
      ...knownHeirs.map((h, i) => {
        const cur = prev[i] ?? emptyHeir();
        return {
          ...cur,
          heirId: cur.heirId ?? h.heirId,
          email: cur.email.trim() ? cur.email : h.email,
          keyLabel: cur.keyLabel === NO_KEY_ACCESS ? h.keyLabel : cur.keyLabel,
          keyFingerprint:
            cur.keyLabel === NO_KEY_ACCESS ? h.keyFingerprint : cur.keyFingerprint ?? '',
        };
      }),
      ...prev.slice(knownHeirs.length),
    ]);
    // A DEFAULT, never a floor: only fill the count while it is unanswered.
    // A number the client picked stands, even when it is lower (decided
    // 2026-09-01: no guards on the heir count).
    setNumHeirs((prev) => prev ?? knownHeirs.length);
  }, [knownHeirs]);
  // The app KNOWS this vault: skip every question the descriptor answers.
  const knownVault = prefill.config !== '' && prefill.labels.length > 0;
  const [numPaths, setNumPaths] = useState<number | null>(
    knownVault ? prefill.recovered.length : null,
  );
  const [paths, setPaths] = useState<PathDraft[]>(knownVault ? prefill.recovered : []);
  /**
   * Changing the plan's SCOPE changes which vaults it describes, so the
   * answers PREFILLED from that coverage must be derived again. This is
   * React's sanctioned render-phase reset (setState during render restarts
   * the render before commit): an effect could not do it, because the seed
   * effects above run FIRST in the same commit and would see stale guards.
   * Only prefill is at stake: the lead vault's config and keys are the same
   * under every scope, so what rederives is the recovery paths (which span
   * every covered vault, and only when a descriptor is there to rederive
   * from) and the heir drafts (only while the client has not touched them —
   * their own words always survive).
   */
  // Keyed on WHICH vault, not merely on whether one was chosen: the plan now
  // prefills from the vault actually picked, so switching the pick has to
  // re-derive everything. Without the account in the key, a client who picks
  // vault A, sees its heirs and recovery paths, then switches to vault B
  // files a document that NAMES vault B and DESCRIBES vault A.
  const scopedToOne = askScope && scopeChoice === 'account';
  const scopeKey = scopedToOne ? `account:${scopeAccounts.join(',') || 'none'}` : 'all';
  const prevScopedToOne = useRef(scopeKey);
  /** Set once the client edits any heir draft or picks a count themselves. */
  const heirsTouched = useRef(false);
  if (prevScopedToOne.current !== scopeKey) {
    prevScopedToOne.current = scopeKey;
    if (knownVault) {
      vaultSeeded.current = false;
      setPaths([]);
      setNumPaths(null);
    }
    if (!heirsTouched.current) {
      heirsSeeded.current = false;
      setHeirs([]);
      setNumHeirs(null);
    }
  }
  const [comments, setComments] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Submit failures get a blocking dialog, not a line of small text: a
   *  test submission failed without anyone noticing (2026-08-28). */
  const [submitFail, setSubmitFail] = useState<{ title: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  // The field being typed in and the button under it both stay above the
  // keyboard (decided 2026-09-18). The buttons sit in a pinned footer that rises
  // above the keys on its own (decided 2026-10-05), so only the field has to be
  // scrolled clear of the footer's fade.
  const revealScrollRef = useRef<ScrollView | null>(null);
  const revealOffsetY = useRef(0);
  useRevealFocusedField(revealScrollRef, revealOffsetY, true, { confirmPinned: true });

  const [dialog, setDialog] = useState<{ title: string; message: string; done?: boolean } | null>(null);
  // Post-submit success page (decided 2026-07-26): the PDF is ready instantly
  // (staff approval retired) and each heir can be emailed their own copy,
  // drafted in the owner's DEFAULT mail app (mailto:). Replaces the BCC offer.
  const [doneHeirs, setDoneHeirs] = useState<
    { name: string; email: string }[] | null
  >(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const sessionRef = useRef<CompanySession | null>(null);
  const userName = useRef<string>('');

  // Elite unlocks the co-signing limit fields (website parity).
  React.useEffect(() => {
    void (async () => {
      try {
        const session = await loadSession();
        if (!session) return;
        sessionRef.current = session;
        userName.current = [session.firstName, session.lastName].filter(Boolean).join(' ');
        // The scope question, exactly as the website asks it. A failure means
        // the question is not asked and the plan files unscoped, as before.
        try {
          const opts = await fetchEstatePlanScopeOptions(session);
          setScopeOptions(opts);
          // Opened FOR one vault (the hub's per-vault row, the vault
          // screen's banner): answer the scope question with it, when the
          // backend offers that account (decided 2026-09-04).
          // The vault the wizard was opened FOR is the answer, whether or
          // not the backend's list happens to carry it and whether or not
          // this phone holds that vault (decided 2026-09-24: "No matter which
          // vault I click, it seems to select the first vault which is
          // still missing an estate plan ... Please just choose the vault
          // that the user selects"). If it turns out not to be one this
          // client may file for, the door says so by name; silently filing
          // for a different vault is the one outcome nobody can catch.
          const wanted = wantedAccount.current;
          if (wanted != null) {
            setScopeChoice('account');
            setScopeAccounts([wanted]);
          }
        } catch {
          // question not asked — unscoped submission, the pre-2026-08 shape
        }
        // A Lifetime Elite member with an old expired plan has no lifetime row
        // in the list (the server adds it only to an empty list), so the flag
        // is read here too, or the Elite-only fields stay hidden (2026-09-12).
        try {
          const profile = await fetchProfile(session);
          if (profile.phoneNumber) {
            setPhoneNumber((prev) => prev || profile.phoneNumber);
          }
          // Everything we hold about them is shown back, filled in, so a
          // name typed carelessly at sign-up can be put right here (decided
          // 2026-09-25). Never over something already typed on this screen.
          if (profile.firstName) setClientFirstName((prev) => prev || profile.firstName);
          if (profile.lastName) setClientLastName((prev) => prev || profile.lastName);
          if (profile.dateOfBirth) setDob((prev) => prev || profile.dateOfBirth);
        } catch {
          // phone stays manual
        }
      } catch {
        // the profile prefill is best effort
      }
    })();
  }, []);

  const keyOptions = useMemo(
    () => [...hwLabels.filter((l) => l.trim()), TWENTY_FIRST],
    [hwLabels],
  );
  const heirKeyOptions = useMemo(() => {
    // The client's own devices PLUS the labels of keys their heirs hold —
    // an heir's key lives in a recovery path, never among the client's
    // hardware wallets, so it must be offered separately (decided 2026-07-27).
    const opts = [...hwLabels.filter((l) => l.trim())];
    for (const h of knownHeirs) {
      if (h.keyLabel !== NO_KEY_ACCESS && !opts.includes(h.keyLabel)) opts.push(h.keyLabel);
    }
    return [...opts, NO_KEY_ACCESS];
  }, [hwLabels, knownHeirs]);
  const allowedConfigs = useMemo(
    () => VAULT_CONFIG_OPTIONS.filter((c) => keyCountFor(c) <= hwLabels.filter((l) => l.trim()).length + 1),
    [hwLabels],
  );

  // ---- Step navigation with the website's branching rules ----
  const stepOrder = (): Step[] => {
    // Known vault (launched from a wallet): keys, primary config and
    // recovery paths come from the descriptor — only ask what we can't know
    // (heirs, optional extras).
    const order: Step[] = knownVault
      ? ['details', 'primary', 'heirsCount']
      : ['details', 'keys', 'primary', 'heirsCount'];
    for (let i = 0; i < (numHeirs ?? 0); i++) order.push({ heir: i });
    // The extra-approval step was removed from the website form (decided
    // 2026-08-10): heir support is conditioned on the owner being deceased
    // or incapacitated, so a per-heir approval gate is redundant. The app
    // mirrors the site (decided 2026-08-28).
    if (!knownVault) {
      order.push('pathsCount');
      for (let i = 0; i < (numPaths ?? 0); i++) order.push({ path: i });
    }
    order.push('review');
    return order;
  };
  const stepIndex = (s: Step) =>
    stepOrder().findIndex((x) => JSON.stringify(x) === JSON.stringify(s));
  const goNext = () => {
    // A step advanced past is a step answered — the correction note (e.g.
    // the scope bounce from submit) must not follow the client forward.
    setError(null);
    const order = stepOrder();
    const i = stepIndex(step);
    if (i >= 0 && i < order.length - 1) setStep(order[i + 1]);
  };
  // Refs so the beforeRemove interceptor sees current state (decided 2026-07-21:
  // an accidental swipe or header-back must step back ONE, never exit the
  // whole protocol).
  const orderRef = useRef<Step[]>([]);
  orderRef.current = stepOrder();
  const stepRef = useRef<Step>(step);
  stepRef.current = step;
  /** Once the plan is SUBMITTED the wizard is over: back must leave the
   *  screen, never step "back" into a form that was already filed (found
   *  2026-08-28: Done on the success page landed on the heir step, and the
   *  same interception was behind the earlier "jumped back" reports). */
  const doneRef = useRef(false);
  /** Move one step back inside the wizard; returns false if already first. */
  const goOneStepBack = React.useCallback((): boolean => {
    const order = orderRef.current;
    const i = order.findIndex((x) => JSON.stringify(x) === JSON.stringify(stepRef.current));
    if (i > 0) {
      setStep(order[i - 1]);
      return true;
    }
    return false;
  }, []);
  // Disable the swipe gesture; intercept the header back + any pop so it
  // steps back instead of leaving.
  React.useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
    const unsub = navigation.addListener('beforeRemove', (e) => {
      // Only the header back and a pop step back one page, as in every other
      // wizard. A reset (the Done of a claim an invite link opened over this
      // screen) leaves instead of silently rewinding the questionnaire.
      if (e.data.action.type !== 'GO_BACK' && e.data.action.type !== 'POP') return;
      if (doneRef.current) return; // submitted: every way out leaves
      if (goOneStepBack()) e.preventDefault();
    });
    return unsub;
  }, [navigation, goOneStepBack]);
  const goBack = () => {
    const order = stepOrder();
    const i = stepIndex(step);
    if (i > 0) setStep(order[i - 1]);
    else navigation.goBack();
  };

  /** This vault belongs to a family member, so nothing about the account
   *  holder's own person belongs on this step (reported 2026-09-16: "if the plan is
   *  for someone else, whats the point of requiring the date of birth of the
   *  main account owner?"). That person is identified by their own name and
   *  date of birth, asked above. */
  /* Always the client's own details: the plan is theirs (decided 2026-09-25). */
  /** Asked only when it is the client's own plan AND we do not already hold
   *  the date. The backend falls back to the account's record. */

  const stepValid = (): boolean => {
    if (step === 'details') {
      // The document names the client, so the name and the birthday are
      // required here whether they came from our record or were typed now
      // (decided 2026-09-25). The phone stays optional, as it always was.
      if (!clientFirstName.trim() || !clientLastName.trim()) return false;
      if (!dateOk(dob, true)) return false;
      // The website's scope rules, verbatim: an asked question needs an
      // answer; a scoped plan needs its account and its holder; a holder
      // outside the household needs a name and a date of birth.
      if (askScope) {
        if (!scopeChoice) return false;
        if (scopeChoice === 'account') {
          if (scopeAccounts.length === 0) return false;
        }
      }
      return true;
    }
    if (step === 'keys')
      return hwLabels.length >= 1 && hwLabels.every((l) => l.trim().length > 0);
    if (step === 'primary') {
      // Limits that contradict each other never leave the phone.
      return knownVault
        ? true
        : !!vaultConfig && primaryKeys.length === keyCountFor(vaultConfig);
    }
    // Any count is valid, including zero — the plan is the client's document
    // and their wishes may have changed since vault setup (decided 2026-09-01:
    // no guards on the heir count, same as the website).
    if (step === 'heirsCount') return numHeirs != null;
    if (typeof step === 'object' && 'heir' in step) {
      const h = heirs[step.heir];
      if (!h) return false;
      // Every heir field is mandatory (decided 2026-07-21) — no point collecting
      // partial information about who inherits.
      // The SHARE is deliberately not gated here. It used to require more than
      // 0%, which dead-ended the client the moment an earlier heir took the
      // whole estate: Continue went grey and said nothing (decided 2026-08-30). The
      // website has never gated it either. An unfinished split is now reported
      // in plain language on the review step, where the client can see the
      // whole picture and fix it, and our team reads every plan before the PDF
      // is issued.
      // The EMAIL is optional (decided 2026-08-30: "I just want users to be able to
      // add their kids who are still too young to have an email"), EXCEPT for
      // an heir who holds a key (decided 2026-09-23). A key holder will one day ask
      // us to co-sign or rescue, and we recognise an heir by their verified
      // address (apps/vaults/vault_access.py): without one they are refused.
      // An heir with no key never asks us for anything, so the child case is
      // untouched. The field label carries this; nothing explains it.
      return (
        h.firstName.trim().length > 0 &&
        h.lastName.trim().length > 0 &&
        dateOk(h.dob) &&
        heirEmailOk(h.email, h.keyLabel) &&
        !!h.relationship &&
        (h.relationship !== 'Other' || h.relationshipOther.trim().length > 0)
      );
    }
    if (step === 'pathsCount') return numPaths != null;
    if (typeof step === 'object' && 'path' in step) {
      const p = paths[step.path];
      if (!p) return false;
      if (p.isRescuePath) return true;
      if (!p.config) return false;
      if (p.config === 'Single Signature') return !!p.keyHolder;
      return p.keyHoldersMultisig.length === keyCountFor(p.config);
    }
    if (step === 'review') return consent;
    return true;
  };

  // ---- Payload assembly (website-parity transforms) ----
  const formatHolder = (label: string): string => {
    if (label === TWENTY_FIRST) return TWENTY_FIRST;
    if (label === 'Myself') return userName.current ? `Myself: ${userName.current}` : 'Myself';
    return label;
  };

  /**
   * What the HEIRS read in the PDF. The structured payload describes one
   * vault (the lead), so when a second vault is covered the document must
   * name it and its shape explicitly — otherwise the plan quietly describes
   * the wrong vault to the people relying on it (decided 2026-07-27).
   */
  const coverageStatement = (): string => {
    if (coveredVaults.length === 0) return '';
    if (coveredVaults.length === 1) {
      return `This Estate Plan covers your 21st Capital vault “${coveredVaults[0].label}”.`;
    }
    const lines = coveredVaults.map((v) => {
      let shape = '';
      try {
        const pp = parsePolicy(v.descriptor).paths[0];
        if (pp) {
          const { needed, keys } = pathRequirement(pp);
          shape = keys.length === 1 ? 'Single Signature' : `${needed}/${keys.length} Multisig`;
        }
      } catch {
        // shape unknown — the name alone still identifies the vault
      }
      return `• “${v.label}”${shape ? ` · ${shape}` : ''}`;
    });
    const scope = coversEverything
      ? `all ${coveredVaults.length} of your 21st Capital vaults`
      : `${coveredVaults.length} of your 21st Capital vaults`;
    return (
      `This Estate Plan covers ${scope}:\n${lines.join('\n')}\n\n` +
      `The vault details below describe “${coveredVaults[0].label}”; the recovery ` +
      `paths listed cover every vault named above.`
    );
  };

  /**
   * The key register, in prose, for the document itself. The structured
   * fields above are what a future PDF template should read, but this makes
   * every fingerprint visible in TODAY's document — and it is the only place
   * that can name keys the label arrays cannot reach: 21st Capital's own
   * keys, and keys that exist only in a second vault (decided 2026-07-27).
   */
  /**
   * Fingerprint for a label, from the register (own keys and heir keys).
   *
   * The LEAD vault's rows are searched first: since keys are named Key 1,
   * Key 2 by default (decided 2026-09-26), a plan covering more than one vault can
   * hold that label twice, and the chips the owner picks from are the lead
   * vault's. Matching by label at all is a weakness of this screen, not of
   * the names: a key's identity is its fingerprint.
   */
  const fpForLabel = (label: string): string => {
    const leadLabel = coveredVaults[0]?.label;
    const rows = prefill.register;
    const mine = rows.find((r) => r.label === label && r.vault === leadLabel);
    return (mine ?? rows.find((r) => r.label === label))?.fingerprint.toLowerCase() ?? '';
  };

  const keyRegisterStatement = (): string => {
    const rows = prefill.register;
    if (rows.length === 0) return '';
    // Where each key sits, true for every vault shape (decided 2026-09-22):
    // "spends at any time" was false for any key of a multisig (one key of a
    // 2-of-3 spends nothing alone, and heirs read this), and "opens after N
    // months" said a KEY opens on a vault-wide clock, with invented months.
    // A PATH opens, per coin, after the path's own wait.
    const line = (r: (typeof rows)[number], i: number) => {
      const wait = prefill.registerWaits[i];
      const kind = r.role === 'rescue' ? 'rescue key' : 'recovery key';
      const where =
        r.role === 'primary'
          ? 'on the primary path, no waiting period'
          : wait
            ? `${kind}, on a recovery path that opens for each coin left untouched for ≈ ${wait}`
            : `${kind}, on a recovery path`;
      const fp = r.fingerprint ? `fingerprint ${r.fingerprint}` : 'fingerprint not recorded';
      return `• ${r.label} · ${fp} · ${where}${
        coveredVaults.length > 1 ? ` · vault “${r.vault}”` : ''
      }`;
    };
    return `KEY REGISTER\nEvery key involved in this plan, so your heirs can identify each one on their device:\n${rows
      .map(line)
      .join('\n')}`;
  };

  const buildPayload = (): InheritancePayload => {
    const drafts = heirs.slice(0, numHeirs ?? 0);
    // A stand-in is identified to the backend by NAME (what the PDF prints)
    // and by EMAIL (what tells two people of the same name apart). The form's
    // own uid means nothing outside this screen, so it is not sent.
    const byUid = new Map(drafts.map((d) => [d.uid, d]));
    const activeHeirs: InheritanceHeir[] = drafts.map((h) => {
      const target = h.substituteForUid ? byUid.get(h.substituteForUid) : undefined;
      return {
        firstName: h.firstName,
        lastName: h.lastName,
        dob: h.dob,
        email: h.email,
        keyLabel: h.keyLabel,
        keyFingerprint: (h.keyFingerprint ?? '').toUpperCase(),
        relationship: h.relationship,
        relationshipOther: h.relationship === 'Other' ? h.relationshipOther : '',
        percentage: Math.max(0, Math.min(100, parseFloat(h.percentage) || 0)),
        substituteFor: target ? `${target.firstName} ${target.lastName}`.trim() : '',
        substituteForEmail: target ? target.email.trim() : '',
      };
    });
    const heirByLabel = new Map(
      activeHeirs
        .filter((h) => h.keyLabel && h.keyLabel !== NO_KEY_ACCESS)
        .map((h) => [h.keyLabel, h]),
    );
    const activePaths: InheritanceLegacyPath[] = paths.slice(0, numPaths ?? 0).map((p) => {
      const keys = p.config === 'Single Signature' ? [p.keyHolder] : p.keyHoldersMultisig;
      const pathHeirs = keys
        .filter((k) => heirByLabel.has(k))
        .map((k) => {
          const h = heirByLabel.get(k)!;
          return { name: `${h.firstName} ${h.lastName}`.trim(), key_label: k };
        });
      return {
        config: p.config,
        otpEmail: '',
        keyHolder: p.config === 'Single Signature' ? formatHolder(p.keyHolder) : '',
        keyHolderFingerprint:
          p.config === 'Single Signature' ? (p.keyHolderFp ?? '').toUpperCase() : '',
        keyHoldersMultisig:
          p.config === 'Single Signature' ? [] : p.keyHoldersMultisig.map(formatHolder),
        keyHoldersMultisigFingerprints:
          p.config === 'Single Signature'
            ? []
            : p.keyHoldersMultisig.map((_, i) =>
                (p.keyHoldersMultisigFps?.[i] ?? '').toUpperCase(),
              ),
        heirs: pathHeirs,
        specialInstructions: '',
        timelockDuration: p.timelockDuration,
        isRescuePath: p.isRescuePath,
      };
    });
    const selfKeys = primaryKeys.filter((k) => k !== TWENTY_FIRST).length;
    const vaultKeyHolders =
      vaultConfig === 'Single Signature'
        ? ''
        : primaryKeys.includes(TWENTY_FIRST)
          ? `${selfKeys} Key(s) Myself + 1 Key ${TWENTY_FIRST}`
          : 'All Keys Myself';
    return {
      language: 'en',
      protocolName,
      // What the client confirmed or corrected on step 1 (decided 2026-09-25).
      // Omitted, never null: the backend reads these with .strip() and
      // leaves the account's own record alone when they are absent, so an
      // untouched field cannot blank anything.
      ...(clientFirstName.trim() ? { clientFirstName: clientFirstName.trim() } : {}),
      ...(clientLastName.trim() ? { clientLastName: clientLastName.trim() } : {}),
      ...(dob ? { dob } : {}),
      ...(phoneNumber ? { phoneNumber } : {}),
      numHeirs: String(numHeirs ?? 0),
      vaultConfig,
      vaultKeyHolders,
      vaultKeyLabels: primaryKeys,
      // Index-parallel to vaultKeyLabels. Positional, not looked up by
      // label: two 21st Capital keys share one label (decided 2026-07-27).
      vaultKeyFingerprints: primaryKeys.map((l, i) =>
        (l === prefill.selected[i] ? prefill.selectedFps[i] ?? '' : '').toUpperCase(),
      ),
      numHardwareWallets: String(hwLabels.filter((l) => l.trim()).length),
      hardwareWalletLabels: hwLabels.filter((l) => l.trim()),
      hardwareWalletFingerprints: hwLabels
        .map((l, i) => ({ l, fp: hwFingerprints[i] ?? '' }))
        .filter((x) => x.l.trim())
        .map((x) => x.fp.toUpperCase()),
      otpEmail: '',
      heirs: activeHeirs,
      numLegacyPaths: numPaths ? String(numPaths) : '',
      legacyPaths: activePaths,
      // The coverage line belongs in the DOCUMENT, not just on screen: the
      // heirs reading the PDF need to know which vaults it speaks for
      // (decided 2026-07-27).
      // EVERY key, with its fingerprint, vault and role — including 21st
      // Capital's own keys and keys that live only in a second vault, which
      // none of the label arrays can reach (decided 2026-07-27).
      allKeys: prefill.register,
      comments: [coverageStatement(), keyRegisterStatement(), comments.trim()]
        .filter(Boolean)
        .join('\n\n'),
      dataPrivacy: consent,
      // Which vault the plan covers, and who holds it — the website's exact
      // contract (only sent when the question was asked; absence means "all",
      // same as every plan before the question existed).
      ...(askScope && scopeChoice === 'account' && scopeAccounts.length > 0
        ? {
            vaultScope:
              scopeAccounts.length === 1
                ? {
                    type: 'account' as const,
                    account: scopeAccounts[0],
                    vaultNumber: vaultNumberFor(scopeAccounts[0]),
                  }
                : {
                    type: 'accounts' as const,
                    accounts: scopeAccounts,
                    vaultNumbers: scopeAccounts.map(vaultNumberFor),
                  },
          }
        : {}),
    };
  };

  const submit = async () => {
    setError(null);
    // The scope question can arrive AFTER the client passed the first step
    // (they logged in mid-wizard). An asked question must not go unanswered
    // into the document: bring them back to it instead of filing blind.
    if (askScope && !scopeChoice) {
      setStep('details');
      setError('Please choose which vault this Estate Plan covers.');
      return;
    }
    setBusy(true);
    try {
      let session = sessionRef.current ?? (await loadSession());
      if (!session) {
        setBusy(false);
        setAuthOpen(true);
        return;
      }
      await submitInheritanceProtocol(session, buildPayload());
      // Trust, then verify: ask the server whether the plan actually exists
      // now. A 200 with no stored plan (or anything in between) must never
      // show the success page (decided 2026-08-28: a submission vanished with no
      // visible error).
      const check = await fetchInheritanceStatus(session).catch(() => null);
      if (check != null && check.hasAny !== true) {
        setSubmitFail({
          title: 'The plan did not go through',
          message:
            'The server accepted the request but reports no stored Estate Plan. Please try again, and contact us if this repeats.',
        });
        return;
      }
      await updateSettings({ inheritanceSubmittedAt: Date.now() });
      doneRef.current = true;
      // An email typed here is knowledge the vault should keep (decided
      // 2026-08-27): write it back onto the matching heir entry so the
      // invite flow and the next plan run find it. Keyed entries match by
      // fingerprint; keyless ones by their creation id, carried through the
      // seeding as draft.heirId (decided 2026-08-27 — the id makes them
      // unambiguous after all).
      for (const v of coveredVaults) {
        // Rules, tests and the reasoning live in wallet/planHeirs.ts. They
        // decide who is already on the vault, whose address to keep, and who
        // has to JOIN it: a tester filed a plan with two heirs and was offered one
        // invite, because a person named only in the document never reached
        // wallet.heirs, which is what the invite picker reads (2026-08-30).
        // Only keys THIS vault actually contains: the invite screen refuses
        // a fingerprint absent from the descriptor ("Key not found"), and one
        // plan covers several vaults.
        const vaultKeys = new Set(
          parseKeyOrigins(v.descriptor).flatMap((k) =>
            k.fingerprint ? [k.fingerprint.toLowerCase()] : [],
          ),
        );
        // Names travel too (decided 2026-09-21): the invite greets the heir by
        // the name typed here, never by the label of the key they hold.
        const merged = mergePlanHeirsIntoVault(
          v.heirs ?? [],
          heirs.slice(0, numHeirs ?? 0).map((h) => ({ ...h, substituteFor: h.substituteForUid })),
          newHeirId,
          vaultKeys,
        );
        if (merged.changed) void updateWallet(v.id, { heirs: merged.heirs });
      }
      // Straight to the success page: the PDF is ready NOW (staff approval
      // retired 2026-07-26) and every heir with a valid email can be sent
      // their own attached copy from here.
      setDoneHeirs(
        heirs
          .slice(0, numHeirs ?? 0)
          .map((h) => ({
            name: `${h.firstName} ${h.lastName}`.trim(),
            email: h.email.trim(),
          }))
          .filter((h) => h.email.length > 0 && emailOk(h.email)),
      );
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      if (code === 'VAULT_SCOPE_INVALID') {
        // The vault we named is not one the plan can be filed under yet. Send
        // them back to the question with the choice cleared, so the next
        // attempt cannot repeat the same refusal, and say why in plain words
        // rather than passing through the server's account jargon.
        setScopeAccounts([]);
        setScopeChoice('');
        setStep('details');
        setError(
          'That vault cannot have its own Estate Plan yet. A vault gets its ' +
            'own plan once 21st Capital has tested it. Choose another vault, ' +
            'or file one plan covering all of them.',
        );
        return;
      }
      setSubmitFail({
        title:
          code === 'ESTATE_PLAN_LOCKED'
            ? 'A plan is already filed'
            : 'Could not submit your Estate Plan',
        message:
          code === 'ESTATE_PLAN_LOCKED'
            ? 'An Estate Plan covering this vault is already on file. Contact 21st Capital to unlock a resubmission, then file the replacement.'
            : (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };

  // ---- Small render helpers (design-system chips/selects) ----
  const Chip = ({
    label,
    on,
    onPress,
    disabled,
  }: {
    label: string;
    on: boolean;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn, disabled && styles.chipDisabled]}
      accessibilityState={{ disabled: !!disabled, selected: on }}
      disabled={disabled}
      onPress={onPress}>
      <Text style={[styles.chipText, on && styles.chipTextOn, disabled && styles.chipTextDisabled]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  /** The scope question's option cards — same shape as the website's. */
  
  const stepTitle = (): string => {
    if (step === 'details') return 'Your details';
    if (step === 'keys') return 'Your hardware keys';
    // With a known vault this step shows EVERY path (the policy graph), so
    // "Primary spending path" undersold it (decided 2026-09-01). The manual Q&A
    // variant really does ask only about the primary path and keeps its name.
    if (step === 'primary') return knownVault ? 'Vault overview' : 'Primary spending path';
    if (step === 'heirsCount') return 'Your heirs';
    if (typeof step === 'object' && 'heir' in step) return `Heir ${step.heir + 1}`;
    if (step === 'pathsCount') return 'Recovery paths';
    if (typeof step === 'object' && 'path' in step) return `Recovery path ${step.path + 1}`;
    return 'Review & submit';
  };

  const total = stepOrder().length;
  const current = Math.max(0, stepIndex(step)) + 1;

  // ---- Post-submit success page: instant PDF + per-heir delivery.
  // Rendered inside the SAME StepTransition as the wizard (keyed 'done')
  // so the payoff screen slides in like every other step (decided 2026-07-24).
  const finishSubmitted = () => {
    navigation.goBack();
  };
  const downloadPdf = async () => {
    setPdfBusy('pdf');
    try {
      const session = sessionRef.current ?? (await loadSession());
      if (!session) throw new Error('Please log in again to download your plan.');
      await shareEstatePlanPdf(session);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPdfBusy(null);
    }
  };

  // Everything the vault question used to say on screen, now behind its dot
  // (reported 2026-09-04: "waaaay too much text").
  const scopeInfoText = [
    remainingVaults && remainingVaults.length < vaultsWithUs
      ? 'Some of your vaults already have a plan. Pick the vault this one is for.'
      : `You have ${vaultsWithUs} vaults with us. Each one gets its own plan.`,
    'The PDF states which vault this plan applies to.',
    knownVault && eligibleVaultCount > 1
      ? `The vault details are filled in from “${coveredVaults[0]?.label ?? ''}”.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  // Who holds the vault the plan is scoped to. Asked whenever a vault is
  // chosen, INCLUDING the auto-selected last vault (decided 2026-09-04: the
  // website asks, so must the app; an extra plan may be a family member's).
  /* "Who does this vault belong to?" is gone (decided 2026-09-25). An Elite
     client can hand a whole vault SLOT to another person, who then builds
     it with their own email and files its Estate Plan themselves; and money
     meant for a child is named by naming that child as an heir with 100%.
     Neither needs a sentence in somebody else's document claiming the vault
     is not theirs, which nothing else in the system would agree with. */

  return (
    <View style={styles.root}>
      <ScrollView
        ref={revealScrollRef}
        onScroll={(e) => {
          revealOffsetY.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={32}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        // No keyboard inset: the footer's own rise shortens the scroll area
        // by the keyboard already; an inset on top would leave a keyboard's
        // worth of blank under the last field.
        keyboardDismissMode="interactive">
        <StepTransition
          stepKey={doneHeirs ? 'done' : JSON.stringify(step)}
          order={[...stepOrder().map((s) => JSON.stringify(s)), 'done']}
          style={styles.stepWrap}>
        {/* Kicker + title slide WITH the step — a header that swapped in place
            while the body slid made the change read as "it just appeared". */}
        <Text style={styles.kicker}>
          {doneHeirs
            ? 'ESTATE PLAN · SUBMITTED'
            : `ESTATE PLAN · STEP ${current} OF ${total}`}
        </Text>
        {doneHeirs ? (
          // The tick sits beside "ready" (decided 2026-09-21: it took a whole row
          // of its own under the title).
          <View style={styles.readyRow}>
            <Text style={styles.title}>Your Estate Plan is ready</Text>
            <DrawnIcon kind="tick" size={24} strokeWidth={4} />
          </View>
        ) : (
          <Text style={styles.title}>{stepTitle()}</Text>
        )}

        {doneHeirs && (
          <>
            {/* Two numbered steps (decided 2026-09-21: "use numbered bullet points
                for both steps and put the (i) next to the title"). The bubble
                is the one the exchange guides number their steps with. */}
            <Card style={styles.doneStep}>
              <View style={styles.doneStepHead}>
                <View style={styles.stepBubble}>
                  <Text style={styles.stepNumber}>1</Text>
                </View>
                <Text style={styles.doneStepTitle}>Keep a copy for yourself</Text>
              </View>
              <Button
                title={pdfBusy === 'pdf' ? 'Preparing your PDF…' : 'Download my Estate Plan (PDF)'}
                onPress={() => void downloadPdf()}
                loading={pdfBusy === 'pdf'}
                disabled={!!pdfBusy}
              />
            </Card>
            {(numHeirs ?? 0) > 0 && (
              // The invite, not the plan (decided 2026-08-29). Emailing the
              // document told an heir what to do one day; the invite is what
              // actually lets them reach the vault, and it is the thing they
              // have to keep.
              <Card style={styles.doneStep}>
                <View style={styles.doneStepHead}>
                  <View style={styles.stepBubble}>
                    <Text style={styles.stepNumber}>2</Text>
                  </View>
                  <View style={styles.flex1}>
                    {/* The invite opens the vault's DETAILS, never coins
                        (decided 2026-09-22): a keyless heir's code reaches no
                        coin, a timelocked heir's key waits on their path, and
                        one key of an everyday 2-of-3 spends nothing alone. */}
                    <InfoHeading
                      title="What an invite gives them"
                      text={
                        'An invite is a code you hand to one heir. What it opens is your choice when you create it: a sealed card that says only that they are named, until the first waiting period for an heir ends (offered only for an heir whose key waits on a timelock), or the vault in full from the day they claim it.\n\nThe code travels separately from the plan on purpose. Someone who finds the document learns who inherits; the vault\'s details open only with the code, plus the heir\'s own key when their invite requires it.'
                      }
                      style={styles.doneStepTitle}>
                      {/* "Heir(s)" speaks to one heir as well as several (decided
                          2026-09-21), so the words never switch. */}
                      Now invite your heir(s)
                    </InfoHeading>
                  </View>
                </View>
                <Text style={styles.sub}>
                  Each heir needs their own invite code to reach the vault.
                </Text>
                {coveredVaults.map((v) => (
                  <Button
                    key={v.id}
                    title={
                      coveredVaults.length > 1
                        ? `Invite heir(s) for “${v.label}”`
                        : 'Invite my heir(s)'
                    }
                    variant={coveredVaults.length > 1 ? 'ghost' : 'accent'}
                    disabled={!!pdfBusy}
                    onPress={() => navigation.navigate('InviteHeir', { walletId: v.id })}
                  />
                ))}
                {/* Every heir named, nobody with an address: the invites are
                    handed over in person. Silence would read as a bug. */}
                {doneHeirs.length === 0 && (
                  <Text style={styles.doneNote}>
                    No heir has an email address, so hand each code over in person.
                  </Text>
                )}
              </Card>
            )}
          </>
        )}
        {!doneHeirs && step === 'details' && (
          <>
            <InfoHeading
              title="Your Estate Plan"
              // One vault, always (decided 2026-09-24: an Estate Plan is filed
              // for one vault), so the sentence never counts anything. It
              // used to say "vaults" until the vault list arrived and then
              // switch to "vault" under the reader (decided 2026-09-25).
              text="This is the comprehensive document your family follows to access your vault when they need to. Your keys, recovery paths and heirs are filled in from it, so there is little left to type."
              style={styles.sub}>
              This builds the document your family follows to access your vault.
            </InfoHeading>
            {askScope && remainingVaults?.length === 0 && scopeAccounts.length === 0 && (
              <Card style={styles.sectionCard}>
                <Text style={styles.summaryLine}>Every vault already has an Estate Plan.</Text>
              </Card>
            )}
            {askScope && !vaultIsKnown && singleRemaining && scopeAccounts.length <= 1 && (
              <Card style={styles.sectionCard}>
                <Text style={styles.summaryLine}>
                  This plan covers{' '}
                  {scopableVaults.find((v) => v.account === remainingVaults![0].account)?.label ??
                    `account ${remainingVaults![0].account}`}
                  , the only vault without one.
                </Text>
              </Card>
            )}
            {/* Opened FROM a vault, which every route from the hub and the
                vault page is: the answer is known, so it is STATED, not asked
                (decided 2026-09-24: "that question only matters if we did not
                already know the answer which we do because the user selects
                the vault he is submitting the plan for"). Who the vault
                belongs to is still a question: it may be a child's. */}
            {/* Nothing about WHICH vault is shown here (decided 2026-09-25:
                "Please delete this entire section. There is no need to
                display it at all. The user knows where he is because he
                clicked the vault he wants to submit the plan for"). The
                plan's own name carries it anyway. */}
            {askScope && !vaultIsKnown && !(remainingVaults?.length === 0 && scopeAccounts.length === 0) && !(singleRemaining && scopeAccounts.length <= 1) && (
              <Card style={styles.sectionCard}>
                {/* ONE plan, ONE vault (decided 2026-09-24: "the user has to
                    submit an estate plan for EACH VAULT INDIVIDUALLY").
                    "All of my accounts" is gone: it predates giving a vault
                    away, and it let one document speak for vaults that were
                    not the client's to speak for, and for vaults built after
                    it was written. */}
                <InfoHeading
                  title="Which vault is this plan for?"
                  text={scopeInfoText}
                  style={styles.summaryLine}>
                  Which vault is this plan for?
                </InfoHeading>
                {!canScopeToOne && (
                  <Text style={styles.fieldWarn}>
                    Your vaults get their account numbers once 21st Capital has tested them.
                    Please file this plan after your testing session.
                  </Text>
                )}
                {scopeChoice === 'account' && (
                  <>
                    <View style={styles.chipRow}>
                      {/* Named, not numbered: the client knows their vaults by
                          the names they gave them. Every remaining vault can
                          be ticked (decided 2026-09-04: one plan for both). */}
                      {scopableVaults.map((v) => (
                        <Chip
                          key={v.id}
                          label={`${v.label} · account ${v.account}`}
                          on={scopeAccounts.includes(v.account)}
                          onPress={() => setScopeAccounts([v.account])}
                        />
                      ))}
                      {scopableVaults.length === 0 &&
                        (scopeOptions?.accounts ?? [])
                          .filter((a) => !a.hasPlan || scopeAccounts.includes(a.account))
                          .map((a) => (
                            <Chip
                              key={a.account}
                              label={
                                a.vaultNumber != null
                                  ? `Account ${a.account} (vault ${a.vaultNumber})`
                                  : `Account ${a.account}`
                              }
                              on={scopeAccounts.includes(a.account)}
                              onPress={() => setScopeAccounts([a.account])}
                            />
                          ))}
                    </View>
                    {scopableVaults.length === 0 &&
                      (scopeOptions?.accounts.length ?? 0) === 0 && (
                        <Text style={styles.fieldWarn}>
                          Your vaults get their account numbers once 21st Capital has tested them.
                          Choose one plan for all your vaults for now, or come back after your
                          testing session.
                        </Text>
                      )}
                      </>
                )}
              </Card>
            )}
            {/* The plan's own name first, so the step opens with WHICH plan
                this is before it asks who the client is (decided 2026-09-25). */}
            <TextField
              label="Plan name (optional)"
              value={protocolName}
              onChangeText={setProtocolName}
              placeholder="e.g. My Estate Plan 2026"
              autoCapitalize="sentences"
            />
            {/* Everything we already hold about the client, shown back and
                editable (decided 2026-09-25: "We show everything we already have
                from the client. If he changes it, it also changes his record
                on the backend ... Clients sometimes sign up with a fake
                name, and this should be the time to correct that"). The
                date of birth is shown filled in rather than asked for only
                when missing: a wrong one is as worth correcting as a wrong
                name, and this document is the one that has to be right. */}
            <TextField
              label="First name"
              value={clientFirstName}
              onChangeText={setClientFirstName}
              autoCapitalize="sentences"
            />
            <TextField
              label="Last name"
              value={clientLastName}
              onChangeText={setClientLastName}
              autoCapitalize="sentences"
            />
            <BirthDatePicker
              label="Your date of birth"
              value={dob}
              onChange={setDob}
              minAgeYears={18}
            />
            <TextField
              label="Phone number (optional)"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              keyboardType="phone-pad"
              placeholder="+1 202 555 0100"
            />
          </>
        )}

        {step === 'keys' && (
          <>
            <Text style={styles.sub}>
              The hardware keys you and your heirs hold.
            </Text>
            <Text style={styles.fieldLabel}>How many keys?</Text>
            <View style={styles.chipRow}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <Chip
                  key={n}
                  label={String(n)}
                  on={hwLabels.length === n}
                  onPress={() =>
                    setHwLabels((prev) => {
                      const next = prev.slice(0, n);
                      while (next.length < n) next.push('');
                      return next;
                    })
                  }
                />
              ))}
            </View>
            {hwLabels.map((l, i) => (
              <TextField
                key={i}
                label={`Key label ${i + 1}`}
                value={l}
                onChangeText={(t) =>
                  setHwLabels((prev) => prev.map((x, j) => (j === i ? t : x)))
                }
                placeholder={`e.g. ${exampleDeviceName()}, office`}
                autoCapitalize="sentences"
              />
            ))}
          </>
        )}

        {step === 'primary' && knownVault && (
          <>
            <Text style={styles.sub}>
              We already know your vault. Please check it.
            </Text>
            {/* The same policy picture as the vault's Spending policy screen
                (decided 2026-09-01: the graph, not a prose summary). */}
            {coveredVaults[0] && (
              <PolicyOverview wallet={coveredVaults[0]} isProviderKey={isProviderKey} />
            )}
          </>
        )}

        {step === 'primary' && !knownVault && (
          <>
            <Text style={styles.sub}>How your vault is spent day to day.</Text>
            <Text style={styles.fieldLabel}>Configuration</Text>
            <View style={styles.chipRow}>
              {allowedConfigs.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  on={vaultConfig === c}
                  onPress={() => {
                    setVaultConfig(c);
                    setPrimaryKeys((prev) => prev.slice(0, keyCountFor(c)));
                  }}
                />
              ))}
            </View>
            {!!vaultConfig && (
              <>
                <Text style={styles.fieldLabel}>
                  Which keys? Choose exactly {keyCountFor(vaultConfig)}.
                </Text>
                <View style={styles.chipRow}>
                  {keyOptions.map((k) => {
                    const on = primaryKeys.includes(k);
                    const full = primaryKeys.length >= keyCountFor(vaultConfig);
                    return (
                      <Chip
                        key={k}
                        label={k}
                        on={on}
                        disabled={!on && full}
                        onPress={() =>
                          setPrimaryKeys((prev) =>
                            on ? prev.filter((x) => x !== k) : [...prev, k],
                          )
                        }
                      />
                    );
                  })}
                </View>
              </>
            )}
          </>
        )}

        {step === 'heirsCount' && (
          <>
            <InfoHeading
              title="Who inherits"
              text={
                knownHeirs.length > 0
                  ? 'The heirs you named at vault setup are filled in below to save typing. The number itself is entirely your choice: your wishes may have changed since then, and what you enter here is what the plan records.'
                  : 'An heir is someone who inherits a share of what is in the vault. The plan records who they are and what share each one receives.'
              }
              style={styles.sub}>
              How many heirs should your Estate Plan name? You can also continue without heirs.
            </InfoHeading>
            <View style={styles.chipRow}>
              {Array.from({ length: Math.max(6, knownHeirs.length + 3) }, (_, n) => n).map((n) => (
                <Chip
                  key={n}
                  label={n === 0 ? 'No heirs' : String(n)}
                  on={numHeirs === n}
                  onPress={() => {
                    heirsTouched.current = true;
                    setNumHeirs(n);
                    setHeirs((prev) => {
                      const next = prev.slice(0, n);
                      while (next.length < n) next.push(emptyHeir());
                      // Dropping heirs can orphan a stand-in link to someone
                      // who is no longer in the plan.
                      return pruneSubstitutes(next);
                    });
                  }}
                />
              ))}
            </View>
          </>
        )}

        {typeof step === 'object' && 'heir' in step && heirs[step.heir] && (
          <>
            {(() => {
              const i = step.heir;
              const h = heirs[i];
              const set = (patch: Partial<HeirDraft>) => {
                heirsTouched.current = true;
                setHeirs((prev) =>
                  pruneSubstitutes(prev.map((x, j) => (j === i ? { ...x, ...patch } : x))),
                );
              };
              // Shares can't exceed 100% of the POOL this heir draws from:
              // the estate for a direct heir, the substituted heir's portion
              // for a stand-in (which is why naming stand-ins costs the other
              // heirs nothing).
              const remaining = remainingFor(shareHeirs, h.uid);
              const standIns = substituteCandidates(shareHeirs, i);
              const target = h.substituteForUid
                ? shareHeirs.find((x) => x.uid === h.substituteForUid)
                : undefined;
              const targetName = target?.name.trim() || 'that heir';
              return (
                <>
                  <TextField label="Legal first name" value={h.firstName} onChangeText={(t) => set({ firstName: t })} autoCapitalize="sentences" placeholder="Sofia" />
                  <TextField label="Last name" value={h.lastName} onChangeText={(t) => set({ lastName: t })} autoCapitalize="sentences" placeholder="Ramos" />
                  <BirthDatePicker label="Date of birth" value={h.dob} onChange={(t) => set({ dob: t })} />
                  {/* Emails named at vault creation become a tap-to-fill
                      pick-list (decided 2026-07-24) — free typing stays possible. */}
                  {knownHeirEmails.length > 0 && (
                    <>
                      <Text style={styles.fieldLabel}>Known heir emails</Text>
                      <View style={styles.chipRow}>
                        {knownHeirEmails.map((em) => (
                          <Chip key={em} label={em} on={h.email.trim().toLowerCase() === em} onPress={() => set({ email: em })} />
                        ))}
                      </View>
                    </>
                  )}
                  <TextField
                    label={heirEmailRequired(h.keyLabel) ? 'Email' : 'Email (optional)'}
                    value={h.email}
                    onChangeText={(t) => set({ email: t })}
                    keyboardType="email-address"
                    placeholder="heir@example.com"
                  />
                  {/* Say the consequence where the decision is made. A young
                      child can be named without an address, but cannot be
                      invited until they have one, and nothing later in the
                      form would tell the client that. An heir who holds a key
                      must give one, and the label alone says so. */}
                  {h.keyLabel === NO_KEY_ACCESS && h.email.trim().length === 0 && (
                    <Text style={styles.sub}>
                      Leave this empty for a child who has no email address yet. You
                      can name them in your plan now and invite them once they do.
                    </Text>
                  )}
                  {/* The seeded binding must be VISIBLE (decided
                      2026-08-27): a keyless seeded slot looked blank, so a
                      client could type a DIFFERENT person here and their
                      address would be saved onto the vault's heir — and
                      prefill that heir's full-visibility invite later. */}
                  {!!h.heirId && h.keyLabel === NO_KEY_ACCESS && (
                    <Text style={styles.sub}>
                      An heir you named when creating the vault. The address you type is
                      remembered for them, so use a later heir slot for anyone else.
                    </Text>
                  )}
                  <Text style={styles.fieldLabel}>Which key do they hold?</Text>
                  <View style={styles.chipRow}>
                    {heirKeyOptions.map((k) => (
                      <Chip
                        key={k}
                        label={k}
                        on={h.keyLabel === k}
                        onPress={() =>
                          set({
                            keyLabel: k,
                            // Keep the fingerprint with the key it belongs to.
                            keyFingerprint:
                              knownHeirs.find((kh) => kh.keyLabel === k)?.keyFingerprint ??
                              (k === NO_KEY_ACCESS ? '' : fpForLabel(k)),
                          })
                        }
                      />
                    ))}
                  </View>
                  {!!h.keyFingerprint && (
                    <Text style={styles.summaryFp}>
                      Fingerprint {h.keyFingerprint.toUpperCase()}. Printed in the plan so
                      they can identify this key.
                    </Text>
                  )}
                  {/* Substitute heirs (decided 2026-08-30). The common estate is
                      everything to the spouse with the children behind her,
                      which the single estate-wide pool made impossible to
                      express: the spouse took 100% and every later heir was
                      stuck at a share of zero. */}
                  {standIns.length > 0 && (
                    <>
                      <InfoHeading
                        title="Stand-in heirs"
                        text={`A stand-in inherits only in place of someone else, if that person has died or can no longer act. Their share comes out of that person's portion, so naming a stand-in takes nothing away from your other heirs.${
                          h.keyLabel !== NO_KEY_ACCESS
                            ? ' One thing to know: a key still works whenever its path opens. Naming this person as a stand-in records your wish, it does not stop the key they hold.'
                            : ''
                        }`}
                        style={styles.fieldLabel}>
                        When do they inherit?
                      </InfoHeading>
                      <View style={styles.chipRow}>
                        <Chip
                          label="Inherits directly"
                          on={!h.substituteForUid}
                          onPress={() => set({ substituteForUid: '', percentage: '' })}
                        />
                        <Chip
                          // Name them when there is only one candidate: the
                          // chip row below is hidden in that case, so a vague
                          // label would be the only thing the client sees at
                          // the moment they choose.
                          label={
                            standIns.length === 1
                              ? `Stands in for ${standIns[0].name}`
                              : 'Stands in for someone'
                          }
                          on={!!h.substituteForUid}
                          onPress={() =>
                            set({
                              substituteForUid: h.substituteForUid || standIns[0].uid,
                              percentage: '',
                            })
                          }
                        />
                      </View>
                      {!!h.substituteForUid && standIns.length > 1 && (
                        <>
                          <Text style={styles.fieldLabel}>Stands in for</Text>
                          <View style={styles.chipRow}>
                            {standIns.map((c) => (
                              <Chip
                                key={c.uid}
                                label={c.name}
                                on={h.substituteForUid === c.uid}
                                onPress={() => set({ substituteForUid: c.uid })}
                              />
                            ))}
                          </View>
                        </>
                      )}
                    </>
                  )}
                  <PercentSlider
                    label={
                      h.substituteForUid
                        ? `Share of ${targetName}'s portion`
                        : 'Share of the inheritance'
                    }
                    value={parseInt(h.percentage, 10) || 0}
                    onChange={(v) => set({ percentage: String(v) })}
                    max={remaining}
                    warn={remaining === 0}
                    helper={shareHelper(h, remaining, targetName, standIns.length > 0)}
                  />
                  <Text style={styles.fieldLabel}>Relationship to you</Text>
                  <View style={styles.chipRow}>
                    {RELATIONSHIP_OPTIONS.map((r) => (
                      <Chip key={r.value} label={r.label} on={h.relationship === r.value} onPress={() => set({ relationship: r.value })} />
                    ))}
                  </View>
                  {h.relationship === 'Other' && (
                    <TextField label="Please specify" value={h.relationshipOther} onChangeText={(t) => set({ relationshipOther: t })} autoCapitalize="sentences" placeholder="e.g. business partner" />
                  )}
                </>
              );
            })()}
          </>
        )}

        {step === 'pathsCount' && (
          <>
            {/* Per coin, in PolicyOverview's words (decided 2026-09-22): a
                path opens for each coin on that coin's own clock, not once
                the whole vault sits still. */}
            <InfoHeading
              title="Recovery paths"
              text="Every coin has its own clock, and moving a coin starts it again. A recovery path opens for a coin once that coin has sat untouched for the months set on the path. From then on, the path's keys can spend that coin."
              style={styles.sub}>
              Your safety net if the primary path's keys are ever lost.
            </InfoHeading>
            <View style={styles.chipRow}>
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <Chip
                  key={n}
                  label={n === 0 ? 'None' : String(n)}
                  on={numPaths === n}
                  onPress={() => {
                    setNumPaths(n);
                    setPaths((prev) => {
                      const next = prev.slice(0, n);
                      while (next.length < n) next.push(emptyPath());
                      // Website default: the LAST path is the 21C rescue path.
                      if (n >= 1) next[n - 1] = { ...rescuePath() };
                      return next;
                    });
                  }}
                />
              ))}
            </View>
          </>
        )}

        {typeof step === 'object' && 'path' in step && paths[step.path] && (
          <>
            {(() => {
              const i = step.path;
              const p = paths[i];
              const isLast = i === (numPaths ?? 0) - 1;
              const set = (patch: Partial<PathDraft>) =>
                setPaths((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <>
                  {isLast && (
                    <>
                      <Text style={styles.fieldLabel}>Is this a rescue path?</Text>
                      <View style={styles.chipRow}>
                        <Chip label="Yes, 21st Capital rescue" on={p.isRescuePath} onPress={() => set({ ...rescuePath() })} />
                        <Chip label="No" on={!p.isRescuePath} onPress={() => set({ ...emptyPath(), isRescuePath: false })} />
                      </View>
                    </>
                  )}
                  {p.isRescuePath ? (
                    <Card style={styles.sectionCard}>
                      <Text style={styles.sectionTitle}>21ST CAPITAL RESCUE PATH</Text>
                      {/* Per coin (decided 2026-09-22): a spend restarts the
                          clock of the coins it moves, not the whole vault's,
                          so an untouched coin still reaches 15 months. */}
                      <InfoHeading
                        title="Rescue path"
                        text="This is the standard rescue setup. Every coin has its own clock, and moving a coin starts it again, so the rescue path opens only for a coin left untouched for 15 months, and never sooner."
                        style={styles.sub}>
                        One key, held by 21st Capital. Its path opens only for a coin left
                        untouched for 15 months.
                      </InfoHeading>
                    </Card>
                  ) : (
                    <>
                      <Text style={styles.fieldLabel}>Configuration</Text>
                      <View style={styles.chipRow}>
                        {allowedConfigs.map((c) => (
                          <Chip key={c} label={c} on={p.config === c} onPress={() => set({ config: c, keyHolder: '', keyHoldersMultisig: [] })} />
                        ))}
                      </View>
                      {p.config === 'Single Signature' && (
                        <>
                          <Text style={styles.fieldLabel}>Key</Text>
                          <View style={styles.chipRow}>
                            {keyOptions
                              .filter((k) => k !== TWENTY_FIRST || isLast)
                              .map((k) => (
                                <Chip key={k} label={k} on={p.keyHolder === k} onPress={() => set({ keyHolder: k })} />
                              ))}
                          </View>
                        </>
                      )}
                      {!!p.config && p.config !== 'Single Signature' && (
                        <>
                          <Text style={styles.fieldLabel}>
                            Keys: choose exactly {keyCountFor(p.config)}.
                          </Text>
                          <View style={styles.chipRow}>
                            {keyOptions.map((k) => {
                              const on = p.keyHoldersMultisig.includes(k);
                              const full = p.keyHoldersMultisig.length >= keyCountFor(p.config);
                              return (
                                <Chip
                                  key={k}
                                  label={k}
                                  on={on}
                                  disabled={!on && full}
                                  onPress={() =>
                                    set({
                                      keyHoldersMultisig: on
                                        ? p.keyHoldersMultisig.filter((x) => x !== k)
                                        : [...p.keyHoldersMultisig, k],
                                    })
                                  }
                                />
                              );
                            })}
                          </View>
                        </>
                      )}
                      <Text style={styles.fieldLabel}>Opens after a coin sits untouched for (months)</Text>
                      <View style={styles.chipRow}>
                        {['8', '9', '10', '11', '12', '13', '14', '15'].map((m) => (
                          <Chip key={m} label={m} on={p.timelockDuration === m} onPress={() => set({ timelockDuration: m })} />
                        ))}
                      </View>
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}

        {!doneHeirs && step === 'review' && (
          <>
            {/* No standing line here. It used to promise that our team reviews
                the plan and emails the PDF when it is ready, which stopped
                being true when the approval step was retired (2026-07-26): the
                PDF is downloadable the moment you submit. Decided 2026-08-30, and
                the step was crowded anyway. */}
            {/* The only place the client sees the whole split at once. Without
                it an unfinished plan is invisible until the PDF arrives. */}
            {shareHeirs.length > 0 && (
              <Card style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Who inherits</Text>
                {shareHeirs.map((sh) => {
                  const standsFor = sh.substituteForUid
                    ? shareHeirs.find((x) => x.uid === sh.substituteForUid)
                    : undefined;
                  return (
                    <View key={sh.uid} style={styles.summaryRow}>
                      <Text style={styles.summaryName}>
                        {sh.name || 'Unnamed heir'}
                        {standsFor ? (
                          <Text style={styles.summaryStandIn}>
                            {`  stands in for ${standsFor.name || 'another heir'}`}
                          </Text>
                        ) : null}
                      </Text>
                      <Text style={styles.summaryShare}>
                        {standsFor ? `${sh.percentage}% of theirs` : `${sh.percentage}%`}
                      </Text>
                    </View>
                  );
                })}
                {planIssues.map((issue, n) => (
                  <Text key={`${issue.kind}${n}`} style={styles.summaryIssue}>
                    {issue.message}
                  </Text>
                ))}
              </Card>
            )}
            <TextField
              label="Comments (optional)"
              value={comments}
              onChangeText={setComments}
              placeholder="Anything your family should know that the form did not ask for."
              autoCapitalize="sentences"
              multiline
              minHeight={160}
            />
            <TouchableOpacity style={styles.consentRow} onPress={() => setConsent(!consent)}>
              <View style={[styles.checkbox, consent && styles.checkboxOn]}>
                {consent && <DrawnIcon kind="tick" size={13} strokeWidth={4} color={theme.colors.accentInk} />}
              </View>
              <Text style={styles.consentText}>
                I confirm the information provided is accurate and consent to
                21st Capital processing it to prepare my Estate Plan.
              </Text>
            </TouchableOpacity>
          </>
        )}
        </StepTransition>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {submitFail && (
          <AppDialog
            visible
            title={submitFail.title}
            message={submitFail.message}
            actions={[{ label: 'OK', variant: 'primary', onPress: () => {} }]}
            onClose={() => setSubmitFail(null)}
          />
        )}

      </ScrollView>

      {/* The step's actions, pinned at the foot and outside the slide (decided
          2026-10-05): Continue or Submit first, Back last; on the success
          page, Done. The PDF and the invites are their cards' own. */}
      <PageFooter>
        {!doneHeirs && step === 'review' && (
          <Button
            title={busy ? 'Submitting…' : 'Submit Estate Plan'}
            onPress={() => void submit()}
            loading={busy}
            disabled={!consent || busy}
          />
        )}
        {!doneHeirs && step !== 'review' && (
          <Button title="Continue" onPress={goNext} disabled={!stepValid()} />
        )}
        {doneHeirs && <Button title="Done" variant="ghost" onPress={finishSubmitted} disabled={!!pdfBusy} />}
        {!doneHeirs && <Button title="Back" variant="ghost" onPress={goBack} />}
      </PageFooter>

      <AuthSheet
        visible={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthed={(s) => {
          sessionRef.current = s;
          setAuthOpen(false);
          void (async () => {
            // The scope question needs a session, and now there is one. Ask
            // it BEFORE submitting: submit() itself would still read the
            // pre-login state and let an asked question slip through.
            let opts = scopeOptions;
            if (opts == null) {
              try {
                opts = await fetchEstatePlanScopeOptions(s);
                setScopeOptions(opts);
              } catch {
                // question stays unasked — unscoped submission, as before
              }
            }
            if ((opts?.askScope || eligibleLocalVaults.length > 1) && !scopeChoice) {
              setStep('details');
              setError('Please choose which vault this Estate Plan covers.');
              return;
            }
            void submit();
          })();
        }}
      />

      {dialog && (
        <AppDialog
          visible
          title={dialog.title}
          message={dialog.message}
          actions={[
            {
              label: 'Done',
              onPress: () => {
                setDialog(null);
                if (dialog.done) {
                  // Land on the vault this protocol was written for (decided
                  // 2026-07-24), not back on the Account screen: the vault
                  // with the Vaults tab beneath it, whether the plan was
                  // started from Settings or from the vault's banner.
                  const wid = route.params?.walletId;
                  if (wid) {
                    landOverTab('VaultsTab', [{ name: 'WalletDetail', params: { walletId: wid } }]);
                  } else {
                    navigation.goBack();
                  }
                }
              },
            },
          ]}
          onClose={() => setDialog(null)}
        />
      )}
    </View>
  );
}

/** The consent box, and the offset that centres the first caption line on it. */
const CHECK = 24;
const CHECK_TEXT_TOP = (CHECK - theme.typography.caption.lineHeight) / 2;
/** The exchange guides' step bubble (KrakenConnectScreen), the same measure. */
const STEP_BUBBLE = 24;
/** A selected chip's tint: the accent at 12%. */
const CHIP_TINT = '1F';

const styles = themedStyles(() => StyleSheet.create({
  root: { flex: 1 },
  // Above the pinned footer the content ends at the footer's fade.
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: FOOTER_ROOM },
  kicker: { ...theme.typography.label, color: theme.colors.slate },
  readyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  doneStep: { gap: theme.spacing.md },
  doneStepHead: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md },
  stepBubble: {
    width: STEP_BUBBLE,
    height: STEP_BUBBLE,
    borderRadius: STEP_BUBBLE / 2,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumber: { ...theme.typography.label, color: theme.colors.accentInk },
  doneStepTitle: { ...theme.typography.heading, color: theme.colors.offWhite },
  doneNote: { ...theme.typography.caption, color: theme.colors.slate },
  stepWrap: { gap: theme.spacing.md, overflow: 'hidden' },
  title: { ...theme.typography.title, color: theme.colors.offWhite },
  sub: { ...theme.typography.body, color: theme.colors.slate },
  flex1: { flex: 1 },
  fieldLabel: { ...theme.typography.label, color: theme.colors.slate },
  fieldWarn: { ...theme.typography.caption, color: theme.colors.gold },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  // The ONE green (decided 2026-09-12): the selected chip tints with the accent,
  // never the website's lime.
  chipOn: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accent + CHIP_TINT },
  // In colour, never `opacity`: a touchable paints opacity from its own press
  // animation, so a dim can outlive the state that asked for it (decided
  // 2026-09-16).
  chipDisabled: { borderColor: theme.colors.hairline },
  chipTextDisabled: { color: theme.colors.faint },
  chipText: { ...theme.typography.caption, color: theme.colors.slate },
  chipTextOn: { color: theme.colors.accentText },
  sectionCard: { gap: theme.spacing.sm },
  sectionTitle: { ...theme.typography.label, color: theme.colors.slate },
  consentRow: { flexDirection: 'row', gap: theme.spacing.md, alignItems: 'flex-start' },
  checkbox: {
    width: CHECK,
    height: CHECK,
    borderRadius: theme.radius.sm,
    borderWidth: 1.5,
    borderColor: theme.colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
  consentText: { ...theme.typography.caption, color: theme.colors.slate, flex: 1, paddingTop: CHECK_TEXT_TOP },
  summaryLine: { ...theme.typography.bodyStrong, color: theme.colors.offWhite },
  summaryFp: { ...theme.typography.mono, color: theme.colors.slate },
  summaryCard: { gap: theme.spacing.sm },
  summaryTitle: { ...theme.typography.label, color: theme.colors.slate },
  summaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.sm },
  summaryName: { ...theme.typography.body, color: theme.colors.offWhite, flex: 1 },
  summaryStandIn: { ...theme.typography.caption, color: theme.colors.slate },
  summaryShare: { ...theme.typography.body, color: theme.colors.offWhite },
  summaryIssue: { ...theme.typography.caption, color: theme.colors.gold },
  errorText: { ...theme.typography.body, color: theme.colors.negative },
}));
