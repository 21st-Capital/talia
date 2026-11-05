/**
 * How a spending path reads on the Spending policy screen (decided 2026-09-23).
 *
 * Two rules, and they are not the same rule:
 *
 * SHUT is about the CLOCK, whoever holds the keys. "I would change the
 * colour of the timelocked paths to a more gray and inactive colour because
 * they are not active yet", and "the grayed state is for ALL timelocked
 * paths including inheritance key paths". So an heir's path greys exactly
 * like ours. Once a path opens it reads like any other, because by then it
 * is one. No coin confirmed yet means no clock has started, which is still
 * shut.
 *
 * OURS is about the KEYS. "the rescue button ONLY appears with a rescue path
 * with us": a timelocked path every one of whose keys is 21st Capital's.
 * An heir's recovery path holds the heir's own key and is never this, so it
 * never offers to ask us for a rescue.
 */

export interface PolicyPathShape {
  olderBlocks?: number;
  afterHeight?: number;
  groups: ReadonlyArray<{ keys: ReadonlyArray<{ fingerprint?: string }> }>;
}

/** Is this path's clock still running (or not yet started)? */
export function pathStillShut(
  path: PolicyPathShape,
  nextOpening?: Record<number, number | null>,
): boolean {
  if (path.olderBlocks === undefined && path.afterHeight === undefined) return false;
  if (path.olderBlocks === undefined || nextOpening === undefined) return true;
  const left = nextOpening[path.olderBlocks];
  return left == null || left > 0;
}

/** Is this 21st Capital's own rescue path, which we can be asked to use? */
export function isProviderRescuePath(
  path: PolicyPathShape,
  isProviderKey: (fingerprint?: string) => boolean,
): boolean {
  if (path.olderBlocks === undefined) return false;
  if (path.groups.length === 0) return false;
  return path.groups.every(
    (g) => g.keys.length > 0 && g.keys.every((k) => isProviderKey(k.fingerprint)),
  );
}
