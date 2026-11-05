/**
 * When Talia checks an Electrum server's TLS certificate (decided
 * 2026-09-26).
 *
 * Every server the user typed used to connect with the certificate check
 * switched OFF, the suggested public servers included, and the connection
 * test quietly retried a failed `ssl://` as plain `tcp://` and saved that.
 * Anyone on the network path (public Wi-Fi, a hostile ISP, a hijacked name)
 * could then read every address of every vault and feed the app false
 * balances, confirmations and ages, which also drive the heir release date.
 *
 * The rule now, in one place:
 *  - A server named by a HOSTNAME on the internet is checked against the
 *    phone's trusted certificates, like any website. A self-made
 *    certificate there is refused, never silently accepted.
 *  - Only a server on the user's own network (private and loopback
 *    addresses, `.local`, `localhost`) or a Tor `.onion` skips the check:
 *    those are the personal nodes that carry a self-made certificate (or a
 *    bare IP no certificate can name), and the path to them does not cross
 *    the internet.
 *  - Falling back to an unencrypted connection is allowed only for those
 *    same local and Tor servers.
 *
 * The wallet library's bridge (native/bdkwallet, bdk-ffi 3.1.1 since the old
 * engine's removal, decided 2026-11-04; bdk-rn 0.30 before) has no
 * certificate pinning, so a pinned or trust-on-first-use certificate for a
 * personal server on the internet needs a native change.
 */

/** The host of an `ssl://host:port` or `tcp://host:port` URL, lowercase. */
export function electrumHost(url: string): string {
  const rest = url.trim().replace(/^[a-z]+:\/\//i, '');
  if (rest.startsWith('[')) return rest.slice(1, rest.indexOf(']')).toLowerCase();
  return rest.split(/[:/]/)[0].toLowerCase();
}

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT: Tailscale and friends
  );
}

function isPrivateIpv6(host: string): boolean {
  if (!host.includes(':')) return false;
  return host === '::1' || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host);
}

/** A server on the user's own network or reached over Tor. */
export function electrumHostIsLocalOrTor(url: string): boolean {
  const host = electrumHost(url);
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.onion') ||
    isPrivateIpv4(host) ||
    isPrivateIpv6(host)
  );
}

/** Must the certificate of this server be checked? */
export function electrumValidatesCertificate(url: string): boolean {
  return !electrumHostIsLocalOrTor(url);
}

/**
 * May this URL be saved as the client's server? An unencrypted `tcp://`
 * connection only to a server on the user's own network or over Tor (the
 * same rule as the fallback below); an internet server needs `ssl://`.
 * URLs saved before this rule keep working.
 */
export function electrumUrlMayBeSaved(url: string): boolean {
  return !/^tcp:\/\//i.test(url.trim()) || electrumHostIsLocalOrTor(url);
}

/** What Settings says when it refuses to save a plain internet server. */
export const PLAIN_INTERNET_REFUSED =
  'Talia connects to servers on the internet only with SSL. Switch SSL on to save this server.';

/** May a failed `ssl://` connection to this server be retried unencrypted? */
export function electrumMayFallBackToPlain(url: string): boolean {
  return electrumHostIsLocalOrTor(url);
}

/**
 * Suggested servers whose saved URL no longer passes the certificate check
 * (probed 2026-09-30 with openssl -verify_hostname):
 *  - mainnet.foundationdevices.com and electrum1.bluewallet.io serve a
 *    certificate for another name of the SAME operator, which verifies.
 *  - bitcoin.lu.ke serves a self-made certificate and has no verified name.
 *
 * These used to be rewritten at start (the new name, or the public default
 * for bitcoin.lu.ke). Not any more (decided 2026-10-18: "if a user prefers a
 * specific public node, we should never automatically fall to any other
 * public node"): a server the client chose is used exactly as saved, and
 * one of these only earns a plain note on the vault and in Settings →
 * Network (wallet/chainServers.ts `chainServerNote`), so the client changes
 * it themselves. Only the exact URLs Talia once suggested are listed.
 */
const RENAMED_SUGGESTED_SERVERS: Readonly<Record<string, string>> = {
  'ssl://mainnet.foundationdevices.com:50002': 'ssl://mainnet-0.foundation.xyz:50002',
  'ssl://electrum1.bluewallet.io:443': 'ssl://electrum2.bluewallet.io:443',
};
const RETIRED_SUGGESTED_SERVERS: ReadonlySet<string> = new Set(['ssl://bitcoin.lu.ke:50002']);

/** What Talia knows about a saved server it once suggested: renamed (the
 *  same operator's verified name) or retired. Null for anything else. */
export type SavedServerNotice = { kind: 'renamed'; to: string } | { kind: 'retired' };

export function savedServerNotice(url: string): SavedServerNotice | null {
  const key = url.trim().toLowerCase();
  if (RETIRED_SUGGESTED_SERVERS.has(key)) return { kind: 'retired' };
  const to = RENAMED_SUGGESTED_SERVERS[key];
  return to ? { kind: 'renamed', to } : null;
}

/** Well-known public Bitcoin Electrum servers users can pick directly in
 *  Settings → Network, the only network it edits (decided 2026-10-18; Testnet4
 *  vaults use bitcoin/network.ts `TESTNET4_ELECTRUM_SERVERS`, with no
 *  setting). Each must carry a certificate the phone can verify, because
 *  Talia checks it for every internet server (decided 2026-09-26): bitcoin.lu.ke
 *  left the list 2026-09-30, its certificate is self-made, and Foundation
 *  and BlueWallet are listed under the names their certificates carry
 *  (probed 2026-09-30). Saved choices of the old entries get a note
 *  (`savedServerNotice`), never a silent change. */
export const SUGGESTED_ELECTRUM_SERVERS: ReadonlyArray<{ host: string; port: string }> = [
  { host: 'electrum.blockstream.info', port: '50002' },
  { host: 'mainnet-0.foundation.xyz', port: '50002' },
  { host: 'electrum2.bluewallet.io', port: '443' },
  { host: 'electrum.acinq.co', port: '50002' },
];
