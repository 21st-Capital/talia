/**
 * The moments BEFORE the transaction when the device asks the client for
 * something (decided 2026-10-04: "show an animated ledger for each device"; "add
 * two more screens for the moment the device is plugged in"). A Ledger's two
 * the kit reports exactly: the device locked, asking for its PIN ('unlock'),
 * and the app to open ('open-app', "Open app?"). The BitBox's one the phone
 * only WAITS through: it has asked the device to unlock and pair, and cannot
 * tell whether the device is asking for its password or already answered.
 * Pure: the frames each drawing steps through on a timer, the cues the press
 * hint plays over them, the device's own progress on the same clock, and the
 * words: the device's step, numbered in the title (decided 2026-10-05, the plan
 * in `deviceSteps.ts`), and the line under the drawing. Tested in
 * `__tests__/deviceTurns.test.ts`.
 *
 * A guide on a timer, like the review tour. The PIN it enters is nobody's:
 * the touchscreens' keypad comes in a NEW ORDER with every pass, as the device
 * shuffles it every time it asks, so no position ever reads as fixed; the
 * Nano X's row is the device's own 0 to 9; the BitBox's two characters change
 * with every pass. Nothing says the device is on the frame the drawing shows.
 *
 *   touchscreen Ledgers   off: "Press" on the side button, which brings
 *                         "Enter your PIN" (decided 2026-10-04); four taps on the
 *                         keypad, a dot each, then the tick tile (dark once
 *                         four are in); "Open app?": tap the Open button,
 *                         which lands on the app's home page (the Gen5 video)
 *   Nano X                "Enter PIN": press the right button to move the
 *                         cursor, press both to take a digit, run to the tick
 *                         at the right end, press both; "Open app": press both
 *   unknown Ledger        the words alone, no hint
 *   BitBox02 Nova         from the moment it is plugged in (the photos and
 *                         the recording): "Tap this side" round the turning
 *                         arrow, a tap on the middle of the bottom edge;
 *                         "Enter password", a group tapped along the bottom
 *                         edge, which opens, then its character, twice; the
 *                         down arrow over the right slot; the confirmation
 *                         with both arrows at once, both right edges held
 *                         until the arrows meet; the lock, which opens; the
 *                         splash
 *
 * And registering the vault (the three videos of 2026-10-04, the pages in
 * `vaultRegistration.ts`), the same on every flow that registers: the
 * device's own pages at a reading pace, "Tap" on the touchscreens' footer
 * ">" and on their Approve button, "Press" and "Press both" on the Nano X,
 * "Tap" on the Nova's top right edge and, on its last page, "Hold" then
 * "Hold both" with its arrows sliding together as on Total; then the
 * device's own word ("Account registered"), then round again.
 *
 * And the address check (the three videos of the same vault's receive
 * address, the pages in `addressCheck.ts`), on the check's own screen: the
 * device's pages at a reading pace, "Tap" on the touchscreens' footer ">"
 * then on their Confirm button, "Press" then "Press both" on the Nano X's
 * "Confirm", "Tap" on the Nova's top right edge for every page, the last
 * included (its tick sits where the ">" sat); then "Address verified" and
 * the app's home on a Ledger, the splash on the BitBox; then round again.
 */
import type { Network } from '../../bitcoin/descriptor/types';
import { deviceName } from '../../wallet/deviceKinds';
import { HINT_MS, HINT_WORDS, channel, deviceHint, easeOut, hold, inOut, pinKey, scrollSegs, seg, slotKey, swipeCue, swipeStrokes, swipeWord } from '../components/pressHintScript';
import type { HintCue, HintWord, ProgressPlan, ScrollPlan } from '../components/pressHintScript';
import { novaScrollTravel } from '../components/deviceScreenLayout';
import { NOVA_SWIPE_MS, NOVA_TOTAL_MS, isTouchscreen, novaAddressGroups, novaSwipePageMs, novaSwipeStrokesFor } from './signingDevice';
import type { DeviceDrawing, DeviceScreen, ReviewPage } from './signingDevice';
import { registerPages, registeredWords } from './vaultRegistration';
import type { RegisterFacts } from './vaultRegistration';
import { addressPages, verifiedWords } from './addressCheck';
import type { AddressFacts } from './addressCheck';
import { ADDRESS_JOB, REGISTER_JOB, stepTitle, turnStep } from './deviceSteps';
import type { TurnStep } from './deviceSteps';

/** What the device asks for before the transaction: a Ledger's two as the kit
 *  reports them; the BitBox's 'side' is drawn while the search runs (it is
 *  found once its side is chosen) and its 'unlock' is the wait for its
 *  password and pairing after it was found (decided 2026-10-04); 'register' is
 *  the vault shown to the device for its approval (the Ledger kit's
 *  'confirm-register', the BitBox's registerPolicy), drawn from the facts
 *  `connectedDevice.registerVault` hands the flow (`RegisterFacts`); without
 *  them the flows keep their line for it. 'address' is the receive address
 *  shown on the device for the client to compare (the Ledger kit's
 *  'verify-address', the BitBox's policyAddress), drawn from the facts the
 *  address check's screen hands the flow (`AddressFacts`), likewise. */
export type DeviceAsk = 'unlock' | 'open-app' | 'side' | 'register' | 'address';

/** The Bitcoin app's name on the device ("Bitcoin Test" off the main network). */
export function ledgerAppName(network: Network): string {
  return network === 'bitcoin' ? 'Bitcoin' : 'Bitcoin Test';
}

