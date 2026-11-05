/**
 * A vault saved on Signet moves to Testnet4 at start (decided 2026-10-18: "remove
 * signet, keep only bitcoin and testnet4"). A tester built a vault on Signet without
 * knowing it, and a Testnet4 payment to its address never showed: a tb1
 * address reads the same on both chains, and the vault was watching the
 * other one. After the move it watches Testnet4, keeps everything else, and
 * forgets what it cached of Signet.
 */
jest.mock('react-native-keychain', () => require('../../testing/memoryKeychain'));
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { moveVaultsOffSignet } from '../signetVaults';
import { __forgetWalletsReadForTests, loadWallets } from '../storage';
import { __resetSealedStoreForTests, sealedGetItem, sealedSetItem } from '../sealedStore';
import { loadTxCache, saveTxCache } from '../txCache';
import { loadUtxoCache, saveUtxoCache } from '../utxoCache';
import { loadAddrCache, saveAddrCache } from '../addrCache';
import type { WalletMeta } from '../types';
import { DEFAULT_ELECTRUM, DEFAULT_ESPLORA, NETWORK_LABELS, NETWORK_TICKERS } from '../../bitcoin/network';
import { mempoolTxUrl } from '../explorer';
import { addressFitsNetwork } from '../../bitcoin/addressNetwork';
import { scriptToAddress } from '../../bitcoin/psbt/parse';
import { bitcoinAppFor } from '../../bitcoin/ledger/version';
import { networkNote } from '../networkNote';
import { standardOriginPath } from '../descriptorOrigin';
import { getTxEta } from '../mempoolBlocks';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mem = require('../../testing/memoryKeychain') as typeof import('../../testing/memoryKeychain');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const disk = (require('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;

const WALLETS_KEY = 'keel.wallets.v1';
const DESCRIPTOR =
  "wpkh([73c5da0a/84'/1'/0']tpubDCwYjpDhUdPGP5rS3wgNg13mTrrjBuG8V9VpWbyptX6TRPbNoZVXsoVUSkCjmQ8jJycjuDKBb9eataSymXakTTaGifxR6kmVsfFehH1ZgJT/<0;1>/*)";

/** The test vault as a phone set to Signet stored it. */
const SIGNET_VAULT = {
  id: 'w_signet',
  label: 'Test vault',
  descriptor: DESCRIPTOR,
  network: 'signet',
  kind: 'single-sig',
  source: 'created',
  transport: 'created',
  createdAt: 1_760_000_000_000,
  keyLabels: { '73c5da0a': 'Gen5' },
  keyDevices: { '73c5da0a': { kind: 'ledger', model: 'gen5' } },
  frozenUtxos: [],
  cachedBalanceSats: 50_000,
  cachedBalanceAt: 1_760_000_100_000,
  cachedExpiryBlocks: 1200,
  cachedExpiryAt: 1_760_000_100_000,
} as unknown as WalletMeta;

/** The same vault once moved: Testnet4, the Signet caches gone, the rest kept. */
const { cachedBalanceSats: _b, cachedBalanceAt: _ba, cachedExpiryBlocks: _e, cachedExpiryAt: _ea, ...KEPT } =
  SIGNET_VAULT as unknown as Record<string, unknown>;
const MOVED = { ...KEPT, network: 'testnet' };

const MAINNET_VAULT = {
  ...SIGNET_VAULT,
  id: 'w_main',
  label: 'Savings',
  network: 'bitcoin',
} as unknown as WalletMeta;
const TESTNET_VAULT = { ...SIGNET_VAULT, id: 'w_test', network: 'testnet' } as unknown as WalletMeta;

const TX = [{ txid: 'aa'.repeat(32), received: 50_000, sent: 0, confirmationTime: { height: 100, timestamp: 1 } }];

beforeEach(() => {
  mem.__reset();
  disk.clear();
  __resetSealedStoreForTests();
  __forgetWalletsReadForTests();
  jest.restoreAllMocks();
});

describe('moveVaultsOffSignet', () => {
  it('moves a Signet vault to Testnet4 and drops what it cached of Signet', () => {
    expect(moveVaultsOffSignet([SIGNET_VAULT])).toEqual({ wallets: [MOVED], moved: ['w_signet'] });
  });

  it('keeps every other vault as it is, in its place', () => {
    const out = moveVaultsOffSignet([MAINNET_VAULT, SIGNET_VAULT, TESTNET_VAULT]);
    expect(out?.wallets).toEqual([MAINNET_VAULT, MOVED, TESTNET_VAULT]);
    expect(out?.wallets[0]).toBe(MAINNET_VAULT);
    expect(out?.wallets[2]).toBe(TESTNET_VAULT);
    expect(out?.moved).toEqual(['w_signet']);
  });

  it('moves nothing when no vault is on Signet, or the list holds something odd', () => {
    expect(moveVaultsOffSignet([])).toBeNull();
    expect(moveVaultsOffSignet([MAINNET_VAULT, TESTNET_VAULT])).toBeNull();
    expect(moveVaultsOffSignet([null, 5, 'signet', ['signet'], { network: 'regtest' }])).toBeNull();
  });

  it('is done once: a moved list moves nothing more', () => {
    const once = moveVaultsOffSignet([MAINNET_VAULT, SIGNET_VAULT]);
    expect(moveVaultsOffSignet(once!.wallets)).toBeNull();
  });
});

describe('at start', () => {
  async function storeList(list: unknown[]): Promise<void> {
    await sealedSetItem(WALLETS_KEY, JSON.stringify(list));
    __resetSealedStoreForTests();
  }
  async function stored(): Promise<unknown[]> {
    return JSON.parse((await sealedGetItem(WALLETS_KEY))!);
  }
  async function seedCaches(id: string): Promise<void> {
    await saveTxCache(id, TX as never);
    await saveUtxoCache(id, [], 100);
    await saveAddrCache(id, { firstUnused: 3, unused: [], used: [], updatedAt: 1 });
  }

  it('loads the vault on Testnet4, stores it so, and clears its Signet caches alone', async () => {
    await storeList([MAINNET_VAULT, SIGNET_VAULT]);
    await seedCaches('w_signet');
    await seedCaches('w_main');
    const loaded = await loadWallets();
    expect(loaded).toEqual([MAINNET_VAULT, MOVED]);
    expect(await stored()).toEqual([MAINNET_VAULT, MOVED]);
    expect(await loadTxCache('w_signet')).toBeNull();
    expect(await loadUtxoCache('w_signet')).toBeNull();
    expect(await loadAddrCache('w_signet')).toBeNull();
    expect(await loadTxCache('w_main')).toEqual(TX);
    expect(await loadUtxoCache('w_main')).not.toBeNull();
    expect(await loadAddrCache('w_main')).not.toBeNull();
  });

  it('happens once: the next start writes nothing and keeps what Testnet4 cached', async () => {
    await storeList([SIGNET_VAULT]);
    await loadWallets();
    // The first sync on Testnet4 fills the caches again.
    await seedCaches('w_signet');
    __forgetWalletsReadForTests();
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    expect(await loadWallets()).toEqual([MOVED]);
    expect(setItem).not.toHaveBeenCalledWith(WALLETS_KEY, expect.anything());
    expect(await loadTxCache('w_signet')).toEqual(TX);
  });

  it('writes nothing for a list with no Signet vault', async () => {
    await storeList([MAINNET_VAULT, TESTNET_VAULT]);
    await seedCaches('w_test');
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    expect(await loadWallets()).toEqual([MAINNET_VAULT, TESTNET_VAULT]);
    expect(setItem).not.toHaveBeenCalledWith(WALLETS_KEY, expect.anything());
    expect(await loadTxCache('w_test')).toEqual(TX);
  });

  it('still moves for this run when the list cannot be written, and tries again next start', async () => {
    await storeList([SIGNET_VAULT]);
    const realSet = AsyncStorage.setItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async () => {
      throw new Error('disk full');
    });
    expect(await loadWallets()).toEqual([MOVED]);
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(realSet);
    expect(((await stored())[0] as WalletMeta).network).toBe('signet');
    __forgetWalletsReadForTests();
    expect(await loadWallets()).toEqual([MOVED]);
    expect(((await stored())[0] as WalletMeta).network).toBe('testnet');
  });

  /** The moved vault's cache entries still on disk. */
  const signetCachesLeft = () =>
    ['keel.txcache.v1:', 'keel.utxocache.v1:', 'keel.addrcache.v1:']
      .map((prefix) => prefix + 'w_signet')
      .filter((key) => disk.has(key));

  it('clears the Signet caches before it stores the moved list, so a kill after the write leaves none', async () => {
    await storeList([SIGNET_VAULT]);
    await seedCaches('w_signet');
    expect(signetCachesLeft()).toHaveLength(3);
    const realSet = AsyncStorage.setItem.bind(AsyncStorage);
    let leftAtWrite: string[] | undefined;
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key: string, value: string) => {
      if (key === WALLETS_KEY) leftAtWrite = signetCachesLeft();
      return realSet(key, value);
    });
    await loadWallets();
    // The stored list is the "moved" mark: once it is written, the next
    // start moves nothing and clears nothing, so nothing may be left.
    expect(leftAtWrite).toEqual([]);
  });

  it('killed at the write, after the clears: the next start moves, clears and stores again', async () => {
    await storeList([SIGNET_VAULT]);
    await seedCaches('w_signet');
    const realSet = AsyncStorage.setItem.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key: string, value: string) => {
      if (key === WALLETS_KEY) throw new Error('killed');
      return realSet(key, value);
    });
    await loadWallets();
    expect(signetCachesLeft()).toEqual([]);
    expect(((await stored())[0] as WalletMeta).network).toBe('signet');
    // Whatever was cached again before the next start goes too.
    await seedCaches('w_signet');
    jest.spyOn(AsyncStorage, 'setItem').mockImplementation(realSet);
    __forgetWalletsReadForTests();
    expect(await loadWallets()).toEqual([MOVED]);
    expect(signetCachesLeft()).toEqual([]);
    expect(await stored()).toEqual([MOVED]);
  });
});

