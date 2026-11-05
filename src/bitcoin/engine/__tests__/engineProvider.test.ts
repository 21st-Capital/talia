/**
 * The engine provider with one engine (BDK upgrade, decided 2026-10-15, with
 * the connection test routed through the provider; the old engine's
 * removal, decided 2026-11-04): every flavour opens every vault on bdk-ffi 3.1.1
 * through TaliaBdkWalletModule once the launch's known-answer test passed,
 * a failed test or a missing library opens no vault, the connection test
 * goes through the same library, and no screen starts the library.
 */
import * as fs from 'fs';
import * as path from 'path';
let mockFlavour: 'full' | 'signing' | 'store' = 'store';
jest.mock('../../../config', () => {
  const actual = jest.requireActual('../../../config');
  return {
    ...actual,
    get BUILD_FLAVOUR() {
      return mockFlavour;
    },
  };
});

import {
  activeEngineFactory,
  configureEngine,
  ensureKnownAnswer,
  knownAnswerNow,
  LIBRARY_CHECK_FAILED,
  lastConnectionAnswer,
  NO_WALLET_LIBRARY,
  onConnectionAnswer,
  onKnownAnswer,
  resetEngineForTests,
  testBackendConnection,
} from '../engineProvider';
import type { KnownAnswerState } from '../engineProvider';
import { BdkWalletEngineV3 } from '../bdkWalletEngine';
import type { BdkWalletNative } from '../bdkWalletNative';
import type { BackendConfig } from '../types';

const DESC = "wpkh([73c5da0a/84'/0'/0']xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V/<0;1>/*)";
const backend: BackendConfig = { type: 'electrum', url: 'ssl://probe.example.org:50002', validateDomain: true };

/**
 * The library's module, as a build that links it hands it in: every call of
 * any of its methods is recorded, and it answers as a healthy library would
 * unless told otherwise.
 */
function linkedLibrary(answers: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const all: Record<string, unknown> = {
    knownAnswer: { passed: true, vectors: 4 },
    openWallet: 'w',
    closeWallet: true,
    probeServer: { height: 77 },
    ...answers,
  };
  const native = new Proxy(
    {},
    {
      get: (_t, prop) => {
        // Never a thenable: an async function returning it must not await it.
        if (prop === 'then') return undefined;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          const a = all[String(prop)];
          if (a instanceof Error) return Promise.reject(a);
          return Promise.resolve(typeof a === 'function' ? (a as (...x: unknown[]) => unknown)(...args) : a ?? null);
        };
      },
    },
  ) as unknown as BdkWalletNative;
  return { native, calls };
}

beforeEach(() => {
  resetEngineForTests();
  mockFlavour = 'store';
});

describe.each(['full', 'signing', 'store'] as const)('the %s flavour', (flavour) => {
  beforeEach(() => {
    mockFlavour = flavour;
  });

  it('opens a vault on the library once its known answers pass, run once a launch', async () => {
    const { native, calls } = linkedLibrary();
    configureEngine({ native });
    expect(knownAnswerNow()).toBeNull();
    const factory = await activeEngineFactory();
    const a = await factory.create({ descriptor: DESC, network: 'bitcoin' });
    const b = await factory.create({ descriptor: DESC, network: 'bitcoin' });
    expect(a).toBeInstanceOf(BdkWalletEngineV3);
    expect(b).toBeInstanceOf(BdkWalletEngineV3);
    expect(knownAnswerNow()).toEqual({ state: 'passed', vectors: 4 });
    expect(calls.filter((c) => c === 'knownAnswer')).toHaveLength(1);
    expect(calls.filter((c) => c === 'openWallet')).toHaveLength(2);
  });

  it('a failed known-answer test opens no vault this launch, and opens nothing in the library', async () => {
    const { native, calls } = linkedLibrary({ knownAnswer: { passed: false, vectors: 4 } });
    configureEngine({ native });
    const factory = await activeEngineFactory();
    await expect(factory.create({ descriptor: DESC, network: 'bitcoin' })).rejects.toThrow(LIBRARY_CHECK_FAILED);
    await expect(factory.create({ descriptor: DESC, network: 'testnet' })).rejects.toThrow(LIBRARY_CHECK_FAILED);
    expect(knownAnswerNow()).toEqual({ state: 'failed', problem: 'a vector gave another address' });
    expect(calls).toEqual(['knownAnswer']);
  });

  it('a known-answer test that throws is a failure too', async () => {
    const { native } = linkedLibrary({ knownAnswer: new Error('Vector 3 gave another address') });
    configureEngine({ native });
    await expect((await activeEngineFactory()).create({ descriptor: DESC, network: 'bitcoin' })).rejects.toThrow(LIBRARY_CHECK_FAILED);
    expect(knownAnswerNow()).toEqual({ state: 'failed', problem: 'Vector 3 gave another address' });
  });
});