/**
 * The Bitcoin app's home page on the touchscreens, where "Open app?" lands
 * (the Gen5 video, 2026-10-04: "Bitcoin Testnet" over "This app enables
 * signing transactions on all the Bitcoin test networks." and "Quit app").
 * The main network's words are the app's own as read in its source, not
 * filmed: unconfirmed.
 */
export function ledgerAppHome(network: Network): { app: string; note: string } {
  return network === 'bitcoin'
    ? { app: 'Bitcoin', note: 'This app enables signing transactions on the Bitcoin network.' }
    : { app: 'Bitcoin Testnet', note: 'This app enables signing transactions on all the Bitcoin test networks.' };
}

// ─── The keypads ─────────────────────────────────────────────────────────────

/** The touchscreens' keypad: 3 columns by 4 rows, row-major cells 0 to 11;
 *  the backspace at the bottom left, the tick at the bottom right (the
 *  photos of a Gen5), ten digits over the rest. */
export const PAD_COLS = 3;
export const PAD_ROWS = 4;
export const PAD_BACKSPACE = 9;
export const PAD_TICK = 11;
export const PAD_DIGIT_CELLS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10];

/** A Ledger PIN is at least four digits: the tick shows from the fourth. */
export const PIN_MIN = 4;

/**
 * Keypad orders the drawing cycles through, one per pass (the digits in
 * `PAD_DIGIT_CELLS` order): the first is the photo's (2 6 4 / 0 1 9 / 7 5 8 /
 * 3), the others further shuffles. The device shuffles anew every time it
 * asks; the drawing shows that by never keeping one.
 */
export const PIN_PADS: readonly string[] = ['2640197583', '8305714269', '5917328046', '0472961835'];

/** The digit cells the demonstration taps, one set per pass: four distinct
 *  cells, never the same set twice running, so no cell reads as "the" key. */
export const PIN_TAPS: readonly (readonly number[])[] = [
  [4, 1, 8, 10],
  [0, 7, 2, 5],
  [6, 3, 10, 1],
  [8, 4, 0, 7],
];

export const padDigits = (pass: number): string => PIN_PADS[((pass % PIN_PADS.length) + PIN_PADS.length) % PIN_PADS.length];
export const padTaps = (pass: number): readonly number[] => PIN_TAPS[((pass % PIN_TAPS.length) + PIN_TAPS.length) % PIN_TAPS.length];

/** The digit on a touch keypad cell, or null for the backspace and the tick. */
export function padDigitAt(pad: string, cell: number): string | null {
  const i = PAD_DIGIT_CELLS.indexOf(cell);
  return i < 0 ? null : (pad[i] ?? null);
}

/** The Nano X's PIN row: the digits 0 to 9, the backspace at the left end
 *  once a digit is in, the tick at the right end once four are; the cursor
 *  is one of the digits, or the tick. */
export const NANO_PIN_TICK = 10;
export const NANO_PIN_SLOTS = 8;

// ─── The frames and the cues ─────────────────────────────────────────────────

/** The pace (ms): a tap or a press every `step`, the Nano X's cursor run a
 *  quick `run` per key, the page gone `gone` before the pass starts again,
 *  "Open app?" read `read` before the hint lights, the touchscreens' side
 *  button pressed `wake` after the pass starts with the device off, and
 *  their app's home page shown `home` once the app has opened. */
export const TURN_MS = { step: 1200, run: 170, gone: 700, read: 1500, wake: 1500, home: 1800 } as const;

/** One pass of a turn: the frames, what the hint plays over them, and the
 *  device's own progress on the same clock (none on a Ledger's turns). */
export interface TurnPass {
  screens: DeviceScreen[];
  cues: HintCue[];
  words: HintWord[];
  progress: ProgressPlan | null;
  /** A frame whose line is carried along as the lower edge is swiped (the Nova's address). */
  scrolls?: ScrollPlan[];
}

export interface TurnScript {
  /** When each frame shows, ms into the pass (the first at 0). */
  starts: number[];
  /** The pass's length; 0 when nothing moves (the slab). */
  cycle: number;
  /** With Reduce Motion the still hint shows its second side from this frame on. */
  stillFrom: number;
  /** The frames and the hint of one pass; `pass` counts from 0. */
  pass: (pass: number) => TurnPass;
}

const tap = (control: HintCue['controls'][number], at: number, extra: Partial<HintCue> = {}): HintCue => ({
  controls: [control],
  in: at - HINT_MS.tap.lead,
  presses: [{ down: at - HINT_MS.tap.press, at }],
  out: at + HINT_MS.tap.fade,
  ...extra,
});

/** The last press of a pass turns the page away: its light goes with it. */
const withPage = (c: HintCue): HintCue => ({ ...c, out: c.presses[c.presses.length - 1].at, withPage: true });

/**
 * The touchscreens' PIN, from the device OFF (decided 2026-10-04: "before entering
 * a pin on all Ledger Gen5, Flex and Stax, the device needs to be 'turned
 * on' which is done by pressing the side button. Please add that to the
 * animation"): the screen empty and "Press" on the side button, the page
 * coming on with the press, four digits, the tick, the page gone.
 */
