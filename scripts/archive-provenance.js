#!/usr/bin/env node
/**
 * Where did this App Store / TestFlight binary come from? (decided 2026-09-26)
 *
 * scripts/ios-archive.sh calls this before and after it archives:
 *
 *   node scripts/archive-provenance.js gate   --out state.json --name N --flavour F
 *   node scripts/archive-provenance.js record --state state.json --archive A ...
 *   node scripts/archive-provenance.js refused --state state.json --reason R
 *   node scripts/archive-provenance.js verify "<path>.xcarchive"
 *   node scripts/archive-provenance.js build-env
 *
 * gate    reads the source state (commit, branch, every file that differs
 *         from the commit BY CONTENT, untracked and unexpected ignored files,
 *         the native libraries and the repo and commit each was built from,
 *         ios/.xcode.env.local; see "git, trusted" below) and REFUSES a dirty
 *         tree, because a store binary must be built from source that exists
 *         in git. The only way past it is
 *         TALIA_ARCHIVE_ALLOW_DIRTY="<reason>", and the reason, the file list
 *         and the whole uncommitted diff are then recorded with the archive.
 *         A native library with no valid source record (NATIVE_SOURCES), or
 *         one that is not exactly the file its recorded build wrote and the
 *         record pins, is refused with no override; no network is used to
 *         judge it.
 * record  writes Talia-Provenance/provenance.json into the archive (beside
 *         Products/, never inside the app, so the app's signature is
 *         untouched) with the commit, the flags, the JavaScript hashes and a
 *         SHA-256 digest of the archive's contents, and appends the same
 *         record to the local log.
 * build-env prints the allowlisted environment xcodebuild and Metro run in
 *         (`env -i`), so nothing else in the caller's shell reaches the build.
 * verify  recomputes the archive digest and compares it with the record
 *         inside the archive AND with the record this Mac's log kept when the
 *         archive was made, so an archive can be checked again right before
 *         Distribute App, and a record rewritten along with it is caught.
 *
 * Every step also appends a line to the local log
 * (~/Library/Logs/Talia/archive-provenance.jsonl, or TALIA_PROVENANCE_LOG),
 * including refusals and overrides, so there is a history of every archive
 * attempt on this Mac.
 *
 * No dependencies: Node's own fs, crypto and child_process only.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Buffer } = require('buffer');
const { execFileSync } = require('child_process');

const SCHEMA = 'talia-archive-provenance/1';
const PROVENANCE_DIR = 'Talia-Provenance';
// TALIA_HARNESS (BDK upgrade, decided 2026-10-15) is recorded like the
// others; ios-archive.sh refuses it set, so an archive's record reads it ''.
const FLAG_NAMES = ['TALIA_FULL', 'TALIA_HWW', 'TALIA_PURCHASES', 'TALIA_HARNESS'];

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

// ---------------------------------------------------------------- git, trusted
//
// `git status` is NOT the cleanliness check (decided 2026-10-01). Ordinary git
// features hide an edit from it while the build still reads the edited file:
//   (A) `update-index --skip-worktree` / `--assume-unchanged` on a file;
//   (B) an untracked file listed in .git/info/exclude, core.excludesFile or
//       a self-ignoring untracked .gitignore (Metro prefers src/config.ios.ts
//       over src/config.ts, so such a file reaches the bundle);
//   (C) GIT_DIR / GIT_WORK_TREE in the caller's environment, which make git
//       describe another repository than the one being built;
// and `git replace` can make HEAD read as another commit's tree.
// So the checkout is hashed by this script itself, against the commit:
//   - git runs with every GIT_* variable removed, replace refs off, and the
//     fsmonitor, untracked cache and global excludes switched off;
//   - the commit object is hashed and must BE HEAD's id, and its tree id is
//     the reference;
//   - every tracked file is read FROM DISK and hashed as a git blob (no
//     index, no stat cache, no flags), and the whole tree is rebuilt from
//     those hashes and must equal the commit's tree;
//   - untracked files are listed against a scratch index made from HEAD,
//     honouring only the .gitignore files, and every IGNORED entry must be
//     ignored by a .gitignore the commit holds AND sit at a location this
//     script expects (EXPECTED_IGNORED). Anything else counts as uncommitted.

/**
 * Variables that make /usr/bin's Xcode shims (git, xcodebuild, otool, ...)
 * run ANOTHER Xcode's tools: /usr/bin/git is such a shim, so a DEVELOPER_DIR
 * naming a doctored copy of Xcode would answer every git question below
 * (decided 2026-10-02). Dropped for git here and for the build (BUILD_ENV_KEEP).
 */
const XCODE_OVERRIDES = ['DEVELOPER_DIR', 'TOOLCHAINS', 'SDKROOT'];

/**
 * git's environment: the caller's, minus every GIT_* variable and the Xcode
 * overrides. Replace refs and the grafts file are both switched off: either
 * one can give a commit parents it does not have (decided 2026-10-16: a
 * `.git/info/grafts` line made a feature-branch commit read as an ancestor
 * of the allowlisted tip, and GIT_NO_REPLACE_OBJECTS does not cover grafts).
 */
function gitEnv(extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('GIT_') && !XCODE_OVERRIDES.includes(k) && v !== undefined) {
      out[k] = v;
    }
  }
  return {
    ...out,
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_GRAFT_FILE: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_OPTIONAL_LOCKS: '0',
    ...extra,
  };
}

// Command-line settings beat .git/config, so a command a local config names
// (an fsmonitor hook, a gpg program, a hooks folder, a global attributes or
// excludes file) is never run or read by these checks. The commit-graph file
// is a cache of every commit's parents that git trusts as written, so it is
// not read either: ancestry comes from the commit objects alone.
const GIT_SAFE_CONFIG = [
  '-c', 'core.commitGraph=false',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'core.excludesFile=/dev/null',
  '-c', 'core.attributesFile=/dev/null',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'gpg.program=gpg',
  '-c', 'gpg.ssh.program=ssh-keygen',
  '-c', 'gpg.x509.program=gpgsm',
];

function git(root, args, opts = {}) {
  return execFileSync('git', [...GIT_SAFE_CONFIG, '-C', root, ...args], {
    encoding: opts.encoding === null ? undefined : 'utf8',
    env: gitEnv(opts.env),
    input: opts.input,
    maxBuffer: 512 * 1024 * 1024,
    stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
}

function tryGit(root, args) {
  try {
    return git(root, args).trim();
  } catch {
    return null;
  }
}

function splitZ(text) {
  return text.split('\0').filter((s) => s.length > 0);
}

/** A git object id, computed here rather than asked of git. */
function gitObjectId(format, type, body) {
  return crypto
    .createHash(format === 'sha256' ? 'sha256' : 'sha1')
    .update(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]))
    .digest('hex');
}

/** The tree id of a flat list of {path, mode, id}, built as git builds it. */
function treeIdOf(format, entries) {
  const top = new Map();
  for (const e of entries) {
    const parts = e.path.split('/');
    let node = top;
    for (const part of parts.slice(0, -1)) {
      if (!(node.get(part) instanceof Map)) {
        node.set(part, new Map());
      }
      node = node.get(part);
    }
    node.set(parts[parts.length - 1], e);
  }
  const hashNode = (node) => {
    const items = [...node.entries()].map(([name, v]) =>
      v instanceof Map
        ? { name, mode: '40000', id: hashNode(v), dir: true }
        : { name, mode: v.mode, id: v.id, dir: false },
    );
    // git sorts a tree by name, comparing a sub-tree as if it ended in '/'.
    const key = (i) => Buffer.from(i.dir ? `${i.name}/` : i.name);
    items.sort((a, b) => Buffer.compare(key(a), key(b)));
    const body = Buffer.concat(
      items.flatMap((i) => [Buffer.from(`${i.mode} ${i.name}\0`), Buffer.from(i.id, 'hex')]),
    );
    return gitObjectId(format, 'tree', body);
  };
  return hashNode(top);
}

/**
 * What the file at `rel` is ON DISK, as git would store it: mode and blob id.
 * null = missing; 'other' = not a file (a folder where a file was, or a file
 * reached through a symlinked folder, which git would not follow either).
 */
function diskEntry(root, rel, format, realDirs) {
  const dir = path.dirname(rel);
  if (dir !== '.' && !realDirs(dir)) {
    return { mode: 'other', id: null };
  }
  const abs = path.join(root, rel);
  let st;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) {
    return { mode: '120000', id: gitObjectId(format, 'blob', fs.readlinkSync(abs, { encoding: 'buffer' })) };
  }
  if (st.isFile()) {
    return {
      // git's own test: the owner's execute bit.
      mode: (st.mode & 0o100) !== 0 ? '100755' : '100644', // eslint-disable-line no-bitwise
      id: gitObjectId(format, 'blob', fs.readFileSync(abs)),
    };
  }
  return { mode: 'other', id: null };
}

/** Does every folder on the way to `dir` exist as a real folder (no symlink)? */
function realDirChecker(root) {
  const seen = new Map();
  const check = (dir) => {
    if (dir === '.' || dir === '') {
      return true;
    }
    if (seen.has(dir)) {
      return seen.get(dir);
    }
    let ok = false;
    try {
      ok = fs.lstatSync(path.join(root, dir)).isDirectory() && check(path.dirname(dir));
    } catch {
      ok = false;
    }
    seen.set(dir, ok);
    return ok;
  };
  return check;
}

