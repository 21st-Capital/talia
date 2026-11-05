/**
 * The vault builder's draft, as the lanes of the Estate Plan's "Vault
 * Overview" graph (decided 2026-09-25: "why not showing the graph being built
 * one step at a time until its complete. So the keys he adds are part of a
 * graph that starts getting in shape and as he continues, it reaches its
 * final form").
 *
 * The row contract is the one the PDF and the staff dashboard draw from
 * (`apps/forms/estate_graph.py`, `vault-policy.ts`): a title, the keys with
 * their fingerprints, a key glyph per key, and where the wait ends on the
 * document's own scale (8 months = 25%, 12 = 50%, 15 = 75%). So a client
 * sees ONE picture of their vault here, on the vault's own page later, and
 * in the Estate Plan.
 *
 * One step, one path (decided 2026-09-25, second round: "lets display only the
 * path we are building on at a time ... and at the end, we show it all
 * coming together"). `vaultGraphRows` still builds every lane of the draft;
 * `focusedRows` keeps the lanes of the step being worked on, and
 * `timelineShown` says whether the timeline is drawn at all: the "After 8 /
 * 12 / 15 months" axis, its gridlines AND the arrowheads on the lines. It
 * is a property of WHAT IS DRAWN: the timeline exists only while a drawn
 * lane waits ("there is no need to show the time period on the right
 * either because nothing is timelocked on the primary path. We already do
 * this on the estate plan"; "on the primary layer, do not use any arrows at
 * all ... Only add the arrows as soon as additional layers are added").
 *
 * Two rules this module exists to keep:
 *
 *  1. The unfinished picture never lies. A slot with no key is drawn EMPTY
 *     (its name alone, faint, no fingerprint); one of our keys, which only
 *     arrives when the vault is created, is a PENDING stand-in and says so;
 *     a question the client has not answered yet (heirs, the rescue key) is
 *     an OUTLINE lane that says "Not chosen yet" and disappears the moment
 *     the answer is no.
 *  2. Every word holds for every shape: 2-of-2, 2-of-3, one key, with or
 *     without our co-signer, with or without heirs or the rescue key. The
 *     client's own slots are the ones the builder fills from their own
 *     device, so "Your key" is the builder's word for them, exactly as the
 *     key step names its rows; nothing else is ever called theirs, and our
 *     keys are called "21st Capital", no more ("21st Capital Co-signer
 *     key takes way too much space").
 *
 * Pure: a function of the draft alone, tested in __tests__/vaultGraphRows.
 */
import type { KeyOrigin } from '../../bitcoin/descriptor';
import { ownKeysFirst } from '../../wallet/keyOrder';

/**
 * Which slot of the builder a primary key fills, so the key step's graph can
 * add and remove keys in place (decided 2026-09-25: "we can build the add key
 * section inside the graph itself"). Only primary keys carry one.
 */
export type KeySlot = { kind: 'user'; index: number } | { kind: 'coSigner' };

/** One key on a lane. */
export interface GraphKey {
  /** The client's own label once given, else the slot's name. */
  label: string;
  /** The master fingerprint, upper case, once the key is in the draft. */
  fingerprint?: string;
  /**
   * placed: the key is in the draft. empty: the slot still needs its key.
   * pending: one of 21st Capital's keys, fetched when the vault is created.
   */
  state: 'placed' | 'empty' | 'pending';
  /** One of 21st Capital's keys (pending, or fetched at creation). */
  ours?: true;
  slot?: KeySlot;
}

/** Which path of the vault a lane belongs to. */
export type GraphLane = 'primary' | 'heir' | 'rescue';

/** One lane of the graph. */
export interface GraphRow {
  /** Stable across renders, for React. */
  id: string;
  lane: GraphLane;
  /** "Primary Keys 2/3:", "Recovery Key 1/1:", "21st Capital". */
  title: string;
  keys: GraphKey[];
  /** Key glyphs beside the card: one per key on the lane. */
  numIcons: number;
  /** Where the wait ends, as a percent of the timeline. 0 = open now. */
  dashedPercent: number;
  /** Months of waiting; null when the lane is open from the start. */
  months: number | null;
  /**
   * Said on the card when the gridlines cannot say it: a wait that is not
   * 8, 12 or 15 months, or the rehearsal lock.
   */
  waitLabel?: string;
  /**
   * open: spends from the first coin. waiting: opens after its wait.
   * undecided: the client has not answered this step yet; an outline only.
   */
  state: 'open' | 'waiting' | 'undecided';
  /** What an undecided lane is waiting for. */
  hint?: string;
  /**
   * The primary path's extra key is a CHOICE the client sees as two options
   * (decided 2026-09-25: "show two options: one option is the 21stcapital key
   * and the other is the clients. Make the 21st cap key active by
   * default"). Which one is in the vault, and the question over them.
   */
  holder?: { active: 'ours' | 'own'; question: string };
}