describe('a build without the library (not one Talia ships)', () => {
  it('opens no vault and has no connection test, and says so in plain words', async () => {
    configureEngine({});
    await expect((await activeEngineFactory()).create({ descriptor: DESC, network: 'bitcoin' })).rejects.toThrow(NO_WALLET_LIBRARY);
    expect(await ensureKnownAnswer()).toEqual({ state: 'missing' });
    await expect(testBackendConnection(backend)).rejects.toThrow(NO_WALLET_LIBRARY);
    expect(lastConnectionAnswer()).toMatchObject({ height: null, error: NO_WALLET_LIBRARY });
    for (const words of [NO_WALLET_LIBRARY, LIBRARY_CHECK_FAILED]) expect(words).not.toMatch(/—/);
  });

  it('nothing configured at all is the same', async () => {
    await expect((await activeEngineFactory()).create({ descriptor: DESC, network: 'bitcoin' })).rejects.toThrow(NO_WALLET_LIBRARY);
  });
});

describe('the known-answer listeners', () => {
  it('hear the answer once it is known, whoever ran it, and a listener that throws breaks nothing', async () => {
    const { native } = linkedLibrary();
    configureEngine({ native });
    const heard: KnownAnswerState[] = [];
    onKnownAnswer(() => {
      throw new Error('listener');
    });
    const off = onKnownAnswer((k) => heard.push(k));
    await (await activeEngineFactory()).create({ descriptor: DESC, network: 'bitcoin' });
    expect(heard).toEqual([{ state: 'passed', vectors: 4 }]);
    off();
    expect(await ensureKnownAnswer()).toEqual({ state: 'passed', vectors: 4 });
    expect(heard).toHaveLength(1);
  });

  it('are told which vault\'s open ran the test (the report files a failure under its shape), and only that one', async () => {
    const { native } = linkedLibrary({ knownAnswer: { passed: false, vectors: 4 } });
    configureEngine({ native });
    const heard: Array<[string, string | null]> = [];
    onKnownAnswer((k, ranFor) => heard.push([k.state, ranFor]));
    const factory = await activeEngineFactory();
    await expect(factory.create({ descriptor: DESC, network: 'bitcoin' })).rejects.toThrow(LIBRARY_CHECK_FAILED);
    await expect(factory.create({ descriptor: 'wpkh(other)', network: 'bitcoin' })).rejects.toThrow(LIBRARY_CHECK_FAILED);
    expect(heard).toEqual([['failed', DESC]]);
  });

  it('a test run with no vault named tells them null', async () => {
    const { native } = linkedLibrary();
    configureEngine({ native });
    const heard: Array<string | null> = [];
    onKnownAnswer((_k, ranFor) => heard.push(ranFor));
    await ensureKnownAnswer();
    expect(heard).toEqual([null]);
  });
});

describe('the signing rounds', () => {
  it('are copied in the phone app on testnet only; the engine is the library\'s either way', async () => {
    const { native } = linkedLibrary();
    configureEngine({ native });
    mockFlavour = 'full';
    const testnet = await (await activeEngineFactory()).create({ descriptor: DESC, network: 'testnet' });
    expect(testnet).not.toBeInstanceOf(BdkWalletEngineV3);
    expect(testnet.network).toBe('testnet');
    const mainnet = await (await activeEngineFactory()).create({ descriptor: DESC, network: 'bitcoin' });
    expect(mainnet).toBeInstanceOf(BdkWalletEngineV3);
    mockFlavour = 'signing';
    expect(await (await activeEngineFactory()).create({ descriptor: DESC, network: 'testnet' })).toBeInstanceOf(BdkWalletEngineV3);
  });
});

describe('the connection test', () => {
  it('goes through the library, needs no known answer, and keeps its answer', async () => {
    const { native, calls } = linkedLibrary();
    configureEngine({ native });
    const heard: unknown[] = [];
    const off = onConnectionAnswer((a) => heard.push(a));
    await expect(testBackendConnection(backend)).resolves.toBe(77);
    off();
    expect(calls).toEqual(['probeServer']);
    expect(lastConnectionAnswer()).toMatchObject({ height: 77, error: null });
    expect(heard).toHaveLength(1);
  });

  it('a refusal is kept with its words and thrown at the caller', async () => {
    const refusal = new Error('Electrum client error: certificate');
    const { native } = linkedLibrary({ probeServer: refusal });
    configureEngine({ native });
    onConnectionAnswer(() => {
      throw new Error('listener');
    });
    await expect(testBackendConnection(backend)).rejects.toThrow('certificate');
    expect(lastConnectionAnswer()).toMatchObject({ height: null, error: expect.stringContaining('certificate') });
  });

  it('the app imports the provider\'s connection test', () => {
    const index = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(index).toMatch(/testBackendConnection,\n\} from '\.\/engineProvider';/);
    const network = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'ui', 'screens', 'NetworkSettingsScreen.tsx'), 'utf8');
    expect(network).toMatch(/import \{ testBackendConnection \} from '\.\.\/\.\.\/bitcoin\/engine';/);
  });
});

describe('no screen starts the library (decided 2026-10-22)', () => {
  /** Every source file under src/ui. */
  const uiFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === '__tests__' ? [] : uiFiles(p);
      return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });

  it('src/ui never runs the known-answer test or calls the library; Diagnostics only listens', () => {
    const files = uiFiles(path.join(__dirname, '../../../ui'));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => /ensureKnownAnswer|\.knownAnswer\(|nativeBdkWallet|bdkWalletModule/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
    const diagnostics = fs.readFileSync(path.join(__dirname, '../../../ui/screens/DiagnosticsScreen.tsx'), 'utf8');
    expect(diagnostics).toContain('onKnownAnswer(');
  });
});
