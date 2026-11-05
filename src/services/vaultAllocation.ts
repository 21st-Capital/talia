/**
 * Building a vault when a plan's vaults can be FOR SOMEONE ELSE (decided
 * 2026-09-20: "It is a voucher that is allocated to someone else. Only the
 * payment and billing is shared").
 *
 * Every decision the builder and the vault list make about that lives here,
 * pure and tested, so the screens only ask and draw:
 *  - the family member's first run ("Vault 2 is yours", Build it),
 *  - what counts against the client's OWN plan (never an assigned slot,
 *    never a vault somebody else pays for),
 *  - which numbers may be rebuilt,
 *  - when "Which vault are you building?" is asked at all,
 *  - which fingerprints are the builder's own everyday keys,
 *  - the same-device warning (decided: allow, warn, flag; never block).
 *
 * The payer's name appears in exactly one place here, the which-vault
 * question, because two vaults cannot be told apart without it.
 */
import type { WalletMeta } from '../wallet/types';
import type { KeyEntitlement } from './companyAuth';

export type AssignedVault = KeyEntitlement['holdings'][number];

/** The builder's words for all of this. Dialogs are a title and buttons. */
export const BUILDER_COPY = {
  buildIt: 'Build it',
  whichVaultTitle: 'Which vault are you building?',
  ownOption: 'A vault of my own plan',
  cancel: 'Cancel',
  ok: 'OK',
  continue: 'Continue',
  allAssignedTitle: 'Every vault in your plan is for someone else',
  /** The claim of a vault somebody else pays for, refused for payment: its
   *  owner is never offered a plan or a checkout for it. */
  planNotActiveTitle: 'The plan for this vault is not active',
  /** The summary of a vault somebody else pays for: no plan card, no price. */
  nothingToPay: 'Covered. There is nothing to pay.',
} as const;

/** "Vault 2 is yours" */
export function firstRunTitle(vaultNumber: number): string {
  return `Vault ${vaultNumber} is yours`;
}

/** "Vault 2 is already on this phone": the one vault this person may build
 *  is built here, and there is nothing else of theirs to build. */
export function alreadyOnPhoneTitle(vaultNumber: number | null | undefined): string {
  return vaultNumber != null
    ? `Vault ${vaultNumber} is already on this phone`
    : 'This vault is already on this phone';
}

const lower = (s: string | undefined | null): string => (s ?? '').trim().toLowerCase();

/** The payer's first name, else their email: the which-vault question only. */
export function payerFirstName(h: Pick<AssignedVault, 'payerName' | 'payerEmail'>): string {
  const first = h.payerName.trim().split(/\s+/)[0];
  return first || h.payerEmail;
}

/** Is this assigned vault already on this phone? (Same payer, same number.) */
function onThisPhone(h: AssignedVault, wallets: ReadonlyArray<WalletMeta>): boolean {
  return wallets.some(
    (w) => !w.manual && lower(w.heldOf) === lower(h.payerEmail) && w.vaultNumber === h.vaultNumber,
  );
}

/**
 * The family member's first run: the account has a vault somebody assigned
 * to it that nobody has built yet, and this phone holds no vault at all.
 * Null in every other case, and the ordinary welcome shows. The lowest
 * number first when there are several.
 */
export function firstRunAssignedVault(
  ent: Pick<KeyEntitlement, 'holdings'> | null | undefined,
  wallets: ReadonlyArray<Pick<WalletMeta, 'manual'>>,
): AssignedVault | null {
  if (!ent) return null;
  if (wallets.some((w) => !w.manual)) return null;
  const open = ent.holdings.filter((h) => !h.claimed);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => a.vaultNumber - b.vaultNumber)[0];
}

/**
 * Does this vault take a slot of the client's OWN plan? Only an unlocked
 * vault that holds our keys and is known to the backend, and NEVER one that
 * somebody else's plan pays for (`heldOf`): that one sits in the payer's
 * count, not in its owner's.
 */
export function countsAgainstOwnPlan(
  w: Pick<WalletMeta, 'locked' | 'portfolioId' | 'vaultNumber' | 'providerKeyFingerprints' | 'heldOf' | 'manual'>,
): boolean {
  if (w.manual || w.locked || w.heldOf) return false;
  if (!w.portfolioId && w.vaultNumber == null) return false;
  return (w.providerKeyFingerprints?.length ?? 0) > 0;
}

/** How many vaults of the plan are the client's own to build: what the plan
 *  includes minus the slots that are for someone else. Never below zero. */
export function ownPlanCap(
  included: number,
  vaultsAllocated: ReadonlyArray<{ vaultNumber: number }>,
): number {
  const assigned = new Set(vaultsAllocated.map((a) => a.vaultNumber)).size;
  return Math.max(0, included - assigned);
}

