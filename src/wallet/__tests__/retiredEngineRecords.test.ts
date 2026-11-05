/**
 * The removed engine features' records, deleted at launch (the old engine's
 * removal, decided 2026-11-04), and the known-answer failure's count.
 */
import { forgetRetiredEngineRecords, isRetiredEngineRecord } from '../retiredEngineRecords';
import { buildOf, emptyEngineReport, KNOWN_ANSWER_FIELD, reportProblems, withKnownAnswerFailure } from '../engineReport';
import type { ReportApp } from '../engineReport';

describe('which records go', () => {
  it('the names the removed modules wrote, for every flavour, and set-aside copies of the sealed one', () => {
    for (const name of [
      'keel.engineOverride.v1',
      'keel.shadowGuard.v1',
      'keel.engineChecks.v1',
      'keel.reportOnlyGuard.v1.full',
      'keel.reportOnlyGuard.v1.signing',
      'keel.reportOnlyGuard.v1.store',
      'keel.reportOnlyOff.v1.store',
      'talia.reportOnly.checked.v1.signing',
      'talia.reportOnly.checked.v1.store',
      'talia.reportOnly.checked.v1.store.unreadable',
      'talia.reportOnly.checked.v1.store.unreadable.3',
    ]) {
      expect([name, isRetiredEngineRecord(name)]).toEqual([name, true]);
    }
  });

  it('never a record the app still reads', () => {
    for (const name of [
      'keel.wallets.v1',
      'keel.settings.v2',
      'keel.engineReport.install.v1',
      'talia.addressCheck.proven.v1',
      'talia.sealed.check.v1',
      'keel.engineOverride.v2',
      'keel.engineChecks.v1.extra',
    ]) {
      expect([name, isRetiredEngineRecord(name)]).toEqual([name, false]);
    }
  });
});

describe('the clean-up', () => {
  it('a storage that cannot be read removes nothing and never throws', async () => {
    await expect(
      forgetRetiredEngineRecords({
        getAllKeys: async () => {
          throw new Error('locked');
        },
        removeItem: async () => undefined,
      }),
    ).resolves.toBe(0);
  });

  it('a removal that fails leaves the rest going (the next launch tries it again)', async () => {
    const removed: string[] = [];
    const n = await forgetRetiredEngineRecords({
      getAllKeys: async () => ['keel.shadowGuard.v1', 'keel.wallets.v1', 'keel.engineChecks.v1'],
      removeItem: async (k) => {
        if (k === 'keel.shadowGuard.v1') throw new Error('busy');
        removed.push(k);
      },
    });
    expect([n, removed]).toEqual([1, ['keel.engineChecks.v1']]);
  });
});

describe('a failed known-answer test in the report', () => {
  const APP: ReportApp = { version: '1.1.9', build: '24', flavour: 'signing' };
  const now = new Date('2026-10-29T09:00:00Z');

  it('one error under library.knownAnswer, filed under the vault\'s shape class, or other when none was named', () => {
    const r = withKnownAnswerFailure(
      withKnownAnswerFailure(emptyEngineReport(APP, now), 'tr([73c5da0a/86h/1h/0h]tpubX/0/*)', APP, now),
      null,
      APP,
      now,
    );
    const s = buildOf(r, APP)!.sections.preflight;
    expect(s).toEqual({
      total: 2,
      byOutcome: { error: 2 },
      byShape: { 'tr-key': { error: 1 }, other: { error: 1 } },
      byField: { [KNOWN_ANSWER_FIELD]: 2 },
    });
    expect(JSON.stringify(r)).not.toContain('73c5da0a');
    expect(reportProblems(r)).toEqual([]);
  });
});
