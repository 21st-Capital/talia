/**
 * A Passport can never end up in a layered vault.
 *
 * Decided 2026-09-24: "the app should not let the user create a layered vault
 * that involves the foundation passport. you need to study every path to
 * make sure he cant accidently create one", and the reason: "The foundation
 * passport doesnt support taproot ministcript! it only supports standard
 * single and standard multisigs."
 *
 * Talia composes taproot miniscript for every layered vault AND for every
 * vault holding a 21st Capital key, so the line is the SCRIPT, not the
 * number of keys. The paths a Passport could reach a vault by:
 *
 *   1. the vault builders .............. no Passport row at all (`build`)
 *   2. the builder's own binding ....... removed outright
 *   3. "Connect to hardware" on an
 *      imported vault .................. passportBinding refuses
 *   4. Replace signing device .......... the screen refuses
 *   5. the import's own binding ........ guarded by the descriptor
 *
 * 1, 3 and 5 are covered here; 2 and 4 are pinned by reading the source, so
 * a future edit cannot quietly put them back.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { deviceSuitsVault, isStandardScript, modelsFor } from '../../wallet/deviceKinds';

const SRC = join(__dirname, '..');

/** The taproot vaults' internal key: the unspendable one Liana derives from their two keys (K twice). */
const NUMS =
  'tpubD6NzVbkrYhZ4Yewv29FkSvqy94Uw724yyCqZzZnMndNzijRMZdjZr5u4ewutcEbsZDq4Mc5PBDDXVL7zHKZfyC3vTTU67MQwgAVcpWUEzRY';
/** A made-up key, derived from BIP-32 test vector 1's seed at m/48'/1'/0'/2'. */
const K = 'tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg';

const PLAIN_SINGLE = `wpkh([73c5da0a/84'/0'/0']${K}/<0;1>/*)`;
const PLAIN_MULTI = `wsh(sortedmulti(2,[73c5da0a/48'/0'/0'/2']${K}/<0;1>/*,[3442193e/48'/0'/0'/2']${K}/<0;1>/*))`;
const LAYERED = `tr(${NUMS}/<0;1>/*,{pk([73c5da0a/48'/0'/0'/2']${K}/<0;1>/*),and_v(v:pk([cc000008/48'/0'/0'/2']${K}/<0;1>/*),older(52596))})`;
const TAPROOT_MULTI = `tr(${NUMS}/<0;1>/*,multi_a(2,[73c5da0a/48'/0'/0'/2']${K}/<0;1>/*,[cc000008/48'/0'/0'/2']${K}/<0;1>/*))`;

describe('which vaults a Passport may be used with', () => {
  it('says yes to the two standard shapes', () => {
    expect(isStandardScript(PLAIN_SINGLE)).toBe(true);
    expect(isStandardScript(PLAIN_MULTI)).toBe(true);
    expect(deviceSuitsVault('passport', PLAIN_SINGLE)).toBe(true);
    expect(deviceSuitsVault('passport', PLAIN_MULTI)).toBe(true);
  });

  it('says no to anything taproot, layered or not', () => {
    expect(isStandardScript(LAYERED)).toBe(false);
    expect(isStandardScript(TAPROOT_MULTI)).toBe(false);
    expect(deviceSuitsVault('passport', LAYERED)).toBe(false);
    expect(deviceSuitsVault('passport', TAPROOT_MULTI)).toBe(false);
  });

  it('claims nothing about a vault it cannot read', () => {
    // Never true on a guess: the owner would find out at Send.
    expect(deviceSuitsVault('passport', '')).toBe(false);
    expect(deviceSuitsVault('passport', undefined)).toBe(false);
    expect(deviceSuitsVault('passport', 'not a descriptor')).toBe(false);
  });

  it('never stands in the way of a device that speaks taproot', () => {
    for (const d of ['ledger', 'bitbox'] as const) {
      expect(deviceSuitsVault(d, LAYERED)).toBe(true);
      expect(deviceSuitsVault(d, '')).toBe(true);
    }
  });
});

describe('building a vault offers only what can sign every shape it may become', () => {
  it('offers no Passport while building, for either shape', () => {
    for (const shape of ['single', 'multi'] as const) {
      expect(modelsFor(shape, 'build', { hardwareSurface: true })).not.toContain('passport');
      expect(modelsFor(shape, 'build', { hardwareSurface: true }).length).toBeGreaterThan(0);
    }
  });

  it('still offers the Passport where the vault is NOT being built here and its script is standard', () => {
    // "Add an existing vault" is unchanged: an imported vault's shape is
    // settled, and a standard single-sig suits a Passport.
    expect(modelsFor('single', 'key', { hardwareSurface: true })).toContain('passport');
    expect(modelsFor('single', 'sign', { hardwareSurface: true, descriptor: PLAIN_SINGLE })).toContain('passport');
    expect(modelsFor('single', 'sign', { hardwareSurface: true, descriptor: LAYERED })).not.toContain('passport');
  });

  it('the key sheet withholds "Another device" while building', () => {
    const sheet = readFileSync(join(SRC, 'components/KeyEntrySheet.tsx'), 'utf8');
    expect(sheet).toMatch(/another=\{\s*building\s*\?\s*undefined\s*:/);
  });
});

describe('the two paths that are closed by construction', () => {
  const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

  it('the vault builder binds no Passport at all', () => {
    const source = read('screens/VaultBuilderScreen.tsx');
    expect(source).not.toMatch(/bleBoundRef\.current\[[^\]]*\]\s*=\s*\{\s*kind:\s*'passport'/);
  });

  it('replacing a device refuses a Passport on a vault it cannot sign', () => {
    expect(read('screens/ReplaceDeviceScreen.tsx')).toContain("deviceSuitsVault('passport'");
  });

  it('connecting one to an existing vault asks the same question', () => {
    expect(read('hww/passportBinding.ts')).toContain("deviceSuitsVault('passport'");
  });
});
