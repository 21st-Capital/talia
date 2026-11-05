/**
 * scripts/native-sources.js: the checks native/build-bdkwallet.sh and the
 * phone, simulator and archive builds run on a native library and on the
 * app's link (BDK upgrade, decided 2026-10-15). Synthetic Mach-O objects,
 * ar archives, cargo metadata and xcodebuild logs in the OS temp folder.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type Entry = Record<string, any>;
type Xcode = { version: string; build: string } | null;
const src = require('../native-sources.js') as {
  parseXcodeVersion: (out: string) => Xcode;
  xcodeWarnings: (sources: Entry[], installed: Xcode) => string[];
  arMembers: (buf: Buffer, label: string) => { name: string; body: Buffer }[];
  archiveSlices: (buf: Buffer, label: string) => Record<string, Buffer>;
  machoVersions: (body: Buffer) => { command: string; platform: string; minos: string }[] | null;
  judgeMinos: (
    members: { name: string; body: Buffer }[],
    platform: string,
    toolchain: Set<string>,
  ) => { ours: number; toolchain: number; toolchainMinos: Map<string, number>; problems: string[] };
  duplicateWarnings: (log: string) => { found: { name: string; objects: string[] }[]; unnamed: string[][]; stray: number };
  main: (argv: string[], root?: string, deps?: { xcode?: () => Xcode }) => number;
};
const prov = require('../archive-provenance.js') as {
  NATIVE_PIN: string;
  NATIVE_SOURCES: Record<string, { files: string[]; duplicates: string | null; toolCrates: string[] | null }>;
  arMemberNames: (file: string) => string[];
  toolCratesIn: (file: string, crates: string[]) => string[];
  toolCrateFindings: (root: string, pins: { path: string }[]) => { lib: string; path: string; crates: string[] }[];
  gateDecision: (state: Entry, env: Record<string, string>) => Entry;
};

const sha = (b: Buffer | string) => require('crypto').createHash('sha256').update(b).digest('hex');
const ARM64 = 0x0100000c;
const X86_64 = 0x01000007;

/** A 64-bit Mach-O object holding only version load commands (and a tag, so two differ). */
function macho(
  versions: { cmd: 'build'; platform: number; minos: [number, number] }[] | { cmd: 'min'; minos: [number, number] }[],
  tag = '',
  cpu = ARM64,
): Buffer {
  const cmds = (versions as Entry[]).map((v) => {
    const packed = (v.minos[0] << 16) | (v.minos[1] << 8);
    if (v.cmd === 'build') {
      const b = Buffer.alloc(24);
      b.writeUInt32LE(0x32, 0);
      b.writeUInt32LE(24, 4);
      b.writeUInt32LE(v.platform, 8);
      b.writeUInt32LE(packed, 12);
      b.writeUInt32LE(packed, 16);
      return b;
    }
    const b = Buffer.alloc(16);
    b.writeUInt32LE(0x25, 0); // LC_VERSION_MIN_IPHONEOS
    b.writeUInt32LE(16, 4);
    b.writeUInt32LE(packed, 8);
    b.writeUInt32LE(packed, 12);
    return b;
  });
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cpu, 4);
  header.writeUInt32LE(1, 12);
  header.writeUInt32LE(cmds.length, 16);
  header.writeUInt32LE(cmds.reduce((n, c) => n + c.length, 0), 20);
  return Buffer.concat([header, ...cmds, Buffer.from(tag)]);
}

/** A BSD ar archive (long names as "#1/<n>", as rustc and libtool write them). */
function ar(members: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [Buffer.from('!<arch>\n', 'latin1')];
  const field = (s: string, n: number) => Buffer.from(s.padEnd(n, ' ').slice(0, n), 'latin1');
  for (const [name, body] of [['__.SYMDEF SORTED', Buffer.alloc(8)] as [string, Buffer], ...members]) {
    const nameBytes = Buffer.from(name, 'latin1');
    const long = name.length > 16 || name.includes(' ');
    const payload = long ? Buffer.concat([nameBytes, body]) : body;
    parts.push(
      field(long ? `#1/${nameBytes.length}` : name, 16),
      field('0', 12),
      field('0', 6),
      field('0', 6),
      field('644', 8),
      field(String(payload.length), 10),
      Buffer.from('`\n', 'latin1'),
      payload,
    );
    if (payload.length % 2 === 1) {
      parts.push(Buffer.from('\n'));
    }
  }
  return Buffer.concat(parts);
}

/** A fat (universal) file of `slices`: [cpu, bytes]. */
function fat(slices: [number, Buffer][]): Buffer {
  const header = Buffer.alloc(8 + 20 * slices.length);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(slices.length, 4);
  let offset = header.length;
  const bodies: Buffer[] = [];
  slices.forEach(([cpu, bytes], i) => {
    header.writeUInt32BE(cpu, 8 + 20 * i);
    header.writeUInt32BE(offset, 8 + 20 * i + 8);
    header.writeUInt32BE(bytes.length, 8 + 20 * i + 12);
    bodies.push(bytes);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...bodies]);
}

const OURS_IOS = macho([{ cmd: 'build', platform: 2, minos: [15, 0] }], 'bdk_wallet');
const OURS_SIM = macho([{ cmd: 'build', platform: 7, minos: [15, 0] }], 'bdk_wallet sim');
const STD_IOS = macho([{ cmd: 'min', minos: [10, 0] }], 'std');
const STD_SIM = macho([{ cmd: 'build', platform: 7, minos: [14, 0] }], 'std sim');
const STD_X86 = macho([{ cmd: 'min', minos: [10, 0] }], 'std x86', X86_64);
const OURS_X86 = macho([{ cmd: 'build', platform: 7, minos: [15, 0] }], 'bdk_wallet x86', X86_64);

let tmp: string;
let sysroot: string;
let err: string;

