/**
 * Vault owners (decided 2026-09-20, replacing the 2026-09-19 code invite): a vault
 * of a paying client's plan can be FOR SOMEONE ELSE. Only the payment is
 * shared: the other person signs in with the email on record, builds the
 * vault with their own keys and owns it in every respect. The payer assigns
 * a free, unbuilt slot ONCE; after that only our team can change it, so this
 * service reads the slots and assigns, and has no way to take a vault back.
 *
 * The API's field names (holder, hosted, held, held_of) are the contract of
 * installed apps and stay as they are; no client ever reads those words.
 */
import { COMPANY_API, authHeaders } from './companyAuth';
import type { CompanySession } from './companyAuth';

const HOLDERS_URL = `${COMPANY_API}/api/vaults/holders/`;

export interface VaultHolding {
  id: string;
  vaultNumber: number;
  /** The invited address. */
  email: string;
  status: 'invited' | 'active' | 'revoked';
  holderEmail: string | null;
  holderName: string;
  payerEmail: string | null;
  payerName: string;
  emailMismatch: boolean;
  createdAt: string;
  acceptedAt: string | null;
  expiresAt: string;
  /** The person's account is linked (they signed in with that email). */
  signedIn: boolean;
  /** THEY built the vault: from then on it can never move to anyone else. */
  built: boolean;
  account: number | null;
}

/** One vault slot of the payer's plan, paid for whether built or not. */
export interface PayerVault {
  vaultNumber: number;
  account: number | null;
  configType: string | null;
  testedAt: string | null;
  /** Its 21st Capital keys have left us, or it is tested: somebody built it,
   *  so it can no longer be assigned. */
  claimed: boolean;
  /** Who the vault is for when it is not the payer's own. */
  holder: VaultHolding | null;
}

/** Who a row of the plan is for, in the words the payer reads. */
export type OwnerSlotKind = 'you' | 'someoneElse' | 'notAssigned';

export interface OwnerSlotRow {
  vaultNumber: number;
  kind: OwnerSlotKind;
  /** "Vault 2: Alex Example" */
  title: string;
  /** "Signed in", "Savings, Built", or null when there is nothing to add. */
  sub: string | null;
  /** Only a slot nobody has built and nobody was given can be assigned.
   *  Once assigned a row never carries a button again (decided 2026-09-20: only
   *  our team changes an allocation). */
  canAssign: boolean;
}

/** How far the other person is: the three states of the agreed vocabulary. */
export function ownerStateWords(holder: Pick<VaultHolding, 'built' | 'signedIn'>): string {
  if (holder.built) return 'Built';
  return holder.signedIn ? 'Signed in' : 'Not signed in yet';
}

/** Their name, else the email the vault was assigned to. */
export function ownerName(holder: Pick<VaultHolding, 'holderName' | 'holderEmail' | 'email'>): string {
  return holder.holderName.trim() || holder.holderEmail || holder.email;
}

/**
 * The ONE list of the Vault owners screen: every slot the plan paid for.
 * `walletName` answers the name a slot carries on this phone, if the payer
 * built it here. A slot with no owner that is built (or sits on this phone)
 * is the payer's own; one that is neither is free to assign, vault 1
 * included (a payer may keep no vault at all).
 */
export function ownerSlotRows(
  vaults: PayerVault[],
  walletName: (vaultNumber: number) => string | undefined = () => undefined,
): OwnerSlotRow[] {
  return [...vaults]
    .sort((a, b) => a.vaultNumber - b.vaultNumber)
    .map((v): OwnerSlotRow => {
      const n = v.vaultNumber;
      if (v.holder) {
        return {
          vaultNumber: n,
          kind: 'someoneElse',
          title: `Vault ${n}: ${ownerName(v.holder)}`,
          sub: ownerStateWords({ built: v.holder.built, signedIn: v.holder.signedIn }),
          canAssign: false,
        };
      }
      const name = walletName(n);
      const built = v.claimed || v.testedAt != null;
      if (built || name) {
        const sub = [name, built ? 'Built' : null].filter(Boolean).join(', ');
        return { vaultNumber: n, kind: 'you', title: `Vault ${n}: you`, sub: sub || null, canAssign: false };
      }
      return { vaultNumber: n, kind: 'notAssigned', title: `Vault ${n}: not assigned`, sub: null, canAssign: true };
    });
}

