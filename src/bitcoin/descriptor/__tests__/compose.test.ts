import {
  composeSinglesig,
  composeMultisig,
  composeTimelockVault,
  composeLayeredVault,
  monthsToBlocks,
  MAX_OLDER_BLOCKS,
  BLOCKS_PER_MONTH,
} from '../compose';
import { unspendableInternalKey } from '../unspendable';
import { parseColdcardExport } from '../coldcard';
import { extractImportPayload } from '../importFile';
import { parsePolicy, sigTypeLabel } from '../policy';
import { parseDescriptor } from '../parse';
import { TPUB_A, TPUB_B, TPUB_C, XPUB_A } from '../__fixtures__/descriptors';

// Checksum-VALID synthetic tpubs (distinct real curve points): the
// unspendable-key derivation base58check-decodes every composed key, so the
// classification-only fixtures with fake checksums (TPUB_B/TPUB_C/XPUB_A)
// cannot be used for composition.
const TPUB_VB =
  'tpubD6NzVbkrYhZ4YsrXq9nRjEWRm7aBoRj8m7jZoxtAn4GQ7HvFWKSMx9zRgAjuPpLqudEZXG7zKA1cVQUxr3nf2M88odg2MfeZPk1CuCvrWuK';
const TPUB_VC =
  'tpubD6NzVbkrYhZ4XRUcexv9JpRu7jLdgeJSSmQEymQhjkgHW85grqZnxzWruanEgBvE5gHU1JNgwW34W6oJEpnaY8NuQ7D6WKgGukX3iE3hJn3';
const TPUB_VD =
  'tpubD6NzVbkrYhZ4XKTpDpd55aveE9jaKSRetSgKpxsQeVys9ePqDdtLsFteg7VrWuew2sRoK6ACau4GDaY3CHoytheBCpPH28qkTt49iHXtXVg';
const TPUB_VE =
  'tpubD6NzVbkrYhZ4Yjkmt31ALcdHtYjKnpAvAzVbPZEMYuDeZb1a5S9sMfeaSz7TjSGWBbstfeKSGCHc7SDe5hcsDdxmmeQUaGDBbVMCPicvsec';
const KEY_A = { fingerprint: '73c5da0a', originPath: "84'/0'/0'", xpub: TPUB_A };
const KEY_B = { fingerprint: 'a1b2c3d4', originPath: "48'/0'/0'/2'", xpub: TPUB_VB };
const KEY_C = { fingerprint: 'deadbeef', originPath: "48'/0'/0'/2'", xpub: TPUB_VC };
const KEY_D = { fingerprint: '0f056943', originPath: "48'/0'/0'/2'", xpub: TPUB_VD };

describe('composeSinglesig', () => {
  it('builds a wpkh multipath descriptor the app classifies as single-sig', () => {
    const d = composeSinglesig(KEY_A);
    expect(d).toBe(`wpkh([73c5da0a/84'/0'/0']${TPUB_A}/<0;1>/*)`);
    const parsed = parseDescriptor(d);
    expect(parsed.kind).toBe('single-sig');
    expect(parsed.isMultipath).toBe(true);
    expect(sigTypeLabel(d)).toBe('Single-sig');
  });

  it('accepts a bare key without origin', () => {
    expect(composeSinglesig({ xpub: TPUB_A })).toBe(`wpkh(${TPUB_A}/<0;1>/*)`);
  });

  it('builds taproot for a BIP-86 key (the default Coldcard account now)', () => {
    const key = { fingerprint: '73c5da0a', originPath: "86'/0'/0'", xpub: TPUB_A };
    const d = composeSinglesig(key);
    expect(d).toBe(`tr([73c5da0a/86'/0'/0']${TPUB_A}/<0;1>/*)`);
    expect(sigTypeLabel(d)).toBe('Single-sig');
  });
});

