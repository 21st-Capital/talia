/**
 * Keel's wallet-engine domain types and the `WalletEngine` interface.
 *
 * These types are deliberately independent of the wallet library so the rest
 * of the app (UI, stores, PSBT orchestration) never imports a native module
 * directly. `BdkWalletEngineV3` adapts the library's bridge (TaliaBdkWalletModule,
 * bdk-ffi 3.1.1; bdk-rn's until the old engine's removal, decided
 * 2026-11-04) to this interface; `FakeWalletEngine` provides
 * an in-memory implementation for tests and offline development. This is the
 * seam that keeps the BDK/wallet layer cleanly separated from the UI.
 */
import type { RescueExpectation } from '../psbt/broadcastCheck';
import type { Network } from '../descriptor/types';

/** Satoshi amount. Kept as a number (safe up to 2^53; 21e14 sats < that). */
export type Sats = number;

/** Confirmed + pending balance breakdown, in sats. */
export interface Balance {
  confirmed: Sats;
  trustedPending: Sats;
  untrustedPending: Sats;
  spendable: Sats;
  total: Sats;
}

/** A transaction as it relates to this wallet. */
export interface WalletTx {
  txid: string;
  /** Sats received into wallet-owned outputs. */
  received: Sats;
  /** Sats spent from wallet-owned inputs. */
  sent: Sats;
  /** received - sent; positive = incoming, negative = outgoing. */
  netAmount: Sats;
  /** Fee in sats, if known (Electrum always provides it). */
  fee?: Sats;
  confirmed: boolean;
  blockHeight?: number;
  /** Unix seconds of the confirming block, if confirmed. */
  timestamp?: number;
  /**
   * The confirming block's hash, where the engine knows it (decided
   * 2026-10-28, for the shadow checks, which held it to the server's chain
   * until they went with the old engine). Nothing in the app reads it since; the
   * tier C runner may.
   */
  blockHash?: string;
}

/** A freshly derived receive address. */
export interface ReceiveAddress {
  address: string;
  index: number;
  /** `bitcoin:` URI form, convenient for QR display. */
  uri: string;
}

/** Which address to hand out when requesting a receive address. */
export type AddressRequest = 'new' | 'lastUnused' | number;

/** Chain backend selection: an Electrum server, the public default or the
 *  user's own node for privacy. Esplora went on 2026-10-07: a saved Esplora
 *  setting moves to the default Electrum server (wallet/settingsMigration). */
export type BackendConfig = {
  type: 'electrum';
  /** e.g. "ssl://electrum.blockstream.info:60002". */
  url: string;
  retry?: number;
  timeout?: number;
  stopGap?: number;
  validateDomain?: boolean;
};

/** Parameters to instantiate a watch-only wallet from a descriptor. */
export interface WatchOnlyWalletParams {
  /**
   * The output descriptor for the external (receive) chain, OR a multipath
   * descriptor (`<0;1>`) that encodes both chains. When multipath is used,
   * `changeDescriptor` should be omitted.
   */
  descriptor: string;
  /** Optional separate internal (change) descriptor. */
  changeDescriptor?: string;
  network: Network;
  /**
   * The servers this vault may talk to NOW, in the order to try them: the
   * wallet layer's rule (wallet/chainServers.ts `chainServersFor`) with the
   * settings as they are when it is asked; none while there is no server to
   * use. An engine asks before a sync it makes on its own, which no caller
   * handed a server for (the sync after its library recreated a wallet; the
   * shadow's sync of the new engine did too, until the old engine's removal): a server kept from an
   * earlier sync is used only while it is still one of these (decided
   * 2026-10-18: a vault's data goes to the server the client chose, or the
   * built-in Testnet4 list, and to no other). Optional: without it (tests,
   * the tier C runner) such a sync uses the server of the last one.
   */
  chainServers?: () => Promise<readonly BackendConfig[]>;
}

/** A single output in a spend. */
export interface Recipient {
  address: string;
  amountSats: Sats;
}

