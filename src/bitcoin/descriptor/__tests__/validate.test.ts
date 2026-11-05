import { validateForImport } from '../validate';
import * as F from '../__fixtures__/descriptors';

describe('validateForImport', () => {
  it('rejects empty input', () => {
    const r = validateForImport('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('empty');
  });

  it('rejects descriptors containing private keys', () => {
    const r = validateForImport(F.WITH_PRIVATE_KEY, { network: 'testnet' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('contains-private-keys');
  });

  it('accepts a Sparrow single-sig and summarises it', () => {
    const r = validateForImport(F.SPARROW_SINGLE_SIG);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.network).toBe('testnet');
      expect(r.source).toBe('sparrow');
      expect(r.summary).toContain('Single-sig');
      // Import's name dialog shows it: the shared name, never the stored key.
      expect(r.summary).toMatch(/ · Testnet4$/);
      expect(r.summary).not.toMatch(/testnet\b/);
    }
  });

  it('names the network as every screen does: Bitcoin or Testnet4, Signet never', () => {
    const named = (descriptor: string, network?: 'bitcoin' | 'signet') => {
      const r = validateForImport(descriptor, network ? { network } : {});
      expect(r.ok).toBe(true);
      return r.ok ? r.summary : '';
    };
    expect(named(F.MAINNET_SINGLE_SIG)).toMatch(/ · Bitcoin$/);
    expect(named(F.SPARROW_SINGLE_SIG, 'signet')).toMatch(/ · Testnet4$/);
  });

  it('accepts a 2-of-3 multisig with a correct summary', () => {
    const r = validateForImport(F.MULTISIG_2_OF_3, { network: 'testnet' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary).toContain('2-of-3 multisig');
      expect(r.suggestedLabel).toContain('multisig');
    }
  });

  it('accepts a Liana miniscript and flags the timelock', () => {
    const r = validateForImport(F.LIANA_MINISCRIPT, { network: 'signet' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe('liana');
      expect(r.summary).toContain('Miniscript');
      expect(r.warnings.join(' ')).toMatch(/timelock|recovery/i);
    }
  });

  it('allows signet override for a testnet-family descriptor without warning', () => {
    const r = validateForImport(F.SPARROW_SINGLE_SIG, { network: 'signet' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.network).toBe('signet');
      expect(r.warnings.find((w) => w.includes('selected'))).toBeUndefined();
    }
  });

  it('warns on an obvious mainnet/testnet mismatch', () => {
    const r = validateForImport(F.MAINNET_SINGLE_SIG, { network: 'testnet' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join(' ')).toMatch(/bitcoin.*testnet|selected/i);
  });
});
