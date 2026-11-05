/**
 * The press hint, design C "Lit control, one word" (decided 2026-10-03: "lets go
 * with C"): what the client presses on each device, when each hint plays in
 * a pass of the looping tour, and every value it takes from the one clock.
 * Pure: the timings, the order of cause and effect, Reduce Motion's still
 * hint, the Nova's two-edge hold (corrected the same evening), and the
 * gesture line saying what the hint shows.
 */
import {
  HINT_MS,
  HINT_WORDS,
  deviceHint,
  extraRoom,
  hintBeats,
  hintPlan,
  inOut,
  planFromCues,
  pulseFill,
  scrollSegs,
  swipeCue,
  swipeStrokes,
  swipeStrokesOf,
  swipeWord,
  track,
  valueAt,
} from '../pressHintScript';
import type { Channel, HintControl, HintPlan, Track } from '../pressHintScript';
import { novaScrollTravel } from '../deviceScreenLayout';
import {
  DEVICE_DRAWINGS,
  HOLD_PAGE_MS,
  NOVA_SWIPE_MS,
  NOVA_TOTAL_MS,
  TOUCH_SIGN_MS,
  gestureLine,
  novaSwipePageMs,
  reviewPages,
  tourCycle,
  tourStarts,
} from '../../hww/signingDevice';
import type { DeviceDrawing, ReviewPage, TourFacts } from '../../hww/signingDevice';

const TO = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const LEDGER: TourFacts = {
  brand: 'ledger',
  network: 'bitcoin',
  registeredName: 'Family vault',
  nameFirst: false,
  bitboxKind: null,
  outputs: [{ address: TO, amountSats: 1_250_000 }],
  feeSats: 1200,
  lockTime: { lockTime: 921380, rbf: true },
};
const NOVA: TourFacts = { ...LEDGER, brand: 'bitbox', bitboxKind: { kind: 'multisig', threshold: 2, keys: 3 } };

/** Every vault shape a device can meet: two payments, a refresh (nothing
 *  leaves), a one-key vault, the name asked first, a Nova with Total alone,
 *  a Nova paying two people, a Nova paying nobody else (a refresh). */
const FACTS: TourFacts[] = [
  LEDGER,
  { ...LEDGER, outputs: [...LEDGER.outputs, { address: TO, amountSats: 5000 }] },
  { ...LEDGER, outputs: [] },
  { ...LEDGER, registeredName: null },
  { ...LEDGER, nameFirst: true },
  NOVA,
  { ...NOVA, bitboxKind: { kind: 'policy', keys: 3 } },
  { ...NOVA, registeredName: null, bitboxKind: { kind: 'single' }, outputs: [], lockTime: null },
  { ...NOVA, outputs: [...NOVA.outputs, { address: TO, amountSats: 5000 }] },
  { ...NOVA, outputs: [] },
];

const HINTED: DeviceDrawing[] = ['gen5', 'flex', 'stax', 'nanoX', 'nova'];

function planFor(d: DeviceDrawing, f: TourFacts): { plan: HintPlan; pages: ReviewPage[]; starts: number[]; cycle: number } {
  const pages = reviewPages(d, f);
  const starts = tourStarts(pages);
  const cycle = tourCycle(pages);
  const plan = hintPlan(d, pages, starts, cycle);
  if (plan == null) throw new Error(`no plan for ${d}`);
  return { plan, pages, starts, cycle };
}

/** How many strokes a tour swipes in all: the Nova's amount pages, two each. */
const swipesIn = (d: DeviceDrawing, pages: readonly ReviewPage[]) => pages.reduce((n, p) => n + swipeStrokesOf(d, p), 0);

const at = (c: Track, t: number) => valueAt(c, t);
const lit = (p: HintPlan, c: HintControl) => p.lit.find((l) => l.control === c)!;
const word = (p: HintPlan, text: string) => p.words.find((w) => w.text === text)!;
const allChannels = (p: HintPlan): Channel[] => [
  ...p.lit.flatMap((l) => [l.ring, l.fill, ...(l.along ? [l.along] : [])]),
  ...p.words.flatMap((w) => [w.opacity, w.rise]),
  ...(p.progress?.kind === 'line' ? [p.progress.fill, p.progress.page, p.progress.signing] : []),
  ...(p.progress?.kind === 'arrows' ? [p.progress.page, p.progress.confirmed, p.progress.up, p.progress.upRise, p.progress.slide] : []),
  ...p.scrolls.map((s) => s.scroll),
];