/** Request to build an unsigned PSBT. */
export interface BuildPsbtRequest {
  /** Restrict coin selection to EXACTLY these outpoints (coin control). */
  utxos?: Array<{ txid: string; vout: number }>;
  /** NEVER spend these outpoints (frozen coins — e.g. dust-attack bait). */
  excludeUtxos?: Array<{ txid: string; vout: number }>;
  recipients: Recipient[];
  /** Fee rate in sat/vByte. */
  feeRate: number;
  /**
   * A fixed fee in sats that REPLACES the rate when given (BDK's
   * TxBuilder.feeAbsolute). Speed up and Cancel use it: BDK does not enforce
   * BIP-125 on an ordinary build, so when the rate alone would leave the
   * replacement paying less than the original plus its own relay cost,
   * Talia rebuilds with this (wallet/replacement.ts). `feeRate` stays
   * required either way.
   */
  feeAbsolute?: Sats;
  /** If true, send all spendable funds to the single recipient. */
  drain?: boolean;
  /** Enable RBF (BIP-125). Defaults to true. */
  enableRbf?: boolean;
  /** Build the spend on the TIMELOCKED policy branch containing this master
   *  fingerprint (e.g. the 21C rescue key) instead of the primary path.
   *  The caller must ensure the selected coins' timelocks have expired. */
  branchFingerprint?: string;
  /**
   * The waiting transactions this build replaces: Speed up and Cancel name
   * the original (wallet/replacement.ts). bdk_wallet 3.x refuses a coin a
   * waiting transaction spends unless the build names that transaction here
   * (BDK upgrade, decided 2026-10-15). The old engine (bdk 0.28, removed
   * on 2026-11-04) ignored it: it always took those coins.
   */
  replacing?: string[];
}

/** Result of building an unsigned PSBT. */
export interface PsbtBuildResult {
  /** Base64-encoded PSBT (BIP-174), ready to export/sign elsewhere. */
  psbtBase64: string;
  txid: string;
  feeSats: Sats;
  /** Total sats sent to recipients (excludes change). */
  sentSats: Sats;
}

/** Result of merging an externally signed PSBT back into the wallet's view. */
export interface CompletedPsbt {
  /** True when every input is finalized — the tx is ready to broadcast. */
  finalized: boolean;
  /** The combined/finalized PSBT, base64. */
  psbtBase64: string;
  txid: string;
  /** When finalization FAILED: why each fallback route gave up. Diagnostic
   *  only — surfaced to the user so a stuck spend isn't a silent dead end. */
  finalizeNotes?: string[];
}

/** An unspent output owned by the wallet. */
export interface Utxo {
  txid: string;
  vout: number;
  valueSats: Sats;
  /** The address holding this output, when resolvable. */
  address?: string;
  /** 'external' = receive chain, 'internal' = change. */
  keychain: 'external' | 'internal';
}

/**
 * A watch-only wallet backed by BDK (or a fake). One instance ≈ one descriptor.
 * All Bitcoin logic flows through this interface — the UI never touches the library.
 */
export interface WalletEngine {
  readonly network: Network;
  /** Sync UTXO/tx state against the chain backend. */
  sync(backend: BackendConfig): Promise<void>;
  getBalance(): Promise<Balance>;
  listTransactions(): Promise<WalletTx[]>;
  getReceiveAddress(which?: AddressRequest): Promise<ReceiveAddress>;
  /**
   * Fresh address on the INTERNAL (change) branch. Refreshes send here, not
   * to receive addresses (decided 2026-08-28): a registered signing device
   * recognizes its own change branch cryptographically and shows the
   * transaction as a SELF-TRANSFER — the device verifies the destination,
   * which no amount of on-screen address-reading can. Wallets without a
   * separate change descriptor fall back to the external branch (BDK maps
   * the internal keychain onto it).
   */
  getInternalAddress(which?: AddressRequest): Promise<ReceiveAddress>;
  /** Current unspent outputs (coin control / address balances). */
  listUtxos(): Promise<Utxo[]>;
  /** Chain tip height from the last sync, if known (for confirmation counts). */
  getTipHeight(): number | undefined;
  /** Whether this wallet's descriptor derives the given address (BDK isMine). */
  ownsAddress(address: string): Promise<boolean>;
  /**
   * The highest index revealed on a keychain, which every coin the engine
   * lists sits at or below; null when nothing is revealed there. Read only
   * (never moves a counter). Optional: the 0.28 engine's bridge had no such
   * call (a fake has none either), and a caller then uses its own bound (Receive's search for a
   * coin's address, `verifyPinnedAddress`).
   */
  addressReach?(keychain: 'external' | 'internal'): Promise<number | null>;
  /** Build an unsigned PSBT. No signing happens in Phase 1. */
  buildPsbt(request: BuildPsbtRequest): Promise<PsbtBuildResult>;
  /**
   * Merge a PSBT signed by an EXTERNAL device with the
   * original unsigned PSBT, then finalize via BDK. The app itself never signs
   * — private keys live only on the hardware.
   */
  completePsbt(
    signedPsbtBase64: string,
    originalPsbtBase64?: string,
    opts?: CompletePsbtOptions,
  ): Promise<CompletedPsbt>;
  /** Broadcast a FINALIZED PSBT's transaction. Returns the txid. */
  broadcastPsbt(psbtBase64: string, backend: BackendConfig): Promise<string>;
  /** Broadcast a consensus-encoded raw transaction (e.g. one a signing device
   *  already finalized). Returns the txid. `expectedTxid` is the unsigned
   *  txid of the PSBT the client reviewed: anything else is refused and
   *  nothing is sent (decided 2026-09-26). */
  broadcastRawTx(txBytes: Uint8Array, backend: BackendConfig, expectedTxid: string): Promise<string>;
  /**
   * The RESCUE request's unsigned PSBT: every named coin, on the timelocked
   * branch of `branchFingerprint`, drained to `destination`. The one build
   * the watch-only App Store app may make (decided 2026-09-26): 21st Capital's
   * rescue key is the only key that can sign it.
   */
  buildRescuePsbt(request: RescueBuildRequest): Promise<PsbtBuildResult>;
  /**
   * Finish (when it is a PSBT) and broadcast a rescue 21st Capital signed,
   * after proving it spends only this vault's coins and pays only the
   * destination the client filed (or this vault itself), and that it is the
   * requested transaction when a PSBT was sent (decided 2026-09-26).
   * Throws a BroadcastRefusedError otherwise; nothing is sent.
   */
  broadcastRescue(signed: Uint8Array, expect: RescueExpectation, backend: BackendConfig): Promise<string>;
  /** Consensus bytes of one of the wallet's own transactions (display
   *  details: size, fee rate, inputs/outputs). Null when unavailable. */
  getRawTx(txid: string): Promise<Uint8Array | null>;
  // No fee bump here: Speed up and Cancel are an ordinary `buildPsbt` of the
  // same coins (wallet/replacement.ts). BDK's BumpFeeTxBuilder takes no
  // policy path and refused every multi-path vault (decided
  // 2026-10-07), so the engine does not offer it.
}

