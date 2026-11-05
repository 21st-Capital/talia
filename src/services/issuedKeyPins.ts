/**
 * What the app checks on the 21st Capital keys the backend hands over for a
 * NEW vault, before either goes into its descriptor (decided
 * 2026-09-26).
 *
 * The co-signer and rescue keys arrive from /api/vaults/next-vault-keys/
 * and used to be taken as sent. The rescue key alone spends every coin once
 * its lock opens, so a key swapped in on the way (a compromised backend, a
 * pool imported under the wrong purpose, an intercepted connection) would
 * sweep the vault later with nothing looking wrong.
 *
 * This is the part the app can prove on its own today, and it only ever
 * stops a NEW vault from being built on a wrong key: existing vaults are
 * never read here, and the client's own keys are never touched.
 *  - Each key is a well-formed extended public key of the vault's network,
 *    at depth four.
 *  - Its origin path is the multisig purpose 48'/coin'/account'/2', with
 *    the network's coin type.
 *  - On Bitcoin, the co-signer must come from 21st Capital's live
 *    co-signing seed and the rescue key from its live rescue seed (pinned
 *    here by fingerprint), so the two can never be swapped or replaced by
 *    another seed. Test networks are rotated often and are not pinned here.
 *  - A seed that is not pinned never places a key: on Bitcoin the
 *    fingerprint pins below refuse it whatever the proof switches say, and
 *    on both networks the device-signed proof, enforced and required for
 *    every role, refuses a key whose seed has no pinned attestation address
 *    (keyAttestationPins.ts). A retired seed is refused by having its pins
 *    removed; no list of retired seeds is kept in the app.
 *
 * What the fingerprint cannot prove: that the xpub under a pinned
 * fingerprint really is 21st Capital's (the account key is hardened, so it
 * cannot be tied to the master fingerprint). The device-signed per-key proof
 * does (keyAttestation.ts): it is checked here too, on
 * every key received, once its mode is turned on in keyAttestationPins.ts.
 * This function is the ONE gate before a 21C key is placed in a new vault,
 * so new vaults, rebuilds of a vault slot and vault holders' builds are all
 * covered by it.
 *
 * WHEN 21st Capital MOVES TO A NEW SEED, add its fingerprint here in the
 * same release that starts issuing from it, or new Bitcoin vaults stop, and
 * remove the old one here and in keyAttestationPins.ts.
 */
import { sha256 } from '@noble/hashes/sha256';
import { createBase58check } from '@scure/base';
import { KEY_PROOF_POLICY, judgeKeyProof } from './keyAttestation';
import type { KeyProofPolicy, ProofCode, ProofStatus } from './keyAttestation';

const base58check = createBase58check(sha256);

/** 21st Capital's live Bitcoin seeds, by role (fingerprints, lowercase). */
export const PINNED_21C_MAINNET = {
  coSigner: ['bb09d891'],
  rescue: ['fdcd357b'],
} as const;

const MAINNET_VERSIONS = new Set([0x0488b21e, 0x049d7cb2, 0x04b24746, 0x0295b43f, 0x02aa7ed3]);
const TESTNET_VERSIONS = new Set([0x043587cf, 0x044a5262, 0x045f1cf6, 0x024289ef, 0x02575483]);

export interface IssuedKey {
  fingerprint: string;
  originPath: string;
  xpub: string;
  /** The device-signed proof the backend sent with the key, raw (null or
   *  absent = none). Read only by keyAttestation.ts. */
  proof?: unknown;
}

type Net = 'mainnet' | 'testnet4';

/** A proof that did not verify, for the log and our team's report. It
 *  carries no key material: purpose, status, code and one line of text. */
export interface KeyProofNote {
  purpose: 'cosigner' | 'rescue';
  status: ProofStatus;
  code: ProofCode | null;
  text: string;
  /** True when this key's proof is what refuses the build (enforce). */
  refused: boolean;
}

