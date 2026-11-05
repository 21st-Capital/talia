/**
 * SwipeRow under a finger (decided 2026-11-05 after a phone test): swiped
 * past half its actions it opens, swiped all the way its last action runs
 * (Remove, which asks first) and it closes, the hand feels the point where
 * letting go would remove, and a row without a full swipe never runs one.
 * The pan's own handlers are driven with the moves a finger makes.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const mockPan: { cfg: Record<string, (...a: unknown[]) => unknown> | null } = { cfg: null };
const mockTicks = { count: 0 };

jest.mock('react-native', () => {
  const stub = require('../../__tests__/rnStub').reactNative;
  class Value extends stub.Animated.Value {
    stopAnimation(): void {}
  }
  return {
    ...stub,
    Animated: { ...stub.Animated, Value },
    TouchableOpacity: 'TouchableOpacity',
    PanResponder: {
      create: (cfg: Record<string, (...a: unknown[]) => unknown>) => {
        mockPan.cfg = cfg;
        return { panHandlers: {} };
      },
    },
  };
});
jest.mock('../../theme', () => {
  const deep: object = new Proxy(function () {}, { get: () => deep });
  return { theme: deep, themedStyles: () => new Proxy({}, { get: () => ({}) }) };
});
jest.mock('../Gloss', () => ({ Gloss: () => null, cardGlow: () => 0.3 }));
jest.mock('../../../platform/haptics', () => ({ swipeTick: () => (mockTicks.count += 1) }));

import { SwipeRow } from '../SwipeRow';
import { fullSwipeAt, swipeOpenWidth } from '../swipeRowModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const ROW = 370;
const OPEN = swipeOpenWidth(2);
const FULL = fullSwipeAt(ROW, OPEN);

function mount(fullSwipe: boolean) {
  const calls = { edit: 0, remove: 0, opened: 0, closed: 0, started: 0, ended: 0 };
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(
      <SwipeRow
        open={false}
        onOpen={() => (calls.opened += 1)}
        onClose={() => (calls.closed += 1)}
        fullSwipe={fullSwipe}
        onSwipeStart={() => (calls.started += 1)}
        onSwipeEnd={() => (calls.ended += 1)}
        actions={[
          { label: 'Edit', icon: null, onPress: () => (calls.edit += 1) },
          { label: 'Remove', icon: null, destructive: true, onPress: () => (calls.remove += 1) },
        ]}>
        {null}
      </SwipeRow>,
    );
  });
  // The row measures itself, as on a phone.
  const clip = r.root.findAll((n) => (n.type as unknown) === 'View' && typeof n.props.onLayout === 'function')[0];
  act(() => clip.props.onLayout({ nativeEvent: { layout: { width: ROW, height: 80 } } }));
  return { r, calls };
}

/** A finger down, moved through `dxs`, then lifted with `vx`. */
function drag(dxs: number[], vx = 0): void {
  const cfg = mockPan.cfg!;
  act(() => {
    cfg.onPanResponderGrant({}, { dx: 0, dy: 0 });
    for (const dx of dxs) cfg.onPanResponderMove({}, { dx, dy: 0 });
    cfg.onPanResponderRelease({}, { dx: dxs[dxs.length - 1], dy: 0, vx });
  });
}

beforeEach(() => {
  mockTicks.count = 0;
});

it('a sideways move is claimed, a scroll is not', () => {
  mount(true);
  expect(mockPan.cfg!.onMoveShouldSetPanResponderCapture({}, { dx: -30, dy: 2 })).toBe(true);
  expect(mockPan.cfg!.onMoveShouldSetPanResponderCapture({}, { dx: -4, dy: 30 })).toBe(false);
});

it('swiped past half its actions, it opens; swiped back to the right, it closes', () => {
  const { calls } = mount(true);
  drag([-30, -OPEN / 2 - 10]);
  expect(calls).toMatchObject({ opened: 1, closed: 0, remove: 0, edit: 0 });
  drag([40, OPEN - 20]);
  expect(calls).toMatchObject({ opened: 1, closed: 1, remove: 0 });
});

it('swiped less than half its actions, it closes again', () => {
  const { calls } = mount(true);
  drag([-20, -OPEN / 2 + 10]);
  expect(calls).toMatchObject({ opened: 0, closed: 1 });
});

it('swiped all the way, its last action runs once and the row closes, with one tick where it crossed', () => {
  const { calls } = mount(true);
  drag([-60, -OPEN - 20, -FULL - 30]);
  expect(calls).toEqual({ edit: 0, remove: 1, opened: 0, closed: 1, started: 1, ended: 1 });
  expect(mockTicks.count).toBe(1);
});

it('dragged past and back again before letting go, it removes nothing and ticks twice', () => {
  const { calls } = mount(true);
  drag([-FULL - 30, -OPEN - 10]);
  expect(calls.remove).toBe(0);
  expect(calls.opened).toBe(1);
  expect(mockTicks.count).toBe(2);
});

it('a row without a full swipe never runs its action, however far it is dragged', () => {
  const { calls } = mount(false);
  drag([-ROW - 100]);
  expect(calls.remove).toBe(0);
  expect(calls.opened).toBe(1);
  expect(mockTicks.count).toBe(0);
});

it('tells the page when a swipe starts and when it ends, a swipe taken away included', () => {
  const { calls } = mount(true);
  act(() => {
    mockPan.cfg!.onPanResponderGrant({}, { dx: 0, dy: 0 });
  });
  expect(calls).toMatchObject({ started: 1, ended: 0 });
  act(() => {
    mockPan.cfg!.onPanResponderTerminate({}, { dx: -20, dy: 0 });
  });
  expect(calls).toMatchObject({ started: 1, ended: 1 });
  drag([-40]);
  expect(calls).toMatchObject({ started: 2, ended: 2 });
});
