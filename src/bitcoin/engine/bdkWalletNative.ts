/**
 * The wallet library's bridge as JavaScript sees it (BDK upgrade, decided
 * 2026-10-15): `TaliaBdkWalletModule`
 * (native/bdkwallet/bridge/TaliaBdkWalletModule.swift), the 18 calls that
 * replaced the 39 the old engine made, plus the launch-time known-answer
 * test.
 *
 * Pure: the engine takes the module as an argument (the wallet layer hands it
 * this build's, platform/bdkWalletModule.ts), so Jest hands it a recorder.
 * Every rejection becomes an `EngineError` with the bridge's own code
 * (engineError.ts), and an insufficient-funds one keeps its sats, which the
 * bridge words exactly as 0.28 did ("Insufficient funds: N sat available of
 * M sat needed").
 */
import { ENGINE_ERROR_CODES, EngineError, engineErrorMessage } from './engineError';
import type { EngineErrorCode } from './engineError';
import type { AddressActivity } from './types';

/** "bitcoin" | "testnet" (Testnet4) | "signet" | "regtest". */
export type NativeNetwork = 'bitcoin' | 'testnet' | 'signet' | 'regtest';
export type NativeKeychain = 'external' | 'internal';

/** An Electrum server as the bridge takes it. The saved `stopGap` is never
 *  passed: the bridge fixes it at 150. */
export interface NativeServer {
  url: string;
  retry: number;
  timeout: number;
  validateDomain: boolean;
}

export interface NativeSyncResult {
  tipHeight: number;
  /**
   * The tip's block hash (since 2026-10-28; absent from a bridge before).
   * The shadow checks asked whether it was still the server's block at that
   * height before they read the server's blocks for their height buckets;
   * nothing in the app reads it since the old engine's removal (decided 2026-11-04).
   */
  tipHash?: string;
  ms: number;
  /** 1 for the full scan alone; each pass of the coverage rule adds one. */
  passes: number;
  /** The lookahead the synced wallet was opened with. */
  lookahead: number;
  /**
   * The vault's connection of its last good sync was used again (decided
   * 2026-10-25): the library's client then held the transactions, headers
   * and proofs it had fetched. Absent from a bridge before that.
   */
  reused?: boolean;
  /**
   * The kept connection's chain was no longer the server's (decided
   * 2026-10-28): a block it had read was replaced, the chain moved on past
   * what one sync reads again, or the server's tip went below it, so the
   * sync ran again on a new connection (`reused` is then false). Absent
   * from a bridge before that.
   */
  chainMoved?: boolean;
}

export interface NativeBalance {
  confirmed: number;
  trustedPending: number;
  untrustedPending: number;
  immature: number;
  spendable: number;
  total: number;
}

export interface NativeTx {
  txid: string;
  sent: number;
  received: number;
  fee: number | null;
  height: number | null;
  timestamp: number | null;
  /** The confirming block's hash (since 2026-10-28; absent from a bridge before). */
  blockHash?: string | null;
}

/** A block the server holds at a height now (`serverBlocks`). */
export interface NativeServerBlock {
  height: number;
  hash: string;
  time: number;
}

export interface NativeUtxo {
  txid: string;
  vout: number;
  value: number;
  keychain: NativeKeychain;
  index: number;
  height: number | null;
  address: string | null;
}

export interface NativeAddress {
  index: number;
  address: string;
  keychain: NativeKeychain;
}

export type NativePolicyPath = Record<string, number[]>;

/** One build. */
export interface NativeBuildOptions {
  recipients: Array<{ address: string; sats: number }>;
  /** A drain's one destination (send-all, a rescue, a cancel). */
  drainTo: string | null;
  drainWallet: boolean;
  /** "txid:vout", in the order the coins are named. */
  utxos: string[];
  manualOnly: boolean;
  unspendable: string[];
  feeRateSatPerKwu: number;
  /** The rate in sat/vB, for the fee floor. */
  feeRateSatPerVb: number;
  feeAbsoluteSats: number | null;
  policyPaths: { external?: NativePolicyPath; internal?: NativePolicyPath };
  rbf: boolean;
  /** Does the chosen path carry an older()? (the bridge then leaves nSequence to the library). */
  csvPath: boolean;
  version: 1 | 2;
  currentHeight: number;
  replacing: string[];
}

export interface NativeBuildResult {
  psbt: string;
  txid: string;
  fee: number | null;
  /** The fee floor raised the fee to ceil(rate x vsize). */
  floorApplied: boolean;
  /** The drain order put a wallet drain's coins in 0.28's order. */
  reordered: boolean;
}

