/**
 * The leaf hazard (decided 2026-10-17; the library fork calls it
 * D10): a spending path with `older(N)` or `after(N)` counts as satisfied
 * only when the transaction carries the lock. The working copies are the 0.28
 * recorded baseline's with the library fix (test keys only), so the library has
 * left each such input open and the fallback is what remains.
 */
import * as btc from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { carriesAfter, carriesOlder, fallbackWitnessProblems, scriptTimelocks, txLocksOf } from '../timelockCheck';
import type { TxLocks } from '../timelockCheck';
import { finalizeCosigned, scureFinalizePsbt } from '../finalize';
import { decodeBase64, encodeBase64 } from '../export';
import fx from '../../engine/__fixtures__/d10LeafHazard.json';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const tx = (version: number, sequences: number[], lockTime = 0): TxLocks => ({ version, sequences, lockTime });

describe('carriesOlder: what OP_CHECKSEQUENCEVERIFY checks', () => {
  it('carries a block wait when nSequence holds at least that many blocks and the version is 2', () => {
    expect(carriesOlder(tx(2, [144]), 0, 144)).toBe(true);
    expect(carriesOlder(tx(2, [65535]), 0, 144)).toBe(true);
    expect(carriesOlder(tx(2, [143]), 0, 144)).toBe(false);
  });

  it('the everyday spend carries no wait: nSequence 0xFFFFFFFD has the disable flag set, and its version is 1', () => {
    expect(carriesOlder(tx(1, [0xfffffffd]), 0, 144)).toBe(false);
    expect(carriesOlder(tx(2, [0xfffffffd]), 0, 144)).toBe(false);
    expect(carriesOlder(tx(2, [0xfffffffe]), 0, 144)).toBe(false);
    expect(carriesOlder(tx(1, [144]), 0, 144)).toBe(false);
  });

  it('never mixes blocks and time', () => {
    const time = 0x00400000 | 10;
    expect(carriesOlder(tx(2, [time]), 0, 10)).toBe(false);
    expect(carriesOlder(tx(2, [10]), 0, time)).toBe(false);
    expect(carriesOlder(tx(2, [0x00400000 | 12]), 0, time)).toBe(true);
  });
});

describe('carriesAfter: what OP_CHECKLOCKTIMEVERIFY checks', () => {
  it('needs nLockTime at least the height and a non-final nSequence', () => {
    expect(carriesAfter(tx(1, [0xfffffffd], 70000), 0, 1000)).toBe(true);
    expect(carriesAfter(tx(1, [0xfffffffd], 999), 0, 1000)).toBe(false);
    expect(carriesAfter(tx(1, [0xffffffff], 70000), 0, 1000)).toBe(false);
  });

  it('never mixes a height and a time', () => {
    expect(carriesAfter(tx(1, [0], 1_700_000_000), 0, 1000)).toBe(false);
    expect(carriesAfter(tx(1, [0], 70000), 0, 1_600_000_000)).toBe(false);
    expect(carriesAfter(tx(1, [0], 1_700_000_000), 0, 1_600_000_000)).toBe(true);
  });
});

describe('scriptTimelocks', () => {
  it('reads every lock and its value, small numbers and pushes alike', () => {
    // and_v(v:pk(K),older(144)): <K> CHECKSIGVERIFY <0x9000> CSV
    expect(scriptTimelocks(hex('20' + '11'.repeat(32) + 'ad029000b2'))).toEqual([{ kind: 'older', value: 144 }]);
    expect(scriptTimelocks(hex('60b2'))).toEqual([{ kind: 'older', value: 16 }]);
    expect(scriptTimelocks(hex('0390d003b1'))).toEqual([{ kind: 'after', value: 250000 }]);
    expect(scriptTimelocks(hex('5121' + '02' + '11'.repeat(32) + '51ae'))).toEqual([]);
  });
});

