/**
 * Speed up and Cancel for a payment that is still waiting (decided 2026-09-28,
 * design Option A). Everything the screens need short of drawing them: can
 * this transaction be replaced, what did it pay, what is the least the
 * network will take for a replacement, the requests to build, and the
 * figures each row of the fee sheet shows.
 *
 * HOW A REPLACEMENT IS BUILT (route B, no native rebuild). Never BDK's
 * BumpFeeTxBuilder: it has no policy path, so on a layered vault it fails
 * with SpendingPolicyRequired. The ordinary `engine.buildPsbt` is used with
 * EVERY coin the original spent (`utxos`, which the engine adds as the only
 * coins allowed), so no other coin is ever pulled in:
 *   - Speed up: the same recipients with the same amounts; BDK sends the
 *     change, smaller by the extra fee, to a fresh change address. A payment
 *     with no change (a send-all) is rebuilt as a send-all to the same
 *     recipient, so the extra fee comes out of the payment and the sheet says
 *     "Recipient receives {new} instead of {old}" (decided 2026-09-28).
 *   - Cancel: all the coins, drained to a fresh CHANGE address of the vault.
 *
 * BDK DOES NOT ENFORCE BIP-125 ON THIS ROUTE, so Talia does:
 *   new rate  >= max(chosen tier, old rate + 1 sat/vB)
 *   new fee   >= old fee + 1 sat/vB x the replacement's size
 * The first holds by the rate the build asks for (`minimumRate`); the
 * second is checked on the BUILT transaction (`checkBuiltFee`) and, where the
 * rate alone falls short (a cancel is smaller than the payment it replaces,
 * so at a higher rate it can still pay less in total), the build is repeated
 * with an absolute fee.
 *
 * Which transactions (all must hold, else a reason code for the "cannot"
 * state): outgoing, unconfirmed, signals replaceability (an input's
 * nSequence below 0xFFFFFFFE), every coin it spent is the vault's own,
 * spent on the EVERYDAY path (every nSequence 0xFFFFFFFD; a path with a
 * wait carries its wait there instead, and cancelling a recovery spend
 * would relock the coins for the whole wait; decided 2026-09-28), and no waiting
 * transaction of the vault spends one of its outputs (the network would
 * throw that one away with it). A rescue has its own route, because only 21st
 * Capital can sign it again: wallet/rescueReplacement.ts.
 *
 * The change is told apart by listUtxos: an output of the original that is a
 * coin of the vault's CHANGE chain (keychain 'internal'). A payment to one
 * of the vault's own receive addresses is a recipient like any other.
 *
 * Pure except `loadReplacementContext` and `buildReplacement`, which talk
 * to the engine through its interface only. No React Native import.
 */
import type {
  BuildPsbtRequest,
  PsbtBuildResult,
  Recipient,
  WalletEngine,
  WalletTx,
} from '../bitcoin/engine/types';
import type { Network } from '../bitcoin/descriptor/types';
import { parseRawTransaction } from '../bitcoin/rawTx';
import type { RawTxInfo } from '../bitcoin/rawTx';
import { buildUnsignedPsbt } from '../bitcoin/psbt/build';
import { classifyEngineError, engineErrorFacts, isCodedEngineError } from '../bitcoin/engine/engineError';
import { decodeBase64, PSBT_MAGIC } from '../bitcoin/psbt/export';
import { Reader, parseTx, readMap, scriptToAddress } from '../bitcoin/psbt/parse';
import { MAX_FEE_RATE } from './feeEstimates';
import type { FeePresets } from './feeEstimates';
import { TIER_ETA } from './txEta';
import type { ReplacementKind, TxReplacement } from './txReplacementLogic';

// ---------------------------------------------------------------- constants

/** Below this an input signals that its transaction can be replaced (BIP-125). */
export const FINAL_SEQUENCE_NO_RBF = 0xfffffffe;
/** What BDK writes on the everyday path with replacement on. */
export const EVERYDAY_SEQUENCE = 0xfffffffd;
/** A replacement pays at least this much more per vB than the original (decided). */
export const MIN_RATE_STEP = 1;
/** And at least this much per vB of its own size on top of the old fee (decided). */
export const INCREMENTAL_RELAY_RATE = 1;
/**
 * Room per coin in the size the fee floor is measured on. A replacement's
 * signatures are a byte or two longer or shorter than the original's
 * (ECDSA), and falling one satoshi short gets it refused at broadcast,
 * after the whole signing ceremony.
 */
export const SIZE_MARGIN_VB_PER_COIN = 1;

// ---------------------------------------------------------------- gathering

/** A coin the original spent, read from the transaction that created it. */
export interface SpentCoin {
  txid: string;
  vout: number;
  valueSats: number;
  address: string | null;
  scriptLength: number;
  /** The vault's own coin (BDK isMine on its address). */
  mine: boolean;
}

/** Everything the decisions below read, gathered once per page. */
export interface ReplacementContext {
  txid: string;
  /** BDK's view of the transaction; null when the vault no longer lists it. */
  tx: WalletTx | null;
  /** The transaction itself; null when its bytes are unavailable. */
  raw: RawTxInfo | null;
  /** Per input of `raw`, in order: the coin it spent; null when unknown to this vault. */
  spent: Array<SpentCoin | null>;
  /** Outputs of `raw` that are coins of the vault's change chain. */
  changeVouts: number[];
  /** Outputs of `raw` that are coins of the vault's receive chain. */
  ownReceiveVouts: number[];
  /**
   * A waiting transaction of this vault spends one of `raw`'s outputs. Null
   * when a waiting transaction of the vault could not be read, so a child
   * cannot be ruled out (the verdict then offers nothing).
   */
  hasPendingChild: boolean | null;
}

