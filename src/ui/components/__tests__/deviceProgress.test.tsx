/**
 * The drawings draw what the hint's clock gives them (decided 2026-10-04: with
 * the `progress` prop taken off every drawing, or the up arrow, the
 * confirmation or the touch ring deleted, every test stayed green while the
 * Nova's Total lost the whole two-edge sequence). Mounted over the small
 * React Native stand-in, with a sentinel for each value, so each test finds
 * the view a value is bound to and checks what that view holds:
 *
 *   the Nova's Total   the down arrow at the top right sliding by `downY`,
 *                      the up arrow at the bottom right shown by `up`,
 *                      rising by `upRise` and sliding by `upY`, both in the
 *                      page's layer (`page`), and "Transaction confirmed" in
 *                      a layer of its own (`confirmed`);
 *   the touchscreens   the thin line along the "Hold to sign" row's top
 *                      edge scaled by `line`, the page's ink by `page`,
 *                      "Signing transaction" by `signing` (the recording);
 *   DeviceArt          hands each its own kind of progress, and nothing to
 *                      a drawing that has none.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestInstance } from 'react-test-renderer';
import { Animated } from 'react-native';
import { DeviceArt } from '../DeviceArt';
import type { DeviceProgress } from '../DeviceArt';
import { FlexArt, Gen5Art, StaxArt, gen5Anchors, flexAnchors, staxAnchors } from '../LedgerTouchArt';
import type { TouchProgress } from '../LedgerTouchArt';
import { NovaArt, novaAnchors } from '../NovaArt';
import type { NovaProgress, NovaUnlockProgress } from '../NovaArt';
import { EINK_PAGE, NOVA_HOLD_ARROW, einkUnit, novaHoldArrows } from '../deviceScreenLayout';
import { NanoXArt } from '../NanoXArt';
import { reviewPages } from '../../hww/signingDevice';
import type { DeviceDrawing, DeviceScreen, TourFacts } from '../../hww/signingDevice';
import { registerFacts, registerPages } from '../../hww/vaultRegistration';
import { addressFacts, addressPages, novaAddressGroups } from '../../hww/addressCheck';
import { MULTISIG_2_OF_3 } from '../../../bitcoin/descriptor/__fixtures__/descriptors';

/** The 2-of-3 test vault as the device holding its second key sees it. */
const REG = registerFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, 'a1b2c3d4')!;

jest.mock('react-native', () => require('../../__tests__/rnStub').reactNative);
jest.mock('react-native-svg', () => require('../../__tests__/rnStub').svg);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEDGER: TourFacts = {
  brand: 'ledger',
  network: 'bitcoin',
  registeredName: 'Family vault',
  nameFirst: false,
  bitboxKind: null,
  outputs: [{ address: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', amountSats: 1_250_000 }],
  feeSats: 1200,
  lockTime: null,
};
const NOVA: TourFacts = { ...LEDGER, brand: 'bitbox', bitboxKind: { kind: 'multisig', threshold: 2, keys: 3 } };

/** The last review page of a device, as the tour shows it. */
function signPage(d: DeviceDrawing, f: TourFacts): DeviceScreen {
  const pages = reviewPages(d, f);
  return { kind: 'review', page: pages[pages.length - 1], index: pages.length - 1, total: pages.length };
}

/** A value of the clock nothing else can be: an Animated.Value of its own. */
const sentinel = () => new Animated.Value(0);

function novaProgress(): NovaProgress {
  return { kind: 'nova', page: sentinel(), confirmed: sentinel(), up: sentinel(), upRise: sentinel(), downY: sentinel(), upY: sentinel() };
}
function touchProgress(): TouchProgress {
  return { kind: 'touch', line: sentinel(), page: sentinel(), signing: sentinel() };
}
/** A turn in degrees is a string interpolation on the phone; here a sentinel of its own. */
const sentinelDeg = () => new Animated.Value(0) as unknown as NovaUnlockProgress['turn'];
function unlockProgress(): NovaUnlockProgress {
  return { kind: 'nova-unlock', turn: sentinelDeg(), ccw: sentinel(), cw: sentinel(), downY: sentinel(), upY: sentinel(), shackle: sentinelDeg() };
}

const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

async function mount(el: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(el);
  });
  return r;
}

