/**
 * Which Electrum servers a vault's data may go to, in what order, and what
 * the vault says when they cannot be used (decided 2026-10-18).
 *
 * BITCOIN. "Users who use a private node from home are concerned about
 * privacy and we should never leak their vaults to any other node. Also, if
 * a user prefers a specific public node, we should never automatically fall
 * to any other public node!" Once Settings → Network holds a Bitcoin server
 * (the client's own node, or a public one they picked), every request that
 * carries a vault's addresses, transactions or descriptor goes to THAT
 * server and to no other: the sync, every broadcast, and the block explorer
 * the transaction page could ask (services/txPrevouts.ts asks none then). No
 * fallback to the default, no rotation, and what was saved is used exactly
 * as saved (bitcoin/electrumTls.ts no longer rewrites a renamed or retired
 * server; it earns a note here instead). A server that cannot be reached
 * leaves the vault unsynced, with a plain note on it. With no server saved,
 * the default public server, as before, UNLESS the settings hold one back
 * (`serverHold`: the client's own Esplora server from before 2026-07, which
 * has no Electrum address Talia could know, or stored settings that could
 * not be read, so the choice is not known): then NO server, with a note,
 * until the client saves one or resets. A client's own server is never
 * replaced by the public default behind their back. Nor is a sync started
 * before the settings were read (WalletProvider waits for them).
 *
 * TESTNET4. No setting at all ("remove the testnet settings completely and
 * just have testnet vaults sync automatically to public nodes? If one node
 * is not reachable, we switch to another"). Every Testnet4 vault uses the
 * built-in list (bitcoin/network.ts `TESTNET4_ELECTRUM_SERVERS`): tried in
 * order, the next one after a connection failure or a timeout, and the last
 * one that answered first for the rest of the session. A Signet value from
 * old data reads as Testnet4 here too.
 *
 * REGTEST (developers only): the saved server or the local default, alone.
 *
 * Pure but for the session's memory of the last good Testnet4 server.
 */
import type { Network } from '../bitcoin/descriptor/types';
import type { BackendConfig } from '../bitcoin/engine/types';
import { defaultElectrumBackend, NETWORK_LABELS, TESTNET4_ELECTRUM_SERVERS } from '../bitcoin/network';
import { electrumHost, electrumValidatesCertificate, savedServerNotice } from '../bitcoin/electrumTls';
import { SERVER_ANSWERED, serverUnreachable } from '../bitcoin/engine/engineError';
import { libraryProblem } from '../bitcoin/engine/libraryProblem';
import { ADDRESS_LOOKUP_RETRY, ADDRESS_LOOKUP_TIMEOUT_S } from '../bitcoin/engine/bdkWalletRules';
import type { AppSettings, BitcoinServerHold } from './types';
import { withTimeout } from './withTimeout';

type ServerSettings = Pick<AppSettings, 'electrumUrls' | 'bitcoinServerHold'>;

/** Does this network sync through the built-in list (Testnet4)? */
export function usesBuiltInServers(network: Network): boolean {
  return network === 'testnet' || network === 'signet';
}

/**
 * The server the client chose for this network in Settings → Network, as
 * saved, or null (none saved, or Testnet4, which has no setting).
 */
