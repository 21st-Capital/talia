/**
 * The Rescue screen's "Broadcast rescue", mounted (2026-10-19, a rescue of a
 * two-path testnet4 vault: the broadcast went out, the screen kept spinning
 * and never showed a success message). The staff
 * dashboard read Completed, which only the phone's report sets, so the
 * broadcast had answered and the report had reached the server: the
 * spinner was held by what the screen awaited AFTER the broadcast, server
 * calls with no time limit whose reply never came.
 *
 * Every step after the broadcast is made to never settle here, one at a
 * time, and the Sent page must show at once with the spinner gone. A
 * broadcast that never answers must end in the watchdog's time, on the Sent
 * page when the chain has the rescue and on a Try again dialog when it
 * does not. The screen's own wiring is real, the chain-server rule, the
 * watchdog and the rescue service included; the engine, the session, the
 * server (fetch), storage and the page components (plain hosts) are
 * replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { signedRescueTx } from '../../../testing/signedRescueTx';
import type { WalletTx } from '../../../bitcoin/engine/types';

const mockLoadSession = jest.fn(async (): Promise<unknown> => ({ accessToken: 't', email: 'client@example.com' }));
const mockWallets: { value: Record<string, unknown> } = { value: {} };

jest.mock('react-native', () => ({
  ...require('../../__tests__/rnStub').reactNative,
  ActivityIndicator: 'ActivityIndicator',
  TouchableOpacity: 'TouchableOpacity',
  Linking: { openURL: async () => undefined },
}));
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
    AppDialog: (p: {
      title: string;
      message: string;
      actions: Array<{ label: string; onPress: () => void }>;
      onClose: () => void;
    }) =>
      R.createElement(
        'AppDialog',
        { title: p.title, message: p.message },
        p.actions.map((a) =>
          R.createElement('Button', {
            key: a.label,
            title: a.label,
            onPress: () => {
              p.onClose();
              a.onPress();
            },
          }),
        ),
      ),
    SentPage: (p: { wallet: { id: string }; facts: { txids: string[] }; actions: Array<{ title: string; onPress: () => void }> }) =>
      R.createElement(
        'SentPage',
        { walletId: p.wallet.id, txids: p.facts.txids, facts: p.facts },
        p.actions.map((a) => R.createElement('Button', { key: a.title, title: a.title, onPress: a.onPress })),
      ),
    PageHead: (p: { title: string }) => R.createElement('PageHead', { title: p.title }),
    ConsentCheckbox: host('ConsentCheckbox'),
    ChevronRightIcon: 'ChevronRightIcon',
    AddressChunks: host('AddressChunks'),
    AppModal: () => null,
    InfoHeading: host('InfoHeading'),
    BookingSheet: () => null,
    CodeField: host('CodeField'),
    AuthenticatorStep: host('AuthenticatorStep'),
    FeeSheet: () => null,
    feeSheetStyles: {},
    sentWords: () => ({}),
  };
});
jest.mock('../../components/TablerIcons', () => ({ ParachuteIcon: 'ParachuteIcon' }));
jest.mock('../../../platform/QrScanner', () => ({ QrScanner: () => null }));
jest.mock('../../../platform/clipboard', () => ({ readClipboard: async () => '' }));
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../../wallet', () => ({
  useWallets: () => mockWallets.value,
  formatAmount: (s: number) => `${s / 1e8} BTC`,
  formatBtc: (s: number) => `${s / 1e8} BTC`,
  formatFiat: (s: number) => `$${s}`,
  formatSats: (s: number) => `${s} sats`,
  getBtcPrice: async () => null,
}));
jest.mock('../../../services/companyAuth', () => ({
  COMPANY_API: 'https://backend.example',
  authHeaders: () => ({ Authorization: 'Bearer t' }),
  loadSession: () => mockLoadSession(),
}));
jest.mock('../../../services/settingsApi', () => ({ fetchProfile: async () => ({ twoFactorEnabled: false }) }));
jest.mock('@react-native-async-storage/async-storage', () => require('../../../testing/memoryAsyncStorage'));

import { RescueScreen, NO_ANSWER_TITLE, CHECKING_TITLE } from '../RescueScreen';
import { loadPendingRescues, savePendingRescue, RESCUE_SERVER_MS } from '../../../services/rescue';
import {
  BROADCAST_WATCHDOG_MS,
  NO_TESTNET4_SERVER_ANSWERED,
  TESTNET4_BROADCAST_ATTEMPT_MS,
  __forgetGoodServersForTests,
} from '../../../wallet/chainServers';
import { CHAIN_CHECK_MS } from '../../../wallet/broadcastAnswer';
import { TESTNET4_ELECTRUM_SERVERS } from '../../../bitcoin/network';
import { scriptToAddress } from '../../../bitcoin/psbt/parse';

const storage = require('@react-native-async-storage/async-storage').default as {
  setItem: (k: string, v: string) => Promise<void>;
  __clear: () => void;
};
const realSetItem = storage.setItem;
/** Writes held by a storage that "never answers", let go after the test:
 *  the store's writes take turns (services/storeTurns.ts), and one held
 *  for ever would make the next test's first write wait its turn out. */