describe('what the client presses, per device', () => {
  it('every Ledger model and the Nova get a hint; a Ledger of unknown model none', () => {
    for (const d of HINTED) expect({ d, hint: deviceHint(d) != null }).toEqual({ d, hint: true });
    expect(deviceHint('slab')).toBeNull();
    for (const f of FACTS) {
      const pages = reviewPages('slab', f);
      expect(hintPlan('slab', pages, tourStarts(pages), tourCycle(pages))).toBeNull();
    }
    expect(DEVICE_DRAWINGS.filter((d) => deviceHint(d) == null)).toEqual(['slab']);
  });

  it('the touchscreens light the footer’s ">" and the tile, the Nano X its buttons, the Nova its right edges', () => {
    // The touchscreens' ">" is drawn by the page (the last page has none).
    expect(deviceHint('gen5')).toEqual({
      advance: { control: 'next', word: 'Tap', onPage: true },
      sign: { gesture: 'hold', controls: ['tile'], word: 'Hold' },
      // Before the PIN: the side button that turns the device on (decided 2026-10-04).
      before: { controls: ['side'], words: ['side'] },
    });
    expect(deviceHint('flex')).toEqual(deviceHint('gen5'));
    expect(deviceHint('stax')).toEqual(deviceHint('gen5'));
    expect(deviceHint('nanoX')).toEqual({
      advance: { control: 'right', word: 'Press', onPage: false },
      sign: { gesture: 'both', controls: ['right', 'left'], word: 'Press both' },
    });
    expect(deviceHint('nova')).toEqual({
      advance: { control: 'edgeTop', word: 'Tap', onPage: false },
      sign: { gesture: 'edges', controls: ['edgeTop', 'edgeBottom'], word: 'Hold', wordBoth: 'Hold both' },
      // After it is plugged in: the middle of the bottom edge and its three
      // slots, each with its pill under it; and the whole lower edge run
      // along for a line the device scrolls (the address, decided 2026-10-04).
      before: { controls: ['edgeMiddle', 'slot0', 'slot1', 'slot2', 'edgeAlong'], words: ['edgeMiddle', 'slot0', 'slot1', 'slot2', 'edgeAlong'] },
    });
    // The Nano X's turns press the same two buttons: no place beyond the review's.
    expect(deviceHint('nanoX')!.before).toBeUndefined();
  });

  it('one short word per pill, no em dash', () => {
    for (const w of Object.values(HINT_WORDS)) {
      expect(w.split(' ').length).toBeLessThanOrEqual(2);
      expect(w).not.toMatch(/[—–]/);
    }
  });

  it('the gesture line under the card says what the hint shows', () => {
    // The control each light names, in the line's words.
    const named: Partial<Record<HintControl, string>> = {
      next: 'the arrow at the bottom',
      tile: 'hold to sign',
      right: 'the right button',
      left: 'both buttons',
      edgeTop: 'the top right edge',
      edgeBottom: 'the bottom right edge',
    };
    for (const d of HINTED) {
      const hint = deviceHint(d)!;
      const line = gestureLine(d, d === 'nova' ? NOVA : LEDGER);
      // It starts with the moving-on word ("Tap ...", "Press ...").
      expect({ d, starts: line.startsWith(`${hint.advance.word} `) }).toEqual({ d, starts: true });
      // It says the signing word ("hold", "press both").
      expect({ d, signs: line.toLowerCase().includes(hint.sign.word.toLowerCase()) }).toEqual({ d, signs: true });
      for (const c of [hint.advance.control, ...hint.sign.controls]) {
        expect({ d, c, named: line.includes(named[c]!) }).toEqual({ d, c, named: true });
      }
    }
    // "Swipe" is said exactly where the hint shows it: the Nova's amount
    // pages, whose address runs past the screen (decided 2026-10-05); never on a
    // Ledger, whose hint lights a control to tap or press instead.
    for (const d of HINTED) {
      for (const f of FACTS) {
        const { plan } = planFor(d, f);
        const shown = plan.words.some((w) => w.text === HINT_WORDS.swipe);
        expect({ d, f, swipe: /swipe/i.test(gestureLine(d, f)) }).toEqual({ d, f, swipe: shown });
        expect({ d, f, lit: plan.lit.some((l) => l.control === 'edgeAlong') }).toEqual({ d, f, lit: shown });
      }
    }
  });

  it('the line speaks of moving on exactly where the hint shows it (decided 2026-10-04)', () => {
    // A Nova whose only page is Total shows no "Tap": its line opens on the hold.
    for (const d of HINTED) {
      for (const f of FACTS) {
        const { plan } = planFor(d, f);
        const tapShown = plan.words.some((w) => w.text === plan.hint.advance.word && w.at === plan.hint.advance.control);
        const line = gestureLine(d, f);
        expect({ d, f, opensOnIt: line.startsWith(`${plan.hint.advance.word} `) }).toEqual({ d, f, opensOnIt: tapShown });
        expect({ d, f, signs: line.toLowerCase().includes(plan.hint.sign.word.toLowerCase()) }).toEqual({ d, f, signs: true });
      }
    }
  });
});

