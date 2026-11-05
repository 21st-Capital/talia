/**
 * The new engine over a stand-in bridge that answers with CODES (BDK
 * upgrade, decided 2026-10-15): the policy-path retry on
 * SPENDING_POLICY_REQUIRED, the branch chosen by fingerprint, the version
 * from the chosen path and the Version1Csv retry, the outputs shuffled and
 * the txid recomputed, combine in the fixed order, the scure fallback after
 * the library's finalizer, the errors as EngineError with 0.28's words, the
 * stop gap never passed, Testnet4, and the connection test.
 */
jest.mock('../spendGate', () => ({ assertSigningEnabled: () => undefined }));

import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { BdkWalletEngineV3, testBackendConnectionV3 } from '../bdkWalletEngine';
import type { BdkWalletNative, NativeBuildOptions } from '../bdkWalletNative';
import { EngineError, POST_BUILD_CHECK_MESSAGE, classifyEngineError, engineErrorFacts } from '../engineError';
import { isSendPaused, SEND_PAUSED_TITLE } from '../addressCheck';
import { bdkShapes } from '../../../testing/bdkPolicyMirror';
import { encodeBase64 } from '../../psbt/export';
import { unsignedTxid } from '../../psbt/parse';
import { psbtMaps } from '../../psbt/canonical';
import { MAINNET_SINGLE_SIG, SPARROW_SINGLE_SIG } from '../../descriptor/__fixtures__/descriptors';

const TEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const MAIN = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const key = HDKey.fromMasterSeed(sha256(utf8ToBytes('engine-test')));

/** A real three-output PSBT, so the shuffle and the txid have something to do. */
function realPsbt(): string {
  const tx = new btc.Transaction({ allowUnknownOutputs: true });
  const pay = btc.p2wpkh(key.derive("m/84'/1'/0'/0/0").publicKey!, btc.TEST_NETWORK);
  tx.addInput({ txid: new Uint8Array(32).fill(7), index: 0, witnessUtxo: { script: pay.script, amount: 50_000n } });
  for (let i = 0; i < 3; i++) {
    tx.addOutput({ script: btc.p2wpkh(key.derive(`m/84'/1'/0'/1/${i}`).publicKey!, btc.TEST_NETWORK).script, amount: BigInt(1000 + i) });
  }
  return encodeBase64(tx.toPSBT());
}
const PSBT = realPsbt();

type Call = { name: string; args: unknown[] };
const reject = (code: string, message: string) => Object.assign(new Error(message), { code });

function stub(overrides: Partial<Record<keyof BdkWalletNative, (...a: never[]) => unknown>> = {}) {
  const calls: Call[] = [];
  const base: Record<string, (...a: unknown[]) => unknown> = {
    openWallet: () => 'w1',
    closeWallet: () => true,
    sync: () => ({ tipHeight: 900, ms: 5, passes: 2, lookahead: 245 }),
    balance: () => ({ confirmed: 1, trustedPending: 2, untrustedPending: 3, immature: 4, spendable: 3, total: 10 }),
    transactions: () => [
      { txid: 'aa'.repeat(32), sent: 0, received: 5, fee: null, height: null, timestamp: null },
      { txid: 'bb'.repeat(32), sent: 9, received: 1, fee: 141, height: 800, timestamp: 1_700_000_000 },
    ],
    unspent: () => [
      { txid: 'aa'.repeat(32), vout: 0, value: 5, keychain: 'external', index: 3, height: null, address: null },
      { txid: 'bb'.repeat(32), vout: 1, value: 9, keychain: 'internal', index: 0, height: 800, address: TEST },
    ],
    address: (_id: unknown, keychain: unknown, which: unknown) => ({ index: which === 'new' ? 4 : Number(which) || 0, address: TEST, keychain }),
    isMine: () => true,
    derivationIndex: () => 3,
    policies: () => null,
    build: () => ({ psbt: PSBT, txid: 'ff'.repeat(32), fee: 222, floorApplied: false, reordered: false }),
    psbtInfo: (p: unknown) => ({ psbt: p, txid: 'txid-of-' + String(p).slice(0, 4), fee: 222 }),
    combine: (_id: unknown, o: unknown, s: unknown) => `${String(s)}<-combined`,
    finalize: (_id: unknown, p: unknown) => ({ psbt: p, finalized: false, error: 'Missing UTXO' }),
    extract: () => '0200',
    broadcast: () => 'cd'.repeat(32),
    parseTransaction: () => ({ txid: 'ee'.repeat(32) }),
    probeServer: () => ({ height: 903_117 }),
    knownAnswer: () => ({ passed: true, vectors: 4 }),
    rawTransaction: () => '0102',
    ...(overrides as Record<string, (...a: unknown[]) => unknown>),
  };
  const native = new Proxy(base, {
    get: (t, name: string) => async (...args: unknown[]) => {
      calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      return t[name](...args);
    },
  }) as unknown as BdkWalletNative;
  return { native, calls };
}

