/**
 * The change-side disagreement the rule of 2026-10-17 covers, found
 * where it actually happens (decided 2026-10-17): the 0..9 sweep
 * matches on both keychains, but the library puts a payment's change at
 * internal index 23 and scure derives another script there. The new engine's
 * own check of the build (`ownOutputProblems` in `finishBuild`) is the only
 * one that sees it, and it must pause the vault exactly as a sweep's mismatch
 * does: every entry point shows "Sending is paused for this vault" (the code
 * isSendPaused reads), and the vault's verdict blocks Receive and every later
 * build.
 *
 * The real engine (`BdkWalletEngineV3`) over a stand-in bridge whose peeks
 * answer scure's own addresses (so the sweep matches) and whose build hands
 * back a payment with a bad change output, wrapped in the real gate
 * (`guardedEngine`, as `WalletProvider.getEngine` wraps every engine), driven
 * through each entry point's own code: Send's `buildUnsignedPsbt`, the
 * multi-coin Refresh's per-coin drain builds, Cancel's `buildReplacement` and
 * its notice, and the signing page's rebuild for another key
 * (`buildPsbt({ ...rebuild, branchFingerprint })`). What each screen then
 * draws for `isSendPaused` is pinned in sendPaused.test.ts.
 */
jest.mock('react-native', () => ({ InteractionManager: { runAfterInteractions: (f: () => void) => f() } }));
jest.mock('../../config', () => ({ ...jest.requireActual('../../config'), BUILD_FLAVOUR: 'full' }));
jest.mock('../../platform/engineReportFile', () => ({ REPORT_APP: {}, updateEngineReport: jest.fn() }));
jest.mock('../../wallet/sealedStore', () => ({
  sealedGetItem: jest.fn(async () => null),
  sealedSetItem: jest.fn(async () => undefined),
}));
jest.mock('../../bitcoin/engine/spendGate', () => ({ assertSigningEnabled: () => undefined }));

import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { BdkWalletEngineV3 } from '../../bitcoin/engine/bdkWalletEngine';
import type { BdkWalletNative } from '../../bitcoin/engine/bdkWalletNative';
import { blocksBuilding, blocksReceive, isSendPaused, SEND_PAUSED_TITLE } from '../../bitcoin/engine/addressCheck';
import { scureAddresses } from '../../bitcoin/descriptor/scureAddresses';
import { descriptorPair } from '../../bitcoin/engine/engineShared';
import { encodeBase64 } from '../../bitcoin/psbt/export';
import { buildUnsignedPsbt } from '../../bitcoin/psbt/build';
import type { WalletEngine } from '../../bitcoin/engine/types';
import { addressCheckNow, addressCheckVerdict, guardedEngine, resetAddressChecksForTests } from '../../wallet/addressCheckStore';
import type { CheckedVault } from '../../wallet/addressCheckStore';
import { buildReplacement } from '../../wallet/replacement';
import type { OriginalTx } from '../../wallet/replacement';
import { replacementBuildNotice } from '../screens/replacementSheet';
import { bdkShapes } from '../../testing/bdkPolicyMirror';

const H = 0x8000_0000;
const NET = btc.TEST_NETWORK;
const stranger = HDKey.fromMasterSeed(sha256(utf8ToBytes('send-paused-stranger')));
const PAY_TO = btc.p2wpkh(stranger.derive('m/0/0').publicKey!, NET);
const PAY_TO_ADDRESS = btc.Address(NET).encode(btc.OutScript.decode(PAY_TO.script));

// The vault: a one-key wpkh testnet vault with its own change keychain.
const vaultKey = HDKey.fromMasterSeed(sha256(utf8ToBytes('send-paused-change')));
const acct = vaultKey.derive("m/84'/1'/0'");
const fpHex = vaultKey.fingerprint.toString(16).padStart(8, '0');
const WPKH = `wpkh([${fpHex}/84'/1'/0']${acct.publicExtendedKey}/<0;1>/*)`;

// The layered taproot vault the signing page rebuilds on a recovery key's branch.
const layered = bdkShapes('bdkPolicies.v3.json').find(([n]) => n === 'tr-nums-layered-older')![1];
const RESCUE_FP = 'DE1725C5';

/**
 * A payment as the library hands it back: a coin of the vault, the payment,
 * and a change output its derivation labels internal 23 while it pays the
 * script of internal 24 (the library and scure disagree at 23).
 */
