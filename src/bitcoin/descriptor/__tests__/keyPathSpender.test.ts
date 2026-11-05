/**
 * Decided 2026-09-26: an imported taproot descriptor
 * whose internal key has NO origin used to be taken for Liana's NUMS key and
 * left out of every summary of who can spend. An attacker's xpub written
 * there without an origin could then spend every coin alone through the key
 * path while the Spending policy showed only the tree.
 */
import { parsePolicy, primaryPath } from '../policy';
import { validateForImport, taprootKeyPathSpendable } from '../validate';
import { isProvablyUnspendableKey, unspendableInternalKey } from '../unspendable';
import { NUMS_TPUB } from '../__fixtures__/descriptors';

// Checksum-valid tpubs (the Liana golden vector's keys): the attacker's key
// must be a REAL key for the test to mean anything.
const TPUB_A =
  'tpubDDvFWduSiwhW7hUbL1oMyUfcNgeSyZgHbooe1WjHyRaXYH3uUjm1xdxWXAGbQFn8QGScDg4b4a6WMGNiEAq2uQdmPDhDKPE5Dr8DX24mwd5';
const TPUB_B =
  'tpubDEHRt73d4guqR5BLGQud4XMW8vDCGHUj54qDTFtsdFstF6PAYx1oAy3jfKg1PffqLUWuSsXmnetKeTJFKfKLXeJR97yUuqvvojnoBcUDHg5';
const TPUB_C =
  'tpubDEzdWp7365AFAExeUsHiwRmkZN5it3sSAZsd6GKUXvUiJBytXnZrRKMAt9UgCkWB2mP3K9WujLuTjrRLBn51Y18pMVyg2v18un4ivqWSAk2';

const tree =
  `{multi_a(2,[73c5da0a/48'/1'/0'/2']${TPUB_B}/<0;1>/*,[a1b2c3d4/48'/1'/0'/2']${TPUB_C}/<0;1>/*),` +
  `and_v(v:pk([deadbeef/48'/1'/0'/2']${TPUB_A}/<0;1>/*),older(65535))}`;
const ATTACK = `tr(${TPUB_A}/<0;1>/*,${tree})`;
const HONEST = `tr(${NUMS_TPUB}/<0;1>/*,${tree})`;

describe('isProvablyUnspendableKey', () => {
  it('accepts NUMS in a tpub (Liana and Talia), with its derivation', () => {
    expect(isProvablyUnspendableKey(NUMS_TPUB)).toBe(true);
    expect(isProvablyUnspendableKey(`${NUMS_TPUB}/<0;1>/*`)).toBe(true);
  });

  it("accepts the key Talia's own composer writes", () => {
    const k = unspendableInternalKey([{ xpub: TPUB_B }, { xpub: TPUB_C }]);
    expect(isProvablyUnspendableKey(`${k}/<0;1>/*`)).toBe(true);
  });

  it('accepts the raw x-only and compressed H', () => {
    const H = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
    expect(isProvablyUnspendableKey(H)).toBe(true);
    expect(isProvablyUnspendableKey(`02${H}`)).toBe(true);
  });

  it('refuses any other key, origin or not', () => {
    expect(isProvablyUnspendableKey(`${TPUB_A}/<0;1>/*`)).toBe(false);
    expect(isProvablyUnspendableKey(`[73c5da0a/86'/1'/0']${TPUB_A}/<0;1>/*`)).toBe(false);
    expect(isProvablyUnspendableKey('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798')).toBe(false);
    expect(isProvablyUnspendableKey('garbage')).toBe(false);
  });
});

describe('parsePolicy shows a spendable internal key', () => {
  it('an origin-less NON-NUMS internal key is a one-key path with no wait', () => {
    const p = parsePolicy(ATTACK);
    expect(p.exact).toBe(true);
    expect(p.paths).toHaveLength(3);
    const keyPath = primaryPath(p)!;
    expect(keyPath.olderBlocks).toBeUndefined();
    expect(keyPath.groups).toEqual([{ threshold: 1, keys: [expect.objectContaining({ xpub: TPUB_A })] }]);
  });

  it('the real NUMS key is still left out', () => {
    const p = parsePolicy(HONEST);
    expect(p.paths).toHaveLength(2);
    expect(p.paths.some((path) => path.groups.some((g) => g.keys.some((k) => k.xpub === NUMS_TPUB)))).toBe(false);
  });
});

describe('the import says so', () => {
  it('flags the attack shape and not the honest one, with the same predicate', () => {
    expect(taprootKeyPathSpendable(ATTACK)).toBe(true);
    expect(taprootKeyPathSpendable(HONEST)).toBe(false);
    const bad = validateForImport(ATTACK, { network: 'testnet' });
    const good = validateForImport(HONEST, { network: 'testnet' });
    expect(bad.ok && bad.keyPathSpender).toBe(true);
    expect(good.ok && good.keyPathSpender).toBe(false);
  });

  it('a one-key taproot wallet with no tree is not flagged', () => {
    expect(taprootKeyPathSpendable(`tr([9a8b7c6d/86'/1'/0']${TPUB_A}/<0;1>/*)`)).toBe(false);
  });
});

describe('the one-key question cannot be skipped', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '../../../ui/screens', f), 'utf8');

  it('Import: dismissing the question is a no, and "Add this vault" asks again', () => {
    const src = read('ImportScreen.tsx');
    // The backdrop only runs onClose: it must drop the pending import.
    expect(src).toMatch(/setKeyPathAsk\(false\);[\s\S]{0,400}if \(keyPathPendingRef\.current\) \{\s*keyPathPendingRef\.current = null;\s*setValidated\(null\);/);
    expect(src).toMatch(/validated\.keyPathSpender && keyPathAcceptedRef\.current !== validated/);
  });

  it('Claim invite: an heir installing such a vault is asked the same question', () => {
    const src = read('ClaimInviteScreen.tsx');
    expect(src).toMatch(/validated\.keyPathSpender && !\(await askKeyPathSpender\(\)\)/);
    expect(src).toContain("title: 'One key can spend this vault alone'");
    expect(read('ImportScreen.tsx')).toContain('title="One key can spend this vault alone"');
    // A dismissal settles the question as a no.
    expect(src).toMatch(/setTimeout\(\(\) => keyPathAnswerRef\.current\?\.\(false\), 0\)/);
  });
});
