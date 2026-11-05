/**
 * What a refresh session can do next, as a pure function.
 *
 * The product rule it encodes (decided 2026-09-18): Talia is self-custodial, so a
 * client whose own keys can still satisfy the policy must always be able to
 * finish alone. Co-signing is one way on, never the automatic next step and
 * never the only one. This lives outside the screen so it can be tested: the
 * rule is too important to leave to a reading of JSX.
 */

/** The server takes at most this many co-sign requests in one code round. */
export const COSIGN_BATCH_MAX = 50;

export interface RefreshPlanInput {
  /** One entry per coin: has BDK said this transaction can be broadcast? */
  finalized: boolean[];
  /** Every key on the path that belongs to the client, lowercase. */
  customerFps: readonly string[];
  /** Which of those have already signed in this session. */
  signedFps: readonly string[];
  /** 21st Capital's key on this path, or null when the vault holds none. */
  cosignFp: string | null;
}

export interface RefreshPlan {
  /** Every transaction is complete: the client can send, with nobody else. */
  canSend: boolean;
  /** Keys of the client's own that have not signed yet. */
  ownKeysLeft: string[];
  /** Co-signing is available as an OPTION. */
  canCosign: boolean;
  /** There is a co-signer, but this batch is past the one-round limit. */
  cosignOverBatchLimit: boolean;
  /** Nothing left to try on this phone: no own key, no co-sign. */
  stuck: boolean;
}

export function refreshPlan(input: RefreshPlanInput): RefreshPlan {
  const { finalized, customerFps, signedFps, cosignFp } = input;
  const canSend = finalized.length > 0 && finalized.every(Boolean);
  const signed = new Set(signedFps.map((f) => f.toLowerCase()));
  const ownKeysLeft = customerFps.map((f) => f.toLowerCase()).filter((f) => !signed.has(f));
  const overLimit = cosignFp != null && finalized.length > COSIGN_BATCH_MAX;
  const canCosign = cosignFp != null && !overLimit;
  return {
    canSend,
    ownKeysLeft,
    canCosign,
    cosignOverBatchLimit: overLimit,
    // Complete work is never stuck, whatever else is true.
    stuck: !canSend && ownKeysLeft.length === 0 && !canCosign,
  };
}
