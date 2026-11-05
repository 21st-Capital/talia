/**
 * The press hint on the client's turn: design C, "Lit control, one word"
 * (decided 2026-10-03: "lets go with C"; the goal as stated, "a small animation
 * that shows the user where he needs to press ... so easy that even a grand
 * father can see what he needs to do"). Pure: what the client presses on each
 * device, WHEN each hint plays inside one pass of a looping guide, and every
 * value the overlay and the device's own progress take from the ONE clock
 * that runs the pass. `PressHint.tsx` draws it; tested in
 * `__tests__/pressHintScript.test.ts`.
 *
 * Two guides use it. The review tour (`hintPlan`, from the tour's page
 * starts):
 *
 *   touchscreen Ledgers   tap the footer's own ">" to move on (a swipe has
 *                         no control to light); on the last page hold the
 *                         "Hold to sign" tile while the device's thin line
 *                         fills along the row's top edge (decided 2026-10-04)
 *   Nano X                press the RIGHT button to move on; on "Sign
 *                         transaction" press BOTH buttons
 *   BitBox02 Nova         tap the top right edge to move on; on each amount's
 *                         page swipe along the lower edge from right to left
 *                         until the address's end shows, then tap (decided
 *                         2026-10-05); on Total hold the top right edge, then
 *                         the bottom right edge too once the up arrow shows;
 *                         the arrows meet and the device confirms
 *   unknown Ledger        no spot the app can vouch for: no hint
 *
 * And the turns before the transaction (`ui/hww/deviceTurns.ts`: a Ledger's
 * PIN and the app to open, the BitBox from the moment it is plugged in, the
 * address check), which hand their own cues and progress to `planFromCues`;
 * the address check's swipe is the review's (`swipeStrokes`, `swipeCue`,
 * `scrollSegs`: one builder, two guides).
 *
 * Cause and effect: the control lights and pulses, the press fills it, THEN
 * the page turns; the ring and the word fade after. It never draws over the
 * device's words (the overlay keeps clear of every drawn screen's text).
 */
import type { DeviceDrawing, ReviewPage } from '../hww/signingDevice';
import { NOVA_SWIPE_MS, NOVA_TOTAL_MS, TOUCH_SIGN_MS, isTouchscreen, novaSwipeStrokesFor } from '../hww/signingDevice';
import { novaScrollTravel } from './deviceScreenLayout';

// ─── What the client presses ─────────────────────────────────────────────────

/** One of a touch Ledger's twelve PIN keys, by cell (`ui/hww/deviceTurns.ts`). */
export type PinKey = `pin${number}`;

/** One of the Nova's three touch slots along its bottom edge, under the
 *  group printed over it (`deviceScreenLayout.ts` `NOVA_SLOTS`). */
export type SlotKey = `slot${number}`;

/** A control a hint can light: a touch Ledger's footer ">", its tile, its
 *  "Open" button, the dark "Approve" button of its registration's last page
 *  and the dark "Confirm" button of its address page (videos of the device,
 *  2026-10-04), its PIN keys and the side button that turns it on (decided
 *  2026-10-04), the Nano X's buttons, the Nova's top and bottom right edges,
 *  the middle of its bottom edge (the side facing the client, decided 2026-10-04),
 *  the three slots of its bottom edge, and its whole lower edge run along
 *  from right to left (`edgeAlong`: a swipe that scrolls the address, decided
 *  2026-10-04; the light travels, `HintCue.swipe`). */
export type HintControl = 'next' | 'tile' | 'open' | 'approve' | 'confirm' | 'side' | 'right' | 'left' | 'edgeTop' | 'edgeBottom' | 'edgeMiddle' | 'edgeAlong' | PinKey | SlotKey;

export const pinKey = (cell: number): PinKey => `pin${cell}`;
export const pinCellOf = (c: HintControl): number | null => (c.startsWith('pin') ? Number(c.slice(3)) : null);
export const slotKey = (slot: number): SlotKey => `slot${slot}`;
export const slotOf = (c: HintControl): number | null => (c.startsWith('slot') ? Number(c.slice(4)) : null);

/** How the last page signs: a hold, both buttons, or the Nova's two edges. */
export type SignGesture = 'hold' | 'both' | 'edges';

