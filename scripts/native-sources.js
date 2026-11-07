#!/usr/bin/env node
/**
 * Where Talia's native libraries come from (decided 2026-09-26).
 *
 * The signing-critical native code is built outside this repo: the bdk-ffi
 * fork (the Bitcoin core: the TaliaBdkWallet pod links its bdk-ffi 3.1.1,
 * the only wallet library since the old engine's removal took the TaliaBdk
 * pod, decided 2026-11-04) and the BitBox bridge. Since 2026-11-06 they are
 * built from 21st Capital's PUBLIC repos, talia-bdk-ffi and talia-bitbox-ffi,
 * branch main in both (NATIVE_SOURCES in archive-provenance.js), so a public
 * clone of the app can build them and check them against the pins. They are
 * still developed in the private repos (bdk-ffi-fork, branch talia-3, and
 * bitbox-ffi), and each change is copied to the public repo's main in one
 * commit before it is built. native/build-bitboxffi.sh and
 * native/build-bdkwallet.sh call this script so every library they write
 * can be traced to an exact commit there:
 *
 *   node scripts/native-sources.js check     <lib> <checkout> [--rollback <commit>]
 *   node scripts/native-sources.js cargo-env <lib> <checkout>
 *   node scripts/native-sources.js recheck   <lib> <checkout> <commit>
 *   node scripts/native-sources.js record    <lib> <commit> <checkout> [<work folder>]
 *   node scripts/native-sources.js pin       <lib> [<lib> ...]
 *   node scripts/native-sources.js verify    [--test-build]
 *   node scripts/native-sources.js restore   <lib> [<lib> ...] | all
 *   node scripts/native-sources.js copies    [<lib> ...] | all
 *
 * and native/build-bdkwallet.sh, the phone, simulator and archive builds
 * these checks (BDK upgrade, decided 2026-10-16):
 *
 *   node scripts/native-sources.js peers      <lib> <ios|sim>
 *   node scripts/native-sources.js gate       <lib> <checkout> <work folder> <sysroot>
 *   node scripts/native-sources.js minos      <ios|sim> <library.a> <sysroot>
 *   node scripts/native-sources.js vendored   <cargo-metadata.json> <crate dir> <package>...
 *   node scripts/native-sources.js link-check <iphoneos|iphonesimulator> <xcodebuild log>
 *
 * peers      the file of that slice of every other library, for the
 *            symbol-overlap gate; refused unless each is as pinned, or as its
 *            recorded build (not pinned yet) wrote it.
 * gate       the fork's symbol-overlap gate over EVERY pair of libraries the
 *            app links, both slices (the new build against each pinned one,
 *            and the pinned ones against each other), its reports and the
 *            pair-tagged duplicate list written into the build's work folder.
 * minos      every object a build compiled is for iOS 15.0 (none newer), the
 *            rest the Rust toolchain's own prebuilt objects, byte for byte.
 * vendored   each patched crate resolves to the crate's vendor/ copy alone.
 * link-check refuses a link whose log reports a duplicate symbol outside the
 *            exact allowlist the overlap gate proved (each library's
 *            `duplicates` file), or a log with no link of the app at all, or
 *            a link that hid the symbols' names (-no_warn_duplicate_libraries,
 *            Xcode's default: every xcodebuild sets
 *            LD_WARN_DUPLICATE_LIBRARIES=YES), or object lines no name heads.
 *
 *   node scripts/native-sources.js ffi-prefix <Prefix> <header.h> <bindings.swift>
 *
 * ffi-prefix renames the C struct types of freshly generated bindings, so they
 *            never share a Swift type with another library's (prefixFfiTypes).
 *
 * check     (before the build) refuses unless the checkout is exactly its
 *           HEAD commit, judged BY CONTENT with archive-provenance.js's own
 *           checks (no edit, no untracked file, nothing hidden by a local
 *           exclude or an index flag; build output a committed .gitignore
 *           names is fine), and that commit is on the library's ALLOWLISTED
 *           branch of its org repo (NATIVE_SOURCES[lib].branch): the remote
 *           pointing there is FETCHED first, so "pushed" means pushed now, and
 *           a commit only on another branch (a feature branch, say) is
 *           refused. The commit must also CONTAIN the one the library's
 *           "# source" line in native-libs.sha256 records, both in the
 *           working tree and in the app's last commit, so a build never goes
 *           backwards by accident; an older commit of that branch is built
 *           only with `--rollback <that commit>`, which the build scripts pass
 *           through (decided 2026-10-16: not "tip only", so a rollback
 *           stays possible after a hotfix). A record that cannot say which
 *           commit that is (unreadable, a spoiled source line, pins without
 *           one, a source line naming any repo but the library's own) is
 *           refused; only a record holding nothing of the library is its
 *           first build. git's ancestry is read with replace refs, the
 *           grafts file and the commit-graph cache off. It also refuses a cargo
 *           config or a Rust toolchain file ABOVE the checkout (or in
 *           ~/.cargo): cargo and rustup read those for every build beneath
 *           them, so they could move the output or change the compiler
 *           without touching the checkout (decided 2026-10-05). It prints the
 *           commit on stdout and what it found on stderr.
 * cargo-env prints the only environment cargo runs in (NUL-separated
 *           NAME=value pairs for `env -i`): HOME, PATH, the user, the locale,
 *           TMPDIR, the terminal, the ssh agent and proxies. Nothing else in
 *           the shell (CARGO_TARGET_DIR, CARGO_BUILD_*, CARGO_PROFILE_*,
 *           RUSTFLAGS, RUSTC_WRAPPER, CC, CFLAGS, SDKROOT, ...) reaches it.
 *           It adds two variables of its own, the path maps (pathMaps,
 *           decided 2026-11-06): CARGO_ENCODED_RUSTFLAGS and CFLAGS replace
 *           the Cargo home, the checkout <checkout> (its physical path) and,
 *           for clang, the Xcode folder xcode-select names with fixed names
 *           in every path the build writes into <lib>, so neither the home
 *           folder, the checkout's folder nor Xcode's folder changes its
 *           bytes.
 * recheck   (after the build, before anything is copied into the app)
 *           refuses unless the checkout is still clean at that commit. No
 *           network.
 * record    (the build script's last step, never a command of its own)
 *           refuses unless the checkout is still exactly the commit, clean
 *           and on the library's branch, and every file the build copied
 *           into the app is byte for byte the build's own output (in the
 *           checkout, or in the build's work folder; the duplicate list is
 *           made again from the gate's reports there), then
 *           writes the library's record into native/native-libs.sha256:
 *             # source <lib> <repo> <commit>
 *             # built <lib> <sha256> <path>      (one per file the build wrote)
 *             # generated <lib> <sha256> <path>  (one per tracked file it wrote:
 *                                                the bindings, the duplicate list)
 *             # xcode <lib> <version> <build>    (the Xcode its C was compiled by)
 *             # gated <lib> <sha256> <path>      (a library whose build runs the
 *                                                symbol-overlap gate: each file of
 *                                                every OTHER library it judged)
 *           dropping its old "# built", "# generated", "# xcode", "# gated"
 *           and "# source-note" lines (a note describes an older, hand-made
 *           record), and shows the new files' digests against their pins.
 *           verify and the archive refuse a pinned file of another library
 *           that is not the one the gate judged (decided 2026-10-17): rebuilt
 *           since, it was never compared with this library.
 * pin       after the libraries are tested: sets each named library's pins to the
 *           digests its recorded build wrote, and refuses unless the files on
 *           disk ARE those files and the result is a record
 *           scripts/ios-archive.sh accepts. Libraries rebuilt together are
 *           pinned in one call (pin bdkwallet bitboxffi): the record is judged
 *           whole, so neither passes alone. Commit the record and the pins
 *           together; the archive refuses pins that are not exactly the
 *           recorded build's files.
 * verify    (before a build uses the libraries) refuses unless every
 *           library pinned in native-libs.sha256 is on disk with its pinned
 *           digest, the lib folders hold nothing but the pinned files, the
 *           record names our repos and exactly the pinned files, and the
 *           TaliaBdkWallet pod links the fork's library in place:
 *           archive-provenance.js's own checks, the ones
 *           scripts/ios-archive.sh applies with no override (decided
 *           2026-09-26: nothing native is used unchecked). No network.
 *           It also checks every tracked file a recorded build wrote (the
 *           bindings) against its record, and warns when a library was built
 *           with another Xcode than this Mac's (a rebuild here would not give
 *           the pinned bytes).
 *   verify --test-build  (what scripts/ios-device.sh runs before a PHONE
 *           build) is the same, except that a library whose files on disk
 *           are exactly the ones its recorded build wrote ("# built" lines)
 *           passes before it is pinned, and is named as such: that is how a
 *           rebuilt library is tested on the phone BEFORE `pin` (decided
 *           2026-10-07; with plain verify the record and the old pins
 *           disagree, so the untested library had to be pinned first).
 *           Nothing is written; an archive still refuses it until it is
 *           pinned and committed.
 * restore   (a fresh checkout, or the rollback after the old library was
 *           removed: decided 2026-10-22; for bdkffi,
 *           revert the removal commit first, which puts it back into
 *           NATIVE_SOURCES) puts back the
 *           pinned files of the named libraries that are missing, from the
 *           byte-identical copies kept as release files on the PRIVATE fork
 *           repo (COPIES: the releases named in COPIES.tags, each read by its
 *           tag, each file named <sha256>-<file name>), read through the
 *           user's own gh sign-in: for maintainers with access to that repo
 *           (a public clone builds the libraries from the public repos
 *           instead). Nothing is written unless every download has exactly its
 *           pinned SHA-256; each lands in its library's own lib folder as a
 *           plain file, never over an existing file (one already pinned is
 *           kept, one that differs is refused), and it ends with verify. No
 *           rebuild and no re-pin.
 * copies    read only: which release file holds each pinned file's copy; 2
 *           when one has none, or a release could not be read (run it after
 *           uploading a new pin's copies and adding the release's tag to
 *           COPIES.tags).
 *
 * No dependencies: Node's own fs, crypto and child_process only.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const prov = require('./archive-provenance.js');

const { NATIVE_PIN, NATIVE_SOURCES, linkedLibOf } = prov;
const FETCH_TIMEOUT_MS = 3 * 60 * 1000;
const COMMIT = /^[0-9a-f]{40}$/;
const PIN_LINE = /^([0-9a-f]{64}) [ *](.+)$/;
// The same shapes archive-provenance.js parses (strictly) and refuses.
const LOOKS_LIKE_SOURCE = /^\s*#\s*source\s+(\S+)/;
const LOOKS_LIKE_NOTE = /^\s*#\s*source-note\s+([a-z0-9-]+)\s*:/;
const LOOKS_LIKE_BUILT = /^\s*#\s*built\s+(\S+)/;
const LOOKS_LIKE_GENERATED = /^\s*#\s*generated\s+(\S+)/;
const LOOKS_LIKE_XCODE = /^\s*#\s*xcode\s+(\S+)/;
const LOOKS_LIKE_GATED = /^\s*#\s*gated\s+(\S+)/;

function shaOrNull(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/** "github.com/<owner>/<repo>" (lowercase) for any https or ssh spelling of a GitHub repo URL. */
function repoKey(url) {
  const s = String(url).trim();
  const m =
    /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::22)?\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      s,
    );
  return m ? `github.com/${m[1].toLowerCase()}/${m[2].toLowerCase()}` : s;
}

// ---------------------------------------------------------------- the checkout

/**
 * git for the NETWORK step: the user's own credential set-up (system and
 * global config are read, unlike archive-provenance's checks, or a private
 * repo could not be fetched), with no GIT_* variable and no hook.
 */
function userGit(root, args, opts = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !['DEVELOPER_DIR', 'TOOLCHAINS', 'SDKROOT'].includes(k) && v !== undefined) {
      env[k] = v;
    }
  }
  env.GIT_NO_REPLACE_OBJECTS = '1';
  env.GIT_GRAFT_FILE = '/dev/null';
  return execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.commitGraph=false', '-C', root, ...args],
    { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout },
  );
}

/** The remote of `root` whose (effective) URL is `repoUrl`, or null. */
function findRemote(root, repoUrl) {
  const names = (prov.tryGit(root, ['remote']) || '').split('\n').filter(Boolean);
  for (const name of names) {
    let url;
    try {
      // --get-url applies url.<base>.insteadOf, so this is where fetch goes.
      url = userGit(root, ['ls-remote', '--get-url', name]).trim();
    } catch {
      continue;
    }
    if (repoKey(url) === repoKey(repoUrl)) {
      return { name, url };
    }
  }
  return null;
}

/**
 * Is `ancestor` `commit` itself or one of its ancestors? true or false, or
 * null when git cannot tell (an object this checkout does not hold).
 */
function isAncestor(root, ancestor, commit) {
  try {
    prov.git(root, ['merge-base', '--is-ancestor', ancestor, commit]);
    return true;
  } catch (e) {
    return e && e.status === 1 ? false : null;
  }
}

/** A short commit as typed for --rollback: hex only, so it can never be a branch name or an option. */
const ROLLBACK_ARG = /^[0-9a-f]{7,40}$/;

/**
 * Is the checkout at `dir` exactly a commit of `repoUrl` that may be built?
 * Returns { ok, root, commit, remote, branches, problems, why } where `why`
 * names the first thing that failed: 'missing' | 'not-git' | 'no-commit' |
 * 'moved' | 'dirty' | 'no-remote' | 'fetch' | 'unpushed' | 'no-branch' |
 * 'off-branch' | 'rollback-mismatch' | 'behind-pin'.
 *
 * With `fetch` (before a build) it needs `branch`, the library's allowlisted
 * branch: the commit must be reachable from it on the org repo, and contain
 * every commit in `pinned` (the commits the records name, see recordFloors:
 * a commit, or a list of commits or of { commit, where }), unless `rollback`
 * names the checkout's own commit, which then may be older (still on the
 * branch). On success `floors` lists those commits and `rollback` says
 * whether the build goes back from any of them.
 */
