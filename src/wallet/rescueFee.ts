/**
 * What a rate pays on a rescue, for the review step (decided 2026-10-31).
 *
 * BDK prices a rescue at the largest witness its coins could need, so the fee
 * is not the rate times the transaction's final size: a rescue set at 10
 * sat/vB paid about 12.2 on chain (2026-10-31, testnet4). The size that counts
 * is the build's own, its fee over its rate. Until a build has answered, each
 * coin counts as the 110 vB the server's fee cap sizes a rescue input at
 * (rescue_binding.py), plus the transaction's shell and one taproot output.
 */
const VBYTES_PER_COIN = 110;
const VBYTES_SHELL = 54;

export function rescueSizeEstimate(coinCount: number): number {
  return VBYTES_SHELL + coinCount * VBYTES_PER_COIN;
}

/** The last build of these coins: its rate, what it paid, and that over its rate. */
export interface RescueFeeBuild {
  rate: number;
  sats: number | null;
  size: number | null;
}

/**
 * The fee at this rate: the build's own figure at the build's rate, because
 * a fee worked back through its size can read a satoshi high. At any other
 * rate, the build's size, else the estimate.
 */
export function rescueFeeAt(rate: number, build: RescueFeeBuild | null, coinCount: number): number {
  if (build?.rate === rate && build.sats != null) return build.sats;
  return Math.ceil(rate * (build?.size ?? rescueSizeEstimate(coinCount)));
}
