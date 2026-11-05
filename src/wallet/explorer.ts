/**
 * The block-explorer link for a transaction, in ONE place.
 *
 * The rule lived in three screens (TxDetail, SignPsbt, PendingCosign) and had
 * already drifted: two of them pointed the 'testnet' slot at testnet4, the
 * third at mempool.space/testnet, which is testnet3. The app's 'testnet' slot
 * speaks TESTNET4 (see bitcoin/network.ts), so that copy sent people to a
 * chain their transaction is not on. One renderer for one thing.
 */
import type { Network } from '../bitcoin/descriptor/types';

/**
 * mempool.space's path segment per chain. Mainnet sits at the root, and
 * regtest has NO page at all: it is a chain that runs on one machine, so no
 * public explorer can see it. Its old /regtest link was a 404, and the share
 * button would have handed that dead link to somebody else (decided
 * 2026-09-21), so regtest has no URL and the buttons go away with it.
 */
const MEMPOOL_PATH: Record<Network, string | null> = {
  bitcoin: '',
  testnet: 'testnet4',
  // Retired (decided 2026-10-18): a value from old data reads as Testnet4, where
  // its vault moved (wallet/signetVaults.ts).
  signet: 'testnet4',
  regtest: null,
};

/**
 * The mempool.space page for a transaction on the given network, or null when
 * that chain has no public explorer. Callers HIDE the link rather than show a
 * dead one.
 */
export function mempoolTxUrl(network: Network, txid: string): string | null {
  // A value from stored wallet metadata can be older than this table, so an
  // unknown network falls back to its own name rather than to mainnet, which
  // would be a link to the wrong chain. `in` rather than `??`, because a
  // network we DO know can be deliberately set to null.
  const path = network in MEMPOOL_PATH ? MEMPOOL_PATH[network] : String(network);
  if (path == null) return null;
  return path
    ? `https://mempool.space/${path}/tx/${txid}`
    : `https://mempool.space/tx/${txid}`;
}

/**
 * The explorer link a screen offers for the client to OPEN or SHARE, or null
 * where the chain has no public explorer (the button then goes away rather
 * than lead nowhere). Offered on every network, also once the client chose
 * their own Bitcoin server (decided 2026-10-22): the app asks nothing for it,
 * and only the client's own tap opens or hands over the link. What the app
 * looks up BY ITSELF (`services/txPrevouts.ts`) still follows
 * `othersMayBeAsked` in wallet/chainServers.ts, so a vault on a chosen server
 * is never looked up elsewhere unasked.
 */
export function explorerTxUrl(network: Network, txid: string): string | null {
  return mempoolTxUrl(network, txid);
}