/** The Settings row exists for a client with a plan of their OWN only. A
 *  person who owns an assigned vault and pays for nothing has no slots, and
 *  never meets the row (decided 2026-09-20). */
export function hasOwnPlanSlots(page: Pick<VaultHoldersPage, 'vaults'> | null | undefined): boolean {
  return (page?.vaults.length ?? 0) > 0;
}

/** The confirm dialog's whole text: a title and two buttons, no paragraph. */
export function assignConfirmTitle(vaultNumber: number, email: string): string {
  return `Vault ${vaultNumber} is for ${email.trim()}?`;
}

export const emailLooksValid = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/**
 * "Paid for by Toni": who pays for a vault that is somebody else's gift.
 * Shown in Membership and in the vault's advanced details ONLY, never on the
 * everyday card and never in a refusal (decided 2026-09-20: the vault reads as
 * fully theirs). `heldOf` is the payer's email as the wallet recorded it; the
 * entitlement's holdings carry the name.
 */
export function paidForByName(
  heldOf: string | null | undefined,
  holdings: Array<{ payerEmail: string; payerName?: string }> = [],
): string | null {
  const email = (heldOf ?? '').trim();
  if (!email) return null;
  const match = holdings.find((h) => h.payerEmail.trim().toLowerCase() === email.toLowerCase());
  return match?.payerName?.trim() || email;
}

/** Everything the Vault owners screen says, in one place a plain test reads. */
export const OWNERS_COPY = {
  title: 'Vault owners',
  settingsSub: 'Who each vault in your plan is for',
  intro:
    'A vault in your plan can be for someone else: a family member with their own 21st Capital account and their own keys. They build it, ask us to co-sign, write its Estate Plan and set its limits themselves. Your plan pays for it.',
  cardTitle: 'The vaults in your plan',
  teamOnly: 'Only our team can change this.',
  assignAction: 'Assign to someone else',
  emailLabel: 'Their email',
  assign: 'Assign',
  cancel: 'Cancel',
  noSlots: 'Your plan has no vault yet.',
  signInFirst: 'Sign in to 21st Capital in Settings first.',
  assignFailed: 'Could not assign the vault',
  /** Assigning needs two-factor on the payer's account: a title and a door. */
  twoFactorTitle: 'Two-factor is required',
  twoFactorSetUp: 'Set up two-factor',
  /** The lapsed note on a vault somebody else pays for. It never names them. */
  lapsedTitle: 'The plan that pays for this vault has ended',
  /** Decided 2026-09-22: "Your own keys still spend without us" was false for
   *  a 2-of-2 with our co-signer and a 2-of-3 owner, heir and 21st Capital.
   *  The vault being unchanged holds for every shape (the store builds' ⓘ
   *  says the same). "Nothing is locked" moved up here from the ⓘ. */
  lapsedBody: 'Nothing is locked. The vault itself does not change.',
  lapsedInfoTitle: 'What this changes',
  lapsedInfo:
    'This vault is yours and stays completely usable. Co-signing and rescue stay available under our terms for ended plans.',
  /** Estate Plan hub, payer's side. */
  estateIntro: 'who files its Estate Plan from their own account',
} as const;

/** "For Alex Example, who files its Estate Plan from their own account" */
export function estateOwnerLine(who: string): string {
  return `For ${who}, ${OWNERS_COPY.estateIntro}`;
}

function parseVault(v: unknown): PayerVault | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.vault_number !== 'number') return null;
  const testedAt = typeof o.tested_at === 'string' ? o.tested_at : null;
  // An older backend sends neither `claimed` nor the row's `built`: a tested
  // vault is the one thing it does tell us was built.
  const holder = parse(o.holder, testedAt != null);
  return {
    vaultNumber: o.vault_number,
    account: typeof o.account === 'number' ? o.account : null,
    configType: typeof o.config_type === 'string' ? o.config_type : null,
    testedAt,
    claimed: typeof o.claimed === 'boolean' ? o.claimed : testedAt != null,
    holder,
  };
}