export type OwnPlanVerdict = 'ok' | 'full' | 'allAssigned';

/**
 * The gate before a vault with our keys is created on the client's own plan.
 * `included` 0 means the plan is unknown (an onboarding client pays after):
 * never stop them. A vault somebody else pays for never reaches this gate.
 */
export function ownPlanVerdict(
  included: number,
  vaultsAllocated: ReadonlyArray<{ vaultNumber: number }>,
  testedOwnVaults: number,
): OwnPlanVerdict {
  if (included <= 0) return 'ok';
  const cap = ownPlanCap(included, vaultsAllocated);
  if (cap === 0 && testedOwnVaults === 0) return 'allAssigned';
  return testedOwnVaults >= cap ? 'full' : 'ok';
}

/**
 * Numbers of the client's OWN plan that were built before and are not on
 * this phone, so they can be built again on the same keys. An assigned
 * number is never offered (its owner builds it), and a vault somebody else
 * pays for never hides an own number that happens to match.
 */
export function rebuildableOwnVaults(
  ent: Pick<KeyEntitlement, 'vaultsClaimed' | 'vaultsAllocated'>,
  wallets: ReadonlyArray<Pick<WalletMeta, 'vaultNumber' | 'heldOf' | 'manual'>>,
): number[] {
  const onPhone = new Set(
    wallets
      .filter((w) => !w.manual && !w.heldOf)
      .map((w) => w.vaultNumber)
      .filter((n): n is number => n != null),
  );
  const assigned = new Set(ent.vaultsAllocated.map((a) => a.vaultNumber));
  return ent.vaultsClaimed.filter((n) => !onPhone.has(n) && !assigned.has(n));
}

/** Free slots of the client's own plan. The backend's figure when it sends
 *  one; an older backend is worked out from what it does send. */
export function ownFreeSlots(
  ent: Pick<KeyEntitlement, 'ownPlan' | 'vaultsOwnFree' | 'vaultsIncluded' | 'vaultsClaimed' | 'vaultsAllocated'>,
): number {
  if (!ent.ownPlan) return 0;
  if (ent.vaultsOwnFree != null) return ent.vaultsOwnFree;
  // Older backend, figure unknown: assume there is one, so the question is
  // still asked and the backend has the last word on the claim.
  if (ent.vaultsIncluded == null) return 1;
  const unbuiltAssigned = ent.vaultsAllocated.filter(
    (a) => !ent.vaultsClaimed.includes(a.vaultNumber),
  ).length;
  return Math.max(0, ent.vaultsIncluded - ent.vaultsClaimed.length - unbuiltAssigned);
}

/** Assigned vaults this phone could build now: not built yet, or built
 *  before and not on this phone (a reinstall must never be a dead end). One
 *  that IS on this phone is never offered again, whatever the backend says
 *  about it (an older backend never says it was built). */
export function buildableAssignedVaults(
  ent: Pick<KeyEntitlement, 'holdings'>,
  wallets: ReadonlyArray<WalletMeta>,
): AssignedVault[] {
  return ent.holdings.filter((h) => !onThisPhone(h, wallets));
}

/**
 * The backstop after the keys arrive: did the backend answer with a vault
 * somebody else pays for that is ALREADY on this phone? Its keys must never
 * be placed into a second vault here. (An own vault is not judged: its
 * rebuild is offered by number, on purpose.)
 */
export function issuedVaultIsOnThisPhone(
  issued: { heldOf?: string | null; vaultNumber?: number | null },
  wallets: ReadonlyArray<Pick<WalletMeta, 'manual' | 'heldOf' | 'vaultNumber'>>,
): boolean {
  const payer = lower(issued.heldOf);
  if (!payer || issued.vaultNumber == null) return false;
  return wallets.some(
    (w) => !w.manual && lower(w.heldOf) === payer && w.vaultNumber === issued.vaultNumber,
  );
}

/**
 * Is this build a vault somebody else pays for, as far as the entitlement
 * alone can tell? True for a person with no plan of their own who owns an
 * assigned vault: whatever they build with our keys, the backend serves it
 * from the payer's plan, so they are never shown a price or an upgrade.
 */
export function everyBuildIsPaidByOther(
  ent: Pick<KeyEntitlement, 'ownPlan' | 'holdings'> | null | undefined,
): boolean {
  return !!ent && !ent.ownPlan && ent.holdings.length > 0;
}

export type WhichVault =
  | { kind: 'own' }
  | { kind: 'assigned'; vault: AssignedVault }
  | { kind: 'ask'; own: boolean; vaults: AssignedVault[] }
  /** Nothing to build: no plan of their own, and every vault that is theirs
   *  is on this phone already. `vault` is the one to name. */
  | { kind: 'none'; vault: AssignedVault };

