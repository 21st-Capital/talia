/**
 * In-memory fake `WalletEngine`.
 *
 * Two jobs:
 *  1. Unit tests — exercise PSBT orchestration and UI logic without a native
 *     module or a live chain backend.
 *  2. Offline development — let the app render real screens (balance, history,
 *     receive, PSBT export) in a simulator with no BDK/native build.
 *
 * It is NOT a Bitcoin implementation: balances and the PSBT it returns are
 * canned/structural. The real engine is `BdkWalletEngineV3`.
 */
import { parseDescriptor } from '../descriptor/parse';
import type { Network } from '../descriptor/types';
import type {
  AddressActivity,
  AddressRequest,
  Balance,
  BackendConfig,
  BuildPsbtRequest,
  CompletedPsbt,
  PsbtBuildResult,
  ReceiveAddress,
  Utxo,
  WalletEngine,
  WalletEngineFactory,
  WalletTx,
  WatchOnlyWalletParams,
  RescueBuildRequest,
} from './types';
import {
  BroadcastRefusedError,
  psbtTxShape,
  rawTxShape,
  refusalMessage,
} from '../psbt/broadcastCheck';
import type { RescueExpectation } from '../psbt/broadcastCheck';
import { encodeBase64, looksLikePsbt } from '../psbt/export';
import { rescueBuild } from './engineShared';
import { verifyRescueTransaction } from './rescueCheck';

/** Options to seed the fake with deterministic data for tests. */
export interface FakeEngineOptions {
  balance?: Partial<Balance>;
  transactions?: WalletTx[];
  addresses?: string[];
  /** Fee (sats) reported by buildPsbt. */
  fee?: number;
  /** Consensus bytes getRawTx serves, by txid (Speed up and Cancel tests). */
  rawTxs?: Record<string, Uint8Array>;
  /** What listUtxos reports instead of the one canned coin. */
  utxos?: Utxo[];
}

const DEFAULT_BALANCE: Balance = {
  confirmed: 150_000,
  trustedPending: 0,
  untrustedPending: 0,
  spendable: 150_000,
  total: 150_000,
};

/** Sample addresses per network so the fake renders plausibly by default. */
const SAMPLE_ADDRESSES: Record<Network, string[]> = {
  bitcoin: ['bc1qexampleaddr0000000000000000000000000000'],
  testnet: ['tb1qexampleaddr0000000000000000000000000000'],
  signet: ['tb1qexampleaddr0000000000000000000000000000'],
  regtest: ['bcrt1qexampleaddr000000000000000000000000000'],
};

export class FakeWalletEngine implements WalletEngine {
  readonly network: Network;
  private balance: Balance;
  private txs: WalletTx[];
  private addresses: string[];
  private fee: number;
  private rawTxs: Record<string, Uint8Array>;
  private utxos: Utxo[] | undefined;
  private addrCounter = 0;
  private synced = false;

  constructor(network: Network, options: FakeEngineOptions = {}) {
    this.network = network;
    this.balance = { ...DEFAULT_BALANCE, ...options.balance };
    this.txs = options.transactions ?? defaultTxs();
    this.addresses = options.addresses ?? SAMPLE_ADDRESSES[network];
    this.fee = options.fee ?? 250;
    this.rawTxs = options.rawTxs ?? {};
    this.utxos = options.utxos;
  }

  async sync(_backend: BackendConfig): Promise<void> {
    this.synced = true;
  }

  async getBalance(): Promise<Balance> {
    return this.balance;
  }

  async listTransactions(): Promise<WalletTx[]> {
    return this.txs;
  }

  async listUtxos(): Promise<Utxo[]> {
    if (this.utxos) return this.utxos;
    return [
      {
        txid: 'a'.repeat(64),
        vout: 0,
        valueSats: this.balance.total,
        address: this.addresses[0],
        keychain: 'external',
      },
    ];
  }

  getTipHeight(): number | undefined {
    return 2_500_010;
  }

  async getReceiveAddress(which: AddressRequest = 'new'): Promise<ReceiveAddress> {
    let index: number;
    if (typeof which === 'number') index = which;
    else if (which === 'lastUnused') index = Math.max(0, this.addrCounter - 1);
    else index = this.addrCounter++;
    const address = this.addresses[index % this.addresses.length];
    return { address, index, uri: `bitcoin:${address}` };
  }

  async getInternalAddress(which: AddressRequest = 'new'): Promise<ReceiveAddress> {
    return this.getReceiveAddress(which);
  }

  async ownsAddress(address: string): Promise<boolean> {
    return this.addresses.includes(address);
  }

  async buildPsbt(request: BuildPsbtRequest): Promise<PsbtBuildResult> {
    if (request.recipients.length === 0) {
      throw new Error('At least one recipient is required');
    }
    // An absolute fee replaces the canned one, as it replaces the rate in BDK.
    const feeSats = request.feeAbsolute != null ? Math.ceil(request.feeAbsolute) : this.fee;
    const sentSats = request.drain
      ? this.balance.spendable - feeSats
      : request.recipients.reduce((s, r) => s + r.amountSats, 0);
    return {
      // A structurally valid base64 PSBT header ("psbt\xff" + empty maps) so
      // export/validation helpers accept it. Not a spendable transaction.
      psbtBase64: FAKE_PSBT_BASE64,
      txid: 'f'.repeat(64),
      feeSats,
      sentSats,
    };
  }

