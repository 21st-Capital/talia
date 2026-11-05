/**
 * One change at a time to a list kept whole under one storage key (decided
 * 2026-10-19).
 *
 * Each writer of such a list reads all of it and writes all of it back, so
 * two at once lose one change: a record removed after its payment went out
 * comes back when another writer saves its older copy over it, and money
 * already sent shows again as ready to send. Since the Sent page no longer
 * waits for the bookkeeping behind it, writers overlap (Send all reports
 * its coins side by side; a rescue's report, the list's prune and the
 * app-start retry can meet), so each store's writers take turns here.
 * Reads need no turn.
 *
 * A turn waits for the one before at most `STORE_TURN_WAIT_MS`: a write
 * that never ends (storage or a Keychain that never answers) must not hold
 * every later one for good.
 */
export const STORE_TURN_WAIT_MS = 15_000;

/** A queue for one store: `inTurn(change)` runs `change` after the
 *  changes queued before it, and answers what it answers. */
export function storeTurns(waitMs: number = STORE_TURN_WAIT_MS): <T>(change: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(change: () => Promise<T>): Promise<T> => {
    const before = tail;
    const run = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        before,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMs);
        }),
      ]);
      clearTimeout(timer);
      return change();
    })();
    tail = run.catch(() => {});
    return run;
  };
}