type Style = Record<string, unknown> & { transform?: Record<string, unknown>[] };
const styleOf = (n: ReactTestInstance): Style => Object.assign({}, ...[n.props.style].flat(5).filter(Boolean));
const isType = (n: ReactTestInstance, t: string) => (n.type as unknown) === t;
/** The Animated.Views whose opacity, or one of whose transforms, is `v`. */
const boundOpacity = (root: ReactTestInstance, v: unknown) => root.findAll((n) => isType(n, 'Animated.View') && styleOf(n).opacity === v);
const boundShift = (root: ReactTestInstance, v: unknown) =>
  root.findAll((n) => isType(n, 'Animated.View') && (styleOf(n).transform ?? []).some((t) => t.translateY === v));
const boundShiftX = (root: ReactTestInstance, v: unknown) =>
  root.findAll((n) => isType(n, 'Animated.View') && (styleOf(n).transform ?? []).some((t) => t.translateX === v));
const boundScale = (root: ReactTestInstance, v: unknown) =>
  root.findAll((n) => isType(n, 'Animated.View') && (styleOf(n).transform ?? []).some((t) => t.scaleX === v));
const boundRotate = (root: ReactTestInstance, v: unknown) =>
  root.findAll((n) => isType(n, 'Animated.View') && (styleOf(n).transform ?? []).some((t) => t.rotate === v));
const one = (list: ReactTestInstance[], what: string): ReactTestInstance => {
  expect({ what, count: list.length }).toEqual({ what, count: 1 });
  return list[0];
};
const paths = (n: ReactTestInstance) => n.findAll((x) => isType(x, 'Path')).map((x) => x.props.d as string);
const words = (n: ReactTestInstance) => n.findAll((x) => isType(x, 'Text')).map((x) => [x.props.children].flat().join(''));
const within = (inner: ReactTestInstance, outer: ReactTestInstance) => {
  for (let n: ReactTestInstance | null = inner; n; n = n.parent) if (n === outer) return true;
  return false;
};

/** The Total page's two arrows, by their shape (`NOVA_HOLD_ARROW`, 10 x 8). */
const DOWN = 'M0 0 H10 L5 8 Z';
const UP = 'M0 8 H10 L5 0 Z';

describe('the Nova’s Total draws the two-edge hold from the clock', () => {
  const width = 205;
  const px = novaAnchors(width).px;
  const arrows = novaHoldArrows();

  it('the down arrow at the top right slides by downY; the up arrow at the bottom right comes in by up and upRise and slides by upY', async () => {
    const p = novaProgress();
    const r = await mount(<NovaArt width={width} screen={signPage('nova', NOVA)} lit progress={p} />);
    const page = one(boundOpacity(r.root, p.page), 'the Total page’s layer');
    // The down arrow: at the top, bound to downY.
    const down = one(boundShift(r.root, p.downY), 'downY');
    expect(paths(down)).toEqual([DOWN]);
    expect(styleOf(down)).toMatchObject({ top: px * arrows.downTop, right: px * NOVA_HOLD_ARROW.right });
    // The up arrow: at the bottom, bound to upY, shown by up, rising by upRise.
    const slide = one(boundShift(r.root, p.upY), 'upY');
    expect(styleOf(slide)).toMatchObject({ top: px * arrows.upTop, right: px * NOVA_HOLD_ARROW.right });
    const shown = one(boundOpacity(slide, p.up), 'up');
    expect((styleOf(shown).transform ?? []).map((t) => t.translateY)).toEqual([p.upRise]);
    expect(paths(shown)).toEqual([UP]);
    // The down arrow above the up one, in the same column: sliding by +downY
    // and -upY (useHintMotion's signs, signingTour.test) they meet between.
    expect(arrows.downTop).toBeLessThan(arrows.upTop);
    expect(arrows.travel).toBeGreaterThan(0);
    // Both in the page's layer, which goes when the device confirms.
    expect(within(down, page) && within(slide, page)).toBe(true);
    expect(words(page).join(' ')).toMatch(/Total/);
    await act(async () => r.unmount());
  });

  it('"Transaction confirmed" is a layer of its own, bound to confirmed, outside the page’s', async () => {
    const p = novaProgress();
    const r = await mount(<NovaArt width={width} screen={signPage('nova', NOVA)} lit progress={p} />);
    const page = one(boundOpacity(r.root, p.page), 'the Total page’s layer');
    const confirmed = one(boundOpacity(r.root, p.confirmed), 'confirmed');
    expect(words(confirmed)).toEqual(['Transaction', 'confirmed']);
    expect(within(confirmed, page)).toBe(false);
    expect(paths(confirmed).filter((d) => d === UP || d === DOWN)).toEqual([]);
    await act(async () => r.unmount());
  });

  it('without the clock the page stands still, as photo nova-5: the down arrow alone, no confirmation', async () => {
    const r = await mount(<NovaArt width={width} screen={signPage('nova', NOVA)} lit />);
    expect(paths(r.root).filter((d) => d === DOWN || d === UP)).toEqual([DOWN]);
    expect(words(r.root)).not.toContain('confirmed');
    await act(async () => r.unmount());
  });
});

