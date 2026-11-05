/**
 * The smoke check of the wallet library (BDK upgrade, decided 2026-10-15,
 * from its trial link; one library since the old engine's removal, decided 2026-11-04): the app
 * links bdk-ffi 3.1.1 (TaliaBdkWallet), and it must answer.
 *
 * - The library's known-answer test (`knownAnswer`, the launch-time check of
 *   the BDK upgrade, which the engine provider runs before the
 *   first vault opens): fixed public test vectors, compared natively with
 *   addresses worked out independently.
 * - Address 0 of one public descriptor (BIP-84's published account key)
 *   through its DEBUG-only `peekAddress`: it must be BIP-84's own. Until
 *   2026-11-04 the old library (bdk-ffi 0.30) gave its address 0 beside it and
 *   the two had to agree; that half went with it.
 *
 * A DEBUG build runs it once at launch (App.tsx). A RELEASE build runs it
 * only when asked at launch (`smokeAskedAtLaunch`: the hardware-signing
 * flavours alone, never the App Store app, and only with the launch argument
 * `-TaliaBdkWalletSmoke YES`, which only Xcode, simctl or devicectl can pass),
 * so the bindings are proven in a Release build too (decided 2026-10-17: the
 * RustBuffer fix had only run at -Onone, and Release Swift specialises
 * generics differently). A Release build has no `peekAddress`, so its check
 * is the known-answer test alone, whose first vector IS BIP-84's address 0.
 * It only writes one line to the log. Public keys only: nothing here can
 * sign.
 */
import { NativeModules, Platform, Settings } from 'react-native';
import { HWW_ENABLED } from '../../config';

/** BIP-84's account key for "abandon ... about" (m/84'/0'/0'), receive chain. */
export const SMOKE_DESCRIPTOR =
  "wpkh([73c5da0a/84'/0'/0']xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V/0/*)";
/** Its first receive address, from BIP-84's test vectors. */
export const SMOKE_ADDRESS0 = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

/** What TaliaBdkWalletModule offers JavaScript for the check (native/bdkwallet/bridge). */
export interface BdkWalletNative {
  knownAnswer(): Promise<{ passed: boolean; vectors: number }>;
  /** DEBUG builds only. */
  peekAddress?(descriptor: string, network: string, keychain: string, index: number): Promise<string>;
}

export interface SmokeResult {
  /** 'debug' when the build has the DEBUG-only peekAddress, else 'release'. */
  build: 'debug' | 'release';
  knownAnswer: 'passed' | 'failed' | 'missing';
  vectors: number;
  /** Address 0 from `peekAddress` (DEBUG builds), else null. */
  address0: string | null;
  /** BIP-84's address 0 was given (a release build: the known answers, BIP-84's address 0 among them, passed). */
  agree: boolean;
  problems: string[];
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The check itself, over the library it is handed (tested with stand-ins). */
export async function bdkWalletSmoke(lib: BdkWalletNative | undefined): Promise<SmokeResult> {
  const r: SmokeResult = {
    build: lib && typeof lib.peekAddress !== 'function' ? 'release' : 'debug',
    knownAnswer: 'missing',
    vectors: 0,
    address0: null,
    agree: false,
    problems: [],
  };
  if (!lib) {
    r.problems.push('the wallet library (TaliaBdkWalletModule) is not in this build');
    return r;
  }
  try {
    const kat = await lib.knownAnswer();
    r.knownAnswer = kat.passed ? 'passed' : 'failed';
    r.vectors = kat.vectors;
  } catch (e) {
    r.knownAnswer = 'failed';
    r.problems.push(`known-answer test: ${message(e)}`);
  }
  // DEBUG builds only; a release build's check is the known-answer test.
  if (typeof lib.peekAddress === 'function') {
    try {
      r.address0 = await lib.peekAddress(SMOKE_DESCRIPTOR, 'bitcoin', 'external', 0);
    } catch (e) {
      r.problems.push(`address 0: ${message(e)}`);
    }
  }
  r.agree = r.build === 'release' ? r.knownAnswer === 'passed' : r.address0 === SMOKE_ADDRESS0;
  if (r.build === 'debug' && r.address0 !== null && !r.agree) {
    r.problems.push("the library does not give BIP-84's address 0");
  }
  return r;
}

/** One log line, fixed words and public test addresses only. */
export function smokeLine(r: SmokeResult): string {
  const ok = r.knownAnswer === 'passed' && r.agree && r.problems.length === 0;
  const head = `[bdkwallet smoke] ${ok ? 'PASS' : 'FAIL'}${r.build === 'release' ? ' (release build)' : ''}: `;
  const tail = r.problems.length > 0 ? `; ${r.problems.join('; ')}` : '';
  if (r.build === 'release') {
    return `${head}known-answer ${r.knownAnswer} (${r.vectors} vectors, BIP-84's address 0 among them)${tail}`;
  }
  return (
    `${head}known-answer ${r.knownAnswer} (${r.vectors} vectors); ` +
    `address 0 ${r.address0 ?? 'none'}, ${r.agree ? "BIP-84's" : "NOT BIP-84's"}${tail}`
  );
}

/** The launch argument that asks a Release build for the check (`-TaliaBdkWalletSmoke YES`). */
export const SMOKE_LAUNCH_ARG = 'TaliaBdkWalletSmoke';

/**
 * Does this launch run the check? Every DEBUG build does. A Release build only
 * in a hardware-signing flavour (`hww`: the phone app and TestFlight's, never
 * the App Store app) and only when launched with the argument: iOS puts a
 * launch argument into the app's user defaults, and only Xcode, simctl or
 * devicectl can pass one, never a link or another app.
 */
export function smokeAsked(opts: { dev: boolean; hww: boolean; launchValue: unknown }): boolean {
  if (opts.dev) {
    return true;
  }
  if (!opts.hww) {
    return false;
  }
  const v = opts.launchValue;
  return v === true || v === 1 || (typeof v === 'string' && /^(1|yes|true)$/i.test(v));
}

/** smokeAsked for this launch: __DEV__, the build's flags and the launch argument. */
export function smokeAskedAtLaunch(): boolean {
  let launchValue: unknown;
  try {
    launchValue = Platform.OS === 'ios' ? Settings.get(SMOKE_LAUNCH_ARG) : undefined;
  } catch {
    launchValue = undefined;
  }
  return smokeAsked({ dev: typeof __DEV__ !== 'undefined' && __DEV__, hww: HWW_ENABLED, launchValue });
}

/** The real library: this build's native module. */
export function runBdkWalletSmoke(): Promise<SmokeResult> {
  return bdkWalletSmoke((NativeModules as Record<string, unknown>).TaliaBdkWalletModule as BdkWalletNative | undefined);
}