  async completePsbt(
    signedPsbtBase64: string,
    _originalPsbtBase64?: string,
  ): Promise<CompletedPsbt> {
    return {
      finalized: true,
      psbtBase64: signedPsbtBase64,
      txid: 'f'.repeat(64),
    };
  }

  async broadcastPsbt(_psbtBase64: string, _backend: BackendConfig): Promise<string> {
    return 'f'.repeat(64);
  }

  /** Same txid rule as the real engine, so tests exercise it. */
  async broadcastRawTx(txBytes: Uint8Array, _backend: BackendConfig, expectedTxid: string): Promise<string> {
    const shape = rawTxShape(txBytes, this.network);
    if (!shape) throw new BroadcastRefusedError({ code: 'unreadable' }, refusalMessage({ code: 'unreadable' }));
    if (shape.unsignedTxid.toLowerCase() !== (expectedTxid ?? '').toLowerCase()) {
      throw new BroadcastRefusedError({ code: 'different-tx' }, refusalMessage({ code: 'different-tx' }));
    }
    return shape.txid;
  }

  async buildRescuePsbt(request: RescueBuildRequest): Promise<PsbtBuildResult> {
    return this.buildPsbt(rescueBuild(request));
  }

  /** Same rescue rule as the real engine; nothing is sent. */
  async broadcastRescue(signed: Uint8Array, expect: RescueExpectation, _backend: BackendConfig): Promise<string> {
    const shape = looksLikePsbt(signed) ? psbtTxShape(encodeBase64(signed)) : rawTxShape(signed, this.network);
    const refusal = shape ? await verifyRescueTransaction(this, shape, expect) : ({ code: 'unreadable' } as const);
    if (refusal) throw new BroadcastRefusedError(refusal, refusalMessage(refusal));
    return shape!.txid;
  }

  async getRawTx(txid: string): Promise<Uint8Array | null> {
    return this.rawTxs[txid] ?? null;
  }

  /** True once `sync` has been called (test convenience). */
  get isSynced(): boolean {
    return this.synced;
  }
}

/**
 * Minimal valid PSBT: magic `70736274ff` (base64 "cHNidP8") followed by a single
 * empty global-map separator. Enough to pass BIP-174 magic checks in tests.
 */
export const FAKE_PSBT_BASE64 = 'cHNidP8BAAoAAAAAAAAAAAAAAA==';

/**
 * A deterministic two-year history (newest first): mixed receives/sends across
 * many days, one pending send on top. Rich enough to exercise date grouping
 * and the scroll-linked historical balance in UI development.
 */
function defaultTxs(): WalletTx[] {
  const DAY = 86_400;
  const NEWEST = 1_752_400_000; // fixed epoch anchor (July 2025-ish)
  const txs: WalletTx[] = [
    { txid: 'f'.repeat(64), received: 0, sent: 50_000, netAmount: -50_000, fee: 200, confirmed: false },
  ];
  // Deterministic pseudo-random walk: alternating receives and sends.
  let height = 2_550_000;
  for (let i = 0; i < 28; i++) {
    const incoming = i % 3 !== 2; // two receives, then a send
    const amount = 20_000 + ((i * 7919) % 90_000);
    const gapDays = 5 + ((i * 31) % 40);
    const timestamp = NEWEST - i * gapDays * DAY;
    height -= gapDays * 144;
    txs.push({
      txid: i.toString(16).padStart(2, '0').repeat(32),
      received: incoming ? amount : 0,
      sent: incoming ? 0 : amount,
      netAmount: incoming ? amount : -amount,
      fee: 120 + (i % 5) * 37,
      confirmed: true,
      blockHeight: height,
      timestamp,
    });
  }
  return txs;
}

/** Factory that produces fakes — used in tests and offline dev builds. */
export function fakeWalletEngineFactory(
  options?: FakeEngineOptions,
): WalletEngineFactory {
  return {
    create: async (params: WatchOnlyWalletParams) => {
      // Touch the descriptor so bad input still surfaces during offline dev.
      parseDescriptor(params.descriptor);
      return new FakeWalletEngine(params.network, options);
    },
  };
}

/**
 * The fake's answer to the address book's lookup (decided 2026-11-05), for
 * offline UI development: a history of its own for an address the test hands
 * in as spent (one coin paid to it and that coin spent), nothing at all for
 * any other address. Canned, like the rest of the fake.
 */
export function fakeAddressActivity(address: string, spent: ReadonlySet<string> = new Set()): AddressActivity {
  if (!spent.has(address.trim())) return { kind: 'txs', txs: [] };
  const paid = 'f'.repeat(64);
  return {
    kind: 'txs',
    txs: [
      { txid: paid, height: 2_500_000, spends: [`${'e'.repeat(64)}:0`], pays: [0] },
      { txid: 'd'.repeat(64), height: 2_500_001, spends: [`${paid}:0`], pays: [] },
    ],
  };
}
