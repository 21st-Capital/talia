/**
 * Fold the heirs named in an Estate Plan back onto the vault that plan covers.
 *
 * WHY THIS EXISTS. The invite picker is built from `wallet.heirs`, so an heir
 * who exists only inside the submitted document is invisible to it. An owner filed a
 * plan with two heirs and was offered exactly one invite (2026-08-30): the one
 * the vault already knew. The other had been typed into the plan, stored in the
 * document, and could never be invited to the vault it named them for.
 *
 * Two separate faults produced that. The write-back only ever PATCHED existing
 * entries, so a new person was silently dropped; and it skipped a vault with no
 * heirs recorded at all, which lost every one of them.
 *
 * The rules, in order:
 *   1. A draft is matched to an existing entry by KEY fingerprint, else by the
 *      creation id carried through the seeding, else by email address. One
 *      draft claims at most one entry, so two heirs sharing a key cannot both
 *      collapse onto it.
 *   2. A matched entry with no address on file takes the draft's, if the draft
 *      has a usable one. An address already on the vault is never overwritten:
 *      the vault is the older record and the plan may be a re-filing.
 *   3. An unmatched, named draft JOINS the vault, carrying the key the plan
 *      says they hold IF that key is really one of this vault's. The key is
 *      what makes their invite key-sealed rather than code-only, so dropping
 *      it silently downgrades the protection on the person's inheritance
 *      (decided 2026-08-30 asked whether the plan's key answer reaches the invite;
 *      for a newly named heir it did not).
 *   4. An entry the vault records as keyless gains a key the same way, since
 *      that only ever tightens what is required to open the invite.
 *   5. Every matched or joining heir carries the plan's NAME (decided 2026-09-21:
 *      the invite email greeted an heir by their key's label, "Hello test
 *      bitbox," because the vault only ever learned the key). The plan is the
 *      authority on names, so a re-filing that corrects a spelling wins.
 *      When two drafts share one key, the direct heir takes the entry before
 *      the person standing in for them.
 *
 * The vault check is not a formality. InviteHeirScreen looks the fingerprint
 * up in the vault's own descriptor and refuses with "Key not found" if it is
 * absent, so storing a key this vault does not contain would produce an heir
 * whose invite cannot be created at all. One plan covers several vaults and a
 * key may belong to only one of them, hence the per-vault set.
 *
 * An heir with no email is added like any other. The address is optional in the
 * plan and asked for again at invite time, so a child too young to have one
 * still appears in the picker instead of vanishing.
 *
 * Pure: no storage, no clock, no native. Ids come from the caller so the result
 * is reproducible.
 */

/** The shape `WalletMeta.heirs` stores. */
export interface VaultHeir {
  id?: string;
  /** The person's name as the Estate Plan gives it ("Toni Example"). */
  name?: string;
  email?: string;
  fingerprint?: string;
  months?: number;
}

/** What the Estate Plan form holds for one heir. */
export interface PlanHeir {
  /** wallet.heirs id, when this draft was seeded from the vault. */
  heirId?: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Master fingerprint of the key they hold (any case), '' when keyless. */
  keyFingerprint?: string;
  /** Set when this person stands in for another heir; they rank second for
   *  a key both hold. */
  substituteFor?: string;
}

const clean = (v: string | undefined): string => (v ?? '').trim();
const lower = (v: string | undefined): string => clean(v).toLowerCase();

/** A complete address, by the same rule the form uses. */
export const usableEmail = (v: string | undefined): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v));

/** "Toni Example": first and last name as the plan holds them. */
export const planHeirName = (d: Pick<PlanHeir, 'firstName' | 'lastName'>): string =>
  `${clean(d.firstName)} ${clean(d.lastName)}`.trim();

const isNamed = (d: PlanHeir): boolean => !!planHeirName(d);

/**
 * Which draft belongs to `entry`, or -1. `taken` holds indices already spoken
 * for, so each draft is used once.
 */
function matchIndex(entry: VaultHeir, drafts: readonly PlanHeir[], taken: ReadonlySet<number>): number {
  const fp = lower(entry.fingerprint);
  const id = clean(entry.id);
  const email = lower(entry.email);
  const matches = (d: PlanHeir, i: number): boolean => {
    if (taken.has(i)) return false;
    // A key is the strongest identity: same key, same person.
    if (fp) return lower(d.keyFingerprint) === fp;
    if (id && clean(d.heirId) === id) return true;
    return !!email && lower(d.email) === email;
  };
  // The heir themself before anyone standing in for them.
  const direct = drafts.findIndex((d, i) => matches(d, i) && !clean(d.substituteFor));
  return direct >= 0 ? direct : drafts.findIndex(matches);
}

export interface MergeResult {
  heirs: VaultHeir[];
  /** False when nothing moved, so the caller can skip the write entirely. */
  changed: boolean;
}

export function mergePlanHeirsIntoVault(
  existing: readonly VaultHeir[],
  drafts: readonly PlanHeir[],
  newId: () => string,
  /** Lowercase fingerprints in THIS vault's descriptor. A key outside it is
   *  ignored: see the note above on "Key not found". */
  vaultKeyFingerprints: ReadonlySet<string> = new Set(),
): MergeResult {
  const taken = new Set<number>();
  let changed = false;

  /** The key this draft holds, if this vault really has it. */
  const keyOf = (d: PlanHeir): string | undefined => {
    const fp = lower(d.keyFingerprint);
    return fp && vaultKeyFingerprints.has(fp) ? fp : undefined;
  };

  const heirs: VaultHeir[] = existing.map((entry) => {
    const i = matchIndex(entry, drafts, taken);
    if (i < 0) return entry;
    taken.add(i);
    const d = drafts[i];
    let next = entry;

    // A keyless entry may gain a key: that only tightens the invite.
    const key = keyOf(d);
    if (!clean(entry.fingerprint) && key) {
      next = { ...next, fingerprint: key };
      changed = true;
    }

    // The plan names the person; a re-filing may correct the spelling.
    const name = planHeirName(d);
    if (name && name !== clean(entry.name)) {
      next = { ...next, name };
      changed = true;
    }

    // Never overwrite an address the vault already holds.
    if (!clean(entry.email)) {
      const typed = clean(d.email);
      if (typed && usableEmail(typed)) {
        next = { ...next, email: typed };
        changed = true;
      }
    }
    return next;
  });

  drafts.forEach((d, i) => {
    if (taken.has(i) || !isNamed(d)) return;
    changed = true;
    const key = keyOf(d);
    heirs.push({
      id: clean(d.heirId) || newId(),
      name: planHeirName(d),
      ...(usableEmail(d.email) ? { email: clean(d.email) } : {}),
      ...(key ? { fingerprint: key } : {}),
    });
  });

  return { heirs, changed };
}
