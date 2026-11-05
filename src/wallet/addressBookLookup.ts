/**
 * The address book's check, run (decided 2026-11-05): has this saved
 * Private Address spent coins before? Screens call it through
 * ui/hooks/useAddressBookCheck.ts; the rule is ./addressBookCheck.ts.
 *
 *   - An Exchange Address is NEVER looked up ('idle').
 *   - An address the book (or this session) already found spent is not
 *     asked about again: 'spent' at once.
 *   - Otherwise the vault network's own server is asked, under the server
 *     rule (./chainServers.ts `lookupThroughChainServers`): a Bitcoin lookup
 *     goes to the one server the client chose, or the default while none is
 *     saved, and to nothing while a server is held; Testnet4 to its built-in
 *     servers with fail-over. Never a block explorer, never fetch(), never
 *     another server.
 *   - 'spent' is remembered: `spentSeenAt` on the saved entry (and for this
 *     session, so an address not saved yet is not asked again either).
 *     'notFound' is never stored, and never shown as safe.
 *   - Any error, no server, or a bridge without the call: 'unknown'.
 *
 * The check never decides anything else: Next on Send and Save on the Add
 * address page are never disabled or delayed by it.
 */
import { addressFamily, addressFitsNetwork } from '../bitcoin/addressNetwork';
import type { Network } from '../bitcoin/descriptor/types';
import type { AddressActivity, BackendConfig } from '../bitcoin/engine/types';
import { findBookEntry, loadAddressBook, markAddressSpent, normaliseBookAddress } from './addressBook';
import type { AddressCategory } from './addressBook';
import { activityVerdict } from './addressBookCheck';
import { lookupThroughChainServers } from './chainServers';
import { lookUpActivity } from './engineProvider';
import type { AppSettings } from './types';

/** What a screen shows for the check: nothing, the quiet line, the gold notice, nothing, "Could not check". */
export type BookCheckState = 'idle' | 'checking' | 'spent' | 'notFound' | 'unknown';

/** A finished check (never 'checking'). */
export interface BookCheckAnswer {
  state: Exclude<BookCheckState, 'checking'>;
  /** When it was first found spent (ms), with 'spent'. */
  spentSeenAt?: number;
}

export interface BookCheckRequest {
  address: string;
  category: AddressCategory;
  /** The sending vault's network (Send). Without one, the address's own network. */
  network?: Network;
  /** The settings that choose the servers (WalletProvider's, once read). */
  settings: Pick<AppSettings, 'electrumUrls' | 'bitcoinServerHold'>;
  /** What the screen already knows (the saved entry's `spentSeenAt`); the book is read when it is not given. */
  spentSeenAt?: number;
}

export interface BookCheckDeps {
  /** One server's answer for one address (./engineProvider.ts `lookUpActivity`). */
  lookUp: (backend: BackendConfig, network: Network, address: string) => Promise<AddressActivity | null>;
  /** When the book found this address spent, if it did (the saved entry's `spentSeenAt`). */
  knownSpentAt: (address: string) => Promise<number | undefined>;
  /** Remember a spent address in the book (./addressBook.ts `markAddressSpent`). */
  markSpent: (address: string, at: number) => Promise<unknown>;
  now: () => number;
}

const realDeps: BookCheckDeps = {
  lookUp: lookUpActivity,
  knownSpentAt: async (address) => findBookEntry(await loadAddressBook(), address)?.spentSeenAt,
  markSpent: markAddressSpent,
  now: () => Date.now(),
};

/** Addresses found spent this session, by network and address. */
const spentThisSession = new Map<string, number>();

/**
 * The network whose servers are asked about `address`: the vault's when
 * given (null when the address does not fit it: nothing is asked), else the
 * address's own (a test address is Testnet4's, the one test network).
 */
export function lookupNetworkOf(address: string, vaultNetwork?: Network): Network | null {
  if (vaultNetwork) return addressFitsNetwork(address, vaultNetwork) ? vaultNetwork : null;
  const family = addressFamily(address);
  if (family === 'bitcoin') return 'bitcoin';
  if (family === 'test') return 'testnet';
  if (family === 'regtest') return 'regtest';
  return null;
}

/** Run the check once (the rules above). Never throws. */
export async function checkBookAddress(req: BookCheckRequest, deps: BookCheckDeps = realDeps): Promise<BookCheckAnswer> {
  if (req.category !== 'private') return { state: 'idle' };
  const address = normaliseBookAddress(req.address);
  if (address == null) return { state: 'idle' };
  const network = lookupNetworkOf(address, req.network);
  if (network == null) return { state: 'idle' };
  if (req.spentSeenAt != null) return { state: 'spent', spentSeenAt: req.spentSeenAt };
  const key = `${network}\n${address}`;
  const known = spentThisSession.get(key) ?? (await deps.knownSpentAt(address).catch(() => undefined));
  if (known != null) return { state: 'spent', spentSeenAt: known };

  let activity: AddressActivity | null;
  try {
    activity = await lookupThroughChainServers(network, req.settings, (backend) => deps.lookUp(backend, network, address));
  } catch {
    return { state: 'unknown' };
  }
  const verdict = activityVerdict(activity);
  if (verdict !== 'spent') return { state: verdict };
  const at = deps.now();
  spentThisSession.set(key, at);
  try {
    await deps.markSpent(address, at);
  } catch {
    // The book could not be written: the notice still shows, and the
    // session remembers it.
  }
  return { state: 'spent', spentSeenAt: at };
}

/** Tests only: a fresh launch. */
export function __forgetAddressChecksForTests(): void {
  spentThisSession.clear();
}