/** Run `fn` with a scratch index holding exactly HEAD's tree (the real index is never read). */
function withHeadIndex(root, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talia-index-'));
  const env = { GIT_INDEX_FILE: path.join(dir, 'index') };
  try {
    git(root, ['read-tree', 'HEAD'], { env });
    return fn(env);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The checkout against HEAD, by content: every tracked file hashed from disk,
 * the tree rebuilt from those hashes. Returns porcelain-style change lines
 * (' M', ' D', ' T') and whether the rebuilt tree is the commit's.
 */
function compareTrackedFiles(root, commit, format, { docExempt = true } = {}) {
  const problems = [];
  const commitBody = git(root, ['cat-file', 'commit', commit], { encoding: null });
  const commitTree = /^tree ([0-9a-f]+)$/m.exec(commitBody.toString('utf8'));
  if (gitObjectId(format, 'commit', commitBody) !== commit || !commitTree) {
    problems.push(`!! git: the commit object stored for ${commit} does not hash to that id`);
  }
  const listing = splitZ(git(root, ['ls-tree', '-r', '-z', '--full-tree', commit]));
  const realDirs = realDirChecker(root);
  const changes = [];
  const docChanges = [];
  const rebuilt = [];
  const changed = []; // {path, disk} of every tracked file that differs, for the diff
  const gitignores = new Set();
  for (const rec of listing) {
    const tab = rec.indexOf('\t');
    const [mode, type, id] = rec.slice(0, tab).split(' ');
    const rel = rec.slice(tab + 1);
    if (path.basename(rel) === '.gitignore') {
      gitignores.add(rel);
    }
    if (type !== 'blob') {
      // A submodule (gitlink): its content is another repository's, which
      // this check cannot vouch for. None exist today; refuse rather than guess.
      changes.push(`!! git: ${rel} is a ${type}, which this check cannot verify`);
      rebuilt.push({ path: rel, mode, id });
      continue;
    }
    const disk = diskEntry(root, rel, format, realDirs);
    // (docExempt false: native/build-*.sh judging a Rust crate, where
    // include_str! can compile a README into the library.)
    const doc = docExempt && /\.md$/i.test(rel);
    let line = null;
    if (disk === null) {
      line = ` D ${rel}`;
    } else if (disk.mode === 'other') {
      line = ` T ${rel}`;
    } else if (disk.id !== id || disk.mode !== mode) {
      line = disk.id === id ? ` T ${rel}` : ` M ${rel}`;
    }
    if (line && doc) {
      // Markdown cannot reach the app: recorded, and the tree is rebuilt
      // with the commit's own copy so it does not count.
      docChanges.push(line);
      rebuilt.push({ path: rel, mode, id });
    } else {
      if (line) {
        changes.push(line);
        changed.push({ path: rel, disk });
      }
      if (disk && disk.mode !== 'other') {
        rebuilt.push({ path: rel, mode: disk.mode, id: disk.id });
      }
    }
  }
  const treeMatches = commitTree !== null && treeIdOf(format, rebuilt) === commitTree[1];
  if (!treeMatches && changes.length === 0) {
    // Every file agreed with git's own listing, yet the tree they make is not
    // the commit's: the listing itself was not the commit's.
    problems.push(`!! git: the checkout does not hash to the tree of ${commit}`);
  }
  return { changes: [...changes, ...problems], docChanges, gitignores, treeMatches, changed };
}

/**
 * Every native library the app links, one row each (decided 2026-09-26;
 * generalised into this one table by the BDK upgrade,
 * 2026-10-16). The signing-critical native code is not in this repo: the
 * bdk-ffi fork (the Bitcoin core, bdk-ffi 3.1.1, since the old engine's
 * removal took bdk-ffi 0.30, decided 2026-11-04) and the BitBox bridge are
 * 21st Capital's own repos. Since 2026-11-06 each row names the library's
 * PUBLIC repo (talia-bdk-ffi and talia-bitbox-ffi, one branch each, main),
 * so a public clone of the app can build and check its libraries. The
 * libraries are still developed in the private repos (bdk-ffi-fork, branch
 * talia-3, and bitbox-ffi), which keep their history; each change is copied
 * to the public repo's main in one commit, and the build is taken from there.
 * NATIVE_PIN names, beside each library's pins, the repo and the full commit
 * its pinned files were built from, and the digest of every file that build
 * wrote:
 *
 *   # source <library> <repo URL> <40-hex commit>
 *   # source-note <library>: <free text, e.g. how the commit was established>
 *   # built <library> <sha256> <path>       (each library file the build wrote)
 *   # generated <library> <sha256> <path>   (each tracked file it wrote: the
 *                                            bindings, the duplicate-symbol list)
 *   # xcode <library> <version> <build>     (the Xcode whose clang compiled its C)
 *   # gated <library> <sha256> <path>       (each file of ANOTHER library its
 *                                            symbol-overlap gate judged, as judged)
 *
 * native/build-*.sh write their library's lines after a build from a clean
 * checkout whose HEAD they found on the org repo (scripts/native-sources.js;
 * the network is needed there, never here). The gate refuses an archive, with
 * NO override, when a library has no such line, when a line is malformed,
 * when it names any repo but that library's own one below, or when the
 * library's PINS are not exactly the files its recorded build wrote (decided
 * 2026-10-05): a pin pasted in by hand, or a record kept while the libraries
 * were put back, would otherwise name a commit the pinned files were not
 * built from. It also refuses, with no override, a tracked generated file
 * (the bindings) that is not the one the recorded build wrote: uniffi 0.31
 * checks the bindings against the library at the first call and calls
 * fatalError on a mismatch, and the BitBox bindings are just
 * as tied to their library. A store binary whose native
 * code cannot be traced to a commit in our repos is not made. The record goes
 * into the archive's provenance (nativeSources).
 *
 * Each row:
 *   repo      the org repo the library is built from: its public repo since
 *             2026-11-06. A record written before then names the private
 *             repo, and the archive refuses it until the library is built
 *             again from the public one and pinned.
 *   branch    the ALLOWLISTED branch, the only one of the repo a build is
 *             taken from (decided 2026-10-16; main in both public repos,
 *             decided 2026-11-06). scripts/native-sources.js
 *             `check`, and so the build script, refuses a commit not reachable
 *             from it on the org repo (a feature branch, say) and one
 *             that does not contain the commit the library's "# source" line
 *             records, unless `--rollback <commit>` asks for that older commit
 *             of the branch. The archive has no network and does not ask
 *             again: the record names the commit the build was allowed from.
 *   libDir    the folder its static libraries live in, on the app's library
 *             search path, so it may hold only the pinned files.
 *   ignore    that folder as `git status --ignored` names it: the one ignored
 *             entry it adds to EXPECTED_IGNORED (its own .gitignore says /lib/).
 *   files     what the build script copies into libDir, and so what `record`
 *             hashes into the "# built" lines.
 *   generated the TRACKED files the build script writes (the bindings, and
 *             for bdkwallet the duplicate-symbol list), hashed by `record` into
 *             the "# generated" lines and checked against the tracked copies.
 *   build     the build script.
 *   podspec   the pod that links the library, and `vendors`, its one
 *             vendoring line (the device library, linked IN PLACE).
 *   judgePod  the podspec is read as data and fails closed (readPodLink): only
 *             the statements POD_ATTRIBUTES and `podDependencies` allow. The
 *             BitBox pod predates that rule and adds its own linker settings,
 *             so only its vendoring line is checked.
 *   fullRecord the record must also carry the "# generated" and "# xcode"
 *             lines. Records written before 2026-10-16 (bitboxffi) lack them;
 *             a build of it writes them, and they are then checked.
 *   toolCrates crates that must not be inside the library (null: not
 *             judged): uniffi's bindgen tool and its own dependencies, which
 *             the fork's "cli" feature put into the static library (decided
 *             2026-10-17). Its pinned device library is refused by the
 *             archive, plain verify and `pin` when it holds a member of one;
 *             verify --test-build only warns, so a build can still be tried.
 *             The BitBox library is judged too since its crate gave uniffi's
 *             "cli" feature to its bindgen tool alone (decided 2026-11-06).
 *   duplicates the generated file listing the symbols the app's link may
 *             report as duplicates (scripts/native-sources.js link-check), each
 *             for the pair of libraries the overlap gate proved it identical
 *             for, over EVERY pair the app links (decided 2026-10-17); null for
 *             a library whose build does not run the gate.
 */
const NATIVE_SOURCES = {
  // The BitBox bridge: built from its public repo (decided 2026-11-06),
  // developed in the private bitbox-ffi.
  bitboxffi: {
    repo: 'https://github.com/21st-Capital/talia-bitbox-ffi',
    branch: 'main',
    libDir: 'native/bitboxffi/lib',
    ignore: 'native/bitboxffi/lib/',
    files: ['native/bitboxffi/lib/libbitboxffi-ios.a', 'native/bitboxffi/lib/libbitboxffi-sim.a'],
    generated: ['native/bitboxffi/bitbox.swift', 'native/bitboxffi/ffi/bitboxFFI.h'],
    build: 'native/build-bitboxffi.sh',
    podspec: 'native/bitboxffi/BitBoxFFI.podspec',
    vendors: 's.vendored_libraries = "lib/libbitboxffi-ios.a"',
    judgePod: false,
    podDependencies: ['React-Core'],
    fullRecord: false,
    toolCrates: [
      'uniffi_bindgen',
      'uniffi_testing',
      'weedle',
      'clap',
      'clap_lex',
      'goblin',
      'askama',
      'cargo_metadata',
      'camino',
    ],
    duplicates: null,
  },
  // The Bitcoin core (BDK upgrade, decided 2026-10-15): bdk-ffi 3.1.1, the only
  // wallet library since the old engine's removal (decided 2026-11-04) took
  // bdkffi (bdk-ffi 0.30 from the private fork's talia line). Built from the
  // public talia-bdk-ffi, main (decided 2026-11-06): a copy of the private
  // fork's talia-3 line, where the library is developed, refreshed by one
  // commit per change.
  bdkwallet: {
    repo: 'https://github.com/21st-Capital/talia-bdk-ffi',
    branch: 'main',
    libDir: 'native/bdkwallet/lib',
    ignore: 'native/bdkwallet/lib/',
    files: ['native/bdkwallet/lib/libbdkwallet-ios.a', 'native/bdkwallet/lib/libbdkwallet-sim.a'],
    generated: [
      'native/bdkwallet/BitcoinDevKit.swift',
      'native/bdkwallet/ffi/BitcoinDevKitFFI.h',
      'native/bdkwallet/duplicate-symbols.txt',
    ],
    build: 'native/build-bdkwallet.sh',
    podspec: 'native/bdkwallet/TaliaBdkWallet.podspec',
    vendors: 's.vendored_libraries = "lib/libbdkwallet-ios.a"',
    judgePod: true,
    podDependencies: ['React-Core'],
    fullRecord: true,
    toolCrates: [
      'uniffi_bindgen',
      'uniffi_udl',
      'weedle',
      'clap',
      'clap_builder',
      'clap_lex',
      'goblin',
      'askama',
      'cargo_metadata',
    ],
    duplicates: 'native/bdkwallet/duplicate-symbols.txt',
  },
};

/**
 * Libraries the app linked once and links no more, with the files they had
 * (decided 2026-11-04). bdkffi, bdk-ffi 0.30 from the fork's talia line (the
 * old engine, TaliaBdk), was removed with that engine. The
 * pinned bdkwallet's record still names its two files in "# gated" lines,
 * and bdkwallet's duplicate list (native/bdkwallet/duplicate-symbols.txt)
 * still holds the symbols its symbol-overlap gate proved identical between
 * bdkffi and bitboxffi: both are bdkwallet's build output, written by
 * native/build-bdkwallet.sh and checked against its record, so they are
 * never edited by hand, and they describe a pair the app no longer links.
 * A "# gated" line naming a retired library's file, and a duplicate-list
 * line naming a retired library, are therefore read and set aside: the file
 * is never pinned or looked for, and the linker can never report that pair.
 * The next bdkwallet build gates against the libraries the app links and
 * writes neither; drop the entry then. A rollback
 * reverts the removal commit, which puts bdkffi back into
 * NATIVE_SOURCES, before `native-sources.js restore bdkffi`.
 */
const RETIRED_NATIVE_LIBS = {
  bdkffi: { files: ['native/bdkffi/lib/libbdkffi-ios.a', 'native/bdkffi/lib/libbdkffi-sim.a'] },
};
const isRetiredLib = (lib) => Object.prototype.hasOwnProperty.call(RETIRED_NATIVE_LIBS, lib);
const isRetiredLibFile = (file) => Object.values(RETIRED_NATIVE_LIBS).some((r) => r.files.includes(file));

/** The device library a library's pod links in place: its vendoring line's path, from the podspec's folder. */
function linkedLibOf(lib) {
  const src = NATIVE_SOURCES[lib];
  const m = /^s\.vendored_libraries = "([^"]+)"$/.exec(src.vendors);
  return path.posix.join(path.posix.dirname(src.podspec), m[1]);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Ignored paths a checkout of this repo is expected to hold: dependencies,
 * build output and per-machine files that git does not hold by design. Each
 * is either checked on its own (the native libraries, .xcode.env.local, the
 * Xcode user data) or not read by an iOS archive at all. Anything else that
 * is ignored (a node_modules folder inside src/ shadowing a real package, a
 * stray *.jsbundle, a file hidden by a local exclude) counts as uncommitted.
 * A new kind of local file is added HERE, in a reviewed commit.
 */
const EXPECTED_IGNORED = [
  /^node_modules\/$/,
  /^ios\/Pods\/$/,
  /^ios\/build(-device|-sim)?\/$/,
  // Each native library's lib folder (NATIVE_SOURCES), pinned in native/native-libs.sha256.
  ...Object.values(NATIVE_SOURCES).map((s) => new RegExp(`^${escapeRe(s.ignore)}$`)),
  /^ios\/\.xcode\.env\.local$/, // judged byte for byte (readXcodeEnv)
  /^ios\/KeelWallet\.xc(workspace|odeproj)\/xcuserdata\/$/, // schemes judged by readXcodeSchemes
  /^vendor\/bundle\/$/, // CocoaPods' gems: pod install, not the archive
  /^\.claude\/worktrees\/$/, // worktrees nested in the checkout
  /^coverage\/$/,
  /^\.devices\.local$/, // phone ids for scripts/ios-device.sh; nothing in a build reads it
  /^scripts\/tier-c\/out\/$/, // the simulator harness's report; nothing in a build reads it
  /^\.metro-health-check[^/]*$/,
  /(^|\/)\.DS_Store$/,
];

const isExpectedIgnored = (entry) => EXPECTED_IGNORED.some((re) => re.test(entry));

/**
 * Untracked and ignored paths, judged against HEAD alone. Returns the
 * untracked lines ('?? path') and the problems found among ignored entries.
 * `expected` says where an ignored entry may sit (this app's EXPECTED_IGNORED
 * by default; native-sources.js allows a committed rule's build output
 * anywhere in a Rust crate).
 */
function readUntracked(root, gitignores, expected = isExpectedIgnored) {
  return withHeadIndex(root, (env) => {
    const others = splitZ(
      git(root, ['ls-files', '-o', '-z', '--exclude-per-directory=.gitignore'], { env }),
    );
    const ignored = splitZ(
      git(root, ['ls-files', '-o', '-i', '-z', '--directory', '--exclude-per-directory=.gitignore'], { env }),
    );
    // Which .gitignore ignores each entry. A folder that is listed only
    // because everything in it is ignored matches no rule itself; its
    // children are judged instead.
    const whoIgnores = (paths) => {
      if (paths.length === 0) {
        return new Map();
      }
      let out = '';
      try {
        out = git(root, ['check-ignore', '--no-index', '-v', '-z', '--stdin'], {
          env,
          input: paths.join('\0') + '\0',
        });
      } catch (e) {
        if (e.status !== 1) {
          throw e;
        }
        out = e.stdout ? e.stdout.toString() : '';
      }
      const fields = out.split('\0');
      const map = new Map();
      for (let i = 0; i + 3 < fields.length; i += 4) {
        if (fields[i]) {
          map.set(fields[i + 3], fields[i]);
        }
      }
      return map;
    };
    const kept = [];
    const problems = [];
    const hidden = [];
    const seen = new Set();
    const judge = (entries) => {
      const fresh = entries.filter((e) => !seen.has(e));
      fresh.forEach((e) => seen.add(e));
      const sources = whoIgnores(fresh);
      for (const entry of fresh) {
        const source = sources.get(entry);
        if (!source && entry.endsWith('/')) {
          const children = fs
            .readdirSync(path.join(root, entry))
            .map((name) => {
              const rel = entry + name;
              return fs.lstatSync(path.join(root, rel)).isDirectory() ? `${rel}/` : rel;
            });
          judge(children);
          continue;
        }
        if (/(^|\/)\.DS_Store$/.test(entry)) {
          continue; // Finder's folder metadata; never read by a build
        }
        if (!source || !gitignores.has(source)) {
          problems.push(`!! ignored: ${entry} is hidden by ${source || 'no rule'}, not by a committed .gitignore`);
          hidden.push(entry);
        } else if (!expected(entry)) {
          problems.push(`!! ignored: ${entry} (${source}) is not a place this checkout keeps local files`);
          hidden.push(entry);
        } else {
          kept.push({ path: entry, rule: source });
        }
      }
    };
    judge(ignored);
    return { others, expected: kept, problems, hidden };
  });
}

/**
 * The uncommitted diff against HEAD, built from the bytes ON DISK.
 *
 * `git diff` against the work tree would pass every file through the clean
 * filter, end-of-line and ident conversion its attributes name, and
 * .git/info/attributes plus .git/config can name any command there: the
 * command would run, and the patch would show the filter's output instead of
 * the file the build read. So the changed files are written as blobs exactly
 * as they are on disk (`hash-object --no-filters`) into a scratch object store
 * (the repository's own objects only read, never written), placed into a
 * scratch index made from HEAD, and the diff is tree against tree, where no
 * filter, no textconv and no external diff runs.
 */
function uncommittedDiff(root, changed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talia-diff-'));
  try {
    const realObjects = path.resolve(root, git(root, ['rev-parse', '--git-path', 'objects']).trim());
    const env = {
      GIT_INDEX_FILE: path.join(dir, 'index'),
      GIT_OBJECT_DIRECTORY: path.join(dir, 'objects'),
      GIT_ALTERNATE_OBJECT_DIRECTORIES: realObjects,
    };
    fs.mkdirSync(path.join(dir, 'objects'));
    git(root, ['read-tree', 'HEAD'], { env });
    const zero = '0'.repeat(git(root, ['rev-parse', 'HEAD'], { env }).trim().length);
    const records = [];
    for (const { path: rel, disk } of changed) {
      if (!disk || disk.mode === 'other') {
        records.push(`0 ${zero}\t${rel}\0`);
        continue;
      }
      const abs = path.join(root, rel);
      const body =
        disk.mode === '120000' ? fs.readlinkSync(abs, { encoding: 'buffer' }) : fs.readFileSync(abs);
      const id = git(root, ['hash-object', '-w', '--no-filters', '--stdin'], { env, input: body }).trim();
      records.push(`${disk.mode} ${id}\t${rel}\0`);
    }
    if (records.length > 0) {
      git(root, ['update-index', '-z', '--index-info'], { env, input: records.join('') });
    }
    const tree = git(root, ['write-tree'], { env }).trim();
    return git(root, ['diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', tree], {
      env,
      encoding: null,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The path(s) a porcelain-style line names (both sides of a rename). */
function porcelainPaths(line) {
  return line
    .slice(3)
    .split(' -> ')
    .map((p) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p));
}

/**
 * A change that cannot reach the app: Markdown only. Metro bundles
 * js/jsx/json/ts/tsx and never .md, and Xcode copies no Markdown into the
 * app, so a Markdown tracker (edited often) or a note never
 * blocks an archive. Such changes are still RECORDED, as docChanges.
 */
function isDocOnly(line) {
  return porcelainPaths(line).every((p) => /\.md$/i.test(p));
}

/**
 * The source the build is about to read. `dirty` counts every difference
 * between the files on disk and the commit (tracked files by content,
 * untracked files, unexpected ignored ones), the native libraries and the
 * Xcode environment file, except Markdown.
 */
function readSourceState(root, env = process.env) {
  const gitEnvDropped = Object.keys(env)
    .filter((k) => k.startsWith('GIT_'))
    .sort();
  const commit = tryGit(root, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const top = tryGit(root, ['rev-parse', '--show-toplevel']);
  const realRoot = fs.realpathSync(root);
  if (!commit || !top || fs.realpathSync(top) !== realRoot) {
    return {
      isGit: false,
      commit: null,
      dirty: true,
      changes: [commit ? `(git's work tree is ${top}, not ${realRoot})` : '(not a git checkout)'],
      gitEnvDropped,
    };
  }
  const format = tryGit(root, ['rev-parse', '--show-object-format']) || 'sha1';
  const tracked = compareTrackedFiles(root, commit, format);
  const untracked = readUntracked(root, tracked.gitignores);
  const native = readNativeState(root);
  const xcodeEnv = readXcodeEnv(root, env);
  const xcodeSchemes = readXcodeSchemes(root);
  const otherLines = untracked.others.map((p) => `?? ${p}`);
  // A native library that differs from its pin, or an Xcode environment
  // file that does more than name node, is source git cannot show, so it
  // counts exactly like an uncommitted file.
  const changes = [
    ...tracked.changes,
    ...otherLines.filter((l) => !isDocOnly(l)),
    ...untracked.problems,
    ...native.problems.map((p) => `!! native: ${p}`),
    ...native.strays.map((p) => `!! native-lib: ${p}`),
    ...xcodeEnv.problems.map((p) => `!! xcode-env: ${p}`),
    ...xcodeSchemes.problems.map((p) => `!! xcode-scheme: ${p}`),
  ];
  const docChanges = [...tracked.docChanges, ...otherLines.filter(isDocOnly)];
  const untrackedPaths = [
    ...otherLines.filter((l) => !isDocOnly(l)).map((l) => l.slice(3)),
    ...untracked.hidden,
  ];
  let diffSha256 = null;
  const untrackedFiles = [];
  if (changes.length > 0) {
    diffSha256 = sha256(uncommittedDiff(root, tracked.changed));
    for (const rel of untrackedPaths) {
      const abs = path.join(root, rel);
      let st;
      try {
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }
      untrackedFiles.push({
        path: rel,
        sha256: st.isFile() ? sha256File(abs) : null,
      });
    }
  }
  const remotes = tryGit(root, ['branch', '-r', '--contains', 'HEAD']);
  return {
    isGit: true,
    commit,
    branch: tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    describe: tryGit(root, ['describe', '--tags', '--always']),
    // %G? is git's own verdict on the commit signature: G good, N none, ...
    commitSignature: tryGit(root, ['log', '-1', '--format=%G?', 'HEAD']),
    // Remote-tracking branches that already hold this commit (as of the last
    // fetch; nothing is fetched here). Empty = the source is on this Mac only.
    onRemotes: remotes
      ? remotes
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s && !s.includes(' -> '))
      : [],
    objectFormat: format,
    // true = the files on disk, hashed here, rebuild exactly the commit's tree.
    treeMatchesCommit: tracked.treeMatches,
    gitEnvDropped,
    dirty: changes.length > 0,
    changes,
    docChanges,
    diffSha256,
    untrackedFiles,
    ignoredExpected: untracked.expected,
    native,
    xcodeEnv,
    xcodeSchemes,
  };
}

/**
 * ios/.xcode.env (tracked, so checked above) and ios/.xcode.env.local (not
 * tracked, per machine) are SOURCED AS SHELL by react-native's
 * with-environment.sh in the "Bundle React Native code and images" phase,
 * which runs after the app is linked and before it is signed: one line there
 * could replace the executable.
 *
 * So .xcode.env.local is judged BYTE FOR BYTE, never by a trimmed or decoded
 * reading (decided 2026-10-02: a line that JavaScript trimmed to a comment,
 * " #;cmd", is to the shell a command, a ';' and then any command). It is
 * accepted only when it is absent, empty, or exactly one of the two lines
 * React Native's own setup writes, with nothing else, not even a comment:
 *
 *   export NODE_BINARY=/an/absolute/path/node      (what `echo ... > .xcode.env.local` writes)
 *   export NODE_BINARY=$(command -v node)
 *
 * followed by at most one newline. The path is plain ASCII with no shell
 * syntax, the file must be a plain file (not a symlink), and the node it
 * names must BE the node on the build's PATH (the one that re-bundles the
 * JavaScript for the proof), resolved through every symlink: a NODE_BINARY
 * naming another program would be run by Xcode as node. Anything else is a
 * build instruction that is not source, so it is refused outright, with no
 * override. Both files' digests are recorded.
 */
const XCODE_ENV = 'ios/.xcode.env';
const XCODE_ENV_LOCAL = 'ios/.xcode.env.local';
const NODE_LINE_COMMAND = 'export NODE_BINARY=$(command -v node)';
const NODE_LINE_PATH = /^export NODE_BINARY=(\/[A-Za-z0-9._@+/-]+)$/;

/** The first executable `node` on a PATH value, or null. */
function nodeOnPath(pathVar) {
  for (const dir of (pathVar || '').split(':')) {
    if (!dir.startsWith('/')) {
      continue; // an empty or relative entry means "here", never trusted
    }
    const candidate = path.join(dir, 'node');
    try {
      if (fs.statSync(candidate).isFile()) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // not here
    }
  }
  return null;
}

function realOrNull(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return null;
  }
}

function readXcodeEnv(root, env = process.env) {
  const files = [XCODE_ENV, XCODE_ENV_LOCAL].map((rel) => ({
    path: rel,
    sha256: shaOrNull(path.join(root, rel)),
  }));
  const problems = [];
  let nodeBinary = null;
  const abs = path.join(root, XCODE_ENV_LOCAL);
  let st = null;
  try {
    st = fs.lstatSync(abs);
  } catch {
    // no local file: .xcode.env's `command -v node` applies
  }
  const pathNode = nodeOnPath(buildEnv(env).kept.PATH);
  if (st && !st.isFile()) {
    problems.push(`${XCODE_ENV_LOCAL} is not a plain file (a symlink or a folder)`);
  } else if (st) {
    const bytes = fs.readFileSync(abs);
    // Printable ASCII and newlines only; no carriage return, tab, NUL or
    // anything a decoder could turn into something else.
    const plain = bytes.every((b) => b === 0x0a || (b >= 0x20 && b <= 0x7e));
    let body = bytes.toString('latin1');
    if (body.endsWith('\n')) {
      body = body.slice(0, -1);
    }
    if (bytes.length === 0) {
      // empty: .xcode.env's `command -v node` applies
    } else if (!plain || body.includes('\n')) {
      problems.push(`${XCODE_ENV_LOCAL} must be one line, "export NODE_BINARY=<path to node>", and nothing else`);
    } else if (body === NODE_LINE_COMMAND) {
      nodeBinary = pathNode;
    } else {
      const m = NODE_LINE_PATH.exec(body);
      if (!m) {
        problems.push(`${XCODE_ENV_LOCAL} must be one line, "export NODE_BINARY=<path to node>", and nothing else`);
      } else {
        nodeBinary = m[1];
        const named = realOrNull(m[1]);
        const onPath = pathNode && realOrNull(pathNode);
        if (!named || named !== onPath) {
          problems.push(
            `${XCODE_ENV_LOCAL} names ${m[1]}, which is not the node on the build's PATH (${pathNode || 'none'})`,
          );
        }
      }
    }
  }
  return { files, nodeBinary, problems };
}

/**
 * Which scheme xcodebuild builds. A scheme can carry pre- and post-build
 * actions, shell scripts xcodebuild runs with the build's rights, and Xcode
 * looks for `-scheme KeelWallet` in the shared folder AND in every user's
 * xcuserdata of every project the workspace opens, following symlinks. The
 * shared scheme is tracked, so the content check covers it; this covers the
 * rest (decided 2026-10-02: a personal scheme behind a symlinked folder passed
 * a scan that did not follow it, and xcodebuild ran its pre-build script).
 *
 * Refused outright, with no override:
 *   - any symlink inside a project or workspace bundle (.xcodeproj,
 *     .xcworkspace), or a bundle, xcuserdata, xcshareddata or xcschemes
 *     folder, or a .xcscheme that is itself a symlink, anywhere under ios/;
 *   - a project the workspace opens that is reached through a symlink (its
 *     real path must be its own path);
 *   - any .xcscheme in the app's own xcuserdata (project or workspace);
 *   - any scheme named KeelWallet other than the shared one, wherever it is
 *     (Pods.xcodeproj's per-pod user schemes, which CocoaPods writes, are
 *     allowed; xcodebuild never runs another scheme's actions).
 * The build folders (ios/build*) are not walked: Xcode never reads a scheme
 * from them, and ios-archive.sh builds in a fresh folder of its own.
 */
const SHARED_SCHEME = 'ios/KeelWallet.xcodeproj/xcshareddata/xcschemes/KeelWallet.xcscheme';
const APP_WORKSPACE = 'ios/KeelWallet.xcworkspace';
const APP_USERDATA = /^ios\/KeelWallet\.xc(odeproj|workspace)\/xcuserdata(\/|$)/;
const BUNDLE_NAME = /\.(xcodeproj|xcworkspace)$/i;
const SCHEME_FOLDER = /^(xcuserdata|xcshareddata|xcschemes)$/i;

function readXcodeSchemes(root) {
  const problems = [];
  const schemes = [];
  const realRoot = fs.realpathSync(root);
  // The projects the workspace opens, by their real paths.
  let workspaceData = '';
  try {
    workspaceData = fs.readFileSync(path.join(root, APP_WORKSPACE, 'contents.xcworkspacedata'), 'utf8');
  } catch {
    // Tracked: a missing or changed workspace is the content check's to report.
  }
  for (const m of workspaceData.matchAll(/location\s*=\s*"([^"]*)"/g)) {
    const loc = m[1];
    const group = /^(group|container):(.+)$/.exec(loc);
    if (!group || group[2].startsWith('/') || group[2].split('/').includes('..')) {
      problems.push(`the workspace opens ${loc}, outside the ios folder`);
      continue;
    }
    const rel = path.posix.join('ios', group[2]);
    const real = realOrNull(path.join(root, rel));
    if (real && real !== path.join(realRoot, rel)) {
      problems.push(`${rel}, which the workspace opens, is reached through a symlink (${real})`);
    }
  }
  const walk = (rel, inBundle) => {
    let names;
    try {
      names = fs.readdirSync(path.join(root, rel));
    } catch {
      return;
    }
    for (const name of names) {
      const child = `${rel}/${name}`;
      if (rel === 'ios' && /^build/.test(name)) {
        continue;
      }
      const st = fs.lstatSync(path.join(root, child));
      const bundle = inBundle || BUNDLE_NAME.test(name);
      if (st.isSymbolicLink()) {
        if (bundle || SCHEME_FOLDER.test(name) || /\.xcscheme$/i.test(name)) {
          problems.push(`${child} is a symlink where Xcode looks for projects and schemes`);
        }
        continue; // never followed (Pods/Headers is full of harmless ones)
      }
      if (st.isDirectory()) {
        walk(child, bundle);
      } else if (/\.xcscheme$/i.test(name)) {
        schemes.push(child);
        if (APP_USERDATA.test(child)) {
          problems.push(`${child} is a personal Xcode scheme, which could replace the shared one`);
        } else if (name.toLowerCase() === 'keelwallet.xcscheme' && child !== SHARED_SCHEME) {
          problems.push(`${child} is a second KeelWallet scheme, which could replace the shared one`);
        }
      }
    }
  };
  if (fs.existsSync(path.join(root, 'ios')) && fs.lstatSync(path.join(root, 'ios')).isSymbolicLink()) {
    problems.push('ios is a symlink');
  } else {
    walk('ios', false);
  }
  return { shared: SHARED_SCHEME, schemes: schemes.length, problems };
}

/**
 * The native libraries linked into the app that git does NOT hold (built on
 * this Mac by native/build-*.sh). A clean checkout says nothing about them,
 * so their SHA-256 is pinned in a tracked file, NATIVE_PIN, and checked:
 *
 * - every pinned library must be present with the pinned digest, with NO
 *   override (decided 2026-10-05; it used to count as an uncommitted change
 *   that TALIA_ARCHIVE_ALLOW_DIRTY got past): the source record below names
 *   the commit of the PINNED files, so a library that differs from its pin
 *   was built from nothing the record or the archive's provenance names;
 * - the app must link our fork's bdk-ffi IN PLACE: the TaliaBdkWallet pod
 *   (BDK_POD_SPEC) must vendor exactly the pinned library and nothing else,
 *   and must not add linker flags to the app (decided 2026-10-07:
 *   bdk-rn's npm package, whose install script downloaded the stock
 *   framework unchecked, left the app; since the old engine's removal,
 *   decided 2026-11-04, the Bitcoin core is bdk-ffi 3.1.1 behind the app's
 *   own bridge in native/bdkwallet). A stock bdk-ffi lacks the fork's
 *   policy paths, its panics as catchable errors and its saturating
 *   timelock check, so this one has no override at all. The same holds for
 *   every library's pod (NATIVE_SOURCES: its podspec must vendor exactly its
 *   own vendoring line; the judged pods are read as data);
 * - the folders the libraries live in (NATIVE_LIB_DIRS) may hold NOTHING but
 *   the pinned files, each a plain file (decided 2026-10-02). Those folders
 *   are on the app's library search path, and the linker takes a
 *   libbitboxffi-ios.dylib or .tbd there before the pinned .a (a static
 *   archive renamed .dylib is still linked statically, so the app launches
 *   with any code in it), and -lbitboxffi / -l"BitBoxFFI" would find a
 *   libbitboxffi.a or libBitBoxFFI.a. So any other entry, any symlink (the
 *   folder itself, a parent, or a library) and any folder is refused with
 *   NO override, like the stock bdk-ffi: nothing legitimate puts another
 *   file there (build-*.sh write exactly the -ios.a and -sim.a pinned in
 *   NATIVE_PIN). Finder's .DS_Store is the one exception: the linker never
 *   opens it.
 */
const NATIVE_PIN = 'native/native-libs.sha256';
const BDK_FORK_LIB = linkedLibOf('bdkwallet');
const BDK_POD_SPEC = NATIVE_SOURCES.bdkwallet.podspec;
// The one way the pod may hand a library to the app's link: BDK_FORK_LIB,
// relative to the podspec's folder.
const BDK_POD_VENDORS = NATIVE_SOURCES.bdkwallet.vendors;
const NATIVE_LIB_DIRS = Object.values(NATIVE_SOURCES).map((s) => s.libDir);

function lstatOrNull(file) {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}

function entryKind(st) {
  if (st.isSymbolicLink()) {
    return 'symlink';
  }
  if (st.isDirectory()) {
    return 'folder';
  }
  return st.isFile() ? 'file' : 'other';
}

/**
 * A judged podspec (NATIVE_SOURCES judgePod: TaliaBdkWallet) is Ruby, so it
 * is read as data and FAILS CLOSED (decided 2026-10-07, on the old engine's
 * TaliaBdk pod): between `Pod::Spec.new do |s|` and `end` it may hold only
 * the statements below, one per line, and nothing else. A list of what is
 * forbidden always misses something: `s.libraries = "bdkffi-sim"`,
 * `s.frameworks = "bdkFFI"` and an `s.script_phases` entry that copies
 * another .a over the vendored library before the compile each changed the
 * library the app links, and each passed a check that only looked for
 * vendored_ lines and linker settings. A string may hold no "#" and no
 * backslash: Ruby interpolates "#{...}", "#@x" and
 * "#$x", so "OTHER_#{'LD'}FLAGS" is OTHER_LDFLAGS, and a check that strips
 * "#" as a comment never sees it. Any line that is not one of these, a
 * statement split over lines, a second `do` block or a `dependency` on any
 * pod but the library's own `podDependencies` (React-Core; another pod could
 * vendor a stock bdkFFI) is refused.
 */
const POD_STRING = '"[^"\\\\#]*"';
const POD_STRINGS = `${POD_STRING}(?:\\s*,\\s*${POD_STRING})*`;
const podHash = (keys) =>
  `\\{\\s*:(?:${keys})\\s*=>\\s*${POD_STRING}(?:\\s*,\\s*:(?:${keys})\\s*=>\\s*${POD_STRING})*\\s*\\}`;
/** attribute -> the only value shape it may take. */
const POD_ATTRIBUTES = {
  name: POD_STRING,
  version: POD_STRING,
  summary: POD_STRING,
  homepage: POD_STRING,
  author: POD_STRING,
  license: `(?:${POD_STRING}|${podHash('type|file|text')})`,
  platform: `:ios\\s*,\\s*${POD_STRING}`,
  // A :path pod; a :git or :http source would mean a download.
  source: podHash('path'),
  source_files: POD_STRINGS,
  preserve_paths: POD_STRINGS,
  // Exactly the library's `vendors` line, checked below.
  vendored_libraries: POD_STRINGS,
};
// The pod's own Swift compile may look for the C module (bdkFFI,
// BitcoinDevKitFFI) in its ffi folder; nothing in this hash reaches the app's
// link.
const POD_XCCONFIG_KEYS = ['SWIFT_INCLUDE_PATHS'];

/** A podspec line's code: the text before its comment, or a problem. */
function podCode(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inString = !inString;
    } else if (c === '#') {
      if (inString) {
        return { problem: 'a string holds "#" (Ruby would interpolate "#{...}", "#@x" or "#$x" there)' };
      }
      return { code: line.slice(0, i).trim() };
    }
  }
  return { code: line.trim() };
}

