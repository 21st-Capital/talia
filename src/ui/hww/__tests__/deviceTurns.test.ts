/**
 * The turns before the transaction (decided 2026-10-04): a Ledger's PIN and app
 * to open, per drawing, and the BitBox from the moment it is plugged in. The
 * frames, their pace, the hint's cues, the device's own progress and the
 * words; every pass clean on one clock; the keypad never in one order, the
 * BitBox's characters never the same pair twice running.
 */
import {
  NANO_PIN_SLOTS,
  NANO_PIN_TICK,
  NOVA_GROUPS,
  NOVA_SIDE_TURN,
  NOVA_TYPED,
  NOVA_UNLOCK_MS,
  PAD_BACKSPACE,
  PAD_DIGIT_CELLS,
  PAD_TICK,
  PIN_MIN,
  PIN_PADS,
  PIN_TAPS,
  REGISTER_MS,
  TURN_MS,
  deviceTurn,
  ledgerAppHome,
  ledgerAppName,
  novaKeyOf,
  novaSplit,
  novaTyped,
  padDigitAt,
  padDigits,
  padTaps,
  registerApproveMs,
  registerDwell,
  turnWords,
} from '../deviceTurns';
import type { DeviceAsk } from '../deviceTurns';
import { DEVICE_DRAWINGS, NOVA_TOTAL_MS } from '../signingDevice';
import type { DeviceDrawing, DeviceScreen } from '../signingDevice';
import { registerFacts, registerPages } from '../vaultRegistration';
import { addressFacts } from '../addressCheck';
import { HINT_MS, HINT_WORDS, deviceHint, pinKey, planFromCues, slotKey, valueAt } from '../../components/pressHintScript';
import type { HintCue, HintPlan } from '../../components/pressHintScript';
import { LIANA_TAPROOT, MULTISIG_2_OF_3 } from '../../../bitcoin/descriptor/__fixtures__/descriptors';

const LEDGERS: DeviceDrawing[] = ['gen5', 'flex', 'stax', 'nanoX', 'slab'];
const HINTED: DeviceDrawing[] = ['gen5', 'flex', 'stax', 'nanoX'];
/** The test 2-of-3 as the device holding its second key sees it; and a policy vault. */
const FACTS = registerFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, 'a1b2c3d4')!;
const POLICY = registerFacts({ descriptor: LIANA_TAPROOT, label: 'Family vault', network: 'testnet' }, '73c5da0a')!;
/** Receive address 1 of a 2-of-3 test vault, as in `addressCheck.test.ts`. */
// A made-up test address: receive index 1 (testnet) of wsh(sortedmulti(2, ...)) over the
// filmed Nova key 4a290600, the filmed Nano X key abf931aa and the made-up key from
// BIP-32 test vector 1's seed (3442193e). Public test material, nobody's wallet.
const TEST_ADDRESS = 'tb1q3hnufu5vvjfz6fklvrft0f3y7ean0x9wjzkzd3u0ensg96alzwssrk5vy2';
const ADDR = (d: DeviceDrawing) => addressFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, TEST_ADDRESS, 'Test 2/3 Oct', d === 'nova' ? 'bitbox' : 'ledger');
/** Every drawing with a hinted turn: the four Ledgers' two, their
 *  registration and their address check, the Nova's unlock in two halves,
 *  its registration and its address check. */
const TURNS: [DeviceDrawing, DeviceAsk][] = [
  ...HINTED.flatMap((d): [DeviceDrawing, DeviceAsk][] => [[d, 'unlock'], [d, 'open-app'], [d, 'register'], [d, 'address']]),
  ['nova', 'side'],
  ['nova', 'unlock'],
  ['nova', 'register'],
  ['nova', 'address'],
];
const ASKS: DeviceAsk[] = ['unlock', 'open-app'];

const turnOf = (d: DeviceDrawing, ask: DeviceAsk, facts = FACTS) => deviceTurn(d, ask, 'bitcoin', ask === 'register' ? facts : null, ask === 'address' ? ADDR(d) : null)!;
const planOf = (d: DeviceDrawing, ask: DeviceAsk, pass = 0, facts = FACTS): { plan: HintPlan; cycle: number; cues: HintCue[] } => {
  const turn = turnOf(d, ask, facts);
  const p = turn.pass(pass);
  return { plan: planFromCues(deviceHint(d)!, p.cues, p.words, p.progress, turn.cycle, [], p.scrolls), cycle: turn.cycle, cues: p.cues };
};
const kindOf = (s: DeviceScreen) => s.kind;

