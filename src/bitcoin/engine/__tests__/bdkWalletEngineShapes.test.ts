/**
 * Two problems found on 2026-10-07 (below), held through the engine's own
 * build code on EVERY vault shape of the new library's fixture set
 * (bdkPolicies.v3.json). The bridge is a stand-in that keeps the rules of
 * the real library these problems ran into, on the library's own policy
 * trees (src/testing/bdkPolicyMirror, which reads 3.x's trees): it refuses
 * to choose a branch of a multi-path tree on its own
 * (SPENDING_POLICY_REQUIRED), checks a given path node by node ("Not
 * enough items selected"), and refuses a version 1 transaction on a path
 * with an older() (VERSION1_CSV).
 *
 * 1. Speed up and Cancel are an ordinary build of the same coins at a
 *    higher fee (wallet/replacement.ts), naming the payment they replace.
 * 2. A rescue, or an heir's spend, takes the branch of the key it names,
 *    the nested wsh choice included, as version 2 exactly when that branch
 *    waits with an older(), in one build.
 *
 * Until the old engine's removal (decided 2026-11-04) the same two
 * problems were pinned through the old engine (bdkEngineBuild.test.ts,
 * removed with it); this holds the one engine left to them, shape by shape.
 */
jest.mock('../spendGate', () => ({ assertSigningEnabled: () => undefined }));

import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { BdkWalletEngineV3 } from '../bdkWalletEngine';
import type { BdkWalletNative, NativeBuildOptions } from '../bdkWalletNative';
import { cancelRequest, speedUpRequest } from '../../../wallet/replacement';
import type { OriginalTx } from '../../../wallet/replacement';
import { parsePolicy } from '../../descriptor/policy';
import { bdkCondition, bdkRequiresPath, bdkShapes, mergeConditions } from '../../../testing/bdkPolicyMirror';
import type { BdkShape, Condition } from '../../../testing/bdkPolicyMirror';
import type { PolicyNode } from '../policyPath';
import { encodeBase64 } from '../../psbt/export';

const RECIPIENT = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const CHANGE = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';
const shapes = bdkShapes('bdkPolicies.v3.json');

/** A real PSBT with no output marked as the vault's, so the engine's own checks pass and it can shuffle. */
function realPsbt(): string {
  const key = HDKey.fromMasterSeed(sha256(utf8ToBytes('engine-shapes')));
  const tx = new btc.Transaction({ allowUnknownOutputs: true });
  const pay = btc.p2wpkh(key.derive("m/84'/1'/0'/0/0").publicKey!, btc.TEST_NETWORK);
  tx.addInput({ txid: new Uint8Array(32).fill(9), index: 0, witnessUtxo: { script: pay.script, amount: 250_000n } });
  for (let i = 0; i < 2; i++) {
    tx.addOutput({ script: btc.p2wpkh(key.derive(`m/84'/1'/0'/1/${i}`).publicKey!, btc.TEST_NETWORK).script, amount: BigInt(100_000 + i) });
  }
  return encodeBase64(tx.toPSBT());
}
const PSBT = realPsbt();

const reject = (code: string, message: string) => Object.assign(new Error(message), { code });

interface Built {
  options: NativeBuildOptions;
  condition: Condition;
}