function inspectCheckout(
  dir,
  { repoUrl, fetch = true, expectCommit = null, branch = null, pinned = null, rollback = null },
) {
  if (fetch && !branch) {
    throw new Error('inspectCheckout: a build is judged against its allowlisted branch, and none was named');
  }
  const floors = (pinned === null ? [] : Array.isArray(pinned) ? pinned : [pinned]).map((p) =>
    typeof p === 'string' ? { commit: p, where: `the commit ${NATIVE_PIN} records` } : p,
  );
  const fail = (why, problems, extra = {}) => ({ ok: false, why, problems, ...extra });
  let root;
  try {
    root = fs.realpathSync(dir);
  } catch {
    return fail('missing', [`${dir} does not exist`]);
  }
  const top = prov.tryGit(root, ['rev-parse', '--show-toplevel']);
  if (!top || fs.realpathSync(top) !== root) {
    return fail('not-git', [
      top ? `${root} is inside the checkout ${top}, not its top folder` : `${root} is not a git checkout`,
    ]);
  }
  const commit = prov.tryGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!commit || !COMMIT.test(commit)) {
    return fail('no-commit', [`HEAD is not a full commit (${commit || 'none'})`], { root });
  }
  if (expectCommit && commit !== expectCommit) {
    return fail('moved', [`HEAD is now ${commit}, the build started from ${expectCommit}`], { root, commit });
  }
  // By content, as the archive judges the app (archive-provenance.js): every
  // tracked file hashed from disk must rebuild the commit's tree (Markdown
  // too: a crate can include_str! it), nothing untracked, and nothing ignored
  // but by a .gitignore the commit holds. Finder's .DS_Store aside.
  const tracked = prov.compareTrackedFiles(root, commit, 'sha1', { docExempt: false });
  const untracked = prov.readUntracked(root, tracked.gitignores, () => true);
  const changes = [
    ...tracked.changes,
    ...untracked.others.filter((p) => path.basename(p) !== '.DS_Store').map((p) => `?? ${p}`),
    ...untracked.problems,
  ];
  if (changes.length > 0) {
    return fail('dirty', changes, { root, commit });
  }
  if (!fetch) {
    return { ok: true, root, commit, remote: null, branches: [], problems: [] };
  }
  const remote = findRemote(root, repoUrl);
  if (!remote) {
    return fail('no-remote', [`no remote of this checkout is ${repoUrl}`], { root, commit });
  }
  try {
    userGit(
      root,
      [
        'fetch',
        '--quiet',
        '--no-tags',
        '--prune',
        '--no-recurse-submodules',
        remote.name,
        `+refs/heads/*:refs/remotes/${remote.name}/*`,
      ],
      { timeout: FETCH_TIMEOUT_MS },
    );
  } catch (e) {
    const said = String((e && e.stderr) || (e && e.message) || '').trim();
    return fail('fetch', [`could not fetch ${remote.url} (remote ${remote.name})${said ? `: ${said}` : ''}`], {
      root,
      commit,
      remote,
    });
  }
  const refs = prov.git(root, [
    'for-each-ref',
    '--contains',
    commit,
    '--format=%(refname)%00%(symref)',
    `refs/remotes/${remote.name}`,
  ]);
  const branches = refs
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\0'))
    .filter(([ref, sym]) => !sym && ref.startsWith(`refs/remotes/${remote.name}/`))
    .map(([ref]) => ref.slice('refs/remotes/'.length));
  if (branches.length === 0) {
    return fail('unpushed', [`${commit} is on no branch of ${repoUrl}`], { root, commit, remote });
  }
  // Only the allowlisted branch counts (decided 2026-10-16): "on some
  // branch" let a harness-branch or feature-branch commit, reviewed by nobody,
  // become the app's Bitcoin core.
  const seen = { root, commit, remote, branches };
  const allowed = `${remote.name}/${branch}`;
  if (!prov.tryGit(root, ['rev-parse', '--verify', '--quiet', `refs/remotes/${allowed}^{commit}`])) {
    return fail('no-branch', [`${repoUrl} has no branch ${branch}, the only one this library is built from`], seen);
  }
  if (!branches.includes(allowed)) {
    const others = branches.map((b) => b.slice(remote.name.length + 1)).join(', ');
    return fail('off-branch', [`${commit} is not on ${branch} of ${repoUrl} (only on: ${others})`], seen);
  }
  if (rollback !== null) {
    const named = ROLLBACK_ARG.test(rollback)
      ? prov.tryGit(root, ['rev-parse', '--verify', '--quiet', `${rollback}^{commit}`])
      : null;
    if (named !== commit) {
      return fail('rollback-mismatch', [`--rollback names ${rollback}, but the checkout is ${commit}`], seen);
    }
  }
  // Never backwards by accident: every commit the records name (the one the
  // app's libraries were last built from, and the one its last commit pins)
  // must be in this one's history, unless the rollback is asked for.
  const checked = floors.map((f) => ({ ...f, contains: isAncestor(root, f.commit, commit) }));
  const behind = checked.filter((f) => f.contains !== true);
  if (behind.length > 0 && rollback === null) {
    return fail(
      'behind-pin',
      behind.map((f) =>
        f.contains === null
          ? `${commit} cannot be shown to contain ${f.commit}, ${f.where} (this checkout does not hold it)`
          : `${commit} does not contain ${f.commit}, ${f.where}: this build would go backwards`,
      ),
      seen,
    );
  }
  return {
    ok: true,
    root,
    commit,
    remote,
    branches,
    branch: allowed,
    floors: checked.map(({ commit: c, where, contains }) => ({ commit: c, where, contained: contains === true })),
    rollback: behind.length > 0,
    problems: [],
  };
}

// ---------------------------------------------------------------- the build environment

/**
 * Files cargo and rustup read for a build in `root` that are NOT in the
 * checkout (decided 2026-10-05): a `.cargo/config(.toml)` in any folder above
 * it, or in ~/.cargo (where cargo looks when CARGO_HOME is unset, as it is
 * under cargo-env), can set the target folder, rustflags, a rustc wrapper or
 * a linker; a `rust-toolchain(.toml)` above it picks the compiler for a crate
 * that names none. The checkout's own copies are judged with the checkout.
 */
const CARGO_CONFIGS = ['.cargo/config', '.cargo/config.toml'];
const TOOLCHAIN_FILES = ['rust-toolchain', 'rust-toolchain.toml'];

function buildConfigOutside(root, home) {
  const found = [];
  const exists = (f) => {
    try {
      fs.lstatSync(f);
      return true;
    } catch {
      return false;
    }
  };
  const looked = new Set();
  const lookIn = (dir, names) => {
    for (const name of names) {
      const f = path.join(dir, name);
      if (!looked.has(f) && exists(f)) {
        found.push(f);
      }
      looked.add(f);
    }
  };
  let dir = path.dirname(path.resolve(root));
  for (;;) {
    lookIn(dir, [...CARGO_CONFIGS, ...TOOLCHAIN_FILES]);
    const up = path.dirname(dir);
    if (up === dir) {
      break;
    }
    dir = up;
  }
  if (home) {
    lookIn(home, CARGO_CONFIGS);
  }
  return found;
}

/**
 * The only environment cargo (and the C compilers its build scripts drive)
 * runs in, for `env -i`: what finds the tools and the network, never what
 * steers a build. Everything else is dropped, by name, so a variable nobody
 * thought of cannot reach it either: CARGO_TARGET_DIR (cargo would build
 * elsewhere and the script would copy a stale library), CARGO_BUILD_*,
 * CARGO_PROFILE_*, CARGO_TARGET_<triple>_*, RUSTFLAGS and
 * CARGO_ENCODED_RUSTFLAGS, RUSTC, RUSTC_WRAPPER, RUSTC_WORKSPACE_WRAPPER,
 * RUSTUP_TOOLCHAIN, CARGO_HOME, CC/CFLAGS/AR (secp256k1 and SQLite are C),
 * SDKROOT, DEVELOPER_DIR, *_DEPLOYMENT_TARGET. cargo-env then adds its own
 * path maps (pathMaps) as CARGO_ENCODED_RUSTFLAGS and CFLAGS, the only values
 * of either that reach cargo; the shell's are dropped here like the rest.
 */
const CARGO_ENV_KEEP = new Set([
  'HOME',
  'PATH',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  'TERM',
  'SSH_AUTH_SOCK',
  // The network only: Cargo.lock's checksums decide what is downloaded.
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
]);
/** Dropped names worth saying out loud: each of these would change a build. */
const NOTABLE_CARGO_DROPPED =
  /^CARGO_|^RUST|^(C|CXX|CPP|LD|OBJC)FLAGS|^CC|^CXX|^AR(_|$)|^TARGET_|^LD$|^LIBRARY_PATH$|^SDKROOT$|^DEVELOPER_DIR$|^TOOLCHAINS$|DEPLOYMENT_TARGET$|^DYLD_/;

function cargoEnv(env) {
  const kept = {};
  const dropped = [];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) {
      continue;
    }
    if (CARGO_ENV_KEEP.has(k) || /^LC_[A-Z_]+$/.test(k)) {
      kept[k] = v;
    } else {
      dropped.push(k);
    }
  }
  return { kept, dropped: dropped.sort() };
}

/**
 * The path maps (decided 2026-11-06): the paths of the build machine a build
 * of `lib` would write into the library, each replaced by a fixed name.
 * cargo-env gives cargo no CARGO_HOME, so its home is `<HOME>/.cargo` taken
 * literally (as cargo and rustup take it), and the crates.io sources sit
 * under it: that becomes `/cargo`. The checkout, which the build scripts hand
 * over as its physical path (`pwd -P`, the path cargo reads it at, and the
 * root of their --target-dir), becomes `/` plus the public repo's name. The
 * Xcode that `xcode-select -p` names (`developer`, its Developer folder: the
 * one cc's xcrun and clang use once cargo-env drops DEVELOPER_DIR) becomes
 * `/xcode`: ring compiles its C and assembly with -gfull on Apple targets,
 * so their debug information holds the SDK's and clang's include folders.
 * rustc takes the first two as `--remap-path-prefix` in
 * CARGO_ENCODED_RUSTFLAGS (panic locations; the flags are separated by
 * 0x1f), clang all three as `-ffile-prefix-map` in CFLAGS, which the cc
 * crate passes to every C and assembly file. A folder reached through a
 * link is mapped by its physical path too, because clang records the
 * folder it runs in as getcwd gives it. Neither compiler writes the flags
 * themselves into the library, so a build under any home folder, in any
 * checkout folder and with the same Xcode installed anywhere gives the same
 * bytes. Each fork's README gives the same variables for a build of one's
 * own.
 *
 * CARGO_ENCODED_RUSTFLAGS takes the place of any rustflags the checkout's
 * own cargo config sets (cargo reads one source of rustflags only): the bdk
 * fork's apply to Android alone, and the BitBox crate sets none. A path
 * holding whitespace (CFLAGS is split on it), "=" (both flags split FROM=TO
 * on it), 0x1f or a NUL, a relative or unnormalised one (cargo takes HOME
 * as it is, so a map built from a tidied copy would miss), a checkout given
 * other than by its physical path, and one folder inside another are
 * refused: the map would be ambiguous or silently miss.
 */
function pathMaps(lib, home, checkout, developer) {
  if (!Object.prototype.hasOwnProperty.call(NATIVE_SOURCES, lib || '')) {
    return { problem: `${lib} is not one of the libraries (${Object.keys(NATIVE_SOURCES).join(', ')}).` };
  }
  const src = NATIVE_SOURCES[lib];
  const as = `/${src.repo.split('/').pop()}`;
  const bad = (p) => typeof p !== 'string' || !path.isAbsolute(p) || /[\s=\x1f\0]/.test(p) || path.resolve(p) !== p.replace(/(.)\/+$/, '$1');
  if (bad(home)) {
    return { problem: `HOME (${home}) must be an absolute, normalised path with no whitespace and no "=": cargo's home under it is mapped to /cargo.` };
  }
  if (bad(checkout)) {
    return { problem: `The checkout (${checkout}) must be an absolute, normalised path with no whitespace and no "=".` };
  }
  if (bad(developer)) {
    return { problem: `The Xcode folder xcode-select names (${developer}) must be an absolute, normalised path with no whitespace and no "=".` };
  }
  const physical = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return null;
    }
  };
  const checkoutPhysical = physical(checkout);
  if (!checkoutPhysical) {
    return { problem: `The checkout (${checkout}) does not exist.` };
  }
  if (checkoutPhysical !== path.resolve(checkout)) {
    return { problem: `The checkout must be given as its physical path (${checkoutPhysical}), the one cargo reads it at.` };
  }
  const cargoHome = path.join(home.replace(/(.)\/+$/, '$1'), '.cargo');
  const homePhysical = physical(home);
  const cargoHomePhysical = physical(cargoHome) || (homePhysical && path.join(homePhysical, '.cargo')) || cargoHome;
  const developerPhysical = physical(developer) || developer;
  for (const p of [cargoHomePhysical, developerPhysical]) {
    if (bad(p)) {
      return { problem: `The physical path ${p} must hold no whitespace and no "=".` };
    }
  }
  const both = (logical, real) => (real === logical ? [logical] : [logical, real]);
  const groups = [
    { froms: both(cargoHome, cargoHomePhysical), to: '/cargo', rustc: true },
    { froms: [checkoutPhysical], to: as, rustc: true },
    { froms: both(path.resolve(developer), developerPhysical), to: '/xcode', rustc: false },
  ];
  const inside = (a, b) => a === b || a.startsWith(b.endsWith('/') ? b : `${b}/`);
  for (const [i, g] of groups.entries()) {
    for (const h of groups.slice(i + 1)) {
      for (const a of g.froms) {
        for (const b of h.froms) {
          if (inside(a, b) || inside(b, a)) {
            return { problem: `${a} and ${b} must not be one inside the other: the checkout, cargo's home and the Xcode folder are each mapped once.` };
          }
        }
      }
    }
  }
  const pairs = (rustcOnly) => groups.filter((g) => !rustcOnly || g.rustc).flatMap((g) => g.froms.map((from) => [from, g.to]));
  return {
    vars: {
      CARGO_ENCODED_RUSTFLAGS: pairs(true)
        .map(([from, to]) => `--remap-path-prefix=${from}=${to}`)
        .join('\x1f'),
      CFLAGS: pairs(false)
        .map(([from, to]) => `-ffile-prefix-map=${from}=${to}`)
        .join(' '),
    },
    shown: pairs(false)
      .map(([from, to]) => `${from} → ${to}`)
      .join(', '),
  };
}

/**
 * The Developer folder of the Xcode `xcode-select -p` names, the one a cargo
 * build under cargo-env compiles its C code with (DEVELOPER_DIR, TOOLCHAINS
 * and SDKROOT dropped, as installedXcode does), or null.
 */
function selectedDeveloperDir() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!['DEVELOPER_DIR', 'TOOLCHAINS', 'SDKROOT'].includes(k) && v !== undefined) {
      env[k] = v;
    }
  }
  try {
    const out = execFileSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30 * 1000 });
    return out.trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the record

/** The pin lines of `lib` in the record's text: [{ path, pinned }]. */
function pinsOf(text, lib) {
  const dir = `${NATIVE_SOURCES[lib].libDir}/`;
  const out = [];
  for (const line of text.split('\n')) {
    const m = PIN_LINE.exec(line.trim());
    if (m && m[2].startsWith(dir)) {
      out.push({ path: m[2], pinned: m[1] });
    }
  }
  return out;
}

const linesOf = (text) => {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
};

const isPinOf = (line, lib) => {
  const m = PIN_LINE.exec(line.trim());
  return m !== null && m[2].startsWith(`${NATIVE_SOURCES[lib].libDir}/`);
};

/**
 * The record's text with `lib`'s record set to `commit` and the files its
 * build wrote (`built`: [{ path, sha256 }]), the tracked files it wrote
 * (`generated`, the bindings: [{ path, sha256 }]) and the Xcode that compiled
 * its C code (`xcode`: { version, build } or null) and the other libraries'
 * files its symbol-overlap gate judged (`gated`: [{ path, sha256 }]): the
 * source line in place of the old one (a second one dropped), else just above
 * the library's pins, else at the end, with one "# built" line per file right
 * under it, then the "# generated" lines, the "# xcode" line and the
 * "# gated" lines. The library's old "# built", "# generated", "# xcode",
 * "# gated" and "# source-note" lines go: they describe the record being
 * replaced. Nothing else changes; the pins stay until `pin`.
 */