/**
 * Read the transaction, the coins it spent, which of its outputs are the
 * vault's change, and whether anything waiting spends from it. Never
 * throws; what it cannot read comes back empty and the verdict says so.
 * Sync first when the answer must be current (a tap on Speed up).
 */
export async function loadReplacementContext(
  engine: WalletEngine,
  txid: string,
): Promise<ReplacementContext> {
  const ctx: ReplacementContext = {
    txid,
    tx: null,
    raw: null,
    spent: [],
    changeVouts: [],
    ownReceiveVouts: [],
    hasPendingChild: false,
  };
  let txs: WalletTx[] = [];
  try {
    txs = await engine.listTransactions();
    ctx.tx = txs.find((t) => t.txid === txid) ?? null;
    const bytes = await engine.getRawTx(txid);
    ctx.raw = bytes ? parseRawTransaction(bytes, engine.network) : null;
  } catch {
    return ctx;
  }
  const { tx, raw } = ctx;
  // Nothing more to learn about a received or a confirmed transaction.
  if (!tx || !raw || tx.confirmed || tx.sent <= 0) return ctx;

  ctx.spent = await Promise.all(
    raw.inputs.map(async (inp): Promise<SpentCoin | null> => {
      try {
        const prevBytes = await engine.getRawTx(inp.txid);
        if (!prevBytes) return null;
        const out = parseRawTransaction(prevBytes, engine.network).outputs[inp.vout];
        if (!out) return null;
        const mine = out.address ? await engine.ownsAddress(out.address) : false;
        return {
          txid: inp.txid,
          vout: inp.vout,
          valueSats: out.valueSats,
          address: out.address,
          scriptLength: out.scriptLength,
          mine,
        };
      } catch {
        return null;
      }
    }),
  );

  try {
    const utxos = await engine.listUtxos();
    for (const u of utxos) {
      if (u.txid !== txid) continue;
      if (u.keychain === 'internal') ctx.changeVouts.push(u.vout);
      else ctx.ownReceiveVouts.push(u.vout);
    }
  } catch {
    // no change known: every output counts as a recipient
  }

  ctx.hasPendingChild = await findPendingChild(engine, txid, txs);
  return ctx;
}

/**
 * Does a waiting transaction of this vault spend one of `txid`'s outputs?
 * True when one does, false when none does, and null when a waiting
 * transaction could not be read: a child cannot be ruled out then, so the
 * caller fails closed (the network would throw the child away with the
 * original). `txs` is the vault's list as the engine has it. Never throws.
 */
export async function findPendingChild(
  engine: WalletEngine,
  txid: string,
  txs: WalletTx[],
): Promise<boolean | null> {
  const id = txid.toLowerCase();
  let answer: boolean | null = false;
  for (const other of txs) {
    if (other.confirmed || other.txid.toLowerCase() === id) continue;
    try {
      const bytes = await engine.getRawTx(other.txid);
      if (!bytes) {
        answer = null;
        continue;
      }
      if (parseRawTransaction(bytes, engine.network).inputs.some((i) => i.txid.toLowerCase() === id)) return true;
    } catch {
      answer = null;
    }
  }
  return answer;
}

/**
 * Just before a replacement of `oldTxid` is broadcast: does a waiting
 * transaction of the vault spend from it NOW? The sheet asked when it
 * opened, but a co-signed replacement can wait hours, and Send may since
 * have paid someone from the original's change; the replacement would throw
 * that payment away without a word (decided 2026-09-28). False when the
 * original is confirmed or gone (nothing waiting can go with it, and the
 * broadcast's own answer says what happened), null when it cannot be told.
 * Pass an engine synced just before. Never throws.
 */
export async function pendingChildNow(engine: WalletEngine, oldTxid: string): Promise<boolean | null> {
  // An engine that has not synced this launch lists nothing, so "the original
  // is not there" would read as "nothing waits on it" and let the replacement
  // out unchecked. It cannot be told yet (decided 2026-09-28): fail closed.
  if (engine.getTipHeight() == null) return null;
  let txs: WalletTx[];
  try {
    txs = await engine.listTransactions();
  } catch {
    return null;
  }
  const id = oldTxid.toLowerCase();
  const orig = txs.find((t) => t.txid.toLowerCase() === id);
  if (!orig || orig.confirmed) return false;
  return findPendingChild(engine, id, txs);
}

// ---------------------------------------------------------------- eligibility

/** Why a transaction offers neither Speed up nor Cancel. */
export type CannotReplace =
  /** Money in: there is nothing of the vault's to replace. */
  | 'incoming'
  /** Already in a block ("Already confirmed"). */
  | 'confirmed'
  /** Talia already replaced it; the page shows "Replaced" / "Cancelled". */
  | 'replaced'
  /** The transaction or its coins cannot be read right now. */
  | 'missing-data'
  /** Sent without the option to replace it ("Cannot be sped up or cancelled"). */
  | 'not-signalled'
  /** It spends a coin that is not this vault's (e.g. a joint payment). */
  | 'foreign-coins'
  /** Spent through a path with a wait (an heir's or the rescue key's; decided 2026-09-28). */
  | 'recovery-path'
  /** A waiting transaction spends from it; replacing it would throw that one away. */
  | 'has-child'
  /** It pays a script with no address, which Talia cannot pay again. */
  | 'unreadable';