const builds = (calls: Call[]) => calls.filter((c) => c.name === 'build').map((c) => c.args[1] as NativeBuildOptions);

describe('opening and reading', () => {
  it('opens the two descriptors, on Testnet4 for "testnet", and never passes the saved stop gap', async () => {
    const { native, calls } = stub();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    expect(calls[0].name).toBe('openWallet');
    expect(calls[0].args[0]).toMatch(/\/0\/\*\)/);
    expect(calls[0].args[1]).toMatch(/\/1\/\*\)/);
    expect(calls[0].args[2]).toBe('testnet');
    await e.sync({ type: 'electrum', url: 'ssl://x:1', stopGap: 20 });
    expect(calls[1]).toEqual({ name: 'sync', args: ['w1', { url: 'ssl://x:1', retry: 5, timeout: 30, validateDomain: true }] });
    expect(e.getTipHeight()).toBe(900);
  });

  it('maps balance, history and coins as the old engine did', async () => {
    const { native } = stub();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    expect(await e.getBalance()).toEqual({ confirmed: 1, trustedPending: 2, untrustedPending: 3, spendable: 3, total: 10 });
    const txs = await e.listTransactions();
    expect(txs[0]).toEqual({ txid: 'aa'.repeat(32), received: 5, sent: 0, netAmount: 5, fee: undefined, confirmed: false, blockHeight: undefined, timestamp: undefined });
    expect(txs[1]).toMatchObject({ confirmed: true, blockHeight: 800, fee: 141, netAmount: -8 });
    const coins = await e.listUtxos();
    expect(coins.map((c) => [c.valueSats, c.keychain, c.address])).toEqual([
      [9, 'internal', TEST],
      [5, 'external', undefined],
    ]);
  });

  it('a peek answers the index it was asked for, as 0.28 did, where the library says 0 (a descriptor with no wildcard)', async () => {
    const { native } = stub({ address: (_id: unknown, keychain: unknown) => ({ index: 0, address: TEST, keychain }) });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    expect(await e.getReceiveAddress(7)).toMatchObject({ address: TEST, index: 7 });
    // 'new' and 'lastUnused' keep the library's own index.
    expect(await e.getReceiveAddress('new')).toMatchObject({ index: 0 });
  });

  it('asks for addresses by name or index; an address of another network is never the vault\'s', async () => {
    const { native, calls } = stub();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    expect(await e.getReceiveAddress()).toEqual({ address: TEST, index: 4, uri: `bitcoin:${TEST}` });
    await e.getInternalAddress('lastUnused');
    await e.getReceiveAddress(7);
    expect(calls.filter((c) => c.name === 'address').map((c) => c.args.slice(1))).toEqual([
      ['external', 'new'],
      ['internal', 'lastUnused'],
      ['external', '7'],
    ]);
    const before = calls.length;
    expect(await e.ownsAddress(MAIN)).toBe(false);
    expect(calls.length).toBe(before); // never asked
    expect(await e.ownsAddress(TEST)).toBe(true);
  });
});

