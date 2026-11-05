/**
 * BDK upgrade (decided 2026-10-15): the engine report holds
 * counts, the vault's shape class and a field name, and NEVER a descriptor,
 * a key, an address, a transaction or a server, but for a fixed word for
 * each built-in Testnet4 server in reports of the shadow checks (decided
 * 2026-10-30). Since the old engine's removal (decided 2026-11-04) only the address check's
 * verdicts and the connection tests are written; a report written while two
 * engines shipped (engine choices, sync times, height buckets, guard trips,
 * shadow and fallback counts, the servers of failed state jobs) is still
 * read and held to the same rule.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('../../testing/memoryAsyncStorage'));

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ENGINE_REPORT_FILE,
  ENGINE_REPORT_FILE_V1,
  ENGINE_REPORT_SCHEMA,
  ENGINE_REPORT_SCHEMA_V1,
  FIELD_NAME,
  REPORT_BUILDS_MAX,
  REPORT_LIST_MAX,
  SERVER_FIELD,
  SHAPE_CLASSES,
  addressChecksOf,
  buildOf,
  emptyEngineReport,
  parseEngineReport,
  reportProblems,
  reportToChange,
  shapeClassOf,
  withConnectionTest,
  withCount,
  withKnownAnswerFailure,
} from '../engineReport';
import type { BuildCounts, EngineReport } from '../engineReport';
import {
  LIANA_TAPROOT,
  MAINNET_SINGLE_SIG,
  NESTED_SINGLE_SIG,
  SPARROW_SINGLE_SIG,
} from '../../bitcoin/descriptor/__fixtures__/descriptors';
import { bdkShapes } from '../../testing/bdkPolicyMirror';

const APP = { version: '1.1.7', build: '22', flavour: 'full' as const };
const NOW = new Date('2026-10-16T10:00:00.000Z');
/** This build's entry (decided 2026-10-28: every count is filed under the build that made it). */
const mine = (r: EngineReport) => buildOf(r, APP)!;

/**
 * A build's entry as a phone app of the shadow week wrote it (schema 2,
 * before the old engine's removal): its engine choice, a guard trip, sync times on all four
 * lists, height buckets, shadow, preflight and fallback counts, and
 * connection tests answered by both engines. Nothing writes these since.
 */
const SHADOW_WEEK_ENTRY: BuildCounts = {
  app: { version: '1.1.9', build: '24', flavour: 'full' },
  since: '2026-10-25T18:00:00.000Z',
  firstAt: '2026-10-25T18:00:01.000Z',
  lastAt: '2026-10-27T06:47:17.757Z',
  engine: { committed: 'shadow', active: 'shadow', reason: 'committed', previousEngine: false, shadowOff: false },
  connectionTests: [
    { at: '2026-10-25T19:00:00.000Z', engine: 'v028', ok: true, ms: 284 },
    { at: '2026-10-26T19:00:00.000Z', engine: 'v3', ok: false, ms: 15_000 },
  ],
  guard: { tripped: 1, lastAt: '2026-10-26T07:00:00.000Z' },
  sections: {
    shadow: {
      total: 3,
      byOutcome: { mismatch: 1, 'sees-more': 1, compared: 1 },
      byShape: { 'tr-timelocked': { mismatch: 1, 'sees-more': 1, compared: 1 } },
      byField: { 'history.height': 1, isMine: 1, 'shadow.state': 1 },
    },
    preflight: { total: 2, byOutcome: { match: 2 }, byShape: { 'tr-timelocked': { match: 2 } }, byField: { 'scure.address': 2 } },
    fallback: { total: 1, byOutcome: { 'fell-back': 1 }, byShape: { wpkh: { 'fell-back': 1 } }, byField: { knownAnswer: 1 } },
  },
  syncMs: { v028: { 'tr-timelocked': [6105] }, v028Repeat: { 'tr-timelocked': [1860] }, v3: { 'tr-timelocked': [12435] }, v3Repeat: { wpkh: [900] } },
  heights: { 'tr-timelocked': { 'new.gap1.conf0to5.reorgYes.newOnChain.oldOnce': 1 } },
};

