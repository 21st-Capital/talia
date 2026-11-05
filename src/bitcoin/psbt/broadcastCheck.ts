/**
 * What a transaction returned from OUTSIDE the app must prove before Talia
 * broadcasts it (decided 2026-09-26).
 *
 * A signer (QR, file) or 21st Capital's rescue hands back bytes. The screen
 * showed the spend the client REVIEWED, and "Send" broadcast whatever came
 * back: an older signed payment left on an SD card, or another request's
 * rescue, went out while the screen named the one the client approved.
 *
 * Two rules, both pure:
 *  - A transaction answering a PSBT the app built must BE that transaction:
 *    same txid as the unsigned one (inputs, outputs, amounts, locktime).
 *  - A rescue signed by 21st Capital must spend only this vault's coins and
 *    pay only the destination the client typed when filing it (kept on the
 *    phone, never the server's copy) or this vault's own addresses; when the
 *    request carried a PSBT, it must be that very transaction.
 * Plus one guard for every broadcast of bytes the app did not build: a fee
 * that is out of all proportion is refused unless the client confirms it.
 */
import { decodeBase64, PSBT_MAGIC } from './export';
import { parsePsbt, parseTx, readMap, Reader, unsignedTxid } from './parse';
import { parseRawTransaction } from '../rawTx';
import { MAX_FEE_RATE } from './build';
import type { Network } from '../descriptor/types';

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** A transaction reduced to what the checks compare. */
export interface TxShape {
  txid: string;
  /** The txid as the transaction stood unsigned (scriptSigs empty): what
   *  matching a returned transaction to its PSBT compares. Equals `txid`
   *  for a PSBT and for segwit and taproot spends. */
  unsignedTxid: string;
  inputs: Array<{ txid: string; vout: number }>;
  outputs: Array<{ scriptHex: string; valueSats: number }>;
  /** Virtual size when known (a finished transaction), for the fee rate. */
  vsize?: number;
}

/** Shape of a raw, finished transaction; null when it cannot be read. */
export function rawTxShape(bytes: Uint8Array, network: Network): TxShape | null {
  try {
    const info = parseRawTransaction(bytes, network);
    return {
      txid: info.txid,
      unsignedTxid: info.unsignedTxid,
      inputs: info.inputs.map((i) => ({ txid: i.txid, vout: i.vout })),
      outputs: info.outputs.map((o) => ({ scriptHex: o.scriptHex, valueSats: o.valueSats })),
      vsize: info.vsize,
    };
  } catch {
    return null;
  }
}

/** Shape of a PSBT's unsigned transaction; null when it cannot be read. */
export function psbtTxShape(base64: string): TxShape | null {
  try {
    const bytes = decodeBase64(base64);
    if (!bytes || bytes.length < 5 || !PSBT_MAGIC.every((b, i) => bytes[i] === b)) return null;
    const r = new Reader(bytes, PSBT_MAGIC.length);
    const txEntry = readMap(r).find((e) => e.keyType === 0x00);
    const txid = unsignedTxid(base64);
    if (!txEntry || !txid) return null;
    const tx = parseTx(new Reader(txEntry.value));
    return {
      txid,
      unsignedTxid: txid,
      inputs: tx.ins,
      outputs: tx.outs.map((o) => ({ scriptHex: toHex(o.script), valueSats: o.amountSats })),
    };
  } catch {
    return null;
  }
}

/**
 * Is this raw transaction the one this PSBT describes? Compared by the
 * unsigned txid (scriptSigs emptied), which covers every input and its
 * sequence, every output and amount, the version and the locktime, but not
 * the signatures: a nested-segwit or legacy input carries its signature in
 * the scriptSig, which would change the plain txid of a correct answer.
 */
export function rawTxMatchesTxid(raw: Uint8Array, expectedTxid: string, network: Network): boolean {
  const shape = rawTxShape(raw, network);
  return (
    !!shape && !!expectedTxid && shape.unsignedTxid.toLowerCase() === expectedTxid.toLowerCase()
  );
}

export function rawTxMatchesPsbt(raw: Uint8Array, psbtBase64: string, network: Network): boolean {
  const want = unsignedTxid(psbtBase64);
  return !!want && rawTxMatchesTxid(raw, want, network);
}

