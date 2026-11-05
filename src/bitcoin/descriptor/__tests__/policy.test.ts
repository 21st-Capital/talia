import { parsePolicy, sigTypeLabel } from '../policy';
import {
  LIANA_MINISCRIPT,
  LIANA_TAPROOT,
  MAINNET_SINGLE_SIG,
  MULTISIG_2_OF_3,
  SPARROW_SINGLE_SIG,
  TAPROOT_SINGLE_SIG,
  TPUB_A,
  TPUB_B,
  TPUB_C,
  NUMS_TPUB,
} from '../__fixtures__/descriptors';

describe('parsePolicy', () => {
  it('single-sig wpkh → one unlocked 1-of-1 path', () => {
    const p = parsePolicy(SPARROW_SINGLE_SIG);
    expect(p.exact).toBe(true);
    expect(p.paths).toHaveLength(1);
    expect(p.paths[0].olderBlocks).toBeUndefined();
    expect(p.paths[0].groups).toEqual([
      { threshold: 1, keys: [expect.objectContaining({ fingerprint: '73c5da0a' })] },
    ]);
  });

  it('2-of-3 sortedmulti → one unlocked 2-of-3 path', () => {
    const p = parsePolicy(MULTISIG_2_OF_3);
    expect(p.exact).toBe(true);
    expect(p.paths).toHaveLength(1);
    const [g] = p.paths[0].groups;
    expect(g.threshold).toBe(2);
    expect(g.keys.map((k) => k.fingerprint)).toEqual(['73c5da0a', 'a1b2c3d4', 'deadbeef']);
  });

  it('Liana or_d → primary path + timelocked recovery path', () => {
    const p = parsePolicy(LIANA_MINISCRIPT);
    expect(p.exact).toBe(true);
    expect(p.paths).toHaveLength(2);
    const [primary, recovery] = p.paths;
    expect(primary.olderBlocks).toBeUndefined();
    expect(primary.groups[0]).toEqual({
      threshold: 1,
      keys: [expect.objectContaining({ fingerprint: '73c5da0a' })],
    });
    expect(recovery.olderBlocks).toBe(65535);
    expect(recovery.groups[0].keys[0].fingerprint).toBe('a1b2c3d4');
  });

  it('Liana taproot: internal key primary + timelocked leaf', () => {
    const p = parsePolicy(LIANA_TAPROOT);
    expect(p.exact).toBe(true);
    expect(p.paths).toHaveLength(2);
    expect(p.paths[0].groups[0].keys[0].fingerprint).toBe('73c5da0a');
    expect(p.paths[1].olderBlocks).toBe(4032);
  });

  it('taproot single key (no tree) → one path', () => {
    const p = parsePolicy(TAPROOT_SINGLE_SIG);
    expect(p.paths).toHaveLength(1);
    expect(p.paths[0].groups[0].threshold).toBe(1);
  });

  it('Liana taproot with UNSPENDABLE internal key (no origin) omits it', () => {
    // 2-of-2 primary leaf + 1-key rescue leaf, a Liana-built shape.
    const d =
      `tr(${NUMS_TPUB}/<0;1>/*,{` +
      `multi_a(2,[0c21c051/48'/1'/0'/2']${TPUB_B}/<0;1>/*,[f00dcafe/48'/1'/0'/2']${TPUB_C}/<0;1>/*),` +
      `and_v(v:pk([4c21e5c0/48'/1'/0'/2']${TPUB_A}/<0;1>/*),older(65535))})`;
    const p = parsePolicy(d);
    expect(p.exact).toBe(true);
    expect(p.paths).toHaveLength(2);
    expect(p.paths[0].olderBlocks).toBeUndefined();
    expect(p.paths[0].groups[0].threshold).toBe(2);
    expect(p.paths[0].groups[0].keys.map((k) => k.fingerprint)).toEqual([
      '0c21c051',
      'f00dcafe',
    ]);
    expect(p.paths[1].olderBlocks).toBe(65535);
    expect(p.paths[1].groups[0].keys[0].fingerprint).toBe('4c21e5c0');
  });

  it('multi-key AND within a recovery path (and_v of multi + older)', () => {
    const d =
      `wsh(or_d(multi(2,[73c5da0a/48']${TPUB_A}/<0;1>/*,[a1b2c3d4/48']${TPUB_B}/<0;1>/*),` +
      `and_v(v:multi(1,[deadbeef/48']${TPUB_C}/<0;1>/*),older(52596))))`;
    const p = parsePolicy(d);
    expect(p.exact).toBe(true);
    expect(p.paths[0].groups[0].threshold).toBe(2);
    expect(p.paths[1].olderBlocks).toBe(52596);
    expect(p.paths[1].groups[0].threshold).toBe(1);
  });

  it('unsupported shapes fall back to exact:false with all keys listed', () => {
    const d = `wsh(and_v(v:hash160(aabbccddeeff00112233445566778899aabbccdd),pk(${TPUB_A})))`;
    const p = parsePolicy(d);
    expect(p.exact).toBe(false);
    expect(p.paths[0].groups[0].keys).toHaveLength(1);
  });
});

describe('sigTypeLabel', () => {
  it('single-sig descriptors → Single-sig', () => {
    expect(sigTypeLabel(SPARROW_SINGLE_SIG)).toBe('Single-sig');
    expect(sigTypeLabel(MAINNET_SINGLE_SIG)).toBe('Single-sig');
    expect(sigTypeLabel(TAPROOT_SINGLE_SIG)).toBe('Single-sig');
  });

  it('multisig and Liana multi-key descriptors → Multisig', () => {
    expect(sigTypeLabel(MULTISIG_2_OF_3)).toBe('Multisig');
    expect(sigTypeLabel(LIANA_MINISCRIPT)).toBe('Multisig');
    expect(sigTypeLabel(LIANA_TAPROOT)).toBe('Multisig');
  });

  it('same key reused across paths still counts as Single-sig', () => {
    const d = `wsh(or_d(pk([73c5da0a/48']${TPUB_A}/<0;1>/*),and_v(v:pkh([73c5da0a/49']${TPUB_A}/<0;1>/*),older(100))))`;
    expect(sigTypeLabel(d)).toBe('Single-sig');
  });
});