describe('building', () => {
  it('a payment: the rate as sat/kwu, version 1, the tip, RBF; outputs shuffled and the txid the shuffled one', async () => {
    const { native, calls } = stub();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native, random: () => 0.9 });
    await e.sync({ type: 'electrum', url: 'ssl://x:1' });
    const r = await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1000 }], feeRate: 1.1 });
    const [o] = builds(calls);
    expect(o).toMatchObject({ feeRateSatPerKwu: 275, feeRateSatPerVb: 1.1, version: 1, csvPath: false, rbf: true, currentHeight: 900 });
    expect(r.feeSats).toBe(222);
    expect(r.sentSats).toBe(1000);
    expect(r.txid).toBe(unsignedTxid(r.psbtBase64));
    // Same outputs, maybe another order; the inputs untouched.
    const a = psbtMaps(PSBT)!;
    const b = psbtMaps(r.psbtBase64)!;
    expect(b.tx.outs.map((x) => x.amountSats).sort()).toEqual(a.tx.outs.map((x) => x.amountSats).sort());
    expect(b.inputs).toEqual(a.inputs);
  });

  it('refuses a fee above the ceiling and a recipient of another network before the bridge', async () => {
    const { native, calls } = stub();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await expect(e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1 }], feeRate: 1_000_000 })).rejects.toThrow(/fee rate/);
    await expect(e.buildPsbt({ recipients: [{ address: MAIN, amountSats: 1 }], feeRate: 1 })).rejects.toThrow();
    await expect(e.buildPsbt({ recipients: [], feeRate: 1 })).rejects.toThrow('At least one recipient');
    expect(builds(calls)).toHaveLength(0);
  });

  const layered = bdkShapes('bdkPolicies.v3.json').find(([n]) => n === 'tr-nums-layered-older')![1];
  const layeredStub = (first: () => unknown) => {
    let n = 0;
    return stub({
      policies: ((_id: unknown, k: unknown) => JSON.stringify(k === 'internal' ? layered.policyInternal : layered.policyExternal)) as never,
      build: (() => (n++ === 0 ? first() : { psbt: PSBT, txid: 'x', fee: 300, floorApplied: false, reordered: false })) as never,
    });
  };

  it('a multi-path vault: the retry on the CODE, with the primary path on both keychains', async () => {
    const { native, calls } = layeredStub(() => {
      throw reject('SPENDING_POLICY_REQUIRED', 'Spending policy required: External');
    });
    const e = await BdkWalletEngineV3.create({ descriptor: layered.descriptorExternal, changeDescriptor: layered.descriptorInternal, network: 'testnet' }, { native });
    await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 7000 }], feeRate: 3 });
    const [first, second] = builds(calls);
    expect(first.policyPaths).toEqual({});
    expect(second.policyPaths).toEqual({ external: layered.bdkEverydayBuild.path, internal: layered.bdkEverydayBuild.path });
    expect([second.version, second.csvPath]).toEqual([1, false]);
    // The policy trees are read once.
    expect(calls.filter((c) => c.name === 'policies')).toHaveLength(2);
  });

  it('any other refusal is not retried, and keeps its code and 0.28\'s words', async () => {
    const { native, calls } = layeredStub(() => {
      throw reject('INSUFFICIENT_FUNDS', 'Insufficient funds: 10 sat available of 20 sat needed');
    });
    const e = await BdkWalletEngineV3.create({ descriptor: layered.descriptorExternal, changeDescriptor: layered.descriptorInternal, network: 'testnet' }, { native });
    const err = await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 20 }], feeRate: 1 }).catch((x) => x);
    expect(err).toBeInstanceOf(EngineError);
    expect(engineErrorFacts(err)).toEqual({ code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds: 10 sat available of 20 sat needed', availableSats: 10, neededSats: 20 });
    expect(builds(calls)).toHaveLength(1);
  });

  it('a rescue: the named key\'s timelocked branch, RBF off, version 2 (a CSV path)', async () => {
    const { native, calls } = layeredStub(() => ({ psbt: PSBT, txid: 'x', fee: 400, floorApplied: false, reordered: false }));
    const e = await BdkWalletEngineV3.create({ descriptor: layered.descriptorExternal, changeDescriptor: layered.descriptorInternal, network: 'testnet' }, { native });
    const rescueFp = 'DE1725C5';
    await e.buildRescuePsbt({ utxos: [{ txid: 'aa'.repeat(32), vout: 0 }], destination: TEST, feeRate: 4, branchFingerprint: rescueFp });
    const [o] = builds(calls);
    expect(o).toMatchObject({ drainTo: TEST, drainWallet: true, manualOnly: true, rbf: false, version: 2, csvPath: true });
    expect(Object.keys(o.policyPaths).sort()).toEqual(['external', 'internal']);
    await expect(
      e.buildRescuePsbt({ utxos: [{ txid: 'aa'.repeat(32), vout: 0 }], destination: TEST, feeRate: 4, branchFingerprint: '0badf00d' }),
    ).rejects.toThrow('This vault has no spending path for that key.');
  });

  it('a rescue’s speed-up: the same path, the rescue it replaces named, an absolute fee when asked (decided 2026-10-31)', async () => {
    const { native, calls } = layeredStub(() => ({ psbt: PSBT, txid: 'x', fee: 400, floorApplied: false, reordered: false }));
    const e = await BdkWalletEngineV3.create({ descriptor: layered.descriptorExternal, changeDescriptor: layered.descriptorInternal, network: 'testnet' }, { native });
    const old = 'bb'.repeat(32);
    await e.buildRescuePsbt({ utxos: [{ txid: 'aa'.repeat(32), vout: 0 }], destination: TEST, feeRate: 4, feeAbsolute: 9000, branchFingerprint: 'DE1725C5', replacing: [old] });
    const [o] = builds(calls);
    expect(o).toMatchObject({
      drainTo: TEST, drainWallet: true, manualOnly: true, utxos: [`${'aa'.repeat(32)}:0`],
      rbf: false, version: 2, csvPath: true, feeAbsoluteSats: 9000, replacing: [old],
    });
  });

  it('a first rescue names nothing to replace', async () => {
    const { native, calls } = layeredStub(() => ({ psbt: PSBT, txid: 'x', fee: 400, floorApplied: false, reordered: false }));
    const e = await BdkWalletEngineV3.create({ descriptor: layered.descriptorExternal, changeDescriptor: layered.descriptorInternal, network: 'testnet' }, { native });
    await e.buildRescuePsbt({ utxos: [{ txid: 'aa'.repeat(32), vout: 0 }], destination: TEST, feeRate: 4, branchFingerprint: 'DE1725C5' });
    expect(builds(calls)[0]).toMatchObject({ replacing: [], feeAbsoluteSats: null });
  });

  it('a Version1Csv refusal is built again as version 2, and told', async () => {
    let told = 0;
    const { native, calls } = stub({
      build: ((_: unknown, o: NativeBuildOptions) => {
        if (o.version === 1) throw reject('VERSION1_CSV', 'Version 1 transactions cannot spend a CSV path');
        return { psbt: PSBT, txid: 'x', fee: 1, floorApplied: false, reordered: false };
      }) as never,
    });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native, onVersionRetry: () => (told += 1) });
    await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1 }], feeRate: 1, enableRbf: false });
    expect(builds(calls).map((o) => [o.version, o.csvPath])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(told).toBe(1);
  });

  it('how far a keychain reaches: the library\'s last revealed index, read only (Receive\'s search for a coin\'s address)', async () => {
    const { native, calls } = stub({ derivationIndex: ((_id: unknown, k: unknown) => (k === 'internal' ? 1040 : null)) as never });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    expect(await e.addressReach('internal')).toBe(1040);
    expect(await e.addressReach('external')).toBeNull();
    expect(calls.filter((c) => c.name === 'derivationIndex').map((c) => c.args[1])).toEqual(['internal', 'external']);
    // Nothing that moves a counter was asked.
    expect(calls.filter((c) => c.name === 'address')).toEqual([]);
  });

  it('a coin a waiting payment spends: UNKNOWN_UTXO, which Speed up reads as coins-unavailable', async () => {
    const { native } = stub({ build: (() => { throw reject('UNKNOWN_UTXO', 'UTXO not found in the internal database'); }) as never });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    const err = await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1 }], feeRate: 1, replacing: ['aa'.repeat(32)] }).catch((x) => x);
    expect(classifyEngineError(err)).toBe('UNKNOWN_UTXO');
  });
});