/** A report holding the shadow week's entry, as its file would be read back. */
const shadowWeekReport = (): EngineReport => ({
  schema: ENGINE_REPORT_SCHEMA,
  createdAt: '2026-10-25T18:00:01.000Z',
  updatedAt: '2026-10-27T06:47:17.757Z',
  app: { ...SHADOW_WEEK_ENTRY.app, since: SHADOW_WEEK_ENTRY.since! },
  builds: [JSON.parse(JSON.stringify(SHADOW_WEEK_ENTRY))],
});

describe('a vault becomes its shape, never its keys', () => {
  it('classes every shape the fixtures hold', () => {
    const got = Object.fromEntries(bdkShapes().map(([name, s]) => [name, shapeClassOf(s.descriptorExternal)]));
    expect(got).toEqual({
      'wsh-sortedmulti-2of3': 'wsh-sortedmulti',
      'tr-nums-multi_a-2of3': 'tr-multi',
      'wsh-layered-older': 'wsh-timelocked',
      'wsh-after': 'wsh-timelocked',
      'tr-nums-layered-older': 'tr-timelocked',
      'tr-liana-keypath-older': 'tr-timelocked',
    });
    expect(shapeClassOf(MAINNET_SINGLE_SIG)).toBe('wpkh');
    expect(shapeClassOf(SPARROW_SINGLE_SIG)).toBe('wpkh');
    expect(shapeClassOf(NESTED_SINGLE_SIG)).toBe('sh-wpkh');
    expect(shapeClassOf(LIANA_TAPROOT)).toBe('tr-timelocked');
    expect(shapeClassOf('pkh(xpub)')).toBe('pkh');
    expect(shapeClassOf('tr(xpub)')).toBe('tr-key');
    expect(shapeClassOf('sh(wsh(sortedmulti(2,a,b)))')).toBe('sh-wsh');
    expect(shapeClassOf('sh(sortedmulti(2,a,b))')).toBe('sh-multi');
    expect(shapeClassOf('wsh(multi(2,a,b))')).toBe('wsh-multi');
    expect(shapeClassOf('anything else')).toBe('other');
    for (const name of bdkShapes().map(([, s]) => shapeClassOf(s.descriptorExternal))) {
      expect(SHAPE_CLASSES).toContain(name);
    }
  });
});

