/**
 * scripts/archive-provenance.js: the provenance half of ios-archive.sh
 * (decided 2026-09-26). Every test runs against a throwaway git repository
 * and a fake .xcarchive in the OS temp folder, and a private log file.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

type Entry = Record<string, any>;
type Env = Record<string, string | undefined>;
const prov = require('../archive-provenance.js') as {
  PROVENANCE_DIR: string;
  readSourceState: (root: string, env?: Env) => Entry;
  gateDecision: (
    state: Entry,
    env: Env,
  ) => {
    allowed: boolean;
    override: string | null;
    buildInstructions?: string[];
    nativeSources?: string[];
    nativeLibs?: string[];
  };
  dependencyDigests: (root: string) => Record<string, { sha256: string; files: number } | null>;
  stampFor: (state: Entry) => string;
  buildEnv: (env: Env) => { kept: Record<string, string>; dropped: string[] };
  archiveManifest: (archive: string) => { manifest: string; digest: string; files: number };
  main: (argv: string[], env: Env, root?: string) => number;
  readDeveloperDir: (env: Env) => { selected: string | null; problems: string[] };
  gitEnv: (extra?: Env) => Record<string, string>;
  parseNativeSources: (text: string | null) => { sources: Entry[]; problems: string[] };
  RETIRED_NATIVE_LIBS: Record<string, { files: string[] }>;
  NATIVE_PIN: string;
  NATIVE_SOURCES: Record<
    string,
    {
      repo: string;
      branch: string;
      libDir: string;
      ignore: string;
      files: string[];
      generated: string[];
      build: string;
      podspec: string;
      vendors: string;
      judgePod: boolean;
      fullRecord: boolean;
    }
  >;
  NATIVE_LIB_DIRS: string[];
  EXPECTED_IGNORED: RegExp[];
  BDK_FORK_LIB: string;
  BDK_POD_SPEC: string;
  BDK_POD_VENDORS: string;
  readPodLink: (root: string, lib: string) => { lib: string; podspec: string; problems: string[] };
  linkedLibOf: (lib: string) => string;
};

// The public repos the libraries are built from (decided 2026-11-06).
const BDK_REPO = 'https://github.com/21st-Capital/talia-bdk-ffi';
const BITBOX_REPO = 'https://github.com/21st-Capital/talia-bitbox-ffi';
// The private repos they are developed in, which the record named before.
const BDK_PRIVATE_REPO = 'https://github.com/21st-Capital/bdk-ffi-fork';
const BITBOX_PRIVATE_REPO = 'https://github.com/21st-Capital/bitbox-ffi';
const BITBOX_COMMIT = 'b2'.repeat(20);
const BITBOX_LIB = 'native/bitboxffi/lib/libbitboxffi-ios.a';
const sha = (text: string) => require('crypto').createHash('sha256').update(text).digest('hex');
/**
 * The podspecs this repo commits (every library's pod is checked, decided
 * 2026-10-16). The fixture links the fork through the TaliaBdkWallet pod (POD_SPEC):
 * the Bitcoin core since the old engine's removal (decided 2026-11-04)
 * took its TaliaBdk pod.
 */
const POD_SPECS: [string, string][] = Object.keys(prov.NATIVE_SOURCES).map((lib) => [
  prov.NATIVE_SOURCES[lib].podspec,
  fs.readFileSync(path.join(__dirname, '..', '..', prov.NATIVE_SOURCES[lib].podspec), 'utf8'),
]);
const POD_SPEC = (POD_SPECS.find(([spec]) => spec === prov.BDK_POD_SPEC) as [string, string])[1];
/** The "# built" line a build of `lib` writes for a file of `content`. */
const built = (lib: string, content: string, file: string) => `# built ${lib} ${sha(content)} ${file}\n`;
const BITBOX_BUILT = built('bitboxffi', 'bitbox', BITBOX_LIB);
/**
 * The wallet library (BDK upgrade): its record also names the
 * tracked files its build wrote (the bindings, the duplicate list) and the
 * Xcode; the fixture writes those files with these contents. It is the
 * Bitcoin core the app links in place (prov.BDK_FORK_LIB) since 2026-11-04.
 */
const WALLET_COMMIT = 'd4'.repeat(20);
const WALLET_LIB = 'native/bdkwallet/lib/libbdkwallet-ios.a';
const WALLET_GENERATED: [string, string][] = [
  ['native/bdkwallet/BitcoinDevKit.swift', 'wallet swift'],
  ['native/bdkwallet/ffi/BitcoinDevKitFFI.h', 'wallet header'],
  ['native/bdkwallet/duplicate-symbols.txt', 'ios _dup\n'],
];
const WALLET =
  `# source bdkwallet ${BDK_REPO} ${WALLET_COMMIT}\n${built('bdkwallet', 'wallet', WALLET_LIB)}` +
  WALLET_GENERATED.map(([f, c]) => `# generated bdkwallet ${sha(c)} ${f}\n`).join('') +
  '# xcode bdkwallet 27.1 27A9275\n' +
  // The other library's pinned files its overlap gate judged (decided 2026-10-17).
  `# gated bdkwallet ${sha('bitbox')} ${BITBOX_LIB}\n`;
const WALLET_PIN = `${sha('wallet')}  ${WALLET_LIB}\n`;
/**
 * Where each native library was built from (decided 2026-09-26), as the build
 * scripts write it: the commit, and the digest of each file that build wrote
 * (the fixture's libraries, as pinned).
 */
const SOURCE_LINES = `# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\n${BITBOX_BUILT}` + WALLET;
/** The fixture's pins, each its recorded build's file. */
const PIN_LINES = `${sha('bitbox')}  ${BITBOX_LIB}\n${WALLET_PIN}`;

let tmp: string;
let repo: string;
let archive: string;
let log: string;
let env: Env;
let nodeBin: string;

function git(...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8' },
  ).trim();
}

/** Write a file under the fake repo, making its folder. */
function put(rel: string, text: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}

function logLines(): Entry[] {
  return fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
}

function run(argv: string[], extraEnv: Env = {}): number {
  return prov.main(argv, { ...env, ...extraEnv }, repo);
}

function gate(extraEnv: Env = {}): number {
  return run(['gate', '--out', path.join(tmp, 'state.json'), '--name', 'Build 21', '--flavour', 'signing'], extraEnv);
}