export interface VaultGraph {
  rows: GraphRow[];
  /** Every slot filled or pending, every question answered. */
  complete: boolean;
  /** Keys the client still has to add from a device. */
  emptySlots: number;
}

export interface HeirDraft {
  method: 'assisted' | 'key';
  key?: KeyOrigin;
  /** 8 to 15, or `testLockMonths` for the rehearsal lock. */
  months: number;
}

/** The builder's draft, as the screen holds it. */
export interface VaultDraft {
  /** How many keys the client adds from their own devices. */
  ownKeys: number;
  /** Signatures the primary path needs. */
  threshold: number;
  /** The keys placed so far, in the order they were added. */
  userKeys: readonly KeyOrigin[];
  /** Who holds the extra primary key; ignored when threshold is 1. */
  coSignerMode: '21c' | 'self';
  coSignerKey: KeyOrigin | null;
  inheritance: boolean | null;
  heirs: readonly HeirDraft[];
  rescue: boolean | null;
  rescueKey: KeyOrigin | null;
  /** The rescue key's wait in months (15). */
  rescueMonths: number;
  /** The rescue key's lock shrunk to the rehearsal lock (our builds only). */
  rescueTestLock?: boolean;
  /** The sentinel an heir's `months` carries for the rehearsal lock. */
  testLockMonths?: number;
  /** Labels by lower-case fingerprint: the client's own names for keys. */
  keyLabels: Readonly<Record<string, string>>;
}

/**
 * The gridlines, and the scale every lane is drawn on. The three waits the
 * configurator offers land exactly on a line; anything else lands in the
 * right neighbourhood. `estate_graph.dashed_percent` is the same function.
 */
export const MILESTONES: ReadonlyArray<{ months: number; percent: number }> = [
  { months: 8, percent: 25 },
  { months: 12, percent: 50 },
  { months: 15, percent: 75 },
];

/** Where a wait ends, as a percent of the timeline. */
export function dashedPercent(months: number): number {
  if (months <= 0) return 0;
  if (months <= 8) return (months / 8) * 25;
  if (months <= 12) return 25 + ((months - 8) / 4) * 25;
  if (months <= 15) return 50 + ((months - 12) / 3) * 25;
  return Math.min(75 + ((months - 15) / 5) * 25, 95);
}

/**
 * The rehearsal lock (three blocks, about half an hour) is nowhere near a
 * month. Drawn at zero it would read as "open now", which is the one thing
 * it is not; it gets a short, visible wait of its own.
 */
export const TEST_LOCK_PERCENT = 10;
export const TEST_LOCK_LABEL = 'After about 30 minutes';
/** An heir's test lock: two blocks, drawn just before the rescue's three
 *  (decided 2026-10-18), as 12 months is drawn before 15. */
export const HEIR_TEST_LOCK_PERCENT = 7;
export const HEIR_TEST_LOCK_LABEL = 'After about 20 minutes';

/** The words for the 21st Capital keys: the PDF's, and no longer. */
export const PROVIDER_TITLE = '21st Capital';
export const COSIGNER_LABEL = '21st Capital';
export const RESCUE_LABEL = 'Rescue Key';
export const NOT_CHOSEN = 'Not chosen yet';
/** The client's own extra primary key, when they hold it rather than us. */
export const OWN_EXTRA_LABEL = 'Your extra key';
/**
 * What an empty slot the client can fill says on the key step (decided
 * 2026-09-25: "lets use some language that the user knows he needs to
 * click there. Maybe 'Add Key'"): the row is the button, so it says so.
 */
export const ADD_KEY_LABEL = 'Add key';
/** The client's own key as the holder option NOT taken: the choice, not a button. */
export const OWN_OPTION_LABEL = 'Your own key';

const upper = (fp?: string): string | undefined => fp?.toUpperCase();
const lower = (fp?: string): string | undefined => fp?.toLowerCase();

/**
 * A wait's row fields, from its months (or the rehearsal lock).
 *
 * A wait in MONTHS is never written inside the card (decided 2026-09-25: "no
 * need to mention the number of months as text on the left even if its
 * not the matching number from the top"): the line already says when the
 * lane opens, against an axis that names the months, and the Estate Plan
 * PDF never printed it either. The REHEARSAL lock keeps its label, because
 * "about 30 minutes" is not months and sits nowhere near the axis; it
 * exists in our own builds alone.
 */