describe('the Nova after it is plugged in draws its guide from the clock (decided 2026-10-04, photos 56 to 62 and the recording)', () => {
  const width = 205;

  it('the side page: two glyphs of the turning arrow, one shown by ccw and one by cw, both turned by turn; the words top and bottom', async () => {
    const p = unlockProgress();
    const r = await mount(<NovaArt width={width} screen={{ kind: 'nova-side' }} lit progress={p} />);
    const turned = boundRotate(r.root, p.turn);
    expect(turned).toHaveLength(2);
    const ccw = one(boundOpacity(r.root, p.ccw), 'ccw');
    const cw = one(boundOpacity(r.root, p.cw), 'cw');
    expect(turned).toEqual(expect.arrayContaining([ccw, cw]));
    // Each glyph is the arc and its head; the anticlockwise one is the mirror.
    for (const g of [ccw, cw]) expect(paths(g)).toHaveLength(2);
    const mirrored = (n: ReactTestInstance) => n.findAll((x) => isType(x, 'Svg')).some((x) => ([x.props.style].flat().filter(Boolean) as Style[]).some((st) => (st.transform ?? []).some((t) => t.scaleX === -1)));
    expect([mirrored(ccw), mirrored(cw)]).toEqual([true, false]);
    expect(words(r.root)).toEqual(['Tap this side', 'Tap this side']);
    // The first is turned round for the person facing the other way.
    const texts = r.root.findAll((x) => isType(x, 'Text'));
    expect(texts.map((t) => (styleOf(t).transform ?? []).some((x) => x.rotate === '180deg'))).toEqual([true, false]);
    await act(async () => r.unmount());
    // Without the clock: the first glyph, still.
    const still = await mount(<NovaArt width={width} screen={{ kind: 'nova-side' }} lit />);
    expect(boundRotate(still.root, p.turn)).toHaveLength(0);
    expect(still.root.findAll((x) => isType(x, 'Svg') && paths(x).length === 2)).toHaveLength(1);
    await act(async () => still.unmount());
  });

  it('the confirmation: both arrows at once, the down one sliding by downY and the up one by upY, no layer for the up arrow to come in', async () => {
    const p = unlockProgress();
    const r = await mount(<NovaArt width={width} screen={{ kind: 'nova-confirm', entered: 2, last: '3' }} lit progress={p} />);
    const px = novaAnchors(width).px;
    const arrows = novaHoldArrows();
    const down = one(boundShift(r.root, p.downY), 'downY');
    expect(paths(down)).toEqual([DOWN]);
    expect(styleOf(down)).toMatchObject({ top: px * arrows.downTop, right: px * NOVA_HOLD_ARROW.right });
    const up = one(boundShift(r.root, p.upY), 'upY');
    expect(paths(up)).toEqual([UP]);
    expect(styleOf(up)).toMatchObject({ top: px * arrows.upTop, right: px * NOVA_HOLD_ARROW.right });
    expect(boundOpacity(r.root, p.ccw).concat(boundOpacity(r.root, p.cw))).toEqual([]);
    expect(words(r.root)).toEqual(['•3']);
    await act(async () => r.unmount());
  });

  it('the password page: the entry, the groups and the down arrow, nothing of the clock', async () => {
    const p = unlockProgress();
    const r = await mount(<NovaArt width={width} screen={{ kind: 'nova-password', entered: 1, last: '6', groups: ['3', '4', '5'], depth: 1 }} lit progress={p} />);
    expect(words(r.root)).toEqual(['<', 'abc', '6_', '3', '4', '5']);
    expect(paths(r.root).filter((d) => d === DOWN)).toHaveLength(1);
    expect([...boundShift(r.root, p.downY), ...boundShift(r.root, p.upY), ...boundRotate(r.root, p.turn), ...boundRotate(r.root, p.shackle)]).toEqual([]);
    await act(async () => r.unmount());
  });

  it('the lock: the shackle turned by shackle about its left foot; without the clock, closed', async () => {
    const p = unlockProgress();
    const r = await mount(<NovaArt width={width} screen={{ kind: 'nova-lock' }} lit progress={p} />);
    const shackle = one(boundRotate(r.root, p.shackle), 'shackle');
    expect(styleOf(shackle)).toMatchObject({ transformOrigin: 'left bottom' });
    expect(paths(shackle)).toHaveLength(1);
    expect(paths(shackle)[0]).toMatch(/ A/);
    expect(words(r.root)).toEqual([]);
    await act(async () => r.unmount());
    const still = await mount(<NovaArt width={width} screen={{ kind: 'nova-lock' }} lit />);
    expect(boundRotate(still.root, p.shackle)).toHaveLength(0);
    expect(paths(still.root).filter((d) => / A/.test(d))).toHaveLength(1);
    await act(async () => still.unmount());
  });

  it('the splash: the name alone', async () => {
    const r = await mount(<NovaArt width={width} screen={{ kind: 'nova-splash' }} lit progress={unlockProgress()} />);
    expect(words(r.root)).toEqual(['BitBox02 Nova']);
    await act(async () => r.unmount());
  });

  it('DeviceArt hands the Nova its unlock progress, and a Ledger none of it', async () => {
    const p = unlockProgress();
    const r = await mount(<DeviceArt drawing="nova" width={width} screen={{ kind: 'nova-side' }} lit progress={p} />);
    expect(boundRotate(r.root, p.turn)).toHaveLength(2);
    await act(async () => r.unmount());
    for (const d of ['gen5', 'nanoX'] as const) {
      const g = await mount(<DeviceArt drawing={d} width={d === 'nanoX' ? 250 : 176} screen={{ kind: 'nova-side' }} lit progress={p} />);
      expect(boundRotate(g.root, p.turn)).toHaveLength(0);
      expect(words(g.root)).not.toContain('Tap this side');
      await act(async () => g.unmount());
    }
  });
});

