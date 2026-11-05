import { minOlderBlocks } from '../timelock';

describe('minOlderBlocks', () => {
  it('extracts a single older()', () => {
    expect(
      minOlderBlocks("wsh(or_d(pk(xpubA/<0;1>/*),and_v(v:pkh(xpubB/<0;1>/*),older(52560))))"),
    ).toBe(52560);
  });

  it('returns the SMALLEST when multiple recovery paths exist', () => {
    expect(
      minOlderBlocks(
        'wsh(or_i(and_v(v:pkh(A),older(65535)),or_d(pk(B),and_v(v:pkh(C),older(4320)))))',
      ),
    ).toBe(4320);
  });

  it('returns null without timelocks', () => {
    expect(minOlderBlocks('wpkh(xpub6C.../0/*)')).toBeNull();
    expect(minOlderBlocks('wsh(sortedmulti(2,A,B,C))')).toBeNull();
  });

  it('ignores zero/garbage values', () => {
    expect(minOlderBlocks('wsh(and_v(v:pk(A),older(0)))')).toBeNull();
  });
});