function record(): number {
  return run([
    'record',
    '--state', path.join(tmp, 'state.json'),
    '--archive', archive,
    '--name', 'Build 21',
    '--flavour', 'signing',
    '--bundle-id', 'com.twentyfirstcapital.keel',
    '--plain-sha', 'a'.repeat(64),
    '--hermes-sha', 'b'.repeat(64),
    '--flags-read', 'false true false',
    '--reproduced', 'yes',
  ]);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'talia-prov-'));
  repo = path.join(tmp, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  // The real repo's rules for the paths these tests use.
  fs.writeFileSync(
    path.join(repo, '.gitignore'),
    'build/\nnode_modules/\nnative/*/lib/\nios/build-device/\n**/.xcode.env.local\nxcuserdata\n.devices.local\n',
  );
  // The native libraries git does not hold, pinned by a tracked file, and
  // the pod that links the fork's bdk-ffi in place.
  put(BITBOX_LIB, 'bitbox');
  put(WALLET_LIB, 'wallet');
  for (const [spec, text] of POD_SPECS) {
    put(spec, text);
  }
  for (const [file, text] of WALLET_GENERATED) {
    put(file, text);
  }
  put(
    prov.NATIVE_PIN,
    `# pins\n${SOURCE_LINES}${PIN_LINES}`,
  );
  git('add', '.');
  git('commit', '-qm', 'first');
  archive = path.join(tmp, 'Build 21.xcarchive');
  const app = path.join(archive, 'Products', 'Applications', 'KeelWallet.app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'main.jsbundle'), 'bytecode');
  fs.writeFileSync(path.join(app, 'KeelWallet'), 'executable');
  fs.writeFileSync(path.join(archive, 'Info.plist'), 'archive plist');
  log = path.join(tmp, 'logs', 'archive-provenance.jsonl');
  // The node on the build's PATH (a stand-in; nothing runs it).
  fs.mkdirSync(path.join(tmp, 'bin'));
  nodeBin = path.join(tmp, 'bin', 'node');
  fs.writeFileSync(nodeBin, '#!/bin/sh\n');
  fs.chmodSync(nodeBin, 0o755);
  env = { TALIA_PROVENANCE_LOG: log, TALIA_HWW: '1', PATH: path.join(tmp, 'bin') };
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
  // git 2.4x+ may still be running its detached auto-maintenance in a test repo
  // (found 2026-10-22: ENOTEMPTY under a full parallel run), so the removal retries.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('the source state', () => {
  it('is clean on a fresh commit and names it', () => {
    const state = prov.readSourceState(repo);
    expect(state.dirty).toBe(false);
    expect(state.commit).toBe(git('rev-parse', 'HEAD'));
    expect(prov.stampFor(state)).toBe(state.commit);
  });

  it('counts an edited and an untracked file, but not build output where it belongs', () => {
    put('ios/build-device/out.js', 'ignored build output');
    let clean = prov.readSourceState(repo);
    expect(clean.dirty).toBe(false);
    expect(clean.treeMatchesCommit).toBe(true);
    expect(clean.ignoredExpected).toContainEqual({ path: 'ios/build-device/', rule: '.gitignore' });

    // The phone list scripts/ios-device.sh reads sits at the root, ignored.
    put('.devices.local', 'default=phone-id\n');
    clean = prov.readSourceState(repo);
    expect(clean.dirty).toBe(false);
    expect(clean.ignoredExpected).toContainEqual({ path: '.devices.local', rule: '.gitignore' });

    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 2;\n');
    let state = prov.readSourceState(repo);
    expect(state.dirty).toBe(true);
    expect(state.changes).toEqual([' M src/a.ts']);
    expect(state.treeMatchesCommit).toBe(false);
    expect(state.diffSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(prov.stampFor(state)).toBe(`${state.commit}-dirty`);

    git('checkout', '--', 'src/a.ts');
    fs.writeFileSync(path.join(repo, 'src', 'new.ts'), 'export const b = 1;\n');
    state = prov.readSourceState(repo);
    expect(state.dirty).toBe(true);
    expect(state.untrackedFiles).toEqual([
      { path: 'src/new.ts', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);

    // Staging changes nothing: what counts is the disk against the commit.
    git('add', 'src/new.ts');
    expect(prov.readSourceState(repo).changes).toEqual(['?? src/new.ts']);
  });

  it('records a Markdown-only change without counting it (it cannot reach the app)', () => {
    fs.writeFileSync(path.join(repo, 'TRACKER.md'), '# tracker\n');
    git('add', 'TRACKER.md');
    git('commit', '-qm', 'tracker');
    fs.appendFileSync(path.join(repo, 'TRACKER.md'), '- a line\n');
    fs.writeFileSync(path.join(repo, 'notes.md'), 'scratch\n');
    let state = prov.readSourceState(repo);
    expect(state.dirty).toBe(false);
    expect(state.docChanges).toEqual([' M TRACKER.md', '?? notes.md']);
    expect(prov.gateDecision(state, {}).allowed).toBe(true);

    fs.writeFileSync(path.join(repo, 'src', 'readme.md.ts'), 'export {};\n');
    state = prov.readSourceState(repo);
    expect(state.dirty).toBe(true);
    expect(state.changes).toEqual(['?? src/readme.md.ts']);
  });

  it('checks the pinned native libraries and records their digests', () => {
    const state = prov.readSourceState(repo);
    expect(state.dirty).toBe(false);
    expect(state.native.bdkForkLinked).toBe(true);
    expect(prov.BDK_FORK_LIB).toBe(WALLET_LIB);
    expect(state.native.bdkLinked).toEqual({
      path: prov.BDK_FORK_LIB,
      sha256: sha('wallet'),
      podspec: prov.BDK_POD_SPEC,
      problems: [],
    });
    expect(state.native.libs).toEqual([
      { path: BITBOX_LIB, pinned: sha('bitbox'), sha256: sha('bitbox') },
      { path: WALLET_LIB, pinned: sha('wallet'), sha256: sha('wallet') },
    ]);
    expect(state.native.podLinks.map((l: Entry) => [l.lib, l.path, l.problems])).toEqual(
      Object.keys(prov.NATIVE_SOURCES).map((lib) => [lib, prov.linkedLibOf(lib), []]),
    );
    expect(state.native.generated).toEqual(
      WALLET_GENERATED.map(([file, text]) => ({ lib: 'bdkwallet', path: file, recorded: sha(text), sha256: sha(text) })),
    );
  });

  it('refuses generated bindings that are not the ones the recorded build wrote, with no override', () => {
    // uniffi 0.31 compares the bindings with the library at the first call
    // and calls fatalError when they differ.
    put('native/bdkwallet/BitcoinDevKit.swift', 'wallet swift, edited');
    git('commit', '-qam', 'edit the bindings');
    const state = prov.readSourceState(repo);
    const problem =
      `native/bdkwallet/BitcoinDevKit.swift is ${sha('wallet swift, edited')}, but the build of bdkwallet from ` +
      `${WALLET_COMMIT} wrote ${sha('wallet swift')}: the generated files and the library are out of step`;
    expect(state.native.problems).toEqual([problem]);
    const decision = prov.gateDecision(state, { TALIA_ARCHIVE_ALLOW_DIRTY: 'please' });
    expect(decision.allowed).toBe(false);
    expect(decision.nativeLibs).toEqual([problem]);
  });

  it('refuses a new library\'s record without its generated files or its Xcode, and a partial one for any library', () => {
    const noXcode = SOURCE_LINES.replace('# xcode bdkwallet 27.1 27A9275\n', '');
    expect(prov.parseNativeSources(`${noXcode}${PIN_LINES}`).problems).toEqual([
      'no "# xcode bdkwallet <version> <build>" line: the record does not say which Xcode compiled bdkwallet\'s C code',
    ]);
    const noHeader = SOURCE_LINES.split('\n').filter((l) => !l.includes('BitcoinDevKitFFI.h')).join('\n');
    expect(prov.parseNativeSources(`${noHeader}${PIN_LINES}`).problems.join('\n')).toContain(
      'no "# generated bdkwallet <sha256> native/bdkwallet/ffi/BitcoinDevKitFFI.h" line',
    );
    // A library from before 2026-10-16 may carry none, but not half of them.
    const half = `${SOURCE_LINES}# generated bitboxffi ${sha('x')} native/bitboxffi/bitbox.swift\n`;
    expect(prov.parseNativeSources(`${half}${PIN_LINES}`).problems).toEqual([
      'no "# generated bitboxffi <sha256> native/bitboxffi/ffi/bitboxFFI.h" line: the record does not say which native/bitboxffi/ffi/bitboxFFI.h that build wrote',
    ]);
    for (const [bad, says] of [
      [`# generated bdkwallet ${sha('x')} native/bdkwallet/other.swift\n`, "bdkwallet's build does not write native/bdkwallet/other.swift"],
      [`# generated bdkwallet ${sha('x')}\n`, 'is not "# generated'],
      ['# xcode bdkwallet 27.1\n', 'is not "# xcode'],
      ['# xcode bdkwallet 27.1 27A9275\n', 'a second "# xcode" line for bdkwallet'],
      [`# generated bdkwallet ${sha('x')} native/bdkwallet/BitcoinDevKit.swift\n`, 'a second "# generated" line'],
    ] as [string, string][]) {
      expect(prov.parseNativeSources(`${SOURCE_LINES}${bad}${PIN_LINES}`).problems.join('\n')).toContain(says);
    }
  });

  it('refuses a native library that differs from its pin, with no override (decided 2026-10-05)', () => {
    put(BITBOX_LIB, 'rebuilt bitbox');
    const state = prov.readSourceState(repo);
    expect(state.dirty).toBe(true);
    const problem = `${BITBOX_LIB} is ${sha('rebuilt bitbox')}, pinned ${sha('bitbox')}`;
    expect(state.changes).toEqual([`!! native: ${problem}`]);
    expect(prov.gateDecision(state, {}).allowed).toBe(false);
    // The record names the commit of the PINNED file; this one comes from no
    // commit anything records, so the override must not let it ship.
    const decision = prov.gateDecision(state, { TALIA_ARCHIVE_ALLOW_DIRTY: 'new BitBox lib' });
    expect(decision.allowed).toBe(false);
    expect(decision.override).toBeNull();
    expect(decision.nativeLibs).toEqual([problem]);
  });

  it('counts a missing library and a missing pin file', () => {
    expect(prov.parseNativeSources(`${SOURCE_LINES}${PIN_LINES}`).problems).toEqual([]);
    fs.rmSync(path.join(repo, BITBOX_LIB));
    expect(prov.readSourceState(repo).changes).toEqual([
      `!! native: ${BITBOX_LIB} is missing, pinned ${sha('bitbox')}`,
    ]);
    fs.rmSync(path.join(repo, prov.NATIVE_PIN));
    const changes = prov.readSourceState(repo).changes;
    expect(changes).toContain(`!! native: ${prov.NATIVE_PIN} is missing`);
    expect(changes).toContain(`!! native: ${prov.NATIVE_PIN} does not pin ${prov.BDK_FORK_LIB}`);
  });

  it.each([
    ['another library', POD_SPEC.replace('"lib/libbdkwallet-ios.a"', '"stock/bdkFFI.a"')],
    ['a framework beside it', POD_SPEC.replace(prov.BDK_POD_VENDORS, `${prov.BDK_POD_VENDORS}\n  s.vendored_frameworks = "bdkFFI.xcframework"`)],
    ['a second vendoring line', `${POD_SPEC}\ns.vendored_libraries = "lib/libbdkwallet-ios.a", "stock/libbdk.a"\n`],
    ['no library at all', POD_SPEC.replace(prov.BDK_POD_VENDORS, '')],
    ['the app\'s own link flags', POD_SPEC.replace('s.dependency', 's.user_target_xcconfig = { "OTHER_LDFLAGS" => "-force_load /tmp/stock.a" }\n  s.dependency')],
    ['a library folder for the app', POD_SPEC.replace('s.dependency', 's.xcconfig = { "LIBRARY_SEARCH_PATHS" => "/tmp" }\n  s.dependency')],
    // Decided 2026-10-07: each of these changed the library the app links and
    // passed the old check, which looked only for vendored_ lines and linker
    // settings. The podspec is now read as a short list of allowed statements.
    ['a system library named like the simulator one', POD_SPEC.replace('s.dependency', 's.libraries = "bdkwallet-sim"\n  s.dependency')],
    ['a framework the app links', POD_SPEC.replace('s.dependency', 's.frameworks = "bdkFFI"\n  s.dependency')],
    ['a weak framework', POD_SPEC.replace('s.dependency', 's.weak_frameworks = "bdkFFI"\n  s.dependency')],
    [
      'a script that swaps the library before the compile',
      POD_SPEC.replace(
        's.dependency',
        's.script_phases = [{ :name => "swap", :script => "cp /tmp/stock.a ${PODS_TARGET_SRCROOT}/lib/libbdkwallet-ios.a", :execution_position => :before_compile }]\n  s.dependency',
      ),
    ],
    ['a prepare command', POD_SPEC.replace('s.dependency', 's.prepare_command = "cp /tmp/stock.a lib/libbdkwallet-ios.a"\n  s.dependency')],
    ['an interpolated linker setting', POD_SPEC.replace('"SWIFT_INCLUDE_PATHS"', '"OTHER_#{\'LD\'}FLAGS" => "-force_load /tmp/stock.a",\n    "SWIFT_INCLUDE_PATHS"')],
    ['a "#@" interpolation', POD_SPEC.replace('s.version      = "3.1.1"', 's.version      = "3.1.1#@x"')],
    ['a second setting in the pod\'s own hash', POD_SPEC.replace('"SWIFT_INCLUDE_PATHS"', '"OTHER_LDFLAGS" => "-lbdkwallet-sim",\n    "SWIFT_INCLUDE_PATHS"')],
    ['a platform-scoped vendoring line', POD_SPEC.replace('s.dependency', 's.ios.vendored_frameworks = "bdkFFI.xcframework"\n  s.dependency')],
    ['a dependency on another pod', POD_SPEC.replace('s.dependency "React-Core"', 's.dependency "React-Core"\n  s.dependency "BitcoinDevKit"')],
    ['a download as the source', POD_SPEC.replace('{ :path => "." }', '{ :git => "https://example.com/bdk.git" }')],
    ['a statement split over two lines', POD_SPEC.replace('"BitcoinDevKit.swift", "bridge', '"BitcoinDevKit.swift",\n    "bridge')],
    ['code before the spec', `system("cp /tmp/stock.a native/bdkwallet/lib/libbdkwallet-ios.a")\n${POD_SPEC}`],
    ['code after the spec', `${POD_SPEC}\nPod::Spec.new do |t|\nend\n`],
    ['a single-quoted string', POD_SPEC.replace('s.version      = "3.1.1"', "s.version      = '3.1.1'")],
  ])('refuses a pod that would not link the fork in place (%s), even with the override', (_what, text) => {
    put(prov.BDK_POD_SPEC, text);
    const state = prov.readSourceState(repo);
    expect(state.native.bdkForkLinked).toBe(false);
    expect(state.native.bdkLinked.problems.length).toBeGreaterThan(0);
    const decision = prov.gateDecision(state, { TALIA_ARCHIVE_ALLOW_DIRTY: 'please' });
    expect(decision.allowed).toBe(false);
    expect(decision.override).toBeNull();
  });

  it.each(['bitboxffi', 'bdkwallet'])('checks the %s pod: its one vendoring line, linked in place', (lib) => {
    const spec = prov.NATIVE_SOURCES[lib].podspec;
    const text = (POD_SPECS.find(([s]) => s === spec) as [string, string])[1];
    put(spec, text.replace(prov.NATIVE_SOURCES[lib].vendors, 's.vendored_libraries = "stock/libbdk.a"'));
    const state = prov.readSourceState(repo);
    expect(state.native.bdkForkLinked).toBe(false);
    expect(state.native.podLinks.find((l: Entry) => l.lib === lib).problems).toEqual([
      `${spec} must vendor exactly one library, ${prov.NATIVE_SOURCES[lib].vendors}; it has: s.vendored_libraries = "stock/libbdk.a"`,
    ]);
    expect(prov.gateDecision(state, { TALIA_ARCHIVE_ALLOW_DIRTY: 'please' }).allowed).toBe(false);
  });

  it('reads the TaliaBdkWallet pod as data, and the BitBox pod by its vendoring line alone', () => {
    const wallet = prov.NATIVE_SOURCES.bdkwallet.podspec;
    const text = (POD_SPECS.find(([s]) => s === wallet) as [string, string])[1];
    put(wallet, text.replace('s.dependency', 's.libraries = "bdkwallet-sim"\n  s.dependency'));
    expect(prov.readPodLink(repo, 'bdkwallet').problems.join('\n')).toContain(
      'is not a statement the TaliaBdkWallet pod may hold: s.libraries = "bdkwallet-sim"',
    );
    expect(prov.NATIVE_SOURCES.bitboxffi.judgePod).toBe(false);
    expect(prov.readPodLink(repo, 'bitboxffi').problems).toEqual([]);
  });

  it('refuses outright when the fork library is missing, even with the override', () => {
    fs.rmSync(path.join(repo, prov.BDK_FORK_LIB));
    const state = prov.readSourceState(repo);
    expect(state.native.bdkForkLinked).toBe(false);
    expect(prov.gateDecision(state, { TALIA_ARCHIVE_ALLOW_DIRTY: 'please' }).allowed).toBe(false);
  });

  it('a comment in the podspec is not code', () => {
    put(prov.BDK_POD_SPEC, `# s.vendored_frameworks = "bdkFFI.xcframework"\n${POD_SPEC}`);
    expect(prov.readPodLink(repo, 'bdkwallet').problems).toEqual([]);
    // After code too, and a quote inside a comment is not a string.
    put(prov.BDK_POD_SPEC, POD_SPEC.replace('s.dependency "React-Core"', 's.dependency "React-Core" # the "bridge" needs React'));
    expect(prov.readPodLink(repo, 'bdkwallet').problems).toEqual([]);
  });

  it('names the line it refuses, and reads the hash of the pod\'s own settings on one line too', () => {
    put(prov.BDK_POD_SPEC, POD_SPEC.replace('s.dependency', 's.libraries = "bdkwallet-sim"\n  s.dependency'));
    const at = POD_SPEC.split('\n').findIndex((l) => l.includes('s.dependency')) + 1;
    expect(prov.readPodLink(repo, 'bdkwallet').problems).toEqual([
      `${prov.BDK_POD_SPEC} line ${at} is not a statement the TaliaBdkWallet pod may hold: s.libraries = "bdkwallet-sim"`,
    ]);
    const oneLine = POD_SPEC.replace(/s\.pod_target_xcconfig = \{[^}]*\}/, 's.pod_target_xcconfig = { "SWIFT_INCLUDE_PATHS" => "$(PODS_TARGET_SRCROOT)/ffi" }');
    expect(oneLine).not.toBe(POD_SPEC);
    put(prov.BDK_POD_SPEC, oneLine);
    expect(prov.readPodLink(repo, 'bdkwallet').problems).toEqual([]);
    put(prov.BDK_POD_SPEC, oneLine.replace('"$(PODS_TARGET_SRCROOT)/ffi" }', '"$(PODS_TARGET_SRCROOT)/ffi", "OTHER_LDFLAGS" => "-lx" }'));
    expect(prov.readPodLink(repo, 'bdkwallet').problems).toHaveLength(1);
  });

  it('the committed podspec links exactly the pinned fork library', () => {
    expect(prov.BDK_POD_VENDORS).toBe(`s.vendored_libraries = "${path.relative('native/bdkwallet', prov.BDK_FORK_LIB)}"`);
    expect(prov.readPodLink(path.join(__dirname, '..', '..'), 'bdkwallet').problems).toEqual([]);
  });

  it('every committed podspec links its own pinned library, and every library is in the table once', () => {
    const root = path.join(__dirname, '..', '..');
    for (const lib of Object.keys(prov.NATIVE_SOURCES)) {
      const src = prov.NATIVE_SOURCES[lib];
      expect(prov.readPodLink(root, lib).problems).toEqual([]);
      expect(prov.linkedLibOf(lib)).toBe(src.files.find((f: string) => f.endsWith('-ios.a')));
      expect(path.dirname(prov.linkedLibOf(lib))).toBe(src.libDir);
      expect(src.ignore).toBe(`${src.libDir}/`);
      // git ignores the libraries, and the archive expects them there.
      expect(() =>
        execFileSync('git', ['-C', root, 'check-ignore', '-q', `${src.libDir}/${path.basename(src.files[0])}`]),
      ).not.toThrow();
      expect(prov.EXPECTED_IGNORED.some((re: RegExp) => re.test(src.ignore))).toBe(true);
      for (const g of src.generated) {
        expect(fs.existsSync(path.join(root, g))).toBe(true);
      }
    }
    expect(prov.NATIVE_LIB_DIRS).toEqual(Object.values(prov.NATIVE_SOURCES).map((s) => s.libDir));
  });

  it("expects the simulator harness's report folder, which git ignores", () => {
    const root = path.join(__dirname, '..', '..');
    expect(prov.EXPECTED_IGNORED.some((re: RegExp) => re.test('scripts/tier-c/out/'))).toBe(true);
    expect(prov.EXPECTED_IGNORED.some((re: RegExp) => re.test('scripts/tier-c/'))).toBe(false);
    expect(() => execFileSync('git', ['-C', root, 'check-ignore', '-q', 'scripts/tier-c/out/report.txt'])).not.toThrow();
  });

  it('treats a folder that is not a git checkout as dirty and unknown', () => {
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    const state = prov.readSourceState(plain);
    expect(state.isGit).toBe(false);
    expect(state.dirty).toBe(true);
    expect(prov.stampFor(state)).toBe('unknown');
    expect(prov.gateDecision(state, {}).allowed).toBe(false);
  });
});

describe('gate', () => {
  it('lets a clean checkout through and logs the start with the flags', () => {
    expect(gate()).toBe(0);
    const [entry] = logLines();
    expect(entry.event).toBe('started');
    expect(entry.source.commit).toBe(git('rev-parse', 'HEAD'));
    expect(entry.flags).toEqual({ TALIA_FULL: '', TALIA_HWW: '1', TALIA_PURCHASES: '', TALIA_HARNESS: '' });
    expect(entry.overrideAllowDirty).toBeNull();
  });

  it('refuses a dirty checkout and logs the refusal', () => {
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'tampered');
    expect(gate()).toBe(3);
    const [entry] = logLines();
    expect(entry.event).toBe('refused');
    expect(entry.source.changes).toEqual([' M src/a.ts']);
  });

  it('allows a dirty checkout only with a reason, and keeps the reason', () => {
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'hotfix');
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: '   ' })).toBe(3);
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'hotfix for review, approved' })).toBe(0);
    const entry = logLines()[1];
    expect(entry.event).toBe('started');
    expect(entry.overrideAllowDirty).toBe('hotfix for review, approved');
    expect(entry.stamp).toMatch(/-dirty$/);
  });

  it('lets a checkout with its own node_modules through', () => {
    put('node_modules/react-native/package.json', '{}\n');
    expect(gate()).toBe(0);
  });

  it("refuses a node_modules linked from another checkout and says to install this checkout's own", () => {
    const shared = path.join(tmp, 'main-checkout', 'node_modules');
    fs.mkdirSync(shared, { recursive: true });
    fs.symlinkSync(shared, path.join(repo, 'node_modules'));
    let err = '';
    (process.stderr.write as unknown as jest.Mock).mockImplementation((s: string) => {
      err += s;
      return true;
    });
    expect(gate()).toBe(3);
    expect(logLines()[0].source.changes).toEqual(['?? node_modules']);
    expect(err).toContain(`node_modules links to ${fs.realpathSync(shared)}.`);
    expect(err).toContain('run npm ci here');
  });
});

