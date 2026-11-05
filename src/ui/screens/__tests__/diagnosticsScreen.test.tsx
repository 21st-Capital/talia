/**
 * Settings > Diagnostics, mounted (BDK upgrade, decided 2026-10-15; one
 * engine since the old engine's removal, decided 2026-11-04): the wallet library's launch
 * check, the connection test, "Share report", and, in the phone app only,
 * this build's address checks and their mismatches and "Export signing round". No
 * engine line and no engine switches: there is no engine to choose.
 *
 * The screen's own wiring is real: the engine provider, its known-answer
 * test and its connection test, and the signing rounds. What touches the
 * phone is replaced: storage, the files and the share sheet, and the app's
 * page and button components (plain hosts here).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockShareReport = jest.fn(async () => undefined);
const mockStoredReport: { value: unknown } = { value: { builds: [] } };
const mockExportText = jest.fn(async (_name: string, _text: string) => undefined);
const mockFlavour = { value: 'full' };

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  Switch: 'Switch',
}));
jest.mock('../../../config', () => {
  const actual = jest.requireActual('../../../config');
  return {
    ...actual,
    get BUILD_FLAVOUR() {
      return mockFlavour.value;
    },
  };
});
jest.mock('../../components', () => {
  const R = require('react');
  return {
    Screen: ({ children }: { children: React.ReactNode }) => R.createElement('Screen', null, children),
    Card: ({ children }: { children: React.ReactNode }) => R.createElement('Card', null, children),
    Button: (p: { title: string; onPress: () => void; disabled?: boolean }) =>
      R.createElement('Button', { title: p.title, onPress: p.onPress, disabled: !!p.disabled }),
  };
});
jest.mock('../../../wallet', () => ({
  useWallets: () => ({ settings: { defaultNetwork: 'testnet', electrumUrls: {} } }),
  backendFor: (network: string) => ({ type: 'electrum', url: `ssl://${network}.example:50002`, validateDomain: true }),
}));
jest.mock('../../../platform/engineReportFile', () => ({
  REPORT_APP: { version: '1.1.7', build: '22', flavour: 'full' },
  shareEngineReport: () => mockShareReport(),
  readEngineReport: async () => mockStoredReport.value,
  reportApp: async () => ({ version: '1.1.9', build: '24', flavour: 'full', since: '2026-10-28T08:00:00.000Z' }),
}));
jest.mock('../../../platform/files', () => ({
  exportTextToFile: (name: string, text: string) => mockExportText(name, text),
}));

import { DiagnosticsScreen } from '../DiagnosticsScreen';
import { capturingEngine, clearSigningRounds } from '../../../bitcoin/engine/signingRounds';
import { configureEngine, ensureKnownAnswer, resetEngineForTests } from '../../../bitcoin/engine/engineProvider';
import type { BdkWalletNative } from '../../../bitcoin/engine/bdkWalletNative';
import type { WalletEngine } from '../../../bitcoin/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;

/** Let every promise the page started settle, inside act. */
const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });

const mounted: Renderer[] = [];

async function mount(): Promise<Renderer> {
  let r!: Renderer;
  await act(async () => {
    r = TestRenderer.create(<DiagnosticsScreen {...({} as React.ComponentProps<typeof DiagnosticsScreen>)} />);
  });
  mounted.push(r);
  await settle();
  return r;
}

// A page left mounted would still hear the next test's answers and rounds.
afterEach(async () => {
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount();
  });
});

/** Every string the page shows, in order. */
function words(r: Renderer): string[] {
  return r.root
    .findAll((n) => (n.type as unknown) === 'Text')
    .map((n) => [n.props.children].flat().join(''));
}

const button = (r: Renderer, title: string) => r.root.find((n) => (n.type as unknown) === 'Button' && n.props.title === title);

/** The library's module as a build that links it hands it in. */
const probeAnswers = jest.fn(async (_id: string, _server: unknown) => ({ height: 903_117 }));
const library = (knownAnswer = { passed: true, vectors: 4 }): BdkWalletNative =>
  ({
    knownAnswer: async () => knownAnswer,
    probeServer: (server: unknown) => probeAnswers('probe', server),
  }) as unknown as BdkWalletNative;

beforeEach(() => {
  resetEngineForTests();
  clearSigningRounds();
  mockFlavour.value = 'full';
  mockStoredReport.value = { builds: [] };
  probeAnswers.mockClear();
  for (const m of [mockShareReport, mockExportText]) m.mockClear();
});

