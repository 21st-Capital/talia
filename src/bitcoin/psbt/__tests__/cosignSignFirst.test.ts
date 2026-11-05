/**
 * Reproduces the SIGN-FIRST co-sign pipeline end-to-end at the byte level
 * (the bug of 2026-07-24: "after he signs and we cosign, he cannot send").
 *
 * Flow under test — exactly what the app + the co-signing machine do:
 *   1. full vault PSBT (all leaves, all derivations, merkle root)
 *   2. CLIENT signs it (Coldcard stand-in)              → originalPsbt
 *   3. app strips it with buildCosignRequest            → blind request
 *   4. 21C signs the blind request (signing machine stand-in)  → serverSigned
 *   5. BIP-174 combine(originalPsbt, serverSigned)      → combined
 *   6. finalize
 *
 * Steps 5–6 run in BDK on-device; here we combine per BIP-174 (union of the
 * input maps, first-wins on duplicates — same as rust-bitcoin 0.29) and
 * finalize with @scure/btc-signer, an independent implementation. If scure
 * can finalize the combined bytes, the DATA is sufficient and any on-device
 * failure lives in BDK's finalizer; if scure can't, the data pipeline is
 * broken and the test shows exactly which hop lost what.
 */
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { schnorr } from '@noble/curves/secp256k1';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { buildCosignRequest } from '../cosignRequest';
import { scureFinalizePsbt } from '../finalize';
import { psbtSignatureStatus } from '../parse';
import { decodeBase64, encodeBase64 } from '../export';
import { Reader, readMap, parseTx } from '../parse';

const NET = btc.TEST_NETWORK;
const DEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

// 21C co-signer (same construction as the real co-signing machine's tests)
const seed21c = sha256(utf8ToBytes('21C-master-seed-test'));
const master21c = HDKey.fromMasterSeed(seed21c);
const COSIGN_PATH = "m/48'/1'/0'/2'/0/0";
const fp21c = master21c.fingerprint.toString(16).padStart(8, '0');

// Client key (Coldcard stand-in)
const seedClient = sha256(utf8ToBytes('client-master-seed-test'));
const masterClient = HDKey.fromMasterSeed(seedClient);
const CLIENT_PATH = "m/86'/1'/0'/0/0";
const fpClient = masterClient.fingerprint.toString(16).padStart(8, '0');

const toPathIdx = (p: string) =>
  p.replace('m/', '').split('/').map((s) =>
    s.endsWith("'") ? 0x80000000 + parseInt(s, 10) : parseInt(s, 10));

/** Full spend PSBT as BDK would build it: every leaf script, both
 *  derivations, merkle root — nothing stripped. */
function buildFullPsbt() {
  const cosignX = master21c.derive(COSIGN_PATH).publicKey!.slice(1);
  const clientX = masterClient.derive(CLIENT_PATH).publicKey!.slice(1);
  const rescueX = schnorr.getPublicKey(sha256(utf8ToBytes('rescue')));

  const primary = btc.p2tr_ms(2, [clientX, cosignX]);
  const rescueScript = btc.Script.encode([
    btc.ScriptNum().encode(65535n), 'CHECKSEQUENCEVERIFY', 'DROP', rescueX, 'CHECKSIG',
  ]);
  // runtime accepts an undefined internal key (BIP-341 NUMS); the TS overloads don't
  const vault = btc.p2tr(undefined as unknown as string, [primary, { script: rescueScript }] as unknown as Parameters<typeof btc.p2tr>[1], NET, true);

  const tx = new btc.Transaction({ allowUnknownOutputs: true });
  tx.addInput({
    txid: '22'.repeat(32),
    index: 0,
    witnessUtxo: { script: vault.script, amount: 101_000n },
    tapInternalKey: vault.tapInternalKey,
    tapMerkleRoot: vault.tapMerkleRoot,
    // full psbt: ALL leaves present (BDK includes every leaf it may satisfy)
    tapLeafScript: vault.tapLeafScript,
    tapBip32Derivation: [
      [clientX, {
        hashes: [vault.leaves!.find((l) => l.script.includes(primary.script[0]))!.hash],
        der: { fingerprint: masterClient.fingerprint, path: toPathIdx(CLIENT_PATH) },
      }],
      [cosignX, {
        hashes: [vault.leaves!.find((l) => l.script.includes(primary.script[0]))!.hash],
        der: { fingerprint: master21c.fingerprint, path: toPathIdx(COSIGN_PATH) },
      }],
    ],
  });
  tx.addOutputAddress(DEST, 100_000n, NET);
  return tx.toPSBT(0);
}

/** BIP-174 combine at the byte level, mirroring rust-bitcoin 0.29:
 *  union of entries per map, `self` (original) wins on duplicate keys. */