describe('gate and the native libraries', () => {
  it('refuses a pod that links anything but the fork with the override set, says why, and logs it', () => {
    put(prov.BDK_POD_SPEC, POD_SPEC.replace('"lib/libbdkwallet-ios.a"', '"stock/bdkFFI.a"'));
    let err = '';
    (process.stderr.write as unknown as jest.Mock).mockImplementation((s: string) => {
      err += s;
      return true;
    });
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
    const [entry] = logLines();
    expect(entry.event).toBe('refused');
    expect(entry.source.native.bdkForkLinked).toBe(false);
    expect(err).toContain('would not link our own native libraries in place');
    expect(err).toContain('stock/bdkFFI.a');
    expect(err).toContain('There is no override for this.');
  });

  it.each([
    ['the bdk-ffi fork', prov.BDK_FORK_LIB, 'bdkwallet'],
    ['the BitBox bridge', BITBOX_LIB, 'bitboxffi'],
  ])('refuses an unpinned build of %s even with the override, and says so', (_what, lib, name) => {
    put(lib, 'built by hand from an edited checkout');
    let err = '';
    (process.stderr.write as unknown as jest.Mock).mockImplementation((s: string) => {
      err += s;
      return true;
    });
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'fork rebuilt, pin follows' })).toBe(3);
    const entry = logLines().pop() as Entry;
    expect(entry.event).toBe('refused');
    expect(entry.overrideAllowDirty).toBeNull();
    expect(entry.source.native.libs.find((l: Entry) => l.path === lib).sha256).toBe(
      sha('built by hand from an edited checkout'),
    );
    expect(err).toContain('a native library is not the one pinned');
    expect(err).toContain(`native: ${lib} is ${sha('built by hand from an edited checkout')}`);
    expect(err).toContain('There is no override for this.');
    expect(err).not.toContain(`${name} @`); // no commit is claimed for it
  });

  it('refuses a missing pinned library with no override', () => {
    fs.rmSync(path.join(repo, BITBOX_LIB));
    const decision = prov.gateDecision(prov.readSourceState(repo), { TALIA_ARCHIVE_ALLOW_DIRTY: 'please' });
    expect(decision.allowed).toBe(false);
    expect(decision.nativeLibs).toEqual([`${BITBOX_LIB} is missing, pinned ${sha('bitbox')}`]);
  });
});

