/**
 * Decided 2026-09-26: bdk-rn builds an address with no
 * network check, so a testnet address pasted into a mainnet vault paid the
 * same program on mainnet (and the reverse). These pin the one check.
 */
import { addressFamily, addressFitsNetwork, addressToScriptHex } from '../addressNetwork';
import { scriptToAddress } from '../psbt/parse';
import { looksLikeAddress, validateBuildRequest } from '../psbt/build';

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const P2WPKH = hex('0014751e76e8199196d454941c45d1b3a323f1433bd6');
const P2TR = hex('51200000000000000000000000000000000000000000000000000000000000000001');
const P2PKH = hex('76a914751e76e8199196d454941c45d1b3a323f1433bd688ac');
const P2SH = hex('a914751e76e8199196d454941c45d1b3a323f1433bd687');

describe('addressFamily', () => {
  it('reads every standard shape on every network', () => {
    for (const script of [P2WPKH, P2TR, P2PKH, P2SH]) {
      expect(addressFamily(scriptToAddress(script, 'bitcoin')!)).toBe('bitcoin');
      expect(addressFamily(scriptToAddress(script, 'testnet')!)).toBe('test');
    }
    expect(addressFamily(scriptToAddress(P2WPKH, 'regtest')!)).toBe('regtest');
  });

  it('refuses a typo instead of guessing', () => {
    const good = scriptToAddress(P2WPKH, 'bitcoin')!;
    const typo = good.slice(0, -1) + (good.endsWith('q') ? 'p' : 'q');
    expect(addressFamily(typo)).toBeNull();
    expect(addressFamily('not an address')).toBeNull();
  });

  // BIP-173 and BIP-350's own test vectors, and one a phone could be handed.
  it.each([
    ['BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'bitcoin', 20],
    ['tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7', 'test', 32],
    ['bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y', 'bitcoin', 40],
    ['BC1SW50QGDZ25J', 'bitcoin', 2],
    ['bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs', 'bitcoin', 16],
    ['bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'bitcoin', 32],
  ])('reads every witness program a script can hold: %s', (address, family, bytes) => {
    expect(addressFamily(address)).toBe(family);
    expect(addressToScriptHex(address)).toHaveLength(2 * (2 + bytes));
  });

  it.each([
    ['padding past the last byte', 'bc1qwjqcaxagkhpvlh8f7cp3q8f2xaz9zhntptysaqp'],
    ['more than 4 bits of padding', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v07qwwzcrf'],
    ['padding that is not zero', 'tb1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vpggkg4j'],
    ['a one byte program', 'bc1pw5dgrnzv'],
    ['a 41 byte program', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7v8n0nx0muaewav253zgeav'],
    ['a v0 program of neither allowed length', 'BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P'],
    ['a witness version past 16', 'BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R'],
    ['a v1 address under the bech32 checksum', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd'],
    ['a v0 address under the bech32m checksum', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh'],
    ['no data at all', 'bc1gmk9yu'],
  ])('refuses %s, whose checksum may pass', (_name, address) => {
    expect(addressFamily(address)).toBeNull();
    expect(addressToScriptHex(address)).toBeNull();
    expect(addressFitsNetwork(address, 'bitcoin')).toBe(false);
    expect(addressFitsNetwork(address, 'testnet')).toBe(false);
  });
});

describe('addressFitsNetwork', () => {
  const main = scriptToAddress(P2WPKH, 'bitcoin')!;
  const test = scriptToAddress(P2WPKH, 'testnet')!;
  const reg = scriptToAddress(P2WPKH, 'regtest')!;
  const testBase58 = scriptToAddress(P2PKH, 'testnet')!;

  it('a testnet address never pays from a mainnet vault, nor the reverse', () => {
    expect(addressFitsNetwork(main, 'bitcoin')).toBe(true);
    expect(addressFitsNetwork(test, 'bitcoin')).toBe(false);
    expect(addressFitsNetwork(main, 'testnet')).toBe(false);
    expect(addressFitsNetwork(main, 'signet')).toBe(false);
  });

  it('testnet and signet share tb1; regtest takes bcrt1 and the test base58', () => {
    expect(addressFitsNetwork(test, 'signet')).toBe(true);
    expect(addressFitsNetwork(test, 'regtest')).toBe(false);
    expect(addressFitsNetwork(reg, 'regtest')).toBe(true);
    expect(addressFitsNetwork(reg, 'testnet')).toBe(false);
    expect(addressFitsNetwork(testBase58, 'regtest')).toBe(true);
  });
});

describe('the build request checks it', () => {
  const test = scriptToAddress(P2WPKH, 'testnet')!;
  it('looksLikeAddress takes the network', () => {
    expect(looksLikeAddress(test)).toBe(true);
    expect(looksLikeAddress(test, 'bitcoin')).toBe(false);
    expect(looksLikeAddress(test, 'testnet')).toBe(true);
  });

  it('validateBuildRequest names the wrong network', () => {
    const issues = validateBuildRequest(
      { recipients: [{ address: test, amountSats: 10_000 }], feeRate: 2 },
      'bitcoin',
    );
    expect(issues.map((i) => i.message)).toContain(
      'This is a test network address. This vault is on the main Bitcoin network.',
    );
  });
});
