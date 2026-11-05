#!/usr/bin/env node
/**
 * Writes FULL_B64, the fixture of src/bitcoin/psbt/__tests__/cosignRequest.test.ts:
 * a full spend PSBT of a layered taproot vault
 *
 *   tr(NUMS, { multi_a(2, client, co-signer), <65535> CSV DROP <rescue> CHECKSIG })
 *
 * spending the PRIMARY path, as a wallet hands it over before the co-signing
 * request is cut from it: both leaf scripts with their control blocks, a
 * taproot derivation for each of the three keys, the internal key and the
 * merkle root, a change output carrying a derivation, and a GLOBAL_XPUB.
 *
 * Everything in it is made up: each key is the x-only public key of
 * sha256("talia cosign-request fixture: <role>"), the fingerprints are the
 * placeholders the test names, the spent coin is txid 33...33:0 and the
 * global xpub is filler bytes. The internal key is BIP-341's NUMS point H.
 *
 * Usage (from the repository root): node scripts/cosign-request-fixture.mjs
 * It prints the base64 PSBT and the test's RESCUE_LEAF_HEX. The output is
 * the same on every run.
 */
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base64 } from '@scure/base';

/** BIP-341's NUMS point H, x-only. */
const NUMS = hexToBytes('50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0');
const LEAF_VERSION = 0xc0;
/** The placeholder fingerprints the test names. */
export const FIXTURE_FINGERPRINTS = { client: 'c1c1c1c1', cosigner: 'c0c0c0c0', rescue: 'dededede' };
/** 48'/1'/0'/2'/0/0, little-endian u32s. */
const PATH = [0x80000030, 0x80000001, 0x80000000, 0x80000002, 0, 0];

const u32le = (n) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
const u64le = (n) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};
const compactSize = (n) => {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  throw new Error('too long');
};
const withLength = (b) => concatBytes(compactSize(b.length), b);
const keyValue = (key, value) => ({ key, bytes: concatBytes(withLength(key), withLength(value)) });
/** A PSBT map: its pairs in key order, then the separator. */
const map = (...pairs) =>
  concatBytes(
    ...pairs.sort((x, y) => (bytesToHex(x.key) < bytesToHex(y.key) ? -1 : 1)).map((p) => p.bytes),
    Uint8Array.of(0x00),
  );
const tagged = (tag, ...parts) => schnorr.utils.taggedHash(tag, ...parts);

const xonly = (role) => schnorr.getPublicKey(sha256(utf8ToBytes(`talia cosign-request fixture: ${role}`)));

/** The fixture PSBT for three x-only keys and their fingerprints. */
export function build({ client, cosigner, rescue }, FP = FIXTURE_FINGERPRINTS) {
  // The two leaves, as a wallet writes them.
  const multiLeaf = concatBytes(Uint8Array.of(0x20), client, Uint8Array.of(0xac, 0x20), cosigner, Uint8Array.of(0xba, 0x52, 0x9c));
  const rescueLeaf = concatBytes(hexToBytes('03ffff00b275'), Uint8Array.of(0x20), rescue, Uint8Array.of(0xac));
  const leafHash = (script) => tagged('TapLeaf', Uint8Array.of(LEAF_VERSION), withLength(script));
  const hMulti = leafHash(multiLeaf);
  const hRescue = leafHash(rescueLeaf);
  const [a, b] = [hMulti, hRescue].sort((x, y) => (bytesToHex(x) < bytesToHex(y) ? -1 : 1));
  const root = tagged('TapBranch', a, b);

  // The output key: H tweaked by the tree.
  const P = secp256k1.ProjectivePoint.fromHex(concatBytes(Uint8Array.of(0x02), NUMS));
  const t = tagged('TapTweak', NUMS, root);
  const Q = P.add(secp256k1.ProjectivePoint.BASE.multiply(BigInt(`0x${bytesToHex(t)}`)));
  const qBytes = Q.toRawBytes(true);
  const outputKey = qBytes.slice(1);
  const parity = qBytes[0] & 1;
  const spk = concatBytes(Uint8Array.of(0x51, 0x20), outputKey);
  const control = (sibling) => concatBytes(Uint8Array.of(LEAF_VERSION | parity), NUMS, sibling);

  // The unsigned transaction: one coin in, the payment and the change out.
  const payment = hexToBytes('0014751e76e8199196d454941c45d1b3a323f1433bd6'); // tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx (BIP-173)
  const tx = concatBytes(
    u32le(2),
    compactSize(1),
    new Uint8Array(32).fill(0x33),
    u32le(0),
    compactSize(0),
    u32le(0xffffffff),
    compactSize(2),
    u64le(250_000),
    withLength(payment),
    u64le(49_000),
    withLength(spk),
    u32le(0),
  );

  const derivation = (leaves, fp) =>
    concatBytes(compactSize(leaves.length), ...leaves, hexToBytes(fp), ...PATH.map(u32le));

  const global = map(
    keyValue(Uint8Array.of(0x00), tx),
    // GLOBAL_XPUB: filler bytes, never a real key.
    keyValue(concatBytes(Uint8Array.of(0x01), new Uint8Array(78).fill(0xab)), concatBytes(hexToBytes(FP.client), new Uint8Array(24))),
  );
  const input = map(
    keyValue(Uint8Array.of(0x01), concatBytes(u64le(300_000), withLength(spk))),
    keyValue(concatBytes(Uint8Array.of(0x15), control(hRescue)), concatBytes(multiLeaf, Uint8Array.of(LEAF_VERSION))),
    keyValue(concatBytes(Uint8Array.of(0x15), control(hMulti)), concatBytes(rescueLeaf, Uint8Array.of(LEAF_VERSION))),
    ...[
      [client, [hMulti], FP.client],
      [cosigner, [hMulti], FP.cosigner],
      [rescue, [hRescue], FP.rescue],
    ].map(([key, leaves, fp]) => keyValue(concatBytes(Uint8Array.of(0x16), key), derivation(leaves, fp))),
    keyValue(Uint8Array.of(0x17), NUMS),
    keyValue(Uint8Array.of(0x18), root),
  );
  const paymentOut = map();
  const changeOut = map(
    keyValue(Uint8Array.of(0x05), NUMS),
    keyValue(concatBytes(Uint8Array.of(0x07), cosigner), derivation([], FP.cosigner)),
  );
  const psbt = concatBytes(hexToBytes('70736274ff'), global, input, paymentOut, changeOut);
  return { psbt, rescueLeaf };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { psbt, rescueLeaf } = build({ client: xonly('client'), cosigner: xonly('co-signer'), rescue: xonly('rescue') });
  console.log(`FULL_B64 = ${base64.encode(psbt)}`);
  console.log(`RESCUE_LEAF_HEX = ${bytesToHex(rescueLeaf)}`);
}