describe('the native library folders, on the linker search path (decided 2026-10-02)', () => {
  const BITBOX_DIR = 'native/bitboxffi/lib';

  /** Gate with the override set: these refusals must not need it. */
  function refusedOutright(expected: string): void {
    const state = prov.readSourceState(repo);
    expect(state.dirty).toBe(true);
    expect(state.changes).toContain(`!! native-lib: ${expected}`);
    const decision = prov.gateDecision(state, { TALIA_ARCHIVE_ALLOW_DIRTY: 'please' });
    expect(decision.allowed).toBe(false);
    expect(decision.buildInstructions).toContain(`native-lib: ${expected}`);
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
    const entry = logLines().pop() as Entry;
    expect(entry.event).toBe('refused');
  }

  it.each([
    'libbitboxffi-ios.dylib', // the linker prefers it to the pinned .a
    'libbitboxffi-ios.tbd',
    'libbitboxffi.a', // what the podspec's -lbitboxffi looks for
    'libBitBoxFFI.a', // what the app's -l"BitBoxFFI" looks for
    'notes.txt',
  ])('refuses a planted %s beside the pinned library, with no override', (name) => {
    put(`${BITBOX_DIR}/${name}`, 'implant');
    refusedOutright(`${BITBOX_DIR}/${name} is not pinned in ${prov.NATIVE_PIN}; the linker would find it`);
  });

  it('refuses a folder (an .xcframework) planted there', () => {
    put(`${BITBOX_DIR}/extra.xcframework/Info.plist`, 'implant');
    refusedOutright(`${BITBOX_DIR}/extra.xcframework is a folder; this folder may only hold the pinned libraries`);
  });

  it('refuses a symlinked lib folder, although every pinned digest still matches', () => {
    const elsewhere = path.join(tmp, 'elsewhere-lib');
    fs.renameSync(path.join(repo, BITBOX_DIR), elsewhere);
    fs.symlinkSync(elsewhere, path.join(repo, BITBOX_DIR));
    expect(prov.readSourceState(repo).native.libs[0].sha256).toBe(sha('bitbox'));
    refusedOutright(`${BITBOX_DIR} is a symlink, not a folder`);
  });

  it('refuses a symlinked parent of a lib folder', () => {
    const elsewhere = path.join(tmp, 'elsewhere-bdkwallet');
    fs.renameSync(path.join(repo, 'native/bdkwallet'), elsewhere);
    fs.symlinkSync(elsewhere, path.join(repo, 'native/bdkwallet'));
    const state = prov.readSourceState(repo);
    expect(state.native.strays).toContain('native/bdkwallet is a symlink, not a folder');
    expect(prov.gateDecision(state, { TALIA_ARCHIVE_ALLOW_DIRTY: 'please' }).allowed).toBe(false);
  });

  it('refuses a pinned library that is a symlink, even to identical bytes', () => {
    const copy = path.join(tmp, 'bitbox-copy.a');
    fs.writeFileSync(copy, 'bitbox');
    fs.rmSync(path.join(repo, BITBOX_LIB));
    fs.symlinkSync(copy, path.join(repo, BITBOX_LIB));
    refusedOutright(`${BITBOX_LIB} is a symlink; this folder may only hold the pinned libraries`);
  });

  it('allows the simulator library once it is pinned, and Finder\'s .DS_Store', () => {
    const SIM = `${BITBOX_DIR}/libbitboxffi-sim.a`;
    put(SIM, 'bitbox sim');
    put(`${BITBOX_DIR}/.DS_Store`, 'finder');
    expect(prov.readSourceState(repo).native.strays).toEqual([
      `${SIM} is not pinned in ${prov.NATIVE_PIN}; the linker would find it`,
    ]);
    // Pinned as its build recorded it: the record and the pin together, and
    // the new library's overlap gate judged it (decided 2026-10-17).
    fs.appendFileSync(
      path.join(repo, prov.NATIVE_PIN),
      `${built('bitboxffi', 'bitbox sim', SIM)}${sha('bitbox sim')}  ${SIM}\n`,
    );
    expect(prov.readSourceState(repo).native.sourceProblems).toEqual([
      `no "# gated bdkwallet <sha256> ${SIM}" line: the record does not say that bdkwallet's overlap gate judged ${SIM}`,
    ]);
    fs.appendFileSync(path.join(repo, prov.NATIVE_PIN), `# gated bdkwallet ${sha('bitbox sim')} ${SIM}\n`);
    git('commit', '-qam', 'pin the simulator library');
    const state = prov.readSourceState(repo);
    expect(state.dirty).toBe(false);
    expect(state.native.strays).toEqual([]);
    const dir = state.native.libDirs.find((d: Entry) => d.dir === BITBOX_DIR);
    expect(dir.entries.map((e: Entry) => e.name)).toEqual(['.DS_Store', 'libbitboxffi-ios.a', 'libbitboxffi-sim.a']);
    expect(gate()).toBe(0);
  });

  it('refuses a library planted while the archive was built', () => {
    expect(gate()).toBe(0);
    put(`${BITBOX_DIR}/libbitboxffi-ios.dylib`, 'implant');
    expect(record()).toBe(4);
  });

  /**
   * Whether every library IS pinned is the own-record test's to say (below):
   * a rebuilt library stays recorded but unpinned on its branch until it is
   * tested, and only that test is red meanwhile, on purpose.
   */
  it('the repo pins only files the libraries\' build scripts write, and each script writes only its own', () => {
    const root = path.join(__dirname, '..', '..');
    const pinned = fs
      .readFileSync(path.join(root, prov.NATIVE_PIN), 'utf8')
      .split('\n')
      .filter((l) => /^[0-9a-f]{64} /.test(l))
      .map((l) => l.split(/\s+/)[1]);
    const all = Object.values(prov.NATIVE_SOURCES).flatMap((s) => s.files);
    expect(all.sort()).toEqual([
      'native/bdkwallet/lib/libbdkwallet-ios.a',
      'native/bdkwallet/lib/libbdkwallet-sim.a',
      'native/bitboxffi/lib/libbitboxffi-ios.a',
      'native/bitboxffi/lib/libbitboxffi-sim.a',
    ]);
    for (const p of pinned) {
      expect(all).toContain(p);
    }
    for (const [lib, src] of Object.entries(prov.NATIVE_SOURCES)) {
      const written = fs.readFileSync(path.join(root, src.build), 'utf8').match(/lib\/lib[\w-]+\.a/g) || [];
      expect(written.length).toBeGreaterThan(0);
      for (const w of written) {
        expect(prov.NATIVE_SOURCES[lib].files.some((f) => f.endsWith(w))).toBe(true);
      }
    }
  });
});

/**
 * Decided 2026-09-26: the native libraries must be traceable to a commit in
 * 21st Capital's own repos. The archive judges the committed record (no
 * network) and refuses, with no override, a record it cannot trust.
 */
