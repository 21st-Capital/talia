/**
 * When the home screen refreshes the vaults by itself (decided 2026-11-04
 * after a phone test: the balances changed only after a pull-down, every
 * time the app was opened).
 */
import {
  LAUNCH_DELAY_MS,
  RETURN_DELAY_MS,
  RETURN_MIN_GAP_MS,
  homeRefresh,
} from '../homeRefresh';
import type { HomeRefreshDeps } from '../homeRefresh';

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const deps: HomeRefreshDeps = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= now && timers.has(id)) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  return { deps, advance, pending: () => timers.size };
}

/** A refresh the test finishes by hand, counting how often it started. */
function fakeRun() {
  const finishers: Array<() => void> = [];
  let failNext = false;
  const run = jest.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        if (failNext) {
          failNext = false;
          finishers.push(() => reject(new Error('offline')));
        } else {
          finishers.push(resolve);
        }
      }),
  );
  return {
    run,
    finish: async (): Promise<void> => {
      finishers.shift()?.();
      // Let the pass's own then-chain and anything queued behind it settle.
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    },
    failNext: () => {
      failNext = true;
    },
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('the launch', () => {
  it('refreshes once, after the delay, when the vault list is in', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    r.launch();
    t.advance(LAUNCH_DELAY_MS - 1);
    await settle();
    expect(f.run).not.toHaveBeenCalled();
    t.advance(1);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it('counts only the first call: a vault list that changes never cancels or repeats it', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    r.launch();
    t.advance(1_000);
    r.launch();
    r.launch();
    t.advance(LAUNCH_DELAY_MS);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it("is not doubled by the 'active' iOS reports a few seconds into a cold launch", async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    r.appState('inactive');
    r.launch();
    t.advance(2_000);
    r.appState('active');
    t.advance(LAUNCH_DELAY_MS + RETURN_DELAY_MS);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
  });
});

describe('a return to the app', () => {
  async function launched() {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    r.launch();
    t.advance(LAUNCH_DELAY_MS);
    await settle();
    await f.finish();
    return { t, f, r };
  }

  it('refreshes after the app was in the background', async () => {
    const { t, f, r } = await launched();
    t.advance(10 * 60_000);
    r.appState('inactive');
    r.appState('background');
    r.appState('active');
    t.advance(RETURN_DELAY_MS);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it('refreshes at every return, not only the first', async () => {
    const { t, f, r } = await launched();
    for (let i = 0; i < 3; i += 1) {
      t.advance(60_000);
      r.appState('background');
      r.appState('active');
      t.advance(RETURN_DELAY_MS);
      await settle();
      await f.finish();
    }
    expect(f.run).toHaveBeenCalledTimes(4);
  });

  it('refreshes even when the launch refresh failed', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    f.failNext();
    r.launch();
    t.advance(LAUNCH_DELAY_MS);
    await settle();
    await f.finish();
    t.advance(60_000);
    r.appState('background');
    r.appState('active');
    t.advance(RETURN_DELAY_MS);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it('asks nothing when the app never left the foreground (a Face ID prompt, Control Center)', async () => {
    const { t, f, r } = await launched();
    t.advance(60_000);
    r.appState('inactive');
    r.appState('active');
    t.advance(RETURN_DELAY_MS * 5);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it('asks nothing within the minimum gap of a finished refresh', async () => {
    const { t, f, r } = await launched();
    t.advance(RETURN_MIN_GAP_MS - RETURN_DELAY_MS - 1);
    r.appState('background');
    r.appState('active');
    t.advance(RETURN_DELAY_MS);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
    // The next return past the gap refreshes again.
    t.advance(RETURN_MIN_GAP_MS);
    r.appState('background');
    r.appState('active');
    t.advance(RETURN_DELAY_MS);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it('queues ONE more refresh behind one still running, never a second beside it', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    r.launch();
    t.advance(LAUNCH_DELAY_MS);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
    // Two returns while the launch's refresh still runs (iOS paused it).
    for (let i = 0; i < 2; i += 1) {
      r.appState('background');
      r.appState('active');
      t.advance(RETURN_DELAY_MS);
      await settle();
    }
    expect(f.run).toHaveBeenCalledTimes(1);
    await f.finish();
    expect(f.run).toHaveBeenCalledTimes(2);
    await f.finish();
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it('replaces a launch refresh still waiting, so the two never run back to back', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    r.launch();
    t.advance(500);
    r.appState('background');
    r.appState('active');
    t.advance(LAUNCH_DELAY_MS + RETURN_DELAY_MS);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(t.pending()).toBe(0);
  });
});

describe('the pull', () => {
  it('refreshes at once and resolves when that refresh ends', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    let done = false;
    void r.pull().then(() => {
      done = true;
    });
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    await f.finish();
    expect(done).toBe(true);
  });

  it('joins a refresh already running instead of starting a second loop', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    r.launch();
    t.advance(LAUNCH_DELAY_MS);
    await settle();
    let done = false;
    void r.pull().then(() => {
      done = true;
    });
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
    await f.finish();
    expect(done).toBe(true);
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it('takes the place of a return refresh still waiting', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    r.appState('background');
    r.appState('active');
    void r.pull();
    t.advance(RETURN_DELAY_MS * 5);
    await settle();
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it('pulls again after a refresh ends, however recent', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    void r.pull();
    await settle();
    await f.finish();
    void r.pull();
    await settle();
    expect(f.run).toHaveBeenCalledTimes(2);
  });
});

describe('a screen that is gone', () => {
  it('fires no timer and starts no queued refresh', async () => {
    const t = fakeTime();
    const f = fakeRun();
    const r = homeRefresh(f.run, t.deps);
    r.launch();
    t.advance(LAUNCH_DELAY_MS);
    await settle();
    r.appState('background');
    r.appState('active');
    t.advance(RETURN_DELAY_MS);
    await settle();
    r.dispose();
    await f.finish();
    expect(f.run).toHaveBeenCalledTimes(1);

    const t2 = fakeTime();
    const f2 = fakeRun();
    const r2 = homeRefresh(f2.run, t2.deps);
    r2.launch();
    r2.dispose();
    t2.advance(LAUNCH_DELAY_MS * 2);
    await settle();
    expect(f2.run).not.toHaveBeenCalled();
  });
});
