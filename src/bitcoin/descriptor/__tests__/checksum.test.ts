import { checksumMatches, descriptorChecksum } from '../parse';
import { validateForImport } from '../validate';
import { TPUB_A, TPUB_B } from '../__fixtures__/descriptors';

/**
 * BIP-380 checksums (decided 2026-09-26). The engine
 * splits a multipath `<0;1>` descriptor and drops its checksum before BDK
 * sees it, so a changed or damaged descriptor used to import without a word.
 */
describe('descriptorChecksum (BIP-380 reference vectors)', () => {
  it('matches the vectors published in BIP-380', () => {
    expect(descriptorChecksum('raw(deadbeef)')).toBe('89f8spxm');
    expect(descriptorChecksum('addr(mkmZxiEcEd8ZqjQWVZuC6so5dFMKEFpN2j)')).toBe('02wpgw69');
  });

  it('refuses a character outside the descriptor alphabet', () => {
    expect(descriptorChecksum('raw(deadbeef)é')).toBeNull();
  });
});

describe('checksumMatches', () => {
  const body = `wsh(multi(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,[a1b2c3d4/48'/1'/0'/2']${TPUB_B}/<0;1>/*))`;
  const good = `${body}#${descriptorChecksum(body)}`;

  it('accepts a matching checksum and a descriptor with none', () => {
    expect(checksumMatches(good)).toBe(true);
    expect(checksumMatches(body)).toBe(true);
  });

  it('catches an edited threshold on a MULTIPATH descriptor', () => {
    const edited = good.replace('multi(2,', 'multi(1,');
    expect(checksumMatches(edited)).toBe(false);
  });

  it('validateForImport refuses the edited descriptor and keeps the good one', () => {
    const edited = good.replace('multi(2,', 'multi(1,');
    const bad = validateForImport(edited, { network: 'testnet' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe('checksum-mismatch');
    expect(validateForImport(good, { network: 'testnet' }).ok).toBe(true);
  });
});
