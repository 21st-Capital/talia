/**
 * The client's turn, mounted (decided 2026-10-03: deleting the tour's
 * re-scheduling left every test green while the tour froze on page 2). The
 * tour as screen 2 mounts it, under fake timers: the pages turn on the
 * pass's own clock and start again from the first, the hint's clock starts
 * again with every pass, Reduce Motion stops it, and nothing is left running
 * once the turn is over.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { resetStub, stub } from '../../__tests__/rnStub';
import { DeviceLoop, SigningTour, askOnce } from '../SigningTour';
import type { LoopScript } from '../SigningTour';
import { deviceHint, planFromCues } from '../pressHintScript';
import { deviceTurn, padDigits } from '../../hww/deviceTurns';
import { NOVA_TOTAL_PAGE_MS, reviewPages, tourCycle, tourStarts } from '../../hww/signingDevice';
import { registerFacts, registerPages } from '../../hww/vaultRegistration';
import { novaHoldArrows, novaScrollTravel, novaThumbTravel } from '../deviceScreenLayout';
import { novaAnchors } from '../NovaArt';
import type { DeviceDrawing, TourFacts } from '../../hww/signingDevice';
import { MULTISIG_2_OF_3 } from '../../../bitcoin/descriptor/__fixtures__/descriptors';

jest.mock('react-native', () => require('../../__tests__/rnStub').reactNative);
jest.mock('react-native-svg', () => require('../../__tests__/rnStub').svg);

/** The drawing is replaced by a recorder: which page, with what progress and which scrolled lines. */
const drawn: { index: number; screen: unknown; progress: unknown; scrolls: unknown }[] = [];
jest.mock('../DeviceArt', () => {
  const actual = jest.requireActual('../DeviceArt');
  return {
    ...actual,
    DeviceArt: (props: { screen: { index: number }; progress?: unknown; scrolls?: unknown }) => {
      drawn.push({ index: props.screen.index, screen: props.screen, progress: props.progress, scrolls: props.scrolls });
      return null;
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
const NOVA_ONLY_TOTAL: TourFacts = { ...LEDGER, brand: 'bitbox', registeredName: null, bitboxKind: { kind: 'single' }, outputs: [], lockTime: null };
/** A Nova paying someone: its amount page swipes the address (decided 2026-10-05). */
const NOVA_PAYING: TourFacts = { ...LEDGER, brand: 'bitbox', bitboxKind: { kind: 'multisig', threshold: 2, keys: 3 } };

const page = () => drawn[drawn.length - 1].index;

async function mount(drawing: DeviceDrawing, facts: TourFacts) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(<SigningTour drawing={drawing} width={176} facts={facts} />);
  });
  return r;
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** Unmounted, and React's own scheduler drained: a timer the tour left
 *  behind would set itself again, so none may be left. */
async function unmountAndCount(r: TestRenderer.ReactTestRenderer): Promise<number> {
  await act(async () => {
    r.unmount();
  });
  jest.runOnlyPendingTimers();
  return jest.getTimerCount();
}

const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  // react-test-renderer says it is deprecated; everything else is shown.
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

beforeEach(() => {
  jest.useFakeTimers();
  resetStub();
  drawn.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the tour goes round for as long as the turn lasts', () => {
  it('past one pass the first page shows again, then the second; nothing runs once it unmounts', async () => {
    const pages = reviewPages('gen5', LEDGER);
    const starts = tourStarts(pages);
    const cycle = tourCycle(pages);
    expect(starts).toEqual([0, 1800, 4400, 6000]);
    const r = await mount('gen5', LEDGER);
    expect(page()).toBe(0);
    await advance(1800);
    expect(page()).toBe(1);
    await advance(4400 - 1800);
    expect(page()).toBe(2);
    await advance(cycle - 4400 - 1);
    expect(page()).toBe(3);
    // One pass over: the first page again, then the second.
    await advance(1);
    expect(page()).toBe(0);
    await advance(1800);
    expect(page()).toBe(1);
    // And round again, many times.
    await advance(10 * cycle);
    expect(page()).toBe(1);
    expect(await unmountAndCount(r)).toBe(0);
    expect(stub.timings.every((t) => !t.started || t.stopped)).toBe(true);
  });

  it('the hint’s clock runs the pass on the native driver, and starts again with every pass', async () => {
    const pages = reviewPages('nanoX', LEDGER);
    const cycle = tourCycle(pages);
    const r = await mount('nanoX', LEDGER);
    expect(stub.timings).toHaveLength(1);
    expect(stub.timings[0].config).toMatchObject({ toValue: cycle, duration: cycle, useNativeDriver: true });
    expect(stub.timings[0].started).toBe(true);
    // Page turns inside a pass leave the clock alone...
    await advance(cycle - 1);
    expect(stub.timings).toHaveLength(1);
    // ...a new pass starts it again from where the pass stands.
    await advance(1);
    expect(stub.timings).toHaveLength(2);
    expect(stub.timings[0].stopped).toBe(true);
    expect(stub.timings[1].started).toBe(true);
    expect(stub.setValues[stub.setValues.length - 1]).toBeLessThan(50);
    // Pass by pass (each pass a render of its own, as on the phone).
    for (let k = 0; k < 3; k++) await advance(cycle);
    expect(stub.timings).toHaveLength(5);
    // Only one clock runs at a time.
    expect(stub.timings.filter((t) => t.started && !t.stopped)).toHaveLength(1);
    expect(await unmountAndCount(r)).toBe(0);
    expect(stub.timings.filter((t) => t.started && !t.stopped)).toHaveLength(0);
  });

  it('a Nova whose only page is Total still plays the hold, pass after pass', async () => {
    expect(reviewPages('nova', NOVA_ONLY_TOTAL)).toHaveLength(1);
    const r = await mount('nova', NOVA_ONLY_TOTAL);
    expect(stub.timings).toHaveLength(1);
    await advance(NOVA_TOTAL_PAGE_MS);
    expect(page()).toBe(0);
    expect(stub.timings).toHaveLength(2);
    // The drawing gets the Nova's own progress (its arrows and confirmation).
    expect((drawn[drawn.length - 1].progress as { kind: string }).kind).toBe('nova');
    expect(await unmountAndCount(r)).toBe(0);
  });

  it('the Nova’s arrows slide toward each other and meet: down by +travel, up by -travel (decided 2026-10-04)', async () => {
    const r = await mount('nova', NOVA_ONLY_TOTAL);
    type Track = { config: { outputRange: number[] } };
    const p = drawn[drawn.length - 1].progress as { kind: string; downY: Track; upY: Track };
    expect(p.kind).toBe('nova');
    // The down arrow starts at the top and the up arrow at the bottom
    // (deviceProgress.test), each moving `travel` toward the other.
    const travel = novaHoldArrows().travel * novaAnchors(176).px;
    expect(travel).toBeGreaterThan(0);
    const down = p.downY.config.outputRange;
    const up = p.upY.config.outputRange;
    expect([Math.min(...down), Math.max(...down)].map((v) => v + 0)).toEqual([0, travel]);
    expect([Math.min(...up), Math.max(...up)].map((v) => v + 0)).toEqual([-travel, 0]);
    // Met by the end of the pass, where the device confirms.
    expect([down[down.length - 1], up[up.length - 1]]).toEqual([travel, -travel]);
    expect(await unmountAndCount(r)).toBe(0);
  });

  it('the Nova’s amount page hands the drawing the address’s scroll for that frame alone: the line carried left by its travel, the thumb right along its track (decided 2026-10-05)', async () => {
    const pages = reviewPages('nova', NOVA_PAYING);
    const starts = tourStarts(pages);
    const i = pages.findIndex((p) => p.kind === 'nova-output');
    const page_ = pages[i];
    if (page_.kind !== 'nova-output') throw new Error(page_.kind);
    const r = await mount('nova', NOVA_PAYING);
    type Track = { config: { outputRange: number[] } };
    type Scroll = { page: number; line: Track; thumb: Track };
    // On every frame the same list: the one swiped frame, by its index.
    const scrolls = drawn[drawn.length - 1].scrolls as Scroll[];
    expect(scrolls.map((s) => s.page)).toEqual([i]);
    const px = novaAnchors(176).px;
    // (`v + 0` reads a negated zero as zero, as the arrows' test does.)
    const line = scrolls[0].line.config.outputRange.map((v: number) => v + 0);
    expect([Math.min(...line), Math.max(...line)]).toEqual([-novaScrollTravel(page_.to) * px, 0]);
    expect(line[0]).toBe(0);
    expect(line[line.length - 1]).toBe(0);
    const thumb = scrolls[0].thumb.config.outputRange;
    expect([Math.min(...thumb), Math.max(...thumb)]).toEqual([0, novaThumbTravel() * px]);
    // The frame turns onto the amount page with the same scroll, and Total keeps its arrows.
    await advance(starts[i]);
    expect(page()).toBe(i);
    expect((drawn[drawn.length - 1].scrolls as Scroll[]).map((s) => s.page)).toEqual([i]);
    await advance(starts[starts.length - 1] - starts[i]);
    expect(page()).toBe(pages.length - 1);
    expect((drawn[drawn.length - 1].progress as { kind: string }).kind).toBe('nova');
    expect(await unmountAndCount(r)).toBe(0);
    // A Nova paying nobody else scrolls nothing.
    const none = await mount('nova', NOVA_ONLY_TOTAL);
    expect(drawn[drawn.length - 1].scrolls).toEqual([]);
    expect(await unmountAndCount(none)).toBe(0);
  });

  it('with Reduce Motion the clock stops and the hint stands still for the page on show', async () => {
    stub.reduceMotion = true;
    const r = await mount('gen5', LEDGER);
    // The clock started as the turn opened is stopped once Reduce Motion answers.
    expect(stub.timings.filter((t) => t.started && !t.stopped)).toHaveLength(0);
    const pages = reviewPages('gen5', LEDGER);
    const starts = tourStarts(pages);
    // The pages still turn; on the last one the device's line stands half
    // full, the page whole, "Signing transaction" not yet come.
    await advance(starts[3]);
    expect(page()).toBe(3);
    const progress = drawn[drawn.length - 1].progress as { kind: string; line: unknown; page: unknown; signing: unknown };
    expect(progress.kind).toBe('touch');
    expect([progress.line, progress.page, progress.signing]).toEqual([0.5, 1, 0]);
    for (let k = 0; k < 3; k++) await advance(tourCycle(pages));
    expect(stub.timings.filter((t) => t.started && !t.stopped)).toHaveLength(0);
    expect(await unmountAndCount(r)).toBe(0);
  });

  it('a Ledger of unknown model: one page, no clock, no hint', async () => {
    const r = await mount('slab', LEDGER);
    await advance(30_000);
    expect(page()).toBe(0);
    expect(stub.timings).toHaveLength(0);
    expect(drawn[drawn.length - 1].progress).toBeUndefined();
    expect(r.toJSON()).toMatchObject({ type: 'View' });
    expect(await unmountAndCount(r)).toBe(0);
  });
});

describe('a guide whose frames change with the pass: the keypad comes in a new order each time (decided 2026-10-04)', () => {
  it('the touch PIN turn: seven frames a pass from the device off, the keypad reshuffled on the next pass, the hint on the new keys', async () => {
    const turn = deviceTurn('gen5', 'unlock', 'bitcoin')!;
    const hint = deviceHint('gen5')!;
    const script: LoopScript = {
      starts: turn.starts,
      cycle: turn.cycle,
      stillFrom: turn.stillFrom,
      pass: (n) => {
        const p = turn.pass(n);
        return { screens: p.screens, plan: planFromCues(hint, p.cues, p.words, null, turn.cycle) };
      },
    };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<DeviceLoop drawing="gen5" width={176} script={script} />);
    });
    const screen = () => drawn[drawn.length - 1].screen as { kind: string; entered?: number; pad?: string };
    // Off first (decided 2026-10-04: the side button turns it on), then the PIN page.
    expect(screen()).toEqual({ kind: 'blank' });
    await advance(turn.starts[1]);
    expect(screen()).toMatchObject({ kind: 'pin', entered: 0, pad: padDigits(0) });
    await advance(turn.starts[5] - turn.starts[1]);
    expect(screen()).toMatchObject({ kind: 'pin', entered: 4, pad: padDigits(0) });
    await advance(turn.starts[6] - turn.starts[5]);
    expect(screen()).toEqual({ kind: 'blank' });
    // The next pass: off again, then the keypad in another order.
    await advance(turn.cycle - turn.starts[6] + turn.starts[1]);
    expect(screen()).toMatchObject({ kind: 'pin', entered: 0, pad: padDigits(1) });
    expect(padDigits(1)).not.toBe(padDigits(0));
    // One clock per pass, started again with the new pass.
    expect(stub.timings).toHaveLength(2);
    expect(await unmountAndCount(r)).toBe(0);
  });
});

