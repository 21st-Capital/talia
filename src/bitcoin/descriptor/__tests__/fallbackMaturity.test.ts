/**
 * The fallback finaliser assembles a witness for our recovery leaf without
 * checking the timelock (found 2026-07-29). Left alone, the app tells a client
 * their rescue is "ready to send" and the network rejects it — at the exact
 * moment they are already in trouble.
 *
 * The trap in fixing it: "refuse any timelocked path" BREAKS RESCUE. A rescue
 * is signed only by the rescue key, that key lives only behind a timelock, and
 * the rescue screen has no other assembly route. The first proposed fix would
 * have failed every genuine rescue, which is why the rescue cases below are the
 * point of this file, not the padding.
 */
import { fallbackWitnessAllowed } from '../policy';
import type { WalletPolicy } from '../policy';

const CLIENT_A = 'aaaa1111';
const CLIENT_B = 'bbbb2222';
const C21 = '0c21c051';
const RESCUE = '4c21e5c0';

const key = (fp: string) => ({ fingerprint: fp, xpub: `xpub-${fp}` });

/** The test shape: 2-of-3 now, or the rescue key alone after a wait. */
const vault = (olderBlocks: number): WalletPolicy =>
  ({
    exact: true,
    paths: [
      { groups: [{ threshold: 2, keys: [key(CLIENT_A), key(CLIENT_B), key(C21)] }] },
      { groups: [{ threshold: 1, keys: [key(RESCUE)] }], olderBlocks },
    ],
  }) as unknown as WalletPolicy;

describe('the normal path is unaffected', () => {
  it('allows a 2-of-3 spend — no wait involved', () => {
    const r = fallbackWitnessAllowed(vault(4383), [CLIENT_A, C21], 0);
    expect(r.allowed).toBe(true);
  });

  it('still refuses signatures that satisfy nothing', () => {
    const r = fallbackWitnessAllowed(vault(4383), [CLIENT_A], 999999);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/do not satisfy any spending path/);
  });
});

describe('rescue must keep working — this is the one that matters', () => {
  it('ALLOWS a rescue once the wait is over', () => {
    const r = fallbackWitnessAllowed(vault(4383), [RESCUE], 4383);
    expect(r.allowed).toBe(true);
  });

  it('ALLOWS a rescue long past the wait', () => {
    expect(fallbackWitnessAllowed(vault(4383), [RESCUE], 100000).allowed).toBe(true);
  });

  it('ALLOWS a rescue when the coin age is UNKNOWN', () => {
    // The rescue screen may not be able to tell. Blocking on missing
    // information would fail real rescues, so unknown means allowed — the same
    // stance the rest of this guard takes.
    expect(fallbackWitnessAllowed(vault(4383), [RESCUE], undefined).allowed).toBe(true);
  });

  it('REFUSES a rescue attempted before the wait is over', () => {
    const r = fallbackWitnessAllowed(vault(4383), [RESCUE], 4382);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/network would reject/);
  });

  it('refuses at zero confirmations — the clock has not started', () => {
    expect(fallbackWitnessAllowed(vault(3), [RESCUE], 0).allowed).toBe(false);
  });

  it('allows exactly at the boundary', () => {
    // older(N) is satisfied AT N confirmations, not N+1. Off by one here means
    // a client waits an extra block for no reason, or sends one too early.
    expect(fallbackWitnessAllowed(vault(3), [RESCUE], 3).allowed).toBe(true);
    expect(fallbackWitnessAllowed(vault(3), [RESCUE], 2).allowed).toBe(false);
  });
});

describe('never block on missing information', () => {
  it('allows when the policy could not be flattened', () => {
    const vague = { exact: false, paths: [] } as unknown as WalletPolicy;
    expect(fallbackWitnessAllowed(vague, [], 0).allowed).toBe(true);
  });

  it('allows when a key has no fingerprint', () => {
    // An imported bare xpub: we cannot tell "did not sign" from "unknown key".
    const bare = {
      exact: true,
      paths: [{ groups: [{ threshold: 1, keys: [{ xpub: 'xpub-bare' }] }], olderBlocks: 10 }],
    } as unknown as WalletPolicy;
    expect(fallbackWitnessAllowed(bare, [], 0).allowed).toBe(true);
  });
});