function touchPin(): TurnScript {
  const s = TURN_MS.step;
  const w = TURN_MS.wake;
  // Off; the side button at `wake` brings the PIN page; four digits, then
  // the tick, then the page is gone.
  const starts = [0, w, w + s, w + 2 * s, w + 3 * s, w + 4 * s, w + 5 * s];
  const cycle = w + 5 * s + TURN_MS.gone;
  const tickAt = starts[PIN_MIN + 2];
  return {
    starts,
    cycle,
    stillFrom: PIN_MIN + 1,
    pass: (n) => {
      const pad = padDigits(n);
      const taps = padTaps(n);
      const screens: DeviceScreen[] = [
        { kind: 'blank' },
        ...Array.from({ length: PIN_MIN + 1 }, (_, k): DeviceScreen => ({ kind: 'pin', entered: k, cursor: -1, pad })),
        { kind: 'blank' },
      ];
      // The side button's light goes as the page comes on, like a page turn.
      const wake = withPage(tap('side', w, { still: 0 }));
      const cues: HintCue[] = [wake, ...taps.map((cell, k) => tap(pinKey(cell), starts[k + 2])), withPage(tap(pinKey(PAD_TICK), tickAt, { still: 1 }))];
      // "Press" on the side button; then one word for the whole entry, in the
      // band over the keypad: the rings say where (a pill over a key would
      // cover the digits beside it). The stills: the side button first, the
      // tick from the fourth digit on.
      const words: HintWord[] = [
        { text: HINT_WORDS.press, at: 'side', both: false, in: wake.in, out: wake.out, withPage: true, still: 0 },
        { text: HINT_WORDS.tap, at: 'band', both: false, in: cues[1].in, out: tickAt, withPage: true, still: 1 },
      ];
      return { screens, cues, words, progress: null };
    },
  };
}

function nanoPin(): TurnScript {
  const s = TURN_MS.step;
  const r = TURN_MS.run;
  // Three digits in: the cursor moves twice, both buttons take the fourth
  // (the tick appears), the cursor runs to the tick, both buttons again.
  const runFrom = 4 * s;
  const runKeys = Array.from({ length: NANO_PIN_TICK - 2 }, (_, k) => 3 + k); // 3 .. 10
  const runAt = runKeys.map((_, k) => runFrom + k * r);
  const last = runAt[runAt.length - 1];
  const done = last + s;
  const starts = [0, s, 2 * s, 3 * s, ...runAt, done];
  const cycle = done + TURN_MS.gone;
  const pin = (entered: number, cursor: number): DeviceScreen => ({ kind: 'pin', entered, cursor, pad: '' });
  const screens: DeviceScreen[] = [pin(3, 0), pin(3, 1), pin(3, 2), pin(4, 2), ...runKeys.map((c) => pin(4, c)), { kind: 'blank' }];
  const both = (at: number, extra: Partial<HintCue> = {}): HintCue => ({
    controls: ['right', 'left'],
    in: at - HINT_MS.tap.lead,
    presses: [{ down: at - HINT_MS.tap.press, at }],
    out: at + HINT_MS.tap.fade,
    ...extra,
  });
  const run: HintCue = {
    controls: ['right'],
    in: runFrom - HINT_MS.tap.lead + HINT_MS.tap.press,
    presses: runAt.map((at) => ({ down: at - HINT_MS.fill.quickIn, at })),
    out: last + HINT_MS.tap.fade,
    quick: true,
  };
  const cues: HintCue[] = [tap('right', s, { still: 0 }), tap('right', 2 * s), both(3 * s), run, both(done, { still: 1 })];
  const word = (c: HintCue, text: string, at: HintWord['at'], many: boolean): HintWord => ({ text, at, both: many, in: c.in, out: c.out, still: c.still });
  const words: HintWord[] = [
    word(cues[0], HINT_WORDS.press, 'right', false),
    word(cues[1], HINT_WORDS.press, 'right', false),
    word(cues[2], HINT_WORDS.pressBoth, 'between', true),
    word(run, HINT_WORDS.press, 'right', false),
    word(cues[4], HINT_WORDS.pressBoth, 'between', true),
  ];
  return { starts, cycle, stillFrom: starts.length - 2, pass: () => ({ screens, cues, words, progress: null }) };
}

function openApp(d: DeviceDrawing, network: Network): TurnScript {
  const app = ledgerAppName(network);
  const at = TURN_MS.read + HINT_MS.tap.lead;
  const touch = isTouchscreen(d);
  // Every Ledger lands on the app's home page (the Gen5 video; the Nano
  // X's home filmed at the end of an address check), shown a while before
  // the pass starts again.
  const starts = [0, at, at + TURN_MS.home];
  const cycle = at + TURN_MS.home + TURN_MS.gone;
  const screens: DeviceScreen[] = [{ kind: 'open-app', app }, { kind: 'app-home', ...ledgerAppHome(network) }, { kind: 'blank' }];
  const cue: HintCue = touch
    ? withPage(tap('open', at, { still: 0 }))
    : { controls: ['right', 'left'], in: at - HINT_MS.tap.lead, presses: [{ down: at - HINT_MS.tap.press, at }], out: at + HINT_MS.tap.fade, still: 0 };
  const word: HintWord = touch
    ? { text: HINT_WORDS.tap, at: 'open', both: false, in: cue.in, out: cue.out, withPage: true, still: 0 }
    : { text: HINT_WORDS.pressBoth, at: 'between', both: true, in: cue.in, out: cue.out, still: 0 };
  return { starts, cycle, stillFrom: 1, pass: () => ({ screens, cues: [cue], words: [word], progress: null }) };
}

// ─── The BitBox after it is plugged in ───────────────────────────────────────

/** The password keyboard's digit groups along the bottom edge, as the device
 *  shows them (photo 62). */
export const NOVA_GROUPS: readonly string[] = ['012', '345', '6789'];

/** A tapped group opens over the same three slots (photo 61: "6789" into
 *  "6", "7", "89"): one character a slot, the rest in the last. */
export function novaSplit(group: string): string[] {
  return group.length <= 3 ? [...group] : [group[0], group[1], group.slice(2)];
}

/** The two characters the demonstration types, one pair per pass, the pair in
 *  the photos first ("6", then "3"), never one that sits two levels deep (8, 9).
 *  Nobody's password: a guide, and a different pair every pass. */
