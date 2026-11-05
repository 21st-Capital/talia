/**
 * Everything the "Vault built" page decides that needs no React Native (decided
 * 2026-10-02: design B "Keys into the lock", at pace B2: "B2 is perfect").
 * `VaultBuiltMark` draws the lock and `VaultBuiltPage` lays the page out;
 * this file holds the timeline they run on, the lock's geometry and every
 * word they show, so each case is pinned by a test
 * (`__tests__/vaultBuiltModel.test.ts`).
 *
 * The moment: a pen sketches the lock's disc and inks it, the keyhole draws,
 * the vault's keys appear named in a row (the client's first, 21st Capital's
 * last), and one by one each travels into the keyhole while the lock turns a
 * 40 degree notch for it. The green ring inks over the last 300 ms and
 * completes WITH the final click (the haptic), then "Vault built", the
 * vault's name as the hero, the shape line, the Keys card, the sub line and
 * the button. One dashed ring around the lock per recovery path.
 *
 * Every sentence holds for every vault the two builders make (decided 2026-09-22,
 * "a sentence that holds true in any scenario"): one key, k of n with or
 * without our co-signer, with or without heirs and the rescue key, and the
 * custom builder's own recovery layers. Keys are named as the builder named
 * them (`keyDisplayName`), ours by their role as the summary drew them
 * ("21st Capital", "Rescue Key"), and an heir as a PERSON (`heirTitle`),
 * never by the label of the key they hold.
 */
import { parseKeyOrigins, parsePolicy, pathRequirement, primaryPath, stripChecksum } from '../../bitcoin/descriptor';
import type { KeyOrigin, PolicyPath } from '../../bitcoin/descriptor';
import { heirTitle } from '../../wallet/heirNames';
import type { VaultHeir } from '../../wallet/planHeirs';
import { keyDisplayName } from '../../wallet/keyNames';
import { ownKeysFirst } from '../../wallet/keyOrder';
import { formatWaitMonths } from '../../wallet/timelock';
import { INK_BOX, inOutCubic, MIN_INK_BOX, outCubic, PEN, penEaseAt } from './sentPageModel';
import type { PageTimeline, SentRow, Track } from './sentPageModel';
import { COSIGNER_LABEL, RESCUE_LABEL } from './vaultGraphRows';

// ------------------------------------------------------------------ the vault

/** The vault as the builder saved it: what the page reads, and nothing else. */
export interface BuiltVault {
  label: string;
  descriptor: string;
  /** The builder's names for the keys, by lower-case fingerprint. */
  keyLabels?: Readonly<Record<string, string>>;
  /** The heirs, in the builder's order (Heir 1 first). */
  heirs?: ReadonlyArray<VaultHeir>;
  /** 21st Capital's keys in the vault, as the builder tagged them. */
  providerKeyFingerprints?: readonly string[];
}

/** One key of the vault, as the page shows it. */
export interface BuiltKey {
  /** Lower-case master fingerprint, or the key itself when it has none. */
  id: string;
  /** Upper-case master fingerprint for the card; '' when the key has none. */
  fingerprint: string;
  /** What the page calls it. */
  name: string;
  /** One of 21st Capital's keys. */
  ours: boolean;
  /** Blocks its path waits; absent on the everyday path (or a wait not in blocks). */
  waitBlocks?: number;
}

export interface VaultBuiltFacts {
  /** The vault's name: the hero. */
  name: string;
  /**
   * The everyday path's keys, the client's first and ours last: the row of
   * keys that travels into the lock, one notch each.
   */
  everyday: BuiltKey[];
  /** Signatures the everyday path needs; null when the policy is not read exactly. */
  needed: number | null;
  /** How many recovery paths the vault has: one dashed ring each. */
  recoveryPaths: number;
  /**
   * The Keys card: every key once, the everyday path first (the client's,
   * then ours), then each recovery path's keys by ascending wait, ours last
   * within a wait.
   */
  keys: BuiltKey[];
}

