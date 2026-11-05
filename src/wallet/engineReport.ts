/**
 * The engine report: one small JSON file in the app's Documents folder
 * (BDK upgrade, decided 2026-10-15), in Talia Test and
 * TestFlight (the App Store app keeps none). COUNTS only, with the vault's
 * shape class and a field name: NEVER a descriptor, a key, an address, a
 * transaction or a server name. Everything in it is a number, a date, or a
 * word from a fixed list, and `reportProblems` refuses anything else before
 * the file is written. The one mention of a server, in reports written while
 * two engines shipped, is a short fixed word for each of the three public
 * built-in Testnet4 servers, everything else being 'other' (`SERVER_FIELD`,
 * decided 2026-10-30).
 *
 * How it is collected:
 *   - Talia Test: pulled from the owner's Mac, with no action on the phone:
 *       xcrun devicectl device copy from --device <id> \
 *         --domain-type appDataContainer \
 *         --domain-identifier com.twentyfirstcapital.keel.test \
 *         --source Documents/talia-engine-report-2.json --destination <file>
 *     (a report a build could not trust is kept beside it as
 *     talia-engine-report-2.unreadable-N.json, so pull those too when they
 *     exist)
 *   - TestFlight: Settings > Diagnostics > "Share report" (the share sheet,
 *     per the email-attachment rule).
 *
 * What is written since the old engine's removal (decided 2026-11-04: one engine, nothing
 * left to compare it with): the independent address check's verdicts
 * (wallet/addressCheckStore.ts: a mismatch, a match it derived and a match
 * an earlier sweep had proved, in the `preflight` section under the fields
 * `scure.address`, `scure.proven`, `scure.output` and `scure.shown`;
 * `addressChecksOf` reads them back), a known-answer test the library failed
 * (`withKnownAnswerFailure`, the same section, `library.knownAnswer`) and
 * each connection test (`withConnectionTest`). The
 * schema did not change, so a report written while two engines shipped
 * reads as before: its shadow, preflight and fallback counts, sync times,
 * height buckets, guard trips and engine choices are still read and
 * checked, and nothing writes them any more (the shadow checks, the
 * per-vault preflight, its fallbacks and the report-only check of the
 * signing and store builds went with the old engine).
 *
 * BY BUILD (decided 2026-10-28, schema 2): every count, sync time, height
 * bucket, connection test, guard trip and the engine choice goes into the
 * entry of `builds` for the build that made it, known by its version, build
 * number, flavour and `since`, when that install of it first ran (a phone
 * build keeps the version and build number of the last release, so they
 * alone do not tell two Talia Test builds apart;
 * platform/engineReportFile.ts finds `since`). One week's numbers are never
 * mixed with another build's: only the report's own dates and the build
 * that wrote last stand outside the entries. A report written before the
 * split (schema 1, counted since the first build of the shadow week) is
 * kept as one entry marked `mixed`. Each TRANSACTION behind a
 * `history.height` mismatch is also counted in txid-free buckets (`heights`,
 * bitcoin/engine/heightBucket.ts). The two count different things:
 * `byField['history.height']` counts the COMPARISONS that found one or more
 * (a state job counts each field once), the buckets count the transactions
 * (one per transaction that differed), so a shape's bucket total is never
 * below its `history.height` count and is above it whenever one comparison
 * found several (decided 2026-10-28).
 *
 * Pure (no native import); platform/engineReportFile.ts reads and writes it.
 */
import type { BuildFlavour } from '../config';
import { isHeightBucket } from '../bitcoin/engine/heightBucket';

export const ENGINE_REPORT_SCHEMA = 'talia-engine-report/2';
/** The schema before the split by build (decided 2026-10-28): read once, kept as one `mixed` entry. */
export const ENGINE_REPORT_SCHEMA_V1 = 'talia-engine-report/1';
/**
 * Schema 2 has a file of its own (decided 2026-10-28). A build from before
 * the split reads a schema 2 report as one that breaks its rule and writes
 * an empty schema 1 report in its place, so installing such a build after
 * this one, on the same phone, would wipe every count; it cannot find this
 * file. The schema 1 file is only ever READ here, to carry it over while
 * this file does not exist yet, and is never written or removed.
 */