/**
 * Does `lib`'s pod link its library, in place, and nothing else? The podspec
 * is tracked, so an edit to it is also an uncommitted change; this is the
 * part that has NO override: one vendoring line, exactly the library's
 * `vendors` (its device library, linked in place), and, for a judged pod, no
 * statement outside the short list above (no other library, framework,
 * script, dependency or build setting).
 */
function readPodLink(root, lib) {
  const src = NATIVE_SOURCES[lib];
  const spec = src.podspec;
  const pod = path.posix.basename(spec, '.podspec');
  let text = null;
  try {
    text = fs.readFileSync(path.join(root, spec), 'utf8');
  } catch {
    return { lib, podspec: spec, problems: [`${spec} is missing`] };
  }
  const problems = [];
  const code = [];
  text.split('\n').forEach((raw, i) => {
    const at = `${spec} line ${i + 1}`;
    const c = podCode(raw);
    if (c.problem) {
      problems.push(`${at}: ${c.problem}: ${raw.trim()}`);
    } else if (c.code !== '') {
      code.push({ at, line: c.code });
    }
  });
  const vendoring = code.filter((c) => /vendored_/.test(c.line)).map((c) => c.line);
  if (vendoring.length !== 1 || vendoring[0] !== src.vendors) {
    problems.push(`${spec} must vendor exactly one library, ${src.vendors}; it has: ${vendoring.join(' | ') || 'none'}`);
  }
  if (!src.judgePod) {
    return { lib, podspec: spec, problems };
  }
  const whole = (re) => new RegExp(`^${re}$`);
  const isDependency = (l) => src.podDependencies.some((d) => whole(`s\\.dependency\\s+"${escapeRe(d)}"`).test(l));
  const xcconfigPair = whole(`"(?:${POD_XCCONFIG_KEYS.join('|')})"\\s*=>\\s*${POD_STRING}`);
  const unknown = (c) => problems.push(`${c.at} is not a statement the ${pod} pod may hold: ${c.line}`);
  if (code.length < 2 || code[0].line !== 'Pod::Spec.new do |s|' || code[code.length - 1].line !== 'end') {
    problems.push(`${spec} must be one "Pod::Spec.new do |s|" block, from its first line of code to an "end" on its last`);
  }
  let inXcconfig = false;
  code.slice(1, -1).forEach((c) => {
    const l = c.line;
    if (inXcconfig) {
      if (l === '}') {
        inXcconfig = false;
      } else if (!xcconfigPair.test(l.replace(/,$/, ''))) {
        unknown(c);
      }
      return;
    }
    if (/^s\.pod_target_xcconfig\s*=\s*\{$/.test(l)) {
      inXcconfig = true;
      return;
    }
    const oneLine = /^s\.pod_target_xcconfig\s*=\s*\{(.*)\}$/.exec(l);
    if (oneLine) {
      const pairs = oneLine[1].trim().replace(/,$/, '');
      if (pairs !== '' && !pairs.split(/\s*,\s*/).every((p) => xcconfigPair.test(p))) {
        unknown(c);
      }
      return;
    }
    if (isDependency(l)) {
      return;
    }
    const m = /^s\.([a-z_]+)\s*=\s*(.+)$/.exec(l);
    if (!m || !Object.prototype.hasOwnProperty.call(POD_ATTRIBUTES, m[1]) || !whole(POD_ATTRIBUTES[m[1]]).test(m[2])) {
      unknown(c);
    }
  });
  if (inXcconfig) {
    problems.push(`${spec}: the pod_target_xcconfig hash is never closed`);
  }
  return { lib, podspec: spec, problems };
}

/**
 * Every entry of the native library folders, judged against the pin list:
 * returns what each folder holds (name, kind, digest of a plain file) and
 * the problems (no override). A folder that does not exist holds nothing;
 * the pinned libraries in it are then reported missing by the digest check.
 */
function readNativeLibDirs(root, pinnedPaths) {
  const dirs = [];
  const problems = [];
  for (const dir of NATIVE_LIB_DIRS) {
    // The folder and each of its parents must be real folders, not links:
    // a symlinked lib folder would hand the linker any folder on this Mac.
    const parts = dir.split('/');
    let blocked = false;
    for (let i = 1; i <= parts.length; i++) {
      const rel = parts.slice(0, i).join('/');
      const st = lstatOrNull(path.join(root, rel));
      if (st === null) {
        blocked = true;
        break;
      }
      if (!st.isDirectory()) {
        problems.push(`${rel} is a ${entryKind(st)}, not a folder`);
        blocked = true;
        break;
      }
    }
    if (blocked) {
      dirs.push({ dir, entries: null });
      continue;
    }
    const entries = [];
    for (const name of fs.readdirSync(path.join(root, dir)).sort()) {
      const rel = `${dir}/${name}`;
      const st = fs.lstatSync(path.join(root, rel));
      const kind = entryKind(st);
      entries.push({ name, kind, sha256: kind === 'file' ? shaOrNull(path.join(root, rel)) : null });
      if (name === '.DS_Store' && kind === 'file') {
        continue;
      }
      if (kind !== 'file') {
        problems.push(`${rel} is a ${kind}; this folder may only hold the pinned libraries`);
      } else if (!pinnedPaths.includes(rel)) {
        problems.push(`${rel} is not pinned in ${NATIVE_PIN}; the linker would find it`);
      }
    }
    dirs.push({ dir, entries });
  }
  return { dirs, problems };
}

function shaOrNull(file) {
  try {
    return sha256File(file);
  } catch {
    return null;
  }
}

// The record's lines (NATIVE_SOURCES, above, says what each one means).
const SOURCE_LINE = /^# source ([a-z0-9-]+) (\S+) ([0-9a-f]{40})$/;
const SOURCE_NOTE = /^# source-note ([a-z0-9-]+): ?(.*)$/;
const BUILT_LINE = /^# built ([a-z0-9-]+) ([0-9a-f]{64}) (\S+)$/;
const GENERATED_LINE = /^# generated ([a-z0-9-]+) ([0-9a-f]{64}) (\S+)$/;
// `xcodebuild -version` as "<version> <build>": "Xcode 27.1" and "Build version 27A9275".
const XCODE_LINE = /^# xcode ([a-z0-9-]+) ([0-9][0-9A-Za-z.]*) ([0-9A-Za-z]+)$/;
// The file of ANOTHER library the build's symbol-overlap gate judged, as it judged it.
const GATED_LINE = /^# gated ([a-z0-9-]+) ([0-9a-f]{64}) (\S+)$/;
// Anything that LOOKS like one of them is judged by the strict form above, so
// a near miss ("#source", a short commit, a CRLF line end) is refused, never
// skipped as an ordinary comment.
const LOOKS_LIKE_SOURCE = /^\s*#\s*source(\s|$)/;
const LOOKS_LIKE_NOTE = /^\s*#\s*source-note(\W|$)/;
const LOOKS_LIKE_BUILT = /^\s*#\s*built(\s|$)/;
const LOOKS_LIKE_GENERATED = /^\s*#\s*generated(\s|$)/;
const LOOKS_LIKE_XCODE = /^\s*#\s*xcode(\s|$)/;
const LOOKS_LIKE_GATED = /^\s*#\s*gated(\s|$)/;
/** A pin: "<sha256>  <path>" (shasum's own format). */
const PIN_LINE = /^([0-9a-f]{64}) [ *](.+)$/;

const isNativeLib = (lib) => Object.prototype.hasOwnProperty.call(NATIVE_SOURCES, lib);

/**
 * The library whose lib folder holds `rel` directly (the folders are flat:
 * a subfolder there is refused anyway), or null; a path that climbs out with
 * ".." belongs to none.
 */
function libOfPath(rel) {
  const name = path.posix.basename(rel);
  return (
    Object.keys(NATIVE_SOURCES).find(
      (lib) => rel === `${NATIVE_SOURCES[lib].libDir}/${name}` && name !== '.' && name !== '..',
    ) || null
  );
}

/** The pins in NATIVE_PIN's text, in order: [{ path, pinned }]. */
function parsePins(text) {
  const pins = [];
  for (const line of (text || '').split('\n')) {
    const m = PIN_LINE.exec(line.trim());
    if (m) {
      pins.push({ path: m[2], pinned: m[1] });
    }
  }
  return pins;
}

/**
 * The source record in NATIVE_PIN's text: what it names, and what is wrong
 * with it, including every pin that is not exactly a file the library's
 * recorded build wrote (no override for any of it).
 */
function parseNativeSources(text) {
  const libs = Object.keys(NATIVE_SOURCES);
  const found = new Map();
  const notes = new Map();
  const built = new Map(libs.map((lib) => [lib, []]));
  const generated = new Map(libs.map((lib) => [lib, []]));
  const xcode = new Map();
  const gated = new Map(libs.map((lib) => [lib, []]));
  const problems = [];
  (text || '').split('\n').forEach((raw, i) => {
    const at = `${NATIVE_PIN} line ${i + 1}`;
    if (LOOKS_LIKE_GATED.test(raw)) {
      const m = GATED_LINE.exec(raw);
      if (!m || !isNativeLib(m[1])) {
        problems.push(`${at} is not "# gated <${libs.join('|')}> <sha256> <path>": ${JSON.stringify(raw)}`);
        return;
      }
      const [, lib, digest, file] = m;
      const owner = libOfPath(file);
      if (!NATIVE_SOURCES[lib].duplicates) {
        problems.push(`${at}: ${lib}'s build runs no symbol-overlap gate`);
      } else if (isRetiredLibFile(file)) {
        // A library the app no longer links (RETIRED_NATIVE_LIBS): set aside.
      } else if (owner === null || owner === lib || !NATIVE_SOURCES[owner].files.includes(file)) {
        problems.push(`${at}: ${file} is not a file of another library the app links`);
      } else if (gated.get(lib).some((g) => g.path === file)) {
        problems.push(`${at} is a second "# gated" line for ${file}`);
      } else {
        gated.get(lib).push({ lib: owner, path: file, sha256: digest });
      }
      return;
    }
    if (LOOKS_LIKE_GENERATED.test(raw)) {
      const m = GENERATED_LINE.exec(raw);
      if (!m || !isNativeLib(m[1])) {
        problems.push(`${at} is not "# generated <${libs.join('|')}> <sha256> <path>": ${JSON.stringify(raw)}`);
        return;
      }
      const [, lib, digest, file] = m;
      if (!NATIVE_SOURCES[lib].generated.includes(file)) {
        problems.push(`${at}: ${lib}'s build does not write ${file} (it writes ${NATIVE_SOURCES[lib].generated.join(', ')})`);
      } else if (generated.get(lib).some((g) => g.path === file)) {
        problems.push(`${at} is a second "# generated" line for ${file}`);
      } else {
        generated.get(lib).push({ path: file, sha256: digest });
      }
      return;
    }
    if (LOOKS_LIKE_XCODE.test(raw)) {
      const m = XCODE_LINE.exec(raw);
      if (!m || !isNativeLib(m[1])) {
        problems.push(`${at} is not "# xcode <${libs.join('|')}> <version> <build>": ${JSON.stringify(raw)}`);
      } else if (xcode.has(m[1])) {
        problems.push(`${at} is a second "# xcode" line for ${m[1]}`);
      } else {
        xcode.set(m[1], { version: m[2], build: m[3] });
      }
      return;
    }
    if (LOOKS_LIKE_NOTE.test(raw)) {
      const m = SOURCE_NOTE.exec(raw);
      if (!m || !isNativeLib(m[1])) {
        problems.push(`${at} is not "# source-note <${libs.join('|')}>: <text>": ${JSON.stringify(raw)}`);
      } else {
        notes.set(m[1], [...(notes.get(m[1]) || []), m[2].trim()]);
      }
      return;
    }
    if (LOOKS_LIKE_BUILT.test(raw)) {
      const m = BUILT_LINE.exec(raw);
      if (!m || !isNativeLib(m[1])) {
        problems.push(`${at} is not "# built <${libs.join('|')}> <sha256> <path>": ${JSON.stringify(raw)}`);
        return;
      }
      const [, lib, digest, file] = m;
      if (libOfPath(file) !== lib) {
        problems.push(`${at}: ${lib}'s build cannot have written ${file} (not in ${NATIVE_SOURCES[lib].libDir}/)`);
      } else if (built.get(lib).some((b) => b.path === file)) {
        problems.push(`${at} is a second "# built" line for ${file}`);
      } else {
        built.get(lib).push({ path: file, sha256: digest });
      }
      return;
    }
    if (!LOOKS_LIKE_SOURCE.test(raw)) {
      return;
    }
    const m = SOURCE_LINE.exec(raw);
    if (!m) {
      problems.push(`${at} is not "# source <library> <repo URL> <40-hex commit>": ${JSON.stringify(raw)}`);
      return;
    }
    const [, lib, repo, commit] = m;
    if (!isNativeLib(lib)) {
      problems.push(`${at} names ${lib}, which is not a library this app links (${libs.join(', ')})`);
      return;
    }
    if (found.has(lib)) {
      problems.push(`${at} is a second source line for ${lib}`);
      return;
    }
    if (repo !== NATIVE_SOURCES[lib].repo) {
      problems.push(`${at}: ${lib} names ${repo}, not 21st Capital's ${NATIVE_SOURCES[lib].repo}`);
    }
    if (/^0+$/.test(commit)) {
      problems.push(`${at}: ${lib} names no commit (${commit})`);
    }
    found.set(lib, { lib, repo, commit });
  });
  for (const lib of libs) {
    if (!found.has(lib)) {
      problems.push(`no source line for ${lib} ("# source ${lib} ${NATIVE_SOURCES[lib].repo} <commit>")`);
    }
  }
  // The pins must be exactly what each library's recorded build wrote: a
  // record and pins that drifted apart name a commit the files did not come
  // from (decided 2026-10-05).
  const pins = parsePins(text);
  for (const pin of pins) {
    const lib = libOfPath(pin.path);
    if (lib === null) {
      problems.push(`${pin.path} is pinned, but no library with a source record lives there`);
      continue;
    }
    const rec = built.get(lib).find((b) => b.path === pin.path);
    if (!rec) {
      problems.push(`${pin.path} is pinned, but no "# built ${lib}" line records it: no build of ${lib} wrote it`);
    } else if (rec.sha256 !== pin.pinned) {
      problems.push(
        `${pin.path} is pinned ${pin.pinned}, but the build of ${lib} recorded ${rec.sha256}: ` +
          'the pins and the source record were not written together',
      );
    }
  }
  for (const lib of libs) {
    if (found.has(lib) && built.get(lib).length === 0) {
      problems.push(`no "# built ${lib} <sha256> <path>" line: the record does not say which files that build wrote`);
    }
    for (const b of built.get(lib)) {
      if (!pins.some((p) => p.path === b.path)) {
        problems.push(`${lib}'s build recorded ${b.path}, which is not pinned`);
      }
    }
    // The tracked files the build wrote (the bindings): all of them or none,
    // and all of them, with the Xcode, for a library whose record must carry
    // them (a binding out of step with its library is a crash
    // at the first call).
    const src = NATIVE_SOURCES[lib];
    const gen = generated.get(lib);
    const owned = found.has(lib) || built.get(lib).length > 0 || gen.length > 0 || xcode.has(lib) || gated.get(lib).length > 0;
    if (owned && (src.fullRecord || gen.length > 0)) {
      for (const file of src.generated) {
        if (!gen.some((g) => g.path === file)) {
          problems.push(`no "# generated ${lib} <sha256> ${file}" line: the record does not say which ${file} that build wrote`);
        }
      }
    }
    if (owned && src.fullRecord && !xcode.has(lib)) {
      problems.push(`no "# xcode ${lib} <version> <build>" line: the record does not say which Xcode compiled ${lib}'s C code`);
    }
    // The symbol-overlap gate judged the other libraries as they were then
    // (decided 2026-10-17): its proof, and the duplicate list made from it,
    // hold for exactly those files. A library rebuilt since (another
    // secp256k1-sys, a patched C file) was never compared with this one, and
    // ld prints nothing when only one copy of a symbol is loaded.
    if (owned && src.duplicates) {
      const judged = gated.get(lib);
      for (const pin of pins) {
        const owner = libOfPath(pin.path);
        if (owner === null || owner === lib) {
          continue;
        }
        const g = judged.find((x) => x.path === pin.path);
        if (!g) {
          problems.push(
            `no "# gated ${lib} <sha256> ${pin.path}" line: the record does not say that ${lib}'s overlap gate judged ${pin.path}`,
          );
        } else if (g.sha256 !== pin.pinned) {
          problems.push(
            `${lib}'s overlap gate judged ${pin.path} as ${g.sha256}, but it is pinned ${pin.pinned}: the two were ` +
              `never compared; rebuild ${lib} (${src.build}), whose gate judges the libraries it is linked with`,
          );
        }
      }
      for (const g of judged.filter((x) => !pins.some((p) => p.path === x.path))) {
        problems.push(`${lib}'s overlap gate judged ${g.path}, which is not pinned`);
      }
    }
  }
  const sources = libs
    .filter((lib) => found.has(lib))
    .map((lib) => ({
      ...found.get(lib),
      note: notes.has(lib) ? notes.get(lib).join(' ') : null,
      built: built.get(lib),
      // Only when recorded (records before 2026-10-16 carry neither).
      generated: generated.get(lib).length > 0 ? generated.get(lib) : undefined,
      xcode: xcode.get(lib),
      // The other libraries' files its overlap gate judged (only a library that runs one).
      gated: gated.get(lib).length > 0 ? gated.get(lib) : undefined,
    }));
  return { sources, problems };
}

/**
 * The member names of a static library, plain or fat (universal), read from
 * the ar headers alone (a library is hundreds of megabytes).
 */
function arMemberNames(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const read = (pos, n) => {
      const b = Buffer.alloc(n);
      return b.subarray(0, fs.readSync(fd, b, 0, n, pos));
    };
    const size = fs.fstatSync(fd).size;
    const head = read(0, 8);
    const magic = head.length >= 8 ? head.readUInt32BE(0) : 0;
    const slices = [];
    if (magic === 0xcafebabe || magic === 0xcafebabf) {
      const width = magic === 0xcafebabe ? 20 : 32;
      const count = head.readUInt32BE(4);
      const table = read(8, width * count);
      for (let i = 0; i < count; i++) {
        const at = i * width;
        slices.push(
          magic === 0xcafebabe
            ? [table.readUInt32BE(at + 8), table.readUInt32BE(at + 12)]
            : [Number(table.readBigUInt64BE(at + 8)), Number(table.readBigUInt64BE(at + 16))],
        );
      }
    } else {
      slices.push([0, size]);
    }
    const names = [];
    for (const [start, length] of slices) {
      if (read(start, 8).toString('latin1') !== '!<arch>\n') {
        throw new Error(`${file}: not an ar archive`);
      }
      let pos = start + 8;
      while (pos + 60 <= start + length) {
        const h = read(pos, 60);
        let name = h.toString('latin1', 0, 16).trim();
        const bytes = parseInt(h.toString('latin1', 48, 58).trim(), 10);
        if (h.length < 60 || !Number.isFinite(bytes) || bytes < 0) {
          throw new Error(`${file}: a damaged member header at byte ${pos}`);
        }
        const long = /^#1\/(\d+)$/.exec(name);
        if (long) {
          name = read(pos + 60, parseInt(long[1], 10)).toString('latin1').replace(/\0+$/, '');
        }
        names.push(name);
        pos += 60 + bytes + (bytes & 1);
      }
    }
    return names;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The libraries whose pinned device file holds a crate it must not
 * (NATIVE_SOURCES toolCrates): [{ lib, path, crates }]. rustc names a crate's
 * objects "<crate>-<16 hex>.<...>.rcgu.o".
 */
function toolCrateFindings(root, pins) {
  const out = [];
  for (const [lib, src] of Object.entries(NATIVE_SOURCES)) {
    const file = linkedLibOf(lib);
    if (!src.toolCrates || !pins.some((p) => p.path === file)) {
      continue;
    }
    let crates;
    try {
      crates = toolCratesIn(path.join(root, file), src.toolCrates);
    } catch {
      continue; // missing or not a library: refused as unpinned already
    }
    if (crates.length > 0) {
      out.push({ lib, path: file, crates });
    }
  }
  return out;
}

/** Which of `crates` a static library holds objects of (throws when it is not one). */
function toolCratesIn(file, crates) {
  const found = new Set();
  for (const n of arMemberNames(file)) {
    const m = /^([a-z0-9_]+)-[0-9a-f]{16}\./.exec(n);
    if (m && crates.includes(m[1])) {
      found.add(m[1]);
    }
  }
  return [...found].sort();
}

/**
 * The C struct types each library's generated headers declare, and every one
 * two libraries declare DIFFERENTLY (found by a trial link on
 * 2026-10-16). Swift imports a C struct as a type named by its C name alone,
 * whichever clang module it comes from, and the linker keeps one copy of its
 * metadata for the whole app, silently: uniffi 0.23's RustBuffer (32-bit
 * lengths, the old bdk-ffi and BitBox) and uniffi 0.31's (64-bit) under one
 * name made the new library free a pointer it never allocated. The same
 * declaration in two headers is harmless (the old bdk-ffi and BitBox share
 * theirs); a different one is refused with no override. Headers that are not
 * on disk are skipped (their record check reports them).
 */
function ffiStructProblems(root) {
  const seen = new Map(); // name -> [{ lib, file, body }]
  for (const [lib, src] of Object.entries(NATIVE_SOURCES)) {
    for (const file of src.generated.filter((g) => g.endsWith('.h'))) {
      let text;
      try {
        text = fs.readFileSync(path.join(root, file), 'utf8');
      } catch {
        continue;
      }
      const plain = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const m of plain.matchAll(/\btypedef\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/g)) {
        const body = m[2].replace(/\s+/g, ' ').trim();
        seen.set(m[1], [...(seen.get(m[1]) || []), { lib, file, body }]);
      }
    }
  }
  const problems = [];
  for (const [name, decls] of seen) {
    const libs = [...new Set(decls.map((d) => d.lib))];
    if (libs.length > 1 && new Set(decls.map((d) => d.body)).size > 1) {
      problems.push(
        `the C struct ${name} is declared differently in ${decls.map((d) => d.file).join(' and ')}: ` +
          "Swift merges imported C types by name across the app, so one library's code would use the other's layout",
      );
    }
  }
  return problems;
}

/**
 * The native libraries against NATIVE_PIN. `pinText`, when given, is judged
 * in place of the file's text: scripts/native-sources.js `verify
 * --test-build` passes the record with a recorded, not yet pinned build
 * pinned in memory (the file is never changed, and the archive never passes
 * it).
 */
function readNativeState(root, pinText) {
  let text = pinText === undefined ? null : pinText;
  if (pinText === undefined) {
    try {
      text = fs.readFileSync(path.join(root, NATIVE_PIN), 'utf8');
    } catch {
      // no pin file: every library below is unaccounted for
    }
  }
  const libs = parsePins(text).map((p) => ({ ...p, sha256: shaOrNull(path.join(root, p.path)) }));
  const problems = [];
  if (text === null) {
    problems.push(`${NATIVE_PIN} is missing`);
  }
  // Every library a pod links must be pinned (the fork's bdk-ffi first among them).
  for (const lib of Object.keys(NATIVE_SOURCES)) {
    const linked = linkedLibOf(lib);
    if (!libs.some((l) => l.path === linked)) {
      problems.push(`${NATIVE_PIN} does not pin ${linked}`);
    }
  }
  for (const l of libs) {
    if (l.sha256 !== l.pinned) {
      problems.push(`${l.path} is ${l.sha256 || 'missing'}, pinned ${l.pinned}`);
    }
  }
  const sources = parseNativeSources(text);
  // The tracked files a recorded build wrote (the bindings) must be the ones
  // in the checkout: uniffi 0.31 compares the bindings with the
  // library at the first call and calls fatalError when they differ.
  const generated = [];
  for (const s of sources.sources) {
    for (const g of s.generated || []) {
      const now = shaOrNull(path.join(root, g.path));
      generated.push({ lib: s.lib, path: g.path, recorded: g.sha256, sha256: now });
      if (now !== g.sha256) {
        problems.push(
          `${g.path} is ${now || 'missing'}, but the build of ${s.lib} from ${s.commit} wrote ${g.sha256}: ` +
            'the generated files and the library are out of step',
        );
      }
    }
  }
  problems.push(...ffiStructProblems(root));
  // Tool crates inside a library that must hold none (decided 2026-10-17).
  const toolCrates = toolCrateFindings(root, libs).map(
    (t) =>
      `${t.path} holds ${t.crates.join(', ')}: uniffi's bindgen tool and its dependencies, which the ` +
      `fork's "cli" feature puts into the library; build ${t.lib} from a fork commit that gives that ` +
      'feature to the uniffi-bindgen binary alone',
  );
  const podLinks = Object.keys(NATIVE_SOURCES).map((lib) => {
    const link = readPodLink(root, lib);
    const linked = linkedLibOf(lib);
    return { lib, path: linked, sha256: shaOrNull(path.join(root, linked)), podspec: link.podspec, problems: link.problems };
  });
  const bdk = podLinks.find((l) => l.lib === 'bdkwallet');
  const libDirs = readNativeLibDirs(root, libs.map((l) => l.path));
  return {
    pinFile: NATIVE_PIN,
    libs,
    // Which repo and commit each library was built from, and the files that
    // build wrote (refused with no override when missing, malformed, naming
    // another repo, or not exactly the pinned files).
    sources: sources.sources,
    sourceProblems: sources.problems,
    // A library on disk that is not the pinned one (or no pin file, or no
    // pin for a linked library), or a generated file that is not the one its
    // recorded build wrote: refused with no override too, since no record
    // says what such a file was built from (decided 2026-10-05).
    problems,
    generated,
    // A library holding uniffi's bindgen tool crates (NATIVE_SOURCES toolCrates):
    // refused by the archive and plain verify, no override; verify
    // --test-build only warns.
    toolCrates,
    libDirs: libDirs.dirs,
    // Refused with no override (see above).
    strays: libDirs.problems,
    // The app links each library itself, through its pod: no copy. The
    // Bitcoin core is bdkwallet since 2026-11-04.
    bdkLinked: { path: bdk.path, sha256: bdk.sha256, podspec: bdk.podspec, problems: bdk.problems },
    podLinks,
    // The fork's bdk-ffi is there, and every pod links its own library in
    // place (the name predates the other pods; the BDK upgrade made it cover each
    // podspec, and the old engine's removal made bdkwallet the fork's library it names).
    // Another library that is missing is refused as unpinned.
    bdkForkLinked: bdk.sha256 !== null && podLinks.every((l) => l.problems.length === 0),
  };
}

/**
 * May an App Store / TestFlight archive be made from this state?
 * A clean checkout always may. A dirty one only with an explicit override,
 * and the override's text is kept as the reason. Four things have no
 * override at all: the stock bdk-ffi; a native library source record that is
 * missing, malformed, names a repo other than ours (NATIVE_SOURCES) or does
 * not record exactly the pinned files; a native library that is not the
 * pinned one (decided 2026-10-05: the override let a hand-built library ship
 * while the record named a commit it was not built from); and a build
 * instruction outside git (an .xcode.env.local that does more than name node,
 * a scheme other than the shared one). Nothing legitimate needs any of them,
 * and each runs or links code no record could describe.
 */
function buildInstructionProblems(state) {
  return [
    ...((state.native && state.native.strays) || []).map((p) => `native-lib: ${p}`),
    ...((state.developerDir && state.developerDir.problems) || []).map((p) => `xcode: ${p}`),
    ...((state.xcodeEnv && state.xcodeEnv.problems) || []).map((p) => `xcode-env: ${p}`),
    ...((state.xcodeSchemes && state.xcodeSchemes.problems) || []).map((p) => `xcode-scheme: ${p}`),
  ];
}

function gateDecision(state, env) {
  const override = (env.TALIA_ARCHIVE_ALLOW_DIRTY || '').trim();
  if (state.native && !state.native.bdkForkLinked) {
    return { allowed: false, override: null, stockBdk: true };
  }
  // Native code no record ties to a commit in our repos: no override.
  const sourceProblems = (state.native && state.native.sourceProblems) || [];
  if (sourceProblems.length > 0) {
    return { allowed: false, override: null, nativeSources: sourceProblems };
  }
  // A native library that is not the pinned one: its source is unknown.
  const unpinned = (state.native && state.native.problems) || [];
  if (unpinned.length > 0) {
    return { allowed: false, override: null, nativeLibs: unpinned };
  }
  const tools = (state.native && state.native.toolCrates) || [];
  if (tools.length > 0) {
    return { allowed: false, override: null, toolCrates: tools };
  }
  const instructions = buildInstructionProblems(state);
  if (instructions.length > 0) {
    return { allowed: false, override: null, buildInstructions: instructions };
  }
  if (state.isGit && !state.dirty) {
    return { allowed: true, override: null };
  }
  if (override) {
    return { allowed: true, override };
  }
  return { allowed: false, override: null };
}

/** The flags exactly as the build will see them ('' = unset = false). */
function readFlags(env) {
  const flags = {};
  for (const name of FLAG_NAMES) {
    flags[name] = env[name] || '';
  }
  return flags;
}

/**
 * Which Xcode builds a store archive: the one `xcode-select -p` names, which
 * only an administrator can change (sudo xcode-select -s). DEVELOPER_DIR is
 * NOT passed to the build (decided 2026-10-02: a DEVELOPER_DIR naming a copy
 * of Xcode whose xcodebuild, clang or ld was swapped built the archive, and
 * `xcodebuild -version` still read the real version). ios-archive.sh unsets
 * it after the gate, and a DEVELOPER_DIR in the shell that is not the
 * selected Xcode (compared after resolving symlinks) is refused with no
 * override, so nobody believes they built with the Xcode it names.
 */
const XCODE_SELECT = '/usr/bin/xcode-select';

function readDeveloperDir(env) {
  let selected = null;
  try {
    selected =
      execFileSync(XCODE_SELECT, ['-p'], { encoding: 'utf8', env: {}, stdio: ['ignore', 'pipe', 'ignore'] }).trim() ||
      null;
  } catch {
    // not a Mac, or no Xcode selected: the archive itself will fail
  }
  const selectedReal = selected ? realOrNull(selected) : null;
  const given = env.DEVELOPER_DIR || null;
  const problems = [];
  if (given !== null) {
    const givenReal = realOrNull(given);
    if (givenReal === null || givenReal !== selectedReal) {
      problems.push(
        `DEVELOPER_DIR=${given} is not the Xcode xcode-select names (${selected || 'none'}); ` +
          'unset it (or choose that Xcode with sudo xcode-select -s)',
      );
    }
  }
  return { selected, selectedReal, developerDirEnv: given, problems };
}

/**
 * The ONLY environment xcodebuild and the Metro re-bundle run in
 * (ios-archive.sh starts both under `env -i` with these). xcodebuild hands
 * its whole environment to the compiler, the linker and every build phase,
 * so a variable in the caller's shell reaches the binary without touching a
 * file: XCODE_XCCONFIG_FILE adds an xcconfig to every target (an
 * OTHER_LDFLAGS = -force_load of any library), PODFILE_DIR moves the
 * .xcode.env React Native sources, and EXTRA_PACKAGER_ARGS, BUNDLE_COMMAND,
 * NODE_ARGS and friends change what is bundled (decided 2026-10-01). Kept:
 * what Xcode needs to find its tools, the signing identity and the locale,
 * plus the three build flags. DEVELOPER_DIR, TOOLCHAINS and SDKROOT are
 * NOT kept: they swap the Xcode or the toolchain that compiles and links
 * (readDeveloperDir). Every other name is recorded as dropped (names only;
 * values can be secrets).
 */
const BUILD_ENV_KEEP = [
  'HOME',
  'PATH',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'LANG',
  '__CF_USER_TEXT_ENCODING',
  ...FLAG_NAMES,
];

function buildEnv(env) {
  const kept = {};
  const dropped = [];
  for (const name of Object.keys(env).sort()) {
    if (env[name] === undefined) {
      continue;
    }
    if (BUILD_ENV_KEEP.includes(name) || /^LC_[A-Z]+$/.test(name)) {
      kept[name] = env[name];
    } else {
      dropped.push(name);
    }
  }
  return { kept, dropped };
}

/** Where `node` resolves for the build, and its digest. */
function nodeFor(kept, xcodeEnv) {
  const file = (xcodeEnv && xcodeEnv.nodeBinary) || nodeOnPath(kept.PATH);
  if (!file) {
    return { path: null, sha256: null };
  }
  const real = realOrNull(file) || file;
  return { path: file, realPath: real, sha256: shaOrNull(real) };
}

/**
 * The dependencies git does not hold and no pin covers: node_modules (every
 * JavaScript package Metro bundles and every native module's source) and
 * ios/Pods (the generated Pods project, its build phases and the prebuilt
 * React Native and Hermes binaries). Their content is NOT judged here (they
 * are made by npm ci, patch-package and pod install, and
 * no pin survives a reinstall); it is RECORDED, as one digest each over a
 * sorted manifest, so two archives of one commit can be compared and a
 * clean reinstall can be checked against an archive later. Read before the
 * build: the Hermes pod's own script may swap files in Pods during it.
 */
const DEPENDENCY_DIRS = [
  { dir: 'node_modules', skip: /^node_modules\/\.cache(\/|$)/ },
  { dir: 'ios/Pods', skip: /\/xcuserdata(\/|$)/ },
];

function dependencyDigests(root) {
  const out = {};
  for (const { dir, skip } of DEPENDENCY_DIRS) {
    const lines = [];
    const walk = (rel) => {
      let names;
      try {
        names = fs.readdirSync(path.join(root, rel)).sort();
      } catch {
        return;
      }
      for (const name of names) {
        const child = `${rel}/${name}`;
        if (skip.test(child)) {
          continue;
        }
        const abs = path.join(root, child);
        const st = fs.lstatSync(abs);
        if (st.isSymbolicLink()) {
          lines.push(`${sha256(`link:${fs.readlinkSync(abs)}`)}  ${child}`);
        } else if (st.isDirectory()) {
          walk(child);
        } else if (st.isFile()) {
          lines.push(`${sha256File(abs)}  ${child}`);
        }
      }
    };
    let present = false;
    try {
      present = fs.lstatSync(path.join(root, dir)).isDirectory();
    } catch {
      present = false;
    }
    if (present) {
      walk(dir);
    }
    out[dir] = present ? { sha256: sha256(lines.join('\n') + '\n'), files: lines.length } : null;
  }
  return out;
}

/** The value stamped into the app's Info.plist as TaliaSourceCommit. */
function stampFor(state) {
  if (!state.commit) {
    return 'unknown';
  }
  return state.dirty ? `${state.commit}-dirty` : state.commit;
}

/**
 * The archive's contents as a sorted manifest of "sha256  relative/path"
 * lines, and one digest over that manifest. The archive's top-level
 * Info.plist is left out on purpose: Xcode's Organizer writes the upload
 * history into it, and our own Talia-Provenance folder cannot hash itself.
 */
function archiveManifest(archive) {
  const lines = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const rel = path.relative(archive, abs).split(path.sep).join('/');
      if (rel === 'Info.plist' || rel === PROVENANCE_DIR) {
        continue;
      }
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) {
        lines.push(`${sha256(`link:${fs.readlinkSync(abs)}`)}  ${rel}`);
      } else if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile()) {
        lines.push(`${sha256File(abs)}  ${rel}`);
      }
    }
  };
  walk(archive);
  lines.sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : a.slice(66) > b.slice(66) ? 1 : 0));
  const manifest = lines.join('\n') + '\n';
  return { manifest, digest: sha256(manifest), files: lines.length };
}