function put(rel: string, content: string | Buffer, root = tmp): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'talia-checks-')));
  // A toolchain whose prebuilt std is the STD_* objects.
  sysroot = path.join(tmp, 'sysroot');
  put('sysroot/lib/rustlib/aarch64-apple-ios/lib/libstd-x.rlib', ar([['std-x.std.0.rcgu.o', STD_IOS], ['lib.rmeta', Buffer.from('meta')]]));
  put('sysroot/lib/rustlib/aarch64-apple-ios-sim/lib/libstd-x.rlib', ar([['std-x.std.0.rcgu.o', STD_SIM]]));
  put('sysroot/lib/rustlib/x86_64-apple-ios/lib/libstd-x.rlib', ar([['std-x.std.0.rcgu.o', STD_X86]]));
  err = '';
  jest.spyOn(process.stderr, 'write').mockImplementation((s: string | Uint8Array) => {
    err += String(s);
    return true;
  });
  jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
  jest.restoreAllMocks();
  // git 2.4x+ may still be running its detached auto-maintenance in a test repo
  // (found 2026-10-22: ENOTEMPTY under a full parallel run), so the removal retries.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('the minimum iOS of every object (decided 2026-09-26)', () => {
  it('reads the archives, thin and fat, and the version load commands', () => {
    const thin = ar([['a.o', OURS_IOS], ['a-name-longer-than-sixteen.o', STD_IOS]]);
    expect(src.arMembers(thin, 'x').map((m) => m.name)).toEqual(['a.o', 'a-name-longer-than-sixteen.o']);
    expect(Object.keys(src.archiveSlices(thin, 'x'))).toEqual(['arm64']);
    const universal = fat([
      [ARM64, ar([['a.o', OURS_SIM]])],
      [X86_64, ar([['a.o', OURS_X86]])],
    ]);
    expect(Object.keys(src.archiveSlices(universal, 'x')).sort()).toEqual(['arm64', 'x86_64']);
    expect(src.machoVersions(OURS_IOS)).toEqual([{ command: 'LC_BUILD_VERSION', platform: 'iOS', minos: '15.0' }]);
    expect(src.machoVersions(STD_IOS)).toEqual([{ command: 'LC_VERSION_MIN', platform: 'iOS', minos: '10.0' }]);
    expect(src.machoVersions(Buffer.from('not an object'))).toBeNull();
  });

  it('takes objects built here for iOS 15.0 and the toolchain\'s own objects, byte for byte', () => {
    const r = src.judgeMinos(
      [
        { name: 'ours.o', body: OURS_IOS },
        { name: 'std.o', body: STD_IOS },
      ],
      'iOS',
      new Set([sha(STD_IOS)]),
    );
    expect(r.problems).toEqual([]);
    expect(r.ours).toBe(1);
    expect(r.toolchain).toBe(1);
    expect([...r.toolchainMinos]).toEqual([['iOS 10.0', 1]]);
  });

  it.each([
    ['an object built for a NEWER iOS (what an Xcode update used to stamp on C code)', macho([{ cmd: 'build', platform: 2, minos: [27, 1] }], 'c'), 'newer than iOS 15.0'],
    ['an older object that is not the toolchain\'s', macho([{ cmd: 'min', minos: [10, 0] }], 'someone else'), 'is not one of the toolchain\'s own objects'],
    ['a simulator object in a device library', macho([{ cmd: 'build', platform: 7, minos: [15, 0] }], 'sim'), 'not iOS 15.0'],
    ['an object with no iOS version', macho([], 'none'), 'no iOS version'],
    ['something that is not an object', Buffer.from('a stray file'), 'not a 64-bit Mach-O object'],
  ])('refuses %s', (_what, body, says) => {
    const r = src.judgeMinos([{ name: 'x.o', body }], 'iOS', new Set([sha(STD_IOS)]));
    expect(r.problems.join('\n')).toContain(says);
  });

  it('a toolchain object never excuses a newer iOS', () => {
    const newer = macho([{ cmd: 'build', platform: 2, minos: [16, 0] }], 'std');
    expect(src.judgeMinos([{ name: 'std.o', body: newer }], 'iOS', new Set([sha(newer)])).problems).toHaveLength(1);
  });

  it('minos checks each slice against the toolchain of its own target', () => {
    const ios = put('ios.a', ar([['ours.o', OURS_IOS], ['std.o', STD_IOS]]));
    expect(src.main(['minos', 'ios', ios, sysroot])).toBe(0);
    expect(err).toContain('arm64: 1 objects built for iOS 15.0; 1 the toolchain\'s own');
    const sim = put('sim.a', fat([
      [ARM64, ar([['ours.o', OURS_SIM], ['std.o', STD_SIM]])],
      [X86_64, ar([['ours.o', OURS_X86], ['std.o', STD_X86]])],
    ]));
    expect(src.main(['minos', 'sim', sim, sysroot])).toBe(0);
    // The device toolchain's std is not the simulator's.
    const mixed = put('mixed.a', fat([
      [ARM64, ar([['ours.o', OURS_SIM], ['std.o', STD_IOS]])],
      [X86_64, ar([['ours.o', OURS_X86], ['std.o', STD_X86]])],
    ]));
    expect(src.main(['minos', 'sim', mixed, sysroot])).toBe(2);
    // A device library must be arm64 alone, a simulator one arm64 and x86_64.
    expect(src.main(['minos', 'sim', ios, sysroot])).toBe(2);
    expect(src.main(['minos', 'ios', sim, sysroot])).toBe(2);
    expect(src.main(['minos', 'tv', ios, sysroot])).toBe(64);
  });
});