describe('where the native libraries were built from (decided 2026-09-26)', () => {
  const PINS = () => PIN_LINES;
  const EXPECTED = [
    {
      lib: 'bitboxffi',
      repo: BITBOX_REPO,
      commit: BITBOX_COMMIT,
      note: null,
      built: [{ path: BITBOX_LIB, sha256: sha('bitbox') }],
    },
    {
      lib: 'bdkwallet',
      repo: BDK_REPO,
      commit: WALLET_COMMIT,
      note: null,
      built: [{ path: WALLET_LIB, sha256: sha('wallet') }],
      generated: WALLET_GENERATED.map(([file, text]) => ({ path: file, sha256: sha(text) })),
      xcode: { version: '27.1', build: '27A9275' },
      gated: [{ lib: 'bitboxffi', path: BITBOX_LIB, sha256: sha('bitbox') }],
    },
  ];

  /** Commit `sourceLines` and `pins` as the pin file, so the tree itself is clean. */
  function commitRecord(sourceLines: string, pins: string = PINS()): void {
    put(prov.NATIVE_PIN, `# pins\n${sourceLines}${pins}`);
    git('commit', '-qam', 'source record');
  }

  /** The gate, with the override set, must refuse `problem` outright. */
  function refusedWithoutOverride(problem: string): void {
    const state = prov.readSourceState(repo);
    expect(state.native.sourceProblems.join('\n')).toContain(problem);
    const decision = prov.gateDecision(state, { TALIA_ARCHIVE_ALLOW_DIRTY: 'please' });
    expect(decision.allowed).toBe(false);
    expect((decision.nativeSources || []).join('\n')).toContain(problem);
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
    const entry = logLines().pop() as Entry;
    expect(entry.event).toBe('refused');
    expect(entry.source.native.sourceProblems.join('\n')).toContain(problem);
  }

  it('records each library\'s repo, commit and built files in the log, the archive and verify', () => {
    const state = prov.readSourceState(repo);
    expect(state.native.sources).toEqual(EXPECTED);
    expect(state.native.sourceProblems).toEqual([]);
    expect(gate()).toBe(0);
    expect(logLines()[0].nativeSources).toEqual(EXPECTED);
    expect(record()).toBe(0);
    const rec = JSON.parse(fs.readFileSync(path.join(archive, prov.PROVENANCE_DIR, 'provenance.json'), 'utf8'));
    expect(rec.nativeSources).toEqual(EXPECTED);
    expect(rec.source.native.sources).toEqual(EXPECTED);
    let out = '';
    (process.stdout.write as unknown as jest.Mock).mockImplementation((s: string) => {
      out += s;
      return true;
    });
    expect(run(['verify', archive])).toBe(0);
    expect(out).toContain(`bdkwallet  ${BDK_REPO} @ ${WALLET_COMMIT}`);
    expect(out).toContain(`bitboxffi  ${BITBOX_REPO} @ ${BITBOX_COMMIT}`);
  });

  it('keeps a library\'s source-note with its record', () => {
    commitRecord(
      `# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\n# source-note bitboxffi: inferred\n` +
        `# source-note bitboxffi: from dates.\n${BITBOX_BUILT}` +
        WALLET,
    );
    expect(gate()).toBe(0);
    expect(logLines()[0].nativeSources[0]).toEqual({ ...EXPECTED[0], note: 'inferred from dates.' });
    expect(logLines()[0].nativeSources[1].note).toBeNull();
  });

  const BITBOX = `# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\n${BITBOX_BUILT}`;
  const B = (line: string) => `${line}\n${BITBOX_BUILT}${WALLET}`;
  it.each([
    ['no record at all', '', 'no source line for bitboxffi'],
    ['one library with none', BITBOX, 'no source line for bdkwallet'],
    ['a short commit', B(`# source bitboxffi ${BITBOX_REPO} 0123abc`), 'is not "# source <library> <repo URL> <40-hex commit>"'],
    ['an uppercase commit', B(`# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT.toUpperCase()}`), 'is not "# source'],
    ['a missing field', B(`# source bitboxffi ${BITBOX_COMMIT}`), 'is not "# source'],
    ['an extra field', B(`# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT} main`), 'is not "# source'],
    ['no space after #', B(`#source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}`), 'is not "# source'],
    ['a CRLF line end', B(`# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\r`), 'is not "# source'],
    ['the public upstream', B(`# source bitboxffi https://github.com/BitBoxSwiss/bitbox-api-rs ${BITBOX_COMMIT}`), "not 21st Capital's"],
    ['a fork in another org', B(`# source bitboxffi https://github.com/evil/bitbox-ffi ${BITBOX_COMMIT}`), "not 21st Capital's"],
    ['a lookalike org', B(`# source bitboxffi https://github.com/21st-Capita1/bitbox-ffi ${BITBOX_COMMIT}`), "not 21st Capital's"],
    ['another host', B(`# source bitboxffi https://gitlab.com/21st-Capital/bitbox-ffi ${BITBOX_COMMIT}`), "not 21st Capital's"],
    // The private repos the libraries were built from before 2026-11-06: a
    // record naming one is not taken until the library is built from its public repo.
    ['its private development repo', B(`# source bitboxffi ${BITBOX_PRIVATE_REPO} ${BITBOX_COMMIT}`), "not 21st Capital's"],
    ['the other library\'s private repo', B(`# source bitboxffi ${BDK_PRIVATE_REPO} ${BITBOX_COMMIT}`), "not 21st Capital's"],
    ['the other library\'s repo', B(`# source bitboxffi ${BDK_REPO} ${BITBOX_COMMIT}`), "not 21st Capital's"],
    ['another spelling of the URL', B(`# source bitboxffi ${BITBOX_REPO}.git ${BITBOX_COMMIT}`), "not 21st Capital's"],
    ['an all-zero commit', B(`# source bitboxffi ${BITBOX_REPO} ${'0'.repeat(40)}`), 'names no commit'],
    ['two lines for one library', `${BITBOX}# source bitboxffi ${BITBOX_REPO} ${WALLET_COMMIT}\n${WALLET}`, 'second source line for bitboxffi'],
    ['a library the app does not link', `${BITBOX}${WALLET}# source otherffi ${BDK_REPO} ${BITBOX_COMMIT}\n`, 'not a library this app links'],
    ['a name every object has', `${BITBOX}${WALLET}# source constructor ${BDK_REPO} ${BITBOX_COMMIT}\n`, 'not a library this app links'],
    // The old engine's library is not one any more (removed, decided 2026-11-04).
    ['the old engine\'s library', `${BITBOX}${WALLET}# source bdkffi ${BDK_REPO} ${BITBOX_COMMIT}\n`, 'not a library this app links'],
    ['a malformed note', `${BITBOX}# source-note bitboxffi inferred\n${WALLET}`, 'is not "# source-note'],
    ['a note for a library the app does not link', `${BITBOX}# source-note otherffi: x\n${WALLET}`, 'is not "# source-note'],
    ['a note for a name every object has', `${BITBOX}# source-note constructor: x\n${WALLET}`, 'is not "# source-note'],
    // The files the recorded build wrote (decided 2026-10-05).
    ['a library with no "# built" line', `# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\n${WALLET}`, 'no "# built bitboxffi'],
    ['a short digest', `# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\n# built bitboxffi ${sha('bitbox').slice(0, 63)} ${BITBOX_LIB}\n${WALLET}`, 'is not "# built'],
    ['a built line with no path', `# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\n# built bitboxffi ${sha('bitbox')}\n${WALLET}`, 'is not "# built'],
    ['a CRLF built line', `# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\n${BITBOX_BUILT.replace('\n', '\r\n')}${WALLET}`, 'is not "# built'],
    ['a near-miss built line', `# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\n${BITBOX_BUILT.replace('# built', '#built')}${WALLET}`, 'is not "# built'],
    ['a built line for a library the app does not link', `${BITBOX}${WALLET}# built otherffi ${sha('x')} native/otherffi/lib/libother.a\n`, 'is not "# built'],
    ['a build writing into the other library\'s folder', `${BITBOX}${WALLET}# built bitboxffi ${sha('wallet')} ${WALLET_LIB}\n`, "bitboxffi's build cannot have written"],
    ['two built lines for one file', `${BITBOX}${WALLET}${BITBOX_BUILT}`, 'second "# built" line'],
    ['a recorded file that is not pinned', `${BITBOX}${WALLET}${built('bitboxffi', 'sim', 'native/bitboxffi/lib/libbitboxffi-sim.a')}`, 'which is not pinned'],
  ])('refuses %s, with no override', (_what, recordText, problem) => {
    commitRecord(recordText);
    expect(prov.readSourceState(repo).dirty).toBe(false);
    refusedWithoutOverride(problem);
  });

  /**
   * Decided 2026-10-05: the record and the pins must not drift apart, or the
   * archive certifies a commit the pinned files were not built from. Every
   * case below is a CLEAN checkout whose libraries match their pins.
   */
  describe('the pins are exactly the files the recorded build wrote', () => {
    const NEW = 'c3'.repeat(20);

    it('refuses pins updated without the record (digests pasted by hand)', () => {
      put(BITBOX_LIB, 'bitbox built by the old script');
      commitRecord(
        SOURCE_LINES,
        `${sha('bitbox built by the old script')}  ${BITBOX_LIB}\n${WALLET_PIN}`,
      );
      const state = prov.readSourceState(repo);
      expect(state.dirty).toBe(false);
      expect(state.native.problems).toEqual([]);
      refusedWithoutOverride(
        `${BITBOX_LIB} is pinned ${sha('bitbox built by the old script')}, ` +
          `but the build of bitboxffi recorded ${sha('bitbox')}`,
      );
    });

    it('refuses a new record kept while the old libraries and pins were put back', () => {
      // The build recorded NEW and its file; the device test failed, the old
      // library was restored, and the record was committed with the old pins.
      commitRecord(
        `# source bitboxffi ${BITBOX_REPO} ${NEW}\n${built('bitboxffi', 'bitbox from NEW', BITBOX_LIB)}${WALLET}`,
      );
      const state = prov.readSourceState(repo);
      expect(state.dirty).toBe(false);
      refusedWithoutOverride(`${BITBOX_LIB} is pinned ${sha('bitbox')}, but the build of bitboxffi recorded ${sha('bitbox from NEW')}`);
    });

    it('refuses a pin no build recorded at all', () => {
      const SIM = 'native/bitboxffi/lib/libbitboxffi-sim.a';
      put(SIM, 'bitbox sim');
      commitRecord(SOURCE_LINES, `${PINS()}${sha('bitbox sim')}  ${SIM}\n`);
      refusedWithoutOverride(`${SIM} is pinned, but no "# built bitboxffi" line records it`);
    });

    it.each(['native/other/lib/libother.a', 'native/bitboxffi/lib/../../other/libother.a', 'native/bitboxffi/lib/sub/libx.a'])(
      'refuses a pin outside every library\'s folder: %s',
      (where) => {
        commitRecord(SOURCE_LINES, `${PINS()}${sha('x')}  ${where}\n`);
        refusedWithoutOverride(`${where} is pinned, but no library with a source record lives there`);
      },
    );

    it('refuses a merge that combines an old record with new pins, although git merged it cleanly', () => {
      // A branch cut before the "# built" lines existed pasted new BitBox pins
      // by hand; main meanwhile gained the built lines for the OLD files. The
      // two hunks are apart, so git merges them without a conflict.
      const layout = (record: string, pins: string) => `# pins\n${record}#\n# (pins below)\n#\n${pins}`;
      const OLD_FORMAT = `# source bitboxffi ${BITBOX_REPO} ${BITBOX_COMMIT}\n${WALLET}`;
      put(prov.NATIVE_PIN, layout(OLD_FORMAT, PINS()));
      git('commit', '-qam', 'before the built lines');
      const base = git('rev-parse', 'HEAD');
      git('checkout', '-qb', 'bitbox-fix');
      const newPins = `${sha('bitbox v2')}  ${BITBOX_LIB}\n${WALLET_PIN}`;
      put(prov.NATIVE_PIN, layout(OLD_FORMAT, newPins));
      git('commit', '-qam', 'new BitBox pins, pasted by hand');
      git('checkout', '-q', base);
      git('checkout', '-qb', 'main-with-built-lines');
      put(prov.NATIVE_PIN, layout(SOURCE_LINES, PINS()));
      git('commit', '-qam', 'record the built files');
      git('merge', '-q', '--no-edit', 'bitbox-fix');
      expect(fs.readFileSync(path.join(repo, prov.NATIVE_PIN), 'utf8')).toBe(layout(SOURCE_LINES, newPins));
      put(BITBOX_LIB, 'bitbox v2');
      const state = prov.readSourceState(repo);
      expect(state.dirty).toBe(false);
      expect(state.native.problems).toEqual([]);
      refusedWithoutOverride(`${BITBOX_LIB} is pinned ${sha('bitbox v2')}, but the build of bitboxffi recorded ${sha('bitbox')}`);
    });

    it('refuses, with no override, a library rebuilt and pinned after the new library\'s overlap gate judged the old one (decided 2026-10-17)', () => {
      // BitBox rebuilt (another secp256k1-sys, a patched C file) and pinned
      // with its own record, while bdkwallet's gate compared the OLD BitBox:
      // nothing ever compared the two, and ld is silent when one copy loads.
      put(BITBOX_LIB, 'bitbox from NEW');
      commitRecord(
        `# source bitboxffi ${BITBOX_REPO} ${NEW}\n${built('bitboxffi', 'bitbox from NEW', BITBOX_LIB)}${WALLET}`,
        `${sha('bitbox from NEW')}  ${BITBOX_LIB}\n${WALLET_PIN}`,
      );
      refusedWithoutOverride(
        `bdkwallet's overlap gate judged ${BITBOX_LIB} as ${sha('bitbox')}, but it is pinned ${sha('bitbox from NEW')}: ` +
          'the two were never compared; rebuild bdkwallet (native/build-bdkwallet.sh)',
      );
    });

    it.each([
      ['a malformed gated line', `# gated bdkwallet ${sha('x')}\n`, 'is not "# gated'],
      ['a gated line of a library whose build runs no gate', `# gated bitboxffi ${sha('x')} ${WALLET_LIB}\n`, "bitboxffi's build runs no symbol-overlap gate"],
      ['a gated line naming the library\'s own file', `# gated bdkwallet ${sha('x')} ${WALLET_LIB}\n`, 'is not a file of another library the app links'],
      ['a second gated line', `# gated bdkwallet ${sha('bitbox')} ${BITBOX_LIB}\n`, 'a second "# gated" line'],
      ['a gated file that is not pinned', `# gated bdkwallet ${sha('x')} native/bitboxffi/lib/libbitboxffi-sim.a\n`, 'judged native/bitboxffi/lib/libbitboxffi-sim.a, which is not pinned'],
    ])('refuses %s', (_what, bad, says) => {
      expect(prov.parseNativeSources(`${SOURCE_LINES}${bad}${PIN_LINES}`).problems.join('\n')).toContain(says);
    });

    // The old engine's removal (decided 2026-11-04): the pinned bdkwallet's
    // record still names the old engine's two files, which its overlap gate
    // judged; the record is that build's own and is never edited by hand.
    it('sets aside a gated line naming a file of a library the app no longer links, and pins none of it', () => {
      const retired = prov.RETIRED_NATIVE_LIBS.bdkffi.files;
      expect(retired).toEqual(['native/bdkffi/lib/libbdkffi-ios.a', 'native/bdkffi/lib/libbdkffi-sim.a']);
      expect(Object.keys(prov.NATIVE_SOURCES)).not.toContain('bdkffi');
      const old = retired.map((f) => `# gated bdkwallet ${sha(`old ${f}`)} ${f}\n`).join('');
      const parsed = prov.parseNativeSources(`${SOURCE_LINES}${old}${PIN_LINES}`);
      expect(parsed.problems).toEqual([]);
      expect(parsed.sources.find((x) => x.lib === 'bdkwallet')!.gated).toEqual([{ lib: 'bitboxffi', path: BITBOX_LIB, sha256: sha('bitbox') }]);
      // Another file in that folder is no file of a library at all.
      expect(prov.parseNativeSources(`${SOURCE_LINES}# gated bdkwallet ${sha('x')} native/bdkffi/lib/other.a\n${PIN_LINES}`).problems.join('\n')).toContain(
        'is not a file of another library the app links',
      );
      // Pinned again, a retired file is refused: no library with a record lives there.
      commitRecord(`${SOURCE_LINES}${old}`, `${PIN_LINES}${sha('x')}  ${retired[0]}\n`);
      refusedWithoutOverride(`${retired[0]} is pinned, but no library with a source record lives there`);
    });

    it('lets a record and pins written together through, once the overlap gate judged them', () => {
      put(BITBOX_LIB, 'bitbox from NEW');
      const regated = WALLET.replace(`# gated bdkwallet ${sha('bitbox')} ${BITBOX_LIB}`, `# gated bdkwallet ${sha('bitbox from NEW')} ${BITBOX_LIB}`);
      expect(regated).not.toBe(WALLET);
      commitRecord(
        `# source bitboxffi ${BITBOX_REPO} ${NEW}\n${built('bitboxffi', 'bitbox from NEW', BITBOX_LIB)}${regated}`,
        `${sha('bitbox from NEW')}  ${BITBOX_LIB}\n${WALLET_PIN}`,
      );
      expect(gate()).toBe(0);
      expect(logLines()[0].nativeSources[0]).toEqual({
        lib: 'bitboxffi',
        repo: BITBOX_REPO,
        commit: NEW,
        note: null,
        built: [{ path: BITBOX_LIB, sha256: sha('bitbox from NEW') }],
      });
    });
  });

  it('refuses when the pin file, and so the record, is missing', () => {
    fs.rmSync(path.join(repo, prov.NATIVE_PIN));
    git('commit', '-qam', 'no pins');
    const state = prov.readSourceState(repo);
    expect(state.native.sourceProblems).toEqual([
      `no source line for bitboxffi ("# source bitboxffi ${BITBOX_REPO} <commit>")`,
      `no source line for bdkwallet ("# source bdkwallet ${BDK_REPO} <commit>")`,
    ]);
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
  });

  it('says how to fix a refused record', () => {
    commitRecord(BITBOX);
    let err = '';
    (process.stderr.write as unknown as jest.Mock).mockImplementation((s: string) => {
      err += s;
      return true;
    });
    expect(gate()).toBe(3);
    expect(err).toContain('cannot be traced to a commit in our repos');
    expect(err).toContain(`# source bitboxffi ${BITBOX_REPO} <commit>`);
    expect(err).toContain('native/build-bitboxffi.sh');
    expect(err).toContain('node scripts/native-sources.js pin <library>');
    expect(err).toContain('There is no override for this.');
  });

  it('a prose comment is not a source or built line, but a near miss is', () => {
    const ok = prov.parseNativeSources(
      `# Sources: see below\n#  each library's "# source" line\n# (they are built locally)\n${BITBOX}${WALLET}${PINS()}`,
    );
    expect(ok.problems).toEqual([]);
    expect(prov.parseNativeSources(`# source of truth\n${BITBOX}${WALLET}${PINS()}`).problems).toHaveLength(1);
    expect(prov.parseNativeSources(`# built locally\n${BITBOX}${WALLET}${PINS()}`).problems).toHaveLength(1);
    expect(prov.parseNativeSources(`# generated by hand\n${BITBOX}${WALLET}${PINS()}`).problems).toHaveLength(1);
    expect(prov.parseNativeSources(`# xcode updates are off\n${BITBOX}${WALLET}${PINS()}`).problems).toHaveLength(1);
  });

  it('refuses a record changed while the archive was built', () => {
    expect(gate()).toBe(0);
    const text = fs.readFileSync(path.join(repo, prov.NATIVE_PIN), 'utf8');
    fs.writeFileSync(path.join(repo, prov.NATIVE_PIN), text.replace(BITBOX_COMMIT, 'c3'.repeat(20)));
    expect(record()).toBe(4);
  });

  it('judges the record without the network', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'archive-provenance.js'), 'utf8');
    expect(code).not.toMatch(/'(fetch|ls-remote|clone|pull|remote)'/);
    expect(code).not.toMatch(/require\('(https?|net|dns)'\)/);
  });

  /**
   * Properties, never today's values (decided 2026-10-05): the BitBox rebuild
   * of 2026-10-03, or any later bdk build, rewrites the record and must not
   * turn CI red. What must hold for ANY committed record is what the archive
   * itself demands.
   *
   * Two tests (decided 2026-10-20): a recorded build tested before its pin
   * (as happens during a library upgrade) keeps the second one red on purpose, and
   * that must never hide a broken property of the record behind the same
   * single red test, so every other check runs and passes on its own.
   */
  const ownRecord = () => {
    const root = path.join(__dirname, '..', '..');
    const text = fs.readFileSync(path.join(root, prov.NATIVE_PIN), 'utf8');
    return { text, ...prov.parseNativeSources(text) };
  };
  const NOT_PINNED_YET = /^\w+'s build recorded \S+, which is not pinned$/;

  it("the repo's own record is one the archive accepts, naming both org repos and full commits", () => {
    const { text, sources, problems } = ownRecord();
    // A recorded build waiting for its pin is the next test's alone.
    expect(problems.filter((p: string) => !NOT_PINNED_YET.test(p))).toEqual([]);
    expect(sources.map((s) => s.lib)).toEqual(Object.keys(prov.NATIVE_SOURCES));
    for (const s of sources) {
      expect(s.repo).toBe(prov.NATIVE_SOURCES[s.lib].repo);
      expect(s.repo).toMatch(/^https:\/\/github\.com\/21st-Capital\//);
      expect(s.commit).toMatch(/^[0-9a-f]{40}$/);
      // Each library's record names every file its build script writes.
      expect(s.built.map((b: Entry) => b.path).sort()).toEqual([...prov.NATIVE_SOURCES[s.lib].files].sort());
      // A hand-written record says how its commit was established; a build
      // drops the note, so none is required.
      if (s.note !== null) {
        expect(s.note).toMatch(/recorded by hand|INFERRED FROM DATES/i);
        expect(s.note).toContain('records the commit for certain');
      }
    }
    // Nothing tells anyone to write a digest by hand.
    expect(text).not.toMatch(/shasum/);
  });

  /**
   * The repos themselves, in a test of their own (decided 2026-11-06): the one
   * above stays red while a recorded build waits for its pin, and that must
   * not hide which repos the archive holds a record to.
   */
  it('each library is built from its public repo, branch main, never the private one it is developed in', () => {
    expect(Object.fromEntries(Object.entries(prov.NATIVE_SOURCES).map(([k, v]) => [k, v.repo]))).toEqual({
      bitboxffi: BITBOX_REPO,
      bdkwallet: BDK_REPO,
    });
    expect(Object.fromEntries(Object.entries(prov.NATIVE_SOURCES).map(([k, v]) => [k, v.branch]))).toEqual({
      bitboxffi: 'main',
      bdkwallet: 'main',
    });
    for (const s of Object.values(prov.NATIVE_SOURCES)) {
      expect([BDK_PRIVATE_REPO, BITBOX_PRIVATE_REPO]).not.toContain(s.repo);
    }
  });

  it("every library the repo's own record names is pinned (red while a recorded build waits for its pin)", () => {
    const { problems } = ownRecord();
    expect(problems.filter((p: string) => NOT_PINNED_YET.test(p))).toEqual([]);
  });
});