describe('the touchscreens draw the device’s own hold from the clock (decided 2026-10-04, the recording)', () => {
  const MODELS = [
    { d: 'gen5' as const, Art: Gen5Art, anchors: gen5Anchors, ts: 1 },
    { d: 'flex' as const, Art: FlexArt, anchors: flexAnchors, ts: 0.9 },
    { d: 'stax' as const, Art: StaxArt, anchors: staxAnchors, ts: 0.95 },
  ];

  it('a thin line along the row’s top edge, the screen wide, scaled from its left end by `line`; the page by `page`; "Signing transaction" by `signing`', async () => {
    for (const { d, Art, anchors, ts } of MODELS) {
      const p = touchProgress();
      const r = await mount(<Art width={176} screen={signPage(d, LEDGER)} lit progress={p} />);
      const { w: W, h: H } = anchors(176).screen;
      // The line: on the rule the "Hold to sign" row hangs from, as wide as
      // the screen, a hair thick, growing from the left (a scale, never a width).
      const line = one(boundScale(r.root, p.line), `${d} line`);
      const lineH = einkUnit(EINK_PAGE.type.holdLine, W, ts);
      expect(styleOf(line)).toMatchObject({ left: 0, width: W, height: lineH, transformOrigin: 'left' });
      expect(styleOf(line).top as number).toBeCloseTo(EINK_PAGE.sign.rule * H - lineH / 2, 6);
      // The page's layer holds the sign page and the line; the signing layer
      // holds "Signing transaction", outside it. No ring, no arc.
      const page = one(boundOpacity(r.root, p.page), `${d} page`);
      expect(within(line, page)).toBe(true);
      expect(words(page).join(' ')).toMatch(/Hold to sign/);
      const signing = one(boundOpacity(r.root, p.signing), `${d} signing`);
      expect(within(signing, page)).toBe(false);
      expect(words(signing)).toEqual(['Signing transaction']);
      expect(paths(r.root).filter((x) => / A/.test(x))).toEqual([]);
      await act(async () => r.unmount());
    }
  });

  it('without the clock, or on a page that is not the last, no line and no signing layer', async () => {
    for (const { d, Art } of MODELS) {
      const still = await mount(<Art width={176} screen={signPage(d, LEDGER)} lit />);
      const p = touchProgress();
      expect([...boundScale(still.root, p.line), ...boundOpacity(still.root, p.page), ...boundOpacity(still.root, p.signing)]).toEqual([]);
      expect(words(still.root)).not.toContain('Signing transaction');
      await act(async () => still.unmount());
      const first: DeviceScreen = { kind: 'review', page: reviewPages(d, LEDGER)[0], index: 0, total: 4 };
      const r = await mount(<Art width={176} screen={first} lit progress={p} />);
      expect([...boundScale(r.root, p.line), ...boundOpacity(r.root, p.page), ...boundOpacity(r.root, p.signing)]).toEqual([]);
      await act(async () => r.unmount());
    }
  });
});