describe('the BitBox’s guide after it is plugged in (decided 2026-10-04): its frames, its own progress, another pair of characters on the next pass', () => {
  it('nine frames a pass on the turn’s clock, the drawing given the unlock progress, the next pass typing another pair', async () => {
    const turn = deviceTurn('nova', 'unlock', 'bitcoin')!;
    const hint = deviceHint('nova')!;
    const script: LoopScript = {
      starts: turn.starts,
      cycle: turn.cycle,
      stillFrom: turn.stillFrom,
      pass: (n) => {
        const p = turn.pass(n);
        return { screens: p.screens, plan: planFromCues(hint, p.cues, p.words, p.progress, turn.cycle) };
      },
    };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<DeviceLoop drawing="nova" width={176} script={script} />);
    });
    const last = () => drawn[drawn.length - 1];
    const screen = () => last().screen as { kind: string; last?: string };
    // The password, once the BitBox was found (its side is the search's page).
    expect(screen()).toMatchObject({ kind: 'nova-password', entered: 0 });
    expect((last().progress as { kind: string }).kind).toBe('nova-unlock');
    const firstPair = turn.pass(0).screens[4] as { last: string };
    await advance(turn.starts[4]);
    expect(screen()).toMatchObject({ kind: 'nova-password', last: firstPair.last });
    await advance(turn.starts[5] - turn.starts[4]);
    expect(screen()).toMatchObject({ kind: 'nova-confirm' });
    await advance(turn.starts[6] - turn.starts[5]);
    expect(screen()).toEqual({ kind: 'nova-lock' });
    await advance(turn.starts[8] - turn.starts[6]);
    expect(screen()).toEqual({ kind: 'blank' });
    // The next pass: the password again, another pair of characters.
    await advance(turn.cycle - turn.starts[8]);
    expect(screen()).toMatchObject({ kind: 'nova-password', entered: 0 });
    await advance(turn.starts[4]);
    const secondPair = turn.pass(1).screens[4] as { last: string };
    expect(screen()).toMatchObject({ kind: 'nova-password', last: secondPair.last });
    expect(secondPair.last).not.toBe(firstPair.last);
    // One clock per pass.
    expect(stub.timings).toHaveLength(2);
    expect(await unmountAndCount(r)).toBe(0);
  });
});