/** Why a returned transaction may not go out. */
export type BroadcastRefusal =
  | { code: 'unreadable' }
  | { code: 'different-tx' }
  | { code: 'foreign-coins' }
  | { code: 'wrong-destination'; scripts: string[] }
  | { code: 'unconfirmed-destination'; scripts: string[] }
  | { code: 'high-fee'; feeSats: number };

export interface RescueExpectation {
  /** The destination's scriptPubKey (hex), from the phone's own record of
   *  the filed request. Absent on requests filed before it was recorded. */
  destinationScriptHex?: string;
  /** The unsigned txid of the request PSBT the app sent, when it sent one. */
  requestTxid?: string;
  /** Scripts the client has explicitly confirmed on screen (legacy records
   *  with no stored destination). */
  confirmedScripts?: string[];
  /** The client confirmed an unusually high fee. */
  acceptHighFee?: boolean;
  /**
   * A speed-up: the coins of the waiting rescue it replaces, as this phone
   * read them when it filed the speed-up. That rescue has spent them, so the
   * vault no longer lists them. They count as the vault's only for the very
   * transaction this phone prepared (`requestTxid`).
   */
  replacedCoins?: Array<{ txid: string; vout: number; valueSats: number }>;
}

export interface WalletFacts {
  /** Every coin of this vault, `txid:vout` lowercase, with its value. */
  ownCoins: Map<string, number>;
  /** Output scripts (hex) this vault owns, as BDK says. */
  ownScripts: Set<string>;
}

const outpointKey = (i: { txid: string; vout: number }) => `${i.txid.toLowerCase()}:${i.vout}`;

/**
 * A fee Talia will not send without the client's word: above the rate
 * ceiling, or over 100 000 sats AND over a tenth of what the coins hold.
 * Deliberately generous: a guard against a broken or hostile source, never
 * a second opinion on a normal busy-network fee.
 */
export function feeLooksAbsurd(feeSats: number, inputSats: number, vsize?: number): boolean {
  if (!Number.isFinite(feeSats) || feeSats <= 0) return false;
  if (vsize && vsize > 0 && feeSats / vsize > MAX_FEE_RATE) return true;
  return feeSats > 100_000 && feeSats > inputSats / 10;
}

/**
 * The fee of a PSBT when it is out of all proportion (`feeLooksAbsurd`),
 * else null: the one question every broadcast of a signed spend asks
 * before it goes out (decided 2026-09-26). Null too when the fee
 * cannot be known (an input without its amount).
 */
export function psbtAbsurdFee(psbtBase64: string): number | null {
  try {
    const p = parsePsbt(psbtBase64, 'bitcoin');
    if (p.feeSats == null || p.totalInSats == null) return null;
    return feeLooksAbsurd(p.feeSats, p.totalInSats) ? p.feeSats : null;
  } catch {
    return null;
  }
}

/**
 * The rescue rule. Returns null when the transaction may go out.
 */
export function checkRescueSpend(
  shape: TxShape,
  facts: WalletFacts,
  expect: RescueExpectation,
): BroadcastRefusal | null {
  if (shape.inputs.length === 0 || shape.outputs.length === 0) return { code: 'unreadable' };
  if (isDifferentTx(shape, expect)) return { code: 'different-tx' };
  if (!shape.inputs.every((i) => facts.ownCoins.has(outpointKey(i)))) {
    return { code: 'foreign-coins' };
  }
  const inputSats = shape.inputs.reduce((sum, i) => sum + (facts.ownCoins.get(outpointKey(i)) ?? 0), 0);
  return payoutRefusal(shape, facts.ownScripts, inputSats, expect);
}

