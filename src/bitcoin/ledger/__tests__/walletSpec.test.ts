import { ledgerWalletSpecFor } from '../walletSpec';

const TPUB = 'tpubDDDvczQ8xdMxbdVMAvcCxfsqjSbrumbGVDeJmqzR8ZgVKTZBQqQNzHZDU3nZaXe2rZmMgLRWtmvxb5x9ZAqjK4CCwGaWDkWc6Y3EqcCMu2d';
const TPUB2 = 'tpubDCDuqEgbT3rnSzcJZC94rWJqBUyVbEgigqW9NkNkzyLYQCsNbTJVEWuLNfYzRe4EGkMK9ARxBDeHfxecFFrBAztDsZLYNiBB1uD86ZLpuXn';

describe('ledgerWalletSpecFor', () => {
  it('a stored registration wins outright', () => {
    const reg = { name: 'V', descriptorTemplate: 'tr(@0/**,multi_a(1,@1/**))', keys: ['a', 'b'], hmacHex: 'ff' };
    const r = ledgerWalletSpecFor(`wpkh([73c5da0a/84'/1'/0']${TPUB}/<0;1>/*)`, 'V', reg);
    expect(r).toEqual({ spec: { kind: 'registered', ...reg } });
  });

  it('single-sig wpkh becomes a default wallet at the key origin path', () => {
    const r = ledgerWalletSpecFor(`wpkh([73c5da0a/84'/1'/0']${TPUB}/<0;1>/*)`, 'V', undefined);
    expect(r).toEqual({ spec: { kind: 'default', derivationPath: "84'/1'/0'", template: 'wpkh' } });
  });

  it('single-sig tr maps to the taproot template', () => {
    const r = ledgerWalletSpecFor(`tr([73c5da0a/86'/1'/0']${TPUB}/<0;1>/*)`, 'V', undefined);
    expect(r).toEqual({ spec: { kind: 'default', derivationPath: "86'/1'/0'", template: 'tr' } });
  });

  it('an unregistered multisig points at the registration ceremony', () => {
    const d = `tr(${TPUB}/<0;1>/*,multi_a(2,[73c5da0a/48'/1'/0'/2']${TPUB}/<0;1>/*,[deadbeef/48'/1'/0'/2']${TPUB2}/<0;1>/*))`;
    const r = ledgerWalletSpecFor(d, 'V', undefined);
    expect('blocker' in r && r.blocker).toContain('Register this vault');
  });

  it('a bare-key vault explains what is missing', () => {
    const r = ledgerWalletSpecFor(`wpkh(${TPUB}/<0;1>/*)`, 'V', undefined);
    expect('blocker' in r && r.blocker).toContain('full vault description');
  });
});
