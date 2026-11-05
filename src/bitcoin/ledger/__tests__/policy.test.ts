import { descriptorToLedgerPolicy, isDefaultPolicy, ledgerPolicyBlocker, nonRangedBlocker } from '../policy';
import { TPUB_A, TPUB_B, TPUB_C } from '../../descriptor/__fixtures__/descriptors';

// Checksum-VALID synthetic tpubs (same values compose.test uses): the
// unspendable-key derivation base58check-decodes every composed key, so the
// classification-only placeholder fixtures cannot feed composeMultisig(tr).
const TPUB_VB =
  'tpubD6NzVbkrYhZ4YsrXq9nRjEWRm7aBoRj8m7jZoxtAn4GQ7HvFWKSMx9zRgAjuPpLqudEZXG7zKA1cVQUxr3nf2M88odg2MfeZPk1CuCvrWuK';
const TPUB_VC =
  'tpubD6NzVbkrYhZ4XRUcexv9JpRu7jLdgeJSSmQEymQhjkgHW85grqZnxzWruanEgBvE5gHU1JNgwW34W6oJEpnaY8NuQ7D6WKgGukX3iE3hJn3';
import { composeMultisig, composeSinglesig } from '../../descriptor/compose';
import { unspendableInternalKey } from '../../descriptor/unspendable';

const KEY_A = { fingerprint: '73c5da0a', originPath: "84'/0'/0'", xpub: TPUB_A };
const MKEY_A = { fingerprint: '73c5da0a', originPath: "48'/0'/0'/2'", xpub: TPUB_A };
const MKEY_B = { fingerprint: 'aabbccdd', originPath: "48'/0'/0'/2'", xpub: TPUB_B };
const MKEY_C = { fingerprint: '11223344', originPath: "48'/0'/0'/2'", xpub: TPUB_C };

describe('descriptorToLedgerPolicy', () => {
  it('single-sig wpkh → the standard template, key lifted with its origin', () => {
    const d = composeSinglesig(KEY_A);
    const p = descriptorToLedgerPolicy(d, 'My vault');
    expect(p.descriptorTemplate).toBe('wpkh(@0/**)');
    expect(p.keys).toEqual([`[73c5da0a/84'/0'/0']${TPUB_A}`]);
    expect(isDefaultPolicy(p)).toBe(true); // signable without registration
  });

  it('wsh(sortedmulti) → placeholders in descriptor order', () => {
    const d = composeMultisig(2, [MKEY_A, MKEY_B, MKEY_C], { script: 'wsh' });
    const p = descriptorToLedgerPolicy(d, 'Family 2of3');
    expect(p.descriptorTemplate).toMatch(/^wsh\(sortedmulti\(2,@0\/\*\*,@1\/\*\*,@2\/\*\*\)\)$/);
    expect(p.keys).toHaveLength(3);
    for (const k of p.keys) expect(k).toMatch(/^\[[0-9a-f]{8}\/48'/);
    expect(isDefaultPolicy(p)).toBe(false); // registration ceremony required
  });

  it('taproot multi_a: the NUMS internal key is lifted BARE (no origin), like Liana', () => {
    // TPUB_VB/VC: fixtures with REAL key material (the unspendable key
    // derivation decodes pubkeys; the placeholder tpubs cannot).
    const KB = { fingerprint: 'a1b2c3d4', originPath: "48'/0'/0'/2'", xpub: TPUB_VB };
    const KC = { fingerprint: 'deadbeef', originPath: "48'/0'/0'/2'", xpub: TPUB_VC };
    const d = composeMultisig(1, [KB, KC]); // tr default
    const p = descriptorToLedgerPolicy(d, 'Vault');
    expect(p.descriptorTemplate).toMatch(/^tr\(@0\/\*\*,multi_a\(1,@1\/\*\*,@2\/\*\*\)\)$/);
    const sorted = [KB, KC].sort((a, b) => (a.xpub < b.xpub ? -1 : 1));
    const nums = unspendableInternalKey(sorted);
    expect(p.keys[0]).toBe(nums); // bare xpub, no [origin]
    expect(p.keys.slice(1)).toEqual(sorted.map((k) => `[${k.fingerprint}/${k.originPath}]${k.xpub}`));
  });

  it('a repeated key keeps ONE placeholder (policies require dedup)', () => {
    const d = `wsh(sortedmulti(1,[73c5da0a/48'/0'/0'/2']${TPUB_A}/<0;1>/*,[73c5da0a/48'/0'/0'/2']${TPUB_A}/<0;1>/*))`;
    const p = descriptorToLedgerPolicy(d, 'x');
    expect(p.keys).toHaveLength(1);
    expect(p.descriptorTemplate).toContain('@0/**,@0/**');
  });

  it('a checksum is stripped; unusual multipath pairs stay explicit', () => {
    const d = `wpkh([73c5da0a/84'/0'/0']${TPUB_A}/<2;3>/*)#abcd1234`;
    const p = descriptorToLedgerPolicy(d, 'x');
    expect(p.descriptorTemplate).toBe('wpkh(@0/<2;3>/*)');
  });

  it('the device name is ascii-clamped to 16 chars', () => {
    const d = composeSinglesig(KEY_A);
    expect(descriptorToLedgerPolicy(d, 'Family Höldings Vault Extra Long').name.length).toBeLessThanOrEqual(16);
    expect(descriptorToLedgerPolicy(d, '···').name).toBe('Talia vault');
  });

  it('refuses non-descriptor input with a readable reason', () => {
    expect(ledgerPolicyBlocker('not a descriptor')).toMatch(/cannot be registered/);
    expect(() => descriptorToLedgerPolicy('addr(bc1q...)', 'x')).toThrow(/cannot be registered/);
  });
});

describe('single-branch descriptors (imported as separate receive/change)', () => {
  it('are refused with the real reason — BIP-388 has no /N/* form', () => {
    const TPUB = 'tpubDDDvczQ8xdMxbdVMAvcCxfsqjSbrumbGVDeJmqzR8ZgVKTZBQqQNzHZDU3nZaXe2rZmMgLRWtmvxb5x9ZAqjK4CCwGaWDkWc6Y3EqcCMu2d';
    const single = `wpkh([73c5da0a/84'/1'/0']${TPUB}/0/*)`;
    expect(ledgerPolicyBlocker(single)).toContain('two separate lists');
    expect(() => descriptorToLedgerPolicy(single, 'Vault')).toThrow('two separate lists');
    // The combined multipath form of the SAME vault stays fine.
    expect(ledgerPolicyBlocker(`wpkh([73c5da0a/84'/1'/0']${TPUB}/<0;1>/*)`)).toBeNull();
  });
});

/** The library corpus's own check (the fork's app_policy_check.mjs):
 *  every placeholder is `@i/**` or `@i/<a;b>/*` with nothing after it. */
function notBip388(template: string): string[] {
  return [...template.matchAll(/@\d+[^,)}]*/g)].map((m) => m[0]).filter((k) => !/^@\d+(\/\*\*|\/<\d+;\d+>\/\*)$/.test(k));
}