/** The words on the pills. */
export const HINT_WORDS = {
  tap: 'Tap',
  press: 'Press',
  hold: 'Hold',
  pressBoth: 'Press both',
  holdBoth: 'Hold both',
  swipe: 'Swipe',
} as const;

export interface DeviceHint {
  /**
   * The control that moves to the next page, and its word. `onPage`: the
   * page draws it (the touchscreens' footer ">"), and the last page has none.
   */
  advance: { control: HintControl; word: string; onPage: boolean };
  /** What signs on the last page: the controls in the order they are held. */
  sign: { gesture: SignGesture; controls: HintControl[]; word: string; wordBoth?: string };
  /** What the guide BEFORE the transaction lights beyond the review's
   *  controls, and where its words sit (the row leaves them their room,
   *  `hintReach`): the Nova's bottom edge, and a touch Ledger's side button
   *  (its keys and its Open button sit inside its screen). The Nano X's
   *  turns press the same two buttons, so it names none. */
  before?: { controls: HintControl[]; words: (HintControl | 'between' | 'band')[] };
}

/** What the client presses on this device; null where the app cannot say. */
export function deviceHint(d: DeviceDrawing): DeviceHint | null {
  if (isTouchscreen(d)) {
    return {
      advance: { control: 'next', word: HINT_WORDS.tap, onPage: true },
      sign: { gesture: 'hold', controls: ['tile'], word: HINT_WORDS.hold },
      // The side button turns the device on before its PIN (decided 2026-10-04).
      before: { controls: ['side'], words: ['side'] },
    };
  }
  if (d === 'nanoX') {
    return {
      advance: { control: 'right', word: HINT_WORDS.press, onPage: false },
      sign: { gesture: 'both', controls: ['right', 'left'], word: HINT_WORDS.pressBoth },
    };
  }
  if (d === 'nova') {
    // The lower edge: the middle for the side, the slots for the password,
    // and the whole edge run along for a line the device scrolls (the
    // address check); every pill sits under the drawing.
    const bottom: HintControl[] = ['edgeMiddle', slotKey(0), slotKey(1), slotKey(2), 'edgeAlong'];
    return {
      advance: { control: 'edgeTop', word: HINT_WORDS.tap, onPage: false },
      sign: { gesture: 'edges', controls: ['edgeTop', 'edgeBottom'], word: HINT_WORDS.hold, wordBoth: HINT_WORDS.holdBoth },
      before: { controls: bottom, words: bottom },
    };
  }
  return null;
}

// ─── When ────────────────────────────────────────────────────────────────────

/** The timings (ms), slow enough to follow. */
export const HINT_MS = {
  /** Moving on: lit 0.7 s before the page turn, pressed 0.15 s before it,
   *  the word gone 0.45 s after. */
  tap: { lead: 700, press: 150, fade: 450 },
  /** The Nano X's both buttons: lit 0.5 s into the sign page, pressed 0.5 s
   *  later, held 0.4 s. */
  both: { wait: 500, press: 500, held: 400, fade: 500 },
  /** The Nova's two edges: each lit 0.35 s before it is pressed; the word
   *  gone 0.45 s after the device confirms (the rest is `NOVA_TOTAL_MS`). */
  edges: { press: 350, fade: 450 },
  /** The ring: in, a pulse (full to `low` and back) about every `pulse`, out. */
  ring: { in: 150, pulse: 400, low: 0.35, out: 200 },
  /** The fill at the press: in, its strength, out after the turn; a quick
   *  press in a run (the Nano X's cursor stepping to the tick) is shorter. */
  fill: { in: 80, level: 0.55, out: 250, quickIn: 60, quickOut: 90 },
  /** The word: in, the rise (points) and how long, out; the swap of words. */
  word: { in: 200, rise: 220, lift: 4, out: 250, swap: 150 },
  /** The Nova's up arrow coming in, and its rise (in the screen's pixels). */
  arrow: { in: 250, lift: 3 },
  /** The touchscreens' page ghosting into "Signing transaction" at the end of
   *  the hold (the recording): the ink left on the page, and how long. */
  ghost: { level: 0.3, ms: 500, in: 80 },
} as const;

