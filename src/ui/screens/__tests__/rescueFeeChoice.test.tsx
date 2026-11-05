/**
 * The fee of a rescue, chosen on its review step (decided 2026-10-31): the
 * Priority choice Send uses, High preselected, with what the client will pay
 * on the page. The screen, the rescue service and the fee tiers are real; the
 * page's other parts, the vault, the session and the server (fetch) are
 * replaced. mempool.space answers through the same fetch.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const DEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const OWN_FIRST = 'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0c';

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
    FactRow: (p: { label: string; value: string; sub?: string }) =>
      R.createElement('FactRow', null, ...[p.label, p.value, p.sub].map((line) => R.createElement('Text', null, line))),
    SentPage: () => null,
    PageHead: (p: { title: string }) => R.createElement('PageHead', { title: p.title }),
    ConsentCheckbox: (p: Record<string, unknown>) => R.createElement('ConsentCheckbox', p),
    ChevronRightIcon: 'ChevronRightIcon',
    InfoHeading: host('InfoHeading'),
    BookingSheet: () => null,
    CodeField: (p: Record<string, unknown>) => R.createElement('CodeField', p),
    AuthenticatorStep: host('AuthenticatorStep'),
    FeeSheet: (p: Record<string, unknown>) => R.createElement('FeeSheet', p),
    feeSheetStyles: {},
    sentWords: () => ({}),
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
jest.mock('../../../platform/clipboard', () => ({ readClipboard: async () => mockClip.text }));
const mockClip = { text: '' };
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
import { EngineError } from '../../../bitcoin/engine/engineError';
import { loadPendingRescues, RESCUE_FEE_REFUSED_TITLE } from '../../../services/rescue';

const storage = require('@react-native-async-storage/async-storage').default as { __clear: () => void };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;
type Req = { destination: string; feeRate: number };

const COIN = { txid: 'a'.repeat(64), vout: 0, valueSats: 500_000, keychain: 'external' };
/** BDK's size for these coins: fee over rate. */
const SIZE = 288;
const world = {
  refuseFee: false,
  buildFails: null as Error | null,
  created: [] as Array<Record<string, unknown>>,
  otps: 0,
  /** The coins cannot pay this rate or more. */
  cannotPayFrom: null as number | null,
  /** The first build at this rate never answers: a preview still on its way. */
  previewHeldAt: null as number | null,
  /** What every build pays, whatever the rate. */
  fixedFee: null as number | null,
};

const engine = {
  network: 'testnet',
  listUtxos: async () => [COIN],
  listTransactions: async () => [{ txid: COIN.txid, blockHeight: 1 }],
  ownsAddress: async () => false,
  getTipHeight: () => 900_000,
  getReceiveAddress: async () => ({ address: OWN_FIRST, index: 0 }),
  buildRescuePsbt: jest.fn(async (r: Req): Promise<{ psbtBase64: string; feeSats: number }> => {
    if (world.previewHeldAt === r.feeRate) {
      world.previewHeldAt = null;
      await new Promise(() => {});
    }
    if (world.buildFails) throw world.buildFails;
    if (world.cannotPayFrom != null && r.feeRate >= world.cannotPayFrom) {
      throw new EngineError('INSUFFICIENT_FUNDS', 'Insufficient funds: 10 sat available of 20 sat needed');
    }
    return { psbtBase64: 'cHNidP8=', feeSats: world.fixedFee ?? Math.ceil(r.feeRate * SIZE) };
  }),
};

const VAULT = { id: 'v2', label: 'Savings', network: 'testnet', descriptor: 'tr(xpub/0/*)', providerKeyFingerprints: ['aabbccdd'] };