describe('record and verify', () => {
  it('writes the record into the archive and the log, and verify accepts it', () => {
    expect(gate()).toBe(0);
    expect(record()).toBe(0);
    const file = path.join(archive, prov.PROVENANCE_DIR, 'provenance.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(rec.event).toBe('verified');
    expect(rec.source.commit).toBe(git('rev-parse', 'HEAD'));
    expect(rec.javascript).toMatchObject({
      plainSha256: 'a'.repeat(64),
      hermesSha256: 'b'.repeat(64),
      flagsReadBack: 'false true false',
      reproducedFromSource: true,
    });
    expect(rec.archive.sha256).toBe(prov.archiveManifest(archive).digest);
    expect(rec.savedSource).toEqual([]);
    expect(logLines().map((e) => e.event)).toEqual(['started', 'verified']);

    expect(run(['verify', archive])).toBe(0);
    expect(logLines().pop()!.event).toBe('reverified');
  });

  it('the digest ignores the archive Info.plist (Organizer writes to it) but nothing in Products', () => {
    const before = prov.archiveManifest(archive).digest;
    fs.writeFileSync(path.join(archive, 'Info.plist'), 'uploaded to Apple');
    expect(prov.archiveManifest(archive).digest).toBe(before);
    fs.appendFileSync(
      path.join(archive, 'Products', 'Applications', 'KeelWallet.app', 'main.jsbundle'),
      'x',
    );
    expect(prov.archiveManifest(archive).digest).not.toBe(before);
  });

  it('verify refuses an archive changed after it was recorded', () => {
    expect(gate()).toBe(0);
    expect(record()).toBe(0);
    fs.writeFileSync(
      path.join(archive, 'Products', 'Applications', 'KeelWallet.app', 'main.jsbundle'),
      'swapped',
    );
    expect(run(['verify', archive])).toBe(5);
    expect(logLines().pop()!.event).toBe('mismatch');
  });

  it('logs a refusal made after the gate, with its reason', () => {
    expect(gate()).toBe(0);
    expect(
      run(['refused', '--state', path.join(tmp, 'state.json'), '--reason', 'hermes mismatch', '--archive', '/x.refused-1']),
    ).toBe(0);
    const entry = logLines().pop()!;
    expect(entry.event).toBe('refused');
    expect(entry.refusal).toBe('hermes mismatch');
    expect(entry.source.commit).toBe(git('rev-parse', 'HEAD'));
    expect(entry.archive).toEqual({ path: '/x.refused-1' });
  });

  it('verify refuses a record rewritten together with the archive (the log disagrees)', () => {
    expect(gate()).toBe(0);
    expect(record()).toBe(0);
    const app = path.join(archive, 'Products', 'Applications', 'KeelWallet.app', 'main.jsbundle');
    fs.writeFileSync(app, 'swapped');
    const file = path.join(archive, prov.PROVENANCE_DIR, 'provenance.json');
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    rec.archive.sha256 = prov.archiveManifest(archive).digest;
    fs.writeFileSync(file, JSON.stringify(rec));
    expect(run(['verify', archive])).toBe(5);
    expect(logLines().pop()!.event).toBe('mismatch');
  });

  it('verify refuses an archive this Mac never logged', () => {
    expect(gate()).toBe(0);
    expect(record()).toBe(0);
    fs.writeFileSync(log, '');
    expect(run(['verify', archive])).toBe(5);
  });

  it('verify refuses an archive with no record', () => {
    expect(run(['verify', archive])).toBe(2);
  });

  it('refuses when the checkout changed while the archive was built', () => {
    expect(gate()).toBe(0);
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'edited mid-archive');
    expect(record()).toBe(4);
    const rec = JSON.parse(
      fs.readFileSync(path.join(archive, prov.PROVENANCE_DIR, 'provenance.json'), 'utf8'),
    );
    expect(rec.event).toBe('refused');
    expect(rec.sourceAfter.changes).toEqual([' M src/a.ts']);
    expect(run(['verify', archive])).toBe(5);
  });

  it('refuses a new commit made while the archive was built', () => {
    expect(gate()).toBe(0);
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'next');
    git('commit', '-qam', 'second');
    expect(record()).toBe(4);
  });

  it('refuses when a native library changed while the archive was built', () => {
    expect(gate()).toBe(0);
    put(BITBOX_LIB, 'swapped mid-archive');
    expect(record()).toBe(4);
  });

  it('refuses when an untracked file changed while an overridden archive was built', () => {
    put('src/extra.ts', 'export const x = 1;\n');
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'testing' })).toBe(0);
    put('src/extra.ts', 'export const x = 2;\n');
    expect(record()).toBe(4);
  });

  it('keeps the uncommitted diff and untracked files with an overridden archive', () => {
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 3;\n');
    fs.writeFileSync(path.join(repo, 'src', 'extra.ts'), 'export const x = 1;\n');
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'testing' })).toBe(0);
    expect(record()).toBe(0);
    const dir = path.join(archive, prov.PROVENANCE_DIR);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'provenance.json'), 'utf8'));
    expect(rec.savedSource).toEqual(['source.patch', 'untracked.tar']);
    expect(rec.overrideAllowDirty).toBe('testing');
    expect(fs.readFileSync(path.join(dir, 'source.patch'), 'utf8')).toContain('+export const a = 3;');
    const listing = execFileSync('tar', ['-tf', path.join(dir, 'untracked.tar')], { encoding: 'utf8' });
    expect(listing.trim()).toBe('src/extra.ts');
  });
});

/**
 * Decided 2026-10-01: ordinary git features hide an edit from `git status`
 * while the build still reads it. Each case first proves git status is
 * fooled, then that the gate is not.
 */
