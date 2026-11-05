// booking.ts pulls companyAuth, which touches the iOS Keychain natively —
// irrelevant here, and the package ships untranspiled ESM Jest can't load.
jest.mock('react-native-keychain', () => ({}));

// The signed-in session is the one thing the booking call asks the auth
// service for, so it is faked here per test.
const mockLoadSession = jest.fn();
const mockClearSession = jest.fn(() => Promise.resolve());
jest.mock('../companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  loadSession: () => mockLoadSession(),
  clearSession: () => mockClearSession(),
  authHeaders: (s: { accessToken: string }) => ({ Authorization: `Bearer ${s.accessToken}` }),
}));

import {
  bookAppointment,
  isUpcomingSession,
  SESSION_GRACE_MS,
  SIGN_IN_AGAIN_TO_BOOK,
} from '../booking';

// Decided 2026-09-02: the booked-session banner must survive a relaunch, and must
// give way to the Book button only once the session is over.
describe('isUpcomingSession', () => {
  const now = Date.parse('2026-09-03T09:00:00Z');

  it('is true for a session ahead', () => {
    expect(isUpcomingSession(now + 3600_000, now)).toBe(true);
  });

  it('stays true while the session is under way', () => {
    expect(isUpcomingSession(now - SESSION_GRACE_MS + 1, now)).toBe(true);
  });

  it('is false once the session is two hours old', () => {
    expect(isUpcomingSession(now - SESSION_GRACE_MS, now)).toBe(false);
  });

  it('is false with nothing booked or a bad timestamp', () => {
    expect(isUpcomingSession(undefined, now)).toBe(false);
    expect(isUpcomingSession(null, now)).toBe(false);
    expect(isUpcomingSession(Number.NaN, now)).toBe(false);
  });
});

/**
 * The backend attaches a family member's free setup meeting to their booking
 * only when it knows who is asking, so the header goes along when there is a
 * session. Nobody may ever be blocked from booking a meeting by it.
 */
describe('bookAppointment', () => {
  const input = {
    firstName: 'Alex',
    lastName: 'Example',
    email: 'alex@example.com',
    scheduledAtUtc: '2026-09-25T13:00:00Z',
  };
  const ok = { ok: true, status: 200 };
  const unauthorised = { ok: false, status: 401, json: async () => ({}) };

  let calls: Array<{ url: string; init: RequestInit }>;
  const fakeFetch = (results: Array<unknown>) => {
    let n = 0;
    return jest.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(results[n++]);
    });
  };
  const headersOf = (i: number) => calls[i].init.headers as Record<string, string>;

  beforeEach(() => {
    calls = [];
    mockLoadSession.mockReset();
    mockClearSession.mockClear();
  });

  it('sends the signed-in session header', async () => {
    mockLoadSession.mockResolvedValue({ accessToken: 'live-token' });
    (global as { fetch?: unknown }).fetch = fakeFetch([ok]);

    await bookAppointment('link-token', input);

    expect(calls).toHaveLength(1);
    expect(headersOf(0).Authorization).toBe('Bearer live-token');
  });

  it('books without a header when nobody is signed in', async () => {
    mockLoadSession.mockResolvedValue(null);
    (global as { fetch?: unknown }).fetch = fakeFetch([ok]);

    await bookAppointment('link-token', input);

    expect(calls).toHaveLength(1);
    expect(headersOf(0).Authorization).toBeUndefined();
  });

  it('retries once without the header when a stale token is refused', async () => {
    mockLoadSession.mockResolvedValue({ accessToken: 'stale-token' });
    (global as { fetch?: unknown }).fetch = fakeFetch([unauthorised, ok]);

    await expect(bookAppointment('link-token', input)).resolves.toBeUndefined();

    expect(calls).toHaveLength(2);
    expect(headersOf(0).Authorization).toBe('Bearer stale-token');
    expect(headersOf(1).Authorization).toBeUndefined();
    expect(calls[1].init.body).toBe(calls[0].init.body);
  });

  // A token loadSession believed was live and the server refused is a login
  // that was ended elsewhere: keeping it would let every later call fail the
  // same silent way (decided 2026-09-21).
  it('drops a login the server refuses, and still books', async () => {
    mockLoadSession.mockResolvedValue({ accessToken: 'revoked-token' });
    (global as { fetch?: unknown }).fetch = fakeFetch([unauthorised, ok]);

    await expect(bookAppointment('link-token', input)).resolves.toBeUndefined();

    expect(mockClearSession).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(headersOf(1).Authorization).toBeUndefined();
  });

  // A 403 is about what the account may do, not about the token.
  it('keeps the session when the refusal is a 403', async () => {
    mockLoadSession.mockResolvedValue({ accessToken: 'live-token' });
    (global as { fetch?: unknown }).fetch = fakeFetch([
      { ok: false, status: 403, json: async () => ({}) },
      ok,
    ]);

    await expect(bookAppointment('link-token', input)).resolves.toBeUndefined();

    expect(mockClearSession).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
  });

  it('does not retry a refusal that is not about the token', async () => {
    mockLoadSession.mockResolvedValue({ accessToken: 'live-token' });
    (global as { fetch?: unknown }).fetch = fakeFetch([
      { ok: false, status: 400, json: async () => ({ message: 'That time has gone.' }) },
    ]);

    await expect(bookAppointment('link-token', input)).rejects.toThrow('That time has gone.');
    expect(calls).toHaveLength(1);
  });

  it('books anyway when the session cannot be read', async () => {
    mockLoadSession.mockRejectedValue(new Error('keychain locked'));
    (global as { fetch?: unknown }).fetch = fakeFetch([ok]);

    await bookAppointment('link-token', input);

    expect(calls).toHaveLength(1);
    expect(headersOf(0).Authorization).toBeUndefined();
  });
});