export function chosenServer(network: Network, settings: ServerSettings): string | null {
  if (usesBuiltInServers(network)) return null;
  const url = settings.electrumUrls?.[network];
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

/**
 * Why a Bitcoin vault has no server to sync through, or null. Only while no
 * Bitcoin server is saved: a saved one is always used, and Save clears the
 * hold anyway (ui/screens/NetworkSettingsScreen).
 */
export function serverHold(network: Network, settings: ServerSettings): BitcoinServerHold | null {
  if (network !== 'bitcoin' || chosenServer(network, settings)) return null;
  return settings.bitcoinServerHold ?? null;
}

/**
 * May a service other than the vault's own server be told what this vault
 * looks at (a block explorer asked about its transactions)? Only while the
 * vault uses the default servers anyway: never once the client chose a
 * Bitcoin server, nor while the settings hold one back. Testnet4 has no
 * setting and uses public servers, so yes.
 */
export function othersMayBeAsked(network: Network, settings: ServerSettings): boolean {
  return !chosenServer(network, settings) && !serverHold(network, settings);
}

/** What a sync or a broadcast says while a Bitcoin vault has no server. */
export const NO_BITCOIN_SERVER = 'No server is set for your Bitcoin vaults';

/** The last Testnet4 server that answered, for this run of the app. */
let lastGoodTestnet4: string | null = null;

/** Tests only: a fresh launch. */
export function __forgetGoodServersForTests(): void {
  lastGoodTestnet4 = null;
}

/**
 * The servers a vault on this network may talk to, in the order to try
 * them. Bitcoin and Regtest: exactly one, or NONE while the settings hold
 * a Bitcoin server back (`serverHold`). Testnet4: the built-in list,
 * starting from the last one that answered.
 */
export function chainServersFor(network: Network, settings: ServerSettings): BackendConfig[] {
  const base = defaultElectrumBackend(network);
  if (usesBuiltInServers(network)) {
    const list = TESTNET4_ELECTRUM_SERVERS;
    const start = lastGoodTestnet4 ? Math.max(0, list.indexOf(lastGoodTestnet4)) : 0;
    return [...list.slice(start), ...list.slice(0, start)].map((url) => ({
      ...base,
      url,
      validateDomain: electrumValidatesCertificate(url),
      // A silent server gives up natively inside its own slot (below).
      retry: TESTNET4_RETRY,
      timeout: TESTNET4_TIMEOUT_S,
    }));
  }
  const chosen = chosenServer(network, settings);
  if (!chosen) return serverHold(network, settings) ? [] : [base];
  // The certificate is checked for every server on the internet; only a
  // server on the user's own network or over Tor skips it (decided
  // 2026-09-26, rule in bitcoin/electrumTls).
  return [{ ...base, url: chosen, validateDomain: electrumValidatesCertificate(chosen) }];
}

// The rule itself lives with the engine's codes (bitcoin/engine/engineError.ts),
// where the shadow's report asked the same question until the old engine's removal.
export { serverUnreachable };

/** Did this server fail a sync: unreachable, or it answered with an error
 *  or something unreadable? Either way another server may do better. */
export function serverFailed(e: unknown): boolean {
  if (serverUnreachable(e)) return true;
  const message = e instanceof Error ? e.message : String(e ?? '');
  return SERVER_ANSWERED.test(message);
}

/** What a Testnet4 vault says when no built-in server answered. */
export const NO_TESTNET4_SERVER_ANSWERED = `None of the ${NETWORK_LABELS.testnet} servers answered. Try again later.`;

/**
 * Run `run` against this network's servers in turn (see `chainServersFor`).
 * Bitcoin and Regtest have one server: its own error comes back as it is,
 * and nothing else is tried (none at all while held: `NO_BITCOIN_SERVER`). Testnet4 moves to the next server when
 * `failOver` says the error was the server's, remembers the one that
 * answered, and says `NO_TESTNET4_SERVER_ANSWERED` when none did; any other
 * error (one of the app's own checks) comes back at once.
 */
export async function throughChainServers<T>(
  network: Network,
  settings: ServerSettings,
  run: (backend: BackendConfig) => Promise<T>,
  opts: { failOver: (e: unknown) => boolean; attemptMs?: number; label?: string },
): Promise<T> {
  const servers = chainServersFor(network, settings);
  if (servers.length === 0) throw new Error(NO_BITCOIN_SERVER);
  for (const backend of servers) {
    try {
      const attempt = run(backend);
      const value = opts.attemptMs
        ? await withTimeout(attempt, opts.attemptMs, opts.label ?? 'Connection')
        : await attempt;
      if (usesBuiltInServers(network)) lastGoodTestnet4 = backend.url;
      return value;
    } catch (e) {
      if (servers.length === 1 || !opts.failOver(e)) throw e;
    }
  }
  throw new Error(NO_TESTNET4_SERVER_ANSWERED);
}

/** The sync watchdog for the one server of Bitcoin or Regtest: big first
 *  syncs are slow, but a hung server must not leave screens spinning. */
export const SYNC_WATCHDOG_MS = 90_000;
/** Each Testnet4 server's share of the same 90 seconds. */
export const TESTNET4_SYNC_ATTEMPT_MS = SYNC_WATCHDOG_MS / TESTNET4_ELECTRUM_SERVERS.length;

/**
 * How a Testnet4 server is asked: no second try on the same server (the
 * next server IS the second try) and 8 seconds for each answer.
 *
 * Why it matters (decided 2026-10-18): the JS watchdog gives up on a server,
 * but it cannot stop the native call. The wallet library's bridge runs every
 * wallet call on ONE serial queue (native/bdkwallet/bridge/
 * TaliaBdkWalletModule.swift `walletQueue`; bdk-rn's `bdkQueue` when this
 * was found, until the old engine's removal, decided 2026-11-04), so the
 * next server's sync waited behind the abandoned one while its own clock
 * ran. With the Bitcoin settings (2 more tries, 10 s each) a server that
 * accepts the connection and then says nothing kept that queue for over a
 * minute (`silentServerGivesUpMs`), longer than its 30 s slot, and the
 * healthy servers behind it timed out without being asked: "None of the
 * Testnet4 servers answered". With these, the native call ends by itself in
 * 16 s, the queue is free when the next server is tried, and the watchdog
 * is only the backstop. Not covered: a server that answers every request,
 * slowly, just inside the 8 s (no request ever times out).
 */
export const TESTNET4_RETRY = 0;
export const TESTNET4_TIMEOUT_S = 8;

/**
 * The longest a native call to a SILENT server can take before
 * electrum-client gives up by itself, from the backend's settings: the
 * connection (up to `timeout`), the first try of a request (up to
 * `timeout`), then for each of `retry` more tries electrum-client's pause
 * (2, 4, 8... seconds, at most 30), a new connection and the try again.
 * The defaults are the engine's when a setting is missing
 * (bitcoin/engine/bdkWalletRules.ts `syncServerOf`: 5 tries, 30 s, the old
 * engine's own).
 */
export function silentServerGivesUpMs(backend: Pick<BackendConfig, 'retry' | 'timeout'>): number {
  const each = (backend.timeout ?? 30) * 1000;
  let total = each + each;
  for (let k = 1; k <= (backend.retry ?? 5); k += 1) total += Math.min(2 ** k, 30) * 1000 + each + each;
  return total;
}

/** A vault's sync, through its servers. */
export function syncThroughChainServers<T>(
  network: Network,
  settings: ServerSettings,
  run: (backend: BackendConfig) => Promise<T>,
): Promise<T> {
  return throughChainServers(network, settings, run, {
    failOver: serverFailed,
    attemptMs: usesBuiltInServers(network) ? TESTNET4_SYNC_ATTEMPT_MS : SYNC_WATCHDOG_MS,
    label: 'Sync',
  });
}

/**
 * How long one server has for an address-book lookup (decided 2026-11-05):
 * about 20 seconds. The native call (the bridge's `addressActivity`, on the
 * serial queue the connection test shares) is three round trips at most:
 * the connection, the history, then the history's transactions in ONE batch
 * or the address's coins, each read allowed `ADDRESS_LOOKUP_TIMEOUT_S`
 * (8 s) with retry `ADDRESS_LOOKUP_RETRY`. A silent server ends it by itself
 * in 16 s (`silentServerGivesUpMs`), and the bridge asks the last question
 * only within its first 11 seconds (`ADDRESS_ACTIVITY_LAST_ASK_S`), so a slow
 * server that does answer ends it by 19 s. Either way the native call has
 * ended before the next Testnet4 server, a Try again or the connection test
 * is asked. Not covered, as for the sync: a server that trickles one answer
 * in pieces, each just inside the 8 s.
 */
export const ADDRESS_LOOKUP_ATTEMPT_MS = 20_000;

/**
 * An address-book lookup (decided 2026-11-05: is a saved Private Address
 * known to have spent coins?), through exactly the servers the vault's
 * network uses, under the same rule as its sync: a Bitcoin lookup goes to
 * the one server the client chose (or the default while none is saved) and
 * to NOTHING while a server is held (`NO_BITCOIN_SERVER`); Testnet4 uses its
 * built-in servers and moves on after a server failed or said nothing in
 * `ADDRESS_LOOKUP_ATTEMPT_MS`. Every server is asked with the lookup's own
 * settings (retry `ADDRESS_LOOKUP_RETRY`, timeout `ADDRESS_LOOKUP_TIMEOUT_S`).
 * Never a block explorer and never any other server.
 */
export function lookupThroughChainServers<T>(
  network: Network,
  settings: ServerSettings,
  run: (backend: BackendConfig) => Promise<T>,
): Promise<T> {
  return throughChainServers(
    network,
    settings,
    (backend) => run({ ...backend, retry: ADDRESS_LOOKUP_RETRY, timeout: ADDRESS_LOOKUP_TIMEOUT_S }),
    { failOver: serverFailed, attemptMs: ADDRESS_LOOKUP_ATTEMPT_MS, label: 'Address check' },
  );
}

/**
 * How long the RESCUE's broadcast waits for its answer: the same watchdog
 * as a sync, the 90 seconds for a Bitcoin vault's one server and each
 * Testnet4 server's share of them (2026-10-19). Both are above the
 * longest a silent server keeps the native call by itself
 * (`silentServerGivesUpMs`: 66 s with the Bitcoin settings, 16 s with
 * Testnet4's), so a slow server that still answers is not cut short.
 *
 * The watchdog gives up in JavaScript only: it cannot stop the native
 * call, and a broadcast waits on the same serial native queue as every
 * sync (native/bdkwallet/bridge/TaliaBdkWalletModule.swift `walletQueue`).
 * A broadcast it
 * gave up on can still go out afterwards. So only a screen that then asks
 * the chain and keeps listening for the late answer may use it
 * (`broadcastWithWatchdog`: the rescue, ui/screens/RescueScreen.tsx); a
 * screen that would say "Could not send" for a payment that is merely
 * queued must not (decided 2026-10-19), and `broadcastThroughChainServers`
 * waits for the native answer as it always did.
 */
export const BROADCAST_WATCHDOG_MS = SYNC_WATCHDOG_MS;
export const TESTNET4_BROADCAST_ATTEMPT_MS = TESTNET4_SYNC_ATTEMPT_MS;

/**
 * A broadcast, through the vault's servers. Testnet4 moves on only when a
 * server could not be reached: a refusal is the network's answer, and the
 * same transaction would meet it everywhere. No JavaScript time limit: it
 * waits for the native answer (see `BROADCAST_WATCHDOG_MS` for why).
 */
export function broadcastThroughChainServers<T>(
  network: Network,
  settings: ServerSettings,
  run: (backend: BackendConfig) => Promise<T>,
): Promise<T> {
  return throughChainServers(network, settings, run, { failOver: serverUnreachable });
}

/**
 * The rescue's broadcast: `broadcastThroughChainServers` with the
 * watchdog (`BROADCAST_WATCHDOG_MS`). A Testnet4 server that does not
 * answer in its share is treated like one that could not be reached, and
 * the next one is asked; sending the same signed transaction again is
 * harmless, the network knows it by its txid. A Bitcoin vault still uses
 * its one server and no other. The caller keeps every attempt it started
 * (`run`): one the watchdog gave up on may still answer later.
 */
export function broadcastWithWatchdog<T>(
  network: Network,
  settings: ServerSettings,
  run: (backend: BackendConfig) => Promise<T>,
): Promise<T> {
  return throughChainServers(network, settings, run, {
    failOver: serverUnreachable,
    attemptMs: usesBuiltInServers(network) ? TESTNET4_BROADCAST_ATTEMPT_MS : BROADCAST_WATCHDOG_MS,
    label: 'Broadcast',
  });
}

/**
 * The plain note about the Bitcoin server the client chose, or null.
 *
 * While the settings hold a server back (`serverHold`: an old Esplora
 * server, or settings that could not be read), the note says so on the
 * vault and in Settings → Network, whether or not a sync was tried: the
 * vault syncs through no server until the client enters theirs or resets.
 *
 * A server Talia once suggested that was renamed or retired says so on the
 * vault and in Settings → Network (it fails the certificate check under the
 * saved name, and is never swapped behind the client's back). On the vault,
 * a sync that failed through the chosen server says that Talia uses no
 * other. True for a home node and for a public server alike: "the server
 * you chose".
 */
export function chainServerNote(
  network: Network,
  settings: ServerSettings,
  opts: { where: 'vault' | 'settings'; syncFailed?: boolean },
): string | null {
  if (network !== 'bitcoin') return null;
  const hold = serverHold(network, settings);
  if (hold?.reason === 'esplora') {
    const said = `Talia can no longer use ${hold.host}, the server you chose, as it was set up.`;
    return opts.where === 'settings' ? `${said} Enter it again and tap Save & test.` : `${said} Enter it again in Settings → Network.`;
  }
  if (hold) {
    // The stored settings could not be read: whether the client chose a
    // server, and which, is not known, so the words hold either way.
    return opts.where === 'settings'
      ? 'Talia could not read its network settings. Enter your server and tap Save & test, or tap Reset to default server.'
      : 'Talia could not read its network settings and uses no server until you check them in Settings → Network.';
  }
  const chosen = chosenServer(network, settings);
  if (!chosen) return null;
  const host = electrumHost(chosen);
  const notice = savedServerNotice(chosen);
  if (opts.where === 'settings') {
    if (notice?.kind === 'renamed') return `This server now goes by ${electrumHost(notice.to)}.`;
    if (notice?.kind === 'retired') return 'This server can no longer be checked as safe. Choose another one.';
    return null;
  }
  if (notice?.kind === 'renamed') {
    return `The server you chose now goes by ${electrumHost(notice.to)}. Change it in Settings → Network.`;
  }
  if (notice?.kind === 'retired') {
    return `The server you chose, ${host}, can no longer be checked as safe. Choose another one in Settings → Network.`;
  }
  if (opts.syncFailed) {
    return `Talia could not reach ${host}, the server you chose, and uses no other. Check it in Settings → Network.`;
  }
  return null;
}

/** The vault page's one line about its server and its last sync: plain words, or the library's own text. */
export interface SyncProblemNote {
  text: string;
  /** 'note': a sentence in Talia's words; 'error': the library's own text, for a failure no sentence covers. */
  tone: 'note' | 'error';
}

/**
 * The ONE line the vault page shows about its server and its last sync, or
 * null (decided 2026-10-29: a failed sync through the chosen server showed
 * two lines saying the same, the plain sentence and the library's text).
 * When the wallet library refused to open the vault, its own sentence is the
 * line, exactly as written and before any note about the server, because no
 * sync reached one (decided 2026-11-04: the approved text read "Sync failed:"
 * first, or not at all under a standing note).
 * A standing note about the chosen server (held, renamed, retired) comes
 * next and covers any failure that follows from it. A server that could not
 * be reached is named in plain words on EVERY network, the default Bitcoin
 * server and Testnet4's built-in servers included, so a failed sync is never
 * silent. Any other failure keeps the library's text: no plain sentence
 * would be true for every one of them.
 */
export function syncProblemNote(network: Network, settings: ServerSettings, syncError: unknown): SyncProblemNote | null {
  const library = libraryProblem(syncError);
  if (library) return { text: library, tone: 'note' };
  const standing = chainServerNote(network, settings, { where: 'vault' });
  if (standing) return { text: standing, tone: 'note' };
  if (syncError == null) return null;
  const message = syncError instanceof Error ? syncError.message : String(syncError);
  if (message === NO_TESTNET4_SERVER_ANSWERED) return { text: message, tone: 'note' };
  if (serverUnreachable(syncError)) {
    if (chosenServer(network, settings)) {
      const chosen = chainServerNote(network, settings, { where: 'vault', syncFailed: true });
      if (chosen) return { text: chosen, tone: 'note' };
    }
    const servers = chainServersFor(network, settings);
    if (servers.length === 1) {
      const host = electrumHost(servers[0].url);
      return {
        text: `Talia could not reach ${host}, its default server, and uses no other. Try again later, or choose another server in Settings → Network.`,
        tone: 'note',
      };
    }
    // Testnet4, a failure that did not come through `throughChainServers`
    // (the engine's own sync after a panic): one server said nothing, so
    // `NO_TESTNET4_SERVER_ANSWERED` would claim more than is known.
    if (servers.length > 1) return { text: `Talia could not reach a ${NETWORK_LABELS.testnet} server. Try again later.`, tone: 'note' };
  }
  return { text: `Sync failed: ${message}`, tone: 'error' };
}