describe('when: beats inside one pass, never overlapping, cause before effect', () => {
  it('every beat sits in the pass, in order, one at a time', () => {
    for (const d of HINTED) {
      for (const f of FACTS) {
        const pages = reviewPages(d, f);
        const starts = tourStarts(pages);
        const cycle = tourCycle(pages);
        const beats = hintBeats(d, pages, starts, cycle);
        // One per page (its turn, or the sign), plus a stroke for each swipe.
        expect(beats.length).toBe(pages.length + swipesIn(d, pages));
        beats.forEach((b, i) => {
          const ctx = { d, i, b };
          expect({ ...ctx, ok: b.in >= 0 && b.in < b.down && b.down < b.at && b.at <= b.out && b.out <= cycle }).toEqual({ ...ctx, ok: true });
          if (i > 0) expect({ ...ctx, apart: beats[i - 1].out <= b.in }).toEqual({ ...ctx, apart: true });
        });
      }
    }
  });

  it('moving on: lit 0.7 s before the page turns, pressed 0.15 s before, the word gone 0.45 s after', () => {
    for (const d of HINTED) {
      const pages = reviewPages(d, LEDGER.brand === 'ledger' && d === 'nova' ? NOVA : LEDGER);
      const starts = tourStarts(pages);
      const beats = hintBeats(d, pages, starts, tourCycle(pages)).filter((b) => b.gesture === 'tap');
      expect(beats.length).toBe(pages.length - 1);
      beats.forEach((b, i) => {
        // The page turns at the next page's start, on the page before it.
        expect(b.page).toBe(i);
        expect(b.at).toBe(starts[i + 1]);
        expect(b.at - b.in).toBe(700);
        expect(b.at - b.down).toBe(150);
        // Onto a touchscreen's last page the hint goes with the turn (below).
        const withPage = ['gen5', 'flex', 'stax'].includes(d) && i === beats.length - 1;
        expect({ d, i, after: b.out - b.at }).toEqual({ d, i, after: withPage ? 0 : 450 });
      });
    }
  });

  it('the touchscreens’ last turn: the ">"’s hint goes with the page that drew it (decided 2026-10-04)', () => {
    // The last page has no ">", and its "Hold to sign" tile sits right under
    // the "Tap" pill: what lit the ">" must not linger there.
    for (const d of ['gen5', 'flex', 'stax'] as DeviceDrawing[]) {
      for (const f of FACTS.filter((x) => x.brand === 'ledger')) {
        const { plan, starts } = planFor(d, f);
        const L = starts[starts.length - 1];
        const tap = word(plan, HINT_WORDS.tap);
        const next = lit(plan, 'next');
        // Up to the turn: lit, pressed, its word up.
        expect([at(tap.opacity, L - 1), at(next.ring, L - 1), at(next.fill, L - 1)]).toEqual([1, 1, HINT_MS.fill.level]);
        // Gone with it.
        for (const t of [L + 1, L + 100, L + HINT_MS.tap.fade - 1]) {
          expect({ d, t, word: at(tap.opacity, t), ring: at(next.ring, t), fill: at(next.fill, t) }).toEqual({ d, t, word: 0, ring: 0, fill: 0 });
        }
        // Every earlier turn keeps its fade: the next page has a ">" in the same place.
        const first = plan.beats[0];
        expect(at(tap.opacity, first.at + 100)).toBe(1);
        expect(at(next.fill, first.at + 100)).toBeGreaterThan(0);
      }
    }
    // The Nano X's and the Nova's controls stay where they were, and their
    // words sit off the screen: their last turn fades as every other.
    for (const d of ['nanoX', 'nova'] as DeviceDrawing[]) {
      const { plan, starts } = planFor(d, d === 'nova' ? NOVA : LEDGER);
      const L = starts[starts.length - 1];
      expect({ d, word: at(word(plan, plan.hint.advance.word).opacity, L + 100) }).toEqual({ d, word: 1 });
    }
  });

  it('the touchscreens’ hold: read, pressed, held while the line fills, then the page ghosts (decided 2026-10-04)', () => {
    const m = TOUCH_SIGN_MS;
    for (const d of ['gen5', 'flex', 'stax'] as DeviceDrawing[]) {
      const pages = reviewPages(d, LEDGER);
      const starts = tourStarts(pages);
      const cycle = tourCycle(pages);
      const L = starts[starts.length - 1];
      const hold = hintBeats(d, pages, starts, cycle).at(-1)!;
      const down = L + m.read + m.press;
      // The light goes with the page as it ghosts: no fade after the hold.
      expect(hold).toMatchObject({ gesture: 'hold', page: pages.length - 1, in: L + m.read, down, at: down + m.hold, out: down + m.hold, withPage: true });
      // "Signing transaction" shows for the rest of the pass.
      expect(cycle - hold.at).toBe(m.signing);
    }
  });

  it('the Nano X’s both buttons: from 0.5 s into the sign page, pressed 0.5 s later for 0.4 s', () => {
    const pages = reviewPages('nanoX', LEDGER);
    const starts = tourStarts(pages);
    const cycle = tourCycle(pages);
    const L = starts[starts.length - 1];
    const both = hintBeats('nanoX', pages, starts, cycle).at(-1)!;
    expect(both).toMatchObject({ gesture: 'both', in: L + 500, down: L + 1000, at: L + 1400 });
    // The sign page stays HOLD_PAGE_MS, room for all of it.
    expect(cycle - L).toBe(HOLD_PAGE_MS);
    expect(both.out).toBeLessThanOrEqual(cycle);
  });

  it('the Nova’s Total: the top held, THEN the bottom, THEN the arrows meet, THEN the device confirms', () => {
    for (const f of FACTS.filter((x) => x.brand === 'bitbox')) {
      const pages = reviewPages('nova', f);
      const starts = tourStarts(pages);
      const cycle = tourCycle(pages);
      const L = starts[starts.length - 1];
      const b = hintBeats('nova', pages, starts, cycle).at(-1)!;
      const s = NOVA_TOTAL_MS;
      expect(b.gesture).toBe('edges');
      expect(b.in).toBe(L + 500);
      expect(b.down).toBe(L + s.read);
      expect(b.then).toEqual({ in: L + s.read + s.top, down: L + s.read + s.top + HINT_MS.edges.press });
      expect(b.slide).toBe(L + s.read + s.top + s.both);
      expect(b.at).toBe(L + s.read + s.top + s.both + s.meet);
      // Strictly one after the other.
      expect(b.down < b.then!.in && b.then!.in < b.then!.down && b.then!.down < b.slide! && b.slide! < b.at).toBe(true);
      // "Transaction confirmed" stays at least a second before the tour
      // starts again; longer where a swiped amount page outlasts Total's own
      // sequence, since the last page is held as long as the longest.
      const swiped = pages.some((p) => swipeStrokesOf('nova', p) > 0);
      expect(cycle - b.at).toBe(swiped ? novaSwipePageMs(NOVA_SWIPE_MS.strokes) - (b.at - L) : s.confirmed);
      expect(cycle - b.at).toBeGreaterThanOrEqual(s.confirmed);
    }
  });

  it('the Nova’s amount page (decided 2026-10-05): the address read, "Swipe" along the lower edge twice carrying the line to its end, the end read, THEN the tap; nothing of it on a Ledger or on any other page', () => {
    const sw = NOVA_SWIPE_MS;
    for (const f of FACTS.filter((x) => x.brand === 'bitbox')) {
      const { plan, pages, starts } = planFor('nova', f);
      const outputs = pages.flatMap((p, i) => (p.kind === 'nova-output' ? [{ p, i }] : []));
      const swipes = plan.beats.filter((b) => b.gesture === 'swipe');
      expect(swipes).toHaveLength(outputs.length * sw.strokes);
      expect(plan.scrolls.map((s) => s.page)).toEqual(outputs.map(({ i }) => i));
      for (const { p, i } of outputs) {
        const L = starts[i];
        const T = starts[i + 1];
        const strokes = swipes.filter((b) => b.page === i);
        // The strokes as the address check plays them: one builder, from the line read.
        expect(strokes.map(({ in: start, down, at: end, out }) => ({ in: start, down, at: end, out }))).toEqual(swipeStrokes(L + sw.read, sw.strokes));
        expect(strokes[0].in).toBe(L + sw.read);
        expect(strokes[1].in).toBe(strokes[0].at + sw.lift);
        // The order on the page: stroke, stroke, a pause once the last light
        // has gone (most of a second, then the edge lights), then the tap that turns it.
        const tap = plan.beats.find((b) => b.gesture === 'tap' && b.page === i)!;
        const last = strokes[strokes.length - 1];
        expect(last.out).toBeLessThan(tap.in);
        expect(tap.in - last.out).toBe(sw.settle - HINT_MS.tap.lead);
        expect(tap.in - last.out).toBeGreaterThanOrEqual(500);
        expect(tap.at).toBe(T);
        expect(T - L).toBe(novaSwipePageMs(sw.strokes));
        // The beats in time order: the swipes of this page sit between the turn onto it and the turn off it.
        const order = plan.beats.map((b) => `${b.gesture}@${b.page}`);
        expect(order.indexOf(`swipe@${i}`)).toBeGreaterThan(order.indexOf(`tap@${i - 1}`));
        expect(order.lastIndexOf(`swipe@${i}`)).toBeLessThan(order.indexOf(`tap@${i}`));
        // The line: still at the start, half way after the first stroke, at its end after the second, there until the page turns, at its start again in both stills.
        const sc = plan.scrolls.find((s) => s.page === i)!;
        if (p.kind !== 'nova-output') throw new Error(p.kind);
        expect(sc.travel).toBeCloseTo(novaScrollTravel(p.to), 5);
        expect(sc.travel).toBeGreaterThan(0);
        expect(at(sc.scroll, L)).toBe(0);
        expect(at(sc.scroll, strokes[0].down)).toBe(0);
        expect(at(sc.scroll, (strokes[0].down + strokes[0].at) / 2)).toBeCloseTo(0.25, 5);
        expect(at(sc.scroll, strokes[0].at)).toBeCloseTo(0.5, 5);
        expect(at(sc.scroll, strokes[1].down)).toBeCloseTo(0.5, 5);
        expect(at(sc.scroll, strokes[1].at)).toBe(1);
        expect(at(sc.scroll, T - 1)).toBe(1);
        expect(at(sc.scroll, T + 1)).toBe(0);
        expect(sc.scroll.still).toEqual([0, 0]);
        // The light travels the lower edge from its right end to its left with "Swipe" under it, lit for each stroke, gone between.
        const along = lit(plan, 'edgeAlong');
        expect(along.along).toBeDefined();
        expect(at(along.ring, strokes[0].in + HINT_MS.ring.in)).toBe(1);
        expect(at(along.along!, strokes[0].down)).toBe(1);
        expect(at(along.along!, strokes[0].at)).toBe(-1);
        expect(at(along.ring, strokes[0].out)).toBe(0);
        expect(at(along.ring, strokes[1].in - 1)).toBe(0);
        expect(at(along.fill, (strokes[1].down + strokes[1].at) / 2)).toBeCloseTo(HINT_MS.fill.level, 5);
        expect(at(word(plan, HINT_WORDS.swipe).opacity, strokes[0].down)).toBe(1);
        expect(at(word(plan, HINT_WORDS.swipe).opacity, tap.in)).toBe(0);
        // Nothing of the swipe is lit while the tap plays.
        expect(at(along.ring, tap.down)).toBe(0);
      }
      // Never a still: Reduce Motion shows the tap, not the swipe.
      for (const said of plan.words.filter((w) => w.text === HINT_WORDS.swipe)) expect(said.opacity.still).toEqual([0, 0]);
      if (outputs.length > 0) expect(lit(plan, 'edgeAlong').ring.still).toEqual([0, 0]);
    }
    // A Ledger's pages never swipe; a Nova page that is not an amount's neither.
    for (const d of HINTED.filter((x) => x !== 'nova')) {
      for (const f of FACTS) {
        const { plan, pages } = planFor(d, f);
        expect({ d, swipes: plan.beats.filter((b) => b.gesture === 'swipe') }).toEqual({ d, swipes: [] });
        expect({ d, scrolls: plan.scrolls }).toEqual({ d, scrolls: [] });
        expect({ d, lit: plan.lit.some((l) => l.control === 'edgeAlong') }).toEqual({ d, lit: false });
        for (const p of pages) expect({ d, p, strokes: swipeStrokesOf(d, p) }).toEqual({ d, p, strokes: 0 });
      }
    }
    for (const f of [FACTS[7], FACTS[9]]) {
      const { plan, pages } = planFor('nova', f);
      expect(pages.some((p) => p.kind === 'nova-output')).toBe(false);
      expect(plan.beats.filter((b) => b.gesture === 'swipe')).toEqual([]);
      expect(plan.scrolls).toEqual([]);
    }
    // A line that fits the screen is never swiped.
    expect(swipeStrokesOf('nova', { kind: 'nova-output', amount: '1 BTC', to: 'bc1q shor t' })).toBe(0);
    expect(swipeStrokesOf('nova', { kind: 'nova-item', title: 'Spend from', body: 'x' })).toBe(0);
    // The one builder's pieces, as the address check uses them.
    const [s0, s1] = swipeStrokes(1000, 2);
    expect(s0).toEqual({ in: 1000, down: 1350, at: 2450, out: 2750 });
    expect(s1).toEqual({ in: 2950, down: 3300, at: 4400, out: 4700 });
    expect(swipeCue(s0)).toEqual({ controls: ['edgeAlong'], in: 1000, presses: [{ down: 1350, at: 2450 }], out: 2750, swipe: { from: 1350, to: 2450 } });
    expect(swipeWord(s0)).toEqual({ text: HINT_WORDS.swipe, at: 'edgeAlong', both: false, in: 1000, out: 2750 });
    const segs = scrollSegs([s0, s1], 9000);
    expect(segs.map((s) => [s.from, s.to, s.v0, s.v1])).toEqual([
      [1350, 2450, 0, 0.5],
      [2450, 3300, 0.5, 0.5],
      [3300, 4400, 0.5, 1],
      [4400, 9000, 1, 1],
    ]);
    expect(swipeStrokes(0, 0)).toEqual([]);
  });
});

