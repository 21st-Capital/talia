/**
 * Device ids and retired seed fingerprints stay out of the tracked files
 * (decided 2026-10-06: "There is no need to have this anywhere recorded").
 * This fails if any tracked text file holds either.
 *
 *  - An iPhone device id (eight hex digits, a dash, sixteen hex digits, the
 *    first four "0000"). Phones are named in the untracked .devices.local
 *    instead (see scripts/ios-device.sh).
 *  - The fingerprint of a retired 21st Capital seed. The list is kept only
 *    in the private repository, in private/retired-seed-sha256.txt (the
 *    SHA-256, hex, of each lowercase fingerprint, one per line), because a
 *    hash of a 32-bit value is reversed by trying all 2^32; the public copy
 *    leaves private/ out. Without the file this part is skipped, and the test
 *    title says so; the detector itself is always tested on stand-in values.
 *    Every run of eight or more hex digits in every tracked text file is
 *    hashed, eight digits at a time at every offset, and compared. A fingerprint is four raw bytes
 *    inside a hex-encoded PSBT (the BIP32 derivation fields), so it can sit
 *    in the middle of one long hex run; a base64 PSBT ("cHNidP8...") is
 *    decoded to hex and read the same way. A failure names the file and line,
 *    never the value, so the CI log does not carry it either.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..', '..');

/** The private list (absent from the public copy). */
const RETIRED_SEED_FILE = path.join(ROOT, 'private', 'retired-seed-sha256.txt');

/**
 * SHA-256 (hex) of each retired seed's lowercase fingerprint, read from the
 * private list; empty when the file is not in this copy. A line that is not
 * a comment, blank or one SHA-256 value throws: a damaged list must fail,
 * never pass as a shorter one.
 */
function readRetiredSeedHashes(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line, i) => {
      if (!/^[0-9a-f]{64}$/.test(line)) throw new Error(`${file}: entry ${i + 1} is not one SHA-256 value`);
      return line;
    });
}

const RETIRED_SEED_HASHES: readonly string[] = readRetiredSeedHashes(RETIRED_SEED_FILE);

const DEVICE_ID = /(?<![0-9A-Fa-f])0000[0-9A-Fa-f]{4}-[0-9A-Fa-f]{16}(?![0-9A-Fa-f])/;
/** Each maximal run of hex digits at least eight long. */
const HEX_RUN = /[0-9A-Fa-f]{8,}/g;
/** A base64 PSBT: the magic "psbt\xff" encodes as "cHNidP8". */
const BASE64_PSBT = /cHNidP8[A-Za-z0-9+/]*={0,2}/g;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** True when any eight consecutive hex digits of `hex` hash to a listed value. */
function holdsListed(hex: string, listed: ReadonlySet<string>): boolean {
  const lower = hex.toLowerCase();
  for (let at = 0; at + 8 <= lower.length; at += 1) {
    if (listed.has(sha256(lower.slice(at, at + 8)))) return true;
  }
  return false;
}

/** Every problem in one text, as "line N: <what>" (never the value itself). */
function problemsIn(text: string, hashes: readonly string[] = RETIRED_SEED_HASHES): string[] {
  const out: string[] = [];
  const retired = new Set(hashes);
  text.split('\n').forEach((line, i) => {
    if (DEVICE_ID.test(line)) out.push(`line ${i + 1}: an iPhone device id`);
    const runs = [
      ...(line.match(HEX_RUN) ?? []),
      ...(line.match(BASE64_PSBT) ?? []).map((b64) => Buffer.from(b64, 'base64').toString('hex')),
    ];
    for (const run of runs) {
      if (holdsListed(run, retired)) {
        out.push(`line ${i + 1}: a retired 21st Capital seed fingerprint`);
      }
    }
  });
  return out;
}

function trackedFiles(): string[] {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && v !== undefined) env[k] = v;
  }
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

/** Text only: a NUL byte in the first 8 KB marks a binary file. */
function readText(rel: string): string | null {
  const full = path.join(ROOT, rel);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(full);
  } catch {
    return null; // deleted in this checkout, not yet committed
  }
  if (!stat.isFile()) return null;
  const bytes = fs.readFileSync(full);
  if (bytes.subarray(0, 8192).includes(0)) return null;
  return bytes.toString('utf8');
}

