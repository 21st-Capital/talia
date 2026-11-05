/**
 * Found in a phone test (2026-07-29): one payment, two rows — "Waiting for 21st Capital…" and
 * "Signed 1/2 — needs your next key" — and after the money was sent the second
 * one stayed behind forever.
 *
 * The merge rule has one property that is easy to get wrong and expensive when
 * it is: THE CO-SIGN RECORD MUST WIN. Its id is the one the backend knows.
 * Lose it and the "co-signed — ready to send" button never appears, Discard
 * leaves the request live on our side, and the vault banner disappears — so
 * "last writer wins" would turn a cosmetic duplicate into a stuck payment.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadPendingCosigns,
  savePendingCosign,
  removePendingCosignsForTxid,
  isCosignRequest,
  type PendingCosign,
} from '../cosign';

// cosign.ts pulls in companyAuth, which imports the Keychain native module.
// Jest runs in node here (no native modules), so it has to be stubbed — nothing in
// these tests touches it.
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));

// The repo has no AsyncStorage mock either, so give it one.
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

const TXID = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const parked = (over: Partial<PendingCosign> = {}): PendingCosign => ({
  id: 'partial-wallet1-1700000000000',
  walletId: 'wallet1',
  originalPsbt: 'PSBT-with-one-signature',
  amountSats: 14752,
  destination: 'bc1qsaj6q7u6zgsh',
  createdAt: 1,
  awaiting: 'device',
  signatures: 1,
  signaturesNeeded: 2,
  txid: TXID,
  ...over,
});

const request = (over: Partial<PendingCosign> = {}): PendingCosign => ({
  id: '550e8400-e29b-41d4-a716-446655440000', // the server's uuid
  walletId: 'wallet1',
  originalPsbt: 'PSBT-with-one-signature',
  amountSats: 14752,
  destination: 'bc1qsaj6q7u6zgsh',
  createdAt: 2,
  txid: TXID,
  ...over,
});

beforeEach(() => {
  (AsyncStorage as unknown as { __clear: () => void }).__clear();
});

describe('one spend, one row', () => {
  it("the reported order: park a partial, then request the co-signature", async () => {
    await savePendingCosign(parked());
    await savePendingCosign(request());
    const all = await loadPendingCosigns();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(request().id);
    expect(isCosignRequest(all[0])).toBe(true);
  });

  it('the REVERSE order still keeps the server record', async () => {
    // Request the co-signature, then re-enter from Send and sign another key.
    await savePendingCosign(request());
    await savePendingCosign(parked({ originalPsbt: 'PSBT-with-two-signatures', signatures: 2 }));
    const all = await loadPendingCosigns();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(request().id);
    // …and the fresher signing progress is carried across, not thrown away.
    expect(all[0].originalPsbt).toBe('PSBT-with-two-signatures');
    expect(all[0].signatures).toBe(2);
  });

  it('does NOT merge two different spends', async () => {
    await savePendingCosign(parked());
    await savePendingCosign(request({ id: 'other-uuid', txid: OTHER }));
    expect(await loadPendingCosigns()).toHaveLength(2);
  });

  it('leaves records with no txid alone', async () => {
    // Written by an older build. Undefined must mean "no opinion", never a
    // match — or two unrelated payments would collapse into one.
    await savePendingCosign(parked({ txid: undefined, id: 'old-1' }));
    await savePendingCosign(parked({ txid: undefined, id: 'old-2' }));
    expect(await loadPendingCosigns()).toHaveLength(2);
  });

  it('updating the same id in place does not duplicate', async () => {
    await savePendingCosign(request());
    await savePendingCosign(request({ originalPsbt: 'updated' }));
    const all = await loadPendingCosigns();
    expect(all).toHaveLength(1);
    expect(all[0].originalPsbt).toBe('updated');
  });
});

describe('clearing once it is sent', () => {
  it('removes every record for the spend, not just the one that sent it', async () => {
    await savePendingCosign(parked({ id: 'p1' }));
    await savePendingCosign(request({ id: 'r1', txid: OTHER })); // unrelated
    await removePendingCosignsForTxid(TXID);
    const all = await loadPendingCosigns();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('r1');
  });

  it('an empty txid is a no-op rather than a purge', async () => {
    await savePendingCosign(request());
    await removePendingCosignsForTxid('');
    expect(await loadPendingCosigns()).toHaveLength(1);
  });
});
