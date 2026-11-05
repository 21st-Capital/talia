/**
 * Where the press hint sits (design C, decided 2026-10-03): it lights the control
 * the client presses and never draws over the device's words, and the
 * courier's row leaves its pills the room they need, so none reaches the
 * title above the drawing or the card under it. Measured on the drawings'
 * own anchors at the widths of an iPhone SE, a 17 Pro and a 17 Pro Max.
 *
 * The touchscreen Ledgers' words are the system face, which Node cannot
 * measure: the widths and line counts below were measured with CoreText at
 * the sizes the drawings set them (a touch Ledger is 176 points wide on all
 * three phones). Change a size or a place and measure again.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { deviceAnchors, deviceArtBox, deviceArtWidth } from '../DeviceArt';
import { PILL_H, PressHint, RING_GAP, fillBox, hintReach, lightBox, spotOf, wordPlace, wordSpan } from '../PressHint';
import type { HintMotion, WordPlace } from '../PressHint';
import { EINK_PAGE, NOVA_SLOTS, einkUnit, novaHoldArrows } from '../deviceScreenLayout';
import { HINT_MS, HINT_WORDS, deviceHint, extraRoom, hintPlan, pinKey, valueAt } from '../pressHintScript';
import { PAD_DIGIT_CELLS, PAD_TICK, deviceTurn } from '../../hww/deviceTurns';
import type { HintControl } from '../pressHintScript';
import { DEVICE_DRAWINGS, reviewPages, tourCycle, tourStarts } from '../../hww/signingDevice';
import type { DeviceDrawing, TourFacts } from '../../hww/signingDevice';
import { registerFacts, registerPages } from '../../hww/vaultRegistration';
import { addressFacts, addressPages } from '../../hww/addressCheck';
import { MULTISIG_2_OF_3 } from '../../../bitcoin/descriptor/__fixtures__/descriptors';

/** The 2-of-3 test vault as the device holding its second key sees it. */
const REG = registerFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, 'a1b2c3d4')!;
/** Receive address 1 of a 2-of-3 test vault, as a Ledger shows it. */
// A made-up test address: receive index 1 (testnet) of wsh(sortedmulti(2, ...)) over the
// filmed Nova key 4a290600, the filmed Nano X key abf931aa and the made-up key from
// BIP-32 test vector 1's seed (3442193e). Public test material, nobody's wallet.
const ADDR = addressFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, 'tb1q3hnufu5vvjfz6fklvrft0f3y7ean0x9wjzkzd3u0ensg96alzwssrk5vy2', 'Test 2/3 Oct', 'ledger');

jest.mock('react-native', () => require('../../__tests__/rnStub').reactNative);
jest.mock('react-native-svg', () => require('../../__tests__/rnStub').svg);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PHONES: Record<string, number> = { 'iPhone SE': 375, 'iPhone 17 Pro': 402, 'iPhone 17 Pro Max': 440 };
const HINTED: DeviceDrawing[] = ['gen5', 'flex', 'stax', 'nanoX', 'nova'];

/** The courier's row (SigningCourier): the device gets the width left after
 *  the page's gutters (16), the drawn phone (36), the row's two gaps (12) and
 *  the path's three chevrons (64); the phone is 66 tall; the row is padded 8
 *  and the screen's column gap is 12. */
const COURIER = { gutter: 16, phoneW: 36, phoneH: 66, gap: 12, path: 64, pad: 8, column: 12, clear: 2 };
const widthOn = (d: DeviceDrawing, windowW: number) =>
  deviceArtWidth(d, windowW - 2 * COURIER.gutter - COURIER.phoneW - 2 * COURIER.gap - COURIER.path);

type Box = { left: number; top: number; right: number; bottom: number };
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const rect = (s: { x: number; y: number; w: number; h: number }): Box => ({ left: s.x, top: s.y, right: s.x + s.w, bottom: s.y + s.h });

/** The widest a pill can be: 8 of padding each side, and no glyph of the
 *  label face at 12 wider than 0.7 of it. */
const pillWidthAtMost = (text: string) => 16 + text.length * 0.7 * 12;
function pillBox(p: WordPlace, text: string): Box {
  const w = pillWidthAtMost(text);
  const { top, bottom } = wordSpan(p);
  return p.align.kind === 'center'
    ? { left: p.align.x - w / 2, right: p.align.x + w / 2, top, bottom }
    : { left: p.align.right - w, right: p.align.right, top, bottom };
}