export const NOVA_TYPED: readonly (readonly [string, string])[] = [
  ['6', '3'],
  ['1', '7'],
  ['4', '0'],
  ['2', '5'],
];

export const novaTyped = (pass: number): readonly [string, string] => NOVA_TYPED[((pass % NOVA_TYPED.length) + NOVA_TYPED.length) % NOVA_TYPED.length];

/** Where a character is typed: the slot of its group, then, with the group
 *  open, its own slot. */
export function novaKeyOf(ch: string): { group: number; slot: number } {
  const group = NOVA_GROUPS.findIndex((g) => g.includes(ch));
  const slot = group < 0 ? -1 : novaSplit(NOVA_GROUPS[group]).findIndex((s) => s.includes(ch));
  return { group, slot };
}

/**
 * The pace of the BitBox's guide (ms): the side page's arrow still, then
 * turning one way and the other before the tap; "Enter password" read, a tap
 * every step, the entry read before the down arrow; the confirmation read,
 * both edges held while the arrows slide together, the met arrows a moment;
 * the lock closed, opening, open; the splash; then gone.
 */
export const NOVA_UNLOCK_MS = {
  side: { still: 300, turn: 1100 },
  read: 1200,
  step: 1200,
  done: 1200,
  confirm: 700,
  meet: 1000,
  met: 500,
  locked: 1200,
  opening: 400,
  open: 500,
  splash: 1400,
  gone: 500,
} as const;

/** The side page's arrow turns through this many degrees each way. */
export const NOVA_SIDE_TURN = 180;

/**
 * The BitBox's side choice, drawn while the search runs: it is found once its
 * side is chosen (reported 2026-10-04: "When I choose the side on the first screen
 * of the bitbox, the app jumps to this screen as soon as the pin entry prompt
 * starts"). The arrow turns one way and the other, "Tap" on the middle of the
 * bottom edge, the page goes, round again.
 */
function novaSide(): TurnScript {
  const m = NOVA_UNLOCK_MS;
  const ccwTo = m.side.still + m.side.turn;
  const sideAt = ccwTo + m.side.turn;
  const cycle = sideAt + m.gone;
  const progress: ProgressPlan = {
    kind: 'unlock',
    turn: channel(0, [seg(m.side.still, ccwTo, 0, -NOVA_SIDE_TURN, inOut), seg(ccwTo, sideAt, 0, NOVA_SIDE_TURN, inOut)], cycle, [0, 0]),
    ccw: channel(0, [hold(0, ccwTo, 1)], cycle, [1, 1]),
    cw: channel(0, [hold(ccwTo, sideAt, 1)], cycle, [0, 0]),
    slide: channel(0, [], cycle, [0, 0]),
    shackle: channel(0, [], cycle, [0, 0]),
  };
  return {
    starts: [0, sideAt],
    cycle,
    stillFrom: 0,
    pass: () => {
      const cue = withPage(tap('edgeMiddle', sideAt, { still: 0 }));
      const word: HintWord = { text: HINT_WORDS.tap, at: 'edgeMiddle', both: false, in: cue.in, out: cue.out, withPage: true, still: 0 };
      return { screens: [{ kind: 'nova-side' }, { kind: 'blank' }], cues: [cue], words: [word], progress };
    },
  };
}

/**
 * The BitBox's password, after it was found and while the phone waits for
 * its unlock and pairing: the groups tapped down to a character, twice, the
 * down arrow, both right edges held until the arrows meet, the lock opening,
 * the splash, then gone and round again.
 */
function novaUnlock(): TurnScript {
  const m = NOVA_UNLOCK_MS;
  const taps = [0, 1, 2, 3].map((k) => m.read + k * m.step);
  const confirmAt = taps[3] + m.done;
  const holdDown = confirmAt + m.confirm;
  const met = holdDown + m.meet;
  const lockAt = met + m.met;
  const openFrom = lockAt + m.locked;
  const openTo = openFrom + m.opening;
  const splashAt = openTo + m.open;
  const goneAt = splashAt + m.splash;
  const cycle = goneAt + m.gone;
  const starts = [0, ...taps, confirmAt, lockAt, splashAt, goneAt];
  // The device's own progress is the same every pass: the arrows' slide, the
  // shackle's swing (the side's arrow is the search's page, not this one).
  const progress: ProgressPlan = {
    kind: 'unlock',
    turn: channel(0, [], cycle, [0, 0]),
    ccw: channel(0, [], cycle, [0, 0]),
    cw: channel(0, [], cycle, [0, 0]),
    slide: channel(0, [seg(holdDown, met, 0, 1, inOut), hold(met, cycle, 1)], cycle, [0, 0]),
    shackle: channel(0, [seg(openFrom, openTo, 0, 1, easeOut), hold(openTo, cycle, 1)], cycle, [1, 1]),
  };
  return {
    starts,
    cycle,
    stillFrom: 5,
    pass: (n) => {
      const [a, b] = novaTyped(n);
      const ka = novaKeyOf(a);
      const kb = novaKeyOf(b);
      const top = NOVA_GROUPS;
      const pw = (entered: number, last: string | null, groups: readonly string[], depth: number): DeviceScreen => ({ kind: 'nova-password', entered, last, groups, depth });
      const screens: DeviceScreen[] = [
        pw(0, null, top, 0),
        pw(0, null, novaSplit(top[ka.group]), 1),
        pw(1, a, top, 0),
        pw(1, a, novaSplit(top[kb.group]), 1),
        pw(2, b, top, 0),
        { kind: 'nova-confirm', entered: 2, last: b },
        { kind: 'nova-lock' },
        { kind: 'nova-splash' },
        { kind: 'blank' },
      ];
      const slots = [ka.group, ka.slot, kb.group, kb.slot];
      const tapCues: HintCue[] = [
        ...slots.map((slot, k) => tap(slotKey(slot), taps[k], k === 0 ? { still: 0 } : {})),
        withPage(tap('edgeTop', confirmAt)),
      ];
      const holdCue: HintCue = {
        controls: ['edgeTop', 'edgeBottom'],
        in: holdDown - HINT_MS.edges.press,
        presses: [{ down: holdDown, at: met }],
        out: met + HINT_MS.edges.fade,
        still: 1,
      };
      const words: HintWord[] = [
        ...tapCues.map((c, k): HintWord => ({ text: HINT_WORDS.tap, at: c.controls[0], both: false, in: c.in, out: c.out, ...(c.withPage ? { withPage: true } : {}), ...(k === 0 ? { still: 0 as const } : {}) })),
        { text: HINT_WORDS.holdBoth, at: 'edgeTop', both: true, in: holdCue.in, out: holdCue.out, still: 1 },
      ];
      return { screens, cues: [...tapCues, holdCue], words, progress };
    },
  };
}

