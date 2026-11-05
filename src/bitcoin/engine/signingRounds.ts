/**
 * Real signing rounds, captured on TESTNET in the phone app only, so the
 * new library can be checked against what the devices really send back
 * (BDK upgrade, decided 2026-10-15: real replies, the PSBTs
 * captured in a recorded session, on testnet keys only, replayed through
 * the old and new complete(), broadcastRescue and broadcastPsbt).
 *
 * Every device reply reaches the engine through three doors: `completePsbt`
 * (a Ledger's merged signatures, a BitBox's, a Passport's UR, the 21C
 * co-signer's Krux reply), `broadcastRescue` (the 21C rescue signer's) and
 * `broadcastRawTx` (a device that finalized itself). `capturingEngine` wraps
 * an engine so each of those calls is copied here before and after it runs,
 * and changes nothing about it: the same arguments go in, the same answer
 * or error comes out, and a failure to record is swallowed.
 *
 * Only the phone app (TALIA_FULL) and only a testnet vault are ever wrapped
 * (`capturesSigningRounds`); a mainnet vault's PSBTs are never copied. The
 * rounds live in memory for the launch (nothing touches the disk) until
 * Settings > Diagnostics > "Export signing round" hands them to the share
 * sheet as one file.
 *
 * Pure (no native import).
 */
import type { BuildFlavour } from '../../config';
import type { Network } from '../descriptor/types';
import type { RescueExpectation } from '../psbt/broadcastCheck';
import { encodeBase64 } from '../psbt/export';
import type { PolicyNode } from './policyPath';
import type {
  AddressRequest,
  BackendConfig,
  BuildPsbtRequest,
  CompletePsbtOptions,
  CompletedPsbt,
  RescueBuildRequest,
  WalletEngine,
} from './types';

export const SIGNING_ROUNDS_SCHEMA = 'talia-signing-rounds/1';

/** The most rounds kept; the oldest go first. */
export const MAX_SIGNING_ROUNDS = 30;

export interface SigningRound {
  /** ISO time the call was made. */
  at: string;
  network: Network;
  call: 'completePsbt' | 'broadcastRescue' | 'broadcastRawTx';
  /** completePsbt: the copy that went out to the device, when given. */
  originalPsbtBase64?: string;
  /** completePsbt: what came back; broadcastRescue/RawTx: the bytes, base64. */
  replyBase64: string;
  /** completePsbt's options (the youngest coin's confirmations). */
  opts?: CompletePsbtOptions;
  /** broadcastRawTx: the unsigned txid the reply must match. */
  expectedTxid?: string;
  /** What the engine answered, or why it refused. */
  result?: Pick<CompletedPsbt, 'finalized' | 'psbtBase64' | 'txid' | 'finalizeNotes'>;
  /** broadcastRescue/RawTx: the txid sent, when the network took it. */
  sentTxid?: string;
  error?: string;
}

const rounds: SigningRound[] = [];
const listeners = new Set<() => void>();

function keep(round: SigningRound): SigningRound {
  rounds.push(round);
  while (rounds.length > MAX_SIGNING_ROUNDS) rounds.shift();
  for (const l of listeners) {
    try {
      l();
    } catch {
      // a listener never breaks a signing
    }
  }
  return round;
}

/** The rounds of this launch, oldest first. */
export function signingRounds(): readonly SigningRound[] {
  return rounds.slice();
}

export function clearSigningRounds(): void {
  rounds.length = 0;
  for (const l of listeners) l();
}