const heldWrites: Array<() => void> = [];
const storageNeverAnswers = () => {
  storage.setItem = () => new Promise<void>((resolve) => heldWrites.push(resolve));
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;

const TX = signedRescueTx(9);
const hexBytes = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));
/** Where the client asked the rescue to go when filing it: where TX pays. */
const DEST = scriptToAddress(hexBytes(TX.outScriptHex), 'testnet')!;
/** Another address, which the client never chose. */
const STRANGER = scriptToAddress(hexBytes('5120' + '44'.repeat(32)), 'testnet')!;
const hang = <T,>(): Promise<T> => new Promise<T>(() => {});
/** The vault's record of TX once the chain has it: it took the 380 000
 *  sats coin, paid 370 083 and 9 917 in fee. */
const walletTx = (txid: string): WalletTx => ({
  txid,
  received: 0,
  sent: 380_000,
  netAmount: -380_000,
  fee: 9_917,
  confirmed: false,
  ...world.chainTx,
});

/** What the server and the chain do, per test. */
const world = {
  /** Does the chain list the rescue? */
  onChain: false,
  /** Rescue requests list: answers, or never. */
  mine: 'answer' as 'answer' | 'hang',
  /** The server's status of r1 in that list. */
  status: 'signed' as 'signed' | 'completed',
  /** The report that the rescue went out: answers, or never. */
  complete: 200 as number | 'hang',
  completeCalls: 0,
  /** An older request of another vault, which 21st Capital turned down
   *  and the phone keeps until the client clears it. */
  olderRejected: false,
  /** What the vault's record of TX says, over `walletTx`'s defaults. */
  chainTx: {} as Partial<WalletTx>,
};

const engine = {
  network: 'testnet',
  listUtxos: async () => (world.onChain ? [] : [{ ...TX.spends, valueSats: 380_000, keychain: 'external' }]),
  listTransactions: async () => (world.onChain ? [walletTx(TX.txid)] : []),
  ownsAddress: async () => false,
  getTipHeight: () => 157_034,
  broadcastRescue: jest.fn(async (): Promise<string> => TX.txid),
};
const syncWallet = jest.fn(async (): Promise<unknown> => engine);

const wallet = {
  id: 'w1',
  label: 'Twopaths test',
  network: 'testnet',
  descriptor: 'tr(xpub/0/*)',
  providerKeyFingerprints: [],
};