function defaultLogPath(env) {
  return (
    env.TALIA_PROVENANCE_LOG ||
    path.join(os.homedir(), 'Library', 'Logs', 'Talia', 'archive-provenance.jsonl')
  );
}

/** Every parsable line of the log; a missing log reads as empty. */
function readLog(logPath) {
  let text;
  try {
    text = fs.readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    try {
      if (line.trim()) out.push(JSON.parse(line));
    } catch {
      // a torn line from an interrupted write: skip it
    }
  }
  return out;
}

function appendLog(logPath, entry) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

/**
 * Keep an exact copy of uncommitted source with a dirty (overridden)
 * archive: the diff against HEAD and every untracked file. The binary can
 * then be traced back to source even though that source is not in git.
 */
function saveDirtySource(root, outDir, state) {
  if (!state.isGit || !state.dirty) {
    return [];
  }
  const saved = [];
  // From the bytes on disk, through a scratch index made from HEAD, so no
  // index flag can leave a file out and no filter can rewrite one. The record
  // step already proved the checkout has not moved since the gate.
  const { changed } = compareTrackedFiles(root, state.commit, state.objectFormat || 'sha1');
  fs.writeFileSync(path.join(outDir, 'source.patch'), uncommittedDiff(root, changed));
  saved.push('source.patch');
  const untracked = state.untrackedFiles.map((f) => f.path);
  if (untracked.length > 0) {
    execFileSync('tar', ['-cf', path.join(outDir, 'untracked.tar'), '-C', root, '--', ...untracked]);
    saved.push('untracked.tar');
  }
  return saved;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function baseEntry(event, args, env) {
  return {
    schema: SCHEMA,
    event,
    at: new Date().toISOString(),
    name: args.name || null,
    flavour: args.flavour || null,
    flags: readFlags(env),
    builder: `${os.userInfo().username}@${os.hostname()}`,
  };
}

/** "    bdkwallet  <repo> @ <commit>" per library, for the gate and verify. */
function nativeSourceLines(sources) {
  if (!sources || sources.length === 0) {
    return ['    (not recorded)'];
  }
  return sources.map(
    (s) =>
      `    ${s.lib.padEnd(10)} ${s.repo} @ ${s.commit}` + (s.note ? ` (note: see ${NATIVE_PIN})` : ''),
  );
}

/**
 * A worktree that LINKS another checkout's node_modules is refused as an
 * untracked file (.gitignore's `node_modules/` matches folders only), and no
 * commit fixes it: pod install then writes that other checkout's path into
 * tracked files (REACT_NATIVE_PATH in the Xcode project, Podfile.lock's
 * ReactCodegen and hermes-engine checksums). An archive checkout keeps its
 * own node_modules (never a link to another checkout's), so the refusal says that
 * rather than suggest a commit or the override.
 */
function linkedNodeModulesLines(root, changes) {
  const abs = path.join(root, 'node_modules');
  const st = lstatOrNull(abs);
  if (!changes.includes('?? node_modules') || !st || !st.isSymbolicLink()) {
    return [];
  }
  return [
    `  node_modules links to ${realOrNull(abs) || fs.readlinkSync(abs)}.`,
    "  An archive needs this checkout's own: delete the link, run npm ci here,",
    '  then pod install in ios/.',
    '',
  ];
}

function cmdGate(args, env, root) {
  const state = readSourceState(root, env);
  state.developerDir = readDeveloperDir(env);
  const decision = gateDecision(state, env);
  const entry = {
    ...baseEntry(decision.allowed ? 'started' : 'refused', args, env),
    source: state,
    // The repo and commit each native library was built from (decided 2026-09-26),
    // as NATIVE_PIN records them; also in source.native.
    nativeSources: state.native ? state.native.sources : null,
    overrideAllowDirty: decision.override,
    stamp: stampFor(state),
    build: buildRecord(env, state),
    dependencies: decision.allowed ? dependencyDigests(root) : undefined,
  };
  appendLog(defaultLogPath(env), entry);
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(entry, null, 2));
  }
  if (decision.stockBdk) {
    process.stderr.write(
      [
        '✗ Refusing to archive: the app would not link our own native libraries in place.',
        ...(state.native && state.native.bdkLinked.sha256 === null ? [`    ${BDK_FORK_LIB} is missing`] : []),
        ...((state.native && state.native.podLinks) || []).flatMap((l) => l.problems.map((p) => `    ${p}`)),
        ...Object.keys(NATIVE_SOURCES).map(
          (lib) => `  ${NATIVE_SOURCES[lib].podspec} must vendor ${linkedLibOf(lib)} itself and nothing else.`,
        ),
        '  A stock bdk-ffi lacks the fork\'s vault policy paths, its panics as',
        '  catchable errors and its timelock checks. Rebuild a missing library',
        `  with its build script (${Object.values(NATIVE_SOURCES)
          .map((s) => s.build)
          .join(', ')}),`,
        '  and put back its podspec as committed. There is no override for this.',
        '',
      ].join('\n'),
    );
    return 3;
  }
  if (decision.nativeSources) {
    process.stderr.write(
      [
        '✗ Refusing to archive: the native libraries cannot be traced to a commit in our repos.',
        '',
        ...decision.nativeSources.map((p) => `    native-source: ${p}`),
        '',
        `  ${NATIVE_PIN} must name, beside each library's pins, the 21st Capital`,
        '  repo and the full commit its pinned files were built from, and the',
        '  digest of each file that build wrote, which must be the pinned one:',
        ...Object.entries(NATIVE_SOURCES).map(([lib, s]) => `    # source ${lib} ${s.repo} <commit>`),
        '  The build scripts write those lines themselves after a build from a',
        `  clean commit on the library's own branch (${Object.values(NATIVE_SOURCES)
          .map((s) => s.build)
          .join(', ')}),`,
        '  and `node scripts/native-sources.js pin <library>` pins exactly those',
        '  files once they are tested. A pin edited by hand, or a record kept while',
        '  the libraries were put back, is refused here: rebuild, or restore the',
        `  record and the pins together (git checkout -- ${NATIVE_PIN}).`,
        '  There is no override for this.',
        '',
      ].join('\n'),
    );
    return 3;
  }
  if (decision.nativeLibs) {
    process.stderr.write(
      [
        '✗ Refusing to archive: a native library is not the one pinned, so nothing',
        '  says which commit it was built from.',
        '',
        ...decision.nativeLibs.map((p) => `    native: ${p}`),
        '',
        '  Put the pinned library back (build it with its build script from the',
        '  commit its source line names), or, once a new build is tested, pin it',
        '  with `node scripts/native-sources.js pin <library>` and commit the',
        `  record and the pins together (${NATIVE_PIN}).`,
        '  There is no override for this.',
        '',
      ].join('\n'),
    );
    return 3;
  }
  if (decision.toolCrates) {
    process.stderr.write(
      [
        '✗ Refusing to archive: a native library carries code that is not part of it.',
        '',
        ...decision.toolCrates.map((p) => `    native: ${p}`),
        '',
        '  The fork must give uniffi\'s "cli" feature to its uniffi-bindgen binary',
        '  alone ([[bin]] required-features), then the library is built again and',
        '  pinned. There is no override for this.',
        '',
      ].join('\n'),
    );
    return 3;
  }
  if (decision.buildInstructions) {
    process.stderr.write(
      [
        '✗ Refusing to archive: Xcode would follow instructions or link files that are not in git.',
        '',
        ...decision.buildInstructions.map((p) => `    ${p}`),
        '',
        '  ios/.xcode.env.local is run as shell during the build, so it may hold one',
        '  line, export NODE_BINARY=<the node on your PATH>, or be deleted. A scheme',
        '  runs its own scripts, so only the shared KeelWallet scheme may exist:',
        '  delete the other one (and any symlink Xcode would follow). The native',
        `  lib folders may hold only the libraries pinned in ${NATIVE_PIN}: delete`,
        '  anything else there. DEVELOPER_DIR must be unset (Xcode is the one',
        '  xcode-select names). There is no override for this.',
        '',
      ].join('\n'),
    );
    return 3;
  }
  if (!decision.allowed) {
    process.stderr.write(
      [
        '✗ Refusing to archive: the checkout has changes that are not committed.',
        '  An App Store or TestFlight build must come from a commit, so the',
        '  binary can always be traced back to source that exists in git.',
        '',
        ...state.changes.slice(0, 40).map((c) => `    ${c}`),
        state.changes.length > 40 ? `    ... and ${state.changes.length - 40} more` : '',
        '',
        ...linkedNodeModulesLines(root, state.changes),
        '  Commit (or stash) them and run the archive again.',
        '  To archive anyway, set TALIA_ARCHIVE_ALLOW_DIRTY to the reason; the',
        '  reason, this list and the full diff are then kept with the archive and',
        '  in the log.',
        '',
      ]
        .filter((l, i, all) => l !== '' || all[i - 1] !== '')
        .join('\n'),
    );
    return 3;
  }
  const { kept, dropped } = buildEnv(env);
  const notable = dropped.filter((n) => NOTABLE_DROPPED.test(n));
  process.stderr.write(
    [
      '  Native libraries, as built from:',
      ...nativeSourceLines(entry.nativeSources),
      `  Xcode and Metro run with only: ${Object.keys(kept).join(' ')}.`,
      `  ${dropped.length} other variable(s) of this shell are left out (names in the record).`,
      ...(notable.length > 0 ? [`  Left out on purpose, as they change a build: ${notable.join(' ')}`] : []),
      '',
    ].join('\n'),
  );
  process.stdout.write(entry.stamp + '\n');
  return 0;
}

