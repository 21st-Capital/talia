/**
 * The title over each spending path on the policy card (PolicyOverview).
 * Pure, so Jest can pin the wording (__tests__/policyTitles.test.ts).
 *
 * "Primary path" and "Recovery path" only mean something when there are
 * several paths. A vault with a single path, a plain single-sig or multisig,
 * is not layered, so its card is titled what it is (decided 2026-09-21:
 * "'primary path' has no meaning here because this is not a layered setup.
 * We have to call it 'Spending policy'").
 */
import type { PolicyPath } from '../../bitcoin/descriptor';

export function pathTitle(p: PolicyPath, all: readonly PolicyPath[]): string {
  const timelocked = (x: PolicyPath) => x.olderBlocks !== undefined || x.afterHeight !== undefined;
  if (!timelocked(p)) return all.length === 1 ? 'Spending policy' : 'Primary path';
  const recoveries = all.filter(timelocked);
  const nth = recoveries.indexOf(p);
  return recoveries.length > 1 ? `Recovery path ${nth + 1}` : 'Recovery path';
}
