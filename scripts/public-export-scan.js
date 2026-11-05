#!/usr/bin/env node
/**
 * Scans a public copy of the app made by scripts/public-export.sh (decided
 * 2026-11-05). Exit status 0 when the copy is clean, 1 with one line per
 * problem otherwise.
 *
 *   node scripts/public-export-scan.js <folder> [--markers <file>]
 *
 * It checks that:
 *  - the files that never leave the private repository are absent
 *    (CLAUDE.md, ROADMAP.md and RELEASE_NOTES.md anywhere, .claude/ and
 *    private/ at the top);
 *  - no text file holds an email address outside the example domains
 *    (example.com, example.org, example.net and their subdomains), apart
 *    from ALLOWED_EMAILS: addresses that are not a person's;
 *  - no text file holds a review or audit finding number;
 *  - with --markers, no file (binary ones too) holds any value of that file,
 *    one per line (blank lines and lines starting with # are skipped): as
 *    written, in any case when the value is hex, as raw bytes when it is
 *    hex, and inside base64 runs. A hit names the value's line number in the
 *    markers file and the file it was found in, never the value.
 *
 * Plain Node, no dependency, so it runs before any npm install.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Never in a public copy, at any depth. */
const EXCLUDED_NAMES = new Set(['CLAUDE.md', 'ROADMAP.md', 'RELEASE_NOTES.md']);
/** Never in a public copy, at the top. */
const EXCLUDED_TOP = ['.claude', 'private'];

/** Example domains, which no person reads. */
const EXAMPLE_DOMAIN = /(^|\.)example\.(com|org|net)$/i;
/**
 * Addresses that are not a person's: the company's role addresses the app
 * shows to clients, and the user part of git remote URLs in tests.
 */
const ALLOWED_EMAILS = new Set([
  'recovery@21stcapital.com',
  'contact@21stcapital.com',
  'git@github.com',
  'user@github.com',
]);
/** Third-party package metadata: its authors' addresses are theirs to publish. */
const EMAIL_EXEMPT_FILES = new Set(['package-lock.json']);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/**
 * A finding number: the word finding (or findings) followed by a number, with
 * "no.", "number" or "#" between them or not, and audit, golden or review
 * followed by item, point or issue and a number.
 */
const FINDING = /\bfindings?\s*(?:no\.?\s*|number\s*|#\s*)?\d+|\b(?:audit|golden|review)\s+(?:item|point|issue)\s*#?\s*\d+/gi;

const BASE64_RUN = /[A-Za-z0-9+/]{24,}={0,2}/g;
const HEX = /^[0-9a-fA-F]+$/;

/** Every file under `root`, relative, with forward slashes; links are not followed. */
function walk(root) {
  const out = [];
  const visit = (rel) => {
    const abs = path.join(root, rel);
    for (const name of fs.readdirSync(abs)) {
      const childRel = rel ? `${rel}/${name}` : name;
      if (!rel && name === '.git') continue;
      const st = fs.lstatSync(path.join(root, childRel));
      if (st.isDirectory()) visit(childRel);
      else out.push({ rel: childRel, link: st.isSymbolicLink() });
    }
  };
  visit('');
  return out.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

/** A NUL byte in the first 8 KB marks a binary file. */
const isBinary = (buf) => buf.subarray(0, 8192).includes(0);

/** The values of a markers file, with their line numbers. */
function readMarkers(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line, i) => ({ value: line.trim(), line: i + 1 }))
    .filter((m) => m.value !== '' && !m.value.startsWith('#'));
}

/** The decoded bytes of every base64 run in `text` (runs that do not decode are skipped). */
function base64Blobs(text) {
  const blobs = [];
  for (const run of text.match(BASE64_RUN) ?? []) {
    const body = run.replace(/=+$/, '');
    if (body.length % 4 === 1) continue;
    blobs.push(Buffer.from(body, 'base64'));
  }
  return blobs;
}

/** The forms of one file the marker check reads, made once per file. */
function markerView(buf) {
  const text = buf.toString('latin1');
  const blobs = base64Blobs(text);
  return { buf, text, lower: text.toLowerCase(), blobs, blobText: blobs.map((b) => b.toString('latin1').toLowerCase()) };
}

/** True when the file holds `value` in any of the forms the scan knows. */
function holdsMarker(view, value) {
  const hex = HEX.test(value);
  const want = hex ? value.toLowerCase() : value;
  if (hex ? view.lower.includes(want) : view.text.includes(want)) return true;
  if (hex && value.length % 2 === 0) {
    const bytes = Buffer.from(value, 'hex');
    if (view.buf.includes(bytes) || view.blobs.some((b) => b.includes(bytes))) return true;
  }
  return hex ? view.blobText.some((t) => t.includes(want)) : view.blobs.some((b) => b.toString('latin1').includes(want));
}

/** Every problem in the copy at `root`, one line each. */
function scan(root, markers = []) {
  const problems = [];
  for (const top of EXCLUDED_TOP) {
    if (fs.existsSync(path.join(root, top))) problems.push(`${top}/: left out of every public copy, but present`);
  }
  const files = walk(root);
  for (const { rel, link } of files) {
    if (EXCLUDED_NAMES.has(path.posix.basename(rel))) problems.push(`${rel}: left out of every public copy, but present`);
    if (link) continue;
    const buf = fs.readFileSync(path.join(root, rel));
    if (markers.length) {
      const view = markerView(buf);
      for (const m of markers) {
        if (holdsMarker(view, m.value)) problems.push(`${rel}: holds the value on line ${m.line} of the markers file`);
      }
    }
    if (isBinary(buf)) continue;
    const lines = buf.toString('utf8').split('\n');
    lines.forEach((line, i) => {
      if (!EMAIL_EXEMPT_FILES.has(rel)) {
        for (const email of line.match(EMAIL) ?? []) {
          const domain = email.slice(email.lastIndexOf('@') + 1);
          if (!EXAMPLE_DOMAIN.test(domain) && !ALLOWED_EMAILS.has(email.toLowerCase())) {
            problems.push(`${rel}:${i + 1}: an email address outside the example domains (${email})`);
          }
        }
      }
      for (const hit of line.match(FINDING) ?? []) problems.push(`${rel}:${i + 1}: a finding number ("${hit}")`);
    });
  }
  return { files: files.length, problems };
}

function main(argv) {
  const args = argv.slice(2);
  const at = args.indexOf('--markers');
  const markersFile = at >= 0 ? args[at + 1] : null;
  const rest = args.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
  if (rest.length !== 1 || (at >= 0 && !markersFile)) {
    console.error('usage: node scripts/public-export-scan.js <folder> [--markers <file>]');
    return 2;
  }
  const root = rest[0];
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`public-export-scan: not a folder: ${root}`);
    return 2;
  }
  const markers = markersFile ? readMarkers(markersFile) : [];
  const { files, problems } = scan(root, markers);
  for (const p of problems) console.log(`public-export-scan: ${p}`);
  const what = markersFile ? `, ${markers.length} marker values` : '';
  console.log(`public-export-scan: ${files} files${what}, ${problems.length} problems`);
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { scan, readMarkers, markerView, holdsMarker, ALLOWED_EMAILS, EXCLUDED_NAMES, EXCLUDED_TOP };
