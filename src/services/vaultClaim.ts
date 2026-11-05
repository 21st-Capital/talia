/**
 * The vault slot a build has claimed, remembered across app launches.
 *
 * Fetching this vault's 21st Capital keys CONSUMES one of the client's ten
 * account numbers on the backend, and nothing releases it. So if the claim
 * lived only in the creation screen's memory (decided 2026-09-01 review), backing
 * out, a crash, or simply closing the app between the key fetch and a
 * finished vault would strand that number forever: a client on a one-vault
 * plan would then be told "all your vaults are in use" and could never build
 * anything without us editing the database by hand.
 *
 * Remembering the claim makes the next attempt ask for the SAME vault, which
 * the backend answers idempotently with the same keys. The record is cleared
 * only when a vault actually gets built with it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'vault.pendingClaim.v1';

export interface PendingVaultClaim {
  vaultNumber: number;
  /** May be absent while the pool is still being exported this deep. */
  account?: number;
  network: 'mainnet' | 'testnet4';
  /** Lowercased account email, so one device serving two logins cannot hand
   *  one client's claimed number to the other. */
  email: string;
  /** The payer's id when the claimed vault is one the client HOLDS of
   *  somebody else's plan (decided 2026-09-19): a retry must name it again. */
  heldOf?: number;
}

export async function loadPendingClaim(): Promise<PendingVaultClaim | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingVaultClaim;
    return typeof v?.vaultNumber === 'number' && typeof v?.email === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** The slot to ask for on this network for this account, if one is pending. */
export async function pendingClaimFor(
  email: string,
  network: 'mainnet' | 'testnet4',
): Promise<number | undefined> {
  return (await pendingClaimRecordFor(email, network))?.vaultNumber;
}

/** The whole pending record, for callers that need to know whose plan the
 *  claimed vault belongs to. */
export async function pendingClaimRecordFor(
  email: string,
  network: 'mainnet' | 'testnet4',
): Promise<PendingVaultClaim | undefined> {
  const who = email.trim().toLowerCase();
  if (!who) return undefined;
  const claim = await loadPendingClaim();
  if (!claim) return undefined;
  if (claim.email !== who) return undefined;
  if (claim.network !== network) return undefined;
  return claim;
}

export async function savePendingClaim(claim: PendingVaultClaim): Promise<void> {
  // With no email there is nothing to attribute the claim to, and a blank
  // owner would let a second account on this device pick up the first
  // account's number. Better to lose the record than to misattribute it.
  const who = claim.email.trim().toLowerCase();
  if (!who) return;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...claim, email: who }));
  } catch {
    // Best effort. Losing this costs the client one account number, not a
    // vault, so it must never block the build itself.
  }
}

/** The vault was built: this number is spoken for and no longer pending. */
export async function clearPendingClaim(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // As above.
  }
}
