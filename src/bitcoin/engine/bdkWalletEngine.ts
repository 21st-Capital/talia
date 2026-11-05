/**
 * The wallet engine: bdk-ffi 3.1.1 from the fork's talia-3 line, through
 * TaliaBdkWalletModule (BDK upgrade, decided 2026-10-15). The
 * only engine since the old one was removed (decided 2026-11-04; bdk
 * 0.28 behind the bdk-ffi 0.30 fork, bdkEngine.ts).
 *
 * It implements the same `WalletEngine` the old engine did and shares the
 * pure half the two had in common (engineShared.ts: the fee ceiling, the
 * history order, the descriptor split, the scure fallback and its judge, the
 * raw-transaction and rescue checks), so while both shipped they could only
 * differ where the libraries did. What changed with it:
 *   1. 'testnet' is Testnet4 (the bridge maps it).
 *   2. The multipath descriptor is split here, as before; multi_a stays self-sorted.
 *   3. Discovery: the bridge fixes the stop gap and lookahead at 150, ignores
 *      the saved stopGap, and scans each keychain as far as the other one's
 *      last use plus 150 (the coverage rule, decided 2026-10-17).
 *   4. A fresh wallet per sync with the session's revealed range carried (the bridge).
 *   5. The rate as ceil(rate x 250) sat/kwu (bdkWalletRules.satPerKwu).
 *   6. 0.28's transaction shape (decided 2026-10-15): version 1 unless the chosen path
 *      carries an older(), a Version1Csv refusal built again as version 2;
 *      nSequence chosen by the bridge from RBF, the CSV path and nLockTime;
 *      the outputs shuffled here, as 0.28 shuffled them (the inputs stay in
 *      the bridge's order: named coins as named, a drain's in 0.28's order,
 *      the drain order).
 *   7. Change: peeked, revealed only when the build succeeded (the bridge).
 *   8. The policy path: the same `branchPolicyPath`/`primaryPolicyPath`, the
 *      retry on the CODE SPENDING_POLICY_REQUIRED, ids read live.
 *   9. Speed up and Cancel, and a rescue's speed-up: `replacing` is passed through.
 *  10. completePsbt: combine(original, signed) with the combine repair, the
 *      library's finalizer (where the leaf hazard's fix lands), then the scure fallback
 *      and its judge, as today.
 *  11. Errors: `EngineError` with a code and 0.28's words (bdkWalletNative.ts).
 * The fee floor (never below ceil(rate x vsize)) is the bridge's.
 *
 * Servers (decided 2026-10-18, wallet/chainServers.ts): a sync, the
 * connection test and every broadcast go to the server the caller hands in,
 * which the wallet layer picked from the vault's own servers; each broadcast
 * gets a short-lived client of its own, never the last sync's. The one sync
 * this engine makes on its own (after a panic) asks the vault's servers as
 * they are then (`chainServers`), so a server the client has left is never
 * asked again.
 *
 * Watch-only: public descriptors only, and nothing here can sign.
 */
import type { Network } from '../descriptor/types';
import { branchPolicyPath, primaryPolicyPath } from './policyPath';
import type { KeychainPolicies, PolicyNode, PolicyPath } from './policyPath';
import { addressFitsNetwork, wrongNetworkMessage } from '../addressNetwork';
import type {
  AddressActivity,
  AddressRequest,
  Balance,
  BackendConfig,
  BuildPsbtRequest,
  CompletedPsbt,
  CompletePsbtOptions,
  PsbtBuildResult,
  ReceiveAddress,
  RescueBuildRequest,
  Utxo,
  WalletEngine,
  WalletEngineFactory,
  WalletTx,
  WatchOnlyWalletParams,
} from './types';
import { assertSigningEnabled } from './spendGate';
import { psbtTxShape, rawTxShape } from '../psbt/broadcastCheck';
import type { RescueExpectation } from '../psbt/broadcastCheck';
import { looksLikePsbt, encodeBase64 } from '../psbt/export';
import { shufflePsbtOutputs, secureRandom } from '../psbt/shuffleOutputs';
import { classifyEngineError, engineErrorMessage, EngineError, POST_BUILD_CHECK_MESSAGE } from './engineError';
import { ownOutputProblems, SEND_PAUSED_TITLE } from './addressCheck';
import {
  assertFeeRate,
  assertRescueSpend,
  assertReviewedRawTx,
  descriptorPair,
  finishFinalization,
  ownSyncServer,
  rescueBuild,
  rescueNotAssembledError,
  sortByRecencyDesc,
  toUri,
} from './engineShared';
import { bridged } from './bdkWalletNative';
import type { BdkWalletNative, NativeBuildOptions, NativeBuildResult, NativeKeychain, NativeSyncResult } from './bdkWalletNative';
import {
  baseBuildOptions,
  lookupServerOf,
  nativeNetworkOf,
  probeServerOf,
  syncServerOf,
  whichOf,
  withPaths,
} from './bdkWalletRules';