describe('registering the vault is drawn from the clock and the facts (the three videos, 2026-10-04)', () => {
  const width = 205;
  /** A registration page of a device, as the turn shows it. */
  const regPage = (d: DeviceDrawing, i: number): DeviceScreen => {
    const pages = registerPages(d, REG);
    return { kind: 'review', page: pages[i], index: i, total: pages.length };
  };

  it('the Nova’s last key page: the down arrow in place of the ">" sliding by downY, the up arrow by up, upRise and upY; no layer for a confirmation (the word is the next frame)', async () => {
    const p = novaProgress();
    const last = registerPages('nova', REG).length - 1;
    const r = await mount(<NovaArt width={width} screen={regPage('nova', last)} lit progress={p} />);
    const px = novaAnchors(width).px;
    const arrows = novaHoldArrows();
    const down = one(boundShift(r.root, p.downY), 'downY');
    expect(paths(down)).toEqual([DOWN]);
    expect(styleOf(down)).toMatchObject({ top: px * arrows.downTop, right: px * NOVA_HOLD_ARROW.right });
    const slide = one(boundShift(r.root, p.upY), 'upY');
    expect(styleOf(slide)).toMatchObject({ top: px * arrows.upTop, right: px * NOVA_HOLD_ARROW.right });
    const shown = one(boundOpacity(slide, p.up), 'up');
    expect((styleOf(shown).transform ?? []).map((t) => t.translateY)).toEqual([p.upRise]);
    expect(paths(shown)).toEqual([UP]);
    expect([...boundOpacity(r.root, p.page), ...boundOpacity(r.root, p.confirmed)]).toEqual([]);
    expect(words(r.root)).toEqual(['×', 'Register', `Cosigner 3/3: ${REG.keys[2].slice(REG.keys[2].indexOf(']') + 1)}`]);
    await act(async () => r.unmount());
    // Without the clock: the down arrow alone; a page before the last: the ">" and no arrow at all.
    const still = await mount(<NovaArt width={width} screen={regPage('nova', last)} lit />);
    expect(paths(still.root).filter((d) => d === DOWN || d === UP)).toEqual([DOWN]);
    await act(async () => still.unmount());
    const earlier = await mount(<NovaArt width={width} screen={regPage('nova', 3)} lit progress={p} />);
    expect(paths(earlier.root).filter((d) => d === DOWN || d === UP)).toEqual([]);
    expect([...boundShift(earlier.root, p.downY), ...boundShift(earlier.root, p.upY)]).toEqual([]);
    expect(words(earlier.root)).toEqual(['×', 'Register', `Cosigner 1/3: ${REG.keys[0].slice(REG.keys[0].indexOf(']') + 1)}`]);
    await act(async () => earlier.unmount());
  });

  it('the device’s word: the Nova’s "Multisig account registered" with one tick; a touch Ledger’s "Account registered" in the outlined circle; the Nano X’s alone', async () => {
    const nova = await mount(<NovaArt width={width} screen={{ kind: 'registered', text: 'Multisig account registered' }} lit />);
    expect(words(nova.root)).toEqual(['Multisig account', 'registered']);
    // One tick on the screen (the other path is the BitBox mark on the glass).
    expect(paths(nova.root).filter((d) => /^M5 12\.5 /.test(d))).toHaveLength(1);
    expect(paths(nova.root).filter((d) => d === UP || d === DOWN)).toEqual([]);
    await act(async () => nova.unmount());
    const gen5 = await mount(<Gen5Art width={176} screen={{ kind: 'registered', text: 'Account registered' }} lit />);
    expect(words(gen5.root)).toEqual(['Account registered']);
    expect(gen5.root.findAll((x) => isType(x, 'Circle') && x.props.fill === 'none')).toHaveLength(1);
    await act(async () => gen5.unmount());
    const nano = await mount(<NanoXArt width={250} screen={{ kind: 'registered', text: 'Account registered' }} lit />);
    expect(words(nano.root)).toEqual(['Account registered']);
    expect(nano.root.findAll((x) => isType(x, 'Svg'))).toHaveLength(1);
    await act(async () => nano.unmount());
  });

  it('a touch Ledger’s pages: the account, a key under its title, "Register account?" over Approve; the app’s home after "Open app?"', async () => {
    const account = await mount(<Gen5Art width={176} screen={regPage('gen5', 1)} lit />);
    expect(words(account.root).slice(0, 4)).toEqual(['Account name', 'Test 2/3 Oct', 'Spending policy', 'Any 2 of @0, @1 and @2 must sign']);
    expect(words(account.root).join(' ')).toMatch(/Reject/);
    await act(async () => account.unmount());
    const key = await mount(<Gen5Art width={176} screen={regPage('gen5', 4)} lit />);
    expect(words(key.root).slice(0, 2)).toEqual(['Internal key@1', REG.keys[1]]);
    await act(async () => key.unmount());
    const approve = await mount(<Gen5Art width={176} screen={regPage('gen5', 6)} lit />);
    expect(words(approve.root)).toEqual(['Register account?', 'Approve', 'Reject', '7 of 7']);
    await act(async () => approve.unmount());
    const home = await mount(<Gen5Art width={176} screen={{ kind: 'app-home', app: 'Bitcoin Testnet', note: 'This app enables signing transactions on all the Bitcoin test networks.' }} lit />);
    expect(words(home.root)).toEqual(['Bitcoin Testnet', 'This app enables signing transactions on all the Bitcoin test networks.', 'Quit app']);
    await act(async () => home.unmount());
    // The Nano X's home, filmed at the end of an address check: the title over "app is ready"; the Nova has no such page: dark.
    const nanoHome = await mount(<NanoXArt width={250} screen={{ kind: 'app-home', app: 'Bitcoin Testnet', note: 'x' }} lit />);
    expect(words(nanoHome.root)).toEqual(['Bitcoin Testnet', 'app is ready']);
    await act(async () => nanoHome.unmount());
    const dark = await mount(<DeviceArt drawing="nova" width={205} screen={{ kind: 'app-home', app: 'Bitcoin', note: 'x' }} lit />);
    expect(words(dark.root)).toEqual([]);
    await act(async () => dark.unmount());
  });
});