function withSourceRecord(text, lib, commit, built, generated = [], xcode = null, gated = []) {
  const want = [
    `# source ${lib} ${NATIVE_SOURCES[lib].repo} ${commit}`,
    ...built.map((b) => `# built ${lib} ${b.sha256} ${b.path}`),
    ...generated.map((g) => `# generated ${lib} ${g.sha256} ${g.path}`),
    ...(xcode ? [`# xcode ${lib} ${xcode.version} ${xcode.build}`] : []),
    ...gated.map((g) => `# gated ${lib} ${g.sha256} ${g.path}`),
  ];
  const out = [];
  let placed = false;
  for (const line of linesOf(text)) {
    const own = [LOOKS_LIKE_NOTE, LOOKS_LIKE_BUILT, LOOKS_LIKE_GENERATED, LOOKS_LIKE_XCODE, LOOKS_LIKE_GATED].some((re) => {
      const m = re.exec(line);
      return m !== null && m[1] === lib;
    });
    if (own) {
      continue;
    }
    const source = LOOKS_LIKE_SOURCE.exec(line);
    if (source && source[1] === lib) {
      if (!placed) {
        out.push(...want);
        placed = true;
      }
      continue;
    }
    out.push(line);
  }
  if (!placed) {
    const at = out.findIndex((l) => isPinOf(l, lib));
    out.splice(at >= 0 ? at : out.length, 0, ...want);
  }
  return out.join('\n') + '\n';
}

/**
 * The record's text with `lib`'s pins set to digests[path]: each pin of the
 * library rewritten in place, and a pin added (after the library's last pin,
 * else at the end) for a path that has none yet.
 */
function withPins(text, lib, digests) {
  const seen = new Set();
  const out = linesOf(text).map((line) => {
    const m = PIN_LINE.exec(line.trim());
    if (m && isPinOf(line, lib) && digests[m[2]]) {
      seen.add(m[2]);
      return `${digests[m[2]]}  ${m[2]}`;
    }
    return line;
  });
  const added = Object.keys(digests)
    .filter((p) => !seen.has(p))
    .map((p) => `${digests[p]}  ${p}`);
  if (added.length > 0) {
    let at = -1;
    out.forEach((l, i) => {
      if (isPinOf(l, lib)) {
        at = i;
      }
    });
    out.splice(at >= 0 ? at + 1 : out.length, 0, ...added);
  }
  return out.join('\n') + '\n';
}

function readRecordOrNull(root) {
  try {
    return fs.readFileSync(path.join(root, NATIVE_PIN), 'utf8');
  } catch {
    return null;
  }
}

function readRecord(root) {
  const text = readRecordOrNull(root);
  return text === null ? '' : text;
}

/**
 * The floor `lib`'s record in `text` sets for a build: { commit } from its one
 * "# source" line (the commit its libraries in the app were last built from,
 * pinned or still being tested), { commit: null } for its FIRST build, or
 * { problem }. It fails closed (decided 2026-10-16): a first build is a record
 * holding nothing of the library at all, no source, built, note or pin line,
 * so a source line spoiled by hand (a short commit, a second line), or pins
 * left without their source line, is refused rather than read as "no floor";
 * and `text` null (the record could not be read) is refused too. A source
 * line naming any repo but the library's own (NATIVE_SOURCES[lib].repo,
 * spelled exactly) is refused as well, its private development repo included
 * (decided 2026-11-06): the public repo shares no history with it.
 */
function recordFloor(text, lib, where = NATIVE_PIN) {
  if (text === null) {
    return { problem: `${where} cannot be read` };
  }
  const lines = linesOf(text);
  const named = (re) =>
    lines.filter((l) => {
      const m = re.exec(l);
      return m !== null && m[1] === lib;
    });
  const sourceLines = named(LOOKS_LIKE_SOURCE);
  if (sourceLines.length === 0) {
    const traces = [
      ...named(LOOKS_LIKE_BUILT),
      ...named(LOOKS_LIKE_NOTE),
      ...named(LOOKS_LIKE_GENERATED),
      ...named(LOOKS_LIKE_XCODE),
      ...named(LOOKS_LIKE_GATED),
      ...lines.filter((l) => isPinOf(l, lib)),
    ];
    return traces.length === 0
      ? { commit: null }
      : { problem: `${where} holds ${lib}'s pins or build lines but no "# source ${lib}" line` };
  }
  if (sourceLines.length > 1) {
    return { problem: `${where} holds ${sourceLines.length} "# source ${lib}" lines` };
  }
  const own = prov.parseNativeSources(text).sources.find((s) => s.lib === lib);
  if (!own || own.repo !== NATIVE_SOURCES[lib].repo || !COMMIT.test(own.commit) || /^0+$/.test(own.commit)) {
    return {
      problem: `${where}'s line ${JSON.stringify(sourceLines[0])} is not "# source ${lib} <repo URL> <40-hex commit>"`,
    };
  }
  return { commit: own.commit };
}

/**
 * The record as the app's last commit holds it (HEAD:native/native-libs.sha256),
 * or null. Read from the object store, never through a filter.
 */
function committedRecord(root) {
  try {
    return prov.git(root, ['cat-file', 'blob', `HEAD:${NATIVE_PIN}`]);
  } catch {
    return null;
  }
}

/**
 * What a build of `lib` must contain: the commit the record in the working
 * tree names AND the one the app's last commit names (decided 2026-10-16: a
 * rollback built and then abandoned leaves the working-tree record at the old
 * commit while the committed pins still name the newer one, and the floor must
 * not drop with it). Returns { floors: [{ commit, where }], problems, spoiled }
 * (`spoiled`: which records, 'working' and/or 'committed', could not set a
 * floor); no floor at all is a first build.
 */
function recordFloors(root, lib) {
  const sides = [
    { side: 'working', text: readRecordOrNull(root), where: NATIVE_PIN, says: `the commit ${NATIVE_PIN} records` },
    {
      side: 'committed',
      text: committedRecord(root),
      where: `${NATIVE_PIN} in the app's last commit`,
      says: `the commit ${NATIVE_PIN} records in the app's last commit`,
    },
  ];
  const floors = [];
  const problems = [];
  const spoiled = [];
  for (const { side, text, where, says } of sides) {
    const f = recordFloor(text, lib, where);
    if (f.problem) {
      problems.push(f.problem);
      spoiled.push(side);
    } else if (f.commit && !floors.some((x) => x.commit === f.commit)) {
      floors.push({ commit: f.commit, where: says });
    }
  }
  return { floors, problems, spoiled };
}

// ---------------------------------------------------------------- CLI

const say = (lines) => process.stderr.write(lines.join('\n') + '\n');
/** A problem as an indented block (git's own messages run over several lines). */
const block = (p) => `    ${p.split('\n').join('\n      ')}`;

function usage() {
  say([
    'usage: native-sources.js check <lib> <checkout> [--rollback <commit>] | cargo-env <lib> <checkout> |',
    '                         recheck <lib> <checkout> <commit> | record <lib> <commit> <checkout> [<work>] |',
    `                         pin <lib>... | verify [--test-build]   (lib: ${Object.keys(NATIVE_SOURCES).join(', ')})`,
    '                         peers <lib> <ios|sim> | gate <lib> <checkout> <work> <sysroot> |',
    '                         minos <ios|sim> <library.a> <sysroot> |',
    '                         vendored <cargo-metadata.json> <crate dir> <package>... |',
    '                         link-check <iphoneos|iphonesimulator> <xcodebuild log> |',
    '                         ffi-prefix <Prefix> <header.h> <bindings.swift> |',
    `                         ${RESTORE_USAGE} | copies [<lib>|all]...`,
  ]);
  return 64;
}

function libOrNull(lib) {
  if (!Object.prototype.hasOwnProperty.call(NATIVE_SOURCES, lib || '')) {
    say([`✗ Unknown library "${lib}" (${Object.keys(NATIVE_SOURCES).join(', ')}).`]);
    return null;
  }
  return NATIVE_SOURCES[lib];
}

/**
 * What `check <lib> <checkout> [--rollback <commit>]` asks inspectCheckout:
 * the library's org repo and allowlisted branch, and the commits its record
 * names in `root`'s native-libs.sha256, in the working tree and in the app's
 * last commit (recordFloors). `problems` is not empty when a record cannot
 * set the floor, and the build is then refused before anything is asked.
 * null for a malformed command line.
 */
function checkRequest([lib, dir, ...rest], root) {
  const src = libOrNull(lib);
  if (!src || !dir) {
    return null;
  }
  let rollback = null;
  if (rest.length === 2 && rest[0] === '--rollback' && rest[1]) {
    rollback = rest[1];
  } else if (rest.length > 0) {
    return null;
  }
  const { floors, problems, spoiled } = recordFloors(root, lib);
  return {
    lib,
    src,
    dir,
    problems,
    spoiled,
    opts: { repoUrl: src.repo, branch: src.branch, pinned: floors, rollback },
  };
}

function cmdCheck(args, root) {
  const req = checkRequest(args, root);
  if (!req) {
    return usage();
  }
  const { lib, src, dir, opts } = req;
  if (req.problems.length > 0) {
    say([
      `✗ Refusing to build ${lib}: its record cannot say which commit the app's`,
      '  libraries were last built from, so a build could go backwards unseen.',
      '',
      ...req.problems.map(block),
      '',
      ...(req.spoiled.includes('committed')
        ? [
            "  The app's last commit holds a record no build can start from: check out",
            '  a commit of the app whose record is whole, and build there.',
          ]
        : [
            '  Put the record back as the app last committed it and build again:',
            `    git -C ${root} checkout -- ${NATIVE_PIN}`,
          ]),
      '  Never write a record line by hand: the build writes them.',
    ]);
    return 2;
  }
  const r = inspectCheckout(dir, opts);
  if (!r.ok) {
    const where = r.root || dir;
    const remote = r.remote ? r.remote.name : '<remote>';
    const hint = {
      dirty: [
        'Set the change aside (stash it, or delete the untracked files) and build',
        'again. A change to the library is reviewed in its private repository and',
        `copied to the public repository's ${src.branch} in one commit, then built.`,
      ],
      'no-remote': ['Add the repo as a remote and build again:', `    git -C ${where} remote add 21c ${src.repo}`],
      fetch: ['Check the network and your access to the repo, then build again.'],
      unpushed: [
        'A change to the library is reviewed in its private repository and copied',
        `to the public repository's ${src.branch} in one commit, then built: build from`,
        'that commit once it is there, never from one made in this checkout.',
      ],
      'no-branch': [`Builds come from ${src.branch} alone. Check the repo, then build again.`],
      'off-branch': [
        `Only commits on ${src.branch} are built into the app, never one only on another`,
        'branch (a feature branch, say). A change to the library is reviewed in its',
        `private repository and copied to the public repository's ${src.branch} in one`,
        'commit, then built from there.',
      ],
      'rollback-mismatch': [
        "--rollback must name the commit being built, which is the checkout's HEAD.",
      ],
      'behind-pin': [
        'The checkout is almost certainly just out of date. Check out the branch as',
        'it is now and build again; this is nearly always the right move:',
        `    git -C ${where} checkout --detach ${remote}/${src.branch}`,
        'Building an older library on purpose is a ROLLBACK: a decision to ship older',
        'code, made for the release, never the way past this message. The build',
        'script takes it only with --rollback naming the commit being built.',
      ],
    }[r.why] || ['Check out a commit of the repo and build again.'];
    say([
      `✗ Refusing to build ${lib} from ${where}:`,
      '',
      ...r.problems.map(block),
      '',
      '  A native library is built only from a clean checkout of a commit on the',
      `  ${src.branch} branch of ${src.repo}`,
      '  that contains the commit its libraries were last built from, so every',
      '  library in the app can be traced to reviewed source in our own repo and a',
      '  build never goes backwards by accident.',
      ...hint.map((l) => `  ${l}`),
    ]);
    return 2;
  }
  const outside = buildConfigOutside(r.root, process.env.HOME);
  if (outside.length > 0) {
    say([
      `✗ Refusing to build ${lib} from ${r.root}:`,
      '',
      ...outside.map((f) => `    ${f}`),
      '',
      '  cargo and rustup read these for every build under them, and they are not',
      '  in the checkout: they can move where cargo builds (so an old library would',
      '  be copied in), add compiler flags or a wrapper, or pick another compiler.',
      '  Move them away for the build and build again.',
    ]);
    return 2;
  }
  say([
    `▸ ${lib} source: ${r.root}`,
    `    commit ${r.commit} (the checkout is exactly this commit)`,
    `    on     ${src.repo} branch ${src.branch}`,
    ...(r.floors.length === 0
      ? [`    after  nothing: ${NATIVE_PIN} records no commit for ${lib} yet (its first build)`]
      : r.floors.map((f) =>
          f.contained
            ? `    after  ${f.commit}, ${f.where} (this one contains it)`
            : `    ROLLBACK from ${f.commit}, ${f.where} (--rollback)`,
        )),
  ]);
  process.stdout.write(`${r.commit}\n`);
  return 0;
}

function cmdCargoEnv([lib, checkout, ...extra], developerDir = selectedDeveloperDir) {
  if (!lib || !checkout || extra.length > 0) {
    return usage();
  }
  const { kept, dropped } = cargoEnv(process.env);
  if (!kept.PATH || !kept.HOME) {
    say(['✗ PATH and HOME must be set: cargo cannot be found or run without them.']);
    return 2;
  }
  const maps = pathMaps(lib, kept.HOME, checkout, developerDir());
  if (maps.problem) {
    say([`✗ ${maps.problem}`]);
    return 2;
  }
  const notable = dropped.filter((n) => NOTABLE_CARGO_DROPPED.test(n));
  say([
    `▸ cargo runs with only: ${Object.keys(kept).join(' ')}, and the path maps (${maps.shown}).`,
    ...(notable.length > 0 ? [`  Left out on purpose, as they change a build: ${notable.join(' ')}`] : []),
  ]);
  const env = { ...kept, ...maps.vars };
  process.stdout.write(Object.entries(env).map(([k, v]) => `${k}=${v}\0`).join(''));
  return 0;
}

function cmdRecheck([lib, dir, commit]) {
  const src = libOrNull(lib);
  if (!src || !dir || !COMMIT.test(commit || '')) {
    return usage();
  }
  const r = inspectCheckout(dir, { repoUrl: src.repo, fetch: false, expectCommit: commit });
  if (!r.ok) {
    say([
      `✗ The ${lib} checkout changed while it was being built, so the new libraries`,
      `  are not certainly ${commit}. Nothing was copied into the app.`,
      '',
      ...r.problems.map(block),
      '',
      '  Put the checkout back to that commit and build again.',
    ]);
    return 2;
  }
  process.stdout.write(`${r.commit}\n`);
  return 0;
}

/**
 * The Xcode that compiles the C code a cargo build under cargo-env drives:
 * xcode-select's, as `/usr/bin/xcodebuild -version` reports it with
 * DEVELOPER_DIR, TOOLCHAINS and SDKROOT dropped (cargo-env drops them too).
 * { version, build } or null when there is no Xcode here.
 */
function installedXcode() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!['DEVELOPER_DIR', 'TOOLCHAINS', 'SDKROOT'].includes(k) && v !== undefined) {
      env[k] = v;
    }
  }
  try {
    const out = execFileSync('/usr/bin/xcodebuild', ['-version'], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60 * 1000,
    });
    return parseXcodeVersion(out);
  } catch {
    return null;
  }
}

/** "Xcode 27.1\nBuild version 27A9275" -> { version: '27.1', build: '27A9275' }, or null. */
function parseXcodeVersion(out) {
  const version = /^Xcode ([0-9][0-9A-Za-z.]*)\s*$/m.exec(String(out));
  const build = /^Build version ([0-9A-Za-z]+)\s*$/m.exec(String(out));
  return version && build ? { version: version[1], build: build[1] } : null;
}

/**
 * May `record` vouch for a build from `dir` at `commit`? Only when the
 * checkout is still exactly that commit and clean (judged by content, as
 * `recheck`), and the commit is on the library's allowlisted branch as the
 * checkout's org remote was last fetched (by `check`, at the start of the
 * same build; no network here). { ok, root, problems }.
 */
