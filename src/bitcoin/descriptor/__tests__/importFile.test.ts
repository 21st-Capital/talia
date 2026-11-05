import { extractImportPayload, unsupportedWalletFileReason } from '../importFile';
import { validateForImport } from '../validate';

/**
 * An extended key's bytes after its 4-byte version prefix: depth,
 * fingerprint, child number, chain code and public key. Two keys that
 * differ only in how they are labelled (xpub, zpub) give the same bytes.
 */
function keyBytes(key: string): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(0);
  for (const c of key) n = n * BigInt(58) + BigInt(alphabet.indexOf(c));
  // 78 key bytes + 4 checksum bytes = 164 hex digits; drop version and checksum.
  return n.toString(16).padStart(164, '0').slice(8, 156);
}

/**
 * BIP-84's published test vector: the account key m/84'/0'/0' of the
 * mnemonic "abandon abandon ... about" (master fingerprint 73c5da0a), laid
 * out as a Bitcoin Core descriptor export would show it. Public material.
 */
const CORE_XPUB =
  'xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XyuvPEbvqAQY3rAPshWcMLoP2fMFMKHPJ4ZeZXYVUhLv1VMrjPC7PW6V';
const CORE_ORIGIN = `[73c5da0a/84h/0h/0h]${CORE_XPUB}`;

/** The same BIP-84 test vector account key as BIP-84 prints it, a zpub, as an Electrum file holds it. */
const ELECTRUM_ZPUB =
  'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';

const BITCOIN_CORE_FILE = `# Receive and change descriptor:
wpkh(${CORE_ORIGIN}/<0;1>/*)#qf45pmyh


# Receive descriptor:
wpkh(${CORE_ORIGIN}/0/*)#afwvtk2s

# Change descriptor:
wpkh(${CORE_ORIGIN}/1/*)#vatdkr6g
`;

// Structure mirrors a real Electrum file; the xprv is a placeholder string —
// never commit real private keys, even test ones.
const ELECTRUM_FILE = JSON.stringify({
  keystore: {
    xpub: ELECTRUM_ZPUB,
    xprv: 'zprvFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE',
    type: 'bip32',
    pw_hash_version: 1,
  },
  wallet_type: 'standard',
  use_encryption: false,
  seed_type: 'bip39',
});

describe('extractImportPayload — Bitcoin Core text export', () => {
  it('skips comments and prefers the multipath descriptor', () => {
    const { descriptor } = extractImportPayload(BITCOIN_CORE_FILE);
    expect(descriptor).toBe(`wpkh(${CORE_ORIGIN}/<0;1>/*)#qf45pmyh`);
  });

  it('combines a receive/change pair into multipath when no multipath line exists', () => {
    const pairOnly = `wpkh(${CORE_ORIGIN}/0/*)#afwvtk2s\nwpkh(${CORE_ORIGIN}/1/*)#vatdkr6g\n`;
    const { descriptor } = extractImportPayload(pairOnly);
    expect(descriptor).toBe(`wpkh(${CORE_ORIGIN}/<0;1>/*)`);
  });

  it('end-to-end validates as mainnet single-sig from Sparrow-family origin', () => {
    const { descriptor } = extractImportPayload(BITCOIN_CORE_FILE);
    const r = validateForImport(descriptor);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.network).toBe('bitcoin');
      expect(r.parsed.kind).toBe('single-sig');
    }
  });
});

describe('extractImportPayload — Electrum JSON', () => {
  it('reads the file as the whole wallet with the same public key, never the xprv, and warns about the file', () => {
    // Since the Sparrow/Electrum reader (2026-09-09) an Electrum
    // file comes back as a full descriptor, the key written as an xpub.
    const { descriptor, warnings } = extractImportPayload(ELECTRUM_FILE);
    const m = /^wpkh\((xpub[1-9A-HJ-NP-Za-km-z]+)\/<0;1>\/\*\)$/.exec(descriptor);
    expect(m).not.toBeNull();
    // The very key the file's zpub carries, only labelled differently.
    expect(keyBytes(m![1])).toEqual(keyBytes(ELECTRUM_ZPUB));
    expect(descriptor).not.toContain('prv');
    expect(warnings.join(' ')).toMatch(/PRIVATE key material/);
  });

  it('end-to-end validates via bare-key normalization (zpub → wpkh)', () => {
    const { descriptor } = extractImportPayload(ELECTRUM_FILE);
    const r = validateForImport(descriptor);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.parsed.kind).toBe('single-sig');
      expect(r.parsed.scriptType).toBe('wpkh');
    }
  });
});

describe('extractImportPayload — edge cases', () => {
  it('passes plain descriptors through unchanged', () => {
    const plain = `wpkh(${CORE_ORIGIN}/<0;1>/*)#qf45pmyh`;
    expect(extractImportPayload(plain).descriptor).toBe(plain);
  });

  it('warns when several unrelated descriptors are present', () => {
    const two = `wpkh(${CORE_ORIGIN}/0/*)\ntr(${CORE_XPUB}/0/*)\n`;
    const { warnings } = extractImportPayload(two);
    expect(warnings.join(' ')).toMatch(/2 different descriptors/);
  });

  it('throws a clear error on junk and on empty input', () => {
    expect(() => extractImportPayload('just some notes')).toThrow(/No descriptor/);
    expect(() => extractImportPayload('   ')).toThrow(/empty/i);
  });

  it('refuses an Electrum multisig file that is missing keys', () => {
    // Electrum multisig files are read as whole wallets since 2026-09-09
    // (electrumWallet.test.ts covers complete ones). A "2of2" file that
    // carries a single key must be refused, never half-imported.
    const oneOfTwo = JSON.stringify({
      'x1/': { xpub: 'Zpub' + ELECTRUM_ZPUB.slice(4) },
      wallet_type: '2of2',
    });
    expect(() => extractImportPayload(oneOfTwo)).toThrow(/does not carry that many/i);
  });
});

describe('unsupportedWalletFileReason', () => {
  it('rejects wallet databases with guidance', () => {
    expect(unsupportedWalletFileReason('test-sparrow.mv.db')).toMatch(/Output Descriptor/);
    expect(unsupportedWalletFileReason('wallet.dat')).toMatch(/internal database/);
  });
  it('allows text/JSON exports', () => {
    expect(unsupportedWalletFileReason('descriptor.txt')).toBeNull();
    expect(unsupportedWalletFileReason('electrum-export.json')).toBeNull();
  });
});
