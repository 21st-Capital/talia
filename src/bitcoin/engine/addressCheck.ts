/**
 * The permanent independent address check (BDK upgrade, decided
 * 2026-10-15): @scure/btc-signer derives a vault's first
 * 10 receive and change addresses for every shape Talia's own TypeScript can
 * derive (descriptor/scureAddresses.ts), and the engine that runs must give
 * the same. If it does not, nothing of that vault is received to or built
 * (wallet/addressCheckStore.ts) and the event is counted. It runs under BOTH
 * engines and stays after the old one is gone.
 *
 * More checks share the deriver, because the 0..9 sweep cannot see the
 * index a vault actually uses next (decided 2026-10-17):
 *   - `verifyShownAddress`: the exact address Receive is about to show;
 *   - `verifyPinnedAddress`: an address Receive is opened ON with no index
 *     (the coin list's "Show coin address"): its keychain and index are found
 *     among the vault's own addresses first (as far as the engine reaches),
 *     then it is derived there (decided 2026-10-17);
 *   - `ownOutputProblems`: every output a build marks as the vault's own
 *     (its change, a refresh, a cancel), at the index its derivation names.
 *
 * Pure but for the engine it is handed (peeks only: neither library moves a
 * counter for an index). A shape scure does not read is 'not-covered': the
 * phone app's per-vault preflight compared the two libraries on it while both
 * shipped, and nothing does since the old engine's removal (decided 2026-11-04;
 * descriptor/scureAddresses.ts says what that rests on).
 *
 * The scure derivations are the expensive part (tens of milliseconds an
 * address for a layered taproot vault on Hermes, which has no JIT), so the
 * sweep derives one address per `pause()` and never runs on the launch path;
 * a sweep whose engine gave exactly the addresses an earlier sweep proved
 * (`provenDigest`) derives nothing at all.
 */
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes, bytesToHex } from '@noble/hashes/utils';
import type { Network } from '../descriptor/types';
import { scureDeriver } from '../descriptor/scureAddresses';
import type { Deriver } from '../descriptor/scureAddresses';
import { psbtMaps } from '../psbt/canonical';
import { descriptorPair } from './engineShared';
import { classifyEngineError } from './engineError';
import type { WalletEngine, WatchOnlyWalletParams } from './types';

/** How many addresses of each keychain are checked. */
export const ADDRESS_CHECK_COUNT = 10;

export type AddressCheckVerdict =
  /** `digest`: the checked addresses, for the next sweep to recognise. */
  | { kind: 'match'; checked: number; digest: string; derived: boolean }
  | { kind: 'mismatch'; keychain: 'external' | 'internal'; index: number }
  | { kind: 'not-covered' }
  /** The engine could not answer (a sync holding its queue, a library
   *  error): nothing is concluded, nothing is blocked. */
  | { kind: 'error' };

/**
 * The title of the dialog that blocks Receive (a minimal dialog: title and
 * button, decided 2026-09-02). Wording decided 2026-10-17, with the BDK
 * upgrade.
 */
export const RECEIVE_PAUSED_TITLE = 'Receiving is paused for this vault';

/**
 * The title of the dialog Send, Refresh (one payment or a coin each, the
 * refresh session's), Speed up, Cancel and the signing page's rebuild for
 * another key show when the check found the vault's addresses differ on
 * either keychain: the build is refused before any device sees it
 * (wallet/addressCheckStore.ts `guardedEngine`). A title and a button,
 * nothing to read around. Wording approved on 2026-10-17 (approval
 * (b): "Send, Refresh and Cancel pause for that vault too"). A rescue
 * request's own PSBT is refused the same way, and the request then goes to
 * 21st Capital without it, as after any failed rescue build: a rescue is
 * never blocked by the phone (RescueScreen).
 */
export const SEND_PAUSED_TITLE = 'Sending is paused for this vault';

