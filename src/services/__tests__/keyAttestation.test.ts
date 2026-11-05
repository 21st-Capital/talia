/**
 * The per-key proof of 21st Capital's keys (decided 2026-09-26).
 *
 * Two golden sets, both made ONCE with 21st Capital's key tooling
 * and test keys, every xpub a placeholder
 * string; never regenerated, so a change of encoding fails here instead of
 * moving them:
 *  - fixtures/key-proof-vectors.json is the SHARED set
 *    (the key tooling's own set),
 *    copied byte for byte into the backend and here;
 *  - fixtures/key-proof-vectors.talia.json is Talia's extra set (Merkle roots
 *    for 1..40 keys, more refusals), every expectation in it checked by the
 *    tooling's check_key_proof when it was made.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils';
import { base64, hex } from '@scure/base';
import {
  KEY_PROOF_COPY,
  KEY_PROOF_POLICY,
  MAX_PROOF_PATH,
  PROOF_FORMAT,
  checkKeyProof,
  isPinAddress,
  judgeKeyProof,
  keyCheckFailedTitle,
  leafBytes,
  leafHash,
  merkleTree,
  messageHash,
  nodeHash,
  p2pkhAddress,
  parseManifestV2,
  proofModeFor,
  recoverSigner,
  verifyAuditPath,
} from '../keyAttestation';
import type { KeyProofPolicy, ProvenKey } from '../keyAttestation';
import type { AttestationPins, KeyProofMode, ProofNet, ProofPurpose } from '../keyAttestationPins';

interface VectorCase {
  name: string;
  network: ProofNet;
  purpose: ProofPurpose;
  account: number | null;
  pins: 'default' | AttestationPins;
  key: { fingerprint: string; origin_path: string; xpub: string };
  proof: unknown;
  expect: { status: string; code: string | null };
}

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));

/** The tools' placeholder digits: an account number in base58 letters. */
const b58int = (n: number) => {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let out = '';
  do {
    out = A[n % 58] + out;
    n = Math.floor(n / 58);
  } while (n > 0);
  return out;
};
const placeholder = (coin: number, purpose: string, account: number) =>
  `${coin === 0 ? 'xpub' : 'tpub'}TestVector${purpose[0].toUpperCase()}${purpose.slice(1)}Key${b58int(account)}`;

const V = fixture('key-proof-vectors.talia.json') as {
  format: string;
  leaf_example: { row: { account: number; fingerprint: string; xpub: string }; purpose: ProofPurpose; coin: number; bytes_hex: string; hash: string };
  merkle_rows: { seed: string; purpose: ProofPurpose; coin: number; first: number };
  merkle: { count: number; root: string }[];
  pins: AttestationPins;
  trees: {
    name: string;
    network: ProofNet;
    purpose: ProofPurpose;
    seed: string;
    first: number;
    count: number;
    manifest: string;
    root: string;
    leaf_hashes: string[];
  }[];
  cases: VectorCase[];
};

const keyOf = (k: VectorCase['key']): ProvenKey => ({
  fingerprint: k.fingerprint,
  originPath: k.origin_path,
  xpub: k.xpub,
});

/** The shared set, exactly as the tools wrote it. */
interface SharedCase {
  name: string;
  network: ProofNet;
  purpose: ProofPurpose;
  key: { fingerprint: string; origin_path: string; xpub: string; account?: number };
  pins: Record<string, string>;
  proof: unknown;
  expect: { status: string; code: string | null };
}
const S = fixture('key-proof-vectors.json') as {
  proof_format: string;
  codes: string[];
  statuses: string[];
  trees: {
    network: ProofNet;
    purpose: ProofPurpose;
    count: number;
    rows: { account: number; fingerprint: string; xpub: string }[];
    leaves: { text: string; hash: string }[];
    root: string;
    manifest: string;
    proofs: unknown;
  }[];
  cases: SharedCase[];
};