const hexOf = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const bytesOf = (hex: string): Uint8Array => Uint8Array.from((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

export interface BdkWalletEngineDeps {
  /** The bridge: this build's module (platform/bdkWalletModule.ts), or a recorder. */
  native?: BdkWalletNative;
  /** A float in [0, 1) for the output shuffle. Default: the CSPRNG. */
  random?: () => number;
  /** Told after every sync (the tier C harness reads its passes). */
  onSync?: (result: NativeSyncResult) => void;
  /** Told when a build was retried as version 2. */
  onVersionRetry?: () => void;
}

function requireNative(deps?: BdkWalletEngineDeps): BdkWalletNative {
  const n = deps?.native;
  if (!n) throw new Error('This build does not carry the new wallet library.');
  return n;
}

/**
 * A watch-only wallet on the new library. Created by `BdkWalletEngineV3.create`.
 * The library keeps nothing on the phone (decided 2026-10-15): every launch re-scans.
 */
export class BdkWalletEngineV3 implements WalletEngine {
  readonly network: Network;
  private readonly native: BdkWalletNative;
  private readonly id: string;
  private readonly descriptorStr: string;
  private readonly changeDescriptor?: string;
  private readonly hasChange: boolean;
  private readonly random: () => number;
  private readonly deps?: BdkWalletEngineDeps;
  private tipHeight?: number;
  /** The hash of the tip block the last sync reached (`getTipHash`). */
  private tipHash?: string;
  /** The server of the last sync, for the sync a panic makes necessary. */
  private lastBackend?: BackendConfig;
  /** The vault's servers now (WatchOnlyWalletParams.chainServers), when the wallet layer gave them. */
  private readonly chainServers?: WatchOnlyWalletParams['chainServers'];
  /**
   * A panic recreated the library's wallet (RUST_PANIC): it holds no coins
   * and no tip, and the bridge answers WALLET_RESYNCING to every read of the
   * chain until it synced again. The next read or build syncs first.
   */
  private resyncPending = false;
  /** Each keychain's policy tree, read once (they never change). */
  private trees: Partial<Record<NativeKeychain, PolicyNode | null>> = {};
  /** {rootPolicyNodeId: [primaryIndex]} per keychain, read once. */
  private primaryCache: Partial<Record<NativeKeychain, PolicyPath | null>> = {};

  private constructor(
    network: Network,
    native: BdkWalletNative,
    id: string,
    descriptorStr: string,
    changeDescriptor: string | undefined,
    hasChange: boolean,
    deps?: BdkWalletEngineDeps,
    chainServers?: WatchOnlyWalletParams['chainServers'],
  ) {
    this.network = network;
    this.chainServers = chainServers;
    this.native = native;
    this.id = id;
    this.descriptorStr = descriptorStr;
    this.changeDescriptor = changeDescriptor;
    this.hasChange = hasChange;
    this.random = deps?.random ?? secureRandom;
    this.deps = deps;
  }

  /** Open a watch-only wallet from a (public) descriptor. */
  static async create(params: WatchOnlyWalletParams, deps?: BdkWalletEngineDeps): Promise<BdkWalletEngineV3> {
    const native = requireNative(deps);
    // The library reads a multipath descriptor itself, but the app hands it
    // the same two descriptors the old engine opened (engineShared).
    const pair = descriptorPair(params);
    const id = await bridged(native.openWallet(pair.external, pair.internal, nativeNetworkOf(params.network)));
    return new BdkWalletEngineV3(
      params.network,
      native,
      id,
      params.descriptor,
      params.changeDescriptor,
      pair.internal != null,
      deps,
      params.chainServers,
    );
  }

  /**
   * The bridge and this engine's wallet id, for reads the WalletEngine
   * interface has no room for (a coin's derivation index and height, a
   * keychain's revealed index): the tier C harness only. Nothing in the app
   * calls it.
   */
  nativeHandle(): { native: BdkWalletNative; id: string } {
    return { native: this.native, id: this.id };
  }

  /** Free the library's wallet (the engine is unusable after). */
  async close(): Promise<void> {
    await bridged(this.native.closeWallet(this.id));
  }

  async sync(backend: BackendConfig): Promise<void> {
    this.lastBackend = backend;
    const r = await this.call(this.native.sync(this.id, syncServerOf(backend)));
    this.tipHeight = r.tipHeight;
    this.tipHash = r.tipHash;
    this.resyncPending = false;
    this.deps?.onSync?.(r);
  }

  /**
   * A bridge call, its rejection as an EngineError. A panic leaves the wallet
   * empty at genesis: the tip this engine kept is forgotten (a build must not
   * use it as nLockTime) and the next read syncs again (`ready`).
   */
  private async call<T>(p: Promise<T>): Promise<T> {
    try {
      return await bridged(p);
    } catch (e) {
      const code = classifyEngineError(e);
      if (code === 'RUST_PANIC' || code === 'WALLET_RESYNCING') {
        this.tipHeight = undefined;
        this.tipHash = undefined;
        this.resyncPending = true;
      }
      if (code === 'POST_BUILD_CHECK') {
        // The bridge's own words name inputs and PSBT fields: the log keeps
        // them, the client reads one plain sentence.
        console.warn(`[engine] the build was refused by its own checks: ${engineErrorMessage(e)}`);
        throw new EngineError('POST_BUILD_CHECK', POST_BUILD_CHECK_MESSAGE);
      }
      throw e;
    }
  }

  /**
   * The server for the sync a panic makes necessary: the last sync's while
   * it is still one of the vault's servers, else the vault's server now
   * (the client chose another since), never one it no longer uses; null
   * before any sync, or while the vault has no server (decided 2026-10-18,
   * wallet/chainServers.ts).
   */
  private async resyncServer(): Promise<BackendConfig | null> {
    if (!this.lastBackend) return null;
    return ownSyncServer(this.lastBackend, this.chainServers);
  }

  /** Before a read of the chain or a build: the sync a panic made necessary. */
  private async ready(): Promise<void> {
    if (!this.resyncPending) return;
    const server = await this.resyncServer();
    if (server) await this.sync(server);
  }

  /**
   * A read of the chain: synced first if a panic is known, and asked once
   * more after a sync when the bridge says WALLET_RESYNCING (a panic this
   * engine did not see, on a call made around it).
   */
  private async read<T>(ask: () => Promise<T>): Promise<T> {
    await this.ready();
    try {
      return await this.call(ask());
    } catch (e) {
      if (classifyEngineError(e) !== 'WALLET_RESYNCING') throw e;
      const server = await this.resyncServer();
      if (!server) throw e;
      await this.sync(server);
      return this.call(ask());
    }
  }

  getTipHeight(): number | undefined {
    return this.tipHeight;
  }

  /**
   * The hash of the tip block the last sync reached (since 2026-10-28, for
   * the shadow's height buckets; nothing in the app reads it since the old engine's removal,
   * kept read-only beside the bridge's answer), undefined before a sync,
   * after a panic, or from a bridge before.
   */
  getTipHash(): string | undefined {
    return this.tipHash;
  }

  async listUtxos(): Promise<Utxo[]> {
    const unspent = await this.read(() => this.native.unspent(this.id));
    return unspent
      .map(
        (u): Utxo => ({
          txid: u.txid,
          vout: u.vout,
          valueSats: u.value,
          address: u.address ?? undefined,
          keychain: u.keychain === 'internal' ? 'internal' : 'external',
        }),
      )
      .sort((a, b) => b.valueSats - a.valueSats);
  }

  async getBalance(): Promise<Balance> {
    const b = await this.read(() => this.native.balance(this.id));
    // Spendable is trusted_spendable; immature stays out of the four.
    return {
      confirmed: b.confirmed,
      trustedPending: b.trustedPending,
      untrustedPending: b.untrustedPending,
      spendable: b.spendable,
      total: b.total,
    };
  }

  async listTransactions(): Promise<WalletTx[]> {
    const txs = await this.read(() => this.native.transactions(this.id));
    return txs
      .map(
        (t): WalletTx => ({
          txid: t.txid,
          received: t.received,
          sent: t.sent,
          netAmount: t.received - t.sent,
          fee: t.fee ?? undefined,
          confirmed: t.height != null,
          blockHeight: t.height ?? undefined,
          timestamp: t.timestamp ?? undefined,
          ...(t.blockHash != null ? { blockHash: t.blockHash } : {}),
        }),
      )
      .sort(sortByRecencyDesc);
  }

  /**
   * The server's blocks at these heights now (its hash and time), asked of the
   * server of this engine's last sync, never of a cache (decided 2026-10-28,
   * for the shadow checks, which asked whether the block each engine
   * reported for a transaction was still on the chain; nothing in the app
   * calls it since the old engine's removal, and the bridge keeps the call). Null for a height above the server's
   * tip; null altogether before a sync, or from a bridge without the call.
   */
  async serverBlocks(heights: number[]): Promise<Array<{ height: number; hash: string; time: number } | null> | null> {
    const serverBlocks = this.native.serverBlocks;
    if (!this.lastBackend || !serverBlocks) return null;
    return bridged(serverBlocks.call(this.native, this.id, syncServerOf(this.lastBackend), heights));
  }

  private async addressOf(keychain: NativeKeychain, which: AddressRequest): Promise<ReceiveAddress> {
    // A peeked index needs no chain; 'new' and 'lastUnused' read the coins.
    const ask = () => this.native.address(this.id, keychain, whichOf(which));
    const info = typeof which === 'number' ? await this.call(ask()) : await this.read(ask);
    // A peek answers the index it was asked for, as 0.28 did: bdk_wallet 3.x
    // reports index 0 for every peek of a descriptor with no wildcard (the
    // same address either way), which the address check would read as
    // another address (as the preflight did; found by tier C's build matrix
    // while it ran).
    const index = typeof which === 'number' ? which : info.index;
    return { address: info.address, index, uri: toUri(info.address) };
  }

  getReceiveAddress(which: AddressRequest = 'new'): Promise<ReceiveAddress> {
    return this.addressOf('external', which);
  }

  getInternalAddress(which: AddressRequest = 'new'): Promise<ReceiveAddress> {
    return this.addressOf('internal', which);
  }

  /** The library's last revealed index on a keychain (read only), or null. */
  async addressReach(keychain: 'external' | 'internal'): Promise<number | null> {
    const k: NativeKeychain = keychain === 'internal' && this.hasChange ? 'internal' : 'external';
    const i = await this.call(this.native.derivationIndex(this.id, k));
    return typeof i === 'number' && Number.isInteger(i) && i >= 0 ? i : null;
  }

  async ownsAddress(address: string): Promise<boolean> {
    // An address of another network is never the vault's (decided 2026-09-26).
    if (!addressFitsNetwork(address, this.network)) return false;
    try {
      return await this.read(() => this.native.isMine(this.id, address.trim()));
    } catch {
      return false;
    }
  }

  /** A keychain's policy tree, as the library writes it (3.x JSON), or null. */
  async policyTree(keychain: NativeKeychain): Promise<PolicyNode | null> {
    if (this.trees[keychain] !== undefined) return this.trees[keychain] ?? null;
    const json = await this.call(this.native.policies(this.id, keychain));
    const tree = json ? (JSON.parse(json) as PolicyNode) : null;
    this.trees[keychain] = tree;
    return tree;
  }

  private async policies(): Promise<KeychainPolicies> {
    return {
      external: await this.policyTree('external').catch(() => null),
      internal: this.hasChange ? await this.policyTree('internal').catch(() => null) : null,
    };
  }

  async buildPsbt(request: BuildPsbtRequest): Promise<PsbtBuildResult> {
    assertSigningEnabled('Sending');
    return this.build(request);
  }

  /** The rescue request's PSBT, exactly as the old engine built it (decided 2026-09-26). */
  async buildRescuePsbt(request: RescueBuildRequest): Promise<PsbtBuildResult> {
    if (!request.branchFingerprint || request.utxos.length === 0) {
      throw new Error('A rescue spends named coins on the rescue path.');
    }
    return this.build(rescueBuild(request));
  }

  private async build(request: BuildPsbtRequest): Promise<PsbtBuildResult> {
    if (request.recipients.length === 0) {
      throw new Error('At least one recipient is required');
    }
    assertFeeRate(request.feeRate);
    // A wallet a panic recreated syncs before the tip is read for nLockTime.
    await this.ready();
    // The old engine's one place an address became a script (decided 2026-09-26):
    // a drain's first recipient, else every recipient.
    const checked = request.drain ? request.recipients.slice(0, 1) : request.recipients;
    for (const r of checked) {
      if (!addressFitsNetwork(r.address, this.network)) throw new Error(wrongNetworkMessage(this.network));
    }
    const base = baseBuildOptions(request, this.tipHeight);
    const policies = await this.policies();

    if (request.branchFingerprint) {
      // RESCUE/RECOVERY: the named key's timelocked branch, never the primary path.
      const fp = request.branchFingerprint.toLowerCase();
      const external = branchPolicyPath(policies.external, fp);
      const internal = this.hasChange ? branchPolicyPath(policies.internal ?? null, fp) : null;
      if (!external && !internal) {
        throw new Error('This vault has no spending path for that key.');
      }
      return this.finishBuild(await this.runBuild(withPaths(base, policies, { external, internal })), request);
    }
    let result: NativeBuildResult;
    try {
      result = await this.runBuild(withPaths(base, policies, null));
    } catch (e) {
      // A multi-path vault: the library will not choose a branch on its own.
      // Take the PRIMARY path on both keychains and build again (the retry
      // reads the code, engineError.ts).
      if (classifyEngineError(e) !== 'SPENDING_POLICY_REQUIRED') throw e;
      const external = this.primaryPathFor('external', policies.external);
      const internal = this.hasChange ? this.primaryPathFor('internal', policies.internal ?? null) : null;
      if (!external && !internal) throw e;
      result = await this.runBuild(withPaths(base, policies, { external, internal }));
    }
    return this.finishBuild(result, request);
  }

  /** The build, once more as version 2 when the library says the path needs it. */
  private async runBuild(options: NativeBuildOptions): Promise<NativeBuildResult> {
    try {
      return await this.call(this.native.build(this.id, options));
    } catch (e) {
      if (classifyEngineError(e) !== 'VERSION1_CSV') throw e;
      this.deps?.onVersionRetry?.();
      return this.call(this.native.build(this.id, { ...options, version: 2, csvPath: true }));
    }
  }

  private primaryPathFor(keychain: NativeKeychain, tree: PolicyNode | null): PolicyPath | null {
    const cached = this.primaryCache[keychain];
    if (cached !== undefined) return cached;
    let path: PolicyPath | null;
    try {
      path = primaryPolicyPath(tree, this.descriptorStr);
    } catch {
      path = null;
    }
    this.primaryCache[keychain] = path;
    return path;
  }

  private finishBuild(result: NativeBuildResult, request: BuildPsbtRequest): PsbtBuildResult {
    // Every output the build marks as the vault's own (the change, a refresh,
    // a cancel) pays the script scure derives at the index it names: the
    // change index is usually far past the 0..9 sweep, and after the old engine's removal
    // this is the only independent look at it (decided 2026-10-17).
    const problem = ownOutputProblems(result.psbt, {
      descriptor: this.descriptorStr,
      changeDescriptor: this.changeDescriptor,
      network: this.network,
    });
    if (problem?.kind === 'mismatch') {
      // The library and scure disagree about an address of this vault, past
      // the 0..9 sweep: the vault pauses like a sweep's mismatch (decided
      // 2026-10-17). The client sees the title alone; where
      // it happened goes to the log (an output and an index, no address) and
      // rides on the error for the gate (wallet/addressCheckStore.ts).
      console.warn(`[address check] a build's ${problem.detail}: the engine and scure disagree`);
      throw new EngineError('ADDRESS_CHECK_FAILED', SEND_PAUSED_TITLE, {
        mismatch: { keychain: problem.keychain, index: problem.index },
      });
    }
    if (problem) {
      console.warn(`[engine] the build was refused by its own checks: ${problem.detail}`);
      throw new EngineError('POST_BUILD_CHECK', POST_BUILD_CHECK_MESSAGE);
    }
    // 0.28 shuffled the outputs (and only them); the bridge built them in order.
    const shuffled = shufflePsbtOutputs(result.psbt, this.random);
    const sentSats = request.drain ? 0 : request.recipients.reduce((sum, r) => sum + r.amountSats, 0);
    return { psbtBase64: shuffled.psbtBase64, txid: shuffled.txid, feeSats: result.fee ?? 0, sentSats };
  }

  async completePsbt(
    signedPsbtBase64: string,
    originalPsbtBase64?: string,
    opts?: CompletePsbtOptions,
  ): Promise<CompletedPsbt> {
    assertSigningEnabled('Signing');
    return this.complete(signedPsbtBase64, originalPsbtBase64, opts);
  }

  private async complete(
    signedPsbtBase64: string,
    originalPsbtBase64?: string,
    opts?: CompletePsbtOptions,
  ): Promise<CompletedPsbt> {
    let working = signedPsbtBase64;
    if (originalPsbtBase64 && originalPsbtBase64 !== signedPsbtBase64) {
      // original.combine(signed) in that order, then the vault's own key
      // origins re-derived.
      working = await this.call(this.native.combine(this.id, originalPsbtBase64, signedPsbtBase64));
    }
    // The library's finalizer, the way 0.28's watch-only sign() ran it.
    // The leaf hazard's fix lands inside it (the fork, another track).
    let bdkError: string | undefined;
    let finished = working;
    try {
      // The finalizer reads the wallet's tip for older() and after().
      await this.ready();
      const r = await this.call(this.native.finalize(this.id, working));
      finished = r.psbt;
      if (r.error) bdkError = r.error;
    } catch (e) {
      bdkError = engineErrorMessage(e);
    }
    const { psbtBase64, finalized, finalizeNotes } = finishFinalization({
      descriptor: this.descriptorStr,
      bdkPsbtBase64: finished,
      bdkError,
      signedPsbtBase64,
      originalPsbtBase64,
      opts,
    });
    const txid = (await bridged(this.native.psbtInfo(finished))).txid;
    return { finalized, psbtBase64, txid, finalizeNotes };
  }

  async broadcastPsbt(psbtBase64: string, backend: BackendConfig): Promise<string> {
    assertSigningEnabled('Broadcasting a transaction');
    return this.sendPsbt(psbtBase64, backend);
  }

  private async sendPsbt(psbtBase64: string, backend: BackendConfig): Promise<string> {
    const hex = await bridged(this.native.extract(psbtBase64));
    return bridged(this.native.broadcast(syncServerOf(backend), hex));
  }

  async getRawTx(txid: string): Promise<Uint8Array | null> {
    try {
      const hex = await this.read(() => this.native.rawTransaction(this.id, txid));
      return hex ? bytesOf(hex) : null;
    } catch {
      return null; // a display nicety: never break the screen over it
    }
  }

  async broadcastRawTx(txBytes: Uint8Array, backend: BackendConfig, expectedTxid: string): Promise<string> {
    assertSigningEnabled('Broadcasting a transaction');
    assertReviewedRawTx(txBytes, this.network, expectedTxid);
    return this.sendRaw(txBytes, backend);
  }

  async broadcastRescue(signed: Uint8Array, expect: RescueExpectation, backend: BackendConfig): Promise<string> {
    // No spend gate: the watch-only app's one way out, narrow by what it checks.
    if (looksLikePsbt(signed)) {
      const result = await this.complete(encodeBase64(signed));
      if (!result.finalized) throw rescueNotAssembledError(result.finalizeNotes);
      await assertRescueSpend(this, psbtTxShape(result.psbtBase64), expect);
      return this.sendPsbt(result.psbtBase64, backend);
    }
    await assertRescueSpend(this, rawTxShape(signed, this.network), expect);
    return this.sendRaw(signed, backend);
  }

  private async sendRaw(txBytes: Uint8Array, backend: BackendConfig): Promise<string> {
    const hex = hexOf(txBytes);
    // A strict decode first, as the old engine's Transaction().create did.
    await bridged(this.native.parseTransaction(hex));
    return bridged(this.native.broadcast(syncServerOf(backend), hex));
  }
}

/** The new engine's factory (the engine provider decides when it is used). */
export function bdkWalletEngineV3Factory(deps?: BdkWalletEngineDeps): WalletEngineFactory {
  return { create: (params) => BdkWalletEngineV3.create(params, deps) };
}

/** The connection test on the new library: connect and read the tip. */
export async function testBackendConnectionV3(backend: BackendConfig, native: BdkWalletNative): Promise<number> {
  return (await bridged(native.probeServer(probeServerOf(backend)))).height;
}

/**
 * What the server knows about one address (the address book's check,
 * decided 2026-11-05), or null when this build's bridge has no such call.
 * An address that is not for this network is never asked about. The server
 * is the one handed in (wallet/chainServers.ts chose it), asked with the
 * lookup's own settings (`lookupServerOf`).
 */
export async function addressActivityV3(
  backend: BackendConfig,
  network: Network,
  address: string,
  native: BdkWalletNative,
): Promise<AddressActivity | null> {
  const ask = native.addressActivity;
  if (!ask) return null;
  if (!addressFitsNetwork(address, network)) throw new Error(wrongNetworkMessage(network));
  return bridged(ask.call(native, lookupServerOf(backend), nativeNetworkOf(network), address.trim()));
}
