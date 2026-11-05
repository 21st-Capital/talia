/**
 * After a rescue went out (2026-10-19, a testnet rescue: the coins
 * moved, the staff dashboard read Completed, and the phone kept spinning
 * with no success message). React Native's fetch has no time limit, so a
 * reply lost on the way waited for ever. Every call that follows a sent
 * rescue is now bounded, and the report to 21st Capital is kept and sent
 * again until it lands, so the request never stays "Signed and ready to
 * broadcast" on the phone or on the server.
 */
import {
  completeRescue,
  fetchMyRescues,
  loadPendingRescues,
  markRescueSent,
  reportSentRescues,
  savePendingRescue,
  sentRecordExpired,
  settleSentRescue,
  RESCUE_SERVER_MS,
  SENT_RECORD_KEEP_MS,
} from '../rescue';
import { completeCosign, COMPLETE_COSIGN_MS, fetchMyCosigns } from '../cosign';
import { fetchWithin, LIST_FETCH_MS } from '../fetchWithin';

const mockLoadSession = jest.fn(async (): Promise<unknown> => ({ accessToken: 't' }));
jest.mock('../companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  authHeaders: () => ({ Authorization: 'Bearer t' }),
  loadSession: () => mockLoadSession(),
}));
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));
jest.mock('../../wallet/sealedStore', () => ({
  sealedGetItem: async () => null,
  sealedSetItem: async () => undefined,
}));

const memory = require('../../testing/memoryAsyncStorage') as { __clear: () => void };
const session = { accessToken: 't' } as never;
const realFetch = global.fetch;

/** Every call, with the abort signal it carried. */
let calls: Array<{ url: string; method: string; signal?: AbortSignal }> = [];
/** Answer each URL with a status, or never ('hang'). */
function serve(answers: Record<string, number | 'hang'>, body: unknown = {}) {
  calls = [];
  global.fetch = jest.fn((url: string, init?: { method?: string; signal?: AbortSignal }) => {
    calls.push({ url, method: init?.method ?? 'GET', signal: init?.signal });
    const key = Object.keys(answers).find((k) => url.includes(k));
    const a = key ? answers[key] : 404;
    if (a === 'hang') return new Promise(() => {});
    return Promise.resolve({ ok: a < 400, status: a, json: async () => body });
  }) as unknown as typeof fetch;
}

/** Answer `path` with 200 and `body` after `ms`, as a slow download does. */
function serveSlow(path: string, ms: number, body: unknown) {
  calls = [];
  global.fetch = jest.fn((url: string) => {
    calls.push({ url, method: 'GET' });
    if (!url.includes(path)) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    return new Promise((resolve) => setTimeout(() => resolve({ ok: true, status: 200, json: async () => body }), ms));
  }) as unknown as typeof fetch;
}

const pending = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  walletId: 'w1',
  vaultLabel: 'Twopaths test',
  createdAt: 1,
  ...extra,
});