/** The words every hint shows on a device, with where each points. */
function wordsOf(d: DeviceDrawing): { text: string; at: HintControl | 'between'; both: boolean }[] {
  const h = deviceHint(d)!;
  const signAt: HintControl | 'between' = h.sign.gesture === 'both' ? 'between' : h.sign.controls[0];
  return [
    { text: h.advance.word, at: h.advance.control, both: false },
    { text: h.sign.word, at: signAt, both: h.sign.gesture === 'both' },
    ...(h.sign.wordBoth ? [{ text: h.sign.wordBoth, at: signAt, both: true }] : []),
  ];
}
const controlsOf = (d: DeviceDrawing): HintControl[] => {
  const h = deviceHint(d)!;
  return [h.advance.control, ...h.sign.controls];
};

describe('every Ledger model and the Nova have a spot for each control; the slab none', () => {
  it('anchors for every control the hint lights, on every phone', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of DEVICE_DRAWINGS) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (d === 'slab') {
          expect(a.kind).toBe('none');
          continue;
        }
        for (const c of controlsOf(d)) expect({ phone, d, c, spot: spotOf(a, c) != null }).toEqual({ phone, d, c, spot: true });
        for (const w of wordsOf(d)) expect({ phone, d, w, placed: wordPlace(a, w.at, w.both) != null }).toEqual({ phone, d, w, placed: true });
      }
    }
  });

  it('the slab draws no hint at all', async () => {
    let r!: TestRenderer.ReactTestRenderer;
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      r = TestRenderer.create(<PressHint drawing="slab" width={176} motion={{ overlay: { lit: [], words: [] }, progress: undefined, scrolls: [] }} />);
    });
    expect(r.toJSON()).toBeNull();
    quiet.mockRestore();
    expect(hintReach('slab', 176, 100)).toEqual({ above: 0, below: 0 });
  });
});

describe('the hint never covers the device’s words', () => {
  it('the Nano X and the Nova: no light and no pill on the screen', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['nanoX', 'nova'] as DeviceDrawing[]) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'nanoX' && a.kind !== 'nova') throw new Error(d);
        const screen = rect(a.a.screen);
        for (const c of controlsOf(d)) {
          const light = lightBox(c, spotOf(a, c)!);
          expect({ phone, d, c, clear: !overlaps(light, screen) }).toEqual({ phone, d, c, clear: true });
        }
        for (const w of wordsOf(d)) {
          const pill = pillBox(wordPlace(a, w.at, w.both)!, w.text);
          expect({ phone, d, w, clear: !overlaps(pill, screen) }).toEqual({ phone, d, w, clear: true });
        }
      }
    }
  });

  /** CoreText at the touch drawings' sizes (weights as the pages set them). */
  const MEASURED = {
    /** The footer's counter, weight 500: the widest "i of N" with a ">" (N up to 9, "4 of 8"). */
    counter: { gen5: 26.33, flex: 25.54, stax: 26.33 },
    /** "Hold to sign", weight 600. */
    holdToSign: { gen5: 61.9, flex: 60.33, stax: 62.44 },
    /** An address's lines in the output page's column, weight 600: 42
     *  characters take two, 62 take three, on every model; a name of up to
     *  14 characters and every amount up to 21 BTC one. */
    addressLines: 3,
  } as const;

  it('the touchscreens: the pills sit between the page’s words and the footer, the rings clear of the counter', () => {
    for (const d of ['gen5', 'flex', 'stax'] as const) {
      const a = deviceAnchors(d, 176);
      if (a.kind !== 'touch') throw new Error(d);
      const { x: sx, y: sy, w: W, h: H } = a.a.screen;
      const ts = { gen5: 1, flex: 0.9, stax: 0.95 }[d];
      const P = EINK_PAGE;
      const T = P.type;
      const f = (k: number) => einkUnit(k, W, ts);
      const line = (t: readonly [number, number]) => f(t[1]);
      const gap = P.output.gap * H;
      // Where each word ends, in the screen's own points.
      const intro = P.intro.note * H + line(T.small);
      const output =
        P.output.top * H +
        (line(T.small) + line(T.value) + gap) + // the account and the vault's name
        line(T.small) + line(T.value) + // Amount
        gap + line(T.small) + MEASURED.addressLines * line(T.address); // To
      const fees = P.fees.top * H + line(T.small) + line(T.value) + gap + line(T.small) + line(T.value);
      const signTitle = P.sign.title * H + 2 * line(T.title);
      const tap = wordSpan(wordPlace(a, 'next')!);
      const hold = wordSpan(wordPlace(a, 'tile')!);
      for (const [page, bottom] of Object.entries({ intro, output, fees })) {
        expect({ d, page, clear: sy + bottom + COURIER.clear <= tap.top }).toEqual({ d, page, clear: true });
      }
      expect({ d, clear: sy + signTitle + COURIER.clear <= hold.top }).toEqual({ d, clear: true });
      // Both pills inside the screen, above the footer's rule (the pointer
      // may cross the dotted rule toward the ">", never the footer's words).
      for (const c of ['next', 'tile'] as HintControl[]) {
        expect({ d, c, above: wordPlace(a, c)!.top + PILL_H <= sy + P.footer.top * H + 1 }).toEqual({ d, c, above: true });
        expect({ d, c, inside: wordPlace(a, c)!.top >= sy }).toEqual({ d, c, inside: true });
      }
      expect(wordPlace(a, 'next')!.align).toMatchObject({ kind: 'right' });
      // The counter, centred between the two chevron slots, ends before the ring round ">".
      const pad = P.pad * W;
      const chev = f(T.chevron);
      const left = sx + P.footer.split * W + pad * P.footer.inset + chev;
      const right = sx + W - pad * P.footer.inset - chev;
      const counterEnd = (left + right) / 2 + MEASURED.counter[d] / 2;
      expect({ d, clear: counterEnd <= lightBox('next', a.a.next).left }).toEqual({ d, clear: true });
      // "Hold to sign" ends well before the ring round the tile.
      expect({ d, clear: sx + pad + MEASURED.holdToSign[d] < lightBox('tile', a.a.tile).left }).toEqual({ d, clear: true });
    }
  });
});

