/**
 * When the independent address check runs, what it found, and what it
 * blocks, per vault (BDK upgrade,
 * decided 2026-10-15; the check itself is bitcoin/engine/addressCheck.ts).
 *
 * When: never on the launch path (decided 2026-10-17: a sweep of a layered
 * taproot vault is a few hundred milliseconds of scure on Hermes, which has
 * no JIT, and it ran inside getEngine for every vault at every cold start).
 * `scheduleAddressCheck` only queues it: the queue runs one vault at a time,
 * after React Native's interactions settle and a pause, and each scure
 * derivation waits for the interactions again and a timer turn, so no single
 * piece holds the JavaScript thread for more than one address. A sweep whose
 * engine answers exactly the addresses an earlier sweep proved (the digest
 * kept per vault in the sealed store, `ADDRESS_CHECK_PROVEN_KEY`) derives
 * nothing: once per vault, in effect, until its addresses change.
 *
 * What it blocks: a mismatch on EITHER keychain blocks Receive and every
 * build of the vault (Send, Refresh, Speed up, Cancel, a rescue: the change
 * of a payment goes to the other keychain). `guardedEngine` wraps the vault's
 * engine so a build first waits for the vault's check (starting it at once if
 * it is still queued) and is refused with ADDRESS_CHECK_FAILED on a mismatch.
 * An engine that could not answer, or a shape scure does not read, blocks
 * nothing (the engine's own checks still apply). A mismatch is counted in the
 * engine report (Talia Test and TestFlight keep one; the App Store app keeps
 * none) and logged, and so is every match: one it derived under
 * `scure.address`, one whose answers an earlier sweep proved under
 * `scure.proven`. The report files them under its `preflight` section
 * (fields `scure.*`), where they were counted beside the per-vault
 * preflight; since the old engine's removal (decided 2026-11-04) they are the only thing
 * counted there apart from a failed known-answer test, and Diagnostics shows
 * them as "Address checks" and "Address check mismatches".
 *
 * The sweep is not the only finder (decided 2026-10-17): a BUILD whose own
 * output (its change, at the library's next index, far past 0..9) is not the
 * script scure derives there is refused by the new engine with
 * ADDRESS_CHECK_FAILED and where it happened (`buildMismatchOf`), and
 * Receive's own derivation of the address it shows can disagree too
 * (`reportAddressMismatch`). Either one pauses the vault exactly as a sweep's
 * mismatch does: the verdict is announced (Receive, Send at open, every
 * later build), and it STAYS for the launch: a later sweep's match never
 * lifts a pause, because the 0..9 sweep cannot see the index that disagreed.
 */
import { InteractionManager } from 'react-native';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { BUILD_FLAVOUR } from '../config';
import { blocksBuilding, checkAddresses, SEND_PAUSED_TITLE } from '../bitcoin/engine/addressCheck';
import type { AddressCheckVerdict } from '../bitcoin/engine/addressCheck';
import { buildMismatchOf, EngineError } from '../bitcoin/engine/engineError';
import type { WalletEngine } from '../bitcoin/engine/types';
import type { Network } from '../bitcoin/descriptor/types';
import { shapeClassOf, withCount } from './engineReport';
import { updateEngineReport } from '../platform/engineReportFile';
import { sealedGetItem, sealedSetItem } from './sealedStore';

export interface CheckedVault {
  id: string;
  descriptor: string;
  changeDescriptor?: string;
  network: Network;
}

type Engine = Pick<WalletEngine, 'getReceiveAddress' | 'getInternalAddress'>;

/** The sealed record of each vault's proven addresses (a digest, by vault). */
export const ADDRESS_CHECK_PROVEN_KEY = 'talia.addressCheck.proven.v1';
/** The pause after interactions settle before a vault's sweep starts. */
export const ADDRESS_CHECK_IDLE_MS = 2000;

/** Storage for the proven digests (the sealed store; tests hand in a map). */
export interface ProvenStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const sealed: ProvenStorage = { getItem: sealedGetItem, setItem: sealedSetItem };