function builtCheckout(src, dir, commit) {
  const r = inspectCheckout(dir, { repoUrl: src.repo, fetch: false, expectCommit: commit });
  if (!r.ok) {
    return { ok: false, root: r.root || null, problems: r.problems };
  }
  const remote = findRemote(r.root, src.repo);
  if (!remote) {
    return { ok: false, root: r.root, problems: [`no remote of ${r.root} is ${src.repo}`] };
  }
  const tip = `refs/remotes/${remote.name}/${src.branch}`;
  const on = prov.tryGit(r.root, ['rev-parse', '--verify', '--quiet', `${tip}^{commit}`]) ? isAncestor(r.root, commit, tip) : null;
  if (on !== true) {
    return { ok: false, root: r.root, problems: [`${commit} is not on ${remote.name}/${src.branch} as this checkout last fetched it`] };
  }
  return { ok: true, root: r.root, problems: [] };
}

/**
 * The duplicate list and the "# gated" lines a build's gate reports in `work`
 * prove (cmdGate wrote them): every pair of the link set judged, passed, on
 * the files it names, with the digests the files have now. { text, gated,
 * problems }.
 */
function gateProof(root, lib, checkoutRoot, work) {
  const problems = [];
  const judged = [];
  const gated = [];
  for (const slice of Object.keys(SLICES)) {
    const peers = peerFiles(root, lib, slice);
    if (peers.problems.length > 0) {
      problems.push(...peers.problems);
      continue;
    }
    for (const pair of linkPairs(lib, path.join(checkoutRoot, BUILD_OUTPUTS[lib].libs[slice]), peers.files)) {
      const file = gateReport(work, slice, pair);
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        problems.push(`no gate report ${file}`);
        continue;
      }
      const r = readGateReport(text, pair);
      problems.push(...r.problems.map((p) => `${file}: ${p}`));
      for (const side of [pair.a, pair.b]) {
        const now = shaOrNull(side.abs);
        if (r.judged.get(side.abs) !== now) {
          problems.push(`${file}: the gate judged ${side.abs} as ${r.judged.get(side.abs) || 'nothing'}; it is ${now || 'missing'} now`);
        }
      }
      judged.push({ slice, key: pair.key, names: r.duplicates });
    }
    gated.push(...peers.files.map((f) => ({ lib: f.lib, path: f.path, sha256: f.sha256 })));
  }
  gated.sort((a, b) => libOrder(a.lib, b.lib) || NATIVE_SOURCES[a.lib].files.indexOf(a.path) - NATIVE_SOURCES[b.lib].files.indexOf(b.path));
  return { text: allowlistText(judged), gated, problems };
}

/**
 * `record <lib> <commit> <checkout> [<work>]`, the last step of a build
 * script, never a command of its own (decided 2026-10-17: run by hand, it
 * hashed whatever lay in the app, so a hand-edited binding or duplicate list
 * was recorded, pinned and archived as the build's). It writes the record
 * only when the checkout is still exactly `commit`, clean and on the
 * library's branch (builtCheckout), and every file it records is byte for
 * byte what that build left (BUILD_OUTPUTS): the libraries in the checkout's
 * target folder, the bindings in the checkout or the build's work folder, and
 * the duplicate list as made again from the gate's reports there, whose
 * judged digests must be the files' digests now.
 */
function cmdRecord([lib, commit, checkout, work, ...rest], root, deps) {
  const src = libOrNull(lib);
  const outputs = src ? BUILD_OUTPUTS[lib] : null;
  const usesWork = !!outputs && Object.values(outputs.generated).some((g) => g.work || g.gate);
  if (!src || !COMMIT.test(commit || '') || !checkout || (usesWork ? !work : work !== undefined) || rest.length > 0) {
    return usage();
  }
  const refuse = (why) => {
    say([
      `✗ ${lib}: ${why[0]}, so nothing is recorded.`,
      ...why.slice(1).map(block),
      `  A record is written only by ${src.build}, from the build it just made. Run it again.`,
    ]);
    return 2;
  };
  const co = deps.checkout(src, checkout, commit);
  if (!co.ok) {
    return refuse([`the checkout ${checkout} is not a clean checkout of ${commit} on ${src.branch}`, ...co.problems]);
  }
  // The files the build script just copied into the app, as they lie there,
  // each the build's own output byte for byte.
  const notBuilt = [];
  const sameAs = (appFile, from) => {
    const here = shaOrNull(path.join(root, appFile));
    const there = shaOrNull(from);
    if (here === null) {
      notBuilt.push(`${appFile} is missing`);
    } else if (here !== there) {
      notBuilt.push(`${appFile} is ${here}; the build left ${there || 'nothing'} at ${from}`);
    }
    return here;
  };
  const built = src.files.map((f) => ({ path: f, sha256: sameAs(f, path.join(co.root, outputs.libs[sliceOf(f)])) }));
  let gated = [];
  const generated = src.generated.map((f) => {
    const from = outputs.generated[f];
    if (from.gate) {
      const proof = gateProof(root, lib, co.root, work);
      gated = proof.gated;
      notBuilt.push(...proof.problems);
      const here = fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : null;
      if (here === null) {
        notBuilt.push(`${f} is missing`);
      } else if (proof.problems.length === 0 && here !== proof.text) {
        notBuilt.push(`${f} is not the list the gate's reports in ${work} make`);
      }
      return { path: f, sha256: shaOrNull(path.join(root, f)) };
    }
    return { path: f, sha256: sameAs(f, path.join(from.work ? work : co.root, from.work || from.checkout)) };
  });
  if (notBuilt.length > 0) {
    return refuse(['the app does not hold exactly what the build wrote', ...notBuilt]);
  }
  const xcode = deps.xcode();
  if (src.fullRecord && xcode === null) {
    return refuse(['no Xcode answered `xcodebuild -version`']);
  }
  // uniffi's bindgen tool inside a library that must hold none: recorded, so
  // it can be tried, but never pinned or archived (decided 2026-10-17).
  const toolWarnings = [];
  if (src.toolCrates) {
    for (const b of built) {
      let crates = [];
      try {
        crates = prov.toolCratesIn(path.join(root, b.path), src.toolCrates);
      } catch {
        // not a static library: pin refuses it
      }
      if (crates.length > 0) {
        toolWarnings.push(`  ⚠ ${b.path} holds ${crates.join(', ')} (uniffi's bindgen tool): pin and the archive refuse it.`);
      }
    }
  }
  const text = withSourceRecord(readRecord(root), lib, commit, built, generated, xcode, gated);
  fs.writeFileSync(path.join(root, NATIVE_PIN), text);
  const pins = pinsOf(text, lib);
  const pinnedAs = (b) => (pins.find((p) => p.path === b.path) || {}).pinned;
  const unpinned = built.filter((b) => pinnedAs(b) !== b.sha256);
  say([
    `✓ ${lib}: recorded in ${NATIVE_PIN}`,
    `    # source ${lib} ${src.repo} ${commit}`,
    '  The files this build wrote:',
    ...built.map((b) => `    ${b.sha256}  ${b.path}  ${pinnedAs(b) === b.sha256 ? '(as pinned)' : '(NOT PINNED)'}`),
    ...generated.map((g) => `    ${g.sha256}  ${g.path}  (tracked: commit it with the record)`),
    ...(xcode ? [`  Its C code was compiled by Xcode ${xcode.version} (${xcode.build}).`] : []),
    ...(gated.length > 0
      ? ['  Its overlap gate judged it beside (archive and verify refuse other files there):', ...gated.map((g) => `    ${g.sha256}  ${g.path}`)]
      : []),
    ...toolWarnings,
    ...(unpinned.length === 0
      ? ['  They match their pins: commit the record.']
      : [
          '  scripts/ios-archive.sh refuses these libraries, and this record, until',
          '  they are pinned. Test them on the phone first (scripts/ios-device.sh',
          '  takes this recorded build before it is pinned), then pin them and',
          '  commit the record, the pins and any bindings the build changed, TOGETHER:',
          `    node scripts/native-sources.js pin ${lib}`,
          `    git add ${NATIVE_PIN} ${path.dirname(src.libDir)} && git commit`,
          `  To keep the old libraries instead, put back both: git checkout -- ${NATIVE_PIN}`,
          '  and the old files (the archive refuses a record kept without its files).',
        ]),
  ]);
  return 0;
}

function cmdPin(asked, root) {
  // Several libraries rebuilt together are pinned in ONE write: the record is
  // judged whole, so pinning either alone leaves the other's pins disagreeing
  // with its record and nothing could ever be pinned (2026-10-15, the BDK and
  // BitBox rebuilds tested on the phone together).
  const libs = [...new Set(asked.length > 0 ? asked : [undefined])];
  if (libs.some((lib) => !libOrNull(lib))) {
    return usage();
  }
  const text = readRecord(root);
  const sources = prov.parseNativeSources(text).sources;
  let next = text;
  const pinned = [];
  for (const lib of libs) {
    const src = NATIVE_SOURCES[lib];
    const own = sources.find((s) => s.lib === lib);
    if (!own || own.built.length === 0) {
      say([
        `✗ ${NATIVE_PIN} records no build of ${lib}, so nothing is pinned.`,
        `  Build it with ${src.build}, which records the commit and the files it wrote, then pin.`,
      ]);
      return 2;
    }
    // Only the files the recorded build wrote are pinned, never whatever lies
    // on disk: a library copied in by hand or built some other way is not
    // known to come from the recorded commit (decided 2026-10-05).
    const files = own.built.map((b) => ({ ...b, now: shaOrNull(path.join(root, b.path)) }));
    const wrong = files.filter((f) => f.now !== f.sha256);
    if (wrong.length > 0) {
      say([
        `✗ These are not the files the recorded build of ${lib} (${own.commit}) wrote, so nothing is pinned:`,
        ...wrong.map((f) => `    ${f.path} is ${f.now || 'missing'}; the build wrote ${f.sha256}`),
        `  Build them again with ${src.build} (it records what it writes), then pin.`,
      ]);
      return 2;
    }
    // A library that must hold none of uniffi's bindgen tool crates is never
    // pinned with them (decided 2026-10-17).
    if (src.toolCrates) {
      const tools = files
        .map((f) => {
          try {
            return { path: f.path, crates: prov.toolCratesIn(path.join(root, f.path), src.toolCrates) };
          } catch (e) {
            return { path: f.path, crates: [`nothing readable (${e.message})`] };
          }
        })
        .filter((t) => t.crates.length > 0);
      if (tools.length > 0) {
        say([
          `✗ ${lib} holds uniffi's bindgen tool and its dependencies, so nothing is pinned:`,
          ...tools.map((t) => `    ${t.path}: ${t.crates.join(', ')}`),
          '  Build it from a fork commit that gives uniffi\'s "cli" feature to the',
          '  uniffi-bindgen binary alone ([[bin]] required-features), then pin.',
        ]);
        return 2;
      }
    }
    next = withPins(next, lib, Object.fromEntries(own.built.map((b) => [b.path, b.sha256])));
    pinned.push({ lib, src, own, before: pinsOf(text, lib) });
  }
  const problems = prov.parseNativeSources(next).problems;
  if (problems.length > 0) {
    // The archive would refuse this record, so it is not written.
    const unpinned = prov
      .parseNativeSources(next)
      .sources.filter((s) => s.built.length > 0 && !libs.includes(s.lib))
      .filter((s) => !s.built.every((b) => pinsOf(next, s.lib).some((p) => p.path === b.path && p.pinned === b.sha256)))
      .map((s) => s.lib);
    const together = Object.keys(NATIVE_SOURCES).filter((l) => libs.includes(l) || unpinned.includes(l));
    say([
      `✗ ${NATIVE_PIN} would still be refused by scripts/ios-archive.sh, so nothing is pinned:`,
      ...problems.map((p) => `    ${p}`),
      unpinned.length > 0
        ? `  ${unpinned.join(' and ')} was rebuilt too and is not pinned; after testing, pin them together:\n` +
          `    node scripts/native-sources.js pin ${together.join(' ')}`
        : '  A build records its library\'s lines; pin each library its build changed.',
    ]);
    return 2;
  }
  fs.writeFileSync(path.join(root, NATIVE_PIN), next);
  for (const { lib, src, own, before } of pinned) {
    const was = (b) => (before.find((p) => p.path === b.path) || {}).pinned;
    const changed = own.built.filter((b) => was(b) !== b.sha256);
    say([
      changed.length === 0
        ? `✓ ${lib} was already pinned as its recorded build wrote it.`
        : `✓ ${lib} pinned in ${NATIVE_PIN}, built from ${own.repo} @ ${own.commit}:`,
      ...own.built.map((b) => `    ${b.sha256}  ${b.path}  ${was(b) === b.sha256 ? '(unchanged)' : '(new)'}`),
    ]);
  }
  say([
    '  Commit the record and the pins together:',
    `    git add ${NATIVE_PIN} ${pinned.map(({ src }) => path.dirname(src.libDir)).join(' ')} && git commit`,
  ]);
  return 0;
}

// ---------------------------------------------------------------- the C types the bindings import

/**
 * The C struct types a uniffi header declares (`typedef struct NAME`), each once.
 */
function ffiStructNames(header) {
  return [...new Set([...String(header).matchAll(/\btypedef\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)].map((m) => m[1]))];
}

/**
 * The bindings with every C struct type the header declares renamed to
 * `<prefix><name>`, in the header and in the Swift alike, and the header's
 * shared-block guard renamed too (found by a trial link on
 * 2026-10-16).
 *
 * Swift imports a C struct as a type named by its C name alone (__C.RustBuffer,
 * mangled So10RustBufferV), whatever clang module it came from, and every
 * Swift module that uses it carries its own copy of that type's metadata as a
 * weak symbol: the linker keeps ONE copy for the whole app, silently. uniffi
 * 0.23 (the old bdk-ffi, and BitBox's) declares RustBuffer with 32-bit
 * capacity and length, uniffi 0.31 with 64-bit, both as "RustBuffer" under the
 * same header guard. Linked together, the new library's generic Swift code
 * copied its 24-byte buffers through the old 16-byte type metadata, and the
 * Rust side freed a pointer it never allocated (the Debug simulator smoke
 * check aborted in the first known-answer call). With its own names the new
 * library's types cannot meet the old ones. The C ABI does not change: a
 * struct's name is not part of it, and uniffi's checksums cover the API, not
 * these names.
 */
function prefixFfiTypes(header, swift, prefix) {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(prefix)) {
    throw new Error(`"${prefix}" is not a type-name prefix`);
  }
  const names = ffiStructNames(header);
  if (names.length === 0) {
    throw new Error('the header declares no C struct type');
  }
  const prefixed = names.filter((n) => n.startsWith(prefix));
  if (prefixed.length > 0) {
    throw new Error(`the header already holds ${prefixed.join(', ')}: renamed twice?`);
  }
  const byLength = [...names].sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${byLength.join('|')})\\b`, 'g');
  const guard = /\bUNIFFI_SHARED_H(EADER_V\d+)?\b/g;
  const out = {
    header: String(header).replace(re, `${prefix}$1`).replace(guard, (m) => `${prefix.toUpperCase()}_${m}`),
    swift: String(swift).replace(re, `${prefix}$1`),
    renamed: names,
  };
  const left = new RegExp(`(?<![A-Za-z0-9_])(${byLength.join('|')})(?![A-Za-z0-9_])`);
  for (const [what, text] of [['header', out.header], ['Swift', out.swift]]) {
    const m = left.exec(text.replace(new RegExp(`\\b${prefix}[A-Za-z0-9_]+`, 'g'), ''));
    if (m) {
      throw new Error(`the ${what} still names ${m[1]} after the rename`);
    }
  }
  return out;
}

/**
 * `ffi-prefix <Prefix> <header.h> <bindings.swift>`: prefixFfiTypes, in place.
 */
function cmdFfiPrefix([prefix, header, swift, ...rest]) {
  if (!prefix || !header || !swift || rest.length > 0) {
    return usage();
  }
  let r;
  try {
    r = prefixFfiTypes(fs.readFileSync(header, 'utf8'), fs.readFileSync(swift, 'utf8'), prefix);
  } catch (e) {
    say([`✗ The bindings' C types were not renamed: ${e.message}`]);
    return 2;
  }
  fs.writeFileSync(header, r.header);
  fs.writeFileSync(swift, r.swift);
  say([`✓ The bindings' C types carry the prefix ${prefix} (Swift merges imported C types by name across modules):`, `    ${r.renamed.join(', ')}`]);
  return 0;
}

