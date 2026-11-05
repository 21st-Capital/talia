/**
 * The rescue request (decided 2026-09-26 and
 * 2026-10-05): the authenticator code goes with it when the account has
 * two-factor, exactly as co-signing sends it, and only then; the server's
 * refusals are handled the way co-signing handles them; rescue mode names
 * the one vault it is on for and when 21st Capital can sign.
 */
import {
  cancelRescue,
  closeRescueMode,
  forgetAfterCancel,
  loadRefusedVaults,
  otherVaultLine,
  parseRescueMode,
  refusedUnder,
  rememberRefusedVault,
  requestLapsed,
  requestOpen,
  rescueRefusal,
  rescueRequestBody,
  sendRescueOtp,
  signableLine,
  submitRescueRequest,
  vaultsWithOpenRequest,
  RESCUE_ALREADY_OPEN_TITLE,
  RESCUE_ALREADY_REPLACED_TITLE,
  RESCUE_FEE_REFUSED_TITLE,
  RESCUE_MODE_ENDED_TITLE,
  RESCUE_NOT_REPLACED_TITLE,
  RESCUE_WRONG_VAULT_TITLE,
} from '../rescue';
import type { RescueRequestInput } from '../rescue';

jest.mock('../companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  authHeaders: () => ({ Authorization: 'Bearer t' }),
  loadSession: jest.fn(async () => ({ accessToken: 't' })),
}));
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

const session = { accessToken: 't' } as never;
const realFetch = global.fetch;
afterAll(() => {
  global.fetch = realFetch;
});

const input = (over: Partial<RescueRequestInput> = {}): RescueRequestInput => ({
  descriptor: 'tr(...)',
  destination: 'bc1qdest',
  amountSats: 50_000,
  vaultLabel: 'Savings',
  requestPsbt: 'cHNidP8=',
  emailOtp: ' 123456 ',
  ...over,
});

/** Answer every fetch with this status and body, and keep what was sent. */
function answer(status: number, body: Record<string, unknown> = {}) {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    sent.push({ url, body: init?.body ? JSON.parse(init.body) : {} });
    return { ok: status < 400, status, json: async () => body };
  }) as unknown as typeof fetch;
  return sent;
}

describe('the request body', () => {
  it('carries no authenticator code when there is none to send', () => {
    const body = rescueRequestBody(input());
    expect(body).not.toHaveProperty('totp');
    expect(body).toEqual({
      descriptor: 'tr(...)',
      destination: 'bc1qdest',
      amount_sats: 50_000,
      vault_label: 'Savings',
      request_psbt: 'cHNidP8=',
      email_otp: '123456',
    });
  });

  it('an empty or blank code is not a code', () => {
    expect(rescueRequestBody(input({ totp: '' }))).not.toHaveProperty('totp');
    expect(rescueRequestBody(input({ totp: '   ' }))).not.toHaveProperty('totp');
  });

  it('carries the authenticator code under co-signing’s name when there is one', () => {
    expect(rescueRequestBody(input({ totp: ' 654321 ' }))).toMatchObject({ totp: '654321', email_otp: '123456' });
  });

  it('is what goes over the wire', async () => {
    const sent = answer(201, { id: 'r1', status: 'pending' });
    await expect(submitRescueRequest(session, input({ totp: '654321' }))).resolves.toEqual({ id: 'r1' });
    expect(sent[0].url).toBe('https://backend.example/api/vaults/rescue/requests/');
    expect(sent[0].body).toMatchObject({ email_otp: '123456', totp: '654321' });

    const without = answer(201, { id: 'r2', status: 'pending' });
    await submitRescueRequest(session, input());
    expect(without[0].body).not.toHaveProperty('totp');
  });
});