function badChangePayment(): string {
  const tx = new btc.Transaction({ allowUnknownOutputs: true });
  tx.addInput({
    txid: new Uint8Array(32).fill(3),
    index: 0,
    witnessUtxo: { script: btc.p2wpkh(acct.deriveChild(0).deriveChild(0).publicKey!, NET).script, amount: 50_000n },
  });
  tx.addOutput({ script: PAY_TO.script, amount: 1_000n });
  tx.addOutput({
    script: btc.p2wpkh(acct.deriveChild(1).deriveChild(24).publicKey!, NET).script,
    amount: 48_000n,
    bip32Derivation: [[acct.deriveChild(1).deriveChild(23).publicKey!, { fingerprint: vaultKey.fingerprint, path: [84 + H, 1 + H, 0 + H, 1, 23] }]],
  } as never);
  return encodeBase64(tx.toPSBT());
}

/**
 * The stand-in bridge: every peek answers scure's address at that index (the
 * 0..9 sweep MATCHES on both keychains), `new` answers index 40 of the
 * keychain asked, and every build hands back the bad change payment.
 */
function bridge(vault: { descriptor: string; changeDescriptor?: string }) {
  const pair = descriptorPair(vault);
  const idx = Array.from({ length: 50 }, (_, i) => i);
  const ext = scureAddresses(pair.external, 'testnet', idx)!;
  const int = scureAddresses(pair.internal ?? pair.external, 'testnet', idx)!;
  let builds = 0;
  const answers: Record<string, (...a: never[]) => unknown> = {
    openWallet: () => 'w1',
    closeWallet: () => true,
    sync: () => ({ tipHeight: 900, ms: 5, passes: 1, lookahead: 150 }),
    address: ((_id: string, keychain: string, which: string) => {
      const i = which === 'new' || which === 'lastUnused' ? 40 : Number(which);
      return { index: i, address: (keychain === 'internal' ? int : ext)[i].address, keychain };
    }) as never,
    policies: ((_id: string, k: string) =>
      vault.descriptor === layered.descriptorExternal
        ? JSON.stringify(k === 'internal' ? layered.policyInternal : layered.policyExternal)
        : null) as never,
    build: () => {
      builds += 1;
      return { psbt: badChangePayment(), txid: 'ff'.repeat(32), fee: 222, floorApplied: false, reordered: false };
    },
    isMine: () => true,
  };
  const native = new Proxy(answers, {
    get: (t, name: string) => async (...args: never[]) => {
      if (!t[name]) throw new Error(`the stand-in bridge has no ${name}`);
      return t[name](...args);
    },
  }) as unknown as BdkWalletNative;
  return { native, builds: () => builds };
}

/** A launch: the gate's state cleared, the check's pauses immediate. */
async function launch(vault: CheckedVault) {
  resetAddressChecksForTests({
    storage: { getItem: async () => null, setItem: async () => undefined },
    idle: async () => undefined,
    sleep: async () => undefined,
  });
  const b = bridge(vault);
  const created = await BdkWalletEngineV3.create(
    { descriptor: vault.descriptor, changeDescriptor: vault.changeDescriptor, network: 'testnet' },
    { native: b.native },
  );
  // As WalletProvider.getEngine hands every screen its engine.
  return { engine: guardedEngine(created as unknown as WalletEngine, vault), builds: b.builds };
}

const wpkhVault: CheckedVault = { id: 'vault-wpkh', descriptor: WPKH, network: 'testnet' };
const layeredVault: CheckedVault = {
  id: 'vault-layered',
  descriptor: layered.descriptorExternal,
  changeDescriptor: layered.descriptorInternal,
  network: 'testnet',
};

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

/** The vault is paused for the launch: Receive, Send at open, and every later build. */
async function expectPaused(vault: CheckedVault, engine: WalletEngine, builds: () => number) {
  expect(addressCheckVerdict(vault.id)).toMatchObject({ kind: 'mismatch', keychain: 'internal' });
  expect(blocksReceive(addressCheckVerdict(vault.id))).toBe(true);
  expect(blocksBuilding(addressCheckVerdict(vault.id))).toBe(true);
  const before = builds();
  const later = await buildUnsignedPsbt(engine, { recipients: [{ address: PAY_TO_ADDRESS, amountSats: 1000 }], feeRate: 2 }).catch((x) => x);
  expect(isSendPaused(later)).toBe(true);
  // Refused by the gate: the library is not asked again.
  expect(builds()).toBe(before);
}