describe('on the sign page nothing of the ">"’s hint is left over the tile (decided 2026-10-04)', () => {
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

  it('wherever the "Tap" pill or the ">"’s light would reach the tile, it shows nothing on the last page', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const pages = reviewPages(d, LEDGER);
        const starts = tourStarts(pages);
        const cycle = tourCycle(pages);
        const plan = hintPlan(d, pages, starts, cycle)!;
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        const tile = lightBox('tile', a.a.tile);
        const pill = pillBox(wordPlace(a, 'next')!, HINT_WORDS.tap);
        const light = lightBox('next', a.a.next);
        // The pill does reach the tile: only time keeps them apart.
        expect(overlaps(pill, tile)).toBe(true);
        const tap = plan.words.find((w) => w.text === HINT_WORDS.tap)!;
        const next = plan.lit.find((l) => l.control === 'next')!;
        for (let t = starts[starts.length - 1] + 1; t <= cycle; t += 5) {
          const left = {
            pill: valueAt(tap.opacity, t) > 0 && overlaps(pill, tile),
            ring: (valueAt(next.ring, t) > 0 || valueAt(next.fill, t) > 0) && overlaps(light, tile),
            // The footer of the last page has no ">" for the light to ring.
            footer: valueAt(next.ring, t) > 0 || valueAt(next.fill, t) > 0,
          };
          expect({ phone, d, t, left }).toEqual({ phone, d, t, left: { pill: false, ring: false, footer: false } });
        }
      }
    }
  });
});

describe('the press fills over the ring, in the control’s own shape', () => {
  it('a disc for a round control, a rounded rectangle for the Open button', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        const next = fillBox('next', a.a.next);
        expect(next.width / 2).toBeGreaterThanOrEqual(a.a.next.r + RING_GAP);
        expect(next).toMatchObject({ height: next.width, radius: next.width / 2 });
        const tile = fillBox('tile', a.a.tile);
        expect(tile.width / 2).toBeGreaterThanOrEqual(a.a.tile.r + RING_GAP);
        // The Open button: wide, so its ring and its fill follow its shape.
        const open = a.a.open;
        expect(open.w).toBeGreaterThan(2 * open.r);
        const o = fillBox('open', open);
        expect({ phone, d, wide: o.width > o.height && o.width > open.w! && o.height > open.h! }).toEqual({ phone, d, wide: true });
        expect(o.radius).toBeGreaterThan(open.corner ?? 0);
        const light = lightBox('open', open);
        expect(light.left).toBeCloseTo(o.left, 9);
        expect(light.top).toBeCloseTo(o.top, 9);
        expect(light.right).toBeCloseTo(o.left + o.width, 9);
        expect(light.bottom).toBeCloseTo(o.top + o.height, 9);
      }
    }
  });

  it('mounted: the fills are drawn in those boxes', async () => {
    const a = deviceAnchors('gen5', 176);
    if (a.kind !== 'touch') throw new Error('gen5');
    // Sentinel values, to find each view by what it is bound to.
    const motion: HintMotion = {
      overlay: {
        lit: [
          { control: 'next', ring: 0.11, fill: 0.12 },
          { control: 'open', ring: 0.21, fill: 0.22 },
        ],
        words: [],
      },
      progress: undefined,
      scrolls: [],
    };
    let r!: TestRenderer.ReactTestRenderer;
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      r = TestRenderer.create(<PressHint drawing="gen5" width={176} motion={motion} />);
    });
    quiet.mockRestore();
    const bound = (o: number) =>
      r.root.findAll((n) => (n.type as unknown) === 'Animated.View' && [n.props.style].flat(3).some((x: { opacity?: number } | undefined) => x?.opacity === o));
    const box = (o: number) => Object.assign({}, ...[bound(o)[0].props.style].flat(3));
    const next = fillBox('next', a.a.next);
    expect(box(0.12)).toMatchObject({ left: next.left, top: next.top, width: next.width, height: next.height, borderRadius: next.radius });
    const open = fillBox('open', a.a.open);
    expect(box(0.22)).toMatchObject({ left: open.left, top: open.top, width: open.width, height: open.height, borderRadius: open.radius });
    // The Open button's ring is a rounded rectangle, the ">"'s a circle.
    const ringOf = (o: number) => bound(o)[0];
    expect(ringOf(0.21).findAll((n) => (n.type as unknown) === 'Rect')).toHaveLength(1);
    expect(ringOf(0.11).findAll((n) => (n.type as unknown) === 'Circle')).toHaveLength(1);
    await act(async () => r.unmount());
  });
});