export const ENGINE_REPORT_FILE = 'talia-engine-report-2.json';
export const ENGINE_REPORT_FILE_V1 = 'talia-engine-report.json';

/** The most connection tests and sync times kept per list; the oldest go first. */
export const REPORT_LIST_MAX = 50;
/**
 * The most builds kept; the oldest goes first, never the `mixed` entry.
 * Every install of a phone build is an entry of its own (`since`), so this
 * counts installs, not builds: at one install a day it holds two months
 * between pulls (decided 2026-10-28: at 12, the twelfth reinstall dropped the
 * first one's counts).
 */
export const REPORT_BUILDS_MAX = 60;

/**
 * A vault's SHAPE, never the vault: the script kind and whether a wait is in
 * it, read off the descriptor's words (no key is read).
 */
export type ShapeClass =
  | 'wpkh'
  | 'sh-wpkh'
  | 'pkh'
  | 'tr-key'
  | 'tr-multi'
  | 'tr-timelocked'
  | 'tr-other'
  | 'wsh-sortedmulti'
  | 'wsh-multi'
  | 'wsh-timelocked'
  | 'wsh-other'
  | 'sh-wsh'
  | 'sh-multi'
  | 'other';

export const SHAPE_CLASSES: readonly ShapeClass[] = [
  'wpkh',
  'sh-wpkh',
  'pkh',
  'tr-key',
  'tr-multi',
  'tr-timelocked',
  'tr-other',
  'wsh-sortedmulti',
  'wsh-multi',
  'wsh-timelocked',
  'wsh-other',
  'sh-wsh',
  'sh-multi',
  'other',
];

