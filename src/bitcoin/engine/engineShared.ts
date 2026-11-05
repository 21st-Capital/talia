/**
 * The half of the wallet engine that never asks the native library (BDK
 * upgrade, decided 2026-10-15).
 *
 * Moved out of the old engine's `bdkEngine.ts` WITHOUT changing a single
 * native call: the fee-rate ceiling, the history order, the descriptor
 * split, the judge that decides whether a fallback witness may be trusted
 * (`complete()`), and the checks a transaction coming back from outside
 * passes before it is sent. The new engine ran this same code, so
 * the two could only differ where the libraries did; the old contract test
 * (`bdkBridgeProtocol.test.ts`) proved the move changed nothing. Since the old
 * engine's removal (decided 2026-11-04) the one engine, `bdkWalletEngine.ts`, runs it.
 *
 * Pure (no native import), so Jest runs it in Node.
 */
import type { Network } from '../descriptor/types';
import { splitMultipathDescriptor } from '../descriptor/multipath';
import { parsePolicy, fallbackWitnessAllowed, WAIT_NOT_CARRIED } from '../descriptor/policy';
import { mergeSignerGroups, psbtInputsFinalized, psbtSignatureStatus } from '../psbt/parse';
import { scureFinalizePsbt, finalizeCosigned } from '../psbt/finalize';
import { fallbackWitnessProblems, txLocksOf } from '../psbt/timelockCheck';
import { MAX_FEE_RATE } from '../psbt/build';
import { BroadcastRefusedError, rawTxShape, refusalMessage } from '../psbt/broadcastCheck';
import type { RescueExpectation, TxShape } from '../psbt/broadcastCheck';
import { verifyRescueOnChain, verifyRescueTransaction } from './rescueCheck';
import type {
  BackendConfig,
  BuildPsbtRequest,
  CompletePsbtOptions,
  RescueBuildRequest,
  WalletEngine,
  WalletTx,
  WatchOnlyWalletParams,
} from './types';

/** Build the `bitcoin:` URI form used for QR display. */
export function toUri(address: string): string {
  return `bitcoin:${address}`;
}

/**
 * Is it the same server, as a connection sees one: its URL (trimmed) and
 * whether its certificate is checked (a certificate rule changed is another
 * connection).
 */
export function sameServer(a: Pick<BackendConfig, 'url' | 'validateDomain'>, b: Pick<BackendConfig, 'url' | 'validateDomain'>): boolean {
  return a.url.trim() === b.url.trim() && (a.validateDomain ?? true) === (b.validateDomain ?? true);
}

/**
 * The server for a sync an engine makes on its own (no caller handed it
 * one): the last sync's while it is still one of the vault's servers now,
 * else the vault's first server now, else none (the vault has no server to
 * use, so nothing is asked). Without the wallet layer's list (tests, the
 * tier C runner), the last sync's. Never a server the vault no longer uses
 * (decided 2026-10-18: a Bitcoin vault talks to the server the client chose
 * and to no other).
 */
export async function ownSyncServer(
  last: BackendConfig | undefined,
  chainServers: WatchOnlyWalletParams['chainServers'],
): Promise<BackendConfig | null> {
  if (!chainServers) return last ?? null;
  const now = await chainServers();
  return (last && now.find((s) => sameServer(s, last))) || now[0] || null;
}

/**
 * The one build a rescue is, on every engine: every named coin drained to one
 * address on the rescue key's timelocked branch. RBF stays off in the build
 * because nSequence carries the path's older() value there, which is also what
 * lets the network replace a waiting rescue: anything below 0xFFFFFFFE signals
 * it (BIP-125).
 */
export function rescueBuild(request: RescueBuildRequest): BuildPsbtRequest {
  return {
    utxos: request.utxos,
    recipients: [{ address: request.destination, amountSats: 0 }],
    drain: true,
    feeRate: request.feeRate,
    ...(request.feeAbsolute != null ? { feeAbsolute: request.feeAbsolute } : {}),
    enableRbf: false,
    branchFingerprint: request.branchFingerprint,
    ...(request.replacing?.length ? { replacing: request.replacing } : {}),
  };
}

