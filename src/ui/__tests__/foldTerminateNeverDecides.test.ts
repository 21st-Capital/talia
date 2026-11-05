/**
 * The docked vault graph folds on a drag, its height NEVER GOES BELOW
 * ZERO, and EVERY HEIGHT IT SHOWS IS A PROP REACT COMMITTED (decided
 * 2026-09-26).
 *
 * It used to fold on `Animated.spring` driving the body's height, and on a
 * hard downward throw the whole drawing flashed back for a frame or more
 * after the fold had settled (three phone recordings; then, with the
 * animation deleted: "without the animation, the problem is gone"). The
 * mechanism, caught on the simulator with a probe of every value the
 * animation wrote: a spring with any bounce overshoots its target, the
 * target was 0, and for its last frames it wrote a height a fraction of a
 * point below zero. To Yoga a negative height is not a height at all
 * (`Node::hasDefiniteLength` wants `>= 0`), so the body laid out at its
 * natural height, the whole drawing, until the spring's final write of
 * exactly 0. A throw hands the spring more energy, so its overshoot lasts
 * long enough to be seen. Measured off recordings frame by frame: one
 * frame at the open height with that spring (fifteen in one run), none
 * with the fold on plain state.
 *
 * So the rules this file pins: the fold follows the finger and finishes
 * by a clock, both write a plain number into state through ONE function,
 * and that function clamps at zero. Nothing in the file is `Animated`, a
 * `LayoutAnimation` or a `setNativeProps`, so there is no second copy of
 * the height to disagree with the one React committed, and no curve to
 * overshoot. A terminated gesture may not decide anything either: it only
 * slides the body back to the committed side (the older rule, kept: a
 * terminate that ran the release's decision sprang an open card to full
 * height).
 *
 * A synthetic swipe never terminates, and a source read is the guard a
 * test can give, in the same spirit as the repo's other source-level rules.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'components', 'VaultGraph.tsx');

/** The source without its comments, so the rules read the code alone. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The body of a handler named `name`, braces balanced. */
function handlerBody(source: string, name: string): string {
  const at = source.indexOf(name);
  expect(at).toBeGreaterThan(-1);
  const open = source.indexOf('{', source.indexOf('=>', at));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced ${name} body`);
}

describe('the fold gesture', () => {
  const source = readFileSync(SRC, 'utf8');
  const plain = code(source);
  const hook = plain.slice(plain.indexOf('function useFold('), plain.indexOf('\nconst SHUT_STYLE'));

  it('🔴 puts nothing on screen that React did not commit', () => {
    // No animated node, no native layout animation, no native prop write:
    // each of these is a height React's copy of the view does not carry,
    // and the next unrelated commit puts React's copy back.
    expect(plain).not.toMatch(/\bAnimated\b/);
    expect(plain).not.toMatch(/LayoutAnimation/);
    expect(plain).not.toMatch(/setNativeProps/);
    expect(plain).not.toMatch(/useNativeDriver/);
  });

  it('drives the height from state alone', () => {
    // The moving height is state, the rest is a plain object or nothing.
    expect(hook).toMatch(/const \[moving, setMoving\] = useState<number \| null>\(null\);/);
    expect(hook).toMatch(
      /bodyStyle:\s*moving !== null \? \{ height: moving, overflow: 'hidden' as const \} : shut \? SHUT_STYLE : undefined/,
    );
    // The finger and the clock both go through `place`, which sets state.
    expect(handlerBody(hook, 'onPanResponderMove')).toMatch(/place\(/);
    expect(hook).toMatch(/requestAnimationFrame\(tick\)/);
    expect(hook.split('setMoving(').length).toBe(2);
  });

  it('🔴 never writes a height below zero', () => {
    // The one write clamps at zero: to Yoga a negative height is no height,
    // and the body then lays out at its natural height, which is the flash.
    expect(hook).toMatch(
      /const place = useCallback\(\(h: number \| null\) => \{\s*const kept = h === null \? null : Math\.max\(0, h\);\s*movingRef\.current = kept;\s*setMoving\(kept\);/,
    );
    // And no spring to overshoot in the first place: the slide is an
    // ease-out that runs from where the body stands to its end.
    expect(plain).not.toMatch(/spring|bounciness/i);
    expect(hook).toMatch(/place\(from \+ span \* \(1 - \(1 - p\) \*\* 3\)\);/);
  });

  it('stops the clock on a new touch and on unmount', () => {
    expect(handlerBody(hook, 'onPanResponderGrant')).toMatch(/stopClock\(\)/);
    expect(hook).toMatch(/useEffect\(\(\) => stopClock, \[stopClock\]\);/);
  });

  it('never decides an end from a terminate', () => {
    const body = handlerBody(hook, 'onPanResponderTerminate');
    // `set` is the one place a gesture may commit a side.
    expect(body).not.toMatch(/\bset\s*\(/);
    expect(body).not.toMatch(/\btoggle\s*\(/);
    expect(body).not.toMatch(/shutRef\.current\s*=/);
    expect(body).not.toMatch(/lastShut\s*=/);
    // All it may do is slide back to the side that is committed.
    expect(body).toMatch(/slide\(shutRef\.current \? 0 : bodyH\.current\)/);
  });

  it('cannot act on a gesture that already ended', () => {
    expect(handlerBody(hook, 'onPanResponderTerminate')).toMatch(/if \(decided\.current\) return;/);
    expect(handlerBody(hook, 'onPanResponderRelease')).toMatch(/if \(decided\.current\) return;/);
  });

  it('sets the committed side in ONE place', () => {
    const at = hook.indexOf('const set = useCallback');
    expect(at).toBeGreaterThan(-1);
    const body = hook.slice(at, at + 400);
    expect(body).toMatch(/shutRef\.current = nextShut;/);
    expect(body).toMatch(/lastShut = nextShut;/);
    expect(body).toMatch(/setShutState\(nextShut\);/);
    // And nowhere else.
    expect(hook.split('setShutState(').length).toBe(2);
  });

  it('hands the drawing to the fold as a finished element', () => {
    // The fold renders once per frame while it moves; the drawing must not
    // render with it. Built by VaultGraph, passed down, skipped by React.
    expect(plain).toMatch(/<Fold heading=\{heading\}>\{drawing\}<\/Fold>/);
    const fold = plain.slice(plain.indexOf('function Fold('), plain.indexOf('function useFold('));
    expect(fold).toMatch(/<View onLayout=\{fold\.measure\}>\{children\}<\/View>/);
  });

  it('keeps the fold to ITSELF: no prop may say whether it is folded', () => {
    // One source of truth cannot disagree with itself. The screen says only
    // whether folding is allowed at all.
    const props = source.slice(
      source.indexOf('export function VaultGraph('),
      source.indexOf('): React.JSX.Element | null {'),
    );
    expect(props).toMatch(/foldable\?: boolean;/);
    expect(props).not.toMatch(/collapsed|onToggleCollapsed/);
  });
});
