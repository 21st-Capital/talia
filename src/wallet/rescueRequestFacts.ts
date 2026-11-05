/**
 * What a filed rescue request pays, for the client to check it again on the
 * video call with 21st Capital (decided 2026-11-03): where it goes, what
 * arrives there, the network fee and what leaves the vault.
 *
 * Every figure is read from the PHONE'S OWN transaction, never from the
 * server's word. The server sends back the request's PSBT while it waits
 * and, once 21st Capital has signed it, the signed transaction instead (the
 * PSBT is wiped in the same step). Either counts only when its unsigned txid
 * is the one this phone recorded when it filed (`PendingRescue.requestTxid`):
 * that txid covers every coin spent and every output with its amount, so the
 * outputs are then exactly what this phone built, signed or not. It does NOT
 * cover the coins' values, which a PSBT carries outside the transaction, so
 * the fee is worked out from the values THIS phone knows (the vault's coin
 * list, a speed-up's recorded coins), and is left out when it does not know
 * them all. The address shown is only ever the phone's own record, and an
 * output pays it when its script is that address's script on the vault's
 * network. "Ours" for an output is BDK's answer (`ownOutputIndicesOf`),
 * never a derivation entry in the PSBT.
 *
 * Pure, tested (`rescueRequestFacts.test.ts`).
 */
import { decodeHexOrBase64, encodeBase64, looksLikePsbt } from '../bitcoin/psbt/export';
import { psbtTxShape, rawTxShape } from '../bitcoin/psbt/broadcastCheck';
import type { TxShape } from '../bitcoin/psbt/broadcastCheck';
import { addressFitsNetwork, addressToScriptHex } from '../bitcoin/addressNetwork';
import type { Network } from '../bitcoin/descriptor/types';
import { formatAmount, formatSats } from './format';
import type { AmountUnit } from './types';

/** A coin and its value, as this phone knows it. */
export interface KnownCoin {
  txid: string;
  vout: number;
  valueSats: number;
}

/** The parts of the phone's record of a request (`PendingRescue`) read here. */
export interface RescueRequestRecord {
  destination?: string;
  requestTxid?: string;
  replaces?: { coins: ReadonlyArray<KnownCoin> };
}

/** Why a request shows no amount and no fee. */
export type UncheckedReason =
  /** This phone kept no address or no txid for it. */
  | 'no-record'
  /** The server's answer carries no transaction (wiped, or an older server). */
  | 'no-transaction'
  /** The server's transaction is not the one this phone filed. */
  | 'other-transaction'
  /** The server's transaction cannot be read. */
  | 'unreadable';

export type RescueRequestFacts =
  | {
      kind: 'figures';
      destination: string;
      /** What the outputs paying the recorded address receive. */
      arrivesSats: number;
      /** Null when this phone does not know the value of every coin spent. */
      feeSats: number | null;
      /** The amount plus the fee: what goes out of the vault. Null with the fee. */
      leavesSats: number | null;
      /** How many of the vault's coins it spends. */
      coins: number;
    }
  | {
      /** It pays an address that is neither the recorded one nor the vault's. */
      kind: 'pays-elsewhere';
      destination: string;
      /** Those outputs, by index. */
      others: number[];
    }
  | { kind: 'unchecked'; destination: string | null; reason: UncheckedReason };

/** The request's transaction as compared here: its unsigned txid, the coins
 *  it spends and its outputs by script. */
export type RequestTx = Pick<TxShape, 'unsignedTxid' | 'inputs' | 'outputs'>;

/** What the server's answer holds of the request's transaction. */
export type ServerRequestTx = RequestTx | 'none' | 'unreadable';

/** The parts of the server's answer (`RescueServerRequest`) read here. */
export interface ServerRequestCopy {
  status?: string;
  request_psbt?: string | null;
  signed_tx?: string | null;
}

/**
 * The request's transaction as the server holds it: the signed one once
 * 21st Capital has signed (the PSBT is wiped then; decided 2026-11-03), else
 * the PSBT the phone sent. A signed transaction may come as raw bytes (hex
 * or base64) or as a finalized PSBT, as at Broadcast. Not yet checked
 * against anything: `rescueRequestFacts` does that.
 */
export function serverRequestTx(server: ServerRequestCopy | null | undefined, network: Network): ServerRequestTx {
  const signed = server?.status === 'signed' ? (server.signed_tx ?? '').trim() : '';
  if (signed) {
    const bytes = decodeHexOrBase64(signed);
    if (!bytes) return 'unreadable';
    const shape = looksLikePsbt(bytes) ? psbtTxShape(encodeBase64(bytes)) : rawTxShape(bytes, network);
    return shape ?? 'unreadable';
  }
  const psbt = (server?.request_psbt ?? '').trim();
  if (!psbt) return 'none';
  return psbtTxShape(psbt) ?? 'unreadable';
}

const coinKey = (txid: string, vout: number): string => `${txid.toLowerCase()}:${vout}`;