/** Dropped names worth saying out loud: each of these would change a build. */
const NOTABLE_DROPPED =
  /XCCONFIG|^XCODE_|^RCT_|^PODFILE|BUNDLE|^NODE_|HERMES|ENTRY_FILE|CONFIG_JSON|PACKAGER|^SDKROOT$|^DEVELOPER_DIR$|^TOOLCHAINS$|FLAGS$|^CC$|^CXX$|^LD$|^GIT_|^DYLD_|^TALIA_/;

/** What the build itself ran with: the kept environment, the dropped names, node. */
function buildRecord(env, state) {
  const { kept, dropped } = buildEnv(env);
  return { env: kept, droppedEnv: dropped, node: nodeFor(kept, state.xcodeEnv) };
}

/** NUL-separated NAME=value pairs for ios-archive.sh's `env -i`. */
function cmdBuildEnv(env) {
  const { kept } = buildEnv(env);
  process.stdout.write(Object.entries(kept).map(([k, v]) => `${k}=${v}\0`).join(''));
  return 0;
}

function cmdRecord(args, env, root) {
  const started = JSON.parse(fs.readFileSync(args.state, 'utf8'));
  const archive = args.archive;
  const after = readSourceState(root, env);
  // The tree must not move while Xcode reads it: another session editing a
  // file mid-archive would put code in the binary that the record does not
  // describe.
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const moved =
    after.commit !== started.source.commit ||
    after.dirty !== started.source.dirty ||
    after.diffSha256 !== started.source.diffSha256 ||
    !same(after.changes, started.source.changes) ||
    // diffSha256 covers tracked files only; an untracked file (overridden
    // archive) or a native library edited mid-archive must count too.
    !same(after.untrackedFiles, started.source.untrackedFiles) ||
    !same(after.native, started.source.native) ||
    !same(after.xcodeEnv, started.source.xcodeEnv) ||
    !same(after.xcodeSchemes, started.source.xcodeSchemes) ||
    after.treeMatchesCommit !== started.source.treeMatchesCommit;
  const outDir = path.join(archive, PROVENANCE_DIR);
  fs.mkdirSync(outDir, { recursive: true });
  const { manifest, digest, files } = archiveManifest(archive);
  fs.writeFileSync(path.join(outDir, 'archive-manifest.txt'), manifest);
  const entry = {
    ...started,
    event: moved ? 'refused' : 'verified',
    at: new Date().toISOString(),
    startedAt: started.at,
    refusal: moved ? 'the source changed while the archive was being built' : undefined,
    sourceAfter: moved ? after : undefined,
    archive: {
      path: archive,
      sha256: digest,
      files,
      manifest: `${PROVENANCE_DIR}/archive-manifest.txt`,
    },
    app: {
      bundleId: args['bundle-id'] || null,
      displayName: args['display-name'] || null,
      version: args.version || null,
      build: args.build || null,
      team: args.team || null,
      infoPlistSourceCommit: args['plist-commit'] || null,
    },
    javascript: {
      plainSha256: args['plain-sha'] || null,
      hermesSha256: args['hermes-sha'] || null,
      xcodePlainPath: args['xcode-js'] || null,
      flagsReadBack: args['flags-read'] || null,
      reproducedFromSource: args.reproduced === 'yes',
    },
    toolchain: {
      xcode: args.xcode || null,
      node: process.version,
      hermescSha256: args['hermesc-sha'] || null,
    },
  };
  entry.savedSource = saveDirtySource(root, outDir, started.source);
  fs.writeFileSync(path.join(outDir, 'provenance.json'), JSON.stringify(entry, null, 2) + '\n');
  appendLog(defaultLogPath(env), entry);
  if (moved) {
    process.stderr.write(
      '✗ The source changed while the archive was being built. Its contents are\n' +
        '  not what the record describes. Not safe to upload.\n',
    );
    return 4;
  }
  process.stdout.write(`${digest}\n`);
  return 0;
}

