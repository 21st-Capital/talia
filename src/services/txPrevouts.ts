/**
 * The addresses of the coins a transaction spent, for the Advanced section of
 * the transaction page (decided 2026-09-22: "copy the exact same structure from
 * blue wallet", which lists the spent coins by ADDRESS; a coin ID "doesnt
 * provide any valuable information").
 *
 * A spent coin names only the transaction and position it came from; its
 * address lives in THAT earlier transaction. The page resolves it in three
 * steps, cheapest first: what the spending input itself reveals
 * (`bitcoin/rawTx.ts`), the vault's own history (every coin the vault spent
 * was once received by it), and only then a block explorer, for the
 * sender's coins of a received payment.
 *
 * Privacy: the explorer is asked only when the Advanced section is opened,
 * and NEVER when the client chose their own Bitcoin server, their node or a
 * public one they picked: someone who chose their server chose not to tell
 * another what they look at (decided 2026-10-18: "we should never leak their
 * vaults to any other node"; wallet/chainServers.ts `othersMayBeAsked`, the
 * same rule the sync and every broadcast follow, which also covers a server
 * the settings hold back). Testnet4 has no setting and
 * uses public servers anyway, so its explorer is always asked.
 */
import type { AppSettings } from '../wallet/types';
import type { Network } from '../bitcoin/descriptor/types';
import { DEFAULT_ESPLORA } from '../bitcoin/network';
import { withTimeout } from '../wallet/withTimeout';
import { othersMayBeAsked } from '../wallet/chainServers';

/** The explorer to ask, or null when this client must not be sent to one. */
export function explorerApiFor(
  network: Network,
  settings: Pick<AppSettings, 'electrumUrls' | 'bitcoinServerHold'>,
): string | null {
  // The client's own choice of server (or one held back until they enter
  // it again): no other lookups on their behalf.
  if (!othersMayBeAsked(network, settings)) return null;
  return DEFAULT_ESPLORA[network].replace(/\/+$/, '');
}

/**
 * The address of every coin `txid` spent, in input order (null where the
 * explorer names none). Throws on a network failure; the page keeps what it
 * already had.
 */
export async function fetchSpentCoinAddresses(api: string, txid: string): Promise<Array<string | null>> {
  const res = await withTimeout(fetch(`${api}/tx/${txid}`), 10_000, 'The block explorer');
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  const body = (await res.json()) as { vin?: Array<{ prevout?: { scriptpubkey_address?: unknown } | null }> };
  return (body.vin ?? []).map((v) => {
    const a = v?.prevout?.scriptpubkey_address;
    return typeof a === 'string' && a ? a : null;
  });
}
