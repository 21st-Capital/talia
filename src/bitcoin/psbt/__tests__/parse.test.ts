import { psbtSignatureStatus, parsePsbt, psbtLockTime, scriptToAddress, psbtInputsFinalized } from '../parse';

// --- tiny byte builders ----------------------------------------------------

const u32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const toBase64 = (bytes: number[]): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
};
const u64 = (n: number): number[] => [...u32(n % 0x100000000), ...u32(Math.floor(n / 0x100000000))];
const varint = (n: number): number[] => (n < 0xfd ? [n] : [0xfd, n & 0xff, n >> 8]);
const hex = (s: string): number[] => (s.match(/../g) ?? []).map((b) => parseInt(b, 16));

/** The BIP-173 example witness program → bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4 */
const P2WPKH_SCRIPT = hex('0014751e76e8199196d454941c45d1b3a323f1433bd6');
const KNOWN_P2WPKH_ADDR = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

const IN_SATS = 1_050_000;
const OUT1_SATS = 1_000_000;
const OUT2_SATS = 30_000;

function buildUnsignedTx(lockTime = 0, sequence = 0xfffffffd): number[] {
  return [
    ...u32(2), // version
    ...varint(1),
    ...new Array(32).fill(0), // prev txid
    ...u32(0), // vout
    ...varint(0), // empty scriptSig
    ...u32(sequence), // sequence
    ...varint(2),
    ...u64(OUT1_SATS),
    ...varint(P2WPKH_SCRIPT.length),
    ...P2WPKH_SCRIPT,
    ...u64(OUT2_SATS),
    ...varint(P2WPKH_SCRIPT.length),
    ...P2WPKH_SCRIPT,
    ...u32(lockTime), // locktime
  ];
}

export function buildTestPsbtBase64(lockTime = 0, sequence = 0xfffffffd): string {
  const tx = buildUnsignedTx(lockTime, sequence);
  const pubkey = [0x02, ...new Array(32).fill(0x11)];
  const fpAndPath = [...hex('aabbccdd'), ...u32(0)];
  const bytes = [
    ...hex('70736274ff'), // magic
    // global map: unsigned tx
    ...varint(1), 0x00, ...varint(tx.length), ...tx,
    0x00, // end global
    // input 0 map: witness_utxo + bip32 derivation
    ...varint(1), 0x01,
    ...varint(8 + 1 + P2WPKH_SCRIPT.length),
    ...u64(IN_SATS), ...varint(P2WPKH_SCRIPT.length), ...P2WPKH_SCRIPT,
    ...varint(1 + pubkey.length), 0x06, ...pubkey,
    ...varint(fpAndPath.length), ...fpAndPath,
    0x00, // end input 0
    0x00, // output 0 map (empty)
    // output 1 map: bip32 derivation → change
    ...varint(1 + pubkey.length), 0x02, ...pubkey,
    ...varint(fpAndPath.length), ...fpAndPath,
    0x00, // end output 1
  ];
  return toBase64(bytes);
}

describe('parsePsbt', () => {
  const base64 = buildTestPsbtBase64();

  it('reads structure, fingerprints, addresses, and fee', () => {
    const p = parsePsbt(base64);
    expect(p.numInputs).toBe(1);
    expect(p.numOutputs).toBe(2);
    expect(p.inputFingerprints).toEqual(['aabbccdd']);
    expect(p.outputs[0].address).toBe(KNOWN_P2WPKH_ADDR);
    expect(p.outputs[0].amountSats).toBe(OUT1_SATS);
    expect(p.outputs[0].hasDerivation).toBe(false);
    expect(p.outputs[1].hasDerivation).toBe(true);
    expect(p.totalInSats).toBe(IN_SATS);
    expect(p.feeSats).toBe(IN_SATS - OUT1_SATS - OUT2_SATS);
  });

  it('reads the lock time and the replacement signal a BitBox shows', () => {
    expect(psbtLockTime(buildTestPsbtBase64(921380))).toEqual({ lockTime: 921380, rbf: true });
    expect(psbtLockTime(buildTestPsbtBase64(0, 0xffffffff))).toEqual({ lockTime: 0, rbf: false });
    // 0xFFFFFFFE opts out of replacement (BIP-125), and only a lower one opts in.
    expect(psbtLockTime(buildTestPsbtBase64(5, 0xfffffffe))).toEqual({ lockTime: 5, rbf: false });
    expect(psbtLockTime('aGVsbG8=')).toBeNull();
  });

  it('rejects non-PSBT payloads', () => {
    expect(() => parsePsbt('aGVsbG8=')).toThrow('Not a valid PSBT');
    expect(() => parsePsbt('definitely not base64!!!')).toThrow('Not a valid PSBT');
  });
});

