/**
 * Estate-plan share arithmetic, including STAND-IN heirs.
 *
 * Decided 2026-08-30: "many clients want to give everything to one person, their
 * spouse usually, and add their kids as well however only if their spouse is
 * also gone or incapacitated". That is the substitute heir (Ersatzerbe): a
 * person who inherits ONLY in place of someone else.
 *
 * The consequence for the maths is the important part. A stand-in does not
 * draw from the estate, so their share must not be counted against the other
 * heirs. Each heir belongs to a POOL: direct heirs share the estate, and the
 * stand-ins for one person share that person's portion. Every pool totals
 * 100% of itself, independently.
 *
 * Before this existed, a client who gave their spouse 100% had 0% left for
 * anyone else and the form's Continue button died with no explanation (found
 * in a phone test). Hence `remainingFor`, and hence `shareIssues`
 * reporting in plain language rather than silently blocking.
 *
 * One level only: a stand-in cannot itself be stood in for. Chains of
 * substitution are a legal drafting exercise, not a slider.
 *
 * Pure: no storage, no clock, no native.
 */

export interface ShareHeir {
  /** Identity within one plan. */
  uid: string;
  /** Display name, used only to phrase the problems. */
  name: string;
  percentage: number;
  /** uid of the heir this person stands in for; '' = inherits directly. */
  substituteForUid: string;
}

/** The pool an heir draws from: '' is the estate itself. */
export const poolOf = (h: Pick<ShareHeir, 'substituteForUid'>): string => h.substituteForUid ?? '';

/** Everyone drawing from `pool`, in the order given. */
export function heirsInPool<T extends Pick<ShareHeir, 'substituteForUid'>>(
  heirs: readonly T[],
  pool: string,
): T[] {
  return heirs.filter((h) => poolOf(h) === pool);
}

/** What `heir` may still take from its own pool, after the others in it. */
export function remainingFor(heirs: readonly ShareHeir[], uid: string): number {
  const self = heirs.find((h) => h.uid === uid);
  if (!self) return 100;
  const others = heirsInPool(heirs, poolOf(self))
    .filter((h) => h.uid !== uid)
    .reduce((sum, h) => sum + clampPct(h.percentage), 0);
  return Math.max(0, 100 - others);
}

const clampPct = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;

/**
 * The heirs `heirs[index]` may stand in for: named people, ahead of them in
 * the list, who inherit directly themselves. Ahead-of-them keeps the list
 * honest — you cannot stand in for someone the client has not described yet.
 */
export function substituteCandidates(heirs: readonly ShareHeir[], index: number): ShareHeir[] {
  return heirs
    .slice(0, Math.max(0, index))
    .filter((h) => poolOf(h) === '' && h.name.trim().length > 0);
}

/**
 * Clear stand-in links that no longer point anywhere: the target was removed
 * (the heir count shrank) or the target became a stand-in itself. Returns the
 * same array when nothing changed, so callers can skip a state write.
 */
export function pruneSubstitutes<T extends Pick<ShareHeir, 'uid' | 'substituteForUid'>>(
  heirs: readonly T[],
): T[] {
  const direct = new Set(heirs.filter((h) => poolOf(h) === '').map((h) => h.uid));
  let changed = false;
  const out = heirs.map((h) => {
    if (poolOf(h) === '' || direct.has(h.substituteForUid)) return h;
    changed = true;
    return { ...h, substituteForUid: '' };
  });
  return changed ? out : (heirs as T[]);
}

export interface ShareIssue {
  /** Machine tag, for tests and for styling. */
  kind: 'estateTotal' | 'standInTotal' | 'noShare';
  /** Plain language, ready to render. No em dashes: clients read this. */
  message: string;
}

/**
 * Everything wrong with the way this plan divides itself, said plainly.
 *
 * These are WARNINGS, never gates. The website has always let a client past an
 * unfinished split (decided 2026-08-30), and a dead button that will not say what it
 * wants is the worse failure. So the form reports and lets the client decide.
 *
 * Do NOT lean on "staff review it first" to justify this: the approval step was
 * retired 2026-07-26 and the PDF is downloadable the moment a plan is
 * submitted. Nobody stands between the client and the document, which is why
 * these messages have to be legible enough to act on.
 */
export function shareIssues(heirs: readonly ShareHeir[]): ShareIssue[] {
  const named = heirs.filter((h) => h.name.trim().length > 0 || h.percentage > 0);
  if (named.length === 0) return [];
  const issues: ShareIssue[] = [];

  const estate = heirsInPool(heirs, '');
  const estateTotal = estate.reduce((sum, h) => sum + clampPct(h.percentage), 0);
  if (estate.length > 0 && estateTotal !== 100) {
    issues.push({
      kind: 'estateTotal',
      message:
        estateTotal < 100
          ? `Your heirs add up to ${estateTotal}% of the estate. ${100 - estateTotal}% is not spoken for.`
          : `Your heirs add up to ${estateTotal}% of the estate, which is more than there is to give.`,
    });
  }

  for (const target of estate) {
    const standIns = heirsInPool(heirs, target.uid);
    if (standIns.length === 0) continue;
    const total = standIns.reduce((sum, h) => sum + clampPct(h.percentage), 0);
    if (total !== 100) {
      const who = target.name.trim() || 'that heir';
      issues.push({
        kind: 'standInTotal',
        message: `The stand-ins for ${who} add up to ${total}% of ${who}'s portion, not 100%.`,
      });
    }
  }

  for (const h of heirs) {
    if (h.name.trim().length > 0 && clampPct(h.percentage) === 0) {
      issues.push({
        kind: 'noShare',
        message: `${h.name.trim()} is set to inherit nothing. Give them a share or remove them.`,
      });
    }
  }

  return issues;
}
