/**
 * The step slides the keyboard waits for (decided 2026-10-18: the authenticator
 * step went invisible after a pasted code when the keyboard's animation
 * caught the step's slide; see stepSlides.ts).
 */
import { slideStarted, slidesRunning, whenSlidesLand } from '../stepSlides';

it('nothing waits when no step slides', () => {
  expect(slidesRunning()).toBe(false);
  const fn = jest.fn();
  whenSlidesLand(fn);
  expect(fn).toHaveBeenCalledTimes(1);
});

it('a change waits for the slide, and runs once it has landed', () => {
  const landed = slideStarted();
  expect(slidesRunning()).toBe(true);
  const fn = jest.fn();
  whenSlidesLand(fn);
  expect(fn).not.toHaveBeenCalled();
  landed();
  expect(slidesRunning()).toBe(false);
  expect(fn).toHaveBeenCalledTimes(1);
});

it('two slides at once (a step inside a step): the change waits for both', () => {
  const outer = slideStarted();
  const inner = slideStarted();
  const fn = jest.fn();
  whenSlidesLand(fn);
  outer();
  expect(fn).not.toHaveBeenCalled();
  expect(slidesRunning()).toBe(true);
  inner();
  expect(fn).toHaveBeenCalledTimes(1);
});

it('a slide that lands twice (stopped AND unmounted) counts once', () => {
  const first = slideStarted();
  const second = slideStarted();
  first();
  first();
  expect(slidesRunning()).toBe(true);
  second();
  expect(slidesRunning()).toBe(false);
});

it('the next step counted before the last one stops: nothing gets through in between', () => {
  const first = slideStarted();
  const fn = jest.fn();
  whenSlidesLand(fn);
  const next = slideStarted();
  first();
  expect(fn).not.toHaveBeenCalled();
  next();
  expect(fn).toHaveBeenCalledTimes(1);
});

it('a waiter that goes away is never run', () => {
  const landed = slideStarted();
  const fn = jest.fn();
  const cancel = whenSlidesLand(fn);
  cancel();
  landed();
  expect(fn).not.toHaveBeenCalled();
});

it('each waiter runs once, and a later slide starts with none', () => {
  const a = slideStarted();
  const fn = jest.fn();
  whenSlidesLand(fn);
  a();
  const b = slideStarted();
  b();
  expect(fn).toHaveBeenCalledTimes(1);
});