describe('a refusal keeps the server’s code', () => {
  it('on the request', async () => {
    answer(400, { error: 'INVALID_TOTP', message: 'That authenticator code is not right.' });
    await expect(submitRescueRequest(session, input({ totp: '000000' }))).rejects.toMatchObject({
      code: 'INVALID_TOTP',
      message: 'That authenticator code is not right.',
    });
  });

  it('on the email, so an ended rescue mode is recognised there too', async () => {
    answer(403, { error: 'RESCUE_MODE_REQUIRED', message: 'Rescue mode isn’t active for your account.' });
    await expect(sendRescueOtp(session)).rejects.toMatchObject({ code: 'RESCUE_MODE_REQUIRED' });
  });
});

describe('what the screen does with a refusal', () => {
  const err = (code: string, message = '') => Object.assign(new Error(message), { code });

  it('asks for the authenticator code when the account has two-factor', () => {
    expect(rescueRefusal(err('TOTP_REQUIRED', 'Enter the code from your authenticator app.'), 'email')).toEqual({
      kind: 'totp',
    });
  });

  it('says a wrong authenticator code under its own field', () => {
    expect(rescueRefusal(err('INVALID_TOTP', 'That authenticator code is not right.'), 'totp')).toEqual({
      kind: 'code',
      step: 'totp',
      message: 'That authenticator code is not right.',
    });
  });

  it('takes a wrong email code back to the email step', () => {
    expect(rescueRefusal(err('INVALID_EMAIL_OTP', 'That email code is wrong or has expired.'), 'totp')).toEqual({
      kind: 'code',
      step: 'email',
      message: 'That email code is wrong or has expired.',
    });
  });

  it('says too many attempts where the client is, as co-signing does', () => {
    const msg = 'Too many wrong codes. Please wait an hour and try again.';
    expect(rescueRefusal(err('TOO_MANY_ATTEMPTS', msg), 'totp')).toEqual({ kind: 'code', step: 'totp', message: msg });
    expect(rescueRefusal(err('TOO_MANY_ATTEMPTS', msg), 'email')).toEqual({ kind: 'code', step: 'email', message: msg });
  });

  it('has words of its own when the server sends none', () => {
    expect(rescueRefusal(err('INVALID_TOTP'), 'totp')).toMatchObject({ message: 'That authenticator code is not right.' });
    expect(rescueRefusal(err('TOO_MANY_ATTEMPTS'), 'email')).toMatchObject({
      message: 'Too many wrong codes. Please wait an hour and try again.',
    });
  });

  it('names the wrong vault and the ended mode in a title of its own', () => {
    expect(rescueRefusal(err('RESCUE_WRONG_VAULT', 'Rescue mode is switched on for a different vault…'), 'totp')).toEqual({
      kind: 'mode',
      title: RESCUE_WRONG_VAULT_TITLE,
      // Remembered for this vault, so it is not offered again (decided 2026-10-05).
      wrongVault: true,
    });
    // Expired, cancelled from the email or closed: the server says the same.
    expect(rescueRefusal(err('RESCUE_MODE_REQUIRED', 'Rescue mode isn’t active…'), 'email')).toEqual({
      kind: 'mode',
      title: RESCUE_MODE_ENDED_TITLE,
      wrongVault: false,
    });
  });

  it('leaves anything else as it was', () => {
    expect(rescueRefusal(err('CONSENT_REQUIRED', 'Open the link in our email first.'), 'email')).toEqual({
      kind: 'other',
      message: 'Open the link in our email first.',
    });
    expect(rescueRefusal(new Error('Your session has expired. Please log in again.'), 'totp')).toEqual({
      kind: 'other',
      message: 'Your session has expired. Please log in again.',
    });
  });

  it('no client-visible text carries an em dash', () => {
    for (const t of [RESCUE_WRONG_VAULT_TITLE, RESCUE_MODE_ENDED_TITLE, otherVaultLine('Savings'), otherVaultLine(null)]) {
      expect(t).not.toMatch(/—/);
    }
    for (const code of ['INVALID_TOTP', 'INVALID_EMAIL_OTP', 'TOO_MANY_ATTEMPTS']) {
      const r = rescueRefusal(err(code), 'totp');
      expect(r.kind === 'code' && r.message).not.toMatch(/—/);
    }
  });
});