/** Told whenever a round is kept or the list is cleared. */
export function onSigningRounds(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The phone app, on testnet: the only place a round is ever copied. */
export function capturesSigningRounds(flavour: BuildFlavour, network: Network): boolean {
  return flavour === 'full' && network === 'testnet';
}

/** The file "Export signing round" shares. */
export function signingRoundsFile(list: readonly SigningRound[], app: { version: string; build: string }): string {
  return JSON.stringify(
    {
      schema: SIGNING_ROUNDS_SCHEMA,
      exportedAt: new Date().toISOString(),
      app,
      // Test networks only, by construction (capturesSigningRounds).
      rounds: list.filter((r) => r.network === 'testnet'),
    },
    null,
    2,
  );
}

const messageOf = (e: unknown) => String((e as Error)?.message ?? e);

/** An engine's optional policy-tree read (both engines have one; WalletEngine does not name it). */
type WithPolicyTree = { policyTree?(keychain: 'external' | 'internal'): Promise<PolicyNode | null> };

/**
 * The same engine, with its three reply doors copied into the rounds. Every
 * other call goes straight through, the inner engine's OPTIONAL reads too,
 * and only where it has them (decided 2026-10-20): an absent `addressReach`
 * tells Receive's search for a coin's address to use its own bound (0..999,
 * what the 0.28 engine got), so the wrapper dropping the engine's would hide
 * a coin past index 999 that the engine itself lists.
 */
export function capturingEngine(inner: WalletEngine & WithPolicyTree): WalletEngine & WithPolicyTree {
  // Recording never stands between the client and the engine: anything
  // that fails here leaves the call to run exactly as it would have.
  const record = (make: () => SigningRound): SigningRound | null => {
    try {
      return keep(make());
    } catch {
      return null;
    }
  };
  const note = (round: SigningRound | null, fill: (r: SigningRound) => void) => {
    if (!round) return;
    try {
      fill(round);
    } catch {
      // as above
    }
  };
  return {
    get network() {
      return inner.network;
    },
    sync: (backend: BackendConfig) => inner.sync(backend),
    getBalance: () => inner.getBalance(),
    listTransactions: () => inner.listTransactions(),
    getReceiveAddress: (which?: AddressRequest) => inner.getReceiveAddress(which),
    getInternalAddress: (which?: AddressRequest) => inner.getInternalAddress(which),
    listUtxos: () => inner.listUtxos(),
    getTipHeight: () => inner.getTipHeight(),
    ownsAddress: (address: string) => inner.ownsAddress(address),
    buildPsbt: (request: BuildPsbtRequest) => inner.buildPsbt(request),
    buildRescuePsbt: (request: RescueBuildRequest) => inner.buildRescuePsbt(request),
    getRawTx: (txid: string) => inner.getRawTx(txid),
    broadcastPsbt: (psbtBase64: string, backend: BackendConfig) => inner.broadcastPsbt(psbtBase64, backend),
    ...(inner.addressReach
      ? { addressReach: (keychain: 'external' | 'internal') => inner.addressReach!(keychain) }
      : {}),
    ...(inner.policyTree
      ? { policyTree: (keychain: 'external' | 'internal') => inner.policyTree!(keychain) }
      : {}),

    async completePsbt(signed: string, original?: string, opts?: CompletePsbtOptions): Promise<CompletedPsbt> {
      const round = record(() => ({
        at: new Date().toISOString(),
        network: inner.network,
        call: 'completePsbt',
        ...(original != null ? { originalPsbtBase64: original } : {}),
        replyBase64: signed,
        ...(opts != null ? { opts: { ...opts } } : {}),
      }));
      try {
        const result = await inner.completePsbt(signed, original, opts);
        note(round, (r) => {
          r.result = {
            finalized: result.finalized,
            psbtBase64: result.psbtBase64,
            txid: result.txid,
            ...(result.finalizeNotes ? { finalizeNotes: [...result.finalizeNotes] } : {}),
          };
        });
        return result;
      } catch (e) {
        note(round, (r) => {
          r.error = messageOf(e);
        });
        throw e;
      }
    },

    async broadcastRescue(signed: Uint8Array, expect: RescueExpectation, backend: BackendConfig): Promise<string> {
      const round = record(() => ({
        at: new Date().toISOString(),
        network: inner.network,
        call: 'broadcastRescue',
        replyBase64: encodeBase64(signed),
      }));
      try {
        const txid = await inner.broadcastRescue(signed, expect, backend);
        note(round, (r) => {
          r.sentTxid = txid;
        });
        return txid;
      } catch (e) {
        note(round, (r) => {
          r.error = messageOf(e);
        });
        throw e;
      }
    },

    async broadcastRawTx(txBytes: Uint8Array, backend: BackendConfig, expectedTxid: string): Promise<string> {
      const round = record(() => ({
        at: new Date().toISOString(),
        network: inner.network,
        call: 'broadcastRawTx',
        replyBase64: encodeBase64(txBytes),
        expectedTxid,
      }));
      try {
        const txid = await inner.broadcastRawTx(txBytes, backend, expectedTxid);
        note(round, (r) => {
          r.sentTxid = txid;
        });
        return txid;
      } catch (e) {
        note(round, (r) => {
          r.error = messageOf(e);
        });
        throw e;
      }
    },
  };
}
