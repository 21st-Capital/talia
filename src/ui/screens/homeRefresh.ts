/**
 * When the home screen brings the vaults' balances up to date by itself
 * (decided 2026-11-04 after a phone test: the balances stayed as they were
 * until the list was pulled down, every time the app was opened).
 *
 * The home screen used to refresh ONCE per mount, 2.5 s after its first
 * vault list, and never again. Its tab stays mounted while the app is in
 * the background, so coming back to the app refreshed nothing; and a vault
 * list whose length changed inside those 2.5 s cancelled the only refresh
 * the launch had.
 *
 * Three ways in, and one refresh at a time:
 * - the launch: once the vault list is in, after `LAUNCH_DELAY_MS`, so a
 *   vault the client opens straight away enters the engine's serial queue
 *   first. Nothing heavy runs on the launch path (a scrypt KDF once blocked a
 *   launch for about 12 seconds on Hermes, 2026-08-27): the refresh is the same syncs the pull runs, after the delay.
 * - a return to the app: 'active' after the app was in the background, after
 *   `RETURN_DELAY_MS`. iOS also reports 'active' 2 to 3 s into a COLD launch,
 *   coming from a state that was never 'background'; that one belongs to the
 *   launch and is not a return, so a launch never refreshes twice. A return
 *   within `RETURN_MIN_GAP_MS` of a finished refresh asks nothing.
 * - the pull, as before. It joins a refresh already running.
 *
 * A return while a refresh is running queues ONE more after it, never a
 * second loop beside it: the engine's native queue is serial (and until the
 * old engine's removal, decided 2026-11-04, every sync of the 0.28 engine
 * opened a connection bdk-rn never closed). The running one may have started
 * before the app went away.
 *
 * Every launch syncs every vault from nothing (the engine keeps no history
 * between launches), one vault after another, so with many vaults the last
 * card changes a minute or more after the app opens (simulator 2026-11-04:
 * 36 s for three vaults). No spinner shows it (decided 2026-11-04 after a
 * phone test: one turning at every opening was irritating, and clients
 * rarely hold that many vaults); the cards simply change when their vault
 * is done.
 */

export const LAUNCH_DELAY_MS = 2_500;
export const RETURN_DELAY_MS = 1_000;
export const RETURN_MIN_GAP_MS = 15_000;

/** React Native's AppState values, as text (this file imports nothing native). */
export type AppStateName = 'active' | 'background' | 'inactive' | 'unknown' | 'extension' | string;

export interface HomeRefreshDeps {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface HomeRefresh {
  /** The vault list is in. Only the first call counts. */
  launch(): void;
  /** Every AppState change. */
  appState(next: AppStateName): void;
  /** The pull-down. Resolves when the refresh it started or joined ends. */
  pull(): Promise<void>;
  /** The screen is gone: no timer fires and no queued refresh starts. */
  dispose(): void;
}

const realDeps: HomeRefreshDeps = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function homeRefresh(run: () => Promise<void>, deps: HomeRefreshDeps = realDeps): HomeRefresh {
  let launched = false;
  let away = false;
  let disposed = false;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let finishedAt: number | null = null;

  const cancelTimer = (): void => {
    if (timer != null) deps.clearTimer(timer);
    timer = null;
  };

  const startPass = (): Promise<void> => {
    cancelTimer();
    const pass = Promise.resolve()
      .then(run)
      // A refresh that fails leaves the cards on their cached values.
      .catch(() => undefined)
      .then(() => {
        finishedAt = deps.now();
        running = null;
      });
    running = pass;
    return pass;
  };

  const queueAfterRunning = (): Promise<void> => {
    if (queued) return queued;
    const after = running ?? Promise.resolve();
    queued = after.then(() => {
      queued = null;
      if (disposed) return undefined;
      return startPass();
    });
    return queued;
  };

  const schedule = (ms: number, fire: () => void): void => {
    // One timer at a time: a return replaces a launch still waiting, so the
    // two never run back to back.
    cancelTimer();
    timer = deps.setTimer(() => {
      timer = null;
      if (!disposed) fire();
    }, ms);
  };

  return {
    launch() {
      if (launched || disposed) return;
      launched = true;
      schedule(LAUNCH_DELAY_MS, () => {
        if (!running) void startPass();
      });
    },

    appState(next) {
      if (disposed) return;
      if (next === 'background') {
        away = true;
        return;
      }
      if (next !== 'active' || !away) return;
      away = false;
      schedule(RETURN_DELAY_MS, () => {
        if (running) {
          void queueAfterRunning();
          return;
        }
        if (finishedAt != null && deps.now() - finishedAt < RETURN_MIN_GAP_MS) return;
        void startPass();
      });
    },

    pull() {
      if (disposed) return Promise.resolve();
      cancelTimer();
      return queued ?? running ?? startPass();
    },

    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}
