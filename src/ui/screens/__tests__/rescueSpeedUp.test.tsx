/**
 * Speed up on a waiting rescue, mounted (decided 2026-10-31): the card, the
 * sheet, the code steps of a first request, the request that names what it
 * replaces, the broadcast of the signed speed-up and what happens to the phone's
 * records. The screen, the rescue service, the replacement rules and the signed
 * transaction's check are real; the page's other parts, the vault's engine, the
 * session and the server (fetch) are replaced. The transactions are real bytes.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

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
    StepTransition: host('StepTransition'),
    Card: host('Card'),
    Button: (p: Record<string, unknown>) => R.createElement('Button', p),
    AppDialog: (p: Record<string, unknown>) => R.createElement('AppDialog', p),
    AppModal: () => null,
    AddressChunks: (p: Record<string, unknown>) => R.createElement('AddressChunks', p),
    SentPage: (p: { facts: unknown; actions?: unknown }) => R.createElement('SentPage', { facts: p.facts, actions: p.actions }),
    PageHead: (p: { title: string; line?: string }) => R.createElement('PageHead', { title: p.title, line: p.line }),
    ConsentCheckbox: (p: Record<string, unknown>) => R.createElement('ConsentCheckbox', p),
    ChevronRightIcon: 'ChevronRightIcon',
    InfoHeading: host('InfoHeading'),
    BookingSheet: () => null,
    CodeField: (p: Record<string, unknown>) => R.createElement('CodeField', p),
    AuthenticatorStep: (p: Record<string, unknown>) => R.createElement('AuthenticatorStep', p),
    FeeSheet: ({ children, ...p }: { children?: React.ReactNode }) => R.createElement('FeeSheet', p, children),
    feeSheetStyles: {},
    sentWords: () => ({}),
  };
});
jest.mock('../../components/TablerIcons', () => new Proxy({}, { get: () => 'Icon' }));
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../../platform/QrScanner', () => ({ QrScanner: () => null }));
jest.mock('../../../platform/clipboard', () => ({ readClipboard: async () => '' }));
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
  loadSession: async () => mockSession.value,
}));
const mockSession = { value: { accessToken: 't', email: 'client@example.com' } as unknown };
jest.mock('../../../services/settingsApi', () => ({ fetchProfile: async () => ({ twoFactorEnabled: mockTwoFactor.on }) }));
const mockTwoFactor = { on: false };
jest.mock('@react-native-async-storage/async-storage', () => require('../../../testing/memoryAsyncStorage'));
jest.mock('../../../bitcoin/descriptor', () => ({
  ...jest.requireActual('../../../bitcoin/descriptor'),
  parsePolicy: () => ({ paths: [{ olderBlocks: 3, groups: [{ keys: [{ fingerprint: 'aabbccdd' }] }] }] }),
}));

import { RescueScreen } from '../RescueScreen';
import { FakeWalletEngine } from '../../../bitcoin/engine/fakeEngine';
import { encodeBase64 } from '../../../bitcoin/psbt/export';
import { scriptToAddress } from '../../../bitcoin/psbt/parse';
import { rawTxShape } from '../../../bitcoin/psbt/broadcastCheck';
import { loadPendingRescues, savePendingRescue, RESCUE_ALREADY_REPLACED_TITLE, RESCUE_FEE_REFUSED_TITLE, RESCUE_MODE_ENDED_TITLE, RESCUE_NOT_REPLACED_TITLE } from '../../../services/rescue';
import type { PendingRescue } from '../../../services/rescue';
import type { RescueBuildRequest, WalletTx } from '../../../bitcoin/engine/types';

const storage = require('@react-native-async-storage/async-storage').default as { __clear: () => void };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

// ---------------------------------------------------------------- bytes

const NET = 'testnet' as const;
const u32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u64 = (n: number): number[] => [...u32(n % 0x100000000), ...u32(Math.floor(n / 0x100000000))];
const le = (txid: string): number[] => (txid.match(/../g) as string[]).map((h) => parseInt(h, 16)).reverse();
const tr = (fill: number) => [0x51, 0x20, ...new Array(32).fill(fill)];
const addr = (script: number[]) => scriptToAddress(Uint8Array.from(script), NET) as string;
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

const WITNESS = [new Array(64).fill(0xaa), new Array(38).fill(0x20), [0xc0, ...new Array(64).fill(0x01)]];
const OLDER = 3;
interface In { txid: string; vout: number; sequence: number }
interface Out { script: number[]; value: number }

function unsigned(ins: In[], outs: Out[]): number[] {
  return [
    ...u32(2),
    ins.length,
    ...ins.flatMap((i) => [...le(i.txid), ...u32(i.vout), 0x00, ...u32(i.sequence)]),
    outs.length,
    ...outs.flatMap((o) => [...u64(o.value), o.script.length, ...o.script]),
    ...u32(0),
  ];
}
function raw(ins: In[], outs: Out[]): Uint8Array {
  const t = unsigned(ins, outs);
  return Uint8Array.from([
    ...t.slice(0, 4), 0x00, 0x01, ...t.slice(4, t.length - 4),
    ...ins.flatMap(() => [WITNESS.length, ...WITNESS.flatMap((w) => [w.length, ...w])]),
    ...t.slice(t.length - 4),
  ]);
}
function psbtOf(ins: In[], outs: Out[]): string {
  const t = unsigned(ins, outs);
  return encodeBase64(
    Uint8Array.from([0x70, 0x73, 0x62, 0x74, 0xff, 0x01, 0x00, t.length, ...t, 0x00, ...ins.map(() => 0x00), ...outs.map(() => 0x00)]),
  );
}

const VAULT_SCRIPT = tr(0x11);
const DEST = tr(0x22);
const COIN_1 = '1'.repeat(64);
const COIN_2 = '2'.repeat(64);
const INS: In[] = [
  { txid: COIN_1, vout: 0, sequence: OLDER },
  { txid: COIN_2, vout: 0, sequence: OLDER },
];
const IN_SATS = [12_000, 8_061];
const TOTAL = 20_061;
const FEE = 2_881;
const FIRST = raw(INS, [{ script: DEST, value: TOTAL - FEE }]);
const FIRST_TXID = rawTxShape(FIRST, NET)!.txid;
const SIZE = 288;

// ---------------------------------------------------------------- the world

const world = {
  /** The vault's record of the waiting rescue; null: it does not list it. */
  chain: {} as Partial<WalletTx> | null,
  mine: [] as Array<Record<string, unknown>>,
  /** Server down: the list cannot be read. */
  mineFails: false,
  /** How many times the list was read. */
  mineReads: 0,
  /** The vault's listing answers only once this resolves. */
  hold: null as Promise<void> | null,
  /** The email's answer comes only once this resolves. */
  otpHold: null as Promise<void> | null,
  /** The server refuses the report that a rescue went out. */
  completeFails: false,
  /** Syncs that answer; the ones after them fail. */
  syncsAnswered: Infinity,
  syncs: 0,
  created: [] as Array<Record<string, unknown>>,
  otpBodies: [] as string[],
  refuse: null as { error: string; message: string } | null,
  completed: [] as string[],
  broadcastError: null as Error | null,
  /** The last speed-up built, as bytes. */
  built: null as { ins: In[]; outs: Out[] } | null,
};

