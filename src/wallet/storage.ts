/**
 * Persistence for wallet metadata and app settings via AsyncStorage.
 *
 * The WALLET LIST is sealed at rest (./sealedStore, decided
 * 2026-09-26): descriptors hold every key of every vault and
 * the heirs' names and emails, which is what a forensic copy of a phone must
 * not read. Settings are display preferences and stay plain; the app PIN's
 * verifier moved out of them into the Keychain (./pin).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { sealedGetItem, sealedSetItem } from './sealedStore';
import type { AppSettings, WalletMeta } from './types';
import { DEFAULT_NETWORK } from '../bitcoin/network';
import { moveOffEsplora, moveOffSignet, moveOffTestnetSettings } from './settingsMigration';
import { moveVaultsOffSignet } from './signetVaults';
import { clearTxCache } from './txCache';
import { clearUtxoCache } from './utxoCache';
import { clearAddrCache } from './addrCache';

const WALLETS_KEY = 'keel.wallets.v1';
// v2: default network changed to mainnet (2026-07-14); bumping the key applies
// the new default to existing installs rather than pinning their old one.
const SETTINGS_KEY = 'keel.settings.v2';

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'system',
  defaultNetwork: DEFAULT_NETWORK,
  backendType: 'electrum',
  electrumUrls: {},
  unit: 'btc',
  fiat: 'USD',
  hideBalances: false,
  biometricsEnabled: false,
  requireAuthOnOpen: false,
  requireAuthToUnhide: false,
  hiddenCategories: [],
};

/**
 * The vault list was read in this run of the app. Until it has been, no save
 * is taken: a list built while the stored one could not be read (the
 * Keychain not answering, the store key missing) would replace the real one.
 */
let walletsRead = false;

/** The stored vault list. THROWS when the sealed list cannot be opened right
 *  now (sealedStore): the caller must retry or let the owner choose, never
 *  carry on with an empty list. */
export async function loadWallets(): Promise<WalletMeta[]> {
  const raw = await sealedGetItem(WALLETS_KEY);
  walletsRead = true;
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  // A vault saved on Signet moves to Testnet4, once: stored straight away,
  // so the next start finds nothing to move, and what it cached of Signet
  // (history, coins, addresses) goes, so it shows Testnet4's own coins.
  // The caches go FIRST: the stored list is the "moved" mark, so it is
  // written only once nothing of Signet is left. An app killed in between
  // still finds the vault on Signet next start and moves and clears again
  // (the clears never throw and are harmless twice).
  const offSignet = moveVaultsOffSignet(parsed);
  if (!offSignet) return parsed as WalletMeta[];
  for (const id of offSignet.moved) {
    await clearTxCache(id);
    await clearUtxoCache(id);
    await clearAddrCache(id);
  }
  try {
    await sealedSetItem(WALLETS_KEY, JSON.stringify(offSignet.wallets));
  } catch {
    // Moved for this run all the same; the next start tries again.
  }
  return offSignet.wallets;
}

/** Refused (throws) until `loadWallets` has read the stored list. */
export async function saveWallets(wallets: WalletMeta[]): Promise<void> {
  if (!walletsRead) throw new Error('The saved vaults have not been read yet.');
  await sealedSetItem(WALLETS_KEY, JSON.stringify(wallets));
}

/** Tests only: a fresh launch, before the list was read. */
export function __forgetWalletsReadForTests(): void {
  walletsRead = false;
}

/**
 * The stored settings. Nothing stored: the defaults. Stored but unreadable
 * (damaged JSON, not an object, or a saved server that is not one): the
 * defaults with the Bitcoin server HELD (`bitcoinServerHold` 'unreadable'),
 * because the client may have chosen their own node and the public default
 * must never take its place (decided 2026-10-18, wallet/chainServers.ts). The
 * hold is saved with the next change of settings, so it lasts until the
 * client saves a server or resets to the default. THROWS when the store
 * itself does not answer: the caller then knows nothing (WalletProvider
 * syncs nothing until the settings are read).
 */
export async function loadSettings(): Promise<AppSettings> {
  const raw = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    let stored = JSON.parse(raw) as unknown;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return UNREADABLE_SETTINGS;
    // A saved Esplora server becomes the default Electrum server, a saved
    // Signet choice becomes Testnet4, and the Testnet4 settings go (its
    // vaults use the built-in servers), once: stored straight away, so the
    // next start finds nothing to move.
    const offEsplora = moveOffEsplora(stored);
    if (offEsplora) stored = offEsplora;
    const offSignet = moveOffSignet(stored);
    if (offSignet) stored = offSignet;
    const offTestnet = moveOffTestnetSettings(stored);
    if (offTestnet) stored = offTestnet;
    if (offEsplora || offSignet || offTestnet) {
      try {
        await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
      } catch {
        // Moved for this run all the same; the next start tries again.
      }
    }
    // An older install stored its Esplora servers too; nothing reads them now.
    const { esploraUrls: _unused, ...kept } = (stored ?? {}) as Partial<AppSettings> & { esploraUrls?: unknown };
    // A saved Bitcoin server is used exactly as saved, never rewritten or
    // dropped for another (decided 2026-10-18; a renamed or retired one earns a
    // note instead, wallet/chainServers.ts `chainServerNote`).
    const merged = { ...DEFAULT_SETTINGS, ...kept };
    const servers = savedServers(merged.electrumUrls);
    const hold = savedHold(merged.bitcoinServerHold, servers === null);
    const { bitcoinServerHold: _stored, ...rest } = merged;
    return { ...rest, electrumUrls: servers ?? {}, ...(hold ? { bitcoinServerHold: hold } : {}) };
  } catch {
    return UNREADABLE_SETTINGS;
  }
}

/** Settings that were stored but could not be read: the defaults, with the
 *  Bitcoin server held (see `loadSettings`). */
const UNREADABLE_SETTINGS: AppSettings = { ...DEFAULT_SETTINGS, bitcoinServerHold: { reason: 'unreadable' } };

/** The saved servers as stored, keeping only the entries that name one;
 *  nothing is renamed. Null when what is stored cannot be read as servers
 *  (not an object, or a Bitcoin entry that is not text): which server the
 *  client chose is then not known. */
function savedServers(urls: unknown): AppSettings['electrumUrls'] | null {
  if (!urls || typeof urls !== 'object' || Array.isArray(urls)) return null;
  const entries = urls as Record<string, unknown>;
  if ('bitcoin' in entries && entries.bitcoin != null && typeof entries.bitcoin !== 'string') return null;
  const out: Record<string, string> = {};
  for (const [network, url] of Object.entries(entries)) {
    if (typeof url === 'string') out[network] = url;
  }
  return out as AppSettings['electrumUrls'];
}

/** The stored hold, or 'unreadable' when it, or the saved servers, cannot
 *  be read. Never dropped for being odd: that would mean the default. */
function savedHold(value: unknown, serversUnreadable: boolean): AppSettings['bitcoinServerHold'] {
  if (serversUnreadable) return { reason: 'unreadable' };
  if (value == null) return undefined;
  const hold = value as { reason?: unknown; host?: unknown };
  if (hold.reason === 'esplora' && typeof hold.host === 'string' && hold.host.trim()) return { reason: 'esplora', host: hold.host };
  return { reason: 'unreadable' };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** Small, dependency-free unique id for a wallet record. */
export function newWalletId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `w_${Date.now().toString(36)}_${rand}`;
}