describe('GET rescue/mode/', () => {
  const active = {
    status: 'active',
    booking_url: 'https://book.example/abc',
    booking_token: 'abc',
    vault: { account: 1042, network: 'mainnet', label: 'Vault 2' },
    activated_at: '2026-10-05T10:00:00+00:00',
    signable_after: '2026-10-07T10:00:00+00:00',
    expires_at: '2026-10-12T10:00:00+00:00',
    signable_now: false,
  };

  it('names the vault and the times while active', () => {
    expect(parseRescueMode(active)).toEqual({
      status: 'active',
      bookingUrl: 'https://book.example/abc',
      bookingToken: 'abc',
      vault: { account: 1042, network: 'mainnet', label: 'Vault 2' },
      activatedAt: '2026-10-05T10:00:00+00:00',
      signableAfter: '2026-10-07T10:00:00+00:00',
      expiresAt: '2026-10-12T10:00:00+00:00',
      signableNow: false,
    });
  });

  it('names nothing when not active', () => {
    for (const status of ['none', 'scheduled']) {
      const m = parseRescueMode({ ...active, status });
      expect(m).toMatchObject({ status, vault: null, signableAfter: null, expiresAt: null, signableNow: false });
    }
  });

  it('an unknown status is none, and an older server simply names no vault', () => {
    expect(parseRescueMode({ status: 'weird' }).status).toBe('none');
    expect(parseRescueMode({ status: 'active' })).toMatchObject({ status: 'active', vault: null, signableAfter: null });
  });
});

describe('the one line on when 21st Capital can sign', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const when = () => '7 Oct, 12:00';
  const mode = { status: 'active' as const, signableAfter: '2026-10-07T10:00:00+00:00', signableNow: false };

  it('says when, while the 48 hours run', () => {
    expect(signableLine(mode, now, when)).toBe('21st Capital can sign from 7 Oct, 12:00.');
  });

  it('says nothing once it can, or when nothing is known', () => {
    expect(signableLine({ ...mode, signableNow: true }, now, when)).toBeNull();
    expect(signableLine(mode, Date.parse('2026-10-08T00:00:00Z'), when)).toBeNull();
    expect(signableLine({ ...mode, status: 'none' }, now, when)).toBeNull();
    expect(signableLine({ ...mode, signableAfter: null }, now, when)).toBeNull();
    expect(signableLine(null, now, when)).toBeNull();
  });
});

describe('a vault the server refused under this rescue mode (decided 2026-10-05)', () => {
  const A = '2026-10-05T10:00:00Z';
  const B = '2026-10-09T10:00:00Z';

  it('is remembered for that activation only', async () => {
    const kept = await rememberRefusedVault('w1', A);
    expect(refusedUnder(kept, 'w1', A)).toBe(true);
    expect(refusedUnder(kept, 'w2', A)).toBe(false);
    // A new activation may be for this very vault.
    expect(refusedUnder(kept, 'w1', B)).toBe(false);
    expect(refusedUnder(kept, 'w1', null)).toBe(false);
    expect(await loadRefusedVaults()).toEqual([{ walletId: 'w1', activatedAt: A }]);
  });

  it('keeps every vault refused under the same activation, and drops older activations', async () => {
    await rememberRefusedVault('w1', A);
    const same = await rememberRefusedVault('w2', A);
    expect(same).toEqual([
      { walletId: 'w1', activatedAt: A },
      { walletId: 'w2', activatedAt: A },
    ]);
    const next = await rememberRefusedVault('w3', B);
    expect(next).toEqual([{ walletId: 'w3', activatedAt: B }]);
    expect(await loadRefusedVaults()).toEqual(next);
  });

  it('says which vault rescue mode is on for, by name when there is one', () => {
    expect(otherVaultLine('Savings')).toBe('Rescue mode is on for Savings');
    expect(otherVaultLine(null)).toBe(RESCUE_WRONG_VAULT_TITLE);
  });
});