function combinePsbts(originalB64: string, otherB64: string): string {
  const parseAll = (b64: string) => {
    const bytes = decodeBase64(b64)!;
    const r = new Reader(bytes, 5);
    const global = readMap(r);
    const { ins, outs } = parseTx(new Reader(global.find((e) => e.keyType === 0x00)!.value));
    const inputs = ins.map(() => readMap(r));
    const outputs = outs.map(() => readMap(r));
    return { global, inputs, outputs };
  };
  const a = parseAll(originalB64);
  const b = parseAll(otherB64);
  const keyOf = (e: { keyType: number; keyData: Uint8Array }) =>
    e.keyType + ':' + Array.from(e.keyData, (x) => x.toString(16).padStart(2, '0')).join('');
  const union = (x: ReturnType<typeof readMap>, y: ReturnType<typeof readMap>) => {
    const seen = new Set(x.map(keyOf));
    return [...x, ...y.filter((e) => !seen.has(keyOf(e)))];
  };
  const writeVarint = (n: number) =>
    n < 0xfd ? Uint8Array.of(n) : Uint8Array.of(0xfd, n & 0xff, (n >> 8) & 0xff);
  const serMap = (entries: ReturnType<typeof readMap>) => {
    const parts: number[] = [];
    for (const e of entries) {
      const key = [e.keyType, ...e.keyData];
      parts.push(...writeVarint(key.length), ...key, ...writeVarint(e.value.length), ...e.value);
    }
    parts.push(0x00);
    return Uint8Array.from(parts);
  };
  const chunks = [
    Uint8Array.of(0x70, 0x73, 0x62, 0x74, 0xff),
    serMap(union(a.global, b.global)),
    ...a.inputs.map((m, i) => serMap(union(m, b.inputs[i] ?? []))),
    ...a.outputs.map((m, i) => serMap(union(m, b.outputs[i] ?? []))),
  ];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return encodeBase64(out);
}

test('sign-first co-sign: combine(client-signed original, blind server copy) finalizes', () => {
  // 1–2. full PSBT, client signs FIRST. scure refuses to sign with foreign
  // tapBip32Derivation entries present, so sign a copy stripped of them and
  // BIP-174-combine the signature back into the full PSBT — byte-for-byte
  // what a hardware signer handing back its signed copy produces.
  const fullPsbt = buildFullPsbt();
  const fullB64 = encodeBase64(fullPsbt);
  const clientTx = btc.Transaction.fromPSBT(fullPsbt, { allowUnknownOutputs: true });
  clientTx.updateInput(0, { tapBip32Derivation: [] });
  clientTx.signIdx(masterClient.derive(CLIENT_PATH).privateKey!, 0);
  const clientCopyB64 = encodeBase64(clientTx.toPSBT(0));
  const originalB64 = combinePsbts(fullB64, clientCopyB64);

  const origStatus = psbtSignatureStatus(originalB64);
  expect(origStatus.signatureCount).toBe(1);
  expect(origStatus.signedFingerprints.map((f) => f.toLowerCase())).toContain(fpClient);

  // 3. app builds the blind request FROM THE SIGNED psbt
  const request = buildCosignRequest(originalB64, fp21c);

  // 4. The signing machine stand-in signs the blind request (same scure calls as sign.mjs)
  const serverTx = btc.Transaction.fromPSBT(decodeBase64(request.psbtBase64)!, {
    allowUnknownOutputs: true,
  });
  serverTx.signIdx(master21c.derive(COSIGN_PATH).privateKey!, 0);
  const serverSignedB64 = encodeBase64(serverTx.toPSBT(0));

  // 5. combine as the app does on Send
  const combinedB64 = combinePsbts(originalB64, serverSignedB64);
  const combStatus = psbtSignatureStatus(combinedB64);
  expect(combStatus.signedFingerprints.map((f) => f.toLowerCase()).sort()).toEqual(
    [fpClient, fp21c].sort(),
  );

  // 6. finalize with an independent implementation
  const finalTx = btc.Transaction.fromPSBT(decodeBase64(combinedB64)!, {
    allowUnknownOutputs: true,
  });
  finalTx.finalize();
  expect(finalTx.extract().length).toBeGreaterThan(0);

  // 7. and through the engine's actual fallback entry point
  const finalizedB64 = scureFinalizePsbt(combinedB64);
  expect(finalizedB64).not.toBeNull();
  const { psbtInputsFinalized } = require('../parse') as typeof import('../parse');
  expect(psbtInputsFinalized(finalizedB64!)).toBe(true);
});