/** The bridge, with the library's path rules on this shape's trees. */
function bridgeFor(s: BdkShape) {
  const builds: Built[] = [];
  const tree = (k: string): PolicyNode => (k === 'internal' ? s.policyInternal : s.policyExternal);
  const native = {
    openWallet: async () => 'w1',
    closeWallet: async () => true,
    policies: async (_id: string, k: string) => JSON.stringify(tree(k)),
    build: async (_id: string, options: NativeBuildOptions) => {
      for (const k of ['external', 'internal'] as const) {
        if (bdkRequiresPath(tree(k), 'enough') && !options.policyPaths[k]) {
          throw reject('SPENDING_POLICY_REQUIRED', `Spending policy required: ${k === 'external' ? 'External' : 'Internal'}`);
        }
      }
      const condition = mergeConditions(
        bdkCondition(tree('external'), options.policyPaths.external ?? {}, 'enough'),
        bdkCondition(tree('internal'), options.policyPaths.internal ?? {}, 'enough'),
      );
      if (condition.csv != null && options.version === 1) {
        throw reject('VERSION1_CSV', 'Version 1 transactions cannot spend a CSV path');
      }
      builds.push({ options: JSON.parse(JSON.stringify(options)) as NativeBuildOptions, condition });
      return { psbt: PSBT, txid: 'ff'.repeat(32), fee: 1_000, floorApplied: false, reordered: false };
    },
  };
  const calls: string[] = [];
  const proxied = new Proxy(native as Record<string, (...a: never[]) => unknown>, {
    get: (t, name: string) => {
      const f = t[name];
      if (!f) return undefined;
      return (...args: never[]) => {
        calls.push(name);
        return f(...args);
      };
    },
  }) as unknown as BdkWalletNative;
  return { native: proxied, builds, calls };
}

async function engineFor(s: BdkShape) {
  const bridge = bridgeFor(s);
  const engine = await BdkWalletEngineV3.create(
    { network: 'testnet', descriptor: s.descriptorExternal, changeDescriptor: s.descriptorInternal },
    { native: bridge.native, random: () => 0.5 },
  );
  return { engine, ...bridge };
}

const buildCalls = (calls: string[]) => calls.filter((c) => c === 'build').length;

/** A waiting payment of 100 000 sats with change, spending two coins. */
const original: OriginalTx = {
  txid: 'a'.repeat(64),
  coins: [
    { txid: 'b'.repeat(64), vout: 0, valueSats: 200_000 },
    { txid: 'c'.repeat(64), vout: 1, valueSats: 50_000 },
  ],
  outputs: [
    { vout: 0, address: RECIPIENT, valueSats: 100_000, scriptLength: 22, change: false },
    { vout: 1, address: CHANGE, valueSats: 149_000, scriptLength: 34, change: true },
  ],
  totalInSats: 250_000,
  feeSats: 1_000,
  vsize: 250,
  weight: 1_000,
  feeRate: 4,
  recipients: [{ address: RECIPIENT, amountSats: 100_000 }],
  paymentSats: 100_000,
  changeSats: 149_000,
  ownScriptLength: 34,
};
const COINS = ['b'.repeat(64) + ':0', 'c'.repeat(64) + ':1'];

it('the fixture set holds every shape the old engine was held to', () => {
  expect(shapes.map(([n]) => n).sort()).toEqual(bdkShapes().map(([n]) => n).sort());
  expect(shapes.length).toBeGreaterThanOrEqual(6);
});

describe('Speed up and Cancel build on every vault shape', () => {
  it.each(shapes)('%s: Speed up', async (_name, s) => {
    const { engine, builds, calls } = await engineFor(s);
    await engine.buildPsbt(speedUpRequest(original, 12));
    // A multi-path vault is refused once (the library will not choose) and built again on its primary path.
    expect(buildCalls(calls)).toBe(s.bdkEverydayBuild.path ? 2 : 1);
    const built = builds[builds.length - 1];
    // The same coins and nothing else, the same payment, a higher rate, naming the payment it replaces.
    expect(built.options).toMatchObject({
      utxos: COINS,
      manualOnly: true,
      recipients: [{ address: RECIPIENT, sats: 100_000 }],
      drainTo: null,
      feeRateSatPerKwu: 3_000,
      rbf: true,
      version: 1,
      csvPath: false,
      replacing: [original.txid],
    });
    // On the everyday path: no wait.
    expect(built.condition).toEqual({ csv: undefined, timelock: undefined });
    // A multi-path vault was asked for its primary path, for both chains.
    if (s.bdkEverydayBuild.path) {
      expect(built.options.policyPaths).toEqual({ external: s.bdkEverydayBuild.path, internal: s.bdkEverydayBuild.path });
    } else {
      expect(built.options.policyPaths).toEqual({});
    }
  });

  it.each(shapes)('%s: Cancel', async (_name, s) => {
    const { engine, builds } = await engineFor(s);
    await engine.buildPsbt(cancelRequest(original, CHANGE, 12));
    const built = builds[builds.length - 1];
    expect(built.options).toMatchObject({
      utxos: COINS,
      manualOnly: true,
      recipients: [],
      drainTo: CHANGE,
      drainWallet: true,
      rbf: true,
      replacing: [original.txid],
    });
    expect(built.condition).toEqual({ csv: undefined, timelock: undefined });
  });

  it('the engine offers no fee bump of the library, which no multi-path vault survived', async () => {
    const { engine } = await engineFor(shapes.find(([n]) => n === 'wsh-layered-older')![1]);
    expect((engine as unknown as Record<string, unknown>).bumpFee).toBeUndefined();
  });
});

