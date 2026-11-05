/**
 * A small stand-in for react-native and react-native-svg, for the few tests
 * that mount a component in Jest's plain Node environment (the repo runs no
 * React Native preset, see jest.config.js). Host components are plain names,
 * so react-test-renderer prints them; Animated keeps a record of every
 * animation started and stopped, so a test can see the clock run.
 *
 *   jest.mock('react-native', () => require('<path>/rnStub').reactNative);
 *   jest.mock('react-native-svg', () => require('<path>/rnStub').svg);
 */

/** What the stub has seen, cleared by `resetStub`. */
export const stub = {
  reduceMotion: false,
  timings: [] as { config: Record<string, unknown>; started: boolean; stopped: boolean }[],
  setValues: [] as number[],
  interpolations: 0,
  /** The end callbacks handed to `Animated.parallel(...).start`, for a test to finish a slide. */
  parallelEnds: [] as ((result: { finished: boolean }) => void)[],
};

export function resetStub(): void {
  stub.reduceMotion = false;
  stub.timings = [];
  stub.setValues = [];
  stub.interpolations = 0;
  stub.parallelEnds = [];
}

class Interpolation {
  constructor(readonly config: { inputRange: number[]; outputRange: (number | string)[] }) {
    stub.interpolations += 1;
  }
  interpolate(config: { inputRange: number[]; outputRange: (number | string)[] }): Interpolation {
    return new Interpolation(config);
  }
}

class Value {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  setValue(v: number): void {
    this.value = v;
    stub.setValues.push(v);
  }
  interpolate(config: { inputRange: number[]; outputRange: (number | string)[] }): Interpolation {
    return new Interpolation(config);
  }
}

function timing(_value: Value, config: Record<string, unknown>) {
  const record = { config, started: false, stopped: false };
  stub.timings.push(record);
  return {
    start: () => {
      record.started = true;
    },
    stop: () => {
      record.stopped = true;
    },
  };
}

const identity = (x: number) => x;

export const reactNative = {
  View: 'View',
  Text: 'Text',
  Animated: {
    Value,
    View: 'Animated.View',
    timing,
    loop: (a: { start: () => void; stop: () => void }) => a,
    sequence: (list: { start: () => void; stop: () => void }[]) => ({
      start: () => list.forEach((x) => x.start()),
      stop: () => list.forEach((x) => x.stop()),
    }),
    parallel: (list: { start: () => void; stop: () => void }[]) => ({
      start: (end?: (result: { finished: boolean }) => void) => {
        list.forEach((x) => x.start());
        if (end) stub.parallelEnds.push(end);
      },
      stop: () => list.forEach((x) => x.stop()),
    }),
    delay: () => ({ start: () => undefined, stop: () => undefined }),
  },
  Easing: { linear: identity, quad: identity, out: () => identity, in: () => identity, inOut: () => identity },
  StyleSheet: {
    create: <T>(s: T): T => s,
    absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    hairlineWidth: 1,
  },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(stub.reduceMotion),
    announceForAccessibility: () => undefined,
  },
  useWindowDimensions: () => ({ width: 402, height: 874, scale: 3, fontScale: 1 }),
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
};

export const svg = {
  __esModule: true,
  default: 'Svg',
  Svg: 'Svg',
  Path: 'Path',
  Circle: 'Circle',
  Rect: 'Rect',
  Defs: 'Defs',
  G: 'G',
  LinearGradient: 'LinearGradient',
  Stop: 'Stop',
};