const lower = (s: string | undefined | null): string => (s ?? '').trim().toLowerCase();
const timelocked = (p: PolicyPath): boolean => p.olderBlocks !== undefined || p.afterHeight !== undefined;

function dedupe<T>(items: readonly T[], id: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of items) {
    const k = id(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** The descriptor's policy, or null when it cannot be read EXACTLY. */
function exactPolicy(descriptor: string): ReturnType<typeof parsePolicy> | null {
  try {
    const policy = parsePolicy(descriptor);
    return policy.exact && policy.paths.length > 0 ? policy : null;
  } catch {
    return null;
  }
}

/**
 * What the page says about the vault, read off its descriptor (the policy
 * the builder composed), never off the builder's own state: a word the
 * descriptor does not back is never said.
 */
export function vaultBuiltFacts(v: BuiltVault): VaultBuiltFacts {
  const ours = new Set((v.providerKeyFingerprints ?? []).map(lower));
  const heirs = v.heirs ?? [];
  const idOf = (k: KeyOrigin): string => lower(k.fingerprint) || k.xpub;
  const isOurs = (k: KeyOrigin): boolean => ours.has(lower(k.fingerprint));
  const heirOf = (k: KeyOrigin): number => {
    const fp = lower(k.fingerprint);
    return fp ? heirs.findIndex((h) => lower(h.fingerprint) === fp) : -1;
  };

  // The structure: the everyday path, its threshold, the recovery paths by
  // ascending wait (a wait not in blocks, an absolute lock, last). A policy
  // that cannot be read exactly claims none: every key, no threshold, no
  // paths.
  const policy = exactPolicy(v.descriptor);
  let primaryKeys: KeyOrigin[];
  let needed: number | null;
  let recoveries: PolicyPath[];
  if (policy) {
    const primary = primaryPath(policy)!;
    ({ needed, keys: primaryKeys } = pathRequirement(primary));
    recoveries = policy.paths
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p !== primary && timelocked(p))
      .sort((a, b) => (a.p.olderBlocks ?? Infinity) - (b.p.olderBlocks ?? Infinity) || a.i - b.i)
      .map(({ p }) => p);
  } else {
    let all: KeyOrigin[] = [];
    try {
      all = parseKeyOrigins(stripChecksum(v.descriptor).body);
    } catch {
      all = [];
    }
    primaryKeys = all;
    needed = null;
    recoveries = [];
  }

  // The client's own keys in the order they are listed: the number for the
  // one key no builder leaves unnamed in practice (a lone key with no label).
  const own = dedupe(
    [...primaryKeys, ...recoveries.flatMap((p) => pathRequirement(p).keys)].filter(
      (k) => !isOurs(k) && heirOf(k) < 0,
    ),
    idOf,
  );
  const nameOf = (k: KeyOrigin, recovery: boolean): string => {
    if (isOurs(k)) return recovery ? RESCUE_LABEL : COSIGNER_LABEL;
    const h = heirOf(k);
    if (h >= 0) return heirTitle(heirs[h], h);
    const named = keyDisplayName(v, k.fingerprint, ours);
    if (named) return named;
    return own.length > 1 ? `Your key ${own.findIndex((o) => idOf(o) === idOf(k)) + 1}` : 'Your key';
  };
  const builtKey = (k: KeyOrigin, waitBlocks: number | undefined, recovery: boolean): BuiltKey => ({
    id: idOf(k),
    fingerprint: (k.fingerprint ?? '').toUpperCase(),
    name: nameOf(k, recovery),
    ours: isOurs(k),
    ...(waitBlocks !== undefined ? { waitBlocks } : {}),
  });

  const everyday = ownKeysFirst(dedupe(primaryKeys, idOf), isOurs).map((k) => builtKey(k, undefined, false));
  const listed = new Set(everyday.map((k) => k.id));
  const later: BuiltKey[] = [];
  for (const p of recoveries) {
    for (const k of ownKeysFirst(pathRequirement(p).keys, isOurs)) {
      if (listed.has(idOf(k))) continue;
      listed.add(idOf(k));
      later.push(builtKey(k, p.olderBlocks, true));
    }
  }
  return { name: v.label, everyday, needed, recoveryPaths: recoveries.length, keys: [...everyday, ...later] };
}

// ------------------------------------------------------------------ the words

export const VAULT_BUILT_TITLE = 'Vault built';

/**
 * What the button does next, the builders' own next step: a vault that some
 * device must be shown first is registered ('register'); anything else opens
 * the vault ('open'). The screen decides it with the vault page's own rule
 * (`registrationWalk`), so the page never says "register" to a vault whose
 * keys need no registration.
 */
export type VaultBuiltNext = 'register' | 'open';

export interface VaultBuiltWords {
  title: string;
  sub: string;
  action: string;
}

export function vaultBuiltWords(next: VaultBuiltNext): VaultBuiltWords {
  return next === 'register'
    ? {
        title: VAULT_BUILT_TITLE,
        sub: 'Next, register it on your hardware so it can sign.',
        action: 'Register on hardware',
      }
    : { title: VAULT_BUILT_TITLE, sub: 'Your vault is ready to receive.', action: 'Open the vault' };
}

/**
 * The line under the name: "1 key", "2 of 3 keys", "2 of 3 keys · 3
 * recovery paths". With a policy that is not read exactly it says only how
 * many keys there are.
 */
export function vaultBuiltLine(f: VaultBuiltFacts): string {
  const n = f.everyday.length;
  const keys =
    f.needed == null
      ? `${n} key${n === 1 ? '' : 's'}`
      : n === 1 && f.needed === 1
        ? '1 key'
        : `${f.needed} of ${n} keys`;
  const p = f.recoveryPaths;
  return p === 0 ? keys : `${keys} · ${p} recovery path${p === 1 ? '' : 's'}`;
}

/** The Keys card's rows: the key's name (and when a recovery key's path opens), its fingerprint. */
export function vaultBuiltRows(f: VaultBuiltFacts): SentRow[] {
  return f.keys.map((k) => ({
    label: k.waitBlocks !== undefined ? `${k.name} · after ${formatWaitMonths(k.waitBlocks)}` : k.name,
    value: k.fingerprint,
    mono: true,
  }));
}

/** What VoiceOver hears once the page has settled: the title and the vault's name. */
export const vaultBuiltAnnouncement = (f: VaultBuiltFacts): string => `${VAULT_BUILT_TITLE}. ${f.name}`;

// ------------------------------------------------------------------ the clock

/**
 * THE pace (B2, decided 2026-10-02): `travel` is one key's flight into the
 * keyhole, `notch` the lock's turn for it, `beat` the time from one key's
 * arrival to the next. One constant: change the pace here and nowhere else.
 */
export const VAULT_BUILT_PACE = { travel: 640, notch: 360, beat: 500 } as const;
export type VaultBuiltPace = { travel: number; notch: number; beat: number };

/** The lock's turn per key, in degrees. */
export const NOTCH_DEG = 40;
/** The first key leaves its row once the disc is inked (800) and the keyhole is being drawn. */
export const KEYS_FROM = 820;
/** The notch begins as the key enters the keyhole: the last fifth of its flight. */
const NOTCH_LEAD = 0.2;
/** The design's key count; more keys share its span so the page never drags. */
const DESIGN_KEYS = 3;

/**
 * The pace for `n` keys: the design's up to three keys. A vault with more
 * (the custom builder's k of n) runs the same pace faster, all three numbers
 * scaled alike so its keys fit the three-key span: the ratios hold, so each
 * key is in the keyhole before its notch ends and one notch always ends
 * before the next begins.
 */
export function vaultBuiltPace(n: number): VaultBuiltPace {
  if (n <= DESIGN_KEYS) return { ...VAULT_BUILT_PACE };
  const k = (DESIGN_KEYS - 1) / (n - 1);
  return {
    travel: VAULT_BUILT_PACE.travel * k,
    notch: VAULT_BUILT_PACE.notch * k,
    beat: VAULT_BUILT_PACE.beat * k,
  };
}

export interface KeyFlight {
  /** It leaves its place in the row. */
  start: number;
  /** It is in the keyhole. */
  arrive: number;
  /** The lock's notch for it. */
  turnFrom: number;
  turnTo: number;
}

export interface VaultBuiltPlan {
  keys: KeyFlight[];
  /** The final click: the last notch comes to rest. */
  clickEnd: number;
  /** The travel track's length: KEYS_FROM to the click. */
  span: number;
}

export function vaultBuiltPlan(count: number): VaultBuiltPlan {
  const n = Math.max(1, count);
  const { travel, notch, beat } = vaultBuiltPace(n);
  const keys = Array.from({ length: n }, (_, i) => {
    const start = KEYS_FROM + i * beat;
    const arrive = start + travel;
    const turnFrom = arrive - NOTCH_LEAD * travel;
    return { start, arrive, turnFrom, turnTo: turnFrom + notch };
  });
  const clickEnd = keys[n - 1].turnTo;
  return { keys, clickEnd, span: clickEnd - KEYS_FROM };
}

export type VaultBuiltTrackKey =
  | 'penIn'
  | 'pen'
  | 'penOut'
  | 'keyhole'
  | 'rings'
  | 'appear'
  | 'travel'
  | 'green'
  | 'text1'
  | 'text2';
export const VAULT_BUILT_TRACK_KEYS: readonly VaultBuiltTrackKey[] = [
  'penIn',
  'pen',
  'penOut',
  'keyhole',
  'rings',
  'appear',
  'travel',
  'green',
  'text1',
  'text2',
];

const linear = (t: number): number => t;
/** The lock's pen: sketch 350, ink 300 (the Sent pen's curve at its own split). */
const LOCK_PEN_SKETCH = 350;
const LOCK_PEN_MS = 650;
export const lockPenEase = penEaseAt(LOCK_PEN_SKETCH / LOCK_PEN_MS);
/** The green ring inks over the last notch and completes with the click. */
export const GREEN_MS = 300;

/**
 * Design B's timeline (tracksB at pace B2), on the page's clock, which starts
 * once the page has arrived. Live: the pen sketches and inks the disc, the
 * keyhole draws, the keys appear named in their row and travel in one by one
 * (`travel`, one linear track the flights and the notches are read off), the
 * green ring completes with the final click (the haptic), the title and name
 * rise, then the card and the button, live 450 ms after the click. Three
 * keys: click 2692, live 3142; one key: click 1692, live 2142. Reduce
 * Motion: the lock and the green ring inked in 350 ms, no key flies, the
 * words already there, the haptic and the button live at 350.
 */
export function vaultBuiltTimeline(reduce: boolean, keyCount: number): PageTimeline<VaultBuiltTrackKey> {
  if (reduce) {
    return {
      tracks: {
        pen: { start: 0, end: 350, easing: (t) => 0.5 + 0.5 * outCubic(t) },
        keyhole: { start: 0, end: 350, easing: outCubic },
        rings: { start: 0, end: 350, easing: outCubic },
        appear: { start: 0, end: 1 },
        green: { start: 100, end: 350, easing: outCubic },
        text1: { start: 0, end: 1 },
        text2: { start: 0, end: 1 },
      },
      tickAt: 350,
      doneAt: 350,
    };
  }
  const { clickEnd } = vaultBuiltPlan(keyCount);
  const tracks: Record<VaultBuiltTrackKey, Track> = {
    penIn: { start: 0, end: 150, easing: outCubic },
    pen: { start: 150, end: 150 + LOCK_PEN_MS, easing: lockPenEase },
    penOut: { start: 800, end: 950, easing: outCubic },
    keyhole: { start: 650, end: 850, easing: outCubic },
    rings: { start: 650, end: 900, easing: outCubic },
    appear: { start: 300, end: 600, easing: outCubic },
    travel: { start: KEYS_FROM, end: clickEnd, easing: linear },
    green: { start: clickEnd - GREEN_MS, end: clickEnd, easing: outCubic },
    text1: { start: clickEnd, end: clickEnd + 300, easing: outCubic },
    text2: { start: clickEnd + 150, end: clickEnd + 450, easing: outCubic },
  };
  return { tracks, tickAt: clickEnd, doneAt: clickEnd + 450 };
}

/** Where `ms` falls on the travel track, 0 -> 1. */
const onTravel = (plan: VaultBuiltPlan, ms: number): number => (ms - KEYS_FROM) / plan.span;

/** An interpolation table: input and output ranges for Animated's `interpolate`. */
export interface Table {
  inputRange: number[];
  outputRange: number[];
}

/**
 * The lock's turn, read off the travel track: still until a key enters the
 * keyhole, then one 40 degree notch eased in and out, then still again;
 * `n` notches in all. Strictly increasing inputs, so the native driver never
 * divides by a zero-length step.
 */
export function lockTurnTable(keyCount: number): Table {
  const plan = vaultBuiltPlan(keyCount);
  const inputRange: number[] = [0];
  const outputRange: number[] = [0];
  const STEPS = 8;
  plan.keys.forEach((k, i) => {
    const a = onTravel(plan, k.turnFrom);
    const b = onTravel(plan, k.turnTo);
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      const x = a + (b - a) * t;
      if (x <= inputRange[inputRange.length - 1]) continue;
      inputRange.push(x);
      outputRange.push((i + inOutCubic(t)) * NOTCH_DEG);
    }
  });
  if (inputRange[inputRange.length - 1] < 1) {
    inputRange.push(1);
    outputRange.push(plan.keys.length * NOTCH_DEG);
  }
  return { inputRange, outputRange };
}