describe('a rescue or an heir’s spend takes its key’s path', () => {
  const cases = shapes.flatMap(([name, s]) =>
    parsePolicy(s.descriptorExternal)
      .paths.filter((p) => p.olderBlocks != null || p.afterHeight != null)
      .flatMap((p) =>
        p.groups.flatMap((g) =>
          g.keys.map((k) => [name, k.fingerprint!, s, { csv: p.olderBlocks, timelock: p.afterHeight }] as const),
        ),
      ),
  );

  it('there are timelocked paths to test', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('%s, rescue by %s', async (_name, fp, s, wait) => {
    const { engine, builds, calls } = await engineFor(s);
    await engine.buildRescuePsbt({
      utxos: [{ txid: 'd'.repeat(64), vout: 0 }],
      destination: RECIPIENT,
      feeRate: 10,
      branchFingerprint: fp,
    });
    expect(builds[0].condition).toEqual(wait);
    expect(builds[0].options).toMatchObject({
      drainTo: RECIPIENT,
      drainWallet: true,
      manualOnly: true,
      rbf: false,
      version: wait.csv != null ? 2 : 1,
      csvPath: wait.csv != null,
    });
    // One build: the path and the version were right the first time.
    expect(buildCalls(calls)).toBe(1);
  });

  // Decided 2026-10-31: a waiting rescue can be sped up. Held on the old
  // engine shape by shape until the old engine's removal; the same rows on the one engine.
  it.each(cases)('%s, a rescue’s speed-up by %s: the same wait, an absolute fee, the spent coins taken', async (_name, fp, s, wait) => {
    const { engine, builds, calls } = await engineFor(s);
    const replaced = 'e'.repeat(64);
    await engine.buildRescuePsbt({
      utxos: [{ txid: 'd'.repeat(64), vout: 0 }],
      destination: RECIPIENT,
      feeRate: 10,
      feeAbsolute: 9_000,
      branchFingerprint: fp,
      replacing: [replaced],
    });
    expect(builds[0].condition).toEqual(wait);
    expect(builds[0].options).toMatchObject({
      drainTo: RECIPIENT,
      drainWallet: true,
      manualOnly: true,
      utxos: [`${'d'.repeat(64)}:0`],
      rbf: false,
      version: wait.csv != null ? 2 : 1,
      csvPath: wait.csv != null,
      feeAbsoluteSats: 9_000,
      replacing: [replaced],
    });
    expect(buildCalls(calls)).toBe(1);
  });

  it.each(cases)('%s, heir spend by %s', async (_name, fp, s, wait) => {
    const { engine, builds, calls } = await engineFor(s);
    await engine.buildPsbt({
      utxos: [{ txid: 'd'.repeat(64), vout: 0 }],
      recipients: [{ address: RECIPIENT, amountSats: 50_000 }],
      feeRate: 10,
      branchFingerprint: fp,
    });
    expect(builds[0].condition).toEqual(wait);
    expect(builds[0].options).toMatchObject({ version: wait.csv != null ? 2 : 1, csvPath: wait.csv != null });
    expect(buildCalls(calls)).toBe(1);
  });
});
