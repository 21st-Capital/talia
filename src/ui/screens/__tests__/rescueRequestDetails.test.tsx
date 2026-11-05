/**
 * A filed rescue request opens from its card on the Rescue page (decided
 * 2026-11-03): a rescue is confirmed with the client on a video call, so the
 * client reads back the address, the amount that arrives and the fee. The
 * figures come from the phone's own transaction: the server's PSBT while the
 * request waits, its signed transaction once it is signed (the server wipes
 * the PSBT in that step), and either counts only when its unsigned txid is
 * the one the phone recorded at filing.
 *
 * Mounted with the screen's own wiring; the engine, the session, the server
 * (fetch), storage and the page components (plain hosts) are replaced. The
 * sheet itself is a host here, so what the screen hands it is what is read.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';

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
    AppDialog: () => null,
    SentPage: () => null,
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
    RescueRequestSheet: (p: Record<string, unknown>) => R.createElement('RescueRequestSheet', p),
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
  loadSession: async () => ({ accessToken: 't', email: 'client@example.com' }),
}));
jest.mock('../../../services/settingsApi', () => ({ fetchProfile: async () => ({ twoFactorEnabled: false }) }));
jest.mock('@react-native-async-storage/async-storage', () => require('../../../testing/memoryAsyncStorage'));

import { RescueScreen } from '../RescueScreen';
import { savePendingRescue } from '../../../services/rescue';
import { decodeBase64, encodeBase64 } from '../../../bitcoin/psbt/export';
import { unsignedTxid } from '../../../bitcoin/psbt/parse';

const storage = require('@react-native-async-storage/async-storage').default as {
  setItem: (k: string, v: string) => Promise<void>;
  __clear: () => void;
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

type Renderer = TestRenderer.ReactTestRenderer;

/** The client's Testnet4 address (BIP-173's example) and the vault's coins. */
const DEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const COINS = [
  { txid: 'a1b2' + '00'.repeat(28) + 'c3d4', vout: 0, valueSats: 60_000 },
  { txid: 'e5f6' + '11'.repeat(28) + '0718', vout: 1, valueSats: 41_000 },
];
const vaultKey = HDKey.fromMasterSeed(sha256(utf8ToBytes('rescue-details-screen'))).derive("m/84'/1'/0'/0/0");

function rescuePsbt(paySats: number): string {
  const tx = new btc.Transaction();
  const spk = btc.p2wpkh(vaultKey.publicKey!, btc.TEST_NETWORK).script;
  for (const c of COINS) tx.addInput({ txid: c.txid, index: c.vout, witnessUtxo: { script: spk, amount: BigInt(c.valueSats) } });
  tx.addOutputAddress(DEST, BigInt(paySats), btc.TEST_NETWORK);
  return encodeBase64(tx.toPSBT(0));
}
/** The transaction the phone filed: 100 200 to the client, 800 in fee. */
const FILED = rescuePsbt(100_200);

/** A PSBT signed and finalized by the vault's test key: what 21st Capital
 *  hands back, as raw bytes in hex (what the backend stores). */
function signedHex(psbt: string): string {
  const tx = btc.Transaction.fromPSBT(decodeBase64(psbt)!);
  tx.sign(vaultKey.privateKey!);
  tx.finalize();
  return tx.hex;
}

/** What the server answers, per test. */
const world = {
  status: 'pending' as 'pending' | 'signed',
  /** The PSBT in the server's list; undefined = an older server. */
  requestPsbt: FILED as string | undefined,
  /** The signed transaction, "" until it is signed. */
  signedTx: '',
};

const engine = {
  network: 'testnet',
  listUtxos: jest.fn(async () => COINS.map((c) => ({ ...c, keychain: 'external' as const }))),
  listTransactions: async () => [],
  ownsAddress: async () => false,
  getTipHeight: () => 157_034,
};
const getEngine = jest.fn(async (): Promise<unknown> => engine);

const wallet = {
  id: 'w1',
  label: 'Real test',
  network: 'testnet',
  descriptor: 'tr(xpub/0/*)',
  providerKeyFingerprints: [],
};

function serve() {
  global.fetch = jest.fn((url: string) => {
    const json = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
    if (url.endsWith('/rescue/mode/')) return json({ status: 'active' });
    if (url.endsWith('/rescue/mine/')) {
      return json([
        {
          id: 'r1',
          vault_label: 'Real test',
          destination: 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0',
          amount_sats: 1,
          status: world.status,
          signed_tx: world.signedTx,
          created_at: '2026-11-03T19:30:00Z',
          signed_at: null,
          ...(world.requestPsbt !== undefined ? { request_psbt: world.requestPsbt } : {}),
        },
      ]);
    }
    return json({}, 404);
  }) as unknown as typeof fetch;
}

const realFetch = global.fetch;
afterAll(() => {
  global.fetch = realFetch;
});

const mounted: Renderer[] = [];
const settle = () =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(10);
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
  await settle();
  return r;
}

const isType = (n: TestRenderer.ReactTestInstance, name: string) => (n.type as unknown) === name;
/** The request card's tap: its words, not its buttons. */
const requestTap = (r: Renderer) =>
  r.root.findAll((n) => isType(n, 'TouchableOpacity') && n.props.accessibilityHint === 'Shows its address, amount and fee')[0];
