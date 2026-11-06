/**
 * scripts/native-sources.js: what native/build-bitboxffi.sh and
 * native/build-bdkwallet.sh ask before and after a build (decided
 * 2026-10-05). The old engine's native/build-bdkffi.sh went with its library
 * (decided 2026-11-04). Every test runs against throwaway git repositories in the OS temp
 * folder; the "org repo" is a local bare repository, so no test needs the
 * network.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

type Entry = Record<string, any>;
const src = require('../native-sources.js') as {
  repoKey: (url: string) => string;
  inspectCheckout: (
    dir: string,
    opts: {
      repoUrl: string;
      fetch?: boolean;
      expectCommit?: string | null;
      branch?: string | null;
      pinned?: string | null;
      rollback?: string | null;
    },
  ) => Entry;
  checkRequest: (args: string[], root: string) => Entry | null;
  recordFloor: (text: string | null, lib: string, where?: string) => { commit?: string | null; problem?: string };
  recordFloors: (root: string, lib: string) => { floors: Entry[]; problems: string[]; spoiled: string[] };
  buildConfigOutside: (root: string, home?: string) => string[];
  cargoEnv: (env: Record<string, string | undefined>) => { kept: Record<string, string>; dropped: string[] };
  withSourceRecord: (
    text: string,
    lib: string,
    commit: string,
    built: { path: string; sha256: string }[],
    generated?: { path: string; sha256: string }[],
    xcode?: { version: string; build: string } | null,
  ) => string;
  withPins: (text: string, lib: string, digests: Record<string, string>) => string;
  pinsOf: (text: string, lib: string) => { path: string; pinned: string }[];
  withRecordedBuildsPinned: (text: string, root: string) => { text: string; testing: Entry[] };
  BUILD_OUTPUTS: Record<string, { libs: Record<string, string>; generated: Record<string, Entry>; gate?: string }>;
  allowlistText: (judged: Entry[]) => string;
  builtCheckout: (src: { repo: string; branch: string }, dir: string, commit: string) => { ok: boolean; root: string | null; problems: string[] };
  COPIES: { repo: string; tagPrefix: string; tags: string[] };
  copyName: (sha256: string, file: string) => string;
  main: (
    argv: string[],
    root?: string,
    deps?: {
      xcode?: () => { version: string; build: string } | null;
      checkout?: (src: Entry, dir: string, commit: string) => { ok: boolean; root: string | null; problems: string[] };
      copies?: {
        release: (tag: string) => { tag: string; name: string; size: number; digest?: string | null }[];
        fetch: (copy: { tag: string; name: string; size: number; digest?: string | null }, dir: string) => string;
        pause?: (ms: number) => void;
      };
    },
  ) => number;
};
const prov = require('../archive-provenance.js') as {
  NATIVE_PIN: string;
  gitEnv: (extra?: Record<string, string>) => Record<string, string>;
  NATIVE_SOURCES: Record<
    string,
    { repo: string; branch: string; libDir: string; files: string[]; generated: string[]; build: string; podspec: string }
  >;
  parseNativeSources: (text: string | null) => { sources: Entry[]; problems: string[] };
};

// The public repos the libraries are built from (decided 2026-11-06).
const BDK_REPO = 'https://github.com/21st-Capital/talia-bdk-ffi';
const BITBOX_REPO = 'https://github.com/21st-Capital/talia-bitbox-ffi';
// The private repos they are developed in: a record naming one is refused, and
// the release-file copies of the pinned libraries stay on the bdk-ffi one.
const BDK_PRIVATE_REPO = 'https://github.com/21st-Capital/bdk-ffi-fork';
const BITBOX_PRIVATE_REPO = 'https://github.com/21st-Capital/bitbox-ffi';
const OLD = 'a1'.repeat(20); // made-up commit ids
const NEW = 'c3'.repeat(20);
const BDK = 'e5'.repeat(20);
const sha = (text: string | Buffer) => require('crypto').createHash('sha256').update(text).digest('hex');
/** A static library (an ar archive) whose members name these crates, as rustc names its objects. */
const arOf = (crates: string[]): Buffer => {
  const parts = [Buffer.from('!<arch>\n', 'latin1')];
  for (const c of crates) {
    const name = Buffer.from(`${c}-0123456789abcdef.${c}.0123456789abcdef-cgu.0.rcgu.o`, 'latin1');
    const body = Buffer.concat([name, Buffer.from('object')]);
    const field = (v: string, n: number) => Buffer.from(v.padEnd(n, ' '), 'latin1');
    parts.push(field(`#1/${name.length}`, 16), field('0', 12), field('0', 6), field('0', 6), field('644', 8), field(String(body.length), 10), Buffer.from('`\n'), body);
    if (body.length % 2 === 1) {
      parts.push(Buffer.from('\n'));
    }
  }
  return Buffer.concat(parts);
};

let tmp: string;
let crate: string;
let bare: string;

function gitIn(dir: string, ...args: string[]): string {
  return execFileSync(
    'git',
    // init.defaultBranch: CI's git still starts repos on "master", Xcode's on "main".
    ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}
const git = (...args: string[]) => gitIn(crate, ...args);

function put(rel: string, text: string, root = crate): void {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

// Before a build the allowlisted branch is always named; the org repo here holds main.
const inspect = (opts: Partial<{ fetch: boolean; expectCommit: string }> = {}) =>
  src.inspectCheckout(crate, { repoUrl: bare, branch: 'main', ...opts });

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'talia-src-')));
  // The org repo, and a checkout of it holding a small Rust crate.
  bare = path.join(tmp, 'org', 'bitbox-ffi.git');
  fs.mkdirSync(bare, { recursive: true });
  gitIn(bare, 'init', '-q', '--bare');
  crate = path.join(tmp, 'bitbox-ffi');
  fs.mkdirSync(crate);
  git('init', '-q');
  put('Cargo.toml', '[package]\nname = "bitbox-ffi"\n');
  put('Cargo.lock', '# lock\n');
  put('src/lib.rs', 'pub fn f() {}\n');
  put('README.md', '# bitbox-ffi\n');
  put('.gitignore', 'target/\ngenerated/\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  git('remote', 'add', 'upstream', path.join(tmp, 'somewhere-else.git'));
  git('remote', 'add', 'org', bare);
  git('push', '-q', 'org', 'HEAD:refs/heads/main');
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
  // git 2.4x+ may still be running its detached auto-maintenance in a test repo
  // (found 2026-10-22: ENOTEMPTY under a full parallel run), so the removal retries.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('the source checkout, before a build', () => {
  it('passes a clean checkout of a pushed commit, found by the remote\'s URL, and names the branch', () => {
    const r = inspect();
    expect(r.ok).toBe(true);
    expect(r.commit).toBe(git('rev-parse', 'HEAD'));
    expect(r.remote).toEqual({ name: 'org', url: bare });
    expect(r.branches).toEqual(['org/main']);
  });

  it('ignores build output a committed .gitignore names, and Finder\'s .DS_Store', () => {
    put('target/aarch64-apple-ios/release/libbitboxffi.a', 'built');
    put('generated/bitbox.swift', 'bindings');
    put('.DS_Store', 'finder');
    expect(inspect().ok).toBe(true);
  });

  it('refuses a commit on no branch of the org repo, and one only on another branch; a deleted one is on none', () => {
    put('src/lib.rs', 'pub fn g() {}\n');
    git('commit', '-qam', 'local only');
    const r = inspect();
    expect(r.ok).toBe(false);
    expect(r.why).toBe('unpushed');
    expect(r.problems).toEqual([`${r.commit} is on no branch of ${bare}`]);
    // Another branch of the org repo is not the allowlisted one.
    git('push', '-q', 'org', 'HEAD:refs/heads/feature');
    expect(inspect()).toMatchObject({ ok: false, why: 'off-branch', branches: ['org/feature'] });
    git('push', '-q', 'org', '--delete', 'feature');
    // Fetched with --prune: a branch deleted on the org repo no longer counts.
    expect(inspect().why).toBe('unpushed');
  });

  it('fetches first: a commit pushed from another checkout counts, a stale tracking ref does not', () => {
    const other = path.join(tmp, 'other');
    execFileSync('git', ['clone', '-q', '-b', 'main', bare, other]);
    put('src/lib.rs', 'pub fn h() {}\n', other);
    gitIn(other, 'commit', '-qam', 'from elsewhere');
    gitIn(other, 'push', '-q', 'origin', 'HEAD:main');
    git('fetch', '-q', 'org');
    git('checkout', '-q', 'org/main');
    // Now rewrite the org repo's main to drop that commit; only a fresh fetch shows it.
    gitIn(other, 'push', '-q', '-f', 'origin', 'HEAD~1:main');
    expect(git('branch', '-r', '--contains', 'HEAD')).toContain('org/main');
    expect(inspect().why).toBe('unpushed');
  });

  it.each([
    ['an edited file', () => put('src/lib.rs', 'pub fn evil() {}\n'), ' M src/lib.rs'],
    ['a deleted file', () => fs.rmSync(path.join(crate, 'src/lib.rs')), ' D src/lib.rs'],
    ['an edited Markdown file (a crate can include_str! it)', () => put('README.md', '# changed\n'), ' M README.md'],
    ['an edited Cargo.lock', () => put('Cargo.lock', '# other deps\n'), ' M Cargo.lock'],
    ['an untracked source file', () => put('src/extra.rs', 'pub fn x() {}\n'), '?? src/extra.rs'],
    ['an untracked .cargo/config.toml', () => put('.cargo/config.toml', '[patch]\n'), '?? .cargo/config.toml'],
  ])('refuses %s', (_what, change, line) => {
    change();
    const r = inspect();
    expect(r.ok).toBe(false);
    expect(r.why).toBe('dirty');
    expect(r.problems).toContain(line);
  });

  it('refuses an edit git status cannot see: --skip-worktree and --assume-unchanged', () => {
    for (const flag of ['--skip-worktree', '--assume-unchanged']) {
      git('update-index', flag, 'src/lib.rs');
      put('src/lib.rs', 'pub fn evil() {}\n');
      expect(git('status', '--porcelain')).toBe('');
      expect(inspect().problems).toEqual([' M src/lib.rs']);
      git('update-index', flag.replace('--', '--no-'), 'src/lib.rs');
      git('checkout', '--', 'src/lib.rs');
    }
  });

  it('refuses a file hidden by .git/info/exclude or by an untracked .gitignore', () => {
    put('src/evil.rs', 'pub fn evil() {}\n');
    fs.appendFileSync(path.join(crate, '.git', 'info', 'exclude'), 'src/evil.rs\n');
    expect(git('status', '--porcelain')).toBe('');
    expect(inspect().problems).toEqual(['?? src/evil.rs']);
    fs.writeFileSync(path.join(crate, '.git', 'info', 'exclude'), '');
    put('src/.gitignore', '*\n');
    expect(git('status', '--porcelain')).toBe('');
    expect(inspect().problems).toEqual(
      expect.arrayContaining([
        '!! ignored: src/evil.rs is hidden by src/.gitignore, not by a committed .gitignore',
      ]),
    );
  });

  it('refuses a checkout with no remote pointing at the org repo', () => {
    git('remote', 'remove', 'org');
    const r = inspect();
    expect(r.why).toBe('no-remote');
    expect(r.problems).toEqual([`no remote of this checkout is ${bare}`]);
  });

  it('refuses when the org repo cannot be fetched', () => {
    const gone = path.join(tmp, 'gone.git');
    git('remote', 'set-url', 'org', gone);
    const r = src.inspectCheckout(crate, { repoUrl: gone, branch: 'main' });
    expect(r.why).toBe('fetch');
    expect(r.problems[0]).toContain(`could not fetch ${gone} (remote org)`);
  });

  it('refuses a folder inside the checkout, or no checkout at all', () => {
    const opts = { repoUrl: bare, branch: 'main' };
    expect(src.inspectCheckout(path.join(crate, 'src'), opts).why).toBe('not-git');
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    expect(src.inspectCheckout(plain, opts).why).toBe('not-git');
    expect(src.inspectCheckout(path.join(tmp, 'missing'), opts).why).toBe('missing');
  });

  it('after the build (no network): still clean, and still the same commit', () => {
    const commit = git('rev-parse', 'HEAD');
    git('remote', 'remove', 'org'); // nothing is fetched
    expect(inspect({ fetch: false, expectCommit: commit }).ok).toBe(true);
    put('target/release/libbitboxffi.a', 'built');
    expect(inspect({ fetch: false, expectCommit: commit }).ok).toBe(true);
    put('src/lib.rs', 'pub fn mid_build() {}\n');
    expect(inspect({ fetch: false, expectCommit: commit }).why).toBe('dirty');
    git('commit', '-qam', 'moved');
    expect(inspect({ fetch: false, expectCommit: commit }).why).toBe('moved');
  });

  it('record\'s own look at the checkout: exactly the commit, clean, on the branch as last fetched, with no network (decided 2026-10-17)', () => {
    const lib = { repo: bare, branch: 'main' };
    const first = git('rev-parse', 'HEAD');
    git('fetch', '-q', 'org');
    expect(src.builtCheckout(lib, crate, first)).toMatchObject({ ok: true, problems: [] });
    // Build output a committed .gitignore names is fine.
    put('target/aarch64-apple-ios/release/libbitboxffi.a', 'built');
    put('generated/bitbox.swift', 'bindings');
    expect(src.builtCheckout(lib, crate, first).ok).toBe(true);
    // Another commit than the one the build started from.
    expect(src.builtCheckout(lib, crate, NEW).problems.join('\n')).toContain(`HEAD is now ${first}`);
    // An edit since.
    put('src/lib.rs', 'pub fn edited() {}\n');
    expect(src.builtCheckout(lib, crate, first)).toMatchObject({ ok: false });
    git('checkout', '-q', '--', 'src/lib.rs');
    // A commit on no branch of the org repo as this checkout last fetched it.
    put('src/lib.rs', 'pub fn local() {}\n');
    git('commit', '-qam', 'local only');
    const local = git('rev-parse', 'HEAD');
    expect(src.builtCheckout(lib, crate, local).problems).toEqual([`${local} is not on org/main as this checkout last fetched it`]);
    // Another branch, or no remote that is the repo.
    git('checkout', '-q', first);
    expect(src.builtCheckout({ repo: bare, branch: 'talia' }, crate, first).ok).toBe(false);
    expect(src.builtCheckout({ repo: BITBOX_REPO, branch: 'main' }, crate, first).problems).toEqual([`no remote of ${crate} is ${BITBOX_REPO}`]);
  });

  it('the CLI prints only the commit on stdout, and refuses a checkout off the org repo', () => {
    // The CLI always asks for the real org repo, which this checkout lacks.
    expect(src.main(['check', 'bitboxffi', crate])).toBe(2);
    expect(src.main(['check', 'bitboxffi', crate, '--rollback', git('rev-parse', 'HEAD')])).toBe(2);
    expect(process.stdout.write).not.toHaveBeenCalled();
    expect(src.main(['check', 'otherffi', crate])).toBe(64);
    // --rollback takes the commit, and nothing else is an option.
    expect(src.main(['check', 'bitboxffi', crate, '--rollback'])).toBe(64);
    expect(src.main(['check', 'bitboxffi', crate, '--force'])).toBe(64);
    expect(src.main(['recheck', 'bitboxffi', crate, git('rev-parse', 'HEAD')])).toBe(0);
    expect(process.stdout.write).toHaveBeenCalledWith(`${git('rev-parse', 'HEAD')}\n`);
    expect(src.main(['recheck', 'bitboxffi', crate, 'HEAD'])).toBe(64);
  });
});