describe('the keyframes: one clock, rising input ranges', () => {
  it('every channel of every plan rises from 0 to the end of the pass', () => {
    for (const d of HINTED) {
      for (const f of FACTS) {
        const { plan, cycle } = planFor(d, f);
        for (const c of allChannels(plan)) {
          const x = c.inputRange;
          expect(x[0]).toBe(0);
          expect(x[x.length - 1]).toBeGreaterThanOrEqual(cycle);
          for (let i = 1; i < x.length; i++) expect({ d, i, rises: x[i] > x[i - 1] }).toEqual({ d, i, rises: true });
          expect(c.outputRange.length).toBe(x.length);
          expect(c.outputRange.every((v) => Number.isFinite(v))).toBe(true);
        }
      }
    }
  });

  it('a track holds its base outside its segments and a segment that ends the pass keeps its value', () => {
    const t = track(0, [{ from: 100, to: 200, v0: 0, v1: 1 }], 1000);
    expect(at(t, 50)).toBe(0);
    expect(at(t, 150)).toBeCloseTo(0.5, 5);
    expect(at(t, 200)).toBe(1);
    expect(at(t, 300)).toBe(0);
    const end = track(0, [{ from: 900, to: 1000, v0: 1, v1: 1 }], 1000);
    expect(at(end, 999)).toBe(1);
    expect(at(end, 1000)).toBe(1);
  });

  it('a pulse dips and comes back, or holds when there is no room for one', () => {
    expect(pulseFill(0, 300, 400, 0.35)).toEqual([{ from: 0, to: 300, v0: 1, v1: 1 }]);
    const p = pulseFill(0, 840, 400, 0.35);
    expect(p).toHaveLength(4);
    expect(p[p.length - 1].to).toBe(840);
    // Moving on leaves room for one soft pulse before the press.
    expect(HINT_MS.tap.lead - HINT_MS.ring.in - HINT_MS.tap.press).toBeGreaterThanOrEqual(HINT_MS.ring.pulse);
  });

  it('nothing is lit at either end of a pass: the next pass starts clean', () => {
    for (const d of HINTED) {
      for (const f of FACTS) {
        const { plan, cycle } = planFor(d, f);
        for (const c of [...plan.lit.flatMap((l) => [l.ring, l.fill]), ...plan.words.map((w) => w.opacity)]) {
          expect({ d, start: at(c, 0), end: at(c, cycle) }).toEqual({ d, start: 0, end: 0 });
        }
      }
    }
  });
});