describe('the shared golden vectors (the key tooling\'s own set)', () => {
  it('speak the same contract', () => {
    expect(S.proof_format).toBe(PROOF_FORMAT);
    expect([...S.statuses].sort()).toEqual(['invalid', 'missing', 'unpinned', 'verified']);
    expect(S.codes).toHaveLength(11);
    expect(S.trees.map((t) => t.count)).toEqual([1, 7, 8]);
  });

  it('every leaf, root and manifest, byte for byte', () => {
    for (const t of S.trees) {
      const coin = t.network === 'mainnet' ? 0 : 1;
      const leaves = t.rows.map((r, i) => {
        expect(new TextDecoder().decode(leafBytes(r, t.purpose, coin))).toBe(t.leaves[i].text);
        const h = leafHash(r, t.purpose, coin);
        expect(hex.encode(h)).toBe(t.leaves[i].hash);
        return h;
      });
      expect(hex.encode(merkleTree(leaves).root)).toBe(t.root);
      expect(parseManifestV2(t.manifest)?.count).toBe(t.count);
    }
  });

  it.each(S.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const table = { cosigner: {}, rescue: {}, [c.purpose]: c.pins } as Record<ProofPurpose, Record<string, string>>;
    const pins = { mainnet: { cosigner: {}, rescue: {} }, testnet4: { cosigner: {}, rescue: {} }, [c.network]: table } as AttestationPins;
    const result = checkKeyProof({
      key: { fingerprint: c.key.fingerprint, originPath: c.key.origin_path, xpub: c.key.xpub },
      proof: c.proof,
      network: c.network,
      purpose: c.purpose,
      account: c.key.account ?? null,
      pins,
    });
    expect(result).toEqual({ status: c.expect.status, code: c.expect.code });
  });
});

describe("Talia's golden vectors (made with the key tooling)", () => {
  it('are the vectors this checker was written against', () => {
    expect(V.format).toBe('21c-key-proof-vectors-v1');
    expect(V.trees.map((t) => t.count)).toEqual([1, 7, 8]);
    expect(V.cases.length).toBeGreaterThan(70);
  });

  it('a leaf is seven fixed lines, byte for byte', () => {
    const { row, purpose, coin } = V.leaf_example;
    expect(hex.encode(leafBytes(row, purpose, coin))).toBe(V.leaf_example.bytes_hex);
    expect(hex.encode(leafHash(row, purpose, coin))).toBe(V.leaf_example.hash);
  });

  it('every tree: leaves, root and manifest agree', () => {
    for (const t of V.trees) {
      const coin = t.network === 'mainnet' ? 0 : 1;
      const leaves = Array.from({ length: t.count }, (_, i) =>
        leafHash({ account: t.first + i, fingerprint: t.seed, xpub: placeholder(coin, t.purpose, t.first + i) }, t.purpose, coin),
      );
      expect(leaves.map((h) => hex.encode(h))).toEqual(t.leaf_hashes);
      expect(hex.encode(merkleTree(leaves).root)).toBe(t.root);
      const m = parseManifestV2(t.manifest);
      expect(m).not.toBeNull();
      expect(m && hex.encode(m.root)).toBe(t.root);
      expect(m?.count).toBe(t.count);
    }
  });

  it('Merkle roots for n = 1..40 match the tools', () => {
    const { seed, purpose, coin, first } = V.merkle_rows;
    for (const { count, root } of V.merkle) {
      const leaves = Array.from({ length: count }, (_, i) =>
        leafHash({ account: first + i, fingerprint: seed, xpub: placeholder(coin, purpose, first + i) }, purpose, coin),
      );
      expect(hex.encode(merkleTree(leaves).root)).toBe(root);
    }
  });

  it.each(V.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = checkKeyProof({
      key: keyOf(c.key),
      proof: c.proof,
      network: c.network,
      purpose: c.purpose,
      account: c.account,
      pins: c.pins === 'default' ? V.pins : c.pins,
    });
    expect(result).toEqual({ status: c.expect.status, code: c.expect.code });
  });
});

