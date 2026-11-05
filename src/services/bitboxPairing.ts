/**
 * The BitBox pairing memory: the Noise config that makes a later connection
 * codeless.
 *
 * The config holds the app's Noise static private key plus the device public
 * keys we have confirmed a pairing code against. It is a SECRET (whoever has
 * it skips the code comparison on the next connect), so it lives in the iOS
 * Keychain like every other secret in this app, never AsyncStorage
 * (a standing rule since Phase 1).
 *
 * One record for all BitBoxes: the config's device_static_pubkeys is already
 * a LIST, which is exactly how the vendor's own persisted config works.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteSecret, getSecret, getSecretStrict, setSecret } from './keychain';

const SERVICE = 'talia-bitbox-noise';
const USER = 'noise';
/** Set once the item has been rewritten this-device-only (decided 2026-09-26). */
const POLICY_FLAG = 'talia.bitboxNoise.thisDeviceOnly.v1';

export async function loadNoiseConfig(): Promise<string | null> {
  // An unreadable Keychain entry must never block a connection: the honest
  // fallback is a fresh pairing with the code shown again.
  return getSecret(SERVICE);
}

export async function saveNoiseConfig(json: string): Promise<void> {
  await setSecret(SERVICE, USER, json);
}

export async function forgetPairing(): Promise<void> {
  await deleteSecret(SERVICE);
}

/**
 * The pairing key used to be written with the library's default class,
 * which travels in a device backup (decided 2026-09-26).
 * Rewrite it once through `setSecret` (this device only). A read that fails
 * leaves everything as it is and tries again next launch.
 */
export async function upgradeNoiseConfigProtection(): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(POLICY_FLAG)) === '1') return;
    const json = await getSecretStrict(SERVICE);
    if (json != null) await setSecret(SERVICE, USER, json);
    await AsyncStorage.setItem(POLICY_FLAG, '1');
  } catch {
    // try again on the next launch
  }
}
