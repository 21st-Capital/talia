/**
 * Decided 2026-09-26: the 21st Capital keys for a new
 * vault were taken from the backend as sent. What the app can prove on its
 * own is checked before either key reaches the descriptor.
 */
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes } from '@noble/hashes/utils';
import { base64, hex } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { issuedKeysProblem } from '../issuedKeyPins';
import * as ka from '../keyAttestation';
import type { KeyProofPolicy as Policy } from '../keyAttestation';

const TPUB = { private: 0x04358394, public: 0x043587cf };
const seed = (s: string, versions?: typeof TPUB) =>
  HDKey.fromMasterSeed(sha256(utf8ToBytes(s)), versions);

const main = seed('21c');
const test = seed('21c', TPUB);
const key = (fingerprint: string, originPath: string, hd: HDKey) => ({
  fingerprint,
  originPath,
  xpub: hd.derive(`m/${originPath}`).publicExtendedKey,
});

const coSigner = key('bb09d891', "48'/0'/1001'/2'", main);
const rescue = key('fdcd357b', "48'/0'/1001'/2'", seed('21c rescue'));

/** The fingerprint checks alone: these keys are made here and carry no
 *  device proof, which the shipped policy (enforce + required) refuses. */
const FINGERPRINTS_ONLY: Policy = {
  ...ka.KEY_PROOF_POLICY,
  mode: { mainnet: 'off', testnet4: 'off' },
};

describe('issuedKeysProblem', () => {
  it("21st Capital's live seeds, in their roles, pass", () => {
    expect(issuedKeysProblem({ coSigner, rescue }, 'mainnet', null, FINGERPRINTS_ONLY)).toBeNull();
  });

  it('as shipped, a 21st Capital key without its device proof is refused on both networks', () => {
    expect(issuedKeysProblem({ coSigner, rescue }, 'mainnet')).not.toBeNull();
    const a = key('49578625', "48'/1'/1000'/2'", test);
    expect(issuedKeysProblem({ coSigner: a }, 'testnet4')).not.toBeNull();
  });

  it('a swapped role is refused', () => {
    expect(issuedKeysProblem({ coSigner: rescue, rescue: coSigner }, 'mainnet')).toMatch(/co-signing key: unknown/);
  });

  it('an unknown seed under the rescue role is refused', () => {
    const other = { ...rescue, fingerprint: '12345678' };
    expect(issuedKeysProblem({ coSigner, rescue: other }, 'mainnet')).toMatch(/rescue key: unknown rescue seed/);
  });

  it('a seed outside the pins is refused on Bitcoin, whatever the proof switches say', () => {
    // How a retired seed stays out: its fingerprint is no longer pinned. The
    // fingerprint here is made up and stands in for any such seed.
    const unpinned = key('0a0a0a01', "48'/0'/1001'/2'", seed('a seed that is not pinned'));
    for (const policy of [FINGERPRINTS_ONLY, ka.KEY_PROOF_POLICY]) {
      expect(issuedKeysProblem({ coSigner: unpinned }, 'mainnet', null, policy)).toMatch(/^co-signing key: unknown co-signing seed/);
      expect(issuedKeysProblem({ coSigner, rescue: unpinned }, 'mainnet', null, policy)).toMatch(/^rescue key: unknown rescue seed/);
    }
  });

  it('a key of another network, purpose or depth is refused', () => {
    expect(issuedKeysProblem({ coSigner: key('bb09d891', "48'/1'/1001'/2'", test) }, 'mainnet')).toMatch(/another network/);
    expect(issuedKeysProblem({ coSigner: key('bb09d891', "84'/0'/0'", main) }, 'mainnet')).toMatch(/depth|purpose/);
    expect(issuedKeysProblem({ coSigner: { ...coSigner, originPath: "86'/0'/1001'/2'" } }, 'mainnet')).toMatch(/purpose/);
  });

  it('one seed in both roles is refused, and test keys are not pinned', () => {
    const a = key('49578625', "48'/1'/1000'/2'", test);
    const b = key('01d4b72e', "48'/1'/1000'/2'", seed('test rescue', TPUB));
    expect(issuedKeysProblem({ coSigner: a, rescue: b }, 'testnet4', null, FINGERPRINTS_ONLY)).toBeNull();
    expect(issuedKeysProblem({ coSigner: a, rescue: { ...b, fingerprint: '49578625' } }, 'testnet4')).toMatch(/same seed/);
  });
});

/**
 * The same rule: the device-signed proof of each key, checked in the
 * same gate. Real (derived) keys, proofs built here with a test signer, as
 * the backend serves them.
 */