/**
 * The same rule for a rescue the chain ALREADY has (decided 2026-10-19):
 * found among the vault's transactions when Broadcast is tapped, or after
 * a broadcast whose answer was lost. Without it the phone showed Sent and
 * reported Completed for whatever 21st Capital's signed transaction paid,
 * once it was out, and the alarm this check exists to raise read as a
 * success.
 *
 * Its coins are spent, so they are no longer the vault's coins to look up.
 * The vault's own record of the transaction says instead what it took from
 * the vault (`spentSats`, BDK's `sent`) and its fee: every coin is the
 * vault's when what it took is everything the transaction pays plus its
 * fee; less, or a fee not known, and a coin may be someone else's
 * ('foreign-coins'). The rest is checkRescueSpend's rule, unchanged: the
 * very transaction requested, only the destination filed on this phone (or
 * the client's word for it), and a sane fee.
 */
export function checkRescueOnChain(
  shape: TxShape,
  facts: {
    /** Output scripts (hex) this vault owns, as BDK says. */
    ownScripts: Set<string>;
    /** What the transaction took from this vault's coins, in sats. */
    spentSats: number;
    /** Its fee, when the vault's record knows it. */
    feeSats?: number | null;
  },
  expect: RescueExpectation,
): BroadcastRefusal | null {
  if (shape.inputs.length === 0 || shape.outputs.length === 0) return { code: 'unreadable' };
  if (isDifferentTx(shape, expect)) return { code: 'different-tx' };
  const outputSats = shape.outputs.reduce((sum, o) => sum + o.valueSats, 0);
  if (facts.feeSats == null || !(facts.spentSats > 0) || facts.spentSats !== outputSats + facts.feeSats) {
    return { code: 'foreign-coins' };
  }
  return payoutRefusal(shape, facts.ownScripts, facts.spentSats, expect);
}

/** Is this not the very transaction the request PSBT described? */
function isDifferentTx(shape: TxShape, expect: RescueExpectation): boolean {
  return !!expect.requestTxid && shape.unsignedTxid.toLowerCase() !== expect.requestTxid.toLowerCase();
}

/** Where it pays, and what it costs: the rescue rule once the coins are
 *  known to be the vault's, worth `inputSats` together. */
function payoutRefusal(
  shape: TxShape,
  ownScripts: Set<string>,
  inputSats: number,
  expect: RescueExpectation,
): BroadcastRefusal | null {
  const leaving = [
    ...new Set(
      shape.outputs.map((o) => o.scriptHex.toLowerCase()).filter((s) => !ownScripts.has(s)),
    ),
  ];
  const dest = expect.destinationScriptHex?.toLowerCase();
  if (dest) {
    const wrong = leaving.filter((s) => s !== dest);
    if (wrong.length > 0) return { code: 'wrong-destination', scripts: wrong };
  } else {
    const confirmed = new Set((expect.confirmedScripts ?? []).map((s) => s.toLowerCase()));
    const unconfirmed = leaving.filter((s) => !confirmed.has(s));
    if (unconfirmed.length > 0) return { code: 'unconfirmed-destination', scripts: unconfirmed };
  }
  const outputSats = shape.outputs.reduce((sum, o) => sum + o.valueSats, 0);
  const feeSats = inputSats - outputSats;
  if (!expect.acceptHighFee && feeLooksAbsurd(feeSats, inputSats, shape.vsize)) {
    return { code: 'high-fee', feeSats };
  }
  return null;
}

/** An Error carrying the refusal, so a screen can answer it by code. */
export class BroadcastRefusedError extends Error {
  readonly refusal: BroadcastRefusal;
  constructor(refusal: BroadcastRefusal, message: string) {
    super(message);
    this.name = 'BroadcastRefusedError';
    this.refusal = refusal;
  }
}

/** Plain words for each refusal. Nothing was sent in any of them. */
export function refusalMessage(r: BroadcastRefusal): string {
  switch (r.code) {
    case 'unreadable':
      return 'The signed transaction could not be read. Nothing was sent.';
    case 'different-tx':
      return 'This is a different transaction from the one that was requested. Nothing was sent.';
    case 'foreign-coins':
      return 'This transaction spends coins that are not in this vault. Nothing was sent.';
    case 'wrong-destination':
      return 'This transaction pays an address you did not choose. Nothing was sent.';
    case 'unconfirmed-destination':
      return 'Confirm where this transaction sends the coins before it goes out.';
    case 'high-fee':
      return 'The network fee of this transaction is unusually high. Nothing was sent.';
  }
}