/**
 * A vault's setup (testing) meeting counts for the vault only when it is
 * booked signed in as the account (backend, decided 2026-09-26). An
 * anonymous retry would book a meeting staff see and the vault never does,
 * so for that meeting there is none: the person is asked to sign in again.
 */
describe('bookAppointment for the vault setup meeting (signedInOnly)', () => {
  const input = {
    firstName: 'Alex',
    lastName: 'Example',
    email: 'alex@example.com',
    scheduledAtUtc: '2026-09-25T13:00:00Z',
  };
  const ok = { ok: true, status: 200 };
  let calls: Array<{ url: string; init: RequestInit }>;
  const fakeFetch = (results: Array<unknown>) => {
    let n = 0;
    return jest.fn((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(results[n++]);
    });
  };

  beforeEach(() => {
    calls = [];
    mockLoadSession.mockReset();
    mockClearSession.mockClear();
  });

  it('books with the session header', async () => {
    mockLoadSession.mockResolvedValue({ accessToken: 'live-token' });
    (global as { fetch?: unknown }).fetch = fakeFetch([ok]);

    await bookAppointment('link-token', input, { signedInOnly: true });

    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer live-token');
  });

  it('never retries anonymously after a 401: the login is dropped and nothing is booked', async () => {
    mockLoadSession.mockResolvedValue({ accessToken: 'revoked-token' });
    (global as { fetch?: unknown }).fetch = fakeFetch([
      { ok: false, status: 401, json: async () => ({}) },
      ok,
    ]);

    await expect(
      bookAppointment('link-token', input, { signedInOnly: true }),
    ).rejects.toThrow(SIGN_IN_AGAIN_TO_BOOK);

    expect(calls).toHaveLength(1);
    expect(mockClearSession).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when there is no session, or it cannot be read', async () => {
    mockLoadSession.mockResolvedValue(null);
    (global as { fetch?: unknown }).fetch = fakeFetch([ok]);
    await expect(
      bookAppointment('link-token', input, { signedInOnly: true }),
    ).rejects.toThrow(SIGN_IN_AGAIN_TO_BOOK);

    mockLoadSession.mockRejectedValue(new Error('keychain locked'));
    await expect(
      bookAppointment('link-token', input, { signedInOnly: true }),
    ).rejects.toThrow(SIGN_IN_AGAIN_TO_BOOK);

    expect(calls).toHaveLength(0);
  });

  it('does not retry a 403 either, and keeps the session', async () => {
    mockLoadSession.mockResolvedValue({ accessToken: 'live-token' });
    (global as { fetch?: unknown }).fetch = fakeFetch([
      { ok: false, status: 403, json: async () => ({ message: 'This link is not assigned to your account.' }) },
      ok,
    ]);

    await expect(
      bookAppointment('link-token', input, { signedInOnly: true }),
    ).rejects.toThrow('This link is not assigned to your account.');

    expect(calls).toHaveLength(1);
    expect(mockClearSession).not.toHaveBeenCalled();
  });

  it('the message is plain, with no dash', () => {
    expect(SIGN_IN_AGAIN_TO_BOOK).not.toMatch(/[\u2013\u2014]/);
  });

  it('the setup meeting sheet books signed in only', () => {
    const fs = require('fs');
    const path = require('path');
    const source: string = fs.readFileSync(
      path.join(__dirname, '../../ui/hooks/useSetupMeetingSheet.tsx'),
      'utf8',
    );
    expect(source).toMatch(/<BookingSheet[\s\S]*\bsignedInOnly\b[\s\S]*\/>/);
  });
});
