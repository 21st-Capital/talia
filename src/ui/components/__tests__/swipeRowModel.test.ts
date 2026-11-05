/**
 * The swipe row's rules (decided 2026-11-05 after a phone test: Edit and
 * Remove behind a card swiped to the left, as in Google's authenticator app).
 */
import { dragOffset, fullSwipeAt, isSwipe, pastFullSwipe, settlesOpen, swipeOpenWidth, SWIPE_ACTION_W, SWIPE_GAP } from '../swipeRowModel';

const OPEN = swipeOpenWidth(2);

it('opens wide enough for its actions, each with its own room', () => {
  expect(OPEN).toBe(2 * (SWIPE_ACTION_W + SWIPE_GAP));
  expect(swipeOpenWidth(1)).toBe(SWIPE_ACTION_W + SWIPE_GAP);
});

it('a sideways move is a swipe; a scroll, a drift and a wobble are not', () => {
  expect(isSwipe(-30, 4)).toBe(true);
  expect(isSwipe(30, 4)).toBe(true);
  expect(isSwipe(-8, 0)).toBe(false); // the dead zone
  expect(isSwipe(-20, 18)).toBe(false); // a scroll that drifts
  expect(isSwipe(2, 40)).toBe(false);
});

it('drags with the finger, never right of closed, and gives only a little past open', () => {
  expect(dragOffset(0, -40, OPEN)).toBe(-40);
  expect(dragOffset(0, 60, OPEN)).toBe(0);
  expect(dragOffset(-OPEN, 30, OPEN)).toBe(-OPEN + 30);
  expect(dragOffset(0, -OPEN - 40, OPEN)).toBe(-OPEN - 10);
});

it('a flick decides by its direction, a slow release by the halfway point', () => {
  expect(settlesOpen(-10, -1, OPEN)).toBe(true);
  expect(settlesOpen(-OPEN, 1, OPEN)).toBe(false);
  expect(settlesOpen(-OPEN / 2 - 1, 0, OPEN)).toBe(true);
  expect(settlesOpen(-OPEN / 2 + 1, 0, OPEN)).toBe(false);
});

describe('the full swipe (decided 2026-11-05 after a phone test: dragged all the way, Remove asks)', () => {
  const ROW = 370;
  const FULL = fullSwipeAt(ROW, OPEN);

  it('lies well past the actions and past most of the row', () => {
    expect(FULL).toBeGreaterThanOrEqual(OPEN + 48);
    expect(FULL).toBeGreaterThanOrEqual(ROW * 0.6 - 1);
    expect(fullSwipeAt(200, OPEN)).toBe(OPEN + 48);
  });

  it('a row that takes one follows the finger past its actions, up to its own width', () => {
    expect(dragOffset(0, -FULL - 20, OPEN, FULL, ROW)).toBe(-FULL - 20);
    expect(dragOffset(0, -ROW - 80, OPEN, FULL, ROW)).toBe(-ROW);
    expect(dragOffset(0, -40, OPEN, FULL, ROW)).toBe(-40);
    expect(dragOffset(0, 40, OPEN, FULL, ROW)).toBe(0);
  });

  it('runs only once the row is dragged that far, never for a row without one', () => {
    expect(pastFullSwipe(-FULL, FULL)).toBe(true);
    expect(pastFullSwipe(-FULL + 1, FULL)).toBe(false);
    expect(pastFullSwipe(-ROW, null)).toBe(false);
  });
});
