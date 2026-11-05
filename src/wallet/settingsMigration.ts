/**
 * A saved Esplora server becomes an Electrum one (decided 2026-10-07: "Quick
 * fixes, then upgrade", and yes to moving those installs).
 *
 * Settings have offered Electrum only since 2026-07, but an install that
 * saved the older Esplora server type before then kept syncing through it,
 * on a connection whose security warnings cannot be fixed. At start such a
 * setting moves to Electrum, and the caller stores the result, so it happens
 * once. Pure: `loadSettings` (./storage) reads and writes.
 */
import { DEFAULT_ESPLORA } from '../bitcoin/network';

/** The settings as stored: any shape an older install may have written. */
export type StoredSettings = Record<string, unknown>;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** An Esplora address as a comparable value: trimmed, no trailing slash. */
const sameServer = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

/** "umbrel.local:3006" from "http://umbrel.local:3006/api": the server's
 *  name and port, without the scheme, a login or the path. */
export function esploraHost(url: string): string {
  const trimmed = url.trim();
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(trimmed)?.[1] ?? trimmed.split(/[/?#]/)[0];
  return authority.replace(/^[^@]*@/, '') || trimmed;
}

/**
 * The stored settings moved off Esplora, or null when they never named it
 * (nothing to do, nothing to write). Every other stored value is kept as it
 * was, and the Esplora servers go. The Electrum servers are cleared, so each
 * network uses its default, EXCEPT where that would send a Bitcoin vault to
 * a server the client did not choose (decided 2026-10-18: "we should never leak
 * their vaults to any other node", wallet/chainServers.ts):
 *  - a Bitcoin Electrum server the client saved is kept (an install that
 *    once typed its own node and then switched to Esplora keeps that node);
 *  - with none, a Bitcoin Esplora server of their own (any but the public
 *    default, which the old page never saved) becomes a HOLD
 *    (`bitcoinServerHold`): Bitcoin vaults use no server until the client
 *    enters one in Settings → Network, and the vault says so. Talia cannot
 *    know that server's Electrum address, and the public default would send
 *    every vault address to Blockstream.
 * A client who had picked the public Esplora default moves to the public
 * Electrum default, as before.
 */
export function moveOffEsplora(stored: unknown): StoredSettings | null {
  if (!isRecord(stored)) return null;
  const { esploraUrls, ...rest } = stored;
  if (rest.backendType !== 'esplora') return null;
  const savedBitcoin = isRecord(rest.electrumUrls) ? rest.electrumUrls.bitcoin : undefined;
  if (typeof savedBitcoin === 'string' && savedBitcoin.trim()) {
    return { ...rest, backendType: 'electrum', electrumUrls: { bitcoin: savedBitcoin } };
  }
  const oldBitcoin = isRecord(esploraUrls) ? esploraUrls.bitcoin : undefined;
  const ownEsplora =
    typeof oldBitcoin === 'string' && !!oldBitcoin.trim() && sameServer(oldBitcoin) !== sameServer(DEFAULT_ESPLORA.bitcoin);
  return {
    ...rest,
    backendType: 'electrum',
    electrumUrls: {},
    ...(ownEsplora ? { bitcoinServerHold: { reason: 'esplora', host: esploraHost(oldBitcoin) } } : {}),
  };
}

/**
 * A phone whose saved network was Signet moves to Testnet4 (decided 2026-10-18:
 * "remove signet, keep only bitcoin and testnet4").
 *
 * Settings → Network offers Bitcoin and Testnet4 only, so a saved choice of
 * Signet would keep every new test-key vault landing on a network no screen
 * shows or lets anyone change. A saved Signet server goes too: nothing edits
 * it any more, and no vault is left to use it, because every vault saved on
 * Signet moves to Testnet4 at start as well (./signetVaults.ts). Pure, like
 * `moveOffEsplora`: null when there is nothing to move (nothing to write),
 * and every other stored value is kept.
 */
export function moveOffSignet(stored: unknown): StoredSettings | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const settings = stored as StoredSettings;
  const urls = settings.electrumUrls;
  const savedServer =
    !!urls && typeof urls === 'object' && !Array.isArray(urls) && 'signet' in urls;
  const savedChoice = settings.defaultNetwork === 'signet';
  if (!savedChoice && !savedServer) return null;
  const moved: StoredSettings = { ...settings };
  if (savedChoice) moved.defaultNetwork = 'testnet';
  if (savedServer) {
    const { signet: _dropped, ...kept } = urls as Record<string, unknown>;
    moved.electrumUrls = kept;
  }
  return moved;
}

/**
 * The phone's Testnet4 settings go (decided 2026-10-18: "can we also remove the
 * testnet settings completely and just have testnet vaults sync
 * automatically to public nodes?").
 *
 * Settings → Network edits the Bitcoin server alone now, and every Testnet4
 * vault syncs through the built-in public servers (bitcoin/network.ts
 * `TESTNET4_ELECTRUM_SERVERS`), so a saved Testnet4 server (and a Signet one
 * an older install may still carry) is dropped: nothing would read it, and
 * nothing could show or change it. The saved network choice goes back to
 * Bitcoin too: it was the radio row on that page, the page no longer has
 * it, and a phone left on Testnet4 would keep reading hardware keys as test
 * keys with no way to change it. A Testnet4 vault is still built through the
 * vault configurator's own network chooser, and a test key (tpub) still
 * lands on Testnet4 by itself (`testNetworkFor`). Regtest, which only a
 * developer sets by hand, stays.
 *
 * Pure, like `moveOffEsplora`: null when there is nothing to move (nothing
 * to write), every other stored value kept; run once at start and stored at
 * once (./storage), and a second run finds nothing.
 */
export function moveOffTestnetSettings(stored: unknown): StoredSettings | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const settings = stored as StoredSettings;
  const urls = settings.electrumUrls;
  const savedTestServer =
    !!urls &&
    typeof urls === 'object' &&
    !Array.isArray(urls) &&
    ('testnet' in urls || 'signet' in urls);
  const savedTestChoice = settings.defaultNetwork === 'testnet' || settings.defaultNetwork === 'signet';
  if (!savedTestServer && !savedTestChoice) return null;
  const moved: StoredSettings = { ...settings };
  if (savedTestChoice) moved.defaultNetwork = 'bitcoin';
  if (savedTestServer) {
    const { testnet: _testnet, signet: _signet, ...kept } = urls as Record<string, unknown>;
    moved.electrumUrls = kept;
  }
  return moved;
}
