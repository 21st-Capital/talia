/**
 * Shrink a PSBT for the Bluetooth trip to a signing device.
 *
 * WHY. The wallet engine packs each input's COMPLETE previous transaction
 * into the PSBT (`non_witness_utxo`, a pre-segwit safety habit). Coins that
 * arrived in large transactions drag those whole transactions along, so a
 * 7-input spend can weigh hundreds of kilobytes. Streamed over Bluetooth at
 * hardware pace, the Ledger sat on "Loading transaction" until its own
 * screen timeout threw the session away (a 7-coin funding spend,
 * 2026-08-31).
 *
 * WHAT IS DROPPED, EXACTLY. `non_witness_utxo` is removed ONLY from inputs
 * that also carry a `witness_utxo` whose script is taproot (v1). A taproot
 * signature commits to every spent output's amount and script through
 * `witness_utxo`, so the full parent transaction adds nothing the device
 * checks; both Ledger and BitBox sign taproot from `witness_utxo` alone.
 * Segwit-v0 inputs (wsh vaults) KEEP the parent transaction: devices
 * demand it there, because v0 signatures do not commit to input amounts
 * the same way and the parent is their defense against fee lies.
 *
 * Everything else — the maps' order, unknown fields, proprietary keys — is
 * copied through byte-for-byte. Pure; unit-tested.
 */
import { base64 } from '@scure/base';

import { Reader, parseTx, readMap, tapFpOf } from './parse';

const PSBT_MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff];
const IN_NON_WITNESS_UTXO = 0x00;
const IN_WITNESS_UTXO = 0x01;

type MapEntry = { keyType: number; keyData: Uint8Array; value: Uint8Array };

