#!/usr/bin/env node
/**
 * The warning-only npm audit in CI (decided 2026-09-26 and
 * 2026-10-07).
 *
 *   node scripts/npm-audit-summary.js <audit.json>               markdown, for the job summary
 *   node scripts/npm-audit-summary.js --annotation <audit.json>  one GitHub warning line
 *
 * <audit.json> is what `npm audit --package-lock-only --json` printed. This
 * script only reports: it always exits 0, whatever the file holds, because a
 * failed CI run sends an email and this check is not blocking (yet). Make it
 * blocking only once the audit is clean.
 *
 * No dependencies: Node's own fs only.
 */
'use strict';

const fs = require('fs');

const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

/** The audit's findings, or null when the file is not an npm audit report. */
function readAudit(text) {
  let audit;
  try {
    audit = JSON.parse(text);
  } catch {
    return null;
  }
  if (!audit || typeof audit !== 'object' || !audit.metadata || !audit.vulnerabilities) {
    return null;
  }
  const counts = {};
  for (const s of SEVERITIES) {
    const n = Number(audit.metadata.vulnerabilities && audit.metadata.vulnerabilities[s]);
    counts[s] = Number.isFinite(n) ? n : 0;
  }
  const rows = Object.values(audit.vulnerabilities)
    .filter((v) => v && typeof v.name === 'string')
    .map((v) => ({
      name: v.name,
      severity: SEVERITIES.includes(v.severity) ? v.severity : 'info',
      direct: v.isDirect === true,
      fix:
        v.fixAvailable === true
          ? 'yes'
          : v.fixAvailable && typeof v.fixAvailable === 'object'
            ? `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (major)' : ''}`
            : 'no',
    }))
    .sort(
      (a, b) =>
        SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
        Number(b.direct) - Number(a.direct) ||
        a.name.localeCompare(b.name),
    );
  const total = SEVERITIES.reduce((sum, s) => sum + counts[s], 0);
  return { counts, rows, total };
}

/** "3 critical, 60 high, 16 moderate" (severities with none are left out). */
function countLine(counts) {
  const parts = SEVERITIES.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

function summaryMarkdown(text) {
  const audit = readAudit(text);
  const head = '### npm audit (warning only)\n\n';
  const foot = '\nThis check never fails the build. It turns blocking only once it is clean.\n';
  if (audit === null) {
    return `${head}npm audit gave no report (the advisory service may have been unreachable).\n${foot}`;
  }
  if (audit.total === 0) {
    return `${head}No known advisories in the locked packages.\n${foot}`;
  }
  const lines = [
    `${audit.total} known advisories in the locked packages: ${countLine(audit.counts)}.`,
    '',
    '| Package | Severity | Direct | Fix |',
    '| --- | --- | --- | --- |',
    ...audit.rows.map((r) => `| ${r.name} | ${r.severity} | ${r.direct ? 'yes' : 'no'} | ${r.fix} |`),
  ];
  return `${head}${lines.join('\n')}\n${foot}`;
}

function annotation(text) {
  const audit = readAudit(text);
  if (audit === null) {
    return '::warning title=npm audit::npm audit gave no report.';
  }
  if (audit.total === 0) {
    return '::notice title=npm audit::No known advisories in the locked packages.';
  }
  return `::warning title=npm audit::${audit.total} known advisories (${countLine(audit.counts)}). Warning only; see the job summary.`;
}

function main(argv) {
  const wantAnnotation = argv[0] === '--annotation';
  const file = wantAnnotation ? argv[1] : argv[0];
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // An unreadable report is reported as "no report", never as a failure.
  }
  process.stdout.write(`${wantAnnotation ? annotation(text) : summaryMarkdown(text)}\n`);
  return 0;
}

module.exports = { readAudit, summaryMarkdown, annotation, main };

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch {
    // Never a red run from a report.
  }
  process.exitCode = 0;
}
