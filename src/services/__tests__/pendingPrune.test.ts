import { shouldDropPendingRecord } from '../pendingPrune';

const base = { isCosignRequest: true, createdAt: 1000, windowFull: false, oldestServerTs: 0 };

describe('shouldDropPendingRecord', () => {
  it('KEEPS a rejected request: it still carries the client signature', () => {
    // Decided 2026-09-18: the other key may be at home, days away. Dropping this
    // record would throw away the signature they already gave.
    expect(shouldDropPendingRecord({ ...base, serverStatus: 'rejected' })).toBe(false);
  });

  it('keeps a request still pending or already signed by us', () => {
    expect(shouldDropPendingRecord({ ...base, serverStatus: 'pending' })).toBe(false);
    expect(shouldDropPendingRecord({ ...base, serverStatus: 'signed' })).toBe(false);
  });

  it('drops one that is finished or withdrawn', () => {
    expect(shouldDropPendingRecord({ ...base, serverStatus: 'completed' })).toBe(true);
    expect(shouldDropPendingRecord({ ...base, serverStatus: 'cancelled' })).toBe(true);
  });

  it('never drops a spend parked on the client own device', () => {
    expect(shouldDropPendingRecord({ ...base, isCosignRequest: false })).toBe(false);
    expect(
      shouldDropPendingRecord({ ...base, isCosignRequest: false, serverStatus: undefined }),
    ).toBe(false);
  });

  it('gone from the server means deleted, unless it simply scrolled off', () => {
    expect(shouldDropPendingRecord({ ...base, serverStatus: undefined })).toBe(true);
    expect(
      shouldDropPendingRecord({
        ...base,
        serverStatus: undefined,
        windowFull: true,
        oldestServerTs: 5000,
      }),
    ).toBe(false);
  });
});