describe('the turns before the transaction (decided 2026-10-04): the keys, the Open button and their words, clear of the device’s words', () => {
  it('every touch Ledger has a spot for each of its twelve keys and its Open button, on every phone', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        for (let cell = 0; cell < 12; cell++) expect({ phone, d, cell, spot: spotOf(a, pinKey(cell)) != null }).toEqual({ phone, d, cell, spot: true });
        expect(spotOf(a, pinKey(12))).toBeNull();
        expect(spotOf(a, 'open')).toBe(a.a.open);
        // The Nano X and the Nova have no such controls.
        for (const other of ['nanoX', 'nova'] as const) {
          const b = deviceAnchors(other, widthOn(other, windowW));
          expect([spotOf(b, pinKey(0)), spotOf(b, 'open'), wordPlace(b, 'band')]).toEqual([null, null, null]);
        }
      }
    }
  });

  it('a key’s ring stays inside the keypad, clear of the digits in the cells around it', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        const { x: sx, y: sy, w: W, h: H } = a.a.screen;
        const ts = { gen5: 1, flex: 0.9, stax: 0.95 }[d];
        const digit = einkUnit(EINK_PAGE.type.padDigit, W, ts);
        const padTop = sy + EINK_PAGE.pin.pad * H;
        for (let cell = 0; cell < 12; cell++) {
          const light = lightBox(pinKey(cell), spotOf(a, pinKey(cell))!);
          expect({ phone, d, cell, inside: light.top >= padTop - 1 && light.bottom <= sy + H + 1 && light.left >= sx && light.right <= sx + W }).toEqual({ phone, d, cell, inside: true });
          for (let other = 0; other < 12; other++) {
            if (other === cell) continue;
            const o = spotOf(a, pinKey(other))!;
            const glyph = { left: o.x - digit / 2, right: o.x + digit / 2, top: o.y - digit / 2, bottom: o.y + digit / 2 };
            expect({ phone, d, cell, other, clear: !overlaps(light, glyph) }).toEqual({ phone, d, cell, other, clear: true });
          }
        }
      }
    }
  });

  it('the one "Tap" of the PIN entry sits in the band between the dots and the keypad, pointing at no key', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        const { x: sx, y: sy, w: W, h: H } = a.a.screen;
        const place = wordPlace(a, 'band')!;
        expect(place.side).toBe('none');
        const pill = pillBox(place, HINT_WORDS.tap);
        const dotsBottom = sy + EINK_PAGE.pin.dots.top * H + EINK_PAGE.pin.dots.d * W;
        const padTop = sy + EINK_PAGE.pin.pad * H;
        // Clear of the dots above, and (but for the rise it comes in from) of the keypad's first row.
        expect({ phone, d, clear: place.top >= dotsBottom + COURIER.clear }).toEqual({ phone, d, clear: true });
        expect({ phone, d, clear: place.top + PILL_H <= padTop - COURIER.clear }).toEqual({ phone, d, clear: true });
        expect(pill.left >= sx && pill.right <= sx + W).toBe(true);
        // The turn's script uses that place for its one word of the entry,
        // after "Press" on the side button that turns the device on.
        const turn = deviceTurn(d, 'unlock', 'bitcoin')!;
        expect(turn.pass(0).words.map((w) => w.at)).toEqual(['side', 'band']);
      }
    }
  });

  it('the "Tap" over the Open button sits between the app’s name and the button, centred', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        const { y: sy, w: W, h: H } = a.a.screen;
        const ts = { gen5: 1, flex: 0.9, stax: 0.95 }[d];
        const place = wordPlace(a, 'open')!;
        expect(place.side).toBe('bottom');
        expect(place.align).toEqual({ kind: 'center', x: a.a.open.x });
        const nameBottom = sy + EINK_PAGE.open.app * H + einkUnit(EINK_PAGE.type.appName[1], W, ts);
        expect({ phone, d, clear: place.top >= nameBottom + COURIER.clear }).toEqual({ phone, d, clear: true });
        expect(wordSpan(place).bottom - 4).toBeLessThanOrEqual(a.a.open.y - a.a.open.h! / 2);
        expect(deviceTurn(d, 'open-app', 'bitcoin')!.pass(0).words.map((w) => w.at)).toEqual(['open']);
      }
    }
  });

  it('the keys the demonstration taps are digit cells, and the tick is where the device draws it', () => {
    for (const d of ['gen5', 'flex', 'stax'] as const) {
      const a = deviceAnchors(d, 176);
      if (a.kind !== 'touch') throw new Error(d);
      const turn = deviceTurn(d, 'unlock', 'bitcoin')!;
      const [wake, ...keys] = turn.pass(0).cues;
      // The side button first (the device off), then the keys.
      expect(wake.controls).toEqual(['side']);
      const cells = keys.map((c) => Number(c.controls[0].slice(3)));
      expect(cells.slice(0, -1).every((c) => PAD_DIGIT_CELLS.includes(c))).toBe(true);
      expect(cells[cells.length - 1]).toBe(PAD_TICK);
      // The tick: the bottom right cell.
      const tick = a.a.pin[PAD_TICK];
      expect(tick.x).toBeGreaterThan(a.a.screen.x + (a.a.screen.w * 2) / 3);
      expect(tick.y).toBeGreaterThan(a.a.screen.y + a.a.screen.h * 0.9);
    }
  });
});

