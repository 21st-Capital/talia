/**
 * The leaf hazard ("d10" in this file's name), end to end through the engine's pure half
 * (`finishFinalization`, what completePsbt runs after the library's own
 * finalizer). The library is fixed: on these copies it leaves the input open.
 * Before this, the scure fallback and its judge then said "finalized" on
 * both (checked on these very copies): a wsh witness holding the script and
 * no signature, and the taproot recovery leaf with nSequence 0xFFFFFFFD in a
 * version 1 transaction. The network refuses both. Now they stay open, with
 * the reason kept for the screen, and the recovery path itself still
 * finishes. Test keys only (the bdk 0.28 recorded baseline, with the fix).
 */
import * as btc from '@scure/btc-signer';
import { finishFinalization } from '../engineShared';
import { decodeBase64 } from '../../psbt/export';
import { mergeLedgerSignatures } from '../../ledger/merge';
import fx from '../__fixtures__/d10LeafHazard.json';

/** Years past every wait in these vaults: only the transaction can say no. */
const OLD = { inputConfirmations: 69001 };

const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

/** What the app makes of a Ledger's reply: its signatures merged into the copy that went out. */
const ledgerReply = (unsigned: string, sigs: typeof fx.trRecovery.k0LedgerSigs): string =>
  mergeLedgerSignatures(
    unsigned,
    sigs.map((x) => ({
      inputIndex: x.inputIndex,
      pubkey: bytes(x.pubkey),
      tapleafHash: bytes(x.tapleafHash),
      signature: bytes(x.signature),
    })),
  );

const extractHex = (b64: string): string =>
  Array.from(
    btc.Transaction.fromPSBT(decodeBase64(b64)!, { allowUnknownInputs: true, allowUnknownOutputs: true }).extract(),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');

describe('an everyday spend signed only by the device that holds two keys', () => {
  it('wsh: stays open; the recovery path is not counted while the transaction does not carry its wait', () => {
    const f = fx.wshEveryday;
    const r = finishFinalization({
      descriptor: f.descriptor,
      bdkPsbtBase64: f.k0LedgerWorking,
      signedPsbtBase64: f.k0LedgerWorking,
      originalPsbtBase64: f.unsigned,
      opts: OLD,
    });
    expect(r.finalized).toBe(false);
    expect(r.psbtBase64).toBe(f.k0LedgerWorking);
    expect(r.finalizeNotes!.join('\n')).toMatch(/opens only after a wait, and this transaction does not carry that wait/);
  });

  it('wsh, each device signed one key (a BitBox picks the recovery key): the judge counts the fingerprints as the everyday path, the witness check refuses the witness with no signature', () => {
    const f = fx.wshEveryday;
    const r = finishFinalization({
      descriptor: f.descriptor,
      bdkPsbtBase64: f.bitboxK0K1Working,
      signedPsbtBase64: f.bitboxK0K1Working,
      originalPsbtBase64: f.unsigned,
      opts: OLD,
    });
    expect(r.finalized).toBe(false);
    expect(r.psbtBase64).toBe(f.bitboxK0K1Working);
    expect(r.finalizeNotes!.join('\n')).toMatch(/refused: coin 1: the backup assembler has no template for this vault's script/);
  });

  it('taproot: stays open; the recovery leaf is not used while the transaction does not carry its wait', () => {
    const f = fx.trEveryday;
    const r = finishFinalization({
      descriptor: f.descriptor,
      bdkPsbtBase64: f.k0LedgerWorking,
      signedPsbtBase64: f.k0LedgerWorking,
      originalPsbtBase64: f.unsigned,
      opts: OLD,
    });
    expect(r.finalized).toBe(false);
    expect(r.psbtBase64).toBe(f.k0LedgerWorking);
    expect(r.finalizeNotes!.join('\n')).toMatch(/opens only after a wait, and this transaction does not carry that wait/);
  });

  it('taproot, a Krux reply finished through the co-sign route: stays open too (the reply carries no key origins, so the judge finds no signer; the witness check would refuse it as well)', () => {
    const f = fx.trEveryday;
    const r = finishFinalization({
      descriptor: f.descriptor,
      bdkPsbtBase64: f.unsigned,
      signedPsbtBase64: f.k0KruxReply,
      originalPsbtBase64: f.unsigned,
      opts: OLD,
    });
    expect(r.finalized).toBe(false);
    expect(r.finalizeNotes!.join('\n')).toMatch(/^refused: /m);
  });

  it('the single-copy route (a rescue hands over one PSBT) keeps the reason too', () => {
    const f = fx.trEveryday;
    const r = finishFinalization({
      descriptor: f.descriptor,
      bdkPsbtBase64: f.k0LedgerWorking,
      signedPsbtBase64: f.k0LedgerWorking,
      opts: OLD,
    });
    expect(r.finalized).toBe(false);
    expect(r.finalizeNotes).toEqual([
      expect.stringMatching(/^refused a fallback witness: these signatures are for a path that opens only after a wait/),
    ]);
  });

  it('taproot, the Ledger reply as the app merges it: stays open', () => {
    const f = fx.trEveryday;
    const reply = ledgerReply(f.unsigned, f.k0LedgerSigs);
    const r = finishFinalization({
      descriptor: f.descriptor,
      bdkPsbtBase64: reply,
      signedPsbtBase64: reply,
      originalPsbtBase64: f.unsigned,
      opts: OLD,
    });
    expect(r.finalized).toBe(false);
  });
});

describe('the recovery path itself', () => {
  // The same device, the same two signatures (a Ledger signs every leaf it
  // holds a key in), on a build that took the recovery path: nSequence 144,
  // version 2. Handed to the fallback as if the library had left it open.
  const recovery = () => ledgerReply(fx.trRecovery.unsigned, fx.trRecovery.k0LedgerSigs);

  it('finishes: the transaction carries older(144), and it is the very transaction libbitcoinconsensus accepted', () => {
    const f = fx.trRecovery;
    const r = finishFinalization({
      descriptor: f.descriptor,
      bdkPsbtBase64: recovery(),
      signedPsbtBase64: recovery(),
      originalPsbtBase64: f.unsigned,
      opts: OLD,
    });
    expect(r.finalized).toBe(true);
    expect(f.k0LedgerConsensus).toBe('ok');
    expect(extractHex(r.psbtBase64)).toBe(f.k0LedgerFinalizedTx);
  });

  it('a young coin on it still finishes (the wait is the network\'s BIP-68 check, never a script failure), unless provably too early', () => {
    const f = fx.trRecovery;
    const at = (inputConfirmations?: number) =>
      finishFinalization({
        descriptor: f.descriptor,
        bdkPsbtBase64: recovery(),
        signedPsbtBase64: recovery(),
        originalPsbtBase64: f.unsigned,
        opts: { inputConfirmations },
      }).finalized;
    expect(at(undefined)).toBe(true); // unknown age: never blocked
    expect(at(144)).toBe(true);
    expect(at(10)).toBe(false); // provably early: the judge of 2026-07-29, unchanged
  });
});