describe('which device, which turn', () => {
  it('every Ledger drawing gets both turns; the slab the words alone; the BitBox its unlock and no app to open', () => {
    for (const d of LEDGERS) {
      for (const ask of ASKS) {
        const turn = deviceTurn(d, ask, 'bitcoin');
        expect({ d, ask, turn: turn != null }).toEqual({ d, ask, turn: true });
        // The touchscreens start OFF (decided 2026-10-04: the side button turns them on).
        const first = turn!.pass(0).screens[ask === 'unlock' && ['gen5', 'flex', 'stax'].includes(d) ? 1 : 0];
        expect(kindOf(first)).toBe(ask === 'unlock' ? 'pin' : 'open-app');
      }
    }
    // The BitBox's side while the search runs, its password once it was found (decided 2026-10-04).
    expect(kindOf(deviceTurn('nova', 'side', 'bitcoin')!.pass(0).screens[0])).toBe('nova-side');
    expect(kindOf(deviceTurn('nova', 'unlock', 'bitcoin')!.pass(0).screens[0])).toBe('nova-password');
    for (const d of LEDGERS) expect(deviceTurn(d, 'side', 'bitcoin')).toBeNull();
    expect(deviceTurn('nova', 'open-app', 'bitcoin')).toBeNull();
    for (const ask of ASKS) {
      const slab = deviceTurn('slab', ask, 'testnet')!;
      expect(slab.cycle).toBe(0);
      expect(slab.starts).toEqual([0]);
      expect(slab.pass(0)).toMatchObject({ cues: [], words: [], progress: null });
    }
    expect(DEVICE_DRAWINGS.filter((d) => deviceTurn(d, 'unlock', 'bitcoin') == null)).toEqual([]);
    // The vault shown for approval is drawn from the facts the device layer
    // hands the flow (the device videos, 2026-10-04), on every drawing; without
    // them every drawing keeps its line.
    expect(DEVICE_DRAWINGS.filter((d) => deviceTurn(d, 'register', 'bitcoin') != null)).toEqual([]);
    expect(DEVICE_DRAWINGS.filter((d) => deviceTurn(d, 'register', 'bitcoin', null) != null)).toEqual([]);
    expect(DEVICE_DRAWINGS.filter((d) => deviceTurn(d, 'register', 'bitcoin', FACTS) == null)).toEqual([]);
    // A Ledger's turns bring no progress of the device's own.
    for (const d of HINTED) for (const ask of ASKS) expect(deviceTurn(d, ask, 'bitcoin')!.pass(0).progress).toBeNull();
  });

  it('the app is "Bitcoin" on the main network and "Bitcoin Test" off it, on every drawing', () => {
    expect(ledgerAppName('bitcoin')).toBe('Bitcoin');
    expect(ledgerAppName('testnet')).toBe('Bitcoin Test');
    for (const d of LEDGERS) {
      expect(deviceTurn(d, 'open-app', 'bitcoin')!.pass(0).screens[0]).toEqual({ kind: 'open-app', app: 'Bitcoin' });
      expect(deviceTurn(d, 'open-app', 'testnet')!.pass(0).screens[0]).toEqual({ kind: 'open-app', app: 'Bitcoin Test' });
    }
  });
});

describe('the touchscreens’ PIN: a keypad in a new order every pass, four taps, then the tick', () => {
  it('every order is the ten digits once; no two passes running show the same order or tap the same keys', () => {
    for (const pad of PIN_PADS) expect([...pad].sort().join('')).toBe('0123456789');
    expect(PIN_PADS[0]).toBe('2640197583');
    for (let n = 0; n < 8; n++) {
      expect(padDigits(n + 1)).not.toBe(padDigits(n));
      expect(padTaps(n + 1)).not.toEqual(padTaps(n));
      const taps = padTaps(n);
      expect(taps).toHaveLength(PIN_MIN);
      expect(new Set(taps).size).toBe(PIN_MIN);
      expect(taps.every((c) => PAD_DIGIT_CELLS.includes(c))).toBe(true);
    }
    expect(padTaps(PIN_TAPS.length)).toEqual(padTaps(0));
    // The photo: 2 6 4 / 0 1 9 / 7 5 8 / backspace 3 tick.
    const pad = PIN_PADS[0];
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 10].map((c) => padDigitAt(pad, c))).toEqual(['2', '6', '4', '0', '1', '9', '7', '5', '8', '3']);
    expect(padDigitAt(pad, PAD_BACKSPACE)).toBeNull();
    expect(padDigitAt(pad, PAD_TICK)).toBeNull();
  });

  it('the frames: off, the side button, a dot a tap, the tick from the fourth, the page gone at the end; the pass’s own keypad', () => {
    const w = TURN_MS.wake;
    for (const d of ['gen5', 'flex', 'stax'] as DeviceDrawing[]) {
      const turn = deviceTurn(d, 'unlock', 'bitcoin')!;
      expect(turn.starts).toEqual([0, w, w + 1200, w + 2400, w + 3600, w + 4800, w + 6000]);
      expect(turn.cycle).toBe(w + 6000 + TURN_MS.gone);
      expect(turn.stillFrom).toBe(PIN_MIN + 1);
      for (const n of [0, 1, 2, 3]) {
        const { screens, cues, words } = turn.pass(n);
        // The device off first (decided 2026-10-04: "the device needs to be 'turned on'").
        expect(screens.map(kindOf)).toEqual(['blank', 'pin', 'pin', 'pin', 'pin', 'pin', 'blank']);
        screens.slice(1, 6).forEach((s, k) => expect(s).toEqual({ kind: 'pin', entered: k, cursor: -1, pad: padDigits(n) }));
        // The side button brings the page; four taps on this pass's cells, then the tick, each turning the next frame.
        expect(cues.map((c) => c.controls)).toEqual([['side'], ...padTaps(n).map((c) => [pinKey(c)]), [pinKey(PAD_TICK)]]);
        cues.forEach((c, k) => {
          expect(c.presses).toEqual([{ down: turn.starts[k + 1] - HINT_MS.tap.press, at: turn.starts[k + 1] }]);
          expect(c.in).toBe(turn.starts[k + 1] - HINT_MS.tap.lead);
        });
        // The side button's light goes as the page comes on; the tick goes
        // with the page; the digit keys fade after their tap.
        expect(cues[0]).toMatchObject({ withPage: true, out: w, still: 0 });
        expect(cues[5]).toMatchObject({ withPage: true, out: w + 6000, still: 1 });
        expect(cues[1]).toMatchObject({ out: w + 1200 + HINT_MS.tap.fade });
        expect(cues[1].still).toBeUndefined();
        // "Press" on the side button, then one "Tap" in the band for the whole entry.
        expect(words).toEqual([
          { text: HINT_WORDS.press, at: 'side', both: false, in: cues[0].in, out: w, withPage: true, still: 0 },
          { text: HINT_WORDS.tap, at: 'band', both: false, in: cues[1].in, out: w + 6000, withPage: true, still: 1 },
        ]);
      }
    }
  });
});