/** Key `i`'s flight on the travel track: [leaves, arrives], 0 -> 1. */
export function keyFlightWindow(keyCount: number, i: number): [number, number] {
  const plan = vaultBuiltPlan(keyCount);
  const k = plan.keys[i];
  return [onTravel(plan, k.start), onTravel(plan, k.arrive)];
}

/** An eased stretch of a linear track: `[from, to]` mapped through `fn` onto `out`. */
export function easedTable(
  from: number,
  to: number,
  fn: (t: number) => number = inOutCubic,
  out: [number, number] = [0, 1],
  steps = 10,
): Table {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    inputRange.push(from + (to - from) * t);
    outputRange.push(out[0] + (out[1] - out[0]) * fn(t));
  }
  return { inputRange, outputRange };
}

// ------------------------------------------------------------------ the lock

/** The lock's box on the page (the Sent mark's 220), and the smallest a short screen draws. */
export const LOCK_BOX = INK_BOX;
export const MIN_LOCK_BOX = MIN_INK_BOX;
/** The disc, in the 0-100 drawing box. */
export const LOCK_R = 30;
/** The first recovery ring sits this far outside the disc; the outermost may reach 49. */
const RING_FIRST = LOCK_R + 7;
const RING_STEP = 5;
const RING_MAX = 49;

