/**
 * Inheritance protocol — the 21stcapital.com/inheritance questionnaire,
 * rebuilt natively (decided 2026-07-21: full in-app experience). The payload
 * contract mirrors the website tool exactly (camelCase keys; see the web
 * page's handleFinalSubmit) so the SAME backend pipeline (submission →
 * staff review → Playwright PDF → approval email) serves both surfaces.
 *
 * Flow: submissions require an ACTIVE subscription (activated vault owners
 * qualify), land as review_status="pending", and appear in the client's
 * account (list + PDF) only after staff approves. The app's banner clears on
 * SUBMISSION — the status endpoint counts pending ones too.
 */
import { COMPANY_API, authHeaders } from './companyAuth';
import { filedPlanHeirs } from '../wallet/heirNames';
import type { FiledPlanHeir } from '../wallet/heirNames';
import type { CompanySession } from './companyAuth';

export const INHERITANCE_SUBMIT_URL = `${COMPANY_API}/api/automations/submit-verification-process/`;
export const INHERITANCE_STATUS_URL = `${COMPANY_API}/api/automations/inheritance-protocol/status/`;
export const INHERITANCE_DETAILS_URL = `${COMPANY_API}/api/automations/inheritance-protocol/details/`;
export const ESTATE_SCOPE_OPTIONS_URL = `${COMPANY_API}/api/automations/estate-plan/scope-options/`;

/** One tested vault an Estate Plan may be scoped to. */
export interface EstateScopeAccount {
  account: number;
  vaultNumber: number | null;
  configType: string | null;
  /** A live plan already covers this vault: the wizard offers only the
   *  remaining vaults, and "all" only while nothing is covered
   *  (decided 2026-09-04). */
  hasPlan: boolean;
  /** Opaque key of the vault's on-chain shape, null when unverified. Vaults
   *  may share one plan only when their keys are equal. */
  shape: string | null;
  /** Whose plan PAYS for this vault when it is the client's own vault of
   *  somebody else's plan (decided 2026-09-20): they are its owner, so the wizard
   *  does not ask who it belongs to, and no screen shows this value. Null
   *  for vaults of the client's own plan. */
  heldOf: string | null;
}

export interface EstateScopeOptions {
  accounts: EstateScopeAccount[];
  /** True only with two or more tested vaults — the "one plan or one per
   *  vault?" question is only worth asking then. */
  askScope: boolean;
  /** Whether ONE plan may cover every vault: only when the vaults are the
   *  same vault on-chain. Decided by the server, exactly as on the website —
   *  the client never receives the key material the answer depends on. */
  allowAllScope: boolean;
}

/**
 * The same scope question the website's /inheritance form asks (decided
 * 2026-09-01: the app must match it). Server-decided; a failure here means
 * the question is simply not asked and the plan files unscoped, which the
 * backend accepts as it always has.
 */
export async function fetchEstatePlanScopeOptions(
  session: CompanySession,
): Promise<EstateScopeOptions> {
  const res = await fetch(ESTATE_SCOPE_OPTIONS_URL, { headers: authHeaders(session) });
  if (!res.ok) throw new Error(`Could not load your vault list (${res.status}).`);
  const body = (await res.json()) as {
    accounts?: Array<{
      account?: number;
      vault_number?: number | null;
      config_type?: string | null;
      has_plan?: boolean;
      shape?: string | null;
      held_of?: string | null;
    }>;
    ask_scope?: boolean;
    allow_all_scope?: boolean;
  };
  return {
    accounts: (body.accounts ?? [])
      .filter((a) => typeof a.account === 'number')
      .map((a) => ({
        account: a.account as number,
        vaultNumber: a.vault_number ?? null,
        configType: a.config_type ?? null,
        hasPlan: a.has_plan === true,
        shape: typeof a.shape === 'string' ? a.shape : null,
        heldOf: typeof a.held_of === 'string' && a.held_of ? a.held_of : null,
      })),
    askScope: body.ask_scope === true,
    allowAllScope: body.allow_all_scope === true,
  };
}

export const ESTATE_OVERVIEW_URL = `${COMPANY_API}/api/automations/estate-plan/overview/`;

