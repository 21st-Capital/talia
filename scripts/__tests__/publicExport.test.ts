/**
 * scripts/public-export.sh and its scanner (decided 2026-11-05): the public
 * copy is one commit's tree minus the private files, scanned, and a git
 * repository with one commit and no remote only when asked. Run on throwaway
 * repositories in a temp folder, never on this checkout's history.
 */
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sha256 } from '@noble/hashes/sha2';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import { createBase58check } from '@scure/base';

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'public-export.sh');
const SCANNER = path.join(ROOT, 'scripts', 'public-export-scan.js');
type Marker = { value: string; kind?: string; line: number };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const scanner = require('../public-export-scan.js') as {
  scan: (root: string, markers?: Marker[]) => { files: number; problems: string[] };
  readMarkers: (file: string) => Marker[];
};

/**
 * BIP-32 test vector 1 (seed 000102030405060708090a0b0c0d0e0f), as published
 * in BIP-32: the master key's fingerprint and the m/0' key, with that key's
 * public key, chain code and own fingerprint. Published test values only.
 */
const TV1 = {
  masterFingerprint: '3442193e',
  xpub: 'xpub68Gmy5EdvgibQVfPdqkBBCHxA5htiqg55crXYuXoQRKfDBFA1WEjWgP6LHhwBZeNK1VTsfTFUHCdrfp1bgwQ9xv5ski8PX9rL2dZXvgGDnw',
  publicKey: '035a784662a4a20a65bf6aab9ae98a6c068a81c52e4b032c0fb5400c706cfccc56',
  chainCode: '47fdacbd0f1097043b78c63c20c34ef4ed9a111d980047ad16282c7ae6236141',
  fingerprint: '5c1bd648',
};
/** The key's 32-byte x-only public key: its public key without the first byte. */
const TV1_XONLY = TV1.publicKey.slice(2);
/** A fingerprint as the 32-bit numbers it reads as, both byte orders, in decimal. */
const numbersOf = (fp: string) => [Buffer.from(fp, 'hex').readUInt32BE(0), Buffer.from(fp, 'hex').readUInt32LE(0)].map(String);
/** A made-up fingerprint a comment line names, as the real file names kept test devices. */
const KEPT_DEVICE = 'd34db33f';
const base58check = createBase58check(sha256);
/** The same key under another version header (tpub: 043587cf). */
const reencoded = (xkey: string, version: string) =>
  base58check.encode(Buffer.concat([Buffer.from(version, 'hex'), Buffer.from(base58check.decode(xkey)).subarray(4)]));

/** A markers file in the real file's form: comment lines, then "label value" lines (3 and 4). */
const MARKERS_FILE = [
  '# Values removed from the public copy; the scan never prints them.',
  `# Kept test devices, never markers: ${KEPT_DEVICE}`,
  `fingerprint ${TV1.masterFingerprint}`,
  `key [${TV1.masterFingerprint}/0h]${TV1.xpub}`,
  '',
].join('\n');

/** git with no GIT_* from the caller (a hook or an IDE may set them). */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull };
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv() }).trim();

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'public-export-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A repository holding `files`, committed once. */
function repoWith(files: Record<string, string | Buffer>): string {
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), body);
  }
  git(repo, 'add', '-A');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'one');
  return repo;
}

const PRIVATE_FILES = {
  'CLAUDE.md': 'notes\n',
  'ROADMAP.md': 'tracker\n',
  'RELEASE_NOTES.md': 'notes\n',
  '.claude/launch.json': '{}\n',
  'private/list.txt': 'value\n',
};

function exportOf(repo: string, ...extra: string[]) {
  const out = path.join(tmp, 'out');
  const r = spawnSync('bash', [SCRIPT, 'HEAD', out, '--repo', repo, ...extra], { encoding: 'utf8', env: gitEnv() });
  return { out, status: r.status, text: `${r.stdout}${r.stderr}` };
}