describe('the patched crates resolve to their vendored copies', () => {
  const crate = () => path.join(tmp, 'bdk-ffi');
  function metadata(packages: Entry[]): string {
    return put(
      'metadata.json',
      JSON.stringify({ packages, resolve: { nodes: packages.map((p) => ({ id: p.id })) } }),
    );
  }
  beforeEach(() => {
    put('bdk-ffi/vendor/electrum-client/Cargo.toml', '[package]\n');
    put('bdk-ffi/vendor/bdk_wallet/Cargo.toml', '[package]\n');
  });
  const vendored = (name: string, version: string) => ({
    name,
    version,
    id: `path+file://${crate()}/vendor/${name}#${version}`,
    source: null,
    manifest_path: path.join(crate(), 'vendor', name, 'Cargo.toml'),
  });

  it('passes when each is the vendored copy and the only one', () => {
    const meta = metadata([vendored('electrum-client', '0.25.0'), vendored('bdk_wallet', '3.1.0')]);
    expect(src.main(['vendored', meta, crate(), 'electrum-client', 'bdk_wallet'])).toBe(0);
    expect(err).toContain('electrum-client 0.25.0: vendor/electrum-client');
  });

  it.each([
    ['the registry copy', () => [{ ...vendored('electrum-client', '0.25.0'), source: 'registry+https://github.com/rust-lang/crates.io-index', manifest_path: '/x/Cargo.toml' }], 'comes from registry'],
    ['a second copy beside the vendored one', () => [vendored('electrum-client', '0.25.0'), { ...vendored('electrum-client', '0.24.0'), source: 'registry+x', id: 'other' }], '2 copies'],
    ['no copy at all (a patch that was not used)', () => [], '0 copies'],
  ])('refuses %s', (_what, packages, says) => {
    const meta = metadata((packages as () => Entry[])());
    expect(src.main(['vendored', meta, crate(), 'electrum-client'])).toBe(2);
    expect(err).toContain(says);
  });
});

