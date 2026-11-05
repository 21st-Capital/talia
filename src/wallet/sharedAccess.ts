/**
 * Who may change a shared portfolio (decided 2026-09-14): if Alice creates
 * portfolio A and shares it with Bob, Bob cannot add any transactions;
 * Alice is the only person who can update the portfolio.
 *
 * The owner writes; everyone else reads. One rule, so a screen cannot decide
 * differently from the sync: `isSharedViewer` hides every way to write, and
 * `runSharedSync` mirrors the owner's copy instead of pushing. The backend
 * refuses a member's write as well, which is what actually enforces it.
 *
 * Exporting splits in two (decided 2026-09-14). An export that re-imports as an
 * ordinary, EDITABLE portfolio is the owner's alone: it would outlive the
 * share the owner is free to end and survive the copy the member's phone
 * deletes when it does, which is the loophole to close. An account statement
 * is a document to read, not a portfolio to carry on editing, so a member
 * keeps it: "the idea is to close the loop for shared users to be able to
 * export the portfolio into an editing version".
 */
import type { WalletMeta } from './types';

/** True when this phone joined the portfolio by invite and sharing is live. */
export function isSharedViewer(
  wallet: Pick<WalletMeta, 'sharedPortfolio'> | undefined | null,
): boolean {
  const share = wallet?.sharedPortfolio;
  return !!share && share.role === 'member' && !share.ended;
}

/**
 * The ⋯ menu actions that write a portfolio someone can go on EDITING: the
 * Talia QR and the backup file both re-import as an ordinary portfolio. The
 * account statement is not one of them.
 */
export const EDITABLE_EXPORT_ACTIONS: ReadonlySet<string> = new Set(['qr', 'backup']);

/** False for a member: only the owner hands out an editable copy. */
export function mayExportEditableCopy(
  wallet: Pick<WalletMeta, 'sharedPortfolio'> | undefined | null,
): boolean {
  return !isSharedViewer(wallet);
}
