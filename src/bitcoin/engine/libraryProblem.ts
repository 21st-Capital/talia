/**
 * What opening a vault says when the wallet library cannot be used, in
 * Talia's own words. `LIBRARY_CHECK_FAILED` came with the old engine's
 * removal, its text approved word for word (decided 2026-11-04).
 *
 * A leaf, so the vault page's one line (wallet/chainServers.ts
 * `syncProblemNote`) and the screens can show the sentence as written, with
 * nothing before it, without importing the engine. engineProvider.ts throws
 * these and re-exports them.
 */

/** What opening a vault says when the build has no wallet library (no build Talia ships). */
export const NO_WALLET_LIBRARY = 'This build of Talia has no wallet library on this phone.';

/** What opening a vault says when the library failed its known-answer test this launch. */
export const LIBRARY_CHECK_FAILED = "Talia's wallet library failed its self-check, so no vault opens. Please contact 21st Capital.";

/**
 * The sentence when `e` is the library refusing to open a vault, else null.
 * Shown exactly as it is: never after "Sync failed:" or "Could not load
 * coins:", and never in place of a note about the server, which no sync
 * reached (decided 2026-11-04).
 */
export function libraryProblem(e: unknown): string | null {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : null;
  return message === LIBRARY_CHECK_FAILED || message === NO_WALLET_LIBRARY ? message : null;
}