export interface HintBeat {
  /** `swipe`: one stroke along the Nova's lower edge on an amount's page (decided
   *  2026-10-05), the light at the right end at `in`, the finger on at
   *  `down`, at the left end at `at`, the light gone at `out`. */
  gesture: 'tap' | 'swipe' | SignGesture;
  /** The page the beat plays on. */
  page: number;
  /** The hint appears. */
  in: number;
  /** The press. */
  down: number;
  /** The page turns; the hold completes; both buttons release; the Nova's arrows meet; a stroke ends. */
  at: number;
  /** The hint has gone. */
  out: number;
  /** The hint goes with the page turn (`out` is `at`): the touchscreens'
   *  last turn, onto a page with no ">" and its tile under the "Tap" pill;
   *  and their hold, whose page ghosts away as it completes. */
  withPage?: boolean;
  /** The Nova only: the bottom right edge lights (the up arrow shows) and is pressed. */
  then?: { in: number; down: number };
  /** The Nova only: the arrows start sliding together. */
  slide?: number;
}

// ─── A swipe along the Nova's lower edge ─────────────────────────────────────

/** One stroke of a swipe along the Nova's lower edge from right to left: the
 *  light at the edge's right end at `in`, the finger on at `down`, at the left
 *  end at `at`, the light gone at `out` (`NOVA_SWIPE_MS`). */
export interface SwipeStroke {
  in: number;
  down: number;
  at: number;
  out: number;
}

/** The strokes of one swipe, the first lit at `from` (the line read): each
 *  `lead` before the finger touches, `stroke` long, the finger off `lift`
 *  before the next, the light gone `fade` after. The one pace for the
 *  address check's address and the review's amount pages (decided 2026-10-05:
 *  "the same swipe through the address until the end"). */
export function swipeStrokes(from: number, strokes: number): SwipeStroke[] {
  const sw = NOVA_SWIPE_MS;
  const out: SwipeStroke[] = [];
  let t = from;
  for (let k = 0; k < strokes; k++) {
    const down = t + sw.lead;
    const at = down + sw.stroke;
    out.push({ in: t, down, at, out: at + sw.fade });
    t = at + sw.lift;
  }
  return out;
}

/** The cue of one stroke: the travelling control lit at the right end, its
 *  press the stroke to the left end (`swipe`), gone after; no still (Reduce
 *  Motion shows the tap, never the swipe). */
export function swipeCue(s: SwipeStroke): HintCue {
  return { controls: ['edgeAlong'], in: s.in, presses: [{ down: s.down, at: s.at }], out: s.out, swipe: { from: s.down, to: s.at } };
}

/** "Swipe" under the travelling light, for as long as it is lit. */
export function swipeWord(s: SwipeStroke): HintWord {
  return { text: HINT_WORDS.swipe, at: 'edgeAlong', both: false, in: s.in, out: s.out };
}

/** The line carried along the strokes: a stroke's share each (0 at its start
 *  to 1 at its end), held where it was carried until the next finger, and at
 *  its end until `until` (the page's turn). */
export function scrollSegs(strokes: readonly SwipeStroke[], until: number): Seg[] {
  const n = strokes.length;
  return strokes.flatMap((s, k) => [
    seg(s.down, s.at, k / n, (k + 1) / n, inOut),
    k + 1 < n ? hold(s.at, strokes[k + 1].down, (k + 1) / n) : hold(s.at, until, 1),
  ]);
}

/** How many strokes a review page is swiped: the Nova's amount over an
 *  address that runs past its screen (decided 2026-10-05), none anywhere else. */
export function swipeStrokesOf(d: DeviceDrawing, page: ReviewPage | undefined): number {
  return d === 'nova' && page?.kind === 'nova-output' ? novaSwipeStrokesFor(page.to) : 0;
}

/**
 * Every beat of one pass of the review tour, in ms into the pass: on a page
 * the Nova swipes, its strokes once the line is read; one per page turn (the
 * page turns at its `at`, `tourStarts`); then the sign beat on the last page.
 * Nothing when the tour does not move (`cycle` 0) or the device has no hint.
 */