/** Why Speed up alone is not offered. */
export type NoSpeedUp =
  /** Several recipients and no change: the extra fee has nowhere to come from. */
  'batch-without-change';

/** Why Cancel alone is not offered. */
export type NoCancel =
  /** It already pays a cancelled payment back (no cancel of a cancel). */
  | 'is-return'
  /** Every output is the vault's own: nothing leaves, nothing to cancel. */
  | 'self-transfer';

export interface ReplacementEligibility {
  /** Null when the transaction can be replaced at all. */
  cannot: CannotReplace | null;
  speedUp: boolean;
  noSpeedUp?: NoSpeedUp;
  cancel: boolean;
  noCancel?: NoCancel;
}

/** Some input signals BIP-125 replaceability. */
export function signalsReplaceable(raw: RawTxInfo): boolean {
  return raw.inputs.some((i) => i.sequence < FINAL_SEQUENCE_NO_RBF);
}

/** Every input was spent on the everyday path (nSequence 0xFFFFFFFD). */
export function spentOnEverydayPath(raw: RawTxInfo): boolean {
  return raw.inputs.length > 0 && raw.inputs.every((i) => i.sequence === EVERYDAY_SEQUENCE);
}

/**
 * Can this transaction be sped up, cancelled, both, or neither (and why).
 *
 * @param opts.replacedBy  Talia's record says it was already replaced
 *                         (`replacedBy` in txReplacementLogic)
 * @param opts.isReturn    it pays a cancelled payment back (`isReturn`)
 */
export function replacementEligibility(
  ctx: ReplacementContext,
  opts: { replacedBy?: string | null; isReturn?: boolean } = {},
): ReplacementEligibility {
  const no = (cannot: CannotReplace): ReplacementEligibility => ({ cannot, speedUp: false, cancel: false });
  const { tx, raw } = ctx;
  if (tx && tx.sent <= 0) return no('incoming');
  if (tx?.confirmed) return no('confirmed');
  if (opts.replacedBy) return no('replaced');
  if (!tx || !raw) return no('missing-data');
  if (!signalsReplaceable(raw)) return no('not-signalled');
  if (ctx.spent.length !== raw.inputs.length) return no('missing-data');
  if (ctx.spent.some((c) => c == null || !c.mine)) {
    // BDK's `sent` is the total of the vault's OWN coins this spends. When
    // the coins read as the vault's add up to less, a coin that could not
    // be read (or checked) is the vault's own: say nothing rather than
    // blame coins that are not this vault's.
    const ownIn = ctx.spent.reduce((sum, c) => sum + (c?.mine ? c.valueSats : 0), 0);
    return no(ownIn < tx.sent ? 'missing-data' : 'foreign-coins');
  }
  if (!spentOnEverydayPath(raw)) return no('recovery-path');
  if (ctx.hasPendingChild === true) return no('has-child');
  // A waiting transaction it could not read may spend from this one.
  if (ctx.hasPendingChild == null) return no('missing-data');

  const change = new Set(ctx.changeVouts);
  const own = new Set([...ctx.changeVouts, ...ctx.ownReceiveVouts]);
  const recipients = raw.outputs.filter((_, i) => !change.has(i));
  if (recipients.some((o) => !o.address)) return no('unreadable');

  const out: ReplacementEligibility = { cannot: null, speedUp: true, cancel: true };
  if (change.size === 0 && recipients.length > 1) {
    out.speedUp = false;
    out.noSpeedUp = 'batch-without-change';
  }
  if (opts.isReturn) {
    out.cancel = false;
    out.noCancel = 'is-return';
  } else if (raw.outputs.every((_, i) => own.has(i))) {
    out.cancel = false;
    out.noCancel = 'self-transfer';
  }
  return out;
}

// ---------------------------------------------------------------- the original

export interface OriginalOutput {
  vout: number;
  address: string | null;
  valueSats: number;
  scriptLength: number;
  /** A coin of the vault's change chain. */
  change: boolean;
}

/** The original, as the fee floor and the requests need it. */
export interface OriginalTx {
  txid: string;
  /** Every coin it spent: the replacement spends exactly these. */
  coins: Array<{ txid: string; vout: number; valueSats: number }>;
  outputs: OriginalOutput[];
  totalInSats: number;
  /** What it pays the network: coins in minus outputs. */
  feeSats: number;
  /** Its REAL size (from its own bytes) and weight. */
  vsize: number;
  weight: number;
  /** feeSats / vsize. */
  feeRate: number;
  /** Its outputs that are not change: the payment, same addresses and amounts. */
  recipients: Recipient[];
  /** What those recipients receive together. */
  paymentSats: number;
  changeSats: number;
  /** Script size of one of the vault's own outputs (its change, else a coin it spent). */
  ownScriptLength: number;
}