describe('the Nano X’s PIN: move the cursor, take a digit with both buttons, run to the tick, both again', () => {
  it('the frames and the cues, in order', () => {
    const turn = deviceTurn('nanoX', 'unlock', 'bitcoin')!;
    const { screens, cues, words } = turn.pass(0);
    const pin = (entered: number, cursor: number) => ({ kind: 'pin', entered, cursor, pad: '' });
    // Three digits in, the cursor stepping 0, 1, 2; the fourth taken; the run 3 to the tick; gone.
    expect(screens.slice(0, 4)).toEqual([pin(3, 0), pin(3, 1), pin(3, 2), pin(4, 2)]);
    expect(screens.slice(4, 12)).toEqual([3, 4, 5, 6, 7, 8, 9, NANO_PIN_TICK].map((c) => pin(4, c)));
    expect(screens[12]).toEqual({ kind: 'blank' });
    expect(turn.starts.slice(0, 4)).toEqual([0, 1200, 2400, 3600]);
    expect(turn.starts.slice(4, 12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((k) => 4800 + k * TURN_MS.run));
    expect(turn.starts[12]).toBe(turn.starts[11] + TURN_MS.step);
    expect(turn.cycle).toBe(turn.starts[12] + TURN_MS.gone);
    expect(turn.stillFrom).toBe(11);
    // Press, press, press both, the run of presses, press both.
    expect(cues.map((c) => c.controls)).toEqual([['right'], ['right'], ['right', 'left'], ['right'], ['right', 'left']]);
    expect(cues[3].presses.map((p) => p.at)).toEqual(turn.starts.slice(4, 12));
    expect(cues[3].quick).toBe(true);
    expect(cues[4].presses[0].at).toBe(turn.starts[12]);
    expect(cues[0].still).toBe(0);
    expect(cues[4].still).toBe(1);
    expect(words.map((w) => [w.text, w.at, w.both])).toEqual([
      [HINT_WORDS.press, 'right', false],
      [HINT_WORDS.press, 'right', false],
      [HINT_WORDS.pressBoth, 'between', true],
      [HINT_WORDS.press, 'right', false],
      [HINT_WORDS.pressBoth, 'between', true],
    ]);
    expect(NANO_PIN_SLOTS).toBe(8);
    // The same on every pass: the Nano X's row is the device's own 0 to 9.
    expect(turn.pass(3)).toEqual(turn.pass(0));
  });

  it('the run: a quick fill per key, each gone before the next', () => {
    const { plan, cues } = planOf('nanoX', 'unlock');
    const right = plan.lit.find((l) => l.control === 'right')!;
    const run = cues[3];
    for (const p of run.presses) {
      expect(valueAt(right.fill, p.down - 1)).toBe(0);
      expect(valueAt(right.fill, p.at)).toBeCloseTo(HINT_MS.fill.level, 5);
      expect(valueAt(right.fill, p.at + HINT_MS.fill.quickOut)).toBe(0);
    }
    // The ring stays lit through the run, and "Press" stays up.
    const mid = (run.presses[2].at + run.presses[3].at) / 2;
    expect(valueAt(right.ring, mid)).toBe(1);
    expect(valueAt(plan.words.find((w) => w.text === HINT_WORDS.press)!.opacity, mid)).toBe(1);
  });
});

describe('"Open app?": one press, then the app’s home on every Ledger (the Gen5 video; the Nano X’s home at the end of its address check)', () => {
  it('the touchscreens tap the Open button; the Nano X presses both; the page read first; the home shown a while, then gone', () => {
    for (const d of HINTED) {
      const turn = deviceTurn(d, 'open-app', 'bitcoin')!;
      const at = TURN_MS.read + HINT_MS.tap.lead;
      const { cues, words, screens } = turn.pass(0);
      expect(cues).toHaveLength(1);
      expect(cues[0].presses).toEqual([{ down: at - HINT_MS.tap.press, at }]);
      expect(turn.stillFrom).toBe(1);
      // The app's home page where the press lands, shown a while, then gone.
      expect(turn.starts).toEqual([0, at, at + TURN_MS.home]);
      expect(turn.cycle).toBe(at + TURN_MS.home + TURN_MS.gone);
      expect(screens).toEqual([{ kind: 'open-app', app: 'Bitcoin' }, { kind: 'app-home', ...ledgerAppHome('bitcoin') }, { kind: 'blank' }]);
      if (d === 'nanoX') {
        expect(cues[0].controls).toEqual(['right', 'left']);
        expect(words).toEqual([{ text: HINT_WORDS.pressBoth, at: 'between', both: true, in: cues[0].in, out: cues[0].out, still: 0 }]);
      } else {
        expect(cues[0]).toMatchObject({ controls: ['open'], withPage: true, out: at });
        expect(words).toEqual([{ text: HINT_WORDS.tap, at: 'open', both: false, in: cues[0].in, out: at, withPage: true, still: 0 }]);
      }
    }
  });

  it('the home page’s words: the video’s on the test network; the main network’s as the app’s source has them', () => {
    expect(ledgerAppHome('testnet')).toEqual({ app: 'Bitcoin Testnet', note: 'This app enables signing transactions on all the Bitcoin test networks.' });
    expect(ledgerAppHome('bitcoin')).toEqual({ app: 'Bitcoin', note: 'This app enables signing transactions on the Bitcoin network.' });
    expect(deviceTurn('gen5', 'open-app', 'testnet')!.pass(0).screens[1]).toEqual({ kind: 'app-home', app: 'Bitcoin Testnet', note: ledgerAppHome('testnet').note });
  });
});

describe('registering the vault (the three videos, 2026-10-04): the pages, the approval, the device’s word, round again', () => {
  const pagesOf = (d: DeviceDrawing, facts = FACTS) => registerPages(d, facts);

  it('the frames: every page as the device shows it, then the device’s word, then gone; the same every pass', () => {
    for (const [d, facts] of [...HINTED.map((h) => [h, FACTS] as const), ['nova', FACTS] as const, ['nova', POLICY] as const, ['gen5', POLICY] as const]) {
      const turn = turnOf(d, 'register', facts);
      const pages = pagesOf(d, facts);
      const { screens } = turn.pass(0);
      expect(screens).toHaveLength(pages.length + 2);
      pages.forEach((page, index) => expect(screens[index]).toEqual({ kind: 'review', page, index, total: pages.length }));
      expect(screens[pages.length]).toEqual({ kind: 'registered', text: d === 'nova' ? (facts.multisig ? 'Multisig account registered' : 'Policy registered') : 'Account registered' });
      expect(screens[pages.length + 1]).toEqual({ kind: 'blank' });
      expect(turn.starts).toHaveLength(screens.length);
      expect(turn.pass(3)).toEqual(turn.pass(0));
      // The approval's page is where the still hint changes sides.
      expect(turn.stillFrom).toBe(pages.length - 1);
    }
  });

  it('the pace: each page its reading time, the last page its device’s own approval, the word, then gone', () => {
    for (const d of [...HINTED, 'nova' as const]) {
      const turn = turnOf(d, 'register');
      const pages = pagesOf(d);
      let t = 0;
      pages.forEach((p, i) => {
        expect({ d, i, at: turn.starts[i] }).toEqual({ d, i, at: t });
        t += i === pages.length - 1 ? registerApproveMs(d) : registerDwell(p);
      });
      expect(turn.starts[pages.length]).toBe(t);
      expect(turn.starts[pages.length + 1]).toBe(t + REGISTER_MS.registered);
      expect(turn.cycle).toBe(t + REGISTER_MS.registered + TURN_MS.gone);
    }
    // The last page: read then the Approve tapped; both buttons; Total's hold.
    expect(registerApproveMs('gen5')).toBe(TURN_MS.read + HINT_MS.tap.lead);
    expect(registerApproveMs('nanoX')).toBe(HINT_MS.both.wait + HINT_MS.both.press + HINT_MS.both.held);
    expect(registerApproveMs('nova')).toBe(NOVA_TOTAL_MS.read + NOVA_TOTAL_MS.top + NOVA_TOTAL_MS.both + NOVA_TOTAL_MS.meet);
    // A key gets longer than a page of words; a page the Nano X marks long too.
    expect(registerDwell({ kind: 'touch-register-key', title: 'External key@0', key: 'x' })).toBeGreaterThan(registerDwell({ kind: 'touch-register-intro' }));
    expect(registerDwell({ kind: 'nano-item', title: 'Their key@0 (1/3)', value: 'x', long: true })).toBeGreaterThan(registerDwell({ kind: 'nano-item', title: 'Account name', value: 'x' }));
  });

  it('the touchscreens: "Tap" on the footer’s ">" for every turn (gone with the turn onto the last page, which draws none), then "Tap" on Approve, gone with the page', () => {
    for (const d of ['gen5', 'flex', 'stax'] as const) {
      const turn = turnOf(d, 'register');
      const n = pagesOf(d).length;
      const { cues, words, progress } = turn.pass(0);
      expect(progress).toBeNull();
      expect(cues).toHaveLength(n);
      cues.slice(0, n - 1).forEach((c, i) => {
        const T = turn.starts[i + 1];
        expect(c).toMatchObject({ controls: ['next'], presses: [{ down: T - HINT_MS.tap.press, at: T }], in: T - HINT_MS.tap.lead, still: 0 });
        expect({ i, withPage: c.withPage === true, out: c.out }).toEqual({ i, withPage: i + 2 === n, out: i + 2 === n ? T : T + HINT_MS.tap.fade });
      });
      const approve = cues[n - 1];
      const at = turn.starts[n];
      expect(approve).toMatchObject({ controls: ['approve'], presses: [{ down: at - HINT_MS.tap.press, at }], in: at - HINT_MS.tap.lead, out: at, withPage: true, still: 1 });
      expect(words.map((w) => [w.text, w.at, w.both, w.still])).toEqual([...Array.from({ length: n - 1 }, () => [HINT_WORDS.tap, 'next', false, 0]), [HINT_WORDS.tap, 'approve', false, 1]]);
      expect(words[n - 1]).toMatchObject({ in: approve.in, out: at, withPage: true });
    }
  });

  it('the Nano X: "Press" on the right button for every turn, then "Press both" on "Register account", which the device answers with its word', () => {
    const turn = turnOf('nanoX', 'register');
    const n = pagesOf('nanoX').length;
    const { cues, words, progress } = turn.pass(0);
    expect(progress).toBeNull();
    expect(cues).toHaveLength(n);
    cues.slice(0, n - 1).forEach((c, i) => expect(c).toMatchObject({ controls: ['right'], presses: [{ at: turn.starts[i + 1] }], still: 0 }));
    expect(cues.slice(0, n - 1).some((c) => c.withPage)).toBe(false);
    const L = turn.starts[n - 1];
    const at = turn.starts[n];
    const m = HINT_MS.both;
    expect(cues[n - 1]).toEqual({ controls: ['right', 'left'], in: L + m.wait, presses: [{ down: L + m.wait + m.press, at }], out: at + m.fade, still: 1 });
    expect(words[n - 1]).toEqual({ text: HINT_WORDS.pressBoth, at: 'between', both: true, in: L + m.wait, out: at + m.fade, still: 1 });
    expect(words.slice(0, n - 1).every((w) => w.text === HINT_WORDS.press && w.at === 'right')).toBe(true);
  });

  it('the BitBox: "Tap" on the top right edge for every turn, then Total’s hold on the last page: "Hold", the up arrow, "Hold both", the arrows meeting as the device answers', () => {
    for (const facts of [FACTS, POLICY]) {
      const turn = turnOf('nova', 'register', facts);
      const n = pagesOf('nova', facts).length;
      const { cues, words, progress } = turn.pass(0);
      expect(cues).toHaveLength(n + 1);
      cues.slice(0, n - 1).forEach((c, i) => expect(c).toMatchObject({ controls: ['edgeTop'], presses: [{ at: turn.starts[i + 1] }], still: 0, out: turn.starts[i + 1] + HINT_MS.tap.fade }));
      const L = turn.starts[n - 1];
      const at = turn.starts[n];
      const s = NOVA_TOTAL_MS;
      const down = L + s.read;
      const second = down + s.top;
      const slide = second + s.both;
      expect(at).toBe(slide + s.meet);
      expect(cues[n - 1]).toEqual({ controls: ['edgeTop'], in: down - HINT_MS.edges.press, presses: [{ down, at }], out: at + HINT_MS.edges.fade, still: 1 });
      expect(cues[n]).toEqual({ controls: ['edgeBottom'], in: second, presses: [{ down: second + HINT_MS.edges.press, at }], out: at + HINT_MS.edges.fade, still: 1 });
      const swap = HINT_MS.word.swap;
      expect(words.slice(n - 1)).toEqual([
        { text: HINT_WORDS.hold, at: 'edgeTop', both: false, in: down - HINT_MS.edges.press, out: second + swap, fade: swap },
        { text: HINT_WORDS.holdBoth, at: 'edgeTop', both: true, in: second + swap, out: at + HINT_MS.edges.fade, still: 1 },
      ]);
      // The device's own progress: the up arrow in once the top edge is
      // held, the arrows sliding together until they meet at the word; the
      // page whole and no confirmation layer (the word is the next frame).
      expect(progress?.kind).toBe('arrows');
      if (progress?.kind !== 'arrows') return;
      expect(valueAt(progress.up, second - 1)).toBe(0);
      expect(valueAt(progress.up, second + HINT_MS.arrow.in)).toBe(1);
      expect(valueAt(progress.up, turn.cycle)).toBe(1);
      expect(valueAt(progress.slide, slide)).toBe(0);
      expect(valueAt(progress.slide, (slide + at) / 2)).toBeGreaterThan(0.2);
      expect(valueAt(progress.slide, at)).toBe(1);
      expect([valueAt(progress.page, 0), valueAt(progress.page, at), valueAt(progress.page, turn.cycle)]).toEqual([1, 1, 1]);
      expect([valueAt(progress.confirmed, 0), valueAt(progress.confirmed, at), valueAt(progress.confirmed, turn.cycle)]).toEqual([0, 0, 0]);
      expect(progress.up.still).toEqual([0, 1]);
    }
  });

  it('the slab: its one page, still, no hint', () => {
    const turn = turnOf('slab', 'register');
    expect(turn.cycle).toBe(0);
    expect(turn.starts).toEqual([0]);
    expect(turn.pass(0)).toMatchObject({ cues: [], words: [], progress: null });
    expect(turn.pass(0).screens).toEqual([{ kind: 'review', page: { kind: 'slab-register' }, index: 0, total: 1 }]);
  });
});

describe('the BitBox: its side while the search runs, its password once it was found (decided 2026-10-04)', () => {
  const m = NOVA_UNLOCK_MS;
  const side = deviceTurn('nova', 'side', 'bitcoin')!;
  const turn = deviceTurn('nova', 'unlock', 'bitcoin')!;
  const ccwTo = m.side.still + m.side.turn;
  const sideAt = ccwTo + m.side.turn;
  const taps = [0, 1, 2, 3].map((k) => m.read + k * m.step);
  const confirmAt = taps[3] + m.done;
  const holdDown = confirmAt + m.confirm;
  const met = holdDown + m.meet;
  const lockAt = met + m.met;
  const splashAt = lockAt + m.locked + m.opening + m.open;
  const goneAt = splashAt + m.splash;

  it('the groups along the bottom are the device\u2019s, a group opens over the same three slots, each typed character has its two taps', () => {
    expect(NOVA_GROUPS).toEqual(['012', '345', '6789']);
    expect(novaSplit('6789')).toEqual(['6', '7', '89']);
    expect(novaSplit('012')).toEqual(['0', '1', '2']);
    expect(novaKeyOf('6')).toEqual({ group: 2, slot: 0 });
    expect(novaKeyOf('3')).toEqual({ group: 1, slot: 0 });
    expect(novaKeyOf('7')).toEqual({ group: 2, slot: 1 });
    expect(novaKeyOf('0')).toEqual({ group: 0, slot: 0 });
    expect(NOVA_TYPED[0]).toEqual(['6', '3']);
    for (const pair of NOVA_TYPED) for (const ch of pair) expect(['8', '9']).not.toContain(ch);
    for (let n = 0; n < 8; n++) expect(novaTyped(n + 1)).not.toEqual(novaTyped(n));
    expect(novaTyped(NOVA_TYPED.length)).toEqual(novaTyped(0));
  });

  it('the side: the arrow turns one way then the other, "Tap" on the middle of the bottom edge, the page goes with it', () => {
    expect(side.starts).toEqual([0, sideAt]);
    expect(side.cycle).toBe(sideAt + m.gone);
    expect(side.stillFrom).toBe(0);
    const { screens, cues, words, progress } = side.pass(0);
    expect(screens).toEqual([{ kind: 'nova-side' }, { kind: 'blank' }]);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ controls: ['edgeMiddle'], withPage: true, out: sideAt, still: 0, presses: [{ down: sideAt - HINT_MS.tap.press, at: sideAt }] });
    expect(words.map((w) => [w.text, w.at])).toEqual([[HINT_WORDS.tap, 'edgeMiddle']]);
    const { plan } = planOf('nova', 'side');
    const p = plan.progress!;
    expect(p.kind).toBe('unlock');
    if (p.kind !== 'unlock' || progress == null) return;
    expect(valueAt(p.ccw, 0)).toBe(1);
    expect(valueAt(p.cw, 0)).toBe(0);
    expect(valueAt(p.turn, m.side.still)).toBe(0);
    expect(valueAt(p.turn, ccwTo - 1)).toBeLessThan(-NOVA_SIDE_TURN * 0.95);
    expect(valueAt(p.cw, ccwTo + 1)).toBe(1);
    expect(valueAt(p.turn, sideAt - 1)).toBeGreaterThan(NOVA_SIDE_TURN * 0.95);
    expect(valueAt(p.cw, sideAt + 2)).toBe(0);
  });

  it('the password: the frames in the recording\u2019s order at the guide\u2019s pace, the pass\u2019s own pair of characters', () => {
    expect(turn.starts).toEqual([0, ...taps, confirmAt, lockAt, splashAt, goneAt]);
    expect(turn.cycle).toBe(goneAt + m.gone);
    expect(turn.stillFrom).toBe(5);
    for (let n = 0; n < 4; n++) {
      const [a, b] = novaTyped(n);
      const { screens } = turn.pass(n);
      const top = NOVA_GROUPS;
      expect(screens).toEqual([
        { kind: 'nova-password', entered: 0, last: null, groups: top, depth: 0 },
        { kind: 'nova-password', entered: 0, last: null, groups: novaSplit(top[novaKeyOf(a).group]), depth: 1 },
        { kind: 'nova-password', entered: 1, last: a, groups: top, depth: 0 },
        { kind: 'nova-password', entered: 1, last: a, groups: novaSplit(top[novaKeyOf(b).group]), depth: 1 },
        { kind: 'nova-password', entered: 2, last: b, groups: top, depth: 0 },
        { kind: 'nova-confirm', entered: 2, last: b },
        { kind: 'nova-lock' },
        { kind: 'nova-splash' },
        { kind: 'blank' },
      ]);
      expect(screens).toHaveLength(turn.starts.length);
    }
  });

  it('the password\u2019s cues: "Tap" on each group\u2019s slot, on the top right edge; then "Hold both" on both right edges', () => {
    const { cues, words } = turn.pass(0);
    const ka = novaKeyOf('6');
    const kb = novaKeyOf('3');
    expect(cues.map((c) => c.controls)).toEqual([
      [slotKey(ka.group)],
      [slotKey(ka.slot)],
      [slotKey(kb.group)],
      [slotKey(kb.slot)],
      ['edgeTop'],
      ['edgeTop', 'edgeBottom'],
    ]);
    cues.slice(0, 4).forEach((c, k) => expect(c).toMatchObject({ in: taps[k] - HINT_MS.tap.lead, presses: [{ down: taps[k] - HINT_MS.tap.press, at: taps[k] }], out: taps[k] + HINT_MS.tap.fade }));
    expect(cues[4]).toMatchObject({ withPage: true, out: confirmAt, presses: [{ at: confirmAt }] });
    expect(cues[5]).toEqual({ controls: ['edgeTop', 'edgeBottom'], in: holdDown - HINT_MS.edges.press, presses: [{ down: holdDown, at: met }], out: met + HINT_MS.edges.fade, still: 1 });
    expect(words.map((w) => [w.text, w.at, w.both])).toEqual([
      [HINT_WORDS.tap, slotKey(ka.group), false],
      [HINT_WORDS.tap, slotKey(ka.slot), false],
      [HINT_WORDS.tap, slotKey(kb.group), false],
      [HINT_WORDS.tap, slotKey(kb.slot), false],
      [HINT_WORDS.tap, 'edgeTop', false],
      [HINT_WORDS.holdBoth, 'edgeTop', true],
    ]);
    expect(words.some((w) => w.text === HINT_WORDS.hold)).toBe(false);
  });

  it('the password\u2019s own progress: the arrows slide and meet, the shackle swings open; nothing lit at either end', () => {
    const { plan, cycle } = planOf('nova', 'unlock');
    const p = plan.progress!;
    if (p.kind !== 'unlock') throw new Error('unlock progress');
    expect(valueAt(p.slide, holdDown)).toBe(0);
    expect(valueAt(p.slide, (holdDown + met) / 2)).toBeGreaterThan(0.2);
    expect(valueAt(p.slide, (holdDown + met) / 2)).toBeLessThan(0.8);
    expect(valueAt(p.slide, met)).toBe(1);
    expect(valueAt(p.shackle, lockAt + m.locked)).toBe(0);
    expect(valueAt(p.shackle, lockAt + m.locked + m.opening)).toBe(1);
    expect(valueAt(p.shackle, cycle)).toBe(1);
    const lit = (c: string) => plan.lit.find((l) => l.control === c)!;
    const mid = (holdDown + met) / 2;
    for (const c of ['edgeTop', 'edgeBottom']) {
      expect(valueAt(lit(c).ring, mid)).toBe(1);
      expect(valueAt(lit(c).fill, mid)).toBeCloseTo(HINT_MS.fill.level, 5);
    }
    for (const c of [...plan.lit.flatMap((l) => [l.ring, l.fill]), ...plan.words.map((w) => w.opacity)]) {
      expect([valueAt(c, 0), valueAt(c, cycle)]).toEqual([0, 0]);
    }
  });
});

