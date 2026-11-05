/**
 * The new bridge's contract scenario (BDK upgrade, decided 2026-10-15):
 * the old contract test's three-vault walk (bdkBridgeProtocol.test.ts),
 * redone for the new engine on regtest so every answer is REAL: tier C runs
 * it in the simulator against the real Swift bridge and records every native
 * call with its real answer (harness/tierC.ts, the `protocol` job), and
 * bdkWalletBridgeProtocol.test.ts replays the recording, call for call.
 *
 * The same function runs in both places; only the native module and the
 * `exchange` with the host differ (live: the host signs and answers through
 * files; replay: the recorded answers). Test keys only.
 */
import { BdkWalletEngineV3, testBackendConnectionV3 } from '../bitcoin/engine/bdkWalletEngine';
import type { BdkWalletNative } from '../bitcoin/engine/bdkWalletNative';
import type { BackendConfig } from '../bitcoin/engine/types';

export interface ProtocolVaults {
  backend: BackendConfig;
  /** A funded regtest single-sig vault (receive and change descriptors). */
  single: { ext: string; int: string };
  /** A funded regtest layered taproot vault and its rescue key's fingerprint. */
  layered: { ext: string; int: string; rescueFp: string };
  /** An unfunded signet vault with a separate change descriptor (open only). */
  signet: { ext: string; int: string };
  /** A regtest address outside both vaults. */
  foreign: string;
  /** A mainnet address (refused: another network). */
  mainnet: string;
}

export type ProtocolEntry =
  | { call: string; args: unknown[]; result?: unknown; error?: { code: string | null; message: string } }
  | { step: string; result?: unknown; error?: string }
  | { exchange: string; sent: unknown; answer: unknown };

/** The host's answer to a request (live: through files; replay: recorded). */
export type Exchange = (name: string, payload: unknown) => Promise<unknown>;

const clean = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** A PRNG for the output shuffle, the same in the recording and the replay. */
export function seededRandom(seed = 0x5eed): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    s ^= s >>> 12;
    return (s >>> 0) / 0x100000000;
  };
}