/** The original's figures; null unless every coin it spent is known. */
export function originalOf(ctx: ReplacementContext): OriginalTx | null {
  const { raw } = ctx;
  if (!raw || ctx.spent.length !== raw.inputs.length || ctx.spent.some((c) => c == null)) return null;
  const spent = ctx.spent as SpentCoin[];
  const change = new Set(ctx.changeVouts);
  const outputs: OriginalOutput[] = raw.outputs.map((o, vout) => ({
    vout,
    address: o.address,
    valueSats: o.valueSats,
    scriptLength: o.scriptLength,
    change: change.has(vout),
  }));
  const totalInSats = spent.reduce((s, c) => s + c.valueSats, 0);
  const totalOut = outputs.reduce((s, o) => s + o.valueSats, 0);
  const feeSats = totalInSats - totalOut;
  if (feeSats < 0) return null;
  const recipients = outputs
    .filter((o) => !o.change && o.address)
    .map((o) => ({ address: o.address as string, amountSats: o.valueSats }));
  const ownScriptLength =
    outputs.find((o) => o.change)?.scriptLength ?? spent[0]?.scriptLength ?? 34;
  return {
    txid: ctx.txid,
    coins: spent.map((c) => ({ txid: c.txid, vout: c.vout, valueSats: c.valueSats })),
    outputs,
    totalInSats,
    feeSats,
    vsize: raw.vsize,
    weight: raw.weight,
    feeRate: raw.vsize > 0 ? feeSats / raw.vsize : 0,
    recipients,
    paymentSats: recipients.reduce((s, r) => s + r.amountSats, 0),
    changeSats: outputs.filter((o) => o.change).reduce((s, o) => s + o.valueSats, 0),
    ownScriptLength,
  };
}

/**
 * The fee rate the transaction pays, for the ETA line: from its coins when
 * they are known, else BDK's fee. Null when neither is known.
 */
export function feeRateOf(ctx: ReplacementContext): number | null {
  const orig = originalOf(ctx);
  if (orig) return orig.feeRate;
  const fee = ctx.tx?.fee;
  if (ctx.raw && fee != null && ctx.raw.vsize > 0) return fee / ctx.raw.vsize;
  return null;
}

// ---------------------------------------------------------------- the fee floor

/**
 * Round a rate UP to the precision the app shows it in (formatFeeRate: one
 * decimal under 10 sat/vB, whole above), so the minimum a client reads is
 * the minimum Talia enforces and typing exactly it is accepted.
 */
export function roundRateUp(rate: number): number {
  if (!Number.isFinite(rate)) return rate;
  if (rate >= 10) return Math.ceil(rate - 1e-6);
  return Math.ceil(rate * 10 - 1e-6) / 10;
}

/** The least a replacement may pay per vB: the old rate plus one, as the app shows it. */
export function minimumRate(oldFeeRate: number): number {
  return roundRateUp(oldFeeRate + MIN_RATE_STEP);
}

/** The rate a replacement is built at: the chosen one, never under the minimum. */
export function effectiveRate(chosenRate: number, minRate: number): number {
  return Number.isFinite(chosenRate) ? Math.max(chosenRate, minRate) : minRate;
}

/** The least a replacement of this size may pay in total. */
export function feeFloor(oldFeeSats: number, newVsize: number, coinCount = 0): number {
  return oldFeeSats + Math.ceil(INCREMENTAL_RELAY_RATE * (newVsize + coinCount * SIZE_MARGIN_VB_PER_COIN));
}

/** Serialized size of an output list: the count, then value + script per output. */
function outputsBytes(scriptLengths: number[]): number {
  const varintLen = (n: number) => (n < 0xfd ? 1 : n <= 0xffff ? 3 : 5);
  return (
    varintLen(scriptLengths.length) +
    scriptLengths.reduce((s, len) => s + 8 + varintLen(len) + len, 0)
  );
}

/**
 * The replacement's size: the original's REAL weight (same coins, same path,
 * so the same signatures) with its outputs swapped for the new ones.
 */
export function replacementVsize(orig: Pick<OriginalTx, 'weight' | 'outputs'>, newScriptLengths: number[]): number {
  const delta = outputsBytes(newScriptLengths) - outputsBytes(orig.outputs.map((o) => o.scriptLength));
  return Math.ceil((orig.weight + 4 * delta) / 4);
}

/** What a replacement of this size pays at this rate, the floor included. */
export function replacementFee(orig: OriginalTx, vsize: number, rate: number): number {
  return Math.max(Math.ceil(rate * vsize), feeFloor(orig.feeSats, vsize, orig.coins.length));
}

/** The smallest output the network relays for a script of this size (Core's dust at 3 sat/vB). */
export function dustFor(scriptLength: number): number {
  if (scriptLength === 22) return 294; // P2WPKH
  if (scriptLength === 34) return 330; // P2WSH, P2TR
  if (scriptLength === 23) return 540; // P2SH
  return 546; // P2PKH and anything else
}

// ---------------------------------------------------------------- speed up

/** How a speed-up is rebuilt. */
export type SpeedUpShape =
  /** Same recipients, the change pays the extra fee. */
  | 'change'
  /** No change: a send-all to the same recipient, which receives less (decided 2026-09-28). */
  | 'send-all'
  /** Nothing leaves the vault (a refresh, a return): everything to one own address. */
  | 'self';

export function speedUpShape(orig: OriginalTx): SpeedUpShape | null {
  const changeOutputs = orig.outputs.filter((o) => o.change);
  if (orig.recipients.length === 0) return 'self';
  if (changeOutputs.length > 0) return 'change';
  return orig.recipients.length === 1 ? 'send-all' : null;
}

/** The script sizes of the speed-up's outputs, before it is built. */
function speedUpScripts(orig: OriginalTx, shape: SpeedUpShape): number[] {
  if (shape === 'self') return [orig.ownScriptLength];
  const recipients = orig.outputs.filter((o) => !o.change).map((o) => o.scriptLength);
  return shape === 'change' ? [...recipients, orig.ownScriptLength] : recipients;
}

export interface SpeedUpFigures {
  shape: SpeedUpShape;
  rate: number;
  vsize: number;
  /** The replacement's whole fee. */
  feeSats: number;
  /** What it costs on top of the original's fee (the sheet's "+ {sats}"). */
  extraSats: number;
  /** What the recipient receives: unchanged, or less on a send-all. */
  recipientSats: number;
  /** False when the change (or the payment) cannot carry the extra fee. */
  affordable: boolean;
}