/** A circle about (cx, cy), clockwise from the top, as one dashable path. */
export const circleCw = (r: number, cx = 50, cy = 50): string =>
  `M${cx} ${cy - r} A${r} ${r} 0 1 1 ${cx} ${cy + r} A${r} ${r} 0 1 1 ${cx} ${cy - r}`;
/** The same circle counter-clockwise: the sketch pass. */
export const circleCcw = (r: number, cx = 50, cy = 50): string =>
  `M${cx} ${cy - r} A${r} ${r} 0 1 0 ${cx} ${cy + r} A${r} ${r} 0 1 0 ${cx} ${cy - r}`;
/** A circle's stroke length, rounded up so the dash covers it whole. */
export const circleLen = (r: number): number => Math.ceil(2 * Math.PI * r) + 1;
export const LOCK_LEN = circleLen(LOCK_R);
/** The keyhole: its eye and its wedge. */
export const KEYHOLE_EYE = circleCw(5.5, 50, 44);
export const KEYHOLE_EYE_LEN = circleLen(5.5);
export const KEYHOLE_WEDGE = 'M47.2 48.6 L44.5 61 L55.5 61 L52.8 48.6';
/** 12.69 + 11 + 12.69, rounded up. */
export const KEYHOLE_WEDGE_LEN = 37;