describe('the vault\'s own outputs, held to scure (decided 2026-10-17)', () => {
  const vaultKey = HDKey.fromMasterSeed(sha256(utf8ToBytes('engine-own-outputs')));
  const acct = vaultKey.derive("m/84'/1'/0'");
  const fpHex = vaultKey.fingerprint.toString(16).padStart(8, '0');
  const descriptor = `wpkh([${fpHex}/84'/1'/0']${acct.publicExtendedKey}/<0;1>/*)`;
  const H = 0x8000_0000;
  /** A payment whose change the library labels internal 23 but pays `changeKey`'s script. */
  function withChange(changeKey: Uint8Array): string {
    const tx = new btc.Transaction({ allowUnknownOutputs: true });
    tx.addInput({ txid: new Uint8Array(32).fill(3), index: 0, witnessUtxo: { script: btc.p2wpkh(acct.deriveChild(0).deriveChild(0).publicKey!, btc.TEST_NETWORK).script, amount: 50_000n } });
    tx.addOutput({ script: btc.p2wpkh(key.derive("m/84'/1'/0'/0/9").publicKey!, btc.TEST_NETWORK).script, amount: 1_000n });
    tx.addOutput({
      script: btc.p2wpkh(changeKey, btc.TEST_NETWORK).script,
      amount: 48_000n,
      bip32Derivation: [[acct.deriveChild(1).deriveChild(23).publicKey!, { fingerprint: vaultKey.fingerprint, path: [84 + H, 1 + H, 0 + H, 1, 23] }]],
    } as never);
    return encodeBase64(tx.toPSBT());
  }

  it('a change output that is not the vault\'s at the index it names pauses sending: the title alone, and where for the gate', async () => {
    const bad = withChange(acct.deriveChild(1).deriveChild(24).publicKey!);
    const { native } = stub({ build: () => ({ psbt: bad, txid: 'ff'.repeat(32), fee: 222, floorApplied: false, reordered: false }) });
    const e = await BdkWalletEngineV3.create({ descriptor, network: 'testnet' }, { native });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1000 }], feeRate: 2 }).catch((x) => x);
    // The approved words and nothing else for the client (decided 2026-10-17);
    // the detail goes to the log, never the screen.
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ code: 'ADDRESS_CHECK_FAILED', message: SEND_PAUSED_TITLE, mismatch: { keychain: 'internal', index: 23 } });
    expect(isSendPaused(err)).toBe(true);
    expect(String(err.message)).not.toMatch(/output|internal|index/);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/output 1 does not pay the vault's own address \(internal 23\)/);
    warn.mockRestore();
  });

  it('a payment that cannot be read is refused (POST_BUILD_CHECK) in one plain sentence, never a pause', async () => {
    const { native } = stub({ build: () => ({ psbt: 'cHNidP8BAAAA', txid: 'ff'.repeat(32), fee: 222, floorApplied: false, reordered: false }) });
    const e = await BdkWalletEngineV3.create({ descriptor, network: 'testnet' }, { native });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1000 }], feeRate: 2 }).catch((x) => x);
    expect(err).toMatchObject({ code: 'POST_BUILD_CHECK', message: POST_BUILD_CHECK_MESSAGE });
    expect(isSendPaused(err)).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/the payment could not be read/);
    warn.mockRestore();
  });

  it('the bridge\'s own post-build refusals reach the client as the same plain sentence; their words go to the log', async () => {
    const { native } = stub({
      build: (() => {
        throw reject('POST_BUILD_CHECK', 'The payment was not built safely: input 0 carries no witness_utxo');
      }) as never,
    });
    const e = await BdkWalletEngineV3.create({ descriptor, network: 'testnet' }, { native });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const err = await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1000 }], feeRate: 2 }).catch((x) => x);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ code: 'POST_BUILD_CHECK', message: POST_BUILD_CHECK_MESSAGE });
    expect(POST_BUILD_CHECK_MESSAGE).not.toMatch(/input|output|witness|psbt|utxo|\u2014/i);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/input 0 carries no witness_utxo/);
    warn.mockRestore();
  });

  it('the right change script passes', async () => {
    const good = withChange(acct.deriveChild(1).deriveChild(23).publicKey!);
    const { native } = stub({ build: () => ({ psbt: good, txid: 'ff'.repeat(32), fee: 222, floorApplied: false, reordered: false }) });
    const e = await BdkWalletEngineV3.create({ descriptor, network: 'testnet' }, { native });
    expect(await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1000 }], feeRate: 2 })).toMatchObject({ feeSats: 222 });
  });
});