/** A build the address check refused (ADDRESS_CHECK_FAILED): show SEND_PAUSED_TITLE. */
export function isSendPaused(e: unknown): boolean {
  return classifyEngineError(e) === 'ADDRESS_CHECK_FAILED';
}

/** Receive is blocked on a mismatch alone. */
export function blocksReceive(v: AddressCheckVerdict | null | undefined): boolean {
  return v?.kind === 'mismatch';
}

/** Building is blocked on a mismatch of EITHER keychain: the change goes to the other one. */
export function blocksBuilding(v: AddressCheckVerdict | null | undefined): boolean {
  return v?.kind === 'mismatch';
}

type CheckedParams = Pick<WatchOnlyWalletParams, 'descriptor' | 'changeDescriptor'> & { network: Network };

/** Each keychain's deriver, or null when scure does not read the vault. */
function derivers(params: CheckedParams): { external: Deriver; internal: Deriver | null } | null {
  const pair = descriptorPair(params);
  try {
    const external = scureDeriver(pair.external, params.network);
    const internal = pair.internal ? scureDeriver(pair.internal, params.network) : null;
    if (!external || (pair.internal && !internal)) return null;
    return { external, internal };
  } catch {
    return null;
  }
}

/** One digest of what a sweep compared (indexes, keychains and addresses). */
export function addressDigest(external: string[], internal: string[]): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify({ v: 1, count: ADDRESS_CHECK_COUNT, external, internal }))));
}

export interface AddressCheckOptions {
  count?: number;
  /** Awaited before each scure derivation: the caller's yield to the UI. */
  pause?: () => Promise<void>;
  /** The digest of addresses an earlier sweep proved equal to scure's for
   *  this vault: the same answers from the engine need no derivation. */
  provenDigest?: string | null;
}

/**
 * Compare the engine's peeked addresses 0..count-1 with scure's, receive
 * first, then change when the vault has its own change descriptor (a vault
 * without one answers change with receive in both libraries).
 */
export async function checkAddresses(
  params: CheckedParams,
  engine: Pick<WalletEngine, 'getReceiveAddress' | 'getInternalAddress'>,
  opts: AddressCheckOptions | number = {},
): Promise<AddressCheckVerdict> {
  const o: AddressCheckOptions = typeof opts === 'number' ? { count: opts } : opts;
  const count = o.count ?? ADDRESS_CHECK_COUNT;
  const pair = descriptorPair(params);
  // The engine's answers first: native peeks, nothing heavy on this thread.
  const got: Record<'external' | 'internal', Array<{ address: string; index: number }>> = { external: [], internal: [] };
  try {
    for (let i = 0; i < count; i++) got.external.push(await engine.getReceiveAddress(i));
    if (pair.internal) for (let i = 0; i < count; i++) got.internal.push(await engine.getInternalAddress(i));
  } catch {
    return { kind: 'error' };
  }
  for (const k of ['external', 'internal'] as const) {
    for (let i = 0; i < got[k].length; i++) {
      if (got[k][i].index !== i) return { kind: 'mismatch', keychain: k, index: i };
    }
  }
  const digest = addressDigest(
    got.external.map((a) => `${a.index}:${a.address}`),
    got.internal.map((a) => `${a.index}:${a.address}`),
  );
  const checked = got.external.length + got.internal.length;
  // Answers an earlier sweep proved: nothing to derive.
  if (o.provenDigest && o.provenDigest === digest) return { kind: 'match', checked, digest, derived: false };
  // Each keychain's deriver in a piece of its own (making one derives every
  // key's step child, the costliest piece for a vault of many keys), then one
  // address per piece.
  const make = async (desc: string): Promise<Deriver | null> => {
    if (o.pause) await o.pause();
    try {
      return scureDeriver(desc, params.network);
    } catch {
      return null;
    }
  };
  const d = { external: await make(pair.external), internal: pair.internal ? await make(pair.internal) : null };
  if (!d.external || (pair.internal && !d.internal)) return { kind: 'not-covered' };
  for (const k of ['external', 'internal'] as const) {
    const derive = k === 'external' ? d.external : d.internal;
    if (!derive) continue;
    for (let i = 0; i < got[k].length; i++) {
      if (o.pause) await o.pause();
      let want: string;
      try {
        want = derive(i).address;
      } catch {
        // A shape scure reads but cannot derive at this index: not concluded.
        return { kind: 'error' };
      }
      if (got[k][i].address !== want) return { kind: 'mismatch', keychain: k, index: i };
    }
  }
  return { kind: 'match', checked, digest, derived: true };
}