describe('what it looks like on the clock', () => {
  it('moving on: the ring pulses until the press, the press fills it, the page turns, then it all fades', () => {
    for (const d of HINTED) {
      const { plan } = planFor(d, d === 'nova' ? NOVA : LEDGER);
      const b = plan.beats[0];
      const l = lit(plan, plan.hint.advance.control);
      const w = word(plan, plan.hint.advance.word);
      expect(at(l.ring, b.in - 1)).toBe(0);
      expect(at(l.ring, b.in + 150)).toBe(1);
      // A soft pulse down to 35% and back before the press.
      let low = 1;
      for (let t = b.in + 150; t < b.down; t += 5) low = Math.min(low, at(l.ring, t));
      expect(low).toBeCloseTo(HINT_MS.ring.low, 2);
      // The fill appears at the press and holds through the turn...
      expect(at(l.fill, b.down - 1)).toBe(0);
      expect(at(l.fill, b.down + 80)).toBeCloseTo(HINT_MS.fill.level, 5);
      expect(at(l.fill, b.at - 1)).toBeCloseTo(HINT_MS.fill.level, 5);
      // ...and is gone 0.25 s after it; the ring and the word by the end.
      expect(at(l.fill, b.at + 250)).toBe(0);
      expect(at(l.ring, b.at + 100)).toBe(1);
      expect(at(l.ring, b.out)).toBe(0);
      // The word rises in with the ring and fades 0.45 s after the turn.
      expect(at(w.opacity, b.in)).toBe(0);
      expect(at(w.opacity, b.in + 200)).toBe(1);
      expect(at(w.rise, b.in)).toBe(HINT_MS.word.lift);
      expect(at(w.rise, b.in + 220)).toBe(0);
      expect(at(w.opacity, b.at + 150)).toBe(1);
      expect(at(w.opacity, b.out)).toBe(0);
    }
  });

  it('the touchscreens’ hold: the tile lit and held while the line fills, then the page ghosts into "Signing transaction" (decided 2026-10-04)', () => {
    const g = HINT_MS.ghost;
    for (const d of ['gen5', 'flex', 'stax'] as DeviceDrawing[]) {
      const { plan, cycle } = planFor(d, LEDGER);
      const b = plan.beats.at(-1)!;
      const tile = lit(plan, 'tile');
      const p = plan.progress!;
      expect(p.kind).toBe('line');
      if (p.kind !== 'line') return;
      // Lit and pulsing, then pressed: the green ring stays round the tile
      // through the hold (the device draws no ring of its own), the tint on.
      expect(at(tile.ring, b.in + 150)).toBe(1);
      expect(at(tile.fill, b.down + 100)).toBeCloseTo(HINT_MS.fill.level, 5);
      expect(at(word(plan, 'Hold').opacity, b.in + 200)).toBe(1);
      for (const t of [b.down + 100, (b.down + b.at) / 2, b.at - 1]) {
        expect({ d, t, ring: at(tile.ring, t), tint: at(tile.fill, t), word: at(word(plan, 'Hold').opacity, t) }).toEqual({ d, t, ring: 1, tint: HINT_MS.fill.level, word: 1 });
      }
      // The line fills from the press to the hold's end, left to right, and stays.
      expect(at(p.fill, b.down - 1)).toBe(0);
      expect(at(p.fill, (b.down + b.at) / 2)).toBeCloseTo(0.5, 2);
      expect(at(p.fill, b.at)).toBe(1);
      expect(at(p.fill, cycle)).toBe(1);
      // The page is whole until the hold completes...
      expect(at(p.page, b.at)).toBe(1);
      expect(at(p.signing, b.at)).toBe(0);
      // ...then ghosts (its ink left for a moment) as "Signing transaction" comes, and is gone.
      expect(at(p.page, b.at + g.in)).toBeCloseTo(g.level, 5);
      expect(at(p.page, b.at + g.ms)).toBeCloseTo(g.level, 5);
      expect(at(p.signing, b.at + g.in)).toBe(1);
      expect(at(p.page, b.at + g.ms + g.in)).toBe(0);
      expect(at(p.page, cycle)).toBe(0);
      expect(at(p.signing, cycle)).toBe(1);
      // The tile's light and the word go with the page: nothing lit over the ghost.
      for (const t of [b.at + 1, b.at + 100, cycle]) {
        expect({ d, t, ring: at(tile.ring, t), tint: at(tile.fill, t), word: at(word(plan, 'Hold').opacity, t) }).toEqual({ d, t, ring: 0, tint: 0, word: 0 });
      }
    }
    // The Nano X and the Nova draw no such line.
    for (const d of ['nanoX', 'nova'] as DeviceDrawing[]) {
      expect(planFor(d, d === 'nova' ? NOVA : LEDGER).plan.progress?.kind).not.toBe('line');
    }
  });

  it('a word about both controls is marked so, and points at neither (decided 2026-10-04)', () => {
    for (const d of HINTED) {
      const { plan } = planFor(d, d === 'nova' ? NOVA : LEDGER);
      const both = plan.words.filter((w) => w.both).map((w) => w.text);
      expect({ d, both }).toEqual({ d, both: d === 'nanoX' ? ['Press both'] : d === 'nova' ? ['Hold both'] : [] });
    }
  });

  it('the Nano X: both buttons lit together, one word between them, pressed together', () => {
    const { plan } = planFor('nanoX', LEDGER);
    const b = plan.beats.at(-1)!;
    expect(word(plan, 'Press both').at).toBe('between');
    for (const c of ['right', 'left'] as HintControl[]) {
      expect(at(lit(plan, c).ring, b.in + 150)).toBe(1);
      expect(at(lit(plan, c).fill, b.down + 80)).toBeCloseTo(HINT_MS.fill.level, 5);
      expect(at(lit(plan, c).fill, b.at + 250)).toBe(0);
    }
    expect(plan.progress).toBeNull();
  });

  it('the Nova: "Hold" on the top edge, the up arrow and the bottom edge once it is held, "Hold both", the arrows meet, the device confirms', () => {
    for (const f of FACTS.filter((x) => x.brand === 'bitbox')) {
      const { plan, cycle } = planFor('nova', f);
      const b = plan.beats.at(-1)!;
      const then = b.then!;
      const top = lit(plan, 'edgeTop');
      const bottom = lit(plan, 'edgeBottom');
      const p = plan.progress!;
      expect(p.kind).toBe('arrows');
      if (p.kind !== 'arrows') return;
      // Step 1: the down arrow alone, the top lit and held, "Hold".
      const step1 = (b.down + then.in) / 2;
      expect(at(p.up, step1)).toBe(0);
      expect(at(top.ring, step1)).toBe(1);
      expect(at(top.fill, step1)).toBeCloseTo(HINT_MS.fill.level, 5);
      expect(at(bottom.ring, step1)).toBe(0);
      expect(at(word(plan, 'Hold').opacity, step1)).toBe(1);
      expect(at(word(plan, 'Hold both').opacity, step1)).toBe(0);
      // Step 2: the up arrow comes in, the bottom lights and is held too, "Hold both".
      const step2 = (then.down + b.slide!) / 2;
      expect(at(p.up, step2)).toBe(1);
      expect(at(bottom.ring, step2)).toBe(1);
      expect(at(bottom.fill, step2)).toBeCloseTo(HINT_MS.fill.level, 5);
      expect(at(top.fill, step2)).toBeCloseTo(HINT_MS.fill.level, 5);
      expect(at(word(plan, 'Hold').opacity, step2)).toBe(0);
      expect(at(word(plan, 'Hold both').opacity, step2)).toBe(1);
      expect(at(p.slide, step2)).toBe(0);
      // Step 3: both held while the arrows slide together and meet.
      const mid = (b.slide! + b.at) / 2;
      expect(at(p.slide, mid)).toBeGreaterThan(0.2);
      expect(at(p.slide, mid)).toBeLessThan(0.8);
      expect(at(top.fill, mid)).toBeCloseTo(HINT_MS.fill.level, 5);
      expect(at(bottom.fill, mid)).toBeCloseTo(HINT_MS.fill.level, 5);
      expect(at(p.page, b.at - 1)).toBe(1);
      expect(at(p.confirmed, b.at - 1)).toBe(0);
      // Then the device confirms, and the lights fade.
      expect(at(p.slide, b.at)).toBe(1);
      expect(at(p.confirmed, b.at + 1)).toBe(1);
      expect(at(p.page, b.at + 1)).toBe(0);
      expect(at(p.confirmed, cycle)).toBe(1);
      for (const l of [top, bottom]) {
        expect(at(l.fill, b.at + 250)).toBe(0);
        expect(at(l.ring, b.out)).toBe(0);
      }
      expect(at(word(plan, 'Hold both').opacity, b.out)).toBe(0);
      // One word at a time on the pill: "Hold" goes before "Hold both" comes.
      for (let t = b.in; t <= b.out; t += 5) {
        const both = [at(word(plan, 'Hold').opacity, t), at(word(plan, 'Hold both').opacity, t)];
        expect({ t, oneAtATime: Math.min(...both) === 0 }).toEqual({ t, oneAtATime: true });
      }
    }
  });
});