/** A recovery ring's dash and gap (in the 100-unit box). */
const RING_DASH = 2;
const RING_GAP = 2.6;

/**
 * The ring's dash pattern stretched to a whole number of dashes round the
 * circle, so the last dash never meets the first as one long dash (the seam
 * at 3 o'clock, render 2026-10-02).
 */
export function ringDash(r: number): string {
  const period = RING_DASH + RING_GAP;
  const around = 2 * Math.PI * r;
  const p = around / Math.max(1, Math.round(around / period));
  const k = p / period;
  return `${(RING_DASH * k).toFixed(4)} ${(RING_GAP * k).toFixed(4)}`;
}

/**
 * One dashed ring per recovery path, 5 apart from just outside the disc;
 * more paths than fit at that spacing (up to six: five heirs and the rescue
 * key) close up so the outermost stays inside the box.
 */
export function ringRadii(paths: number): number[] {
  if (paths <= 0) return [];
  const step = paths === 1 ? 0 : Math.min(RING_STEP, (RING_MAX - RING_FIRST) / (paths - 1));
  return Array.from({ length: paths }, (_, i) => RING_FIRST + step * i);
}

/**
 * The pen dot as it sketches the disc counter-clockwise from the top (the
 * first half of its track) and inks it clockwise (the second half), in a box
 * of `box` points. It scales with the box, 14 at the design's 220.
 */
