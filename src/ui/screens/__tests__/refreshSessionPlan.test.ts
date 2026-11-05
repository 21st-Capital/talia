import { refreshPlan, COSIGN_BATCH_MAX } from '../refreshSessionPlan';

const THEIRS_A = 'aaaa1111';
const THEIRS_B = 'bbbb2222';
const OURS = 'cccc3333';

describe('refreshPlan: the client is never forced through 21st Capital', () => {
  it('a 2-of-3 where they hold two keys can finish alone after the second', () => {
    const afterFirst = refreshPlan({
      finalized: [false, false, false],
      customerFps: [THEIRS_A, THEIRS_B],
      signedFps: [THEIRS_A],
      cosignFp: OURS,
    });
    // Their own key is offered, and co-signing is only ALSO available.
    expect(afterFirst.ownKeysLeft).toEqual([THEIRS_B]);
    expect(afterFirst.canCosign).toBe(true);
    expect(afterFirst.canSend).toBe(false);

    const afterSecond = refreshPlan({
      finalized: [true, true, true],
      customerFps: [THEIRS_A, THEIRS_B],
      signedFps: [THEIRS_A, THEIRS_B],
      cosignFp: OURS,
    });
    expect(afterSecond.canSend).toBe(true);
    expect(afterSecond.stuck).toBe(false);
  });

  it('a vault with NO 21st Capital key still sends itself', () => {
    const plan = refreshPlan({
      finalized: [true, true],
      customerFps: [THEIRS_A],
      signedFps: [THEIRS_A],
      cosignFp: null,
    });
    expect(plan.canSend).toBe(true);
    expect(plan.canCosign).toBe(false);
    expect(plan.stuck).toBe(false);
  });

  it('holding only one of the three keys leaves co-signing as the way on', () => {
    const plan = refreshPlan({
      finalized: [false],
      customerFps: [THEIRS_A],
      signedFps: [THEIRS_A],
      cosignFp: OURS,
    });
    expect(plan.ownKeysLeft).toEqual([]);
    expect(plan.canCosign).toBe(true);
    expect(plan.stuck).toBe(false);
  });

  it('past the one-round co-sign limit, their own key is still offered', () => {
    const many = new Array(COSIGN_BATCH_MAX + 1).fill(false);
    const plan = refreshPlan({
      finalized: many,
      customerFps: [THEIRS_A, THEIRS_B],
      signedFps: [THEIRS_A],
      cosignFp: OURS,
    });
    expect(plan.cosignOverBatchLimit).toBe(true);
    expect(plan.canCosign).toBe(false);
    expect(plan.ownKeysLeft).toEqual([THEIRS_B]);
    expect(plan.stuck).toBe(false);
  });

  // The hole found on 2026-09-18: the everyday 2-of-2, client key
  // plus ours, with more coins than one co-sign round takes. Both ways on are
  // shut at once, which is the state the screen used to render with nothing
  // but Cancel.
  it('one key of theirs, our key, and past the round limit is stuck and must be handled', () => {
    const many = new Array(COSIGN_BATCH_MAX + 1).fill(false);
    const plan = refreshPlan({
      finalized: many,
      customerFps: [THEIRS_A],
      signedFps: [THEIRS_A],
      cosignFp: OURS,
    });
    expect(plan.ownKeysLeft).toEqual([]);
    expect(plan.canCosign).toBe(false);
    expect(plan.cosignOverBatchLimit).toBe(true);
    expect(plan.canSend).toBe(false);
    // Stuck here means the SCREEN owes the client a route, not that they are
    // out of options: the one-at-a-time ceremony still finishes this.
    expect(plan.stuck).toBe(true);
  });

  it('one unfinished leg among many never counts as sendable', () => {
    const plan = refreshPlan({
      finalized: [true, true, false],
      customerFps: [THEIRS_A],
      signedFps: [THEIRS_A],
      cosignFp: null,
    });
    expect(plan.canSend).toBe(false);
    expect(plan.stuck).toBe(true);
  });

  it('only one key, no co-signer and not complete is the one honest dead end', () => {
    const plan = refreshPlan({
      finalized: [false],
      customerFps: [THEIRS_A],
      signedFps: [THEIRS_A],
      cosignFp: null,
    });
    expect(plan.stuck).toBe(true);
  });

  it('a case is matched whatever the case of the fingerprints', () => {
    const plan = refreshPlan({
      finalized: [false],
      customerFps: ['AAAA1111', THEIRS_B],
      signedFps: ['aaaa1111'],
      cosignFp: null,
    });
    expect(plan.ownKeysLeft).toEqual([THEIRS_B]);
  });
});
