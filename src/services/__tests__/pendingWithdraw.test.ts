/**
 * Decided 2026-09-28: a speed-up and a cancel of the same payment could both
 * sit in Pending transactions. Once one went out, the other kept its Send
 * button, and sending it could undo a cancel. The broadcast now withdraws
 * every other version by its unsigned txid: the rows leave the phone at
 * once, and a co-sign request is cancelled at 21st Capital too, so its
 * signed copy cannot come back.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadPendingCosigns, savePendingCosign, withdrawPendingForTxids, type PendingCosign } from '../cosign';

// The pending list is sealed with a Keychain key (decided 2026-09-26).
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));

// The session lives in the Keychain (a native module); a signed-in client here.
jest.mock('../companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  authHeaders: () => ({ Authorization: 'Bearer t' }),
  loadSession: jest.fn(async () => ({ accessToken: 't' })),
}));

jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

const SPEEDUP = 'b'.repeat(64);
const CANCEL = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);

const row = (id: string, txid: string, over: Partial<PendingCosign> = {}): PendingCosign => ({
  id,
  walletId: 'wallet1',
  originalPsbt: 'PSBT',
  amountSats: 5_000_000,
  destination: 'bc1qpayee',
  createdAt: 1,
  txid,
  ...over,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

let calls: string[] = [];
const realFetch = global.fetch;

beforeEach(() => {
  (AsyncStorage as unknown as { __clear: () => void }).__clear();
  calls = [];
  global.fetch = jest.fn(async (url: string) => {
    calls.push(url);
    return { ok: true, json: async () => ({}) };
  }) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

describe('withdrawing the other versions of a payment', () => {
  it('drops their rows and cancels their co-sign requests; every other spend stays', async () => {
    await savePendingCosign(row('req-speedup', SPEEDUP));
    await savePendingCosign(row('partial-other', OTHER, { awaiting: 'device' }));
    await savePendingCosign(row('req-cancel', CANCEL));

    await withdrawPendingForTxids([SPEEDUP.toUpperCase()]);
    // The rows are gone the moment it returns: nothing left to tap Send on.
    expect((await loadPendingCosigns()).map((p) => p.id).sort()).toEqual(['partial-other', 'req-cancel']);

    await flush();
    expect(calls).toEqual(['https://backend.example/api/vaults/cosign/requests/req-speedup/cancel/']);
  });

  it('a phone-parked partial exists only here: dropped, nothing asked of the server', async () => {
    await savePendingCosign(row('partial-speedup', SPEEDUP, { awaiting: 'device' }));
    await withdrawPendingForTxids([SPEEDUP]);
    await flush();
    expect(await loadPendingCosigns()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('nothing to withdraw: nothing changes', async () => {
    await savePendingCosign(row('req-cancel', CANCEL));
    await withdrawPendingForTxids([]);
    await withdrawPendingForTxids([SPEEDUP]);
    await flush();
    expect((await loadPendingCosigns()).map((p) => p.id)).toEqual(['req-cancel']);
    expect(calls).toEqual([]);
  });
});