/**
 * What Receive's own check of the address it is about to show found.
 *   - 'match': scure derives the same address there; 'not-covered': a shape
 *     scure does not read (as for every address of that vault). Shown.
 *   - 'mismatch': the engine names this address at `keychain`/`index` and
 *     scure derives another one there. A real disagreement: the vault pauses
 *     (wallet/addressCheckStore.ts `reportAddressMismatch`), so the approved
 *     "Receiving is paused for this vault" is true.
 *   - 'not-found': a pinned address the search did not find among the
 *     vault's own addresses as far as the engine reaches; 'error': a
 *     derivation or the engine could not answer. Nothing is concluded about
 *     the VAULT, so it is not paused and the vault-wide title is never shown
 *     (decided 2026-10-17: the rule that a sentence holds in every scenario);
 *     the address stays hidden.
 *   - 'aborted': the screen went away before the search ended.
 */
export type ShownAddressCheck =
  | { kind: 'match' }
  | { kind: 'not-covered' }
  | { kind: 'mismatch'; keychain: 'external' | 'internal'; index: number }
  | { kind: 'not-found' }
  | { kind: 'error' }
  | { kind: 'aborted' };

/** Shown on the screen: a match, or a shape scure does not read. */
export function shownCheckShows(c: ShownAddressCheck | null | undefined): boolean {
  return c?.kind === 'match' || c?.kind === 'not-covered';
}

/**
 * The exact address Receive is about to show (decided 2026-10-17: the sweep
 * covers 0..9, a used vault shows index 37): one derivation, compared.
 */
export function verifyShownAddress(
  params: CheckedParams,
  keychain: 'external' | 'internal',
  index: number,
  address: string,
): ShownAddressCheck {
  const d = derivers(params);
  if (!d) return { kind: 'not-covered' };
  const onInternal = keychain === 'internal' && d.internal != null;
  const derive = onInternal ? d.internal! : d.external;
  let want: string;
  try {
    want = derive(index).address;
  } catch {
    return { kind: 'error' };
  }
  return want === address.trim() ? { kind: 'match' } : { kind: 'mismatch', keychain: onInternal ? 'internal' : 'external', index };
}

/**
 * How far each keychain is searched for an address Receive was opened on,
 * when the engine cannot say how far it reaches (the 0.28 engine was one, its
 * bridge had no read-only index; the engine since the old engine's removal says, through
 * `addressReach`): a coin past it is 'not-found', never a pause.
 */
export const PINNED_SEARCH_LIMIT = 1000;

/** Set by the caller to stop a search (Receive's cleanup when the screen goes). */
export interface SearchSignal {
  readonly aborted: boolean;
}

/**
 * An address Receive is opened ON without its index (the coin list's "Show
 * coin address", decided 2026-10-17): it is shown only once checked.
 * Its keychain and index are found among the vault's own addresses (the
 * engine's peeks, the coin's keychain first), and scure derives it again
 * there (`verifyShownAddress`). Each keychain is searched as far as the
 * ENGINE reaches on it (`addressReach`: the last revealed index, which every
 * coin the engine lists sits at or below), else up to `limit`. Not found is
 * 'not-found' and an engine that cannot answer is 'error': the address stays
 * hidden, and the vault is NOT paused (decided 2026-10-17). A shape scure does
 * not read is 'not-covered', as for any address of that vault.
 */