describe('after a panic (decided 2026-10-17)', () => {
  it('the tip is forgotten, and the next read or build syncs again first', async () => {
    let needsSync = false;
    let tip = 900;
    let panicked = false;
    const resyncing = () => reject('WALLET_RESYNCING', 'The wallet library was opened again and is syncing this vault first.');
    const { native, calls } = stub({
      sync: () => {
        needsSync = false;
        tip += 1;
        return { tipHeight: tip, ms: 5, passes: 1, lookahead: 150 };
      },
      build: () => {
        if (!panicked) {
          panicked = true;
          needsSync = true;
          throw reject('RUST_PANIC', 'The wallet library stopped: rustPanic(Amount addition error)');
        }
        if (needsSync) throw resyncing();
        return { psbt: PSBT, txid: 'ff'.repeat(32), fee: 222, floorApplied: false, reordered: false };
      },
      balance: () => {
        if (needsSync) throw resyncing();
        return { confirmed: 7, trustedPending: 0, untrustedPending: 0, immature: 0, spendable: 7, total: 7 };
      },
    });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await e.sync({ type: 'electrum', url: 'ssl://x:1' });
    await expect(e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1000 }], feeRate: 2 })).rejects.toMatchObject({ code: 'RUST_PANIC' });
    expect(e.getTipHeight()).toBeUndefined();
    // The read syncs first and never sees the empty recreated wallet.
    expect(await e.getBalance()).toMatchObject({ total: 7 });
    expect(e.getTipHeight()).toBe(902);
    const order = calls.map((c) => c.name).filter((n) => ['sync', 'build', 'balance'].includes(n));
    expect(order).toEqual(['sync', 'build', 'sync', 'balance']);
    // A build after it reads the new tip.
    await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1000 }], feeRate: 2 });
    expect(builds(calls).pop()).toMatchObject({ currentHeight: 902 });
  });

  it('a read that meets WALLET_RESYNCING (a panic the engine did not see) syncs and asks once more', async () => {
    let needsSync = true;
    let syncs = 0;
    const { native, calls } = stub({
      sync: () => {
        syncs += 1;
        needsSync = false;
        return { tipHeight: 950, ms: 5, passes: 1, lookahead: 150 };
      },
      unspent: () => {
        if (needsSync) throw reject('WALLET_RESYNCING', 'syncing');
        return [];
      },
    });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    // Never synced: nothing to sync with, the refusal stands.
    await expect(e.listUtxos()).rejects.toMatchObject({ code: 'WALLET_RESYNCING' });
    needsSync = false;
    await e.sync({ type: 'electrum', url: 'ssl://x:1' });
    needsSync = true; // the bridge recreated the wallet behind the engine's back
    expect(await e.listUtxos()).toEqual([]);
    expect(syncs).toBe(2);
    expect(calls.map((c) => c.name).filter((n) => n === 'unspent' || n === 'sync')).toEqual(['unspent', 'sync', 'unspent', 'sync', 'unspent']);
  });

  it('a build after a panic syncs before it reads the tip for nLockTime', async () => {
    let needsSync = false;
    let panicked = false;
    let tip = 900;
    const { native, calls } = stub({
      sync: () => {
        needsSync = false;
        tip += 5;
        return { tipHeight: tip, ms: 5, passes: 1, lookahead: 150 };
      },
      build: () => {
        if (!panicked) {
          panicked = true;
          needsSync = true;
          throw reject('RUST_PANIC', 'The wallet library stopped');
        }
        if (needsSync) throw reject('WALLET_RESYNCING', 'syncing');
        return { psbt: PSBT, txid: 'ff'.repeat(32), fee: 222, floorApplied: false, reordered: false };
      },
    });
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await e.sync({ type: 'electrum', url: 'ssl://x:1' });
    await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1000 }], feeRate: 2 }).catch(() => null);
    await e.buildPsbt({ recipients: [{ address: TEST, amountSats: 1000 }], feeRate: 2 });
    expect(builds(calls).map((o) => o.currentHeight)).toEqual([905, 910]);
  });
});

