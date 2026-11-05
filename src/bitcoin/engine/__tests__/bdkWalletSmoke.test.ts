/**
 * The wallet library's smoke check (BDK upgrade, decided 2026-10-15; one
 * library since the old engine's removal, decided 2026-11-04): the pure check over stand-in
 * libraries, and the library's known-answer vectors, which live in the
 * native module's Swift, worked out again here by an independent
 * implementation (@scure/btc-signer), so a vector cannot be "fixed" in the
 * Swift to match whatever the library says.
 */
import * as fs from 'fs';
import * as path from 'path';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';

// What the app's user defaults hold at launch (a launch argument lands there).
const mockDefaults: Record<string, unknown> = {};
jest.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'ios' },
  Settings: { get: (key: string) => mockDefaults[key] },
}));

import {
  SMOKE_ADDRESS0,
  SMOKE_DESCRIPTOR,
  SMOKE_LAUNCH_ARG,
  bdkWalletSmoke,
  smokeAsked,
  smokeAskedAtLaunch,
  smokeLine,
} from '../bdkWalletSmoke';
import type { BdkWalletNative } from '../bdkWalletSmoke';

const passing = (overrides: Partial<BdkWalletNative> = {}): BdkWalletNative => ({
  knownAnswer: async () => ({ passed: true, vectors: 4 }),
  peekAddress: async () => SMOKE_ADDRESS0,
  ...overrides,
});

describe('the smoke check', () => {
  it("passes when the known answers pass and the library gives BIP-84's address 0", async () => {
    const r = await bdkWalletSmoke(passing());
    expect(r).toEqual({
      build: 'debug',
      knownAnswer: 'passed',
      vectors: 4,
      address0: SMOKE_ADDRESS0,
      agree: true,
      problems: [],
    });
    expect(smokeLine(r)).toBe(`[bdkwallet smoke] PASS: known-answer passed (4 vectors); address 0 ${SMOKE_ADDRESS0}, BIP-84's`);
  });

  it('asks the library for the public descriptor, on mainnet, receive chain, index 0', async () => {
    const asked: unknown[][] = [];
    await bdkWalletSmoke(
      passing({
        peekAddress: async (...args) => {
          asked.push(args);
          return SMOKE_ADDRESS0;
        },
      }),
    );
    expect(asked).toEqual([[SMOKE_DESCRIPTOR, 'bitcoin', 'external', 0]]);
    expect(SMOKE_DESCRIPTOR).not.toMatch(/prv/);
  });

  it.each([
    ['the library missing from the build', undefined, 'is not in this build'],
    [
      'a known-answer failure',
      passing({ knownAnswer: async () => Promise.reject(new Error('Vector 2 gave another address')) }),
      'known-answer test: Vector 2 gave another address',
    ],
    [
      'a release build whose known answers fail',
      passing({ peekAddress: undefined, knownAnswer: async () => Promise.reject(new Error('Vector 1 gave another address')) }),
      'known-answer test: Vector 1 gave another address',
    ],
    ['another address 0', passing({ peekAddress: async () => 'bc1qother' }), "does not give BIP-84's address 0"],
    ['address 0 failing', passing({ peekAddress: async () => Promise.reject(new Error('no wallet')) }), 'address 0: no wallet'],
  ])('fails on %s, and says so in the log line', async (_what, lib, says) => {
    const r = await bdkWalletSmoke(lib);
    expect(r.problems.join('; ')).toContain(says);
    expect(smokeLine(r)).toMatch(/^\[bdkwallet smoke\] FAIL( \(release build\))?: /);
  });

  it('a known answer that does not pass fails the check even when address 0 is right', async () => {
    const r = await bdkWalletSmoke(passing({ knownAnswer: async () => ({ passed: false, vectors: 4 }) }));
    expect(r).toMatchObject({ knownAnswer: 'failed', agree: true });
    expect(smokeLine(r)).toMatch(/^\[bdkwallet smoke\] FAIL: known-answer failed/);
  });

  // Decided 2026-10-17: the bindings must be proven in a Release build too.
  it('passes a release build (no peekAddress) on the known answers alone', async () => {
    const asked: unknown[] = [];
    const r = await bdkWalletSmoke(passing({ peekAddress: undefined, knownAnswer: async () => (asked.push('kat'), { passed: true, vectors: 4 }) }));
    expect(asked).toEqual(['kat']);
    expect(r).toMatchObject({ build: 'release', knownAnswer: 'passed', address0: null, agree: true, problems: [] });
    expect(smokeLine(r)).toBe("[bdkwallet smoke] PASS (release build): known-answer passed (4 vectors, BIP-84's address 0 among them)");
  });
});