/** A speed-up at `rate` (already at or over the minimum), before it is built. */
export function speedUpFigures(orig: OriginalTx, rate: number): SpeedUpFigures | null {
  const shape = speedUpShape(orig);
  if (!shape) return null;
  let vsize = replacementVsize(orig, speedUpScripts(orig, shape));
  let feeSats = replacementFee(orig, vsize, rate);
  let recipientSats = orig.paymentSats;
  let affordable = true;
  if (shape === 'change') {
    const left = orig.changeSats - (feeSats - orig.feeSats);
    if (left < dustFor(orig.ownScriptLength)) {
      // The change is too small to keep: BDK gives it to the network, and
      // the transaction is one output smaller.
      const noChange = replacementVsize(orig, speedUpScripts(orig, 'send-all'));
      const all = orig.totalInSats - orig.paymentSats;
      affordable = all >= replacementFee(orig, noChange, rate);
      vsize = noChange;
      feeSats = Math.max(all, replacementFee(orig, noChange, rate));
    }
  } else {
    recipientSats = orig.totalInSats - feeSats;
    const script = shape === 'self' ? orig.ownScriptLength : orig.outputs.find((o) => !o.change)!.scriptLength;
    affordable = recipientSats >= dustFor(script);
  }
  return {
    shape,
    rate,
    vsize,
    feeSats,
    extraSats: feeSats - orig.feeSats,
    recipientSats: Math.max(0, recipientSats),
    affordable,
  };
}

/**
 * The speed-up's build request. A send-all drains to the same recipient; a
 * refresh or a return (the 'self' shape) drains back to the original's own
 * output address, which keeps it the same payment.
 */
export function speedUpRequest(orig: OriginalTx, rate: number, feeAbsolute?: number): BuildPsbtRequest {
  const shape = speedUpShape(orig);
  if (!shape) throw new ReplacementError('not-eligible', 'This payment has no change to pay a higher fee from.');
  const utxos = orig.coins.map(({ txid, vout }) => ({ txid, vout }));
  const base = {
    utxos,
    feeRate: rate,
    ...(feeAbsolute != null ? { feeAbsolute } : {}),
    // The waiting payment whose coins these are (BuildPsbtRequest.replacing).
    replacing: [orig.txid],
  };
  if (shape === 'change') return { ...base, recipients: orig.recipients.map((r) => ({ ...r })) };
  const to =
    shape === 'send-all'
      ? orig.recipients[0].address
      : (orig.outputs.find((o) => o.address)?.address as string);
  return { ...base, recipients: [{ address: to, amountSats: 0 }], drain: true };
}

// ---------------------------------------------------------------- cancel

export interface CancelFigures {
  rate: number;
  vsize: number;
  /** The cancel's whole fee (the sheet's right column). */
  feeSats: number;
  /** The payment's amount: what the sheet says comes back (decided 2026-09-28). */
  paymentSats: number;
  /** Every coin back, less the fee: what the return actually holds. */
  returnedSats: number;
  affordable: boolean;
}

/** A cancel at `rate` (already at or over the minimum), before it is built. */
export function cancelFigures(orig: OriginalTx, rate: number): CancelFigures {
  const vsize = replacementVsize(orig, [orig.ownScriptLength]);
  const feeSats = replacementFee(orig, vsize, rate);
  const returnedSats = orig.totalInSats - feeSats;
  return {
    rate,
    vsize,
    feeSats,
    paymentSats: orig.paymentSats,
    returnedSats: Math.max(0, returnedSats),
    affordable: returnedSats >= dustFor(orig.ownScriptLength),
  };
}

/** The cancel's build request: every coin, drained to a fresh change address. */
export function cancelRequest(
  orig: OriginalTx,
  drainAddress: string,
  rate: number,
  feeAbsolute?: number,
): BuildPsbtRequest {
  return {
    utxos: orig.coins.map(({ txid, vout }) => ({ txid, vout })),
    recipients: [{ address: drainAddress, amountSats: 0 }],
    drain: true,
    feeRate: rate,
    ...(feeAbsolute != null ? { feeAbsolute } : {}),
    // The waiting payment whose coins these are (BuildPsbtRequest.replacing).
    replacing: [orig.txid],
  };
}

// ---------------------------------------------------------------- the sheet

export type TierKey = 'fast' | 'medium' | 'slow';
export const TIER_KEYS: TierKey[] = ['fast', 'medium', 'slow'];
export const TIER_LABELS: Record<TierKey, string> = { fast: 'High', medium: 'Medium', slow: 'Slow' };

export interface ReplacementRow {
  key: TierKey | 'custom';
  /** "High", "Medium", "Slow", "Custom". */
  label: string;
  /** The tier's own phrase ("about 30 minutes"); null for Custom. */
  eta: string | null;
  /** The tier's own rate (what the row shows). */
  rate: number;
  /** At or under the minimum: drawn muted, "Below the current fee". */
  belowMinimum: boolean;
  /** The rate the replacement would be built at: never under the minimum. */
  buildRate: number;
  /** The replacement's whole fee at `buildRate`. */
  feeSats: number;
  /** The fee on top of the original's. */
  extraSats: number;
  /** The row's right column: the extra fee for a speed-up, the whole fee for a cancel. */
  costSats: number;
  /** A send-all speed-up: what the recipient receives instead. Otherwise the payment. */
  recipientSats: number;
  /** A cancel: every coin back, less the fee. */
  returnedSats?: number;
  /** False when the coins cannot carry this fee ("Not enough left for a higher fee"). */
  affordable: boolean;
}

