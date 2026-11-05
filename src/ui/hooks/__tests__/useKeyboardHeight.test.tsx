/**
 * The keyboard's height as the pinned footers and the sheets follow it,
 * mounted against a stand-in keyboard.
 *
 * Decided 2026-10-18: LayoutAnimation.configureNext applies to the next render
 * of the WHOLE app, whatever that render is. A will-event that sets the
 * height a view already has renders nothing, so the keyboard's animation
 * stayed pending and landed on the next, unrelated, render: the first digit,
 * the error line, the next step. A footer that mounts at the keyboard's
 * height (the co-signing request's authenticator step) gets exactly that
 * will-event when the next field takes focus, so the animation is configured
 * only for a height that changes.
 *
 * And while a step slides in, the keyboard waits (decided 2026-10-18, stepSlides.ts):
 * its animation caught the sliding authenticator step after a pasted code and
 * left it invisible. A change during a slide lands when the slide has, on what
 * is left of the keyboard's curve.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SLIDE_HOLD_CAP_MS, useKeyboardHeight } from '../useKeyboardHeight';
import { slideStarted, slidesRunning } from '../../components/stepSlides';

type Listener = (e?: unknown) => void;
const mockListeners: Record<string, Listener[]> = {};
const mockKeys = { visible: false, height: 0 };
const mockConfigureNext = jest.fn();

jest.mock('react-native', () => ({
  Keyboard: {
    addListener: (name: string, fn: Listener) => {
      (mockListeners[name] ??= []).push(fn);
      return {
        remove: () => {
          mockListeners[name] = mockListeners[name].filter((f) => f !== fn);
        },
      };
    },
    isVisible: () => mockKeys.visible,
    metrics: () =>
      mockKeys.visible ? { height: mockKeys.height, screenX: 0, screenY: 874 - mockKeys.height, width: 402 } : undefined,
  },
  LayoutAnimation: {
    configureNext: (config: unknown) => mockConfigureNext(config),
    Types: { keyboard: 'keyboard' },
  },
  Platform: { OS: 'ios' },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const KEYS = 308;
const event = (height: number, duration = 383) => ({ duration, endCoordinates: { height, screenY: 874 - height } });

/** Every height the probe rendered, in order. */
let seen: number[] = [];
function Probe(): null {
  seen.push(useKeyboardHeight());
  return null;
}

function mount(): TestRenderer.ReactTestRenderer {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<Probe />);
  });
  return r;
}

function emit(name: string, e?: unknown): void {
  act(() => {
    for (const fn of [...(mockListeners[name] ?? [])]) fn(e);
  });
}

const now = () => seen[seen.length - 1];

beforeEach(() => {
  seen = [];
  mockKeys.visible = false;
  mockKeys.height = 0;
  mockConfigureNext.mockClear();
  for (const k of Object.keys(mockListeners)) delete mockListeners[k];
});

it('rises and falls with the keys, on the keyboard’s own curve', () => {
  const r = mount();
  expect(now()).toBe(0);
  emit('keyboardWillShow', event(KEYS));
  expect(now()).toBe(KEYS);
  expect(mockConfigureNext).toHaveBeenCalledTimes(1);
  expect(mockConfigureNext).toHaveBeenLastCalledWith({ duration: 383, update: { type: 'keyboard' } });
  emit('keyboardWillHide', event(0, 250));
  expect(now()).toBe(0);
  expect(mockConfigureNext).toHaveBeenCalledTimes(2);
  expect(mockConfigureNext).toHaveBeenLastCalledWith({ duration: 250, update: { type: 'keyboard' } });
  act(() => r.unmount());
});

it('a view that mounts with the keys up starts above them, with no animation of its own', () => {
  mockKeys.visible = true;
  mockKeys.height = KEYS;
  const r = mount();
  expect(seen[0]).toBe(KEYS);
  expect(mockConfigureNext).not.toHaveBeenCalled();
  act(() => r.unmount());
});

it('a will-event at the height the view already has configures nothing (the next field taking focus)', () => {
  mockKeys.visible = true;
  mockKeys.height = KEYS;
  const r = mount();
  emit('keyboardWillShow', event(KEYS));
  expect(now()).toBe(KEYS);
  expect(mockConfigureNext).not.toHaveBeenCalled();
  act(() => r.unmount());
});

it('a hide while the keys are already down configures nothing either', () => {
  const r = mount();
  emit('keyboardWillHide', event(0));
  expect(now()).toBe(0);
  expect(mockConfigureNext).not.toHaveBeenCalled();
  act(() => r.unmount());
});