/**
 * Per-vault Estate Plan progress — the same overview the website dashboard
 * uses (decided 2026-08-15). One plan no longer means "done": a client with
 * several vaults files one plan per vault, and the banner must keep
 * inviting them until every vault is covered (decided 2026-09-01).
 */
/** A filed plan as the overview names it. */
export interface EstatePlanRef {
  id: number;
  name: string | null;
  /** Locked = filed and not reopened by staff; a replacement needs staff. */
  locked: boolean;
}

/** One of the client's vaults with the plan (if any) covering it. */
export interface EstatePlanVault {
  account: number;
  vaultNumber: number | null;
  isActive: boolean;
  plan: EstatePlanRef | null;
  /** Covered by a plan filed for EVERY vault rather than this one. */
  coveredByAllPlan: boolean;
  /** No plan yet, or staff reopened the existing one for replacement. */
  canSubmit: boolean;
  /** This vault of the payer's plan is for someone else, who files its
   *  Estate Plan from their own account (decided 2026-09-20); the payer reads
   *  "For Alex Example, who files its Estate Plan from their own account". */
  heldBy: string | null;
  /** Somebody else's plan pays for this vault of the client's: whose. Never
   *  shown on the Estate Plan screens. */
  heldOf: string | null;
}

export interface EstatePlanOverview {
  /** Activated AND tested vaults on the account. */
  activeVaults: number;
  /** Of those, how many a live plan already covers. */
  coveredVaults: number;
  /** A tested vault still waits for its plan (computed over ACTIVE vaults
   *  only: an untested vault is not ready to plan and must not nag). */
  hasOutstanding: boolean;
  /** Every vault the backend knows, tested or not, with its plan. The hub
   *  lists these one by one (decided 2026-09-04: one filed plan must never hide
   *  the way to file the next). */
  vaults: EstatePlanVault[];
  /** A live plan filed for every vault at once, if there is one. */
  allVaultsPlan: EstatePlanRef | null;
}

const parsePlanRef = (v: unknown): EstatePlanRef | null => {
  const o = v as { id?: unknown; name?: unknown; locked?: unknown } | null | undefined;
  if (!o || typeof o.id !== 'number') return null;
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name ? o.name : null,
    locked: o.locked === true,
  };
};