function serve() {
  global.fetch = jest.fn((url: string, init?: { method?: string; body?: string }) => {
    const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    if (url.includes('fees/precise')) return json({ fastestFee: 12, halfHourFee: 6, hourFee: 3 });
    if (url.endsWith('/rescue/mode/')) return json({ status: 'active' });
    if (url.endsWith('/rescue/mine/')) {
      // A filed request is listed, or the phone forgets its record of it.
      return json(world.created.map(() => ({ id: 'r1', status: 'pending', vault_label: 'Savings', signed_tx: '' })));
    }
    if (url.endsWith('/rescue/otp/')) {
      world.otps += 1;
      return json({ sent: true });
    }
    if (url.endsWith('/rescue/requests/') && init?.method === 'POST') {
      world.created.push(JSON.parse(init.body ?? '{}'));
      if (world.refuseFee) {
        return json({ error: 'FEE_NOT_SANE', message: 'We could not accept the fee of the rescue transaction your app prepared.' }, 400);
      }
      return json({ id: 'r1', status: 'pending' }, 201);
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
const feeSheet = (r: Renderer) => hosts(r, 'FeeSheet')[0];
const dialogs = (r: Renderer) => hosts(r, 'AppDialog').map((d) => [d.props.title, d.props.message]);

async function openReview(): Promise<Renderer> {
  mockWallets.value = {
    wallets: [VAULT],
    settings: { electrumUrls: {}, fiat: 'USD', unit: 'BTC', btcOnly: true },
    getWallet: () => VAULT,
    getEngine: async () => engine,
    syncWallet: async () => engine,
  };
  let r!: Renderer;
  const navigation = { addListener: () => () => {}, goBack: () => {}, navigate: () => {} };
  await act(async () => {
    r = TestRenderer.create(
      React.createElement(RescueScreen as unknown as React.ComponentType<Record<string, unknown>>, {
        navigation,
        route: { params: { walletId: VAULT.id } },
      }),
    );
    await new Promise((res) => setTimeout(res, 20));
  });
  return r;
}

const settle = () => act(async () => new Promise((res) => setTimeout(res, 20)));

async function paste(r: Renderer, address: string) {
  mockClip.text = address;
  await act(async () => hosts(r, 'AddressField')[0].props.onPaste());
  await settle();
}

async function agreeAndRequest(r: Renderer) {
  await act(async () => hosts(r, 'ConsentCheckbox')[0].props.onChange(true));
  await act(async () => button(r, 'Request rescue')?.props.onPress());
  await settle();
}

async function typeCode(r: Renderer) {
  await act(async () => hosts(r, 'CodeField')[0].props.onComplete('123456'));
  await settle();
}

beforeEach(() => {
  storage.__clear();
  world.refuseFee = false;
  world.buildFails = null;
  world.created = [];
  world.otps = 0;
  world.cannotPayFrom = null;
  world.previewHeldAt = null;
  world.fixedFee = null;
  engine.buildRescuePsbt.mockClear();
  serve();
});

const lastBuild = () => engine.buildRescuePsbt.mock.calls.at(-1)?.[0] as Req;

describe('the fee on the review step', () => {
  it('opens on High, with what it pays and what arrives, from a build of these coins', async () => {
    const r = await openReview();
    const page = text(r);
    expect(page).toContain(`High ≈ ${12 * SIZE} sats`);
    expect(page).toContain('Network fee');
    expect(page).toContain(`${12 * SIZE} sats`);
    expect(page).toContain('12 sat/vB');
    expect(page).toContain('Arrives');
    expect(page).toContain(`${(500_000 - 12 * SIZE) / 1e8} BTC`);
  });

  it('until an address lands, the vault’s first address stands in for the build', async () => {
    const r = await openReview();
    expect(lastBuild().destination).toBe(OWN_FIRST);
    await paste(r, DEST);
    expect(lastBuild().destination).toBe(DEST);
  });

  it('counts the coins when no build answers, and the page still stands', async () => {
    world.buildFails = new Error('not built');
    const r = await openReview();
    expect(text(r)).toContain(`High ≈ ${12 * (54 + 110)} sats`);
  });

  it('files what was on the page: High unless the client chose otherwise', async () => {
    const r = await openReview();
    await paste(r, DEST);
    await agreeAndRequest(r);
    await typeCode(r);
    expect(lastBuild()).toMatchObject({ destination: DEST, feeRate: 12 });
    expect(world.created[0].request_psbt).toBe('cHNidP8=');
  });

  it('files the tier the client picked, and the sheet closes on it', async () => {
    const r = await openReview();
    await act(async () => feeSheet(r).props.onClose());
    await act(async () => feeSheet(r).props.rows[2].onPress());
    await settle();
    expect(feeSheet(r).props.visible).toBe(false);
    expect(text(r)).toContain(`Slow ≈ ${3 * SIZE} sats`);
    await paste(r, DEST);
    await agreeAndRequest(r);
    await typeCode(r);
    expect(lastBuild().feeRate).toBe(3);
  });

  it('files the client’s own rate', async () => {
    const r = await openReview();
    await act(async () => feeSheet(r).props.custom.onChangeText('7.5'));
    await settle();
    expect(feeSheet(r).props.custom.on).toBe(true);
    expect(text(r)).toContain('Custom ≈');
    await paste(r, DEST);
    await agreeAndRequest(r);
    await typeCode(r);
    expect(lastBuild().feeRate).toBe(7.5);
  });

  it('shows the build’s own fee, to the satoshi', async () => {
    // 2,003 over 7 and back rounds up to 2,004.
    world.fixedFee = 2_003;
    const r = await openReview();
    await act(async () => feeSheet(r).props.custom.onChangeText('7'));
    await settle();
    expect(text(r)).toContain('Custom ≈ 2003 sats');
    expect(text(r)).not.toContain('2004 sats');
    expect(text(r)).toContain(`${(500_000 - 2_003) / 1e8} BTC`);
  });

  it('promises no speed-up: it takes this phone’s record and 21st Capital’s word', async () => {
    const r = await openReview();
    const about = hosts(r, 'InfoHeading').find((h) => h.props.title === 'When the fee is set');
    expect(about?.props.text).toBe(
      'The fee is set now, and the rescue goes out later. If it is slow to confirm then, a speed-up may be offered on this page.',
    );
  });

  it('a first rescue’s code step says it sends everything', async () => {
    const r = await openReview();
    await paste(r, DEST);
    await agreeAndRequest(r);
    expect(text(r)).toContain('The rescue sends everything this vault holds there.');
  });

  it('a fee the coins cannot pay is refused with a title before any email goes out', async () => {
    world.buildFails = new EngineError('INSUFFICIENT_FUNDS', 'Insufficient funds: 10 sat available of 20 sat needed');
    const r = await openReview();
    await paste(r, DEST);
    await agreeAndRequest(r);
    expect(dialogs(r)).toEqual([['The coins cannot pay this fee', '']]);
    expect(world.otps).toBe(0);
  });
});

describe('while the request goes out', () => {
  it('the fee is locked with the address: what was on the page is what is filed', async () => {
    const r = await openReview();
    await paste(r, DEST);
    await act(async () => hosts(r, 'ConsentCheckbox')[0].props.onChange(true));
    const held: { release?: (v: unknown) => void } = {};
    const fetched = global.fetch as unknown as (u: string, i?: unknown) => Promise<unknown>;
    global.fetch = ((url: string, init?: unknown) =>
      url.endsWith('/rescue/otp/')
        ? new Promise((res) => {
            held.release = res;
          })
        : fetched(url, init)) as unknown as typeof fetch;
    await act(async () => void button(r, 'Request rescue')?.props.onPress());
    const field = r.root.findAll((n) => (n.type as unknown) === 'TouchableOpacity' && n.props.accessibilityLabel === 'Change the priority')[0];
    expect(field.props.disabled).toBe(true);
    await act(async () => held.release?.({ ok: true, status: 200, json: async () => ({ sent: true }) }));
  });
});

describe('a fee the server will not take (FEE_NOT_SANE)', () => {
  it('is a title and OK, back where the fee is chosen, with nothing filed on this phone', async () => {
    world.refuseFee = true;
    const r = await openReview();
    await paste(r, DEST);
    await agreeAndRequest(r);
    await typeCode(r);
    expect(dialogs(r)).toEqual([[RESCUE_FEE_REFUSED_TITLE, '']]);
    expect(text(r)).toContain('Network fee');
    expect(text(r)).not.toContain('could not accept');
    expect(await loadPendingRescues()).toEqual([]);
  });
});

describe('a preview of another rate', () => {
  it('does not refuse this one', async () => {
    world.cannotPayFrom = 12;
    const r = await openReview();
    await paste(r, DEST);
    await settle();
    world.previewHeldAt = 3;
    await act(async () => feeSheet(r).props.rows[2].onPress());
    await settle();
    await agreeAndRequest(r);
    expect(dialogs(r)).toEqual([]);
    expect(world.otps).toBe(1);
  });

  it('does not let this one through: the coins cannot pay it, and no email goes out', async () => {
    const r = await openReview();
    await paste(r, DEST);
    world.cannotPayFrom = 900;
    world.previewHeldAt = 999;
    await act(async () => feeSheet(r).props.custom.onChangeText('999'));
    await settle();
    await agreeAndRequest(r);
    expect(dialogs(r)).toEqual([['The coins cannot pay this fee', '']]);
    expect(world.otps).toBe(0);
    expect(world.created).toEqual([]);
  });
});

describe('a build that fails', () => {
  it('still files the request without its transaction: a rescue is never blocked here', async () => {
    world.buildFails = new EngineError('ADDRESS_CHECK_FAILED', 'Sending is paused for this vault');
    const r = await openReview();
    await paste(r, DEST);
    await agreeAndRequest(r);
    expect(dialogs(r)).toEqual([]);
    expect(world.otps).toBe(1);
    await typeCode(r);
    expect(world.created[0].request_psbt).toBe('');
    expect((await loadPendingRescues()).length).toBe(1);
  });

  it.each<[string, Error]>([
    ['the address check pauses it', new EngineError('ADDRESS_CHECK_FAILED', 'Sending is paused for this vault')],
    ['anything else', new Error('not built')],
  ])('only at the code, when %s: the request still goes, without its transaction', async (_name, failure) => {
    const r = await openReview();
    await paste(r, DEST);
    await agreeAndRequest(r);
    world.buildFails = failure;
    await typeCode(r);
    expect(dialogs(r)).toEqual([]);
    expect(world.created[0].request_psbt).toBe('');
    const [record] = await loadPendingRescues();
    expect(record.requestTxid).toBeUndefined();
  });

  it('the coins no longer pay the fee at the code: a title, nothing filed, back where a lower fee can be chosen', async () => {
    const r = await openReview();
    await paste(r, DEST);
    await agreeAndRequest(r);
    world.buildFails = new EngineError('INSUFFICIENT_FUNDS', 'Insufficient funds: 10 sat available of 20 sat needed');
    await typeCode(r);
    expect(world.created).toEqual([]);
    expect(dialogs(r)).toEqual([['The coins cannot pay this fee', '']]);
    expect(text(r)).toContain('Network fee');
    expect(await loadPendingRescues()).toEqual([]);
  });

  it('the coins no longer pay the fee at Resend: the same, and no email', async () => {
    const r = await openReview();
    await paste(r, DEST);
    await agreeAndRequest(r);
    world.cannotPayFrom = 1;
    await act(async () => hosts(r, 'CodeField')[0].props.onAlternative());
    await settle();
    expect(dialogs(r)).toEqual([['The coins cannot pay this fee', '']]);
    expect(text(r)).toContain('Network fee');
    expect(world.otps).toBe(1);
  });
});