function parse(v: unknown, builtFallback = false): VaultHolding | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o.id !== 'string' || typeof o.vault_number !== 'number') return null;
  const status = o.status === 'active' || o.status === 'revoked' ? o.status : 'invited';
  return {
    id: o.id,
    vaultNumber: o.vault_number,
    email: String(o.email ?? ''),
    status,
    holderEmail: typeof o.holder_email === 'string' ? o.holder_email : null,
    holderName: typeof o.holder_name === 'string' ? o.holder_name : '',
    payerEmail: typeof o.payer_email === 'string' ? o.payer_email : null,
    payerName: typeof o.payer_name === 'string' ? o.payer_name : '',
    emailMismatch: o.email_mismatch === true,
    createdAt: String(o.created_at ?? ''),
    acceptedAt: typeof o.accepted_at === 'string' ? o.accepted_at : null,
    expiresAt: String(o.expires_at ?? ''),
    signedIn: typeof o.signed_in === 'boolean' ? o.signed_in : status === 'active',
    built: typeof o.built === 'boolean' ? o.built : builtFallback,
    account: typeof o.account === 'number' ? o.account : null,
  };
}

/** The payer's account has no two-factor yet (backend 403 2FA_REQUIRED).
 *  Typed, so the screen can offer the way to the setup instead of an OK. */
export class TwoFactorRequiredError extends Error {
  constructor() {
    super('Turn on two-factor authentication in your 21st Capital account first.');
    this.name = 'TwoFactorRequiredError';
  }
}

/** "Assign vault 3 to someone else": VoiceOver's name for a row's button,
 *  so several free slots can be told apart. */
export function assignActionLabel(vaultNumber: number): string {
  return `Assign vault ${vaultNumber} to someone else`;
}

/** The refusal of a holders call, as the error the screen handles. Exported
 *  for tests. */
export function holdersRefusal(
  status: number,
  body: { message?: string; error?: string },
  fallback: string,
): Error {
  if (status === 401) return new Error('Your session has expired. Please log in again.');
  if (body.error === '2FA_REQUIRED') return new TwoFactorRequiredError();
  return new Error(body.message ?? `${fallback} (${status}).`);
}

async function fail(res: Response, fallback: string): Promise<never> {
  const body =
    res.status === 401
      ? {}
      : ((await res.json().catch(() => ({}))) as { message?: string; error?: string });
  throw holdersRefusal(res.status, body, fallback);
}

export interface VaultHoldersPage {
  hosted: VaultHolding[];
  held: VaultHolding[];
  /** Every paid slot of the client's own plan, built or not. */
  vaults: PayerVault[];
}

export function parseVaultHoldersPage(body: unknown): VaultHoldersPage {
  const o = (body ?? {}) as { hosted?: unknown[]; held?: unknown[]; vaults?: unknown[] };
  const list = (v: unknown[] | undefined) => (v ?? []).map((r) => parse(r)).filter((h): h is VaultHolding => h != null);
  return {
    hosted: list(o.hosted),
    held: list(o.held),
    vaults: (o.vaults ?? []).map(parseVault).filter((v): v is PayerVault => v != null),
  };
}

export async function fetchVaultHolders(session: CompanySession): Promise<VaultHoldersPage> {
  const res = await fetch(HOLDERS_URL, { headers: authHeaders(session) });
  if (!res.ok) return fail(res, 'Could not load the vaults of your plan');
  return parseVaultHoldersPage(await res.json());
}

export async function inviteVaultHolder(
  session: CompanySession,
  vaultNumber: number,
  email: string,
): Promise<VaultHolding> {
  const res = await fetch(`${HOLDERS_URL}invite/`, {
    method: 'POST',
    headers: { ...authHeaders(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ vault_number: vaultNumber, email: email.trim() }),
  });
  if (!res.ok) return fail(res, 'Could not assign the vault');
  const row = parse(await res.json());
  if (!row) throw new Error('Could not read the answer.');
  return row;
}