describe('the sweep matches, the build\'s change does not: every entry point pauses the vault', () => {
  it('the stand-in really passes the sweep (the pause below comes from the build alone)', async () => {
    for (const vault of [wpkhVault, layeredVault]) {
      const { engine } = await launch(vault);
      expect(await addressCheckNow(vault, engine)).toMatchObject({ kind: 'match', checked: 20 });
    }
  });

  it('Send: "Sending is paused for this vault", and the vault is paused', async () => {
    const { engine, builds } = await launch(wpkhVault);
    const err = await buildUnsignedPsbt(engine, { recipients: [{ address: PAY_TO_ADDRESS, amountSats: 1000 }], feeRate: 2 }).catch((x) => x);
    expect(isSendPaused(err)).toBe(true);
    expect(err.message).toBe(SEND_PAUSED_TITLE);
    expect(builds()).toBe(1);
    await expectPaused(wpkhVault, engine, builds);
  });

  it('a multi-coin Refresh (one drain per coin, as SendScreen builds them): the first coin stops the whole refresh', async () => {
    const { engine, builds } = await launch(wpkhVault);
    const coins = [
      { txid: 'aa'.repeat(32), vout: 0 },
      { txid: 'bb'.repeat(32), vout: 1 },
    ];
    // SendScreen's loop: a fresh change address per coin, a drain of that coin,
    // and `if (isSendPaused(e)) throw e;` (pinned in sendPaused.test.ts).
    const refresh = async () => {
      for (const u of coins) {
        const addr = (await engine.getInternalAddress('new')).address;
        try {
          await buildUnsignedPsbt(engine, { recipients: [{ address: addr, amountSats: 0 }], feeRate: 2, drain: true, utxos: [u] });
        } catch (e) {
          if (isSendPaused(e)) throw e;
        }
      }
    };
    const err = await refresh().catch((x) => x);
    expect(isSendPaused(err)).toBe(true);
    expect(builds()).toBe(1);
    await expectPaused(wpkhVault, engine, builds);
  });

  it('Cancel: the notice is the title alone, never "Could not cancel it"', async () => {
    const { engine, builds } = await launch(wpkhVault);
    const orig: OriginalTx = {
      txid: 'cc'.repeat(32),
      coins: [{ txid: 'aa'.repeat(32), vout: 0, valueSats: 50_000 }],
      outputs: [
        { vout: 0, address: PAY_TO_ADDRESS, valueSats: 1_000, scriptLength: 22, change: false },
        { vout: 1, address: null, valueSats: 48_800, scriptLength: 22, change: true },
      ],
      totalInSats: 50_000,
      feeSats: 200,
      vsize: 141,
      weight: 561,
      feeRate: 200 / 141,
      recipients: [{ address: PAY_TO_ADDRESS, amountSats: 1_000 }],
      paymentSats: 1_000,
      changeSats: 48_800,
      ownScriptLength: 22,
    };
    const err = await buildReplacement(engine, orig, 'cancel', 5).catch((x) => x);
    expect(isSendPaused(err)).toBe(true);
    expect(replacementBuildNotice(err, 'cancel')).toEqual({ title: SEND_PAUSED_TITLE });
    expect(replacementBuildNotice(err, 'speedup')).toEqual({ title: SEND_PAUSED_TITLE });
    await expectPaused(wpkhVault, engine, builds);
  });

  it('the signing page\'s rebuild for another key (a recovery key\'s branch): the same title', async () => {
    const { engine, builds } = await launch(layeredVault);
    const rebuild = { recipients: [{ address: PAY_TO_ADDRESS, amountSats: 1000 }], feeRate: 2 };
    // SignPsbtScreen: `engine.buildPsbt({ ...rebuild, branchFingerprint: fp })`.
    const err = await engine.buildPsbt({ ...rebuild, branchFingerprint: RESCUE_FP }).catch((x) => x);
    expect(isSendPaused(err)).toBe(true);
    expect(err.message).toBe(SEND_PAUSED_TITLE);
    expect(builds()).toBe(1);
    await expectPaused(layeredVault, engine, builds);
  });
});