describe('the fallback on the leaf-hazard copies', () => {
  it('wsh: @scure has no template for the vault script and would send it with no signature: refused', () => {
    const working = fx.wshEveryday.k0LedgerWorking;
    const solo = scureFinalizePsbt(working);
    expect(solo).not.toBeNull(); // the hazard: @scure says yes
    const witness = btc.Transaction.fromPSBT(decodeBase64(solo!)!, { allowUnknownInputs: true, allowUnknownOutputs: true })
      .getInput(0).finalScriptWitness!;
    expect(witness.length).toBe(1); // the witness script alone
    const problems = fallbackWitnessProblems(working, solo!);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^coin 1: the backup assembler has no template for this vault's script/);
  });

  it('taproot: @scure picks the recovery leaf, whose wait the everyday spend does not carry: refused', () => {
    const working = fx.trEveryday.k0LedgerWorking;
    expect(txLocksOf(working)).toEqual({ version: 1, lockTime: 70000, sequences: [0xfffffffd] });
    const solo = scureFinalizePsbt(working);
    expect(solo).not.toBeNull();
    const witness = btc.Transaction.fromPSBT(decodeBase64(solo!)!, { allowUnknownInputs: true, allowUnknownOutputs: true })
      .getInput(0).finalScriptWitness!;
    expect(scriptTimelocks(witness[witness.length - 2])).toEqual([{ kind: 'older', value: 144 }]);
    const problems = fallbackWitnessProblems(working, solo!);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^coin 1: this signature uses a path that opens only after a wait/);
  });

  it('taproot: the same through the co-sign route (combine, then finalize): refused', () => {
    const routes = finalizeCosigned(fx.trEveryday.unsigned, fx.trEveryday.k0KruxReply);
    expect(routes.psbtBase64).not.toBeNull();
    const problems = fallbackWitnessProblems(fx.trEveryday.unsigned, routes.psbtBase64!, routes.sources);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^coin 1: this signature uses a path that opens only after a wait/);
  });

  it('taproot recovery path: nSequence carries older(144), so the same leaf is accepted, byte for byte the transaction the library built and libbitcoinconsensus accepted', () => {
    const routes = finalizeCosigned(fx.trRecovery.unsigned, fx.trRecovery.k0KruxReply);
    expect(routes.psbtBase64).not.toBeNull();
    expect(txLocksOf(routes.psbtBase64!)).toEqual({ version: 2, lockTime: 70000, sequences: [144] });
    // The signatures are in the reply, which the co-sign route built from.
    expect(fallbackWitnessProblems(fx.trRecovery.unsigned, routes.psbtBase64!, routes.sources)).toEqual([]);
    const raw = btc.Transaction.fromPSBT(decodeBase64(routes.psbtBase64!)!, {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
    }).extract();
    expect(fx.trRecovery.consensus).toBe('ok');
    expect(toHex(raw)).toBe(fx.trRecovery.finalizedTx);
  });

  it('an input the library finalized itself is never judged here', () => {
    const routes = finalizeCosigned(fx.trRecovery.unsigned, fx.trRecovery.k0KruxReply);
    // The same final witness before and after: nothing to judge, even on a copy that is unreadable as a fallback.
    expect(fallbackWitnessProblems(routes.psbtBase64!, routes.psbtBase64!)).toEqual([]);
  });

  it('an unreadable copy is refused, never passed', () => {
    expect(fallbackWitnessProblems(fx.trRecovery.unsigned, 'not a psbt')).toEqual(['the assembled copy cannot be read']);
  });
});

describe('P2SH: the redeem script is read from the scriptSig (decided 2026-10-17)', () => {
  const NET = btc.TEST_NETWORK;
  const A = HDKey.fromMasterSeed(sha256(utf8ToBytes('talia-golden-k0'))).derive("m/48'/1'/0'/2'/0/0");
  const spendOf = (p: { script: Uint8Array; redeemScript?: Uint8Array; witnessScript?: Uint8Array }, sequence = 0xfffffffd) => {
    const t = new btc.Transaction({ version: 1, lockTime: 70000, allowUnknownOutputs: true, allowUnknownInputs: true });
    t.addInput({
      txid: '22'.repeat(32),
      index: 0,
      sequence,
      witnessUtxo: { script: p.script, amount: 100000n },
      redeemScript: p.redeemScript,
      witnessScript: p.witnessScript,
    });
    t.addOutputAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 99000n, NET);
    t.signIdx(A.privateKey!, 0);
    return encodeBase64(t.toPSBT(0));
  };

  it('sh(wpkh): a single key, no script of its own, so nothing to refuse (the witness\'s last item is the key)', () => {
    const before = spendOf(btc.p2sh(btc.p2wpkh(A.publicKey!, NET), NET));
    const after = scureFinalizePsbt(before)!;
    const w = btc.Transaction.fromPSBT(decodeBase64(after)!, { allowUnknownInputs: true }).getInput(0).finalScriptWitness!;
    expect(w).toHaveLength(2);
    expect(w[1]).toEqual(A.publicKey);
    expect(fallbackWitnessProblems(before, after)).toEqual([]);
  });

  it('sh(wsh(<a script @scure has no template for>)): still refused, it is sent with no signature', () => {
    const script = btc.Script.encode([A.publicKey!, 'CHECKSIGVERIFY', 144, 'CHECKSEQUENCEVERIFY']);
    const p = btc.p2sh(btc.p2wsh({ type: 'unknown', script } as never, NET), NET);
    const before = spendOf(p, 144);
    const after = scureFinalizePsbt(before);
    expect(after).not.toBeNull(); // @scure says yes: the script alone, no signature
    expect(fallbackWitnessProblems(before, after!)[0]).toMatch(/has no template for this vault's script/);
  });
});
