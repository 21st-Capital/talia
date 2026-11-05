/**
 * Speed up for a rescue that is still waiting (decided 2026-10-31).
 *
 * A rescue's fee is chosen when it is requested, and on real bitcoin the
 * payment goes out at least one waiting period later, so a choice made then
 * cannot prevent a stuck payment. A rescue that waits can be replaced by the
 * same coins, to the same address, at a higher fee.
 *
 * It is its own route, beside Speed up and Cancel (wallet/replacement.ts),
 * which refuse every path with a wait ('recovery-path'): an everyday payment
 * or an heir's is signed again by the client's own keys, while a rescue is
 * signed again by 21st Capital, after the email link and the codes of a first
 * request, so it needs what a first request needs, not the signing ceremony.
 * It shares that file's arithmetic: the fee floor, the sheet's rows, the rule
 * that a build pays enough and is the same payment.
 *
 * What makes a replacement valid on the rescue path: every coin of the
 * original and no other, one output to the same address, version 2, and each
 * input's nSequence equal to the path's older() value. Any other nSequence
 * either fails the path's check or spends another path, so a build that
 * differs is refused here, before anything is sent to 21st Capital. The
 * server holds a speed-up to the same rules (rescue_binding.check_replacement).
 *
 * No React Native import.
 */
import type { PsbtBuildResult, WalletEngine } from '../bitcoin/engine/types';
import { addressToScriptHex } from '../bitcoin/addressNetwork';
import { txLocksOf } from '../bitcoin/psbt/timelockCheck';
import {
  checkBuiltFee,
  effectiveRate,
  loadReplacementContext,
  minimumRate,
  originalOf,
  ReplacementError,
  replacementBuildFailure,
  replacementProblems,
} from './replacement';
import type { OriginalTx, ReplacementContext } from './replacement';

/** The rescue path a rescue spent: its wait, and the key on it. */
export interface RescuePath {
  olderBlocks: number;
  fingerprint: string;
}

/** Where a rescue that went out stands, as the vault's last sync saw it. */
export type RescueOnChain =
  /** In a block: nothing left to speed up. */
  | { state: 'confirmed' }
  /** Waiting. `orig` is null when it cannot be replaced from this phone. */
  | { state: 'waiting'; orig: OriginalTx | null }
  /** The vault does not list it: not seen yet, or replaced from elsewhere. */
  | { state: 'not-listed' };

/**
 * The original as a speed-up needs it, or null when this is not the rescue
 * filed on this phone: one output, paying the destination the phone recorded,
 * every coin the vault's own and every coin on the rescue path (its older()
 * value in nSequence), and nothing waiting that spends from it.
 *
 * The one output is a recipient whatever chain of the vault it may belong to:
 * a rescue has no change, so it is never read as change.
 */
export function waitingRescueOf(
  ctx: ReplacementContext,
  rule: { destination: string; olderBlocks: number },
): OriginalTx | null {
  const { raw } = ctx;
  if (!raw || raw.outputs.length !== 1 || ctx.hasPendingChild !== false) return null;
  const want = addressToScriptHex(rule.destination);
  if (!want || raw.outputs[0].scriptHex.toLowerCase() !== want.toLowerCase()) return null;
  if (raw.inputs.length === 0 || raw.inputs.some((i) => i.sequence !== rule.olderBlocks)) return null;
  if (ctx.spent.length !== raw.inputs.length || ctx.spent.some((c) => c == null || !c.mine)) return null;
  return originalOf({ ...ctx, changeVouts: [] });
}

/** Read a rescue off the vault. Pass an engine synced just before. */
export async function rescueOnChain(
  engine: WalletEngine,
  txid: string,
  rule: { destination: string; olderBlocks: number },
): Promise<RescueOnChain> {
  const ctx = await loadReplacementContext(engine, txid);
  if (!ctx.tx) return { state: 'not-listed' };
  if (ctx.tx.confirmed) return { state: 'confirmed' };
  return { state: 'waiting', orig: waitingRescueOf(ctx, rule) };
}

export interface RescueSpeedUp {
  built: PsbtBuildResult;
  /** The rate asked for (never under the minimum). */
  rate: number;
  feeSats: number;
  /** What it pays on top of the rescue it replaces. */
  extraSats: number;
  /** What reaches the destination. */
  arrivesSats: number;
}

/**
 * Build the replacement on the rescue path, hold it to the fee floor (a
 * second build with an absolute fee when the rate alone falls short, as
 * `buildReplacement` does) and refuse anything that is not the same rescue.
 *
 * `feeSats` is the fee the sheet showed, built outright. BDK prices a rescue at
 * the largest witness its coins could need, well over what the path's
 * transaction weighs, so a rate alone would pay more than the sheet said.
 *
 * Throws ReplacementError ('insufficient-funds' | 'coins-unavailable' |
 * 'wrong-shape'); any other engine error passes through.
 */
export async function buildRescueSpeedUp(
  engine: Pick<WalletEngine, 'buildRescuePsbt' | 'network'>,
  orig: OriginalTx,
  args: { destination: string; path: RescuePath; chosenRate: number; feeSats?: number },
): Promise<RescueSpeedUp> {
  const rate = effectiveRate(args.chosenRate, minimumRate(orig.feeRate));
  const build = async (feeAbsolute?: number): Promise<PsbtBuildResult> => {
    try {
      return await engine.buildRescuePsbt({
        utxos: orig.coins.map(({ txid, vout }) => ({ txid, vout })),
        destination: args.destination,
        feeRate: rate,
        ...(feeAbsolute != null ? { feeAbsolute } : {}),
        branchFingerprint: args.path.fingerprint,
        replacing: [orig.txid],
      });
    } catch (e) {
      throw replacementBuildFailure(e, orig, 'speedup', rate);
    }
  };

  let built = await build(args.feeSats);
  let check = checkBuiltFee(orig, built, rate);
  if (!check.ok) {
    built = await build(check.requiredFeeSats);
    check = checkBuiltFee(orig, built, rate);
    if (!check.ok) {
      throw new ReplacementError('wrong-shape', 'The rebuilt rescue does not pay the fee it was built with.');
    }
  }
  const problems = replacementProblems(orig, 'speedup', built.psbtBase64, engine.network);
  const locks = txLocksOf(built.psbtBase64);
  if (!locks || locks.version < 2 || locks.sequences.some((s) => s !== args.path.olderBlocks)) {
    problems.push('it does not spend the coins on the rescue path');
  }
  if (problems.length > 0) {
    throw new ReplacementError('wrong-shape', `The rebuilt rescue is not the same rescue: ${problems.join('; ')}.`);
  }
  return {
    built,
    rate,
    feeSats: built.feeSats,
    extraSats: built.feeSats - orig.feeSats,
    arrivesSats: orig.totalInSats - built.feeSats,
  };
}