/** What a rescue request's PSBT is built from. */
export interface RescueBuildRequest {
  /** Every coin the rescue moves. */
  utxos: Array<{ txid: string; vout: number }>;
  destination: string;
  feeRate: number;
  /** The rescue key's fingerprint: the branch the PSBT must spend. */
  branchFingerprint: string;
  /**
   * A fixed fee in sats that replaces the rate: a speed-up whose rate alone
   * would pay less than the rescue it replaces plus its own relay cost
   * (wallet/rescueReplacement.ts). As in BuildPsbtRequest.
   */
  feeAbsolute?: Sats;
  /**
   * The waiting rescue this build replaces: its coins are spent as far as the
   * vault knows, and the new engine takes them only when the build names the
   * transaction that spends them (BuildPsbtRequest.replacing).
   */
  replacing?: string[];
}

/** Factory that constructs a watch-only wallet engine from a descriptor. */
export interface WalletEngineFactory {
  create(params: WatchOnlyWalletParams): Promise<WalletEngine>;
}

/** Extra context for finalisation. */
export interface CompletePsbtOptions {
  /**
   * Confirmations on the YOUNGEST coin being spent, when the caller can tell.
   *
   * Only the fallback finaliser needs this, and only to answer "is this
   * timelocked path actually open yet?" — @scure will otherwise assemble a
   * witness for a wait that is not over and the network will reject it
   * (2026-07-29). Leave it undefined when unknown: the guard treats missing
   * information as permission, so a real rescue is never blocked by it.
   */
  inputConfirmations?: number;
}

// ─── one address's activity (the address book's check, decided 2026-11-05) ───

/**
 * One transaction of an address's history, as the bridge reads it
 * (`addressActivity`): facts only, the rule is the wallet layer's
 * (wallet/addressBookCheck.ts).
 */
export interface AddressActivityTx {
  txid: string;
  /** Electrum's height: the block's height once confirmed, 0 or -1 while in the mempool. */
  height: number;
  /** Every coin the transaction spends, as "<txid>:<vout>". */
  spends: string[];
  /** The outputs (vout) of this transaction that pay the address. */
  pays: number[];
}

/** One entry of an address's history alone (the long form). */
export interface AddressHistoryItem {
  txid: string;
  height: number;
}

/** One coin the address holds now (the long form). */
export interface AddressUnspentItem {
  txid: string;
  vout: number;
  height: number;
}

/**
 * What the vault's server knows about one address, from the bridge's
 * `addressActivity` (decided 2026-11-05):
 *   'txs'   the history had at most 50 entries, and each one was fetched
 *           whole, so every coin paid to the address and every spend of one
 *           is in the list;
 *   'long'  above 50: the history (txids and heights, asked FIRST) and the
 *           coins the address holds now (asked after it).
 */
export type AddressActivity =
  | { kind: 'txs'; txs: AddressActivityTx[] }
  | { kind: 'long'; history: AddressHistoryItem[]; unspent: AddressUnspentItem[] };