describe('the Merkle tree (RFC 9162)', () => {
  const leavesOf = (n: number) =>
    Array.from({ length: n }, (_, i) => sha256(utf8ToBytes(`leaf ${i}`)));

  it('every inclusion proof checks out for n = 1..40, and nothing else does', () => {
    for (let n = 1; n <= 40; n++) {
      const leaves = leavesOf(n);
      const { root, paths } = merkleTree(leaves);
      for (let i = 0; i < n; i++) {
        expect(verifyAuditPath(leaves[i], i, n, paths[i], root)).toBe(true);
        // another leaf, another index, a changed hash. (The SIZE is not
        // tested here: RFC 9162 lets a left-edge path check under a larger
        // size, which is why the size comes from the SIGNED manifest.)
        expect(verifyAuditPath(sha256(utf8ToBytes('other')), i, n, paths[i], root)).toBe(false);
        if (n > 1) expect(verifyAuditPath(leaves[i], (i + 1) % n, n, paths[i], root)).toBe(false);
        for (let j = 0; j < paths[i].length; j++) {
          const bad = paths[i].map((h, k) => (k === j ? new Uint8Array(32) : h));
          expect(verifyAuditPath(leaves[i], i, n, bad, root)).toBe(false);
        }
      }
    }
  });

  it('never duplicates the last node', () => {
    const leaves = leavesOf(3);
    const expected = nodeHash(nodeHash(leaves[0], leaves[1]), leaves[2]);
    expect(hex.encode(merkleTree(leaves).root)).toBe(hex.encode(expected));
  });

  it('refuses an index outside the tree and a path longer than 32', () => {
    const leaves = leavesOf(4);
    const { root, paths } = merkleTree(leaves);
    expect(verifyAuditPath(leaves[0], -1, 4, paths[0], root)).toBe(false);
    expect(verifyAuditPath(leaves[0], 4, 4, paths[0], root)).toBe(false);
    expect(verifyAuditPath(leaves[0], 0, 4, Array(MAX_PROOF_PATH + 1).fill(leaves[1]), root)).toBe(false);
    expect(() => merkleTree([])).toThrow();
  });
});

describe('BIP-137 signatures', () => {
  const priv = sha256(utf8ToBytes('Talia unit tests: attestation key, NOT A REAL KEY'));
  const pub = secp256k1.getPublicKey(priv, true);
  const sign = (text: string, header = 31) => {
    const sig = secp256k1.sign(messageHash(text), priv, { lowS: true });
    return base64.encode(concatBytes(new Uint8Array([header + sig.recovery]), sig.toCompactRawBytes()));
  };

  it('recovers the signer from a compressed P2PKH signature', () => {
    expect(hex.encode(recoverSigner('hello', sign('hello')))).toBe(hex.encode(pub));
    expect(hex.encode(recoverSigner('hello', sign('hello'))) === hex.encode(recoverSigner('hellO', sign('hello')))).toBe(false);
  });

  it('refuses high-S, an unknown header and a short signature', () => {
    const raw = base64.decode(sign('hello'));
    const s = BigInt('0x' + hex.encode(raw.slice(33)));
    const highS = secp256k1.CURVE.n - s;
    const flipped = concatBytes(
      new Uint8Array([raw[0] ^ 1]),
      raw.slice(1, 33),
      hex.decode(highS.toString(16).padStart(64, '0')),
    );
    expect(() => recoverSigner('hello', base64.encode(flipped))).toThrow(/high-S/);
    expect(() => recoverSigner('hello', base64.encode(concatBytes(new Uint8Array([43]), raw.slice(1))))).toThrow();
    expect(() => recoverSigner('hello', base64.encode(raw.slice(1)))).toThrow();
  });

  it('a pin is a P2PKH address of its own network only', () => {
    expect(isPinAddress(p2pkhAddress(pub, 0), 0)).toBe(true);
    expect(isPinAddress(p2pkhAddress(pub, 1), 1)).toBe(true);
    expect(isPinAddress(p2pkhAddress(pub, 1), 0)).toBe(false);
    expect(isPinAddress('', 0)).toBe(false);
    expect(isPinAddress('bc1qxyz', 0)).toBe(false);
    expect(isPinAddress(undefined, 0)).toBe(false);
  });
});