test('scureFinalizePsbt returns null (not garbage) when a signature is missing', () => {
  const fullPsbt = buildFullPsbt();
  const fullB64 = encodeBase64(fullPsbt);
  // Only 21C signs — one of two required signatures.
  const request = buildCosignRequest(fullB64, fp21c);
  const serverTx = btc.Transaction.fromPSBT(decodeBase64(request.psbtBase64)!, {
    allowUnknownOutputs: true,
  });
  serverTx.signIdx(master21c.derive(COSIGN_PATH).privateKey!, 0);
  const combined = combinePsbts(fullB64, encodeBase64(serverTx.toPSBT(0)));
  expect(scureFinalizePsbt(combined)).toBeNull();
});

test('the SERVER psbt alone is self-sufficient: it finalizes without the original', () => {
  // The blind request keeps WITNESS_UTXO + TAP_INTERNAL_KEY + our TAP_LEAF_SCRIPT
  // (script + control block) + every TAP_SCRIPT_SIG. For a taproot script-path
  // spend that is the COMPLETE witness recipe — no merkle root, no derivations.
  // So 21C's returned PSBT should finalize on its own, with no combine at all.
  const fullPsbt = buildFullPsbt();
  const fullB64 = encodeBase64(fullPsbt);
  const clientTx = btc.Transaction.fromPSBT(fullPsbt, { allowUnknownOutputs: true });
  clientTx.updateInput(0, { tapBip32Derivation: [] });
  clientTx.signIdx(masterClient.derive(CLIENT_PATH).privateKey!, 0);
  const originalB64 = combinePsbts(fullB64, encodeBase64(clientTx.toPSBT(0)));

  const request = buildCosignRequest(originalB64, fp21c);
  const serverTx = btc.Transaction.fromPSBT(decodeBase64(request.psbtBase64)!, {
    allowUnknownOutputs: true,
  });
  serverTx.signIdx(master21c.derive(COSIGN_PATH).privateKey!, 0);
  const serverSignedB64 = encodeBase64(serverTx.toPSBT(0));

  // finalize the server copy ALONE
  const finalized = scureFinalizePsbt(serverSignedB64);
  expect(finalized).not.toBeNull();

  // and the transaction it yields must be byte-identical to the one from the
  // full combined path — same txid, so nothing was substituted.
  const viaServer = btc.Transaction.fromPSBT(decodeBase64(finalized!)!, {
    allowUnknownOutputs: true,
  });
  const combined = combinePsbts(originalB64, serverSignedB64);
  const viaCombine = btc.Transaction.fromPSBT(decodeBase64(combined)!, {
    allowUnknownOutputs: true,
  });
  viaCombine.finalize();
  expect(viaServer.id).toBe(viaCombine.id);
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  expect(hex(viaServer.extract())).toBe(hex(viaCombine.extract()));
});

// Decided 2026-09-26 (and the engine's fallback trust
// check it sits in): a FINALIZED input keeps only its witness, so the
// signatures that built it must be read on the copies it came from.
test('the fallback finaliser names the copies it built from, and only they show the signers', () => {
  const { finalizeCosigned } = require('../finalize') as typeof import('../finalize');
  const { mergeSignerGroups } = require('../parse') as typeof import('../parse');
  const { pathSatisfiedOnEveryInput } = require('../../descriptor/policy') as typeof import('../../descriptor/policy');
  const fullPsbt = buildFullPsbt();
  const fullB64 = encodeBase64(fullPsbt);
  const clientTx = btc.Transaction.fromPSBT(fullPsbt, { allowUnknownOutputs: true });
  clientTx.updateInput(0, { tapBip32Derivation: [] });
  clientTx.signIdx(masterClient.derive(CLIENT_PATH).privateKey!, 0);
  const originalB64 = combinePsbts(fullB64, encodeBase64(clientTx.toPSBT(0)));
  const request = buildCosignRequest(originalB64, fp21c);
  const serverTx = btc.Transaction.fromPSBT(decodeBase64(request.psbtBase64)!, { allowUnknownOutputs: true });
  serverTx.signIdx(master21c.derive(COSIGN_PATH).privateKey!, 0);
  const serverSignedB64 = encodeBase64(serverTx.toPSBT(0));

  const routes = finalizeCosigned(originalB64, serverSignedB64);
  expect(routes.psbtBase64).not.toBeNull();
  expect(routes.sources.length).toBeGreaterThan(0);

  const primary = {
    groups: [{ threshold: 2, keys: [{ fingerprint: fpClient }, { fingerprint: fp21c }] }],
  } as unknown as import('../../descriptor/policy').PolicyPath;
  // The finalized copy carries no signature entries at all...
  expect(pathSatisfiedOnEveryInput(primary, psbtSignatureStatus(routes.psbtBase64!).signerGroups)).toBe(false);
  // ...the copies it was built from carry both, on the same leaf.
  const merged = mergeSignerGroups(...routes.sources.map((p) => psbtSignatureStatus(p).signerGroups));
  expect(pathSatisfiedOnEveryInput(primary, merged)).toBe(true);
});
