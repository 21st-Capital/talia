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
 *  - with --markers, no file (binary ones too) holds any value of that file
 *    (readMarkers, below: its lines read "label value", blank lines and
 *    lines starting with # are skipped, and labels are never markers). The
 *    values of a line: each hex value, and each extended key as written
 *    plus what survives writing it under another version header: its public
 *    key, its 32-byte x-only public key, its chain code and its own
 *    fingerprint (every extended key in a file is decoded to look for
 *    them); each fingerprint also as a 32-bit decimal number in both byte
 *    orders. A value is looked for:
 *      - as written, in any case when it is hex; a decimal number only
 *        whole, never inside a longer one;
 *      - as raw bytes when it is hex (both byte orders for a fingerprint);
 *      - inside base64, standard or URL-safe, at each of the three byte
 *        offsets into a 3-byte group, however short the base64 is: the
 *        value's raw bytes and its hex text (lower and upper case, both byte
 *        orders for a fingerprint), and an extended key's text;
 *      - in the bytes of every base64 run of 24 characters or more, of base64
 *        wrapped over consecutive lines of one width (PEM's 64 columns,
 *        MIME's 76), and of every single-part UR (ur:<type>/<bytewords>, in
 *        any case), and in every extended key written in any of these.
 *    A hit names the value's line number in the markers file and the file
 *    it was found in, never the value.
 *
 * Known limits, forms the scan does not decode: text in UTF-16 or another
 * wide encoding; compressed data (gzip, zip, zlib, so also PNG and PDF
 * streams); a multi-part UR; base32, and base58 of anything but a whole
 * extended key; base64 split in any other way (pieces of a string joined in
 * code, lines of different widths); an extended key under another version
 * header inside base64 that none of the readings above decodes (URL-safe,
 * short, or glued to other base64 letters); hex text in mixed case, or with
 * separators ("34:42", "0x34, 0x42"); bytes written as a list of numbers; a
 * fingerprint's decimal number under eight digits, or inside base64; and
 * anything encrypted.
 *
 * Plain Node plus @scure/base, @noble/hashes and @ngraveio/bc-ur, three of
 * the app's own dependencies (decided 2026-11-06, to decode extended keys and
 * URs), so it runs from a checkout whose node_modules is installed.
 */
'use strict';

const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');

let base58check;
let sha256;
let ripemd160;
let URDecoder;
try {
  ({ sha256 } = require('@noble/hashes/sha2'));
  ({ ripemd160 } = require('@noble/hashes/legacy'));
  base58check = require('@scure/base').createBase58check(sha256);
  ({ URDecoder } = require('@ngraveio/bc-ur'));
} catch (e) {
  if (require.main !== module) throw e;
  console.error('public-export-scan: needs @scure/base, @noble/hashes and @ngraveio/bc-ur; run npm ci in the repository first');
  process.exit(2);
}

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
/** The two base64 alphabets: standard, and URL-safe (- and _ for + and /). */
const BASE64_ALPHABETS = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
];
/**
 * One line of base64 wrapped over several (PEM, MIME): a full line is 16
 * characters or more, and only the last one may be shorter or end in padding.
 */
const WRAPPED_LINE = /^[A-Za-z0-9+/_-]+={0,2}$/;
const WRAPPED_MIN_WIDTH = 16;
/**
 * A single-part UR: ur:<type>/<bytewords>, in any case (QR codes write it in
 * upper case). A multi-part one has a sequence part ("1-3") after its type,
 * so it is not matched.
 */
const UR_SINGLE = /(?<![A-Za-z0-9])ur:[a-z0-9-]+\/[a-z]{8,}(?![a-z0-9/-])/gi;
/**
 * A fingerprint's decimal number is looked for only from 8 digits on: a
 * shorter number turns up everywhere by chance.
 */
const MIN_FINGERPRINT_NUMBER = 10_000_000;