describe('when the check runs (decided 2026-10-17)', () => {
  afterEach(() => {
    delete mockDefaults[SMOKE_LAUNCH_ARG];
    delete (global as Record<string, unknown>).__DEV__;
  });

  it('runs in every DEBUG build, and in a Release build only in a signing flavour launched with the argument', () => {
    expect(smokeAsked({ dev: true, hww: false, launchValue: undefined })).toBe(true);
    for (const v of ['YES', 'yes', '1', 'true', 1, true]) {
      expect(smokeAsked({ dev: false, hww: true, launchValue: v })).toBe(true);
      // Never the App Store app, whatever it is launched with.
      expect(smokeAsked({ dev: false, hww: false, launchValue: v })).toBe(false);
    }
    for (const v of [undefined, null, '', 'NO', '0', 0, false, 'please']) {
      expect(smokeAsked({ dev: false, hww: true, launchValue: v })).toBe(false);
    }
  });

  it('reads the launch argument from the app\'s user defaults, and a Release build without it never runs', () => {
    expect(SMOKE_LAUNCH_ARG).toBe('TaliaBdkWalletSmoke');
    // jest runs with no flags: the App Store flavour, so the argument alone opens nothing.
    mockDefaults[SMOKE_LAUNCH_ARG] = 'YES';
    expect(smokeAskedAtLaunch()).toBe(false);
    (global as Record<string, unknown>).__DEV__ = true;
    expect(smokeAskedAtLaunch()).toBe(true);
  });

  it('App.tsx runs it through smokeAskedAtLaunch alone, and peekAddress stays DEBUG-only in the Swift', () => {
    const root = path.join(__dirname, '..', '..', '..', '..');
    const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
    expect(app).toContain('if (smokeAskedAtLaunch()) {\n  void runBdkWalletSmoke().then((r) => console.log(smokeLine(r)));\n}');
    expect(app.match(/runBdkWalletSmoke\(/g)).toHaveLength(1);
    const swift = fs.readFileSync(path.join(root, 'native', 'bdkwallet', 'bridge', 'TaliaBdkWalletModule.swift'), 'utf8');
    expect(swift.indexOf('#if DEBUG')).toBeLessThan(swift.indexOf('func peekAddress('));
    expect(swift.indexOf('#endif')).toBeGreaterThan(swift.indexOf('func peekAddress('));
  });
});

describe('the known-answer vectors in the native module', () => {
  const swift = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'native', 'bdkwallet', 'bridge', 'TaliaBdkWalletModule.swift'),
    'utf8',
  );
  const constants: Record<string, string> = {};
  for (const m of swift.matchAll(/^private let ([A-Z0-9_]+) = "([^"]+)"$/gm)) {
    constants[m[1]] = m[2];
  }
  const expand = (s: string) => s.replace(/\\\(([A-Z0-9_]+)\)/g, (_m, k: string) => constants[k]);
  const vectors = [
    ...swift.matchAll(
      /KnownAnswer\(\s*descriptor: "([^"]+)", change: (?:"([^"]+)"|nil),\s*network: \.(\w+), keychain: \.(\w+), index: (\d+),\s*address: "([^"]+)"\)/g,
    ),
  ].map((m) => ({
    descriptor: expand(m[1]),
    change: m[2] ? expand(m[2]) : null,
    network: m[3],
    keychain: m[4],
    index: Number(m[5]),
    address: m[6],
  }));
  const TEST_NET = { bech32: 'tb', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };

  /** `[origin]xpub/<chain>/*` -> the public key at chain/index. */
  const keyAt = (expr: string, index: number) => {
    const m = /^\[[0-9a-f]{8}(?:\/\d+')*\]([xt]pub[1-9A-HJ-NP-Za-km-z]+)\/(\d+)\/\*$/.exec(expr);
    if (!m) {
      throw new Error(`not a ranged key: ${expr}`);
    }
    // scure reads the key bytes; the tpub prefix only names the network.
    const versions = m[1].startsWith('tpub') ? { private: 0x04358394, public: 0x043587cf } : undefined;
    return HDKey.fromExtendedKey(m[1], versions).deriveChild(Number(m[2])).deriveChild(index).publicKey as Uint8Array;
  };

  /** The address the descriptor gives at index, by scure (wpkh, tr key path, wsh(sortedmulti)). */
  function scureAddress(descriptor: string, index: number, network: string): string {
    const net = network === 'bitcoin' ? undefined : TEST_NET;
    let m = /^wpkh\((.+)\)$/.exec(descriptor);
    if (m) {
      return btc.p2wpkh(keyAt(m[1], index), net).address as string;
    }
    m = /^tr\((.+)\)$/.exec(descriptor);
    if (m) {
      return btc.p2tr(keyAt(m[1], index).slice(1), undefined, net).address as string;
    }
    m = /^wsh\(sortedmulti\((\d+),(.+)\)\)$/.exec(descriptor);
    if (m) {
      const keys = m[2].split(',').map((k) => keyAt(k, index));
      keys.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      return btc.p2wsh(btc.p2ms(Number(m[1]), keys), net).address as string;
    }
    throw new Error(`no scure form for ${descriptor}`);
  }

  it('holds the four vectors: BIP-84 receive and change, BIP-86, and a Testnet4 2-of-2', () => {
    expect(vectors.map((v) => [v.network, v.keychain, v.index])).toEqual([
      ['bitcoin', 'external', 0],
      ['bitcoin', 'internal', 0],
      ['bitcoin', 'external', 1],
      ['testnet4', 'external', 0],
    ]);
    // BIP-84's and BIP-86's own published addresses.
    expect(vectors[0].address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    expect(vectors[1].address).toBe('bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
    expect(vectors[2].address).toBe('bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh');
    // The JavaScript smoke check's descriptor is the first vector's.
    expect(vectors[0].descriptor).toBe(SMOKE_DESCRIPTOR);
    expect(vectors[0].address).toBe(SMOKE_ADDRESS0);
  });

  it('each address is what an independent implementation derives', () => {
    for (const v of vectors) {
      const descriptor = v.keychain === 'internal' ? (v.change as string) : v.descriptor;
      expect(scureAddress(descriptor, v.index, v.network)).toBe(v.address);
    }
  });

  it('public keys only, and the peek is compiled into DEBUG builds alone', () => {
    expect(swift).not.toMatch(/[xt]prv|mnemonic|Mnemonic\(/);
    const debugBlock = /#if DEBUG([\s\S]*?)#endif/.exec(swift);
    expect(debugBlock && debugBlock[1]).toContain('func peekAddress(');
    const code = (text: string) => text.replace(/\/\/.*$/gm, '');
    // The library's own peekAddress is what the known answers use; the bridge
    // METHOD of that name, the one JavaScript can call, is DEBUG-only.
    const outside = code(swift).replace(/#if DEBUG[\s\S]*?#endif/g, '');
    expect(outside).not.toContain('func peekAddress(');
    expect(outside).not.toContain('@objc(peekAddress');
    const objc = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', '..', 'native', 'bdkwallet', 'bridge', 'TaliaBdkWalletModule.m'),
      'utf8',
    );
    expect(code(objc).replace(/#if DEBUG[\s\S]*?#endif/g, '')).not.toContain('peekAddress');
  });
});
