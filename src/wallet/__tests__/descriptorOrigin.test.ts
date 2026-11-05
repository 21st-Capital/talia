import { standardOriginPath, withKeyOrigin } from '../descriptorOrigin';
import { TPUB_A, TPUB_B } from '../../bitcoin/descriptor/__fixtures__/descriptors';

describe('withKeyOrigin', () => {
  it('puts the origin in front of a bare key, both branches of a multipath key', () => {
    expect(withKeyOrigin(`wpkh(${TPUB_A}/<0;1>/*)`, TPUB_A, 'A0B1C2D3', "m/84'/1'/0'")).toBe(
      `wpkh([a0b1c2d3/84'/1'/0']${TPUB_A}/<0;1>/*)`,
    );
  });

  it('leaves a key that already has an origin alone, and drops the checksum', () => {
    const d = `wpkh([73c5da0a/84'/1'/0']${TPUB_A}/<0;1>/*)#v783ze88`;
    expect(withKeyOrigin(d, TPUB_A, 'deadbeef', "84'/1'/0'")).toBe(
      `wpkh([73c5da0a/84'/1'/0']${TPUB_A}/<0;1>/*)`,
    );
  });

  it('touches only the named key', () => {
    const d = `wsh(sortedmulti(1,${TPUB_A}/0/*,${TPUB_B}/0/*))`;
    expect(withKeyOrigin(d, TPUB_B, 'deadbeef', "48'/1'/0'/2'")).toBe(
      `wsh(sortedmulti(1,${TPUB_A}/0/*,[deadbeef/48'/1'/0'/2']${TPUB_B}/0/*))`,
    );
  });

  it('refuses a key that is not in the vault, and a bad fingerprint', () => {
    expect(() => withKeyOrigin(`wpkh(${TPUB_A}/0/*)`, TPUB_B, 'deadbeef', "84'/1'/0'")).toThrow(
      'not in this vault',
    );
    expect(() => withKeyOrigin(`wpkh(${TPUB_A}/0/*)`, TPUB_A, 'nope', "84'/1'/0'")).toThrow(
      'fingerprint',
    );
  });
});

describe('standardOriginPath', () => {
  it('names the standard account for each single-key shape', () => {
    expect(standardOriginPath(`wpkh(${TPUB_A}/0/*)`, 'testnet')).toBe("84'/1'/0'");
    expect(standardOriginPath(`tr(${TPUB_A}/0/*)`, 'bitcoin', 2)).toBe("86'/0'/2'");
    expect(standardOriginPath(`sh(wpkh(${TPUB_A}/0/*))`, 'bitcoin')).toBe("49'/0'/0'");
    expect(standardOriginPath(`pkh(${TPUB_A}/0/*)`, 'bitcoin')).toBe("44'/0'/0'");
    expect(standardOriginPath(`wsh(sortedmulti(1,${TPUB_A}/0/*))`, 'bitcoin')).toBeNull();
  });
});