export function rescueRequestFacts(input: {
  /** The phone's record of the request; absent when it kept none. */
  record: RescueRequestRecord | null | undefined;
  /** The server's transaction for it (`serverRequestTx`). */
  tx: ServerRequestTx;
  /** The vault's network: only an address of it can be the recorded one. */
  network: Network;
  /** Coins this phone knows the value of. */
  knownCoins?: ReadonlyArray<KnownCoin>;
  /** The outputs BDK says pay this vault itself (`ownOutputIndicesOf`). */
  ownOutputs?: ReadonlyArray<number>;
}): RescueRequestFacts {
  const { record, network, tx } = input;
  const recorded = record?.destination?.trim() ? record.destination.trim() : null;
  if (!recorded) return { kind: 'unchecked', destination: null, reason: 'no-record' };
  if (tx === 'none') return { kind: 'unchecked', destination: recorded, reason: 'no-transaction' };
  const filed = record?.requestTxid?.trim().toLowerCase();
  if (!filed) return { kind: 'unchecked', destination: recorded, reason: 'no-record' };
  if (tx === 'unreadable' || !tx.unsignedTxid) return { kind: 'unchecked', destination: recorded, reason: 'unreadable' };
  if (tx.unsignedTxid.toLowerCase() !== filed) {
    return { kind: 'unchecked', destination: recorded, reason: 'other-transaction' };
  }

  // One script has an address on each network: the recorded address counts
  // only as an address of the vault's own network.
  const to = addressFitsNetwork(recorded, network) ? addressToScriptHex(recorded) : null;
  const own = new Set(input.ownOutputs ?? []);
  let arrives = 0;
  let back = 0;
  let out = 0;
  const others: number[] = [];
  tx.outputs.forEach((o, i) => {
    out += o.valueSats;
    if (to != null && o.scriptHex.toLowerCase() === to) arrives += o.valueSats;
    else if (own.has(i)) back += o.valueSats;
    else others.push(i);
  });
  if (others.length > 0) return { kind: 'pays-elsewhere', destination: recorded, others };

  // The coins' values from this phone only: the PSBT's own copies of them
  // are outside the txid, so the server could have written any number there.
  const values = new Map<string, number>();
  for (const c of input.knownCoins ?? []) values.set(coinKey(c.txid, c.vout), c.valueSats);
  const spent = tx.inputs.map((r) => values.get(coinKey(r.txid, r.vout)));
  const totalIn = spent.every((v): v is number => v != null) ? spent.reduce((a, v) => a + v, 0) : null;
  const fee = totalIn == null ? null : totalIn - out;
  const feeSats = fee != null && fee >= 0 ? fee : null;
  return {
    kind: 'figures',
    destination: recorded,
    arrivesSats: arrives,
    feeSats,
    leavesSats: feeSats == null || totalIn == null ? null : totalIn - back,
    coins: tx.inputs.length,
  };
}

/** Does reading the facts again with BDK's answer, or with the vault's live
 *  coin list, have anything to add? */
export function factsNeedEngine(f: RescueRequestFacts): { own: boolean; coins: boolean } {
  return { own: f.kind === 'pays-elsewhere', coins: f.kind === 'figures' && f.feeSats == null };
}

/** The line under the rows, and how loud it is; null when the rows say it all. */
export function rescueRequestLine(f: RescueRequestFacts): { text: string; tone: 'quiet' | 'warning' | 'alarm' } | null {
  if (f.kind === 'pays-elsewhere') {
    return { text: 'This transaction pays an address other than the one you chose.', tone: 'alarm' };
  }
  if (f.kind === 'figures') {
    return f.feeSats == null ? { text: 'Network fee not shown: this phone does not know the value of every coin.', tone: 'quiet' } : null;
  }
  switch (f.reason) {
    case 'other-transaction':
      return { text: '21st Capital holds a different transaction from the one this phone sent.', tone: 'warning' };
    case 'no-transaction':
      return { text: 'Amount and fee not shown: there is no transaction to check.', tone: 'quiet' };
    case 'unreadable':
      return { text: 'Amount and fee not shown: the transaction could not be read.', tone: 'quiet' };
    case 'no-record':
    default:
      return { text: 'Amount and fee not shown: this phone kept no record to check them against.', tone: 'quiet' };
  }
}

/** One row of the figures: a label, its value, the exact satoshis under it. */
export interface FigureRow {
  label: string;
  value: string;
  sub?: string;
}

/**
 * The figure rows of the details sheet, in the owner's unit with the exact
 * satoshis under an amount shown in bitcoin. `mask` stands in for every
 * figure while balances are hidden.
 */
export function rescueFigureRows(f: RescueRequestFacts, unit: AmountUnit, mask: string | null = null): FigureRow[] {
  if (f.kind !== 'figures') return [];
  const amount = (label: string, sats: number): FigureRow => {
    if (mask != null) return { label, value: mask };
    const value = formatAmount(sats, unit);
    const exact = formatSats(sats);
    return value === exact ? { label, value } : { label, value, sub: exact };
  };
  const rows: FigureRow[] = [amount('Amount', f.arrivesSats)];
  if (f.feeSats != null) rows.push({ label: 'Network fee', value: mask ?? formatSats(f.feeSats) });
  if (f.leavesSats != null) rows.push(amount('Leaves the vault', f.leavesSats));
  rows.push({ label: 'Coins', value: String(f.coins) });
  return rows;
}
