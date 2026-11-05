/**
 * Decided 2026-09-26: sign-out must revoke the refresh
 * token on the server, two refreshes must never race on the single-use
 * refresh token, and a network failure must never sign anyone out.
 */
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mem = require('../../testing/memoryKeychain') as typeof import('../../testing/memoryKeychain');
import { COMPANY_API, loadSession, refreshStatusVerdict, saveSession, signOut } from '../companyAuth';
import type { CompanySession } from '../companyAuth';

const SERVICE = 'com.twentyfirstcapital.keel.companyauth';

function stored(): CompanySession | null {
  const item = mem.__items().get(SERVICE);
  return item ? (JSON.parse(item.password) as CompanySession) : null;
}

const expired = (): CompanySession => ({
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  expiresAt: Date.now() - 1000,
  email: 'owner@example.com',
});

function respond(status: number, body: unknown = {}): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as unknown as Response;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  mem.__reset();
  fetchMock = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
});

describe('refreshStatusVerdict', () => {
  it('only a refusal of the token is a reason to forget the session', () => {
    expect(refreshStatusVerdict(200)).toBe('ok');
    expect(refreshStatusVerdict(400)).toBe('rejected');
    expect(refreshStatusVerdict(401)).toBe('rejected');
    expect(refreshStatusVerdict(403)).toBe('rejected');
    for (const s of [404, 429, 500, 502, 503]) expect(refreshStatusVerdict(s)).toBe('unavailable');
  });
});

describe('loadSession', () => {
  it('refreshes ONCE when several screens ask at the same moment', async () => {
    await saveSession(expired());
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => {
        release = resolve;
      }),
    );
    const all = Promise.all([loadSession(), loadSession(), loadSession()]);
    await new Promise((r) => setTimeout(r, 0));
    release(respond(200, { access_token: 'new-access', refresh_token: 'new-refresh' }));
    const sessions = await all;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const s of sessions) expect(s?.accessToken).toBe('new-access');
    expect(stored()?.refreshToken).toBe('new-refresh');
  });

  it('offline or a server error keeps the session for the next try', async () => {
    await saveSession(expired());
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await loadSession()).toBeNull();
    expect(stored()?.refreshToken).toBe('old-refresh');
    fetchMock.mockResolvedValueOnce(respond(503));
    expect(await loadSession()).toBeNull();
    expect(stored()?.refreshToken).toBe('old-refresh');
  });

  it('a refused refresh token forgets the session', async () => {
    await saveSession(expired());
    fetchMock.mockResolvedValueOnce(respond(401));
    expect(await loadSession()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('a Keychain that cannot answer is not a signed-out user', async () => {
    await saveSession({ ...expired(), expiresAt: Date.now() + 60_000 });
    mem.__failNextRead();
    expect(await loadSession()).toBeNull();
    expect(stored()).not.toBeNull();
    expect((await loadSession())?.accessToken).toBe('old-access');
  });
});

describe('signOut', () => {
  it('asks the server to revoke the refresh token, then forgets the session', async () => {
    const s = { ...expired(), expiresAt: Date.now() + 60_000 };
    await saveSession(s);
    fetchMock.mockResolvedValueOnce(respond(200));
    await signOut(s);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${COMPANY_API}/api/auth/logout/`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer old-access');
    expect(JSON.parse(init.body)).toEqual({ refresh_token: 'old-refresh' });
    expect(stored()).toBeNull();
  });

  it('an older backend (404), an error or no network still signs out here', async () => {
    for (const answer of [
      () => Promise.resolve(respond(404)),
      () => Promise.resolve(respond(500)),
      () => Promise.reject(new Error('offline')),
    ]) {
      const s = { ...expired(), expiresAt: Date.now() + 60_000 };
      await saveSession(s);
      fetchMock.mockImplementationOnce(answer);
      await signOut(s);
      expect(stored()).toBeNull();
    }
  });
});