/** No build above the one ceiling, whoever chose the rate (decided 2026-09-26). */
export function assertFeeRate(rate: number): void {
  if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_FEE_RATE) {
    throw new Error(`The fee rate must be above 0 and at most ${MAX_FEE_RATE} sat/vB.`);
  }
}

/** Newest-first: confirmed by height desc, unconfirmed on top. Inside ONE
 *  block, sends list above receives: BDK gives no order within a block, and
 *  a receive listed above the sweep that spent it made the vault screen's
 *  running balance dip below zero on that row (decided 2026-09-07). */
export function sortByRecencyDesc(a: WalletTx, b: WalletTx): number {
  if (a.confirmed !== b.confirmed) return a.confirmed ? 1 : -1;
  return (b.blockHeight ?? 0) - (a.blockHeight ?? 0) || a.netAmount - b.netAmount;
}

/**
 * The two descriptors a wallet is opened with. bdk-rn 0.30, the old
 * engine's bridge, could not parse BIP-389 multipath (`<0;1>`) descriptors,
 * which is what Liana and Sparrow export, so they are split into external
 * and internal first, and the engine is still opened that way since the old engine's removal
 * (decided 2026-11-04); a separate change descriptor, when given, wins over
 * the split.
 */
export function descriptorPair(params: Pick<WatchOnlyWalletParams, 'descriptor' | 'changeDescriptor'>): {
  external: string;
  internal: string | null;
} {
  const split = splitMultipathDescriptor(params.descriptor);
  const changeStr = params.changeDescriptor ?? split.internal;
  return { external: split.external, internal: changeStr ? changeStr : null };
}

export interface FinalizationInput {
  /** The vault's descriptor (the judge reads its spending paths). */
  descriptor: string;
  /** The PSBT after the library's own finalizer, base64. */
  bdkPsbtBase64: string;
  /** Why the library's finalizer threw, when it did. */
  bdkError?: string;
  /** The copy the device returned. */
  signedPsbtBase64: string;
  /** The copy that went out, when the caller holds it. */
  originalPsbtBase64?: string;
  opts?: CompletePsbtOptions;
}

export interface FinalizationResult {
  psbtBase64: string;
  finalized: boolean;
  finalizeNotes?: string[];
}

/**
 * Everything `completePsbt` does after the library's finalizer: when an
 * input is still open, the scure fallback finalizers, and the judge that
 * decides whether their witness may be trusted, with the reasons kept for
 * the screen when nothing could be assembled.
 */