describe('issuedKeysProblem with per-key proofs', () => {
  const testPriv = (label: string) => sha256(utf8ToBytes(`Talia unit tests: ${label}, NOT A REAL KEY`));
  const signBip137 = (text: string, priv: Uint8Array) => {
    const sig = secp256k1.sign(ka.messageHash(text), priv, { lowS: true });
    const out = new Uint8Array(65);
    out[0] = 31 + sig.recovery;
    out.set(sig.toCompactRawBytes(), 1);
    return base64.encode(out);
  };
  const addressOf = (priv: Uint8Array) => ka.p2pkhAddress(secp256k1.getPublicKey(priv, true), 0);

  /** A pool of `count` keys from `first`, its signed manifest, and one proof per account (coin 0 = Bitcoin, 1 = Testnet4). */
  const pool = (hd: HDKey, fp: string, purpose: 'cosigner' | 'rescue', first: number, count: number, priv: Uint8Array, coin = 0) => {
    const rows = Array.from({ length: count }, (_, i) => {
      const account = first + i;
      const originPath = `48'/${coin}'/${account}'/2'`;
      return { account, fingerprint: fp, originPath, xpub: hd.derive(`m/${originPath}`).publicExtendedKey };
    });
    const { root, paths } = ka.merkleTree(rows.map((r) => ka.leafHash(r, purpose, coin)));
    const manifest = [
      '21C key pool v2',
      `purpose ${purpose}`,
      `seed ${fp}`,
      `chain 48'/${coin}'`,
      `accounts ${first}-${first + count - 1}`,
      `keys ${count}`,
      `root ${hex.encode(root)}`,
    ].join('\n');
    const signature = signBip137(manifest, priv);
    return rows.map((r, i) => ({
      key: { fingerprint: r.fingerprint, originPath: r.originPath, xpub: r.xpub },
      proof: { format: ka.PROOF_FORMAT, manifest, signature, index: i, path: paths[i].map((h) => hex.encode(h)) },
    }));
  };

  const cosPriv = testPriv('co-signer attestation key');
  const resPriv = testPriv('rescue attestation key');
  const cosPool = pool(main, 'bb09d891', 'cosigner', 1000, 5, cosPriv);
  const resPool = pool(seed('21c rescue'), 'fdcd357b', 'rescue', 1000, 5, resPriv);
  const pins = {
    mainnet: { cosigner: { bb09d891: addressOf(cosPriv) }, rescue: { fdcd357b: addressOf(resPriv) } },
    testnet4: { cosigner: {}, rescue: {} },
  };
  const policy = (mode: 'off' | 'report' | 'enforce', required = false): Policy => ({
    mode: { mainnet: mode, testnet4: 'off' },
    required: { mainnet: { cosigner: required, rescue: required }, testnet4: { cosigner: false, rescue: false } },
    pins,
  });
  const at = (account: number) => ({
    coSigner: { ...cosPool[account - 1000].key, proof: cosPool[account - 1000].proof },
    rescue: { ...resPool[account - 1000].key, proof: resPool[account - 1000].proof },
  });

  it('proven keys pass on every mode', () => {
    for (const mode of ['off', 'report', 'enforce'] as const) {
      const notes: unknown[] = [];
      expect(issuedKeysProblem(at(1003), 'mainnet', 1003, policy(mode, true), (n) => notes.push(n))).toBeNull();
      expect(notes).toEqual([]);
    }
  });

  it('a rescue xpub rewritten in the database: off builds, report notes and builds, enforce refuses', () => {
    // A genuine-looking key of the right seed and path, but not the one the
    // device signed (the threat: one superuser rewrites a pool key's xpub).
    const swapped = { ...at(1003), rescue: { ...at(1003).rescue, xpub: seed('attacker').derive("m/48'/0'/1003'/2'").publicExtendedKey } };
    expect(issuedKeysProblem(swapped, 'mainnet', 1003, policy('off'))).toBeNull();
    const notes: { purpose: string; status: string; code: string | null; text: string; refused: boolean }[] = [];
    expect(issuedKeysProblem(swapped, 'mainnet', 1003, policy('report'), (n) => notes.push(n))).toBeNull();
    expect(notes).toEqual([
      { purpose: 'rescue', status: 'invalid', code: 'PROOF_PATH', text: 'rescue key proof invalid (PROOF_PATH)', refused: false },
    ]);
    const enforced: { refused: boolean }[] = [];
    expect(issuedKeysProblem(swapped, 'mainnet', 1003, policy('enforce'), (n) => enforced.push(n))).toBe(
      'rescue key: proof invalid (PROOF_PATH)',
    );
    // The report says the build was refused, so the backend files it as enforced.
    expect(enforced.map((n) => n.refused)).toEqual([true]);
  });

  it("another account's genuine key served for this vault is refused on enforce", () => {
    const other = { ...at(1003), coSigner: at(1004).coSigner };
    expect(issuedKeysProblem(other, 'mainnet', 1003, policy('enforce'))).toBe('co-signing key: proof invalid (PROOF_KEY_SHAPE)');
  });

  it('roles swapped with their proofs fail the fingerprint check first', () => {
    const swapped = { coSigner: at(1003).rescue, rescue: at(1003).coSigner };
    expect(issuedKeysProblem(swapped, 'mainnet', 1003, policy('enforce'))).toMatch(/co-signing key: unknown/);
  });

  it('a missing proof is never refused until the role is required', () => {
    const bare = { coSigner: at(1002).coSigner, rescue: { ...at(1002).rescue, proof: null } };
    const heard: { status: string; refused: boolean }[] = [];
    expect(issuedKeysProblem(bare, 'mainnet', 1002, policy('enforce'), (n) => heard.push(n))).toBeNull();
    expect(heard).toEqual([expect.objectContaining({ status: 'missing', refused: false })]);
    expect(issuedKeysProblem(bare, 'mainnet', 1002, policy('enforce', true))).toBe('rescue key: proof missing');
    const legacy = { coSigner: { ...cosPool[0].key }, rescue: { ...resPool[0].key } }; // an older backend: no field at all
    expect(issuedKeysProblem(legacy, 'mainnet', 1000, policy('enforce'))).toBeNull();
  });

  it('an unpinned seed passes on enforce and is refused once required', () => {
    const unpinned: Policy = { ...policy('enforce'), pins: { ...pins, mainnet: { ...pins.mainnet, rescue: { fdcd357b: '' } } } };
    expect(issuedKeysProblem(at(1001), 'mainnet', 1001, unpinned)).toBeNull();
    const required: Policy = { ...unpinned, required: policy('enforce', true).required };
    expect(issuedKeysProblem(at(1001), 'mainnet', 1001, required)).toBe('rescue key: proof unpinned');
  });

  it('a pool signed by another device is refused on enforce', () => {
    const forged = pool(seed('21c rescue'), 'fdcd357b', 'rescue', 1000, 5, testPriv('somebody else'));
    const keys = { coSigner: at(1001).coSigner, rescue: { ...forged[1].key, proof: forged[1].proof } };
    expect(issuedKeysProblem(keys, 'mainnet', 1001, policy('enforce'))).toBe('rescue key: proof invalid (PROOF_WRONG_KEY)');
  });

  it('as shipped, a Testnet4 seed outside the pins is refused, with a sound proof or none', () => {
    // Testnet4 pins no fingerprint in issuedKeyPins.ts: the proof, enforced and
    // required for every role, is what keeps out a seed whose attestation
    // address is not pinned, such as a retired one. Made-up seed and signer.
    const [served] = pool(seed('a test seed that is not pinned', TPUB), '0a0a0a02', 'rescue', 1000, 2, testPriv('an unpinned attestation key'), 1);
    // The proof itself is sound; only its pin is missing.
    expect(ka.checkKeyProof({ key: served.key, proof: served.proof, network: 'testnet4', purpose: 'rescue' })).toEqual({
      status: 'unpinned',
      code: null,
    });
    const heard: { status: string; refused: boolean }[] = [];
    expect(issuedKeysProblem({ rescue: { ...served.key, proof: served.proof } }, 'testnet4', 1000, undefined, (n) => heard.push(n))).toBe(
      'rescue key: proof unpinned',
    );
    expect(heard).toEqual([expect.objectContaining({ status: 'unpinned', refused: true })]);
    expect(issuedKeysProblem({ rescue: served.key }, 'testnet4', 1000)).toBe('rescue key: proof missing');
  });

  it('both keys are noted before the first refusal', () => {
    const bad = { coSigner: { ...at(1001).coSigner, proof: 'x' }, rescue: { ...at(1001).rescue, proof: 'y' } };
    const notes: { purpose: string }[] = [];
    expect(issuedKeysProblem(bad, 'mainnet', 1001, policy('enforce'), (n) => notes.push(n))).toBe(
      'co-signing key: proof invalid (PROOF_FORMAT)',
    );
    expect(notes.map((n) => n.purpose)).toEqual(['cosigner', 'rescue']);
  });

  it('the build as shipped refuses nothing a client gets today', () => {
    // Default switches (keyAttestationPins.ts): whatever is set there, a key
    // without a proof is never refused unless that role is required.
    const legacy = { coSigner: { ...cosPool[0].key }, rescue: { ...resPool[0].key } };
    const req = ka.KEY_PROOF_POLICY.required.mainnet;
    if (!req.cosigner && !req.rescue) expect(issuedKeysProblem(legacy, 'mainnet', 1000)).toBeNull();
  });
});