describe('a moved vault works as any Testnet4 vault', () => {
  const vault = moveVaultsOffSignet([SIGNET_VAULT])!.wallets[0];
  const network = vault.network;
  const P2WPKH = Uint8Array.from(Buffer.from('0014751e76e8199196d454941c45d1b3a323f1433bd6', 'hex'));

  it('syncs through the Testnet4 server and opens Testnet4 pages', () => {
    expect(network).toBe('testnet');
    expect(DEFAULT_ELECTRUM[network]).toBe('ssl://blackie.c3-soft.com:57010');
    expect(DEFAULT_ESPLORA[network]).toBe('https://mempool.space/testnet4/api');
    expect(mempoolTxUrl(network, 'ab'.repeat(32))).toBe(`https://mempool.space/testnet4/tx/${'ab'.repeat(32)}`);
  });

  it('keeps its addresses: tb1 is the same on both chains, and still refused on the main network', () => {
    const tb1 = scriptToAddress(P2WPKH, network)!;
    expect(tb1.startsWith('tb1')).toBe(true);
    expect(scriptToAddress(P2WPKH, 'signet')).toBe(tb1);
    expect(addressFitsNetwork(tb1, network)).toBe(true);
    expect(addressFitsNetwork(scriptToAddress(P2WPKH, 'bitcoin')!, network)).toBe(false);
  });

  it('asks the Ledger for its test app, keeps its test key path and is named Testnet4', async () => {
    expect(bitcoinAppFor(network)).toBe('Bitcoin Test');
    expect(standardOriginPath(vault.descriptor, network)).toBe(standardOriginPath(vault.descriptor, 'signet'));
    expect(NETWORK_LABELS[network]).toBe('Testnet4');
    expect(NETWORK_TICKERS[network]).toBe('tBTC');
    expect(networkNote(network)).toBe('Test network');
    // The main network's fee sources say nothing about a test chain.
    expect(await getTxEta(5, network)).toBeNull();
  });
});