describe('registering the vault goes round (phone test videos, 2026-10-04): the pages, the device’s word, gone, the first page again', () => {
  const REG = registerFacts({ descriptor: MULTISIG_2_OF_3, label: 'Test 2/3 Oct', network: 'testnet' }, 'a1b2c3d4')!;

  it('on a Gen5: seven pages at their pace, "Account registered", blank, then round again on a new clock', async () => {
    const turn = deviceTurn('gen5', 'register', 'testnet', REG)!;
    const hint = deviceHint('gen5')!;
    const n = registerPages('gen5', REG).length;
    expect(n).toBe(7);
    const script: LoopScript = {
      starts: turn.starts,
      cycle: turn.cycle,
      stillFrom: turn.stillFrom,
      pass: (k) => {
        const p = turn.pass(k);
        return { screens: p.screens, plan: planFromCues(hint, p.cues, p.words, p.progress, turn.cycle) };
      },
    };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<DeviceLoop drawing="gen5" width={176} script={script} />);
    });
    const screen = () => drawn[drawn.length - 1].screen as { kind: string; index?: number; text?: string };
    expect(screen()).toMatchObject({ kind: 'review', index: 0 });
    for (let i = 1; i < n; i++) {
      await advance(turn.starts[i] - turn.starts[i - 1]);
      expect(screen()).toMatchObject({ kind: 'review', index: i });
    }
    await advance(turn.starts[n] - turn.starts[n - 1]);
    expect(screen()).toEqual({ kind: 'registered', text: 'Account registered' });
    await advance(turn.starts[n + 1] - turn.starts[n]);
    expect(screen()).toEqual({ kind: 'blank' });
    await advance(turn.cycle - turn.starts[n + 1]);
    expect(screen()).toMatchObject({ kind: 'review', index: 0 });
    expect(stub.timings).toHaveLength(2);
    expect(stub.timings.filter((t) => t.started && !t.stopped)).toHaveLength(1);
    expect(await unmountAndCount(r)).toBe(0);
  });

  it('on a Nova: the drawing gets the arrows’ progress on every page of the pass, the word after the last', async () => {
    const turn = deviceTurn('nova', 'register', 'testnet', REG)!;
    const hint = deviceHint('nova')!;
    const n = registerPages('nova', REG).length;
    const script: LoopScript = {
      starts: turn.starts,
      cycle: turn.cycle,
      stillFrom: turn.stillFrom,
      pass: (k) => {
        const p = turn.pass(k);
        return { screens: p.screens, plan: planFromCues(hint, p.cues, p.words, p.progress, turn.cycle) };
      },
    };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(<DeviceLoop drawing="nova" width={205} script={script} />);
    });
    const last = () => drawn[drawn.length - 1];
    expect((last().progress as { kind: string }).kind).toBe('nova');
    await advance(turn.starts[n - 1]);
    expect(last().screen).toMatchObject({ kind: 'review', index: n - 1 });
    await advance(turn.starts[n] - turn.starts[n - 1]);
    expect(last().screen).toEqual({ kind: 'registered', text: 'Multisig account registered' });
    expect(await unmountAndCount(r)).toBe(0);
  });
});