/** ios-archive.sh refused after the gate: say so in the log, with why. */
function cmdRefused(args, env) {
  const started = JSON.parse(fs.readFileSync(args.state, 'utf8'));
  appendLog(defaultLogPath(env), {
    ...started,
    event: 'refused',
    at: new Date().toISOString(),
    startedAt: started.at,
    refusal: args.reason || 'unknown',
    archive: args.archive ? { path: args.archive } : undefined,
  });
  return 0;
}

function cmdVerify(args, env) {
  const archive = args._[1];
  const file = path.join(archive || '', PROVENANCE_DIR, 'provenance.json');
  if (!archive || !fs.existsSync(file)) {
    process.stderr.write(`✗ No provenance record in ${archive}. Not made by ios-archive.sh.\n`);
    return 2;
  }
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { digest } = archiveManifest(archive);
  // The record inside the archive could be rewritten together with the
  // archive, so it must also agree with this Mac's log, written when the
  // archive was made: same archive (name and start time), same digest.
  const logged = readLog(defaultLogPath(env)).filter(
    (e) => e.event === 'verified' && e.name === rec.name && e.startedAt === rec.startedAt,
  );
  const logDigest = logged.length > 0 ? logged[logged.length - 1].archive.sha256 : null;
  const ok = rec.event === 'verified' && digest === rec.archive.sha256 && logDigest === rec.archive.sha256;
  appendLog(defaultLogPath(env), {
    schema: SCHEMA,
    event: ok ? 'reverified' : 'mismatch',
    at: new Date().toISOString(),
    name: rec.name,
    archive: archive,
    recorded: rec.archive.sha256,
    now: digest,
  });
  const lines = [
    `  commit   ${rec.source.commit}${rec.source.dirty ? ' (DIRTY: ' + rec.overrideAllowDirty + ')' : ''}`,
    `  flavour  ${rec.flavour}  (${FLAG_NAMES.map((n) => `${n}=${rec.flags[n] || 0}`).join(' ')})`,
    // Archives made while the engine was a per-flavour constant (until
    // the old engine's removal, decided 2026-11-04) recorded which one.
    ...(rec.javascript && rec.javascript.engineReadBack ? [`  engine   ${rec.javascript.engineReadBack}`] : []),
    `  app      ${rec.app.bundleId} ${rec.app.version} (${rec.app.build})`,
    `  JS       ${rec.javascript.hermesSha256} (Hermes), ${rec.javascript.plainSha256} (plain)`,
    '  native   built from',
    ...nativeSourceLines(rec.nativeSources || (rec.source.native && rec.source.native.sources)).map(
      (l) => `  ${l}`,
    ),
    `  archive  recorded ${rec.archive.sha256}`,
    `           now      ${digest}`,
    `           log      ${logDigest || '(no entry for this archive in ' + defaultLogPath(env) + ')'}`,
  ];
  if (!ok) {
    process.stderr.write(
      ['✗ This archive does not match its record. Not safe to upload.', ...lines, ''].join('\n'),
    );
    return 5;
  }
  process.stdout.write(['✓ Archive matches its record.', ...lines, ''].join('\n'));
  return 0;
}