describe('the report', () => {
  it('starts empty and clean', () => {
    const r = emptyEngineReport(APP, NOW);
    expect(r.schema).toBe(ENGINE_REPORT_SCHEMA);
    expect(r.builds).toEqual([]);
    expect(reportProblems(r)).toEqual([]);
  });

  it('records each connection test, answered by the one engine, and the address check\'s counts', () => {
    let r = emptyEngineReport(APP, NOW);
    r = withConnectionTest(r, { height: 903_117, ms: 812.4, at: NOW.getTime() }, APP, NOW);
    r = withConnectionTest(r, { height: null, ms: 15_000, at: NOW.getTime() }, APP, NOW);
    r = withCount(r, 'preflight', { shape: 'wsh-timelocked', outcome: 'mismatch', field: 'scure.shown' }, APP, NOW);
    r = withCount(r, 'preflight', { shape: 'wsh-timelocked', outcome: 'match', field: 'scure.address' }, APP, NOW);
    expect(mine(r).engine).toBeNull();
    expect(mine(r).connectionTests).toEqual([
      { at: NOW.toISOString(), engine: 'v3', ok: true, ms: 812 },
      { at: NOW.toISOString(), engine: 'v3', ok: false, ms: 15_000 },
    ]);
    expect(mine(r).sections.preflight).toEqual({
      total: 2,
      byOutcome: { mismatch: 1, match: 1 },
      byShape: { 'wsh-timelocked': { mismatch: 1, match: 1 } },
      byField: { 'scure.shown': 1, 'scure.address': 1 },
    });
    expect(mine(r).sections.shadow.total).toBe(0);
    expect(mine(r).sections.fallback.total).toBe(0);
    expect(mine(r).syncMs).toEqual({});
    expect(mine(r).heights).toEqual({});
    expect(mine(r).guard).toEqual({ tripped: 0, lastAt: null });
    expect(reportProblems(r)).toEqual([]);
    // Round trip through the file.
    expect(parseEngineReport(JSON.stringify(r), APP, NOW)).toEqual(r);
  });

  it("reads the address check's verdicts back: every match and mismatch is a check, a failed known-answer test is none", () => {
    expect(addressChecksOf(undefined)).toEqual({ checks: 0, mismatches: 0 });
    let r = emptyEngineReport(APP, NOW);
    r = withCount(r, 'preflight', { shape: 'wpkh', outcome: 'match', field: 'scure.address' }, APP, NOW);
    r = withCount(r, 'preflight', { shape: 'wpkh', outcome: 'match', field: 'scure.proven' }, APP, NOW);
    r = withCount(r, 'preflight', { shape: 'tr-timelocked', outcome: 'match', field: 'scure.proven' }, APP, NOW);
    r = withCount(r, 'preflight', { shape: 'wpkh', outcome: 'mismatch', field: 'scure.output' }, APP, NOW);
    r = withKnownAnswerFailure(r, null, APP, NOW);
    expect(addressChecksOf(mine(r))).toEqual({ checks: 4, mismatches: 1 });
    expect(mine(r).sections.preflight.byField).toEqual({
      'scure.address': 1,
      'scure.proven': 2,
      'scure.output': 1,
      'library.knownAnswer': 1,
    });
    expect(reportProblems(r)).toEqual([]);
  });

  it('keeps the latest connection tests', () => {
    let r = emptyEngineReport(APP, NOW);
    for (let i = 0; i < REPORT_LIST_MAX + 3; i++) {
      r = withConnectionTest(r, { height: i, ms: i, at: NOW.getTime() }, APP, NOW);
    }
    expect(mine(r).connectionTests).toHaveLength(REPORT_LIST_MAX);
    expect(mine(r).connectionTests[0].ms).toBe(3);
  });

  it('reads a report written while two engines shipped, and counts on beside it', () => {
    const before = shadowWeekReport();
    expect(reportProblems(before)).toEqual([]);
    expect(parseEngineReport(JSON.stringify(before), APP, NOW)).toEqual(before);
    let r = withConnectionTest(before, { height: 5, ms: 300, at: NOW.getTime() }, APP, NOW);
    r = withCount(r, 'preflight', { shape: 'wpkh', outcome: 'match', field: 'scure.address' }, APP, NOW);
    expect(r.builds[0]).toEqual(SHADOW_WEEK_ENTRY);
    expect(mine(r).connectionTests).toEqual([{ at: NOW.toISOString(), engine: 'v3', ok: true, ms: 300 }]);
    expect(reportProblems(r)).toEqual([]);
    // Its words are still held to the fixed lists.
    expect(reportProblems({ ...before, builds: [{ ...SHADOW_WEEK_ENTRY, syncMs: { v4: { wpkh: [1] } } }] })).not.toEqual([]);
    expect(reportProblems({ ...before, builds: [{ ...SHADOW_WEEK_ENTRY, engine: { ...SHADOW_WEEK_ENTRY.engine!, active: 'v4' } }] })).not.toEqual([]);
  });

  it('a field is a short name, never a value', () => {
    const r = emptyEngineReport(APP, NOW);
    // The xpub is synthetic: the placeholder XPUB_A's header and chain code
    // with a valid public key put in (descriptors.ts), nobody's wallet.
    for (const field of ['tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz', 'a b', 'Balance', 'a.b.c.d.e', 'shadow.state.sync.COVERAGE_INCOMPLETE']) {
      expect(() => withCount(r, 'shadow', { shape: 'wpkh', outcome: 'mismatch', field }, APP, NOW)).toThrow();
    }
    // A failed state job's step and class (decided 2026-10-25): four short words.
    const counted = withCount(r, 'shadow', { shape: 'tr-timelocked', outcome: 'error', field: 'shadow.state.sync.coverageIncomplete' }, APP, NOW);
    expect(mine(counted).sections.shadow.byField).toEqual({ 'shadow.state.sync.coverageIncomplete': 1 });
    expect(reportProblems(counted)).toEqual([]);
  });

  it('refuses, before it is written, anything that is not a count or a fixed word', () => {
    const clean = shadowWeekReport();
    const tamper = (fn: (r: Record<string, any>) => void) => {
      const r = JSON.parse(JSON.stringify(clean));
      fn(r);
      return reportProblems(r);
    };
    expect(tamper((r) => (r.descriptor = MAINNET_SINGLE_SIG))).not.toEqual([]);
    expect(tamper((r) => (r.app.version = MAINNET_SINGLE_SIG))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].connectionTests = [{ at: NOW.toISOString(), engine: 'v3', ok: true, ms: 1, server: 'ssl://my.node:50002' }]))).not.toEqual([]);
    // Nothing counted stands outside a build's entry any more (decided 2026-10-28).
    expect(tamper((r) => (r.connectionTests = []))).not.toEqual([]);
    expect(tamper((r) => (r.guard = { tripped: 0, lastAt: null }))).not.toEqual([]);
    expect(tamper((r) => (r.engine = null))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].sections.shadow.byField = { 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx': 1 }))).not.toEqual([]);
    // A section holds its four counts and nothing beside them (decided 2026-10-28).
    expect(tamper((r) => (r.builds[0].sections.shadow.txid = 'f4184fc596403b9d638783cf57adfe4c75c605f6356fbc91338530e9831e9e16'))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].sections.shadow.byShape = { [LIANA_TAPROOT]: { match: 1 } }))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].syncMs = { v028: { wpkh: ['slow'] } }))).not.toEqual([]);
    // A build is known by fixed words and dates only (decided 2026-10-28).
    expect(tamper((r) => (r.builds[0].since = '/var/containers/Bundle/Application/ABC'))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].app.since = NOW.toISOString()))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].mixed = false))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].commit = 'abc1234'))).not.toEqual([]);
    expect(tamper((r) => (r.app.since = 'yesterday'))).not.toEqual([]);
    // A height bucket is five fixed words, never a txid, a height or a time.
    expect(tamper((r) => (r.builds[0].heights = { 'tr-timelocked': { 'new.gap1.conf0to5.reorgYes.newOnChain.oldOnce': 1 } }))).toEqual([]);
    expect(tamper((r) => (r.builds[0].heights = { 'tr-timelocked': { ['a'.repeat(64)]: 1 } }))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].heights = { 'tr-timelocked': { 'new.gap1.conf0to5.reorgYes': 1 } }))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].heights = { 'tr-timelocked': { 'new.gap1.conf0to5.reorgYes.newOnChain.812345': 1 } }))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].heights = { [LIANA_TAPROOT]: {} }))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].heights = { wpkh: { 'same.gap0.conf6plus.reorgNo.newOnChain.oldOnce': -1 } }))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].engine.reason = 'because'))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].guard.lastAt = 'yesterday'))).not.toEqual([]);
    expect(tamper((r) => (r.builds[0].guard.server = 'ssl://my.node:50002'))).not.toEqual([]);
    expect(tamper(() => undefined)).toEqual([]);
  });

  it('a stored file that breaks the rule, or is not JSON, starts over', () => {
    const fresh = parseEngineReport('{"schema":"talia-engine-report/1","xpub":"x"}', APP, NOW);
    expect(fresh).toEqual(emptyEngineReport(APP, NOW));
    expect(parseEngineReport('not json', APP, NOW)).toEqual(emptyEngineReport(APP, NOW));
    expect(parseEngineReport(null, APP, NOW)).toEqual(emptyEngineReport(APP, NOW));
  });
});

