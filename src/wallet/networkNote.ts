/**
 * What a client is told about which chain a vault is on.
 *
 * Decided 2026-09-23: "please mark the [testnet] vaults. No need to mark mainnet
 * vaults because they are the default", and "I dont want client to see
 * mainnet written anywhere."
 *
 * So the real network is never named: it is simply Bitcoin, and saying
 * "Mainnet" beside a vault is jargon that only makes a client wonder what
 * the other kind is. A rehearsal vault IS marked, every time, because the
 * same vault number exists on both chains and a test vault that reads like
 * a real one is the one dangerous confusion (the keys page's own rule).
 *
 * One helper, because the network is spelled differently depending on who is
 * answering: the app's own wallets say `bitcoin`, and 21st Capital's records
 * say `mainnet`.
 */

const REAL = new Set(['bitcoin', 'mainnet', 'main']);

export function isTestNetwork(network?: string | null): boolean {
  const name = (network ?? '').trim().toLowerCase();
  return name !== '' && !REAL.has(name);
}

/** "Test network", or nothing at all for the real one. */
export function networkNote(network?: string | null): string {
  return isTestNetwork(network) ? 'Test network' : '';
}

/** "Vault 3", or "Vault 3 (test network)". */
export function withNetworkNote(name: string, network?: string | null): string {
  return isTestNetwork(network) ? `${name} (test network)` : name;
}