describe('withdrawing a request, and forgetting it on this phone (decided 2026-10-05)', () => {
  it('reports the server’s status once withdrawn', async () => {
    const sent = answer(200, { status: 'cancelled' });
    expect(await cancelRescue(session, '42')).toBe('cancelled');
    expect(sent[0].url).toBe('https://backend.example/api/vaults/rescue/requests/42/cancel/');
    answer(200, { status: 'rejected' });
    expect(await cancelRescue(session, '42')).toBe('rejected');
  });

  it('reports a request signed meanwhile (409 ALREADY_SIGNED)', async () => {
    answer(409, { error: 'ALREADY_SIGNED', message: 'This rescue was already signed…', status: 'signed' });
    expect(await cancelRescue(session, '42')).toBe('signed');
    answer(409, { error: 'ALREADY_SIGNED', status: 'completed' });
    expect(await cancelRescue(session, '42')).toBe('completed');
  });

  it('tells a request the server does not have from one it could not ask about', async () => {
    answer(404, { error: 'NOT_FOUND' });
    expect(await cancelRescue(session, '42')).toBe('not_found');
    answer(500, {});
    expect(await cancelRescue(session, '42')).toBeNull();
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await cancelRescue(session, '42')).toBeNull();
  });

  it('forgets it only when the server says nothing will be signed', () => {
    expect(forgetAfterCancel('cancelled')).toBe(true);
    expect(forgetAfterCancel('rejected')).toBe(true);
    // Signed meanwhile: the record holds what the signed rescue is checked
    // against before it goes out (decided 2026-09-26).
    expect(forgetAfterCancel('signed')).toBe(false);
    expect(forgetAfterCancel('completed')).toBe(false);
    expect(forgetAfterCancel('pending')).toBe(false);
    // Not asked: the refresh decides, from the server's own list.
    expect(forgetAfterCancel('not_found')).toBe(false);
    expect(forgetAfterCancel(null)).toBe(false);
  });
});

describe('the phone switching rescue mode off', () => {
  it('says whether the server took it, so the screen never assumes', async () => {
    answer(200, { status: 'closed' });
    expect(await closeRescueMode(session)).toBe(true);
    answer(500, {});
    expect(await closeRescueMode(session)).toBe(false);
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await closeRescueMode(session)).toBe(false);
  });
});

describe('a fee the server will not take (decided 2026-10-31)', () => {
  it.each(['FEE_NOT_SANE', 'REPLACEMENT_FEE_NOT_HIGHER'])('%s is a plain title, never the server’s sentence', (code) => {
    expect(rescueRefusal({ code, message: 'A paragraph for another reader.' }, 'email')).toEqual({
      kind: 'fee',
      title: RESCUE_FEE_REFUSED_TITLE,
    });
  });

  it('the title holds whatever the reason: over the cap, or a fee it cannot read', () => {
    expect(RESCUE_FEE_REFUSED_TITLE).toBe('21st Capital cannot accept this fee');
  });
});

describe('a speed-up (decided 2026-10-31)', () => {
  it('names the rescue it replaces in the request, and an ordinary request names none', () => {
    expect(rescueRequestBody(input({ replaces: 'r1' })).replaces).toBe('r1');
    expect('replaces' in rescueRequestBody(input())).toBe(false);
  });

  it('asks for the email link by the rescue it replaces', async () => {
    const bodies: string[] = [];
    global.fetch = jest.fn(async (_: string, init: { body: string }) => {
      bodies.push(init.body);
      return { ok: true, status: 200, json: async () => ({ sent: true }) };
    }) as unknown as typeof fetch;
    await sendRescueOtp(session, 'r1');
    await sendRescueOtp(session);
    expect(bodies).toEqual(['{"replaces":"r1"}', '{}']);
  });

  it.each([
    ['RESCUE_ALREADY_REPLACED', RESCUE_ALREADY_REPLACED_TITLE],
    ['RESCUE_NOT_REPLACEABLE', RESCUE_NOT_REPLACED_TITLE],
    ['REPLACEMENT_DIFFERENT_COINS', RESCUE_NOT_REPLACED_TITLE],
    ['REPLACEMENT_DIFFERENT_DESTINATION', RESCUE_NOT_REPLACED_TITLE],
    ['REPLACEMENT_SEQUENCE_CHANGED', RESCUE_NOT_REPLACED_TITLE],
  ])('%s is a plain title', (code, title) => {
    expect(rescueRefusal({ code, message: 'A paragraph.' }, 'totp')).toEqual({ kind: 'speed-up', title });
  });
});

