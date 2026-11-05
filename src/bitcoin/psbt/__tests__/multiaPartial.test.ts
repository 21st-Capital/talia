/**
 * Found in a phone test (2026-07-28): "2-of-3 with a co-signer — I performed two signatures without
 * the co-signer key and the app STILL wants the co-signer to sign."
 *
 * A `multi_a(2, A, B, C)` tapscript is satisfied by ANY two of the three, and
 * its witness carries one stack item per key IN ORDER: a signature for the
 * keys that signed, an EMPTY item for the ones that did not. If a finalizer
 * can't emit those empty items it will insist on a signature that the policy
 * never required — exactly the symptom.
 *
 * This pins the behaviour of both finalize routes for the partially-signed
 * case, so the fix can't regress.
 */
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { schnorr } from '@noble/curves/secp256k1';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { scureFinalizePsbt } from '../finalize';
import { psbtSignatureStatus } from '../parse';
import { encodeBase64 } from '../export';

const NET = btc.TEST_NETWORK;
const DEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

const keyFor = (label: string) => HDKey.fromMasterSeed(sha256(utf8ToBytes(label)));
const PATH = "m/48'/1'/0'/2'/0/0";

const cc1 = keyFor('coldcard-1');
const cc2 = keyFor('coldcard-2');
const c21 = keyFor('21c-cosigner');

/** The vault it was found on: tr(NUMS,{multi_a(2,CC1,CC2,21C), and_v(v:pk(rescue),older(N))}) */
function buildVaultPsbt(): { psbt: Uint8Array; xonly: Uint8Array[] } {
  const xonly = [cc1, cc2, c21].map((k) => k.derive(PATH).publicKey!.slice(1));
  const primary = btc.p2tr_ms(2, xonly);
  const rescueX = schnorr.getPublicKey(sha256(utf8ToBytes('rescue')));
  const rescueScript = btc.Script.encode([
    btc.ScriptNum().encode(65535n),
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
  tx.addInput({
    txid: '33'.repeat(32),
    index: 0,
    witnessUtxo: { script: vault.script, amount: 101_000n },
    tapInternalKey: vault.tapInternalKey,
    tapMerkleRoot: vault.tapMerkleRoot,
    tapLeafScript: vault.tapLeafScript,
  });
  tx.addOutputAddress(DEST, 100_000n, NET);
  return { psbt: tx.toPSBT(0), xonly };
}

test('a 2-of-3 multi_a signed by TWO of the three finalizes — the third is not needed', () => {
  const { psbt } = buildVaultPsbt();

  // CC1 and CC2 sign; 21st Capital never touches it.
  const tx = btc.Transaction.fromPSBT(psbt, { allowUnknownOutputs: true });
  tx.signIdx(cc1.derive(PATH).privateKey!, 0);
  tx.signIdx(cc2.derive(PATH).privateKey!, 0);
  const signedB64 = encodeBase64(tx.toPSBT(0));

  // Two signatures are present…
  expect(psbtSignatureStatus(signedB64).signatureCount).toBe(2);

  // …and that is enough: the witness pads the unsigned key with an empty item.
  const finalized = scureFinalizePsbt(signedB64);
  expect(finalized).not.toBeNull();
  expect(
    require('../parse').psbtInputsFinalized(finalized as string),
  ).toBe(true);
});