/**
 * Decided 2026-10-16: a build is taken only from the library's
 * allowlisted branch, and only from a commit that contains the one its record
 * names, so it never goes backwards by accident; an older commit of the
 * branch needs --rollback naming it. Here the org repo's main is A then B.
 */
describe('the allowlisted branch and the recorded commit', () => {
  let A: string;
  let B: string;
  const head = () => git('rev-parse', 'HEAD');
  const commitOn = (file: string, refs: string[]) => {
    put(file, `${file}\n`);
    git('add', file);
    git('commit', '-qm', file);
    for (const ref of refs) {
      git('push', '-q', 'org', `HEAD:refs/heads/${ref}`);
    }
    return head();
  };
  const judge = (opts: { pinned?: any; rollback?: string | null; branch?: string }) =>
    src.inspectCheckout(crate, { repoUrl: bare, branch: 'main', ...opts });
  // An app checkout whose LAST COMMIT holds `committed` as its record (none
  // when null), and whose working tree then holds `working` (as committed
  // when undefined, no file when null).
  const appWith = (committed: string | null, working?: string | null, name = 'app') => {
    const app = path.join(tmp, name);
    fs.mkdirSync(app, { recursive: true });
    gitIn(app, 'init', '-q');
    put(committed === null ? 'README.md' : prov.NATIVE_PIN, committed === null ? '# app\n' : committed, app);
    gitIn(app, 'add', '.');
    gitIn(app, 'commit', '-qm', 'app');
    if (working === null) {
      fs.rmSync(path.join(app, prov.NATIVE_PIN), { force: true });
    } else if (working !== undefined) {
      put(prov.NATIVE_PIN, working, app);
    }
    return app;
  };
  const bitboxRecord = (commit: string) => `# source bitboxffi ${BITBOX_REPO} ${commit}\n`;
  // check's request, judged against the scratch org repo instead of GitHub.
  const judgeRequest = (app: string, args: string[] = []) => {
    const req = src.checkRequest(['bitboxffi', crate, ...args], app)!;
    expect(req.problems).toEqual([]);
    return src.inspectCheckout(crate, { ...req.opts, repoUrl: bare, branch: 'main' });
  };

  beforeEach(() => {
    A = head();
    B = commitOn('src/b.rs', ['main']);
  });

  it('accepts a commit of the branch that contains the recorded one, or is it', () => {
    expect(judge({ pinned: A })).toMatchObject({
      ok: true,
      commit: B,
      branch: 'org/main',
      floors: [{ commit: A, contained: true }],
      rollback: false,
    });
    git('checkout', '-q', A);
    expect(judge({ pinned: A })).toMatchObject({ ok: true, commit: A, rollback: false });
    // A first build: the record names no commit yet, and the branch rule alone applies.
    expect(judge({ pinned: null })).toMatchObject({ ok: true, commit: A, floors: [], rollback: false });
    expect(judge({ pinned: [] })).toMatchObject({ ok: true, commit: A, floors: [], rollback: false });
  });

  it('refuses a commit only on another branch, even one that contains the recorded commit (a harness branch)', () => {
    const golden = commitOn('golden_talia.rs', ['golden/028']);
    const r = judge({ pinned: A });
    expect(r).toMatchObject({ ok: false, why: 'off-branch', commit: golden, branches: ['org/golden/028'] });
    expect(r.problems).toEqual([`${golden} is not on main of ${bare} (only on: golden/028)`]);
    // A feature branch is refused the same way, until it is merged into the branch.
    git('push', '-q', 'org', 'HEAD:refs/heads/feature');
    expect(judge({ pinned: A })).toMatchObject({ why: 'off-branch', branches: ['org/feature', 'org/golden/028'] });
    git('push', '-q', 'org', 'HEAD:refs/heads/main');
    expect(judge({ pinned: A })).toMatchObject({ ok: true, commit: golden });
  });

  it('refuses an ancestor of the recorded commit without --rollback: the build would go backwards', () => {
    git('checkout', '-q', A);
    const r = judge({ pinned: B });
    expect(r).toMatchObject({ ok: false, why: 'behind-pin', commit: A });
    expect(r.problems).toEqual([
      `${A} does not contain ${B}, the commit ${prov.NATIVE_PIN} records: this build would go backwards`,
    ]);
    // A recorded commit this checkout does not even hold cannot be shown to be contained.
    git('checkout', '-q', B);
    const unknown = 'f'.repeat(40);
    expect(judge({ pinned: unknown })).toMatchObject({ ok: false, why: 'behind-pin' });
    expect(judge({ pinned: unknown }).problems[0]).toContain('this checkout does not hold it');
  });

  it('accepts that older commit of the branch with --rollback naming it, full or short, even after a hotfix', () => {
    // The branch has moved on since B was recorded (a hotfix), so the guard is not "tip only".
    commitOn('src/hotfix.rs', ['main']);
    git('checkout', '-q', A);
    expect(judge({ pinned: B, rollback: A })).toMatchObject({ ok: true, commit: A, rollback: true });
    expect(judge({ pinned: B, rollback: A.slice(0, 7) })).toMatchObject({ ok: true, commit: A, rollback: true });
    // Naming a commit that does not go back is allowed, and is not a rollback.
    git('checkout', '-q', B);
    expect(judge({ pinned: A, rollback: B })).toMatchObject({ ok: true, rollback: false });
  });

  it('refuses --rollback that names anything but the commit being built', () => {
    git('checkout', '-q', A);
    for (const rollback of [B, B.slice(0, 7), 'main', 'HEAD', '--all', 'A'.repeat(40)]) {
      const r = judge({ pinned: B, rollback });
      expect(r).toMatchObject({ ok: false, why: 'rollback-mismatch' });
      expect(r.problems).toEqual([`--rollback names ${rollback}, but the checkout is ${A}`]);
    }
  });

  it('refuses --rollback of a commit off the branch: the rollback is still from the branch alone', () => {
    git('checkout', '-q', A);
    const golden = commitOn('golden_talia.rs', ['golden/028']);
    expect(judge({ pinned: B, rollback: golden })).toMatchObject({ ok: false, why: 'off-branch', commit: golden });
    // ...and a commit on no branch at all.
    const local = commitOn('src/local.rs', []);
    expect(judge({ pinned: B, rollback: local })).toMatchObject({ ok: false, why: 'unpushed', commit: local });
  });

  it('refuses when the org repo has no such branch, and a check before a build always names one', () => {
    expect(judge({ pinned: A, branch: 'talia' })).toMatchObject({ ok: false, why: 'no-branch' });
    expect(judge({ pinned: A, branch: 'talia' }).problems).toEqual([
      `${bare} has no branch talia, the only one this library is built from`,
    ]);
    expect(() => src.inspectCheckout(crate, { repoUrl: bare })).toThrow(/allowlisted branch/);
    // After the build there is no network and no branch to ask about.
    expect(src.inspectCheckout(crate, { repoUrl: bare, fetch: false, expectCommit: B }).ok).toBe(true);
  });

  it('check asks for each library\'s own branch and the commits its records name, and passes --rollback on', () => {
    const working = `the commit ${prov.NATIVE_PIN} records`;
    const committed = `the commit ${prov.NATIVE_PIN} records in the app's last commit`;
    const app = appWith(`# source bdkwallet ${BDK_REPO} ${BDK}\n${bitboxRecord(OLD)}`);
    expect(src.checkRequest(['bitboxffi', crate], app)).toMatchObject({
      lib: 'bitboxffi',
      dir: crate,
      problems: [],
      opts: { repoUrl: BITBOX_REPO, branch: 'main', pinned: [{ commit: OLD, where: working }], rollback: null },
    });
    expect(src.checkRequest(['bdkwallet', crate, '--rollback', NEW.slice(0, 7)], app)).toMatchObject({
      opts: { repoUrl: BDK_REPO, branch: 'main', pinned: [{ commit: BDK }], rollback: NEW.slice(0, 7) },
    });
    // The old engine's library is no library to build any more.
    expect(src.checkRequest(['bdkffi', crate], app)).toBeNull();
    // A build recorded and not committed yet: the commit of each record is a floor.
    put(prov.NATIVE_PIN, `# source bdkwallet ${BDK_REPO} ${BDK}\n${bitboxRecord(NEW)}`, app);
    expect(src.checkRequest(['bitboxffi', crate], app)!.opts.pinned).toEqual([
      { commit: NEW, where: working },
      { commit: OLD, where: committed },
    ]);
    // Nothing of the library in either record: its first build.
    const first = appWith(`# source bdkwallet ${BDK_REPO} ${BDK}\n`, undefined, 'first');
    expect(src.checkRequest(['bitboxffi', crate], first)).toMatchObject({ problems: [], opts: { pinned: [] } });
    for (const args of [
      ['bitboxffi'],
      ['bitboxffi', crate, '--rollback'],
      ['bitboxffi', crate, '--rollback', ''],
      ['bitboxffi', crate, '--rollback', NEW, 'more'],
      ['bitboxffi', crate, '--force'],
      ['bitboxffi', crate, NEW],
    ]) {
      expect(src.checkRequest(args, app)).toBeNull();
    }
  });

  it('the floor is the committed record too: an abandoned rollback in the working tree does not lower it (decided 2026-10-16)', () => {
    // main is A, B, C. The app last committed the build of C; then a rollback
    // to A was built, which rewrote the working tree's record, and abandoned.
    const C = commitOn('src/c.rs', ['main']);
    const app = appWith(bitboxRecord(C), bitboxRecord(A));
    git('checkout', '-q', B);
    const r = judgeRequest(app);
    expect(r).toMatchObject({ ok: false, why: 'behind-pin', commit: B });
    expect(r.problems).toEqual([
      `${B} does not contain ${C}, the commit ${prov.NATIVE_PIN} records in the app's last commit: this build would go backwards`,
    ]);
    // Going back past it is still possible, by name.
    expect(judgeRequest(app, ['--rollback', B])).toMatchObject({
      ok: true,
      rollback: true,
      floors: [
        { commit: A, contained: true },
        { commit: C, contained: false },
      ],
    });
    // The committed commit, or anything after it, builds as before.
    git('checkout', '-q', C);
    expect(judgeRequest(app)).toMatchObject({ ok: true, rollback: false });
    // A working-tree record emptied of the library does not lower it either.
    const emptied = appWith(bitboxRecord(C), '', 'emptied');
    git('checkout', '-q', B);
    expect(judgeRequest(emptied)).toMatchObject({ ok: false, why: 'behind-pin' });
  });

  it('a record that cannot set the floor is refused, never read as a first build (decided 2026-10-16)', () => {
    const digest = 'a'.repeat(64);
    const lib = 'native/bitboxffi/lib/libbitboxffi-ios.a';
    const built = `# built bitboxffi ${digest} ${lib}\n${digest}  ${lib}\n`;
    const floor = (text: string | null) => src.recordFloor(text, 'bitboxffi');
    expect(floor(bitboxRecord(OLD) + built)).toEqual({ commit: OLD });
    expect(floor('')).toEqual({ commit: null });
    expect(floor(`# source bdkwallet ${BDK_REPO} ${BDK}\n`)).toEqual({ commit: null });
    for (const [text, says] of [
      [null, `${prov.NATIVE_PIN} cannot be read`],
      // The reviewer's case: a short commit, with the pins still in place.
      [`# source bitboxffi ${BITBOX_REPO} ${OLD.slice(0, 7)}\n${built}`, 'is not "# source bitboxffi <repo URL> <40-hex commit>"'],
      [built, 'pins or build lines but no "# source bitboxffi" line'],
      [`${digest}  ${lib}\n`, 'pins or build lines'],
      ['# source-note bitboxffi: written by hand\n', 'pins or build lines'],
      [bitboxRecord(NEW) + bitboxRecord(OLD), '2 "# source bitboxffi" lines'],
      [`# source bitboxffi https://github.com/someone/bitbox-ffi ${OLD}\n`, 'is not "# source bitboxffi'],
      [bitboxRecord('0'.repeat(40)), 'is not "# source bitboxffi'],
      // The private repo a library is developed in is not its repo, with a
      // whole commit or not (decided 2026-11-06), nor the other library's.
      [`# source bitboxffi ${BITBOX_PRIVATE_REPO} ${OLD}\n${built}`, 'is not "# source bitboxffi'],
      [`# source bitboxffi ${BDK_PRIVATE_REPO} ${OLD}\n${built}`, 'is not "# source bitboxffi'],
      [`# source bitboxffi ${BITBOX_PRIVATE_REPO}.git ${OLD}\n${built}`, 'is not "# source bitboxffi'],
      [`# source bitboxffi ${BITBOX_PRIVATE_REPO} ${OLD.slice(0, 7)}\n${built}`, 'is not "# source bitboxffi'],
      [`# source bitboxffi ${BITBOX_PRIVATE_REPO} ${OLD}\n${bitboxRecord(NEW)}`, '2 "# source bitboxffi" lines'],
    ] as [string | null, string][]) {
      expect(floor(text).problem).toContain(says);
    }
    // The same for the wallet library: its public repo sets the floor, its
    // private fork is refused (decided 2026-11-06).
    expect(src.recordFloor(`# source bdkwallet ${BDK_REPO} ${BDK}\n`, 'bdkwallet')).toEqual({ commit: BDK });
    expect(src.recordFloor(`# source bdkwallet ${BDK_PRIVATE_REPO} ${BDK}\n`, 'bdkwallet')).toEqual({
      problem: `${prov.NATIVE_PIN}'s line ${JSON.stringify(`# source bdkwallet ${BDK_PRIVATE_REPO} ${BDK}`)} is not "# source bdkwallet <repo URL> <40-hex commit>"`,
    });
    // Through the CLI: refused before the checkout is even looked at, and
    // nothing reaches stdout, so the build script stops.
    const live = fs.readFileSync(path.join(__dirname, '..', '..', prov.NATIVE_PIN), 'utf8');
    const spoiled = live.replace(/^(# source bdkwallet \S+ )([0-9a-f]{7})[0-9a-f]{33}$/m, '$1$2');
    expect(spoiled).not.toBe(live);
    const err = () =>
      (process.stderr.write as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('');
    for (const [name, committedText, workingText, spoiledSide] of [
      ['short', live, spoiled, 'working'],
      ['missing', live, null, 'working'],
      ['committed', spoiled, live, 'committed'],
    ] as [string, string, string | null | undefined, string][]) {
      const app = appWith(committedText, workingText, name);
      expect(src.checkRequest(['bdkwallet', crate], app)!.spoiled).toEqual([spoiledSide]);
      (process.stderr.write as unknown as jest.Mock).mockClear();
      expect(src.main(['check', 'bdkwallet', crate], app)).toBe(2);
      expect(err()).toContain("its record cannot say which commit the app's");
      expect(err()).toContain(spoiledSide === 'committed' ? 'a commit of the app whose record is whole' : 'checkout --');
      expect(err()).not.toContain('no remote of this checkout');
    }
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it('a record naming the private repo a library is developed in is refused, never a first build (decided 2026-11-06)', () => {
    const working = `the commit ${prov.NATIVE_PIN} records`;
    const privateRecord = (commit: string) => `# source bitboxffi ${BITBOX_PRIVATE_REPO} ${commit}\n`;
    const err = () =>
      (process.stderr.write as unknown as jest.Mock).mock.calls.map((c) => String(c[0])).join('');
    // In the working tree, in the app's last commit, or both: refused before
    // the checkout is looked at, with nothing on stdout, so the build stops.
    for (const [name, committedText, workingText, spoiled] of [
      ['private-both', privateRecord(OLD), undefined, ['working', 'committed']],
      ['private-working', bitboxRecord(A), privateRecord(OLD), ['working']],
      ['private-committed', privateRecord(OLD), bitboxRecord(A), ['committed']],
    ] as [string, string, string | undefined, string[]][]) {
      const app = appWith(committedText, workingText, name);
      const req = src.checkRequest(['bitboxffi', crate], app)!;
      expect(req.spoiled).toEqual(spoiled);
      expect(req.problems.join('\n')).toContain(`"# source bitboxffi ${BITBOX_PRIVATE_REPO} ${OLD}" is not "# source bitboxffi`);
      (process.stderr.write as unknown as jest.Mock).mockClear();
      expect(src.main(['check', 'bitboxffi', crate], app)).toBe(2);
      expect(err()).toContain("its record cannot say which commit the app's");
    }
    expect(process.stdout.write).not.toHaveBeenCalled();
    // The public repo's line is the floor, as for any record.
    const pub = appWith(bitboxRecord(A), undefined, 'public');
    expect(src.checkRequest(['bitboxffi', crate], pub)).toMatchObject({
      problems: [],
      spoiled: [],
      opts: { repoUrl: BITBOX_REPO, branch: 'main', pinned: [{ commit: A, where: working }] },
    });
    expect(judgeRequest(pub)).toMatchObject({ ok: true, commit: B, floors: [{ commit: A, contained: true }] });
    // Nothing of the transition is left: no former-repo table, no floor that
    // names another repo.
    expect(Object.keys(src)).not.toContain('FORMER_REPOS');
    expect(fs.readFileSync(path.join(__dirname, '..', 'native-sources.js'), 'utf8')).not.toMatch(/FORMER_REPOS|\bformers?\b/);
  });

  it('a grafts file cannot make another branch\'s commit, or an older one, read as talia\'s (decided 2026-10-16)', () => {
    const graft = (text: string) => fs.writeFileSync(path.join(crate, '.git', 'info', 'grafts'), text);
    // Plain git believes both of these (git 2.54 does, with a deprecation
    // hint; checked by hand, since a git without grafts would not).
    // A harness branch cut from A; the grafts file gives main's tip B a second parent, G.
    git('checkout', '-q', A);
    const G = commitOn('golden_talia.rs', ['golden/028']);
    graft(`${B} ${A} ${G}\n`);
    expect(judge({ pinned: A })).toMatchObject({ ok: false, why: 'off-branch', branches: ['org/golden/028'] });
    expect(judge({ pinned: A, rollback: G.slice(0, 7) })).toMatchObject({ ok: false, why: 'off-branch' });
    // An older commit of the branch given the recorded one as its parent (a
    // loop, which git walks without complaint).
    git('checkout', '-q', A);
    graft(`${A} ${B}\n`);
    expect(judge({ pinned: B })).toMatchObject({ ok: false, why: 'behind-pin', commit: A });
    // git's own environment for these checks switches both caches of parents off.
    expect(prov.gitEnv()).toMatchObject({ GIT_GRAFT_FILE: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1' });
  });

  it('no refusal prints a ready-made push or a ready-made rollback (decided 2026-10-16)', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'native-sources.js'), 'utf8');
    const hints = code.slice(code.indexOf('const hint = {'), code.indexOf("}[r.why] || ["));
    expect(hints).toContain('checkout --detach ${remote}/${src.branch}');
    // A change is reviewed in the private repository and copied to the public
    // one's main in one commit, then built (decided 2026-11-06): no hint sends
    // anyone to push, or to open a pull request, in the repo being built.
    expect(hints).not.toMatch(/\bpush\b|pull request|HEAD:/);
    for (const key of ['dirty: [', 'unpushed: [', "'off-branch': ["]) {
      const hint = hints.slice(hints.indexOf(key) + key.length);
      const said = hint
        .slice(0, hint.indexOf('],'))
        .match(/`[^`]*`|'[^']*'/g)!
        .map((l) => l.slice(1, -1))
        .join(' ');
      expect(said).toMatch(/reviewed in its private repository and copied to the public repository's \$\{src\.branch\} in one commit, then built/);
    }
    expect(hints).not.toMatch(/--rollback \$\{/);
    // The forward fix comes before any word about a rollback.
    const behind = hints.slice(hints.indexOf("'behind-pin'"));
    expect(behind.indexOf('checkout --detach')).toBeLessThan(behind.indexOf('ROLLBACK'));
  });

  it('the allowlist: both libraries build from main of their public repos, and the live record gives each a floor', () => {
    // bdkffi (branch talia) went with the old engine (decided 2026-11-04);
    // bdkwallet built from the private fork's talia-3 until 2026-11-06.
    expect(Object.fromEntries(Object.entries(prov.NATIVE_SOURCES).map(([lib, s]) => [lib, [s.repo, s.branch]]))).toEqual({
      bitboxffi: [BITBOX_REPO, 'main'],
      bdkwallet: [BDK_REPO, 'main'],
    });
    // bdkwallet's first build had no floor (nothing recorded yet); once it is
    // recorded, every later build must contain that commit, as for the others.
    expect(src.recordFloor('# header\n', 'bdkwallet')).toEqual({ commit: null });
    // The live record sets each library's floor: a full commit of its public
    // repo (decided 2026-11-06).
    const live = fs.readFileSync(path.join(__dirname, '..', '..', prov.NATIVE_PIN), 'utf8');
    for (const lib of Object.keys(prov.NATIVE_SOURCES)) {
      expect(src.recordFloor(live, lib)).toEqual({ commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    }
  });
});

describe('a GitHub repo, however it is spelled', () => {
  it.each([
    'https://github.com/21st-Capital/talia-bitbox-ffi',
    'https://github.com/21st-Capital/talia-bitbox-ffi.git',
    'https://github.com/21st-capital/Talia-Bitbox-FFI/',
    'https://user@github.com/21st-Capital/talia-bitbox-ffi.git',
    'git@github.com:21st-Capital/talia-bitbox-ffi.git',
    'ssh://git@github.com/21st-Capital/talia-bitbox-ffi',
  ])('%s is the org repo', (url) => {
    expect(src.repoKey(url)).toBe(src.repoKey(BITBOX_REPO));
  });

  it.each([
    'https://github.com/bitcoindevkit/talia-bitbox-ffi',
    'https://github.com/21st-Capital/talia-bitbox-ffi-evil',
    'https://github.com.evil.example/21st-Capital/talia-bitbox-ffi',
    'https://gitlab.com/21st-Capital/talia-bitbox-ffi',
    '/Users/dev/talia-bitbox-ffi.git',
    // The private repo it is developed in is another repo (decided 2026-11-06).
    BITBOX_PRIVATE_REPO,
    'git@github.com:21st-Capital/bitbox-ffi.git',
  ])('%s is not', (url) => {
    expect(src.repoKey(url)).not.toBe(src.repoKey(BITBOX_REPO));
  });
});

describe('the record, written after a build', () => {
  const PIN_IOS = 'native/bitboxffi/lib/libbitboxffi-ios.a';
  const PIN_SIM = 'native/bitboxffi/lib/libbitboxffi-sim.a';
  const built = (lib: string, content: string, file: string) => `# built ${lib} ${sha(content)} ${file}\n`;
  const gatedLines = (files: [string, string][]) => files.map(([f, c]) => `# gated bdkwallet ${sha(c)} ${f}\n`).join('');
  // The wallet library, recorded by its build with
  // the tracked files it wrote and the Xcode, and pinned, so the tests below
  // judge the BitBox library's record alone where they rebuild only that.
  const W_IOS = 'native/bdkwallet/lib/libbdkwallet-ios.a';
  const W_SIM = 'native/bdkwallet/lib/libbdkwallet-sim.a';
  const W_COMMIT = 'd4'.repeat(20);
  const XCODE = { version: '27.1', build: '27A9275' };
  const W_GENERATED: [string, string][] = [
    ['native/bdkwallet/BitcoinDevKit.swift', 'wallet swift'],
    ['native/bdkwallet/ffi/BitcoinDevKitFFI.h', 'wallet header'],
    // The list the gate's reports make when nothing is defined twice (the stand-in libraries).
    ['native/bdkwallet/duplicate-symbols.txt', src.allowlistText([])],
  ];
  // The BitBox library's bindings, which its build now records too.
  const OLD_GENERATED: [string, string][] = [
    ['native/bitboxffi/bitbox.swift', 'bitbox swift'],
    ['native/bitboxffi/ffi/bitboxFFI.h', 'bitbox header'],
  ];
  const BITBOX_GENERATED = OLD_GENERATED.filter(([f]) => f.startsWith('native/bitboxffi/')).map(([f, c]) => ({ path: f, sha256: sha(c) }));
  const WALLET =
    `\n# source bdkwallet ${BDK_REPO} ${W_COMMIT}\n` +
    built('bdkwallet', 'wallet ios', W_IOS) +
    built('bdkwallet', 'wallet sim', W_SIM) +
    W_GENERATED.map(([f, c]) => `# generated bdkwallet ${sha(c)} ${f}\n`).join('') +
    '# xcode bdkwallet 27.1 27A9275\n' +
    // The other library's files its overlap gate judged (decided 2026-10-17).
    gatedLines([
      [PIN_IOS, 'old ios'],
      [PIN_SIM, 'old sim'],
    ]) +
    `${sha('wallet ios')}  ${W_IOS}\n` +
    `${sha('wallet sim')}  ${W_SIM}\n`;
  // Today's shape: hand-written records whose built lines are the pins.
  const RECORD =
    '# header\n\n' +
    `# source bitboxffi ${BITBOX_REPO} ${OLD}\n` +
    '# source-note bitboxffi: INFERRED FROM DATES,\n' +
    '# source-note bitboxffi: not recorded by a build.\n' +
    built('bitboxffi', 'old ios', PIN_IOS) +
    built('bitboxffi', 'old sim', PIN_SIM) +
    `${sha('old ios')}  ${PIN_IOS}\n` +
    `${sha('old sim')}  ${PIN_SIM}\n` +
    WALLET;
  const NEW_BUILT = [
    { path: PIN_IOS, sha256: sha('new ios') },
    { path: PIN_SIM, sha256: sha('new sim') },
  ];
  let app: string;
  const recordText = () => fs.readFileSync(path.join(app, prov.NATIVE_PIN), 'utf8');
  const errors = () => {
    let err = '';
    (process.stderr.write as unknown as jest.Mock).mockImplementation((s: string) => {
      err += s;
      return true;
    });
    return () => err;
  };

  beforeEach(() => {
    app = path.join(tmp, 'app');
    put(prov.NATIVE_PIN, RECORD, app);
    put(PIN_IOS, 'old ios', app);
    put(PIN_SIM, 'old sim', app);
    put(W_IOS, 'wallet ios', app);
    put(W_SIM, 'wallet sim', app);
    for (const [file, text] of [...W_GENERATED, ...OLD_GENERATED]) {
      put(file, text, app);
    }
  });
  /**
   * native-sources.js in the fixture app, with this Mac's Xcode answered by
   * XCODE (or `xcode`), and every checkout taken as a clean checkout of the
   * commit on its branch (builtCheckout is tested on real git below).
   */
  const run = (argv: string[], xcode: { version: string; build: string } | null = XCODE) =>
    src.main(argv, app, { xcode: () => xcode, checkout: (_s, dir) => ({ ok: true, root: dir, problems: [] }) });
  // A stand-in for the fork's overlap gate: "libraries" are text files, a
  // symbol is a "sym <name>" line, and one both define is a DUPLICATE.
  const GATE = [
    'import sys',
    'new, pinned = sys.argv[3], sys.argv[4]',
    'syms = lambda f: {l.split()[1] for l in open(f) if l.startswith("sym ")}',
    'print("new: " + new + ": arm64 (1 defined global symbols, iOS)")',
    'print("pinned: " + pinned + ": arm64")',
    'for n in sorted(syms(new) & syms(pinned)):',
    '    print("    DUPLICATE " + n + ": the same code")',
    'print("RESULT: PASS: every overlap is identical (members or code)")',
    '',
  ].join('\n');
  const checkoutOf = (lib: string) => path.join(tmp, `build-${lib}`);
  const work = () => path.join(tmp, 'build-work');
  /**
   * What a build of `lib` leaves behind, as the build script then copies it
   * into the app: its outputs in the checkout (and the work folder), copies
   * of the app's files; for the new library, the overlap gate's reports too.
   */
  const leaveOutputs = (lib: string) => {
    const out = src.BUILD_OUTPUTS[lib];
    const copy = (from: string, to: string) => {
      if (fs.existsSync(path.join(app, from))) {
        put(to, fs.readFileSync(path.join(app, from), 'utf8'), '/');
      }
    };
    for (const f of prov.NATIVE_SOURCES[lib].files) {
      copy(f, path.join(checkoutOf(lib), out.libs[f.endsWith('-ios.a') ? 'ios' : 'sim']));
    }
    for (const [f, from] of Object.entries(out.generated)) {
      if (!from.gate) {
        copy(f, from.work ? path.join(work(), from.work) : path.join(checkoutOf(lib), from.checkout));
      }
    }
    if (out.gate) {
      put(out.gate, GATE, checkoutOf(lib));
      fs.mkdirSync(work(), { recursive: true });
      src.main(['gate', lib, checkoutOf(lib), work(), '/sysroot'], app);
    }
  };
  /** `record`, as the build script's last step calls it. */
  const recordOnly = (lib: string, commit = NEW, xcode: { version: string; build: string } | null = XCODE) =>
    run(['record', lib, commit, checkoutOf(lib), ...(src.BUILD_OUTPUTS[lib].gate ? [work()] : [])], xcode);
  /** A build of `lib` from `commit`: its outputs, then `record`. */
  const record = (lib: string, commit = NEW, xcode: { version: string; build: string } | null = XCODE) => {
    leaveOutputs(lib);
    return recordOnly(lib, commit, xcode);
  };
  /** The new library's build again (its overlap gate judges the libraries on disk now). */
  const regate = () => expect(record('bdkwallet', W_COMMIT)).toBe(0);

  it('the hand-written record of today is one the archive accepts', () => {
    expect(prov.parseNativeSources(RECORD).problems).toEqual([]);
  });

  it('replaces the library\'s record in place, drops its notes and old built lines, touching nothing else', () => {
    const next = src.withSourceRecord(RECORD, 'bitboxffi', NEW, NEW_BUILT);
    expect(next).toBe(
      '# header\n\n' +
        `# source bitboxffi ${BITBOX_REPO} ${NEW}\n` +
        built('bitboxffi', 'new ios', PIN_IOS) +
        built('bitboxffi', 'new sim', PIN_SIM) +
        `${sha('old ios')}  ${PIN_IOS}\n` +
        `${sha('old sim')}  ${PIN_SIM}\n` +
        WALLET,
    );
    // Recorded but not pinned: the archive refuses it until `pin`.
    const { sources, problems } = prov.parseNativeSources(next);
    expect(sources[0]).toEqual({ lib: 'bitboxffi', repo: BITBOX_REPO, commit: NEW, note: null, built: NEW_BUILT });
    expect(problems).toEqual([
      `${PIN_IOS} is pinned ${sha('old ios')}, but the build of bitboxffi recorded ${sha('new ios')}: ` +
        'the pins and the source record were not written together',
      `${PIN_SIM} is pinned ${sha('old sim')}, but the build of bitboxffi recorded ${sha('new sim')}: ` +
        'the pins and the source record were not written together',
    ]);
  });

  it('puts a missing record above the library\'s pins, else at the end, and drops a second source line', () => {
    const without = RECORD.replace(`# source bitboxffi ${BITBOX_REPO} ${OLD}\n`, '');
    expect(src.withSourceRecord(without, 'bitboxffi', NEW, NEW_BUILT)).toContain(
      `# source bitboxffi ${BITBOX_REPO} ${NEW}\n${built('bitboxffi', 'new ios', PIN_IOS)}` +
        `${built('bitboxffi', 'new sim', PIN_SIM)}${sha('old ios')}  ${PIN_IOS}\n`,
    );
    expect(src.withSourceRecord('# only a header', 'bitboxffi', OLD, [{ path: PIN_IOS, sha256: sha('x') }])).toBe(
      `# only a header\n# source bitboxffi ${BITBOX_REPO} ${OLD}\n# built bitboxffi ${sha('x')} ${PIN_IOS}\n`,
    );
    const twice = RECORD + `# source bitboxffi https://github.com/evil/bitbox-ffi ${OLD}\n#built bitboxffi junk\n`;
    const fixed = src.withSourceRecord(twice, 'bitboxffi', NEW, NEW_BUILT);
    expect(fixed.match(/# source bitboxffi/g)).toHaveLength(1);
    expect(fixed.match(/#\s*built bitboxffi/g)).toHaveLength(2);
  });

  it('record hashes the files the build copied into the app and shows them as not pinned yet', () => {
    put(PIN_IOS, 'new ios', app);
    put(PIN_SIM, 'new sim', app);
    const err = errors();
    expect(record('bitboxffi')).toBe(0);
    expect(recordText()).toBe(src.withSourceRecord(RECORD, 'bitboxffi', NEW, NEW_BUILT, BITBOX_GENERATED, XCODE));
    expect(err()).toContain(`${sha('new ios')}  ${PIN_IOS}  (NOT PINNED)`);
    expect(err()).toContain('node scripts/native-sources.js pin bitboxffi');
    expect(err()).toContain('TOGETHER');
    expect(run(['record', 'bitboxffi', NEW.slice(0, 7), checkoutOf('bitboxffi')])).toBe(64);
    expect(run(['record', 'otherffi', NEW])).toBe(64);
  });

  it('record refuses when the build left a library missing', () => {
    fs.rmSync(path.join(app, PIN_SIM));
    expect(record('bitboxffi')).toBe(2);
    expect(recordText()).toBe(RECORD);
  });

  it('a reproducible rebuild records a record that already matches its pins', () => {
    expect(record('bitboxffi')).toBe(0);
    expect(prov.parseNativeSources(recordText()).problems).toEqual([]);
  });

  it('pin, after record, pins exactly the recorded files and leaves a record the archive accepts', () => {
    put(PIN_IOS, 'new ios', app);
    put(PIN_SIM, 'new sim', app);
    expect(record('bitboxffi')).toBe(0);
    // The new library's overlap gate judged the OLD BitBox: pinning the new
    // one alone is refused until that build judges it (decided 2026-10-17).
    const err = errors();
    expect(run(['pin', 'bitboxffi'])).toBe(2);
    expect(err()).toContain(
      `bdkwallet's overlap gate judged ${PIN_IOS} as ${sha('old ios')}, but it is pinned ${sha('new ios')}: the two were never compared`,
    );
    regate();
    expect(run(['pin', 'bitboxffi'])).toBe(0);
    const text = recordText();
    expect(src.pinsOf(text, 'bitboxffi')).toEqual([
      { path: PIN_IOS, pinned: sha('new ios') },
      { path: PIN_SIM, pinned: sha('new sim') },
    ]);
    // The other library is untouched, and the archive accepts the record.
    expect(src.pinsOf(text, 'bdkwallet')).toEqual([
      { path: W_IOS, pinned: sha('wallet ios') },
      { path: W_SIM, pinned: sha('wallet sim') },
    ]);
    expect(prov.parseNativeSources(text).problems).toEqual([]);
    // Pinning again changes nothing.
    expect(run(['pin', 'bitboxffi'])).toBe(0);
    expect(recordText()).toBe(text);
  });

  it('pin refuses a file the recorded build did not write: a hand copy, after a build dropped the note', () => {
    put(PIN_IOS, 'new ios', app);
    put(PIN_SIM, 'new sim', app);
    expect(record('bitboxffi')).toBe(0);
    const recorded = recordText();
    put(PIN_IOS, 'copied by hand, or a dirty manual cargo build', app);
    const err = errors();
    expect(run(['pin', 'bitboxffi'])).toBe(2);
    expect(recordText()).toBe(recorded);
    expect(err()).toContain(`${PIN_IOS} is ${sha('copied by hand, or a dirty manual cargo build')}; the build wrote ${sha('new ios')}`);
  });

  it('pin refuses a file copied over a hand-written record (no build recorded it)', () => {
    put(PIN_IOS, 'copied by hand', app);
    expect(run(['pin', 'bitboxffi'])).toBe(2);
    expect(recordText()).toBe(RECORD);
  });

  it('pin refuses a record with no build of the library, and a record the archive would still refuse', () => {
    put(prov.NATIVE_PIN, RECORD.replace(/# built bitboxffi .*\n/g, ''), app);
    expect(run(['pin', 'bitboxffi'])).toBe(2);
    // Another library's record is broken: pinning this one would not make the record acceptable.
    const broken = src.withSourceRecord(RECORD, 'bitboxffi', NEW, NEW_BUILT).replace(`# source bdkwallet ${BDK_REPO} ${W_COMMIT}\n`, '');
    put(prov.NATIVE_PIN, broken, app);
    put(PIN_IOS, 'new ios', app);
    put(PIN_SIM, 'new sim', app);
    const err = errors();
    expect(run(['pin', 'bitboxffi'])).toBe(2);
    expect(recordText()).toBe(broken);
    expect(err()).toContain('no source line for bdkwallet');
  });

  it('pin takes two libraries rebuilt together in one write, where neither alone leaves a record the archive accepts', () => {
    put(PIN_IOS, 'new ios', app);
    put(PIN_SIM, 'new sim', app);
    // The wallet library is pinned only as a real archive with no bindgen tool in it.
    const walletIos = arOf(['bdk_wallet', 'serde_json']);
    const walletSim = arOf(['bdk_wallet', 'serde_json', 'sim']);
    fs.writeFileSync(path.join(app, W_IOS), walletIos);
    fs.writeFileSync(path.join(app, W_SIM), walletSim);
    expect(record('bitboxffi')).toBe(0);
    // The wallet library's build, whose gate judges the new BitBox.
    expect(record('bdkwallet', W_COMMIT)).toBe(0);
    const recorded = recordText();
    const err = errors();
    expect(run(['pin', 'bdkwallet'])).toBe(2);
    expect(run(['pin', 'bitboxffi'])).toBe(2);
    expect(recordText()).toBe(recorded);
    expect(err()).toContain('was rebuilt too and is not pinned');
    expect(err()).toContain('node scripts/native-sources.js pin bitboxffi bdkwallet');
    expect(run(['pin', 'bdkwallet', 'bitboxffi'])).toBe(0);
    const text = recordText();
    expect(src.pinsOf(text, 'bdkwallet')).toEqual([
      { path: W_IOS, pinned: sha(walletIos) },
      { path: W_SIM, pinned: sha(walletSim) },
    ]);
    expect(src.pinsOf(text, 'bitboxffi')).toEqual([
      { path: PIN_IOS, pinned: sha('new ios') },
      { path: PIN_SIM, pinned: sha('new sim') },
    ]);
    expect(prov.parseNativeSources(text).problems).toEqual([]);
    expect(run(['pin', 'bitboxffi', 'bdkwallet'])).toBe(0);
    expect(recordText()).toBe(text);
  });

  it('pin of several writes nothing when any one of them is not what its recorded build wrote', () => {
    put(PIN_IOS, 'new ios', app);
    put(PIN_SIM, 'new sim', app);
    put(W_IOS, 'new wallet ios', app);
    put(W_SIM, 'new wallet sim', app);
    expect(record('bitboxffi')).toBe(0);
    expect(record('bdkwallet', W_COMMIT)).toBe(0);
    const recorded = recordText();
    put(W_SIM, 'copied by hand', app);
    expect(run(['pin', 'bdkwallet', 'bitboxffi'])).toBe(2);
    expect(run(['pin', 'bitboxffi', 'otherffi'])).toBe(64);
    // The old engine's library is no library to pin any more.
    expect(run(['pin', 'bdkffi'])).toBe(64);
    expect(recordText()).toBe(recorded);
  });

  it('pin adds a pin for a recorded file that had none, after the library\'s other pins', () => {
    const noSim = RECORD.replace(`${sha('old sim')}  ${PIN_SIM}\n`, '');
    put(prov.NATIVE_PIN, noSim, app);
    put(PIN_IOS, 'new ios', app);
    put(PIN_SIM, 'new sim', app);
    expect(record('bitboxffi')).toBe(0);
    regate();
    expect(run(['pin', 'bitboxffi'])).toBe(0);
    const regated = WALLET.replace(gatedLines([[PIN_IOS, 'old ios'], [PIN_SIM, 'old sim']]), gatedLines([[PIN_IOS, 'new ios'], [PIN_SIM, 'new sim']]));
    expect(regated).not.toBe(WALLET);
    expect(recordText().endsWith(`${sha('new ios')}  ${PIN_IOS}\n${sha('new sim')}  ${PIN_SIM}\n${regated}`)).toBe(true);
    expect(prov.parseNativeSources(recordText()).problems).toEqual([]);
  });

  describe('verify, before a build uses the libraries', () => {
    const POD_SPEC = fs.readFileSync(path.join(__dirname, '..', '..', 'native', 'bdkwallet', 'TaliaBdkWallet.podspec'), 'utf8');
    beforeEach(() => {
      // Every library's pod, as the repo commits it.
      for (const lib of Object.keys(prov.NATIVE_SOURCES)) {
        const spec = prov.NATIVE_SOURCES[lib].podspec;
        put(spec, fs.readFileSync(path.join(__dirname, '..', '..', spec), 'utf8'), app);
      }
    });

    it('passes when every pinned library is on disk as pinned and the pod links the fork in place', () => {
      const err = errors();
      expect(run(['verify'])).toBe(0);
      expect(err()).toContain('Every native library is the one pinned');
      expect(err()).toContain(`${sha('old sim')}  ${PIN_SIM}`);
    });

    it.each([
      ['a library that differs from its pin', () => put(PIN_IOS, 'swapped', app), `${PIN_IOS} is ${sha('swapped')}, pinned ${sha('old ios')}`],
      ['a missing library', () => fs.rmSync(path.join(app, W_SIM)), `${W_SIM} is missing, pinned ${sha('wallet sim')}`],
      ['a file the linker would find', () => put('native/bdkwallet/lib/libbdkwallet.a', 'stock', app), 'native/bdkwallet/lib/libbdkwallet.a is not pinned'],
      // Decided 2026-10-07: a scratch file left beside the libraries (a symbol
      // list) made every phone build and archive refuse; the message says what to do.
      ['a scratch file left in a lib folder', () => put('native/bdkwallet/lib/libbdkwallet-ios.a.names.tmp', 'bdk_6351_Wallet_sync', app), 'delete anything else there'],
      ['a pod that vendors another library', () => put('native/bdkwallet/TaliaBdkWallet.podspec', POD_SPEC.replace('"lib/libbdkwallet-ios.a"', '"stock.a"'), app), 'must vendor exactly one library'],
      ['pins with no record of their build', () => put(prov.NATIVE_PIN, RECORD.replace(/^# (source|source-note|built) bitboxffi.*\n/gm, ''), app), 'no source line for bitboxffi'],
    ])('refuses %s, and nothing is built', (_what, spoil, says) => {
      spoil();
      const err = errors();
      expect(run(['verify'])).toBe(2);
      expect(err()).toContain('so nothing is built');
      expect(err()).toContain(says);
      // A phone test build refuses it too: none of these is a recorded build.
      expect(run(['verify', '--test-build'])).toBe(2);
    });

    describe('--test-build: a rebuilt library is tested on the phone BEFORE it is pinned (decided 2026-10-07)', () => {
      // A BitBox rebuild, and the new library's build that judges it (decided 2026-10-17).
      const rebuilt = () => {
        put(PIN_IOS, 'new ios', app);
        put(PIN_SIM, 'new sim', app);
        expect(record('bitboxffi')).toBe(0);
        regate();
      };

      it('refuses a rebuilt library the new library\'s overlap gate never judged', () => {
        put(PIN_IOS, 'new ios', app);
        put(PIN_SIM, 'new sim', app);
        expect(record('bitboxffi')).toBe(0);
        const err = errors();
        expect(run(['verify', '--test-build'])).toBe(2);
        expect(err()).toContain(`bdkwallet's overlap gate judged ${PIN_SIM} as ${sha('old sim')}, but it is pinned ${sha('new sim')}`);
        expect(err()).toContain('rebuild bdkwallet (native/build-bdkwallet.sh)');
        regate();
        expect(run(['verify', '--test-build'])).toBe(0);
      });

      it('takes the files the recorded build wrote, names them as not pinned, and writes nothing', () => {
        rebuilt();
        const before = recordText();
        // Plain verify (what the archive applies) refuses the unpinned build...
        expect(run(['verify'])).toBe(2);
        // ...the phone build takes it, and says so.
        const err = errors();
        expect(run(['verify', '--test-build'])).toBe(0);
        expect(err()).toContain(`${sha('new ios')}  ${PIN_IOS}  (recorded build, NOT PINNED)`);
        expect(err()).toContain(`${sha('wallet ios')}  ${W_IOS}\n`);
        expect(err()).toContain(`bitboxffi: this build tests the libraries built from ${NEW}, not pinned yet`);
        expect(err()).toContain('node scripts/native-sources.js pin bitboxffi');
        expect(recordText()).toBe(before);
        // After the test: pin, and both checks pass with nothing left unpinned.
        expect(run(['pin', 'bitboxffi'])).toBe(0);
        expect(run(['verify'])).toBe(0);
        const after = errors();
        expect(run(['verify', '--test-build'])).toBe(0);
        expect(after()).not.toContain('NOT PINNED');
      });

      it('refuses a library that is neither pinned nor what the recorded build wrote', () => {
        rebuilt();
        put(PIN_SIM, 'copied by hand', app);
        const err = errors();
        expect(run(['verify', '--test-build'])).toBe(2);
        expect(err()).toContain(`${PIN_SIM} is ${sha('copied by hand')}, pinned ${sha('old sim')}`);
        expect(err()).toContain('only when its');
      });

      it('refuses the old pinned files kept under a new record (the record names another commit)', () => {
        rebuilt();
        put(PIN_IOS, 'old ios', app);
        put(PIN_SIM, 'old sim', app);
        const err = errors();
        expect(run(['verify', '--test-build'])).toBe(2);
        expect(err()).toContain('the pins and the source record were not written together');
      });

      it('still refuses everything else plain verify refuses: a stray file, another library in the pod', () => {
        rebuilt();
        put('native/bitboxffi/lib/libbitboxffi.a', 'stray', app);
        expect(run(['verify', '--test-build'])).toBe(2);
        fs.rmSync(path.join(app, 'native/bitboxffi/lib/libbitboxffi.a'));
        put('native/bdkwallet/TaliaBdkWallet.podspec', POD_SPEC.replace('s.dependency', 's.libraries = "bdkwallet-sim"\n  s.dependency'), app);
        expect(run(['verify', '--test-build'])).toBe(2);
      });

      it('knows no other option', () => {
        expect(run(['verify', '--allow-anything'])).toBe(64);
        expect(src.withRecordedBuildsPinned(recordText(), app).testing).toEqual([]);
      });
    });

    describe('restore: the pinned files back from their release-file copies (decided 2026-10-22)', () => {
      const TAG = src.COPIES.tags[0];
      // The stand-in below holds every copy in ONE release, so these tests
      // read COPIES.tags as that release alone (decided 2026-10-27, when a
      // second real release was listed); the real list is checked on its own
      // through REAL_TAGS, however many releases it names.
      const REAL_TAGS = [...src.COPIES.tags];
      beforeEach(() => {
        src.COPIES.tags.splice(0, src.COPIES.tags.length, TAG);
      });
      afterEach(() => {
        src.COPIES.tags.splice(0, src.COPIES.tags.length, ...REAL_TAGS);
      });
      const LIBS: [string, string][] = [
        [PIN_IOS, 'old ios'],
        [PIN_SIM, 'old sim'],
        [W_IOS, 'wallet ios'],
        [W_SIM, 'wallet sim'],
      ];
      type Copy = { tag: string; name: string; size: number; digest?: string | null };
      /**
       * A stand-in for the fork's release files: `served` maps a file name to
       * the bytes a download hands back (default: the pinned content), and
       * every read of a release (by its tag), pause and download is counted.
       * `empty` reads of the release list nothing first (GitHub answering
       * before it has caught up).
       */
      const release = (
        files: [string, string][] = LIBS,
        served: Record<string, string | ((dir: string, name: string) => string)> = {},
        empty = 0,
        extra: (Copy & { content: string })[] = [],
      ) => {
        // GitHub's digest of each file is its own SHA-256, as GitHub gives it.
        const copies = [
          ...files.map(([f, c]) => ({ tag: TAG, name: src.copyName(sha(c), f), size: c.length, digest: `sha256:${sha(c)}` as string | null, content: c })),
          ...extra,
        ];
        const calls = { reads: [] as string[], pauses: 0, fetched: [] as string[], dirs: [] as string[] };
        return {
          calls,
          copies: {
            release: (tag: string): Copy[] => {
              calls.reads.push(tag);
              if (calls.reads.length <= empty) {
                return [];
              }
              return copies.filter((c) => c.tag === tag).map(({ content: _c, ...c }) => c);
            },
            pause: () => {
              calls.pauses += 1;
            },
            fetch: (copy: Copy, dir: string): string => {
              calls.fetched.push(`${copy.tag === TAG ? '' : `${copy.tag}/`}${copy.name}`);
              calls.dirs.push(dir);
              const own = served[copy.name];
              if (typeof own === 'function') {
                return own(dir, copy.name);
              }
              const file = path.join(dir, copy.name);
              fs.writeFileSync(file, own ?? (copies.find((c) => c.name === copy.name && c.tag === copy.tag) as { content: string }).content);
              return file;
            },
          },
        };
      };
      const restore = (argv: string[], copies: ReturnType<typeof release>['copies']) =>
        src.main(['restore', ...argv], app, {
          xcode: () => XCODE,
          checkout: (_s, dir) => ({ ok: true, root: dir, problems: [] }),
          copies,
        });
      const read = (rel: string) => fs.readFileSync(path.join(app, rel), 'utf8');
      const gone = (rel: string) => !fs.existsSync(path.join(app, rel));
      // A fresh checkout: git holds no library, so every lib folder is missing.
      const fresh = () => {
        for (const lib of Object.keys(prov.NATIVE_SOURCES)) {
          fs.rmSync(path.join(app, prov.NATIVE_SOURCES[lib].libDir), { recursive: true, force: true });
        }
      };

      it('names each copy by its SHA-256 and its file name in the lib folder, on the private fork', () => {
        expect(src.copyName(sha('wallet ios'), W_IOS)).toBe(`${sha('wallet ios')}-libbdkwallet-ios.a`);
        // The copies stay on the private fork (decided 2026-10-22), named on
        // their own since the libraries are built from the public repos
        // (decided 2026-11-06): never a repo a build is taken from.
        expect(src.COPIES.repo).toBe(BDK_PRIVATE_REPO);
        for (const s of Object.values(prov.NATIVE_SOURCES)) {
          expect(src.repoKey(src.COPIES.repo)).not.toBe(src.repoKey(s.repo));
        }
        expect(src.COPIES.tagPrefix).toBe('talia-native-libs-');
        // The releases are named, never discovered from GitHub's release list.
        expect(REAL_TAGS).toContain('talia-native-libs-2026-10-22');
        expect(new Set(REAL_TAGS).size).toBe(REAL_TAGS.length);
        for (const tag of REAL_TAGS) {
          expect(tag).toMatch(/^talia-native-libs-[0-9A-Za-z._-]+$/);
        }
      });

      it('gives a fresh checkout every pinned library byte for byte, as plain files, and ends with verify', () => {
        fresh();
        const r = release();
        const err = errors();
        expect(restore(['all'], r.copies)).toBe(0);
        for (const [f, c] of LIBS) {
          expect(read(f)).toBe(c);
          expect(fs.lstatSync(path.join(app, f)).isFile()).toBe(true);
          expect(fs.readdirSync(path.dirname(path.join(app, f))).sort()).toEqual(
            LIBS.filter(([x]) => path.dirname(x) === path.dirname(f)).map(([x]) => path.basename(x)).sort(),
          );
        }
        expect(r.calls.reads).toEqual(src.COPIES.tags);
        expect(r.calls.fetched.sort()).toEqual(LIBS.map(([f, c]) => src.copyName(sha(c), f)).sort());
        // Each download went to a private temp folder, gone afterwards, never into the app.
        for (const dir of r.calls.dirs) {
          expect(dir.startsWith(app)).toBe(false);
          expect(fs.existsSync(dir)).toBe(false);
        }
        expect(err()).toContain(`✓ ${W_IOS} restored (${sha('wallet ios')}).`);
        expect(err()).toContain('Every native library is the one pinned');
      });

      it('keeps a file that is already the pinned one, and fetches only what is missing', () => {
        fs.rmSync(path.join(app, W_SIM));
        const before = fs.statSync(path.join(app, W_IOS)).mtimeMs;
        const r = release();
        expect(restore(['bdkwallet'], r.copies)).toBe(0);
        expect(r.calls.fetched).toEqual([src.copyName(sha('wallet sim'), W_SIM)]);
        expect(fs.statSync(path.join(app, W_IOS)).mtimeMs).toBe(before);
        expect(read(W_SIM)).toBe('wallet sim');
        // Nothing missing: GitHub is not asked at all.
        const again = release();
        expect(restore(['all'], again.copies)).toBe(0);
        expect(again.calls.reads).toEqual([]);
        expect(again.calls.fetched).toEqual([]);
      });

      it('refuses a download whose SHA-256 is not the pin, and writes nothing at all', () => {
        fresh();
        const r = release(LIBS, { [src.copyName(sha('wallet sim'), W_SIM)]: 'a planted library' });
        const err = errors();
        expect(restore(['bdkwallet'], r.copies)).toBe(2);
        expect(err()).toContain(`is ${sha('a planted library')}, not the pinned`);
        expect(err()).toContain('nothing is restored');
        // The good download before it was not written either.
        expect(gone(W_IOS)).toBe(true);
        expect(gone(W_SIM)).toBe(true);
        for (const dir of r.calls.dirs) {
          expect(fs.existsSync(dir)).toBe(false);
        }
      });

      it('refuses a download that is not a plain file in its temp folder (a symlink to the right bytes)', () => {
        fs.rmSync(path.join(app, W_IOS));
        const elsewhere = path.join(tmp, 'elsewhere.a');
        fs.writeFileSync(elsewhere, 'wallet ios');
        const r = release(LIBS, {
          [src.copyName(sha('wallet ios'), W_IOS)]: (dir, name) => {
            fs.symlinkSync(elsewhere, path.join(dir, name));
            return path.join(dir, name);
          },
        });
        expect(restore(['bdkwallet'], r.copies)).toBe(2);
        expect(gone(W_IOS)).toBe(true);
      });

      it('never replaces a file that differs from its pin, and asks GitHub nothing', () => {
        put(W_IOS, 'a library being tested', app);
        const r = release();
        const err = errors();
        expect(restore(['bdkwallet'], r.copies)).toBe(2);
        expect(err()).toContain(`${W_IOS} is ${sha('a library being tested')}, pinned ${sha('wallet ios')}; restore replaces nothing`);
        expect(read(W_IOS)).toBe('a library being tested');
        expect(r.calls.reads).toEqual([]);
      });

      it('refuses a lib folder or a library that is a symlink, and anything there that is not a plain file', () => {
        fs.rmSync(path.join(app, 'native/bdkwallet/lib'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'other-lib'));
        fs.symlinkSync(path.join(tmp, 'other-lib'), path.join(app, 'native/bdkwallet/lib'));
        const r = release();
        const err = errors();
        expect(restore(['bdkwallet'], r.copies)).toBe(2);
        expect(err()).toContain('native/bdkwallet/lib is a symlink, not a folder');
        expect(fs.readdirSync(path.join(tmp, 'other-lib'))).toEqual([]);
        fs.rmSync(path.join(app, 'native/bdkwallet/lib'));
        fs.mkdirSync(path.join(app, W_IOS), { recursive: true });
        expect(restore(['bdkwallet'], r.copies)).toBe(2);
        expect(r.calls.reads).toEqual([]);
      });

      it('refuses when no release holds a copy, or GitHub cannot be read, and writes nothing', () => {
        fresh();
        const partial = release(LIBS.filter(([f]) => f !== W_SIM));
        const err = errors();
        expect(restore(['bdkwallet'], partial.copies)).toBe(2);
        expect(err()).toContain(`holds ${src.copyName(sha('wallet sim'), W_SIM)} (${W_SIM})`);
        expect(partial.calls.fetched).toEqual([]);
        expect(gone(W_IOS)).toBe(true);
        const down = {
          release: (): Copy[] => {
            throw new Error('gh: not signed in');
          },
          fetch: (): string => '',
          pause: () => undefined,
        };
        expect(restore(['bdkwallet'], down)).toBe(2);
        expect(err()).toContain(`release ${TAG} of ${BDK_PRIVATE_REPO} could not be read after 3 tries (gh: not signed in)`);
        expect(err()).toContain(`so the copy of ${W_IOS}`);
        expect(gone(W_IOS)).toBe(true);
      });

      it('reads each release by its tag, and asks again when one reads as empty (GitHub catching up)', () => {
        fresh();
        const r = release(LIBS, {}, 2);
        expect(restore(['all'], r.copies)).toBe(0);
        expect(r.calls.reads).toEqual([TAG, TAG, TAG]);
        expect(r.calls.pauses).toBe(2);
        expect(read(W_IOS)).toBe('wallet ios');
      });

      it('a release that never answers is "could not be read", never a missing copy: no upload advice, nothing written', () => {
        fresh();
        const r = release(LIBS, {}, 99);
        const err = errors();
        expect(restore(['bdkwallet'], r.copies)).toBe(2);
        expect(err()).toContain(`release ${TAG} of ${BDK_PRIVATE_REPO} could not be read after 3 tries (it listed no files)`);
        expect(err()).not.toContain('no release in COPIES.tags');
        expect(r.calls.fetched).toEqual([]);
        expect(gone(W_IOS)).toBe(true);
        const again = release(LIBS, {}, 99);
        expect(src.main(['copies'], app, { copies: again.copies })).toBe(2);
        expect(err()).not.toContain('Upload each missing file');
      });

      it('a file of a release not named in COPIES.tags is never used', () => {
        fresh();
        const r = release();
        const elsewhere = {
          ...r.copies,
          release: (tag: string): Copy[] =>
            r.copies.release(tag).map((c) => ({ ...c, tag: `${src.COPIES.tagPrefix}someone-elses` })),
        };
        expect(restore(['bdkwallet'], elsewhere)).toBe(2);
        expect(r.calls.fetched).toEqual([]);
      });

      it('restores only pins its record binds: none for a library whose pins are not its recorded build', () => {
        fresh();
        put(prov.NATIVE_PIN, RECORD.replace(`${sha('wallet sim')}  ${W_SIM}`, `${sha('typed by hand')}  ${W_SIM}`), app);
        const r = release([...LIBS, [W_SIM, 'typed by hand']]);
        const err = errors();
        expect(restore(['bdkwallet'], r.copies)).toBe(2);
        expect(err()).toContain(`${W_SIM}'s pin is not the file bdkwallet's recorded build wrote`);
        expect(r.calls.reads).toEqual([]);
        expect(gone(W_SIM)).toBe(true);
        // And a library with no pins has nothing to restore.
        put(prov.NATIVE_PIN, RECORD.replace(/^[0-9a-f]{64} {2}native\/bdkwallet\/lib\/.*\n/gm, ''), app);
        expect(restore(['bdkwallet'], r.copies)).toBe(2);
        expect(err()).toContain('pins nothing of bdkwallet');
      });

      it('answers with verify: one library restored while another is still missing is not a passing checkout', () => {
        fresh();
        const r = release();
        const err = errors();
        expect(restore(['bdkwallet'], r.copies)).toBe(2);
        expect(read(W_IOS)).toBe('wallet ios');
        expect(err()).toContain(`${PIN_IOS} is missing`);
        expect(restore(['bitboxffi'], r.copies)).toBe(0);
        // The old engine's library cannot be restored until the removal commit is reverted.
        expect(restore(['bdkffi'], r.copies)).toBe(64);
      });

      it('copies says which release holds each pinned file, and refuses one with no copy; both read only', () => {
        const all = release();
        const err = errors();
        expect(src.main(['copies'], app, { copies: all.copies })).toBe(0);
        expect(err()).toContain(`✓ ${W_IOS}: ${TAG}/${src.copyName(sha('wallet ios'), W_IOS)} (GitHub's digest is the pin)`);
        expect(all.calls.fetched).toEqual([]);
        const partial = release(LIBS.filter(([f]) => f !== PIN_SIM));
        expect(src.main(['copies', 'bdkwallet'], app, { copies: partial.copies })).toBe(0);
        expect(src.main(['copies', 'all'], app, { copies: partial.copies })).toBe(2);
        expect(err()).toContain(`✗ no release in COPIES.tags (${src.COPIES.tags.join(', ')}) of ${BDK_PRIVATE_REPO} holds ${src.copyName(sha('old sim'), PIN_SIM)}`);
        // Only a copy proven absent, every release having answered, gets the upload advice.
        expect(err()).toContain('Upload each missing file');
        expect(err()).toContain('add its tag to COPIES.tags');
      });

      describe("GitHub's digest of each copy (decided 2026-10-22)", () => {
        const TAG2 = `${src.COPIES.tagPrefix}2026-12-01`;
        const SIM = () => src.copyName(sha('wallet sim'), W_SIM);
        beforeEach(() => {
          src.COPIES.tags.push(TAG2);
        });
        afterEach(() => {
          src.COPIES.tags.splice(src.COPIES.tags.indexOf(TAG2), 1);
        });
        /** The release files with W_SIM's copy in TAG replaced by `first`, and a good twin in TAG2. */
        const twins = (first: { digest: string | null; content: string } | null, twin = true) =>
          release(
            LIBS.filter(([f]) => f !== W_SIM),
            {},
            0,
            [
              ...(first ? [{ tag: TAG, name: SIM(), size: first.content.length, ...first }] : []),
              twin
                ? { tag: TAG2, name: SIM(), size: 10, digest: `sha256:${sha('wallet sim')}`, content: 'wallet sim' }
                : // TAG2 answers, holding another pin's file only.
                  { tag: TAG2, name: src.copyName(sha('later'), W_IOS), size: 5, digest: `sha256:${sha('later')}`, content: 'later' },
            ],
          );

        it('a copy under the pinned name whose digest is another file\'s is never fetched; its twin in another release is', () => {
          fresh();
          const r = twins({ digest: `sha256:${sha('rebuilt')}`, content: 'rebuilt' });
          const err = errors();
          expect(restore(['all'], r.copies)).toBe(0);
          expect(r.calls.fetched).not.toContain(SIM());
          expect(r.calls.fetched).toContain(`${TAG2}/${SIM()}`);
          expect(read(W_SIM)).toBe('wallet sim');
          // copies passes on the twin, and names the wrong one.
          expect(src.main(['copies', 'bdkwallet'], app, { copies: r.copies })).toBe(0);
          expect(err()).toContain(`✓ ${W_SIM}: ${TAG2}/${SIM()}`);
          expect(err()).toContain(`note: ${TAG}/${SIM()} holds sha256:${sha('rebuilt')} by GitHub's digest, not the pinned ${sha('wallet sim')}`);
        });

        it('a download that is not the pin falls through to the next copy, and is never written', () => {
          fresh();
          // GitHub's digest says the pin, but the bytes that arrive are not.
          const r = twins({ digest: `sha256:${sha('wallet sim')}`, content: 'damaged on the way' });
          const err = errors();
          expect(restore(['all'], r.copies)).toBe(0);
          expect(r.calls.fetched).toEqual(expect.arrayContaining([SIM(), `${TAG2}/${SIM()}`]));
          expect(err()).toContain(`the download of ${TAG}/${SIM()} is ${sha('damaged on the way')}, not the pinned ${sha('wallet sim')}; not used.`);
          expect(read(W_SIM)).toBe('wallet sim');
        });

        it('only a copy with another file\'s digest: copies refuses and says so, restore fetches nothing and writes nothing', () => {
          fresh();
          const r = twins({ digest: `sha256:${sha('rebuilt')}`, content: 'rebuilt' }, false);
          const err = errors();
          expect(src.main(['copies', 'bdkwallet'], app, { copies: r.copies })).toBe(2);
          expect(err()).toContain(`✗ ${TAG}/${SIM()} holds sha256:${sha('rebuilt')} by GitHub's digest, not the pinned`);
          expect(err()).toContain('Upload each missing file');
          expect(restore(['bdkwallet'], r.copies)).toBe(2);
          expect(r.calls.fetched).toEqual([]);
          expect(gone(W_IOS)).toBe(true);
          expect(gone(W_SIM)).toBe(true);
        });

        it('a copy GitHub gives no digest for is not proven to copies, and restore still hashes what it downloads', () => {
          fresh();
          const r = twins({ digest: null, content: 'wallet sim' }, false);
          const err = errors();
          expect(src.main(['copies', 'bdkwallet'], app, { copies: r.copies })).toBe(2);
          expect(err()).toContain(`✗ ${TAG}/${SIM()}: GitHub gives no digest, so its bytes are not proven`);
          expect(restore(['all'], r.copies)).toBe(0);
          expect(read(W_SIM)).toBe('wallet sim');
          // ...and one whose bytes are not the pin is refused like any other.
          fresh();
          const bad = twins({ digest: null, content: 'a planted library' }, false);
          expect(restore(['bdkwallet'], bad.copies)).toBe(2);
          expect(err()).toContain(`No copy of ${W_SIM} (${SIM()}) downloaded as the pinned ${sha('wallet sim')}, so nothing is restored.`);
          expect(gone(W_IOS)).toBe(true);
        });
      });

      it('knows its arguments', () => {
        const r = release();
        expect(restore([], r.copies)).toBe(64);
        expect(restore(['otherffi'], r.copies)).toBe(64);
        expect(restore(['bdkwallet', '--force'], r.copies)).toBe(64);
        expect(src.main(['copies', 'otherffi'], app, { copies: r.copies })).toBe(64);
        expect(r.calls.reads).toEqual([]);
      });
    });
  });

  it('record of the new library writes the tracked files its build wrote and the Xcode, or nothing', () => {
    put(W_IOS, 'new wallet ios', app);
    put(W_SIM, 'new wallet sim', app);
    put('native/bdkwallet/BitcoinDevKit.swift', 'new swift', app);
    expect(record('bdkwallet')).toBe(0);
    const text = recordText();
    expect(text).toContain(`# generated bdkwallet ${sha('new swift')} native/bdkwallet/BitcoinDevKit.swift\n`);
    expect(text).toContain(`# generated bdkwallet ${sha('wallet header')} native/bdkwallet/ffi/BitcoinDevKitFFI.h\n`);
    expect(text).toContain('# xcode bdkwallet 27.1 27A9275\n');
    expect(text.match(/# xcode bdkwallet/g)).toHaveLength(1);
    // The other library's files its overlap gate judged, in NATIVE_SOURCES order (decided 2026-10-17).
    expect(text).toContain(
      '# xcode bdkwallet 27.1 27A9275\n' +
        gatedLines([
          [PIN_IOS, 'old ios'],
          [PIN_SIM, 'old sim'],
        ]),
    );
    expect(text.match(/# gated bdkwallet/g)).toHaveLength(2);
    const wallet = prov.parseNativeSources(text).sources.find((x) => x.lib === 'bdkwallet') as Entry;
    expect(wallet).toMatchObject({ commit: NEW, xcode: XCODE });
    expect(wallet.generated).toHaveLength(3);
    // With no Xcode to name, or a generated file missing, nothing is written.
    expect(record('bdkwallet', BDK, null)).toBe(2);
    expect(recordText()).toBe(text);
    fs.rmSync(path.join(app, 'native/bdkwallet/ffi/BitcoinDevKitFFI.h'));
    expect(record('bdkwallet', BDK)).toBe(2);
    expect(recordText()).toBe(text);
    // The checkout and the work folder are named; the BitBox build has no work folder.
    expect(run(['record', 'bdkwallet', NEW])).toBe(64);
    expect(run(['record', 'bdkwallet', NEW, checkoutOf('bdkwallet')])).toBe(64);
    expect(run(['record', 'bitboxffi', NEW, checkoutOf('bitboxffi'), work()])).toBe(64);
  });

  it('record of an older library records its bindings, and the Xcode when one answers, or nothing without them', () => {
    expect(record('bitboxffi', NEW, null)).toBe(0);
    const text = recordText();
    expect(text).toContain(`# generated bitboxffi ${sha('bitbox swift')} native/bitboxffi/bitbox.swift\n`);
    expect(text).toContain(`# generated bitboxffi ${sha('bitbox header')} native/bitboxffi/ffi/bitboxFFI.h\n`);
    expect(text).not.toContain('# xcode bitboxffi');
    expect(prov.parseNativeSources(text).problems.join('\n')).not.toContain('generated');
    fs.rmSync(path.join(app, 'native/bitboxffi/bitbox.swift'));
    expect(record('bitboxffi')).toBe(2);
    expect(recordText()).toBe(text);
  });

  describe('record is a build\'s last step, never a command of its own (decided 2026-10-17)', () => {
    it('refuses a checkout that is not exactly the commit, clean, on its branch, and writes nothing', () => {
      leaveOutputs('bitboxffi');
      const err = errors();
      expect(
        src.main(['record', 'bitboxffi', NEW, checkoutOf('bitboxffi')], app, {
          xcode: () => XCODE,
          checkout: () => ({ ok: false, root: null, problems: ['HEAD is now 1234, the build started from 4c32'] }),
        }),
      ).toBe(2);
      expect(err()).toContain(`is not a clean checkout of ${NEW} on main`);
      expect(err()).toContain('HEAD is now 1234');
      expect(recordText()).toBe(RECORD);
    });

    it.each([
      ['a library copied by hand', () => put(PIN_IOS, 'hand-made', app), `${PIN_IOS} is ${sha('hand-made')}; the build left ${sha('old ios')} at`],
      ['bindings edited by hand', () => put('native/bitboxffi/bitbox.swift', 'edited', app), `native/bitboxffi/bitbox.swift is ${sha('edited')}; the build left`],
      ['a library the build never wrote', () => fs.rmSync(path.join(checkoutOf('bitboxffi'), 'target/aarch64-apple-ios-sim/release/libbitboxffi.a')), 'the build left nothing at'],
    ])('refuses %s: only the build\'s own output is recorded', (_what, spoil, says) => {
      leaveOutputs('bitboxffi');
      spoil();
      const err = errors();
      expect(recordOnly('bitboxffi')).toBe(2);
      expect(err()).toContain('the app does not hold exactly what the build wrote');
      expect(err()).toContain(says);
      expect(recordText()).toBe(RECORD);
    });

    it.each([
      [
        'a duplicate list edited by hand',
        () => fs.appendFileSync(path.join(app, 'native/bdkwallet/duplicate-symbols.txt'), 'ios bitboxffi bdkwallet _uniffi_rustbuffer_free\n'),
        "native/bdkwallet/duplicate-symbols.txt is not the list the gate's reports in",
      ],
      ['bindings edited by hand', () => put('native/bdkwallet/BitcoinDevKit.swift', 'edited', app), `native/bdkwallet/BitcoinDevKit.swift is ${sha('edited')}; the build left`],
      ['a gate report missing', () => fs.rmSync(path.join(work(), 'gate-sim-bitboxffi-bdkwallet.txt')), 'no gate report'],
      [
        'a gate report that judged other files',
        () =>
          fs.writeFileSync(
            path.join(work(), 'gate-ios-bitboxffi-bdkwallet.txt'),
            fs.readFileSync(path.join(work(), 'gate-ios-bitboxffi-bdkwallet.txt'), 'utf8').replace(/^new: .*$/m, 'new: /elsewhere.a: arm64'),
          ),
        'as the new library',
      ],
    ])('refuses the new library\'s record with %s', (_what, spoil, says) => {
      leaveOutputs('bdkwallet');
      spoil();
      const err = errors();
      expect(recordOnly('bdkwallet', W_COMMIT)).toBe(2);
      expect(err()).toContain(says);
      expect(recordText()).toBe(RECORD);
    });

    it('refuses the new library\'s record when a library changed after its gate judged it', () => {
      leaveOutputs('bdkwallet');
      // BitBox rebuilt and recorded after the gate ran: accepted as a peer, but never judged.
      put(PIN_IOS, 'new ios', app);
      put(PIN_SIM, 'new sim', app);
      expect(record('bitboxffi')).toBe(0);
      const before = recordText();
      const err = errors();
      expect(recordOnly('bdkwallet', W_COMMIT)).toBe(2);
      expect(err()).toContain(`the gate judged ${path.join(app, PIN_SIM)} as ${sha('old sim')}; it is ${sha('new sim')} now`);
      expect(recordText()).toBe(before);
      // The build again: its gate judges the new BitBox, and the record follows.
      expect(record('bdkwallet', W_COMMIT)).toBe(0);
      expect(recordText()).toContain(`# gated bdkwallet ${sha('new sim')} ${PIN_SIM}\n`);
    });

    it('the build scripts copy from exactly where record looks, and call it with the checkout', () => {
      const root = path.join(__dirname, '..', '..');
      const scripts: [string, string, string, string][] = [
        // library, script, the checkout's variable, its target folder's
        ['bitboxffi', 'native/build-bitboxffi.sh', '$CRATE', '$CRATE/target'],
        ['bdkwallet', 'native/build-bdkwallet.sh', '$FORK', '$FORK/bdk-ffi/target'],
      ];
      for (const [lib, script, checkout, target] of scripts) {
        const code = fs.readFileSync(path.join(root, script), 'utf8');
        const out = src.BUILD_OUTPUTS[lib];
        const expand = (p: string) => p.replace('$TARGET', target).replace('$OUT', '$APP/native/bitboxffi');
        const copies = code
          .split('\n')
          .map((l) => /^cp "([^"]+)" "([^"]+)"$/.exec(l))
          .filter((m): m is RegExpExecArray => m !== null)
          // A copy into a folder keeps the file's name.
          .map((m) => [expand(m[1]), expand(m[2]).endsWith('/') ? `${expand(m[2])}${path.basename(m[1])}` : expand(m[2])]);
        const sourceOf = (to: string) => (copies.find(([, t]) => t === to) || [])[0];
        for (const f of prov.NATIVE_SOURCES[lib].files) {
          expect([f, sourceOf(`$APP/${f}`)]).toEqual([f, `${checkout}/${out.libs[f.endsWith('-ios.a') ? 'ios' : 'sim']}`]);
        }
        for (const [f, from] of Object.entries(out.generated)) {
          const want = from.gate ? '$WORK/duplicate-symbols.txt' : from.work ? `$WORK/${from.work}` : `${checkout}/${from.checkout}`;
          expect([f, sourceOf(`$APP/${f}`)]).toEqual([f, want]);
        }
        expect(code).toContain(`node "$SOURCES" record ${lib} "$COMMIT" "${checkout}"${out.gate ? ' "$WORK"' : ''}\n`);
      }
    });
  });

  it('record of the new library refuses when a library its gate judged is not what the app links', () => {
    put(PIN_SIM, 'copied by hand', app);
    const err = errors();
    expect(record('bdkwallet')).toBe(2);
    expect(err()).toContain(`${PIN_SIM} is ${sha('copied by hand')}, pinned ${sha('old sim')}, recorded ${sha('old sim')}`);
    expect(recordText()).toBe(RECORD);
  });

  it('never pins the new library while it holds uniffi\'s bindgen tool; a test build may still try it (decided 2026-10-17)', () => {
    /** A BSD ar archive of rustc-named members of `crates` (long names, as rustc writes them). */
    const ar = (crates: string[]) => {
      const parts = [Buffer.from('!<arch>\n', 'latin1')];
      for (const c of crates) {
        const name = Buffer.from(`${c}-0123456789abcdef.${c}.0123456789abcdef-cgu.0.rcgu.o`, 'latin1');
        const body = Buffer.concat([name, Buffer.from('object')]);
        const field = (v: string, n: number) => Buffer.from(v.padEnd(n, ' '), 'latin1');
        parts.push(field(`#1/${name.length}`, 16), field('0', 12), field('0', 6), field('0', 6), field('644', 8), field(String(body.length), 10), Buffer.from('`\n'), body);
        if (body.length % 2 === 1) {
          parts.push(Buffer.from('\n'));
        }
      }
      return Buffer.concat(parts);
    };
    for (const lib of Object.keys(prov.NATIVE_SOURCES)) {
      const spec = prov.NATIVE_SOURCES[lib].podspec;
      put(spec, fs.readFileSync(path.join(__dirname, '..', '..', spec), 'utf8'), app);
    }
    const withTools = ar(['bdk_wallet', 'clap', 'uniffi_bindgen']);
    fs.writeFileSync(path.join(app, W_IOS), withTools);
    fs.writeFileSync(path.join(app, W_SIM), withTools);
    let err = errors();
    expect(record('bdkwallet', W_COMMIT)).toBe(0);
    expect(err()).toContain(`⚠ ${W_IOS} holds clap, uniffi_bindgen (uniffi's bindgen tool): pin and the archive refuse it.`);
    err = errors();
    expect(run(['verify', '--test-build'])).toBe(0);
    expect(err()).toContain(`⚠ ${W_IOS} holds clap, uniffi_bindgen`);
    const recorded = recordText();
    err = errors();
    expect(run(['pin', 'bdkwallet'])).toBe(2);
    expect(err()).toContain("bdkwallet holds uniffi's bindgen tool and its dependencies, so nothing is pinned");
    expect(err()).toContain(`${W_SIM}: clap, uniffi_bindgen`);
    expect(recordText()).toBe(recorded);
    // Built once the fork gives "cli" to the tool alone: pinned.
    const clean = ar(['bdk_wallet', 'serde_json']);
    fs.writeFileSync(path.join(app, W_IOS), clean);
    fs.writeFileSync(path.join(app, W_SIM), clean);
    expect(record('bdkwallet', W_COMMIT)).toBe(0);
    expect(run(['pin', 'bdkwallet'])).toBe(0);
    expect(run(['verify'])).toBe(0);
  });

  it('peers takes a library rebuilt and recorded but not pinned yet, the build the gate must judge before both are pinned', () => {
    let out = '';
    (process.stdout.write as unknown as jest.Mock).mockImplementation((x: string) => {
      out += x;
      return true;
    });
    put(PIN_SIM, 'new sim', app);
    expect(run(['peers', 'bdkwallet', 'sim'])).toBe(2);
    put(PIN_IOS, 'new ios', app);
    expect(record('bitboxffi')).toBe(0);
    out = '';
    expect(run(['peers', 'bdkwallet', 'sim'])).toBe(0);
    expect(out.split('\n').filter(Boolean)).toEqual([path.join(app, PIN_SIM)]);
  });

  it('peers names the pinned file of that slice of every other library, for the overlap gate, or refuses', () => {
    let out = '';
    (process.stdout.write as unknown as jest.Mock).mockImplementation((x: string) => {
      out += x;
      return true;
    });
    expect(run(['peers', 'bdkwallet', 'ios'])).toBe(0);
    expect(out.split('\n').filter(Boolean)).toEqual([path.join(app, PIN_IOS)]);
    out = '';
    expect(run(['peers', 'bdkwallet', 'sim'])).toBe(0);
    expect(out.split('\n').filter(Boolean)).toEqual([path.join(app, PIN_SIM)]);
    out = '';
    expect(run(['peers', 'bitboxffi', 'ios'])).toBe(0);
    expect(out.split('\n').filter(Boolean)).toEqual([path.join(app, W_IOS)]);
    out = '';
    put(PIN_SIM, 'not the pinned one', app);
    const err = errors();
    expect(run(['peers', 'bdkwallet', 'sim'])).toBe(2);
    expect(out).toBe('');
    expect(err()).toContain(`${PIN_SIM} is ${sha('not the pinned one')}, pinned ${sha('old sim')}`);
    expect(run(['peers', 'bdkwallet', 'tv'])).toBe(64);
    expect(run(['peers', 'otherffi', 'ios'])).toBe(64);
  });

  it('verify checks the generated files against the record, and warns about another Xcode', () => {
    for (const lib of Object.keys(prov.NATIVE_SOURCES)) {
      const spec = prov.NATIVE_SOURCES[lib].podspec;
      put(spec, fs.readFileSync(path.join(__dirname, '..', '..', spec), 'utf8'), app);
    }
    let err = errors();
    expect(run(['verify'])).toBe(0);
    expect(err()).toContain(`${sha('wallet swift')}  native/bdkwallet/BitcoinDevKit.swift  (as bdkwallet's recorded build wrote it)`);
    expect(err()).not.toContain('⚠');
    err = errors();
    expect(run(['verify'], { version: '27.2', build: '27B5000' })).toBe(0);
    expect(err()).toContain('bdkwallet was built with Xcode 27.1 (27A9275); this Mac has 27.2 (27B5000).');
    put('native/bdkwallet/BitcoinDevKit.swift', 'edited swift', app);
    err = errors();
    expect(run(['verify'])).toBe(2);
    expect(run(['verify', '--test-build'])).toBe(2);
    expect(err()).toContain('the generated files and the library are out of step');
  });

  it('withPins rewrites only that library\'s digests', () => {
    expect(src.withPins(RECORD, 'bitboxffi', { [PIN_IOS]: sha('x') })).toBe(
      RECORD.replace(`${sha('old ios')}  ${PIN_IOS}`, `${sha('x')}  ${PIN_IOS}`),
    );
  });
});

describe('the build environment (decided 2026-10-05)', () => {
  it('cargo keeps what finds the tools and the network, and nothing that steers a build', () => {
    const { kept, dropped } = src.cargoEnv({
      HOME: '/Users/dev',
      PATH: '/Users/dev/.cargo/bin:/usr/bin',
      USER: 'dev',
      TMPDIR: '/tmp/x',
      LC_ALL: 'en_US.UTF-8',
      SSH_AUTH_SOCK: '/tmp/agent',
      https_proxy: 'http://proxy:8080',
      CARGO_TARGET_DIR: '/tmp/elsewhere',
      CARGO_BUILD_TARGET_DIR: '/tmp/elsewhere',
      CARGO_PROFILE_RELEASE_SMALLER_OPT_LEVEL: '0',
      CARGO_TARGET_AARCH64_APPLE_IOS_LINKER: '/tmp/evil-ld',
      CARGO_ENCODED_RUSTFLAGS: '-Cevil',
      CARGO_HOME: '/tmp/other-cargo',
      RUSTFLAGS: '--cfg evil',
      RUSTC: '/tmp/rustc',
      RUSTC_WRAPPER: '/tmp/wrap',
      RUSTC_WORKSPACE_WRAPPER: '/tmp/wrap',
      RUSTUP_TOOLCHAIN: 'evil',
      CC: '/tmp/cc',
      CFLAGS: '-DEVIL',
      SDKROOT: '/tmp/sdk',
      DEVELOPER_DIR: '/tmp/Xcode.app',
      IPHONEOS_DEPLOYMENT_TARGET: '9.0',
      GIT_DIR: '/tmp/.git',
      UNSET: undefined,
    });
    expect(kept).toEqual({
      HOME: '/Users/dev',
      PATH: '/Users/dev/.cargo/bin:/usr/bin',
      USER: 'dev',
      TMPDIR: '/tmp/x',
      LC_ALL: 'en_US.UTF-8',
      SSH_AUTH_SOCK: '/tmp/agent',
      https_proxy: 'http://proxy:8080',
    });
    expect(dropped).toContain('CARGO_TARGET_DIR');
    expect(dropped).toContain('RUSTC_WRAPPER');
    expect(dropped).not.toContain('UNSET');
  });

  it('cargo-env hands the build scripts exactly the kept pairs, NUL-separated', () => {
    const before = { ...process.env };
    try {
      process.env.RUSTFLAGS = '--cfg evil';
      process.env.CARGO_TARGET_DIR = '/tmp/elsewhere';
      let out = '';
      (process.stdout.write as unknown as jest.Mock).mockImplementation((s: string) => {
        out += s;
        return true;
      });
      expect(src.main(['cargo-env'])).toBe(0);
      const pairs = out.split('\0').filter(Boolean);
      expect(pairs).toEqual(Object.entries(src.cargoEnv(process.env).kept).map(([k, v]) => `${k}=${v}`));
      expect(pairs.some((p) => p.startsWith('RUSTFLAGS=') || p.startsWith('CARGO_TARGET_DIR='))).toBe(false);
      expect(pairs.some((p) => p.startsWith('PATH='))).toBe(true);
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in before)) {
          delete process.env[k];
        }
      }
      Object.assign(process.env, before);
    }
  });

  it('finds a cargo config or toolchain file above the checkout or in ~/.cargo, never the checkout\'s own', () => {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    // Only what this test planted (the folders above the OS temp folder are the machine's).
    const found = () => src.buildConfigOutside(crate, home).filter((f) => f.startsWith(`${tmp}/`));
    expect(found()).toEqual([]);
    // The checkout's own are judged with the checkout (tracked, or untracked = dirty).
    put('.cargo/config.toml', '[build]\n');
    put('rust-toolchain.toml', '[toolchain]\n');
    expect(found()).toEqual([]);
    put('.cargo/config.toml', '[build]\ntarget-dir = "/tmp/elsewhere"\n', tmp);
    put('rust-toolchain', 'nightly\n', tmp);
    put('.cargo/config', '[build]\nrustflags = ["--cfg", "evil"]\n', home);
    expect(found()).toEqual([
      path.join(tmp, '.cargo/config.toml'),
      path.join(tmp, 'rust-toolchain'),
      path.join(home, '.cargo/config'),
    ]);
  });

  it('check refuses such a file before it prints the commit', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'native-sources.js'), 'utf8');
    const body = code.slice(code.indexOf('function cmdCheck('), code.indexOf('function cmdCargoEnv('));
    const asks = body.indexOf('buildConfigOutside(r.root, process.env.HOME)');
    expect(asks).toBeGreaterThan(0);
    expect(asks).toBeLessThan(body.indexOf('process.stdout.write(`${r.commit}'));
  });
});

describe('the build scripts', () => {
  const root = path.join(__dirname, '..', '..');
  it('a phone build checks every native library against its pin (or its recorded, untested build) before Xcode runs', () => {
    const code = fs
      .readFileSync(path.join(root, 'scripts', 'ios-device.sh'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    const verify = code.indexOf('node "$ROOT/scripts/native-sources.js" verify --test-build || exit 1');
    expect(verify).toBeGreaterThan(0);
    expect(verify).toBeLessThan(code.indexOf('xcodebuild '));
  });
  it('the archive never takes an unpinned build: ios-archive.sh does not run verify --test-build', () => {
    const archive = fs.readFileSync(path.join(root, 'scripts', 'ios-archive.sh'), 'utf8');
    expect(archive).not.toContain('--test-build');
  });
  it.each(['native/build-bitboxffi.sh', 'native/build-bdkwallet.sh'])(
    '%s says: test on the phone first, then pin (the order the phone build allows)',
    (script) => {
      const code = fs.readFileSync(path.join(root, script), 'utf8');
      const last = code.trim().split('\n').pop() as string;
      expect(last).toMatch(/^echo ".*test (them|it) on the phone \(scripts\/ios-device\.sh takes this recorded build before it is pinned\), then pin/);
    },
  );
  it.each([
    ['native/build-bitboxffi.sh', 'BITBOX_FFI_DIR'],
  ])('%s takes --rollback <commit> and no other argument, before it looks for the checkout', (script, dirVar) => {
    const run = (...args: string[]) =>
      require('child_process').spawnSync('bash', [path.join(root, script), ...args], {
        encoding: 'utf8',
        env: { ...process.env, [dirVar]: path.join(tmp, 'no-checkout-here') },
      });
    for (const args of [['--force'], ['--rollback'], ['--rollback', ''], [NEW]]) {
      expect(run(...args).status).toBe(64);
    }
    // Parsed, then it stops at the missing checkout, long before anything is built.
    const parsed = run('--rollback', NEW.slice(0, 7));
    expect(parsed.status).toBe(1);
    expect(parsed.stdout).toContain(`checkout at ${path.join(tmp, 'no-checkout-here')}`);
  });
  it('native/build-bdkwallet.sh takes the fork and its branch by name, the allowlisted branch only, before it looks for the checkout', () => {
    const script = path.join(root, 'native/build-bdkwallet.sh');
    const run = (...args: string[]) => require('child_process').spawnSync('bash', [script, ...args], { encoding: 'utf8' });
    const nowhere = path.join(tmp, 'no-checkout-here');
    for (const args of [
      [],
      ['--fork', nowhere],
      ['--branch', 'main'],
      ['--fork', nowhere, '--branch', 'main', '--force'],
      ['--fork', nowhere, '--branch', 'main', '--rollback'],
      ['--fork', '', '--branch', 'main'],
    ]) {
      expect(run(...args).status).toBe(64);
    }
    // The private fork's branches are not the public repo's (decided 2026-11-06).
    for (const branch of ['talia-3', 'talia']) {
      const other = run('--fork', nowhere, '--branch', branch);
      expect(other.status).toBe(1);
      expect(other.stdout).toContain(`built from the fork's main branch alone, not ${branch}`);
    }
    // Parsed, then it stops at the missing checkout, long before anything is built.
    const parsed = run('--fork', nowhere, '--branch', 'main', '--rollback', NEW.slice(0, 7));
    expect(parsed.status).toBe(1);
    expect(parsed.stdout).toContain(`No bdk-ffi fork checkout at ${nowhere}`);
  });
  it('native/build-bdkwallet.sh judges the library before it copies anything', () => {
    const code = fs
      .readFileSync(path.join(root, 'native/build-bdkwallet.sh'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    const at = (needle: string) => {
      const i = code.indexOf(needle);
      expect(i).toBeGreaterThan(0);
      return i;
    };
    // The frozen target and compiler, asserted under the build's own environment.
    expect(code).toContain(`grep -qx 'version = "3.1.1"' "$MANIFEST"`);
    expect(code).toContain(`grep -Eq '^uniffi = \\{ version = "=0\\.31\\.2"' "$MANIFEST"`);
    const rustc = at('RUSTC_VV="$(clean_env rustc -vV)"');
    expect(code).toContain("grep -qx 'release: 1.97.1' <<< \"$RUSTC_VV\"");
    // The library alone, for the three targets.
    const builds = code.split('\n').filter((l) => /^clean_env cargo build /.test(l));
    expect(builds).toHaveLength(3);
    for (const l of builds) {
      expect(l).toMatch(/ --package bdk-ffi --lib --profile release-smaller --target (aarch64-apple-ios|aarch64-apple-ios-sim|x86_64-apple-ios)$/);
    }
    // Bindings from the device library's metadata, outside the checkout, and the simulator's must match.
    expect(code).toContain('--bin uniffi-bindgen -- generate "$TARGET/aarch64-apple-ios/release-smaller/libbdkffi.a" --language swift --out-dir "$WORK/bindings-ios"');
    expect(code).toContain('WORK="$(mktemp -d "${TMPDIR:-/tmp}/build-bdkwallet.XXXXXX")"');
    const recheck = at('node "$SOURCES" recheck bdkwallet "$FORK" "$COMMIT" > /dev/null || exit 1');
    const cmp = at('cmp -s "$WORK/bindings-ios/$F" "$WORK/bindings-sim/$F"');
    // Their C structs renamed, once compared (Swift merges imported C types by name).
    const prefix = at('node "$SOURCES" ffi-prefix BdkWallet "$WORK/bindings-ios/BitcoinDevKitFFI.h" "$WORK/bindings-ios/BitcoinDevKit.swift" || exit 1');
    expect(cmp).toBeLessThan(prefix);
    const checks = [
      cmp,
      prefix,
      at('node "$SOURCES" vendored "$WORK/metadata.json" "$FORK/bdk-ffi" electrum-client bdk_wallet || exit 1'),
      at('node "$SOURCES" minos ios "$TARGET/aarch64-apple-ios/release-smaller/libbdkffi.a" "$SYSROOT" || exit 1'),
      at('node "$SOURCES" minos sim "$TARGET/lipo-ios-sim/libbdkffi.a" "$SYSROOT" || exit 1'),
      // The overlap gate over every pair the app links, both slices (decided 2026-10-17).
      at('clean_env node "$SOURCES" gate bdkwallet "$FORK" "$WORK" "$SYSROOT" || exit 1'),
    ];
    expect(code).not.toContain('python3');
    const firstCopy = code.indexOf('\ncp ');
    expect(rustc).toBeLessThan(code.indexOf('\nclean_env cargo build '));
    for (const c of checks) {
      expect(c).toBeGreaterThan(recheck);
      expect(c).toBeLessThan(firstCopy);
    }
    // Only the Swift and the header leave the bindings folder; the app keeps its own modulemap.
    const copied = code.split('\n').filter((l) => /^cp /.test(l));
    expect(copied.filter((l) => l.includes('bindings-ios'))).toEqual([
      'cp "$WORK/bindings-ios/BitcoinDevKit.swift" "$APP/native/bdkwallet/BitcoinDevKit.swift"',
      'cp "$WORK/bindings-ios/BitcoinDevKitFFI.h" "$APP/native/bdkwallet/ffi/BitcoinDevKitFFI.h"',
    ]);
    expect(code).not.toMatch(/modulemap"? "\$APP/);
    // What it writes beside the libraries is what the record hashes.
    const generated = copied
      .map((l) => (/"\$APP\/([^"]+)"$/.exec(l) || [])[1])
      .filter((to) => to && !/\/lib\/lib[\w-]+\.a$/.test(to));
    expect(generated.sort()).toEqual([...prov.NATIVE_SOURCES.bdkwallet.generated].sort());
  });
  it('nothing downloads or copies a native library at npm install any more', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.postinstall).toBe('patch-package');
    expect(pkg.dependencies['bdk-rn']).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'scripts', 'install-bdkffi.sh'))).toBe(false);
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    for (const name of ['bdk-rn', 'adm-zip', 'request']) {
      expect(lock.packages[`node_modules/${name}`]).toBeUndefined();
    }
  });
  it.each([
    ['native/build-bitboxffi.sh', 'bitboxffi'],
    ['native/build-bdkwallet.sh', 'bdkwallet'],
  ])('%s checks the source, cleans the outputs, runs cargo fenced in, rechecks, copies, then records', (script, lib) => {
    const code = fs
      .readFileSync(path.join(root, script), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    const lines = code.split('\n');
    const at = (re: RegExp) => code.search(re);
    // The source check gets the build's --rollback, if any, as it was typed.
    const check = at(
      new RegExp(
        `COMMIT="\\$\\(node "\\$SOURCES" check ${lib} "\\$[A-Z]+" \\$\\{ROLLBACK\\[@\\]\\+"\\$\\{ROLLBACK\\[@\\]\\}"\\}\\)" \\|\\| exit 1`,
      ),
    );
    const env = at(/done < <\(node "\$SOURCES" cargo-env\)/);
    const clean = at(/\nrm -f /);
    const firstCargo = at(/\nclean_env cargo /);
    const lastCargo = code.lastIndexOf('\nclean_env cargo ');
    const recheck = at(new RegExp(`node "\\$SOURCES" recheck ${lib} "\\$[A-Z]+" "\\$COMMIT" > /dev/null \\|\\| exit 1`));
    const firstCopy = at(/\ncp /);
    const lastCopy = code.lastIndexOf('\ncp ');
    // record is handed the checkout (and the new library's work folder) it must find the build's output in.
    const recordAt = at(new RegExp(`\\nnode "\\$SOURCES" record ${lib} "\\$COMMIT" "\\$(FORK|CRATE)"( "\\$WORK")?\\n`));
    expect([check, env, clean, firstCargo, recheck, firstCopy, recordAt].every((i) => i > 0)).toBe(true);
    expect(check).toBeLessThan(env);
    expect(env).toBeLessThan(firstCargo);
    expect(clean).toBeLessThan(firstCargo);
    expect(lastCargo).toBeLessThan(recheck);
    expect(recheck).toBeLessThan(firstCopy);
    expect(lastCopy).toBeLessThan(recordAt);
    // cargo only ever runs under env -i with cargo-env's pairs, takes the
    // commit's Cargo.lock as it is, and is told where to build.
    expect(code).toContain('clean_env() { env -i "${CARGO_ENV[@]}" "$@"; }');
    expect(lines.filter((l) => /^\s*cargo\b/.test(l))).toEqual([]);
    const cargoRuns = lines.filter((l) => /^clean_env cargo /.test(l));
    expect(cargoRuns.length).toBeGreaterThan(0);
    for (const line of cargoRuns) {
      // A build or run in the target folder it is told, or a metadata read that builds nothing.
      expect(line).toMatch(/^clean_env cargo ((build|run) --locked --target-dir "\$TARGET" |metadata --locked --offline --format-version 1 )/);
    }
    // Every file copied out of the build was deleted before cargo ran, so a
    // cargo that wrote anywhere else leaves cp nothing old to copy.
    const cleanBlock = code.slice(clean, firstCargo);
    const copied = lines.filter((l) => /^cp /.test(l)).map((l) => (/^cp ("[^"]+")/.exec(l) || [])[1]);
    expect(copied.length).toBeGreaterThan(0);
    for (const from of copied) {
      expect(cleanBlock).toContain(from);
    }
    // What the script copies into the lib folder is what `record` hashes.
    const intoLib = lines
      .filter((l) => /^cp /.test(l))
      .map((l) => (/"([^"]+)"$/.exec(l) || [])[1])
      .filter((to) => /\/lib\/lib[\w-]+\.a$/.test(to))
      .map((to) => to.replace(/^\$APP\//, '').replace(/^\$OUT\//, `${prov.NATIVE_SOURCES[lib].libDir.replace(/\/lib$/, '')}/`));
    expect(intoLib.sort()).toEqual([...prov.NATIVE_SOURCES[lib].files].sort());
    expect(code).toContain('SOURCES="$APP/scripts/native-sources.js"');
    expect(prov.NATIVE_SOURCES[lib].build).toBe(script);
  });
});