describe('one rescue per vault at a time (decided 2026-11-04)', () => {
  const active = { status: 'active' as const };
  const ended = { status: 'none' as const };
  const req = (status: string | undefined, extra: Record<string, unknown> = {}) => ({
    walletId: 'v1',
    pending: extra.replaces ? { replaces: { id: 'r0', txid: 't', coins: [] } } : {},
    server: status ? ({ status, ...extra } as never) : undefined,
  });

  it('the server refusing a second request is a title of its own', () => {
    expect(rescueRefusal({ code: 'RESCUE_ALREADY_OPEN', message: 'words for an older app' }, 'email')).toEqual({
      kind: 'open',
      title: RESCUE_ALREADY_OPEN_TITLE,
    });
    expect(RESCUE_ALREADY_OPEN_TITLE).toBe('This vault already has a rescue request');
    expect(RESCUE_ALREADY_OPEN_TITLE).not.toMatch(/—/);
  });

  it('waiting and signed requests are open; cancelled, rejected and completed are not', () => {
    expect(requestOpen(req('pending'), active)).toBe(true);
    expect(requestOpen(req('signed', { signed_tx: '02ab' }), active)).toBe(true);
    expect(requestOpen(req('signed', { signed_tx: '02ab' }), ended)).toBe(true);
    // Its transaction no longer held (14 days after signing): nothing can send it.
    expect(requestOpen(req('signed', { signed_tx: '' }), active)).toBe(false);
    // Rescue mode on again for its vault: switched on after the signature,
    // which takes it out of the way. On for another vault: it still stands.
    expect(requestOpen(req('signed', { signed_tx: '02ab' }), active, true)).toBe(false);
    expect(requestOpen(req('signed', { signed_tx: '02ab' }), active, false)).toBe(true);
    expect(requestOpen(req('signed', { signed_tx: '02ab' }), ended, true)).toBe(true);
    // A waiting request is not released that way.
    expect(requestOpen(req('pending'), active, true)).toBe(true);
    for (const st of ['cancelled', 'rejected', 'completed']) expect(requestOpen(req(st), active)).toBe(false);
  });

  it('a waiting request whose rescue mode ended is not, on the server’s word alone', () => {
    expect(requestLapsed(req('pending'), ended)).toBe(true);
    expect(requestOpen(req('pending'), ended)).toBe(false);
    // The mode could not be asked: still open.
    expect(requestLapsed(req('pending'), null)).toBe(false);
    expect(requestOpen(req('pending'), null)).toBe(true);
  });

  it('a waiting speed-up goes by the server’s still_open, whatever the mode reads', () => {
    expect(requestOpen(req('pending', { replaces: true, still_open: true }), ended)).toBe(true);
    expect(requestOpen(req('pending', { replaces: true, still_open: false }), active)).toBe(false);
  });

  it('a record the server could not be asked about counts as open', () => {
    expect(requestOpen(req(undefined), active)).toBe(true);
  });

  it('names the vaults that have one', () => {
    const list = [
      { ...req('pending'), walletId: 'a' },
      { ...req('cancelled'), walletId: 'b' },
      { ...req('signed', { signed_tx: '02ab' }), walletId: 'c' },
      { ...req('rejected'), walletId: 'd' },
    ];
    expect([...vaultsWithOpenRequest(list, active)].sort()).toEqual(['a', 'c']);
    expect(vaultsWithOpenRequest([], active).size).toBe(0);
  });
});