describe('what git status cannot see', () => {
  const statusLines = (gitEnv: Env = {}) =>
    execFileSync('git', ['-C', repo, 'status', '--porcelain', '--untracked-files=all'], {
      encoding: 'utf8',
      env: { ...process.env, ...gitEnv },
    }).trim();

  it('(A) an edit behind --skip-worktree or --assume-unchanged', () => {
    for (const flag of ['--skip-worktree', '--assume-unchanged']) {
      git('update-index', flag, 'src/a.ts');
      fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 666;\n');
      expect(statusLines()).toBe('');
      const state = prov.readSourceState(repo);
      expect(state.changes).toEqual([' M src/a.ts']);
      expect(gate()).toBe(3);
      git('update-index', flag.replace('--', '--no-'), 'src/a.ts');
      git('checkout', '--', 'src/a.ts');
    }
    // The flag alone, with the file as committed, is not a change.
    git('update-index', '--skip-worktree', 'src/a.ts');
    expect(prov.readSourceState(repo).dirty).toBe(false);
  });

  it('(B) an untracked file hidden by .git/info/exclude (Metro prefers config.ios.ts)', () => {
    put('src/config.ios.ts', 'export const TAMPER_MARKER = 1;\n');
    fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), 'src/config.ios.ts\n');
    expect(statusLines()).toBe('');
    const state = prov.readSourceState(repo);
    // Only committed .gitignore files are honoured, so it is plainly untracked.
    expect(state.changes).toEqual(['?? src/config.ios.ts']);
    expect(state.untrackedFiles).toEqual([
      { path: 'src/config.ios.ts', sha256: sha('export const TAMPER_MARKER = 1;\n') },
    ]);
    expect(gate()).toBe(3);
  });

  it('(B) an untracked file hidden by core.excludesFile', () => {
    put('src/config.ios.ts', 'export const TAMPER_MARKER = 1;\n');
    fs.writeFileSync(path.join(tmp, 'excludes'), 'src/config.ios.ts\n');
    git('config', 'core.excludesFile', path.join(tmp, 'excludes'));
    expect(statusLines()).toBe('');
    expect(prov.readSourceState(repo).changes).toEqual(['?? src/config.ios.ts']);
  });

  it('(B) an untracked .gitignore that hides itself and its neighbours', () => {
    put('src/config.ios.ts', 'export const TAMPER_MARKER = 1;\n');
    put('src/.gitignore', '*\n');
    expect(statusLines()).toBe('');
    const changes = prov.readSourceState(repo).changes;
    expect(changes).toContain(
      '!! ignored: src/config.ios.ts is hidden by src/.gitignore, not by a committed .gitignore',
    );
    expect(changes).toContain(
      '!! ignored: src/.gitignore is hidden by src/.gitignore, not by a committed .gitignore',
    );
  });

  it('(B) a file a committed rule ignores, in a place no local file belongs', () => {
    // src/node_modules/react would shadow the real package for anything in src/.
    put('src/node_modules/react/index.js', 'module.exports = "implant";\n');
    put('src/build/extra.ts', 'export {};\n');
    expect(statusLines()).toBe('');
    const changes = prov.readSourceState(repo).changes;
    expect(changes).toContain(
      '!! ignored: src/node_modules/ (.gitignore) is not a place this checkout keeps local files',
    );
    expect(changes).toContain(
      '!! ignored: src/build/ (.gitignore) is not a place this checkout keeps local files',
    );
    expect(gate()).toBe(3);
  });

  // The old engine's removal (decided 2026-11-04): the old engine's
  // libraries left in a checkout are refused until deleted (every worktree's
  // clean-up at the merge).
  it('(B2) the old engine\'s ignored library files, left in a checkout', () => {
    put('native/bdkffi/lib/libbdkffi-ios.a', 'the old engine');
    expect(statusLines()).toBe('');
    expect(prov.readSourceState(repo).changes).toContain(
      '!! ignored: native/bdkffi/lib/ (.gitignore) is not a place this checkout keeps local files',
    );
    expect(gate()).toBe(3);
  });

  it('(C) GIT_DIR and GIT_WORK_TREE naming a clean clone', () => {
    const clone = path.join(tmp, 'clone');
    execFileSync('git', ['clone', '-q', repo, clone]);
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 666;\n');
    const fake = { GIT_DIR: path.join(clone, '.git'), GIT_WORK_TREE: clone };
    expect(statusLines(fake)).toBe('');
    const saved = { ...process.env };
    Object.assign(process.env, fake);
    try {
      const state = prov.readSourceState(repo);
      expect(state.changes).toEqual([' M src/a.ts']);
      expect(state.gitEnvDropped).toEqual(expect.arrayContaining(['GIT_DIR', 'GIT_WORK_TREE']));
      expect(gate()).toBe(3);
    } finally {
      delete process.env.GIT_DIR;
      delete process.env.GIT_WORK_TREE;
      Object.assign(process.env, saved);
    }
  });

  it('a clean filter in .git/info/attributes never runs, and the saved patch is the file on disk', () => {
    const marker = path.join(tmp, 'filter-ran');
    git('config', 'filter.hide.clean', `touch ${marker}; sed s/7/1/`);
    git('config', 'filter.hide.smudge', 'cat');
    fs.writeFileSync(path.join(repo, '.git', 'info', 'attributes'), 'src/a.ts filter=hide\n');
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 7;\n');
    // git status hands the file to the filter and believes what it returns.
    expect(statusLines()).toBe('');
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(marker);
    expect(prov.readSourceState(repo).changes).toEqual([' M src/a.ts']);
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'testing' })).toBe(0);
    expect(record()).toBe(0);
    const patch = fs.readFileSync(path.join(archive, prov.PROVENANCE_DIR, 'source.patch'), 'utf8');
    expect(patch).toContain('+export const a = 7;');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('git replace making HEAD read as another commit', () => {
    const c1 = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 666;\n');
    git('commit', '-qam', 'tampered');
    const c2 = git('rev-parse', 'HEAD');
    git('reset', '-q', '--soft', c1);
    git('replace', c1, c2);
    expect(statusLines()).toBe('');
    expect(git('rev-parse', 'HEAD')).toBe(c1);
    const state = prov.readSourceState(repo);
    expect(state.commit).toBe(c1);
    expect(state.changes).toEqual([' M src/a.ts']);
    expect(gate()).toBe(3);
  });

  it('a tracked file reached through a symlinked folder', () => {
    fs.cpSync(path.join(repo, 'src'), path.join(tmp, 'elsewhere'), { recursive: true });
    fs.rmSync(path.join(repo, 'src'), { recursive: true });
    fs.symlinkSync(path.join(tmp, 'elsewhere'), path.join(repo, 'src'));
    expect(prov.readSourceState(repo).changes).toContain(' T src/a.ts');
  });

  it('rebuilds the exact tree of a commit with symlinks, an executable and tricky names', () => {
    put('a-b/x.ts', 'x');
    put('a/b.ts', 'b');
    put('a.ts', 'top');
    put('bin/run.sh', '#!/bin/sh\n');
    fs.chmodSync(path.join(repo, 'bin', 'run.sh'), 0o755);
    fs.symlinkSync('src/a.ts', path.join(repo, 'link.ts'));
    git('add', '.');
    git('commit', '-qm', 'shapes');
    const state = prov.readSourceState(repo);
    expect(state.changes).toEqual([]);
    expect(state.treeMatchesCommit).toBe(true);
    fs.chmodSync(path.join(repo, 'bin', 'run.sh'), 0o644);
    expect(prov.readSourceState(repo).changes).toEqual([' T bin/run.sh']);
  });
});

describe('ios/.xcode.env.local, sourced as shell by Xcode', () => {
  const state = () => prov.readSourceState(repo, env);
  const ONE_LINE = 'ios/.xcode.env.local must be one line, "export NODE_BINARY=<path to node>", and nothing else';

  it('may be absent, empty, or name the node on PATH in one of the two forms React Native writes', () => {
    expect(state().dirty).toBe(false);
    put('ios/.xcode.env.local', '');
    expect(state().dirty).toBe(false);
    put('ios/.xcode.env.local', `export NODE_BINARY=${nodeBin}\n`);
    let s = state();
    expect(s.dirty).toBe(false);
    expect(s.xcodeEnv.nodeBinary).toBe(nodeBin);
    expect(s.xcodeEnv.files[1]).toEqual({
      path: 'ios/.xcode.env.local',
      sha256: sha(`export NODE_BINARY=${nodeBin}\n`),
    });
    put('ios/.xcode.env.local', `export NODE_BINARY=${nodeBin}`);
    expect(state().dirty).toBe(false);
    put('ios/.xcode.env.local', 'export NODE_BINARY=$(command -v node)\n');
    s = state();
    expect(s.dirty).toBe(false);
    expect(s.xcodeEnv.nodeBinary).toBe(nodeBin);
    // A symlink to that same node is that node.
    fs.symlinkSync(nodeBin, path.join(tmp, 'node-link'));
    put('ios/.xcode.env.local', `export NODE_BINARY=${path.join(tmp, 'node-link')}\n`);
    expect(state().dirty).toBe(false);
    expect(gate()).toBe(0);
  });

  it('refuses a line the shell runs although a trimmed reading saw a comment (decided 2026-10-02)', () => {
    // " #" is a comment once JavaScript trims it; to the shell it is a
    // command named " #", then ';', then whatever follows.
    for (const text of [
      ' #;cp /tmp/implant "$TARGET_BUILD_DIR/KeelWallet.app/KeelWallet"\n',
      ` #;true\nexport NODE_BINARY=${nodeBin}\n`,
      `export NODE_BINARY=${nodeBin}\r\n`,
      `export NODE_BINARY=${nodeBin}\n\n`,
      ` export NODE_BINARY=${nodeBin}\n`,
      `export NODE_BINARY=${nodeBin} \n`,
      `\texport NODE_BINARY=${nodeBin}\n`,
      `﻿export NODE_BINARY=${nodeBin}\n`,
      `# mine\nexport NODE_BINARY=${nodeBin}\n`,
      `export NODE_BINARY=${nodeBin}\ncp /tmp/implant "$TARGET_BUILD_DIR/KeelWallet.app/KeelWallet"\n`,
      `export NODE_BINARY=${nodeBin};true\n`,
      `export NODE_BINARY="${nodeBin}"\n`,
      'export NODE_BINARY=$(curl evil)\n',
      'export NODE_BINARY=$(command -v node) \n',
      '\n',
      ' ',
    ]) {
      put('ios/.xcode.env.local', text);
      const s = state();
      expect([JSON.stringify(text), s.changes]).toEqual([JSON.stringify(text), [`!! xcode-env: ${ONE_LINE}`]]);
      // No override reaches past it.
      expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
    }
    const last = logLines().pop() as Entry;
    expect(last.event).toBe('refused');
  });

  it('refuses a NODE_BINARY that is not the node on the build PATH', () => {
    const other = path.join(tmp, 'other-node');
    fs.writeFileSync(other, '#!/bin/sh\n');
    fs.chmodSync(other, 0o755);
    put('ios/.xcode.env.local', `export NODE_BINARY=${other}\n`);
    expect(state().changes).toEqual([
      `!! xcode-env: ios/.xcode.env.local names ${other}, which is not the node on the build's PATH (${nodeBin})`,
    ]);
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
    put('ios/.xcode.env.local', 'export NODE_BINARY=/no/such/node\n');
    expect(state().dirty).toBe(true);
    // With no node on PATH at all, a named node cannot match it either.
    put('ios/.xcode.env.local', `export NODE_BINARY=${nodeBin}\n`);
    expect(prov.readSourceState(repo, { ...env, PATH: '/nowhere' }).dirty).toBe(true);
  });

  it('refuses a symlinked .xcode.env.local', () => {
    fs.writeFileSync(path.join(tmp, 'env-local'), `export NODE_BINARY=${nodeBin}\n`);
    fs.mkdirSync(path.join(repo, 'ios'), { recursive: true });
    fs.symlinkSync(path.join(tmp, 'env-local'), path.join(repo, 'ios', '.xcode.env.local'));
    expect(state().changes).toContain(
      '!! xcode-env: ios/.xcode.env.local is not a plain file (a symlink or a folder)',
    );
  });

  it('refuses when .xcode.env.local changes while the archive is built', () => {
    put('ios/.xcode.env.local', `export NODE_BINARY=${nodeBin}\n`);
    expect(gate()).toBe(0);
    put('ios/.xcode.env.local', 'export NODE_BINARY=$(command -v node)\n');
    expect(record()).toBe(4);
  });
});

