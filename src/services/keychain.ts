/**
 * The ONE way this app writes a secret to the iOS Keychain (decided
 * 2026-09-26).
 *
 * Every item is written THIS-DEVICE-ONLY: it never travels in an encrypted
 * iTunes/Finder backup, never restores onto another phone and never syncs
 * through iCloud Keychain. react-native-keychain's own default is
 * AfterFirstUnlock WITHOUT ThisDeviceOnly, which is backup-migratable; two
 * items (the portfolio-sync credential and the BitBox pairing key) were
 * written that way because a call site simply forgot the option. A call
 * site cannot forget it any more: `setSecret` has no way to leave it out,
 * and `keychainPolicy.test.ts` fails on any `setGenericPassword` outside
 * this file.
 *
 *   'foreground' (the default) = WHEN_UNLOCKED_THIS_DEVICE_ONLY: readable
 *     only while the phone is unlocked. Session tokens, exchange keys, sync
 *     keys, invite codes, the BitBox pairing key, the app PIN verifier, the
 *     at-rest store key (wallet/sealedStore).
 *   'background' = AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: also readable while
 *     the phone is locked (after the first unlock since boot). Nothing uses
 *     it today; it is only for a secret a background task would need, and
 *     such a secret is in a forensic copy of a locked phone.
 *
 * Reads distinguish "there is no such item" (null) from "the Keychain could
 * not answer" (a throw): a caller that would CREATE a fresh secret on a miss
 * must never do so on an error, or it would overwrite a real one.
 */
import * as Keychain from 'react-native-keychain';

export type SecretAvailability = 'foreground' | 'background';

function accessibleFor(availability: SecretAvailability): Keychain.ACCESSIBLE {
  return availability === 'background'
    ? Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
    : Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY;
}

/** Write (or overwrite) one secret, this device only. */
export async function setSecret(
  service: string,
  username: string,
  value: string,
  availability: SecretAvailability = 'foreground',
): Promise<void> {
  const ok = await Keychain.setGenericPassword(username, value, {
    service,
    accessible: accessibleFor(availability),
  });
  if (ok === false) throw new Error('The phone could not store this securely.');
}

/** The secret, null when no item exists. THROWS when the Keychain could not
 *  be read (locked phone, interaction not allowed): that is not a miss. */
export async function getSecretStrict(service: string): Promise<string | null> {
  const item = await Keychain.getGenericPassword({ service });
  return item ? item.password : null;
}

/** The secret, or null for a miss OR an unreadable item. For callers whose
 *  fallback on failure is harmless (they never mint a replacement). */
export async function getSecret(service: string): Promise<string | null> {
  try {
    return await getSecretStrict(service);
  } catch {
    return null;
  }
}

/** Remove one secret. Nothing stored is the state we want anyway. */
export async function deleteSecret(service: string): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service });
  } catch {
    // already gone
  }
}