describe('the link: duplicate symbols', () => {
  const app = () => path.join(tmp, 'app');
  const LD = "Ld /x/Build/Products/Release-iphoneos/KeelWallet.app/KeelWallet normal (in target 'KeelWallet' from project 'KeelWallet')\n";
  const dup = (name: string, a = 'libbitboxffi-ios.a', b = 'libbdkwallet-ios.a') =>
    `ld: warning: duplicate symbol '${name}' in:\n    /x/lib/${a}[12](secp256k1_sys-1.o)\n    /x/lib/${b}[34](secp256k1_sys-2.o)\n`;
  const log = (text: string) => put('xcodebuild.log', text);
  beforeEach(() => {
    put(
      prov.NATIVE_SOURCES.bdkwallet.duplicates as string,
      '# comment\nios bitboxffi bdkwallet _rustsecp256k1_v0_10_0_context_create\nsim bitboxffi bdkwallet _rustsecp256k1_v0_10_0_context_destroy\n',
      app(),
    );
  });

  it('reads the linker\'s warnings, and counts any other mention of a duplicate', () => {
    const r = src.duplicateWarnings(`${LD}${dup('_a')}note: x\n${dup('_b')}something about a duplicate symbol\n`);
    expect(r.found.map((f) => f.name)).toEqual(['_a', '_b']);
    expect(r.found[0].objects).toHaveLength(2);
    expect(r.unnamed).toEqual([]);
    expect(r.stray).toBe(1);
  });

  // Copied from real Xcode 27.1 links of this app (2026-10-16 and 2026-10-17;
  // only the checkout's path is shortened): the Ld block of each.
  const real = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'xcode27-link', `${name}.log`), 'utf8');

  describe('real Xcode 27 links (decided 2026-10-17)', () => {
    it('reads the objects ld prints with no line naming the symbol (Xcode\'s -no_warn_duplicate_libraries)', () => {
      const release = src.duplicateWarnings(real('sim-release-headerless'));
      expect(release.found).toEqual([]);
      expect(release.unnamed).toHaveLength(1);
      expect(release.unnamed[0]).toHaveLength(8);
      expect(release.unnamed[0][0]).toMatch(/libbitboxffi-ios\.a\[297\]\(uniffi_core-/);
      expect(release.unnamed[0][1]).toMatch(/libbdkffi-ios\.a\[arm64\]\[47\]\(uniffi_core-/);
      const debug = src.duplicateWarnings(real('sim-debug-headerless'));
      expect(debug.found).toEqual([]);
      expect(debug.unnamed.flat()).toHaveLength(16);
    });

    it.each([['sim-release-headerless'], ['sim-debug-headerless']])(
      'refuses %s on both slices: the link hid the names, and printed duplicates nobody can name',
      (name) => {
        for (const sdk of ['iphonesimulator', 'iphoneos']) {
          err = '';
          expect(src.main(['link-check', sdk, log(real(name))], app())).toBe(2);
          expect(err).toContain('ends on -no_warn_duplicate_libraries');
          expect(err).toContain('LD_WARN_DUPLICATE_LIBRARIES=YES');
          expect(err).toContain('with no line naming the symbol');
        }
      },
    );

    it('reads the named warnings xcodebuild prints with LD_WARN_DUPLICATE_LIBRARIES=YES, fat members too', () => {
      const r = src.duplicateWarnings(real('sim-release-warned'));
      expect(r.unnamed).toEqual([]);
      expect(r.stray).toBe(0);
      expect(r.found.map((f) => f.name)).toEqual([
        '_uniffi_rustbuffer_free',
        '_rustsecp256k1_v0_10_0_default_error_callback_fn',
        '_rustsecp256k1_v0_10_0_default_illegal_callback_fn',
        '_uniffi_rustbuffer_from_bytes',
      ]);
      for (const f of r.found) {
        expect(f.objects).toHaveLength(2);
      }
      expect(r.found[0].objects[0]).toMatch(/talia-sim-libs\/libbdkffi-ios\.a\[arm64\]\[47\]\(uniffi_core-[^)]+\.o\)$/);
      expect(r.found[1].objects[0]).toMatch(/talia-sim-libs\/libbdkwallet-ios\.a\[arm64\]\[110\]\(secp256k1_sys-/);
    });

    // That link still carried the old engine's library (bdkffi), which the
    // old engine's removal took out (decided 2026-11-04): its two uniffi_core
    // names are refused now, whatever the list says, as not from two of our
    // libraries; the same link without them is today's link.
    const withoutOld = (text: string) =>
      text.replace(/^.*warning: duplicate symbol '_uniffi_rustbuffer_[a-z_]+' in:\n(?:[ \t]+\S.*\n){2}/gm, '');

    it('refuses the old engine\'s library in a link, listed or not', () => {
      const text = real('sim-release-warned');
      put(
        prov.NATIVE_SOURCES.bdkwallet.duplicates as string,
        ['sim bdkffi bitboxffi _uniffi_rustbuffer_free', 'sim bdkffi bitboxffi _uniffi_rustbuffer_from_bytes', ''].join('\n'),
        app(),
      );
      expect(src.main(['link-check', 'iphonesimulator', log(text)], app())).toBe(2);
      expect(err).toContain('duplicate symbol _uniffi_rustbuffer_free comes from');
      expect(err).toContain('libbdkffi-ios.a[arm64][47]');
      expect(err).toContain('not from two of our native libraries');
    });

    it('passes the named link once each name is listed, fat and thin members alike, and refuses the rest', () => {
      const text = withoutOld(real('sim-release-warned'));
      expect(src.duplicateWarnings(text).found.map((f) => f.name)).toEqual([
        '_rustsecp256k1_v0_10_0_default_error_callback_fn',
        '_rustsecp256k1_v0_10_0_default_illegal_callback_fn',
      ]);
      // Not listed: refused by name.
      expect(src.main(['link-check', 'iphonesimulator', log(text)], app())).toBe(2);
      expect(err).toContain(
        'duplicate symbol _rustsecp256k1_v0_10_0_default_error_callback_fn between bitboxffi and bdkwallet is not on the allowlist for sim',
      );
      const listed = [
        'sim bitboxffi bdkwallet _rustsecp256k1_v0_10_0_default_error_callback_fn',
        'sim bitboxffi bdkwallet _rustsecp256k1_v0_10_0_default_illegal_callback_fn',
        '',
      ].join('\n');
      // Every name listed, but for the other slice: refused.
      put(prov.NATIVE_SOURCES.bdkwallet.duplicates as string, listed.replace(/^sim /gm, 'ios '), app());
      err = '';
      expect(src.main(['link-check', 'iphonesimulator', log(text)], app())).toBe(2);
      expect(err).toContain('between bitboxffi and bdkwallet is not on the allowlist for sim');
      put(prov.NATIVE_SOURCES.bdkwallet.duplicates as string, listed, app());
      err = '';
      expect(src.main(['link-check', 'iphonesimulator', log(text)], app())).toBe(0);
      expect(err).toContain('reported 2 duplicate symbol(s), each on the allowlist for its pair of libraries');
      expect(err).toContain('    _rustsecp256k1_v0_10_0_default_error_callback_fn (bitboxffi bdkwallet)');
      // A fat member of a library that is not ours is refused, bracket groups and all.
      err = '';
      expect(
        src.main(['link-check', 'iphonesimulator', log(text.replace(/talia-sim-libs\/libbdkwallet-ios\.a\[arm64\]/g, 'Stock/libStock.a[arm64]'))], app()),
      ).toBe(2);
      expect(err).toContain('not from two of our native libraries');
    });
  });

  it('passes a link with no duplicate, or only listed ones between our own libraries', () => {
    expect(src.main(['link-check', 'iphoneos', log(LD)], app())).toBe(0);
    expect(err).toContain('reported no duplicate symbol');
    expect(src.main(['link-check', 'iphoneos', log(`${LD}${dup('_rustsecp256k1_v0_10_0_context_create')}`)], app())).toBe(0);
    expect(src.main(['link-check', 'iphonesimulator', log(`${LD}${dup('_rustsecp256k1_v0_10_0_context_destroy')}`)], app())).toBe(0);
  });

  it.each([
    ['a duplicate not on the list', `${LD}${dup('_ring_core_0_17_14_bn_mul_mont')}`, 'is not on the allowlist'],
    ['a listed name for the other slice', `${LD}${dup('_rustsecp256k1_v0_10_0_context_destroy')}`, 'is not on the allowlist'],
    ['a listed name from another library', `${LD}${dup('_rustsecp256k1_v0_10_0_context_create', 'libbitboxffi-ios.a', 'libStock.a')}`, 'not from two of our native libraries'],
    // Decided 2026-10-17: a name is proven identical for ONE pair of
    // libraries. The old engine's library, removed with it (decided
    // 2026-11-04), is no library of ours any more.
    [
      'a listed name between the old engine\'s library and the wallet library',
      `${LD}${dup('_rustsecp256k1_v0_10_0_context_create', 'libbdkffi-ios.a', 'libbdkwallet-ios.a')}`,
      'not from two of our native libraries',
    ],
    [
      'a listed name between its pair and a third library',
      `${LD}${dup('_rustsecp256k1_v0_10_0_context_create')}    /x/lib/libbdkffi-ios.a[56](secp256k1_sys-3.o)\n`,
      'not from two of our native libraries',
    ],
    [
      'a name defined twice inside one library',
      `${LD}${dup('_rustsecp256k1_v0_10_0_context_create', 'libbitboxffi-ios.a', 'libbitboxffi-ios.a')}`,
      'is defined twice inside bitboxffi',
    ],
    ['a duplicate in a form this check does not read', `${LD}duplicate symbol '_x' in:\n`, 'in a form this check does not read'],
    ['a log in which the app was not linked', 'Build succeeded\n', 'shows no link of KeelWallet.app/KeelWallet'],
  ])('refuses %s', (_what, text, says) => {
    expect(src.main(['link-check', 'iphoneos', log(text)], app())).toBe(2);
    expect(err).toContain(says);
  });

  it('refuses when the allowlist is missing, and a malformed list line', () => {
    fs.rmSync(path.join(app(), prov.NATIVE_SOURCES.bdkwallet.duplicates as string));
    expect(src.main(['link-check', 'iphoneos', log(LD)], app())).toBe(2);
    expect(err).toContain('duplicate-symbols.txt (bdkwallet) is missing');
    for (const bad of ['ios _a _b', 'ios _rustsecp256k1_v0_10_0_context_create', 'ios bdkwallet bitboxffi _x', 'ios bdkffi bdkffi _x', 'ios stock bdkffi _x']) {
      err = '';
      put(prov.NATIVE_SOURCES.bdkwallet.duplicates as string, `${bad}\n`, app());
      expect(src.main(['link-check', 'iphoneos', log(LD)], app())).toBe(2);
      expect(err).toContain('is not "<ios|sim> <library> <library> <symbol>"');
    }
    expect(src.main(['link-check', 'iphonesimulator'], app())).toBe(64);
  });

  // Since the old engine's removal (decided 2026-11-04) the committed list is bdkwallet's build
  // output and still names the old engine's pair; never edited by hand.
  it('sets aside a list line naming the old engine\'s library: never refused, never allowed', () => {
    put(
      prov.NATIVE_SOURCES.bdkwallet.duplicates as string,
      'ios bdkffi bitboxffi _uniffi_rustbuffer_free\nios bitboxffi bdkwallet _rustsecp256k1_v0_10_0_context_create\n',
      app(),
    );
    expect(src.main(['link-check', 'iphoneos', log(`${LD}${dup('_rustsecp256k1_v0_10_0_context_create')}`)], app())).toBe(0);
    err = '';
    expect(src.main(['link-check', 'iphoneos', log(`${LD}${dup('_uniffi_rustbuffer_free')}`)], app())).toBe(2);
    expect(err).toContain('_uniffi_rustbuffer_free between bitboxffi and bdkwallet is not on the allowlist for ios');
  });

  it('the committed allowlist names only secp256k1 between BitBox and the wallet library (decided 2026-11-05: the first rebuild without the old engine listed none of its pair)', () => {
    const root = path.join(__dirname, '..', '..');
    const text = fs.readFileSync(path.join(root, prov.NATIVE_SOURCES.bdkwallet.duplicates as string), 'utf8');
    const lines = text.split('\n').filter((l) => l !== '' && !l.startsWith('#'));
    for (const l of lines) {
      expect(l).toMatch(/^(ios|sim) bitboxffi bdkwallet _rustsecp256k1_v0_10_0_[a-z_]+$/);
    }
    const names = (slice: string) => lines.filter((l) => l.startsWith(`${slice} `)).map((l) => l.slice(4));
    expect(names('ios')).toEqual(names('sim'));
    expect(names('ios')).toHaveLength(4);
    // The real simulator link of 2026-10-17 passes against it once the old
    // engine's library is out of it, and is refused with it.
    const app2 = path.join(tmp, 'committed');
    put(prov.NATIVE_SOURCES.bdkwallet.duplicates as string, text, app2);
    const old = real('sim-release-warned');
    const today = old.replace(/^.*warning: duplicate symbol '_uniffi_rustbuffer_[a-z_]+' in:\n(?:[ \t]+\S.*\n){2}/gm, '');
    expect(src.main(['link-check', 'iphonesimulator', log(today)], app2)).toBe(0);
    expect(src.main(['link-check', 'iphonesimulator', log(old)], app2)).toBe(2);
  });

  it('every build that links the app runs it: the phone build, the archive and the simulator build', () => {
    const root = path.join(__dirname, '..', '..');
    const code = (f: string) =>
      fs
        .readFileSync(path.join(root, f), 'utf8')
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n');
    const device = code('scripts/ios-device.sh');
    expect(device).toContain('${SIDE_SETTINGS[@]+"${SIDE_SETTINGS[@]}"} 2>&1 | tee "$LINK_LOG"');
    expect(device.indexOf('link-check iphoneos "$LINK_LOG" || exit 1')).toBeLessThan(device.indexOf('xcrun devicectl device install'));
    const archive = code('scripts/ios-archive.sh');
    expect(archive).toContain('link-check iphoneos "$SCRATCH/xcodebuild.log"');
    expect(archive.indexOf('link-check iphoneos')).toBeLessThan(archive.indexOf('Proving the archived JavaScript'));
    const sim = code('scripts/ios-sim.sh');
    expect(sim).toContain('node "$SOURCES" link-check iphonesimulator "$LOG" || exit 1');
    expect(sim.indexOf('verify --test-build')).toBeLessThan(sim.indexOf('xcodebuild '));
    // Always a fresh link, so the check always has one to read; signed to run locally (Keychain).
    expect(sim.indexOf('rm -rf "$DD/Build/Products/$CONFIG-iphonesimulator/KeelWallet.app"')).toBeLessThan(sim.indexOf('xcodebuild '));
    expect(sim).toContain('CODE_SIGN_IDENTITY=- ARCHS=arm64');
    expect(sim).not.toContain('CODE_SIGNING_ALLOWED=NO');
    // Every library's simulator file, under its device name, first on the search path.
    expect(sim).toContain('"LIBRARY_SEARCH_PATHS=$SIMLIBS \\$(inherited)"');
    expect(sim).toContain('p.NATIVE_SOURCES[lib].files.find((f) => f.endsWith("-sim.a"))');
    // ld names each duplicate only without Xcode's -no_warn_duplicate_libraries (decided 2026-10-17).
    expect(device).toContain('-derivedDataPath "$DD" build LD_WARN_DUPLICATE_LIBRARIES=YES');
    expect(archive).toContain('TALIA_SOURCE_COMMIT="$STAMP_COMMIT" LD_WARN_DUPLICATE_LIBRARIES=YES >');
    expect(sim).toContain('ONLY_ACTIVE_ARCH=YES LD_WARN_DUPLICATE_LIBRARIES=YES');
    const project = fs.readFileSync(path.join(root, 'ios/KeelWallet.xcodeproj/project.pbxproj'), 'utf8');
    const app = project.match(/\/\* (Debug|Release) \*\/ = \{\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbaseConfigurationReference = [0-9A-F]+ \/\* Pods-KeelWallet\.[a-z]+\.xcconfig \*\/;[\s\S]*?name = \1;/g) || [];
    expect(app).toHaveLength(2);
    for (const config of app) {
      expect(config).toContain('LD_WARN_DUPLICATE_LIBRARIES = YES;');
    }
  });
});

describe('the symbol-overlap gate over every pair the app links (decided 2026-10-17)', () => {
  const app = () => path.join(tmp, 'app');
  const fork = () => path.join(tmp, 'fork');
  const work = () => path.join(tmp, 'work');
  // A stand-in for the fork's gate: it judges two "libraries" (text files
  // listing "sym <name>"), prints the real gate's lines, names every symbol
  // both define as a DUPLICATE, and fails when either holds "review".
  const GATE = [
    'import sys',
    'args = sys.argv[1:]',
    'assert args[0] == "--sysroot"',
    'new, pinned = args[2], args[3]',
    'syms = lambda f: {l.split()[1] for l in open(f) if l.startswith("sym ")}',
    'bad = any("review" in open(f).read() for f in (new, pinned))',
    'print("sysroot: " + args[1])',
    'print("new: " + new + ": arm64 (3 defined global symbols, iOS)")',
    'print("")',
    'print("pinned: " + pinned + ": arm64")',
    'for n in sorted(syms(new) & syms(pinned)):',
    '    print("    DUPLICATE " + n + ": the same code, defined strongly in a.o and b.o")',
    'print("RESULT: " + ("FAIL: overlaps need review" if bad else "PASS: every overlap is identical (members or code)"))',
    'sys.exit(1 if bad else 0)',
    '',
  ].join('\n');
  const files = (lib: string) => prov.NATIVE_SOURCES[lib].files;
  const pinAll = () => {
    let text = '# pins\n';
    for (const lib of ['bitboxffi']) {
      for (const f of files(lib)) {
        text += `${sha(fs.readFileSync(path.join(app(), f)))}  ${f}\n`;
      }
    }
    put(prov.NATIVE_PIN, text, app());
  };
  beforeEach(() => {
    put('bdk-ffi/scripts/symbol-overlap-gate.py', GATE, fork());
    put('bdk-ffi/target/aarch64-apple-ios/release-smaller/libbdkffi.a', 'sym _new_only\nsym _secp_ctx\n', fork());
    put('bdk-ffi/target/lipo-ios-sim/libbdkffi.a', 'sym _secp_ctx\n', fork());
    put(files('bitboxffi')[0], 'sym _rb_alloc\nsym _secp_ctx\n', app());
    put(files('bitboxffi')[1], 'sym _rb_alloc\nsym _secp_ctx\n', app());
    fs.mkdirSync(work(), { recursive: true });
    pinAll();
  });

  it('judges the new build against each pinned library, and writes the list per pair', () => {
    expect(src.main(['gate', 'bdkwallet', fork(), work(), '/sysroot'], app())).toBe(0);
    // One other library since 2026-11-04: one pair per slice.
    expect(fs.readdirSync(work()).sort()).toEqual(['duplicate-symbols.txt', 'gate-ios-bitboxffi-bdkwallet.txt', 'gate-sim-bitboxffi-bdkwallet.txt']);
    // The new library is the gate's "new" side.
    const report = fs.readFileSync(path.join(work(), 'gate-ios-bitboxffi-bdkwallet.txt'), 'utf8');
    expect(report).toContain(`new: ${path.join(fork(), 'bdk-ffi/target/aarch64-apple-ios/release-smaller/libbdkffi.a')}: `);
    expect(report).toContain(`pinned: ${path.join(app(), files('bitboxffi')[0])}: `);
    const list = fs.readFileSync(path.join(work(), 'duplicate-symbols.txt'), 'utf8');
    expect(list.split('\n').filter((l) => l !== '' && !l.startsWith('#'))).toEqual([
      'ios bitboxffi bdkwallet _secp_ctx',
      'sim bitboxffi bdkwallet _secp_ctx',
    ]);
    // The list is one link-check reads.
    put(prov.NATIVE_SOURCES.bdkwallet.duplicates as string, list, app());
    const LD = "Ld /x/KeelWallet.app/KeelWallet normal (in target 'KeelWallet' from project 'KeelWallet')\n";
    const dup = (name: string, a: string, b: string) => `ld: warning: duplicate symbol '${name}' in:\n    /x/${a}[1](a.o)\n    /x/${b}[2](b.o)\n`;
    put('ok.log', `${LD}${dup('_secp_ctx', 'libbdkwallet-ios.a', 'libbitboxffi-ios.a')}`);
    expect(src.main(['link-check', 'iphoneos', path.join(tmp, 'ok.log')], app())).toBe(0);
    put('bad.log', `${LD}${dup('_rb_alloc', 'libbdkwallet-ios.a', 'libbitboxffi-ios.a')}`);
    expect(src.main(['link-check', 'iphoneos', path.join(tmp, 'bad.log')], app())).toBe(2);
  });

  it('refuses when the pair fails, and writes no list', () => {
    put(files('bitboxffi')[1], 'sym _rb_alloc\nreview\n', app());
    pinAll();
    expect(src.main(['gate', 'bdkwallet', fork(), work(), '/sysroot'], app())).toBe(2);
    expect(err).toContain('sim, bitboxffi bdkwallet: the gate refused');
    expect(fs.existsSync(path.join(work(), 'duplicate-symbols.txt'))).toBe(false);
  });

  it('refuses a peer that is not the pinned file, and a report that judged other files', () => {
    put(files('bitboxffi')[0], 'swapped\n', app());
    expect(src.main(['gate', 'bdkwallet', fork(), work(), '/sysroot'], app())).toBe(2);
    expect(err).toContain(`${files('bitboxffi')[0]} is ${sha('swapped\n')}, pinned`);
    pinAll();
    // A gate that reports on something else proves nothing about these files.
    put('bdk-ffi/scripts/symbol-overlap-gate.py', GATE.replace('print("new: " + new', 'print("new: /elsewhere.a'), fork());
    err = '';
    expect(src.main(['gate', 'bdkwallet', fork(), work(), '/sysroot'], app())).toBe(2);
    expect(err).toContain('as the new library');
    expect(src.main(['gate', 'bdkffi', fork(), work(), '/sysroot'], app())).toBe(64);
    expect(src.main(['gate', 'bdkwallet', fork(), work()], app())).toBe(64);
  });
});

describe('uniffi\'s bindgen tool inside the new library (decided 2026-10-17)', () => {
  const rust = (crate: string) => `${crate}-0123456789abcdef.${crate}.89abcdef01234567-cgu.0.rcgu.o`;
  const WALLET = 'native/bdkwallet/lib/libbdkwallet-ios.a';

  it('reads the member names from the ar headers alone, thin and fat', () => {
    const thin = ar([[rust('bdk_wallet'), OURS_IOS], [rust('clap_builder'), OURS_IOS]]);
    const sim = fat([
      [ARM64, ar([[rust('bdk_wallet'), OURS_SIM], [rust('goblin'), OURS_SIM]])],
      [X86_64, ar([[rust('bdk_wallet'), OURS_X86], ['uniffi_bindgen-0123456789abcdef.x.o', OURS_X86]])],
    ]);
    put('thin.a', thin);
    put('fat.a', sim);
    expect(prov.arMemberNames(path.join(tmp, 'thin.a'))).toEqual(['__.SYMDEF SORTED', rust('bdk_wallet'), rust('clap_builder')]);
    expect(prov.arMemberNames(path.join(tmp, 'fat.a'))).toHaveLength(6);
    const listed = prov.NATIVE_SOURCES.bdkwallet.toolCrates as string[];
    expect(prov.toolCratesIn(path.join(tmp, 'thin.a'), listed)).toEqual(['clap_builder']);
    expect(prov.toolCratesIn(path.join(tmp, 'fat.a'), listed)).toEqual(['goblin', 'uniffi_bindgen']);
    put('not.a', 'text');
    expect(() => prov.arMemberNames(path.join(tmp, 'not.a'))).toThrow('not an ar archive');
  });

  it('judges the new library alone, the pinned device file, and lists what it holds', () => {
    expect(prov.NATIVE_SOURCES.bdkwallet.toolCrates).toEqual(
      expect.arrayContaining(['uniffi_bindgen', 'clap', 'goblin', 'askama', 'cargo_metadata']),
    );
    // The BitBox library carries the same crates today and is not judged.
    expect(prov.NATIVE_SOURCES.bitboxffi.toolCrates).toBeNull();
    put(WALLET, ar([[rust('bdk_wallet'), OURS_IOS], [rust('askama'), OURS_IOS], [rust('clap'), OURS_IOS]]));
    expect(prov.toolCrateFindings(tmp, [{ path: WALLET }])).toEqual([{ lib: 'bdkwallet', path: WALLET, crates: ['askama', 'clap'] }]);
    // Not pinned: not judged here (refused as unpinned anyway).
    expect(prov.toolCrateFindings(tmp, [])).toEqual([]);
    put(WALLET, ar([[rust('bdk_wallet'), OURS_IOS], [rust('serde_json'), OURS_IOS]]));
    expect(prov.toolCrateFindings(tmp, [{ path: WALLET }])).toEqual([]);
  });

  it('the archive refuses it with no override', () => {
    const state = {
      isGit: true,
      dirty: false,
      native: { bdkForkLinked: true, sourceProblems: [], problems: [], strays: [], toolCrates: [`${WALLET} holds clap`] },
    };
    expect(prov.gateDecision(state, { TALIA_ARCHIVE_ALLOW_DIRTY: 'please' })).toEqual({
      allowed: false,
      override: null,
      toolCrates: [`${WALLET} holds clap`],
    });
    expect(prov.gateDecision({ ...state, native: { ...state.native, toolCrates: [] } }, {})).toEqual({ allowed: true, override: null });
  });
});

describe('the Xcode a library was built with', () => {
  it('reads xcodebuild -version', () => {
    expect(src.parseXcodeVersion('Xcode 27.1\nBuild version 27A9275\n')).toEqual({ version: '27.1', build: '27A9275' });
    expect(src.parseXcodeVersion('xcode-select: error: tool requires Xcode')).toBeNull();
  });

  it('warns when this Mac\'s Xcode is not the one a record names, and only then', () => {
    const sources = [
      { lib: 'bdkwallet', xcode: { version: '27.1', build: '27A9275' } },
      { lib: 'bitboxffi' }, // a record from before 2026-10-16 names none
    ];
    expect(src.xcodeWarnings(sources, { version: '27.1', build: '27A9275' })).toEqual([]);
    const lines = src.xcodeWarnings(sources, { version: '27.2', build: '27B5000' }).join('\n');
    expect(lines).toContain('bdkwallet was built with Xcode 27.1 (27A9275); this Mac has 27.2 (27B5000).');
    expect(lines).not.toContain('bitboxffi');
    expect(src.xcodeWarnings(sources, null).join('\n')).toContain('no Xcode answered here');
  });
});

describe('the C types the bindings import (a trial link, 2026-10-16)', () => {
  const psrc = require('../native-sources.js') as {
    ffiStructNames: (header: string) => string[];
    prefixFfiTypes: (header: string, swift: string, prefix: string) => { header: string; swift: string; renamed: string[] };
  };
  const pprov = require('../archive-provenance.js') as { ffiStructProblems: (root: string) => string[] };
  const HEADER =
    '#ifndef UNIFFI_SHARED_H\n#define UNIFFI_SHARED_H\n#define UNIFFI_SHARED_HEADER_V4\n' +
    'typedef struct RustBuffer\n{\n    uint64_t capacity;\n    uint64_t len;\n    uint8_t *_Nullable data;\n} RustBuffer;\n' +
    'typedef struct RustCallStatus {\n    int8_t code;\n    RustBuffer errorBuf;\n} RustCallStatus;\n#endif\n' +
    'typedef struct UniffiForeignFutureResultRustBuffer {\n    RustBuffer returnValue;\n} UniffiForeignFutureResultRustBuffer;\n' +
    'typedef void (*UniffiForeignFutureCompleteRustBuffer)(uint64_t, UniffiForeignFutureResultRustBuffer);\n' +
    'RustBuffer ffi_bdkffi_rustbuffer_alloc(uint64_t size, RustCallStatus *_Nonnull out_status);\n';
  const SWIFT =
    'fileprivate extension RustBuffer {\n  static func empty() -> RustBuffer { RustBuffer(capacity: 0, len: 0, data: nil) }\n}\n' +
    'fileprivate protocol FfiConverterRustBuffer {}\n' +
    'func f(_ s: UnsafeMutablePointer<RustCallStatus>, _ r: UniffiForeignFutureResultRustBuffer) { ffi_bdkffi_rustbuffer_alloc(0, s) }\n';

  it('gives every C struct the prefix, in the header and the Swift, and nothing else', () => {
    const r = psrc.prefixFfiTypes(HEADER, SWIFT, 'BdkWallet');
    expect(r.renamed.sort()).toEqual(['RustBuffer', 'RustCallStatus', 'UniffiForeignFutureResultRustBuffer']);
    expect(psrc.ffiStructNames(r.header).sort()).toEqual([
      'BdkWalletRustBuffer',
      'BdkWalletRustCallStatus',
      'BdkWalletUniffiForeignFutureResultRustBuffer',
    ]);
    expect(r.header).toContain('BdkWalletRustBuffer errorBuf;');
    expect(r.header).toContain('#ifndef BDKWALLET_UNIFFI_SHARED_H');
    expect(r.header).toContain('#define BDKWALLET_UNIFFI_SHARED_HEADER_V4');
    // Function names and callback typedefs keep their names: they are symbols, not imported types.
    expect(r.header).toContain('BdkWalletRustBuffer ffi_bdkffi_rustbuffer_alloc(uint64_t size, BdkWalletRustCallStatus *_Nonnull out_status)');
    expect(r.header).toContain('(*UniffiForeignFutureCompleteRustBuffer)(uint64_t, BdkWalletUniffiForeignFutureResultRustBuffer)');
    expect(r.swift).toContain('fileprivate extension BdkWalletRustBuffer {');
    expect(r.swift).toContain('BdkWalletRustBuffer(capacity: 0, len: 0, data: nil)');
    expect(r.swift).toContain('fileprivate protocol FfiConverterRustBuffer {}');
    expect(r.swift).toContain('UnsafeMutablePointer<BdkWalletRustCallStatus>, _ r: BdkWalletUniffiForeignFutureResultRustBuffer');
  });

  it('refuses to rename twice, a header with no struct, and a prefix that is not a type name', () => {
    const once = psrc.prefixFfiTypes(HEADER, SWIFT, 'BdkWallet');
    expect(() => psrc.prefixFfiTypes(once.header, once.swift, 'BdkWallet')).toThrow('renamed twice');
    expect(() => psrc.prefixFfiTypes('int x;', SWIFT, 'BdkWallet')).toThrow('no C struct');
    expect(() => psrc.prefixFfiTypes(HEADER, SWIFT, 'bdk wallet')).toThrow('not a type-name prefix');
  });

  it('refuses a C struct two libraries declare differently, and lets the same one through', () => {
    const root = path.join(tmp, 'app');
    const decl = (fields: string) => `typedef struct RustBuffer\n{\n${fields}\n} RustBuffer;\n`;
    const old = decl('    int32_t capacity;\n    int32_t len;\n    uint8_t *_Nullable data;');
    put('native/bitboxffi/ffi/bitboxFFI.h', old, root);
    put('native/bdkwallet/ffi/BitcoinDevKitFFI.h', `// the same, laid out otherwise\n${old.replace(/\n {4}/g, '\n  ')}`, root);
    expect(pprov.ffiStructProblems(root)).toEqual([]);
    // The old engine's header (removed with it) is no library's any more: never read.
    put('native/bdkffi/ffi/bdkFFI.h', decl('    uint8_t capacity;'), root);
    expect(pprov.ffiStructProblems(root)).toEqual([]);
    put('native/bdkwallet/ffi/BitcoinDevKitFFI.h', decl('    uint64_t capacity;\n    uint64_t len;\n    uint8_t *_Nullable data;'), root);
    expect(pprov.ffiStructProblems(root).join('\n')).toContain(
      'the C struct RustBuffer is declared differently in native/bitboxffi/ffi/bitboxFFI.h and native/bdkwallet/ffi/BitcoinDevKitFFI.h',
    );
    const renamed = psrc.prefixFfiTypes(decl('    uint64_t capacity;\n    uint64_t len;\n    uint8_t *_Nullable data;'), '', 'BdkWallet');
    put('native/bdkwallet/ffi/BitcoinDevKitFFI.h', renamed.header, root);
    expect(pprov.ffiStructProblems(root)).toEqual([]);
  });

  it('the committed bindings of the new library declare no C struct another library declares', () => {
    const root = path.join(__dirname, '..', '..');
    expect(pprov.ffiStructProblems(root)).toEqual([]);
    const header = fs.readFileSync(path.join(root, 'native/bdkwallet/ffi/BitcoinDevKitFFI.h'), 'utf8');
    const names = psrc.ffiStructNames(header);
    expect(names.length).toBeGreaterThan(2);
    for (const n of names) {
      expect(n).toMatch(/^BdkWallet/);
    }
    const swift = fs.readFileSync(path.join(root, 'native/bdkwallet/BitcoinDevKit.swift'), 'utf8');
    expect(swift).not.toMatch(/(?<![A-Za-z0-9_])(RustBuffer|ForeignBytes|RustCallStatus)(?![A-Za-z0-9_])/);
  });
});
