import { splitMultipathDescriptor } from '../multipath';
import * as F from '../__fixtures__/descriptors';

describe('splitMultipathDescriptor', () => {
  it('returns non-multipath descriptors unchanged (checksum kept)', () => {
    const plain = `wpkh([73c5da0a/84'/1'/0']${F.TPUB_A}/0/*)#abcd1234`;
    expect(splitMultipathDescriptor(plain)).toEqual({ external: plain });
  });

  it('splits a Sparrow single-sig multipath into external/internal', () => {
    const { external, internal } = splitMultipathDescriptor(F.SPARROW_SINGLE_SIG);
    expect(external).toContain('/0/*');
    expect(internal).toContain('/1/*');
    expect(external).not.toContain('<');
    expect(internal).not.toContain('<');
    // checksum must be dropped — the body changed
    expect(external).not.toContain('#');
    expect(internal).not.toContain('#');
  });

  it('splits every multipath element in a multisig descriptor', () => {
    const { external, internal } = splitMultipathDescriptor(F.MULTISIG_2_OF_3);
    expect(external.match(/\/0\/\*/g)).toHaveLength(3);
    expect(internal!.match(/\/1\/\*/g)).toHaveLength(3);
  });

  it('splits Liana miniscript and taproot descriptors', () => {
    for (const desc of [F.LIANA_MINISCRIPT, F.LIANA_TAPROOT]) {
      const { external, internal } = splitMultipathDescriptor(desc);
      expect(external).not.toContain('<');
      expect(internal).toBeDefined();
      expect(internal).not.toContain('<');
      // policy fragments (timelocks) must survive the split intact
      expect(external).toContain('older(');
      expect(internal).toContain('older(');
    }
  });

  it('handles non-standard branch indexes like <2;3>', () => {
    const desc = `wpkh(${F.TPUB_A}/<2;3>/*)`;
    const { external, internal } = splitMultipathDescriptor(desc);
    expect(external).toContain('/2/*');
    expect(internal).toContain('/3/*');
  });
});