export async function verifyPinnedAddress(
  params: CheckedParams,
  engine: Pick<WalletEngine, 'getReceiveAddress' | 'getInternalAddress' | 'addressReach'>,
  address: string,
  keychain?: 'external' | 'internal',
  opts: { limit?: number; signal?: SearchSignal } = {},
): Promise<ShownAddressCheck> {
  if (!derivers(params)) return { kind: 'not-covered' };
  const want = address.trim();
  const limit = opts.limit ?? PINNED_SEARCH_LIMIT;
  const hasInternal = descriptorPair(params).internal != null;
  const order: Array<'external' | 'internal'> = keychain === 'internal' ? ['internal', 'external'] : ['external', 'internal'];
  try {
    for (const k of order) {
      if (k === 'internal' && !hasInternal) continue;
      if (opts.signal?.aborted) return { kind: 'aborted' };
      let last = limit - 1;
      if (engine.addressReach) {
        // The engine's own reach; a keychain with nothing revealed holds no coin.
        let reach: number | null | undefined;
        try {
          reach = await engine.addressReach(k);
        } catch {
          reach = undefined; // could not say: the fixed bound
        }
        if (reach === null) continue;
        if (reach !== undefined && Number.isInteger(reach) && reach >= 0) last = reach;
      }
      for (let i = 0; i <= last; i++) {
        if (opts.signal?.aborted) return { kind: 'aborted' };
        const a = k === 'external' ? await engine.getReceiveAddress(i) : await engine.getInternalAddress(i);
        if (a.address !== want) continue;
        if (a.index !== i) return { kind: 'mismatch', keychain: k, index: i };
        return verifyShownAddress(params, k, i, want);
      }
    }
  } catch {
    return { kind: 'error' };
  }
  return { kind: 'not-found' };
}

// ---------------------------------------------------------------- a build's own outputs

const hexBytes = (h: string): Uint8Array => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const HARDENED = 0x8000_0000;

/** A derivation value's path (after the 4-byte fingerprint), or null when malformed. */
function pathOf(value: Uint8Array, from: number): number[] | null {
  if ((value.length - from) % 4 !== 0 || value.length - from < 4) return null;
  const out: number[] = [];
  for (let i = from + 4; i < value.length; i += 4) {
    out.push((value[i] | (value[i + 1] << 8) | (value[i + 2] << 16)) + value[i + 3] * 0x1000000);
  }
  return out;
}

/** PSBT_OUT_TAP_BIP32_DERIVATION's value: compact-size count, leaf hashes, then origin. */
function tapPathOf(value: Uint8Array): number[] | null {
  let at = 0;
  let n = value[0];
  if (n === 0xfd) {
    n = value[1] | (value[2] << 8);
    at = 3;
  } else if (n >= 0xfe) {
    return null;
  } else {
    at = 1;
  }
  return pathOf(value, at + 32 * n);
}

/** The derivation steps a keychain's keys use before `/*` (`/0/*` → 0). */
function stepsOf(descriptor: string | null): Set<number> {
  const out = new Set<number>();
  for (const m of (descriptor ?? '').matchAll(/\/(\d+)\/\*/g)) out.add(Number(m[1]));
  return out;
}

/**
 * What `ownOutputProblems` found wrong with a build's own outputs.
 *   - 'mismatch': an output the build marks as the vault's own pays another
 *     script than scure derives at the keychain and index its derivation
 *     names. The engine and scure disagree about the vault's addresses (or
 *     the build sends the "change" somewhere else): the same finding as a
 *     sweep's mismatch, so the vault pauses (decided 2026-10-17).
 *   - 'unchecked': the payment could not be read, or an output is marked as
 *     the vault's own without an index or at a path this vault does not
 *     have. Nothing is concluded about the vault's addresses; the build is
 *     refused all the same.
 * `detail` is for the log and the engine report, never for the client
 * (it names outputs and indexes).
 */