function rowFor(
  orig: OriginalTx,
  kind: ReplacementKind,
  key: TierKey | 'custom',
  rate: number,
): ReplacementRow | null {
  const minRate = minimumRate(orig.feeRate);
  const buildRate = effectiveRate(rate, minRate);
  const base = {
    key,
    label: key === 'custom' ? 'Custom' : TIER_LABELS[key],
    eta: key === 'custom' ? null : TIER_ETA[key],
    rate,
    // The design mutes a tier AT or under the minimum. A typed rate is only
    // ever a row once it is at least the minimum (customReplacementRow).
    belowMinimum: key !== 'custom' && rate <= minRate,
    buildRate,
  };
  if (kind === 'cancel') {
    const f = cancelFigures(orig, buildRate);
    return {
      ...base,
      feeSats: f.feeSats,
      extraSats: f.feeSats - orig.feeSats,
      costSats: f.feeSats,
      recipientSats: orig.paymentSats,
      returnedSats: f.returnedSats,
      affordable: f.affordable,
    };
  }
  const f = speedUpFigures(orig, buildRate);
  if (!f) return null;
  return {
    ...base,
    feeSats: f.feeSats,
    extraSats: f.extraSats,
    costSats: f.extraSats,
    recipientSats: f.recipientSats,
    affordable: f.affordable,
  };
}

/**
 * The High, Medium and Slow rows of the Speed up / Cancel sheet. A tier AT
 * or under the minimum is marked `belowMinimum` (the design mutes it);
 * its figures are at the minimum, which is what choosing it would build.
 */
export function replacementRows(
  orig: OriginalTx,
  kind: ReplacementKind,
  presets: Pick<FeePresets, TierKey>,
): ReplacementRow[] {
  return TIER_KEYS.map((k) => rowFor(orig, kind, k, presets[k])).filter((r): r is ReplacementRow => r != null);
}

/** The Custom row for a typed rate; null while the rate cannot be used (see `customRateProblem`). */
export function customReplacementRow(
  orig: OriginalTx,
  kind: ReplacementKind,
  rate: number,
): ReplacementRow | null {
  if (customRateProblem(rate, minimumRate(orig.feeRate)) != null) return null;
  return rowFor(orig, kind, 'custom', rate);
}

/** Why a typed rate cannot be used: not a number, under the minimum, or over MAX_FEE_RATE. */
export function customRateProblem(
  rate: number,
  minRate: number,
): 'invalid' | 'below-minimum' | 'too-high' | null {
  if (!Number.isFinite(rate) || rate <= 0) return 'invalid';
  if (rate < minRate) return 'below-minimum';
  if (rate > MAX_FEE_RATE) return 'too-high';
  return null;
}

// ---------------------------------------------------------------- after the build

/** The coins and outputs of a PSBT's unsigned transaction. */
export function unsignedTxOf(
  psbtBase64: string,
): { ins: Array<{ txid: string; vout: number }>; outs: Array<{ amountSats: number; script: Uint8Array }> } | null {
  try {
    const bytes = decodeBase64(psbtBase64);
    if (!bytes || bytes.length < 5 || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) return null;
    const entry = readMap(new Reader(bytes, PSBT_MAGIC.length)).find((e) => e.keyType === 0x00);
    return entry ? parseTx(new Reader(entry.value)) : null;
  } catch {
    return null;
  }
}

export interface BuiltFeeCheck {
  ok: boolean;
  /** The size the floor was measured on. */
  newVsize: number;
  /** The least this replacement may pay; rebuild with it as `feeAbsolute` when `ok` is false. */
  requiredFeeSats: number;
}

/**
 * Does a BUILT replacement pay enough? BIP-125 wants the old fee plus
 * 1 sat/vB of the replacement's own size; BDK does not check it here.
 * The size is the original's real one with the built transaction's outputs
 * (or, when the PSBT cannot be read, the size BDK's fee implies).
 */
export function checkBuiltFee(
  orig: OriginalTx,
  built: Pick<PsbtBuildResult, 'feeSats' | 'psbtBase64'>,
  rate: number,
): BuiltFeeCheck {
  const tx = unsignedTxOf(built.psbtBase64);
  const newVsize = tx
    ? replacementVsize(orig, tx.outs.map((o) => o.script.length))
    : Math.ceil(built.feeSats / Math.max(rate, 1e-9));
  const requiredFeeSats = Math.max(
    feeFloor(orig.feeSats, newVsize, orig.coins.length),
    Math.ceil(rate * newVsize),
  );
  return { ok: built.feeSats >= requiredFeeSats, newVsize, requiredFeeSats };
}

/**
 * What is wrong with a built replacement, if anything: it must spend exactly
 * the original's coins, and pay what the kind promises (a speed-up the same
 * recipients, a send-all the same one recipient, a cancel one output to the
 * vault's own address). Empty when it is right.
 */
