/**
 * The new engine's rules that never touch the library (BDK upgrade, decided
 * 2026-10-15): the rate as sat/kwu, the networks, the
 * server (no stop gap: the bridge fixes it at 150 and the saved 20 is never
 * passed), the version from the chosen path, and a request as the bridge's
 * options.
 */
import {
  baseBuildOptions,
  nativeNetworkOf,
  probeServerOf,
  satPerKwu,
  syncServerOf,
  versionFor,
  whichOf,
  withPaths,
} from '../bdkWalletRules';
import { bdkShapes } from '../../../testing/bdkPolicyMirror';
import { branchPolicyPath, primaryPolicyPath } from '../policyPath';

describe('the fee rate as sat/kwu', () => {
  it('is ceil(rate x 250), worked out exactly', () => {
    expect(satPerKwu(1)).toBe(250);
    expect(satPerKwu(2)).toBe(500);
    expect(satPerKwu(1.1)).toBe(275); // 275.00000000000006 as a float
    expect(satPerKwu(0.3)).toBe(75);
    expect(satPerKwu(5.5)).toBe(1375);
    expect(satPerKwu(1.001)).toBe(251); // 250.25 rounds up
    expect(satPerKwu(2000)).toBe(500_000);
    expect(satPerKwu(0.004)).toBe(1);
  });
});

describe('the bridge\'s names', () => {
  it('maps the networks; the bridge opens "testnet" as Testnet4', () => {
    expect(['bitcoin', 'testnet', 'signet', 'regtest'].map((n) => nativeNetworkOf(n as never))).toEqual([
      'bitcoin',
      'testnet',
      'signet',
      'regtest',
    ]);
  });

  it('asks for an address by name or index, nothing else', () => {
    expect(whichOf('new')).toBe('new');
    expect(whichOf('lastUnused')).toBe('lastUnused');
    expect(whichOf(7)).toBe('7');
    expect(() => whichOf(-1)).toThrow();
    expect(() => whichOf(1.5)).toThrow();
    expect(() => whichOf(0x80000000)).toThrow();
  });
});

describe('the server', () => {
  const saved = { type: 'electrum' as const, url: 'ssl://e.example:50002', stopGap: 20 };
  it('never passes the saved stop gap', () => {
    expect(syncServerOf(saved)).toEqual({ url: saved.url, retry: 5, timeout: 30, validateDomain: true });
    expect(syncServerOf(saved)).not.toHaveProperty('stopGap');
    expect(probeServerOf(saved)).toEqual({ url: saved.url, retry: 2, timeout: 15, validateDomain: true });
  });
  it('keeps the caller\'s retry, timeout and certificate rule', () => {
    const lan = { type: 'electrum' as const, url: 'ssl://10.0.0.20:50002', retry: 1, timeout: 5, validateDomain: false };
    expect(syncServerOf(lan)).toEqual({ url: lan.url, retry: 1, timeout: 5, validateDomain: false });
    expect(probeServerOf(lan)).toEqual({ url: lan.url, retry: 1, timeout: 5, validateDomain: false });
  });
});

describe('a request as the bridge\'s options', () => {
  const to = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
  it('a payment: recipients, RBF on, the tip as the height, no path yet', () => {
    expect(baseBuildOptions({ recipients: [{ address: ` ${to} `, amountSats: 1000 }], feeRate: 2 }, 900)).toEqual({
      recipients: [{ address: to, sats: 1000 }],
      drainTo: null,
      drainWallet: false,
      utxos: [],
      manualOnly: false,
      unspendable: [],
      feeRateSatPerKwu: 500,
      feeRateSatPerVb: 2,
      feeAbsoluteSats: null,
      policyPaths: {},
      rbf: true,
      csvPath: false,
      version: 1,
      currentHeight: 900,
      replacing: [],
    });
  });
  it('a send-all of named coins, RBF off, frozen coins, a fixed fee, replacing, never synced', () => {
    const o = baseBuildOptions(
      {
        recipients: [{ address: to, amountSats: 0 }],
        drain: true,
        utxos: [{ txid: 'aa'.repeat(32), vout: 1 }],
        excludeUtxos: [{ txid: 'bb'.repeat(32), vout: 0 }],
        feeRate: 5.5,
        feeAbsolute: 1234.2,
        enableRbf: false,
        replacing: ['cc'.repeat(32)],
      },
      undefined,
    );
    expect(o).toMatchObject({
      recipients: [],
      drainTo: to,
      drainWallet: true,
      utxos: [`${'aa'.repeat(32)}:1`],
      manualOnly: true,
      unspendable: [`${'bb'.repeat(32)}:0`],
      feeRateSatPerKwu: 1375,
      feeAbsoluteSats: 1235, // rounded up, as the old bridge's ceiling
      rbf: false,
      currentHeight: 0,
      replacing: ['cc'.repeat(32)],
    });
  });
});

describe('the version follows the chosen path', () => {
  it.each(bdkShapes('bdkPolicies.v3.json'))('%s', (_name, s) => {
    const policies = { external: s.policyExternal, internal: s.policyInternal };
    const everyday = primaryPolicyPath(s.policyExternal, s.descriptorExternal);
    expect(versionFor(policies, { external: everyday, internal: everyday })).toEqual({ version: 1, csvPath: false });
    if (s.bdkRescueBuild && !s.bdkRescueBuild.fullPath.error) {
      const fp = s.fingerprints[s.fingerprints.length - 1];
      const path = branchPolicyPath(s.policyExternal, fp) ?? s.bdkRescueBuild.fullPath.path;
      const v = versionFor({ external: s.policyExternal }, { external: path });
      // 0.28 built version 2 exactly when the path's nSequence was a CSV value.
      expect(v.version === 2).toBe(s.bdkRescueBuild.fullPath.nSequence! < 0x80000000);
    }
    const base = baseBuildOptions({ recipients: [{ address: 'x', amountSats: 1 }], feeRate: 1 }, 1);
    expect(withPaths(base, policies, { external: everyday }).policyPaths).toEqual(everyday ? { external: everyday } : {});
  });
});