const sheet = (r: Renderer) => r.root.findAll((n) => isType(n, 'RescueRequestSheet'))[0];
const press = (node: TestRenderer.ReactTestInstance) =>
  act(async () => {
    node.props.onPress();
  });

async function openRequest(): Promise<Renderer> {
  const r = await mount();
  const tap = requestTap(r);
  expect(tap).toBeDefined();
  await press(tap);
  await settle();
  return r;
}

beforeEach(async () => {
  jest.useFakeTimers();
  storage.__clear();
  Object.assign(world, { status: 'pending', requestPsbt: FILED, signedTx: '' });
  engine.listUtxos.mockClear();
  getEngine.mockClear();
  mockWallets.value = {
    wallets: [],
    syncWallet: async () => engine,
    getWallet: (id: string) => (id === 'w1' ? wallet : undefined),
    getEngine,
    settings: { electrumUrls: {}, unit: 'btc', hideBalances: false },
  };
  serve();
  await savePendingRescue({
    id: 'r1',
    walletId: 'w1',
    vaultLabel: 'Real test',
    createdAt: Date.parse('2026-11-03T19:30:00Z'),
    destination: DEST,
    requestTxid: unsignedTxid(FILED)!,
  });
});

afterEach(async () => {
  await act(async () => {
    for (const r of mounted.splice(0)) r.unmount();
  });
  jest.useRealTimers();
});

describe('a waiting request opens', () => {
  it('on its words, with the figures read from the phone’s own transaction', async () => {
    const r = await openRequest();
    const s = sheet(r);
    expect(s.props.title).toBe('Waiting for 21st Capital…');
    expect(s.props.vaultName).toBe('Real test');
    // The phone's record, never the server's copy of the address.
    expect(s.props.destination).toBe(DEST);
    expect(s.props.askedOn).toEqual(expect.any(String));
    expect(s.props.facts).toEqual({
      kind: 'figures',
      destination: DEST,
      arrivesSats: 100_200,
      feeSats: 800,
      leavesSats: 101_000,
      coins: 2,
    });
    expect(s.props.masked).toBe(false);
  });

  it('asks the engine only for what the cached coin list cannot answer', async () => {
    await storage.setItem(
      'keel.utxocache.v1:w1',
      JSON.stringify({ utxos: COINS.map((c) => ({ ...c, keychain: 'external' })), at: Date.now() }),
    );
    const r = await openRequest();
    expect(sheet(r).props.facts).toMatchObject({ kind: 'figures', feeSats: 800 });
    expect(getEngine).not.toHaveBeenCalled();
  });

  it('shows no figures when the server holds another transaction', async () => {
    world.requestPsbt = rescuePsbt(100_100);
    const r = await openRequest();
    expect(sheet(r).props.facts).toEqual({ kind: 'unchecked', destination: DEST, reason: 'other-transaction' });
  });

  it('shows no figures from a server that sends no transaction, and once it is wiped', async () => {
    for (const requestPsbt of [undefined, '']) {
      world.requestPsbt = requestPsbt;
      const r = await openRequest();
      expect(sheet(r).props.facts).toEqual({ kind: 'unchecked', destination: DEST, reason: 'no-transaction' });
      await act(async () => {
        r.unmount();
      });
    }
  });

  it('keeps the figures hidden while balances are hidden', async () => {
    (mockWallets.value.settings as Record<string, unknown>).hideBalances = true;
    const r = await openRequest();
    expect(sheet(r).props.masked).toBe(true);
  });

  it('closes with Done', async () => {
    const r = await openRequest();
    await act(async () => {
      (sheet(r).props.onClose as () => void)();
    });
    expect(sheet(r)).toBeUndefined();
  });
});

describe('a signed request opens too, and its button stays its own', () => {
  /** A signed request as the backend answers it: the PSBT wiped in the same
   *  step that stored the signature, the signed transaction in its place. */
  const signedWorld = (signedTx: string) => Object.assign(world, { status: 'signed', requestPsbt: '', signedTx });

  it('the Broadcast button is outside the tap, so a tap on it never opens the sheet', async () => {
    signedWorld(signedHex(FILED));
    const r = await mount();
    const tap = requestTap(r);
    expect(tap).toBeDefined();
    expect(tap.findAll((n) => isType(n, 'Button'))).toEqual([]);
    const card = r.root.findAll((n) => isType(n, 'Card') && n.findAll((m) => m === tap).length > 0)[0];
    expect(card.findAll((n) => isType(n, 'Button')).map((b) => b.props.title)).toEqual(['Broadcast rescue']);

    await press(tap);
    await settle();
    expect(sheet(r).props.title).toBe('Signed and ready to broadcast');
    // Read from the signed transaction: the PSBT is gone by now.
    expect(sheet(r).props.destination).toBe(DEST);
    expect(sheet(r).props.facts).toEqual({
      kind: 'figures',
      destination: DEST,
      arrivesSats: 100_200,
      feeSats: 800,
      leavesSats: 101_000,
      coins: 2,
    });
  });

  it('shows no figures when 21st Capital signed a different transaction', async () => {
    signedWorld(signedHex(rescuePsbt(100_100)));
    const r = await openRequest();
    expect(sheet(r).props.title).toBe('Signed and ready to broadcast');
    expect(sheet(r).props.facts).toEqual({ kind: 'unchecked', destination: DEST, reason: 'other-transaction' });
  });
});