describe('composeMultisig', () => {
  it('builds sortedmulti the policy layer reads back correctly', () => {
    const d = composeMultisig(2, [KEY_B, KEY_C, KEY_D]);
    expect(parseDescriptor(d).kind).toBe('multisig');
    const policy = parsePolicy(d);
    expect(policy.exact).toBe(true);
    expect(policy.paths).toHaveLength(1);
    expect(policy.paths[0].groups[0].threshold).toBe(2);
    expect(policy.paths[0].groups[0].keys).toHaveLength(3);
    expect(sigTypeLabel(d)).toBe('Multisig');
  });

  it('defaults to taproot with a deterministic unspendable internal key', () => {
    // 1-of-2, not 2-of-2: a bare k-of-k is refused (see the dead-end guard).
    const d = composeMultisig(1, [KEY_B, KEY_C]);
    // multi_a with self-sorted keys (BDK 0.28 predates sortedmulti_a);
    // the unspendable key commits to the same tap-tree (sorted) order.
    const sortedKeys = [KEY_B, KEY_C].sort((a, b) => (a.xpub < b.xpub ? -1 : 1));
    const nums = unspendableInternalKey(sortedKeys);
    expect(d).toBe(
      `tr(${nums}/<0;1>/*,multi_a(1,${sortedKeys
        .map((k) => `[${k.fingerprint}/${k.originPath}]${k.xpub}/<0;1>/*`)
        .join(',')}))`,
    );
    expect(composeMultisig(1, [KEY_C, KEY_B])).toBe(d); // order-independent
    expect(nums.startsWith('tpub')).toBe(true); // testnet keys → testnet NUMS
    // A different key set derives a different internal key (no cross-vault tell).
    expect(unspendableInternalKey([KEY_B, KEY_D])).not.toBe(nums);
  });

  it('emits classic P2WSH on request, in a canonical key order', () => {
    const d = composeMultisig(1, [KEY_B, KEY_C], { script: 'wsh' });
    // sortedmulti sorts pubkeys at derivation, so the addresses do not depend
    // on our order — we sort anyway so the STRING is stable across builds.
    const sorted = [KEY_B, KEY_C].sort((a, b) => (a.xpub < b.xpub ? -1 : 1));
    expect(d).toBe(
      `wsh(sortedmulti(1,${sorted
        .map((k) => `[${k.fingerprint}/${k.originPath}]${k.xpub}/<0;1>/*`)
        .join(',')}))`,
    );
    expect(composeMultisig(1, [KEY_C, KEY_B], { script: 'wsh' })).toBe(d);
  });

  // Decided 2026-07-28: plain SELF-CUSTODIAL multisig follows the industry
  // standard so it opens in Sparrow/Nunchuk/Coldcard. Anything holding a 21st
  // Capital key stays taproot, because blind co-signing signs script paths.
  describe('the wsh / taproot split', () => {
    it('refuses wsh when one of OUR keys is in the vault', () => {
      expect(() =>
        composeMultisig(2, [KEY_A, KEY_B, KEY_C], {
          script: 'wsh',
          providerFingerprints: [KEY_C.fingerprint],
        }),
      ).toThrow(/21st Capital key must use the taproot form/i);
    });

    it('allows wsh when the vault is entirely the client\'s own', () => {
      const d = composeMultisig(2, [KEY_A, KEY_B, KEY_C], {
        script: 'wsh',
        providerFingerprints: ['ffffffff'],
      });
      expect(d.startsWith('wsh(sortedmulti(2,')).toBe(true);
      expect(d).not.toContain('tr(');
    });

    it('still defaults to taproot — a forgotten option can never break co-signing', () => {
      expect(composeMultisig(2, [KEY_A, KEY_B, KEY_C]).startsWith('tr(')).toBe(true);
    });

    it('layered vaults stay taproot whatever the keys', () => {
      const d = composeLayeredVault({ threshold: 2, keys: [KEY_A, KEY_B, KEY_C] }, [
        { threshold: 1, keys: [KEY_D], olderBlocks: 65535 },
      ]);
      expect(d.startsWith('tr(')).toBe(true);
      expect(d).toContain('older(65535)');
    });
  });

  // Decided 2026-07-28, after a 3-of-3 vault turned up in a phone test: a primary path
  // that needs EVERY key has no margin — lose one key, lose the coins.
  describe('dead-end shapes are refused', () => {
    it('never builds a k-of-k for k > 2, with or without recovery', () => {
      expect(() => composeMultisig(3, [KEY_A, KEY_B, KEY_C])).toThrow(/all 3 keys/i);
      expect(() =>
        composeLayeredVault({ threshold: 3, keys: [KEY_A, KEY_B, KEY_C] }, [
          { threshold: 1, keys: [KEY_D], olderBlocks: 65535 },
        ]),
      ).toThrow(/all 3 keys/i);
    });

    it('refuses a bare 2-of-2, and allows one WITH a timelocked path', () => {
      expect(() => composeMultisig(2, [KEY_B, KEY_C])).toThrow(/needs a recovery path/i);
      expect(() =>
        composeLayeredVault({ threshold: 2, keys: [KEY_B, KEY_C] }, [
          { threshold: 1, keys: [KEY_D], olderBlocks: 65535 },
        ]),
      ).not.toThrow();
    });

    it('still allows every shape Talia offers', () => {
      expect(() => composeMultisig(2, [KEY_A, KEY_B, KEY_C])).not.toThrow(); // 2-of-3
      expect(() =>
        composeLayeredVault({ threshold: 1, keys: [KEY_A] }, [
          { threshold: 1, keys: [KEY_D], olderBlocks: 65535 },
        ]),
      ).not.toThrow(); // 1-of-1 + rescue
    });
  });

  it('rejects bad thresholds, too few keys, and duplicate keys', () => {
    expect(() => composeMultisig(3, [KEY_B, KEY_C])).toThrow('between 1 and 2');
    expect(() => composeMultisig(1, [KEY_B])).toThrow('at least 2');
    expect(() => composeMultisig(1, [KEY_B, KEY_B])).toThrow('added twice');
  });
});

describe('composeTimelockVault', () => {
  it('single primary + single recovery matches the Liana shape', () => {
    const d = composeTimelockVault({
      primary: { threshold: 1, keys: [KEY_A] },
      recovery: { threshold: 1, keys: [KEY_B] },
      olderBlocks: 52596,
    }, { script: 'wsh' });
    expect(d).toBe(
      `wsh(or_d(pk([73c5da0a/84'/0'/0']${TPUB_A}/<0;1>/*),` +
        `and_v(v:pkh([a1b2c3d4/48'/0'/0'/2']${TPUB_VB}/<0;1>/*),older(52596))))`,
    );
    const policy = parsePolicy(d);
    expect(policy.exact).toBe(true);
    expect(policy.paths).toHaveLength(2);
    expect(policy.paths[1].olderBlocks).toBe(52596);
  });

  it('multi primary + multi recovery composes miniscript multis', () => {
    const d = composeTimelockVault({
      primary: { threshold: 2, keys: [KEY_B, KEY_C] },
      recovery: { threshold: 1, keys: [KEY_A, KEY_D] },
      olderBlocks: 13149,
    });
    const policy = parsePolicy(d);
    expect(policy.paths[0].groups[0].threshold).toBe(2);
    expect(policy.paths[1].groups[0].threshold).toBe(1);
    expect(policy.paths[1].groups[0].keys).toHaveLength(2);
    expect(parseDescriptor(d).kind).toBe('miniscript');
  });

  it('rejects shared keys, bad locks', () => {
    const spec = {
      primary: { threshold: 1, keys: [KEY_A] },
      recovery: { threshold: 1, keys: [KEY_A] },
      olderBlocks: 100,
    };
    expect(() => composeTimelockVault(spec)).toThrow('different keys');
    expect(() =>
      composeTimelockVault({ ...spec, recovery: { threshold: 1, keys: [KEY_B] }, olderBlocks: MAX_OLDER_BLOCKS + 1 }),
    ).toThrow('65535');
  });
});

describe('composeLayeredVault (21st Capital shape: heirs + rescue key)', () => {
  it('primary 2-of-3 + one heir (10 months) + rescue (15 months)', () => {
    const d = composeLayeredVault({ threshold: 2, keys: [KEY_A, KEY_B, KEY_C] }, [
      { threshold: 1, keys: [KEY_D], olderBlocks: monthsToBlocks(10) },
      {
        threshold: 1,
        keys: [{ fingerprint: '21c21c21', originPath: "48'/0'/0'/2'", xpub: TPUB_VE }],
        olderBlocks: monthsToBlocks(15),
      },
    ]);
    const policy = parsePolicy(d);
    expect(policy.exact).toBe(true);
    expect(policy.paths).toHaveLength(3);
    expect(policy.paths[0].olderBlocks).toBeUndefined();
    expect(policy.paths[0].groups[0].threshold).toBe(2);
    expect(policy.paths[1].olderBlocks).toBe(10 * BLOCKS_PER_MONTH);
    expect(policy.paths[2].olderBlocks).toBe(MAX_OLDER_BLOCKS); // 15 mo clamps to BIP-68 max
    expect(parseDescriptor(d).kind).toBe('miniscript');
  });

  it('orders recovery paths by ascending timelock regardless of input order', () => {
    const d = composeLayeredVault({ threshold: 1, keys: [KEY_A] }, [
      { threshold: 1, keys: [KEY_C], olderBlocks: monthsToBlocks(15) },
      { threshold: 1, keys: [KEY_D], olderBlocks: monthsToBlocks(8) },
    ]);
    const policy = parsePolicy(d);
    expect(policy.paths[1].olderBlocks).toBe(8 * BLOCKS_PER_MONTH);
    expect(policy.paths[1].groups[0].keys[0].fingerprint).toBe('0f056943');
    expect(policy.paths[2].olderBlocks).toBe(MAX_OLDER_BLOCKS);
  });

  it('three timelocked paths nest or_i correctly and parse back', () => {
    const H2 = { fingerprint: 'aaaa1111', originPath: "48'/0'/0'/2'", xpub: TPUB_VE };
    const d = composeLayeredVault({ threshold: 1, keys: [KEY_A] }, [
      { threshold: 1, keys: [KEY_C], olderBlocks: monthsToBlocks(8) },
      { threshold: 1, keys: [KEY_D], olderBlocks: monthsToBlocks(12) },
      { threshold: 1, keys: [H2], olderBlocks: monthsToBlocks(15) },
    ]);
    const policy = parsePolicy(d);
    expect(policy.exact).toBe(true);
    expect(policy.paths).toHaveLength(4);
  });

  it('rejects duplicate keys across any paths and empty recoveries', () => {
    expect(() =>
      composeLayeredVault({ threshold: 1, keys: [KEY_A] }, [
        { threshold: 1, keys: [KEY_A], olderBlocks: 1000 },
      ]),
    ).toThrow('different keys');
    expect(() => composeLayeredVault({ threshold: 1, keys: [KEY_A] }, [])).toThrow(
      'at least one timelocked path',
    );
  });

  it('taproot layered vault: NUMS internal key + one leaf per path', () => {
    const d = composeLayeredVault({ threshold: 1, keys: [KEY_A] }, [
      { threshold: 1, keys: [KEY_C], olderBlocks: 1000 },
      { threshold: 2, keys: [KEY_B, KEY_D], olderBlocks: 2000 },
    ]);
    expect(d.startsWith('tr(tpub')).toBe(true);
    expect(d).toContain('{pk(');
    expect(d).toContain('multi_a(2,');
    const policy = parsePolicy(d);
    expect(policy.exact).toBe(true);
    // The unspendable internal key must NOT appear as a spending path.
    expect(policy.paths).toHaveLength(3);
    expect(policy.paths[0].olderBlocks).toBeUndefined();
    expect(policy.paths[1].olderBlocks).toBe(1000);
    expect(policy.paths[2].olderBlocks).toBe(2000);
    expect(policy.paths[2].groups[0].threshold).toBe(2);
  });

  it('monthsToBlocks uses Liana months and clamps at the BIP-68 ceiling', () => {
    expect(monthsToBlocks(8)).toBe(8 * BLOCKS_PER_MONTH);
    expect(monthsToBlocks(12)).toBe(52596);
    expect(monthsToBlocks(15)).toBe(MAX_OLDER_BLOCKS);
  });
});

describe('parseColdcardExport + import integration', () => {
  const EXPORT = JSON.stringify({
    chain: 'BTC',
    xfp: '0F056943',
    xpub: XPUB_A, // root — must NOT be picked as the wallet key
    bip44: { deriv: "m/44'/0'/0'", xpub: TPUB_A, name: 'p2pkh' },
    bip84: { deriv: "m/84'/0'/0'", xpub: TPUB_B, name: 'p2wpkh', first: 'bc1q…' },
    bip48_2: { deriv: "m/48'/0'/0'/2'", xpub: TPUB_C, name: 'p2wsh' },
  });

  it('parses fingerprint and the accounts we use', () => {
    const cc = parseColdcardExport(EXPORT);
    expect(cc).not.toBeNull();
    expect(cc!.fingerprint).toBe('0f056943');
    expect(cc!.bip84).toEqual({ originPath: "84'/0'/0'", xpub: TPUB_B });
    expect(cc!.bip48_2).toEqual({ originPath: "48'/0'/0'/2'", xpub: TPUB_C });
  });

  it('extractImportPayload builds the BIP-84 watch wallet, not the root xpub', () => {
    const { descriptor, warnings } = extractImportPayload(EXPORT);
    expect(descriptor).toBe(`wpkh([0f056943/84'/0'/0']${TPUB_B}/<0;1>/*)`);
    // The warning is user-facing, so it names no hardware wallet brand.
    expect(warnings.join(' ')).toMatch(/Hardware wallet export detected/);
  });

  it('non-Coldcard JSON returns null and generic scanning still works', () => {
    expect(parseColdcardExport('{"keystore":{"xpub":"' + TPUB_A + '"}}')).toBeNull();
    expect(parseColdcardExport('not json')).toBeNull();
  });
});

describe('parseColdcardExport — Multisig "Export XPUB" file (Zpub/Vpub)', () => {
  const { createBase58check } = require('@scure/base');
  const { sha256 } = require('@noble/hashes/sha256');
  const b58 = createBase58check(sha256);

  /** Redress a standard tpub in SLIP-132 Vpub clothing (what a testnet
   *  Coldcard writes into ccxp-XXXXXXXX.json). Needs a checksum-valid key —
   *  TPUB_A is real; TPUB_C is a synthetic classification fixture. */
  function toVpub(tpub: string): string {
    const bytes = b58.decode(tpub);
    const dressed = new Uint8Array(bytes);
    dressed.set([0x02, 0x57, 0x54, 0x83], 0); // Vpub version bytes
    return b58.encode(dressed);
  }

  const MS_EXPORT = JSON.stringify({
    xfp: '0F056943',
    account: '0',
    p2sh_deriv: "m/45'",
    p2sh: 'tpubDoesNotMatterHere111111111111111111111111111111111',
    p2wsh_deriv: "m/48'/1'/0'/2'",
    p2wsh: null as unknown, // replaced below
  }).replace('null', JSON.stringify(''));

  it('maps p2wsh (Vpub) to the bip48_2 account as a standard tpub', () => {
    const vpub = toVpub(TPUB_A);
    const json = JSON.stringify({
      xfp: '0F056943',
      account: '0',
      p2wsh_deriv: "m/48'/1'/0'/2'",
      p2wsh: vpub,
    });
    expect(vpub.startsWith('Vpub')).toBe(true);
    const cc = parseColdcardExport(json);
    expect(cc).not.toBeNull();
    expect(cc!.fingerprint).toBe('0f056943');
    expect(cc!.bip48_2).toEqual({ originPath: "48'/1'/0'/2'", xpub: TPUB_A });
    expect(cc!.bip84).toBeUndefined();
  });

  it('still rejects unrelated JSON', () => {
    expect(parseColdcardExport(MS_EXPORT)).toBeNull(); // empty p2wsh string
  });
});

describe('interop: what other wallets have to read (decided 2026-07-27)', () => {
  // A plain single-key vault must open in BlueWallet and Sparrow — the two
  // apps Bitcoin-only single-sig users actually run.
  // What Talia collects for a plain one-key vault: the BIP-84 account.
  // (Recent COLDCARD firmware writes hardened markers as `h`.) The
  // fingerprints are made up; the keys are the synthetic ones above.
  const cc84 = { fingerprint: 'cc000001', originPath: '84h/1h/0h', xpub: TPUB_VB };
  const cc86 = { fingerprint: 'cc000001', originPath: '86h/1h/0h', xpub: TPUB_VB };
  const rescue = { fingerprint: 'cc000002', originPath: "48'/1'/0'/2'", xpub: TPUB_VC };

  it('a plain one-key vault is wpkh on 84\' — what BlueWallet and Sparrow expect', () => {
    const d = composeSinglesig(cc84);
    expect(d).toBe(`wpkh([cc000001/84'/1'/0']${TPUB_VB}/<0;1>/*)`);
    expect(d).not.toContain('h/'); // hardened markers normalised to '
    expect(d).not.toContain('multi');
    expect(d).not.toContain('older');
    expect(d).not.toContain('{');
  });

  it('an imported BIP-86 key still composes as taproot — the key decides', () => {
    expect(composeSinglesig(cc86)).toBe(`tr([cc000001/86'/1'/0']${TPUB_VB}/<0;1>/*)`);
  });

  it('single-sig PLUS a timelocked layer is a Liana tree with a pk() primary', () => {
    const cc48 = { fingerprint: 'cc000001', originPath: "48'/1'/0'/2'", xpub: TPUB_VB };
    const d = composeLayeredVault({ threshold: 1, keys: [cc48] }, [
      { threshold: 1, keys: [rescue], olderBlocks: 65535 },
    ]);
    // Liana's single-key primary is pk(), never multi_a(1,...).
    expect(d).toContain(`{pk([cc000001/48'/1'/0'/2']`);
    expect(d).toContain(`and_v(v:pk([cc000002/48'/1'/0'/2']`);
    expect(d).toContain('older(65535)');
    expect(d).toMatch(/^tr\(tpub|^tr\(xpub/); // NUMS internal key, Liana scheme
  });
});