export function hintBeats(d: DeviceDrawing, pages: readonly ReviewPage[], starts: readonly number[], cycle: number): HintBeat[] {
  const hint = deviceHint(d);
  const n = starts.length;
  if (hint == null || n < 1 || cycle <= 0) return [];
  const beats: HintBeat[] = [];
  for (let i = 0; i + 1 < n; i++) {
    // The address swiped to its end, the end read, THEN the tap (decided 2026-10-05).
    for (const s of swipeStrokes(starts[i] + NOVA_SWIPE_MS.read, swipeStrokesOf(d, pages[i]))) beats.push({ gesture: 'swipe', page: i, ...s });
    const T = starts[i + 1];
    const m = HINT_MS.tap;
    // Onto the last page a control the page draws is gone, and on the
    // touchscreens the tile to hold sits right under the "Tap" pill: the
    // ring, the fill and the word go with the page that drew the control
    // (decided 2026-10-04). Every other turn lands on a page with the same
    // control in the same place, so its hint fades after the turn.
    const withPage = hint.advance.onPage && i + 2 === n;
    beats.push({ gesture: 'tap', page: i, in: T - m.lead, down: T - m.press, at: T, out: withPage ? T : T + m.fade, ...(withPage ? { withPage } : {}) });
  }
  const L = starts[n - 1];
  const page = n - 1;
  switch (hint.sign.gesture) {
    case 'hold': {
      // The tile pressed, the line filling through the hold, and the page
      // ghosting away as it completes: its light goes with it.
      const m = TOUCH_SIGN_MS;
      const down = L + m.read + m.press;
      beats.push({ gesture: 'hold', page, in: L + m.read, down, at: down + m.hold, out: down + m.hold, withPage: true });
      break;
    }
    case 'both': {
      const m = HINT_MS.both;
      const down = L + m.wait + m.press;
      beats.push({ gesture: 'both', page, in: L + m.wait, down, at: down + m.held, out: down + m.held + m.fade });
      break;
    }
    case 'edges': {
      const s = NOVA_TOTAL_MS;
      const down = L + s.read;
      const second = down + s.top;
      const slide = second + s.both;
      const at = slide + s.meet;
      beats.push({
        gesture: 'edges',
        page,
        in: down - HINT_MS.edges.press,
        down,
        then: { in: second, down: second + HINT_MS.edges.press },
        slide,
        at,
        out: at + HINT_MS.edges.fade,
      });
      break;
    }
  }
  return beats;
}

// ─── Keyframes on one clock ──────────────────────────────────────────────────

/** A value moving from `v0` at `from` to `v1` at `to` (eased, or straight). */
export interface Seg {
  from: number;
  to: number;
  v0: number;
  v1: number;
  ease?: (x: number) => number;
}

export const seg = (from: number, to: number, v0: number, v1: number, ease?: (x: number) => number): Seg => ({ from, to, v0, v1, ease });
/** Held at `v` from `from` to `to`. */
export const hold = (from: number, to: number, v: number): Seg => ({ from, to, v0: v, v1: v });

/** Smooth in and out; out only. */
export const inOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
export const easeOut = (x: number): number => 1 - (1 - x) * (1 - x);

/** One interpolation's ranges over the clock (0 to the pass's length). */
export interface Track {
  inputRange: number[];
  outputRange: number[];
}

/**
 * One interpolation over the clock (0 to `cycle` ms) from sparse segments:
 * `base` wherever no segment speaks, each segment straight or eased in eight
 * steps, a step of a millisecond between a segment and what follows, so the
 * input range only ever rises. A segment that ends at the end of the pass
 * keeps its value to the end (the clock never runs past it).
 */
export function track(base: number, segs: Seg[], cycle: number): Track {
  const pts: { t: number; v: number }[] = [];
  const push = (t: number, v: number) => {
    const last = pts[pts.length - 1];
    const tt = last && t <= last.t ? last.t + 0.5 : t;
    pts.push({ t: tt, v });
  };
  const sorted = segs.filter((s) => s.to > s.from).sort((a, b) => a.from - b.from);
  push(0, sorted.length > 0 && sorted[0].from <= 0 ? sorted[0].v0 : base);
  sorted.forEach((s, i) => {
    const prev = sorted[i - 1];
    const chained = prev != null && s.from <= prev.to + 1;
    if (!chained) {
      if (prev != null) push(prev.to + 1, base);
      if (s.from > 1) push(s.from - 1, base);
    }
    push(s.from, s.v0);
    if (s.ease) {
      for (let k = 1; k < 8; k++) {
        const x = k / 8;
        push(s.from + (s.to - s.from) * x, s.v0 + (s.v1 - s.v0) * s.ease(x));
      }
    }
    push(s.to, s.v1);
  });
  const last = sorted[sorted.length - 1];
  if (last && last.to < cycle) {
    push(last.to + 1, base);
    push(cycle, base);
  } else if (!last) {
    push(cycle, base);
  }
  return { inputRange: pts.map((p) => p.t), outputRange: pts.map((p) => p.v) };
}