describe('Reduce Motion: a still hint for the page on show', () => {
  it('a page that moves on shows its lit control and word; the sign page shows what signs', () => {
    for (const d of HINTED) {
      const { plan } = planFor(d, d === 'nova' ? NOVA : LEDGER);
      const hint = plan.hint;
      for (const l of plan.lit) {
        // The touchscreens' tile is shown held (tinted) on the sign page, its
        // line half full below; every other control lit and not pressed.
        const held = hint.sign.gesture === 'hold' && l.control === 'tile';
        expect(l.fill.still).toEqual([0, held ? HINT_MS.fill.level : 0]);
        expect(l.ring.still).toEqual([l.control === hint.advance.control ? 1 : 0, hint.sign.controls.includes(l.control) ? 1 : 0]);
      }
      const shownOn = (side: 0 | 1) => plan.words.filter((w) => w.opacity.still[side] === 1).map((w) => w.text);
      expect(shownOn(0)).toEqual([hint.advance.word]);
      expect(shownOn(1)).toEqual([hint.sign.wordBoth ?? hint.sign.word]);
      expect(plan.words.every((w) => w.rise.still[0] === 0 && w.rise.still[1] === 0)).toBe(true);
    }
    // The Nova's still Total shows both arrows, both edges, before the meeting.
    const nova = planFor('nova', NOVA).plan.progress!;
    if (nova.kind === 'arrows') {
      expect([nova.up.still[1], nova.slide.still[1], nova.page.still[1], nova.confirmed.still[1]]).toEqual([1, 0, 1, 0]);
    }
    // The touchscreens' line half way, the page whole, "Signing transaction" not yet.
    const line = planFor('gen5', LEDGER).plan.progress!;
    expect(line.kind).toBe('line');
    if (line.kind === 'line') expect([line.fill.still, line.page.still, line.signing.still]).toEqual([[0, 0.5], [1, 1], [0, 0]]);
    // ...under the ringed, tinted tile.
    const tile = lit(planFor('gen5', LEDGER).plan, 'tile');
    expect([tile.ring.still[1], tile.fill.still[1]]).toEqual([1, HINT_MS.fill.level]);
  });
});

