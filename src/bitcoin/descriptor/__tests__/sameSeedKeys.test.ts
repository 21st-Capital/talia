/**
 * Decided 2026-07-29: "If a customer uses the same seed as his first and his second
 * key, the app MUST reject it."
 *
 * That is right, and it was not covered. Two keys off ONE seed at different
 * accounts have DIFFERENT xpubs but the SAME master fingerprint, so the old
 * xpub-only check waved them straight through: a vault that reads "2-of-3"
 * while a single seed backup satisfies two of the three slots. That is a 1-of-2
 * wearing a 2-of-3's clothes — a fund-loss shape, not a nuisance.
 *
 * The keys here are REALLY DERIVED rather than hand-written, so the shared
 * fingerprint is a fact of the maths rather than something the test asserts
 * about itself.
 */
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { composeMultisig, composeLayeredVault } from '../compose';
import type { KeyOrigin } from '../types';

const seedOf = (label: string) => HDKey.fromMasterSeed(sha256(utf8ToBytes(label)));

/** One account of one seed, in the shape the vault builder hands to compose. */
function account(label: string, index: number): KeyOrigin {
  const master = seedOf(label);
  const path = `48'/0'/${index}'/2'`;
  return {
    fingerprint: master.fingerprint.toString(16).padStart(8, '0'),
    originPath: path,
    xpub: master.derive(`m/${path}`).publicExtendedKey,
  };
}

const ALICE = account('alice', 0);
const BOB = account('bob', 0);
const C21_COSIGN = account('21c-cosigner', 1000);
const C21_RESCUE = account('21c-rescue', 1000);

describe('the fingerprint is what identifies a signer', () => {
  it('two accounts of one seed really do share a fingerprint (and differ by xpub)', () => {
    const a0 = account('alice', 0);
    const a1 = account('alice', 1);
    expect(a0.fingerprint).toBe(a1.fingerprint);
    expect(a0.xpub).not.toBe(a1.xpub);
  });
});

describe('two keys from the same seed', () => {
  it('is REFUSED in a multisig, even at different accounts', () => {
    // What a client would actually do: export account 0 and account 1 from one
    // Coldcard and add both.
    expect(() => composeMultisig(2, [ALICE, account('alice', 1), BOB])).toThrow(
      /same wallet backup/i,
    );
  });

  it('is REFUSED across the paths of a layered vault', () => {
    // An heir whose key comes off the owner's own device is not an heir.
    expect(() =>
      composeLayeredVault(
        { threshold: 2, keys: [ALICE, BOB, C21_COSIGN] },
        [{ threshold: 1, keys: [account('alice', 7)], olderBlocks: 3 }],
      ),
    ).toThrow(/same wallet backup/i);
  });

  it('still refuses the literal same xpub', () => {
    expect(() => composeMultisig(2, [ALICE, ALICE, BOB])).toThrow(
      /same key was added twice/i,
    );
  });

  it('matches fingerprints case-insensitively', () => {
    const upper = { ...account('alice', 3) };
    upper.fingerprint = upper.fingerprint!.toUpperCase();
    expect(() => composeMultisig(2, [ALICE, upper, BOB])).toThrow(
      /same wallet backup/i,
    );
  });
});

describe('what must still be allowed', () => {
  it('genuinely separate seeds', () => {
    expect(() => composeMultisig(2, [ALICE, BOB, C21_COSIGN])).not.toThrow();
  });

  it('the 21C co-signer and rescue keys together — separate seeds, as confirmed', () => {
    expect(C21_COSIGN.fingerprint).not.toBe(C21_RESCUE.fingerprint);
    expect(() =>
      composeLayeredVault(
        { threshold: 2, keys: [ALICE, BOB, C21_COSIGN] },
        [{ threshold: 1, keys: [C21_RESCUE], olderBlocks: 3 }],
      ),
    ).not.toThrow();
  });

  it('origin-less keys are not treated as related to each other', () => {
    // A bare xpub carries no fingerprint. Two blanks are not evidence of a
    // shared seed, and refusing them would block a legitimate vault built from
    // imported keys.
    const bare = (label: string): KeyOrigin => ({
      xpub: seedOf(label).derive("m/48'/0'/0'/2'").publicExtendedKey,
    });
    expect(() => composeMultisig(2, [bare('one'), bare('two'), ALICE])).not.toThrow();
  });
});

describe('no rehearsal exception: the gate holds across every path', () => {
  // The 30-minute-test-lock heir could once borrow an owner device
  // (sharedSeedAllowed). RETIRED 2026-08-31: the team now has enough Bluetooth
  // devices that a rehearsal heir gets a real one, so the same-seed rule is
  // absolute again.
  const OWNER = account('alice', 0);
  const HEIR_SAME_DEVICE = account('alice', 1); // same seed, next account
  const RESCUE = account('21c-rescue', 1000);

  it('refuses a fingerprint spanning primary and a timelocked path', () => {
    expect(() =>
      composeLayeredVault({ threshold: 1, keys: [OWNER] }, [
        { threshold: 1, keys: [HEIR_SAME_DEVICE], olderBlocks: 3 },
        { threshold: 1, keys: [RESCUE], olderBlocks: 65535 },
      ]),
    ).toThrow(/same wallet backup/);
  });

  it('refuses the identical key twice, the degenerate descriptor', () => {
    expect(() =>
      composeLayeredVault({ threshold: 1, keys: [OWNER] }, [
        { threshold: 1, keys: [{ ...OWNER }], olderBlocks: 3 },
      ]),
    ).toThrow();
  });
});
