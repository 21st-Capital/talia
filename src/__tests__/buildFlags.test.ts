/**
 * The build flags and the build flavour (src/config.ts), and the tier C
 * runner's flag, TALIA_HARNESS, kept out of every phone build and archive
 * (BDK upgrade, decided 2026-10-15).
 *
 * These tests lived in engineChoice.test.ts beside the engine constants.
 * The old engine's removal (decided 2026-11-04) took the constants and that suite; every
 * assertion that did not name an engine moved here unchanged. The flavour
 * still decides that the App Store app keeps no engine report and copies no
 * signing rounds, so its mapping stays pinned.
 */
import * as fs from 'fs';
import * as path from 'path';
import { BUILD_FLAVOUR, buildFlavourOf } from '../config';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CONFIG = read('src/config.ts');

describe('the build flavour', () => {
  it('the flags pick the flavour the way the builds are made: TALIA_FULL wins, then TALIA_HWW', () => {
    expect(buildFlavourOf({ full: true, hww: false })).toBe('full');
    expect(buildFlavourOf({ full: true, hww: true })).toBe('full');
    expect(buildFlavourOf({ full: false, hww: true })).toBe('signing');
    expect(buildFlavourOf({ full: false, hww: false })).toBe('store');
  });

  it('Jest builds with no flag, like the App Store archive: the store app', () => {
    expect(BUILD_FLAVOUR).toBe('store');
  });

  it("the archive makes its two flavours with the same flags: --signing sets TALIA_HWW alone, the plain archive none", () => {
    const archive = read('scripts/ios-archive.sh');
    expect(archive).toMatch(/if \[ "\$FLAVOUR" = "signing" \]; then\n\s+export TALIA_HWW=1/);
    expect(archive).toMatch(/unset TALIA_FULL TALIA_HWW TALIA_PURCHASES TALIA_SIDE TALIA_HARNESS/);
  });
});

describe('the build flags', () => {
  it('the plugin, Metro and provenance know the TALIA_* flags alone (and the harness); config.ts reads three', () => {
    expect(read('babel-plugin-talia-flags.js')).toMatch(/const ALLOWED = new Set\(\['TALIA_FULL', 'TALIA_HWW', 'TALIA_PURCHASES', 'TALIA_HARNESS'\]\);/);
    expect(read('metro.config.js')).toMatch(/const TALIA_FLAGS = \['TALIA_FULL', 'TALIA_HWW', 'TALIA_PURCHASES', 'TALIA_HARNESS'\]/);
    expect(read('scripts/archive-provenance.js')).toMatch(/const FLAG_NAMES = \['TALIA_FULL', 'TALIA_HWW', 'TALIA_PURCHASES', 'TALIA_HARNESS'\];/);
    expect(CONFIG.match(/process\.env\.(\w+)/g)?.sort()).toEqual([
      'process.env.TALIA_FULL',
      'process.env.TALIA_HWW',
      'process.env.TALIA_PURCHASES',
    ]);
  });
});

describe('TALIA_HARNESS: the tier C runner, in the simulator only', () => {
  it("is in all six places: the plugin, babel's cache key, Metro, the device stamp, FLAG_NAMES, the archive", () => {
    expect(read('babel-plugin-talia-flags.js')).toMatch(/'TALIA_HARNESS'\]\);/);
    expect(read('babel.config.js')).toMatch(/\$\{process\.env\.TALIA_HARNESS \?\? ''\}/);
    expect(read('metro.config.js')).toMatch(/'TALIA_HARNESS'\]/);
    expect(read('scripts/ios-device.sh')).toMatch(/FLAGS="\$\{TALIA_FULL:-\}\|\$\{TALIA_HWW:-\}\|\$\{TALIA_PURCHASES:-\}\|\$\{TALIA_HARNESS:-\}"/);
    expect(read('scripts/archive-provenance.js')).toMatch(/'TALIA_HARNESS'\];/);
    expect(read('scripts/ios-archive.sh')).toMatch(/unset TALIA_FULL TALIA_HWW TALIA_PURCHASES TALIA_SIDE TALIA_HARNESS/);
  });

  it('a phone build and an archive refuse it, and the archive proves the runner absent', () => {
    const device = read('scripts/ios-device.sh');
    expect(device).toMatch(/if \[ -n "\$\{TALIA_HARNESS:-\}" \]; then\n\s+echo "✗ TALIA_HARNESS[^\n]*"\n\s+exit 1/);
    const archive = read('scripts/ios-archive.sh');
    expect(archive).toMatch(/if \[ -n "\$\{TALIA_HARNESS:-\}" \]; then\n\s+echo "✗ TALIA_HARNESS is set[^\n]*"\n\s+exit 1\nfi\nunset TALIA_FULL/);
    expect(archive).toMatch(/if grep -q "talia-tier-c-runner" "\$XJS"; then\n\s+refuse/);
    // After the flag arms, before the record.
    expect(archive.indexOf('talia-tier-c-runner')).toBeGreaterThan(archive.indexOf('ARMS="$('));
    expect(archive.indexOf('talia-tier-c-runner')).toBeLessThan(archive.indexOf('--flags-read'));
    // The marker the archive looks for is the runner's own.
    expect(read('src/harness/tierC.ts')).toMatch(/export const TIER_C_MARKER = 'talia-tier-c-runner-[0-9a-f]+';/);
  });

  it('index.js reads the flag itself, so Metro folds the runner away without it', () => {
    expect(read('index.js')).toMatch(/process\.env\.TALIA_HARNESS === '1' \? require\('\.\/src\/harness\/TierCApp'\)\.TierCApp : App/);
    // config.ts reads no harness flag: nothing else in the app can reach the runner.
    expect(CONFIG).not.toMatch(/TALIA_HARNESS/);
  });
});