export function lockPenPath(box: number): { size: number; inputRange: number[]; x: number[]; y: number[] } {
  const size = (PEN * box) / LOCK_BOX;
  const at = (u: number) => (u * box) / 100 - size / 2;
  const N = 24;
  const inputRange: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= 2 * N; i++) {
    const theta = i <= N ? -(i / N) * 2 * Math.PI : ((i - N) / N) * 2 * Math.PI;
    inputRange.push(i / (2 * N));
    x.push(at(50 + LOCK_R * Math.sin(theta)));
    y.push(at(50 - LOCK_R * Math.cos(theta)));
  }
  return { size, inputRange, x, y };
}

// ------------------------------------------------------------------ the glass

/**
 * The disc is GLASS (decided 2026-10-02: "build the lock in a matching glossy
 * optic"), the app's own finish, the one every round button and icon tile
 * carries: HeaderIconButton's recipe, the `surfaceRaised` ground, clipped to
 * the circle, no hairline, `Gloss` as its first child. The story stays drawn:
 * the pen sketches and inks the disc's outline, and the glass settles in
 * under that outline as the ink completes, from `GLASS_IN.from` of the pen's
 * track (the ink pass runs 0.5 -> 1) to its end, opacity 0 -> 1 and scale
 * `GLASS_SCALE_FROM` -> 1, on the native driver. The outline is inked at
 * `LOCK_R`, so the glass IS the disc: its edge sits under the ink, the
 * keyhole is drawn on it in the ink colour, the recovery rings stay outside
 * it, and the green ring inks around its edge with the last click.
 */
export const GLASS_IN = { from: 0.5, to: 1 } as const;
export const GLASS_SCALE_FROM = 0.92;

/** The glass disc in a box of `box` points: its diameter and its inset from the box's edge. */
export function lockGlass(box: number): { size: number; inset: number } {
  const size = (2 * LOCK_R * box) / 100;
  return { size, inset: (box - size) / 2 };
}

/**
 * How big the lock is drawn (the Sent page's `sentMarkBox` rule): the page
 * is laid out once with the smallest lock while nothing on it shows, and
 * the room left over goes to the lock, up to the design's 220, so the
 * button ends where the page ends on an iPhone SE. The lock has no tuck
 * (the rings reach its box's edge), so it grows point for point. No room
 * leaves the smallest, and the page scrolls.
 */