// Decided 2026-10-28: the shadow week's report counted every build since the
// first one together, so a fixed build's numbers were read with the old
// one's. Each build now has its own entry, known by when its install first ran.
describe('the report by build', () => {
  const first = { ...APP, since: '2026-10-25T18:00:00.000Z' };
  const second = { ...APP, since: '2026-10-26T06:19:00.000Z' };

  it('files each count and connection test under the build that made it', () => {
    let r = emptyEngineReport(first, NOW);
    r = withCount(r, 'preflight', { shape: 'tr-timelocked', outcome: 'mismatch', field: 'scure.address' }, first, NOW);
    r = withConnectionTest(r, { height: 5, ms: 300, at: NOW.getTime() }, first, NOW);
    // The same version and build number, installed again: another build.
    const later = new Date('2026-10-29T10:00:00.000Z');
    r = withCount(r, 'preflight', { shape: 'tr-timelocked', outcome: 'match', field: 'scure.address' }, second, later);
    expect(r.builds.map((b) => b.since)).toEqual([first.since, second.since]);
    expect(buildOf(r, first)!.sections.preflight.byOutcome).toEqual({ mismatch: 1 });
    expect(buildOf(r, first)!.connectionTests).toHaveLength(1);
    expect(buildOf(r, second)!.sections.preflight.byOutcome).toEqual({ match: 1 });
    expect(buildOf(r, second)!.connectionTests).toEqual([]);
    expect(buildOf(r, second)!.engine).toBeNull();
    expect(r.app).toEqual(second);
    expect(Object.keys(r).sort()).toEqual(['app', 'builds', 'createdAt', 'schema', 'updatedAt']);
    expect(reportProblems(r)).toEqual([]);
    expect(parseEngineReport(JSON.stringify(r), second, later)).toEqual(r);
  });

  it('a build that cannot tell when it was installed is known by its version and build number', () => {
    let r = withCount(emptyEngineReport(APP, NOW), 'fallback', { shape: 'wpkh', outcome: 'fell-back', field: 'open' }, APP, NOW);
    r = withCount(r, 'fallback', { shape: 'wpkh', outcome: 'fell-back', field: 'open' }, APP, NOW);
    expect(r.builds).toHaveLength(1);
    expect(r.builds[0].since).toBeNull();
    expect(r.builds[0].sections.fallback.total).toBe(2);
    expect(reportProblems(r)).toEqual([]);
  });

  it('keeps the latest builds', () => {
    let r = emptyEngineReport(APP, NOW);
    for (let i = 0; i < REPORT_BUILDS_MAX + 2; i++) {
      const app = { ...APP, since: new Date(NOW.getTime() + i * 60_000).toISOString() };
      r = withCount(r, 'shadow', { shape: 'wpkh', outcome: 'compared', field: 'shadow.state' }, app, NOW);
    }
    expect(r.builds).toHaveLength(REPORT_BUILDS_MAX);
    expect(r.builds[0].since).toBe(new Date(NOW.getTime() + 2 * 60_000).toISOString());
    expect(reportProblems(r)).toEqual([]);
  });

  it('drops the oldest builds past the cap, never the mixed entry', () => {
    const v1 = {
      schema: 'talia-engine-report/1',
      createdAt: '2026-10-17T08:27:55.552Z',
      updatedAt: '2026-10-27T06:47:17.757Z',
      app: { version: '1.1.8', build: '23', flavour: 'full' },
      engine: null,
      connectionTests: [],
      sections: {
        shadow: { total: 1, byOutcome: { compared: 1 }, byShape: { wpkh: { compared: 1 } }, byField: { 'shadow.state': 1 } },
        preflight: { total: 0, byOutcome: {}, byShape: {}, byField: {} },
        fallback: { total: 0, byOutcome: {}, byShape: {}, byField: {} },
      },
      syncMs: {},
      guard: { tripped: 0, lastAt: null },
    };
    let r = parseEngineReport(JSON.stringify(v1), APP, NOW);
    expect(r.builds[0].mixed).toBe(true);
    for (let i = 0; i < REPORT_BUILDS_MAX + 3; i++) {
      const app = { ...APP, since: new Date(NOW.getTime() + i * 60_000).toISOString() };
      r = withCount(r, 'shadow', { shape: 'wpkh', outcome: 'compared', field: 'shadow.state' }, app, NOW);
    }
    expect(r.builds).toHaveLength(REPORT_BUILDS_MAX);
    expect(r.builds[0].mixed).toBe(true);
    expect(r.builds[0].sections.shadow.total).toBe(1);
    expect(r.builds[1].since).toBe(new Date(NOW.getTime() + 4 * 60_000).toISOString());
    expect(reportProblems(r)).toEqual([]);
  });

  it('keeps a report written before the split as one entry, marked mixed, and counts on beside it', () => {
    const v1 = {
      schema: 'talia-engine-report/1',
      createdAt: '2026-10-17T08:27:55.552Z',
      updatedAt: '2026-10-27T06:47:17.757Z',
      app: { version: '1.1.8', build: '23', flavour: 'full' },
      engine: { committed: 'shadow', active: 'shadow', reason: 'committed', previousEngine: false, shadowOff: false },
      connectionTests: [{ at: '2026-10-22T15:36:28.656Z', engine: 'v028', ok: true, ms: 284 }],
      sections: {
        shadow: {
          total: 26,
          byOutcome: { mismatch: 13, 'sees-more': 12, compared: 1 },
          byShape: { 'tr-timelocked': { mismatch: 10, 'sees-more': 12, compared: 1 }, wpkh: { mismatch: 2 }, 'wsh-sortedmulti': { mismatch: 1 } },
          byField: { 'history.height': 13, isMine: 12, 'shadow.state': 1 },
        },
        preflight: { total: 15, byOutcome: { match: 15 }, byShape: { 'tr-timelocked': { match: 15 } }, byField: { 'scure.address': 15 } },
        fallback: { total: 0, byOutcome: {}, byShape: {}, byField: {} },
      },
      syncMs: { v028: { 'tr-timelocked': [6105, 5672] }, v3: { 'tr-timelocked': [12435] }, v028Repeat: { 'tr-timelocked': [1860] } },
      guard: { tripped: 0, lastAt: null },
    };
    const now = new Date('2026-10-29T10:00:00.000Z');
    const r = parseEngineReport(JSON.stringify(v1), second, now);
    expect(reportProblems(r)).toEqual([]);
    expect(r.schema).toBe(ENGINE_REPORT_SCHEMA);
    expect(r.createdAt).toBe(v1.createdAt);
    expect(r.builds).toEqual([
      {
        app: v1.app,
        since: null,
        mixed: true,
        firstAt: v1.createdAt,
        lastAt: v1.updatedAt,
        engine: v1.engine,
        connectionTests: v1.connectionTests,
        guard: v1.guard,
        sections: v1.sections,
        syncMs: v1.syncMs,
        heights: {},
      },
    ]);
    // The next count goes into the build that makes it, never into the mixed entry.
    const next = withCount(r, 'shadow', { shape: 'wpkh', outcome: 'compared', field: 'shadow.state' }, second, now);
    expect(next.builds).toHaveLength(2);
    expect(next.builds[0]).toEqual(r.builds[0]);
    expect(buildOf(next, second)!.sections.shadow.byOutcome).toEqual({ compared: 1 });
    // Even the build the mixed entry names counts apart from it.
    const same = withCount(r, 'shadow', { shape: 'wpkh', outcome: 'compared', field: 'shadow.state' }, { ...v1.app, flavour: 'full' }, now);
    expect(same.builds).toHaveLength(2);
    // A schema 1 report that breaks its own rule is not carried over.
    expect(parseEngineReport(JSON.stringify({ ...v1, xpub: 'x' }), second, now)).toEqual(emptyEngineReport(second, now));
    expect(parseEngineReport(JSON.stringify({ ...v1, sections: { ...v1.sections, shadow: { ...v1.sections.shadow, byField: { [LIANA_TAPROOT]: 1 } } } }), second, now)).toEqual(
      emptyEngineReport(second, now),
    );
  });
});

