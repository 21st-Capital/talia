import { normalizeBareKey } from '../bareKey';
import { validateForImport } from '../validate';

/**
 * Real extended keys derived (via embit) from the public BIP-39 test phrase
 * "abandon … about" — the same keys used in the published BIP-84 test vectors.
 * Master fingerprint 73c5da0a.
 */
const XPUB_84 =
  'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V';
const ZPUB_84 =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
const YPUB_49 =
  'ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP';
const XPUB_49 =
  'xpub6C6nQwHaWbSrzs5tZ1q7m5R9cPK9eYpNMFesiXsYrgc1P8bvLLAet9JfHjYXKjToD8cBRswJXXbbFpXgwsswVPAZzKMa1jUp2kVkGVUaJa7';
const TPUB_84 =
  'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';
const VPUB_84 =
  'vpub5Y6cjg78GGuNLsaPhmYsiw4gYX3HoQiRBiSwDaBXKUafCt9bNwWQiitDk5VZ5BVxYnQdwoTyXSs2JHRPAgjAvtbBrf8ZhDYe2jWAqvZVnsc';

describe('normalizeBareKey', () => {
  it('returns null for full descriptors and junk', () => {
    expect(normalizeBareKey(`wpkh(${XPUB_84}/0/*)`)).toBeNull();
    expect(normalizeBareKey('hello world')).toBeNull();
  });

  it('wraps a bare xpub in wpkh with a multipath spine and warnings', () => {
    const r = normalizeBareKey(XPUB_84)!;
    expect(r.descriptor).toBe(`wpkh(${XPUB_84}/<0;1>/*)`);
    expect(r.warnings.join(' ')).toMatch(/assumed native segwit/i);
    expect(r.warnings.join(' ')).toMatch(/no key origin/i);
  });

  it('converts zpub → xpub (BIP-84 test vector) and wraps in wpkh', () => {
    const r = normalizeBareKey(ZPUB_84)!;
    expect(r.descriptor).toBe(`wpkh(${XPUB_84}/<0;1>/*)`);
    // conversion is announced, but script type is NOT assumed (zpub encodes it)
    expect(r.warnings.join(' ')).toMatch(/converted zpub/i);
    expect(r.warnings.join(' ')).not.toMatch(/assumed/i);
  });

  it('converts ypub → xpub and wraps in sh(wpkh())', () => {
    const r = normalizeBareKey(YPUB_49)!;
    expect(r.descriptor).toBe(`sh(wpkh(${XPUB_49}/<0;1>/*))`);
  });

  it('converts vpub → tpub (testnet) and wraps in wpkh', () => {
    const r = normalizeBareKey(VPUB_84)!;
    expect(r.descriptor).toBe(`wpkh(${TPUB_84}/<0;1>/*)`);
  });

  it('keeps a provided origin and path', () => {
    const r = normalizeBareKey(`[73c5da0a/84'/0'/0']${XPUB_84}/0/*`)!;
    expect(r.descriptor).toBe(`wpkh([73c5da0a/84'/0'/0']${XPUB_84}/0/*)`);
    expect(r.warnings.join(' ')).not.toMatch(/no key origin/i);
  });

  it('rejects a corrupted key with a checksum message', () => {
    const bad = XPUB_84.slice(0, -1) + (XPUB_84.endsWith('V') ? 'W' : 'V');
    expect(() => normalizeBareKey(bad)).toThrow(/checksum/i);
  });

  it('rejects SLIP-132 multisig prefixes with guidance', () => {
    // Structurally plausible fake Zpub; prefix check fires before decoding.
    const fake = 'Zpub' + XPUB_84.slice(4);
    expect(() => normalizeBareKey(fake)).toThrow(/descriptor instead/i);
  });
});

describe('validateForImport with bare keys', () => {
  it('accepts a bare zpub end-to-end as mainnet single-sig', () => {
    const r = validateForImport(ZPUB_84);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.network).toBe('bitcoin');
      expect(r.parsed.kind).toBe('single-sig');
      expect(r.parsed.isMultipath).toBe(true);
      expect(r.warnings.join(' ')).toMatch(/converted zpub/i);
    }
  });

  it('accepts a bare tpub on signet with the assumed-type warning', () => {
    const r = validateForImport(TPUB_84, { network: 'signet' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.network).toBe('signet');
      expect(r.warnings.join(' ')).toMatch(/assumed native segwit/i);
    }
  });

  it('rejects a mistyped xpub with a clear message', () => {
    const bad = XPUB_84.slice(0, -1) + (XPUB_84.endsWith('V') ? 'W' : 'V');
    const r = validateForImport(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/checksum/i);
  });
});