beforeEach(() => {
  memory.__clear();
  mockLoadSession.mockReset();
  mockLoadSession.mockImplementation(async () => ({ accessToken: 't' }));
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());
afterAll(() => {
  global.fetch = realFetch;
});

describe('a fetch that cannot wait for ever', () => {
  it('rejects once the time is up and aborts the request, whether or not the abort is heard', async () => {
    serve({ '/slow/': 'hang' });
    const settled = jest.fn();
    const req = fetchWithin('https://backend.example/slow/', {}, 5_000);
    req.then(settled, settled);
    await jest.advanceTimersByTimeAsync(4_999);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(req).rejects.toThrow('No answer from the server in 5s');
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it('an answer in time passes straight through, and nothing is aborted', async () => {
    serve({ '/fast/': 200 });
    const res = await fetchWithin('https://backend.example/fast/', {}, 5_000);
    expect(res.status).toBe(200);
    expect(calls[0].signal?.aborted).toBe(false);
  });
});

describe('telling 21st Capital the rescue went out', () => {
  it('is settled once the server has it, or can never take it', async () => {
    for (const status of [200, 404, 409]) {
      serve({ '/complete/': status });
      await expect(completeRescue(session, 'r1')).resolves.toBe(true);
      expect(calls[0]).toMatchObject({ url: 'https://backend.example/api/vaults/rescue/requests/r1/complete/', method: 'POST' });
    }
  });

  it('is asked again later after a refused session, a busy or broken server', async () => {
    for (const status of [401, 429, 500, 502, 504]) {
      serve({ '/complete/': status });
      await expect(completeRescue(session, 'r1')).resolves.toBe(false);
    }
  });

  it('a reply that never comes (the incident): false within RESCUE_SERVER_MS, never a hang', async () => {
    serve({ '/complete/': 'hang' });
    const settled = jest.fn();
    const done = completeRescue(session, 'r1');
    done.then(settled);
    await jest.advanceTimersByTimeAsync(RESCUE_SERVER_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(false);
  });

  it('the list of requests is bounded too, with a list’s minute, and throws like any other failure', async () => {
    serve({ '/rescue/mine/': 'hang' });
    const list = fetchMyRescues(session);
    const settled = jest.fn();
    const outcome = list.then(
      () => 'answered',
      () => 'failed',
    );
    outcome.then(settled);
    await jest.advanceTimersByTimeAsync(LIST_FETCH_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBe('failed');
  });

  it('a list that takes 40 s to come down a slow link still loads (decided 2026-10-19)', async () => {
    serveSlow('/rescue/mine/', 40_000, []);
    const list = fetchMyRescues(session);
    await jest.advanceTimersByTimeAsync(40_000);
    await expect(list).resolves.toEqual([]);
  });
});

describe('the phone’s record of a sent rescue', () => {
  it('is marked with the txid that went out, and the others are left alone', async () => {
    await savePendingRescue(pending('r1'));
    await savePendingRescue(pending('r2'));
    await markRescueSent('r1', 'ab'.repeat(32));
    const all = await loadPendingRescues();
    expect(all.find((p) => p.id === 'r1')?.sentTxid).toBe('ab'.repeat(32));
    expect(all.find((p) => p.id === 'r2')?.sentTxid).toBeUndefined();
    // A request the phone does not hold is not invented.
    await markRescueSent('nope', 'cd'.repeat(32));
    expect((await loadPendingRescues()).map((p) => p.id).sort()).toEqual(['r1', 'r2']);
  });

  it('notes that the server has the report, reports it once, and keeps the record while the rescue waits for a block', async () => {
    await savePendingRescue(pending('r1', { sentTxid: 'ab'.repeat(32) }));
    await savePendingRescue(pending('r2', { sentTxid: 'cd'.repeat(32) }));
    await savePendingRescue(pending('r3'));
    serve({ '/requests/r1/complete/': 200, '/requests/r2/complete/': 502 });
    await reportSentRescues(session);
    const reported = async (id: string) => (await loadPendingRescues()).find((p) => p.id === id)?.reported;
    expect(await reported('r1')).toBe(true);
    expect(await reported('r2')).toBeUndefined();
    expect((await loadPendingRescues()).map((p) => p.id).sort()).toEqual(['r1', 'r2', 'r3']);
    // Only sent records are reported: r3 has not gone out.
    expect(calls.map((c) => c.url)).not.toContain('https://backend.example/api/vaults/rescue/requests/r3/complete/');
    // The next run lands r2, and does not tell the server about r1 again.
    serve({ '/complete/': 200 });
    await reportSentRescues(session);
    expect(await reported('r2')).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(['https://backend.example/api/vaults/rescue/requests/r2/complete/']);
  });

  it('`only` limits the report to the rescue just sent', async () => {
    await savePendingRescue(pending('r1', { sentTxid: 'ab'.repeat(32) }));
    await savePendingRescue(pending('r2', { sentTxid: 'cd'.repeat(32) }));
    serve({ '/complete/': 200 });
    await reportSentRescues(session, ['r2']);
    expect(calls.map((c) => c.url)).toEqual(['https://backend.example/api/vaults/rescue/requests/r2/complete/']);
  });

  it('remembers when it went out, and the first time stands', async () => {
    await savePendingRescue(pending('r1'));
    await markRescueSent('r1', 'ab'.repeat(32));
    const at = (await loadPendingRescues())[0].sentAt as number;
    expect(at).toBeGreaterThan(0);
    await jest.advanceTimersByTimeAsync(5_000);
    await markRescueSent('r1', 'ab'.repeat(32));
    expect((await loadPendingRescues())[0].sentAt).toBe(at);
  });

  it('goes only long after it went out, when the vault never lists it', () => {
    const now = 1_000_000_000_000;
    expect(sentRecordExpired({ sentAt: now - SENT_RECORD_KEEP_MS }, now)).toBe(false);
    expect(sentRecordExpired({ sentAt: now - SENT_RECORD_KEEP_MS - 1 }, now)).toBe(true);
    expect(sentRecordExpired({}, now)).toBe(true);
  });
});

describe('everything after the Sent page (settleSentRescue)', () => {
  it('marks and reports, and the record stays for a speed-up', async () => {
    await savePendingRescue(pending('r1'));
    serve({ '/complete/': 200 });
    await settleSentRescue('r1', 'ab'.repeat(32));
    expect(await loadPendingRescues()).toEqual([
      expect.objectContaining({ id: 'r1', sentTxid: 'ab'.repeat(32), reported: true }),
    ]);
  });

  it('a report whose reply never comes ends in RESCUE_SERVER_MS and leaves the record marked for the next try', async () => {
    await savePendingRescue(pending('r1'));
    serve({ '/complete/': 'hang' });
    const settled = jest.fn();
    settleSentRescue('r1', 'ab'.repeat(32)).then(settled);
    await jest.advanceTimersByTimeAsync(RESCUE_SERVER_MS);
    expect(settled).toHaveBeenCalled();
    expect(await loadPendingRescues()).toEqual([expect.objectContaining({ id: 'r1', sentTxid: 'ab'.repeat(32) })]);
  });

  it('a session that never loads (a stuck token refresh) ends too, with the record marked', async () => {
    await savePendingRescue(pending('r1'));
    mockLoadSession.mockImplementation(() => new Promise(() => {}));
    serve({});
    const settled = jest.fn();
    settleSentRescue('r1', 'ab'.repeat(32)).then(settled);
    await jest.advanceTimersByTimeAsync(RESCUE_SERVER_MS);
    expect(settled).toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect((await loadPendingRescues())[0].sentTxid).toBe('ab'.repeat(32));
  });

  it('signed out: the record stays marked, and nothing is sent', async () => {
    await savePendingRescue(pending('r1'));
    mockLoadSession.mockImplementation(async () => null);
    serve({});
    await settleSentRescue('r1', 'ab'.repeat(32));
    expect(calls).toEqual([]);
    expect((await loadPendingRescues())[0].sentTxid).toBe('ab'.repeat(32));
  });
});

describe('co-signing’s report and list are bounded too', () => {
  it('completeCosign resolves within COMPLETE_COSIGN_MS when the reply never comes', async () => {
    serve({ '/cosign/requests/c1/complete/': 'hang' });
    const settled = jest.fn();
    completeCosign(session, 'c1').then(settled);
    await jest.advanceTimersByTimeAsync(COMPLETE_COSIGN_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalled();
  });

  it('fetchMyCosigns throws when the list never answers, so the screen keeps what it had', async () => {
    serve({ '/cosign/requests/mine/': 'hang', '/mine/': 'hang' });
    const settled = jest.fn();
    const outcome = fetchMyCosigns(session).then(
      () => 'answered',
      () => 'failed',
    );
    outcome.then(settled);
    await jest.advanceTimersByTimeAsync(LIST_FETCH_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toBe('failed');
  });

  it('a co-sign list that takes 40 s to come down (200 signed PSBTs, a slow link) still loads', async () => {
    serveSlow('/mine/', 40_000, []);
    const list = fetchMyCosigns(session);
    await jest.advanceTimersByTimeAsync(40_000);
    await expect(list).resolves.toEqual([]);
  });

  it('the list’s minute is for lists only: the reports keep their 15 s', () => {
    expect(COMPLETE_COSIGN_MS).toBe(15_000);
    expect(RESCUE_SERVER_MS).toBe(15_000);
    expect(LIST_FETCH_MS).toBe(60_000);
  });
});
