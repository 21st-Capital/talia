/**
 * The leaf hazard (decided 2026-10-17): the fallback judge asks whether the
 * TRANSACTION carries a waiting path's lock, never only whether the coin is
 * old enough. The rescue cases of fallbackMaturity.test.ts still hold: a
 * rescue is built on its path, so its transaction carries the wait.
 */
import { fallbackWitnessAllowed } from '../policy';
import type { WalletPolicy } from '../policy';
import type { TxLocks } from '../../txLocks';

const CLIENT_A = 'aaaa1111';
const CLIENT_B = 'bbbb2222';
const RESCUE = '4c21e5c0';
const HEIR = 'he1r0001';

const key = (fp: string) => ({ fingerprint: fp, xpub: `xpub-${fp}` });

/** 2-of-2 now, the heir after 144 blocks, the rescue key at a height, or a 512-second wait. */
const vault = (): WalletPolicy =>
  ({
    exact: true,
    paths: [
      { groups: [{ threshold: 2, keys: [key(CLIENT_A), key(CLIENT_B)] }] },
      { groups: [{ threshold: 1, keys: [key(HEIR)] }], olderBlocks: 144 },
      { groups: [{ threshold: 1, keys: [key(RESCUE)] }], afterHeight: 900_000 },
    ],
  }) as unknown as WalletPolicy;

const everyday: TxLocks = { version: 1, lockTime: 850_000, sequences: [0xfffffffd] };
const heirPath: TxLocks = { version: 2, lockTime: 950_000, sequences: [144] };
const rescuePath: TxLocks = { version: 2, lockTime: 900_000, sequences: [0xfffffffe] };

describe('a waiting path counts only when the transaction carries the wait', () => {
  it('the heir\'s signature on an everyday spend is refused, however old the coins', () => {
    const r = fallbackWitnessAllowed(vault(), [HEIR], 1_000_000, everyday);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/this transaction does not carry that wait, so the network would reject it/);
  });

  it('the same signature on a build of the heir\'s path is allowed once the coins are old enough', () => {
    expect(fallbackWitnessAllowed(vault(), [HEIR], 144, heirPath).allowed).toBe(true);
    expect(fallbackWitnessAllowed(vault(), [HEIR], 10, heirPath).allowed).toBe(false); // provably early, as before
  });

  it('a fewer-block nSequence, version 1, or a final nSequence never carries older()', () => {
    expect(fallbackWitnessAllowed(vault(), [HEIR], 999, { ...heirPath, sequences: [143] }).allowed).toBe(false);
    expect(fallbackWitnessAllowed(vault(), [HEIR], 999, { ...heirPath, version: 1 }).allowed).toBe(false);
    expect(fallbackWitnessAllowed(vault(), [HEIR], 999, { ...heirPath, sequences: [0xffffffff] }).allowed).toBe(false);
  });

  it('every input must carry it', () => {
    expect(fallbackWitnessAllowed(vault(), [HEIR], 999, { ...heirPath, sequences: [144, 0xfffffffd] }).allowed).toBe(false);
    expect(fallbackWitnessAllowed(vault(), [HEIR], 999, { ...heirPath, sequences: [144, 200] }).allowed).toBe(true);
  });

  it('after(): nLockTime at the height and a non-final nSequence', () => {
    expect(fallbackWitnessAllowed(vault(), [RESCUE], undefined, rescuePath).allowed).toBe(true);
    expect(fallbackWitnessAllowed(vault(), [RESCUE], undefined, { ...rescuePath, lockTime: 899_999 }).allowed).toBe(false);
    expect(fallbackWitnessAllowed(vault(), [RESCUE], undefined, { ...rescuePath, sequences: [0xffffffff] }).allowed).toBe(false);
  });

  it('a path without a wait needs nothing from the transaction', () => {
    expect(fallbackWitnessAllowed(vault(), [CLIENT_A, CLIENT_B], 0, everyday).allowed).toBe(true);
  });

  it('signatures for two paths: the one the transaction carries is the one judged', () => {
    // The heir and the rescue key both signed; the transaction carries the rescue's lock only.
    expect(fallbackWitnessAllowed(vault(), [HEIR, RESCUE], undefined, rescuePath).allowed).toBe(true);
    expect(fallbackWitnessAllowed(vault(), [HEIR, RESCUE], undefined, everyday).allowed).toBe(false);
  });

  it('an everyday build whose anti-fee-sniping nLockTime is past the height DOES carry after(): that spend is valid', () => {
    expect(fallbackWitnessAllowed(vault(), [RESCUE], undefined, { ...everyday, lockTime: 950_000 }).allowed).toBe(true);
  });

  it('a time-based wait needs a time-based nSequence', () => {
    const timeVault = {
      exact: true,
      paths: [
        { groups: [{ threshold: 2, keys: [key(CLIENT_A), key(CLIENT_B)] }] },
        { groups: [{ threshold: 1, keys: [key(HEIR)] }], olderBlocks: 4400, olderIsTime: true },
      ],
    } as unknown as WalletPolicy;
    expect(fallbackWitnessAllowed(timeVault, [HEIR], undefined, { version: 2, lockTime: 0, sequences: [4400] }).allowed).toBe(false);
    expect(
      fallbackWitnessAllowed(timeVault, [HEIR], undefined, { version: 2, lockTime: 0, sequences: [0x00400000 | 5000] }).allowed,
    ).toBe(true);
  });

  it('without the transaction\'s fields the judge answers as before', () => {
    expect(fallbackWitnessAllowed(vault(), [HEIR], 1_000_000).allowed).toBe(true);
  });
});