function serve() {
  global.fetch = jest.fn((url: string) => {
    const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    if (url.endsWith('/rescue/mode/')) return json({ status: 'none' });
    if (url.endsWith('/rescue/mine/')) {
      if (world.mine === 'hang') return hang();
      return json([
        ...(world.olderRejected
          ? [{ id: 'r0', vault_label: 'Savings', destination: '', amount_sats: 1, status: 'rejected', signed_tx: '', created_at: '2026-10-01T09:00:00Z', signed_at: null }]
          : []),
        {
          id: 'r1',
          vault_label: 'Twopaths test',
          destination: '',
          amount_sats: 370_083,
          status: world.status,
          signed_tx: world.status === 'signed' ? TX.rawHex : '',
          created_at: '2026-10-19T14:27:31Z',
          signed_at: '2026-10-19T14:31:00Z',
        },
      ]);
    }
    if (url.endsWith('/requests/r1/complete/')) {
      world.completeCalls += 1;
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

const mounted: Renderer[] = [];

/** Move the (fake) clock, letting every promise it releases settle. */
const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

async function mount(): Promise<Renderer> {
  let r!: Renderer;
  const navigation = { addListener: jest.fn(() => () => {}), goBack: jest.fn(), navigate: jest.fn() };
  await act(async () => {
    r = TestRenderer.create(
      <RescueScreen {...({ navigation, route: { params: {} } } as unknown as React.ComponentProps<typeof RescueScreen>)} />,
    );
  });
  mounted.push(r);
  await advance(10);
  return r;
}

const buttons = (r: Renderer, title: string) =>
  r.root.findAll((n) => (n.type as unknown) === 'Button' && n.props.title === title);
const broadcastButton = (r: Renderer) =>
  r.root.findAll(
    (n) => (n.type as unknown) === 'Button' && /^(Broadcast rescue|Broadcasting…|Checking the network…)$/.test(n.props.title),
  )[0];
const sentPage = (r: Renderer) => r.root.findAll((n) => (n.type as unknown) === 'SentPage')[0];
const dialog = (r: Renderer) => r.root.findAll((n) => (n.type as unknown) === 'AppDialog')[0];
const press = (node: TestRenderer.ReactTestInstance) =>
  act(async () => {
    node.props.onPress();
  });

/** Mounted with the signed request on the list, its spinner off. */
async function readyToBroadcast(): Promise<Renderer> {
  const r = await mount();
  const b = broadcastButton(r);
  expect(b.props.title).toBe('Broadcast rescue');
  expect(b.props.loading).toBe(false);
  return r;
}

/** The Sent page is up, naming the rescue's txid, and no spinner is left. */
function onSentPage(r: Renderer) {
  const page = sentPage(r);
  expect(page).toBeDefined();
  expect(page.props.walletId).toBe('w1');
  expect(page.props.txids).toEqual([TX.txid]);
  expect(r.root.findAll((n) => (n.type as unknown) === 'Button' && n.props.loading === true)).toEqual([]);
  expect(dialog(r)).toBeUndefined();
}

beforeEach(async () => {
  jest.useFakeTimers();
  __forgetGoodServersForTests();
  storage.__clear();
  storage.setItem = realSetItem;
  Object.assign(world, {
    onChain: false,
    mine: 'answer',
    status: 'signed',
    complete: 200,
    completeCalls: 0,
    olderRejected: false,
    chainTx: {},
  });
  engine.broadcastRescue.mockReset();
  engine.broadcastRescue.mockImplementation(async () => TX.txid);
  syncWallet.mockReset();
  syncWallet.mockImplementation(async () => engine);
  mockLoadSession.mockReset();
  mockLoadSession.mockImplementation(async () => ({ accessToken: 't', email: 'client@example.com' }));
  mockWallets.value = {
    wallets: [],
    syncWallet,
    getWallet: (id: string) => (id === 'w1' ? wallet : undefined),
    getEngine: async () => engine,
    settings: { electrumUrls: {} },
  };
  serve();
  await savePendingRescue({ id: 'r1', walletId: 'w1', vaultLabel: 'Twopaths test', createdAt: 1, destination: DEST });
});

afterEach(async () => {
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount();
  });
  storage.setItem = realSetItem;
  for (const release of heldWrites.splice(0)) release();
  jest.useRealTimers();
});

describe('after the broadcast answered, nothing holds the Sent page (the incident)', () => {
  it('the report to 21st Capital is POSTed but its reply never comes: the Sent page at once', async () => {
    world.complete = 'hang';
    const r = await readyToBroadcast();
    await press(broadcastButton(r));
    await advance(50);
    onSentPage(r);
    expect(engine.broadcastRescue).toHaveBeenCalledTimes(1);
    // The report did go out (the server reads Completed), its answer is lost.
    expect(world.completeCalls).toBe(1);
    // The phone's record is marked sent at once, so the request is never
    // offered for broadcast again.
    expect((await loadPendingRescues())[0].sentTxid).toBe(TX.txid);

    // Done: back on the list, and the request is gone from it, although the
    // server, as the phone last heard it, still says signed.
    await press(buttons(r, 'Done')[0]);
    expect(broadcastButton(r)).toBeUndefined();

    // The lost report gives up in its bound; the record stays marked and
    // the next list load tells 21st Capital again, then notes it heard.
    await advance(RESCUE_SERVER_MS);
    expect((await loadPendingRescues()).map((p) => p.sentTxid)).toEqual([TX.txid]);
    world.complete = 200;
    world.status = 'completed';
    await act(async () => {
      // The screen reads the list again on focus.
      const nav = (r.root.findByType(RescueScreen).props as { navigation: { addListener: jest.Mock } }).navigation;
      const focus = nav.addListener.mock.calls.filter((c) => c[0] === 'focus').map((c) => c[1] as () => void);
      focus.forEach((f) => f());
    });
    await advance(50);
    expect(world.completeCalls).toBeGreaterThanOrEqual(2);
    expect((await loadPendingRescues()).map((p) => p.reported)).toEqual([true]);
    expect(broadcastButton(r)).toBeUndefined();
  });

  it('the session never loads after the broadcast (a stuck token refresh): the Sent page at once', async () => {
    const r = await readyToBroadcast();
    mockLoadSession.mockImplementation(() => hang());
    await press(broadcastButton(r));
    await advance(50);
    onSentPage(r);
    // Bounded behind the page: the record is marked and kept for the next try.
    await advance(RESCUE_SERVER_MS * 2);
    expect((await loadPendingRescues())[0].sentTxid).toBe(TX.txid);
  });

  it('the list of requests never answers after the broadcast: the Sent page at once', async () => {
    // With another request still on the phone, reading the list again
    // asks the server (with none, the list is simply empty).
    world.olderRejected = true;
    await savePendingRescue({ id: 'r0', walletId: 'w0', vaultLabel: 'Savings', createdAt: 0 });
    const r = await readyToBroadcast();
    world.mine = 'hang';
    await press(broadcastButton(r));
    await advance(50);
    onSentPage(r);
    await press(buttons(r, 'Done')[0]);
    expect(broadcastButton(r)).toBeUndefined();
    // The report landed; the list stays as the phone knows it until the
    // server answers, the turned-down request included, and the rescue's
    // record stays while it waits for a block.
    expect((await loadPendingRescues()).map((p) => p.id).sort()).toEqual(['r0', 'r1']);
  });

  it('the phone’s own storage never answers after the broadcast: the Sent page at once', async () => {
    const r = await readyToBroadcast();
    storageNeverAnswers();
    await press(broadcastButton(r));
    await advance(50);
    onSentPage(r);
    await press(buttons(r, 'Done')[0]);
    // Kept off the list by the screen itself while the record cannot be written.
    expect(broadcastButton(r)).toBeUndefined();
  });

  it('the sync that follows never ends: the Sent page at once', async () => {
    const r = await readyToBroadcast();
    syncWallet.mockImplementationOnce(async () => engine).mockImplementation(() => hang());
    await press(broadcastButton(r));
    await advance(50);
    onSentPage(r);
  });

  it('with every server call answering, the request is reported and gone from the list, and its record kept while it waits for a block', async () => {
    const r = await readyToBroadcast();
    await press(broadcastButton(r));
    await advance(50);
    onSentPage(r);
    expect(world.completeCalls).toBe(1);
    expect(await loadPendingRescues()).toEqual([expect.objectContaining({ id: 'r1', sentTxid: TX.txid, reported: true })]);
  });
});

describe('a broadcast whose answer never comes', () => {
  it('Testnet4: every server silent, the chain has it: the Sent page once the watchdog is done', async () => {
    const r = await readyToBroadcast();
    engine.broadcastRescue.mockImplementation(() => {
      // It reached the network; only the answer is lost.
      world.onChain = true;
      return hang();
    });
    await press(broadcastButton(r));
    await advance(TESTNET4_BROADCAST_ATTEMPT_MS * TESTNET4_ELECTRUM_SERVERS.length - 1);
    expect(broadcastButton(r).props.loading).toBe(true);
    expect(sentPage(r)).toBeUndefined();
    await advance(50);
    onSentPage(r);
    // Each server was given its share, then the chain was asked once.
    expect(engine.broadcastRescue).toHaveBeenCalledTimes(TESTNET4_ELECTRUM_SERVERS.length);
    expect(syncWallet).toHaveBeenCalledTimes(3);
  });

  it('the chain does not have it: a Try again dialog, the spinner gone, and Try again sends it', async () => {
    const r = await readyToBroadcast();
    engine.broadcastRescue.mockImplementation(() => hang());
    await press(broadcastButton(r));
    await advance(TESTNET4_BROADCAST_ATTEMPT_MS * TESTNET4_ELECTRUM_SERVERS.length + 50);
    const d = dialog(r);
    expect(d.props.title).toBe(NO_ANSWER_TITLE);
    // Title and buttons only.
    expect(d.props.message).toBe('');
    expect(buttons(r, 'Try again')).toHaveLength(1);
    expect(buttons(r, 'Later')).toHaveLength(1);
    expect(broadcastButton(r).props.loading).toBe(false);
    expect(broadcastButton(r).props.title).toBe('Broadcast rescue');
    expect(sentPage(r)).toBeUndefined();
    expect(await loadPendingRescues()).toEqual([expect.objectContaining({ id: 'r1' })]);
    expect((await loadPendingRescues())[0].sentTxid).toBeUndefined();

    // The same signed transaction again, and this time the network answers.
    engine.broadcastRescue.mockImplementation(async () => TX.txid);
    await press(buttons(r, 'Try again')[0]);
    await advance(50);
    onSentPage(r);
  });

  it('the look on the chain never ends either: the dialog in its bound, never a spinner for ever', async () => {
    const r = await readyToBroadcast();
    engine.broadcastRescue.mockImplementation(() => hang());
    syncWallet.mockImplementationOnce(async () => engine).mockImplementation(() => hang());
    await press(broadcastButton(r));
    await advance(TESTNET4_BROADCAST_ATTEMPT_MS * TESTNET4_ELECTRUM_SERVERS.length - 1);
    expect(broadcastButton(r).props.title).toBe('Broadcasting…');
    // The watchdog is done; the button says what the wait is now.
    await advance(50);
    expect(broadcastButton(r).props.title).toBe(CHECKING_TITLE);
    expect(broadcastButton(r).props.loading).toBe(true);
    await advance(CHAIN_CHECK_MS - 51);
    expect(broadcastButton(r).props.loading).toBe(true);
    await advance(50);
    expect(dialog(r).props.title).toBe(NO_ANSWER_TITLE);
    expect(broadcastButton(r).props.loading).toBe(false);
  });

  it('Bitcoin: the one server the client chose, never another, and the watchdog ends it', async () => {
    const own = 'ssl://10.0.0.20:50002';
    mockWallets.value = {
      ...mockWallets.value,
      getWallet: (id: string) => (id === 'w1' ? { ...wallet, network: 'bitcoin' } : undefined),
      settings: { electrumUrls: { bitcoin: own } },
    };
    const asked: string[] = [];
    engine.broadcastRescue.mockImplementation(((...args: unknown[]) => {
      asked.push((args[2] as { url: string }).url);
      world.onChain = true;
      return hang();
    }) as never);
    const r = await readyToBroadcast();
    await press(broadcastButton(r));
    await advance(BROADCAST_WATCHDOG_MS + 50);
    onSentPage(r);
    expect(asked).toEqual([own]);
  });

  it('none of the Testnet4 servers could be reached at all: asked of the chain, then Try again', async () => {
    const r = await readyToBroadcast();
    engine.broadcastRescue.mockImplementation(async () => {
      throw Object.assign(new Error('Electrum(message: "Made one or multiple attempts, all errored:\n\t- Connection refused (os error 61)\n")'), {
        code: 'BlockchainElectrum init error',
      });
    });
    await press(broadcastButton(r));
    await advance(50);
    expect(dialog(r).props.title).toBe(NO_ANSWER_TITLE);
    expect(dialog(r).props.title).not.toBe(NO_TESTNET4_SERVER_ANSWERED);
    expect(syncWallet).toHaveBeenCalledTimes(2);
  });
});

describe('what has not changed', () => {
  it('a rescue already on the chain (sent before, its report lost): the Sent page, nothing sent twice', async () => {
    const r = await readyToBroadcast();
    // The vault's last sync did not list it yet; Broadcast's own sync does.
    world.onChain = true;
    await press(broadcastButton(r));
    await advance(50);
    onSentPage(r);
    expect(engine.broadcastRescue).not.toHaveBeenCalled();
  });

  it('the same Sent page as the first time: the fee too, from the vault’s record (decided 2026-10-19)', async () => {
    // First time: the coins are still listed and the fee is read off them.
    const first = await readyToBroadcast();
    await press(broadcastButton(first));
    await advance(50);
    const sentFirst = sentPage(first).props.facts;
    expect(sentFirst.feeSats).toBe(9_917);
    await act(async () => first.unmount());

    // Again, once it is on the chain and its coins are spent.
    await savePendingRescue({ id: 'r1', walletId: 'w1', vaultLabel: 'Twopaths test', createdAt: 1, destination: DEST });
    const again = await readyToBroadcast();
    world.onChain = true;
    await press(broadcastButton(again));
    await advance(50);
    onSentPage(again);
    expect(sentPage(again).props.facts).toEqual(sentFirst);
  });

  it('a server that answers with a refusal: Could not broadcast with its words, no look on the chain', async () => {
    const r = await readyToBroadcast();
    engine.broadcastRescue.mockImplementation(async () => {
      throw new Error('Electrum(message: "Electrum server error: \\"scriptpubkey\\"")');
    });
    await press(broadcastButton(r));
    await advance(50);
    expect(dialog(r).props.title).toBe('Could not broadcast');
    expect(dialog(r).props.message).toMatch(/scriptpubkey/);
    expect(syncWallet).toHaveBeenCalledTimes(1);
    expect(broadcastButton(r).props.loading).toBe(false);
    expect((await loadPendingRescues())[0].sentTxid).toBeUndefined();
  });

  it('a first rescue refused for its fee: a title and OK, never the server’s words', async () => {
    const r = await readyToBroadcast();
    engine.broadcastRescue.mockImplementation(async () => {
      throw new Error('Electrum(message: "Electrum server error: \\"min relay fee not met, 100 < 141\\"")');
    });
    await press(broadcastButton(r));
    await advance(50);
    expect(dialog(r).props.title).toBe('The network wants a higher fee');
    expect(dialog(r).props.message).toBe('');
    expect(syncWallet).toHaveBeenCalledTimes(1);
    expect(broadcastButton(r).props.loading).toBe(false);
    expect((await loadPendingRescues())[0].sentTxid).toBeUndefined();
  });

  it('a first rescue whose coins are spent is not called confirmed: only a speed-up has that answer', async () => {
    const r = await readyToBroadcast();
    engine.broadcastRescue.mockImplementation(async () => {
      throw new Error('Electrum(message: "Electrum server error: \\"bad-txns-inputs-missingorspent\\"")');
    });
    await press(broadcastButton(r));
    await advance(50);
    expect(dialog(r).props.title).toBe('Could not broadcast');
    expect(dialog(r).props.message).toMatch(/missingorspent/);
  });
});

describe('on the chain already: the rescue rule first, never Sent for a transaction it refuses (decided 2026-10-19)', () => {
  /** The refusal is on screen, and nothing calls it sent or reports it. */
  async function refused(r: Renderer, words: RegExp) {
    const d = dialog(r);
    expect(d.props.title).toBe('Could not broadcast');
    expect(d.props.message).toMatch(words);
    expect(sentPage(r)).toBeUndefined();
    expect(broadcastButton(r).props.loading).toBe(false);
    await advance(RESCUE_SERVER_MS);
    expect(world.completeCalls).toBe(0);
    expect((await loadPendingRescues())[0].sentTxid).toBeUndefined();
  }

  it('it pays an address the client did not choose (staff sent the wrong one): the alarm, not Sent', async () => {
    await savePendingRescue({ id: 'r1', walletId: 'w1', vaultLabel: 'Twopaths test', createdAt: 1, destination: STRANGER });
    world.onChain = true;
    const r = await readyToBroadcast();
    await press(broadcastButton(r));
    await advance(50);
    await refused(r, /pays an address you did not choose/);
    expect(engine.broadcastRescue).not.toHaveBeenCalled();
  });

  it('the same after a broadcast whose answer was lost and the chain then shows it', async () => {
    await savePendingRescue({ id: 'r1', walletId: 'w1', vaultLabel: 'Twopaths test', createdAt: 1, destination: STRANGER });
    const r = await readyToBroadcast();
    engine.broadcastRescue.mockImplementation(() => {
      // Queued natively, the engine's own check not reached yet when the
      // watchdog gives up, and the transaction is on the chain anyway.
      world.onChain = true;
      return hang();
    });
    await press(broadcastButton(r));
    await advance(TESTNET4_BROADCAST_ATTEMPT_MS * TESTNET4_ELECTRUM_SERVERS.length + 50);
    await refused(r, /pays an address you did not choose/);
  });

  it('a different transaction from the one requested: refused', async () => {
    await savePendingRescue({
      id: 'r1',
      walletId: 'w1',
      vaultLabel: 'Twopaths test',
      createdAt: 1,
      destination: DEST,
      requestTxid: 'ef'.repeat(32),
    });
    world.onChain = true;
    const r = await readyToBroadcast();
    await press(broadcastButton(r));
    await advance(50);
    await refused(r, /different transaction/);
  });

  it('it took less from the vault than it pays and costs (a coin from elsewhere): refused', async () => {
    world.onChain = true;
    world.chainTx = { sent: 200_000, netAmount: -200_000, fee: 9_917 };
    const r = await readyToBroadcast();
    await press(broadcastButton(r));
    await advance(50);
    await refused(r, /coins that are not in this vault/);
  });

  it('a record filed before the destination was kept asks for the address, then the Sent page', async () => {
    await savePendingRescue({ id: 'r1', walletId: 'w1', vaultLabel: 'Twopaths test', createdAt: 1 });
    world.onChain = true;
    const r = await readyToBroadcast();
    await press(broadcastButton(r));
    await advance(50);
    expect(dialog(r).props.title).toBe(`Send the rescue to ${DEST}?`);
    expect(sentPage(r)).toBeUndefined();
    expect(world.completeCalls).toBe(0);
    await press(buttons(r, 'Send')[0]);
    await advance(50);
    onSentPage(r);
    expect(engine.broadcastRescue).not.toHaveBeenCalled();
    expect(world.completeCalls).toBe(1);
  });

  it('an absurd fee asks first, then the Sent page on the client’s word', async () => {
    world.onChain = true;
    world.chainTx = { sent: 1_000_000, netAmount: -1_000_000, fee: 1_000_000 - TX.valueSats };
    const r = await readyToBroadcast();
    await press(broadcastButton(r));
    await advance(50);
    expect(dialog(r).props.title).toMatch(/^The network fee is unusually high/);
    expect(world.completeCalls).toBe(0);
    await press(buttons(r, 'Send anyway')[0]);
    await advance(50);
    onSentPage(r);
  });
});

describe('a broadcast the watchdog gave up on that goes out later (decided 2026-10-19)', () => {
  /** A native broadcast that answers with the txid after `ms`. */
  const answersAfter = (ms: number) =>
    engine.broadcastRescue.mockImplementation(
      () => new Promise<string>((resolve) => setTimeout(() => resolve(TX.txid), ms)),
    );

  it('Bitcoin, the answer at 120 s after "No answer" and Later: the Sent page, marked and reported', async () => {
    const own = 'ssl://10.0.0.20:50002';
    mockWallets.value = {
      ...mockWallets.value,
      getWallet: (id: string) => (id === 'w1' ? { ...wallet, network: 'bitcoin' } : undefined),
      settings: { electrumUrls: { bitcoin: own } },
    };
    const r = await readyToBroadcast();
    answersAfter(120_000);
    await press(broadcastButton(r));
    await advance(BROADCAST_WATCHDOG_MS + 50);
    expect(dialog(r).props.title).toBe(NO_ANSWER_TITLE);
    await press(buttons(r, 'Later')[0]);
    expect(broadcastButton(r).props.title).toBe('Broadcast rescue');
    expect(world.completeCalls).toBe(0);

    await advance(120_000 - BROADCAST_WATCHDOG_MS);
    onSentPage(r);
    expect(world.completeCalls).toBe(1);
    expect((await loadPendingRescues()).map((p) => p.reported)).toEqual([true]);
    // Sent once, through the one server, and never again.
    expect(engine.broadcastRescue).toHaveBeenCalledTimes(1);
    await press(buttons(r, 'Done')[0]);
    expect(broadcastButton(r)).toBeUndefined();
  });

  it('the answer while "No answer from the network" is still open: it closes for the Sent page', async () => {
    const r = await readyToBroadcast();
    const late = TESTNET4_BROADCAST_ATTEMPT_MS * TESTNET4_ELECTRUM_SERVERS.length + 20_000;
    answersAfter(late);
    await press(broadcastButton(r));
    await advance(TESTNET4_BROADCAST_ATTEMPT_MS * TESTNET4_ELECTRUM_SERVERS.length + 50);
    expect(dialog(r).props.title).toBe(NO_ANSWER_TITLE);
    await advance(20_000);
    onSentPage(r);
    expect(world.completeCalls).toBe(1);
  });

  it('the answer while the chain is still being asked: the Sent page, and no dialog after it', async () => {
    const r = await readyToBroadcast();
    answersAfter(BROADCAST_WATCHDOG_MS + 5_000);
    // The look on the chain waits behind the native call, and longer.
    syncWallet.mockImplementationOnce(async () => engine).mockImplementation(() => hang());
    await press(broadcastButton(r));
    await advance(BROADCAST_WATCHDOG_MS + 5_050);
    onSentPage(r);
    await advance(CHAIN_CHECK_MS);
    onSentPage(r);
  });

  it('a signed rescue the vault’s last sync already lists: off the list, marked and reported, sent nothing', async () => {
    world.onChain = true;
    const r = await mount();
    await advance(50);
    expect(broadcastButton(r)).toBeUndefined();
    expect(sentPage(r)).toBeUndefined();
    expect(world.completeCalls).toBe(1);
    expect((await loadPendingRescues()).map((p) => p.reported)).toEqual([true]);
    expect(engine.broadcastRescue).not.toHaveBeenCalled();
  });

  it('one the vault lists that fails the rescue rule stays on the list, unreported', async () => {
    await savePendingRescue({ id: 'r1', walletId: 'w1', vaultLabel: 'Twopaths test', createdAt: 1, destination: STRANGER });
    world.onChain = true;
    const r = await mount();
    await advance(50);
    expect(broadcastButton(r).props.title).toBe('Broadcast rescue');
    expect(world.completeCalls).toBe(0);
    expect((await loadPendingRescues())[0].sentTxid).toBeUndefined();
  });
});

describe('the same state, the same words (decided 2026-10-19)', () => {
  const offline = () =>
    Object.assign(new Error('Electrum(message: "Made one or multiple attempts, all errored:\n\t- Connection refused (os error 61)\n")'), {
      code: 'BlockchainElectrum init error',
    });

  it('Try again while still offline: "No answer from the network" again, with Try again and Later', async () => {
    const r = await readyToBroadcast();
    engine.broadcastRescue.mockImplementation(async () => {
      throw offline();
    });
    // The sync before the broadcast works, then the network goes.
    syncWallet.mockImplementationOnce(async () => engine).mockImplementation(async () => {
      throw new Error(NO_TESTNET4_SERVER_ANSWERED);
    });
    await press(broadcastButton(r));
    await advance(50);
    expect(dialog(r).props.title).toBe(NO_ANSWER_TITLE);

    await press(buttons(r, 'Try again')[0]);
    await advance(50);
    const d = dialog(r);
    expect(d.props.title).toBe(NO_ANSWER_TITLE);
    expect(d.props.message).toBe('');
    expect(buttons(r, 'Try again')).toHaveLength(1);
    expect(buttons(r, 'Later')).toHaveLength(1);
    expect(broadcastButton(r).props.loading).toBe(false);
  });

  it('a Bitcoin vault whose own server cannot be reached before anything is sent: the same', async () => {
    mockWallets.value = {
      ...mockWallets.value,
      getWallet: (id: string) => (id === 'w1' ? { ...wallet, network: 'bitcoin' } : undefined),
      settings: { electrumUrls: { bitcoin: 'ssl://10.0.0.20:50002' } },
    };
    const r = await readyToBroadcast();
    syncWallet.mockImplementation(async () => {
      throw new Error('Sync timed out after 90s. Check the server in Settings → Network');
    });
    await press(broadcastButton(r));
    await advance(50);
    expect(dialog(r).props.title).toBe(NO_ANSWER_TITLE);
    expect(dialog(r).props.message).toBe('');
    expect(engine.broadcastRescue).not.toHaveBeenCalled();
  });

  it('what is not the network keeps its own words: no server set for Bitcoin vaults', async () => {
    const r = await readyToBroadcast();
    syncWallet.mockImplementation(async () => {
      throw new Error('No server is set for your Bitcoin vaults');
    });
    await press(broadcastButton(r));
    await advance(50);
    expect(dialog(r).props.title).toBe('Could not broadcast');
    expect(dialog(r).props.message).toBe('No server is set for your Bitcoin vaults');
  });
});
