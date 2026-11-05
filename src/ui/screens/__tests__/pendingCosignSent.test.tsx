/**
 * Pending transactions, mounted (decided 2026-10-19): once a co-signed spend
 * is on the network its Sent page shows AT ONCE, for one transaction (Send)
 * and for a refresh session (Refresh all coins), whatever the bookkeeping
 * after it does. The rescue screen held its spinner on a report to 21st
 * Capital whose reply never came (2026-10-19); this screen had the same
 * shape, and its fix was guarded by the order of lines in the source alone.
 *
 * Each step that follows the broadcast is made to never settle in turn: the
 * report's POST, the session, the sealed store's write. The screen's own
 * wiring, the co-sign service (records, report, list, the store's turns) and
 * the chain-server rule are real; the engine, the session, the server
 * (fetch), the sealed store and the page components (plain hosts) are
 * replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockLoadSession = jest.fn(async (): Promise<unknown> => ({ accessToken: 't' }));
const mockWallets: { value: Record<string, unknown> } = { value: {} };
/** The sealed store: a map, and writes that can be held. */
const mockSealed = { map: new Map<string, string>(), holdWrites: false, held: [] as Array<() => void> };

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  TouchableOpacity: 'TouchableOpacity',
}));
jest.mock('../../navigation/landOverTab', () => ({ landOverTab: jest.fn() }));
jest.mock('../../components', () => {
  const R = require('react');
  const host =
    (name: string) =>
    ({ children, ...p }: { children?: React.ReactNode }) =>
      R.createElement(name, p, children);
  return {
    Screen: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) =>
      R.createElement('Screen', null, children, footer),
    StepTransition: ({ children }: { children: React.ReactNode }) => R.createElement('StepTransition', null, children),
    Card: host('Card'),
    Button: (p: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean }) =>
      R.createElement('Button', { title: p.title, onPress: p.onPress, loading: !!p.loading, disabled: !!p.disabled }),
    AppDialog: (p: { title: string; message: string }) => R.createElement('AppDialog', { title: p.title, message: p.message }),
    ChevronRightIcon: 'ChevronRightIcon',
    FitText: host('Text'),
    SentCard: host('SentCard'),
    SentPage: (p: { wallet: { id: string }; facts: { txids: string[] } }) =>
      R.createElement('SentPage', { walletId: p.wallet.id, txids: p.facts.txids }),
    FAILURES_TITLE: 'Could not send',
    batchSentWords: (count: number) => ({ title: `${count} sent` }),
    mergeSentFacts: (list: Array<{ txids: string[] }>) =>
      list.length === 0 ? null : { ...list[0], txids: list.flatMap((f) => f.txids) },
    sentFailureRows: () => [],
    sentWords: () => ({}),
  };
});
jest.mock('../../components/SpendReview', () => ({ SpendReview: () => null }));
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../hooks/useWatchWhileWaiting', () => ({ useWatchWhileWaiting: () => undefined }));
jest.mock('../../../wallet', () => ({
  useWallets: () => mockWallets.value,
  broadcastThroughChainServers: jest.requireActual('../../../wallet/chainServers').broadcastThroughChainServers,
  formatBtc: (s: number) => `${s / 1e8} BTC`,
  formatSats: (s: number) => `${s} sats`,
  ownKeysLeftToSign: () => [],
  plannedReplacement: async () => null,
  recordIfReplacement: async () => ({ siblings: [] }),
  replacementBroadcastFailure: () => 'other',
  replacementSendCheck: async () => 'ok',
  returnedPayment: async () => null,
  saveSentAt: async () => undefined,
}));
jest.mock('../../../wallet/sendTooEarly', () => ({ sendTooEarly: async () => null, tooEarlyTitle: () => '' }));
jest.mock('../../../bitcoin/psbt', () => ({
  parsePsbt: () => {
    throw new Error('not a real PSBT in this test');
  },
  psbtAbsurdFee: () => null,
  psbtSignatureStatus: () => ({ signedFingerprints: [] }),
}));
jest.mock('../../../wallet/ownOutputs', () => ({ ownOutputIndices: async () => [] }));
jest.mock('../../../wallet/signingProgress', () => ({
  parkedProgress: () => ({ complete: false, signatures: 1, needed: 2 }),
}));
jest.mock('../../../platform/notifications', () => ({ notifyCosignOutcome: async () => undefined }));
jest.mock('../../../platform/files', () => ({ shareText: async () => undefined }));
jest.mock('../../../services/providerKeys', () => ({ fetchKnown21CFingerprints: async () => new Set<string>() }));
jest.mock('../../../services/companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  authHeaders: () => ({ Authorization: 'Bearer t' }),
  loadSession: () => mockLoadSession(),
}));
jest.mock('../../../wallet/sealedStore', () => ({
  sealedGetItem: async (k: string) => mockSealed.map.get(k) ?? null,
  sealedSetItem: (k: string, v: string) =>
    mockSealed.holdWrites
      ? new Promise<void>((resolve) => mockSealed.held.push(resolve))
      : Promise.resolve(void mockSealed.map.set(k, v)),
}));