describe('the address check is drawn on every device (the three videos, 2026-10-04)', () => {
  // A made-up test address: receive index 1 (testnet) of wsh(sortedmulti(2, ...)) over the
  // filmed Nova key 4a290600, the filmed Nano X key abf931aa and the made-up key from
  // BIP-32 test vector 1's seed (3442193e). Public test material, nobody's wallet.
  const TEST_ADDRESS = 'tb1q3hnufu5vvjfz6fklvrft0f3y7ean0x9wjzkzd3u0ensg96alzwssrk5vy2';
  const facts = (brand: 'ledger' | 'bitbox') => addressFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, TEST_ADDRESS, 'Test 2/3 Oct', brand);
  const page = (d: DeviceDrawing, i: number): DeviceScreen => {
    const pages = addressPages(d, facts(d === 'nova' ? 'bitbox' : 'ledger'));
    return { kind: 'review', page: pages[i], index: i, total: pages.length };
  };

  it('a touch Ledger: the intro with "Cancel" in the footer, the address page with the name, the QR button and Confirm, no ">"; then "Address verified"', async () => {
    const intro = await mount(<Gen5Art width={176} screen={page('gen5', 0)} lit />);
    expect(words(intro.root)).toEqual(['Verify bitcoin\naddress', 'Swipe to continue', 'Cancel', '1 of 2']);
    await act(async () => intro.unmount());
    const address = await mount(<Gen5Art width={176} screen={page('gen5', 1)} lit />);
    expect(words(address.root)).toEqual(['Address', TEST_ADDRESS, 'Account name', 'Test 2/3 Oct', 'Confirm', 'Cancel', '2 of 2']);
    // The QR button's glyph (its three finders), drawn once.
    expect(paths(address.root).filter((d) => d.startsWith('M1 1 h8 v8 h-8 Z'))).toHaveLength(1);
    await act(async () => address.unmount());
    // A vault the device shows as a plain account: no name on the page.
    const plain = await mount(<Gen5Art width={176} screen={{ kind: 'review', page: { kind: 'touch-address', address: TEST_ADDRESS, name: null }, index: 1, total: 2 }} lit />);
    expect(words(plain.root)).toEqual(['Address', TEST_ADDRESS, 'Confirm', 'Cancel', '2 of 2']);
    await act(async () => plain.unmount());
    const verified = await mount(<Gen5Art width={176} screen={{ kind: 'registered', text: 'Address verified' }} lit />);
    expect(words(verified.root)).toEqual(['Address verified']);
    expect(verified.root.findAll((x) => isType(x, 'Circle') && x.props.fill === 'none')).toHaveLength(1);
    await act(async () => verified.unmount());
  });

  it('the Nano X: "Verify bitcoin address", the address over its pages, "Confirm" under the tick, then the word alone', async () => {
    const intro = await mount(<NanoXArt width={250} screen={page('nanoX', 0)} lit />);
    expect(words(intro.root)).toEqual(['Verify bitcoin', 'address']);
    await act(async () => intro.unmount());
    const first = await mount(<NanoXArt width={250} screen={page('nanoX', 1)} lit />);
    expect(words(first.root)).toEqual(['Address (1/2)', 'tb1q3hnufu5vvjfz6fklvrft0f3y7ean0x9wjzkzd3u0ensg96alzwssrk5']);
    await act(async () => first.unmount());
    const confirm = await mount(<NanoXArt width={250} screen={page('nanoX', 4)} lit />);
    expect(words(confirm.root)).toEqual(['Confirm']);
    // The tick over the word, and the two arrows.
    expect(paths(confirm.root).filter((d) => /^M4 12\.5 /.test(d))).toHaveLength(1);
    await act(async () => confirm.unmount());
    const verified = await mount(<NanoXArt width={250} screen={{ kind: 'registered', text: 'Address verified' }} lit />);
    expect(words(verified.root)).toEqual(['Address verified']);
    await act(async () => verified.unmount());
  });

  it('the Nova: "Receive to" over the kind, the name, then the address as one line with the tick in place of the ">"', async () => {
    const kind = await mount(<NovaArt width={205} screen={page('nova', 0)} lit />);
    expect(words(kind.root)).toEqual(['×', 'Receive to', '2-of-3', 'BTC Testnet multisig']);
    await act(async () => kind.unmount());
    const address = await mount(<NovaArt width={205} screen={page('nova', 2)} lit />);
    expect(words(address.root)).toEqual(['×', 'Receive to', novaAddressGroups(TEST_ADDRESS)]);
    // One tick on the screen (the other path is the BitBox mark on the glass), no chevron, no arrow.
    expect(paths(address.root).filter((d) => /^M5 12\.5 /.test(d))).toHaveLength(1);
    expect(paths(address.root).filter((d) => d === UP || d === DOWN)).toEqual([]);
    expect(address.root.findAll((x) => isType(x, 'Text') && x.props.ellipsizeMode === 'clip')).toHaveLength(1);
    await act(async () => address.unmount());
  });
});

