import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';
import { parseElectrumWallet } from '../electrumWallet';
import { TPUB_A } from '../__fixtures__/descriptors';

const base58check = createBase58check(sha256);

/** Re-dress a standard tpub in another SLIP-132 header, as Sparrow does. */
function withHeader(key: string, versionHex: string): string {
  const bytes = new Uint8Array(base58check.decode(key));
  bytes.set((versionHex.match(/../g) ?? []).map((h) => parseInt(h, 16)), 0);
  return base58check.encode(bytes);
}

/** Three DECODABLE tpubs. Only TPUB_A carries a real checksum (the shared
 *  fixtures are structurally realistic placeholders), and this module
 *  decodes what it is given, so the others are derived from it. */
function variant(key: string, tweak: number): string {
  const bytes = new Uint8Array(base58check.decode(key));
  bytes[77] = (bytes[77] + tweak) & 0xff;
  return base58check.encode(bytes);
}
const TPUB_B = variant(TPUB_A, 1);
const TPUB_C = variant(TPUB_A, 2);
const VPUB = '02575483'; // testnet multisig p2wsh
const UPUB = '024289ef'; // testnet multisig p2sh-p2wsh
const VPUB_SINGLE = '045f1cf6'; // testnet single-sig native segwit

/** A Sparrow "Electrum" export, in the shape Electrum.java writes. */
function multisigFile(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    'x1/': {
      label: 'Ledger Nano Gen5',
      derivation: "m/48'/1'/0'/2'",
      root_fingerprint: '73C5DA0A',
      xpub: withHeader(TPUB_A, VPUB),
      type: 'hardware',
      hw_type: 'ledger',
    },
    'x2/': {
      label: 'BitBox 02',
      derivation: "m/48'/1'/0'/2'",
      root_fingerprint: 'a1b2c3d4',
      xpub: withHeader(TPUB_B, VPUB),
      type: 'hardware',
      hw_type: 'bitbox02',
    },
    'x3/': {
      label: 'Passport',
      derivation: "m/48'/1'/0'/2'",
      root_fingerprint: 'deadbeef',
      xpub: withHeader(TPUB_C, VPUB),
      type: 'hardware',
      hw_type: 'passport',
    },
    wallet_type: '2of3',
    use_encryption: false,
    ...over,
  });
}

describe('parseElectrumWallet', () => {
  it('rebuilds a 2 of 3 and keeps the name of every device', () => {
    const w = parseElectrumWallet(multisigFile())!;
    expect(w.threshold).toBe(2);
    expect(w.descriptor).toBe(
      `wsh(sortedmulti(2,[73c5da0a/48'/1'/0'/2']${TPUB_A}/<0;1>/*,` +
        `[a1b2c3d4/48'/1'/0'/2']${TPUB_B}/<0;1>/*,` +
        `[deadbeef/48'/1'/0'/2']${TPUB_C}/<0;1>/*))`,
    );
    expect(w.keyLabels).toEqual({
      '73c5da0a': 'Ledger Nano Gen5',
      a1b2c3d4: 'BitBox 02',
      deadbeef: 'Passport',
    });
    expect(w.keys.map((k) => k.device)).toEqual(['ledger', 'bitbox02', 'passport']);
    expect(w.warnings).toEqual([]);
  });

  it('reads a single-key wallet, whose keystore is not numbered', () => {
    const w = parseElectrumWallet(
      JSON.stringify({
        keystore: {
          label: 'Ledger Nano Gen5',
          derivation: "m/84'/1'/0'",
          root_fingerprint: '73c5da0a',
          xpub: withHeader(TPUB_A, VPUB_SINGLE),
          type: 'hardware',
          hw_type: 'ledger',
        },
        wallet_type: 'standard',
      }),
    )!;
    expect(w.descriptor).toBe(`wpkh([73c5da0a/84'/1'/0']${TPUB_A}/<0;1>/*)`);
    expect(w.threshold).toBe(1);
  });

  it('takes the address type from the PATH, not the key header', () => {
    // Sparrow writes a taproot key with a plain header. Trusting the header
    // would build a native segwit wallet watching addresses that hold
    // nothing.
    const w = parseElectrumWallet(
      JSON.stringify({
        keystore: { derivation: "m/86'/1'/0'", root_fingerprint: '73c5da0a', xpub: TPUB_A },
        wallet_type: 'standard',
      }),
    )!;
    expect(w.descriptor).toBe(`tr([73c5da0a/86'/1'/0']${TPUB_A}/<0;1>/*)`);
  });

  it('nested segwit multisig keeps its wrapper', () => {
    const nested = JSON.parse(multisigFile()) as Record<string, Record<string, unknown>>;
    for (const k of ['x1/', 'x2/', 'x3/']) {
      nested[k].derivation = "m/48'/1'/0'/1'";
      nested[k].xpub = withHeader(String(nested[k].xpub), UPUB);
    }
    const w = parseElectrumWallet(JSON.stringify(nested))!;
    expect(w.descriptor.startsWith('sh(wsh(sortedmulti(2,')).toBe(true);
  });

  it('is not fooled by other JSON', () => {
    expect(parseElectrumWallet('{"foo":1}')).toBeNull();
    expect(parseElectrumWallet('not json')).toBeNull();
    expect(parseElectrumWallet(JSON.stringify({ wallet_type: 'standard' }))).toBeNull();
  });

  it('refuses what it must not guess at', () => {
    // A quorum the file contradicts.
    expect(() => parseElectrumWallet(multisigFile({ wallet_type: '2of5' }))).toThrow(/does not carry/);
    // More signatures than keys.
    expect(() => parseElectrumWallet(multisigFile({ wallet_type: '4of3' }))).toThrow(/more signatures/);
    // Keys of two different address types.
    const mixed = JSON.parse(multisigFile()) as Record<string, Record<string, unknown>>;
    mixed['x2/'].derivation = "m/48'/1'/0'/1'";
    expect(() => parseElectrumWallet(JSON.stringify(mixed))).toThrow(/different address types/);
    // A key that is not an extended public key.
    const broken = JSON.parse(multisigFile()) as Record<string, Record<string, unknown>>;
    broken['x3/'].xpub = 'nonsense';
    expect(() => parseElectrumWallet(JSON.stringify(broken))).toThrow(/not an extended public key/);
    // Several keys under a single-key address type.
    const single = JSON.parse(multisigFile()) as Record<string, Record<string, unknown>>;
    for (const k of ['x1/', 'x2/', 'x3/']) single[k].derivation = "m/84'/1'/0'";
    expect(() => parseElectrumWallet(JSON.stringify(single))).toThrow(/single-key address type/);
  });

  it('says so when a key arrives without its origin', () => {
    const noOrigin = JSON.parse(multisigFile()) as Record<string, Record<string, unknown>>;
    delete noOrigin['x2/'].root_fingerprint;
    const w = parseElectrumWallet(JSON.stringify(noOrigin))!;
    expect(w.warnings.join(' ')).toMatch(/no fingerprint or path/);
    expect(w.descriptor).toContain(`,${TPUB_B}/<0;1>/*`);
  });

  it('never reads private material, even when the file carries it', () => {
    const withPrivate = JSON.parse(multisigFile()) as Record<string, Record<string, unknown>>;
    withPrivate['x1/'].xprv = 'tprv-should-never-be-read';
    withPrivate['x1/'].seed = 'twelve words that must not travel';
    const w = parseElectrumWallet(JSON.stringify(withPrivate))!;
    expect(JSON.stringify(w)).not.toContain('tprv-should-never-be-read');
    expect(JSON.stringify(w)).not.toContain('twelve words');
  });
});