import { PendingCosignScreen } from '../PendingCosignScreen';
import { COMPLETE_COSIGN_MS, loadPendingCosigns, savePendingCosign, type PendingCosign } from '../../../services/cosign';
import { __forgetGoodServersForTests, NO_TESTNET4_SERVER_ANSWERED } from '../../../wallet/chainServers';
import { TESTNET4_ELECTRUM_SERVERS } from '../../../bitcoin/network';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;
const hang = <T,>(): Promise<T> => new Promise<T>(() => {});
const txidOf = (n: number) => String(n).repeat(64).slice(0, 64);

/** What the server does, per test. */
const world = {
  /** The report that a coin went out: answers, or never. */
  complete: 200 as number | 'hang',
  completeCalls: [] as string[],
  /** The server's rows, by id. */
  rows: [] as Array<Record<string, unknown>>,
};

const engine = {
  network: 'testnet',
  completePsbt: jest.fn(async (signed: string) => ({ finalized: true, psbtBase64: `final-${signed}` })),
  broadcastPsbt: jest.fn(async (psbt: string) => txidOf(Number(psbt.replace(/\D/g, '')) || 9)),
};
const syncWallet = jest.fn(async (): Promise<unknown> => engine);
const wallet = { id: 'w1', label: 'Twopaths test', network: 'testnet', descriptor: 'tr(xpub/0/*)' };