/**
 * A value at 1 that dips to `lo` and back, about every `period` ms, filling
 * `from` to `to` exactly (the last pulse ends at `to`); a window too short
 * for one pulse simply holds at 1.
 */
export function pulseFill(from: number, to: number, period: number, lo: number): Seg[] {
  const n = Math.floor((to - from) / period);
  if (n < 1) return [hold(from, to, 1)];
  const p = (to - from) / n;
  const segs: Seg[] = [];
  for (let k = 0; k < n; k++) {
    const t = from + k * p;
    segs.push(seg(t, t + p / 2, 1, lo), seg(t + p / 2, t + p, lo, 1));
  }
  return segs;
}

/** The value of a track at `t` (Animated's interpolation, the ends clamped). */
export function valueAt(tr: Track, t: number): number {
  const { inputRange: x, outputRange: y } = tr;
  if (t <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) {
    if (t <= x[i]) return y[i - 1] + ((t - x[i - 1]) / (x[i] - x[i - 1])) * (y[i] - y[i - 1]);
  }
  return y[y.length - 1];
}

// ─── The cues: what a guide asks the hint to play ────────────────────────────

/** One press of a lit control: the fill comes in at `down`, the page turns at `at`. */
export interface HintPress {
  down: number;
  at: number;
}

/**
 * A control (or two, lit together) through one stretch of the pass: lit at
 * `in`, pulsing until the first press, each press filling it, gone by `out`.
 */
export interface HintCue {
  controls: HintControl[];
  in: number;
  presses: HintPress[];
  out: number;
  /** A swipe (the Nova's lower edge): the lit control travels from the right
   *  end of the edge to the left end between `from` and `to`, the finger's
   *  stroke, lit at the right end before it and gone after. */
  swipe?: { from: number; to: number };
  /** The control is gone from the frame after the last press (a page that
   *  turns away, a tile whose page ghosts): its light goes with the page at
   *  `at`, with no fade after. */
  withPage?: boolean;
  /** A run of quick presses (the Nano X's cursor stepping to the tick): short fills. */
  quick?: boolean;
  /** Which still the control is lit in, with Reduce Motion on: 0 on the
   *  frames before the guide's `stillFrom`, 1 from it on. */
  still?: 0 | 1;
  /** In its still the control is shown held (tinted), not just lit. */
  stillHeld?: boolean;
}

/** A word on its pill through one stretch of the pass. */
export interface HintWord {
  text: string;
  /** Where it points: a control, `between` the Nano X's two buttons, or in the
   *  `band` over a touch Ledger's keypad (pointing at none, the rings point). */
  at: HintControl | 'between' | 'band';
  /** A word about two controls at once ("Press both", "Hold both"): it
   *  points at neither, or it reads as meant for the one it points at
   *  (decided 2026-10-04). */
  both: boolean;
  in: number;
  out: number;
  /** Gone with the page turn at `out`, no fade. */
  withPage?: boolean;
  /** Its own fade, where it hands over to another word (the Nova's swap). */
  fade?: number;
  /** Which still shows it (as a cue's), or both. */
  still?: 0 | 1 | 'both';
}

/** One value on the clock, and where it stands still with Reduce Motion on:
 *  [on a frame before the guide's `stillFrom`, on one from it on]. */
export interface Channel extends Track {
  still: readonly [number, number];
}

/** A lit control: its ring (in, pulsing, out) and the fill of the press;
 *  for a control that travels (a swipe), where it is along its way: 1 at the
 *  right end of the edge, -1 at the left end. */
export interface LitPlan {
  control: HintControl;
  ring: Channel;
  fill: Channel;
  along?: Channel;
}

/** A word on its pill: where it points, how it comes and goes. */
export interface WordPlan {
  text: string;
  at: HintControl | 'between' | 'band';
  both: boolean;
  opacity: Channel;
  rise: Channel;
}