export function finishFinalization(input: FinalizationInput): FinalizationResult {
  const { bdkError, signedPsbtBase64, originalPsbtBase64, opts } = input;
  let psbtBase64 = input.bdkPsbtBase64;
  let finalized = psbtInputsFinalized(psbtBase64);
  let finalizeNotes: string[] | undefined;

  /**
   * May we TRUST a witness the fallback finalizer built? (decided 2026-07-28.)
   *
   * @scure classifies each tapleaf by template. Our timelocked leaves —
   * `and_v(v:multi_a(k,…),older(N))` — end in CHECKSEQUENCEVERIFY, so they
   * match neither of its multisig templates and land in its `unknown`
   * branch, which assembles a witness from whatever signatures it finds
   * WITHOUT checking completeness. A multi_a needs an empty placeholder for
   * every key that didn't sign, so an under-signed recovery leaf yields a
   * short, invalid witness — and our finalized-check only asks whether a
   * witness exists.
   *
   * Vaults Talia builds have single-key recovery leaves, where that cannot
   * happen. An IMPORTED vault can have a multi-key recovery layer (a 2-of-2
   * primary behind a 2-of-3 recovery, say), which makes it reachable — so
   * the fallback's word is only accepted when the signatures actually
   * satisfy one of the descriptor's spending paths.
   *
   * Deliberately conservative: when the policy can't be flattened, or any
   * key lacks a fingerprint (an imported bare xpub), we cannot tell
   * "unsigned" from "unknown key", so we do NOT block.
   */
  let refusalReason: string | undefined;
  // A leaf-hazard refusal (the witness check, or the judge's "wait not carried"),
  // named in the co-sign route's note; every other refusal keeps its words.
  let d10Refusal: string | undefined;
  // The leaf hazard (2026-10-17): the transaction's own lock fields. A
  // waiting path counts only when the transaction carries its wait.
  const txLocks = txLocksOf(psbtBase64) ?? undefined;
  const fallbackTrustworthy = (sources: string[], assembled: string): boolean => {
    d10Refusal = undefined;
    try {
      const policy = parsePolicy(input.descriptor);
      // Judged on the copies the witness was built FROM: a finalized input
      // keeps only its witness, so the finalized copy shows no signer at
      // all and every judgeable vault was refused. Per input and per
      // tapleaf (decided 2026-09-26): signatures on different leaves never add
      // up to one path.
      const signerGroups = mergeSignerGroups(
        ...sources.map((p) => psbtSignatureStatus(p).signerGroups),
      );
      // Counting signatures was not enough: it said yes to a TIMELOCKED path
      // whose wait was not over, so the app reported "ready to send" and the
      // network rejected it (2026-07-29). This also asks whether the wait is
      // over — and only refuses when it PROVABLY is not, so a real rescue
      // still assembles. And (the leaf hazard) a waiting path counts only when the
      // transaction itself carries the wait.
      const verdict = fallbackWitnessAllowed(policy, { signerGroups }, opts?.inputConfirmations, txLocks);
      if (!verdict.allowed) {
        refusalReason = verdict.reason;
        if (verdict.reason === WAIT_NOT_CARRIED) d10Refusal = verdict.reason;
        return false;
      }
    } catch {
      // never block on an analysis failure of the policy reading; the
      // witness check below still runs
    }
    // Then what the witness itself would run (the leaf hazard): every lock in the script
    // it executes must be carried by the transaction, and a script @scure has
    // no template for is never sent (it hands back the script with no
    // signatures). Exact where the policy reading above, by fingerprints,
    // can only estimate; it runs whatever that reading said.
    const problems = fallbackWitnessProblems(input.bdkPsbtBase64, assembled, sources);
    if (problems.length > 0) {
      refusalReason = d10Refusal = problems.join('; ');
      return false;
    }
    return true;
  };
  if (!finalized) {
    // Fallback finalizers (the sign-first co-sign bug, 2026-07-24): with the
    // client's and 21C's TAP_SCRIPT_SIGs arriving in two divergent PSBT
    // copies, BDK 0.28 fails to assemble the witness even though every
    // signature is present. @scure/btc-signer (audited; the same library the
    // air-gapped co-signer signs with) handles that shape. Finalization only
    // assembles a witness from signatures already in the PSBT — no keys, no
    // signing — and `finalizeCosigned` re-enforces BDK's own rule that the
    // two copies must describe the SAME transaction before trusting either.
    const solo = scureFinalizePsbt(psbtBase64);
    if (solo && fallbackTrustworthy([psbtBase64], solo)) {
      psbtBase64 = solo;
      finalized = psbtInputsFinalized(psbtBase64);
    } else if (solo) {
      finalizeNotes = [
        `refused a fallback witness: ${refusalReason ?? 'the signatures do not satisfy any spending path'}`,
      ];
    }
    if (!finalized && originalPsbtBase64) {
      const routes = finalizeCosigned(originalPsbtBase64, signedPsbtBase64);
      if (routes.psbtBase64 && fallbackTrustworthy(routes.sources, routes.psbtBase64)) {
        psbtBase64 = routes.psbtBase64;
        finalized = psbtInputsFinalized(psbtBase64);
      } else if (routes.psbtBase64) {
        routes.attempts.push(
          d10Refusal
            ? `refused: ${d10Refusal}`
            : 'refused: the witness would be incomplete because the signatures present do not satisfy any spending path',
        );
      }
      // Keep WHY every route failed — the UI shows it instead of a dead end.
      if (!finalized) {
        finalizeNotes = [
          ...(bdkError ? [`bdk sign/finalize: ${bdkError}`] : ['bdk sign/finalize: no error, produced no witness']),
          ...routes.attempts,
        ];
      }
    }
    // Single-copy callers (the rescue ceremony hands over one PSBT) never
    // enter the combine route above — without this they'd get a bare
    // "not finalized" and no reason at all (decided 2026-08-26).
    if (!finalized && !originalPsbtBase64 && finalizeNotes == null) {
      finalizeNotes = [
        bdkError
          ? `bdk sign/finalize: ${bdkError}`
          : 'bdk sign/finalize: no error, produced no witness',
        ...(refusalReason ? [`refused a fallback witness: ${refusalReason}`] : []),
      ];
    }
  }
  return { psbtBase64, finalized, finalizeNotes };
}