function wait(
  months: number,
  testLock: boolean,
  heir = false,
): Pick<GraphRow, 'dashedPercent' | 'months' | 'waitLabel'> {
  if (testLock && heir) return { dashedPercent: HEIR_TEST_LOCK_PERCENT, months: null, waitLabel: HEIR_TEST_LOCK_LABEL };
  if (testLock) return { dashedPercent: TEST_LOCK_PERCENT, months: null, waitLabel: TEST_LOCK_LABEL };
  return { dashedPercent: dashedPercent(months), months };
}

/** The label a placed key shows: the client's name for it, else the slot's. */
function placed(key: KeyOrigin, labels: Readonly<Record<string, string>>, slot: string): GraphKey {
  const fp = lower(key.fingerprint);
  return {
    label: (fp && labels[fp]) || slot,
    fingerprint: upper(key.fingerprint),
    state: 'placed',
  };
}

/** One of ours: always by our name, whatever label the draft carries. */
function ours(key: KeyOrigin | null, label: string): GraphKey {
  return key
    ? { label, fingerprint: upper(key.fingerprint), state: 'placed', ours: true }
    : { label, state: 'pending', ours: true };
}

const empty = (slot: string): GraphKey => ({ label: slot, state: 'empty' });

/** The lanes of the draft, in the order they open. */
export function vaultGraphRows(d: VaultDraft): VaultGraph {
  const rows: GraphRow[] = [];
  const own = Math.max(1, d.ownKeys);
  const hasCoSignerSlot = d.threshold > 1;
  const testLockMonths = d.testLockMonths ?? 0;

  // 1. The primary path: the client's slots first, ours last (decided
  //    2026-09-21), which is also the order the builder fills them in.
  const ownSlots: GraphKey[] = [];
  for (let i = 0; i < own; i++) {
    const slot = own > 1 ? `Your key ${i + 1}` : 'Your key';
    const key = d.userKeys[i];
    ownSlots.push({ ...(key ? placed(key, d.keyLabels, slot) : empty(slot)), slot: { kind: 'user', index: i } });
  }
  const coSigner: GraphKey[] = [];
  if (hasCoSignerSlot) {
    const k =
      d.coSignerMode === '21c'
        ? ours(d.coSignerKey, COSIGNER_LABEL)
        : d.coSignerKey
          ? placed(d.coSignerKey, d.keyLabels, OWN_EXTRA_LABEL)
          : empty(OWN_EXTRA_LABEL);
    coSigner.push({ ...k, slot: { kind: 'coSigner' } });
  }
  const primaryKeys = ownKeysFirst([...ownSlots, ...coSigner], (k) => k.ours === true);
  const total = primaryKeys.length;
  rows.push({
    id: 'primary',
    lane: 'primary',
    title: total === 1 ? 'Primary Key 1/1:' : `Primary Keys ${d.threshold}/${total}:`,
    keys: primaryKeys,
    numIcons: total,
    dashedPercent: 0,
    months: null,
    state: 'open',
    ...(hasCoSignerSlot
      ? {
          holder: {
            active: d.coSignerMode === '21c' ? 'ours' : 'own',
            question: `Who holds the ${own === 2 ? 'third' : 'second'} key?`,
          },
        }
      : {}),
  });

  // 2. Heirs: undecided is an outline; each heir holding a key is a lane;
  //    an assisted heir holds no key and has no lane of their own.
  if (d.inheritance === null) {
    rows.push({
      id: 'heirs',
      lane: 'heir',
      title: 'Heirs',
      keys: [],
      numIcons: 1,
      dashedPercent: 0,
      months: null,
      state: 'undecided',
      hint: NOT_CHOSEN,
    });
  }
  const waiting: GraphRow[] = [];
  if (d.inheritance === true) {
    d.heirs.forEach((h, i) => {
      if (h.method !== 'key') return;
      const slot = `Heir ${i + 1} key`;
      waiting.push({
        id: `heir-${i}`,
        lane: 'heir',
        title: 'Recovery Key 1/1:',
        keys: [h.key ? placed(h.key, d.keyLabels, slot) : empty(slot)],
        numIcons: 1,
        state: 'waiting',
        ...wait(h.months, h.months === testLockMonths, true),
      });
    });
  }

  // 3. The rescue key: ours, pending until creation, on its own lane.
  if (d.rescue === true) {
    waiting.push({
      id: 'rescue',
      lane: 'rescue',
      title: PROVIDER_TITLE,
      keys: [ours(d.rescueKey, RESCUE_LABEL)],
      numIcons: 1,
      state: 'waiting',
      ...wait(d.rescueMonths, d.rescueTestLock === true),
    });
  }
  // Ascending wait, as the composer orders the paths; a stable sort keeps
  // heirs before the rescue key at the same wait.
  waiting.sort((a, b) => a.dashedPercent - b.dashedPercent);
  rows.push(...waiting);
  if (d.rescue === null) {
    rows.push({
      id: 'rescue',
      lane: 'rescue',
      title: RESCUE_LABEL,
      keys: [],
      numIcons: 1,
      dashedPercent: 0,
      months: null,
      state: 'undecided',
      hint: NOT_CHOSEN,
    });
  }

  const emptySlots = rows.reduce(
    (n, r) => n + r.keys.filter((k) => k.state === 'empty').length,
    0,
  );
  const undecided = rows.some((r) => r.state === 'undecided');
  return { rows, complete: emptySlots === 0 && !undecided, emptySlots };
}