export async function fetchEstatePlanOverview(
  session: CompanySession,
): Promise<EstatePlanOverview> {
  const res = await fetch(ESTATE_OVERVIEW_URL, { headers: authHeaders(session) });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not check your Estate Plans (${res.status}).`);
  const body = (await res.json()) as {
    vaults?: Array<{
      account?: unknown;
      vault_number?: unknown;
      is_active?: boolean;
      plan?: unknown;
      covered_by_all_plan?: boolean;
      can_submit?: boolean;
      held_by?: string | null;
      held_of?: string | null;
    }>;
    all_vaults_plan?: unknown;
  };
  const vaults: EstatePlanVault[] = (body.vaults ?? [])
    .filter((v) => typeof v.account === 'number')
    .map((v) => ({
      account: v.account as number,
      vaultNumber: typeof v.vault_number === 'number' ? v.vault_number : null,
      isActive: v.is_active === true,
      plan: parsePlanRef(v.plan),
      coveredByAllPlan: v.covered_by_all_plan === true,
      canSubmit: v.can_submit === true,
      heldBy: typeof v.held_by === 'string' && v.held_by ? v.held_by : null,
      heldOf: typeof v.held_of === 'string' && v.held_of ? v.held_of : null,
    }));
  const active = vaults.filter((v) => v.isActive);
  return {
    activeVaults: active.length,
    coveredVaults: active.filter((v) => v.plan != null).length,
    hasOutstanding: active.some((v) => v.canSubmit),
    vaults,
    allVaultsPlan: parsePlanRef(body.all_vaults_plan),
  };
}

/** One specific plan's PDF (the "latest" URL serves the newest plan whatever
 *  vault it covers, which is the wrong one for every vault but the last). */
export const estatePlanPdfUrl = (submissionId: number): string =>
  `${COMPANY_API}/api/automations/inheritance-protocol/${submissionId}/pdf/`;

/** An earlier plan scoped to one vault — the source for "Same as vault N"
 *  when naming who a newly scoped vault belongs to. */
export interface PriorVaultPlan {
  id: number;
  account: number | null;
  vaultNumber: number | null;
}

export async function fetchPriorVaultPlans(
  session: CompanySession,
): Promise<PriorVaultPlan[]> {
  const res = await fetch(INHERITANCE_DETAILS_URL, { headers: authHeaders(session) });
  if (!res.ok) throw new Error(`Could not load your earlier plans (${res.status}).`);
  const body = (await res.json()) as {
    results?: Array<{ id?: number; vault_scope?: { type?: string; account?: number; vault_number?: number | null } }>;
  };
  return (body.results ?? [])
    .filter((p) => typeof p.id === 'number' && p.vault_scope?.type === 'account')
    .map((p) => ({
      id: p.id as number,
      account: p.vault_scope?.account ?? null,
      vaultNumber: p.vault_scope?.vault_number ?? null,
    }));
}

/**
 * The heirs the owner's filed plans name (decided 2026-09-21), to put names onto
 * vaults whose plan was filed before the filing started handing them over.
 * Same endpoint as `fetchPriorVaultPlans`: the owner's own visible plans.
 */
export async function fetchFiledPlanHeirs(session: CompanySession): Promise<FiledPlanHeir[]> {
  const res = await fetch(INHERITANCE_DETAILS_URL, { headers: authHeaders(session) });
  if (!res.ok) throw new Error(`Could not load your Estate Plans (${res.status}).`);
  const body = (await res.json()) as { results?: unknown };
  return filedPlanHeirs(body.results);
}

/** Backend identifiers — NEVER translate these (they drive the PDF). */
export const VAULT_CONFIG_OPTIONS = [
  'Single Signature',
  '2/2 Multisig',
  '3/3 Multisig',
  '4/4 Multisig',
  '2/3 Multisig',
  '2/4 Multisig',
  '3/4 Multisig',
  '3/5 Multisig',
] as const;
export type VaultConfigOption = (typeof VAULT_CONFIG_OPTIONS)[number];

/** Keys a config needs: single-sig 1, else the denominator ("2/3" → 3). */
export function keyCountFor(config: string): number {
  if (config === 'Single Signature') return 1;
  const m = config.match(/^(\d+)\/(\d+)/);
  return m ? parseInt(m[2], 10) : 0;
}

export const RELATIONSHIP_OPTIONS = [
  { value: 'spouse', label: 'Spouse' },
  { value: 'parent', label: 'Parent' },
  { value: 'child', label: 'Child' },
  { value: 'relative', label: 'Relative' },
  { value: 'trustee', label: 'Trustee' },
  { value: 'Other', label: 'Other' },
] as const;

export interface InheritanceHeir {
  firstName: string;
  lastName: string;
  dob: string; // ISO date
  email: string;
  keyLabel: string;
  /** Master fingerprint of that key, lowercase 8-hex ('' when unknown) —
   *  the PDF prints it under the label (decided 2026-07-27). */
  keyFingerprint?: string; // hardware label or 'No Key Access'
  relationship: string;
  relationshipOther: string;
  /**
   * The heir this person STANDS IN FOR: full name, plus the email that tells
   * two people of the same name apart. Empty when they inherit directly
   * (decided 2026-08-30, the substitute heir). When set, `percentage` is a share of
   * THAT heir's portion rather than of the estate, and the person inherits
   * only if the one they stand in for cannot.
   */
  substituteFor?: string;
  substituteForEmail?: string;
  /** Removed from the form with the website's 2026-08-10 change (the heir
   *  support is already conditioned on the owner being deceased or
   *  incapacitated). Optional for wire-compat; no longer sent. */
  requiresAuth2?: string[]; // formatted holders
  percentage: number;
}

export interface InheritanceLegacyPath {
  config: string;
  otpEmail: string;
  keyHolder: string;
  /** Fingerprint of `keyHolder` ('' when unknown). */
  keyHolderFingerprint?: string; // single-sig only (formatted)
  keyHoldersMultisig: string[];
  /** Index-parallel to keyHoldersMultisig. */
  keyHoldersMultisigFingerprints?: string[]; // multisig only (formatted)
  heirs: Array<{ name: string; key_label: string }>;
  // No limits on a recovery path (decided 2026-09-21: "we dont have recovery
  // path limits! we only have cosigning limits!").
  specialInstructions: string;
  timelockDuration: string; // '8'..'15' months
  isRescuePath: boolean;
}

export interface InheritancePayload {
  language: string;
  protocolName: string;
  /**
   * What we hold about the CLIENT, shown back to them on step 1 so it can be
   * corrected (decided 2026-09-25: "Clients sometimes sign up with a fake name,
   * and this should be the time to correct that if they want to"). Sent
   * whether changed or not; the backend updates the account from them and
   * leaves anything absent alone.
   */
  clientFirstName?: string;
  clientLastName?: string;
  dob?: string;
  phoneNumber?: string;
  numHeirs: string;
  vaultConfig: string;
  vaultKeyHolders: string;
  vaultKeyLabels: string[];
  /** Index-parallel to vaultKeyLabels. */
  vaultKeyFingerprints?: string[];
  numHardwareWallets: string;
  hardwareWalletLabels: string[];
  /** Index-parallel to hardwareWalletLabels. */
  hardwareWalletFingerprints?: string[];
  /* No co-signing limits here (decided 2026-09-23: "please REMOVE the limits from
     the estate plan"). A limit is a setting on a VAULT, changed from
     Settings or the vault's own page whenever the client likes, and an
     Estate Plan is a document about inheritance. See services/cosignLimits. */
  otpEmail: string;
  heirs: InheritanceHeir[];
  numLegacyPaths: string;
  legacyPaths: InheritanceLegacyPath[];
  comments: string;
  dataPrivacy: boolean;
  /**
   * Every key the plan touches, across every covered vault — the register
   * the PDF prints and the heirs read (decided 2026-07-27). Includes 21st
   * Capital's own keys and keys that appear only in a second vault, which
   * none of the label arrays above can reach.
   */
  allKeys?: Array<{
    fingerprint: string;
    label: string;
    vault: string;
    role: 'primary' | 'recovery' | 'rescue';
    /** Timelock in months for a recovery/rescue key, '' for primary. */
    months?: string;
  }>;
  /**
   * Which vault the plan covers (same contract as the website form, decided
   * 2026-08-07). Only sent when the scope question was asked; absence means
   * "all", same as every plan before the question existed.
   */
  vaultScope?:
    | { type: 'all' }
    | { type: 'account'; account: number; vaultNumber: number | null }
    /** Several chosen vaults, one plan (decided 2026-09-04). */
    | { type: 'accounts'; accounts: number[]; vaultNumbers: Array<number | null> };
  /** Who the scoped vault belongs to. Absent = the account holder. */
  vaultOwner?:
    | { type: 'self' }
    | { type: 'sameAsSubmission'; submissionId: number }
    | {
        type: 'other';
        firstName: string;
        lastName: string;
        dob: string;
        /** Required: how 21st Capital and the heirs reach the vault's holder
         *  (decided 2026-09-16). */
        email: string;
        phone: string;
        relationship: string;
      };
}

export interface InheritanceStatus {
  hasAny: boolean;
  latestStatus: 'pending' | 'approved' | null;
  approvedCount: number;
}

/** Powers the post-testing banner: has the client submitted their protocol? */
export async function fetchInheritanceStatus(
  session: CompanySession,
): Promise<InheritanceStatus> {
  const res = await fetch(INHERITANCE_STATUS_URL, { headers: authHeaders(session) });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(`Could not check your Estate Plan (${res.status}).`);
  const body = (await res.json()) as {
    has_any?: boolean;
    latest_status?: 'pending' | 'approved' | null;
    approved_count?: number;
  };
  return {
    hasAny: body.has_any === true,
    latestStatus: body.latest_status ?? null,
    approvedCount: body.approved_count ?? 0,
  };
}

export async function submitInheritanceProtocol(
  session: CompanySession,
  payload: InheritancePayload,
): Promise<void> {
  const res = await fetch(INHERITANCE_SUBMIT_URL, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (res.status === 403) {
    throw new Error('An active plan is required for your Estate Plan.');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    // Carry the backend's error CODE so the screen can speak plainly about
    // known cases (a locked prior plan above all). Decided 2026-08-28: a failed
    // submission must be unmissable: a test plan once vanished silently.
    const err = new Error(
      body.message ?? body.error ?? `Could not submit (${res.status}).`,
    ) as Error & { code?: string };
    if (typeof body.error === 'string') err.code = body.error;
    throw err;
  }
}