/** Run the scenario, appending every step's answer to `log` (the native calls are logged by the caller). */
export async function protocolScenario(
  native: BdkWalletNative,
  v: ProtocolVaults,
  exchange: Exchange,
  log: ProtocolEntry[],
): Promise<void> {
  const step = async (name: string, run: () => Promise<unknown>) => {
    try {
      log.push({ step: name, result: clean(await run()) });
    } catch (e) {
      log.push({ step: name, error: String((e as Error)?.message ?? e) });
    }
  };
  const deps = { native, random: seededRandom() };

  // A regtest single-sig vault: sync, read, addresses, builds, a signed round, broadcasts.
  let single!: BdkWalletEngineV3;
  await step('create single-sig', async () => {
    single = await BdkWalletEngineV3.create({ descriptor: v.single.ext, changeDescriptor: v.single.int, network: 'regtest' }, deps);
    return single.network;
  });
  await step('sync', () => single.sync(v.backend));
  await step('tip height', async () => (single.getTipHeight() ?? 0) > 0);
  await step('balance', () => single.getBalance());
  await step('transactions', () => single.listTransactions());
  await step('coins', () => single.listUtxos());
  await step('receive last unused', () => single.getReceiveAddress('lastUnused'));
  await step('receive new', () => single.getReceiveAddress('new'));
  await step('receive at 7', () => single.getReceiveAddress(7));
  await step('change new', () => single.getInternalAddress('new'));
  await step('change last unused', () => single.getInternalAddress('lastUnused'));
  await step('owns its own address', async () => single.ownsAddress((await single.getReceiveAddress(3)).address));
  await step('owns a foreign address', () => single.ownsAddress(v.foreign));
  await step('owns a mainnet address', () => single.ownsAddress(v.mainnet));
  const coins = await single.listUtxos();
  await step('payment with coin control and a fixed fee', () =>
    single.buildPsbt({
      utxos: coins.slice(0, 1).map((c) => ({ txid: c.txid, vout: c.vout })),
      recipients: [{ address: v.foreign, amountSats: 12_000 }, { address: v.foreign, amountSats: 3_000 }],
      feeRate: 5.5,
      feeAbsolute: 1234.2,
    }),
  );
  await step('send all, no RBF, a frozen coin', () =>
    single.buildPsbt({
      excludeUtxos: coins.slice(1, 2).map((c) => ({ txid: c.txid, vout: c.vout })),
      recipients: [{ address: v.foreign, amountSats: 0 }],
      drain: true,
      feeRate: 2,
      enableRbf: false,
    }),
  );
  await step('a fee rate above the ceiling', () => single.buildPsbt({ recipients: [{ address: v.foreign, amountSats: 1 }], feeRate: 1_000_000 }));
  await step('a wrong-network recipient', () => single.buildPsbt({ recipients: [{ address: v.mainnet, amountSats: 1 }], feeRate: 1 }));
  await step('a build the library refuses (too little)', () =>
    single.buildPsbt({ recipients: [{ address: v.foreign, amountSats: 2_100_000_000_000_000 }], feeRate: 1 }),
  );
  await step('a coin it does not hold', () =>
    single.buildPsbt({ utxos: [{ txid: 'ab'.repeat(32), vout: 0 }], recipients: [{ address: v.foreign, amountSats: 1_000 }], feeRate: 1 }),
  );
  let payment = '';
  await step('a payment to sign', async () => {
    const built = await single.buildPsbt({ recipients: [{ address: v.foreign, amountSats: 25_000 }], feeRate: 2 });
    payment = built.psbtBase64;
    return built;
  });
  const signed = (await exchange('sign', { psbt: payment })) as string;
  let completed = '';
  await step('complete with the original', async () => {
    const r = await single.completePsbt(signed, payment);
    completed = r.psbtBase64;
    return r;
  });
  await step('complete, the library cannot finalize (unsigned)', () => single.completePsbt(payment));
  let sentTxid = '';
  await step('broadcast a psbt', async () => {
    sentTxid = await single.broadcastPsbt(completed, v.backend);
    return sentTxid;
  });
  await exchange('mine', { txid: sentTxid });
  await step('sync after', () => single.sync(v.backend));
  await step('raw transaction', async () => {
    const raw = await single.getRawTx(sentTxid);
    return raw ? raw.length > 0 : null;
  });
  await step('raw transaction not known', async () => single.getRawTx('cc'.repeat(32)));
  const raw = (await exchange('raw', { purpose: 'a signed transaction of this vault, not yet sent' })) as {
    hex: string;
    unsignedTxid: string;
  };
  const bytes = Uint8Array.from((raw.hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  await step('broadcast raw bytes', () => single.broadcastRawTx(bytes, v.backend, raw.unsignedTxid));
  await step('broadcast raw bytes of another transaction', () => single.broadcastRawTx(bytes, v.backend, 'dd'.repeat(32)));

  // A layered taproot vault: the library asks for a spending policy, the rescue branch is chosen by fingerprint.
  let layered!: BdkWalletEngineV3;
  await step('create layered taproot', async () => {
    layered = await BdkWalletEngineV3.create({ descriptor: v.layered.ext, changeDescriptor: v.layered.int, network: 'regtest' }, deps);
    return layered.network;
  });
  await step('layered sync', () => layered.sync(v.backend));
  const lcoins = await layered.listUtxos();
  await step('payment that needs the everyday path', () =>
    layered.buildPsbt({ recipients: [{ address: v.foreign, amountSats: 7_000 }], feeRate: 3 }),
  );
  await step('rescue on the timelocked branch', () =>
    layered.buildRescuePsbt({
      utxos: lcoins.slice(0, 1).map((c) => ({ txid: c.txid, vout: c.vout })),
      destination: v.foreign,
      feeRate: 4,
      branchFingerprint: v.layered.rescueFp.toUpperCase(),
    }),
  );
  await step('rescue on a key the vault does not hold', () =>
    layered.buildRescuePsbt({
      utxos: lcoins.slice(0, 1).map((c) => ({ txid: c.txid, vout: c.vout })),
      destination: v.foreign,
      feeRate: 4,
      branchFingerprint: '0badf00d',
    }),
  );
  await step('policy tree', async () => ((await layered.policyTree('external')) as { type?: string } | null)?.type ?? null);

  // Separate receive and change descriptors on signet.
  await step('create with a change descriptor (signet)', async () => {
    const e = await BdkWalletEngineV3.create({ descriptor: v.signet.ext, changeDescriptor: v.signet.int, network: 'signet' }, deps);
    const a = await e.getReceiveAddress(0);
    await e.close();
    return [e.network, a.address.slice(0, 4)];
  });

  await step('connection test', async () => (await testBackendConnectionV3(v.backend, native)) > 0);
  await step('connection test, nobody listening', () =>
    testBackendConnectionV3({ type: 'electrum', url: 'tcp://127.0.0.1:9', retry: 1, timeout: 2 }, native),
  );
  await step('close', async () => {
    await single.close();
    await layered.close();
    return true;
  });
}