describe('Xcode schemes', () => {
  const SHARED = 'ios/KeelWallet.xcodeproj/xcshareddata/xcschemes/KeelWallet.xcscheme';
  const PRE_ACTION = '<Scheme><BuildAction><PreActions><ExecutionAction/></PreActions></BuildAction></Scheme>';
  const state = () => prov.readSourceState(repo, env);

  beforeEach(() => {
    // The real repo's workspace, shared scheme and ignore rule for Pods.
    put(
      'ios/KeelWallet.xcworkspace/contents.xcworkspacedata',
      '<Workspace version = "1.0">\n<FileRef location = "group:KeelWallet.xcodeproj"></FileRef>\n' +
        '<FileRef location = "group:Pods/Pods.xcodeproj"></FileRef>\n</Workspace>\n',
    );
    put('ios/KeelWallet.xcodeproj/project.pbxproj', 'project');
    put(SHARED, '<Scheme/>');
    fs.appendFileSync(path.join(repo, '.gitignore'), '**/Pods/\n');
    git('add', '.');
    git('commit', '-qm', 'xcode');
    // What pod install leaves: a Pods project with per-pod user schemes.
    put('ios/Pods/Pods.xcodeproj/project.pbxproj', 'pods');
    put('ios/Pods/Pods.xcodeproj/xcuserdata/dev.xcuserdatad/xcschemes/RNScreens.xcscheme', '<Scheme/>');
    fs.mkdirSync(path.join(repo, 'ios', 'Pods', 'Headers'), { recursive: true });
    fs.symlinkSync('../../node_modules/x/x.h', path.join(repo, 'ios', 'Pods', 'Headers', 'x.h'));
  });

  it('allows the shared scheme, Xcode user data and the per-pod schemes CocoaPods writes', () => {
    put('ios/KeelWallet.xcworkspace/xcuserdata/dev.xcuserdatad/UserInterfaceState.xcuserstate', 'ui');
    const s = state();
    expect(s.changes).toEqual([]);
    expect(s.xcodeSchemes.schemes).toBe(2);
    expect(gate()).toBe(0);
  });

  it('refuses a personal scheme of the app, with no override', () => {
    for (const where of ['xcworkspace', 'xcodeproj']) {
      const f = `ios/KeelWallet.${where}/xcuserdata/dev.xcuserdatad/xcschemes/Release.xcscheme`;
      put(f, PRE_ACTION);
      expect(state().changes).toEqual([
        `!! xcode-scheme: ${f} is a personal Xcode scheme, which could replace the shared one`,
      ]);
      expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
      fs.rmSync(path.join(repo, f));
    }
  });

  it('refuses a personal scheme behind a symlink, which a scan that does not follow it missed (decided 2026-10-02)', () => {
    const elsewhere = path.join(tmp, 'elsewhere.xcuserdatad');
    fs.mkdirSync(path.join(elsewhere, 'xcschemes'), { recursive: true });
    fs.writeFileSync(path.join(elsewhere, 'xcschemes', 'KeelWallet.xcscheme'), PRE_ACTION);
    const userdata = path.join(repo, 'ios', 'KeelWallet.xcworkspace', 'xcuserdata');
    fs.mkdirSync(userdata, { recursive: true });
    // (1) the user's folder is a symlink
    fs.symlinkSync(elsewhere, path.join(userdata, 'dev.xcuserdatad'));
    expect(state().changes).toContain(
      '!! xcode-scheme: ios/KeelWallet.xcworkspace/xcuserdata/dev.xcuserdatad is a symlink where Xcode looks for projects and schemes',
    );
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
    fs.rmSync(path.join(userdata, 'dev.xcuserdatad'));
    // (2) the xcschemes folder inside it is a symlink
    fs.mkdirSync(path.join(userdata, 'dev.xcuserdatad'));
    fs.symlinkSync(path.join(elsewhere, 'xcschemes'), path.join(userdata, 'dev.xcuserdatad', 'xcschemes'));
    expect(state().dirty).toBe(true);
    fs.rmSync(path.join(userdata, 'dev.xcuserdatad', 'xcschemes'));
    // (3) the scheme file itself is a symlink, in the Pods project
    fs.symlinkSync(
      path.join(elsewhere, 'xcschemes', 'KeelWallet.xcscheme'),
      path.join(repo, 'ios/Pods/Pods.xcodeproj/xcuserdata/dev.xcuserdatad/xcschemes/Other.xcscheme'),
    );
    expect(state().changes).toContain(
      '!! xcode-scheme: ios/Pods/Pods.xcodeproj/xcuserdata/dev.xcuserdatad/xcschemes/Other.xcscheme is a symlink where Xcode looks for projects and schemes',
    );
  });

  it('refuses a second KeelWallet scheme anywhere, e.g. among the Pods schemes', () => {
    const f = 'ios/Pods/Pods.xcodeproj/xcuserdata/dev.xcuserdatad/xcschemes/keelwallet.xcscheme';
    put(f, PRE_ACTION);
    expect(state().changes).toEqual([
      `!! xcode-scheme: ${f} is a second KeelWallet scheme, which could replace the shared one`,
    ]);
    expect(gate({ TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
  });

  it('refuses a project the workspace opens through a symlinked folder', () => {
    const pods = path.join(tmp, 'other-pods');
    fs.renameSync(path.join(repo, 'ios', 'Pods'), pods);
    fs.symlinkSync(pods, path.join(repo, 'ios', 'Pods'));
    expect(state().changes).toContain(
      `!! xcode-scheme: ios/Pods/Pods.xcodeproj, which the workspace opens, is reached through a symlink (${fs.realpathSync(path.join(pods, 'Pods.xcodeproj'))})`,
    );
  });

  it('ios-archive.sh names the workspace and the scheme, and builds in an emptied folder of its own', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'ios-archive.sh'), 'utf8');
    expect(script).toContain('xcodebuild -workspace KeelWallet.xcworkspace -scheme KeelWallet ');
    expect(script).not.toMatch(/ls -d \*\.xcworkspace/);
    expect(script).toMatch(/\nrm -rf "\$DERIVED"\nmkdir -p "\$DERIVED"\n/);
    expect(script).toContain('-derivedDataPath "$DERIVED"');
    expect(script).not.toMatch(/\nDERIVED="\$ROOT\/ios\/build-device"/);
  });
});

describe('dependencies git does not hold', () => {
  it('records digests of node_modules and ios/Pods with a passed gate', () => {
    put('node_modules/react/index.js', 'module.exports = 1;\n');
    put('node_modules/.cache/babel/x', 'cache');
    expect(gate()).toBe(0);
    const [entry] = logLines();
    expect(entry.dependencies.node_modules.files).toBe(1); // react
    expect(entry.dependencies['ios/Pods']).toBeNull();
    const before = entry.dependencies.node_modules.sha256;
    put('node_modules/.cache/babel/x', 'other cache');
    expect(prov.dependencyDigests(repo).node_modules!.sha256).toBe(before);
    put('node_modules/react/index.js', 'module.exports = "implant";\n');
    expect(prov.dependencyDigests(repo).node_modules!.sha256).not.toBe(before);
  });
});

describe('the build environment', () => {
  const shell: Env = {
    HOME: '/Users/dev',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    USER: 'dev',
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    TMPDIR: '/var/folders/x/',
    DEVELOPER_DIR: '/Applications/Xcode.app/Contents/Developer',
    TALIA_HWW: '1',
    XCODE_XCCONFIG_FILE: '/tmp/evil.xcconfig',
    PODFILE_DIR: '/tmp/evil',
    EXTRA_PACKAGER_ARGS: '--entry-file evil.js',
    GIT_DIR: '/tmp/clone/.git',
    AWS_SECRET_ACCESS_KEY: 'secret',
  };

  it('keeps only what Xcode needs and the flags', () => {
    const { kept, dropped } = prov.buildEnv(shell);
    expect(Object.keys(kept).sort()).toEqual(
      ['HOME', 'LANG', 'LC_ALL', 'PATH', 'TALIA_HWW', 'TMPDIR', 'USER'].sort(),
    );
    expect(dropped).toEqual([
      'AWS_SECRET_ACCESS_KEY',
      'DEVELOPER_DIR',
      'EXTRA_PACKAGER_ARGS',
      'GIT_DIR',
      'PODFILE_DIR',
      'XCODE_XCCONFIG_FILE',
    ]);
  });

  it('records the kept values and the dropped NAMES (never their values)', () => {
    expect(gate({ ...shell, DEVELOPER_DIR: undefined })).toBe(0);
    const [entry] = logLines();
    expect(entry.build.env.PATH).toBe(shell.PATH);
    expect(entry.build.env.XCODE_XCCONFIG_FILE).toBeUndefined();
    expect(entry.build.droppedEnv).toContain('XCODE_XCCONFIG_FILE');
    expect(JSON.stringify(entry)).not.toContain('secret');
  });

  it('build-env hands ios-archive.sh exactly the kept pairs', () => {
    let out = '';
    (process.stdout.write as unknown as jest.Mock).mockImplementation((s: string) => {
      out += s;
      return true;
    });
    expect(prov.main(['build-env'], shell, repo)).toBe(0);
    const pairs = out.split('\0').filter(Boolean);
    expect(pairs).toContain('PATH=/usr/local/bin:/usr/bin:/bin');
    expect(pairs).toContain('TALIA_HWW=1');
    expect(pairs.some((p) => p.startsWith('XCODE_XCCONFIG_FILE='))).toBe(false);
  });

  it('ios-archive.sh starts every xcodebuild and the Metro re-bundle under env -i', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'ios-archive.sh'), 'utf8');
    const code = script
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    // Each place a command starts: `xcodebuild -...` or `node ...bundle.js" bundle`.
    const calls = code.match(/[^\n]*(\bxcodebuild -|bundle\.js" bundle)[^\n]*/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      expect(call).toMatch(/env -i "\$\{BUILD_ENV\[@\]\}"( TMPDIR="[^"]+")? (\/usr\/bin\/xcodebuild|node)/);
    }
  });
});

describe('which Xcode builds the archive (decided 2026-10-02)', () => {
  const selectedXcode = (): string | null => {
    try {
      return execFileSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8', env: {} }).trim() || null;
    } catch {
      return null; // not a Mac (CI runs on Linux)
    }
  };

  it('refuses a DEVELOPER_DIR naming another copy of Xcode, with no override', () => {
    // A copy whose every entry is a link to the real Xcode.
    const fake = path.join(tmp, 'Fake.app', 'Contents', 'Developer');
    fs.mkdirSync(fake, { recursive: true });
    fs.mkdirSync(path.join(fake, 'usr', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'usr', 'bin', 'xcodebuild'), '#!/bin/sh\necho FAKE TOOLCHAIN\n');
    expect(prov.readDeveloperDir({ DEVELOPER_DIR: fake }).problems).toHaveLength(1);
    expect(gate({ DEVELOPER_DIR: fake, TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toBe(3);
    const [entry] = logLines();
    expect(entry.event).toBe('refused');
    expect(entry.source.developerDir.developerDirEnv).toBe(fake);
    expect(gate({ DEVELOPER_DIR: path.join(tmp, 'missing') })).toBe(3);
  });

  it('allows a DEVELOPER_DIR that IS the selected Xcode, or none, and records the selected one', () => {
    expect(gate()).toBe(0);
    const selected = selectedXcode();
    expect(logLines()[0].source.developerDir.selected).toBe(selected);
    if (selected) {
      // Reached through a symlink, it is still the same Xcode.
      const link = path.join(tmp, 'Xcode-link');
      fs.symlinkSync(selected, link);
      expect(gate({ DEVELOPER_DIR: link })).toBe(0);
    }
  });

  it('never hands DEVELOPER_DIR, TOOLCHAINS or SDKROOT to the build or to git', () => {
    const swap = { DEVELOPER_DIR: '/tmp/Fake.app/Contents/Developer', TOOLCHAINS: 'evil', SDKROOT: '/tmp/sdk' };
    expect(Object.keys(prov.buildEnv({ ...env, ...swap }).kept)).not.toEqual(
      expect.arrayContaining(['DEVELOPER_DIR']),
    );
    for (const name of Object.keys(swap)) {
      expect(prov.buildEnv({ ...env, ...swap }).kept[name]).toBeUndefined();
    }
    const saved = { ...process.env };
    try {
      Object.assign(process.env, swap);
      const g = prov.gitEnv();
      for (const name of Object.keys(swap)) {
        expect(g[name]).toBeUndefined();
      }
    } finally {
      for (const name of Object.keys(swap)) {
        if (saved[name] === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = saved[name];
        }
      }
    }
  });

  it('ios-archive.sh unsets them after the gate and calls xcodebuild by its absolute path', () => {
    const script = fs.readFileSync(path.join(__dirname, '..', 'ios-archive.sh'), 'utf8');
    const gateAt = script.indexOf('"$PROV" gate');
    const unsetAt = script.indexOf('unset DEVELOPER_DIR TOOLCHAINS SDKROOT');
    const firstBuild = script.indexOf('/usr/bin/xcodebuild -workspace');
    expect(gateAt).toBeGreaterThan(0);
    expect(unsetAt).toBeGreaterThan(gateAt);
    expect(firstBuild).toBeGreaterThan(unsetAt);
    const code = script
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/[^/]xcodebuild -/);
  });
});
