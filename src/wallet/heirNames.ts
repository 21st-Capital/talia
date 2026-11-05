/**
 * An heir is a PERSON, and is named as one (decided 2026-09-21: the invite email
 * read "Hello test bitbox," because the app greeted the heir by the label of
 * the key they hold). The name comes from the Estate Plan, which the owner
 * files before any invite goes out ("by that time, we ALWAYS have the heirs
 * names!"). A key's label is never used for a person, anywhere.
 *
 * Plans filed from now on hand the name to the vault at filing
 * (`planHeirs.ts`). Plans filed before that are read back from the owner's
 * own plans (`inheritance-protocol/details/`) and matched here: a keyed heir
 * by the key's fingerprint, a keyless one by email address.
 *
 * Pure: no storage, no network.
 */
import { planHeirName, type VaultHeir } from './planHeirs';

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const lower = (v: unknown): string => clean(v).toLowerCase();

/** One heir of a filed plan, reduced to what identifies and names them. */
export interface FiledPlanHeir {
  name: string;
  /** Lowercase fingerprint of the key they hold, '' when keyless or unknown. */
  fingerprint: string;
  /** Lowercase email, '' when none. */
  email: string;
  /** True for a person standing in for another heir. */
  standIn: boolean;
}

/**
 * The heirs of the owner's filed plans, newest plan first, from the details
 * endpoint's `results`. An app-filed heir carries `keyFingerprint`; a
 * website-filed one names only the key's LABEL, whose fingerprint is looked up
 * the way the backend's PDF does (`_fp_for_label`): the plan's key register
 * first, then the hardware labels beside their fingerprints.
 */
export function filedPlanHeirs(results: unknown): FiledPlanHeir[] {
  if (!Array.isArray(results)) return [];
  const out: FiledPlanHeir[] = [];
  for (const plan of results) {
    if (!plan || typeof plan !== 'object') continue;
    const p = plan as {
      heirs?: unknown;
      key_fingerprints?: { all?: unknown; hardware?: unknown } | null;
      hardware_wallet_labels?: unknown;
    };
    const register = Array.isArray(p.key_fingerprints?.all) ? (p.key_fingerprints?.all as unknown[]) : [];
    const hardware = Array.isArray(p.key_fingerprints?.hardware) ? (p.key_fingerprints?.hardware as unknown[]) : [];
    const hwLabels = Array.isArray(p.hardware_wallet_labels) ? (p.hardware_wallet_labels as unknown[]) : [];
    const fpForLabel = (label: string): string => {
      const target = label.toLowerCase();
      if (!target) return '';
      for (const e of register) {
        const entry = e as { label?: unknown; fingerprint?: unknown } | null;
        if (entry && lower(entry.label) === target) return lower(entry.fingerprint);
      }
      const i = hwLabels.findIndex((l) => lower(l) === target);
      return i >= 0 && i < hardware.length ? lower(hardware[i]) : '';
    };
    if (!Array.isArray(p.heirs)) continue;
    for (const h of p.heirs) {
      if (!h || typeof h !== 'object') continue;
      const heir = h as Record<string, unknown>;
      const name = planHeirName({ firstName: clean(heir.firstName), lastName: clean(heir.lastName) });
      if (!name) continue;
      out.push({
        name,
        fingerprint: lower(heir.keyFingerprint) || fpForLabel(clean(heir.keyLabel)),
        email: lower(heir.email),
        standIn: !!clean(heir.substituteFor),
      });
    }
  }
  return out;
}

/** The filed name for one vault heir, or '' when no plan names them. */
function filedNameFor(h: VaultHeir, filed: readonly FiledPlanHeir[]): string {
  const fp = lower(h.fingerprint);
  const email = lower(h.email);
  const pick = (ok: (f: FiledPlanHeir) => boolean): string =>
    (filed.find((f) => ok(f) && !f.standIn) ?? filed.find(ok))?.name ?? '';
  // A keyed heir is matched by the key alone, as the filing merge does.
  if (fp) return pick((f) => f.fingerprint === fp);
  return email ? pick((f) => f.email === email) : '';
}

/**
 * Names from filed plans put onto the vault's heirs that have none. A name
 * already on the vault stays: it came from the newest filing on this phone.
 * `changed` is false when nothing was added, so the caller skips the write.
 */
export function withFiledNames(
  heirs: readonly VaultHeir[],
  filed: readonly FiledPlanHeir[],
): { heirs: VaultHeir[]; changed: boolean } {
  let changed = false;
  const next = heirs.map((h) => {
    if (clean(h.name)) return h;
    const name = filedNameFor(h, filed);
    if (!name) return h;
    changed = true;
    return { ...h, name };
  });
  return { heirs: next, changed };
}

/** The heir's own name, or '' when no plan has named them yet. */
export const heirName = (h: Pick<VaultHeir, 'name'> | null | undefined): string => clean(h?.name);

/** A row title: the name, else "Heir 2". Never a key's label. */
export const heirTitle = (h: Pick<VaultHeir, 'name'>, index: number): string =>
  heirName(h) || `Heir ${index + 1}`;

/** The invite email's first line: "Hello Toni Example," or "Hello,". */
export const inviteGreeting = (name: string | undefined): string =>
  clean(name) ? `Hello ${clean(name)},` : 'Hello,';

/**
 * Who an invite already sent is for, by name. Invites sent before
 * 2026-09-21 carry the key's label as their name on the server, so the name
 * is found through the heir the invite was made for (this phone's record of
 * it, else the address), and a server label that is one of this vault's key
 * labels is never shown as a person.
 */
export function inviteHeirName(
  invite: { id: string; heirLabel: string; heirEmail: string },
  records: ReadonlyArray<{ inviteId: string; heirFingerprint: string; heirId?: string; heirEmail?: string }>,
  heirs: readonly VaultHeir[],
  keyLabels: Readonly<Record<string, string>> | undefined,
): string {
  const rec = records.find((r) => r.inviteId === invite.id);
  if (rec) {
    const fp = lower(rec.heirFingerprint);
    const h = fp
      ? heirs.find((x) => lower(x.fingerprint) === fp)
      : heirs.find((x) => (rec.heirId && x.id === rec.heirId) || (!!lower(rec.heirEmail) && lower(x.email) === lower(rec.heirEmail)));
    if (heirName(h)) return heirName(h);
  }
  const email = lower(invite.heirEmail);
  const byEmail = email ? heirs.find((x) => lower(x.email) === email) : undefined;
  if (heirName(byEmail)) return heirName(byEmail);
  const label = clean(invite.heirLabel);
  const isKeyLabel = Object.values(keyLabels ?? {}).some((k) => lower(k) === label.toLowerCase());
  if (label && !isKeyLabel) return label;
  return clean(invite.heirEmail) || 'Your heir';
}

/**
 * Where "Invite an heir" goes (decided 2026-09-21: "yes, same for the vault
 * menu"). Invites follow the Estate Plan, so a vault whose heirs no plan has
 * named yet opens the plan first. A plan already filed for this vault always
 * leads to the invites, even when it names none of the vault's heirs
 * (a filed plan cannot be filed again from here).
 */
export function inviteNeedsPlanFirst(
  heirs: readonly VaultHeir[],
  filed: readonly FiledPlanHeir[],
  planFiledForVault: boolean,
): boolean {
  if (planFiledForVault) return false;
  if (heirs.some((h) => heirName(h))) return false;
  return !withFiledNames(heirs, filed).changed;
}