/**
 * The bytes a device or file returned must be the transaction the client
 * reviewed (decided 2026-09-26): same txid as the unsigned PSBT. Compared as it
 * stood unsigned, so a signed nested-segwit or legacy input (signature in
 * the scriptSig) still matches its PSBT. Throws; nothing is sent.
 */
export function assertReviewedRawTx(txBytes: Uint8Array, network: Network, expectedTxid: string): void {
  const shape = rawTxShape(txBytes, network);
  if (!shape) {
    throw new BroadcastRefusedError({ code: 'unreadable' }, refusalMessage({ code: 'unreadable' }));
  }
  if (!expectedTxid || shape.unsignedTxid.toLowerCase() !== expectedTxid.toLowerCase()) {
    throw new BroadcastRefusedError({ code: 'different-tx' }, refusalMessage({ code: 'different-tx' }));
  }
}

/**
 * A rescue spends only this vault's coins and pays only the destination
 * filed on the phone (decided 2026-09-26). Throws a BroadcastRefusedError
 * otherwise, or when the transaction cannot be read at all.
 */
export async function assertRescueSpend(
  engine: Pick<WalletEngine, 'listUtxos' | 'ownsAddress' | 'network'>,
  shape: TxShape | null,
  expect: RescueExpectation,
): Promise<void> {
  const refusal = shape
    ? await verifyRescueTransaction(engine, shape, expect)
    : ({ code: 'unreadable' } as const);
  if (refusal) throw new BroadcastRefusedError(refusal, refusalMessage(refusal));
}

/**
 * The same rule for a rescue the chain ALREADY has, before the phone calls
 * it sent and reports it Completed (decided 2026-10-19). `tx` is the vault's
 * own record of it. Throws a BroadcastRefusedError like assertRescueSpend.
 */
export async function assertRescueOnChain(
  engine: Pick<WalletEngine, 'ownsAddress' | 'network'>,
  shape: TxShape | null,
  tx: Pick<WalletTx, 'sent' | 'fee'>,
  expect: RescueExpectation,
): Promise<void> {
  const refusal = shape
    ? await verifyRescueOnChain(engine, shape, tx, expect)
    : ({ code: 'unreadable' } as const);
  if (refusal) throw new BroadcastRefusedError(refusal, refusalMessage(refusal));
}

/** A rescue 21st Capital signed that no finalizer could assemble. */
export function rescueNotAssembledError(finalizeNotes?: string[]): Error {
  const why = finalizeNotes?.length ? `\n\nDetails:\n· ${finalizeNotes.join('\n· ')}` : '';
  return new Error(
    'The signed rescue could not be assembled for sending. Please contact the recovery team.' + why,
  );
}