// ---------------------------------------------------------------- what a build script checks

/** The slices a library is built in: the device one and the simulator one. */
const SLICES = { ios: { suffix: '-ios.a', sdk: 'iphoneos' }, sim: { suffix: '-sim.a', sdk: 'iphonesimulator' } };

/**
 * The file of `slice` of every library but `lib` that the app links beside
 * it, as { files: [{ lib, path (relative), abs, sha256, as }], problems }: a
 * new library is judged against exactly that. Each must be on
 * disk as pinned (`as` 'pinned'), or exactly as its own recorded build wrote
 * it ('recorded': a library rebuilt and not pinned yet, which the overlap gate
 * must judge before both are tested and pinned together; decided 2026-10-17).
 */
function peerFiles(root, lib, slice) {
  const text = readRecord(root);
  const recorded = prov.parseNativeSources(text).sources;
  const files = [];
  const problems = [];
  for (const [other, src] of Object.entries(NATIVE_SOURCES)) {
    if (other === lib) {
      continue;
    }
    const file = src.files.find((f) => f.endsWith(SLICES[slice].suffix));
    const pin = pinsOf(text, other).find((p) => p.path === file);
    const own = recorded.find((r) => r.lib === other);
    const built = own && own.built.find((b) => b.path === file);
    const now = shaOrNull(path.join(root, file));
    const at = { lib: other, path: file, abs: path.join(root, file), sha256: now };
    if (now !== null && pin && now === pin.pinned) {
      files.push({ ...at, as: 'pinned' });
    } else if (now !== null && built && now === built.sha256) {
      files.push({ ...at, as: 'recorded' });
    } else if (!pin && !built) {
      problems.push(`${file} is neither pinned in ${NATIVE_PIN} nor recorded there`);
    } else {
      problems.push(
        `${file} is ${now || 'missing'}, ${[pin ? `pinned ${pin.pinned}` : null, built ? `recorded ${built.sha256}` : null]
          .filter(Boolean)
          .join(', ')}`,
      );
    }
  }
  return { files, problems };
}

/**
 * `peers <lib> <ios|sim>`: peerFiles, one absolute path per line, or refused.
 */
function cmdPeers([lib, slice, ...rest], root) {
  if (!libOrNull(lib) || !Object.prototype.hasOwnProperty.call(SLICES, slice || '') || rest.length > 0) {
    return usage();
  }
  const { files, problems } = peerFiles(root, lib, slice);
  if (problems.length > 0) {
    say([
      `✗ ${lib} cannot be judged against the libraries the app links beside it:`,
      ...problems.map(block),
      '  The overlap gate compares the new library with the files the app links beside it:',
      '  the pinned ones, or a recorded build being tested. Put them in place (copy the',
      '  pinned files from a checkout that has them, cp -c), then build again.',
    ]);
    return 2;
  }
  process.stdout.write(files.map((f) => `${f.abs}\n`).join(''));
  return 0;
}

// ---------------------------------------------------------------- the symbol-overlap gate over the link set

/**
 * Where each library's build leaves what the app takes from it (the build
 * scripts copy from exactly these, and `record` compares the app's copies
 * with them, decided 2026-10-17): `libs`, per slice, inside the checkout the
 * library was built from; `generated`, per tracked file, inside the checkout
 * (`checkout`), inside the build's own work folder outside it (`work`), or
 * made from the overlap gate's reports in that folder (`gate`); and for the
 * library whose build judges the whole link set, the fork's gate script.
 */
const BUILD_OUTPUTS = {
  bitboxffi: {
    libs: {
      ios: 'target/aarch64-apple-ios/release/libbitboxffi.a',
      sim: 'target/aarch64-apple-ios-sim/release/libbitboxffi.a',
    },
    generated: {
      'native/bitboxffi/bitbox.swift': { checkout: 'generated/bitbox.swift' },
      'native/bitboxffi/ffi/bitboxFFI.h': { checkout: 'generated/bitboxFFI.h' },
    },
  },
  bdkwallet: {
    libs: {
      ios: 'bdk-ffi/target/aarch64-apple-ios/release-smaller/libbdkffi.a',
      sim: 'bdk-ffi/target/lipo-ios-sim/libbdkffi.a',
    },
    generated: {
      'native/bdkwallet/BitcoinDevKit.swift': { work: 'bindings-ios/BitcoinDevKit.swift' },
      'native/bdkwallet/ffi/BitcoinDevKitFFI.h': { work: 'bindings-ios/BitcoinDevKitFFI.h' },
      'native/bdkwallet/duplicate-symbols.txt': { gate: true },
    },
    gate: 'bdk-ffi/scripts/symbol-overlap-gate.py',
  },
};
/** The slice (ios|sim) a library file of NATIVE_SOURCES is. */
const sliceOf = (file) => Object.keys(SLICES).find((k) => file.endsWith(SLICES[k].suffix));

/** The libraries in the canonical order of NATIVE_SOURCES (the allowlist's pair order). */
const libOrder = (a, b) => Object.keys(NATIVE_SOURCES).indexOf(a) - Object.keys(NATIVE_SOURCES).indexOf(b);
const pairKey = (a, b) => [a, b].sort(libOrder).join(' ');

/**
 * Every pair of libraries the app links together, for `slice`, with the file
 * of each side: `lib`'s new build (`own`, the absolute path of its build
 * output) and every other library's pinned file (peerFiles). Pairs NOT
 * involving `lib` are judged too (decided 2026-10-17: bdkffi, the old engine's
 * library until 2026-11-04, and bitboxffi already linked four uniffi_core
 * functions twice, and nothing had compared them). The new library is the gate's "new" side wherever it is in the pair.
 */
function linkPairs(lib, own, peers) {
  const set = [{ lib, abs: own }, ...peers];
  const pairs = [];
  for (let i = 0; i < set.length; i++) {
    for (let j = i + 1; j < set.length; j++) {
      const [a, b] = set[i].lib === lib ? [set[i], set[j]] : [set[i], set[j]].sort((x, y) => libOrder(x.lib, y.lib));
      pairs.push({ a, b, key: pairKey(a.lib, b.lib) });
    }
  }
  return pairs;
}

/** The gate's report for one pair, in the build's work folder. */
const gateReport = (work, slice, pair) => path.join(work, `gate-${slice}-${pair.key.replace(' ', '-')}.txt`);

/**
 * What the gate's report for a pair says: { passed, duplicates: [names],
 * problems }. It must judge exactly the two files of the pair (the "new:" and
 * "pinned:" lines), pass, and its DUPLICATE lines are the identical symbols
 * defined strongly in different objects, which the link may report.
 */
function readGateReport(text, pair) {
  const problems = [];
  const lines = String(text).split('\n');
  if (!lines.some((l) => l.startsWith(`new: ${pair.a.abs}: `))) {
    problems.push(`it does not judge ${pair.a.abs} as the new library`);
  }
  if (!lines.some((l) => l === `pinned: ${pair.b.abs}: ` || l.startsWith(`pinned: ${pair.b.abs}: `))) {
    problems.push(`it does not judge ${pair.b.abs} beside it`);
  }
  const passed = lines.some((l) => l.startsWith('RESULT: PASS'));
  if (!passed) {
    problems.push('it does not say RESULT: PASS');
  }
  const duplicates = [];
  // The digest of each file as the gate judged it (`gate` appends them).
  const judged = new Map();
  for (const l of lines) {
    const m = /^ {4}DUPLICATE ([^\s:]+): /.exec(l);
    if (m) {
      duplicates.push(m[1]);
    }
    const j = /^# judged ([0-9a-f]{64}) (.+)$/.exec(l);
    if (j) {
      judged.set(j[2], j[1]);
    }
  }
  return { passed, duplicates: [...new Set(duplicates)].sort(), judged, problems };
}

const ALLOWLIST_HEAD = [
  '# Duplicate symbols the app\'s link may report (written by native/build-bdkwallet.sh',
  '# from the fork\'s symbol-overlap gate, run over EVERY pair of the libraries the app',
  '# links; never edit by hand). Each line: <slice> <library> <library> <symbol>. The',
  '# two libraries define the symbol in DIFFERENT objects whose code for it the gate',
  '# proved identical, so ld\'s choice of the first copy it loads changes nothing.',
  '# scripts/native-sources.js link-check refuses any duplicate not listed here for',
  '# exactly the slice and the pair of libraries it was linked from.',
];

/** The allowlist file's text from the gate's DUPLICATE names: [{ slice, key, names }]. */
function allowlistText(judged) {
  const rows = [];
  for (const slice of Object.keys(SLICES)) {
    for (const j of judged.filter((x) => x.slice === slice).sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0))) {
      for (const name of j.names) {
        rows.push(`${slice} ${j.key} ${name}`);
      }
    }
  }
  return [...ALLOWLIST_HEAD, ...rows].join('\n') + '\n';
}

/**
 * `gate <lib> <checkout> <work> <sysroot>`: the fork's symbol-overlap gate
 * (the checkout's own script, `python3 -I`, cargo-env's environment) over
 * every pair of libraries the app links, on the device and the simulator
 * slices: `lib`'s new build (BUILD_OUTPUTS) against each pinned library, and
 * the pinned libraries against each other. Each report goes into `work`
 * (gate-<slice>-<a>-<b>.txt), and the allowlist built from their DUPLICATE
 * lines into work/duplicate-symbols.txt. Refused unless every pair passes.
 */
function cmdGate([lib, checkout, work, sysroot, ...rest], root) {
  const build = BUILD_OUTPUTS[lib];
  if (!libOrNull(lib) || !build || !build.gate || !checkout || !work || !sysroot || rest.length > 0) {
    return usage();
  }
  const script = path.join(checkout, build.gate);
  const env = cargoEnv(process.env).kept;
  const judged = [];
  const problems = [];
  for (const slice of Object.keys(SLICES)) {
    const peers = peerFiles(root, lib, slice);
    if (peers.problems.length > 0) {
      problems.push(...peers.problems);
      continue;
    }
    for (const pair of linkPairs(lib, path.join(checkout, build.libs[slice]), peers.files)) {
      const before = [shaOrNull(pair.a.abs), shaOrNull(pair.b.abs)];
      let out;
      let failed = null;
      try {
        out = execFileSync('python3', ['-I', script, '--sysroot', sysroot, pair.a.abs, pair.b.abs], {
          encoding: 'utf8',
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          maxBuffer: 64 * 1024 * 1024,
        });
      } catch (e) {
        out = String((e && e.stdout) || '');
        failed = String((e && e.stderr) || (e && e.message) || '').trim();
      }
      // What it judged, byte for byte: `record` binds the list and the
      // "# gated" lines to these digests.
      const after = [shaOrNull(pair.a.abs), shaOrNull(pair.b.abs)];
      if (before.some((d, i) => d === null || d !== after[i])) {
        failed = `${pair.a.abs} or ${pair.b.abs} changed while the gate read it`;
      }
      fs.writeFileSync(gateReport(work, slice, pair), `${out}# judged ${before[0]} ${pair.a.abs}\n# judged ${before[1]} ${pair.b.abs}\n`);
      const r = readGateReport(out, pair);
      if (failed !== null || r.problems.length > 0) {
        problems.push(
          `${slice}, ${pair.key}: the gate refused (${gateReport(work, slice, pair)}): ${[...r.problems, ...(failed ? [failed] : [])].join('; ')}`,
        );
        continue;
      }
      judged.push({ slice, key: pair.key, names: r.duplicates });
    }
  }
  if (problems.length > 0) {
    say(['✗ The symbol-overlap gate did not pass over the libraries the app links:', ...problems.map(block)]);
    return 2;
  }
  fs.writeFileSync(path.join(work, 'duplicate-symbols.txt'), allowlistText(judged));
  say([
    '✓ The symbol-overlap gate passed over every pair of the libraries the app links:',
    ...judged.map((j) => `    ${j.slice} ${j.key}: ${j.names.length === 0 ? 'no duplicate' : `${j.names.length} identical duplicate(s): ${j.names.join(', ')}`}`),
  ]);
  return 0;
}

const AR_MAGIC = '!<arch>\n';
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const MH_MAGIC_64 = 0xfeedfacf;
const CPU_NAMES = { 0x0100000c: 'arm64', 0x01000007: 'x86_64' };
const LC_BUILD_VERSION = 0x32;
const LC_VERSION_MIN = { 0x24: 'macOS', 0x25: 'iOS', 0x2f: 'tvOS', 0x30: 'watchOS' };
const PLATFORMS = { 1: 'macOS', 2: 'iOS', 3: 'tvOS', 4: 'watchOS', 6: 'Mac Catalyst', 7: 'iOS simulator' };

/** The members of a BSD ar archive (the format rustc and Apple's libtool write): [{ name, body }]. */
function arMembers(buf, label) {
  if (buf.length < 8 || buf.toString('latin1', 0, 8) !== AR_MAGIC) {
    throw new Error(`${label}: not an ar archive`);
  }
  const members = [];
  let pos = 8;
  while (pos + 60 <= buf.length) {
    let name = buf.toString('latin1', pos, pos + 16).trim();
    const size = parseInt(buf.toString('latin1', pos + 48, pos + 58).trim(), 10);
    if (!Number.isFinite(size) || size < 0 || pos + 60 + size > buf.length) {
      throw new Error(`${label}: a damaged member header at byte ${pos}`);
    }
    let body = buf.subarray(pos + 60, pos + 60 + size);
    const long = /^#1\/(\d+)$/.exec(name);
    if (long) {
      const n = parseInt(long[1], 10);
      name = body.toString('latin1', 0, n).replace(/\0+$/, '');
      body = body.subarray(n);
    }
    if (!name.startsWith('__.SYMDEF')) {
      members.push({ name, body });
    }
    pos += 60 + size + (size & 1);
  }
  return members;
}

/** { <arch>: ar archive bytes } of a plain or fat (universal) static library. */
function archiveSlices(buf, label) {
  const magic = buf.length >= 8 ? buf.readUInt32BE(0) : 0;
  if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
    const slices = {};
    const n = buf.readUInt32BE(4);
    for (let i = 0; i < n; i++) {
      const at = 8 + (magic === FAT_MAGIC ? 20 : 32) * i;
      const cpu = buf.readUInt32BE(at);
      const offset = magic === FAT_MAGIC ? buf.readUInt32BE(at + 8) : Number(buf.readBigUInt64BE(at + 8));
      const size = magic === FAT_MAGIC ? buf.readUInt32BE(at + 12) : Number(buf.readBigUInt64BE(at + 16));
      slices[CPU_NAMES[cpu] || `cpu 0x${cpu.toString(16)}`] = buf.subarray(offset, offset + size);
    }
    return slices;
  }
  for (const m of arMembers(buf, label)) {
    if (m.body.length >= 8 && m.body.readUInt32LE(0) === MH_MAGIC_64) {
      const cpu = m.body.readUInt32LE(4);
      return { [CPU_NAMES[cpu] || `cpu 0x${cpu.toString(16)}`]: buf };
    }
  }
  throw new Error(`${label}: no 64-bit Mach-O member`);
}