export function replacementProblems(
  orig: OriginalTx,
  kind: ReplacementKind,
  psbtBase64: string,
  network: Network,
  drainAddress?: string,
): string[] {
  const tx = unsignedTxOf(psbtBase64);
  if (!tx) return ['the rebuilt payment cannot be read'];
  const problems: string[] = [];
  const key = (t: string, v: number) => `${t}:${v}`;
  const want = new Set(orig.coins.map((c) => key(c.txid, c.vout)));
  const got = tx.ins.map((i) => key(i.txid, i.vout));
  if (got.length !== want.size || !got.every((k) => want.has(k))) {
    problems.push('it does not spend exactly the coins of the original');
  }
  const outs = tx.outs.map((o) => ({ address: scriptToAddress(o.script, network), amountSats: o.amountSats }));
  if (kind === 'cancel') {
    if (outs.length !== 1 || (drainAddress != null && outs[0].address !== drainAddress)) {
      problems.push('a cancel must pay everything to one address of this vault');
    }
    return problems;
  }
  const shape = speedUpShape(orig);
  if (shape === 'change') {
    const left = [...outs];
    for (const r of orig.recipients) {
      const i = left.findIndex((o) => o.address === r.address && o.amountSats === r.amountSats);
      if (i < 0) {
        problems.push('it does not pay every recipient the same amount');
        break;
      }
      left.splice(i, 1);
    }
    if (left.length > 1) problems.push('it pays someone new');
  } else if (shape === 'send-all') {
    if (outs.length !== 1 || outs[0].address !== orig.recipients[0].address) {
      problems.push('it does not pay the same recipient');
    }
  } else if (shape === 'self') {
    if (outs.length !== 1) problems.push('it must pay one address of this vault');
  } else {
    problems.push('this payment cannot be sped up');
  }
  return problems;
}

// ---------------------------------------------------------------- building

export type ReplacementErrorCode =
  /** The coins cannot carry the fee: "Not enough left for a higher fee". */
  | 'insufficient-funds'
  /** Not a transaction this can replace (see `replacementEligibility`). */
  | 'not-eligible'
  /** BDK built something other than the replacement asked for. Never sign it. */
  | 'wrong-shape'
  /**
   * BDK counted NONE of the original's coins ("0 sat available") although
   * they plainly cover the fee: the engine would not spend coins a waiting
   * transaction already spends. An open risk since 2026-07-19; never
   * shown as a lack of funds, which it is not. The coded engine says the
   * same plainly, UNKNOWN_UTXO.
   */
  | 'coins-unavailable';

export class ReplacementError extends Error {
  readonly code: ReplacementErrorCode;
  constructor(code: ReplacementErrorCode, message: string) {
    super(message);
    this.name = 'ReplacementError';
    this.code = code;
  }
}

/** BDK's "not enough" family: too little to pay the fee, or an output left
 *  as dust. Read as a code (bitcoin/engine/engineError.ts), which for 0.28
 *  is `/insufficient/i` or `/dust/i` on the message, as it always was. */
export function isInsufficientFunds(e: unknown): boolean {
  const code = classifyEngineError(e);
  return code === 'INSUFFICIENT_FUNDS' || code === 'OUTPUT_BELOW_DUST';
}

/**
 * Name a failed build in the page's terms. BDK says "Insufficient funds:
 * N sat available of M sat needed"; when N is 0 while the original's own
 * coins cover this fee with room to spare, the coins were never counted,
 * which is not a lack of funds.
 *
 * A coded engine refuses such a coin outright (`UNKNOWN_UTXO`, the new
 * library's UnknownUtxo): that is the same 'coins-unavailable'.
 * Only a CODED error reads that way; 0.28's own "UTXO not found" text
 * passed through as it always had, so the old engine was unchanged while it
 * shipped (until the old engine's removal, decided 2026-11-04).
 */
export function replacementBuildFailure(
  e: unknown,
  orig: OriginalTx,
  kind: ReplacementKind,
  rate: number,
): unknown {
  if (isCodedEngineError(e) && classifyEngineError(e) === 'UNKNOWN_UTXO') {
    return new ReplacementError('coins-unavailable', 'Talia could not use the coins of this payment.');
  }
  if (!isInsufficientFunds(e)) return e;
  // "N sat available", read off 0.28's message or carried by a coded error.
  const available = engineErrorFacts(e).availableSats;
  const plenty =
    kind === 'cancel'
      ? cancelFigures(orig, rate).returnedSats >= 2 * dustFor(orig.ownScriptLength)
      : speedUpFigures(orig, rate)?.affordable === true;
  if (available === 0 && plenty) {
    return new ReplacementError('coins-unavailable', 'Talia could not use the coins of this payment.');
  }
  return new ReplacementError('insufficient-funds', 'Not enough left for a higher fee.');
}

export interface ReplacementBuild {
  kind: ReplacementKind;
  built: PsbtBuildResult;
  request: BuildPsbtRequest;
  /** The rate asked for (never under the minimum). */
  rate: number;
  oldFeeSats: number;
  feeSats: number;
  extraSats: number;
  newVsize: number;
  /** True when the rate fell short of the floor and the fee was set outright. */
  usedAbsoluteFee: boolean;
  /** Where a cancel pays everything (a fresh change address). */
  drainAddress?: string;
  /** Speed up: what the recipient receives (less than before on a send-all). */
  recipientSats: number;
  /** Cancel: every coin back, less the fee. */
  returnedSats?: number;
  /**
   * What the replacement takes out of the vault, its fee included: the
   * recipients and the fee, or the fee alone when every coin stays (a
   * cancel, a refresh, a return).
   */
  sentSats: number;
}

/**
 * Build the replacement, check it against the floor, rebuild with an
 * absolute fee when it falls short, and refuse anything that is not the
 * replacement asked for. The result goes to the signing ceremony.
 *
 * Throws ReplacementError ('insufficient-funds' | 'coins-unavailable' |
 * 'not-eligible' | 'wrong-shape'); any other engine error passes through.
 */