function serve() {
  global.fetch = jest.fn((url: string) => {
    const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    if (url.endsWith('/cosign/mine/')) return json(world.rows);
    const done = /\/cosign\/requests\/([^/]+)\/complete\/$/.exec(url);
    if (done) {
      world.completeCalls.push(done[1]);
      if (world.complete === 'hang') return hang();
      return json({ status: 'completed' }, world.complete);
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
}
const realFetch = global.fetch;
afterAll(() => {
  global.fetch = realFetch;
});

/** A co-signed request on the phone and on the server. */
async function cosigned(id: string, n: number, extra: Partial<PendingCosign> = {}) {
  await savePendingCosign({
    id,
    walletId: 'w1',
    originalPsbt: `psbt-${n}`,
    amountSats: 10_000 * n,
    destination: 'tb1qdestination0000000000000000000000000',
    createdAt: Date.now(),
    txid: `${n}`.repeat(64),
    ...extra,
  });
  world.rows.push({
    id,
    amount_sats: 10_000 * n,
    destination: '',
    status: 'signed',
    signed_psbt: `signed-${n}`,
    batch_id: extra.batchId ?? null,
    created_at: new Date().toISOString(),
    signed_at: new Date().toISOString(),
  });
}

const mounted: Renderer[] = [];
const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

async function mount(): Promise<Renderer> {
  let r!: Renderer;
  const navigation = { addListener: jest.fn(() => () => {}), navigate: jest.fn(), goBack: jest.fn() };
  await act(async () => {
    r = TestRenderer.create(
      <PendingCosignScreen {...({ navigation, route: { params: {} } } as unknown as React.ComponentProps<typeof PendingCosignScreen>)} />,
    );
  });
  mounted.push(r);
  await advance(10);
  return r;
}

const buttons = (r: Renderer, title: string | RegExp) =>
  r.root.findAll(
    (n) => (n.type as unknown) === 'Button' && (typeof title === 'string' ? n.props.title === title : title.test(n.props.title)),
  );
const touchables = (r: Renderer) => r.root.findAll((n) => (n.type as unknown) === 'TouchableOpacity');
const sentPage = (r: Renderer) => r.root.findAll((n) => (n.type as unknown) === 'SentPage')[0];
const spinning = (r: Renderer) => r.root.findAll((n) => (n.type as unknown) === 'Button' && n.props.loading === true);
const press = (onPress: () => void) =>
  act(async () => {
    onPress();
  });

/** The one co-signed spend opened, its Send pressed. */
async function sendOne(r: Renderer) {
  await press(touchables(r)[0].props.onPress);
  const send = buttons(r, 'Send')[0];
  expect(send.props.loading).toBe(false);
  await press(send.props.onPress);
}

/** The refresh session opened, Refresh all coins pressed, the coins sent 3 s apart. */
async function refreshAll(r: Renderer, coins: number) {
  await press(touchables(r)[0].props.onPress);
  await press(buttons(r, 'Refresh all coins')[0].props.onPress);
  await advance(3_000 * (coins - 1) + 50);
}

beforeEach(() => {
  jest.useFakeTimers();
  __forgetGoodServersForTests();
  mockSealed.map.clear();
  mockSealed.holdWrites = false;
  Object.assign(world, { complete: 200, completeCalls: [], rows: [] });
  engine.completePsbt.mockClear();
  engine.broadcastPsbt.mockClear();
  syncWallet.mockReset();
  syncWallet.mockImplementation(async () => engine);
  mockLoadSession.mockReset();
  mockLoadSession.mockImplementation(async () => ({ accessToken: 't' }));
  mockWallets.value = {
    getWallet: (id: string) => (id === 'w1' ? wallet : undefined),
    getEngine: async () => engine,
    syncWallet,
    settings: { electrumUrls: {}, unit: 'btc' },
  };
  serve();
});

afterEach(async () => {
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount();
  });
  mockSealed.holdWrites = false;
  for (const release of mockSealed.held.splice(0)) release();
  jest.useRealTimers();
});

describe('Send: one co-signed spend', () => {
  beforeEach(async () => {
    await cosigned('c1', 1);
  });

  it('every call answering: the Sent page, the coin reported and its record gone', async () => {
    const r = await mount();
    await sendOne(r);
    await advance(50);
    expect(sentPage(r).props.txids).toEqual([txidOf(1)]);
    expect(spinning(r)).toEqual([]);
    expect(world.completeCalls).toEqual(['c1']);
    expect(await loadPendingCosigns()).toEqual([]);
  });

  it('the report’s reply never comes: the Sent page at once', async () => {
    world.complete = 'hang';
    const r = await mount();
    await sendOne(r);
    await advance(50);
    expect(sentPage(r).props.txids).toEqual([txidOf(1)]);
    expect(spinning(r)).toEqual([]);
    expect(world.completeCalls).toEqual(['c1']);
    // The record went before the report, and the report gives up in its bound.
    expect(await loadPendingCosigns()).toEqual([]);
    await advance(COMPLETE_COSIGN_MS);
    expect(sentPage(r)).toBeDefined();
  });

  it('the session never loads after the broadcast: the Sent page at once', async () => {
    const r = await mount();
    mockLoadSession.mockImplementation(() => hang());
    await sendOne(r);
    await advance(50);
    expect(sentPage(r).props.txids).toEqual([txidOf(1)]);
    expect(spinning(r)).toEqual([]);
  });

  it('the sealed store’s write never answers: the Sent page at once', async () => {
    const r = await mount();
    mockSealed.holdWrites = true;
    await sendOne(r);
    await advance(50);
    expect(sentPage(r).props.txids).toEqual([txidOf(1)]);
    expect(spinning(r)).toEqual([]);
  });
});

describe('a broadcast that reached no server (decided 2026-10-30)', () => {
  const refused = () => Object.assign(new Error('Electrum client error: unexpected end of file'), { code: 'SERVER_UNREACHABLE' });
  const dialog = (r: Renderer) => r.root.findAll((n) => (n.type as unknown) === 'AppDialog')[0];

  beforeEach(() => {
    __forgetGoodServersForTests();
  });

  it('one spend, a Bitcoin vault\'s one server: a title in plain words, no library text', async () => {
    mockWallets.value = { ...mockWallets.value, getWallet: () => ({ ...wallet, network: 'bitcoin' }) };
    await cosigned('c1', 1);
    engine.broadcastPsbt.mockImplementationOnce(async () => {
      throw refused();
    });
    const r = await mount();
    await sendOne(r);
    await advance(10);
    expect(dialog(r).props).toMatchObject({ title: 'Could not reach the server', message: '' });
    expect(sentPage(r)).toBeUndefined();
  });

  it('one spend, every Testnet4 server: that network\'s own sentence as the title', async () => {
    await cosigned('c1', 1);
    TESTNET4_ELECTRUM_SERVERS.forEach(() =>
      engine.broadcastPsbt.mockImplementationOnce(async () => {
        throw refused();
      }),
    );
    const r = await mount();
    await sendOne(r);
    await advance(10);
    expect(dialog(r).props).toMatchObject({ title: NO_TESTNET4_SERVER_ANSWERED, message: '' });
  });

  it('a refusal from a server still shows what the server said', async () => {
    await cosigned('c1', 1);
    engine.broadcastPsbt.mockImplementationOnce(async () => {
      throw new Error('Electrum server error: "mandatory-script-verify-flag-failed"');
    });
    const r = await mount();
    await sendOne(r);
    await advance(10);
    expect(dialog(r).props).toMatchObject({
      title: 'Could not send',
      message: 'Electrum server error: "mandatory-script-verify-flag-failed"',
    });
  });
});

describe('Refresh all coins: a refresh session', () => {
  beforeEach(async () => {
    await cosigned('b1-1', 1, { batchId: 'b1', batchTotal: 3 });
    await cosigned('b1-2', 2, { batchId: 'b1', batchTotal: 3 });
    await cosigned('b1-3', 3, { batchId: 'b1', batchTotal: 3 });
  });

  it('every call answering: the Sent page, each coin reported, every record gone', async () => {
    const r = await mount();
    await refreshAll(r, 3);
    expect([...sentPage(r).props.txids].sort()).toEqual([txidOf(1), txidOf(2), txidOf(3)]);
    expect(spinning(r)).toEqual([]);
    await advance(50);
    expect(world.completeCalls.sort()).toEqual(['b1-1', 'b1-2', 'b1-3']);
    expect(await loadPendingCosigns()).toEqual([]);
  });

  it('the reports’ replies never come: every coin goes, the Sent page once the last is out', async () => {
    world.complete = 'hang';
    const r = await mount();
    await refreshAll(r, 3);
    expect(engine.broadcastPsbt).toHaveBeenCalledTimes(3);
    expect([...sentPage(r).props.txids].sort()).toEqual([txidOf(1), txidOf(2), txidOf(3)]);
    expect(spinning(r)).toEqual([]);
  });

  it('the session never loads (a stuck token refresh): every coin still goes, and its Sent page', async () => {
    const r = await mount();
    mockLoadSession.mockImplementation(() => hang());
    await refreshAll(r, 3);
    expect(engine.broadcastPsbt).toHaveBeenCalledTimes(3);
    expect([...sentPage(r).props.txids].sort()).toEqual([txidOf(1), txidOf(2), txidOf(3)]);
    expect(spinning(r)).toEqual([]);
    // Behind the page, the records still go once the session gives up.
    await advance(COMPLETE_COSIGN_MS + 50);
    expect(await loadPendingCosigns()).toEqual([]);
  });

  it('the sealed store’s write never answers: every coin goes, and its Sent page', async () => {
    const r = await mount();
    mockSealed.holdWrites = true;
    await refreshAll(r, 3);
    expect(engine.broadcastPsbt).toHaveBeenCalledTimes(3);
    expect([...sentPage(r).props.txids].sort()).toEqual([txidOf(1), txidOf(2), txidOf(3)]);
    expect(spinning(r)).toEqual([]);
  });
});
