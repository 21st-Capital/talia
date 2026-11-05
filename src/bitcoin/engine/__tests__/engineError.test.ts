/**
 * BDK upgrade (decided 2026-10-15): every decision the app took on BDK's
 * error TEXT asks `classifyEngineError` for a code. For the engine that
 * shipped then (bdk 0.28 behind bdk-ffi 0.30) the codes had to be read off
 * the text by exactly the rules the call sites used, so the change was a
 * no-op; the engine of today (bdk-ffi 3.1.1) rejects with a code and a
 * message in those same 0.28 words, so the rules still
 * hold for anything that reaches them as text.
 *
 * The messages are the real ones: what the shipped fork said in its test
 * harness (`__fixtures__/bdkPolicies.json`), the refusals the old bridge's
 * recording held (`OLD_BRIDGE_ERRORS`: the recording itself went with the
 * old engine, decided 2026-11-04), and the forms the old Swift
 * bridge handed to JavaScript: bdk-rn rejected with "\(error)", which for
 * bdk-ffi 0.30's flat `BdkError` enum read `InsufficientFunds(message: "…")`,
 * around bdk 0.28.2's own Display text.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  coinNotAvailable,
  COIN_NOT_AVAILABLE,
  EngineError,
  classifyEngineError,
  coinsHeldByPendingTx,
  engineErrorFacts,
  engineErrorMessage,
  isCodedEngineError,
  ENGINE_ERROR_CODES,
  serverUnreachable,
} from '../engineError';
import { bridged } from '../bdkWalletNative';
import { isInsufficientFunds } from '../../../wallet/replacement';

const fixture = (rel: string) => JSON.parse(fs.readFileSync(path.join(__dirname, rel), 'utf8'));

const policies = fixture('../__fixtures__/bdkPolicies.json') as Record<string, unknown>;
const shapes = Object.entries(policies).filter(([k]) => k !== '_about') as Array<
  [string, { bdkEverydayBuild: { firstTry: string }; bdkRescueBuild?: Record<string, { error?: string }> }]
>;
/** The refusals the old bridge's recording (bdkBridgeCalls.json, removed with the old engine) held, word for word. */
const OLD_BRIDGE_ERRORS = [
  'The fee rate must be above 0 and at most 2000 sat/vB.',
  'This is a test network address. This vault is on the main Bitcoin network.',
  'Insufficient funds: 10 sat available of 20 sat needed',
  'This is a different transaction from the one that was requested. Nothing was sent.',
  'This vault has no spending path for that key.',
];

/** What the fork's test harness recorded BDK refusing with. */
const firstTries = shapes.map(([, s]) => s.bdkEverydayBuild.firstTry).filter((m) => m !== 'ok');
const pathErrors = shapes.flatMap(([, s]) =>
  Object.values(s.bdkRescueBuild ?? {}).flatMap((r) => (r.error ? [r.error] : [])),
);
const bridgeErrors = OLD_BRIDGE_ERRORS;

/** bdk 0.28.2's Display text (vendor/bdk/src/error.rs) inside the Swift enum's description. */
const swift = (variant: string, text: string) => `${variant}(message: "${text}")`;
const SWIFT_FORMS: Array<[string, ReturnType<typeof classifyEngineError>]> = [
  [swift('InsufficientFunds', 'Insufficient funds: 0 sat available of 330 sat needed'), 'INSUFFICIENT_FUNDS'],
  [swift('InsufficientFunds', 'Insufficient funds: 150000 sat available of 181752 sat needed'), 'INSUFFICIENT_FUNDS'],
  [swift('SpendingPolicyRequired', 'Spending policy required: External'), 'SPENDING_POLICY_REQUIRED'],
  [swift('InvalidPolicyPathError', 'Invalid policy path: Not enought items selected: xkhqahzm'), 'POLICY_PATH_INVALID'],
  [swift('OutputBelowDustLimit', 'Output below the dust limit: 0'), 'OUTPUT_BELOW_DUST'],
  [swift('UnknownUtxo', 'UTXO not found in the internal database'), 'UNKNOWN_UTXO'],
  [swift('Generic', 'Missing UTXO'), 'OTHER'],
  ['rustPanic("attempt to add with overflow")', 'RUST_PANIC'],
];