interface Deps {
  storage: ProvenStorage;
  /** Waits until the app is idle (interactions settled). */
  idle: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}

const realDeps: Deps = {
  storage: sealed,
  idle: () => new Promise<void>((resolve) => InteractionManager.runAfterInteractions(() => resolve())),
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};
let deps: Deps = realDeps;

interface Job {
  wallet: CheckedVault;
  engine: Engine;
  started: boolean;
  start: () => void;
  verdict: Promise<AddressCheckVerdict>;
}

const jobs = new Map<string, Job>();
const settled = new Map<string, AddressCheckVerdict>();
const listeners = new Set<(walletId: string, verdict: AddressCheckVerdict) => void>();
let queue: Promise<void> = Promise.resolve();

const keyOf = (w: CheckedVault) => `${w.id}\n${w.network}\n${w.descriptor}\n${w.changeDescriptor ?? ''}`;
/** The vault's entry in the proven record: a hash, so the record names no descriptor. */
const provenKeyOf = (w: CheckedVault) =>
  bytesToHex(sha256(utf8ToBytes(`${w.network}\n${w.descriptor}\n${w.changeDescriptor ?? ''}`)));

async function readProven(): Promise<Record<string, string>> {
  try {
    const raw = await deps.storage.getItem(ADDRESS_CHECK_PROVEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function rememberProven(w: CheckedVault, digest: string): Promise<void> {
  try {
    const record = await readProven();
    if (record[provenKeyOf(w)] === digest) return;
    record[provenKeyOf(w)] = digest;
    await deps.storage.setItem(ADDRESS_CHECK_PROVEN_KEY, JSON.stringify(record));
  } catch {
    // a record that cannot be written means one more sweep next time
  }
}

/** One sweep, one scure derivation per pause. */
async function sweep(job: Job): Promise<AddressCheckVerdict> {
  const proven = (await readProven())[provenKeyOf(job.wallet)] ?? null;
  const verdict = await checkAddresses(job.wallet, job.engine, {
    provenDigest: proven,
    pause: async () => {
      await deps.idle();
      await deps.sleep(0);
    },
  });
  if (verdict.kind === 'match' && verdict.derived) await rememberProven(job.wallet, verdict.digest);
  return verdict;
}

/**
 * What a vault's check found, told to every listener. A pause stays: once a
 * mismatch is known for a vault this launch, a later verdict that is not one
 * (a sweep of 0..9 that matched, an engine error) changes nothing.
 * `field` names the finder in the engine report: the sweep, a build's own
 * output, or the address Receive was about to show.
 */
function announce(
  wallet: CheckedVault,
  verdict: AddressCheckVerdict,
  field: 'scure.address' | 'scure.output' | 'scure.shown' = 'scure.address',
): void {
  if (settled.get(wallet.id)?.kind === 'mismatch' && verdict.kind !== 'mismatch') return;
  settled.set(wallet.id, verdict);
  for (const l of listeners) {
    try {
      l(wallet.id, verdict);
    } catch {
      // a listener never breaks the check
    }
  }
  if (verdict.kind === 'mismatch') {
    console.warn(`[address check] ${field} ${verdict.keychain} ${verdict.index}: the engine and scure disagree`);
  }
  // Every check that reached a verdict on the addresses is counted, a sweep
  // that found the answers an earlier one proved included, under its own
  // field (decided 2026-11-04 after a phone test: a build whose vaults were
  // all proven before left no entry at all, so the report could not show
  // that its library had given every vault the same addresses).
  if (BUILD_FLAVOUR !== 'store' && (verdict.kind === 'mismatch' || verdict.kind === 'match')) {
    const counted = verdict.kind === 'match' && !verdict.derived ? 'scure.proven' : field;
    void updateEngineReport((r, app) =>
      withCount(r, 'preflight', { shape: shapeClassOf(wallet.descriptor), outcome: verdict.kind, field: counted }, app, new Date()),
    );
  }
}

/**
 * Queue the check of this vault (once per launch and descriptor). Nothing is
 * derived here: the queue starts it when the app is idle.
 */
export function scheduleAddressCheck(wallet: CheckedVault, engine: Engine): Promise<AddressCheckVerdict> {
  const key = keyOf(wallet);
  const known = jobs.get(key);
  if (known) return known.verdict;
  let begin!: () => void;
  const begun = new Promise<void>((resolve) => (begin = resolve));
  const job: Job = {
    wallet,
    engine,
    started: false,
    start: () => {
      if (job.started) return;
      job.started = true;
      begin();
    },
    verdict: begun.then(async () => {
      let v: AddressCheckVerdict;
      try {
        v = await sweep(job);
      } catch {
        v = { kind: 'error' };
      }
      announce(wallet, v);
      // An engine that could not answer is asked again next time.
      if (v.kind === 'error') jobs.delete(key);
      return v;
    }),
  };
  jobs.set(key, job);
  // The idle queue: one vault at a time, after interactions and a pause.
  queue = queue
    .then(async () => {
      if (job.started) {
        await job.verdict.catch(() => null);
        return;
      }
      await deps.idle();
      await deps.sleep(ADDRESS_CHECK_IDLE_MS);
      job.start();
      await job.verdict.catch(() => null);
    })
    .catch(() => undefined);
  return job.verdict;
}

/** The vault's check, started now if it is still queued (a build is waiting). */
export function addressCheckNow(wallet: CheckedVault, engine: Engine): Promise<AddressCheckVerdict> {
  const verdict = scheduleAddressCheck(wallet, engine);
  jobs.get(keyOf(wallet))?.start();
  return verdict;
}

/** What this launch's check found for a vault, if it has finished. */
export function addressCheckVerdict(walletId: string): AddressCheckVerdict | null {
  return settled.get(walletId) ?? null;
}

/**
 * Receive derived the address it was about to show and scure disagreed with
 * the engine there (`verifyShownAddress`, `verifyPinnedAddress`): the vault
 * pauses as on a sweep's mismatch, Send and every build included.
 */
export function reportAddressMismatch(
  wallet: CheckedVault,
  keychain: 'external' | 'internal',
  index: number,
): void {
  announce(wallet, { kind: 'mismatch', keychain, index }, 'scure.shown');
}

/** Told when a vault's check finishes. */
export function onAddressCheck(listener: (walletId: string, verdict: AddressCheckVerdict) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The vault's engine, its builds behind the check: Send, Refresh, Speed up,
 * Cancel and a rescue wait for the vault's sweep and are refused on a
 * mismatch of either keychain, or on a pause this launch already found (a
 * build's own output, Receive's own derivation). A build the ENGINE refuses
 * because its own output disagrees with scure (ADDRESS_CHECK_FAILED with
 * where, the new engine's `finishBuild`) pauses the vault from then on.
 * Every other call goes straight through.
 */
export function guardedEngine<E extends WalletEngine>(engine: E, wallet: CheckedVault): E {
  const gate = async (): Promise<void> => {
    const verdict = await addressCheckNow(wallet, engine).catch((): AddressCheckVerdict => ({ kind: 'error' }));
    if (blocksBuilding(verdict) || blocksBuilding(settled.get(wallet.id))) {
      throw new EngineError('ADDRESS_CHECK_FAILED', SEND_PAUSED_TITLE);
    }
  };
  return new Proxy(engine, {
    get(target, prop, receiver) {
      if (prop === 'buildPsbt' || prop === 'buildRescuePsbt') {
        const build = Reflect.get(target, prop, receiver) as (r: unknown) => Promise<unknown>;
        return async (request: unknown) => {
          await gate();
          try {
            return await build.call(target, request);
          } catch (e) {
            const at = buildMismatchOf(e);
            if (at) announce(wallet, { kind: 'mismatch', keychain: at.keychain, index: at.index }, 'scure.output');
            throw e;
          }
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** Tests only. */
export function resetAddressChecksForTests(overrides?: Partial<Deps>): void {
  jobs.clear();
  settled.clear();
  listeners.clear();
  queue = Promise.resolve();
  deps = { ...realDeps, ...(overrides ?? {}) };
}