export type OwnOutputProblem =
  | { kind: 'mismatch'; output: number; keychain: 'external' | 'internal'; index: number; detail: string }
  | { kind: 'unchecked'; detail: string };

/**
 * Every output a build marks as the vault's own (a PSBT_OUT_BIP32_DERIVATION
 * or PSBT_OUT_TAP_BIP32_DERIVATION entry) must pay the script scure derives
 * for the keychain and index that derivation names; null when they all do,
 * else what is wrong. A shape scure does not read is not judged here (the
 * preflight covered it while both libraries shipped, until the old engine's removal). The change of a build sits
 * at the library's next index, usually far past the 0..9 sweep, so this is
 * the only independent look at it (decided 2026-10-17).
 */
export function ownOutputProblems(psbtBase64: string, params: CheckedParams): OwnOutputProblem | null {
  const d = derivers(params);
  if (!d) return null;
  const maps = psbtMaps(psbtBase64);
  if (!maps) return { kind: 'unchecked', detail: 'the payment could not be read' };
  const pair = descriptorPair(params);
  const extSteps = stepsOf(pair.external);
  const intSteps = stepsOf(pair.internal);
  // A keychain whose descriptor has no wildcard has ONE script, whatever path
  // its derivation entries name (tier C's build matrix: a non-ranged import).
  const fixed: Array<'external' | 'internal'> = [
    ...(!pair.external.includes('*') ? (['external'] as const) : []),
    ...(pair.internal && !pair.internal.includes('*') ? (['internal'] as const) : []),
  ];
  for (let n = 0; n < maps.outputs.length; n++) {
    // (step before the index, or null when the key has none or a hardened one; the index)
    const candidates: Array<[number | null, number]> = [];
    let marked = false;
    for (const e of maps.outputs[n]) {
      const type = parseInt(e.key.slice(0, 2), 16);
      if (type !== 0x02 && type !== 0x07) continue;
      marked = true;
      const value = hexBytes(e.value);
      const path = type === 0x02 ? pathOf(value, 0) : tapPathOf(value);
      if (!path || path.length < 1) continue;
      const index = path[path.length - 1];
      if (index >= HARDENED) continue;
      const before = path.length >= 2 ? path[path.length - 2] : null;
      const step = before != null && before < HARDENED ? before : null;
      if (!candidates.some(([s, i]) => s === step && i === index)) candidates.push([step, index]);
    }
    if (!marked) continue;
    if (candidates.length === 0) {
      return { kind: 'unchecked', detail: `output ${n} is marked as the vault's own without an address index` };
    }
    const script = maps.tx.outs[n].script;
    // The last keychain and index tried: what the log and the verdict name.
    let named: { keychain: 'external' | 'internal'; index: number } | null = null;
    const ok = candidates.some(([step, index]) => {
      // The keychain the step names; a key with no step of its own is tried on each.
      const resolved: Array<'external' | 'internal'> =
        step != null && d.internal && intSteps.has(step) && !extSteps.has(step)
          ? ['internal']
          : step != null && extSteps.has(step)
            ? ['external']
            : step == null
              ? d.internal
                ? ['external', 'internal']
                : ['external']
              : [];
      return [...new Set([...resolved, ...fixed])].some((keychain) => {
        named = { keychain, index };
        const derive = keychain === 'internal' ? d.internal! : d.external;
        try {
          return sameBytes(derive(index).script, script);
        } catch {
          return false;
        }
      });
    });
    if (ok) continue;
    const at = named as { keychain: 'external' | 'internal'; index: number } | null;
    if (!at) {
      return { kind: 'unchecked', detail: `output ${n} is marked as the vault's own at a path this vault does not have` };
    }
    return {
      kind: 'mismatch',
      output: n,
      keychain: at.keychain,
      index: at.index,
      detail: `output ${n} does not pay the vault's own address (${at.keychain} ${at.index})`,
    };
  }
  return null;
}
