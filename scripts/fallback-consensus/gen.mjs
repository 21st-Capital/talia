// Vectors for the @scure fallback's witness check (leaf hazard, decided 2026-10-17):
// signed copies of tapleaf, P2SH and P2WSH spends that the fallback finalizes,
// each with the finished transaction and the coin it spends, so the network's
// own rules (libbitcoinconsensus, `check.rs` beside this file) can say whether
// it would be accepted. `psbt/__tests__/fallbackConsensus.test.ts` then holds
// `fallbackWitnessProblems` to those verdicts: it must pass every transaction
// the network accepts and refuse every one it refuses.
//
//   node scripts/fallback-consensus/gen.mjs > src/bitcoin/psbt/__fixtures__/fallbackConsensus.json
//   cargo run --offline --manifest-path scripts/fallback-consensus/Cargo.toml -- \
//     src/bitcoin/psbt/__fixtures__/fallbackConsensus.json
//
// Test keys only: k0, k1, k2 (seed sha256("talia-golden-k<i>"),
// m/48'/1'/0'/2'/0/0). Signatures use a fixed aux_rand, so the file is reproducible.
import * as btc from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';

const NET = btc.TEST_NETWORK;
const hex = (b) => Buffer.from(b).toString('hex');
const key = (l) => HDKey.fromMasterSeed(sha256(utf8ToBytes(`talia-golden-${l}`))).derive("m/48'/1'/0'/2'/0/0");
const K = { A: key('k0'), B: key('k1'), C: key('k2') };
const x = (k) => K[k].publicKey.slice(1);
const AUX = new Uint8Array(32);
const DEST = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

const LEAVES = {
  // and_v(v:multi_a(2,A,B,C),older(144)): the reviewer's probe
  'and_v(v:multi_a(2,A,B,C),older(144))': [x('A'), 'CHECKSIG', x('B'), 'CHECKSIGADD', x('C'), 'CHECKSIGADD', 2, 'NUMEQUALVERIFY', 144, 'CHECKSEQUENCEVERIFY'],
  // or_d(pk(A),and_v(v:pk(B),older(144)))
  'or_d(pk(A),and_v(v:pk(B),older(144)))': [x('A'), 'CHECKSIG', 'IFDUP', 'NOTIF', x('B'), 'CHECKSIGVERIFY', 144, 'CHECKSEQUENCEVERIFY', 'ENDIF'],
  // and_v(v:pk(A),older(144)): Liana's recovery leaf
  'and_v(v:pk(A),older(144))': [x('A'), 'CHECKSIGVERIFY', 144, 'CHECKSEQUENCEVERIFY'],
  // and_v(v:pk(A),after(60000))
  'and_v(v:pk(A),after(60000))': [x('A'), 'CHECKSIGVERIFY', 60000, 'CHECKLOCKTIMEVERIFY'],
  // and_v(v:thresh(2,pk(A),s:pk(B),s:pk(C)),older(144))
  'and_v(v:thresh(2,pk(A),s:pk(B),s:pk(C)),older(144))': [x('A'), 'CHECKSIG', 'SWAP', x('B'), 'CHECKSIG', 'ADD', 'SWAP', x('C'), 'CHECKSIG', 'ADD', 2, 'EQUALVERIFY', 144, 'CHECKSEQUENCEVERIFY'],
  // multi_a(2,A,B,C): @scure's own template
  'multi_a(2,A,B,C)': [x('A'), 'CHECKSIG', x('B'), 'CHECKSIGADD', x('C'), 'CHECKSIGADD', 2, 'NUMEQUAL'],
};

const LOCKS = {
  everyday: { version: 1, lockTime: 70000, sequence: 0xfffffffd },
  recovery: { version: 2, lockTime: 70000, sequence: 144 },
  final: { version: 2, lockTime: 70000, sequence: 0xfffffffe },
};

const SIGNERS = [['A'], ['B'], ['A', 'B'], ['B', 'C'], ['A', 'B', 'C']];

function spend(name, payment, locks, signers, extra = {}) {
  const tx = new btc.Transaction({ version: locks.version, lockTime: locks.lockTime, allowUnknownOutputs: true, allowUnknownInputs: true });
  tx.addInput({
    txid: hex(sha256(utf8ToBytes(name))),
    index: 0,
    sequence: locks.sequence,
    witnessUtxo: { script: payment.script, amount: 100000n },
    ...extra,
  });
  tx.addOutputAddress(DEST, 99000n, NET);
  let signed = 0;
  for (const s of signers) {
    try {
      if (tx.signIdx(K[s].privateKey, 0, undefined, AUX)) signed++;
    } catch {
      // a key this script does not hold
    }
  }
  if (signed === 0) return null;
  const before = Buffer.from(tx.toPSBT(0)).toString('base64');
  let finalTx = null;
  let scure = 'finalized';
  try {
    const t = btc.Transaction.fromPSBT(tx.toPSBT(0), { allowUnknownOutputs: true, allowUnknownInputs: true, allowLegacyWitnessUtxo: true });
    t.finalize();
    finalTx = hex(t.extract());
  } catch (e) {
    scure = `refused: ${e.message}`;
  }
  return { name, before, finalTx, scure, prevouts: [{ script: hex(payment.script), amount: 100000 }] };
}

const vectors = [];
for (const [leafName, ops] of Object.entries(LEAVES)) {
  const p = btc.p2tr(btc.TAPROOT_UNSPENDABLE_KEY, { script: btc.Script.encode(ops) }, NET, true);
  for (const [lockName, locks] of Object.entries(LOCKS)) {
    for (const signers of SIGNERS) {
      const name = `tr ${leafName} / ${lockName} / signed by ${signers.join('+')}`;
      const v = spend(name, p, locks, signers, { tapInternalKey: p.tapInternalKey, tapLeafScript: p.tapLeafScript });
      if (v) vectors.push(v);
    }
  }
}
// P2SH-P2WPKH, P2SH-P2WSH multisig and legacy P2SH multisig: the fallback's own templates.
{
  const p = btc.p2sh(btc.p2wpkh(K.A.publicKey, NET), NET);
  vectors.push(spend('sh(wpkh(A)) / signed by A', p, LOCKS.everyday, ['A'], { redeemScript: p.redeemScript }));
}
{
  const ms = btc.p2ms(2, [K.A.publicKey, K.B.publicKey]);
  const p = btc.p2sh(btc.p2wsh(ms, NET), NET);
  vectors.push(spend('sh(wsh(multi(2,A,B))) / signed by A+B', p, LOCKS.everyday, ['A', 'B'], { redeemScript: p.redeemScript, witnessScript: p.witnessScript }));
}
{
  const p = btc.p2wsh(btc.p2ms(2, [K.A.publicKey, K.B.publicKey]), NET);
  vectors.push(spend('wsh(multi(2,A,B)) / signed by A+B', p, LOCKS.everyday, ['A', 'B'], { witnessScript: p.witnessScript }));
}
console.log(JSON.stringify({
  about: 'The leaf hazard (decided 2026-10-17): the @scure fallback\'s witnesses against the network\'s rules. Made by scripts/fallback-consensus/gen.mjs; `consensus` written by scripts/fallback-consensus (libbitcoinconsensus, bitcoinconsensus 0.106.0+26.0, VERIFY_ALL_PRE_TAPROOT | VERIFY_TAPROOT). Test keys only.',
  vectors,
}, null, 1));
