import { describeScript, hasTimelock, isLayered } from '../describe';

describe('describeScript', () => {
  it('names a layered vault by its recovery, not just its quorum', () => {
    const d =
      'tr(NUMS,{multi_a(2,A,B,C),{and_v(v:pk(D),older(4320)),and_v(v:pk(E),older(65535))}})';
    expect(describeScript(d)).toBe('Taproot with timelocked recovery (primary 2 of 3)');
  });

  it('names a plain taproot multisig', () => {
    expect(describeScript('tr(NUMS,multi_a(2,A,B,C))')).toBe('Taproot multisig 2 of 3');
  });

  it('names a self-custodial wsh multisig', () => {
    expect(describeScript('wsh(sortedmulti(2,A,B,C))')).toBe('Native SegWit multisig 2 of 3');
  });

  it('matches the wording other wallets use for single-sig', () => {
    expect(describeScript('wpkh([aabbccdd/84h/0h/0h]xpub6C/<0;1>/*)')).toBe(
      'HD SegWit (BIP84 Bech32 Native)',
    );
  });

  it('ignores a checksum', () => {
    expect(describeScript('wpkh(xpub6C/0/*)#abcdefgh')).toBe(
      'HD SegWit (BIP84 Bech32 Native)',
    );
  });

  it('does not claim a type it cannot read', () => {
    expect(describeScript('rawtr(deadbeef)')).toBe('Unrecognised script');
  });

  it('spots both relative and absolute timelocks', () => {
    expect(hasTimelock('and_v(v:pk(A),older(144))')).toBe(true);
    expect(hasTimelock('and_v(v:pk(A),after(800000))')).toBe(true);
    expect(hasTimelock('multi_a(2,A,B)')).toBe(false);
  });
});

describe('isLayered (the Liana gate)', () => {
  it('is true only with a timelocked recovery path', () => {
    expect(
      isLayered('tr(NUMS,{multi_a(2,A,B,C),{and_v(v:pk(D),older(4320)),and_v(v:pk(E),older(65535))}})'),
    ).toBe(true);
  });

  it('refuses the shape Liana refuses: untimelocked taproot multisig', () => {
    // A co-signer vault with no rescue and no heir layer builds exactly this.
    expect(isLayered('tr(NUMS,multi_a(2,A,B,C))')).toBe(false);
  });

  it('is false for plain wsh multisig and single-sig', () => {
    expect(isLayered('wsh(sortedmulti(2,A,B,C))')).toBe(false);
    expect(isLayered('wpkh([aabbccdd/84h/0h/0h]xpub6C/<0;1>/*)')).toBe(false);
  });

  it('ignores a checksum', () => {
    expect(isLayered('tr(NUMS,{pk(A),and_v(v:pk(B),older(144))})#abcdefgh')).toBe(true);
  });

  it("sees Liana's legacy wsh miniscript as layered, whatever its prefix", () => {
    // An imported Liana vault. Routing must not stop at 'wsh(' and send it to
    // Sparrow: the timelock is what decides.
    expect(isLayered('wsh(or_d(pk(A),and_v(v:pkh(B),older(65535))))')).toBe(true);
  });
});