describe('the Nova’s scrolled lines are carried by the clock, each on its own frame (decided 2026-10-04 and 2026-10-05)', () => {
  // A made-up test address: receive index 1 (testnet) of wsh(sortedmulti(2, ...)) over the
  // filmed Nova key 4a290600, the filmed Nano X key abf931aa and the made-up key from
  // BIP-32 test vector 1's seed (3442193e). Public test material, nobody's wallet.
  const TEST_ADDRESS = 'tb1q3hnufu5vvjfz6fklvrft0f3y7ean0x9wjzkzd3u0ensg96alzwssrk5vy2';
  const pages = reviewPages('nova', NOVA);
  const i = pages.findIndex((p) => p.kind === 'nova-output');
  const output: DeviceScreen = { kind: 'review', page: pages[i], index: i, total: pages.length };
  const checkPages = addressPages('nova', addressFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, TEST_ADDRESS, 'Test 2/3 Oct', 'bitbox'));
  const address: DeviceScreen = { kind: 'review', page: checkPages[2], index: 2, total: checkPages.length };

  it('the amount page: the WHOLE address as one line slid by `line`, the thumb by `thumb`; the address check’s page the same; another frame’s scroll moves nothing; without one both stand still', async () => {
    const sc = { page: i, line: sentinel(), thumb: sentinel() };
    const r = await mount(<NovaArt width={205} screen={output} lit scrolls={[sc]} />);
    one(boundShiftX(r.root, sc.line), 'the line');
    one(boundShiftX(r.root, sc.thumb), 'the thumb');
    expect(words(r.root)).toEqual(['×', '0.0125 BTC', novaAddressGroups(LEDGER.outputs[0].address!)]);
    // The down arrow between them, and the ">" (a chevron, no Total arrow).
    expect(paths(r.root).filter((d) => d === 'M0 0 H8 L4 6 Z')).toHaveLength(1);
    expect(paths(r.root).filter((d) => d === UP || d === DOWN)).toEqual([]);
    await act(async () => r.unmount());
    const check = await mount(<NovaArt width={205} screen={address} lit scrolls={[{ ...sc, page: 2 }]} />);
    one(boundShiftX(check.root, sc.line), 'the address check’s line');
    one(boundShiftX(check.root, sc.thumb), 'the address check’s thumb');
    expect(words(check.root)).toEqual(['×', 'Receive to', novaAddressGroups(TEST_ADDRESS)]);
    await act(async () => check.unmount());
    // A scroll for another frame leaves this one still.
    const other = await mount(<NovaArt width={205} screen={output} lit scrolls={[{ ...sc, page: i + 1 }]} />);
    expect(boundShiftX(other.root, sc.line)).toHaveLength(0);
    expect(boundShiftX(other.root, sc.thumb)).toHaveLength(0);
    await act(async () => other.unmount());
    // Without the clock: the line at its start, clipped at the edge, the thumb at its track's left end, nothing animated.
    const still = await mount(<NovaArt width={205} screen={output} lit />);
    expect(still.root.findAll((n) => isType(n, 'Animated.View'))).toHaveLength(0);
    expect(still.root.findAll((x) => isType(x, 'Text') && x.props.ellipsizeMode === 'clip')).toHaveLength(1);
    expect(words(still.root)).toEqual(['×', '0.0125 BTC', novaAddressGroups(LEDGER.outputs[0].address!)]);
    await act(async () => still.unmount());
  });

  it('DeviceArt hands the Nova its scrolls and a Ledger none', async () => {
    const sc = { page: i, line: sentinel(), thumb: sentinel() };
    const nova = await mount(<DeviceArt drawing="nova" width={205} screen={output} lit scrolls={[sc]} />);
    one(boundShiftX(nova.root, sc.line), 'the line through DeviceArt');
    await act(async () => nova.unmount());
    for (const d of ['gen5', 'flex', 'stax', 'nanoX'] as DeviceDrawing[]) {
      const ledger = await mount(<DeviceArt drawing={d} width={d === 'nanoX' ? 250 : 176} screen={signPage(d, LEDGER)} lit scrolls={[sc]} />);
      expect({ d, bound: boundShiftX(ledger.root, sc.line).length + boundShiftX(ledger.root, sc.thumb).length }).toEqual({ d, bound: 0 });
      await act(async () => ledger.unmount());
    }
  });
});