/** The device's own progress on the sign page. */
export type ProgressPlan =
  /**
   * A touch Ledger's hold (decided 2026-10-04, a recording): the thin line
   * filling left to right along the top edge of the "Hold to sign" row (0 to
   * 1 of the screen's width), then the page ghosting (its ink left, 1 to 0)
   * as "Signing transaction" comes (0 to 1).
   */
  | { kind: 'line'; fill: Channel; page: Channel; signing: Channel }
  /** The Nova's Total page: the page and the confirmation, the up arrow
   *  (shown, and its rise as a fraction of `HINT_MS.arrow.lift`), and how far
   *  the arrows have slid together (0 to 1 of `novaHoldArrows().travel`). */
  | { kind: 'arrows'; page: Channel; confirmed: Channel; up: Channel; upRise: Channel; slide: Channel }
  /**
   * The Nova after it is plugged in (`ui/hww/deviceTurns.ts`): the side
   * page's arrow turning (`turn`, degrees, one way then the other; `ccw` and
   * `cw` which of its two glyphs shows), the confirmation's arrows sliding
   * together (`slide`, 0 to 1 of the travel), and the lock's shackle swinging
   * open (`shackle`, 0 closed to 1 open).
   */
  | { kind: 'unlock'; turn: Channel; ccw: Channel; cw: Channel; slide: Channel; shackle: Channel };

/**
 * A frame whose one line the device scrolls as its lower edge is swiped: the
 * Nova's address on the address check (decided 2026-10-04) and the address under
 * each amount of its signing review (decided 2026-10-05). `page` is the frame,
 * `scroll` the line's way along it (0 at its start to 1 at its end; at its
 * start in both stills), `travel` how far that is in the screen's pixels
 * (`novaScrollTravel`); the thumb goes along its track with it.
 */
export interface ScrollPlan {
  page: number;
  scroll: Channel;
  travel: number;
}

export interface HintPlan {
  /** What the client presses on this device (the tour's controls). */
  hint: DeviceHint;
  /** The review tour's beats (none for a turn before the transaction). */
  beats: HintBeat[];
  /** One per control, every cue that lights it on one ring. */
  lit: LitPlan[];
  words: WordPlan[];
  /** The device's own progress on its sign page. */
  progress: ProgressPlan | null;
  /** The frames whose line is swiped along, each with its own way. */
  scrolls: ScrollPlan[];
}

/** One value on the clock with its two stills (a guide's own progress channels). */
export const channel = (base: number, segs: Seg[], cycle: number, still: readonly [number, number]): Channel => ({ ...track(base, segs, cycle), still });

const presence = (from: number, to: number, fade: number = HINT_MS.word.out): Seg[] => {
  const w = HINT_MS.word;
  return [seg(from, from + w.in, 0, 1), hold(from + w.in, to - fade, 1), seg(to - fade, to, 1, 0)];
};
/** A word up until the page turns, gone with it (`withPage`). */
const upToTurn = (from: number, at: number): Seg[] => [seg(from, from + HINT_MS.word.in, 0, 1), hold(from + HINT_MS.word.in, at, 1)];
const riseIn = (from: number): Seg[] => [seg(from, from + HINT_MS.word.rise, HINT_MS.word.lift, 0, easeOut)];

/** The ring of one control through one cue: in, pulsing until the first
 *  press, then held and out as the cue ends (faded, or cut with the page). */
function ringSegs(cue: HintCue): Seg[] {
  const r = HINT_MS.ring;
  const down = cue.presses[0]?.down ?? cue.out;
  const lit = [seg(cue.in, cue.in + r.in, 0, 1), ...pulseFill(cue.in + r.in, down, r.pulse, r.low)];
  return cue.withPage ? [...lit, hold(down, cue.out, 1)] : [...lit, hold(down, cue.out - r.out, 1), seg(cue.out - r.out, cue.out, 1, 0)];
}

/** Where a travelling control is through one cue: at the right end (1) from
 *  the moment it lights until the finger touches, then across to the left
 *  end (-1) by the end of the stroke, where it stays until its light goes. */
function alongSegs(cue: HintCue): Seg[] {
  const sw = cue.swipe;
  if (sw == null) return [];
  return [hold(cue.in, sw.from, 1), seg(sw.from, sw.to, 1, -1, inOut), hold(sw.to, cue.out, -1)];
}

/** The fills of one cue's presses: each in at `down`, held to `at`, out after
 *  it (or gone with the page turn at the last `at`). */
