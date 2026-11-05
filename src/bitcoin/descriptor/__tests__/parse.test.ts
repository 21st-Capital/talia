import {
  parseDescriptor,
  stripChecksum,
  detectNetwork,
  detectScriptType,
  parseMultisig,
  parseTimelocks,
  parseKeyOrigins,
  splitTopLevel,
  extractBalanced,
} from '../parse';
import * as F from '../__fixtures__/descriptors';

describe('stripChecksum', () => {
  it('separates a valid 8-char checksum', () => {
    const { body, checksum } = stripChecksum(F.SPARROW_SINGLE_SIG);
    expect(checksum).toBe('v783ze88');
    expect(body.endsWith(')')).toBe(true);
  });

  it('leaves body intact when no checksum present', () => {
    const raw = 'wpkh(tpubDxxx/0/*)';
    expect(stripChecksum(raw)).toEqual({ body: raw });
  });

  it('does not treat a fragment after # as checksum if malformed', () => {
    const raw = 'wpkh(tpubDxxx/0/*)#short';
    expect(stripChecksum(raw).checksum).toBeUndefined();
  });
});

describe('detectNetwork', () => {
  it('detects testnet from tpub-family keys', () => {
    expect(detectNetwork(F.SPARROW_SINGLE_SIG)).toBe('testnet');
  });
  it('detects mainnet from xpub-family keys', () => {
    expect(detectNetwork(F.MAINNET_SINGLE_SIG)).toBe('bitcoin');
  });
  it('returns undefined when no key prefix present', () => {
    expect(detectNetwork('addr(bc1qxyz)')).toBeUndefined();
  });
});

describe('detectScriptType', () => {
  it.each([
    [F.SPARROW_SINGLE_SIG, 'wpkh'],
    [F.NESTED_SINGLE_SIG, 'sh-wpkh'],
    [F.TAPROOT_SINGLE_SIG, 'tr'],
    [F.MULTISIG_2_OF_3, 'wsh'],
    [F.LIANA_MINISCRIPT, 'wsh'],
    [F.LIANA_TAPROOT, 'tr'],
  ])('classifies script type of %s', (desc, expected) => {
    expect(detectScriptType(desc)).toBe(expected);
  });
});

describe('parseKeyOrigins', () => {
  it('extracts fingerprint, origin path, and key path', () => {
    const keys = parseKeyOrigins(F.SPARROW_SINGLE_SIG);
    expect(keys).toHaveLength(1);
    expect(keys[0].fingerprint).toBe('73c5da0a');
    expect(keys[0].originPath).toBe("84'/1'/0'");
    expect(keys[0].xpub).toBe(F.TPUB_A);
    expect(keys[0].keyPath).toBe('<0;1>/*');
  });

  it('extracts all three keys from a 2-of-3 multisig', () => {
    const keys = parseKeyOrigins(F.MULTISIG_2_OF_3);
    expect(keys).toHaveLength(3);
    expect(keys.map((k) => k.fingerprint)).toEqual(['73c5da0a', 'a1b2c3d4', 'deadbeef']);
  });
});

describe('parseMultisig', () => {
  it('extracts m-of-n from sortedmulti', () => {
    expect(parseMultisig(F.MULTISIG_2_OF_3)).toEqual({ threshold: 2, totalKeys: 3 });
  });
  it('returns undefined for single-sig', () => {
    expect(parseMultisig(F.SPARROW_SINGLE_SIG)).toBeUndefined();
  });
});

describe('parseTimelocks', () => {
  it('finds relative timelocks (older) in Liana miniscript', () => {
    expect(parseTimelocks(F.LIANA_MINISCRIPT)).toEqual([{ type: 'relative', value: 65535 }]);
  });
  it('finds timelocks in taproot Liana descriptors', () => {
    expect(parseTimelocks(F.LIANA_TAPROOT)).toEqual([{ type: 'relative', value: 4032 }]);
  });
  it('returns empty for non-timelock descriptors', () => {
    expect(parseTimelocks(F.MULTISIG_2_OF_3)).toEqual([]);
  });
});

describe('parseDescriptor classification', () => {
  it('classifies single-sig', () => {
    const p = parseDescriptor(F.SPARROW_SINGLE_SIG);
    expect(p.kind).toBe('single-sig');
    expect(p.isMultipath).toBe(true);
    expect(p.containsPrivateKeys).toBe(false);
  });

  it('classifies nested and taproot single-sig', () => {
    expect(parseDescriptor(F.NESTED_SINGLE_SIG).kind).toBe('single-sig');
    expect(parseDescriptor(F.TAPROOT_SINGLE_SIG).kind).toBe('single-sig');
  });

  it('classifies multisig with threshold/total', () => {
    const p = parseDescriptor(F.MULTISIG_2_OF_3);
    expect(p.kind).toBe('multisig');
    expect(p.threshold).toBe(2);
    expect(p.totalKeys).toBe(3);
  });

  it('classifies Liana miniscript as miniscript (timelock wins)', () => {
    const p = parseDescriptor(F.LIANA_MINISCRIPT);
    expect(p.kind).toBe('miniscript');
    expect(p.timelocks).toHaveLength(1);
  });

  it('classifies Liana taproot recovery as miniscript', () => {
    expect(parseDescriptor(F.LIANA_TAPROOT).kind).toBe('miniscript');
  });

  it('flags private-key material', () => {
    expect(parseDescriptor(F.WITH_PRIVATE_KEY).containsPrivateKeys).toBe(true);
  });

  it('detects mainnet', () => {
    expect(parseDescriptor(F.MAINNET_SINGLE_SIG).network).toBe('bitcoin');
  });

  it('throws on empty input', () => {
    expect(() => parseDescriptor('   ')).toThrow();
  });
});

describe('paren helpers', () => {
  it('extractBalanced returns inner content', () => {
    expect(extractBalanced('multi(2,a,b)', 5)).toBe('2,a,b');
  });
  it('splitTopLevel ignores nested commas', () => {
    expect(splitTopLevel('2,pk(a,b),c')).toEqual(['2', 'pk(a,b)', 'c']);
  });
});
