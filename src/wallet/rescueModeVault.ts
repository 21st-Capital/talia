/**
 * Which vault rescue mode is switched on for (decided
 * 2026-09-26 and 2026-10-05).
 *
 * An administrator switches rescue mode on for ONE vault, and only that
 * vault may ask 21st Capital for a rescue. The server names it the way it
 * numbers its own keys: the account number in the origin path of our key
 * in the vault's descriptor (48'/coin'/ACCOUNT'/2'), and the chain by the
 * coin (0 = mainnet, 1 = testnet4). Talia reads the same number off the
 * same key, so the two always agree on which vault is meant.
 *
 * The app only decides what to OFFER, and reads the vault exactly as the
 * server does. The server still refuses a request for any other vault
 * (RESCUE_WRONG_VAULT) before the email code is used; should the two ever
 * disagree, the rescue screen remembers that refusal for the activation and
 * stops offering the vault, rather than asking for the same request again.
 *
 * String classification only: the descriptor layer's parsers, never BDK.
 * Pure and tested.
 */
import { parseKeyOrigins, stripChecksum } from '../bitcoin/descriptor';
import { accountIndexOf } from './providerKeyRoles';
import { withNetworkNote } from './networkNote';
import type { VaultNumber } from './providerKeyRoles';

/** The vault rescue mode is on for, as GET rescue/mode/ names it. */
export interface RescueModeVault extends VaultNumber {
  /** The server's own name for it ("Vault 2"); empty for the old shared
   *  keys, which name no vault. */
  label: string;
}

/** The two old shared accounts every vault built before per-client
 *  numbering holds; the backend's LEGACY_ACCOUNTS. */
const LEGACY_ACCOUNTS = new Set([0, 1]);

/** The backend's spelling of a chain, or null for one it does not use. */
export function rescueNetwork(raw: unknown): VaultNumber['network'] | null {
  const name = String(raw ?? '').trim().toLowerCase();
  if (name === 'mainnet' || name === 'bitcoin' || name === 'main') return 'mainnet';
  // Staff may type "testnet"; the server stores testnet4.
  if (name === 'testnet4' || name === 'testnet') return 'testnet4';
  return null;
}

/** The `vault` field of GET rescue/mode/, read strictly: anything that does
 *  not name an account and a chain is no vault at all. */
export function rescueModeVaultFrom(raw: unknown): RescueModeVault | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as { account?: unknown; network?: unknown; label?: unknown };
  const account = typeof v.account === 'number' ? v.account : Number.NaN;
  const network = rescueNetwork(v.network);
  if (!Number.isInteger(account) || account < 0 || !network) return null;
  return { account, network, label: typeof v.label === 'string' ? v.label.trim() : '' };
}

/** Every distinct (account, chain) our keys sit at in this descriptor, in
 *  the order they first appear in it (the server reads them in that order). */
export function ourVaultNumbers(descriptor: string, providerFps: ReadonlySet<string>): VaultNumber[] {
  const found = new Map<string, VaultNumber>();
  let body: string;
  try {
    body = stripChecksum(descriptor).body;
  } catch {
    return [];
  }
  for (const k of parseKeyOrigins(body)) {
    const fp = k.fingerprint?.toLowerCase();
    if (!fp || !providerFps.has(fp)) continue;
    const account = accountIndexOf(k.originPath);
    if (account === undefined) continue;
    // The coin type says which chain, exactly as the backend reads it.
    const coin = /^48'\/([01])'/.exec((k.originPath ?? '').replace(/[hH]/g, "'"))?.[1];
    if (coin === undefined) continue;
    const network: VaultNumber['network'] = coin === '0' ? 'mainnet' : 'testnet4';
    found.set(`${account}:${network}`, { account, network });
  }
  return [...found.values()];
}

const same = (a: VaultNumber, b: VaultNumber): boolean =>
  a.account === b.account && a.network === b.network;

/**
 * May this vault ask for a rescue under the current rescue mode?
 *
 * `bound` is the vault the mode is on for. Null means the server named none
 * while it reported rescue mode on, which only a server from before the
 * one-vault rule does; that server decides for itself, so every vault is
 * offered, as it was then.
 *
 * Otherwise this follows the server's own reading of a request: a vault
 * whose keys of ours name exactly one numbered account is that vault (an
 * old shared key beside it does not count, as on the server). One that
 * holds ONLY the old shared keys (accounts 0 and 1) names no vault of its
 * own: the server cannot switch rescue mode on for it (VAULT_NOT_BINDABLE)
 * and refuses a request from it (RESCUE_WRONG_VAULT), so it is never
 * offered (cross-check 2026-10-05). Keys of ours that name two different
 * numbered vaults name none.
 */
export function rescueModeCovers(
  bound: VaultNumber | null,
  descriptor: string,
  providerFps: ReadonlySet<string>,
): boolean {
  if (!bound) return true;
  const numbered = ourVaultNumbers(descriptor, providerFps).filter((v) => !LEGACY_ACCOUNTS.has(v.account));
  return numbered.length === 1 && same(numbered[0], bound);
}

/**
 * What to call the vault rescue mode is on for: the client's own name for
 * it when this phone holds it, else the name 21st Capital gave it, either
 * marked when it is a test network vault (the same number exists on both
 * chains, as the limits screen says), else null (the caller says "another
 * vault").
 */
export function rescueModeVaultName(
  bound: RescueModeVault | null,
  vaults: ReadonlyArray<{ label: string; descriptor: string; providerKeyFingerprints?: string[] }>,
): string | null {
  if (!bound) return null;
  for (const w of vaults) {
    if (!w.descriptor) continue;
    const fps = new Set((w.providerKeyFingerprints ?? []).map((f) => f.toLowerCase()));
    if (fps.size === 0) continue;
    const ours = ourVaultNumbers(w.descriptor, fps);
    const numbered = ours.filter((v) => !LEGACY_ACCOUNTS.has(v.account));
    // Only a vault that is certainly the one lends its name.
    if (numbered.length === 1 && same(numbered[0], bound)) return withNetworkNote(w.label, bound.network);
  }
  return bound.label ? withNetworkNote(bound.label, bound.network) : null;
}