function main(argv, env, root = path.resolve(__dirname, '..')) {
  const args = parseArgs(argv);
  switch (args._[0]) {
    case 'gate':
      return cmdGate(args, env, root);
    case 'record':
      return cmdRecord(args, env, root);
    case 'refused':
      return cmdRefused(args, env);
    case 'verify':
      return cmdVerify(args, env);
    case 'build-env':
      return cmdBuildEnv(env);
    default:
      process.stderr.write('usage: archive-provenance.js gate|record|refused|verify|build-env ...\n');
      return 64;
  }
}

module.exports = {
  PROVENANCE_DIR,
  NATIVE_PIN,
  NATIVE_SOURCES,
  BDK_FORK_LIB,
  BDK_POD_SPEC,
  BDK_POD_VENDORS,
  POD_ATTRIBUTES,
  linkedLibOf,
  RETIRED_NATIVE_LIBS,
  isRetiredLib,
  isRetiredLibFile,
  readPodLink,
  readSourceState,
  readNativeState,
  arMemberNames,
  toolCrateFindings,
  toolCratesIn,
  ffiStructProblems,
  parseNativeSources,
  parsePins,
  libOfPath,
  // The trusted git checks, for scripts/native-sources.js.
  git,
  tryGit,
  compareTrackedFiles,
  readUntracked,
  readDeveloperDir,
  gitEnv,
  NATIVE_LIB_DIRS,
  readXcodeEnv,
  readXcodeSchemes,
  dependencyDigests,
  buildEnv,
  EXPECTED_IGNORED,
  gateDecision,
  readFlags,
  stampFor,
  archiveManifest,
  appendLog,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