it('the did-events back the will-events up without an animation of their own', () => {
  const r = mount();
  emit('keyboardDidShow', event(KEYS));
  expect(now()).toBe(KEYS);
  emit('keyboardDidHide', event(0));
  expect(now()).toBe(0);
  expect(mockConfigureNext).not.toHaveBeenCalled();
  act(() => r.unmount());
});

it('a will-event that follows its own did-event (a view mounted between them) animates nothing', () => {
  const r = mount();
  emit('keyboardDidShow', event(KEYS));
  emit('keyboardWillShow', event(KEYS));
  expect(now()).toBe(KEYS);
  expect(mockConfigureNext).not.toHaveBeenCalled();
  act(() => r.unmount());
});

it('stops listening when it unmounts', () => {
  const r = mount();
  act(() => r.unmount());
  for (const name of ['keyboardWillShow', 'keyboardWillHide', 'keyboardDidShow', 'keyboardDidHide']) {
    expect({ name, left: mockListeners[name]?.length ?? 0 }).toEqual({ name, left: 0 });
  }
});

describe('while a step slides in', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    expect(slidesRunning()).toBe(false);
  });

  it('the paste path: the keys dip and come back during the slide, and nothing moves or animates', () => {
    mockKeys.visible = true;
    mockKeys.height = KEYS;
    const r = mount();
    const landed = slideStarted();
    emit('keyboardWillHide', event(0));
    emit('keyboardDidHide', event(0));
    emit('keyboardWillShow', event(KEYS));
    expect(now()).toBe(KEYS);
    expect(mockConfigureNext).not.toHaveBeenCalled();
    act(() => landed());
    expect(now()).toBe(KEYS);
    expect(mockConfigureNext).not.toHaveBeenCalled();
    expect(seen.every((h) => h === KEYS)).toBe(true);
    act(() => r.unmount());
  });

  it('a real change lands with the slide, on what is left of the keyboard’s curve', () => {
    const r = mount();
    const landed = slideStarted();
    emit('keyboardWillShow', event(KEYS, 383));
    expect(now()).toBe(0);
    act(() => {
      jest.advanceTimersByTime(150);
    });
    act(() => landed());
    expect(now()).toBe(KEYS);
    expect(mockConfigureNext).toHaveBeenCalledTimes(1);
    expect(mockConfigureNext).toHaveBeenLastCalledWith({ duration: 233, update: { type: 'keyboard' } });
    act(() => r.unmount());
  });

  it('a change whose keys have already stopped lands at once, with no animation', () => {
    const r = mount();
    const landed = slideStarted();
    emit('keyboardWillShow', event(KEYS, 250));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    act(() => landed());
    expect(now()).toBe(KEYS);
    expect(mockConfigureNext).not.toHaveBeenCalled();
    act(() => r.unmount());
  });

  it('the latest change wins', () => {
    const r = mount();
    const landed = slideStarted();
    emit('keyboardWillShow', event(KEYS));
    emit('keyboardWillHide', event(0));
    act(() => landed());
    expect(now()).toBe(0);
    expect(mockConfigureNext).not.toHaveBeenCalled();
    act(() => r.unmount());
  });

  it('a slide that never says it landed holds the keyboard no longer than the cap', () => {
    const r = mount();
    const landed = slideStarted();
    emit('keyboardDidShow', event(KEYS));
    expect(now()).toBe(0);
    act(() => {
      jest.advanceTimersByTime(SLIDE_HOLD_CAP_MS);
    });
    expect(now()).toBe(KEYS);
    act(() => landed());
    act(() => r.unmount());
  });

  it('a view that goes away while it waits is never set afterwards', () => {
    const r = mount();
    const landed = slideStarted();
    emit('keyboardWillShow', event(KEYS));
    const before = seen.length;
    act(() => r.unmount());
    act(() => landed());
    act(() => {
      jest.advanceTimersByTime(SLIDE_HOLD_CAP_MS);
    });
    expect(seen.length).toBe(before);
    expect(mockConfigureNext).not.toHaveBeenCalled();
  });

  it('after the slide the keyboard moves the view on its own curve again', () => {
    const r = mount();
    const landed = slideStarted();
    act(() => landed());
    emit('keyboardWillShow', event(KEYS));
    expect(now()).toBe(KEYS);
    expect(mockConfigureNext).toHaveBeenCalledTimes(1);
    act(() => r.unmount());
  });
});