export interface NativePsbtInfo {
  psbt: string;
  txid: string;
  fee: number | null;
}

export interface NativeFinalized {
  psbt: string;
  finalized: boolean;
  error: string | null;
}

/** What TaliaBdkWalletModule offers JavaScript. */
export interface BdkWalletNative {
  knownAnswer(): Promise<{ passed: boolean; vectors: number }>;
  openWallet(external: string, internal: string | null, network: NativeNetwork): Promise<string>;
  closeWallet(id: string): Promise<boolean>;
  sync(id: string, server: NativeServer): Promise<NativeSyncResult>;
  balance(id: string): Promise<NativeBalance>;
  transactions(id: string): Promise<NativeTx[]>;
  rawTransaction(id: string, txid: string): Promise<string | null>;
  unspent(id: string): Promise<NativeUtxo[]>;
  /** which: "new" | "lastUnused" | a decimal index. */
  address(id: string, keychain: NativeKeychain, which: string): Promise<NativeAddress>;
  isMine(id: string, address: string): Promise<boolean>;
  /** The highest index revealed on a keychain, or null (read only): Receive's search (`addressReach`) and tier C. */
  derivationIndex(id: string, keychain: NativeKeychain): Promise<number | null>;
  policies(id: string, keychain: NativeKeychain): Promise<string | null>;
  build(id: string, options: NativeBuildOptions): Promise<NativeBuildResult>;
  psbtInfo(psbt: string): Promise<NativePsbtInfo>;
  combine(id: string, original: string, signed: string): Promise<string>;
  finalize(id: string, psbt: string): Promise<NativeFinalized>;
  extract(psbt: string): Promise<string>;
  broadcast(server: NativeServer, transactionHex: string): Promise<string>;
  parseTransaction(transactionHex: string): Promise<{ txid: string }>;
  probeServer(server: NativeServer): Promise<{ height: number }>;
  /**
   * The server's blocks at these heights now, from the server and never a
   * cache, null above its tip (decided 2026-10-28, for the shadow checks'
   * look at a reported block against the chain, which went with the old engine;
   * nothing in the app calls it since; at most 20 heights). Absent from a
   * bridge before that.
   */
  serverBlocks?(id: string, server: NativeServer, heights: number[]): Promise<Array<NativeServerBlock | null>>;
  /**
   * What the server knows about one address (decided 2026-11-05, the address
   * book's check): its history, and either every history transaction read
   * whole (at most 50) or the coins it holds now (above 50). Facts only; the
   * rule is the wallet layer's (wallet/addressBookCheck.ts). On the bridge's
   * `chainQueue` like `probeServer`, never `walletQueue`, with a short-lived
   * client and the same `SERVER_UNREACHABLE` mark as the other server calls.
   * Absent from a bridge before that: the check then answers 'unknown'.
   */
  addressActivity?(server: NativeServer, network: NativeNetwork, address: string): Promise<AddressActivity>;
  /** DEBUG builds only. */
  peekAddress?(descriptor: string, network: string, keychain: string, index: number): Promise<string>;
}

const isCode = (v: unknown): v is EngineErrorCode =>
  typeof v === 'string' && (ENGINE_ERROR_CODES as readonly string[]).includes(v);

/**
 * A rejection of the bridge as the engine throws it: its code when it is one
 * of ours (anything else, UNKNOWN_WALLET or BAD_ARGUMENT, is OTHER with the
 * bridge's code kept in the message's place), its message as the bridge
 * worded it, and an insufficient-funds one's sats.
 */
export function engineErrorOf(e: unknown): EngineError {
  if (e instanceof EngineError) return e;
  const raw = (e as { code?: unknown })?.code;
  const message = engineErrorMessage(e);
  const code: EngineErrorCode = isCode(raw) ? raw : 'OTHER';
  if (code === 'INSUFFICIENT_FUNDS') {
    const available = /(\d+)\s*sat available/i.exec(message);
    const needed = /of\s*(\d+)\s*sat needed/i.exec(message);
    return new EngineError(code, message, {
      availableSats: available ? Number(available[1]) : undefined,
      neededSats: needed ? Number(needed[1]) : undefined,
    });
  }
  return new EngineError(code, message);
}

/** Await a bridge call, rethrowing its rejection as an EngineError. */
export async function bridged<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    throw engineErrorOf(e);
  }
}