describe('Diagnostics', () => {
  it('shows the library check as the first vault ran it, and never runs it itself', async () => {
    const native = library();
    const asked = jest.spyOn(native, 'knownAnswer');
    configureEngine({ native });
    const r0 = await mount();
    let shown = words(r0);
    expect(shown.slice(0, 3)).toEqual(['Wallet library', 'Library check', 'Not run yet']);
    expect(asked).not.toHaveBeenCalled();
    await act(async () => {
      await ensureKnownAnswer();
    });
    shown = words(r0);
    expect(shown[shown.indexOf('Library check') + 1]).toBe('Passed');
    for (const gone of ['Wallet engine', 'Engine', 'On this phone', 'Use the previous engine', 'Shadow checks off', 'Answered by', 'Fallbacks to v028', 'Preflight mismatches']) {
      expect(shown).not.toContain(gone);
    }
    expect(r0.root.findAll((n) => (n.type as unknown) === 'Switch')).toEqual([]);
  });

  it('a failed library check says no vault opens', async () => {
    configureEngine({ native: library({ passed: false, vectors: 4 }) });
    expect((await ensureKnownAnswer()).state).toBe('failed');
    const r = await mount();
    const shown = words(r);
    expect(shown[shown.indexOf('Library check') + 1]).toBe('Failed');
    expect(shown).toContain('No vault opens until the app opens again and the check passes.');
  });

  it('a build without the library says so', async () => {
    configureEngine({});
    await ensureKnownAnswer();
    const r = await mount();
    const shown = words(r);
    expect(shown[shown.indexOf('Library check') + 1]).toBe('Not in this build');
  });

  it('the connection test goes through the provider and shows its answer', async () => {
    configureEngine({ native: library() });
    const r = await mount();
    expect(words(r)).toEqual(expect.arrayContaining(['Connection test', 'Not tested since the app opened.']));
    await act(async () => button(r, 'Test the connection').props.onPress());
    await settle();
    expect(probeAnswers).toHaveBeenCalledTimes(1);
    expect(words(r).some((w) => w.startsWith('Block 903,117 · '))).toBe(true);
  });

  it("shows this build's address checks and their mismatches, from the report", async () => {
    const r0 = await mount();
    const empty = words(r0);
    expect(empty.slice(empty.indexOf('Address checks'), empty.indexOf('Address checks') + 4)).toEqual([
      'Address checks',
      '0',
      'Address check mismatches',
      '0',
    ]);
    const { emptyEngineReport, withCount } = jest.requireActual('../../../wallet/engineReport');
    const app = { version: '1.1.9', build: '24', flavour: 'full', since: '2026-10-28T08:00:00.000Z' };
    const other = { ...app, since: '2026-10-20T08:00:00.000Z' };
    const at = new Date('2026-10-28T09:00:00Z');
    let rep = emptyEngineReport(app, at);
    rep = withCount(rep, 'preflight', { shape: 'wpkh', outcome: 'match', field: 'scure.address' }, app, at);
    rep = withCount(rep, 'preflight', { shape: 'wpkh', outcome: 'match', field: 'scure.proven' }, app, at);
    rep = withCount(rep, 'preflight', { shape: 'wpkh', outcome: 'mismatch', field: 'scure.address' }, app, at);
    // A failed known-answer test is no address check.
    rep = withCount(rep, 'preflight', { shape: 'wpkh', outcome: 'error', field: 'library.knownAnswer' }, app, at);
    rep = withCount(rep, 'preflight', { shape: 'tr-timelocked', outcome: 'mismatch', field: 'scure.shown' }, app, at);
    // Another install's counts are not this build's.
    rep = withCount(rep, 'preflight', { shape: 'wpkh', outcome: 'mismatch', field: 'scure.output' }, other, at);
    mockStoredReport.value = rep;
    const r = await mount();
    const shown = words(r);
    const i = shown.indexOf('Address checks');
    expect(shown.slice(i, i + 5)).toEqual([
      'Address checks',
      '4',
      'Address check mismatches',
      '2',
      'Counted since this build was installed.',
    ]);
  });

  it('shares the report', async () => {
    const r = await mount();
    await act(async () => button(r, 'Share report').props.onPress());
    await settle();
    expect(mockShareReport).toHaveBeenCalledTimes(1);
  });

  it('exports the testnet signing rounds in the phone app, once there is one', async () => {
    const r = await mount();
    expect(button(r, 'Export signing round').props.disabled).toBe(true);
    const engine = capturingEngine({
      network: 'testnet',
      completePsbt: async () => ({ finalized: true, psbtBase64: 'cHNidP8f', txid: 'aa'.repeat(32) }),
    } as unknown as WalletEngine);
    await act(async () => {
      await engine.completePsbt('cHNidP8s', 'cHNidP8o');
    });
    expect(words(r)).toContain('1 on testnet since the app opened.');
    await act(async () => button(r, 'Export signing round').props.onPress());
    await settle();
    const [name, text] = mockExportText.mock.calls[0];
    expect(name).toMatch(/^talia-signing-rounds-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(text).rounds).toHaveLength(1);
  });

  it('TestFlight: no checks card and no signing rounds', async () => {
    mockFlavour.value = 'signing';
    const r = await mount();
    const shown = words(r);
    expect(shown).not.toContain('Checks in this build');
    expect(shown).not.toContain('Address checks');
    expect(shown).not.toContain('Address check mismatches');
    expect(shown).not.toContain('Signing rounds');
    expect(r.root.findAll((n) => (n.type as unknown) === 'Button' && n.props.title === 'Export signing round')).toEqual([]);
    expect(shown).toEqual(expect.arrayContaining(['Wallet library', 'Connection test', 'Engine report']));
  });

  it('no em dash anywhere on the page', async () => {
    configureEngine({ native: library({ passed: false, vectors: 4 }) });
    await ensureKnownAnswer();
    const r = await mount();
    for (const w of words(r)) expect(w).not.toMatch(/—/);
  });
});

describe('the Settings row that opens Diagnostics', () => {
  // Named by what the page shows since the old engine's removal (decided 2026-11-04): the page
  // has a "Wallet library" section and no "Wallet engine" one.
  const settings = (jest.requireActual('fs') as typeof import('fs')).readFileSync(
    (jest.requireActual('path') as typeof import('path')).join(__dirname, '..', 'SettingsScreen.tsx'),
    'utf8',
  );

  it('names the wallet library, never the wallet engine', () => {
    expect(settings).toContain('sub="Wallet library, connection test, report"');
    expect(settings).not.toMatch(/"[^"]*Wallet engine[^"]*"/);
  });
});