describe('the strict manifest', () => {
  const good = V.trees[1].manifest;
  it('reads a good one and refuses every loose variant', () => {
    expect(parseManifestV2(good)).not.toBeNull();
    expect(parseManifestV2(good + '\n')).toBeNull();
    expect(parseManifestV2(good.replace(/\n/g, '\r\n'))).toBeNull();
    expect(parseManifestV2(good.replace('21C key pool v2', '21C key pool v1'))).toBeNull();
    expect(parseManifestV2(good.replace('purpose rescue', 'purpose other'))).toBeNull();
    // another chain is read as written; the CALLER refuses it as PROOF_NETWORK
    expect(parseManifestV2(good.replace("chain 48'/0'", "chain 48'/2'"))?.coin).toBe(2);
    expect(parseManifestV2(good.replace("chain 48'/0'", "chain 48'/00'"))).toBeNull();
    expect(
      parseManifestV2(good.replace('accounts 2001-2007', 'accounts 2147483641-2147483648')),
    ).toBeNull();
    expect(parseManifestV2(good.replace('keys 7', 'keys 6'))).toBeNull();
    expect(parseManifestV2(null)).toBeNull();
  });
});

describe('the mode matrix (keyAttestationPins.ts switches)', () => {
  const n7 = V.cases.find((c) => c.name === 'n7: account 2003 proves') as VectorCase;
  const badPath = V.cases.find((c) => c.name === 'swapped xpub') as VectorCase;
  const unpinnedPins = { mainnet: { cosigner: {}, rescue: {} }, testnet4: { cosigner: {}, rescue: {} } };
  const policy = (mode: KeyProofMode | string, required = false, pins: AttestationPins = V.pins): KeyProofPolicy => ({
    mode: { mainnet: mode as KeyProofMode, testnet4: 'off' },
    required: { mainnet: { cosigner: false, rescue: required }, testnet4: { cosigner: false, rescue: false } },
    pins,
  });
  const judge = (c: VectorCase, p: KeyProofPolicy, proof: unknown = c.proof) =>
    judgeKeyProof({ key: keyOf(c.key), proof, network: 'mainnet', purpose: 'rescue', account: c.account, policy: p });

  it('off looks at nothing', () => {
    expect(judge(badPath, policy('off'))).toEqual({ result: null, refuse: false, note: null });
    expect(judge(n7, policy('off', true), null)).toEqual({ result: null, refuse: false, note: null });
  });

  it('report checks, notes and never refuses', () => {
    expect(judge(n7, policy('report'))).toMatchObject({ refuse: false, note: null, result: { status: 'verified' } });
    expect(judge(badPath, policy('report', true))).toMatchObject({ refuse: false, result: { status: 'invalid', code: 'PROOF_PATH' } });
    expect(judge(badPath, policy('report')).note).toBe('rescue key proof invalid (PROOF_PATH)');
    expect(judge(n7, policy('report', true), null)).toMatchObject({ refuse: false, note: 'rescue key proof missing' });
  });

  it('enforce refuses an invalid proof, never a missing or unpinned one until required', () => {
    expect(judge(n7, policy('enforce')).refuse).toBe(false);
    expect(judge(badPath, policy('enforce')).refuse).toBe(true);
    expect(judge(n7, policy('enforce'), null)).toMatchObject({ refuse: false, result: { status: 'missing' } });
    expect(judge(n7, policy('enforce', false, unpinnedPins))).toMatchObject({ refuse: false, result: { status: 'unpinned' } });
  });

  it('required (the cutover) refuses missing and unpinned too, on enforce only', () => {
    expect(judge(n7, policy('enforce', true), null).refuse).toBe(true);
    expect(judge(n7, policy('enforce', true, unpinnedPins)).refuse).toBe(true);
    expect(judge(n7, policy('enforce', true)).refuse).toBe(false);
  });

  it('a malformed proof is invalid, never missing', () => {
    expect(judge(n7, policy('enforce'), 'garbage')).toMatchObject({ refuse: true, result: { status: 'invalid', code: 'PROOF_FORMAT' } });
    expect(judge(n7, policy('enforce'), {})).toMatchObject({ refuse: true, result: { status: 'invalid' } });
  });

  it('a misspelt mode reads as report, which never refuses', () => {
    expect(proofModeFor(policy('enfroce'), 'mainnet')).toBe('report');
    expect(judge(badPath, policy('enfroce', true)).refuse).toBe(false);
  });

  it('a note never carries key material', () => {
    for (const c of V.cases) {
      const v = judgeKeyProof({
        key: keyOf(c.key),
        proof: c.proof,
        network: c.network,
        purpose: c.purpose,
        account: c.account,
        policy: { ...policy('report'), mode: { mainnet: 'report', testnet4: 'report' } },
      });
      expect(v.note ?? '').not.toContain(c.key.xpub);
      expect(v.note ?? '').not.toMatch(/[xt]pub/);
    }
  });

  it('this build ships with nothing switched on that could refuse a client', () => {
    // Turned on by a later change; until then a client sees exactly what they saw.
    for (const net of ['mainnet', 'testnet4'] as const) {
      expect(['off', 'report', 'enforce']).toContain(KEY_PROOF_POLICY.mode[net]);
    }
    expect(PROOF_FORMAT).toBe('21c-key-proof-v1');
  });
});

