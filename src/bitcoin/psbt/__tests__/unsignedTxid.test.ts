/**
 * Found 2026-07-29, after a first mainnet spend: the pending list showed ONE
 * payment as TWO rows — "Waiting for 21st Capital…" and "Signed 1/2 — needs
 * your next key" — same amount, same destination. Merging them was asked for:
 * "they are both the same PSBT."
 *
 * They are the same SPEND, but never the same BYTES: a PSBT grows every time a
 * signature is added, and the blind co-sign request is a deliberately stripped
 * copy. So the merge key has to be something that does not move.
 *
 * The unsigned transaction is that thing. Its inputs and outputs are fixed the
 * moment the spend is built; signatures live outside it. This test pins that
 * across every form one spend takes in our ceremony — because if it ever
 * stopped holding, the pending list would quietly go back to showing duplicates.
 */
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { unsignedTxid } from '../parse';
import { buildCosignRequest } from '../cosignRequest';
import { decodeBase64, encodeBase64 } from '../export';

const NET = btc.TEST_NETWORK;
const DEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const keyFor = (label: string) => HDKey.fromMasterSeed(sha256(utf8ToBytes(label)));
const PATH = "m/48'/1'/0'/2'/0/0";

const cc1 = keyFor('coldcard-1');
const cc2 = keyFor('coldcard-2');
const c21 = keyFor('21c-cosigner');

/** That spend's shape: 2-of-3 with the 21C co-signer, one timelocked recovery leaf. */
function buildVaultPsbt() {
  const xonly = [cc1, cc2, c21].map((k) => k.derive(PATH).publicKey!.slice(1));
  const primary = btc.p2tr_ms(2, xonly);
  const rescueX = keyFor('heir').derive(PATH).publicKey!.slice(1);
  const rescueScript = btc.Script.encode([
    btc.ScriptNum().encode(3n),
    'CHECKSEQUENCEVERIFY',
    'DROP',
    rescueX,
    'CHECKSIG',
  ]);
  const vault = btc.p2tr(
    undefined as unknown as string,
    [primary, { script: rescueScript }] as unknown as Parameters<typeof btc.p2tr>[1],
    NET,
    true,
  );
  const tx = new btc.Transaction({ allowUnknownOutputs: true });
  // The blind stripper finds our key by its TAP_BIP32_DERIVATION, so the
  // fixture has to carry them or buildCosignRequest has nothing to strip down
  // to.
  const leafHash = vault.leaves!.find((l) =>
    l.script.includes(primary.script[0]),
  )!.hash;
  const toPathIdx = (p: string) =>
    p.replace(/^m\//, '').split('/').map((x) =>
      x.endsWith("'") ? 0x80000000 + parseInt(x, 10) : parseInt(x, 10),
    );
  tx.addInput({
    txid: '33'.repeat(32),
    index: 0,
    witnessUtxo: { script: vault.script, amount: 101_000n },
    tapInternalKey: vault.tapInternalKey,
    tapMerkleRoot: vault.tapMerkleRoot,
    tapLeafScript: vault.tapLeafScript,
    tapBip32Derivation: [cc1, cc2, c21].map((k) => [
      k.derive(PATH).publicKey!.slice(1),
      { hashes: [leafHash], der: { fingerprint: k.fingerprint, path: toPathIdx(PATH) } },
    ]) as never,
  });
  tx.addOutputAddress(DEST, 100_000n, NET);
  return encodeBase64(tx.toPSBT(0));
}

function signWith(b64: string, key: HDKey): string {
  const tx = btc.Transaction.fromPSBT(decodeBase64(b64)!, {
    allowUnknownOutputs: true,
  });
  tx.signIdx(key.derive(PATH).privateKey!, 0);
  return encodeBase64(tx.toPSBT(0));
}

describe('unsignedTxid', () => {
  it('does not change as the spend collects signatures', () => {
    const unsigned = buildVaultPsbt();
    const oneSig = signWith(unsigned, cc1);
    const twoSigs = signWith(oneSig, c21);

    // The bytes really are different at each stage — otherwise this proves
    // nothing.
    expect(oneSig).not.toBe(unsigned);
    expect(twoSigs).not.toBe(oneSig);

    const id = unsignedTxid(unsigned);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(unsignedTxid(oneSig)).toBe(id);
    expect(unsignedTxid(twoSigs)).toBe(id);
  });

  it('survives the strip we send to 21st Capital', () => {
    // The blind request is a deliberately reduced copy — client keys, the
    // rescue leaf and the change derivations are all removed. If the strip
    // touched the unsigned transaction, the returned co-signature could never
    // be matched back to the client's parked copy.
    const unsigned = buildVaultPsbt();
    const signed = signWith(unsigned, cc1);
    const fp = c21.fingerprint.toString(16).padStart(8, '0');
    const request = buildCosignRequest(signed, fp);
    expect(unsignedTxid(request.psbtBase64)).toBe(unsignedTxid(unsigned));
  });

  it('gives DIFFERENT ids to different spends', () => {
    // The guard against over-merging: two genuinely separate payments must
    // never collapse into one row.
    const a = buildVaultPsbt();
    const other = new btc.Transaction({ allowUnknownOutputs: true });
    const xonly = [cc1, cc2, c21].map((k) => k.derive(PATH).publicKey!.slice(1));
    const vault = btc.p2tr(
      undefined as unknown as string,
      [btc.p2tr_ms(2, xonly)] as unknown as Parameters<typeof btc.p2tr>[1],
      NET,
      true,
    );
    other.addInput({
      txid: '44'.repeat(32), // a different coin
      index: 0,
      witnessUtxo: { script: vault.script, amount: 101_000n },
      tapInternalKey: vault.tapInternalKey,
      tapMerkleRoot: vault.tapMerkleRoot,
      tapLeafScript: vault.tapLeafScript,
    });
    other.addOutputAddress(DEST, 100_000n, NET);
    expect(unsignedTxid(encodeBase64(other.toPSBT(0)))).not.toBe(unsignedTxid(a));
  });

  it('returns null rather than throwing on junk', () => {
    // It runs on whatever is in storage, including records written by older
    // builds — it must never be the thing that crashes the pending list.
    expect(unsignedTxid('')).toBeNull();
    expect(unsignedTxid('not base64 at all !!!')).toBeNull();
    expect(unsignedTxid(encodeBase64(new Uint8Array([1, 2, 3])))).toBeNull();
  });
});