/**
 * The version load commands of a 64-bit Mach-O object: [{ command, platform,
 * minos }] (minos "15.0"), or null when it is not one.
 */
function machoVersions(body) {
  if (body.length < 32 || body.readUInt32LE(0) !== MH_MAGIC_64) {
    return null;
  }
  const ncmds = body.readUInt32LE(16);
  const out = [];
  let off = 32;
  for (let i = 0; i < ncmds && off + 8 <= body.length; i++) {
    const cmd = body.readUInt32LE(off);
    const size = body.readUInt32LE(off + 4);
    const v = (packed) => `${packed >>> 16}.${(packed >>> 8) & 0xff}${packed & 0xff ? `.${packed & 0xff}` : ''}`;
    if (cmd === LC_BUILD_VERSION) {
      const platform = body.readUInt32LE(off + 8);
      out.push({ command: 'LC_BUILD_VERSION', platform: PLATFORMS[platform] || `platform ${platform}`, minos: v(body.readUInt32LE(off + 12)) });
    } else if (Object.prototype.hasOwnProperty.call(LC_VERSION_MIN, cmd)) {
      out.push({ command: 'LC_VERSION_MIN', platform: LC_VERSION_MIN[cmd], minos: v(body.readUInt32LE(off + 8)) });
    }
    if (size < 8) {
      break;
    }
    off += size;
  }
  return out;
}

const RUST_TARGETS = { ios: { arm64: 'aarch64-apple-ios' }, sim: { arm64: 'aarch64-apple-ios-sim', x86_64: 'x86_64-apple-ios' } };
const MIN_IOS = '15.0';
const versionKey = (s) => s.split('.').map((n) => parseInt(n, 10)).concat([0, 0, 0]).slice(0, 3);
const newerThan = (a, b) => {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) {
      return x[i] > y[i];
    }
  }
  return false;
};

/**
 * What the minimum-iOS check says about one slice (decided 2026-09-26):
 * every object compiled by this build (the crates' Rust and C code) is built
 * for iOS 15.0, by LC_BUILD_VERSION, for the slice's platform; the rest must
 * be the Rust toolchain's own prebuilt objects (std, core, compiler_builtins:
 * the Rust project builds them for iOS 10.0, or 14.0 on the arm64
 * simulator), proven byte for byte against the pinned toolchain's sysroot
 * rlibs (`toolchain`, a Set of member digests); and nothing at all may claim
 * a NEWER iOS than 15.0, which is what the linker warns about and what an
 * Xcode update used to stamp on the C code. Returns { ours, toolchain,
 * toolchainMinos, problems }.
 */
function judgeMinos(members, platform, toolchain) {
  const problems = [];
  let ours = 0;
  let fromToolchain = 0;
  const toolchainMinos = new Map();
  for (const m of members) {
    const versions = machoVersions(m.body);
    const own = toolchain.has(crypto.createHash('sha256').update(m.body).digest('hex'));
    if (versions === null) {
      if (!own) {
        problems.push(`${m.name} is not a 64-bit Mach-O object, and not the toolchain's`);
      } else {
        fromToolchain++;
      }
      continue;
    }
    const newer = versions.filter((v) => newerThan(v.minos, MIN_IOS));
    if (newer.length > 0) {
      problems.push(`${m.name} claims ${newer.map((v) => `${v.platform} ${v.minos}`).join(', ')}, newer than iOS ${MIN_IOS}`);
      continue;
    }
    const built15 =
      versions.length === 1 &&
      versions[0].command === 'LC_BUILD_VERSION' &&
      versions[0].platform === platform &&
      versions[0].minos === MIN_IOS;
    if (built15) {
      ours++;
    } else if (own) {
      fromToolchain++;
      const key = versions.map((v) => `${v.platform} ${v.minos}`).join(', ') || 'no version load command';
      toolchainMinos.set(key, (toolchainMinos.get(key) || 0) + 1);
    } else {
      problems.push(
        `${m.name} is built for ${versions.map((v) => `${v.platform} ${v.minos} (${v.command})`).join(', ') || 'no iOS version'}, ` +
          `not ${platform} ${MIN_IOS}, and is not one of the toolchain's own objects`,
      );
    }
  }
  return { ours, toolchain: fromToolchain, toolchainMinos, problems };
}

/** SHA-256 of every member of every rlib the toolchain ships for `target`. */
function toolchainMembers(sysroot, target) {
  const dir = path.join(sysroot, 'lib', 'rustlib', target, 'lib');
  const digests = new Set();
  let rlibs = 0;
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith('.rlib')) {
      continue;
    }
    rlibs++;
    for (const m of arMembers(fs.readFileSync(path.join(dir, entry)), entry)) {
      digests.add(crypto.createHash('sha256').update(m.body).digest('hex'));
    }
  }
  return { digests, rlibs };
}

/**
 * `minos <ios|sim> <library.a> <sysroot>`: the minimum-iOS check of every
 * object in a static library (judgeMinos), slice by slice. The device library
 * must be arm64 only, the simulator one arm64 and x86_64.
 */
function cmdMinos([slice, lib, sysroot, ...rest]) {
  if (!Object.prototype.hasOwnProperty.call(RUST_TARGETS, slice || '') || !lib || !sysroot || rest.length > 0) {
    return usage();
  }
  const platform = slice === 'ios' ? 'iOS' : 'iOS simulator';
  let slices;
  try {
    slices = archiveSlices(fs.readFileSync(lib), lib);
  } catch (e) {
    say([`✗ ${e.message}`]);
    return 2;
  }
  const want = Object.keys(RUST_TARGETS[slice]).sort();
  const problems = [];
  const lines = [];
  if (JSON.stringify(Object.keys(slices).sort()) !== JSON.stringify(want)) {
    problems.push(`${lib} holds ${Object.keys(slices).sort().join(', ')}; a ${slice} library holds ${want.join(', ')}`);
  }
  for (const arch of want.filter((a) => slices[a])) {
    const target = RUST_TARGETS[slice][arch];
    let members;
    let toolchain;
    try {
      members = arMembers(slices[arch], `${lib} (${arch})`);
      toolchain = toolchainMembers(sysroot, target);
    } catch (e) {
      problems.push(e.message);
      continue;
    }
    const r = judgeMinos(members, platform, toolchain.digests);
    problems.push(...r.problems.map((p) => `${arch}: ${p}`));
    lines.push(
      `    ${arch}: ${r.ours} objects built for ${platform} ${MIN_IOS}; ${r.toolchain} the toolchain's own ` +
        `(byte for byte in its ${toolchain.rlibs} ${target} rlibs${
          r.toolchainMinos.size > 0 ? `: ${[...r.toolchainMinos].map(([k, n]) => `${k} x${n}`).join(', ')}` : ''
        })`,
    );
  }
  if (problems.length > 0) {
    say([`✗ ${lib}: not every object is built for iOS ${MIN_IOS}:`, ...problems.slice(0, 40).map(block), ...(problems.length > 40 ? [`    ... and ${problems.length - 40} more`] : [])]);
    return 2;
  }
  say([`✓ ${path.basename(lib)}: every object built here is for ${platform} ${MIN_IOS}, none newer:`, ...lines]);
  return 0;
}

/**
 * `vendored <cargo-metadata.json> <crate dir> <package>...`: each package
 * resolves to exactly one copy, the crate's own vendor/<package> (a path
 * dependency, never a registry one), so the patches it carries are the ones
 * built (electrum-client's TLS patch, bdk_wallet's check_older).
 */
function cmdVendored([metadata, crate, ...names]) {
  if (!metadata || !crate || names.length === 0) {
    return usage();
  }
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metadata, 'utf8'));
  } catch (e) {
    say([`✗ ${metadata} is not cargo metadata: ${e.message}`]);
    return 2;
  }
  const real = (f) => {
    try {
      return fs.realpathSync(f);
    } catch {
      return null;
    }
  };
  const used = new Set(((meta.resolve && meta.resolve.nodes) || []).map((n) => n.id));
  const problems = [];
  const lines = [];
  for (const name of names) {
    const copies = (meta.packages || []).filter((p) => p.name === name);
    const want = real(path.join(crate, 'vendor', name, 'Cargo.toml'));
    if (copies.length !== 1) {
      problems.push(`${name}: ${copies.length} copies in the build (${copies.map((c) => c.id).join(', ') || 'none'}), not one`);
      continue;
    }
    const [c] = copies;
    if (c.source !== null || want === null || real(c.manifest_path) !== want) {
      problems.push(`${name} ${c.version} comes from ${c.source || c.manifest_path}, not ${path.join(crate, 'vendor', name)}`);
    } else if (!used.has(c.id)) {
      problems.push(`${name} ${c.version} is vendored but nothing in the build uses it`);
    } else {
      lines.push(`    ${name} ${c.version}: ${path.relative(crate, path.dirname(want))}`);
    }
  }
  if (problems.length > 0) {
    say(['✗ A patched crate does not resolve to its vendored copy:', ...problems.map(block)]);
    return 2;
  }
  say(['✓ The patched crates resolve to their vendored copies:', ...lines]);
  return 0;
}

/**
 * The allowlist of duplicate symbols for `slice` (ios|sim): every library's
 * `duplicates` file, whose lines read "<ios|sim> <library> <library> <symbol>"
 * (the pair in NATIVE_SOURCES order; "#" starts a comment). Returns
 * { allowed: Map<symbol, Set<"<library> <library>">>, files, problems }: a
 * name is allowed only between the two libraries the gate proved it identical
 * for (decided 2026-10-17).
 */
function duplicateAllowlist(root, slice) {
  const allowed = new Map();
  const files = [];
  const problems = [];
  const isLib = (l) => Object.prototype.hasOwnProperty.call(NATIVE_SOURCES, l);
  const { isRetiredLib } = prov;
  for (const [lib, src] of Object.entries(NATIVE_SOURCES)) {
    if (!src.duplicates) {
      continue;
    }
    let text;
    try {
      text = fs.readFileSync(path.join(root, src.duplicates), 'utf8');
    } catch {
      problems.push(`${src.duplicates} (${lib}) is missing`);
      continue;
    }
    files.push(src.duplicates);
    text.split('\n').forEach((raw, i) => {
      const line = raw.replace(/#.*$/, '').trim();
      if (line === '') {
        return;
      }
      const m = /^(ios|sim) ([a-z0-9-]+) ([a-z0-9-]+) (_[A-Za-z0-9_$.]+)$/.exec(line);
      // A pair with a library the app no longer links (archive-provenance.js
      // RETIRED_NATIVE_LIBS, decided 2026-11-04): the linker can never report
      // it, so it is set aside, never allowed.
      const pair = m ? [m[2], m[3]] : [];
      if (m && m[2] !== m[3] && pair.some(isRetiredLib) && pair.every((l) => isLib(l) || isRetiredLib(l))) {
        return;
      }
      if (!m || !isLib(m[2]) || !isLib(m[3]) || m[2] === m[3] || pairKey(m[2], m[3]) !== `${m[2]} ${m[3]}`) {
        problems.push(
          `${src.duplicates} line ${i + 1} is not "<ios|sim> <library> <library> <symbol>" ` +
            `(two of ${Object.keys(NATIVE_SOURCES).join(', ')}, in that order): ${JSON.stringify(raw)}`,
        );
      } else if (m[1] === slice) {
        if (!allowed.has(m[4])) {
          allowed.set(m[4], new Set());
        }
        allowed.get(m[4]).add(`${m[2]} ${m[3]}`);
      }
    });
  }
  return { allowed, files, problems };
}

/**
 * An object as ld names it in a duplicate-symbol warning: an archive member,
 * "<absolute path>.a", any number of bracket groups (ld-27037.1 prints a
 * thin archive's member as `lib.a[297](x.o)` and a fat one's as
 * `lib.a[arm64][47](x.o)`, and the simulator libraries are fat), then the
 * member's name in parentheses; or a plain object file, an absolute path
 * ending in ".o".
 */
const ARCHIVE_MEMBER = /^(\/.*?\.a)((?:\[[^\]\n]*\])*)\(([^()\n]+)\)$/;
const OBJECT_FILE = /^\/\S*\.o$/;
const isObjectRef = (line) => /^\s+\S/.test(line) && (ARCHIVE_MEMBER.test(line.trim()) || OBJECT_FILE.test(line.trim()));
// ld's own words ("ld: warning: duplicate symbol '_x' in:"), which xcodebuild
// prints after the project and the target ("<path>.xcodeproj: KeelWallet: ld: ...").
const DUPLICATE_HEADER = /^(?:.*: )?(?:ld(?:64)?: )?warning: duplicate symbol '([^']+)' in:\s*$/;

/** The archive (its file name) an object line of a duplicate-symbol warning names, or null. */
function archiveOf(objectLine) {
  const m = ARCHIVE_MEMBER.exec(String(objectLine).trim());
  return m ? path.basename(m[1]) : null;
}

/**
 * The linker's duplicate-symbol warnings in an xcodebuild log: { found:
 * [{ name, objects }], unnamed: [[object, ...]], stray }. Xcode 27's ld does
 * not fail on a duplicate symbol: it warns ("ld: warning: duplicate symbol
 * '<name>' in:", then one indented line per object) and keeps the first copy
 * it loaded.
 *
 * Xcode passes `-no_warn_duplicate_libraries` unless LD_WARN_DUPLICATE_LIBRARIES
 * is YES, and with it ld-27037.1 still prints a duplicate's object lines but
 * NOT the line naming the symbol (decided 2026-10-17: the Release and Debug
 * simulator links of 2026-10-16 printed eight and eighteen such lines, and the
 * check read them as no duplicate at all). So the check fails closed: every
 * run of indented object lines that no warning line heads is `unnamed`, and
 * `stray` counts any other line that mentions a duplicate symbol, so a format
 * this does not know is never read as "no duplicates".
 */
function duplicateWarnings(log) {
  const lines = String(log).split('\n');
  const found = [];
  const unnamed = [];
  let stray = 0;
  const objectsFrom = (i) => {
    const objects = [];
    while (i + 1 < lines.length && isObjectRef(lines[i + 1])) {
      objects.push(lines[++i].trim());
    }
    return { objects, i };
  };
  for (let i = 0; i < lines.length; i++) {
    const m = DUPLICATE_HEADER.exec(lines[i].trim());
    if (m) {
      const r = objectsFrom(i);
      found.push({ name: m[1], objects: r.objects });
      i = r.i;
    } else if (isObjectRef(lines[i])) {
      const r = objectsFrom(i - 1);
      unnamed.push(r.objects);
      i = r.i;
    } else if (/duplicate symbol/i.test(lines[i])) {
      stray++;
    }
  }
  return { found, unnamed, stray };
}

/**
 * The links of the app in an xcodebuild log ("Ld <path>/KeelWallet.app/<file>
 * normal"), each with whether its command hides the line naming a duplicate
 * symbol: the LAST of -warn_duplicate_libraries / -no_warn_duplicate_libraries
 * on it is the "no" one (ld takes the last; with neither, ld names it).
 */