// Decided 2026-10-28: a build from before the split, installed after one
// with it, read the schema 2 file as broken and wrote an empty schema 1
// report over it. Schema 2 has a file of its own, the old file is only read,
// and a file this build cannot trust is set aside, never written over.
describe('the file a change starts from', () => {
  const v1 = JSON.stringify({
    schema: 'talia-engine-report/1',
    createdAt: '2026-10-17T08:27:55.552Z',
    updatedAt: '2026-10-27T06:47:17.757Z',
    app: { version: '1.1.8', build: '23', flavour: 'full' },
    engine: null,
    connectionTests: [],
    sections: {
      shadow: { total: 2, byOutcome: { mismatch: 2 }, byShape: { wpkh: { mismatch: 2 } }, byField: { 'history.height': 2 } },
      preflight: { total: 0, byOutcome: {}, byShape: {}, byField: {} },
      fallback: { total: 0, byOutcome: {}, byShape: {}, byField: {} },
    },
    syncMs: {},
    guard: { tripped: 0, lastAt: null },
  });

  it('has a name of its own, apart from the schema 1 file', () => {
    expect(ENGINE_REPORT_FILE).not.toBe(ENGINE_REPORT_FILE_V1);
  });

  const mixedOf = (raw: string) => parseEngineReport(raw, APP, NOW).builds[0];
  const count = (r: EngineReport) =>
    withCount(r, 'shadow', { shape: 'wpkh', outcome: 'compared', field: 'shadow.state' }, { ...APP, since: '2026-10-29T08:00:00.000Z' }, NOW);

  it('starts from this schema\'s file when there is one', () => {
    const mine = count(parseEngineReport(v1, APP, NOW));
    expect(reportToChange(JSON.stringify(mine), v1, APP, NOW)).toEqual({ report: mine, setAside: false });
    expect(reportToChange(JSON.stringify(mine), null, APP, NOW)).toEqual({ report: mine, setAside: false });
  });

  it('carries the old file over while this schema\'s file does not exist', () => {
    const start = reportToChange(null, v1, APP, NOW);
    expect(start.setAside).toBe(false);
    expect(start.report.builds).toHaveLength(1);
    expect(start.report.builds[0].mixed).toBe(true);
    expect(start.report.builds[0].sections.shadow.total).toBe(2);
    expect(reportToChange(null, null, APP, NOW)).toEqual({ report: emptyEngineReport(APP, NOW), setAside: false });
  });

  it('keeps the mixed entry as the old file has it, when a build from before the split counted on in it', () => {
    const mine = count(parseEngineReport(v1, APP, NOW));
    const later = JSON.parse(v1);
    later.updatedAt = '2026-10-30T09:00:00.000Z';
    later.sections.shadow.total = 3;
    later.sections.shadow.byOutcome.mismatch = 3;
    later.sections.shadow.byShape.wpkh.mismatch = 3;
    later.sections.shadow.byField['history.height'] = 3;
    const start = reportToChange(JSON.stringify(mine), JSON.stringify(later), APP, NOW);
    expect(start.setAside).toBe(false);
    expect(start.report.builds).toHaveLength(2);
    expect(start.report.builds[0]).toEqual(mixedOf(JSON.stringify(later)));
    expect(start.report.builds[1]).toEqual(mine.builds[1]);
    expect(reportProblems(start.report)).toEqual([]);
    // A report begun on a phone with no old file takes it in once one appears.
    const fresh = count(emptyEngineReport(APP, NOW));
    const joined = reportToChange(JSON.stringify(fresh), v1, APP, NOW).report;
    expect(joined.builds.map((b) => b.mixed === true)).toEqual([true, false]);
    // An old file that cannot be trusted changes nothing.
    expect(reportToChange(JSON.stringify(mine), JSON.stringify({ ...later, xpub: 'x' }), APP, NOW).report).toEqual(mine);
    // Nor does one started over: newer, but holding fewer counts than the entry.
    const reset = JSON.parse(v1);
    reset.updatedAt = '2026-10-30T09:00:00.000Z';
    reset.sections.shadow = { total: 0, byOutcome: {}, byShape: {}, byField: {} };
    expect(reportToChange(JSON.stringify(mine), JSON.stringify(reset), APP, NOW).report).toEqual(mine);
  });

  it('sets aside a file of its own it cannot trust and starts again from the old file, which it leaves where it is', () => {
    const later = JSON.stringify({ schema: 'talia-engine-report/3', builds: [] });
    const start = reportToChange(later, v1, APP, NOW);
    expect(start.setAside).toBe(true);
    expect(start.report.builds).toEqual([mixedOf(v1)]);
    expect(reportToChange('not json', null, APP, NOW)).toEqual({ report: emptyEngineReport(APP, NOW), setAside: true });
    expect(reportToChange(null, 'not json', APP, NOW)).toEqual({ report: emptyEngineReport(APP, NOW), setAside: false });
  });

  it('never writes or removes the old file, and never writes over a file it could not read', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'platform', 'engineReportFile.ts'), 'utf8');
    const uses = src.match(/ENGINE_REPORT_FILE_V1/g) ?? [];
    // The import and the one read.
    expect(uses).toHaveLength(2);
    expect(src).toContain('await readStored(ENGINE_REPORT_FILE_V1)');
    expect(src).not.toMatch(/unlink\(/);
    // Reading this schema's file throws when it is there and cannot be read.
    const readStored = src.slice(src.indexOf('async function readStored'), src.indexOf('\n}\n', src.indexOf('async function readStored')));
    expect(readStored).not.toMatch(/catch/);
    expect(src).toContain('const current = await readStored(ENGINE_REPORT_FILE);');
    // The copy is made before the write, and only when asked.
    expect(src.indexOf('if (start.setAside) await setAsideCurrent();')).toBeGreaterThan(-1);
    expect(src.indexOf('if (start.setAside) await setAsideCurrent();')).toBeLessThan(src.indexOf('await RNFS.writeFile(engineReportPath()'));
  });
});