// ─── Registering the vault ───────────────────────────────────────────────────

/**
 * The pace of the registration guide (ms), per page kind: a reading pace
 * for a page of words, longer where there is a key to read; the last page
 * plays its device's own approval (`TURN_MS.read` then the tap on the
 * touchscreens' Approve, `HINT_MS.both` on the Nano X, Total's hold on the
 * Nova, `NOVA_TOTAL_MS`); the device's word after it, then gone before the
 * pass starts again.
 */
export const REGISTER_MS = {
  touch: { intro: 1800, account: 2600, keys: 1500, key: 2600 },
  nano: { intro: 1600, item: 1800, long: 2400 },
  nova: { item: 1800, scroll: 2000 },
  registered: 1800,
} as const;

/** How long a registration page stays before the next (the last page has its own sequence). */
export function registerDwell(p: ReviewPage): number {
  switch (p.kind) {
    case 'touch-register-intro':
      return REGISTER_MS.touch.intro;
    case 'touch-register-account':
      return REGISTER_MS.touch.account;
    case 'touch-register-keys':
      return REGISTER_MS.touch.keys;
    case 'touch-register-key':
      return REGISTER_MS.touch.key;
    case 'nano-register-intro':
    case 'nano-register-keys':
      return REGISTER_MS.nano.intro;
    case 'nano-item':
      return p.long ? REGISTER_MS.nano.long : REGISTER_MS.nano.item;
    case 'nova-item':
      return REGISTER_MS.nova.item;
    case 'nova-scroll':
      return REGISTER_MS.nova.scroll;
    default:
      return REGISTER_MS.nano.item;
  }
}

/** The last page's own length, up to the moment the device accepts: the
 *  page read then the Approve tapped; both buttons pressed and held; the
 *  Nova's two edges held until its arrows meet. */
export function registerApproveMs(d: DeviceDrawing): number {
  if (isTouchscreen(d)) return TURN_MS.read + HINT_MS.tap.lead;
  if (d === 'nanoX') return HINT_MS.both.wait + HINT_MS.both.press + HINT_MS.both.held;
  const s = NOVA_TOTAL_MS;
  return s.read + s.top + s.both + s.meet;
}

/**
 * The registration as the client's turn: the device's pages at a reading
 * pace with "Tap" or "Press" on what moves on, the approval on the last page
 * with its own hint and the device's own progress, the device's word
 * ("Account registered"), the page gone, round again. The pages are the
 * same every pass (the vault does not change).
 */
