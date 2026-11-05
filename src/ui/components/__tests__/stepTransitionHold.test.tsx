/**
 * A step's slide holds the keyboard until it has landed (decided 2026-10-18: the
 * keyboard's animation caught the sliding authenticator step after a pasted
 * code and left it invisible; see stepSlides.ts). Mounted on the stub: the
 * slide is counted as it starts, stays counted until React's copy of the
 * step has caught up after its end, and never outlives the step.
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { resetStub, stub } from '../../__tests__/rnStub';
import { SLIDE_SETTLE_MS, StepTransition } from '../StepTransition';
import { slidesRunning } from '../stepSlides';

jest.mock('react-native', () => require('../../__tests__/rnStub').reactNative);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quiet = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
  if (!String(args[0]).includes('react-test-renderer is deprecated')) process.stderr.write(`${args.map(String).join(' ')}\n`);
});
afterAll(() => quiet.mockRestore());

const ORDER = ['email', 'totp', 'done'] as const;
const page = (step: string) => (
  <StepTransition stepKey={step} order={ORDER}>
    <Text>{step}</Text>
  </StepTransition>
);

function mount(step: string): TestRenderer.ReactTestRenderer {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(page(step));
  });
  return r;
}
const show = (r: TestRenderer.ReactTestRenderer, step: string) => act(() => r.update(page(step)));
const end = (i: number, finished = true) => act(() => stub.parallelEnds[i]({ finished }));
const wait = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  resetStub();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

it('a fresh mount slides nothing and holds nothing', () => {
  const r = mount('email');
  expect(slidesRunning()).toBe(false);
  act(() => r.unmount());
});

it('the next step holds the keyboard until its slide has landed and React has caught up', () => {
  const r = mount('email');
  show(r, 'totp');
  expect(slidesRunning()).toBe(true);
  expect(stub.parallelEnds).toHaveLength(1);
  end(0);
  // The slide is over on the screen, React's copy one update later.
  expect(slidesRunning()).toBe(true);
  wait(SLIDE_SETTLE_MS - 1);
  expect(slidesRunning()).toBe(true);
  wait(1);
  expect(slidesRunning()).toBe(false);
  act(() => r.unmount());
});

it('a step that follows mid-slide: the first one’s stop lets nothing through, the second one’s landing does', () => {
  const r = mount('email');
  show(r, 'totp');
  show(r, 'done');
  expect(stub.parallelEnds).toHaveLength(2);
  end(0, false);
  wait(SLIDE_SETTLE_MS);
  expect(slidesRunning()).toBe(true);
  end(1);
  wait(SLIDE_SETTLE_MS);
  expect(slidesRunning()).toBe(false);
  act(() => r.unmount());
});

it('a step that goes away mid-slide holds nothing, and its late end counts nothing twice', () => {
  const r = mount('email');
  show(r, 'totp');
  act(() => r.unmount());
  expect(slidesRunning()).toBe(false);
  const other = mount('email');
  show(other, 'totp');
  end(0);
  wait(SLIDE_SETTLE_MS);
  expect(slidesRunning()).toBe(true);
  end(1);
  wait(SLIDE_SETTLE_MS);
  expect(slidesRunning()).toBe(false);
  act(() => other.unmount());
});