describe('no device ids or retired seed fingerprints in tracked files', () => {
  it('finds both kinds in a sample (the detectors work)', () => {
    // Built at run time, so this file itself never holds a device-id shape.
    const deviceShaped = ['0000', '8120', '-', 'a1b2c3d4e5f60718'].join('');
    expect(problemsIn(`phone ${deviceShaped} here`)).toEqual(['line 1: an iPhone device id']);
    expect(problemsIn(`x${deviceShaped}`)).toHaveLength(1);
    expect(problemsIn(`f${deviceShaped}`)).toEqual([]); // part of a longer hex run
    expect(problemsIn('a commit 0c21c051 and a key [deadbeef/48h]')).toEqual([]);
    // The fingerprint check, on a harmless value standing in for a listed one.
    const standIn = [sha256('deadbeef')];
    expect(problemsIn('ok\n[DEADBEEF/48h/0h]', standIn)).toEqual([
      'line 2: a retired 21st Capital seed fingerprint',
    ]);
    expect(problemsIn('deadbeef00 is longer', standIn)).toHaveLength(1);
    expect(problemsIn('a key [cafef00d/48h] only', standIn)).toEqual([]);
  });

  it('finds a fingerprint inside a hex-encoded PSBT', () => {
    const standIn = [sha256('deadbeef')];
    // The magic, then a PSBT_IN_BIP32_DERIVATION entry (key: length 34, type
    // 06, a 33-byte pubkey; value: length 20, the master fingerprint's four
    // bytes, then 48'/1'/0'/2'), all one hex run, the fingerprint at an even
    // (byte-aligned) offset as in any hex PSBT ...
    const pubkey = '02' + '11'.repeat(32);
    const path = '30000080' + '01000080' + '00000080' + '02000080';
    const psbtHex = '70736274ff' + '22' + '06' + pubkey + '14' + 'DEADBEEF' + path + '00';
    expect(problemsIn(`const PSBT = '${psbtHex}';`, standIn)).toEqual([
      'line 1: a retired 21st Capital seed fingerprint',
    ]);
    // ... and at an odd one too, should a hex run start mid-byte.
    expect(problemsIn(`x${'a' + psbtHex}`, standIn)).toHaveLength(1);
    // The same PSBT with another fingerprint passes.
    expect(problemsIn(psbtHex.replace('DEADBEEF', 'C0FFEE00'), standIn)).toEqual([]);
    // In base64, as most PSBT fixtures here are, the bytes are found too.
    const psbtB64 = Buffer.from(psbtHex, 'hex').toString('base64');
    expect(psbtB64.startsWith('cHNidP8')).toBe(true);
    expect(problemsIn(`const PSBT = '${psbtB64}';`, standIn)).toEqual([
      'line 1: a retired 21st Capital seed fingerprint',
    ]);
    const otherB64 = Buffer.from(psbtHex.replace('DEADBEEF', 'C0FFEE00'), 'hex').toString('base64');
    expect(problemsIn(otherB64, standIn)).toEqual([]);
  });

  it('reads the private list as SHA-256 hex values only', () => {
    for (const h of RETIRED_SEED_HASHES) expect(h).toMatch(/^[0-9a-f]{64}$/);
    if (fs.existsSync(RETIRED_SEED_FILE)) expect(RETIRED_SEED_HASHES.length).toBeGreaterThan(0);
  });

  it(`none appears in any tracked text file${
    RETIRED_SEED_HASHES.length ? '' : ' (device ids only: private/retired-seed-sha256.txt is not in this copy)'
  }`, () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(100);
    const found: string[] = [];
    let read = 0;
    for (const rel of files) {
      const text = readText(rel);
      if (text === null) continue;
      read += 1;
      for (const p of problemsIn(text)) found.push(`${rel} ${p}`);
    }
    expect(read).toBeGreaterThan(100);
    expect(found).toEqual([]);
  });
});