/**
 * A hex value in a markers line: 8 hex digits or more (0x before them
 * allowed), standing alone, so a hex-looking stretch inside a word or an
 * extended key is never one. Shorter runs (the numbers of a derivation path)
 * are not values.
 */
const MARKER_HEX = /(?<![0-9A-Za-z])(?:0x)?([0-9a-fA-F]{8,})(?![0-9A-Za-z])/g;
/** A run of base58 characters; an extended key is one whole run. */
const BASE58_RUN = /[1-9A-HJ-NP-Za-km-z]+/g;
/** The version headers of an extended key, as written (public and private). */
const XKEY_PREFIX = /^(?:[xtyzuv]p(?:ub|rv)|[YZUV]p(?:ub|rv))/;
/** An extended key is 82 bytes in base58check: 111 or 112 characters. */
const XKEY_LENGTHS = [111, 112];
/** Long enough to be meant as an extended key, so a label like "xpub" never is. */
const XKEY_MIN_WRITTEN = 100;
/** Every base58 run that could hold an extended key, in a file. */
const BASE58_LONG = /[1-9A-HJ-NP-Za-km-z]{111,}/g;

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

/**
 * The 78 bytes of an extended key written in base58check (any version
 * header), or null when `text` is not one.
 */
function extendedKeyBytes(text) {
  if (!XKEY_LENGTHS.includes(text.length)) return null;
  try {
    const bytes = base58check.decode(text);
    return bytes.length === 78 ? Buffer.from(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * What survives writing an extended key in another form, as lower-case hex:
 * its 32-byte chain code and, for a public key, its 33-byte public key, its
 * own fingerprint (the first 4 bytes of HASH160 of the public key) and its
 * 32-byte x-only public key (the public key without its first byte, as
 * taproot writes it).
 */
function extendedKeyParts(bytes) {
  const parts = [bytes.subarray(13, 45).toString('hex')];
  const pub = bytes.subarray(45, 78);
  if (pub[0] === 0x02 || pub[0] === 0x03) {
    parts.push(
      pub.toString('hex'),
      Buffer.from(ripemd160(sha256(pub))).subarray(0, 4).toString('hex'),
      pub.subarray(1).toString('hex'),
    );
  }
  return parts;
}

/**
 * A fingerprint (8 hex digits) as the 32-bit numbers it reads as, in both byte
 * orders, in decimal; a number under MIN_FINGERPRINT_NUMBER is left out.
 */
function fingerprintNumbers(hex) {
  const bytes = Buffer.from(hex, 'hex');
  return [bytes.readUInt32BE(0), bytes.readUInt32LE(0)].filter((n) => n >= MIN_FINGERPRINT_NUMBER).map(String);
}

/**
 * Every value of one markers line, each with its kind: each hex run of 8
 * digits or more ('hex': a fingerprint, also the one inside a
 * [fingerprint/path] origin, or a longer value), each extended key (any
 * version header) as written ('text') plus its extendedKeyParts ('hex'), and
 * every fingerprint among them as its fingerprintNumbers ('decimal').
 * Labels ("fingerprint", "key") and the path inside an origin are no values.
 * Throws, naming the line and never its text, when an extended key does not
 * decode or the line holds no value at all: a line the scan cannot read
 * would otherwise be checked for nothing.
 */
function valuesOfLine(text, line) {
  const values = new Map();
  const add = (value, kind) => values.set(`${kind} ${value}`, { value, kind });
  const addHex = (hex) => {
    add(hex, 'hex');
    if (hex.length === 8) for (const n of fingerprintNumbers(hex)) add(n, 'decimal');
  };
  for (const m of text.matchAll(MARKER_HEX)) addHex(m[1].toLowerCase());
  for (const [run] of text.matchAll(BASE58_RUN)) {
    const bytes = extendedKeyBytes(run);
    if (bytes) {
      add(run, 'text');
      for (const part of extendedKeyParts(bytes)) addHex(part);
    } else if (XKEY_PREFIX.test(run) && run.length >= XKEY_MIN_WRITTEN) {
      throw new Error(`line ${line} of the markers file holds an extended key that does not decode`);
    }
  }
  if (!values.size) throw new Error(`line ${line} of the markers file holds no value the scan knows`);
  return [...values.values()];
}

/**
 * The values of a markers file, each { value, kind, line }. Its lines read
 * "label value" (for example "fingerprint <8 hex>" and
 * "key [<fingerprint>/<path>]<extended public key>"); blank lines and lines
 * starting with # are skipped, values and all.
 */
function readMarkers(file) {
  const markers = [];
  fs.readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split('\n')
    .forEach((raw, i) => {
      const text = raw.trim();
      if (text === '' || text.startsWith('#')) return;
      for (const { value, kind } of valuesOfLine(text, i + 1)) markers.push({ value, kind, line: i + 1 });
    });
  return markers;
}

/** A marker's kind; one made by hand without it is hex when it reads as hex. */
const kindOf = (marker) => marker.kind || (HEX.test(marker.value) ? 'hex' : 'text');

/**
 * How `bytes` read inside base64 written in `alphabet` when they start
 * `offset` bytes (0, 1 or 2) into a 3-byte group: `core`, the characters
 * made of the bytes alone, and `before` and `after`, the characters allowed
 * just before and just after it (null where there is none), which the bytes
 * share with the bytes around them. Each allowed character carries the
 * bytes' own bits, so a form holds every bit of the bytes, and a match in
 * text that is not base64 is as unlikely as the bytes themselves.
 */
function base64Form(bytes, offset, alphabet) {
  const first = 8 * offset;
  const end = first + 8 * bytes.length;
  const bit = (pos) => (bytes[(pos - first) >> 3] >> (7 - ((pos - first) & 7))) & 1;
  const allowed = (char) => {
    let chars = '';
    for (let v = 0; v < 64; v++) {
      let fits = true;
      for (let b = 0; b < 6 && fits; b++) {
        const pos = 6 * char + b;
        if (pos >= first && pos < end && ((v >> (5 - b)) & 1) !== bit(pos)) fits = false;
      }
      if (fits) chars += alphabet[v];
    }
    return chars;
  };
  const coreFrom = Math.ceil(first / 6);
  const coreTo = Math.floor(end / 6) - 1;
  let core = '';
  for (let c = coreFrom; c <= coreTo; c++) core += allowed(c);
  return {
    core,
    before: coreFrom > Math.floor(first / 6) ? allowed(coreFrom - 1) : null,
    after: Math.ceil(end / 6) - 1 > coreTo ? allowed(coreTo + 1) : null,
  };
}

const formsCache = new Map();

/**
 * The base64 forms of a marker (base64Form), in both alphabets at all three
 * offsets: of a hex value's raw bytes and of its hex text in lower and upper
 * case (each in both byte orders for a fingerprint), of an extended key's
 * text. A decimal number has none: inside base64 it could not be told from
 * part of a longer number.
 */
function base64FormsOf(marker) {
  const kind = kindOf(marker);
  const key = `${kind} ${marker.value}`;
  if (formsCache.has(key)) return formsCache.get(key);
  const sources = [];
  if (kind === 'hex') {
    const texts = [marker.value.toLowerCase()];
    if (marker.value.length % 2 === 0) {
      const bytes = Buffer.from(marker.value, 'hex');
      sources.push(bytes);
      if (bytes.length === 4) {
        const reversed = Buffer.from(bytes).reverse();
        sources.push(reversed);
        texts.push(reversed.toString('hex'));
      }
    }
    for (const t of texts) sources.push(Buffer.from(t, 'latin1'), Buffer.from(t.toUpperCase(), 'latin1'));
  } else if (kind === 'text') {
    sources.push(Buffer.from(marker.value, 'latin1'));
  }
  const forms = new Map();
  for (const bytes of sources) {
    for (let offset = 0; offset < 3; offset++) {
      for (const alphabet of BASE64_ALPHABETS) {
        const form = base64Form(bytes, offset, alphabet);
        forms.set(`${form.before}|${form.core}|${form.after}`, form);
      }
    }
  }
  const out = [...forms.values()];
  formsCache.set(key, out);
  return out;
}

/** True when `text` holds `form` (base64Form). */
function holdsForm(text, { core, before, after }) {
  for (let at = text.indexOf(core); at >= 0; at = text.indexOf(core, at + 1)) {
    if (before !== null && (at === 0 || !before.includes(text[at - 1]))) continue;
    if (after !== null && (at + core.length >= text.length || !after.includes(text[at + core.length]))) continue;
    return true;
  }
  return false;
}

/** True when `text` holds the decimal number `digits` whole, not inside a longer number. */
function holdsNumber(text, digits) {
  const digit = (ch) => ch >= '0' && ch <= '9';
  for (let at = text.indexOf(digits); at >= 0; at = text.indexOf(digits, at + 1)) {
    if (at > 0 && digit(text[at - 1])) continue;
    if (digit(text[at + digits.length] ?? '')) continue;
    return true;
  }
  return false;
}

/**
 * Base64 wrapped over consecutive lines (PEM at 64 columns, MIME at 76),
 * each block joined into one string: two lines or more, each base64 alone
 * (spaces around it are dropped), all but the last one the same width of
 * WRAPPED_MIN_WIDTH characters or more, the last one no wider, and padding
 * only at the end.
 */
function wrappedBase64(text) {
  const blocks = [];
  let block = [];
  const flush = () => {
    if (block.length > 1) blocks.push(block.join(''));
    block = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const isBase64 = WRAPPED_LINE.test(line);
    const width = block.length ? block[0].length : 0;
    const prev = block.length ? block[block.length - 1] : '';
    const continues =
      isBase64 && block.length > 0 && prev.length === width && !prev.endsWith('=') && line.length <= width;
    if (!continues) {
      flush();
      if (isBase64 && line.length >= WRAPPED_MIN_WIDTH && !line.endsWith('=')) block.push(line);
    } else {
      block.push(line);
    }
  }
  flush();
  return blocks;
}

/**
 * The bytes of every single-part UR in `text` (UR_SINGLE): its CBOR payload
 * and, when that is a byte string, the bytes inside it. A string that does not
 * decode (a wrong checksum, say) is skipped.
 */
function urBytesIn(text) {
  const out = [];
  for (const [ur] of text.matchAll(UR_SINGLE)) {
    let decoded;
    try {
      decoded = URDecoder.decode(ur);
    } catch {
      continue;
    }
    out.push(Buffer.from(decoded.cbor));
    try {
      const inner = decoded.decodeCBOR();
      if (Buffer.isBuffer(inner)) out.push(Buffer.from(inner));
    } catch {
      // A payload that is not plain CBOR is still searched as it is.
    }
  }
  return out;
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

/**
 * The 78 bytes of every extended key written in `text`, whatever its version
 * header. A run longer than one key is tried at every place a key could
 * start in it, so a key written against other base58 characters is read too.
 */
function extendedKeysIn(text) {
  const keys = [];
  for (const [run] of text.matchAll(BASE58_LONG)) {
    for (let at = 0; at + XKEY_LENGTHS[0] <= run.length; at++) {
      for (const len of XKEY_LENGTHS) {
        const bytes = at + len <= run.length ? extendedKeyBytes(run.slice(at, at + len)) : null;
        if (bytes) keys.push(bytes);
      }
    }
  }
  return keys;
}

/**
 * The forms of one file the marker check reads, made once per file: its
 * bytes, its text, the decoded bytes of its base64 runs, of its wrapped
 * base64 and of its single-part URs (in the file and in those decoded
 * bytes), and the bytes of every extended key written in any of them; and
 * the texts its base64 forms are looked for in: the file, each wrapped block
 * joined, and every decoded text.
 */
function markerView(buf) {
  const text = buf.toString('latin1');
  const wrapped = wrappedBase64(text);
  const decoded = [...base64Blobs(text), ...wrapped.map((w) => Buffer.from(w, 'base64'))];
  const urs = [text, ...decoded.map((b) => b.toString('latin1'))].flatMap(urBytesIn);
  // A key's own text hard-wrapped over bare lines is joined like base64 (base58
  // fits inside its alphabet), so it is read as a key too.
  const keys = [text, ...wrapped, ...[...decoded, ...urs].map((b) => b.toString('latin1'))].flatMap(extendedKeysIn);
  const blobs = [...decoded, ...urs, ...keys];
  const blobLatin1 = blobs.map((b) => b.toString('latin1'));
  return {
    buf,
    text,
    lower: text.toLowerCase(),
    blobs,
    blobLatin1,
    blobText: blobLatin1.map((t) => t.toLowerCase()),
    base64Texts: [text, ...wrapped, ...blobLatin1],
  };
}

/**
 * True when the file holds `marker` ({ value, kind }) in any of the forms the
 * scan knows: a hex value as text in any case and as raw bytes (a 4-byte
 * fingerprint in both byte orders, as text too), in the file and in its
 * decoded bytes and extended keys; an extended key as written, in the file
 * and in its decoded bytes; a decimal number whole, in the file and in its
 * decoded bytes; and a hex value or an extended key in base64 (base64FormsOf).
 */
function holdsMarker(view, marker) {
  const kind = kindOf(marker);
  const { value } = marker;
  if (kind === 'decimal') return [view.text, ...view.blobLatin1].some((t) => holdsNumber(t, value));
  const asWritten =
    kind === 'hex' ? holdsHex(view, value) : view.text.includes(value) || view.blobLatin1.some((t) => t.includes(value));
  return asWritten || base64FormsOf(marker).some((form) => view.base64Texts.some((t) => holdsForm(t, form)));
}

/** A hex value as text in any case or as raw bytes, in the file or its decoded bytes (holdsMarker). */
function holdsHex(view, value) {
  const texts = [value.toLowerCase()];
  const byteForms = [];
  if (value.length % 2 === 0) {
    const bytes = Buffer.from(value, 'hex');
    byteForms.push(bytes);
    if (bytes.length === 4) {
      const reversed = Buffer.from(bytes).reverse();
      byteForms.push(reversed);
      texts.push(reversed.toString('hex'));
    }
  }
  if (texts.some((t) => view.lower.includes(t) || view.blobText.some((b) => b.includes(t)))) return true;
  return byteForms.some((b) => view.buf.includes(b) || view.blobs.some((x) => x.includes(b)));
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
      const hitLines = new Set();
      for (const m of markers) if (!hitLines.has(m.line) && holdsMarker(view, m)) hitLines.add(m.line);
      for (const line of hitLines) problems.push(`${rel}: holds the value on line ${line} of the markers file`);
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
  let markers = [];
  if (markersFile) {
    try {
      markers = readMarkers(markersFile);
    } catch (e) {
      console.error(`public-export-scan: ${e.code ? `cannot read the markers file (${e.code})` : e.message}`);
      return 2;
    }
    if (!markers.length) {
      console.error('public-export-scan: the markers file holds no value to look for');
      return 2;
    }
  }
  const { files, problems } = scan(root, markers);
  for (const p of problems) console.log(`public-export-scan: ${p}`);
  const lineCount = new Set(markers.map((m) => m.line)).size;
  const what = markersFile ? `, ${markers.length} marker values from ${lineCount} lines` : '';
  console.log(`public-export-scan: ${files} files${what}, ${problems.length} problems`);
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { scan, readMarkers, markerView, holdsMarker, extendedKeysIn, ALLOWED_EMAILS, EXCLUDED_NAMES, EXCLUDED_TOP };
