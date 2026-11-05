/**
 * Which network an address belongs to (decided 2026-09-26). bdk-rn
 * 0.30, the engine's bridge until the old engine's removal
 * (decided 2026-11-04), built an address with no network check, so a testnet
 * `tb1…` pasted into a mainnet vault paid the same witness program ON
 * MAINNET, where the recipient's software never looks: the coins would be
 * stranded, and the output, re-encoded, reads `bc1…`, a different
 * string from the one the client typed.
 *
 * Pure decoding with the audited @scure codecs (encoding, not cryptography).
 * The checksum is verified, so a typo is "unreadable", never a guess.
 */
import { sha256 } from '@noble/hashes/sha256';
import { bech32, bech32m, createBase58check } from '@scure/base';
import type { Network } from './descriptor/types';

const base58check = createBase58check(sha256);

/** The address's own network family, or null when it cannot be read. */
export type AddressFamily = 'bitcoin' | 'test' | 'regtest';

/**
 * A segwit address's version and program, or null when one cannot be read: a
 * checksum of the wrong kind for its version (v0 bech32, v1+ bech32m, BIP-350),
 * a version past 16, stray padding, or a program of a length no script can
 * hold (BIP-141: 2 to 40 bytes, and v0 exactly 20 or 32). A checksum alone
 * does not make an address (decided 2026-10-31): a string can pass it and still
 * be something the build refuses.
 */
function readWitness(lower: string): { prefix: string; version: number; program: Uint8Array } | null {
  for (const codec of [bech32, bech32m]) {
    try {
      const dec = codec.decode(lower as `${string}1${string}`, 90);
      const version = dec.words[0];
      if ((version === 0) !== (codec === bech32)) continue;
      const program = codec.fromWords(dec.words.slice(1));
      if (version > 16 || program.length < 2 || program.length > 40) return null;
      if (version === 0 && program.length !== 20 && program.length !== 32) return null;
      return { prefix: dec.prefix, version, program };
    } catch {
      // try the other codec
    }
  }
  return null;
}

export function addressFamily(address: string): AddressFamily | null {
  const a = address.trim();
  const hrp = /^(bc|tb|bcrt)1/i.exec(a)?.[1]?.toLowerCase();
  if (hrp) {
    if (readWitness(a.toLowerCase())?.prefix !== hrp) return null;
    return hrp === 'bc' ? 'bitcoin' : hrp === 'tb' ? 'test' : 'regtest';
  }
  try {
    const raw = base58check.decode(a);
    if (raw.length !== 21) return null;
    if (raw[0] === 0x00 || raw[0] === 0x05) return 'bitcoin';
    if (raw[0] === 0x6f || raw[0] === 0xc4) return 'test';
    return null;
  } catch {
    return null;
  }
}

/**
 * True when the address can be paid from a vault on `network`. Testnet,
 * signet and regtest share base58 versions; bech32 splits regtest (`bcrt`)
 * from testnet and signet (`tb`).
 */
export function addressFitsNetwork(address: string, network: Network): boolean {
  const fam = addressFamily(address);
  if (fam == null) return false;
  if (network === 'bitcoin') return fam === 'bitcoin';
  if (fam === 'bitcoin') return false;
  if (fam === 'regtest') return network === 'regtest';
  // 'test': tb1… is testnet/signet only; base58 test versions also serve regtest.
  const bech = /^tb1/i.test(address.trim());
  return bech ? network !== 'regtest' : true;
}

/** The sentence a wrong-network address gets, true for every direction. */
export function wrongNetworkMessage(network: Network): string {
  return network === 'bitcoin'
    ? 'This is a test network address. This vault is on the main Bitcoin network.'
    : 'This address is not for the test network this vault uses.';
}

const hexOf = (b: ArrayLike<number>): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * The scriptPubKey (hex) an address pays, or null when it cannot be read.
 * Used to compare a returned transaction's outputs with the address the
 * client typed, script to script (one script has an address per network).
 */
export function addressToScriptHex(address: string): string | null {
  const a = address.trim();
  if (/^(bc|tb|bcrt)1/i.test(a)) {
    if (addressFamily(a) == null) return null;
    const witness = readWitness(a.toLowerCase());
    if (!witness) return null;
    const { version, program } = witness;
    return hexOf([version === 0 ? 0x00 : 0x50 + version, program.length, ...program]);
  }
  try {
    const raw = base58check.decode(a);
    if (raw.length !== 21) return null;
    const h = raw.slice(1);
    if (raw[0] === 0x00 || raw[0] === 0x6f) return hexOf([0x76, 0xa9, 0x14, ...h, 0x88, 0xac]);
    if (raw[0] === 0x05 || raw[0] === 0xc4) return hexOf([0xa9, 0x14, ...h, 0x87]);
    return null;
  } catch {
    return null;
  }
}
