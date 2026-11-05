/**
 * Which outputs of a PSBT come back to THIS vault, decided in one place by
 * BDK's own isMine against the vault's descriptor (decided
 * 2026-09-26).
 *
 * The screens and the co-signing limit used to read "ours" off any BIP-32
 * or taproot derivation entry in an output map, which whoever wrote the
 * PSBT controls: a derivation with any fingerprint on the attacker's output
 * turned a whole payment into "Change, back to this wallet" or a "Refresh",
 * and told the server to leave it out of the co-signing limit. A derivation
 * entry is a hint for signing devices, never proof of ownership.
 */
import { psbtTxShape } from '../bitcoin/psbt/broadcastCheck';
import { scriptToAddress } from '../bitcoin/psbt/parse';
import type { WalletEngine } from '../bitcoin/engine/types';
import type { ParsedPsbt } from '../bitcoin/psbt/parse';

const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** Indexes of the outputs this vault's descriptor derives. Empty on error. */
export async function ownOutputIndices(
  engine: Pick<WalletEngine, 'ownsAddress' | 'network'>,
  psbtBase64: string,
): Promise<number[]> {
  const shape = psbtTxShape(psbtBase64);
  return shape ? ownOutputIndicesOf(engine, shape.outputs) : [];
}

/** The same answer for outputs already read, from a PSBT or from a signed
 *  transaction (`TxShape.outputs`). */
export async function ownOutputIndicesOf(
  engine: Pick<WalletEngine, 'ownsAddress' | 'network'>,
  outputs: ReadonlyArray<{ scriptHex: string }>,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < outputs.length; i++) {
    const address = scriptToAddress(hexBytes(outputs[i].scriptHex), engine.network);
    try {
      if (address && (await engine.ownsAddress(address))) out.push(i);
    } catch {
      // unknown = not ours: it counts as leaving
    }
  }
  return out;
}

/**
 * The parsed PSBT with every output's `isOwn` set from BDK's answer
 * (`ownOutputIndices`). The review rows, "Refresh" and the co-sign summary
 * all read `isOwn`, so they can never disagree with what the co-signing
 * limit is told.
 */
export function markOwnOutputs(parsed: ParsedPsbt, own: ReadonlyArray<number>): ParsedPsbt {
  const set = new Set(own);
  return { ...parsed, outputs: parsed.outputs.map((o, i) => ({ ...o, isOwn: set.has(i) })) };
}
