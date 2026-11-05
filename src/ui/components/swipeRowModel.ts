/**
 * The rules of a row that slides left to show its actions (decided
 * 2026-11-05 after a phone test: the address book's long press became a
 * swipe with Edit and Remove, as in Google's authenticator app). Pure, so
 * the feel is tested without a finger: `SwipeRow` draws it.
 *
 * A row may also take a FULL swipe (decided 2026-11-05 after a phone test):
 * dragged on past its actions to `fullSwipeAt`, its last action (Remove)
 * stretches across, and letting go there runs that action, which asks first.
 */

/** The width of one action behind a row. */
export const SWIPE_ACTION_W = 76;

/** The room between the row and its first action, and between two actions. */
export const SWIPE_GAP = 8;

/** How far the row moves to show `count` actions. */
export function swipeOpenWidth(count: number): number {
  return count * (SWIPE_ACTION_W + SWIPE_GAP);
}

/**
 * Whether a finger's move is the row's swipe rather than the page's scroll:
 * clearly sideways, past a small dead zone, so a scroll that drifts and a
 * tap that wobbles are left alone.
 */
export function isSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5;
}

/**
 * How far a row of `rowWidth` must be dragged for a full swipe: well past its
 * actions, and past most of its own width, so it never happens by accident.
 */
export function fullSwipeAt(rowWidth: number, openWidth: number): number {
  return Math.max(openWidth + 48, Math.round(rowWidth * 0.6));
}

/**
 * Where the row sits while it is dragged from `start` by `dx`: never right of
 * closed. Past fully open, a row without a full swipe (`fullAt` null) goes
 * only a quarter of the finger's way, so the end gives a little and springs
 * back; a row with one follows the finger, up to its own width.
 */
export function dragOffset(start: number, dx: number, openWidth: number, fullAt: number | null = null, rowWidth = 0): number {
  const x = start + dx;
  if (x > 0) return 0;
  if (x >= -openWidth) return x;
  if (fullAt == null) return -openWidth + (x + openWidth) / 4;
  return Math.max(x, -Math.max(rowWidth, fullAt));
}

/** Whether the row is dragged far enough that letting go runs the full swipe. */
export function pastFullSwipe(offset: number, fullAt: number | null): boolean {
  return fullAt != null && offset <= -fullAt;
}

/**
 * Whether a released row ends open (when it is not past a full swipe): a
 * quick flick decides by its direction, a slow release by whether the row is
 * past half its way.
 */
export function settlesOpen(offset: number, velocityX: number, openWidth: number): boolean {
  if (velocityX < -0.5) return true;
  if (velocityX > 0.5) return false;
  return offset < -openWidth / 2;
}