export async function buildReplacement(
  engine: WalletEngine,
  orig: OriginalTx,
  kind: ReplacementKind,
  chosenRate: number,
  opts: { drainAddress?: string } = {},
): Promise<ReplacementBuild> {
  const rate = effectiveRate(chosenRate, minimumRate(orig.feeRate));
  if (kind === 'speedup' && !speedUpShape(orig)) {
    throw new ReplacementError('not-eligible', 'This payment has no change to pay a higher fee from.');
  }
  const drainAddress =
    kind === 'cancel' ? opts.drainAddress ?? (await engine.getInternalAddress('new')).address : undefined;
  const requestAt = (feeAbsolute?: number): BuildPsbtRequest =>
    kind === 'cancel'
      ? cancelRequest(orig, drainAddress as string, rate, feeAbsolute)
      : speedUpRequest(orig, rate, feeAbsolute);
  const build = async (request: BuildPsbtRequest): Promise<PsbtBuildResult> => {
    try {
      return await buildUnsignedPsbt(engine, request);
    } catch (e) {
      throw replacementBuildFailure(e, orig, kind, rate);
    }
  };

  let request = requestAt();
  let built = await build(request);
  let check = checkBuiltFee(orig, built, rate);
  let usedAbsoluteFee = false;
  if (!check.ok) {
    request = requestAt(check.requiredFeeSats);
    built = await build(request);
    usedAbsoluteFee = true;
    check = checkBuiltFee(orig, built, rate);
    if (!check.ok) {
      throw new ReplacementError('wrong-shape', 'The rebuilt payment does not pay the fee it was built with.');
    }
  }
  const problems = replacementProblems(orig, kind, built.psbtBase64, engine.network, drainAddress);
  const tx = unsignedTxOf(built.psbtBase64);
  // Whatever is not a recipient must come back to this vault: the new
  // change, a cancel's return, a refresh's one output. What comes back is
  // counted on the way, recipients included (a payment to one of the
  // vault's own receive addresses never leaves it), for `sentSats`.
  let ownOutSats: number | null = null;
  if (problems.length === 0 && tx) {
    ownOutSats = 0;
    const recipients = kind === 'speedup' && speedUpShape(orig) !== 'self' ? [...orig.recipients] : [];
    for (const o of tx.outs) {
      const address = scriptToAddress(o.script, engine.network);
      const mine = !!address && (await engine.ownsAddress(address));
      if (mine) ownOutSats += o.amountSats;
      const i = recipients.findIndex(
        (r) => r.address === address && (r.amountSats === o.amountSats || speedUpShape(orig) === 'send-all'),
      );
      if (i >= 0) {
        recipients.splice(i, 1);
        continue;
      }
      if (!mine) {
        problems.push('part of it neither reaches the recipient nor comes back to this vault');
        break;
      }
    }
  }
  if (problems.length > 0) {
    throw new ReplacementError('wrong-shape', `The rebuilt payment is not the same payment: ${problems.join('; ')}.`);
  }

  const totalOut = tx ? tx.outs.reduce((s, o) => s + o.amountSats, 0) : orig.totalInSats - built.feeSats;
  const shape = kind === 'speedup' ? speedUpShape(orig) : null;
  const recipientSats = shape === 'send-all' || shape === 'self' ? totalOut : orig.paymentSats;
  return {
    kind,
    built,
    request,
    rate,
    oldFeeSats: orig.feeSats,
    feeSats: built.feeSats,
    extraSats: built.feeSats - orig.feeSats,
    newVsize: check.newVsize,
    usedAbsoluteFee,
    drainAddress,
    recipientSats,
    returnedSats: kind === 'cancel' ? totalOut : undefined,
    sentSats:
      ownOutSats != null
        ? orig.totalInSats - ownOutSats
        : kind === 'cancel' || shape === 'self'
          ? built.feeSats
          : recipientSats + built.feeSats,
  };
}

// ---------------------------------------------------------------- after the broadcast

/**
 * Why a replacement's broadcast failed, in the terms the page speaks:
 * 'already-confirmed' (the original, or another version, is in a block:
 * show "Already confirmed" or "The cancel came too late" after a sync),
 * 'fee-too-low' (the network wants more), or 'other' (show the plain
 * failure). Read from the server's refusal; the next sync is the truth.
 */
export function replacementBroadcastFailure(e: unknown): 'already-confirmed' | 'fee-too-low' | 'other' {
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  if (/missingorspent|missing[- ]?inputs|inputs[- ]?missing|already spent|bad-txns-inputs/.test(msg)) {
    return 'already-confirmed';
  }
  if (/insufficient fee|not enough additional fees|min relay fee|mempool min fee|fee not met|rejecting replacement/.test(msg)) {
    return 'fee-too-low';
  }
  return 'other';
}

/** The record to save once the replacement is broadcast (`saveTxReplacement`). */
export function replacementRecord(
  walletId: string,
  orig: OriginalTx,
  kind: ReplacementKind,
  newTxid: string,
  newFeeSats: number,
  note?: string,
  newSentSats?: number,
): Omit<TxReplacement, 'at'> {
  return {
    walletId,
    oldTxid: orig.txid,
    newTxid,
    kind,
    recipient: orig.recipients[0]?.address ?? null,
    amount: orig.paymentSats,
    ...(note?.trim() ? { note: note.trim() } : {}),
    oldFeeSats: orig.feeSats,
    newFeeSats,
    ...(newSentSats != null ? { newSentSats } : {}),
  };
}
