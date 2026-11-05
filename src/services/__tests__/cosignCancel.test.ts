/**
 * Decided 2026-09-26: cancelling a co-sign request
 * swallowed a failed POST and deleted the phone's copy anyway, so the client
 * believed a request withdrawn that was still live at 21st Capital. And a
 * new spend could be built from coins a signed spend already used.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  cancelAllPendingCosigns,
  cancelCosign,
  loadPendingCosigns,
  recordServerStatuses,
  refreshPendingServerStatuses,
  savePendingCosign,
  isCosignRequest,
  type PendingCosign,
} from '../cosign';
import {
  HELD_ALL,
  HELD_SHORT,
  recordHoldsCoins,
  reservedOutpoints,
  reservedSats,
} from '../../wallet/pendingReservations';
import { encodeBase64, PSBT_MAGIC } from '../../bitcoin/psbt/export';

jest.mock('../companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  authHeaders: () => ({ Authorization: 'Bearer t' }),
  loadSession: jest.fn(async () => ({ accessToken: 't' })),
}));

// The pending list is sealed at rest (wallet/sealedStore), whose key lives
// in the Keychain: both stand-ins are the shared in-memory ones.
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

const row = (id: string, over: Partial<PendingCosign> = {}): PendingCosign => ({
  id,
  walletId: 'wallet1',
  originalPsbt: 'PSBT',
  amountSats: 5_000,
  destination: 'bc1qpayee',
  createdAt: 1,
  ...over,
});
const session = { accessToken: 't' } as never;
const realFetch = global.fetch;
const answer = (status: number) => {
  global.fetch = jest.fn(async () => ({ ok: status < 400, status, json: async () => ({}) })) as unknown as typeof fetch;
};

beforeEach(() => (AsyncStorage as unknown as { __clear: () => void }).__clear());
afterAll(() => {
  global.fetch = realFetch;
});

describe('cancelCosign keeps the record until the server has the cancel', () => {
  it('a server error throws and the record stays', async () => {
    await savePendingCosign(row('r1'));
    answer(500);
    await expect(cancelCosign(session, 'r1')).rejects.toThrow('could not be withdrawn');
    expect((await loadPendingCosigns()).map((p) => p.id)).toEqual(['r1']);
  });

  it('no network at all throws and the record stays', async () => {
    await savePendingCosign(row('r1'));
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(cancelCosign(session, 'r1')).rejects.toThrow();
    expect(await loadPendingCosigns()).toHaveLength(1);
  });

  it('success, or a server that never knew it, removes it', async () => {
    await savePendingCosign(row('r1'));
    await savePendingCosign(row('r2'));
    answer(200);
    await cancelCosign(session, 'r1');
    answer(404);
    await cancelCosign(session, 'r2');
    expect(await loadPendingCosigns()).toEqual([]);
  });

  it('sign-out cancels what it can and keeps the rest', async () => {
    await savePendingCosign(row('r1'));
    answer(500);
    await expect(cancelAllPendingCosigns(session)).resolves.toBeUndefined();
    expect(await loadPendingCosigns()).toHaveLength(1);
  });
});

describe('reservedOutpoints', () => {
  const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
  const psbtSpending = (txid: string, vout: number): string => {
    const tx = [
      ...u32(2), 1, ...Array.from({ length: 32 }, (_, i) => parseInt(txid.slice(62 - 2 * i, 64 - 2 * i), 16)),
      ...u32(vout), 0, ...u32(0xfffffffd), 1, ...new Array(8).fill(0), 1, 0x51, ...u32(0),
    ];
    return encodeBase64(Uint8Array.from([...PSBT_MAGIC, 1, 0x00, tx.length, ...tx, 0, 0, 0]));
  };

  it("names the coins of THIS vault's pending signed spends", () => {
    const A = 'aa'.repeat(31) + '01';
    const B = 'bb'.repeat(32);
    const out = reservedOutpoints(
      [
        { walletId: 'w1', originalPsbt: psbtSpending(A, 2) },
        { walletId: 'w1', originalPsbt: psbtSpending(A, 2) },
        { walletId: 'w2', originalPsbt: psbtSpending(B, 0) },
        { walletId: 'w1', originalPsbt: 'not a psbt' },
      ],
      'w1',
    );
    expect(out).toEqual([{ txid: A, vout: 2 }]);
  });

  // Found after that fix: a rejected request kept holding its coins, so a
  // smaller payment right after an over-limit refusal could not be built.
  const A = 'aa'.repeat(32);
  const B = 'bb'.repeat(32);

  it.each(['rejected', 'cancelled', 'completed'])('a %s request holds nothing', (status) => {
    expect(recordHoldsCoins({ walletId: 'w1', originalPsbt: '', serverStatus: status })).toBe(false);
    expect(
      reservedOutpoints([{ walletId: 'w1', originalPsbt: psbtSpending(A, 0), serverStatus: status }], 'w1'),
    ).toEqual([]);
  });

  it.each([undefined, 'pending', 'signed'])('a request 21st Capital may still sign (%s) holds its coins', (status) => {
    expect(
      reservedOutpoints([{ walletId: 'w1', originalPsbt: psbtSpending(A, 0), serverStatus: status }], 'w1'),
    ).toEqual([{ txid: A, vout: 0 }]);
  });

  it('a spend parked for the client\'s own next key holds nothing', () => {
    expect(
      reservedOutpoints([{ walletId: 'w1', originalPsbt: psbtSpending(A, 0), awaiting: 'device' }], 'w1'),
    ).toEqual([]);
  });

  it('the held amount counts only coins the vault still has', () => {
    const utxos = [
      { txid: A, vout: 0, valueSats: 70_000 },
      { txid: B, vout: 1, valueSats: 30_000 },
    ];
    expect(reservedSats([{ txid: A.toUpperCase(), vout: 0 }, { txid: 'cc'.repeat(32), vout: 0 }], utxos)).toBe(70_000);
    expect(reservedSats([], utxos)).toBe(0);
  });

  it('the server status is recorded on the phone and frees the coins', async () => {
    await savePendingCosign(row('r1', { walletId: 'w1', originalPsbt: psbtSpending(A, 0) }));
    await savePendingCosign(row('parked', { walletId: 'w1', originalPsbt: psbtSpending(B, 1), awaiting: 'device' }));
    const held = async () => reservedOutpoints((await loadPendingCosigns()).filter(isCosignRequest), 'w1');
    expect(await held()).toEqual([{ txid: A, vout: 0 }]);
    await recordServerStatuses([{ id: 'r1', status: 'rejected' } as never, { id: 'parked', status: 'signed' } as never]);
    const after = await loadPendingCosigns();
    expect(after.find((p) => p.id === 'r1')?.serverStatus).toBe('rejected');
    // A phone-parked spend has no server status of its own.
    expect(after.find((p) => p.id === 'parked')?.serverStatus).toBeUndefined();
    expect(await held()).toEqual([]);
    // The record itself stays: it still carries the client's signature.
    expect(after.map((p) => p.id).sort()).toEqual(['parked', 'r1']);
  });

  it('refreshing from the server never throws, and records what it hears', async () => {
    await savePendingCosign(row('r2', { walletId: 'w1', originalPsbt: psbtSpending(A, 0), serverStatus: 'pending' }));
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => [{ id: 'r2', status: 'rejected' }] })) as unknown as typeof fetch;
    await refreshPendingServerStatuses();
    expect((await loadPendingCosigns())[0].serverStatus).toBe('rejected');
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(refreshPendingServerStatuses()).resolves.toBeUndefined();
    expect((await loadPendingCosigns())[0].serverStatus).toBe('rejected');
  });

  it('Send takes held coins off the amount and says why in plain words', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const send = fs.readFileSync(path.join(__dirname, '../../ui/screens/SendScreen.tsx'), 'utf8');
    expect(send).toMatch(/\(wallet\?\.cachedBalanceSats \?\? 0\) - heldSats/);
    expect(send).toMatch(/HELD_SHORT/);
    expect(send).toMatch(/HELD_ALL/);
    const panel = fs.readFileSync(path.join(__dirname, '../../ui/components/CosignRequestPanel.tsx'), 'utf8');
    // Both submit paths record the answer they got, so an over-limit
    // request rejected on arrival frees its coins at once.
    expect(panel.match(/serverStatus: (batchRejected|rejectionReason) \? \('rejected' as const\)/g)).toHaveLength(2);
    for (const text of [HELD_ALL, HELD_SHORT]) {
      expect(text).not.toMatch(/[\u2014\u2013]/);
      expect(text).not.toMatch(/\b(inputs?|outputs?|outpoints?|UTXO)\b/i);
    }
  });
});


describe('the cancel dialogs say a signed transaction still exists, in the title', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(path.join(__dirname, '../../ui/screens/PendingCosignScreen.tsx'), 'utf8');
  it('single and session cancel carry it in the title, with no paragraph', () => {
    expect(src).toContain("'Remove this signed transaction? It can still be sent.'");
    expect(src).toContain("'Cancel the session? Signed ones can still be sent.'");
    expect(src).not.toMatch(/could still be sent until/);
    expect(src).toContain("title: 'Could not cancel. Please try again.', message: ''");
  });
});