function fillSegs(cue: HintCue): Seg[] {
  const f = HINT_MS.fill;
  const fillIn = cue.quick ? f.quickIn : f.in;
  const fillOut = cue.quick ? f.quickOut : f.out;
  return cue.presses.flatMap((p, i) => {
    const held = [seg(p.down, p.down + fillIn, 0, f.level), hold(p.down + fillIn, p.at, f.level)];
    const last = i === cue.presses.length - 1;
    return cue.withPage && last ? held : [...held, seg(p.at, p.at + fillOut, f.level, 0)];
  });
}

/**
 * Everything the hint shows in one pass, on one clock, from a guide's cues:
 * the lit controls (one ring per control, every cue that lights it), the
 * words (one pill per word and place), the device's own progress and the
 * lines it scrolls, each a track over 0 to `cycle` with its still values.
 */
export function planFromCues(
  hint: DeviceHint,
  cues: HintCue[],
  words: HintWord[],
  progress: ProgressPlan | null,
  cycle: number,
  beats: HintBeat[] = [],
  scrolls: ScrollPlan[] = [],
): HintPlan {
  const ch = (base: number, segs: Seg[], still: readonly [number, number]): Channel => channel(base, segs, cycle, still);
  const byControl = new Map<HintControl, HintCue[]>();
  for (const cue of cues) for (const c of cue.controls) byControl.set(c, [...(byControl.get(c) ?? []), cue]);
  const lit: LitPlan[] = [...byControl.entries()].map(([control, list]) => {
    const side = (k: 0 | 1) => (list.some((cue) => cue.still === k) ? 1 : 0);
    const held = (k: 0 | 1) => (list.some((cue) => cue.still === k && cue.stillHeld) ? HINT_MS.fill.level : 0);
    const travels = list.some((cue) => cue.swipe != null);
    return {
      control,
      ring: ch(0, list.flatMap(ringSegs), [side(0), side(1)]),
      fill: ch(0, list.flatMap(fillSegs), [held(0), held(1)]),
      ...(travels ? { along: ch(1, list.flatMap(alongSegs), [1, 1]) } : {}),
    };
  });
  const byWord = new Map<string, HintWord[]>();
  for (const w of words) {
    const key = `${w.text}\u0000${w.at}\u0000${w.both}`;
    byWord.set(key, [...(byWord.get(key) ?? []), w]);
  }
  const plans: WordPlan[] = [...byWord.values()].map((list) => {
    const { text, at, both } = list[0];
    const side = (k: 0 | 1) => (list.some((w) => w.still === k || w.still === 'both') ? 1 : 0);
    return {
      text,
      at,
      both,
      opacity: ch(0, list.flatMap((w) => (w.withPage ? upToTurn(w.in, w.out) : presence(w.in, w.out, w.fade))), [side(0), side(1)]),
      rise: ch(0, list.flatMap((w) => riseIn(w.in)), [0, 0]),
    };
  });
  return { hint, beats, lit, words: plans, progress, scrolls };
}

// ─── The review tour's plan ──────────────────────────────────────────────────

/**
 * The review tour's hint in one pass, from the tour's pages and their starts.
 * Null for a device the app cannot vouch for (the slab) or a tour that does
 * not move.
 */
