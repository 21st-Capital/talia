/**
 * The warning-only npm audit in CI (decided 2026-10-07): it
 * reports, and it can never turn a run red, because a red run sends an email.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const summary = require('../npm-audit-summary.js') as {
  readAudit: (text: string) => { counts: Record<string, number>; rows: Record<string, unknown>[]; total: number } | null;
  summaryMarkdown: (text: string) => string;
  annotation: (text: string) => string;
};

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'npm-audit-summary.js');

const REPORT = JSON.stringify({
  auditReportVersion: 2,
  vulnerabilities: {
    'shell-quote': {
      name: 'shell-quote',
      severity: 'critical',
      isDirect: false,
      via: [],
      fixAvailable: true,
    },
    jest: {
      name: 'jest',
      severity: 'moderate',
      isDirect: true,
      via: [],
      fixAvailable: { name: 'jest', version: '30.5.2', isSemVerMajor: true },
    },
    'some-lib': { name: 'some-lib', severity: 'high', isDirect: false, via: [], fixAvailable: false },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 1, critical: 1, total: 3 } },
});

describe('npm audit summary (warning only)', () => {
  it('counts by severity and lists each package, worst first', () => {
    const md = summary.summaryMarkdown(REPORT);
    expect(md).toContain('3 known advisories in the locked packages: 1 critical, 1 high, 1 moderate.');
    const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Package') && !l.startsWith('| ---'));
    expect(rows).toEqual([
      '| shell-quote | critical | no | yes |',
      '| some-lib | high | no | no |',
      '| jest | moderate | yes | jest@30.5.2 (major) |',
    ]);
    expect(md).toContain('This check never fails the build.');
    expect(summary.annotation(REPORT)).toBe(
      '::warning title=npm audit::3 known advisories (1 critical, 1 high, 1 moderate). Warning only; see the job summary.',
    );
  });

  it('says so when there is nothing, or when npm gave no report', () => {
    const clean = JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } });
    expect(summary.summaryMarkdown(clean)).toContain('No known advisories');
    expect(summary.annotation(clean)).toMatch(/^::notice /);
    for (const text of ['', 'not json', '{"error":{"code":"ENOTFOUND"}}']) {
      expect(summary.readAudit(text)).toBeNull();
      expect(summary.summaryMarkdown(text)).toContain('npm audit gave no report');
      expect(summary.annotation(text)).toMatch(/^::warning /);
    }
  });

  it('exits 0 whatever it is given', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'talia-audit-'));
    const file = path.join(tmp, 'audit.json');
    fs.writeFileSync(file, 'garbage');
    for (const args of [[file], ['--annotation', file], [path.join(tmp, 'missing.json')], []]) {
      expect(() => execFileSync(process.execPath, [SCRIPT, ...args], { stdio: 'pipe' })).not.toThrow();
    }
  });

  it('the CI job can never fail the run', () => {
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
    const job = ci.slice(ci.indexOf('\n  audit:\n'));
    expect(job.length).toBeGreaterThan(10);
    expect(job).toContain('\n    continue-on-error: true\n');
    expect(job).toContain('npm audit --package-lock-only');
    // Every command in its run block ends in `|| true`.
    const run = job.slice(job.indexOf('run: |') + 'run: |'.length).split('\n').map((l) => l.trim()).filter(Boolean);
    expect(run.length).toBe(3);
    for (const line of run) {
      expect(line.endsWith('|| true')).toBe(true);
    }
    // Nothing is installed for it, so no package's install script runs.
    expect(job).not.toMatch(/npm (ci|install)/);
  });
});