describe('registering the vault on a touch Ledger (the Gen5 video, 2026-10-04): the Approve button and the pages’ words, clear of each other', () => {
  /** CoreText at the touch drawings' sizes: the lines a real key takes in the
   *  key page's column, weight 600 (measured for the two keys of the video
   *  and the longest tpub on every model: seven or eight). */
  const KEY_LINES = 8;

  it('every touch Ledger has an Approve spot, wide, above the footer; the Nano X and the Nova none', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        const s = spotOf(a, 'approve')!;
        expect({ phone, d, wide: s.w != null && s.h != null && s.w > 2 * s.r }).toEqual({ phone, d, wide: true });
        expect(s).toBe(a.a.approve);
        const { y: sy, h: H } = a.a.screen;
        expect({ phone, d, aboveFooter: lightBox('approve', s).bottom <= sy + EINK_PAGE.footer.top * H + 1 }).toEqual({ phone, d, aboveFooter: true });
        for (const other of ['nanoX', 'nova'] as const) expect(spotOf(deviceAnchors(other, widthOn(other, windowW)), 'approve')).toBeNull();
      }
    }
  });

  it('the "Tap" over Approve sits between "Register account?" and the button, centred; the pages’ words end above the ">"’s pill', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        const { y: sy, w: W, h: H } = a.a.screen;
        const ts = { gen5: 1, flex: 0.9, stax: 0.95 }[d];
        const P = EINK_PAGE;
        const T = P.type;
        const f = (k: number) => einkUnit(k, W, ts);
        const line = (t: readonly [number, number]) => f(t[1]);
        const place = wordPlace(a, 'approve')!;
        expect(place.side).toBe('bottom');
        expect(place.align).toEqual({ kind: 'center', x: a.a.approve.x });
        const titleBottom = sy + P.register.approve.title * H + line(T.title);
        expect({ phone, d, clear: place.top >= titleBottom + COURIER.clear }).toEqual({ phone, d, clear: true });
        expect(wordSpan(place).bottom - HINT_MS.word.lift).toBeLessThanOrEqual(a.a.approve.y - a.a.approve.h! / 2);
        // The account page (the name and the policy, two lines) and a key's
        // page (its title and the key's lines) end above the "Tap" pill.
        const tap = wordSpan(wordPlace(a, 'next')!);
        const gap = P.output.gap * H;
        const account = P.output.top * H + line(T.small) + line(T.value) + gap + line(T.small) + 2 * line(T.value);
        const key = P.register.keyTop * H + line(T.small) + KEY_LINES * line(T.address);
        for (const [page, bottom] of Object.entries({ account, key })) {
          expect({ phone, d, page, clear: sy + bottom + COURIER.clear <= tap.top }).toEqual({ phone, d, page, clear: true });
        }
        expect(P.register.keyLines).toBe(KEY_LINES);
        // The turn's words: "Tap" on the ">" for every page but the last, then on Approve.
        const turn = deviceTurn(d, 'register', 'bitcoin', REG)!;
        const n = registerPages(d, REG).length;
        expect(turn.pass(0).words.map((w) => w.at)).toEqual([...Array.from({ length: n - 1 }, () => 'next'), 'approve']);
      }
    }
  });
});