describe('the room beside the drawing', () => {
  it('a hint that reaches past the row’s own room gets the difference, rounded up', () => {
    expect(extraRoom(30, 20, 2)).toBe(12);
    expect(extraRoom(22.2, 28.4, 2)).toBe(0);
    expect(extraRoom(0, 0, 0)).toBe(0);
    expect(extraRoom(10.3, 10, 0)).toBe(1);
  });
});

describe('a swipe: the lit control travels (decided 2026-10-04, the Nova\u2019s address along its lower edge)', () => {
  it('lit at the right end until the finger touches, carried to the left end through the stroke, held there until its light goes; base at the right end between', () => {
    const hint = deviceHint('nova')!;
    const cue = { controls: ['edgeAlong' as const], in: 500, presses: [{ down: 900, at: 2000 }], out: 2300, swipe: { from: 900, to: 2000 } };
    const next = { controls: ['edgeAlong' as const], in: 2500, presses: [{ down: 2900, at: 4000 }], out: 4300, swipe: { from: 2900, to: 4000 } };
    const plan = planFromCues(hint, [cue, next], [], null, 6000);
    const l = plan.lit.find((x) => x.control === 'edgeAlong')!;
    expect(l.along).toBeDefined();
    const a = l.along!;
    expect(at(a, 0)).toBe(1);
    expect(at(a, 500)).toBe(1);
    expect(at(a, 900)).toBe(1);
    expect(at(a, 1450)).toBeCloseTo(1 - 2 * inOut(0.5), 5);
    expect(at(a, 2000)).toBe(-1);
    expect(at(a, 2300)).toBe(-1);
    // Back at the right end for the next stroke, unseen: its light is out.
    expect(at(a, 2400)).toBe(1);
    expect(at(l.ring, 2400)).toBe(0);
    expect(at(a, 2900)).toBe(1);
    expect(at(a, 4000)).toBe(-1);
    expect(at(a, 6000)).toBe(1);
    expect(a.still).toEqual([1, 1]);
    // The ring and the fill play as any press: lit before, filled through the stroke, gone after.
    expect(at(l.ring, 700)).toBeGreaterThan(0);
    expect(at(l.fill, 1500)).toBeCloseTo(HINT_MS.fill.level, 5);
    expect(at(l.fill, 2300)).toBe(0);
    // No swipe, no travel.
    const tap = { controls: ['edgeTop' as const], in: 0, presses: [{ down: 100, at: 200 }], out: 400 };
    expect(planFromCues(hint, [tap], [], null, 1000).lit[0].along).toBeUndefined();
    expect(HINT_WORDS.swipe).toBe('Swipe');
  });
});