describe('finishing a signed copy', () => {
  it('combines original then signed, finalizes, and judges the scure fallback with the library\'s reason', async () => {
    const { native, calls } = stub();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    const r = await e.completePsbt('signed', 'original');
    expect(calls.find((c) => c.name === 'combine')!.args).toEqual(['w1', 'original', 'signed']);
    expect(calls.find((c) => c.name === 'finalize')!.args).toEqual(['w1', 'signed<-combined']);
    expect(r.finalized).toBe(false);
    expect(r.finalizeNotes?.join(' ')).toMatch(/Missing UTXO/);
    expect(r.txid).toBe('txid-of-sign');
  });

  it('no combine when the copy is the original', async () => {
    const { native, calls } = stub();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    await e.completePsbt('same', 'same');
    expect(calls.some((c) => c.name === 'combine')).toBe(false);
  });
});

describe('the network', () => {
  it('broadcasts the extracted transaction through a short-lived client', async () => {
    const { native, calls } = stub();
    const e = await BdkWalletEngineV3.create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' }, { native });
    expect(await e.broadcastPsbt('p', { type: 'electrum', url: 'ssl://x:1' })).toBe('cd'.repeat(32));
    expect(calls.slice(-2).map((c) => c.name)).toEqual(['extract', 'broadcast']);
  });

  it('the connection test asks the new library, with the old probe\'s defaults', async () => {
    const { native, calls } = stub();
    expect(await testBackendConnectionV3({ type: 'electrum', url: 'tcp://192.168.0.10:50001', validateDomain: false }, native)).toBe(903_117);
    expect(calls[0]).toEqual({ name: 'probeServer', args: [{ url: 'tcp://192.168.0.10:50001', retry: 2, timeout: 15, validateDomain: false }] });
  });

  it('a raw transaction the wallet does not know is null, never an error', async () => {
    const { native } = stub({ rawTransaction: (() => { throw reject('OTHER', 'boom'); }) as never });
    const e = await BdkWalletEngineV3.create({ descriptor: MAINNET_SINGLE_SIG, network: 'bitcoin' }, { native });
    expect(await e.getRawTx('aa'.repeat(32))).toBeNull();
  });
});