describe('every pass on one clock: cues in order, nothing lit at either end, every channel rising', () => {
  it('for every hinted drawing and turn, four passes', () => {
    for (const [d, ask] of TURNS) {
      {
        for (let n = 0; n < 4; n++) {
          const { plan, cycle, cues } = planOf(d, ask, n);
          cues.forEach((c, i) => {
            const ctx = { d, ask, n, i };
            const downs = c.presses.map((p) => p.down);
            expect({ ...ctx, ok: c.in >= 0 && c.in < downs[0] && c.presses.every((p) => p.down < p.at) && c.presses[c.presses.length - 1].at <= c.out && c.out <= cycle }).toEqual({ ...ctx, ok: true });
            // In order; and on one control, one cue at a time (a control's
            // ring is one channel): two controls may light together, as the
            // Nova's two edges do on a hold, the bottom one after the top.
            if (i > 0) expect({ ...ctx, ordered: cues[i - 1].in <= c.in }).toEqual({ ...ctx, ordered: true });
            for (const control of c.controls) {
              for (const o of cues.slice(0, i).filter((x) => x.controls.includes(control))) {
                expect({ ...ctx, control, apart: o.out <= c.in }).toEqual({ ...ctx, control, apart: true });
              }
            }
          });
          const p = plan.progress;
          const own = p?.kind === 'unlock' ? [p.turn, p.ccw, p.cw, p.slide, p.shackle] : p?.kind === 'arrows' ? [p.page, p.confirmed, p.up, p.upRise, p.slide] : [];
          const channels = [...plan.lit.flatMap((l) => [l.ring, l.fill]), ...plan.words.flatMap((w) => [w.opacity, w.rise]), ...own, ...plan.scrolls.map((s) => s.scroll)];
          for (const c of channels) {
            const x = c.inputRange;
            expect(x[0]).toBe(0);
            expect(x[x.length - 1]).toBeGreaterThanOrEqual(cycle);
            for (let i = 1; i < x.length; i++) expect({ d, ask, i, rises: x[i] > x[i - 1] }).toEqual({ d, ask, i, rises: true });
          }
          for (const c of [...plan.lit.flatMap((l) => [l.ring, l.fill]), ...plan.words.map((w) => w.opacity)]) {
            expect({ d, ask, n, start: valueAt(c, 0), end: valueAt(c, cycle) }).toEqual({ d, ask, n, start: 0, end: 0 });
          }
          // The Nova's own progress on its unlock and its registration, its line swiped along on its address check; a Ledger's turns have none of either.
          expect(plan.progress == null && plan.scrolls.length === 0).toBe(d !== 'nova');
          expect({ d, ask, scrolled: plan.scrolls.length }).toEqual({ d, ask, scrolled: d === 'nova' && ask === 'address' ? 1 : 0 });
          // A travelling control's place is a channel of its own, from the right end to the left.
          for (const l of plan.lit) {
            if (l.along == null) continue;
            expect({ d, ask, control: l.control }).toEqual({ d, ask, control: 'edgeAlong' });
            expect([valueAt(l.along, 0), valueAt(l.along, cycle)]).toEqual([1, 1]);
          }
        }
      }
    }
  });

  it('Reduce Motion: the first frames show the first control and its word, the last the one that finishes', () => {
    for (const d of [...HINTED, 'nova' as const]) {
      const { plan } = planOf(d, 'unlock');
      const shown = (side: 0 | 1) => plan.lit.filter((l) => l.ring.still[side] === 1).map((l) => l.control);
      const said = (side: 0 | 1) => plan.words.filter((w) => w.opacity.still[side] === 1).map((w) => w.text);
      if (d === 'nova') {
        expect(shown(0)).toEqual([slotKey(novaKeyOf('6').group)]);
        expect(shown(1).sort()).toEqual(['edgeBottom', 'edgeTop']);
        expect(said(0)).toEqual([HINT_WORDS.tap]);
        expect(said(1)).toEqual([HINT_WORDS.holdBoth]);
      } else if (d === 'nanoX') {
        expect(shown(0)).toEqual(['right']);
        expect(shown(1).sort()).toEqual(['left', 'right']);
        expect(said(0)).toEqual([HINT_WORDS.press]);
        expect(said(1)).toEqual([HINT_WORDS.pressBoth]);
      } else {
        // The side button that turns the device on, then the tick.
        expect(shown(0)).toEqual(['side']);
        expect(shown(1)).toEqual([pinKey(PAD_TICK)]);
        expect(said(0)).toEqual([HINT_WORDS.press]);
        expect(said(1)).toEqual([HINT_WORDS.tap]);
      }
    }
  });

  it('Reduce Motion on the registration: what moves on at first, what approves on the last page', () => {
    for (const d of [...HINTED, 'nova' as const]) {
      const { plan } = planOf(d, 'register');
      const shown = (side: 0 | 1) => plan.lit.filter((l) => l.ring.still[side] === 1).map((l) => l.control);
      const said = (side: 0 | 1) => plan.words.filter((w) => w.opacity.still[side] === 1).map((w) => w.text);
      if (d === 'nova') {
        expect(shown(0)).toEqual(['edgeTop']);
        expect(shown(1).sort()).toEqual(['edgeBottom', 'edgeTop']);
        expect(said(0)).toEqual([HINT_WORDS.tap]);
        expect(said(1)).toEqual([HINT_WORDS.holdBoth]);
      } else if (d === 'nanoX') {
        expect(shown(0)).toEqual(['right']);
        expect(shown(1).sort()).toEqual(['left', 'right']);
        expect(said(0)).toEqual([HINT_WORDS.press]);
        expect(said(1)).toEqual([HINT_WORDS.pressBoth]);
      } else {
        expect(shown(0)).toEqual(['next']);
        expect(shown(1)).toEqual(['approve']);
        expect(said(0)).toEqual([HINT_WORDS.tap]);
        expect(said(1)).toEqual([HINT_WORDS.tap]);
      }
    }
  });
});