function appLinks(log) {
  const lines = String(log).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^Ld (.*\/KeelWallet\.app\/[^/]+) normal\b/.exec(lines[i]);
    if (!m) {
      continue;
    }
    let command = '';
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) {
      command += ` ${lines[j]}`;
    }
    const flags = [...command.matchAll(/(?:^|\s)-(no_)?warn_duplicate_libraries(?=\s|$)/g)];
    out.push({ target: m[1], hidesNames: flags.length > 0 && flags[flags.length - 1][1] === 'no_' });
  }
  return out;
}

/**
 * `link-check <iphoneos|iphonesimulator> <xcodebuild log>`: refuses a link
 * that reported a duplicate symbol outside the exact allowlist (decided
 * 2026-10-16). With two Rust libraries beside the BitBox one, ld
 * keeps the first-loaded copy of a symbol two of them define and only warns,
 * so one library could run the other's code; the allowlisted names are the
 * ones the symbol-overlap gate proved identical (native/build-bdkwallet.sh
 * writes them), and each must come from our own native libraries. It also
 * refuses a log in which the app was not linked at all, so a build that
 * skipped the link never passes for one that was checked, and fails closed on
 * what ld prints when Xcode's -no_warn_duplicate_libraries is in force: the
 * objects of each duplicate with no line naming it (decided 2026-10-17), read
 * as unnamed duplicates, never as none.
 */
function cmdLinkCheck([sdk, logFile, ...rest], root) {
  const slice = Object.keys(SLICES).find((k) => SLICES[k].sdk === sdk);
  if (!slice || !logFile || rest.length > 0) {
    return usage();
  }
  let log;
  try {
    log = fs.readFileSync(logFile, 'utf8');
  } catch {
    say([`✗ No xcodebuild log at ${logFile}.`]);
    return 2;
  }
  const problems = [];
  if (!/^Ld .*KeelWallet\.app\/KeelWallet normal/m.test(log)) {
    problems.push(`${logFile} shows no link of KeelWallet.app/KeelWallet, so nothing was checked`);
  }
  for (const l of appLinks(log).filter((x) => x.hidesNames)) {
    problems.push(
      `the link of ${path.basename(l.target)} ends on -no_warn_duplicate_libraries, so ld leaves out the line ` +
        'naming each duplicate symbol: build with LD_WARN_DUPLICATE_LIBRARIES=YES',
    );
  }
  const allow = duplicateAllowlist(root, slice);
  problems.push(...allow.problems);
  // Each library's device file name; a simulator build links the -sim.a copies under these names.
  const libOfArchive = new Map(Object.keys(NATIVE_SOURCES).map((lib) => [path.basename(linkedLibOf(lib)), lib]));
  const { found, unnamed, stray } = duplicateWarnings(log);
  for (const objects of unnamed) {
    problems.push(`ld printed the objects of a duplicate symbol with no line naming the symbol:\n${objects.join('\n')}`);
  }
  if (stray > 0) {
    problems.push(`${stray} line(s) mention a duplicate symbol in a form this check does not read`);
  }
  const reported = new Map(); // name -> the pairs it was reported between
  for (const f of found) {
    const libs = f.objects.map((o) => libOfArchive.get(archiveOf(o)) || null);
    if (f.objects.length < 2 || libs.some((l) => l === null)) {
      problems.push(`duplicate symbol ${f.name} comes from ${f.objects.join(' and ') || 'unnamed objects'}, not from two of our native libraries`);
      continue;
    }
    const distinct = [...new Set(libs)].sort(libOrder);
    if (distinct.length < libs.length) {
      problems.push(`duplicate symbol ${f.name} is defined twice inside ${libs.filter((l, i) => libs.indexOf(l) !== i).join(', ')}`);
    }
    const listed = allow.allowed.get(f.name) || new Set();
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        reported.set(f.name, new Set([...(reported.get(f.name) || []), pairKey(distinct[i], distinct[j])]));
        if (!listed.has(pairKey(distinct[i], distinct[j]))) {
          problems.push(
            `duplicate symbol ${f.name} between ${distinct[i]} and ${distinct[j]} is not on the allowlist for ${slice} ` +
              `(${allow.files.join(', ') || 'none'})`,
          );
        }
      }
    }
  }
  if (problems.length > 0) {
    say([
      '✗ The app links code twice under one name, or the link cannot be checked:',
      ...problems.map(block),
      '  ld keeps the first copy it loads and only warns, so the app would run one',
      "  library's code for another. Only the symbols the overlap gate proved identical",
      '  may appear (native/build-bdkwallet.sh writes them); rebuild, or report this.',
    ]);
    return 2;
  }
  const names = [...reported.keys()].sort();
  say([
    names.length === 0
      ? `✓ The ${sdk} link reported no duplicate symbol.`
      : `✓ The ${sdk} link reported ${names.length} duplicate symbol(s), each on the allowlist for its pair of libraries (identical code, proven by the overlap gate):`,
    ...names.map((n) => `    ${n} (${[...reported.get(n)].join('; ')})`),
  ]);
  return 0;
}

/**
 * The libraries a phone test build may use before they are pinned: each
 * library whose recorded build ("# built" lines) wrote exactly the files the
 * build script copies, which are on disk now exactly as that build wrote
 * them, while its pins still name other files. Returns the record's text
 * with those pinned IN MEMORY (as `pin` would), and the libraries.
 */
function withRecordedBuildsPinned(text, root) {
  const testing = [];
  let next = text;
  for (const s of prov.parseNativeSources(text).sources) {
    const files = NATIVE_SOURCES[s.lib].files;
    const wroteAll = s.built.length === files.length && files.every((f) => s.built.some((b) => b.path === f));
    const onDisk = s.built.every((b) => shaOrNull(path.join(root, b.path)) === b.sha256);
    const pins = pinsOf(text, s.lib);
    const pinned = s.built.every((b) => pins.some((p) => p.path === b.path && p.pinned === b.sha256));
    if (wroteAll && onDisk && !pinned) {
      next = withPins(next, s.lib, Object.fromEntries(s.built.map((b) => [b.path, b.sha256])));
      testing.push(s);
    }
  }
  return { text: next, testing };
}

/**
 * One line per library whose record names another Xcode than the one here
 * (`installed`, { version, build } or null): a rebuild here would compile its
 * C code with another clang against another SDK, so it would not give the
 * pinned bytes. A warning only: the pinned files are what they
 * are, whichever Xcode builds the app.
 */
function xcodeWarnings(sources, installed) {
  const out = [];
  for (const s of sources) {
    if (!s.xcode) {
      continue;
    }
    if (installed === null) {
      out.push(`  ⚠ ${s.lib} was built with Xcode ${s.xcode.version} (${s.xcode.build}); no Xcode answered here.`);
    } else if (installed.version !== s.xcode.version || installed.build !== s.xcode.build) {
      out.push(
        `  ⚠ ${s.lib} was built with Xcode ${s.xcode.version} (${s.xcode.build}); this Mac has ` +
          `${installed.version} (${installed.build}).`,
        '    A rebuild here would not reproduce the pinned files (its C code would be compiled',
        '    by another clang against another SDK). The pinned files themselves are fine.',
      );
    }
  }
  return out;
}

function cmdVerify(args, root, deps) {
  const testBuild = args.includes('--test-build');
  if (args.some((a) => a !== '--test-build')) {
    return usage();
  }
  const recorded = testBuild ? withRecordedBuildsPinned(readRecord(root), root) : { testing: [] };
  const state = recorded.testing.length > 0 ? prov.readNativeState(root, recorded.text) : prov.readNativeState(root);
  const problems = [
    ...state.problems,
    ...state.strays,
    ...state.sourceProblems,
    ...(state.bdkLinked.sha256 === null ? [`${state.bdkLinked.path} is missing`] : []),
    ...state.podLinks.flatMap((l) => l.problems),
    // What the archive refuses; a phone or simulator test build may still try it.
    ...(testBuild ? [] : state.toolCrates),
  ];
  if (problems.length > 0) {
    const missing = state.libs.filter((l) => l.sha256 === null);
    // Pinned files that hold uniffi's bindings tool are the pinned ones: putting them back changes nothing.
    const tools = testBuild ? [] : state.toolCrates;
    const onlyTools = tools.length > 0 && problems.length === tools.length;
    say([
      onlyTools
        ? `✗ A native library pinned in ${NATIVE_PIN} holds uniffi's bindings tool, so nothing is built:`
        : `✗ The native libraries are not the ones pinned in ${NATIVE_PIN}, so nothing is built:`,
      ...problems.map(block),
      '',
      ...(tools.length > 0
        ? [
            '  A library that holds the bindings tool is rebuilt from a fork commit that gives',
            '  uniffi\'s "cli" feature to the uniffi-bindgen binary alone ([[bin]]',
            '  required-features), tested, and pinned with node scripts/native-sources.js pin <lib>.',
          ]
        : []),
      ...(onlyTools
        ? []
        : missing.length > 0
        ? [
            '  A missing library: build it with its script, which records what it wrote',
            `  (${Object.values(NATIVE_SOURCES)
              .map((src) => src.build)
              .join(', ')}),`,
            '  or copy the pinned files from a checkout that has them; this check',
            '  then proves they are the pinned ones.',
          ]
        : [
            '  A library that differs from its pin was built from nothing the record',
            '  names. Put back the pinned files, or rebuild and pin them with',
            '  node scripts/native-sources.js pin <lib>.',
          ]),
      ...(state.strays.length > 0
        ? [
            '  A lib folder may hold only the pinned libraries (the linker searches it):',
            '  delete anything else there, and copy only the pinned files from another checkout.',
          ]
        : []),
      ...(testBuild
        ? [
            '  (A phone test build takes a library that is not pinned yet only when its',
            '  files are exactly the ones its recorded build wrote.)',
          ]
        : []),
    ]);
    return 2;
  }
  const testing = new Set(recorded.testing.flatMap((s) => s.built.map((b) => b.path)));
  say([
    testing.size === 0
      ? `✓ Every native library is the one pinned in ${NATIVE_PIN}:`
      : `✓ Every native library is the one pinned in ${NATIVE_PIN}, or the recorded build being tested:`,
    ...state.libs.map((l) => `    ${l.sha256}  ${l.path}${testing.has(l.path) ? '  (recorded build, NOT PINNED)' : ''}`),
    ...state.generated.map((g) => `    ${g.sha256}  ${g.path}  (as ${g.lib}'s recorded build wrote it)`),
    ...state.podLinks.map((l) => `  ${l.podspec} links ${l.path} in place.`),
    ...xcodeWarnings(state.sources, deps.xcode()),
    ...state.toolCrates.map((t) => `  ⚠ ${t} (an archive refuses it, and pin)`),
    ...recorded.testing.flatMap((s) => [
      `  ▸ ${s.lib}: this build tests the libraries built from ${s.commit}, not pinned yet.`,
      '    Once the phone test passes, pin them and commit the record and the pins together:',
      `      node scripts/native-sources.js pin ${s.lib}`,
      '    An archive refuses them until then.',
    ]),
  ]);
  return 0;
}

// ---------------------------------------------------------------- release-file copies

/**
 * Where the byte-identical copies of the pinned libraries live (decided
 * 2026-10-22): release files of the PRIVATE fork repo, in
 * releases whose tag starts with `tagPrefix` (one release per pinning day,
 * e.g. talia-native-libs-2026-10-22), each file named copyName(sha, file).
 * Never a public repo. Release files are never edited or deleted: a new pin
 * gets a release of its own, and its tag is added to `tags` in the commit
 * that pins it. The libraries are BUILT from the public repos since
 * 2026-11-06 (NATIVE_SOURCES), but the copies stay on the private fork, named
 * here on their own: `restore` and `copies` are for maintainers with access
 * to it, and a public clone builds the libraries from the public repos
 * instead.
 *
 * `tags` names every such release, and each is read BY ITS TAG (decided
 * 2026-10-22): GitHub's release LIST came back empty on most calls for half
 * an hour after the first release was made, while the lookup by tag answered
 * every time, so a listing made `copies` and `restore` answer differently
 * from one run to the next.
 */
const COPIES = {
  // The private bdk-ffi fork, which holds every pinned library's copies
  // (bitboxffi's too); never NATIVE_SOURCES' public repo.
  repo: 'https://github.com/21st-Capital/bdk-ffi-fork',
  tagPrefix: 'talia-native-libs-',
  tags: ['talia-native-libs-2026-10-22', 'talia-native-libs-2026-10-27', 'talia-native-libs-2026-11-06', 'talia-native-libs-2026-11-07'],
};
const COPY_NAME = /^[0-9a-f]{64}-[A-Za-z0-9._-]+$/;
const COPY_TAG = /^talia-native-libs-[0-9A-Za-z._-]+$/;
const GH_TIMEOUT_MS = 30 * 60 * 1000;
/** A release that cannot be read, or reads as holding no file, is asked this many times in all. */
const READ_TRIES = 3;
const READ_PAUSE_MS = 3000;

/** Waits `ms` (between two reads of a release). */
function pauseFor(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** A pinned file's release-file name: its SHA-256, a dash, its name in the lib folder. */
const copyName = (sha256, file) => `${sha256}-${path.basename(file)}`;

/** "owner/repo" of a https://github.com/owner/repo URL. */
const ghRepo = (url) => repoKey(url).replace(/^github\.com\//, '');

/**
 * The files of the published (not draft) release tagged `tag` on
 * COPIES.repo, looked up by that tag through the user's own `gh` sign-in (no
 * token is read or written here): [{ tag, name, size, digest }], `digest`
 * being GitHub's own "sha256:<hex>" of the stored file (null where GitHub
 * gives none).
 */
function ghReleaseCopies(tag) {
  if (!COPY_TAG.test(tag) || !COPIES.tags.includes(tag)) {
    throw new Error(`not a release restore reads: ${tag}`);
  }
  const out = execFileSync(
    'gh',
    [
      'api',
      `repos/${ghRepo(COPIES.repo)}/releases/tags/${tag}`,
      '--jq',
      'select(.draft | not) | .tag_name as $t | .assets[] | [$t, .name, (.size | tostring), (.digest // "")] | @tsv',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: FETCH_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
  );
  return out
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const [t, name, size, digest] = l.split('\t');
      return { tag: t, name, size: Number(size), digest: digest || null };
    })
    .filter((c) => c.tag === tag);
}

/** Downloads one release file into `dir` (a fresh temp folder) with `gh`; returns its path. */
function ghFetchCopy(copy, dir) {
  if (!COPY_NAME.test(copy.name) || !COPIES.tags.includes(copy.tag)) {
    throw new Error(`not a release file restore fetches: ${copy.tag}/${copy.name}`);
  }
  execFileSync(
    'gh',
    ['release', 'download', copy.tag, '--repo', ghRepo(COPIES.repo), '--pattern', copy.name, '--dir', dir],
    { stdio: ['ignore', 'ignore', 'pipe'], timeout: GH_TIMEOUT_MS },
  );
  return path.join(dir, copy.name);
}

/**
 * What stands at `rel` under `root`: 'none', 'file' (a plain file), or what
 * else it is. Never follows a symlink.
 */
function entryKind(root, rel) {
  try {
    const st = fs.lstatSync(path.join(root, rel));
    if (st.isSymbolicLink()) {
      return 'a symlink';
    }
    return st.isFile() ? 'file' : st.isDirectory() ? 'a folder' : 'not a plain file';
  } catch {
    return 'none';
  }
}

/**
 * Why the lib folder `libDir` cannot take a restored file: one of its folders
 * (from the checkout down) is a symlink or not a folder. A folder still
 * missing is fine: restore makes it. null when it can.
 */
function libDirProblem(root, libDir) {
  const parts = libDir.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const rel = parts.slice(0, i).join('/');
    const kind = entryKind(root, rel);
    if (kind === 'none') {
      return null;
    }
    if (kind !== 'a folder') {
      return `${rel} is ${kind === 'file' ? 'a file' : kind}, not a folder (verify and the archive refuse a lib folder that is not a real folder)`;
    }
  }
  return null;
}

