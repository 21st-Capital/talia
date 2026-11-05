/**
 * Decided 2026-09-26: the engine's spend guard passed on
 * LEDGER_PREVIEW, a hard-coded true, so it never fired in any build. It now
 * follows the build-time flags, and the watch-only build keeps only the
 * narrow rescue methods.
 */
import * as fs from 'fs';
import * as path from 'path';
import { assertSigningEnabled, spendSurfaceOpen } from '../engine/spendGate';

describe('spendGate', () => {
  it('the watch-only App Store config (no TALIA_* flag) refuses every spend', () => {
    // Jest runs with no TALIA_* flag set, exactly like an App Store archive.
    expect(spendSurfaceOpen()).toBe(false);
    expect(() => assertSigningEnabled('Sending')).toThrow('cannot spend');
  });

  it('the signing builds open it', () => {
    expect(spendSurfaceOpen({ SIGNING_ENABLED: false, HWW_ENABLED: true })).toBe(true);
    expect(spendSurfaceOpen({ SIGNING_ENABLED: true, HWW_ENABLED: false })).toBe(true);
    expect(() => assertSigningEnabled('Sending', { SIGNING_ENABLED: false, HWW_ENABLED: true })).not.toThrow();
  });
});

// The one engine since the old engine's removal (decided 2026-11-04); the
// old engine's file (bdkEngine.ts) was held to the same rules until then.
describe('the engine asks the gate on every spend method', () => {
  const src = fs.readFileSync(path.join(__dirname, '../engine/bdkWalletEngine.ts'), 'utf8');

  it('never consults LEDGER_PREVIEW', () => {
    expect(src).not.toMatch(/LEDGER_PREVIEW/);
  });

  it.each([
    ['buildPsbt', 'Sending'],
    ['completePsbt', 'Signing'],
    ['broadcastPsbt', 'Broadcasting a transaction'],
    ['broadcastRawTx', 'Broadcasting a transaction'],
  ])('%s', (method, what) => {
    const at = src.indexOf(`async ${method}(`);
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, at + 600);
    expect(body).toContain(`assertSigningEnabled('${what}')`);
  });

  it('has no fee bump: BDK’s BumpFeeTxBuilder takes no policy path (decided 2026-10-07)', () => {
    // Speed up and Cancel are buildPsbt of the same coins (wallet/replacement.ts).
    expect(src).not.toMatch(/BumpFeeTxBuilder|bumpFee/);
  });

  it('the rescue methods are the only ungated ones, and they check the transaction', () => {
    const at = src.indexOf('async broadcastRescue(');
    const body = src.slice(at, src.indexOf('private async sendRaw('));
    // Both routes (a PSBT 21st Capital signed, raw bytes) through the one
    // check in the engine's pure half (BDK upgrade, decided 2026-10-15).
    expect(body.match(/await assertRescueSpend\(this, /g)?.length).toBe(2);
    const shared = fs.readFileSync(path.join(__dirname, '../engine/engineShared.ts'), 'utf8');
    const check = shared.slice(shared.indexOf('export async function assertRescueSpend('));
    expect(check.slice(0, check.indexOf('\n}\n'))).toMatch(
      /await verifyRescueTransaction\(engine, shape, expect\)[\s\S]*if \(refusal\) throw new BroadcastRefusedError\(refusal, refusalMessage\(refusal\)\);/,
    );
    const build = src.slice(src.indexOf('async buildRescuePsbt('), src.indexOf('private async build('));
    expect(build).toContain('branchFingerprint');
    expect(build).toContain('rescueBuild(request)');
    expect(shared.slice(shared.indexOf('export function rescueBuild('))).toContain('drain: true');
  });
});