class Engine extends FakeWalletEngine {
  async listTransactions(): Promise<WalletTx[]> {
    if (world.hold) await world.hold;
    if (world.chain === null) return [];
    return [{ txid: FIRST_TXID, received: 0, sent: TOTAL, netAmount: -TOTAL, fee: FEE, confirmed: false, ...world.chain }];
  }
  async listUtxos() {
    return [];
  }
  getTipHeight() {
    return 158_400;
  }
  async buildRescuePsbt(r: RescueBuildRequest) {
    builds.push(r);
    const fee = r.feeAbsolute ?? Math.ceil(r.feeRate * SIZE);
    const ins = r.utxos.map((u) => ({ ...u, sequence: OLDER }));
    const outs = [{ script: DEST, value: TOTAL - fee }];
    world.built = { ins, outs };
    return { psbtBase64: psbtOf(ins, outs), txid: 'e'.repeat(64), feeSats: fee, sentSats: 0 };
  }
  async broadcastRescue(signed: Uint8Array, expect: unknown, backend: never) {
    broadcasts.push(expect as Record<string, unknown>);
    if (world.broadcastError) throw world.broadcastError;
    return super.broadcastRescue(signed, expect as never, backend);
  }
}
const builds: RescueBuildRequest[] = [];
const broadcasts: Array<Record<string, unknown>> = [];

const makeEngine = () =>
  new Engine(NET, {
    addresses: [addr(VAULT_SCRIPT)],
    rawTxs: {
      [FIRST_TXID]: FIRST,
      [COIN_1]: raw([{ txid: 'f'.repeat(64), vout: 0, sequence: 0xfffffffd }], [{ script: VAULT_SCRIPT, value: IN_SATS[0] }]),
      [COIN_2]: raw([{ txid: 'f'.repeat(64), vout: 1, sequence: 0xfffffffd }], [{ script: VAULT_SCRIPT, value: IN_SATS[1] }]),
    },
  });

const VAULT = { id: 'v1', label: 'Twopaths test', network: 'testnet', descriptor: 'tr(xpub/0/*)', providerKeyFingerprints: ['aabbccdd'] };