function registerTurn(d: DeviceDrawing, f: RegisterFacts): TurnScript {
  const pages = registerPages(d, f);
  const total = pages.length;
  const hint = deviceHint(d);
  const screens: DeviceScreen[] = [
    ...pages.map((page, index): DeviceScreen => ({ kind: 'review', page, index, total })),
    { kind: 'registered', text: registeredWords(d, f) },
    { kind: 'blank' },
  ];
  const starts: number[] = [];
  let t = 0;
  pages.forEach((p, i) => {
    starts.push(t);
    t += i === total - 1 ? registerApproveMs(d) : registerDwell(p);
  });
  const registeredAt = t;
  const goneAt = registeredAt + REGISTER_MS.registered;
  const cycle = goneAt + TURN_MS.gone;
  starts.push(registeredAt, goneAt);
  if (hint == null) {
    // The slab: its one page in the words every model starts with, still.
    return { starts: [0], cycle: 0, stillFrom: 0, pass: () => ({ screens: [screens[0]], cues: [], words: [], progress: null }) };
  }
  const cues: HintCue[] = [];
  const words: HintWord[] = [];
  // Moving on, page by page: the same control each time; onto a page that
  // draws no such control (the touchscreens' last page has no ">") the hint
  // goes with the turn.
  for (let i = 0; i + 1 < total; i++) {
    const T = starts[i + 1];
    const withTurn = hint.advance.onPage && i + 2 === total;
    const cue = tap(hint.advance.control, T, { still: 0 });
    cues.push(withTurn ? withPage(cue) : cue);
    words.push({ text: hint.advance.word, at: hint.advance.control, both: false, in: cue.in, out: withTurn ? T : cue.out, ...(withTurn ? { withPage: true } : {}), still: 0 });
  }
  const L = starts[total - 1];
  let progress: ProgressPlan | null = null;
  if (isTouchscreen(d)) {
    // "Register account?": the page read, then "Tap" on the dark Approve
    // button, whose light goes with the page as "Account registered" comes.
    const cue = withPage(tap('approve', registeredAt, { still: 1 }));
    cues.push(cue);
    words.push({ text: HINT_WORDS.tap, at: 'approve', both: false, in: cue.in, out: cue.out, withPage: true, still: 1 });
  } else if (d === 'nanoX') {
    // "Register account": both buttons, as on "Sign transaction".
    const m = HINT_MS.both;
    const down = L + m.wait + m.press;
    const cue: HintCue = { controls: ['right', 'left'], in: L + m.wait, presses: [{ down, at: registeredAt }], out: registeredAt + m.fade, still: 1 };
    cues.push(cue);
    words.push({ text: HINT_WORDS.pressBoth, at: 'between', both: true, in: cue.in, out: cue.out, still: 1 });
  } else {
    // The last key's page: Total's hold (the video, the same two arrows):
    // "Hold" on the top right edge, the up arrow once it is held, "Hold both"
    // as the bottom right edge lights, the arrows sliding together until
    // they meet, where the device shows its word.
    const s = NOVA_TOTAL_MS;
    const a = HINT_MS.arrow;
    const down = L + s.read;
    const second = down + s.top;
    const slide = second + s.both;
    const at = registeredAt;
    const top: HintCue = { controls: ['edgeTop'], in: down - HINT_MS.edges.press, presses: [{ down, at }], out: at + HINT_MS.edges.fade, still: 1 };
    const bottom: HintCue = { controls: ['edgeBottom'], in: second, presses: [{ down: second + HINT_MS.edges.press, at }], out: at + HINT_MS.edges.fade, still: 1 };
    cues.push(top, bottom);
    const swap = HINT_MS.word.swap;
    words.push({ text: HINT_WORDS.hold, at: 'edgeTop', both: false, in: top.in, out: second + swap, fade: swap });
    words.push({ text: HINT_WORDS.holdBoth, at: 'edgeTop', both: true, in: second + swap, out: top.out, still: 1 });
    // The page stays whole and the device's word is the NEXT frame, so the
    // page and confirmation channels of Total's plan hold still here.
    progress = {
      kind: 'arrows',
      page: channel(1, [], cycle, [1, 1]),
      confirmed: channel(0, [], cycle, [0, 0]),
      up: channel(0, [seg(second, second + a.in, 0, 1), hold(second + a.in, cycle, 1)], cycle, [0, 1]),
      upRise: channel(0, [seg(second, second + a.in, 1, 0, easeOut)], cycle, [0, 0]),
      slide: channel(0, [seg(slide, at, 0, 1, inOut), hold(at, cycle, 1)], cycle, [0, 0]),
    };
  }
  return { starts, cycle, stillFrom: total - 1, pass: () => ({ screens, cues, words, progress }) };
}

// ─── The address check ───────────────────────────────────────────────────────

/**
 * The pace of the address check's guide (ms): the intro pages read, the
 * Nano X's address pages longer (a page of the address to compare), its
 * name page as its other items, the Nova's kind and name pages as its other
 * items; the last page read for `read` before the device's confirmation is
 * played (the touchscreens' Confirm tapped, the Nano X's both buttons, the
 * Nova's top right edge tapped); the device's word after it, the app's home
 * after that (`TURN_MS.home`), the Nova's splash (`NOVA_UNLOCK_MS.splash`).
 */
export const ADDRESS_MS = {
  touch: { intro: 1800, read: 3200 },
  nano: { intro: 1600, item: 1800, address: 2600 },
  /** The Nova's kind and name pages; its address page plays the swipe
   *  (`NOVA_SWIPE_MS`, the signing review's own, in `signingDevice.ts`). */
  nova: { item: 1800 },
  verified: 1800,
} as const;

/**
 * How many swipes the guide plays for these facts (decided 2026-10-04: "when the
 * address is displayed on it, before the user can click the 'confirm' icon on
 * the top right, the user can scroll through the address by swiping from the
 * right to the left on the lower edge of the bitbox. The display is not big
 * enough to show the entire address"): two for a line that runs past the
 * screen (every real address), none for one that fits.
 */
export function novaSwipeStrokes(f: AddressFacts): number {
  return novaSwipeStrokesFor(novaAddressGroups(f.address));
}

/** How long an address page stays before the next (the last page has its own sequence). */
export function addressDwell(p: ReviewPage): number {
  switch (p.kind) {
    case 'touch-address-intro':
      return ADDRESS_MS.touch.intro;
    case 'nano-address-intro':
      return ADDRESS_MS.nano.intro;
    case 'nano-item':
      return p.long ? ADDRESS_MS.nano.address : ADDRESS_MS.nano.item;
    case 'nova-item':
      return ADDRESS_MS.nova.item;
    default:
      return ADDRESS_MS.nano.item;
  }
}

/** The last page's own length, up to the moment the device accepts: the
 *  address read then Confirm tapped; both buttons pressed and held on
 *  "Confirm"; the Nova's address read, swiped along `strokes` times and its
 *  end read with the top right edge lighting inside that pause, exactly as
 *  the signing review plays an amount's page (`novaSwipePageMs`); a line that
 *  fits is read, then the edge tapped. */
export function addressConfirmMs(d: DeviceDrawing, strokes: number = NOVA_SWIPE_MS.strokes): number {
  if (isTouchscreen(d)) return ADDRESS_MS.touch.read + HINT_MS.tap.lead;
  if (d === 'nanoX') return HINT_MS.both.wait + HINT_MS.both.press + HINT_MS.both.held;
  return strokes > 0 ? novaSwipePageMs(strokes) : NOVA_SWIPE_MS.read + HINT_MS.tap.lead;
}