export function shapeClassOf(descriptor: string): ShapeClass {
  const d = descriptor.trim().replace(/#.*$/, '');
  const waits = /\b(older|after)\(/.test(d);
  if (d.startsWith('wpkh(')) return 'wpkh';
  if (d.startsWith('sh(wpkh(')) return 'sh-wpkh';
  if (d.startsWith('pkh(')) return 'pkh';
  if (d.startsWith('sh(wsh(')) return 'sh-wsh';
  if (/^sh\((sorted)?multi\(/.test(d)) return 'sh-multi';
  if (d.startsWith('tr(')) {
    if (waits) return 'tr-timelocked';
    if (/multi_a\(/.test(d)) return 'tr-multi';
    return d.includes(',') ? 'tr-other' : 'tr-key';
  }
  if (d.startsWith('wsh(')) {
    if (waits) return 'wsh-timelocked';
    if (d.startsWith('wsh(sortedmulti(')) return 'wsh-sortedmulti';
    if (d.startsWith('wsh(multi(')) return 'wsh-multi';
    return 'wsh-other';
  }
  return 'other';
}

export type ReportSection = 'shadow' | 'preflight' | 'fallback';
export const REPORT_SECTIONS: readonly ReportSection[] = ['shadow', 'preflight', 'fallback'];

/**
 * Decided 2026-10-25: 'skipped', a part of the shadow's comparison that was
 * not made, its field saying why (`tipMoved.history`, `tipMoved.balance`:
 * the two engines' views were taken at different tips;
 * `shadow.state.noServer`, `shadow.state.off`); 'scheduled' and 'compared'
 * (field `shadow.state`), a state job queued and one that reached its
 * comparison, so each shape shows how many comparisons ran.
 */
export type ReportOutcome =
  | 'match'
  | 'mismatch'
  | 'unparsable'
  | 'sees-more'
  | 'skipped'
  | 'fell-back'
  | 'error'
  | 'scheduled'
  | 'compared';
export const REPORT_OUTCOMES: readonly ReportOutcome[] = [
  'match',
  'mismatch',
  'unparsable',
  'sees-more',
  'skipped',
  'fell-back',
  'error',
  'scheduled',
  'compared',
];

/**
 * The sync-time lists of the shadow week (decided 2026-10-25): `v028` and
 * `v3` each engine's first sync of a launch for a vault, `v028Repeat` and
 * `v3Repeat` its later ones. Nothing writes them since the old engine's removal (decided
 * 2026-11-04: one engine, nothing to time it against); they are read so a
 * report written before stays readable.
 */
export type SyncList = 'v028' | 'v3' | 'v028Repeat' | 'v3Repeat';
export const SYNC_LISTS: readonly SyncList[] = ['v028', 'v3', 'v028Repeat', 'v3Repeat'];

export interface SectionCounts {
  total: number;
  byOutcome: Partial<Record<ReportOutcome, number>>;
  byShape: Partial<Record<ShapeClass, Partial<Record<ReportOutcome, number>>>>;
  /** Which field differed ("balance", "address.external", "build.sequence"). */
  byField: Record<string, number>;
}

/** Sync times in milliseconds, per list (`SyncList`) and shape class. */
export type SyncTimes = Partial<Record<SyncList, Partial<Record<ShapeClass, number[]>>>>;

/**
 * The engines a report may name: 'v028' (the old engine), 'shadow' and 'v3'.
 * Since the old engine's removal (decided 2026-11-04) every connection test is 'v3'; the
 * other two are read in reports written before.
 */
export type ReportEngine = 'v028' | 'shadow' | 'v3';

/**
 * The engine a launch of the phone decided on, in reports written before
 * the old engine's removal (decided 2026-11-04): nothing chooses an engine since, so a new
 * build's entry keeps `engine: null`.
 */
export interface EngineState {
  committed: ReportEngine;
  active: ReportEngine;
  reason: string;
  previousEngine: boolean;
  shadowOff: boolean;
}

/** One connection test: which engine answered (no server is named), whether it worked, how long. */
export interface ConnectionTest {
  at: string;
  engine: ReportEngine;
  ok: boolean;
  ms: number;
}

/** What one build counted (decided 2026-10-28). */
export interface BuildCounts {
  app: { version: string; build: string; flavour: BuildFlavour };
  /** When this install of the build first ran (ISO); null when it could not be told. */
  since: string | null;
  /** Counts of a report written before the split: several builds, mixed. */
  mixed?: true;
  firstAt: string;
  lastAt: string;
  /** The engine this build's last launch decided on; null before it has. */
  engine: EngineState | null;
  /** Which engine answered each connection test this build ran. */
  connectionTests: ConnectionTest[];
  /** The shadow crash-loop guard: how often it switched shadow off at a launch of this build. */
  guard: { tripped: number; lastAt: string | null };
  sections: Record<ReportSection, SectionCounts>;
  syncMs: SyncTimes;
  /**
   * The TRANSACTIONS behind `history.height` mismatches per shape, by bucket
   * (bitcoin/engine/heightBucket.ts): one count per transaction, while
   * `byField['history.height']` counts one per comparison that found any.
   */
  heights: Partial<Record<ShapeClass, Record<string, number>>>;
}

export interface EngineReport {
  schema: typeof ENGINE_REPORT_SCHEMA;
  createdAt: string;
  updatedAt: string;
  /** The build that wrote last. */
  app: { version: string; build: string; flavour: BuildFlavour; since?: string };
  /** Each build's counts, oldest first (decided 2026-10-28); nothing counted stands outside them. */
  builds: BuildCounts[];
}

export interface ReportApp {
  version: string;
  build: string;
  flavour: BuildFlavour;
  /** When this install of the build first ran (ISO), when known (platform/engineReportFile.ts). */
  since?: string;
}

const emptySection = (): SectionCounts => ({ total: 0, byOutcome: {}, byShape: {}, byField: {} });
const emptySections = (): Record<ReportSection, SectionCounts> => ({
  shadow: emptySection(),
  preflight: emptySection(),
  fallback: emptySection(),
});

const appOf = (app: ReportApp): EngineReport['app'] => ({
  version: app.version,
  build: app.build,
  flavour: app.flavour,
  ...(app.since != null ? { since: app.since } : {}),
});

export function emptyEngineReport(app: ReportApp, now: Date): EngineReport {
  const at = now.toISOString();
  return {
    schema: ENGINE_REPORT_SCHEMA,
    createdAt: at,
    updatedAt: at,
    app: appOf(app),
    builds: [],
  };
}

const isBuild = (b: BuildCounts, app: ReportApp) =>
  !b.mixed &&
  b.app.version === app.version &&
  b.app.build === app.build &&
  b.app.flavour === app.flavour &&
  b.since === (app.since ?? null);

/** This build's counts in the report, if it has counted anything yet. */
export function buildOf(r: EngineReport, app: ReportApp): BuildCounts | undefined {
  return r.builds.find((b) => isBuild(b, app));
}

/**
 * The address check's verdicts in one build's counts (decided 2026-11-04):
 * `checks` every verdict on the addresses, a match or a mismatch, and
 * `mismatches` the ones that disagreed. A failed known-answer test is an
 * 'error' in the same section and is neither. No entry, nothing counted.
 */
export function addressChecksOf(b: BuildCounts | undefined): { checks: number; mismatches: number } {
  const out = b?.sections.preflight.byOutcome ?? {};
  const mismatches = out.mismatch ?? 0;
  return { checks: (out.match ?? 0) + mismatches, mismatches };
}

const stamped = (r: EngineReport, app: ReportApp, now: Date): EngineReport => ({
  ...r,
  app: appOf(app),
  updatedAt: now.toISOString(),
});

/**
 * The report with this build's entry changed by `change` (a new entry, last,
 * when the build has none; the oldest go first past REPORT_BUILDS_MAX).
 */
function withBuild(r: EngineReport, app: ReportApp, now: Date, change: (b: BuildCounts) => BuildCounts): EngineReport {
  const at = now.toISOString();
  const i = r.builds.findIndex((b) => isBuild(b, app));
  const current: BuildCounts =
    i >= 0
      ? r.builds[i]
      : {
          app: { version: app.version, build: app.build, flavour: app.flavour },
          since: app.since ?? null,
          firstAt: at,
          lastAt: at,
          engine: null,
          connectionTests: [],
          guard: { tripped: 0, lastAt: null },
          sections: emptySections(),
          syncMs: {},
          heights: {},
        };
  const next = { ...change(current), lastAt: at };
  const builds = i >= 0 ? r.builds.map((b, j) => (j === i ? next : b)) : [...r.builds, next];
  return { ...stamped(r, app, now), builds: keepLatestBuilds(builds) };
}

/**
 * The builds past REPORT_BUILDS_MAX, oldest first, never the `mixed` entry:
 * it is the shadow week from before the split, which no later build can
 * count again (decided 2026-10-28).
 */
function keepLatestBuilds(builds: BuildCounts[]): BuildCounts[] {
  const kept = [...builds];
  while (kept.length > REPORT_BUILDS_MAX) {
    const oldest = kept.findIndex((b) => b.mixed !== true);
    if (oldest < 0) break;
    kept.splice(oldest, 1);
  }
  return kept;
}

const capped = <T>(list: T[]): T[] => list.slice(Math.max(0, list.length - REPORT_LIST_MAX));

/**
 * One connection test of this build: whether it worked and how long it
 * took. The one engine since the old engine's removal (decided 2026-11-04) answered it, so
 * it is noted as 'v3', the word the report has always used for it.
 */
export function withConnectionTest(
  r: EngineReport,
  answer: { height: number | null; ms: number; at: number },
  app: ReportApp,
  now: Date,
): EngineReport {
  return withBuild(r, app, now, (b) => ({
    ...b,
    connectionTests: capped([
      ...b.connectionTests,
      {
        at: new Date(answer.at).toISOString(),
        engine: 'v3',
        ok: answer.height != null,
        ms: Math.max(0, Math.round(answer.ms)),
      },
    ]),
  }));
}

/**
 * A field name may only be a short dotted word, never data: up to four
 * words (a failed state job's `shadow.state.<step>.<class>`, decided
 * 2026-10-25), each a fixed name.
 */
export const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,23}(\.[a-z][a-zA-Z0-9]{0,23}){0,3}$/;

/**
 * The server of a failed state job of the shadow checks (decided
 * 2026-10-30): which of the built-in Testnet4 servers, or `other` for
 * anything else, and whether it `refused` (could not be reached) or failed
 * some `other` way, in `byField` beside the job's
 * `shadow.state.<step>.<class>` on the same count. Nothing writes it since
 * 2026-11-04 (decided then: the shadow checks went with the old engine);
 * a report written before still holds it and reads as before. Any other
 * word under this name is refused: it could only be a server's own.
 */
export const SERVER_FIELD = /^shadow\.stateServer\.(blackie|mempool|stagemole|other)\.(refused|other)$/;
const namesServer = (field: string) => field.startsWith('shadow.stateServer.');

/** The field a failed known-answer test is counted under (`withKnownAnswerFailure`). */
export const KNOWN_ANSWER_FIELD = 'library.knownAnswer';

/**
 * The library failed its known-answer test this launch (decided
 * 2026-11-04): no vault opened, and the report says why. Counted
 * once a launch in the `preflight` section as an 'error' under
 * `library.knownAnswer`, filed under the shape class of the vault whose
 * open ran the test ('other' when none is known); only the shape is
 * written, never the descriptor.
 */
export function withKnownAnswerFailure(r: EngineReport, ranFor: string | null, app: ReportApp, now: Date): EngineReport {
  const shape: ShapeClass = ranFor ? shapeClassOf(ranFor) : 'other';
  return withCount(r, 'preflight', { shape, outcome: 'error', field: KNOWN_ANSWER_FIELD }, app, now);
}

/** Count one finding (since the old engine's removal, the address check's: wallet/addressCheckStore.ts). */
export function withCount(
  r: EngineReport,
  section: ReportSection,
  event: { shape: ShapeClass; outcome: ReportOutcome; field?: string },
  app: ReportApp,
  now: Date,
): EngineReport {
  if (event.field != null && !FIELD_NAME.test(event.field)) {
    throw new Error('A report field is a short name, never a value.');
  }
  // The server words were the shadow checks' alone (`SERVER_FIELD`): nothing names a server since the old engine's removal.
  if (event.field != null && namesServer(event.field)) {
    throw new Error('A report names no server.');
  }
  return withBuild(r, app, now, (b) => {
    const s = b.sections[section];
    const shape = { ...(s.byShape[event.shape] ?? {}) };
    shape[event.outcome] = (shape[event.outcome] ?? 0) + 1;
    const next: SectionCounts = {
      total: s.total + 1,
      byOutcome: { ...s.byOutcome, [event.outcome]: (s.byOutcome[event.outcome] ?? 0) + 1 },
      byShape: { ...s.byShape, [event.shape]: shape },
      byField: event.field ? { ...s.byField, [event.field]: (s.byField[event.field] ?? 0) + 1 } : { ...s.byField },
    };
    return { ...b, sections: { ...b.sections, [section]: next } };
  });
}

const ENGINES: readonly string[] = ['v028', 'shadow', 'v3'];
const FLAVOURS: readonly string[] = ['full', 'signing', 'store'];
/** The reasons a launch gave for its engine, in reports written before the old engine's removal. */
const REASONS: readonly string[] = [
  'committed',
  'android',
  'platform',
  'shadow-full-only',
  'override-previous',
  'override-shadow-off',
  'not-in-build',
];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const SHORT = /^[0-9A-Za-z.() -]{1,24}$/;

const isCount = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

type Bad = (what: string) => void;

function appProblems(app: unknown, bad: Bad, where: string, sinceAllowed: boolean): void {
  const keys = sinceAllowed ? ['version', 'build', 'flavour', 'since'] : ['version', 'build', 'flavour'];
  if (!isObject(app) || Object.keys(app).some((k) => !keys.includes(k))) {
    bad(where);
    return;
  }
  if (typeof app.version !== 'string' || !SHORT.test(app.version)) bad(`${where}.version`);
  if (typeof app.build !== 'string' || !SHORT.test(app.build)) bad(`${where}.build`);
  if (!FLAVOURS.includes(app.flavour as string)) bad(`${where}.flavour`);
  if ('since' in app && (typeof app.since !== 'string' || !ISO.test(app.since))) bad(`${where}.since`);
}

/** Everything a section may hold; anything else is refused (decided 2026-10-28). */
const SECTION_KEYS: readonly string[] = ['total', 'byOutcome', 'byShape', 'byField'];

function sectionsProblems(sections: unknown, bad: Bad, where: string): void {
  if (!isObject(sections) || Object.keys(sections).some((k) => !(REPORT_SECTIONS as readonly string[]).includes(k))) {
    bad(where);
    return;
  }
  for (const name of REPORT_SECTIONS) {
    const s = sections[name];
    if (!isObject(s) || !isCount(s.total) || Object.keys(s).some((k) => !SECTION_KEYS.includes(k))) {
      bad(`${where}.${name}`);
      continue;
    }
    const counts = (o: unknown, keys: readonly string[]) =>
      isObject(o) && Object.entries(o).every(([k, v]) => keys.includes(k) && isCount(v));
    if (!counts(s.byOutcome, REPORT_OUTCOMES)) bad(`${where}.${name}.byOutcome`);
    if (
      !isObject(s.byShape) ||
      !Object.entries(s.byShape).every(([k, v]) => (SHAPE_CLASSES as readonly string[]).includes(k) && counts(v, REPORT_OUTCOMES))
    ) {
      bad(`${where}.${name}.byShape`);
    }
    const fieldName = (k: string) => FIELD_NAME.test(k) && (!namesServer(k) || SERVER_FIELD.test(k));
    if (!isObject(s.byField) || !Object.entries(s.byField).every(([k, v]) => fieldName(k) && isCount(v))) {
      bad(`${where}.${name}.byField`);
    }
  }
}

function syncProblems(sync: unknown, bad: Bad, where: string): void {
  if (
    !isObject(sync) ||
    !Object.entries(sync).every(
      ([eng, per]) =>
        (SYNC_LISTS as readonly string[]).includes(eng) &&
        isObject(per) &&
        Object.entries(per).every(
          ([shape, list]) => (SHAPE_CLASSES as readonly string[]).includes(shape) && Array.isArray(list) && list.every(isCount),
        ),
    )
  ) {
    bad(where);
  }
}

function heightsProblems(heights: unknown, bad: Bad, where: string): void {
  if (
    !isObject(heights) ||
    !Object.entries(heights).every(
      ([shape, per]) =>
        (SHAPE_CLASSES as readonly string[]).includes(shape) &&
        isObject(per) &&
        Object.entries(per).every(([k, v]) => isHeightBucket(k) && isCount(v)),
    )
  ) {
    bad(where);
  }
}

function headProblems(r: Record<string, unknown>, bad: Bad, schema: string, sinceAllowed: boolean): void {
  if (r.schema !== schema) bad('schema');
  for (const k of ['createdAt', 'updatedAt']) if (typeof r[k] !== 'string' || !ISO.test(r[k] as string)) bad(k);
  appProblems(r.app, bad, 'app', sinceAllowed);
}

/** The engine choice, the connection tests and the guard: a build's own (schema 2), the report's (schema 1). */
function stateProblems(r: Record<string, unknown>, bad: Bad, where: string): void {
  const at = (k: string) => (where ? `${where}.${k}` : k);
  const e = r.engine;
  if (e !== null) {
    if (!isObject(e) || Object.keys(e).some((k) => !['committed', 'active', 'reason', 'previousEngine', 'shadowOff'].includes(k))) bad(at('engine'));
    else {
      if (!ENGINES.includes(e.committed as string) || !ENGINES.includes(e.active as string)) bad(at('engine.choice'));
      if (!REASONS.includes(e.reason as string)) bad(at('engine.reason'));
      if (typeof e.previousEngine !== 'boolean' || typeof e.shadowOff !== 'boolean') bad(at('engine.override'));
    }
  }
  if (!Array.isArray(r.connectionTests) || r.connectionTests.length > REPORT_LIST_MAX) bad(at('connectionTests'));
  else {
    for (const t of r.connectionTests) {
      if (
        !isObject(t) ||
        Object.keys(t).some((k) => !['at', 'engine', 'ok', 'ms'].includes(k)) ||
        typeof t.at !== 'string' ||
        !ISO.test(t.at) ||
        !ENGINES.includes(t.engine as string) ||
        typeof t.ok !== 'boolean' ||
        !isCount(t.ms)
      ) {
        bad(at('connectionTests entry'));
      }
    }
  }
  const g = r.guard;
  if (
    !isObject(g) ||
    Object.keys(g).some((k) => !['tripped', 'lastAt'].includes(k)) ||
    !isCount(g.tripped) ||
    !(g.lastAt === null || (typeof g.lastAt === 'string' && ISO.test(g.lastAt)))
  ) {
    bad(at('guard'));
  }
}

/**
 * Everything wrong with a report, by the rule that it holds counts and
 * fixed words only. Empty means it may be written and shared.
 */
export function reportProblems(r: unknown): string[] {
  const out: string[] = [];
  const bad: Bad = (what) => out.push(what);
  if (!isObject(r)) return ['not a report'];
  const known = ['schema', 'createdAt', 'updatedAt', 'app', 'builds'];
  for (const k of Object.keys(r)) if (!known.includes(k)) bad(`unknown entry ${JSON.stringify(k).slice(0, 30)}`);
  headProblems(r, bad, ENGINE_REPORT_SCHEMA, true);
  if (!Array.isArray(r.builds) || r.builds.length > REPORT_BUILDS_MAX) bad('builds');
  else {
    r.builds.forEach((b: unknown, i: number) => {
      const where = `builds.${i}`;
      const keys = ['app', 'since', 'mixed', 'firstAt', 'lastAt', 'engine', 'connectionTests', 'guard', 'sections', 'syncMs', 'heights'];
      if (!isObject(b) || Object.keys(b).some((k) => !keys.includes(k))) {
        bad(where);
        return;
      }
      appProblems(b.app, bad, `${where}.app`, false);
      if (!(b.since === null || (typeof b.since === 'string' && ISO.test(b.since)))) bad(`${where}.since`);
      if ('mixed' in b && b.mixed !== true) bad(`${where}.mixed`);
      for (const k of ['firstAt', 'lastAt']) if (typeof b[k] !== 'string' || !ISO.test(b[k] as string)) bad(`${where}.${k}`);
      stateProblems(b, bad, where);
      sectionsProblems(b.sections, bad, `${where}.sections`);
      syncProblems(b.syncMs, bad, `${where}.syncMs`);
      heightsProblems(b.heights, bad, `${where}.heights`);
    });
  }
  return out;
}

/** A report written before the split by build (schema 1), by that schema's rule. */
function v1Problems(r: Record<string, unknown>): string[] {
  const out: string[] = [];
  const bad: Bad = (what) => out.push(what);
  const known = ['schema', 'createdAt', 'updatedAt', 'app', 'engine', 'connectionTests', 'sections', 'syncMs', 'guard'];
  for (const k of Object.keys(r)) if (!known.includes(k)) bad('unknown entry');
  headProblems(r, bad, ENGINE_REPORT_SCHEMA_V1, false);
  stateProblems(r, bad, '');
  sectionsProblems(r.sections, bad, 'sections');
  syncProblems(r.syncMs, bad, 'syncMs');
  return out;
}

/**
 * A schema 1 report as schema 2: its counts, connection tests, guard and
 * engine choice kept as ONE entry marked `mixed`, since it counted every
 * build from the first of the shadow week on and cannot be told apart by
 * build any more (decided 2026-10-28).
 */
function fromV1(r: Record<string, any>): EngineReport {
  return {
    schema: ENGINE_REPORT_SCHEMA,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    app: { version: r.app.version, build: r.app.build, flavour: r.app.flavour },
    builds: [
      {
        app: { version: r.app.version, build: r.app.build, flavour: r.app.flavour },
        since: null,
        mixed: true,
        firstAt: r.createdAt,
        lastAt: r.updatedAt,
        engine: r.engine,
        connectionTests: capped(r.connectionTests),
        guard: r.guard,
        sections: r.sections,
        syncMs: r.syncMs,
        heights: {},
      },
    ],
  };
}

/** A stored file as a schema 2 report, or null when it cannot be trusted. */
function trustedReport(raw: string): EngineReport | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isObject(parsed) && parsed.schema === ENGINE_REPORT_SCHEMA_V1) {
      if (v1Problems(parsed).length > 0) return null;
      const moved = fromV1(parsed);
      return reportProblems(moved).length === 0 ? moved : null;
    }
    return reportProblems(parsed).length === 0 ? (parsed as EngineReport) : null;
  } catch {
    return null;
  }
}

/** The stored file, or a fresh report when there is none or it cannot be trusted. */
export function parseEngineReport(raw: string | null, app: ReportApp, now: Date): EngineReport {
  return (raw == null ? null : trustedReport(raw)) ?? emptyEngineReport(app, now);
}

/** The schema 1 file as its one `mixed` entry, or null when it is not a trusted schema 1 report. */
function mixedOf(older: string | null): BuildCounts | null {
  if (older == null) return null;
  try {
    const parsed = JSON.parse(older) as unknown;
    if (!isObject(parsed) || parsed.schema !== ENGINE_REPORT_SCHEMA_V1) return null;
    const moved = trustedReport(older);
    return moved ? moved.builds[0] : null;
  } catch {
    return null;
  }
}

/**
 * The report with its `mixed` entry as the schema 1 file has it now. Only a
 * build from before the split writes that file, and it only ever adds to
 * it, so a newer one holds everything the entry held and what such a build
 * counted since (decided 2026-10-28: a co-signing test on a build from
 * before the split counted into the old file, and the new report never saw
 * it). Unchanged when the old file is not newer, cannot be trusted, or
 * holds fewer counts than the entry: that is a file started over, not a
 * later state of it.
 */
function withMixedFrom(report: EngineReport, older: string | null): EngineReport {
  const mixed = mixedOf(older);
  if (!mixed) return report;
  const i = report.builds.findIndex((b) => b.mixed === true);
  const counted = (b: BuildCounts) => REPORT_SECTIONS.reduce((n, s) => n + b.sections[s].total, 0);
  if (i >= 0 && Date.parse(mixed.lastAt) <= Date.parse(report.builds[i].lastAt)) return report;
  if (i >= 0 && counted(mixed) < counted(report.builds[i])) return report;
  const builds = i >= 0 ? report.builds.map((b, j) => (j === i ? mixed : b)) : [mixed, ...report.builds];
  const next = { ...report, builds: keepLatestBuilds(builds) };
  return reportProblems(next).length === 0 ? next : report;
}

/**
 * What a change starts from, given this schema's file (`current`) and the
 * schema 1 file (`older`, null when it is missing or cannot be read). A
 * `current` that cannot be trusted is never written over: `setAside` asks
 * the caller to keep it as a numbered copy first, the way
 * wallet/sealedStore.ts keeps a value it cannot read (decided 2026-10-28; a
 * report written by a later build with a word this one does not know is
 * such a file), and the fresh report starts from the schema 1 file, so the
 * week before the split stays in it. An `older` file that cannot be trusted
 * is simply not carried over, and stays where it is.
 */
export function reportToChange(
  current: string | null,
  older: string | null,
  app: ReportApp,
  now: Date,
): { report: EngineReport; setAside: boolean } {
  const carried = parseEngineReport(older, app, now);
  if (current == null) return { report: carried, setAside: false };
  const report = trustedReport(current);
  return report ? { report: withMixedFrom(report, older), setAside: false } : { report: carried, setAside: true };
}
