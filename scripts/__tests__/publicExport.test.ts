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

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'public-export.sh');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const scanner = require('../public-export-scan.js') as {
  scan: (root: string, markers?: { value: string; line: number }[]) => { files: number; problems: string[] };
};

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
});