/**
 * Whose vault is being built? Asked ONLY when there are really two answers:
 * the client has something of their own plan to build (a free slot, or an
 * own vault to rebuild) AND a vault somebody else pays for, or several of
 * the latter. One assigned vault and nothing else is served with no question.
 *
 * A person with NO plan of their own whose vaults are all on this phone has
 * nothing to build ('none'). A claim that names nobody is served their first
 * vault again by the backend, the SAME 21st Capital keys, and a second vault
 * here would then share its co-signer and rescue key with the first.
 */
export function whichVaultToBuild(ent: KeyEntitlement, wallets: ReadonlyArray<WalletMeta>): WhichVault {
  const assigned = buildableAssignedVaults(ent, wallets);
  if (assigned.length === 0) {
    if (ent.ownPlan || ent.holdings.length === 0) return { kind: 'own' };
    const first = [...ent.holdings].sort((a, b) => a.vaultNumber - b.vaultNumber)[0];
    return { kind: 'none', vault: first };
  }
  const own =
    ent.ownPlan && (ownFreeSlots(ent) > 0 || rebuildableOwnVaults(ent, wallets).length > 0);
  if (!own && assigned.length === 1) return { kind: 'assigned', vault: assigned[0] };
  return { kind: 'ask', own, vaults: assigned };
}

/** The option's words. One vault: "The vault Toni pays for". Several: the
 *  number tells them apart. */
export function assignedOptionLabel(h: AssignedVault, several: boolean): string {
  const who = payerFirstName(h);
  return several ? `Vault ${h.vaultNumber}, which ${who} pays for` : `The vault ${who} pays for`;
}

/**
 * Does a remembered claim belong to the vault being built now? `target` is
 * undefined while nobody has said (the remembered claim then decides), null
 * for the client's own plan, or the payer's id.
 */
export function pendingClaimMatches(
  pending: { vaultNumber: number; heldOf?: number } | undefined,
  target: number | null | undefined,
  targetVault?: number,
): boolean {
  if (!pending) return false;
  if (target === undefined) return true;
  if (target === null) return pending.heldOf == null;
  if (pending.heldOf !== target) return false;
  return targetVault == null || pending.vaultNumber === targetVault;
}

/**
 * The refusal when the named vault is for someone else: "Vault 2 is for
 * Alex Example". The name comes from the plan's own list (name, else email), then
 * from the backend's sentence, and the title still reads without either.
 */
export function allocatedTitle(
  vaultNumber: number | null,
  vaultsAllocated: ReadonlyArray<{ vaultNumber: number; name: string; email: string }>,
  backendMessage?: string,
): string {
  const row = vaultNumber != null ? vaultsAllocated.find((a) => a.vaultNumber === vaultNumber) : undefined;
  const who = row ? row.name.trim() || row.email.trim() : '';
  if (who && vaultNumber != null) return `Vault ${vaultNumber} is for ${who}`;
  // The name ends at the full stop that closes the sentence, not at the
  // dots inside an email address.
  const m = /^Vault (\d+) is for (.+?)\.(?:\s|$)/.exec(backendMessage ?? '');
  if (m) return `Vault ${m[1]} is for ${m[2].trim()}`;
  return vaultNumber != null ? `Vault ${vaultNumber} is for someone else` : 'This vault is for someone else';
}

/** When every remaining slot of the plan is somebody else's, name the first
 *  one nobody has built yet; null when there is none. */
export function firstUnbuiltAssigned(
  ent: Pick<KeyEntitlement, 'vaultsAllocated'>,
): KeyEntitlement['vaultsAllocated'][number] | null {
  const open = ent.vaultsAllocated.filter((a) => !a.built);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => a.vaultNumber - b.vaultNumber)[0];
}

/**
 * The master fingerprints of the BUILDER's own everyday keys: the keys of
 * the everyday path that are theirs. Never an heir's key (another person,
 * a recovery layer), never the rescue key, never a 21st Capital key. A
 * second key the builder holds themselves counts; ours in that slot does not.
 */
export function builderEverydayFingerprints(input: {
  userKeys: ReadonlyArray<{ fingerprint?: string }>;
  coSignerKey?: { fingerprint?: string } | null;
  /** True when the builder holds the second key themselves. */
  coSignerIsOwn: boolean;
  /** Fingerprints of keys 21st Capital issued. */
  providerFps: Iterable<string>;
}): string[] {
  const ours = new Set([...input.providerFps].map(lower));
  const out = new Set<string>();
  const take = (fp?: string) => {
    const v = lower(fp);
    if (/^[0-9a-f]{8}$/.test(v) && !ours.has(v)) out.add(v);
  };
  input.userKeys.forEach((k) => take(k.fingerprint));
  if (input.coSignerIsOwn) take(input.coSignerKey?.fingerprint);
  return [...out];
}