describe('the address check on a touch Ledger (the Gen5 video, 2026-10-04): the Confirm button and the page’s words, clear of each other', () => {
  it('every touch Ledger has a Confirm spot, wide, beside the QR button and above the footer; the Nano X and the Nova none', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        const s = spotOf(a, 'confirm')!;
        expect({ phone, d, wide: s.w != null && s.h != null && s.w > 2 * s.r }).toEqual({ phone, d, wide: true });
        expect(s).toBe(a.a.confirm);
        const { x: sx, y: sy, w: W, h: H } = a.a.screen;
        expect({ phone, d, aboveFooter: lightBox('confirm', s).bottom <= sy + EINK_PAGE.footer.top * H + 1 }).toEqual({ phone, d, aboveFooter: true });
        // To the right of the QR button (a square as tall as the row at the left margin).
        expect({ phone, d, besideQr: s.x - s.w! / 2 > sx + EINK_PAGE.pad * W + s.h! }).toEqual({ phone, d, besideQr: true });
        expect(s.x + s.w! / 2).toBeLessThanOrEqual(sx + W);
        for (const other of ['nanoX', 'nova'] as const) expect(spotOf(deviceAnchors(other, widthOn(other, windowW)), 'confirm')).toBeNull();
      }
    }
  });

  it('the "Tap" over Confirm sits between the account name and the button, centred; the address’s lines end above the name', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of ['gen5', 'flex', 'stax'] as const) {
        const a = deviceAnchors(d, widthOn(d, windowW));
        if (a.kind !== 'touch') throw new Error(d);
        const { y: sy, w: W, h: H } = a.a.screen;
        const ts = { gen5: 1, flex: 0.9, stax: 0.95 }[d];
        const P = EINK_PAGE;
        const T = P.type;
        const f = (k: number) => einkUnit(k, W, ts);
        const line = (t: readonly [number, number]) => f(t[1]);
        const place = wordPlace(a, 'confirm')!;
        expect(place.side).toBe('bottom');
        expect(place.align).toEqual({ kind: 'center', x: a.a.confirm.x });
        const nameBottom = sy + P.address.name * H + line(T.small) + line(T.value);
        expect({ phone, d, clear: place.top >= nameBottom + COURIER.clear }).toEqual({ phone, d, clear: true });
        expect(wordSpan(place).bottom - HINT_MS.word.lift).toBeLessThanOrEqual(a.a.confirm.y - a.a.confirm.h! / 2);
        // The address block (its label and the lines the page leaves it) ends above the name's label.
        const addressBottom = P.address.top * H + line(T.small) + P.address.lines * line(T.address);
        expect({ phone, d, stacked: addressBottom + COURIER.clear <= P.address.name * H }).toEqual({ phone, d, stacked: true });
        // The intro's words end above the ">"'s pill, as the review's intro does.
        const tap = wordSpan(wordPlace(a, 'next')!);
        expect({ phone, d, intro: sy + P.intro.note * H + line(T.small) + COURIER.clear <= tap.top }).toEqual({ phone, d, intro: true });
        // The turn's words: "Tap" on the ">" for the intro, then on Confirm.
        const turn = deviceTurn(d, 'address', 'testnet', null, ADDR)!;
        expect(addressPages(d, ADDR)).toHaveLength(2);
        expect(turn.pass(0).words.map((w) => w.at)).toEqual(['next', 'confirm']);
      }
    }
  });
});