describe('non-ranged descriptors (one fixed address; decided 2026-10-17)', () => {
  const UNSUPPORTED = 'This vault type cannot be registered on a signing device.';
  const k = (fp: string, path: string, xpub: string, tail: string) => `[${fp}/${path}]${xpub}${tail}`;
  // The harness's two shapes (i-nonranged-wpkh, i-nonranged-wsh-multi), on
  // this file's test keys. Before: wpkh(@0/**/0/7) and
  // wsh(multi(2,@0/**/0/5,@1/**/0/5)), handed to the device.
  const NONRANGED_WPKH = `wpkh(${k('73c5da0a', "84'/1'/0'", TPUB_A, '/0/7')})`;
  const NONRANGED_WSH_MULTI = `wsh(multi(2,${k('73c5da0a', "48'/1'/0'/2'", TPUB_A, '/0/5')},${k('aabbccdd', "48'/1'/0'/2'", TPUB_B, '/0/5')}))`;

  it('are refused before any device is asked, with the plain sentence', () => {
    for (const d of [NONRANGED_WPKH, NONRANGED_WSH_MULTI, `${NONRANGED_WPKH}#abcd1234`]) {
      expect(ledgerPolicyBlocker(d)).toBe(UNSUPPORTED);
      expect(() => descriptorToLedgerPolicy(d, 'Vault')).toThrow(UNSUPPORTED);
    }
  });

  it('a bare key is never widened into @0/**, a template of another wallet', () => {
    expect(ledgerPolicyBlocker(`wpkh(${k('73c5da0a', "84'/1'/0'", TPUB_A, '')})`)).toBe(UNSUPPORTED);
    expect(ledgerPolicyBlocker(`wpkh(${TPUB_A})`)).toBe(UNSUPPORTED);
    // One fixed key beside a ranged one is still a fixed key.
    expect(
      ledgerPolicyBlocker(`wsh(sortedmulti(2,${k('73c5da0a', "48'/1'/0'/2'", TPUB_A, '/<0;1>/*')},${k('aabbccdd', "48'/1'/0'/2'", TPUB_B, '')}))`),
    ).toBe(UNSUPPORTED);
  });

  it('more path after a key, or a hardened wildcard, is no placeholder either', () => {
    for (const tail of ['/0/7/*', '/<0;1>/*/0', "/<0;1>/*'", '/<0;1>/*h', '/*h', '/*']) {
      expect({ tail, blocker: ledgerPolicyBlocker(`wpkh(${k('73c5da0a', "84'/1'/0'", TPUB_A, tail)})`) }).toEqual({ tail, blocker: UNSUPPORTED });
    }
  });

  it('a key ending in a single /* is never written as @i/**, the template of another wallet (decided 2026-10-17)', () => {
    // A pasted [fp/84'/1'/0']tpub…/* is stored as is (bareKey.ts): its
    // addresses are m/84'/1'/0'/i, while @0/** is m/84'/1'/0'/0/i, which
    // isDefaultPolicy then took for the device's standard account.
    const oneList = `wpkh(${k('73c5da0a', "84'/1'/0'", TPUB_A, '/*')})`;
    expect(ledgerPolicyBlocker(oneList)).toBe(UNSUPPORTED);
    expect(nonRangedBlocker(oneList)).toBe(UNSUPPORTED);
    expect(() => descriptorToLedgerPolicy(oneList, 'Vault')).toThrow(UNSUPPORTED);
    const mixed = `wsh(sortedmulti(2,${k('73c5da0a', "48'/1'/0'/2'", TPUB_A, '/<0;1>/*')},${k('aabbccdd', "48'/1'/0'/2'", TPUB_B, '/*')}))`;
    expect(ledgerPolicyBlocker(mixed)).toBe(UNSUPPORTED);
  });

  it('nonRangedBlocker is that rule alone: the device registry reads it (decided 2026-10-17)', () => {
    for (const d of [NONRANGED_WPKH, NONRANGED_WSH_MULTI, `${NONRANGED_WPKH}#abcd1234`, `wpkh(${TPUB_A})`]) {
      expect(nonRangedBlocker(d)).toBe(UNSUPPORTED);
    }
    expect(nonRangedBlocker(composeSinglesig(KEY_A))).toBeNull();
    // Not its business: the two-list import, refused by the translator in
    // its own sentence, and a script outside the four the device takes.
    expect(nonRangedBlocker(`wpkh(${k('73c5da0a', "84'/1'/0'", TPUB_A, '/0/*')})`)).toBeNull();
    expect(nonRangedBlocker(`pkh(${k('73c5da0a', "44'/1'/0'", TPUB_A, '/<0;1>/*')})`)).toBeNull();
  });

  it('a raw public key is a fixed key; a hash lock of the same length is not a key', () => {
    const COMPRESSED = `02${'ab'.repeat(32)}`;
    const XONLY = 'cd'.repeat(32);
    const ranged = k('73c5da0a', "48'/1'/0'/2'", TPUB_A, '/<0;1>/*');
    expect(ledgerPolicyBlocker(`wsh(multi(1,${ranged},${COMPRESSED}))`)).toBe(UNSUPPORTED);
    expect(ledgerPolicyBlocker(`wsh(multi(1,${ranged},[aabbccdd/48'/1'/0'/2']${COMPRESSED}))`)).toBe(UNSUPPORTED);
    expect(ledgerPolicyBlocker(`tr(${XONLY},pk(${ranged}))`)).toBe(UNSUPPORTED);
    const hashLock = `wsh(and_v(v:pk(${ranged}),sha256(${XONLY})))`;
    expect(ledgerPolicyBlocker(hashLock)).toBeNull();
    expect(descriptorToLedgerPolicy(hashLock, 'x').descriptorTemplate).toBe(`wsh(and_v(v:pk(@0/**),sha256(${XONLY})))`);
  });

  it('every template the translator still writes is a BIP-388 one', () => {
    const KB = { fingerprint: 'a1b2c3d4', originPath: "48'/0'/0'/2'", xpub: TPUB_VB };
    const KC = { fingerprint: 'deadbeef', originPath: "48'/0'/0'/2'", xpub: TPUB_VC };
    const vaults = [
      composeSinglesig(KEY_A),
      composeMultisig(2, [MKEY_A, MKEY_B, MKEY_C], { script: 'wsh' }),
      composeMultisig(1, [KB, KC]),
      `wpkh([73c5da0a/84'/0'/0']${TPUB_A}/<2;3>/*)`,
      `sh(wsh(sortedmulti(2,${k('73c5da0a', "48'/1'/0'/1'", TPUB_A, '/<0;1>/*')},${k('aabbccdd', "48'/1'/0'/1'", TPUB_B, '/<0;1>/*')})))`,
    ];
    for (const d of vaults) {
      expect(ledgerPolicyBlocker(d)).toBeNull();
      const t = descriptorToLedgerPolicy(d, 'x').descriptorTemplate;
      expect({ t, bad: notBip388(t) }).toEqual({ t, bad: [] });
    }
  });
});