/**
 * What `restore` would do for `lib` in `root`, decided before anything is
 * fetched: { files: [{ path, sha256, state: 'there' | 'missing' }], problems }.
 * Only a library whose record and pins agree is restored (its pins are the
 * files its recorded build wrote, one per file the build writes), and only
 * into its own lib folder: a pinned file already there is kept, a file that
 * is NOT the pinned one is refused (restore never replaces it; move it away
 * first), and so is anything there that is not a plain file.
 */
function restorePlan(text, root, lib) {
  const src = NATIVE_SOURCES[lib];
  const problems = [];
  const own = prov.parseNativeSources(text).sources.find((s) => s.lib === lib);
  const pins = pinsOf(text, lib);
  if (pins.length === 0) {
    return { files: [], problems: [`${NATIVE_PIN} pins nothing of ${lib}, so there is nothing to restore`] };
  }
  for (const file of src.files) {
    const pin = pins.filter((p) => p.path === file);
    const built = own ? own.built.find((b) => b.path === file) : undefined;
    if (pin.length !== 1) {
      problems.push(`${file} has ${pin.length === 0 ? 'no pin' : `${pin.length} pins`} in ${NATIVE_PIN}`);
    } else if (!built || built.sha256 !== pin[0].pinned) {
      problems.push(`${file}'s pin is not the file ${lib}'s recorded build wrote (${NATIVE_PIN} would be refused)`);
    }
  }
  for (const p of pins) {
    if (!src.files.includes(p.path)) {
      problems.push(`${NATIVE_PIN} pins ${p.path}, which is not a file ${lib}'s build writes`);
    }
  }
  const dir = libDirProblem(root, src.libDir);
  if (dir) {
    problems.push(dir);
  }
  if (problems.length > 0) {
    return { files: [], problems };
  }
  const files = pins.map((p) => {
    const kind = entryKind(root, p.path);
    if (kind === 'none') {
      return { path: p.path, sha256: p.pinned, state: 'missing' };
    }
    if (kind !== 'file') {
      problems.push(`${p.path} is ${kind}, not a plain file; restore replaces nothing, so move it away first`);
      return null;
    }
    const now = shaOrNull(path.join(root, p.path));
    if (now !== p.pinned) {
      problems.push(`${p.path} is ${now || 'unreadable'}, pinned ${p.pinned}; restore replaces nothing, so move it away first`);
      return null;
    }
    return { path: p.path, sha256: p.pinned, state: 'there' };
  });
  return { files: files.filter(Boolean), problems };
}

const RESTORE_USAGE = `restore <${Object.keys(NATIVE_SOURCES).join('|')}|all>...`;

/** The libraries `restore`/`copies` were asked for ("all" = every library), or null. */
function askedLibs(asked) {
  if (asked.length === 0) {
    return null;
  }
  const libs = asked.includes('all') ? Object.keys(NATIVE_SOURCES) : asked;
  if (libs.some((lib) => !libOrNull(lib))) {
    return null;
  }
  return [...new Set(libs)];
}

/**
 * The files of every release in COPIES.tags, each read by its tag:
 * { copies: [{ tag, name, size }], unread: [{ tag, why }] }. A release that
 * cannot be read, or reads as holding no file, is asked again (READ_TRIES
 * in all, READ_PAUSE_MS apart) and then named in `unread`: a release that
 * did not answer is never taken for one that holds no copy.
 * `deps.copies.release(tag)` reads one (ghReleaseCopies); the tests stand in
 * for it, and for `deps.copies.pause`.
 */
function readCopies(deps) {
  const pause = deps.copies.pause || pauseFor;
  const copies = [];
  const unread = [];
  for (const tag of COPIES.tags) {
    let got = null;
    let why = 'it was not read';
    for (let i = 0; i < READ_TRIES && got === null; i++) {
      if (i > 0) {
        pause(READ_PAUSE_MS);
      }
      try {
        const files = deps.copies.release(tag).filter((c) => c.tag === tag);
        if (files.length > 0) {
          got = files;
        } else {
          why = 'it listed no files';
        }
      } catch (e) {
        why = String(e.message || e);
      }
    }
    if (got) {
      copies.push(...got);
    } else {
      unread.push({ tag, why });
    }
  }
  return { copies, unread };
}

/** "<tag> could not be read (<why>)" for each release that did not answer. */
const unreadLines = (unread) =>
  unread.map((u) => `release ${u.tag} of ${COPIES.repo} could not be read after ${READ_TRIES} tries (${u.why})`);

/** GitHub's digest of a release file as it would read for the pinned bytes. */
const pinnedDigest = (sha256) => `sha256:${sha256}`;

/**
 * Each wanted file's release files: { found, absent }. A file is found when
 * a release that answered holds a copy under its name whose GitHub digest is
 * the pin (`proven`), or gives no digest; a copy whose digest is another
 * file's (a rebuilt library uploaded under an old name, a damaged upload) is
 * never one of its copies, and the files with only such copies are in
 * `absent` with them as `wrong`. `copies` lists the usable ones in order:
 * proven first, every release in turn, so restore falls through to the next
 * when a download is not the pin. A file in `absent` is proven missing only
 * when every release in COPIES.tags answered (`read.unread` is empty).
 */
function findCopies(want, read) {
  const found = [];
  const absent = [];
  for (const f of want) {
    const name = copyName(f.sha256, f.path);
    const named = read.copies.filter((c) => c.name === name);
    const proven = named.filter((c) => c.digest === pinnedDigest(f.sha256));
    const undigested = named.filter((c) => !c.digest);
    const wrong = named.filter((c) => c.digest && c.digest !== pinnedDigest(f.sha256));
    const copies = [...proven, ...undigested];
    if (copies.length > 0) {
      found.push({ ...f, name, copies, copy: copies[0], proven: proven.length > 0, wrong });
    } else {
      absent.push({ ...f, name, wrong });
    }
  }
  return { found, absent };
}

/** "<tag>/<name> holds sha256:..., not the pin" for each copy whose GitHub digest is another file's. */
const wrongLines = (f) =>
  f.wrong.map((c) => `${c.tag}/${c.name} holds ${c.digest} by GitHub's digest, not the pinned ${f.sha256} (${f.path})`);

/** Why the files in `absent` have no copy: a release did not answer, or none holds them. */
function absentLines(absent, read) {
  if (read.unread.length > 0) {
    return [
      ...unreadLines(read.unread),
      ...absent.flatMap((f) => [...wrongLines(f), `so the copy of ${f.path} (${f.name}) is not known; run it again`]),
    ];
  }
  return absent.flatMap((f) =>
    f.wrong.length > 0
      ? wrongLines(f)
      : [`no release in COPIES.tags (${COPIES.tags.join(', ')}) of ${COPIES.repo} holds ${f.name} (${f.path})`],
  );
}

/**
 * restore <lib>... | all (also the way back after a rollback): puts
 * back each pinned file of the named libraries that is missing, from the
 * release files on COPIES.repo, by the digests the pins name. A copy whose
 * GitHub digest is another file's is never fetched; the others are tried in
 * turn (GitHub's digest the pin first) until one downloads as the pin.
 * Nothing is written unless EVERY file asked for has a download with exactly
 * its pinned SHA-256 (each is fetched into a private temp folder and hashed
 * there); then
 * each is copied into its library's own lib folder as a plain file, never
 * over an existing one, and hashed again. A file already there as pinned is
 * kept; one that differs is refused, never replaced. It ends with `verify`
 * and returns its answer. `deps.copies` = { release(tag), fetch(copy, dir) }
 * lets the tests stand in for GitHub.
 */
function cmdRestore(asked, root, deps) {
  const libs = askedLibs(asked);
  if (!libs) {
    say([`usage: native-sources.js ${RESTORE_USAGE}`]);
    return 64;
  }
  const text = readRecord(root);
  const plans = libs.map((lib) => ({ lib, ...restorePlan(text, root, lib) }));
  const problems = plans.flatMap((p) => p.problems.map((x) => `${p.lib}: ${x}`));
  if (problems.length > 0) {
    say(['✗ Nothing is restored:', ...problems.map(block)]);
    return 2;
  }
  const missing = plans.flatMap((p) => p.files.filter((f) => f.state === 'missing').map((f) => ({ ...f, lib: p.lib })));
  for (const p of plans) {
    for (const f of p.files.filter((x) => x.state === 'there')) {
      say([`  ${f.path} is already the pinned file; kept.`]);
    }
  }
  if (missing.length > 0) {
    const read = readCopies(deps);
    const { found, absent } = findCopies(missing, read);
    if (absent.length > 0) {
      say([
        '✗ Nothing is restored:',
        ...absentLines(absent, read).map(block),
        ...(read.unread.length > 0
          ? ['  (restore reads them through gh: is it installed and signed in to an account that can read that private repo?)']
          : []),
      ]);
      return 2;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'talia-restore-'));
    try {
      const fetched = [];
      for (const f of found) {
        // Each usable copy in turn (proven by GitHub's digest first) until one
        // downloads as exactly the pinned file.
        let file = null;
        for (const copy of f.copies) {
          say([`  fetching ${copy.name} from ${COPIES.repo} (${copy.tag}) ...`]);
          const into = fs.mkdtempSync(path.join(tmp, 'f-'));
          let got = null;
          try {
            const at = deps.copies.fetch(copy, into);
            got = entryKind(into, path.basename(at)) === 'file' && path.dirname(at) === into ? shaOrNull(at) : null;
            if (got === f.sha256) {
              file = at;
              break;
            }
          } catch (e) {
            say([`  ${copy.tag}/${copy.name} could not be downloaded:`, block(String(e.message || e))]);
            continue;
          }
          say([`  the download of ${copy.tag}/${copy.name} is ${got || 'not a readable plain file'}, not the pinned ${f.sha256}; not used.`]);
        }
        if (file === null) {
          say([`✗ No copy of ${f.path} (${f.name}) downloaded as the pinned ${f.sha256}, so nothing is restored.`]);
          return 2;
        }
        fetched.push({ ...f, file });
      }
      // Every download is the pinned file: only now is anything written.
      for (const f of fetched) {
        const dest = path.join(root, f.path);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const dir = libDirProblem(root, NATIVE_SOURCES[f.lib].libDir);
        if (dir) {
          say([`✗ ${dir}; ${f.path} is not restored.`]);
          return 2;
        }
        fs.copyFileSync(f.file, dest, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(dest, 0o644);
        if (entryKind(root, f.path) !== 'file' || shaOrNull(dest) !== f.sha256) {
          fs.rmSync(dest, { force: true });
          say([`✗ ${f.path} did not land as the pinned file, so it was taken out again.`]);
          return 2;
        }
        say([`✓ ${f.path} restored (${f.sha256}).`]);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } else {
    say(['  Every file asked for is already the pinned one; nothing fetched.']);
  }
  return cmdVerify([], root, deps);
}

/**
 * copies <lib>... | all: read only. Says, for each pinned file, which release
 * file on COPIES.repo holds its copy, GitHub's own digest of it being the
 * pin, and refuses (2) when one has none, or only copies whose digest is
 * another file's or missing, or a release in COPIES.tags could not be read
 * (that is never reported as a missing copy): run it after uploading the
 * copies of a new pin and adding the release's tag to COPIES.tags.
 */
function cmdCopies(asked, root, deps) {
  const libs = askedLibs(asked.length === 0 ? ['all'] : asked);
  if (!libs) {
    say([`usage: native-sources.js copies [<${Object.keys(NATIVE_SOURCES).join('|')}|all>...]`]);
    return 64;
  }
  const text = readRecord(root);
  const want = libs.flatMap((lib) => pinsOf(text, lib).map((p) => ({ path: p.path, sha256: p.pinned })));
  const read = readCopies(deps);
  const { found, absent } = findCopies(want, read);
  // A copy counts here only when GitHub's own digest of it is the pin, so a
  // file uploaded under a pinned name with other bytes fails now, not at the
  // rollback that needs it.
  const proven = found.filter((f) => f.proven);
  const unproven = found.filter((f) => !f.proven);
  say([
    ...proven.flatMap((f) => [
      `✓ ${f.path}: ${f.copy.tag}/${f.copy.name} (GitHub's digest is the pin)`,
      ...wrongLines(f).map((w) => `  note: ${w}; restore never fetches it`),
    ]),
    ...unproven.flatMap((f) => [
      ...wrongLines(f),
      ...f.copies.map((c) => `${c.tag}/${c.name}: GitHub gives no digest, so its bytes are not proven (restore still hashes them)`),
    ]).map((p) => `✗ ${p}`),
    ...(absent.length > 0 ? absentLines(absent, read) : unreadLines(read.unread)).map((p) => `✗ ${p}`),
    // Upload advice only when every release answered and a proven copy is really absent.
    ...(absent.length + unproven.length > 0 && read.unread.length === 0
      ? [
          `  Upload each missing file, named <sha256>-<file name>, to a new ${COPIES.tagPrefix}<date> release there,`,
          '  and add its tag to COPIES.tags in scripts/native-sources.js.',
        ]
      : []),
  ]);
  return absent.length > 0 || unproven.length > 0 || read.unread.length > 0 ? 2 : 0;
}

/**
 * `deps` lets the tests answer for this Mac: `xcode()` is the Xcode a build
 * here compiles C code with (installedXcode), `developer()` its Developer
 * folder (selectedDeveloperDir, for cargo-env's path maps), and `copies` reads the release
 * files (ghReleaseCopies, ghFetchCopy).
 */
function main(argv, root = path.resolve(__dirname, '..'), deps = {}) {
  const d = {
    xcode: installedXcode,
    developer: selectedDeveloperDir,
    checkout: builtCheckout,
    copies: { release: ghReleaseCopies, fetch: ghFetchCopy },
    ...deps,
  };
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'check':
      return cmdCheck(rest, root);
    case 'cargo-env':
      return cmdCargoEnv(rest, d.developer);
    case 'recheck':
      return cmdRecheck(rest);
    case 'record':
      return cmdRecord(rest, root, d);
    case 'pin':
      return cmdPin(rest, root);
    case 'verify':
      return cmdVerify(rest, root, d);
    case 'peers':
      return cmdPeers(rest, root);
    case 'gate':
      return cmdGate(rest, root);
    case 'minos':
      return cmdMinos(rest);
    case 'vendored':
      return cmdVendored(rest);
    case 'link-check':
      return cmdLinkCheck(rest, root);
    case 'ffi-prefix':
      return cmdFfiPrefix(rest);
    case 'restore':
      return cmdRestore(rest, root, d);
    case 'copies':
      return cmdCopies(rest, root, d);
    default:
      return usage();
  }
}

module.exports = {
  repoKey,
  inspectCheckout,
  checkRequest,
  recordFloor,
  recordFloors,
  buildConfigOutside,
  cargoEnv,
  pathMaps,
  selectedDeveloperDir,
  withSourceRecord,
  BUILD_OUTPUTS,
  allowlistText,
  builtCheckout,
  withPins,
  pinsOf,
  withRecordedBuildsPinned,
  parseXcodeVersion,
  xcodeWarnings,
  arMembers,
  archiveSlices,
  machoVersions,
  judgeMinos,
  duplicateWarnings,
  duplicateAllowlist,
  ffiStructNames,
  prefixFfiTypes,
  COPIES,
  copyName,
  restorePlan,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