describe('the words', () => {
  const all = [...Object.values(KEY_PROOF_COPY.en), ...Object.values(KEY_PROOF_COPY.de)];
  it('never an em or en dash, and German never says Tresor', () => {
    expect(all.filter((s) => /[—–]/.test(s))).toEqual([]);
    expect(all.filter((s) => /tresor/i.test(s))).toEqual([]);
  });
  it('the refusal title is the one any vault shape can read', () => {
    expect(KEY_PROOF_COPY.en.checkFailedTitle).toBe('The 21st Capital key check did not pass');
    expect(KEY_PROOF_COPY.en.checkFailedTitle).not.toMatch(/\byour\b/i);
  });
  it("keeps the old refusal title while a network is not enforced, and the check's own title once it is", () => {
    const today = 'Your 21st Capital keys could not be verified';
    expect(KEY_PROOF_COPY.en.checkFailedTitleBeforeEnforce).toBe(today);
    // This build, as shipped: enforced on both networks since 2026-10-14.
    expect(keyCheckFailedTitle('mainnet')).toBe(KEY_PROOF_COPY.en.checkFailedTitle);
    expect(keyCheckFailedTitle('testnet4')).toBe(KEY_PROOF_COPY.en.checkFailedTitle);
    const policy = (mainnet: string, testnet4: string): KeyProofPolicy => ({
      ...KEY_PROOF_POLICY,
      mode: { mainnet, testnet4 } as unknown as KeyProofPolicy['mode'],
    });
    expect(keyCheckFailedTitle('mainnet', policy('off', 'off'))).toBe(today);
    expect(keyCheckFailedTitle('mainnet', policy('report', 'enforce'))).toBe(today);
    expect(keyCheckFailedTitle('mainnet', policy('enforced', 'off'))).toBe(today);
    expect(keyCheckFailedTitle('testnet4', policy('report', 'enforce'))).toBe(KEY_PROOF_COPY.en.checkFailedTitle);
    expect(keyCheckFailedTitle('mainnet', policy('enforce', 'off'))).toBe(KEY_PROOF_COPY.en.checkFailedTitle);
  });
});