describe('the words: the device’s steps numbered in the title (decided 2026-10-05), the line following the step', () => {
  it('the BitBox: "1. Tap the side facing you" while the search runs, "2. Enter your password" once found', () => {
    const w = turnWords('nova', 'side', 'bitcoin');
    expect(w).toEqual({ step: 1, title: '1. Tap the side facing you', line: 'Plug the BitBox in first.' });
    const u = turnWords('nova', 'unlock', 'bitcoin');
    // It may already be unlocked once found: the line says so, the title stays the plan's.
    expect(u).toEqual({ step: 2, title: '2. Enter your password', line: 'If the BitBox is already unlocked, this takes just a moment.' });
    for (const x of [w, u]) {
      expect(`${x.title} ${x.line}`).not.toMatch(/[—–]/);
      // Never a claim about what the device shows.
      expect(`${x.title} ${x.line}`).not.toMatch(/\b(is showing|now showing)\b/i);
    }
    // The BitBox has no app to open: no "2." of a Ledger's kind.
    expect(turnWords('nova', 'open-app', 'bitcoin').title).not.toMatch(/app/);
  });

  it('every Ledger: "1. Enter your PIN on the Ledger", then "2. Open the Bitcoin app" (the app named for the network)', () => {
    for (const d of LEDGERS) {
      const pin = turnWords(d, 'unlock', 'bitcoin');
      expect({ d, step: pin.step, title: pin.title }).toEqual({ d, step: 1, title: '1. Enter your PIN on the Ledger' });
      // The same PIN step on every network: only the app's name changes.
      expect(turnWords(d, 'unlock', 'testnet')).toEqual(pin);
      const app = turnWords(d, 'open-app', 'bitcoin');
      expect({ d, step: app.step, title: app.title, line: app.line }).toEqual({ d, step: 2, title: '2. Open the Bitcoin app', line: null });
      expect(turnWords(d, 'open-app', 'testnet').title).toBe('2. Open the Bitcoin Test app');
      for (const ask of ASKS) {
        const w = turnWords(d, ask, 'bitcoin');
        expect(w.title).not.toMatch(/[—–]|Your turn/);
        if (w.line != null) {
          expect(w.line).not.toMatch(/[—–]/);
          expect(w.line.endsWith('.')).toBe(true);
          // The line adds to the title, never repeats it.
          expect(w.line).not.toMatch(/Enter your PIN|Open the/);
        }
      }
    }
    // The touchscreens' line: the side button only IF the device is off
    // (pressed on a device that is on, it puts it to sleep), and the keys move.
    for (const d of ['gen5', 'flex', 'stax'] as DeviceDrawing[]) {
      expect(turnWords(d, 'unlock', 'bitcoin').line).toBe('Press the side button if it is off. The keys change places each time.');
    }
    // The Nano X's buttons and the slab's words: the drawing and the title say it all.
    expect(turnWords('nanoX', 'unlock', 'bitcoin').line).toBeNull();
    expect(turnWords('slab', 'unlock', 'bitcoin').line).toBeNull();
  });

  it('the registration: "3. Register the vault" on every device; what approves on each model’s last page, true for every vault; the slab’s line for every model', () => {
    for (const d of ['gen5', 'flex', 'stax'] as DeviceDrawing[]) {
      expect(turnWords(d, 'register', 'bitcoin')).toEqual({ step: 3, title: '3. Register the vault', line: 'Check the vault page by page on the Ledger, then tap Approve.' });
    }
    expect(turnWords('nanoX', 'register', 'bitcoin')).toEqual({ step: 3, title: '3. Register the vault', line: 'Check the vault page by page on the Ledger, then press both buttons on “Register account”.' });
    expect(turnWords('slab', 'register', 'bitcoin')).toEqual({ step: 3, title: '3. Register the vault', line: 'Check each key on the Ledger and approve it there.' });
    expect(turnWords('nova', 'register', 'bitcoin')).toEqual({
      step: 3,
      title: '3. Register the vault',
      line: 'Check the vault page by page on the BitBox. On its last page, hold the top right edge, then the bottom right edge too.',
    });
    for (const d of DEVICE_DRAWINGS) {
      const w = turnWords(d, 'register', 'bitcoin');
      expect(w.line).not.toBeNull();
      expect(w.line).not.toMatch(/[—–]/);
      // Never a claim about which page the device is on, nor whose key a page shows.
      expect(w.line).not.toMatch(/\b(is showing|now showing|your key|our key)\b/i);
    }
  });

  it('a step the device skips keeps the plan’s numbers: every title starts with its ask’s own step, whatever came before', () => {
    const all: [DeviceDrawing, DeviceAsk][] = [...TURNS, ['slab', 'unlock'], ['slab', 'open-app'], ['slab', 'register'], ['slab', 'address']];
    for (const [d, ask] of all) {
      const w = turnWords(d, ask, 'bitcoin');
      expect({ d, ask, starts: w.title.startsWith(`${w.step}. `) }).toEqual({ d, ask, starts: true });
      const expected = ask === 'register' || ask === 'address' ? 3 : d === 'nova' ? (ask === 'side' ? 1 : 2) : ask === 'unlock' ? 1 : 2;
      expect({ d, ask, step: w.step }).toEqual({ d, ask, step: expected });
    }
    // The job is "3." whether the device asked for its PIN and its app first or
    // was already unlocked with the app open: a step's number is its ask's.
    expect(turnWords('gen5', 'register', 'bitcoin').step).toBe(3);
    expect(turnWords('nova', 'address', 'bitcoin').step).toBe(3);
  });
});
