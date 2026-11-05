/**
 * The one place the app gets a wallet engine from, and the connection test
 * with it (BDK upgrade, decided 2026-10-15).
 *
 * Since the old engine's removal (decided 2026-11-04) there is one engine: bdk-ffi 3.1.1
 * through TaliaBdkWalletModule (bdkWalletEngine.ts), in every build flavour.
 * The old engine (bdk 0.28 behind the bdk-ffi 0.30 fork), the per-flavour
 * engine constants, the phone's engine switches, the per-vault preflight and
 * the shadow checks are gone; the independent address check stays
 * (addressCheck.ts, wallet/addressCheckStore.ts). The wallet layer hands in
 * this build's module at start (`configureEngine`), so this layer never
 * reads React Native itself.
 *
 *   - The library's known-answer test runs once a
 *     launch, when the first vault opens. Until 2026-11-04 a failure kept the
 *     new engine off and every vault on the old one; with no other engine
 *     left, a failure opens NO vault this launch (each open is refused with
 *     LIBRARY_CHECK_FAILED): a library that derives the wrong addresses for
 *     fixed public vectors must not show a vault's balance or a Receive
 *     address, and the address check cannot cover the imported shapes scure
 *     does not read. Diagnostics shows what it found (`onKnownAnswer`), and
 *     Talia Test and TestFlight count a failure in the engine report
 *     (wallet/engineLaunch.ts).
 *   - A build without the module opens no vault (NO_WALLET_LIBRARY). None
 *     ships: Talia is built for iPhone only (decided 2026-11-04, when the
 *     old library's Android bridge and the Android project were removed).
 *   - In the phone app on testnet the engine is wrapped to copy its signing
 *     rounds (signingRounds.ts), which changes nothing it does.
 */
import { BUILD_FLAVOUR } from '../../config';
import { addressActivityV3, BdkWalletEngineV3, testBackendConnectionV3 } from './bdkWalletEngine';
import type { BdkWalletNative } from './bdkWalletNative';
import { capturesSigningRounds, capturingEngine } from './signingRounds';
import type { Network } from '../descriptor/types';
import type { AddressActivity, BackendConfig, WalletEngine, WalletEngineFactory, WatchOnlyWalletParams } from './types';
import { LIBRARY_CHECK_FAILED, NO_WALLET_LIBRARY } from './libraryProblem';

// The two sentences live in a leaf (libraryProblem.ts) so the vault page and
// the screens can show them as written without importing the engine.
export { LIBRARY_CHECK_FAILED, NO_WALLET_LIBRARY };

export interface EngineConfig {
  /** The wallet library's module, when this build links it (iOS). */
  native?: BdkWalletNative;
}

let config: EngineConfig | null = null;

/** Called once at start by the wallet layer, before the first engine. */
export function configureEngine(c: EngineConfig): void {
  config = c;
}

// ---------------------------------------------------------------- the known answer

/** The library's launch-time known-answer test. */
export type KnownAnswerState =
  | { state: 'passed'; vectors: number }
  | { state: 'failed'; problem: string }
  /** The build does not link the library. */
  | { state: 'missing' };

let knownAnswer: Promise<KnownAnswerState> | null = null;
let knownAnswerSettled: KnownAnswerState | null = null;
/** Told the state, and the descriptor of the vault whose open ran the test (null when none named it). */
export type KnownAnswerListener = (k: KnownAnswerState, ranFor: string | null) => void;
const knownAnswerListeners = new Set<KnownAnswerListener>();

/**
 * Run once a launch, by the first vault that opens; every later open reads
 * its answer. Nothing on a screen starts it (decided 2026-10-22):
 * Diagnostics only shows what it found. `ranFor` is the descriptor of the
 * vault whose open ran it, handed to the listeners (the engine report
 * counts a failure under that vault's shape class, never the descriptor).
 */
export function ensureKnownAnswer(ranFor?: string): Promise<KnownAnswerState> {
  if (!knownAnswer) {
    const opener = ranFor ?? null;
    knownAnswer = (async (): Promise<KnownAnswerState> => {
      const native = config?.native;
      if (!native) return { state: 'missing' };
      try {
        const r = await native.knownAnswer();
        return r.passed ? { state: 'passed', vectors: r.vectors } : { state: 'failed', problem: 'a vector gave another address' };
      } catch (e) {
        return { state: 'failed', problem: String((e as Error)?.message ?? e) };
      }
    })().then((s) => {
      knownAnswerSettled = s;
      for (const l of knownAnswerListeners) {
        try {
          l(s, opener);
        } catch {
          // a listener never breaks the test
        }
      }
      return s;
    });
  }
  return knownAnswer;
}

