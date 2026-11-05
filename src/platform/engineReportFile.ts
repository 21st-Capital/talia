/**
 * The engine report on disk (BDK upgrade, decided 2026-10-15; the format
 * and its privacy rule are wallet/engineReport.ts).
 *
 * The file lives in the app's Documents folder, where a developer reads it
 * from a Mac with `xcrun devicectl device copy from --domain-type
 * appDataContainer` and nobody has to send it. Every write is read, changed and
 * written in turn (one at a time), refused when the result breaks the
 * privacy rule, and never throws at the caller: a report that cannot be
 * written is a report with one entry fewer, never a broken screen. Every
 * change is handed this build's identity (`reportApp`: the version, build
 * number, flavour and when this install first ran, decided 2026-10-28), so
 * its counts go into this build's entry of the report. Schema 2 lives in a
 * file of its own and the schema 1 file is only read, never written or
 * removed (decided 2026-10-28; wallet/engineReport.ts `ENGINE_REPORT_FILE`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';
import { APP_BUILD, APP_VERSION, BUILD_FLAVOUR } from '../config';
import {
  ENGINE_REPORT_FILE,
  ENGINE_REPORT_FILE_V1,
  emptyEngineReport,
  reportProblems,
  reportToChange,
} from '../wallet/engineReport';
import type { EngineReport, ReportApp } from '../wallet/engineReport';
import { exportTextToFile } from './files';
import { installSince } from '../wallet/reportInstall';

export const REPORT_APP: ReportApp = { version: APP_VERSION, build: APP_BUILD, flavour: BUILD_FLAVOUR };

let app: Promise<ReportApp> | null = null;

/** This build as the report knows it: REPORT_APP and when this install first ran (wallet/reportInstall.ts). */
export function reportApp(): Promise<ReportApp> {
  if (!app) {
    app = installSince(AsyncStorage, RNFS.MainBundlePath, new Date())
      .then((since) => (since ? { ...REPORT_APP, since } : REPORT_APP))
      .catch(() => REPORT_APP);
  }
  return app;
}

const pathOf = (name: string): string => `${RNFS.DocumentDirectoryPath}/${name}`;

export function engineReportPath(): string {
  return pathOf(ENGINE_REPORT_FILE);
}

/** A file's text, or null when there is no such file. THROWS when it is there and cannot be read. */
async function readStored(name: string): Promise<string | null> {
  const path = pathOf(name);
  if (!(await RNFS.exists(path))) return null;
  return RNFS.readFile(path, 'utf8');
}

/**
 * This schema's file and the schema 1 file (`reportToChange`). This
 * schema's file that is there but cannot be read throws, so nothing is
 * written over it; a schema 1 file that cannot be read is only not carried
 * over (this build never writes it).
 */
async function startOfChange(app: ReportApp, now: Date): Promise<{ report: EngineReport; setAside: boolean }> {
  const current = await readStored(ENGINE_REPORT_FILE);
  const older = await readStored(ENGINE_REPORT_FILE_V1).catch(() => null);
  return reportToChange(current, older, app, now);
}

/** The most numbered copies of a file that could not be trusted. */
const SET_ASIDE_MAX = 99;

/**
 * This schema's file, moved to the first free numbered copy beside it. THROWS
 * when it cannot be moved or every number is taken, so the caller writes
 * nothing over it.
 */
async function setAsideCurrent(): Promise<void> {
  const stem = ENGINE_REPORT_FILE.replace(/\.json$/, '');
  for (let n = 1; n <= SET_ASIDE_MAX; n++) {
    const copy = pathOf(`${stem}.unreadable-${n}.json`);
    if (!(await RNFS.exists(copy))) {
      await RNFS.moveFile(engineReportPath(), copy);
      return;
    }
  }
  throw new Error('no free copy');
}

/** The report as it stands (a fresh one when there is none or it cannot be read). */
export async function readEngineReport(): Promise<EngineReport> {
  const app = await reportApp();
  const now = new Date();
  try {
    return (await startOfChange(app, now)).report;
  } catch {
    return emptyEngineReport(app, now);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Change the report and write it back; null when nothing was written.
 * `change` is handed this build (`reportApp`), which every count must be
 * filed under. Nothing is written when the stored report cannot be read, and
 * one that cannot be trusted is kept as a numbered copy before a fresh one
 * is written (decided 2026-10-28).
 */
export function updateEngineReport(change: (r: EngineReport, app: ReportApp) => EngineReport): Promise<EngineReport | null> {
  const run = queue.then(async () => {
    try {
      const app = await reportApp();
      const start = await startOfChange(app, new Date());
      const next = change(start.report, app);
      if (reportProblems(next).length > 0) return null;
      if (start.setAside) await setAsideCurrent();
      await RNFS.writeFile(engineReportPath(), JSON.stringify(next, null, 2), 'utf8');
      return next;
    } catch {
      return null;
    }
  });
  queue = run.catch(() => null);
  return run;
}

/** "Share report": a copy for the share sheet, gone once the sheet closes. */
export async function shareEngineReport(): Promise<void> {
  const report = await readEngineReport();
  await exportTextToFile(ENGINE_REPORT_FILE, JSON.stringify(report, null, 2));
}