describe('the real 0.28 messages get their codes', () => {
  it('the fixtures hold the messages this test leans on', () => {
    expect(firstTries.length).toBeGreaterThan(0);
    expect(pathErrors).toEqual(['Not enought items selected: xkhqahzm']);
    expect(bridgeErrors).toContain('Insufficient funds: 10 sat available of 20 sat needed');
  });

  it('"Spending policy required" is the retry, on every shape BDK refused to choose for', () => {
    for (const m of firstTries) expect([m, classifyEngineError(new Error(m))]).toEqual([m, 'SPENDING_POLICY_REQUIRED']);
    // The bridge recording's own refusal, both keychains named.
    expect(classifyEngineError(new Error('Spending policy required: External, Internal'))).toBe('SPENDING_POLICY_REQUIRED');
  });

  it('a path that chose too few children', () => {
    for (const m of pathErrors) expect(classifyEngineError(new Error(m))).toBe('POLICY_PATH_INVALID');
    // bdk_wallet 3.x fixed the spelling; both are the same code.
    expect(classifyEngineError(new Error('Not enough items selected: xkhqahzm'))).toBe('POLICY_PATH_INVALID');
  });

  it('insufficient funds, with the sats it names', () => {
    expect(engineErrorFacts(new Error('Insufficient funds: 10 sat available of 20 sat needed'))).toEqual({
      code: 'INSUFFICIENT_FUNDS',
      message: 'Insufficient funds: 10 sat available of 20 sat needed',
      availableSats: 10,
      neededSats: 20,
    });
  });

  it("the app's own refusals in the recording are not BDK's codes", () => {
    const own = bridgeErrors.filter((m) => !/Insufficient funds/.test(m));
    expect(own.length).toBe(4);
    for (const m of own) expect([m, classifyEngineError(new Error(m))]).toEqual([m, 'OTHER']);
  });

  it.each(SWIFT_FORMS)('as the Swift bridge words it: %s', (message, code) => {
    expect(classifyEngineError(new Error(message))).toBe(code);
  });

  it('reads a bare string or a non-error the way the call sites did', () => {
    expect(engineErrorMessage('Insufficient funds: 1 sat available of 2 sat needed')).toBe(
      'Insufficient funds: 1 sat available of 2 sat needed',
    );
    expect(classifyEngineError('Spending policy required: Internal')).toBe('SPENDING_POLICY_REQUIRED');
    expect(classifyEngineError(undefined)).toBe('OTHER');
    expect(classifyEngineError(null)).toBe('OTHER');
  });
});

/**
 * The no-op proof for the call sites: the matchers as they stood before the
 * codes (copied from bdkEngine.ts:326, replacement.ts:861-864 and :880,
 * SendScreen.tsx:530-536 and :645-646 as of 2026-10-15), over every message
 * above and a few awkward ones, answer exactly what the codes now answer.
 */
describe('every old text matcher answers what its code now answers', () => {
  const legacy = {
    retry: (m: string) => m.includes('Spending policy required'),
    insufficient: (m: string) => /insufficient/i.test(m) || /dust/i.test(m),
    available: (m: string) => {
      const a = /(\d+)\s*sat available/i.exec(m);
      return a ? Number(a[1]) : null;
    },
    refreshList: (m: string) =>
      m.includes('0 sat available') ? 'pending' : m.toLowerCase().includes('insufficient') ? 'small' : 'raw',
    heldShort: (m: string) => /insufficient/i.test(m),
  };
  const now = {
    retry: (e: Error) => classifyEngineError(e) === 'SPENDING_POLICY_REQUIRED',
    insufficient: (e: Error) => isInsufficientFunds(e),
    available: (e: Error) => engineErrorFacts(e).availableSats,
    refreshList: (e: Error) =>
      coinsHeldByPendingTx(e) ? 'pending' : classifyEngineError(e) === 'INSUFFICIENT_FUNDS' ? 'small' : 'raw',
    heldShort: (e: Error) => classifyEngineError(e) === 'INSUFFICIENT_FUNDS',
  };
  const corpus = [
    ...firstTries,
    ...pathErrors,
    ...bridgeErrors,
    ...SWIFT_FORMS.map(([m]) => m),
    'Spending policy required: External, Internal',
    'Not enough items selected: abc',
    'Insufficient funds: 0 sat available of 121752 sat needed',
    'Insufficient funds: 150 sat available of 294 sat needed',
    'INSUFFICIENT FUNDS',
    'Output below the dust limit: 0',
    'Recipient 1: amount below dust limit (546 sats).',
    'Electrum client error: timed out',
    'Missing UTXO',
    '',
  ];

  it.each(corpus.map((m) => [m]))('%j', (m) => {
    const e = new Error(m);
    for (const k of Object.keys(legacy) as Array<keyof typeof legacy>) {
      expect([k, now[k](e)]).toEqual([k, legacy[k](m)]);
    }
  });
});