describe('scriptToAddress', () => {
  it('encodes the standard templates', () => {
    expect(scriptToAddress(Uint8Array.from(P2WPKH_SCRIPT))).toBe(KNOWN_P2WPKH_ADDR);
    const p2tr = Uint8Array.from(hex('5120' + '11'.repeat(32)));
    expect(scriptToAddress(p2tr)).toMatch(/^bc1p/);
    const p2wsh = Uint8Array.from(hex('0020' + '22'.repeat(32)));
    expect(scriptToAddress(p2wsh)).toMatch(/^bc1q/);
    const p2pkh = Uint8Array.from(hex('76a914' + '33'.repeat(20) + '88ac'));
    expect(scriptToAddress(p2pkh)).toMatch(/^1/);
    const p2sh = Uint8Array.from(hex('a914' + '44'.repeat(20) + '87'));
    expect(scriptToAddress(p2sh)).toMatch(/^3/);
  });

  it('returns null for non-standard scripts', () => {
    expect(scriptToAddress(Uint8Array.from(hex('6a04deadbeef')))).toBeNull(); // OP_RETURN
  });
});

describe('psbtInputsFinalized', () => {
  /** Same PSBT but input 0 carries a final scriptwitness (keytype 0x08). */
  function buildFinalizedPsbtBase64(): string {
    const tx = buildUnsignedTx();
    const witness = [0x02, 0x01, 0xaa, 0x01, 0xbb]; // 2 stack items, dummy
    const bytes = [
      ...hex('70736274ff'),
      ...varint(1), 0x00, ...varint(tx.length), ...tx,
      0x00,
      // input 0: final_scriptwitness only
      ...varint(1), 0x08, ...varint(witness.length), ...witness,
      0x00,
      0x00, // output 0 (empty)
      0x00, // output 1 (empty)
    ];
    return toBase64(bytes);
  }

  it('is false for an unsigned PSBT', () => {
    expect(psbtInputsFinalized(buildTestPsbtBase64())).toBe(false);
  });

  it('is true when every input has a final witness', () => {
    expect(psbtInputsFinalized(buildFinalizedPsbtBase64())).toBe(true);
  });

  it('is false for garbage', () => {
    expect(psbtInputsFinalized('not a psbt')).toBe(false);
    expect(psbtInputsFinalized('cHNidP8BAAA=')).toBe(false);
  });
});

describe('scriptToAddress network awareness', () => {
  it('encodes the SAME script per network (BIP-173 vectors)', () => {
    const script = Uint8Array.from(P2WPKH_SCRIPT);
    expect(scriptToAddress(script, 'bitcoin')).toBe(KNOWN_P2WPKH_ADDR);
    // Same witness program, testnet HRP — the checksum tail differs too.
    expect(scriptToAddress(script, 'testnet')).toBe(
      'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    );
    expect(scriptToAddress(script, 'signet')).toBe(
      'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
    );
    expect(scriptToAddress(script, 'regtest')!.startsWith('bcrt1q')).toBe(true);
  });

  it('parsePsbt threads the network into output addresses', () => {
    const p = parsePsbt(buildTestPsbtBase64(), 'testnet');
    expect(p.outputs[0].address!.startsWith('tb1q')).toBe(true);
  });
});

describe('psbtSignatureStatus', () => {
  const PK_A = [0x02, ...new Array(32).fill(0x11)];
  const PK_B = [0x03, ...new Array(32).fill(0x22)];
  const FP_A = hex('aaaa0001');
  const FP_B = hex('bbbb0002');
  const SIG = [0x30, 0x44, ...new Array(68).fill(0xcd)];

  /** 1-input 2-key PSBT; whoSigned lists which pubkeys carry partial sigs. */
  function build(whoSigned: number[][]): string {
    const tx = buildUnsignedTx();
    const input: number[] = [];
    for (const [pk, fp] of [
      [PK_A, FP_A],
      [PK_B, FP_B],
    ] as const) {
      input.push(...varint(1 + pk.length), 0x06, ...pk);
      input.push(...varint(fp.length + 4), ...fp, ...u32(0));
    }
    for (const pk of whoSigned) {
      input.push(...varint(1 + pk.length), 0x02, ...pk);
      input.push(...varint(SIG.length), ...SIG);
    }
    const bytes = [
      ...hex('70736274ff'),
      ...varint(1), 0x00, ...varint(tx.length), ...tx,
      0x00,
      ...input, 0x00,
      0x00, 0x00, // two empty output maps
    ];
    return toBase64(bytes);
  }

  it('reports nobody signed on a fresh PSBT', () => {
    const s = psbtSignatureStatus(build([]));
    expect(s.signatureCount).toBe(0);
    expect(s.signedFingerprints).toEqual([]);
    expect(s.pendingFingerprints.sort()).toEqual(['aaaa0001', 'bbbb0002']);
  });

  it('tracks one-of-two signatures', () => {
    const s = psbtSignatureStatus(build([PK_A]));
    expect(s.signatureCount).toBe(1);
    expect(s.signedFingerprints).toEqual(['aaaa0001']);
    expect(s.pendingFingerprints).toEqual(['bbbb0002']);
  });

  it('tracks both signatures', () => {
    const s = psbtSignatureStatus(build([PK_A, PK_B]));
    expect(s.signatureCount).toBe(2);
    expect(s.signedFingerprints.sort()).toEqual(['aaaa0001', 'bbbb0002']);
    expect(s.pendingFingerprints).toEqual([]);
  });
});
