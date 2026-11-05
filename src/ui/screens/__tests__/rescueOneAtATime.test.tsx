/**
 * One rescue per vault at a time (decided 2026-11-04). A vault whose request
 * is on its way, waiting for 21st Capital or signed and not yet sent, is not
 * offered for another; a waiting request can be cancelled from its card,
 * behind a title-only confirmation; once cancelled (or ended, or rejected)
 * the vault is offered again. The server refusing a second request
 * (RESCUE_ALREADY_OPEN) is a title, at the email step and at filing.
 *
 * The screen and the rescue service are real; the page's parts, the vault,
 * the session and the server (fetch) are replaced.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const DEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

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
    AddressChunks: () => null,
    FactRow: () => null,
    SentPage: () => null,
    PageHead: (p: { title: string }) => R.createElement('PageHead', { title: p.title }),
    ConsentCheckbox: (p: Record<string, unknown>) => R.createElement('ConsentCheckbox', p),
    ChevronRightIcon: 'ChevronRightIcon',
    InfoHeading: host('InfoHeading'),
    BookingSheet: () => null,
    CodeField: (p: Record<string, unknown>) => R.createElement('CodeField', p),
    AuthenticatorStep: host('AuthenticatorStep'),
    FeeSheet: () => null,
    feeSheetStyles: {},
    sentWords: () => ({}),
    RescueRequestSheet: () => null,
  };
});
jest.mock('../../components/AddressField', () => ({
  AddressField: (p: Record<string, unknown>) => require('react').createElement('AddressField', p),
}));
jest.mock('../../components/TablerIcons', () => new Proxy({}, { get: () => 'Icon' }));
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../../../platform/QrScanner', () => ({ QrScanner: () => null }));
jest.mock('../../../platform/clipboard', () => ({ readClipboard: async () => DEST }));
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
  loadSession: async () => ({ accessToken: 't', email: 'client@example.com' }),
}));
jest.mock('../../../services/settingsApi', () => ({ fetchProfile: async () => ({ twoFactorEnabled: false }) }));
jest.mock('@react-native-async-storage/async-storage', () => require('../../../testing/memoryAsyncStorage'));
jest.mock('../../../bitcoin/descriptor', () => ({
  ...jest.requireActual('../../../bitcoin/descriptor'),
  parsePolicy: () => ({ paths: [{ olderBlocks: 100, groups: [{ keys: [{ fingerprint: 'aabbccdd' }] }] }] }),
}));

import { RescueScreen } from '../RescueScreen';
import {
  loadPendingRescues,
  savePendingRescue,
  RESCUE_ALREADY_OPEN_TITLE,
  RESCUE_ALREADY_SIGNED_TITLE,
} from '../../../services/rescue';

const storage = require('@react-native-async-storage/async-storage').default as { __clear: () => void };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;

const COIN = { txid: 'a'.repeat(64), vout: 0, valueSats: 500_000, keychain: 'external' };
const engine = {
  network: 'testnet',
  listUtxos: async () => [COIN],
  listTransactions: async () => [{ txid: COIN.txid, blockHeight: 1 }],
  ownsAddress: async () => false,
  getTipHeight: () => 900_000,
  getReceiveAddress: async () => ({ address: DEST, index: 0 }),
  buildRescuePsbt: async () => ({ psbtBase64: 'cHNidP8=', feeSats: 3_000 }),
};
const VAULT = { id: 'v2', label: 'Savings', network: 'testnet', descriptor: 'tr(xpub/0/*)', providerKeyFingerprints: ['aabbccdd'] };

/** What the server answers, per test. */
const world = {
  mode: 'active' as 'active' | 'none',
  /** The request's status on the server; undefined = not listed. */
  status: 'pending' as string | undefined,
  /** The signed transaction the server holds for it ("" = none, or wiped). */
  signedTx: '',
  /** The list cannot be read (no connection). */
  listFails: false,
  /** What the cancel answers. */
  cancel: { status: 200, body: { status: 'cancelled' } as Record<string, unknown> },
  cancels: 0,
  otp: { status: 200, body: { sent: true } as Record<string, unknown> },
  create: { status: 201, body: { id: 'r9', status: 'pending' } as Record<string, unknown> },
  created: 0,
};