export function vaultBuiltBox(pageH: number, contentH: number): number {
  const room = pageH - contentH;
  if (!(room > 0.5)) return MIN_LOCK_BOX;
  return Math.min(LOCK_BOX, Math.floor(MIN_LOCK_BOX + room));
}

// ------------------------------------------------------------------ the keys' row

// The design's row, in points at the design's box (220). The whole row
// scales with the lock box (`keyRow`), so these are B2's proportions, not
// sizes to draw.
/** A key in the row. */
export const KEY_ICON = 30;
/** How far below the lock's centre the row sits. */
export const KEY_START_Y = 150;
/** The spacing in the row, and the widest a name under a key is drawn. */
export const KEY_GAP_X = 104;
export const KEY_LABEL_W = 120;
/** The gap between a key and its name. */
export const KEY_LABEL_TOP = 34;
/** The least room between two neighbouring names in a closed-up row (at the type's scale). */
export const KEY_LABEL_SPACE = 8;
/** A name narrower than this is not drawn at all (it would be an ellipsis), at the type's scale. */
const MIN_LABEL_W = 44;
/**
 * A name's TYPE scales with the row but never below this share of its size
 * (10 of the caption's 12pt): on an iPhone SE the lock is half its size, and
 * a 6pt name is not a name. The glyph and the spacing keep B2's proportions
 * exactly; what the type spaces (the room between neighbouring names, the
 * narrowest name worth drawing) follows the type.
 */
export const KEY_NAME_MIN_SCALE = 10 / 12;

export interface KeyRow {
  /** The row's scale against the design (`box / LOCK_BOX`), and its names' type's. */
  scale: number;
  nameScale: number;
  /** A key glyph, in points. */
  icon: number;
  /** How far below the lock's centre the row sits, and the gap between a key and its name. */
  startY: number;
  labelTop: number;
  /** The spacing between keys, the room each name has (0: no names), and each key's place from the lock's centre line. */
  gap: number;
  labelW: number;
  x: number[];
}

/**
 * The row of keys under a lock drawn in a box of `box` points, in a page
 * `pageW` points wide. Everything scales with the box (decided 2026-10-02:
 * on an iPhone SE the lock shrank to 110 while the keys kept their 30pt and
 * 104pt spacing and looked big beside it), so the picture keeps B2's
 * proportions on every phone. The design's spacing and names, closed up for
 * a row that would not fit (four keys and more, the custom builder's k of
 * n), each name then narrower than the spacing by `KEY_LABEL_SPACE`, so
 * neighbouring names never overlap and the row and its names stay inside
 * the page. Too many keys to name (`labelW` 0): the keys alone, spread
 * across the page.
 */
export function keyRow(n: number, pageW: number, box: number = LOCK_BOX): KeyRow {
  const scale = box / LOCK_BOX;
  const nameScale = Math.max(scale, KEY_NAME_MIN_SCALE);
  const icon = KEY_ICON * scale;
  const base = { scale, nameScale, icon, startY: KEY_START_Y * scale, labelTop: KEY_LABEL_TOP * scale };
  const gapX = KEY_GAP_X * scale;
  const labelMax = KEY_LABEL_W * scale;
  const count = Math.max(1, n);
  const place = (gap: number) => Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * gap);
  if (count === 1) return { ...base, gap: 0, labelW: Math.min(labelMax, pageW), x: [0] };
  const named = Math.min(gapX, (pageW - labelMax) / (count - 1));
  // A name never reaches its neighbour's: on an iPhone SE the row is half
  // size but the type keeps a floor, so a full-width name ran into the next
  // one ("Ledger Nano X" beside "BitBox02 Nova", render 2026-10-02). It is cut
  // short with an ellipsis instead.
  const labelW = Math.min(labelMax, named - KEY_LABEL_SPACE * nameScale);
  if (labelW >= MIN_LABEL_W * nameScale) return { ...base, gap: named, labelW, x: place(named) };
  const bare = Math.max(0, Math.min(gapX, (pageW - icon) / (count - 1)));
  return { ...base, gap: bare, labelW: 0, x: place(bare) };
}