describe('a coded engine (the new bridge) is read by its code, never its words', () => {
  it('takes the code and the sats it carries', () => {
    const e = new EngineError('INSUFFICIENT_FUNDS', 'Insufficient funds: 0 sat available of 330 sat needed', {
      availableSats: 0,
      neededSats: 330,
    });
    expect(engineErrorFacts(e)).toMatchObject({ code: 'INSUFFICIENT_FUNDS', availableSats: 0, neededSats: 330 });
    // The words would say the same; a code that disagrees with them wins.
    expect(classifyEngineError(new EngineError('UNKNOWN_UTXO', 'Insufficient funds: whatever'))).toBe('UNKNOWN_UTXO');
    expect(classifyEngineError(Object.assign(new Error('boom'), { code: 'RUST_PANIC' }))).toBe('RUST_PANIC');
  });

  it("a React Native rejection's code is not ours, so its text decides", () => {
    const rn = Object.assign(new Error('SpendingPolicyRequired(message: "Spending policy required: External")'), {
      code: 'Finish tx error',
    });
    expect(classifyEngineError(rn)).toBe('SPENDING_POLICY_REQUIRED');
    expect(isCodedEngineError(rn)).toBe(false);
  });

  it('tells a coded error from 0.28 words that read the same', () => {
    expect(isCodedEngineError(new EngineError('UNKNOWN_UTXO', 'UTXO not found in the internal database'))).toBe(true);
    // The new bridge's rejection: a plain error carrying one of our codes.
    expect(isCodedEngineError(Object.assign(new Error('x'), { code: 'UNKNOWN_UTXO' }))).toBe(true);
    // 0.28's own text classifies as UNKNOWN_UTXO but is not coded.
    const old = new Error('UTXO not found in the internal database');
    expect(classifyEngineError(old)).toBe('UNKNOWN_UTXO');
    expect(isCodedEngineError(old)).toBe(false);
    expect(isCodedEngineError('UnknownUtxo')).toBe(false);
    expect(isCodedEngineError(null)).toBe(false);
  });

  it("Send's pending-coin rule: a coin the engine does not hold, or none of it counted", () => {
    expect(coinsHeldByPendingTx(new EngineError('UNKNOWN_UTXO', 'UTXO not found'))).toBe(true);
    expect(coinsHeldByPendingTx(new EngineError('INSUFFICIENT_FUNDS', 'x', { availableSats: 0 }))).toBe(true);
    expect(coinsHeldByPendingTx(new EngineError('INSUFFICIENT_FUNDS', 'x', { availableSats: 10 }))).toBe(false);
  });

  it('a coin the coded engine no longer holds gets plain words; the engine that ships today keeps its text', () => {
    expect(coinNotAvailable(new EngineError('UNKNOWN_UTXO', 'UTXO not found in the internal database'))).toBe(true);
    expect(coinNotAvailable(new EngineError('INSUFFICIENT_FUNDS', 'x', { availableSats: 0 }))).toBe(false);
    expect(coinNotAvailable(new Error('UTXO not found in the internal database'))).toBe(false);
    expect(COIN_NOT_AVAILABLE).not.toMatch(/UTXO|input|output|\u2014/i);
  });

  it("0.28's text keeps Send's old substring, quirk included (a separate fix)", () => {
    expect(coinsHeldByPendingTx(new Error('Insufficient funds: 0 sat available of 330 sat needed'))).toBe(true);
    // "10 sat available" contains "0 sat available": kept as it was.
    expect(coinsHeldByPendingTx(new Error('Insufficient funds: 10 sat available of 20 sat needed'))).toBe(true);
    expect(coinsHeldByPendingTx(new Error('Insufficient funds: 11 sat available of 20 sat needed'))).toBe(false);
  });

  it('a connection the bridge could not open is a code of its own, its words kept (decided 2026-10-30)', async () => {
    const rejection = Object.assign(new Error('Electrum client error: unexpected end of file'), { code: 'SERVER_UNREACHABLE' });
    expect(ENGINE_ERROR_CODES).toContain('SERVER_UNREACHABLE');
    expect(classifyEngineError(rejection)).toBe('SERVER_UNREACHABLE');
    expect(isCodedEngineError(rejection)).toBe(true);
    const thrown = await bridged(Promise.reject(rejection)).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(EngineError);
    expect(thrown).toMatchObject({ code: 'SERVER_UNREACHABLE', message: 'Electrum client error: unexpected end of file' });
    expect(serverUnreachable(thrown)).toBe(true);
  });
});
