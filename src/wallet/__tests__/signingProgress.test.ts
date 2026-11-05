/**
 * The leaf hazard, on the signing screens (decided 2026-10-17): the
 * path a working copy is on and how far along it, as SignPsbt (`pathInPlay`
 * behind thresholdMet, the path named, the count shown, the entry jump) and
 * Pending transactions (`parkedProgress`) read it.
 *
 * The copies are the leaf-hazard fix's own (decided 2026-10-17: the bdk 0.28
 * recorded baseline with the fix, test keys only): an everyday spend (version 1, nSequence
 * 0xFFFFFFFD) signed only by device A, which holds keys on both paths. The
 * screens used to call the recovery path satisfied by fingerprint: "Enough
 * signatures collected", "2 signatures. This spend needs no more.", a parked
 * "Signed with 2 keys · ready to send", and device B never asked for, while
 * the library (rightly) left the input open.
 */
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import fx from '../../bitcoin/engine/__fixtures__/d10LeafHazard.json';
import { parsePolicy, pathInPlay, pathOpenForTx, pathSatisfiedOnEveryInput, signerHoldsKey } from '../../bitcoin/descriptor/policy';
import { decodeBase64, encodeBase64 } from '../../bitcoin/psbt/export';
import { psbtSignatureStatus } from '../../bitcoin/psbt/parse';
import { txLocksOf } from '../../bitcoin/psbt/timelockCheck';
import { mergeLedgerSignatures } from '../../bitcoin/ledger/merge';
import { scureFinalizePsbt } from '../../bitcoin/psbt/finalize';
import { parkedProgress, pathInPlayOf, signingProgress } from '../signingProgress';

const A = 'f5d9e0c9'; // k0: the everyday key AND the recovery key (<2;3>)
const B = 'b04e5885'; // k1: the everyday path only

/** The test keys: seed = sha256("talia-golden-<label>"). */
const seedKey = (label: string) =>
  HDKey.fromMasterSeed(sha256(utf8ToBytes(`talia-golden-${label}`)), { private: 0x04358394, public: 0x043587cf });

/** Sign input 0 with every key of the seed the copy names (a Ledger signs
 *  every leaf it holds a key in; B holds one key). */
function signAs(label: string, psbtB64: string): string {
  const master = seedKey(label);
  const tx = btc.Transaction.fromPSBT(decodeBase64(psbtB64)!, { allowUnknownInputs: true, allowUnknownOutputs: true });
  const inp = tx.getInput(0);
  const paths = [
    ...(inp.bip32Derivation ?? []).map(([, d]) => d),
    ...(inp.tapBip32Derivation ?? []).map(([, d]) => d.der),
  ]
    .filter((d) => d.fingerprint === master.fingerprint)
    .map((d) => 'm/' + d.path.map((n: number) => (n >= 0x80000000 ? `${n - 0x80000000}'` : String(n))).join('/'));
  expect(paths.length).toBeGreaterThan(0);
  for (const p of new Set(paths)) tx.signIdx(master.derive(p).privateKey!, 0);
  return encodeBase64(tx.toPSBT(0));
}

const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
const recoveryReply = () =>
  mergeLedgerSignatures(
    fx.trRecovery.unsigned,
    fx.trRecovery.k0LedgerSigs.map((x) => ({
      inputIndex: x.inputIndex,
      pubkey: bytes(x.pubkey),
      tapleafHash: bytes(x.tapleafHash),
      signature: bytes(x.signature),
    })),
  );

const everyday = [
  ['wsh', fx.wshEveryday],
  ['taproot', fx.trEveryday],
] as const;

describe.each(everyday)('%s everyday spend, device A (keys on both paths) signed first', (_kind, f) => {
  it('the rule the screens had: by fingerprint the older(144) path is satisfied', () => {
    const policy = parsePolicy(f.descriptor);
    const status = psbtSignatureStatus(f.k0LedgerWorking);
    expect(status.signatureCount).toBe(2);
    expect(status.signedFingerprints).toEqual([A]);
    expect(policy.paths.find((p) => pathSatisfiedOnEveryInput(p, status.signerGroups))?.olderBlocks).toBe(144);
  });

  it('the transaction does not open the recovery path, so the everyday path stays in play and B is named', () => {
    const p = pathInPlayOf(f.descriptor, f.k0LedgerWorking)!;
    expect(p.satisfied).toBe(false); // thresholdMet: false
    expect(p.path.olderBlocks).toBeUndefined(); // the everyday path
    expect(p.missing).toBe(1);
    expect(p.signers).toEqual([A]);
    expect(signingProgress(f.descriptor, f.k0LedgerWorking)).toEqual({
      signatures: 1, // never 2: one device's two signatures are one key on this path
      needed: 2,
      complete: false,
      waitingFor: [B],
    });
  });

  it('Pending says "1 of 2" for it, whatever count a record stored', () => {
    const stored = { originalPsbt: f.k0LedgerWorking, signatures: 2, signaturesNeeded: 2 };
    expect(parkedProgress(f.descriptor, stored)).toEqual({ signatures: 1, needed: 2, complete: false });
    // A vault the phone cannot read keeps the stored numbers.
    expect(parkedProgress(undefined, stored).complete).toBe(true);
  });

  it('once B signs too, the everyday path is complete', () => {
    const both = signAs('k1', f.k0LedgerWorking);
    expect(signingProgress(f.descriptor, both)).toEqual({ signatures: 2, needed: 2, complete: true, waitingFor: [] });
    expect(pathInPlayOf(f.descriptor, both)!.path.olderBlocks).toBeUndefined();
  });

  it('B alone first: one of two, A still to sign', () => {
    expect(signingProgress(f.descriptor, signAs('k1', f.unsigned))).toEqual({
      signatures: 1,
      needed: 2,
      complete: false,
      waitingFor: [A],
    });
  });
});