describe('public-export.sh', () => {
  it('copies the commit minus the private files, and the copy scans clean', () => {
    const repo = repoWith({
      ...PRIVATE_FILES,
      'package.json': '{ "name": "x", "version": "9.8.7" }\n',
      'src/a.ts': "export const contact = 'someone@example.com';\n",
    });
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'never committed\n');
    const r = exportOf(repo);
    expect(r.text).toContain('0 problems');
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(r.out, 'src/a.ts'), 'utf8')).toContain('someone@example.com');
    for (const gone of ['CLAUDE.md', 'ROADMAP.md', 'RELEASE_NOTES.md', '.claude', 'private', 'untracked.txt', '.git']) {
      expect(fs.existsSync(path.join(r.out, gone))).toBe(false);
    }
  });

  it('refuses a copy that still holds a private file left anywhere else', () => {
    const r = exportOf(repoWith({ ...PRIVATE_FILES, 'docs/CLAUDE.md': 'nested\n' }));
    expect(r.status).toBe(1);
    expect(r.text).toContain('docs/CLAUDE.md: left out of every public copy, but present');
  });

  it('refuses a real email address and a finding number, naming the file and line', () => {
    // Built here, so this file itself passes the scan of a real export.
    const realEmail = ['jane', 'realmail.io'].join('@');
    const r = exportOf(
      repoWith({
        'a.ts': `// mail ${realEmail}\nconst ok = 'test@sub.example.org';\n`,
        'b.ts': `// see ${'find'}ing 12\n`,
        'c.ts': "const app = 'recovery@21stcapital.com';\n",
      }),
    );
    expect(r.status).toBe(1);
    expect(r.text).toContain(`a.ts:1: an email address outside the example domains (${realEmail})`);
    expect(r.text).toContain('b.ts:1: a finding number');
    expect(r.text).not.toContain('a.ts:2');
    expect(r.text).not.toContain('c.ts');
  });

  it('finds a marker as text, as raw bytes and inside base64, and never prints it', () => {
    const marker = 'c0ffee1234abcd';
    const markers = path.join(tmp, 'markers.txt');
    fs.writeFileSync(markers, `# a comment line\n\n${marker}\n`);
    const r = exportOf(
      repoWith({
        'text.ts': `const k = '${marker.toUpperCase()}';\n`,
        'blob.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(marker, 'hex'), Buffer.from([3])]),
        'b64.ts': `const p = '${Buffer.concat([Buffer.from('psbt'), Buffer.from(marker, 'hex'), Buffer.from('more bytes')]).toString('base64')}';\n`,
        'clean.ts': 'const nothing = 1;\n',
      }),
      '--markers',
      markers,
    );
    expect(r.status).toBe(1);
    for (const f of ['text.ts', 'blob.bin', 'b64.ts']) {
      expect(r.text).toContain(`${f}: holds the value on line 3 of the markers file`);
    }
    expect(r.text).not.toContain('clean.ts');
    expect(r.text.toLowerCase()).not.toContain(marker);
  });

  it('reads a markers file of "label value" lines and finds each value in every form, never printing one', () => {
    const markers = path.join(tmp, 'markers.txt');
    fs.writeFileSync(markers, MARKERS_FILE);
    const r = exportOf(
      repoWith({
        'fp-upper.ts': `const fp = '${TV1.masterFingerprint.toUpperCase()}';\n`,
        'fp-le.bin': Buffer.concat([Buffer.from([0, 9]), Buffer.from(TV1.masterFingerprint, 'hex').reverse(), Buffer.from([7])]),
        'key.ts': `const d = 'wpkh([${TV1.masterFingerprint}/0h]${TV1.xpub}/0/*)';\n`,
        'tpub.ts': `const k = '${reencoded(TV1.xpub, '043587cf')}';\n`,
        'pubkey.ts': `const pub = '${TV1.publicKey}';\n`,
        'own-fp.ts': `const child = '${TV1.fingerprint}';\n`,
        'chain.bin': Buffer.concat([Buffer.from([0, 1]), Buffer.from(TV1.chainCode, 'hex')]),
        'b64-text.ts': `const blob = '${Buffer.from(JSON.stringify({ key: TV1.xpub })).toString('base64')}';\n`,
        'b64-raw.ts': `const psbt = '${Buffer.concat([Buffer.from('psbt'), Buffer.from(base58check.decode(TV1.xpub))]).toString('base64')}';\n`,
        'kept.ts': `const device = '${KEPT_DEVICE}';\n`,
        'labels.ts': '// the key and its fingerprint are labels, never markers\n',
        'clean.ts': 'const nothing = 1;\n',
      }),
      '--markers',
      markers,
    );
    expect(r.status).toBe(1);
    const hit = (file: string, line: number) => `${file}: holds the value on line ${line} of the markers file`;
    // The fingerprint, in any case and as raw bytes in either order, is the
    // value of line 3 and the origin's on line 4.
    for (const f of ['fp-upper.ts', 'fp-le.bin']) {
      expect(r.text).toContain(hit(f, 3));
      expect(r.text).toContain(hit(f, 4));
    }
    for (const f of ['key.ts', 'tpub.ts', 'pubkey.ts', 'own-fp.ts', 'chain.bin', 'b64-text.ts', 'b64-raw.ts']) {
      expect(r.text).toContain(hit(f, 4));
    }
    // A public key, a chain code or the key's own fingerprint is no value of line 3.
    for (const f of ['pubkey.ts', 'own-fp.ts', 'chain.bin']) expect(r.text).not.toContain(hit(f, 3));
    for (const f of ['kept.ts', 'labels.ts', 'clean.ts']) expect(r.text).not.toContain(f);
    for (const line of [1, 2]) expect(r.text).not.toContain(`line ${line} of the markers file`);
    expect(r.text).toContain('13 marker values from 2 lines');
    const lower = r.text.toLowerCase();
    expect(r.text).not.toContain(TV1.xpub);
    for (const v of [TV1.masterFingerprint, TV1.publicKey, TV1.chainCode, TV1.fingerprint, KEPT_DEVICE]) {
      expect(lower).not.toContain(v);
    }
  });

  it('finds a value in short and URL-safe base64 at any offset, in a UR, as an x-only key or a decimal fingerprint, and in wrapped base64, never printing one', () => {
    const markers = path.join(tmp, 'markers.txt');
    fs.writeFileSync(markers, MARKERS_FILE);
    const fp = Buffer.from(TV1.masterFingerprint, 'hex');
    const b64 = (...parts: (string | Buffer)[]) =>
      Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : p))).toString('base64');
    const b64url = (...parts: (string | Buffer)[]) =>
      Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : p))).toString('base64url');
    // URL-safe forms that hold - or _, so no standard base64 reading finds them.
    const pubUrl = b64url(Buffer.from(TV1.publicKey, 'hex'));
    const chainUrl = b64url(Buffer.from('ab'), Buffer.from(TV1.chainCode, 'hex'));
    for (const u of [pubUrl, chainUrl]) expect(u).toMatch(/[-_]/);
    // Short base64, each under the 24 characters a base64 run needs to be decoded.
    const short = [b64(fp), b64(Buffer.from([7]), fp), b64(Buffer.from([7, 8]), Buffer.from(fp).reverse()), b64('"fp":"3442193E"')];
    for (const t of short) expect(t.length).toBeLessThan(24);
    const urOf = (bytes: Buffer) => UREncoder.encodeSinglePart(UR.fromBuffer(bytes));
    // Base64 wrapped at 64 columns (PEM) and at 76 with CRLF (MIME), the value across a line end.
    const wrap = (text: string, width: number, eol: string) => text.match(new RegExp(`.{1,${width}}`, 'g'))!.join(eol);
    const pem = wrap(b64('x'.repeat(5), JSON.stringify({ key: TV1.xpub })), 64, '\n');
    const mime = wrap(b64(Buffer.alloc(50, 1), Buffer.from(TV1.chainCode, 'hex'), Buffer.alloc(40, 2)), 76, '\r\n');
    const [ownBE, ownLE] = numbersOf(TV1.fingerprint);
    const [masterBE, masterLE] = numbersOf(TV1.masterFingerprint);
    const r = exportOf(
      repoWith({
        'b64-short-0.ts': `const a = '${short[0]}';\n`,
        'b64-short-1.ts': `const a = '${short[1]}';\n`,
        'b64-short-2.ts': `const a = '${short[2]}';\n`,
        'b64-short-hex.ts': `const a = '${short[3]}';\n`,
        'b64url-pub.ts': `const a = '${pubUrl}';\n`,
        'b64url-chain.ts': `const a = '${chainUrl}';\n`,
        // Glued to other base64 letters, so a decoded run reads it out of step.
        'b64-glued.ts': `const a = 'Zz${b64('k', TV1.xpub)}';\n`,
        'ur.ts': `const q = '${urOf(Buffer.from(base58check.decode(TV1.xpub)))}';\n`,
        'ur-upper.txt': `${urOf(Buffer.from(`{"xfp":"${TV1.masterFingerprint}"}`)).toUpperCase()}\n`,
        'xonly.bin': Buffer.concat([Buffer.from([0, 0x20]), Buffer.from(TV1_XONLY, 'hex'), Buffer.from([1])]),
        'xonly.ts': `const internal = '${TV1_XONLY}';\n`,
        'own-be.ts': `const fp = ${ownBE};\n`,
        'own-le.json': `{"fingerprint": ${ownLE}}\n`,
        'master-le.ts': `const fp = ${masterLE};\n`,
        'longer-number.ts': `const n = 9${masterBE}1;\n`,
        'pem.txt': `-----BEGIN DATA-----\n${pem}\n-----END DATA-----\n`,
        'mime.eml': `Content-Transfer-Encoding: base64\r\n\r\n${mime}\r\n`,
        'clean.ts': 'const nothing = 1;\n',
      }),
      '--markers',
      markers,
    );
    expect(r.status).toBe(1);
    const hit = (file: string, line: number) => `${file}: holds the value on line ${line} of the markers file`;
    // The master fingerprint is a value of both lines, and a whole key decoded
    // from its bytes (ur.ts, pem.txt) names it as its parent's fingerprint;
    // everything else is line 4's alone.
    for (const f of ['b64-short-0.ts', 'b64-short-1.ts', 'b64-short-2.ts', 'b64-short-hex.ts', 'ur-upper.txt', 'master-le.ts', 'ur.ts', 'pem.txt']) {
      expect(r.text).toContain(hit(f, 3));
      expect(r.text).toContain(hit(f, 4));
    }
    for (const f of ['b64url-pub.ts', 'b64url-chain.ts', 'b64-glued.ts', 'xonly.bin', 'xonly.ts', 'own-be.ts', 'own-le.json', 'mime.eml']) {
      expect(r.text).toContain(hit(f, 4));
      expect(r.text).not.toContain(hit(f, 3));
    }
    // A decimal fingerprint counts only whole, never inside a longer number.
    for (const f of ['longer-number.ts', 'clean.ts']) expect(r.text).not.toContain(f);
    expect(r.text).toContain('13 marker values from 2 lines');
    const lower = r.text.toLowerCase();
    expect(r.text).not.toContain(TV1.xpub);
    for (const v of [TV1.masterFingerprint, TV1.publicKey, TV1.chainCode, TV1.fingerprint, TV1_XONLY, ownBE, ownLE, masterBE, masterLE]) {
      expect(lower).not.toContain(v);
    }
  });

  it('finds an extended key whose own text is hard-wrapped over bare lines, never printing it', () => {
    const markers = path.join(tmp, 'markers.txt');
    fs.writeFileSync(markers, MARKERS_FILE);
    const wrap = (text: string, width: number) => text.match(new RegExp(`.{1,${width}}`, 'g'))!;
    const r = exportOf(
      repoWith({
        'wrapped-64.txt': `key:\n${wrap(TV1.xpub, 64).join('\n')}\n`,
        'wrapped-76.eml': `Key:\r\n${wrap(TV1.xpub, 76).join('\r\n')}\r\n`,
        'wrapped-80.md': `A key:\n\n${wrap(TV1.xpub, 80).map((l) => `    ${l}`).join('\n')}\n`,
        'clean.ts': 'const nothing = 1;\n',
      }),
      '--markers',
      markers,
    );
    expect(r.status).toBe(1);
    // The key's bytes name the master fingerprint as its parent, so line 3 counts too.
    for (const f of ['wrapped-64.txt', 'wrapped-76.eml', 'wrapped-80.md']) {
      expect(r.text).toContain(`${f}: holds the value on line 3 of the markers file`);
      expect(r.text).toContain(`${f}: holds the value on line 4 of the markers file`);
    }
    expect(r.text).not.toContain('clean.ts');
    expect(r.text).not.toContain(TV1.xpub);
    for (const part of [...wrap(TV1.xpub, 64), ...wrap(TV1.xpub, 76), ...wrap(TV1.xpub, 80)]) expect(r.text).not.toContain(part);
  });

  it('stops before anything is committed when the markers file holds a line it cannot read, without printing it', () => {
    const broken = `${TV1.xpub.slice(0, -1)}${TV1.xpub.endsWith('w') ? 'x' : 'w'}`;
    const markers = path.join(tmp, 'markers.txt');
    fs.writeFileSync(markers, `# comment\nkey ${broken}\n`);
    const r = exportOf(repoWith({ 'a.ts': 'x\n' }), '--markers', markers, '--init', '--author', 'Release Bot <release@example.com>');
    expect(r.status).toBe(2);
    expect(r.text).toContain('line 2 of the markers file holds an extended key that does not decode');
    expect(r.text).not.toContain(broken);
    expect(fs.existsSync(path.join(r.out, '.git'))).toBe(false);
  });

  it('with --init makes one commit by the given identity, with no remote', () => {
    const repo = repoWith({ 'package.json': '{ "name": "x", "version": "9.8.7" }\n', 'src/a.ts': 'x\n', 'CLAUDE.md': 'n\n' });
    const r = exportOf(repo, '--init', '--author', 'Release Bot <release@example.com>');
    expect(r.status).toBe(0);
    expect(git(r.out, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(git(r.out, 'remote')).toBe('');
    expect(git(r.out, 'log', '-1', '--format=%an <%ae>|%s')).toBe('Release Bot <release@example.com>|Talia 9.8.7');
    expect(git(r.out, 'ls-files').split('\n').sort()).toEqual(['package.json', 'src/a.ts']);
    // The private commit's id is not carried into the copy.
    expect(git(r.out, 'log', '-1', '--format=%B')).not.toContain(git(repo, 'rev-parse', 'HEAD').slice(0, 7));
  });

  it('dates the commit as the source commit, in UTC', () => {
    const repo = repoWith({ 'package.json': '{ "version": "1.0.0" }\n' });
    const r = exportOf(repo, '--init', '--author', 'Release Bot <release@example.com>');
    expect(r.status).toBe(0);
    const [author, committer] = git(r.out, 'log', '-1', '--format=%aI|%cI').split('|');
    expect(author).toBe(committer);
    expect(author).toMatch(/(Z|\+00:00)$/);
    expect(Date.parse(author)).toBe(Date.parse(git(repo, 'show', '-s', '--format=%cI', 'HEAD')));
  });

  it('with --onto adds one commit on top of the public history, dropping a file deleted since', () => {
    const repo = repoWith({ 'package.json': '{ "version": "1.0.0" }\n', 'src/old.ts': 'old\n', 'src/a.ts': 'one\n' });
    const first = exportOf(repo, '--init', '--author', 'Release Bot <release@example.com>');
    expect(first.status).toBe(0);
    const published = path.join(tmp, 'published');
    fs.renameSync(first.out, published);
    const clone = path.join(tmp, 'clone');
    git(tmp, 'clone', '-q', published, clone);
    const before = git(clone, 'rev-parse', 'HEAD');

    git(repo, 'rm', '-q', 'src/old.ts');
    fs.writeFileSync(path.join(repo, 'src/a.ts'), 'two\n');
    fs.writeFileSync(path.join(repo, 'package.json'), '{ "version": "1.1.0" }\n');
    fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'notes\n');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'two');

    const next = exportOf(repo, '--onto', clone, '--author', 'Release Bot <release@example.com>');
    expect(next.text).toContain('one commit added on top');
    expect(next.status).toBe(0);
    expect(git(clone, 'rev-parse', 'HEAD~1')).toBe(before);
    expect(git(clone, 'log', '-1', '--format=%an <%ae>|%s')).toBe('Release Bot <release@example.com>|Talia 1.1.0');
    expect(git(clone, 'ls-files').split('\n').sort()).toEqual(['package.json', 'src/a.ts']);
    expect(fs.readFileSync(path.join(clone, 'src/a.ts'), 'utf8')).toBe('two\n');
    expect(git(clone, 'status', '--porcelain', '--ignored')).toBe('');
    // Its remote is the public copy it was cloned from, and nothing reached it.
    expect(git(published, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('refuses --onto with --init, without an author, on a clone with changes, and on this repository or a worktree of it', () => {
    const repo = repoWith({ 'package.json': '{ "version": "1.0.0" }\n', 'a.ts': 'x\n' });
    const first = exportOf(repo, '--init', '--author', 'Release Bot <release@example.com>');
    const published = path.join(tmp, 'published');
    fs.renameSync(first.out, published);
    const clone = path.join(tmp, 'clone');
    git(tmp, 'clone', '-q', published, clone);
    const bot = ['--author', 'Release Bot <release@example.com>'];
    const again = (...extra: string[]) => {
      fs.rmSync(path.join(tmp, 'out'), { recursive: true, force: true });
      return exportOf(repo, ...extra);
    };

    expect(again('--onto', clone, '--init', ...bot).text).toContain('give one');
    expect(again('--onto', clone).status).toBe(2);
    expect(again('--onto', repo, ...bot).text).toContain('is inside the repository');
    git(repo, 'worktree', 'add', '-q', path.join(tmp, 'wt'));
    expect(again('--onto', path.join(tmp, 'wt'), ...bot).text).toContain("shares this repository's history");
    fs.writeFileSync(path.join(clone, 'stray.txt'), 'x\n');
    expect(again('--onto', clone, ...bot).text).toContain('start from a fresh clone');
    fs.rmSync(path.join(clone, 'stray.txt'));
    expect(again('--onto', clone, ...bot).text).toContain('nothing to commit');
    expect(git(clone, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('refuses --init without an author, a folder that is not empty, and anything that is not a commit', () => {
    const repo = repoWith({ 'a.ts': 'x\n' });
    expect(exportOf(repo, '--init').status).toBe(2);
    fs.mkdirSync(path.join(tmp, 'out'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'out', 'old.txt'), 'x');
    expect(exportOf(repo).text).toContain('is not empty');
    fs.rmSync(path.join(tmp, 'out'), { recursive: true });
    const r = spawnSync('bash', [SCRIPT, 'no-such-ref', path.join(tmp, 'out'), '--repo', repo], { encoding: 'utf8', env: gitEnv() });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not a commit');
  });

  it('never pushes or adds a remote', () => {
    const text = fs.readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
    expect(text).not.toMatch(/git[^\n]*\b(push|remote add|remote set-url)\b/);
  });
});

describe('public-export-scan.js', () => {
  it('passes a folder with nothing wrong', () => {
    fs.writeFileSync(path.join(tmp, 'ok.ts'), "const a = 'name@example.net';\n");
    expect(scanner.scan(tmp)).toEqual({ files: 1, problems: [] });
  });

  const markersOf = (text: string) => {
    const file = path.join(tmp, 'markers.txt');
    fs.writeFileSync(file, text);
    return () => scanner.readMarkers(file);
  };

  it('takes every value of a "label value" line and nothing of a comment line or a label', () => {
    const markers = markersOf(MARKERS_FILE)();
    const on = (line: number) => markers.filter((m) => m.line === line).map((m) => `${m.kind} ${m.value}`).sort();
    const decimals = (fp: string) => numbersOf(fp).map((n) => `decimal ${n}`);
    expect(on(3)).toEqual([`hex ${TV1.masterFingerprint}`, ...decimals(TV1.masterFingerprint)].sort());
    // An extended key: as written, its public key, x-only key, chain code and
    // own fingerprint, and each fingerprint as a decimal number in both byte orders.
    expect(on(4)).toEqual(
      [
        `text ${TV1.xpub}`,
        ...[TV1.masterFingerprint, TV1.publicKey, TV1_XONLY, TV1.chainCode, TV1.fingerprint].map((v) => `hex ${v}`),
        ...decimals(TV1.masterFingerprint),
        ...decimals(TV1.fingerprint),
      ].sort(),
    );
    expect(markers.every((m) => m.line === 3 || m.line === 4)).toBe(true);
    for (const v of ['fingerprint', 'key', KEPT_DEVICE, '0h']) expect(markers.map((m) => m.value)).not.toContain(v);
  });

  it('reads hex values in any case, with 0x, and a bare value on a line of its own', () => {
    const values = markersOf(`fingerprint 0x${TV1.fingerprint.toUpperCase()}\nc0ffee1234abcd\nshort 1234567 path 48/0/0\n`);
    expect(() => values()).toThrow('line 3 of the markers file holds no value the scan knows');
    const markers = markersOf(`fingerprint 0x${TV1.fingerprint.toUpperCase()}\nc0ffee1234abcd\n`)();
    expect(markers).toEqual([
      { value: TV1.fingerprint, kind: 'hex', line: 1 },
      ...numbersOf(TV1.fingerprint).map((value) => ({ value, kind: 'decimal', line: 1 })),
      { value: 'c0ffee1234abcd', kind: 'hex', line: 2 },
    ]);
  });

  it('refuses a line with no value and an extended key that does not decode, naming the line and never its text', () => {
    expect(markersOf('# only a comment\nfingerprint\n')).toThrow(/^line 2 of the markers file holds no value the scan knows$/);
    const broken = `${TV1.xpub.slice(0, -1)}${TV1.xpub.endsWith('w') ? 'x' : 'w'}`;
    expect(markersOf(`key [${TV1.masterFingerprint}/0h]${broken}\n`)).toThrow(
      /^line 1 of the markers file holds an extended key that does not decode$/,
    );
  });

  it('refuses a markers file that holds no value at all, and never prints one', () => {
    fs.mkdirSync(path.join(tmp, 'copy'));
    fs.writeFileSync(path.join(tmp, 'markers.txt'), `# kept test devices: ${KEPT_DEVICE}\n\n`);
    const r = spawnSync('node', [SCANNER, path.join(tmp, 'copy'), '--markers', path.join(tmp, 'markers.txt')], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('the markers file holds no value to look for');
    expect(`${r.stdout}${r.stderr}`).not.toContain(KEPT_DEVICE);
  });
});