// ── one step, one path ──────────────────────────────────────────────────────

/** Which lanes a step draws: its own, or all of them coming together. */
export type GraphFocus = 'primary' | 'heirs' | 'rescue' | 'all';

/** The lanes of the step being worked on. Empty means: nothing to draw here. */
export function focusedRows(rows: readonly GraphRow[], focus: GraphFocus): GraphRow[] {
  if (focus === 'all') return [...rows];
  const lane: GraphLane = focus === 'heirs' ? 'heir' : focus;
  return rows.filter((r) => r.lane === lane);
}

/**
 * Is the timeline drawn: the axis, its gridlines and the arrowheads on the
 * lines? Only while a drawn lane waits. The primary path alone has nothing
 * timelocked, so its line is a plain line; the outline of an unanswered
 * question has no wait yet. One rule for all three, so they cannot drift.
 */
export function timelineShown(rows: readonly GraphRow[]): boolean {
  return rows.some((r) => r.state === 'waiting');
}

// ── the vertical rhythm both columns share ──────────────────────────────────

/**
 * How many lines a key block takes: its name, and under it a fingerprint
 * (placed) or "added at creation" (pending). An empty slot is its name
 * alone ("There is no need to say 'No key yet' as it takes more space").
 */
export function keyBlockLines(k: GraphKey): 1 | 2 {
  if (k.state === 'pending') return 2;
  if (k.state === 'placed' && k.fingerprint) return 2;
  return 1;
}

/** The points a lane is laid out on; the component reads these. */
export interface LaneMetrics {
  /** Top and bottom padding of the card AND the tile. */
  padV: number;
  /** The title's line, plus the air under it, before the first block. */
  titleH: number;
  /** A name's line; the glyph is centred on it. */
  labelLh: number;
  /** The fingerprint's or the state's line, tight under the name. */
  noteLh: number;
  /** Between one key block and the next, in both columns. */
  keySpace: number;
}

/** The picture's rhythm: the document's density. The key step's rows are
 *  not lanes any more (they are the vault card's own rows, on the theme's
 *  type), so this is the one rhythm. */
export const LANE_METRICS: LaneMetrics = {
  padV: 7,
  titleH: 17,
  labelLh: 13,
  noteLh: 11,
  keySpace: 6,
};

export interface KeyBlockLayout {
  /** From the top of the card or tile, padding included. */
  top: number;
  height: number;
  /** Where the glyph's centre sits, which is the name line's centre. */
  nameCentre: number;
}

export interface LaneLayout {
  /** The title's box, or a zero-height one when the lane draws no title. */
  title: { top: number; height: number };
  keys: KeyBlockLayout[];
  /** The card's full height, padding included. */
  height: number;
}

/**
 * Where each key block sits, and where its glyph goes. The card and the
 * amber column are both drawn from THIS, so a glyph cannot drift from its
 * name: cell i and block i share `top` and `height`, and the glyph is
 * centred on the first `labelLh` of the cell, which is the name's line. A
 * block may be one line or two; the arithmetic carries the difference.
 */
export function laneLayout(
  keys: readonly GraphKey[],
  withTitle: boolean,
  m: LaneMetrics = LANE_METRICS,
): LaneLayout {
  const titleH = withTitle ? m.titleH : 0;
  let y = m.padV + titleH;
  const out: KeyBlockLayout[] = [];
  keys.forEach((k, i) => {
    if (i > 0) y += m.keySpace;
    const height = m.labelLh + (keyBlockLines(k) === 2 ? m.noteLh : 0);
    out.push({ top: y, height, nameCentre: y + m.labelLh / 2 });
    y += height;
  });
  return { title: { top: m.padV, height: titleH }, keys: out, height: y + m.padV };
}