function serve() {
  global.fetch = jest.fn((url: string, init?: { method?: string }) => {
    const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    if (url.includes('fees/precise')) return json({ fastestFee: 12, halfHourFee: 6, hourFee: 3 });
    if (url.endsWith('/rescue/mode/')) return json({ status: world.mode });
    if (url.endsWith('/rescue/mine/')) {
      if (world.listFails) return json({}, 503);
      return json(world.status ? [{ id: 'r1', status: world.status, vault_label: 'Savings', signed_tx: world.signedTx }] : []);
    }
    if (url.endsWith('/rescue/requests/r1/cancel/') && init?.method === 'POST') {
      world.cancels += 1;
      if (world.cancel.status === 200) world.status = String(world.cancel.body.status);
      return json(world.cancel.body, world.cancel.status);
    }
    if (url.endsWith('/rescue/otp/')) return json(world.otp.body, world.otp.status);
    if (url.endsWith('/rescue/requests/') && init?.method === 'POST') {
      world.created += 1;
      return json(world.create.body, world.create.status);
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
}

const hosts = (r: Renderer, type: string) => r.root.findAll((n) => (n.type as unknown) === type);
const text = (r: Renderer): string =>
  hosts(r, 'Text')
    .map((n) => n.children.filter((c) => typeof c === 'string').join(''))
    .join(' | ');
const button = (r: Renderer, title: string) => hosts(r, 'Button').find((b) => b.props.title === title);
const dialog = (r: Renderer) => hosts(r, 'AppDialog')[0];
const settle = (ms = 30) => act(async () => new Promise((res) => setTimeout(res, ms)));
/** A dialog after the confirmation waits for it to close (AFTER_MODAL_MS). */
const afterClose = () => settle(500);
/** A signed transaction as the server holds it (its bytes are not read here). */
const SIGNED = '02'.padEnd(120, '0');

/** As the real dialog does: it closes, then runs the action. */
async function choose(r: Renderer, label: string) {
  const d = dialog(r);
  const action = (d.props.actions as Array<{ label: string; onPress: (v: string) => void }>).find((a) => a.label === label)!;
  await act(async () => {
    (d.props.onClose as () => void)();
    action.onPress('');
  });
  await settle();
}

async function mount(params: Record<string, unknown> = {}): Promise<Renderer> {
  mockWallets.value = {
    wallets: [VAULT],
    settings: { electrumUrls: {}, fiat: 'USD', unit: 'BTC', btcOnly: true },
    getWallet: (id: string) => (id === VAULT.id ? VAULT : undefined),
    getEngine: async () => engine,
    syncWallet: async () => engine,
  };
  let r!: Renderer;
  const navigation = { addListener: () => () => {}, goBack: () => {}, navigate: () => {} };
  await act(async () => {
    r = TestRenderer.create(
      React.createElement(RescueScreen as unknown as React.ComponentType<Record<string, unknown>>, {
        navigation,
        route: { params },
      }),
    );
  });
  await settle();
  return r;
}

const fileRecord = (over: Record<string, unknown> = {}) =>
  savePendingRescue({ id: 'r1', walletId: VAULT.id, vaultLabel: 'Savings', createdAt: Date.now(), destination: DEST, ...over });

beforeEach(() => {
  storage.__clear();
  Object.assign(world, {
    mode: 'active',
    status: 'pending',
    signedTx: '',
    listFails: false,
    cancel: { status: 200, body: { status: 'cancelled' } },
    cancels: 0,
    otp: { status: 200, body: { sent: true } },
    create: { status: 201, body: { id: 'r9', status: 'pending' } },
    created: 0,
  });
  serve();
});

describe('a vault with a request on its way', () => {
  it('is not offered while its request waits for 21st Capital, and the card offers Cancel request', async () => {
    await fileRecord();
    const r = await mount();
    expect(text(r)).toContain('Waiting for 21st Capital…');
    expect(text(r)).not.toContain('Ready to rescue');
    expect(button(r, 'Cancel request')).toBeDefined();
  });

  it('is not offered while its request is signed and not yet sent, and that one has no Cancel', async () => {
    // The signature closed rescue mode.
    world.mode = 'none';
    world.status = 'signed';
    world.signedTx = SIGNED;
    await fileRecord();
    const r = await mount();
    expect(text(r)).toContain('Signed and ready to broadcast');
    expect(text(r)).not.toContain('Ready to rescue');
    expect(button(r, 'Cancel request')).toBeUndefined();
  });

  it('is not offered when the server cannot say where its request stands', async () => {
    world.listFails = true;
    await fileRecord();
    const r = await mount();
    expect(text(r)).not.toContain('Ready to rescue');
    expect(button(r, 'Cancel request')).toBeUndefined();
  });

  it('is offered again once its rescue mode ended, beside the request that can no longer be signed', async () => {
    world.mode = 'none';
    await fileRecord();
    const r = await mount();
    expect(text(r)).toContain('Rescue mode has ended');
    expect(text(r)).toContain('Ready to rescue');
    expect(button(r, 'Cancel request')).toBeUndefined();
  });

  it('is offered again once 21st Capital switches rescue mode on again for it after the signature', async () => {
    world.mode = 'active';
    world.status = 'signed';
    world.signedTx = SIGNED;
    await fileRecord();
    const r = await mount();
    expect(text(r)).toContain('Signed and ready to broadcast');
    expect(text(r)).toContain('Ready to rescue');
  });

  it('is offered again once the signed transaction is no longer held (14 days after signing)', async () => {
    world.status = 'signed';
    world.signedTx = '';
    await fileRecord();
    const r = await mount();
    expect(text(r)).toContain('Ready to rescue');
  });

  it('is offered again beside a request 21st Capital rejected', async () => {
    world.status = 'rejected';
    await fileRecord();
    const r = await mount();
    expect(text(r)).toContain('Rejected by 21st Capital');
    expect(text(r)).toContain('Ready to rescue');
  });

  it('opened from the vault’s own page, its request shows instead of the review step', async () => {
    await fileRecord();
    const r = await mount({ walletId: VAULT.id });
    expect(button(r, 'Request rescue')).toBeUndefined();
    expect(text(r)).toContain('Waiting for 21st Capital…');
    expect(button(r, 'Cancel request')).toBeDefined();
  });

  it('opened from the vault’s own page, a rejected request stays to be read: no new rescue starts by itself', async () => {
    world.status = 'rejected';
    await fileRecord();
    const r = await mount({ walletId: VAULT.id });
    await settle(100);
    expect(text(r)).toContain('Rejected by 21st Capital');
    expect(text(r)).toContain('Ready to rescue');
    expect(button(r, 'Request rescue')).toBeUndefined();
  });

  it('with no request at all it is offered as before', async () => {
    world.status = undefined;
    const r = await mount();
    expect(text(r)).toContain('Ready to rescue');
  });
});

describe('Cancel request', () => {
  it('asks first, with a title and buttons only', async () => {
    await fileRecord();
    const r = await mount();
    await act(async () => button(r, 'Cancel request')!.props.onPress());
    expect(dialog(r).props.title).toBe('Cancel this rescue request?');
    expect(dialog(r).props.message).toBe('');
    expect((dialog(r).props.actions as Array<{ label: string }>).map((a) => a.label)).toEqual(['Cancel request', 'Keep it']);
  });

  it('Keep it changes nothing', async () => {
    await fileRecord();
    const r = await mount();
    await act(async () => button(r, 'Cancel request')!.props.onPress());
    await choose(r, 'Keep it');
    expect(world.cancels).toBe(0);
    expect((await loadPendingRescues()).map((p) => p.id)).toEqual(['r1']);
  });

  it('withdraws it at 21st Capital, forgets it, and offers the vault again', async () => {
    await fileRecord();
    const r = await mount();
    await act(async () => button(r, 'Cancel request')!.props.onPress());
    await choose(r, 'Cancel request');
    expect(world.cancels).toBe(1);
    expect(await loadPendingRescues()).toEqual([]);
    expect(text(r)).not.toContain('Waiting for 21st Capital…');
    expect(text(r)).toContain('Ready to rescue');
    await afterClose();
    expect(dialog(r)).toBeUndefined();
  });

  it('on the vault’s own page, a cancel lands on the list: a new rescue is the client’s own tap', async () => {
    await fileRecord();
    const r = await mount({ walletId: VAULT.id });
    await act(async () => button(r, 'Cancel request')!.props.onPress());
    await choose(r, 'Cancel request');
    await afterClose();
    expect(await loadPendingRescues()).toEqual([]);
    expect(text(r)).toContain('Ready to rescue');
    expect(button(r, 'Request rescue')).toBeUndefined();
  });

  it('a second tap on the confirmation sends one cancel', async () => {
    await fileRecord();
    const r = await mount();
    await act(async () => button(r, 'Cancel request')!.props.onPress());
    const action = (dialog(r).props.actions as Array<{ label: string; onPress: (v: string) => void }>)[0];
    await act(async () => {
      action.onPress('');
      action.onPress('');
    });
    await afterClose();
    expect(world.cancels).toBe(1);
  });

  it('the answer waits for the confirmation to close before it opens', async () => {
    world.cancel = { status: 503, body: {} };
    await fileRecord();
    const r = await mount();
    await act(async () => button(r, 'Cancel request')!.props.onPress());
    await choose(r, 'Cancel request');
    expect(dialog(r)).toBeUndefined();
    await afterClose();
    expect(dialog(r).props.title).toBe('Could not reach 21st Capital');
  });

  it('signed meanwhile: says so and keeps the record, and the vault stays off the list', async () => {
    world.cancel = { status: 409, body: { error: 'ALREADY_SIGNED', status: 'signed' } };
    await fileRecord();
    const r = await mount();
    world.status = 'signed';
    world.signedTx = SIGNED;
    world.mode = 'none'; // the signature closed rescue mode
    await act(async () => button(r, 'Cancel request')!.props.onPress());
    await choose(r, 'Cancel request');
    await afterClose();
    expect(dialog(r).props.title).toBe(RESCUE_ALREADY_SIGNED_TITLE);
    expect(dialog(r).props.message).toBe('');
    expect((await loadPendingRescues()).map((p) => p.id)).toEqual(['r1']);
    expect(text(r)).toContain('Signed and ready to broadcast');
    expect(text(r)).not.toContain('Ready to rescue');
  });

  it('no answer from 21st Capital: says so and keeps everything', async () => {
    world.cancel = { status: 503, body: {} };
    await fileRecord();
    const r = await mount();
    await act(async () => button(r, 'Cancel request')!.props.onPress());
    await choose(r, 'Cancel request');
    await afterClose();
    expect(dialog(r).props.title).toBe('Could not reach 21st Capital');
    expect((await loadPendingRescues()).map((p) => p.id)).toEqual(['r1']);
    expect(text(r)).not.toContain('Ready to rescue');
  });

  it('a waiting speed-up says it is one', async () => {
    await fileRecord({ replaces: { id: 'r0', txid: 'b'.repeat(64), coins: [] } });
    const r = await mount();
    await act(async () => button(r, 'Cancel request')!.props.onPress());
    expect(dialog(r).props.title).toBe('Cancel this speed-up?');
  });
});

describe('the server refusing a second request', () => {
  const ALREADY = { error: 'RESCUE_ALREADY_OPEN', message: 'This vault already has a rescue request with us, so we cannot take a second one.' };

  async function request(r: Renderer) {
    await act(async () => hosts(r, 'AddressField')[0].props.onPaste());
    await settle();
    await act(async () => hosts(r, 'ConsentCheckbox')[0].props.onChange(true));
    await act(async () => button(r, 'Request rescue')?.props.onPress());
    await settle();
  }

  it('at the email step: a title, back to the list, and the vault is no longer offered on this visit', async () => {
    world.status = undefined;
    world.otp = { status: 409, body: ALREADY };
    const r = await mount({ walletId: VAULT.id });
    await request(r);
    expect(dialog(r).props.title).toBe(RESCUE_ALREADY_OPEN_TITLE);
    expect(dialog(r).props.message).toBe('');
    expect(hosts(r, 'CodeField')).toEqual([]);
    expect(button(r, 'Request rescue')).toBeUndefined();
    // Greyed with the same words, and not a button.
    expect(text(r)).toContain(RESCUE_ALREADY_OPEN_TITLE);
    expect(text(r)).not.toContain('Ready to rescue');
  });

  it('at filing: a title, nothing kept on the phone, and back to the list', async () => {
    world.status = undefined;
    world.create = { status: 409, body: ALREADY };
    const r = await mount({ walletId: VAULT.id });
    await request(r);
    await act(async () => hosts(r, 'CodeField')[0].props.onComplete('123456'));
    await settle();
    expect(world.created).toBe(1);
    expect(dialog(r).props.title).toBe(RESCUE_ALREADY_OPEN_TITLE);
    expect(hosts(r, 'CodeField')).toEqual([]);
    expect(await loadPendingRescues()).toEqual([]);
    expect(text(r)).toContain(RESCUE_ALREADY_OPEN_TITLE);
    expect(text(r)).not.toContain('Ready to rescue');
  });
});
