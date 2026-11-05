/**
 * Gather what the rescue rule needs from an engine, through the
 * WalletEngine interface only (no native module), so every engine shares it
 * (both did while two shipped, until the old engine's removal, decided 2026-11-04) and
 * Jest can run it (decided 2026-09-26).
 */
import { checkRescueOnChain, checkRescueSpend } from '../psbt/broadcastCheck';
import type { BroadcastRefusal, RescueExpectation, TxShape } from '../psbt/broadcastCheck';
import { scriptToAddress } from '../psbt/parse';
import type { WalletEngine, WalletTx } from './types';

const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

export async function verifyRescueTransaction(
  engine: Pick<WalletEngine, 'listUtxos' | 'ownsAddress' | 'network'>,
  shape: TxShape,
  expect: RescueExpectation,
): Promise<BroadcastRefusal | null> {
  const ownCoins = new Map<string, number>();
  for (const u of await engine.listUtxos()) ownCoins.set(`${u.txid.toLowerCase()}:${u.vout}`, u.valueSats);
  if (expect.requestTxid) {
    for (const c of expect.replacedCoins ?? []) ownCoins.set(`${c.txid.toLowerCase()}:${c.vout}`, c.valueSats);
  }
  return checkRescueSpend(shape, { ownCoins, ownScripts: await ownScriptsOf(engine, shape) }, expect);
}

/**
 * The rescue rule for a rescue the chain already has (`checkRescueOnChain`,
 * decided 2026-10-19): `tx` is the vault's own record of it, from a sync.
 */
export async function verifyRescueOnChain(
  engine: Pick<WalletEngine, 'ownsAddress' | 'network'>,
  shape: TxShape,
  tx: Pick<WalletTx, 'sent' | 'fee'>,
  expect: RescueExpectation,
): Promise<BroadcastRefusal | null> {
  return checkRescueOnChain(
    shape,
    { ownScripts: await ownScriptsOf(engine, shape), spentSats: tx.sent, feeSats: tx.fee },
    expect,
  );
}

/** The output scripts (hex, lowercase) of `shape` this vault owns. */
async function ownScriptsOf(
  engine: Pick<WalletEngine, 'ownsAddress' | 'network'>,
  shape: TxShape,
): Promise<Set<string>> {
  const ownScripts = new Set<string>();
  for (const o of shape.outputs) {
    const address = scriptToAddress(hexBytes(o.scriptHex), engine.network);
    if (address && (await engine.ownsAddress(address))) ownScripts.add(o.scriptHex.toLowerCase());
  }
  return ownScripts;
}