/**
 * The address check as the client's turn: the device's pages at a reading
 * pace with "Tap" or "Press" on what moves on, the confirmation on the last
 * page with its own hint, the device's word and the app's home on a Ledger
 * (the Nova's splash), the page gone, round again. The pages are the same
 * every pass (the address does not change).
 */
function addressTurn(d: DeviceDrawing, f: AddressFacts): TurnScript {
  const pages = addressPages(d, f);
  const total = pages.length;
  const hint = deviceHint(d);
  const word = verifiedWords(d);
  const strokes = d === 'nova' ? novaSwipeStrokes(f) : 0;
  // After the confirmation: the Ledgers' word and their app's home, the
  // Nova's splash (the three videos).
  const after: { screen: DeviceScreen; ms: number }[] =
    word != null
      ? [
          { screen: { kind: 'registered', text: word }, ms: ADDRESS_MS.verified },
          { screen: { kind: 'app-home', ...ledgerAppHome(f.network) }, ms: TURN_MS.home },
        ]
      : [{ screen: { kind: 'nova-splash' }, ms: NOVA_UNLOCK_MS.splash }];
  const screens: DeviceScreen[] = [
    ...pages.map((page, index): DeviceScreen => ({ kind: 'review', page, index, total })),
    ...after.map((a) => a.screen),
    { kind: 'blank' },
  ];
  const starts: number[] = [];
  let t = 0;
  pages.forEach((p, i) => {
    starts.push(t);
    t += i === total - 1 ? addressConfirmMs(d, strokes) : addressDwell(p);
  });
  const confirmedAt = t;
  for (const a of after) {
    starts.push(t);
    t += a.ms;
  }
  const goneAt = t;
  const cycle = goneAt + TURN_MS.gone;
  starts.push(goneAt);
  if (hint == null) {
    // The slab: its one page in the words every model starts with, still.
    return { starts: [0], cycle: 0, stillFrom: 0, pass: () => ({ screens: [screens[0]], cues: [], words: [], progress: null }) };
  }
  const cues: HintCue[] = [];
  const words: HintWord[] = [];
  // Moving on, page by page, as the registration does: onto a page that
  // draws no such control (the touchscreens' address page has no ">") the
  // hint goes with the turn.
  for (let i = 0; i + 1 < total; i++) {
    const T = starts[i + 1];
    const withTurn = hint.advance.onPage && i + 2 === total;
    const cue = tap(hint.advance.control, T, { still: 0 });
    cues.push(withTurn ? withPage(cue) : cue);
    words.push({ text: hint.advance.word, at: hint.advance.control, both: false, in: cue.in, out: withTurn ? T : cue.out, ...(withTurn ? { withPage: true } : {}), still: 0 });
  }
  const L = starts[total - 1];
  if (isTouchscreen(d)) {
    // The address read, then "Tap" on the dark Confirm button, whose light
    // goes with the page as "Address verified" comes.
    const cue = withPage(tap('confirm', confirmedAt, { still: 1 }));
    cues.push(cue);
    words.push({ text: HINT_WORDS.tap, at: 'confirm', both: false, in: cue.in, out: cue.out, withPage: true, still: 1 });
  } else if (d === 'nanoX') {
    // "Confirm": both buttons, as on "Sign transaction".
    const m = HINT_MS.both;
    const down = L + m.wait + m.press;
    const cue: HintCue = { controls: ['right', 'left'], in: L + m.wait, presses: [{ down, at: confirmedAt }], out: confirmedAt + m.fade, still: 1 };
    cues.push(cue);
    words.push({ text: HINT_WORDS.pressBoth, at: 'between', both: true, in: cue.in, out: cue.out, still: 1 });
  } else {
    // The address read, then the finger run along the lower edge from right
    // to left, "Swipe" under it, the line carried along and the thumb with
    // it, twice (decided 2026-10-04); its end read; then "Tap" on the top right
    // edge once more (the video: the tick sits where the ">" sat), the page
    // going with it. The one swipe the signing review's amount pages play
    // (`pressHintScript.ts`, decided 2026-10-05: "the same swipe").
    const strokesAt = swipeStrokes(L + NOVA_SWIPE_MS.read, strokes);
    cues.push(...strokesAt.map(swipeCue));
    words.push(...strokesAt.map(swipeWord));
    const tapCue = withPage(tap('edgeTop', confirmedAt, { still: 1 }));
    cues.push(tapCue);
    words.push({ text: HINT_WORDS.tap, at: 'edgeTop', both: false, in: tapCue.in, out: tapCue.out, withPage: true, still: 1 });
    const last = pages[total - 1];
    if (strokes > 0 && last.kind === 'nova-address') {
      const scrolls: ScrollPlan[] = [{ page: total - 1, scroll: channel(0, scrollSegs(strokesAt, confirmedAt), cycle, [0, 0]), travel: novaScrollTravel(last.body) }];
      return { starts, cycle, stillFrom: total - 1, pass: () => ({ screens, cues, words, progress: null, scrolls }) };
    }
  }
  return { starts, cycle, stillFrom: total - 1, pass: () => ({ screens, cues, words, progress: null }) };
}

/**
 * The guide for a device's turn before the transaction, per drawing. A Ledger
 * of unknown model (the slab) shows the words alone and nothing moves. The
 * BitBox has one, the wait for its unlock and pairing, and no app to open.
 * The vault shown for its approval ('register') is drawn from the facts the
 * device layer hands the flow, the address shown for the client's comparison
 * ('address') from the facts the address check hands it, and without them
 * not at all. `hasTurnPage` says whether a page exists at all: the flows
 * draw a turn only then, and say so to the screen around them only then, so
 * a screen never drops its heading over a bare line.
 */
