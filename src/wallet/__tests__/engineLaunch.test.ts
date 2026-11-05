/**
 * What the launch sets up (App.tsx) with one engine, since the old engine's
 * removal (decided 2026-11-04): the wallet library's module handed to
 * the engine provider on iOS and none elsewhere, the removed features'
 * records deleted, and in the engine report of Talia Test and TestFlight
 * every connection test and a failed known-answer test. Nothing is written
 * to the report at start (no engine choice to note), no shadow or
 * report-only check is set up, and the App Store app writes and sends
 * nothing.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

import { buildOf, emptyEngineReport, KNOWN_ANSWER_FIELD, reportProblems } from '../engineReport';
import type { EngineReport, ReportApp } from '../engineReport';

const mockFlavour = { value: 'full' as 'full' | 'signing' | 'store' };
const mockOs = { value: 'ios' };
const APP: ReportApp = { version: '1.1.9', build: '24', flavour: 'full' };
let mockReport: EngineReport = emptyEngineReport(APP, new Date('2026-10-28T09:00:00Z'));
const mockUpdate = jest.fn(async (change: (r: EngineReport, app: ReportApp) => EngineReport) => {
  mockReport = change(mockReport, APP);
  return mockReport;
});
const mockKnown = { passed: true };
const mockNative = {
  knownAnswer: async () => ({ passed: mockKnown.passed, vectors: 4 }),
  openWallet: async () => 'w1',
  probeServer: async () => ({ height: 903_117 }),
};

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockOs.value;
    },
  },
}));
jest.mock('../../config', () => {
  const actual = jest.requireActual('../../config');
  return {
    ...actual,
    get BUILD_FLAVOUR() {
      return mockFlavour.value;
    },
  };
});
jest.mock('../../platform/bdkWalletModule', () => ({ nativeBdkWallet: () => mockNative }));
jest.mock('../../platform/engineReportFile', () => ({
  updateEngineReport: (change: (r: EngineReport, app: ReportApp) => EngineReport) => mockUpdate(change),
}));

import { configureEngineLaunch, resetEngineLaunchForTests } from '../engineLaunch';
import {
  activeEngineFactory,
  ensureKnownAnswer,
  LIBRARY_CHECK_FAILED,
  resetEngineForTests,
  testBackendConnection,
} from '../../bitcoin/engine/engineProvider';
import { __clear, __store } from '../../testing/memoryAsyncStorage';
import { RETIRED_ENGINE_RECORDS } from '../retiredEngineRecords';
import { SPARROW_SINGLE_SIG } from '../../bitcoin/descriptor/__fixtures__/descriptors';

const settle = () => new Promise((r) => setImmediate(r));
const backend = { type: 'electrum' as const, url: 'ssl://probe.example.org:50002', validateDomain: true };

beforeEach(() => {
  resetEngineLaunchForTests();
  resetEngineForTests();
  mockUpdate.mockClear();
  mockReport = emptyEngineReport(APP, new Date('2026-10-28T09:00:00Z'));
  mockFlavour.value = 'full';
  mockOs.value = 'ios';
  mockKnown.passed = true;
  __clear();
});

describe('the launch', () => {
  it.each(['full', 'signing', 'store'] as const)('%s: hands the provider the library on iOS and writes nothing at start', async (flavour) => {
    mockFlavour.value = flavour;
    configureEngineLaunch();
    configureEngineLaunch(); // App.tsx runs once; a second call changes nothing
    await settle();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(await ensureKnownAnswer()).toEqual({ state: 'passed', vectors: 4 });
  });

  it('anything but iOS gets no library (Talia ships for iPhone only, decided 2026-11-04)', async () => {
    mockOs.value = 'android';
    configureEngineLaunch();
    expect(await ensureKnownAnswer()).toEqual({ state: 'missing' });
  });

  it.each(['full', 'signing'] as const)('%s: notes every connection test in the report, answered by v3', async (flavour) => {
    mockFlavour.value = flavour;
    configureEngineLaunch();
    await testBackendConnection(backend);
    await settle();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const b = buildOf(mockReport, APP)!;
    expect(b.engine).toBeNull();
    expect(b.connectionTests).toHaveLength(1);
    expect(b.connectionTests[0]).toMatchObject({ engine: 'v3', ok: true });
    expect(reportProblems(mockReport)).toEqual([]);
  });

  it('the App Store app writes nothing, not even a connection test', async () => {
    mockFlavour.value = 'store';
    configureEngineLaunch();
    await testBackendConnection(backend);
    await settle();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a report that cannot be written never breaks the launch or the test', async () => {
    mockFlavour.value = 'signing';
    mockUpdate.mockRejectedValueOnce(new Error('disk full'));
    expect(() => configureEngineLaunch()).not.toThrow();
    await expect(testBackendConnection(backend)).resolves.toBe(903_117);
    await settle();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('a failed known-answer test is counted (decided 2026-11-04)', () => {
  const open = async () => (await activeEngineFactory()).create({ descriptor: SPARROW_SINGLE_SIG, network: 'testnet' });

  it.each(['full', 'signing'] as const)('%s: once a launch, under the shape of the vault whose open ran it', async (flavour) => {
    mockFlavour.value = flavour;
    mockKnown.passed = false;
    configureEngineLaunch();
    await expect(open()).rejects.toThrow(LIBRARY_CHECK_FAILED);
    await expect(open()).rejects.toThrow(LIBRARY_CHECK_FAILED);
    await settle();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const s = buildOf(mockReport, APP)!.sections.preflight;
    expect(s.byField).toEqual({ [KNOWN_ANSWER_FIELD]: 1 });
    expect(s.byOutcome).toEqual({ error: 1 });
    expect(s.byShape).toEqual({ wpkh: { error: 1 } });
    // Counts and fixed words: nothing of the vault but its shape.
    expect(JSON.stringify(mockReport)).not.toContain('tpub');
    expect(reportProblems(mockReport)).toEqual([]);
  });

  it('a test that passed is not counted', async () => {
    configureEngineLaunch();
    await open();
    await settle();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('the App Store app keeps no report, so nothing is written', async () => {
    mockFlavour.value = 'store';
    mockKnown.passed = false;
    configureEngineLaunch();
    await expect(open()).rejects.toThrow(LIBRARY_CHECK_FAILED);
    await settle();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('the removed features\' records are deleted at launch (decided 2026-11-04)', () => {
  it.each(['full', 'signing', 'store'] as const)('%s: every one of them, and nothing else', async (flavour) => {
    mockFlavour.value = flavour;
    const retired = [
      ...RETIRED_ENGINE_RECORDS,
      'keel.reportOnlyGuard.v1.store',
      'keel.reportOnlyOff.v1.signing',
      'talia.reportOnly.checked.v1.store',
      'talia.reportOnly.checked.v1.signing',
      'talia.reportOnly.checked.v1.store.unreadable.2',
    ];
    const kept = ['keel.wallets.v1', 'keel.settings.v2', 'keel.engineReport.install.v1', 'talia.addressCheck.proven.v1'];
    for (const k of [...retired, ...kept]) __store.set(k, 'x');
    configureEngineLaunch();
    await settle();
    expect([...__store.keys()].sort()).toEqual([...kept].sort());
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