describe('a device that signs only its recovery key (a BitBox picks its own key)', () => {
  it('wsh: A on <2;3> and B on the everyday path is NOT the everyday path, though the fingerprints match', () => {
    const f = fx.wshEveryday;
    const status = psbtSignatureStatus(f.bitboxK0K1Working);
    // By fingerprint the everyday path looked met.
    expect(status.signerGroups).toEqual([{ ecdsa: [A, B] }]);
    // By key it is not: A signed the recovery key.
    expect(status.signerKeys).toEqual([{ ecdsa: [`${A}/48'/1'/0'/2'/2/0`, `${B}/48'/1'/0'/2'/0/0`] }]);
    expect(signingProgress(f.descriptor, f.bitboxK0K1Working)).toEqual({
      signatures: 1,
      needed: 2,
      complete: false,
      waitingFor: [A],
    });
  });
});

describe('the recovery path itself', () => {
  it('a build of the recovery path (version 2, nSequence 144) signed by A is complete on it', () => {
    const f = fx.trRecovery;
    const p = pathInPlayOf(f.descriptor, recoveryReply())!;
    expect(p.path.olderBlocks).toBe(144);
    expect(p.satisfied).toBe(true);
    expect(signingProgress(f.descriptor, recoveryReply())).toEqual({ signatures: 1, needed: 1, complete: true, waitingFor: [] });
  });

  it('a layer the owner opened is the path in play, whatever else is closer', () => {
    const f = fx.trRecovery;
    const policy = parsePolicy(f.descriptor);
    const everydayPath = policy.paths.find((p) => p.olderBlocks === undefined)!;
    expect(signingProgress(f.descriptor, f.unsigned, everydayPath)).toMatchObject({ needed: 2, complete: false });
  });
});

describe('copies with nothing to count', () => {
  it('a finalized copy is complete (finalizing may drop the signatures it used)', () => {
    const final = scureFinalizePsbt(recoveryReply())!;
    expect(signingProgress(fx.trRecovery.descriptor, final)).toMatchObject({ complete: true, needed: 1, signatures: 1 });
  });

  it('an unreadable copy counts nobody; an unreadable descriptor gives null, and Pending then keeps what it stored', () => {
    expect(signingProgress(fx.trEveryday.descriptor, 'not a psbt')).toMatchObject({ complete: false, signatures: 0 });
    expect(pathInPlayOf('garbage(', fx.trEveryday.unsigned)).toBeNull();
    expect(parkedProgress('garbage(', { originalPsbt: 'x', signatures: 1, signaturesNeeded: 2 })).toEqual({
      signatures: 1,
      needed: 2,
      complete: false,
    });
  });
});

describe('pathOpenForTx and signerHoldsKey', () => {
  const policy = parsePolicy(fx.trEveryday.descriptor);
  const [everydayPath, recovery] = policy.paths;

  it('a path with no wait is always open; a waiting path only when the transaction carries it', () => {
    expect(pathOpenForTx(everydayPath, null)).toBe(true);
    expect(pathOpenForTx(recovery, null)).toBe(false);
    expect(pathOpenForTx(recovery, txLocksOf(fx.trEveryday.unsigned))).toBe(false);
    expect(pathOpenForTx(recovery, txLocksOf(fx.trRecovery.unsigned))).toBe(true);
  });

  it('pathInPlay scores only the open paths', () => {
    const status = psbtSignatureStatus(fx.trEveryday.k0LedgerWorking);
    const unopened = pathInPlay(policy, status, null);
    expect(unopened!.path).toBe(everydayPath);
  });

  it('tells the keys of one seed apart by their branches, and falls back to the fingerprint where the descriptor names none', () => {
    const k = { fingerprint: A, originPath: "48'/1'/0'/2'", xpub: 'x', keyPath: '<0;1>/*' };
    expect(signerHoldsKey(`${A}/48'/1'/0'/2'/0/7`, k)).toBe(true);
    expect(signerHoldsKey(`${A}/48'/1'/0'/2'/1/0`, k)).toBe(true);
    expect(signerHoldsKey(`${A}/48'/1'/0'/2'/2/0`, k)).toBe(false);
    expect(signerHoldsKey(`${A}/48'/1'/0'/3'/0/0`, k)).toBe(false); // another account of the seed
    expect(signerHoldsKey(`${B}/48'/1'/0'/2'/0/0`, k)).toBe(false);
    expect(signerHoldsKey(`${A}/48'/1'/0'/2'/2/0`, { ...k, originPath: '48h/1h/0h/2h', keyPath: '<2;3>/*' })).toBe(true);
    expect(signerHoldsKey(`${A}/48'/1'/0'/2'/5/0`, { ...k, keyPath: '0/*' })).toBe(true); // no branches named
    expect(signerHoldsKey(`${A}/9/9`, { ...k, originPath: undefined })).toBe(true); // no origin path
  });
});