describe('DeviceArt hands each drawing its own progress', () => {
  it('the Nova its arrows, the touchscreens their ring, the others nothing', async () => {
    const cases: { d: DeviceDrawing; f: TourFacts; p: DeviceProgress; bound: (p: DeviceProgress) => unknown[] }[] = [
      { d: 'nova', f: NOVA, p: novaProgress(), bound: (p) => (p.kind === 'nova' ? [p.page, p.confirmed, p.up] : []) },
      ...(['gen5', 'flex', 'stax'] as const).map((d) => ({ d, f: LEDGER, p: touchProgress() as DeviceProgress, bound: (p: DeviceProgress) => (p.kind === 'touch' ? [p.page, p.signing] : []) })),
    ];
    for (const { d, f, p, bound } of cases) {
      const r = await mount(<DeviceArt drawing={d} width={d === 'nova' ? 205 : 176} screen={signPage(d, f)} lit progress={p} />);
      for (const v of bound(p)) expect({ d, drawn: boundOpacity(r.root, v).length }).toEqual({ d, drawn: 1 });
      expect(boundShift(r.root, p.kind === 'nova' ? p.downY : null).length).toBe(p.kind === 'nova' ? 1 : 0);
      expect(boundScale(r.root, p.kind === 'touch' ? p.line : null).length).toBe(p.kind === 'touch' ? 1 : 0);
      await act(async () => r.unmount());
    }
    // A drawing of another kind takes none of it.
    for (const [d, p] of [
      ['nova', touchProgress()],
      ['gen5', novaProgress()],
      ['nanoX', touchProgress()],
    ] as [DeviceDrawing, DeviceProgress][]) {
      const r = await mount(<DeviceArt drawing={d} width={d === 'nanoX' ? 250 : 176} screen={signPage(d, d === 'nova' ? NOVA : LEDGER)} lit progress={p} />);
      const values = p.kind === 'touch' ? [p.page, p.signing] : p.kind === 'nova' ? [p.page, p.confirmed, p.up] : [];
      expect({ d, drawn: values.flatMap((v) => boundOpacity(r.root, v)).length }).toEqual({ d, drawn: 0 });
      if (p.kind === 'touch') expect({ d, line: boundScale(r.root, p.line).length }).toEqual({ d, line: 0 });
      await act(async () => r.unmount());
    }
  });
});