describe('the Nova’s two edges are where the photo holds them (decided 2026-10-04)', () => {
  it('the top edge above the OLED, the bottom edge below it, both over the screen’s ">" and the arrows’ column', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      const w = widthOn('nova', windowW);
      const a = deviceAnchors('nova', w);
      if (a.kind !== 'nova') throw new Error('nova');
      const { edgeTop, edgeBottom, screen, px } = a.a;
      const box = deviceArtBox('nova', w);
      const ctx = { phone };
      // On the body's own edges: the top one above the screen, the bottom one under it.
      expect({ ...ctx, top: edgeTop.y >= 0 && edgeTop.y < screen.y }).toEqual({ ...ctx, top: true });
      expect({ ...ctx, bottom: edgeBottom.y > screen.y + screen.h && edgeBottom.y <= box.h }).toEqual({ ...ctx, bottom: true });
      expect(lightBox('edgeTop', edgeTop).bottom).toBeLessThanOrEqual(screen.y);
      expect(lightBox('edgeBottom', edgeBottom).top).toBeGreaterThanOrEqual(screen.y + screen.h);
      // One column at the right end: over the ">" (4 pixels in, 11 wide) and
      // the column the two arrows slide along on Total.
      expect(edgeBottom.x).toBe(edgeTop.x);
      const right = screen.x + screen.w;
      expect({ ...ctx, overNext: edgeTop.x > right - 15 * px && edgeTop.x < right - 4 * px }).toEqual({ ...ctx, overNext: true });
      const [c0, c1] = novaHoldArrows().column;
      expect({ ...ctx, overArrows: edgeTop.x > screen.x + c0 * px && edgeTop.x < screen.x + c1 * px }).toEqual({ ...ctx, overArrows: true });
    }
  });
});

describe('a word about two controls points at neither (decided 2026-10-04)', () => {
  it('the Nova’s "Hold both" sits where "Hold" sat, with no pointer, as the Nano X’s "Press both"', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      const a = deviceAnchors('nova', widthOn('nova', windowW));
      const hold = wordPlace(a, 'edgeTop')!;
      const both = wordPlace(a, 'edgeTop', true)!;
      expect({ phone, hold: hold.side, both: both.side }).toEqual({ phone, hold: 'bottom', both: 'none' });
      expect(both.top).toBe(hold.top);
      expect(both.align).toEqual(hold.align);
      // The Nano X's was never a pointer.
      expect(wordPlace(deviceAnchors('nanoX', widthOn('nanoX', windowW)), 'between', true)!.side).toBe('none');
    }
  });

  it('mounted: "Hold" draws its pointer, "Hold both" none', async () => {
    const plan = hintPlan('nova', [{ kind: 'nova-total', total: '1 BTC', fee: null }], [0], 6000)!;
    const motion: HintMotion = {
      overlay: { lit: [], words: plan.words.map((w) => ({ plan: w, opacity: 1, rise: 0 })) },
      progress: undefined,
      scrolls: [],
    };
    let r!: TestRenderer.ReactTestRenderer;
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => {
      r = TestRenderer.create(<PressHint drawing="nova" width={176} motion={motion} />);
    });
    quiet.mockRestore();
    // The word's own layer: the Animated.View round its pill (and pointer).
    const layerOf = (text: string) => {
      let n = r.root.find((x) => (x.type as unknown) === 'Text' && x.props.children === text);
      while ((n.type as unknown) !== 'Animated.View') n = n.parent!;
      return n;
    };
    const pointers = (text: string) => layerOf(text).findAll((x) => (x.type as unknown) === 'Path').length;
    expect({ hold: pointers(HINT_WORDS.hold), both: pointers(HINT_WORDS.holdBoth) }).toEqual({ hold: 1, both: 0 });
    await act(async () => r.unmount());
  });
});

