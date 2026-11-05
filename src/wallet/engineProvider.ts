/**
 * Chooses which WalletEngine implementation the app uses and builds backend
 * configs from settings.
 *
 * Production uses BDK, through the engine provider (bitcoin/engine/
 * engineProvider.ts): bdk-ffi 3.1.1 behind the app's own bridge, in every
 * build flavour, since the old engine's removal (decided 2026-11-04)
 * removed the old engine and the per-flavour choice; a build without the
 * library opens no vault (none ships: Talia is for iPhone only). Flip
 * `USE_FAKE_ENGINE` to true to develop the UI in a simulator with no native
 * BDK build and no live chain backend (the fake serves canned
 * balances/history and a structurally valid PSBT).
 */
import { activeEngineFactory, fakeAddressActivity, fakeWalletEngineFactory, lookUpAddressActivity } from '../bitcoin';
import type { AddressActivity, BackendConfig, WalletEngineFactory } from '../bitcoin/engine/types';
import type { Network } from '../bitcoin/descriptor/types';
import type { AppSettings } from './types';
import { chainServersFor } from './chainServers';

/** Set true for offline UI development without a native BDK build. */
export const USE_FAKE_ENGINE = false;

export async function getEngineFactory(): Promise<WalletEngineFactory> {
  return USE_FAKE_ENGINE ? fakeWalletEngineFactory() : activeEngineFactory();
}

/**
 * The chain backend a vault on this network talks to first: the Bitcoin
 * server saved in Settings → Network exactly as saved (never another one in
 * its place, decided 2026-10-18), else the default; for Testnet4 the built-in
 * server that answered last. Null while the settings hold the Bitcoin
 * server back (./chainServers `serverHold`): there is none to ask. The
 * sync and every broadcast go through ./chainServers, which also moves a
 * Testnet4 vault on to the next server; this is for the one-server
 * questions (Diagnostics' connection test).
 */
export function backendFor(network: Network, settings: AppSettings): BackendConfig | null {
  // Electrum only: a saved Esplora setting moved when the settings loaded
  // (wallet/settingsMigration.ts).
  return chainServersFor(network, settings)[0] ?? null;
}

/**
 * What one server knows about one address (the address book's check,
 * decided 2026-11-05): the wallet library's answer through the engine
 * provider, or the fake's canned one under `USE_FAKE_ENGINE`. Null when the
 * build's bridge has no such call. The server is the caller's, picked
 * through ./chainServers `lookupThroughChainServers`.
 */
export function lookUpActivity(backend: BackendConfig, network: Network, address: string): Promise<AddressActivity | null> {
  return USE_FAKE_ENGINE ? Promise.resolve(fakeAddressActivity(address)) : lookUpAddressActivity(backend, network, address);
}