export function hasTurnPage(d: DeviceDrawing, ask: DeviceAsk, register?: RegisterFacts | null, address?: AddressFacts | null): boolean {
  // The network only names the app: whether a page exists does not depend on it.
  return deviceTurn(d, ask, 'bitcoin', register, address) != null;
}

export function deviceTurn(d: DeviceDrawing, ask: DeviceAsk, network: Network, register?: RegisterFacts | null, address?: AddressFacts | null): TurnScript | null {
  if (ask === 'register') return register ? registerTurn(d, register) : null;
  if (ask === 'address') return address ? addressTurn(d, address) : null;
  if (d === 'nova') return ask === 'side' ? novaSide() : ask === 'unlock' ? novaUnlock() : null;
  if (ask === 'side') return null;
  if (d === 'slab') {
    const screens: DeviceScreen[] = [ask === 'unlock' ? { kind: 'pin', entered: 0, cursor: 0, pad: '' } : { kind: 'open-app', app: ledgerAppName(network) }];
    return { starts: [0], cycle: 0, stillFrom: 0, pass: () => ({ screens, cues: [], words: [], progress: null }) };
  }
  if (ask === 'open-app') return openApp(d, network);
  return isTouchscreen(d) ? touchPin() : nanoPin();
}

// ─── The words ───────────────────────────────────────────────────────────────

/** A turn page's words: its step of the plan, the numbered title, and the
 *  line under the drawing, or none where the title and the drawing say it
 *  all (`DeviceTurn` then draws no line). */
export interface TurnWords {
  step: TurnStep;
  title: string;
  line: string | null;
}

/**
 * The page's title and its line, true for every device. The title is the
 * device's step, numbered (decided 2026-10-05: "1. Insert your pin on your ledger
 * (instead of 'your turn on the ledger') 2. Open the bitcoin app 3. verify
 * the address or register the vault etc...", then "do the same to the bitbox
 * screens"; the plan in `deviceSteps.ts`, the words the app's own). The line
 * follows the step and adds what the drawing cannot say, never repeating the
 * title: the touchscreens' PIN line says their keys move, so no one takes the
 * drawn order for the device's, and that the side button is for a device that
 * is OFF; the BitBox's password line that it may already be unlocked (the
 * phone cannot tell). The BitBox's side page is drawn while the search runs,
 * before the device can be found (it shows up only once unlocked), so it is
 * its first step. The job's words are one set on every device (`REGISTER_JOB`,
 * `ADDRESS_JOB`; the courier's `SIGN_JOB`).
 */
export function turnWords(d: DeviceDrawing, ask: DeviceAsk, network: Network): TurnWords {
  const step = turnStep(d, ask);
  const words = (text: string, line: string | null): TurnWords => ({ step, title: stepTitle(step, text), line });
  if (d === 'nova') {
    const name = deviceName('bitbox');
    // The vault page by page (the video): ">" moves on, and the last page
    // is held like Total, whatever the vault holds.
    if (ask === 'register') {
      return words(REGISTER_JOB, `Check the vault page by page on the ${name}. On its last page, hold the top right edge, then the bottom right edge too.`);
    }
    // The address check's screen draws the address ABOVE the device (the
    // video: the top right edge moves on and, on the address, confirms).
    // The address runs past its screen: swiped along the lower edge from
    // right to left to see the rest (decided 2026-10-04), true for every address.
    if (ask === 'address') {
      return words(ADDRESS_JOB, `Check the address on the ${name} against the one above, swiping along its lower edge to see the rest, then tap the top right edge.`);
    }
    // Its side while the search runs (it is found once its side is chosen,
    // decided 2026-10-04), its password once found: it may already be unlocked,
    // so the line says what happens then.
    return ask === 'side'
      ? words('Tap the side facing you', `Plug the ${name} in first.`)
      : words('Enter your password', `If the ${name} is already unlocked, this takes just a moment.`);
  }
  const name = deviceName('ledger');
  if (ask === 'register') {
    // What approves on each model's last page (the videos); the slab's
    // line holds for every model.
    if (isTouchscreen(d)) return words(REGISTER_JOB, `Check the vault page by page on the ${name}, then tap Approve.`);
    if (d === 'nanoX') return words(REGISTER_JOB, `Check the vault page by page on the ${name}, then press both buttons on “Register account”.`);
    return words(REGISTER_JOB, `Check each key on the ${name} and approve it there.`);
  }
  if (ask === 'address') {
    // What confirms on each model's last page (the videos); the slab's line
    // holds for every model. The address sits above the device on the
    // check's screen.
    if (isTouchscreen(d)) return words(ADDRESS_JOB, `Check the address on the ${name} against the one above, then tap Confirm.`);
    if (d === 'nanoX') return words(ADDRESS_JOB, `Check the address on the ${name} against the one above, then press both buttons on “Confirm”.`);
    return words(ADDRESS_JOB, `Check the address on the ${name} against the one above and confirm it there.`);
  }
  // The app named as the device names it ("Bitcoin Test" off the main
  // network, as the drawn "Open app?" prints it); the drawing and its hint
  // say the rest.
  if (ask === 'open-app') return words(`Open the ${ledgerAppName(network)} app`, null);
  // The touchscreens are turned on with their side button (decided 2026-10-04),
  // IF they are off: a short press on a device that is on puts it to sleep,
  // so the line never tells everyone to press it. The Nano X's two buttons
  // are the hint's, and the slab's words are the title: no line.
  return words(`Enter your PIN on the ${name}`, isTouchscreen(d) ? 'Press the side button if it is off. The keys change places each time.' : null);
}