describe('Reduce Motion is asked once, and an answer after the turn closed sets nothing (decided 2026-10-04)', () => {
  /** Lets the ask's promise chain run (its catch, then its then). */
  const settle = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const pending = () => {
    let answer!: (v: boolean) => void;
    let fail!: (e: Error) => void;
    const promise = new Promise<boolean>((res, rej) => {
      answer = res;
      fail = rej;
    });
    return { promise, answer, fail };
  };

  it('cancelled before the answer: the answer is dropped', async () => {
    const q = pending();
    const set = jest.fn();
    const cancel = askOnce(() => q.promise, set);
    cancel();
    q.answer(true);
    await settle();
    expect(set).not.toHaveBeenCalled();
  });

  it('answered while live: handed over once; a failed ask answers false', async () => {
    const q = pending();
    const set = jest.fn();
    askOnce(() => q.promise, set);
    expect(set).not.toHaveBeenCalled();
    q.answer(true);
    await settle();
    expect(set.mock.calls).toEqual([[true]]);
    const bad = pending();
    const set2 = jest.fn();
    askOnce(() => bad.promise, set2);
    bad.fail(new Error('no answer'));
    await settle();
    expect(set2.mock.calls).toEqual([[false]]);
  });

  it('mounted: the tour unmounted before the phone answers draws nothing more', async () => {
    const q = pending();
    const { reactNative } = require('../../__tests__/rnStub');
    const ask = jest.spyOn(reactNative.AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => q.promise);
    const r = await mount('gen5', LEDGER);
    expect(ask).toHaveBeenCalledTimes(1);
    const before = drawn.length;
    expect(await unmountAndCount(r)).toBe(0);
    await act(async () => {
      q.answer(true);
      await settle();
    });
    expect(drawn.length).toBe(before);
    ask.mockRestore();
  });
});