const SENT: PendingRescue = {
  id: 'r1',
  walletId: VAULT.id,
  vaultLabel: VAULT.label,
  createdAt: 1,
  destination: addr(DEST),
  requestTxid: FIRST_TXID,
  sentTxid: FIRST_TXID,
  sentAt: Date.now(),
  reported: true,
};
const serverRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  vault_label: VAULT.label,
  destination: addr(DEST),
  amount_sats: TOTAL,
  status: 'completed',
  signed_tx: '',
  created_at: '2026-10-31T16:35:00Z',
  signed_at: '2026-10-31T16:36:00Z',
  replaces: null,
  can_speed_up: true,
  still_open: false,
  ...over,
});

function serve() {
  global.fetch = jest.fn((url: string, init?: { method?: string; body?: string }) => {
    const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    if (url.includes('fees/precise')) return json({ fastestFee: 40, halfHourFee: 20, hourFee: 5 });
    if (url.endsWith('/rescue/mode/')) return json({ status: 'none' });
    if (url.endsWith('/rescue/mine/')) {
      world.mineReads += 1;
      return world.mineFails ? json({}, 500) : json(world.mine);
    }
    if (url.endsWith('/rescue/otp/')) {
      world.otpBodies.push(init?.body ?? '');
      if (world.otpHold) return world.otpHold.then(() => json({ sent: true }));
      if (world.refuse?.error === 'RESCUE_MODE_REQUIRED') return json(world.refuse, 403);
      return json({ sent: true });
    }
    if (url.endsWith('/rescue/requests/') && init?.method === 'POST') {
      world.created.push(JSON.parse(init.body ?? '{}'));
      if (world.refuse) return json(world.refuse, 400);
      world.mine = [...world.mine, serverRow({ id: 'r2', status: 'pending', replaces: 'r1', can_speed_up: false, still_open: true })];
      return json({ id: 'r2', status: 'pending' }, 201);
    }
    const done = url.match(/requests\/(\w+)\/complete\/$/);
    if (done) {
      if (world.completeFails) return json({}, 502);
      world.completed.push(done[1]);
      return json({ status: 'completed' });
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
}

/** The vault's coins before the rescue, and its record of how they came in. */
const COINS_LISTED = [
  { txid: COIN_1, vout: 0, valueSats: IN_SATS[0], address: addr(VAULT_SCRIPT), keychain: 'external' },
  { txid: COIN_2, vout: 0, valueSats: IN_SATS[1], address: addr(VAULT_SCRIPT), keychain: 'external' },
];
const FUNDING = [COIN_1, COIN_2].map((txid) => ({ txid, received: 1, sent: 0, netAmount: 1, fee: 0, confirmed: true, blockHeight: 100 }));
const SENT_TX = { txid: FIRST_TXID, received: 0, sent: TOTAL, netAmount: -TOTAL, fee: FEE, confirmed: false };

type Renderer = TestRenderer.ReactTestRenderer;

const hosts = (r: Renderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type);
const text = (r: Renderer): string =>
  hosts(r, 'Text')
    .map((n) => n.children.filter((c) => typeof c === 'string').join(''))
    .join(' | ');
const button = (r: Renderer, title: string) => hosts(r, 'Button').find((b) => String(b.props.title).startsWith(title));
const sheet = (r: Renderer) => hosts(r, 'FeeSheet')[0];
const dialogs = (r: Renderer) => hosts(r, 'AppDialog').map((d) => [d.props.title, d.props.message]);
const settle = (ms = 30) => act(async () => new Promise((res) => setTimeout(res, ms)));
const press = async (r: Renderer, title: string, ms = 30) => {
  const b = button(r, title);
  if (!b) throw new Error(`No ${title} on the page: ${text(r)}`);
  await act(async () => b.props.onPress());
  await settle(ms);
};

/** What the page listens for: a real navigator says `focus` after the mount. */
const focusHeard: Array<() => void> = [];
const focus = () => act(async () => focusHeard.forEach((heard) => heard()));

/** Hold the vault's listing back; call what it returns to let it answer. */
const holdListing = () => {
  let open!: () => void;
  world.hold = new Promise((res) => {
    open = () => {
      world.hold = null;
      res();
    };
  });
  return open;
};

async function mount(): Promise<Renderer> {
  const engine = makeEngine();
  mockWallets.value = {
    wallets: [VAULT],
    settings: { electrumUrls: {}, fiat: 'USD', unit: 'BTC', btcOnly: true },
    getWallet: () => VAULT,
    getEngine: async () => engine,
    syncWallet: async () => {
      world.syncs += 1;
      if (world.syncs > world.syncsAnswered) throw new Error('No connection');
      return engine;
    },
  };
  let r!: Renderer;
  const navigation = {
    addListener: (_event: string, heard: () => void) => {
      focusHeard.push(heard);
      return () => {};
    },
    goBack: () => {},
    navigate: () => {},
  };
  await act(async () => {
    r = TestRenderer.create(
      React.createElement(RescueScreen as unknown as React.ComponentType<Record<string, unknown>>, { navigation, route: {} }),
    );
    await new Promise((res) => setTimeout(res, 30));
  });
  return r;
}

/** The sheet, High picked, its button pressed: the email link has gone out. */
async function chooseHigh(r: Renderer) {
  await press(r, 'Speed up');
  expect(sheet(r)).toBeDefined();
  await act(async () => sheet(r).props.rows[0].onPress());
  await press(r, 'Speed up ·', 520);
}

const typeCode = async (r: Renderer) => {
  await act(async () => hosts(r, 'CodeField')[0].props.onChange('123456'));
  await act(async () => hosts(r, 'CodeField')[0].props.onComplete('123456'));
  await settle();
};

beforeEach(async () => {
  storage.__clear();
  world.chain = {};
  world.mine = [serverRow()];
  world.mineFails = false;
  world.mineReads = 0;
  world.hold = null;
  world.otpHold = null;
  world.completeFails = false;
  world.syncsAnswered = Infinity;
  world.syncs = 0;
  focusHeard.length = 0;
  world.created = [];
  world.otpBodies = [];
  world.refuse = null;
  world.completed = [];
  world.broadcastError = null;
  world.built = null;
  builds.length = 0;
  broadcasts.length = 0;
  mockTwoFactor.on = false;
  mockSession.value = { accessToken: 't', email: 'client@example.com' };
  serve();
  await savePendingRescue(SENT);
});

/** Stand-ins on the engine's prototype, undone whichever way a test ends. */
const spied: jest.SpyInstance[] = [];
afterEach(() => spied.splice(0).forEach((s) => s.mockRestore()));

describe('a rescue that waits', () => {
  it('reads as sent, not as an empty vault, and offers Speed up', async () => {
    const r = await mount();
    const page = text(r);
    expect(page).toContain('Rescue sent, waiting for a block');
    expect(page).not.toContain('No coins in this vault');
    expect(page).toContain(`fee ${FEE} sats`);
    expect(button(r, 'Speed up')).toBeDefined();
  });

  it('the rest of the vault list is untouched: an empty vault with no rescue still says so', async () => {
    storage.__clear();
    const r = await mount();
    expect(text(r)).toContain('No coins in this vault');
    expect(button(r, 'Speed up')).toBeUndefined();
  });

  it('leaves the phone’s record once it is in a block', async () => {
    world.chain = { confirmed: true, blockHeight: 158_399 };
    const r = await mount();
    await settle();
    expect(text(r)).not.toContain('Rescue sent');
    expect(await loadPendingRescues()).toEqual([]);
  });

  it('keeps the record when the vault does not list it yet', async () => {
    world.chain = null;
    await mount();
    await settle();
    expect((await loadPendingRescues()).map((p) => p.id)).toEqual(['r1']);
  });

  it('forgets one the vault never listed, long after it went out', async () => {
    world.chain = null;
    await savePendingRescue({ ...SENT, sentAt: Date.now() - 31 * 24 * 60 * 60 * 1000 });
    await mount();
    await settle();
    expect(await loadPendingRescues()).toEqual([]);
  });

  it.each<[string, () => void]>([
    ['the server would not take one', () => void (world.mine = [serverRow({ can_speed_up: false })])],
    ['the server cannot be asked', () => void (world.mineFails = true)],
    ['the rescue is not the one on this phone’s record', () => void savePendingRescue({ ...SENT, destination: addr(tr(0x77)) })],
    ['a speed-up is already with 21st Capital', () => {
      void savePendingRescue({ ...SENT, id: 'r2', sentTxid: undefined, replaces: { id: 'r1', txid: FIRST_TXID, coins: [] } });
      world.mine = [serverRow(), serverRow({ id: 'r2', status: 'pending', replaces: 'r1', still_open: true })];
    }],
  ])('offers nothing when %s', async (_name, arrange) => {
    arrange();
    const r = await mount();
    await settle();
    expect(text(r)).toContain('Rescue sent, waiting for a block');
    expect(button(r, 'Speed up')).toBeUndefined();
  });

  it('reads as waiting while the vault has not answered yet', async () => {
    const open = holdListing();
    const r = await mount();
    expect(text(r)).toContain('Rescue sent, waiting for a block');
    open();
    await settle();
  });

  it('reads as waiting when the chain cannot be asked, never as an empty vault', async () => {
    world.syncsAnswered = 1;
    const r = await mount();
    await settle();
    expect(text(r)).toContain('Rescue sent, waiting for a block');
    expect(text(r)).not.toContain('No coins in this vault');
  });

  it('is no button to a new rescue, whatever a late look at the coins says', async () => {
    spied.push(
      jest.spyOn(Engine.prototype, 'listUtxos').mockImplementation(async () => COINS_LISTED as never),
      jest.spyOn(Engine.prototype, 'listTransactions').mockImplementation(async () => [SENT_TX, ...FUNDING] as never),
    );
    const r = await mount();
    await settle();
    expect(text(r)).toContain('Rescue sent, waiting for a block');
    expect(text(r)).not.toContain('Ready to rescue');
  });

  it('a rejected speed-up leaves the way free', async () => {
    await savePendingRescue({ ...SENT, id: 'r2', sentTxid: undefined, replaces: { id: 'r1', txid: FIRST_TXID, coins: [] } });
    world.mine = [serverRow(), serverRow({ id: 'r2', status: 'rejected', replaces: 'r1', rejection_reason: '' })];
    const r = await mount();
    await settle();
    expect(button(r, 'Speed up')).toBeDefined();
    expect(text(r)).toContain('Nothing new was signed. The rescue you already sent is not affected.');
    expect(text(r)).not.toContain('You can start a new rescue');
  });
});

describe('a rescue that went out with no word of it on this screen', () => {
  const LOST: PendingRescue = {
    id: 'r3',
    walletId: VAULT.id,
    vaultLabel: VAULT.label,
    createdAt: 2,
    destination: addr(DEST),
    requestTxid: rawTxShape(FIRST, NET)!.unsignedTxid,
  };

  beforeEach(async () => {
    storage.__clear();
    await savePendingRescue(LOST);
    world.mine = [serverRow({ id: 'r3', status: 'signed', signed_tx: hex(FIRST) })];
  });

  it('found after the list answered, with focus heard after the mount: the list is read again and it waits', async () => {
    const open = holdListing();
    const r = await mount();
    await focus();
    await settle();
    expect(button(r, 'Broadcast rescue')).toBeDefined();
    open();
    await settle(120);
    expect(text(r)).toContain('Rescue sent, waiting for a block');
    expect(text(r)).not.toContain('No coins in this vault');
    expect(button(r, 'Broadcast rescue')).toBeUndefined();
    expect(button(r, 'Speed up')).toBeDefined();
  });

  it('not on the chain: it stays ready to broadcast, and the list is not read again', async () => {
    world.chain = null;
    const r = await mount();
    await settle(120);
    expect(button(r, 'Broadcast rescue')).toBeDefined();
    expect(world.mineReads).toBe(1);
    expect((await loadPendingRescues())[0].sentTxid).toBeUndefined();
  });
});

describe('after the Sent page', () => {
  it('the vault no longer offers a new rescue', async () => {
    storage.__clear();
    await savePendingRescue({
      id: 'r3',
      walletId: VAULT.id,
      vaultLabel: VAULT.label,
      createdAt: 2,
      destination: addr(DEST),
      requestTxid: rawTxShape(FIRST, NET)!.unsignedTxid,
    });
    world.mine = [serverRow({ id: 'r3', status: 'signed', signed_tx: hex(FIRST), can_speed_up: false })];
    let out = false;
    spied.push(
      jest.spyOn(Engine.prototype, 'listUtxos').mockImplementation(async () => (out ? [] : COINS_LISTED) as never),
      jest.spyOn(Engine.prototype, 'listTransactions').mockImplementation(async () => (out ? [SENT_TX, ...FUNDING] : FUNDING) as never),
      jest.spyOn(Engine.prototype, 'broadcastRescue').mockImplementation(async () => {
        out = true;
        return FIRST_TXID;
      }),
    );
    const r = await mount();
    await settle(120);
    // Signed and not yet sent: the vault is not offered for another rescue
    // (decided 2026-11-04, one per vault at a time).
    expect(text(r)).toContain('Signed and ready to broadcast');
    expect(text(r)).not.toContain('Ready to rescue');
    await press(r, 'Broadcast rescue', 120);
    const page = hosts(r, 'SentPage');
    expect(page).toHaveLength(1);
    await act(async () => (page[0].props.actions as Array<{ onPress: () => void }>)[0].onPress());
    await settle(120);
    expect(text(r)).toContain('Rescue sent, waiting for a block');
    expect(text(r)).not.toContain('Ready to rescue');
  });
});

describe('a rescue 21st Capital has not heard about', () => {
  const ids = async () => (await loadPendingRescues()).map((p) => p.id);

  it('stays on this phone once it is in a block, and goes once the report has landed', async () => {
    await savePendingRescue({ ...SENT, reported: undefined });
    world.chain = { confirmed: true, blockHeight: 158_399 };
    mockSession.value = null;
    const away = await mount();
    await settle();
    expect(await ids()).toEqual(['r1']);
    await act(async () => away.unmount());

    mockSession.value = { accessToken: 't', email: 'client@example.com' };
    await mount();
    await settle(60);
    expect(world.completed).toEqual(['r1']);
    expect(await ids()).toEqual([]);
  });

  it('stays when the server turns the report down, whatever the list says', async () => {
    await savePendingRescue({ ...SENT, reported: undefined });
    world.chain = { confirmed: true, blockHeight: 158_399 };
    world.completeFails = true;
    await mount();
    await settle(60);
    expect(await ids()).toEqual(['r1']);
  });

  it('stays when the vault never listed it, however long ago it went out', async () => {
    await savePendingRescue({ ...SENT, reported: undefined, sentAt: Date.now() - 31 * 24 * 60 * 60 * 1000 });
    world.chain = null;
    world.completeFails = true;
    await mount();
    await settle(60);
    expect(await ids()).toEqual(['r1']);
  });
});

describe('the sheet', () => {
  it('is Speed up’s own, starting above the fee the rescue pays, signed again by 21st Capital', async () => {
    const r = await mount();
    await press(r, 'Speed up');
    const s = sheet(r).props;
    expect(s.title).toBe('Speed up');
    expect(s.caption).toMatch(/^Now \d+(\.\d)? sat\/vB$/);
    // 5 sat/vB sits under what the rescue pays: muted, as on any payment.
    expect(s.rows.map((row: { label: string; muted: boolean }) => [row.label, row.muted])).toEqual([
      ['High', false],
      ['Medium', false],
      ['Slow', true],
    ]);
    expect(s.footer.map((f: { props: { children: string } }) => f.props.children)).toEqual(
      expect.arrayContaining(['Signed again by 21st Capital']),
    );
    expect(String(s.footer[0].props.children)).toContain('Recipient receives');
  });

  it('says so and opens nothing when the rescue confirmed meanwhile', async () => {
    const r = await mount();
    world.chain = { confirmed: true, blockHeight: 158_399 };
    await press(r, 'Speed up');
    expect(sheet(r)).toBeUndefined();
    expect(dialogs(r)).toEqual([['Already confirmed', '']]);
  });

  it('says so when the rescue is no longer the one to replace', async () => {
    const r = await mount();
    world.chain = null;
    await press(r, 'Speed up');
    expect(sheet(r)).toBeUndefined();
    expect(dialogs(r)).toEqual([[RESCUE_NOT_REPLACED_TITLE, '']]);
  });
});

describe('asking for it', () => {
  it('shows the email going out on the card, and a second tap does nothing', async () => {
    let answer!: () => void;
    world.otpHold = new Promise((res) => {
      answer = res;
    });
    const r = await mount();
    await press(r, 'Speed up');
    await act(async () => sheet(r).props.rows[0].onPress());
    await press(r, 'Speed up ·', 10);
    // Before the email has started, while the sheet slides away.
    const early = button(r, 'Sending…');
    expect(early?.props.loading).toBe(true);
    expect(early?.props.disabled).toBe(true);
    await act(async () => early?.props.onPress());
    await settle(520);
    // The email is out and its answer has not come.
    expect(button(r, 'Sending…')?.props.loading).toBe(true);
    expect(world.otpBodies).toHaveLength(1);
    expect(sheet(r)).toBeUndefined();
    await act(async () => answer());
    await settle();
    expect(text(r)).toContain('Check your email');
    expect(world.otpBodies).toHaveLength(1);
  });

  it('the card is ready again after an email that could not go', async () => {
    world.otpHold = Promise.reject(new Error('No connection'));
    world.otpHold.catch(() => {});
    const r = await mount();
    await chooseHigh(r);
    await act(async () => hosts(r, 'AppDialog')[0].props.actions[0].onPress());
    await settle();
    expect(button(r, 'Speed up')?.props.disabled).toBe(false);
  });

  it('the code step says what a speed-up does, and shows the address the client confirms', async () => {
    const r = await mount();
    await chooseHigh(r);
    expect(text(r)).toContain(
      'We emailed you a secure link. Open it and confirm you have checked the destination address below. This speed-up sends the same coins there at a higher fee. The page then shows your 6-digit code.',
    );
    expect(text(r)).not.toContain('everything this vault holds');
    expect(text(r)).toContain('VERIFY ADDRESS');
    expect(hosts(r, 'AddressChunks').map((a) => a.props.address)).toEqual([addr(DEST)]);
  });

  it('passes the email link and the code of a first request, and names what it replaces', async () => {
    const r = await mount();
    await chooseHigh(r);
    expect(world.otpBodies).toEqual(['{"replaces":"r1"}']);
    expect(text(r)).toContain('Check your email');
    await typeCode(r);
    expect(builds).toEqual([
      {
        utxos: [
          { txid: COIN_1, vout: 0 },
          { txid: COIN_2, vout: 0 },
        ],
        destination: addr(DEST),
        feeRate: 40,
        // What the sheet showed, to the satoshi.
        feeAbsolute: expect.any(Number),
        branchFingerprint: 'aabbccdd',
        replacing: [FIRST_TXID],
      },
    ]);
    expect(world.created).toHaveLength(1);
    expect(world.created[0]).toMatchObject({
      replaces: 'r1',
      destination: addr(DEST),
      email_otp: '123456',
      descriptor: VAULT.descriptor,
      amount_sats: TOTAL,
    });
    expect(String(world.created[0].request_psbt).length).toBeGreaterThan(10);
    expect(hosts(r, 'PageHead')[0].props.title).toBe('Speed-up requested');
  });

  it('takes the authenticator code when the account has two-factor', async () => {
    mockTwoFactor.on = true;
    const r = await mount();
    await chooseHigh(r);
    await settle();
    await typeCode(r);
    expect(world.created).toEqual([]);
    expect(hosts(r, 'AuthenticatorStep')).toHaveLength(1);
    await act(async () => hosts(r, 'AuthenticatorStep')[0].props.onComplete('654321'));
    await settle();
    expect(world.created[0]).toMatchObject({ replaces: 'r1', totp: '654321' });
  });

  it('keeps on this phone what the signed speed-up is checked against', async () => {
    const r = await mount();
    await chooseHigh(r);
    await typeCode(r);
    const record = (await loadPendingRescues()).find((p) => p.id === 'r2')!;
    expect(record.destination).toBe(addr(DEST));
    expect(record.requestTxid).toBeDefined();
    expect(record.replaces).toEqual({
      id: 'r1',
      txid: FIRST_TXID,
      coins: [
        { txid: COIN_1, vout: 0, valueSats: IN_SATS[0] },
        { txid: COIN_2, vout: 0, valueSats: IN_SATS[1] },
      ],
    });
    expect((await loadPendingRescues()).find((p) => p.id === 'r1')?.sentTxid).toBe(FIRST_TXID);
  });

  it('Back on the code step leaves it, with nothing filed', async () => {
    const r = await mount();
    await chooseHigh(r);
    await press(r, 'Back');
    expect(text(r)).toContain('Rescue sent, waiting for a block');
    expect(world.created).toEqual([]);
  });

  it.each([
    ['RESCUE_MODE_REQUIRED', RESCUE_MODE_ENDED_TITLE],
    ['FEE_NOT_SANE', RESCUE_FEE_REFUSED_TITLE],
    ['REPLACEMENT_FEE_NOT_HIGHER', RESCUE_FEE_REFUSED_TITLE],
    ['RESCUE_ALREADY_REPLACED', RESCUE_ALREADY_REPLACED_TITLE],
    ['REPLACEMENT_DIFFERENT_COINS', RESCUE_NOT_REPLACED_TITLE],
    ['REPLACEMENT_DIFFERENT_DESTINATION', RESCUE_NOT_REPLACED_TITLE],
    ['REPLACEMENT_SEQUENCE_CHANGED', RESCUE_NOT_REPLACED_TITLE],
  ])('%s: a title and OK, back on the list, nothing filed on this phone', async (error, title) => {
    const r = await mount();
    await press(r, 'Speed up');
    await act(async () => sheet(r).props.rows[0].onPress());
    await press(r, 'Speed up ·', 520);
    world.refuse = { error, message: 'A paragraph for another reader.' };
    if (error === 'RESCUE_MODE_REQUIRED') world.refuse = { error, message: 'Ended.' };
    await typeCode(r);
    expect(dialogs(r)).toEqual([[title, '']]);
    expect(text(r)).toContain('Rescue sent, waiting for a block');
    expect((await loadPendingRescues()).map((p) => p.id)).toEqual(['r1']);
  });

  it('a mode that ended before the email: the same title, back on the list', async () => {
    world.refuse = { error: 'RESCUE_MODE_REQUIRED', message: 'Ended.' };
    const r = await mount();
    await chooseHigh(r);
    expect(dialogs(r)).toEqual([[RESCUE_MODE_ENDED_TITLE, '']]);
    expect(text(r)).toContain('Rescue sent, waiting for a block');
  });
});

describe('sending it', () => {
  const FASTER = raw(INS, [{ script: DEST, value: TOTAL - 11_520 }]);
  const FASTER_TXID = rawTxShape(FASTER, NET)!.unsignedTxid;
  const COINS = [
    { txid: COIN_1, vout: 0, valueSats: IN_SATS[0] },
    { txid: COIN_2, vout: 0, valueSats: IN_SATS[1] },
  ];
  const signedRecord: PendingRescue = {
    id: 'r2',
    walletId: VAULT.id,
    vaultLabel: VAULT.label,
    createdAt: 2,
    destination: addr(DEST),
    requestTxid: FASTER_TXID,
    replaces: { id: 'r1', txid: FIRST_TXID, coins: COINS },
  };

  beforeEach(async () => {
    await savePendingRescue(signedRecord);
    world.mine = [
      serverRow({ can_speed_up: false }),
      serverRow({ id: 'r2', status: 'signed', signed_tx: hex(FASTER), replaces: 'r1', can_speed_up: false }),
    ];
  });

  it('checks it against the coins on this phone’s record, goes out, and takes the rescue’s place', async () => {
    const r = await mount();
    await settle();
    expect(text(r)).toContain('Speed-up of your rescue');
    await press(r, 'Broadcast rescue', 80);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({ requestTxid: FASTER_TXID, replacedCoins: COINS });
    const page = hosts(r, 'SentPage');
    expect(page).toHaveLength(1);
    expect(page[0].props.facts).toMatchObject({ txids: [rawTxShape(FASTER, NET)!.txid], feeSats: 11_520 });
    expect(world.completed).toEqual(['r2']);
    const left = await loadPendingRescues();
    expect(left.map((p) => p.id)).toEqual(['r2']);
    expect(left[0].sentTxid).toBe(rawTxShape(FASTER, NET)!.txid);
  });

  it('keeps a replaced rescue’s record until 21st Capital has heard about it', async () => {
    await savePendingRescue({ ...SENT, reported: undefined });
    world.completeFails = true;
    const first = await mount();
    await settle();
    await press(first, 'Broadcast rescue', 80);
    expect((await loadPendingRescues()).map((p) => p.id)).toEqual(['r1', 'r2']);
    await act(async () => first.unmount());

    world.completeFails = false;
    world.chain = null;
    await mount();
    await settle(80);
    expect(world.completed).toEqual(expect.arrayContaining(['r1', 'r2']));
    expect((await loadPendingRescues()).map((p) => p.id)).toEqual(['r2']);
  });

  it('comes too late once the rescue it replaces is in a block: said, not sent, and its record goes', async () => {
    world.chain = { confirmed: true, blockHeight: 158_399 };
    const r = await mount();
    await settle();
    await press(r, 'Broadcast rescue', 60);
    expect(broadcasts).toEqual([]);
    expect(dialogs(r)).toEqual([['Already confirmed', '']]);
    expect((await loadPendingRescues()).map((p) => p.id)).not.toContain('r2');
  });

  it('a network that wants more says so, in a title', async () => {
    world.broadcastError = new Error('Electrum server error: insufficient fee, rejecting replacement');
    const r = await mount();
    await settle();
    await press(r, 'Broadcast rescue', 60);
    expect(dialogs(r)).toEqual([['The network wants a higher fee', '']]);
    expect((await loadPendingRescues()).find((p) => p.id === 'r2')?.sentTxid).toBeUndefined();
  });

  it('coins already spent in a block: the same answer as the look before it', async () => {
    world.broadcastError = new Error('Electrum server error: bad-txns-inputs-missingorspent');
    const r = await mount();
    await settle();
    await press(r, 'Broadcast rescue', 60);
    expect(dialogs(r)).toEqual([['Already confirmed', '']]);
  });

  it('a waiting speed-up its mode can no longer sign says so, on the server’s word', async () => {
    world.mine = [serverRow({ can_speed_up: false }), serverRow({ id: 'r2', status: 'pending', replaces: 'r1', still_open: false })];
    const r = await mount();
    await settle();
    expect(text(r)).toContain(RESCUE_MODE_ENDED_TITLE);
    expect(button(r, 'Remove from this list')).toBeDefined();
  });

  it('one still open reads as waiting, whatever the mode says', async () => {
    world.mine = [serverRow({ can_speed_up: false }), serverRow({ id: 'r2', status: 'pending', replaces: 'r1', still_open: true })];
    const r = await mount();
    await settle();
    expect(text(r)).toContain('Waiting for 21st Capital…');
    expect(text(r)).not.toContain(RESCUE_MODE_ENDED_TITLE);
  });
});