describe('the row leaves the hint its room: no pill reaches the title or the card', () => {
  it('above and below the drawing, on every phone', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      for (const d of HINTED) {
        const w = widthOn(d, windowW);
        const box = deviceArtBox(d, w);
        const reach = hintReach(d, w, box.h);
        const slack = COURIER.pad + COURIER.column + Math.max(0, (COURIER.phoneH - box.h) / 2);
        const above = Math.max(box.rise, extraRoom(reach.above, slack, COURIER.clear));
        const below = extraRoom(reach.below, slack, COURIER.clear);
        const ctx = { phone, d };
        // The title ends `slack + above` over the drawing, the card `slack + below` under it.
        expect({ ...ctx, title: reach.above + COURIER.clear <= slack + above }).toEqual({ ...ctx, title: true });
        expect({ ...ctx, card: reach.below + COURIER.clear <= slack + below }).toEqual({ ...ctx, card: true });
        // The pills stay on the phone's screen.
        const a = deviceAnchors(d, w);
        const x0 = windowW - COURIER.gutter - box.w;
        for (const word of wordsOf(d)) {
          const p = pillBox(wordPlace(a, word.at, word.both)!, word.text);
          expect({ ...ctx, word, onScreen: x0 + p.left >= 0 && x0 + p.right <= windowW }).toEqual({ ...ctx, word, onScreen: true });
        }
      }
    }
  });

  it('the Nova’s pill sits above the drawing and needs room there; the Nano X’s fit under it', () => {
    const w = widthOn('nova', 402);
    const box = deviceArtBox('nova', w);
    const reach = hintReach('nova', w, box.h);
    // The pill and its pointer, 6 over the top edge's bar.
    expect(reach.above).toBeCloseTo(6 + 5 + PILL_H - 1, 5);
    // Without room of its own it would reach into the title's line.
    expect(reach.above).toBeGreaterThan(COURIER.pad + COURIER.column);
    const nx = deviceArtBox('nanoX', widthOn('nanoX', 402));
    expect(hintReach('nanoX', widthOn('nanoX', 402), nx.h).above).toBe(0);
    // "Hold both" is the widest word the Nova shows, "Press both" the Nano X's.
    expect(wordsOf('nova').map((x) => x.text)).toContain(HINT_WORDS.holdBoth);
    expect(wordsOf('nanoX').map((x) => x.text)).toContain(HINT_WORDS.pressBoth);
  });
});

describe('the Nova after it is plugged in (decided 2026-10-04): the bottom edge’s middle and its three slots, their pills under the drawing', () => {
  const BOTTOM: HintControl[] = ['edgeMiddle', 'slot0', 'slot1', 'slot2'];

  it('a spot for each on the bottom edge, the middle of the body and the thirds of the screen, lit clear of the screen; the pill under it, on the phone', () => {
    for (const [phone, windowW] of Object.entries(PHONES)) {
      const w = widthOn('nova', windowW);
      const a = deviceAnchors('nova', w);
      if (a.kind !== 'nova') throw new Error('nova');
      const box = deviceArtBox('nova', w);
      const screen = rect(a.a.screen);
      const x0 = windowW - COURIER.gutter - box.w;
      for (const c of BOTTOM) {
        const s = spotOf(a, c)!;
        expect({ phone, c, spot: s != null && s.y === a.a.edgeBottom.y }).toEqual({ phone, c, spot: true });
        expect({ phone, c, clear: !overlaps(lightBox(c, s), screen) }).toEqual({ phone, c, clear: true });
        const p = wordPlace(a, c)!;
        expect({ phone, c, side: p.side, under: p.top > box.h }).toEqual({ phone, c, side: 'top', under: true });
        const pill = pillBox(p, HINT_WORDS.tap);
        expect({ phone, c, onScreen: x0 + pill.left >= 0 && x0 + pill.right <= windowW }).toEqual({ phone, c, onScreen: true });
      }
      // The middle of the BODY (the plug is not the body); the slots under the thirds of the screen.
      expect(a.a.edgeMiddle.x).toBeCloseTo(box.w - w / 2, 5);
      NOVA_SLOTS.forEach((sx, i) => expect(a.a.slots[i].x).toBeCloseTo(a.a.screen.x + sx * a.a.px, 5));
      // The three slots' bars never touch: one lights as its neighbour fades.
      for (let i = 1; i < 3; i++) expect(lightBox(`slot${i - 1}`, a.a.slots[i - 1]).right).toBeLessThan(lightBox(`slot${i}`, a.a.slots[i]).left);
    }
  });

  it('the row leaves the room under the drawing for those pills, on every phone', () => {
    for (const windowW of Object.values(PHONES)) {
      const w = widthOn('nova', windowW);
      const box = deviceArtBox('nova', w);
      const reach = hintReach('nova', w, box.h);
      // The pill with its pointer, 6 under the edge's bar, and the rise it comes in from.
      expect(reach.below).toBeCloseTo(6 + 5 + PILL_H + HINT_MS.word.lift - 1, 5);
      expect(reach.below).toBeGreaterThan(COURIER.pad + COURIER.column);
    }
    // A Ledger's turns add no reach: the same places, or places inside the screen.
    for (const d of ['gen5', 'flex', 'stax', 'nanoX'] as const) {
      const w = widthOn(d, 402);
      const box = deviceArtBox(d, w);
      expect({ d, below: hintReach(d, w, box.h).below }).toEqual({ d, below: d === 'nanoX' ? hintReach(d, w, box.h).below : 0 });
    }
  });
});