function writeVarint(n: number, out: number[]): void {
  if (n < 0xfd) {
    out.push(n);
  } else if (n <= 0xffff) {
    out.push(0xfd, n & 0xff, (n >> 8) & 0xff);
  } else {
    out.push(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
  }
}

/** BIP-174 keys are {keytype varint}{keydata}; keyLen covers both. */
function writeMap(entries: MapEntry[], out: number[]): void {
  for (const e of entries) {
    const key: number[] = [];
    writeVarint(e.keyType, key);
    for (const b of e.keyData) key.push(b);
    writeVarint(key.length, out);
    out.push(...key);
    writeVarint(e.value.length, out);
    for (const b of e.value) out.push(b);
  }
  out.push(0x00);
}

/** True when this witness_utxo value pays to a taproot (v1) output. */
function witnessUtxoIsTaproot(value: Uint8Array): boolean {
  // amount(8) + varint scriptLen + script
  try {
    const r = new Reader(value);
    r.bytes(8);
    const script = r.varBytes();
    return script.length === 34 && script[0] === 0x51 && script[1] === 0x20;
  } catch {
    return false;
  }
}

export function slimPsbtForDevice(psbt: Uint8Array): Uint8Array {
  const r = new Reader(psbt);
  const magic = r.bytes(5);
  if (!PSBT_MAGIC.every((b, i) => magic[i] === b)) throw new Error('Not a PSBT');

  const globals = readMap(r);
  const unsignedTx = globals.find((e) => e.keyType === 0x00);
  if (!unsignedTx) throw new Error('PSBT has no transaction');
  const tx = parseTx(new Reader(unsignedTx.value));

  const inputs: MapEntry[][] = [];
  for (let i = 0; i < tx.ins.length; i++) inputs.push(readMap(r));
  const outputs: MapEntry[][] = [];
  for (let i = 0; i < tx.outs.length; i++) outputs.push(readMap(r));

  const out: number[] = [...PSBT_MAGIC];
  writeMap(globals, out);
  for (const entries of inputs) {
    const witness = entries.find((e) => e.keyType === IN_WITNESS_UTXO && e.keyData.length === 0);
    const slim =
      witness && witnessUtxoIsTaproot(witness.value)
        ? entries.filter((e) => !(e.keyType === IN_NON_WITNESS_UTXO && e.keyData.length === 0))
        : entries;
    writeMap(slim, out);
  }
  for (const entries of outputs) writeMap(entries, out);
  return Uint8Array.from(out);
}

/** Base64 in, base64 out, with the sizes for anyone curious. */
export function slimPsbtBase64ForDevice(psbtB64: string): {
  psbt: string;
  beforeBytes: number;
  afterBytes: number;
} {
  const raw = base64.decode(psbtB64);
  const slim = slimPsbtForDevice(raw);
  return { psbt: base64.encode(slim), beforeBytes: raw.length, afterBytes: slim.length };
}

const IN_TAP_BIP32_DERIVATION = 0x16;
const IN_TAP_LEAF_SCRIPT = 0x15;
const IN_TAP_INTERNAL_KEY = 0x17;
const IN_TAP_MERKLE_ROOT = 0x18;
const OUT_TAP_INTERNAL_KEY = 0x05;
const OUT_TAP_TREE = 0x06;
const OUT_TAP_BIP32_DERIVATION = 0x07;

/**
 * The aggressive cut, for LEDGER POLICY signing only. A registered wallet
 * policy makes the device re-derive every script, internal key and tree
 * root itself, yet each input still carried them — plus derivation entries
 * for every co-signer — and the device enumerates all of it over the
 * radio, one exchange at a time. The 7-coin spend cost 890+ exchanges at
 * ~84ms each (measured live, 2026-08-31); entries the device never uses
 * are round trips for nothing.
 *
 * Kept per taproot input: witness_utxo, any signatures already present,
 * and the TAP_BIP32_DERIVATION entry of THE CONNECTED DEVICE — the app
 * signs only key expressions whose derivation entry is present (Bitcoin
 * app 2.4.0 and later), and that entry also carries the address index
 * the device derives the input's script from.
 *
 * The caller MUST fall back to `slimPsbtForDevice` if the device returns
 * no signature: this cut leans on policy-signing behavior, and a firmware
 * that wants the dropped fields back gets them on the automatic retry.
 */
export function slimPsbtForLedgerPolicy(psbt: Uint8Array, keepFingerprint: string): Uint8Array {
  const keep = keepFingerprint.toLowerCase();
  const r = new Reader(slimPsbtForDevice(psbt));
  const magic = r.bytes(5);
  const globals = readMap(r);
  const unsignedTx = globals.find((e) => e.keyType === 0x00);
  if (!unsignedTx) throw new Error('PSBT has no transaction');
  const tx = parseTx(new Reader(unsignedTx.value));
  const inputs: MapEntry[][] = [];
  for (let i = 0; i < tx.ins.length; i++) inputs.push(readMap(r));
  const outputs: MapEntry[][] = [];
  for (let i = 0; i < tx.outs.length; i++) outputs.push(readMap(r));

  const out: number[] = [...magic];
  writeMap(globals, out);
  for (const entries of inputs) {
    const witness = entries.find((e) => e.keyType === IN_WITNESS_UTXO && e.keyData.length === 0);
    if (!(witness && witnessUtxoIsTaproot(witness.value))) {
      writeMap(entries, out);
      continue;
    }
    writeMap(
      entries.filter((e) => {
        if (
          e.keyType === IN_TAP_LEAF_SCRIPT ||
          e.keyType === IN_TAP_INTERNAL_KEY ||
          e.keyType === IN_TAP_MERKLE_ROOT
        ) {
          return false;
        }
        if (e.keyType === IN_TAP_BIP32_DERIVATION) {
          return tapFpOf(e.value)?.toLowerCase() === keep;
        }
        return true;
      }),
      out,
    );
  }
  // Outputs get the same treatment: the change output carried the whole
  // taproot tree and every co-signer's derivation entry. The device
  // recognizes change from the policy plus OUR derivation entry's address
  // index; the rest was radio traffic.
  for (const entries of outputs) {
    writeMap(
      entries.filter((e) => {
        if (e.keyType === OUT_TAP_INTERNAL_KEY || e.keyType === OUT_TAP_TREE) return false;
        if (e.keyType === OUT_TAP_BIP32_DERIVATION) {
          return tapFpOf(e.value)?.toLowerCase() === keep;
        }
        return true;
      }),
      out,
    );
  }
  return Uint8Array.from(out);
}

/** Base64 wrapper for the Ledger policy cut. */
export function slimPsbtBase64ForLedgerPolicy(psbtB64: string, keepFingerprint: string): string {
  return base64.encode(slimPsbtForLedgerPolicy(base64.decode(psbtB64), keepFingerprint));
}
