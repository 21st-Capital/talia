/**
 * The question every broadcast asks first: would the network still refuse
 * this signed transaction because its coins have not waited long enough?
 * (Decided 2026-10-07: BDK assembles a rescue, or an
 * heir's spend, as soon as the signatures are there, whatever the age of
 * the coins, and the network then refuses it.)
 *
 * The rule is `signedSpendReadiness`, the Rescue screen's own readiness
 * applied to the transaction's own waits. Before it says "not yet" the
 * phone asks the chain again (`refresh`), so a stale tip or history never
 * holds back a payment that could go.
 */
import type { Network } from '../bitcoin/descriptor/types';
import type { WalletEngine } from '../bitcoin/engine/types';
import { decodeBase64, encodeBase64, looksLikePsbt } from '../bitcoin/psbt/export';
import { psbtUnsignedTx } from '../bitcoin/psbt/parse';
import { parseRawTransaction } from '../bitcoin/rawTx';
import { signedSpendReadiness } from './rescueReadiness';
import type { SignedTxWaits } from './rescueReadiness';
import { formatBlocksDuration } from './timelock';

type ChainView = Pick<WalletEngine, 'listTransactions' | 'getTipHeight'>;

/** What the transaction waits for; null when it cannot be read. */
export function signedTxWaits(signed: Uint8Array | string, network: Network): SignedTxWaits | null {
  try {
    const bytes = typeof signed === 'string' ? decodeBase64(signed) : signed;
    if (!bytes) return null;
    const tx = looksLikePsbt(bytes) ? psbtUnsignedTx(encodeBase64(bytes)) : bytes;
    if (!tx) return null;
    const info = parseRawTransaction(tx, network);
    return { version: info.version, lockTime: info.lockTime, inputs: info.inputs };
  } catch {
    return null;
  }
}

/**
 * Blocks still to wait before the network takes it, or null when it can go
 * now or Talia cannot tell (which never stops a send).
 *
 * @param signed   a raw transaction, or a PSBT (bytes, or base64)
 * @param refresh  a synced view of the vault, asked before saying "not yet"
 */
export async function sendTooEarly(
  engine: ChainView,
  signed: Uint8Array | string,
  network: Network,
  refresh?: () => Promise<ChainView>,
): Promise<number | null> {
  const tx = signedTxWaits(signed, network);
  if (!tx) return null;
  const ask = async (view: ChainView) => {
    try {
      return signedSpendReadiness(tx, await view.listTransactions(), view.getTipHeight());
    } catch {
      return null;
    }
  };
  let verdict = await ask(engine);
  if (verdict?.state !== 'waiting') return null;
  if (refresh) {
    const fresh = await refresh().catch(() => null);
    if (fresh) {
      verdict = await ask(fresh);
      if (verdict?.state !== 'waiting') return null;
    }
  }
  return verdict.blocks;
}

/** The one sentence for it, on every screen (title only, no paragraph). */
export function tooEarlyTitle(blocks: number): string {
  return `This can be sent in ≈ ${formatBlocksDuration(blocks)}`;
}
