/**
 * Network defaults for Keel.
 *
 * Mainnet is the default; Testnet4 is the one test network people can pick.
 * Backend URLs are sensible public defaults. A Bitcoin vault can use the
 * user's own node (or a public server they pick) in Settings → Network for
 * privacy, and then talks to that server alone (wallet/chainServers.ts).
 * Testnet4 has no setting: its vaults use the built-in list below.
 */
import type { Network } from './descriptor/types';
import type { BackendConfig } from './engine/types';

/**
 * The networks Talia runs on: Bitcoin, Testnet4 (the 'testnet' slot) and
 * Regtest for tests. Signet is not one of them (decided 2026-10-18: "remove
 * signet, keep only bitcoin and testnet4"). It stays in the `Network` type
 * only so old data that names it can still be read, and it always reads as
 * Testnet4 (`knownNetwork`): vaults saved on it move there at start
 * (wallet/signetVaults.ts), as does a phone set to it
 * (wallet/settingsMigration.ts).
 */
export const NETWORKS: Network[] = ['bitcoin', 'testnet', 'regtest'];

/** The networks a vault can be built on: Bitcoin and Testnet4 only (the
 *  vault configurator's own chooser). Regtest was never offered. Settings →
 *  Network edits the Bitcoin server alone (decided 2026-10-18): Testnet4 vaults
 *  sync through the built-in servers below, with no setting. */
export const OFFERED_NETWORKS: readonly Network[] = ['bitcoin', 'testnet'];

/**
 * The network a value from elsewhere names (a released heir vault, a stored
 * record), as one Talia runs on, or undefined when it names none Talia
 * knows. Signet reads as Testnet4, where the owner's own vault moved. Any
 * other name is never guessed: a tb1 address looks the same on every test
 * chain, so a guess would install the vault on the wrong chain with a zero
 * balance and no error.
 */
export function knownNetwork(value: unknown): Network | undefined {
  if (value === 'signet') return 'testnet';
  return NETWORKS.find((n) => n === value);
}

/** Said when a released vault names a network Talia does not know. A
 *  dialog's title, alone: a dialog is a title and buttons (decided 2026-09-02). */
export const UNKNOWN_NETWORK_REFUSED = 'This vault is on a network Talia does not support';

/**
 * The network a test key (tpub…) puts a new vault on: Testnet4, the one test
 * network Talia offers. Regtest only when a developer's settings name it.
 */
export function testNetworkFor(chosen: Network | null | undefined): Network {
  return chosen === 'regtest' ? 'regtest' : 'testnet';
}

/**
 * The name a screen gives each network. The real one is simply Bitcoin (decided
 * 2026-09-23: "I dont want client to see mainnet written anywhere"). Signet
 * reads as Testnet4 here and in every table below, so a value from old data
 * that escaped the move still behaves as Testnet4 end to end.
 */
export const NETWORK_LABELS: Record<Network, string> = {
  bitcoin: 'Bitcoin',
  // The 'testnet' slot speaks TESTNET4 (default servers below): testnet3 is
  // dying and modern COLDCARD firmware only offers Testnet4/Regtest. The
  // address/xpub encoding (tb1/tpub) is identical, so BDK is agnostic —
  // only the chain backend decides which testnet the wallet follows.
  testnet: 'Testnet4',
  signet: 'Testnet4',
  regtest: 'Regtest',
};

/** The coin's ticker beside a vault on the home list. */
export const NETWORK_TICKERS: Record<Network, string> = {
  bitcoin: 'BTC',
  testnet: 'tBTC',
  signet: 'tBTC',
  regtest: 'rBTC',
};

/** Mainnet by default (product decision 2026-07-14); test networks opt-in. */
export const DEFAULT_NETWORK: Network = 'bitcoin';

/**
 * The public Testnet4 Electrum servers every Testnet4 vault syncs through,
 * in the order they are tried (decided 2026-10-18: "remove the testnet settings
 * completely and just have testnet vaults sync automatically to public
 * nodes? If one node is not reachable, we switch to another"). There is no
 * setting for them: wallet/chainServers.ts tries them in turn, moves on
 * after a connection failure or a timeout, and starts the next time from
 * the last one that answered.
 *
 * Each was verified live on 2026-10-18 under the app's certificate rule
 * (bitcoin/electrumTls.ts: an internet server's certificate must verify for
 * the name listed here), answered blockchain.headers.subscribe, and had the
 * same tip height as https://mempool.space/testnet4/api/blocks/tip/height
 * (156912): blackie.c3-soft.com (Fulcrum 2.1.4, Let's Encrypt, the default
 * since 2026-07-18), mempool.space (mempool-electrs, Sectigo) and
 * bitcoin.stagemole.eu (ElectrumX 1.19.0, Let's Encrypt). Three operators,
 * so one outage never stops a Testnet4 vault. Re-verify before adding one:
 * connect with the certificate checked for the host's name, as the app
 * does, and read the server's version and tip.
 */
export const TESTNET4_ELECTRUM_SERVERS: readonly string[] = [
  'ssl://blackie.c3-soft.com:57010',
  'ssl://mempool.space:40002',
  'ssl://bitcoin.stagemole.eu:5010',
];

/**
 * The engine report's short word for each built-in Testnet4 server (decided
 * 2026-10-30). These three are public, listed here, and carry nothing of a
 * client. A Map, so no name can find an object's own members.
 */
const REPORT_SERVER_KEYS: ReadonlyMap<string, string> = new Map([
  ['ssl://blackie.c3-soft.com:57010', 'blackie'],
  ['ssl://mempool.space:40002', 'mempool'],
  ['ssl://bitcoin.stagemole.eu:5010', 'stagemole'],
]);

/**
 * What the engine report may say about a server: a built-in Testnet4 server's
 * key on a Testnet4 vault, and for anything else, every Bitcoin server and a
 * client's own above all, the fixed word 'other'. Never the server itself.
 */
export function reportServerKey(network: Network, url: string | undefined): string {
  if ((network !== 'testnet' && network !== 'signet') || !url) return 'other';
  return REPORT_SERVER_KEYS.get(url) ?? 'other';
}

const TESTNET4_ESPLORA = 'https://mempool.space/testnet4/api';

/** Default public Electrum servers per network. Testnet4's is the first of
 *  its built-in list; a Bitcoin vault uses its default only while no server
 *  is saved in Settings → Network. */
export const DEFAULT_ELECTRUM: Record<Network, string> = {
  bitcoin: 'ssl://electrum.blockstream.info:50002',
  testnet: TESTNET4_ELECTRUM_SERVERS[0],
  signet: TESTNET4_ELECTRUM_SERVERS[0],
  regtest: 'tcp://127.0.0.1:60401',
};

/** Default public Esplora REST endpoints per network: the block explorer
 *  the transaction page may ask (services/txPrevouts.ts). Talia's chain
 *  backend is Electrum only. */
export const DEFAULT_ESPLORA: Record<Network, string> = {
  bitcoin: 'https://blockstream.info/api',
  testnet: TESTNET4_ESPLORA,
  signet: TESTNET4_ESPLORA,
  regtest: 'http://127.0.0.1:3002',
};

/** Build the default Electrum backend config for a network. */
export function defaultElectrumBackend(network: Network): BackendConfig {
  // Fail fast: a dead server must error in ~20s (retry × timeout), not
  // minutes — hung native sync calls queue-block every other engine call.
  return {
    type: 'electrum',
    url: DEFAULT_ELECTRUM[network],
    retry: 2,
    timeout: 10,
    stopGap: 20,
    validateDomain: true,
  };
}