// Decided 2026-10-30: a failed state job of the shadow checks said which
// server it used and whether the server refused, as fixed words, on the same
// count. Nothing writes them since the old engine's removal (decided 2026-11-04); a report
// holding them reads as it was written.
describe('the server of a failed state job, in a report written before 2026-11-04', () => {
  /** The shadow week's entry with two failed state jobs, each naming its server. */
  const withServers = (): EngineReport => {
    const r = shadowWeekReport();
    r.builds[0].sections.shadow = {
      total: 2,
      byOutcome: { error: 2 },
      byShape: { 'tr-multi': { error: 2 } },
      byField: {
        'shadow.state.sync.network': 2,
        'shadow.stateServer.mempool.refused': 1,
        'shadow.stateServer.other.other': 1,
      },
    };
    return r;
  };

  it('reads as written: one more field on the same count, so the failures were never counted twice', () => {
    const r = withServers();
    expect(reportProblems(r)).toEqual([]);
    expect(parseEngineReport(JSON.stringify(r), APP, NOW)).toEqual(r);
    // And a new count lands beside it.
    const next = withCount(r, 'preflight', { shape: 'wpkh', outcome: 'match', field: 'scure.address' }, APP, NOW);
    expect(next.builds[0]).toEqual(withServers().builds[0]);
    expect(reportProblems(next)).toEqual([]);
  });

  it('fits the four words a field may have, so a build from before reads the report as it is', () => {
    expect(FIELD_NAME.source).toBe('^[a-z][a-zA-Z0-9]{0,23}(\\.[a-z][a-zA-Z0-9]{0,23}){0,3}$');
    for (const server of ['blackie', 'mempool', 'stagemole', 'other']) {
      for (const how of ['refused', 'other']) {
        const field = `shadow.stateServer.${server}.${how}`;
        expect(FIELD_NAME.test(field)).toBe(true);
        expect(SERVER_FIELD.test(field)).toBe(true);
      }
    }
  });

  it.each([
    'shadow.stateServer.electrumBlockstreamInfo.refused',
    'shadow.stateServer.myHomeNode.refused',
    'shadow.stateServer.mempool.timeout',
  ])('refuses any other word in a file: %s', (field) => {
    expect(FIELD_NAME.test(field)).toBe(true);
    const written = JSON.parse(JSON.stringify(withServers()).replace('shadow.stateServer.mempool.refused', field));
    expect(reportProblems(written).length).toBeGreaterThan(0);
  });

  it('is never written again: a count that names a server is refused, a built-in one too', () => {
    for (const field of ['shadow.stateServer.mempool.refused', 'shadow.stateServer.myHomeNode.refused']) {
      expect(() => withCount(emptyEngineReport(APP, NOW), 'shadow', { shape: 'tr-multi', outcome: 'error', field }, APP, NOW)).toThrow();
    }
    expect(() =>
      withCount(emptyEngineReport(APP, NOW), 'shadow', { shape: 'tr-multi', outcome: 'error', field: 'ssl://192.0.2.7:50002' }, APP, NOW),
    ).toThrow();
  });

  it('a report from before the field reads as it always did, schema 1 and schema 2 alike', () => {
    const before = withCount(emptyEngineReport(APP, NOW), 'shadow', { shape: 'wpkh', outcome: 'error', field: 'shadow.state.sync.network' }, APP, NOW);
    expect(parseEngineReport(JSON.stringify(before), APP, NOW)).toEqual(before);
    const v1 = {
      schema: ENGINE_REPORT_SCHEMA_V1,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      app: { version: APP.version, build: APP.build, flavour: APP.flavour },
      engine: null,
      connectionTests: [],
      guard: { tripped: 0, lastAt: null },
      sections: mine(before).sections,
      syncMs: {},
    };
    const carried = parseEngineReport(JSON.stringify(v1), APP, NOW);
    expect(carried.builds[0].mixed).toBe(true);
    expect(carried.builds[0].sections.shadow.byField).toEqual({ 'shadow.state.sync.network': 1 });
    // And a new count lands beside it.
    const next = withCount(carried, 'preflight', { shape: 'wpkh', outcome: 'match', field: 'scure.address' }, APP, NOW);
    expect(reportProblems(next)).toEqual([]);
  });
});