/** The known-answer test's state if it has run this launch. */
export function knownAnswerNow(): KnownAnswerState | null {
  return knownAnswerSettled;
}

/** Told when the known-answer test has run, whoever ran it; it never starts it. */
export function onKnownAnswer(listener: KnownAnswerListener): () => void {
  knownAnswerListeners.add(listener);
  return () => knownAnswerListeners.delete(listener);
}

/** The library, once its known answers passed this launch; otherwise why not. */
async function usableLibrary(descriptor: string): Promise<BdkWalletNative> {
  const native = config?.native;
  if (!native) throw new Error(NO_WALLET_LIBRARY);
  if ((await ensureKnownAnswer(descriptor)).state !== 'passed') throw new Error(LIBRARY_CHECK_FAILED);
  return native;
}

// ---------------------------------------------------------------- the factory

/** Copy signing rounds in the phone app on testnet (signingRounds.ts). */
const withRounds = (engine: WalletEngine, params: WatchOnlyWalletParams): WalletEngine =>
  capturesSigningRounds(BUILD_FLAVOUR, params.network) ? capturingEngine(engine) : engine;

const engineFactory: WalletEngineFactory = {
  create: async (params) =>
    withRounds(await BdkWalletEngineV3.create(params, { native: await usableLibrary(params.descriptor) }), params),
};

/** The factory every vault's engine comes from. */
export async function activeEngineFactory(): Promise<WalletEngineFactory> {
  return engineFactory;
}

// ---------------------------------------------------------------- the connection test

/** How the last connection test went. */
export interface ConnectionAnswer {
  /** The tip height it read, or null when it failed. */
  height: number | null;
  /** Why it failed. */
  error: string | null;
  /** How long it took, in milliseconds. */
  ms: number;
  /** When it answered (ms since 1970). */
  at: number;
}

let lastAnswer: ConnectionAnswer | null = null;
const answerListeners = new Set<(a: ConnectionAnswer) => void>();

export function lastConnectionAnswer(): ConnectionAnswer | null {
  return lastAnswer;
}

/** Told after every connection test, whoever ran it. */
export function onConnectionAnswer(listener: (a: ConnectionAnswer) => void): () => void {
  answerListeners.add(listener);
  return () => answerListeners.delete(listener);
}

function answered(a: ConnectionAnswer): void {
  lastAnswer = a;
  for (const l of answerListeners) {
    try {
      l(a);
    } catch {
      // a listener never breaks the test
    }
  }
}

/**
 * The network settings' "test connection", through the library every vault
 * syncs with (a connection test that bypasses the engine in use proves
 * nothing about it). It reads one block header and derives
 * nothing, so it does not wait for the known-answer test. The answer is
 * kept for Diagnostics.
 */
export async function testBackendConnection(backend: BackendConfig): Promise<number> {
  const started = Date.now();
  try {
    const native = config?.native;
    if (!native) throw new Error(NO_WALLET_LIBRARY);
    const height = await testBackendConnectionV3(backend, native);
    answered({ height, error: null, ms: Date.now() - started, at: Date.now() });
    return height;
  } catch (e) {
    answered({ height: null, error: String((e as Error)?.message ?? e), ms: Date.now() - started, at: Date.now() });
    throw e;
  }
}

// ---------------------------------------------------------------- one address's activity

/**
 * What `backend` knows about one address (the address book's check, decided
 * 2026-11-05), or null when this build's bridge has no such call (an older
 * binary: the check then answers 'unknown'). The caller picks the server
 * through the vault's server rule (wallet/chainServers.ts
 * `lookupThroughChainServers`) and hands in exactly one. Like the connection
 * test it derives no vault's addresses, so it does not wait for the
 * known-answer test and never starts it; a test that FAILED this launch
 * refuses it, as it refuses every vault. Throws when the build links no
 * library or the server could not be asked.
 */
export async function lookUpAddressActivity(
  backend: BackendConfig,
  network: Network,
  address: string,
): Promise<AddressActivity | null> {
  const native = config?.native;
  if (!native) throw new Error(NO_WALLET_LIBRARY);
  if (knownAnswerSettled?.state === 'failed') throw new Error(LIBRARY_CHECK_FAILED);
  return addressActivityV3(backend, network, address, native);
}

/** Tests only: forget the launch. */
export function resetEngineForTests(): void {
  config = null;
  lastAnswer = null;
  answerListeners.clear();
  knownAnswer = null;
  knownAnswerSettled = null;
  knownAnswerListeners.clear();
}