export function hintPlan(d: DeviceDrawing, pages: readonly ReviewPage[], starts: readonly number[], cycle: number): HintPlan | null {
  const hint = deviceHint(d);
  const beats = hintBeats(d, pages, starts, cycle);
  if (hint == null || beats.length === 0) return null;
  const ch = (base: number, segs: Seg[], still: readonly [number, number]): Channel => channel(base, segs, cycle, still);
  const cues: HintCue[] = [];
  const words: HintWord[] = [];
  for (const b of beats) {
    if (b.gesture === 'tap') {
      cues.push({ controls: [hint.advance.control], in: b.in, presses: [{ down: b.down, at: b.at }], out: b.out, withPage: b.withPage, still: 0 });
      words.push({ text: hint.advance.word, at: hint.advance.control, both: false, in: b.in, out: b.out, withPage: b.withPage, still: 0 });
    } else if (b.gesture === 'swipe') {
      // The Nova's lower edge run along, "Swipe" under the travelling light.
      cues.push(swipeCue(b));
      words.push(swipeWord(b));
    } else if (b.gesture === 'edges' && b.then) {
      cues.push({ controls: ['edgeTop'], in: b.in, presses: [{ down: b.down, at: b.at }], out: b.out, still: 1 });
      cues.push({ controls: ['edgeBottom'], in: b.then.in, presses: [{ down: b.then.down, at: b.at }], out: b.out, still: 1 });
      // "Hold" while the top is held alone, then "Hold both" once the bottom
      // lights: the one word goes, then the other comes, never both at once.
      const swap = HINT_MS.word.swap;
      words.push({ text: hint.sign.word, at: 'edgeTop', both: false, in: b.in, out: b.then.in + swap, fade: swap });
      words.push({ text: hint.sign.wordBoth ?? hint.sign.word, at: 'edgeTop', both: true, in: b.then.in + swap, out: b.out, still: 1 });
    } else {
      // Reduce Motion: the touchscreens' tile still shows held, its line half full.
      const held = b.gesture === 'hold';
      cues.push({ controls: hint.sign.controls, in: b.in, presses: [{ down: b.down, at: b.at }], out: b.out, withPage: b.withPage, still: 1, stillHeld: held });
      words.push({
        text: hint.sign.word,
        at: b.gesture === 'both' ? 'between' : hint.sign.controls[0],
        both: b.gesture === 'both',
        in: b.in,
        out: b.out,
        withPage: b.withPage,
        still: 1,
      });
    }
  }

  // The sign beat: never a tap, and never one of the swipes before it.
  const sign = beats.find((b) => b.gesture !== 'tap' && b.gesture !== 'swipe') ?? null;
  let progress: ProgressPlan | null = null;
  if (sign?.gesture === 'hold') {
    // The line fills through the hold; as it completes the page ghosts (its
    // ink left for a moment, then gone) and "Signing transaction" comes.
    const g = HINT_MS.ghost;
    progress = {
      kind: 'line',
      fill: ch(0, [seg(sign.down, sign.at, 0, 1), hold(sign.at, cycle, 1)], [0, 0.5]),
      page: ch(1, [seg(sign.at, sign.at + g.in, 1, g.level), hold(sign.at + g.in, sign.at + g.ms, g.level), seg(sign.at + g.ms, sign.at + g.ms + g.in, g.level, 0), hold(sign.at + g.ms + g.in, cycle, 0)], [1, 1]),
      signing: ch(0, [seg(sign.at, sign.at + g.in, 0, 1), hold(sign.at + g.in, cycle, 1)], [0, 0]),
    };
  } else if (sign?.gesture === 'edges' && sign.then && sign.slide != null) {
    const a = HINT_MS.arrow;
    // The confirmation from the moment the arrows meet to the end of the pass.
    progress = {
      kind: 'arrows',
      page: ch(1, [hold(sign.at, cycle, 0)], [1, 1]),
      confirmed: ch(0, [hold(sign.at, cycle, 1)], [0, 0]),
      up: ch(0, [seg(sign.then.in, sign.then.in + a.in, 0, 1), hold(sign.then.in + a.in, cycle, 1)], [0, 1]),
      upRise: ch(0, [seg(sign.then.in, sign.then.in + a.in, 1, 0, easeOut)], [0, 0]),
      slide: ch(0, [seg(sign.slide, sign.at, 0, 1, inOut), hold(sign.at, cycle, 1)], [0, 0]),
    };
  }
  // Each swiped page: its line carried along its own strokes, at its end
  // until the page turns, at its start again on the next (decided 2026-10-05).
  const scrolls: ScrollPlan[] = [];
  pages.forEach((page, i) => {
    const strokes = beats.filter((b) => b.gesture === 'swipe' && b.page === i);
    if (strokes.length === 0 || page.kind !== 'nova-output' || i + 1 >= starts.length) return;
    scrolls.push({ page: i, scroll: ch(0, scrollSegs(strokes, starts[i + 1]), [0, 0]), travel: novaScrollTravel(page.to) });
  });
  return planFromCues(hint, cues, words, progress, cycle, beats, scrolls);
}

// ─── The room the hint takes beside the drawing ──────────────────────────────

/**
 * How much more room the courier's row leaves above and below a drawing so no
 * pill reaches the title above it or the card under it: `reach` is how far
 * the hint goes past the drawing's box (points), `slack` the room the row
 * already has on that side (its padding, the gap to its neighbour, and the
 * centring room when the phone beside it is taller), `clear` what is kept
 * free beyond.
 */
export function extraRoom(reach: number, slack: number, clear: number): number {
  return Math.max(0, Math.ceil(reach + clear - slack));
}