function keyProblem(key: IssuedKey, network: Net, role: 'coSigner' | 'rescue'): string | null {
  const fp = key.fingerprint.toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(fp)) return 'unreadable fingerprint';
  let bytes: Uint8Array;
  try {
    bytes = base58check.decode(key.xpub.trim());
  } catch {
    return 'unreadable key';
  }
  if (bytes.length !== 78) return 'unreadable key';
  const version = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  const versions = network === 'mainnet' ? MAINNET_VERSIONS : TESTNET_VERSIONS;
  if (!versions.has(version)) return 'key of another network';
  if (bytes[4] !== 4) return 'key at the wrong depth';
  if (key.originPath) {
    const m = /^(?:m\/)?48['h]\/(\d+)['h]\/(\d+)['h]\/2['h]$/i.exec(key.originPath.trim());
    if (!m) return 'key for another purpose';
    if (Number(m[1]) !== (network === 'mainnet' ? 0 : 1)) return 'key of another network';
  }
  if (network === 'mainnet' && !(PINNED_21C_MAINNET[role] as readonly string[]).includes(fp)) {
    return `unknown ${role === 'coSigner' ? 'co-signing' : 'rescue'} seed ${fp}`;
  }
  return null;
}

/**
 * Null when the issued keys may go into a new vault, else the reason (for
 * the diagnostic line, never shown as the dialog's words).
 *
 * `account` is the account the backend named for this vault; each key's
 * proof must be for that account. `onNote` hears every proof that did not
 * verify while the mode is report or enforce (never an xpub in it); what
 * refuses is decided by `policy`, the build's switches by default.
 */
export function issuedKeysProblem(
  issued: { coSigner?: IssuedKey; rescue?: IssuedKey },
  network: Net,
  account?: number | null,
  policy: KeyProofPolicy = KEY_PROOF_POLICY,
  onNote?: (note: KeyProofNote) => void,
): string | null {
  const { coSigner, rescue } = issued;
  if (coSigner) {
    const p = keyProblem(coSigner, network, 'coSigner');
    if (p) return `co-signing key: ${p}`;
  }
  if (rescue) {
    const p = keyProblem(rescue, network, 'rescue');
    if (p) return `rescue key: ${p}`;
  }
  if (coSigner && rescue) {
    // Always two seeds on two devices: one key must never be both.
    if (coSigner.fingerprint.toLowerCase() === rescue.fingerprint.toLowerCase()) {
      return 'the co-signing and rescue keys come from the same seed';
    }
    if (coSigner.xpub.trim() === rescue.xpub.trim()) return 'the co-signing and rescue keys are the same key';
  }
  // The device-signed proof of each key (decided 2026-09-26). Off until
  // it is switched on; then an invalid proof refuses, and a missing one only
  // once that role is required.
  const roles: Array<[IssuedKey | undefined, 'cosigner' | 'rescue', string]> = [
    [coSigner, 'cosigner', 'co-signing key'],
    [rescue, 'rescue', 'rescue key'],
  ];
  // Both keys are judged (so both notes are heard) before the first refusal.
  let refusal: string | null = null;
  for (const [key, purpose, label] of roles) {
    if (!key) continue;
    const verdict = judgeKeyProof({
      key: { fingerprint: key.fingerprint.toLowerCase(), originPath: key.originPath, xpub: key.xpub },
      proof: key.proof ?? null,
      network,
      purpose,
      account,
      policy,
    });
    if (verdict.note && verdict.result) {
      onNote?.({
        purpose,
        status: verdict.result.status,
        code: verdict.result.code,
        text: verdict.note,
        refused: verdict.refuse,
      });
    }
    if (verdict.refuse && refusal === null) {
      const r = verdict.result;
      refusal = `${label}: proof ${r?.status ?? 'refused'}${r?.code ? ` (${r.code})` : ''}`;
    }
  }
  return refusal;
}
