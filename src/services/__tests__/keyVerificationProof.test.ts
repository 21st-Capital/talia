/**
 * The key check on the testing call carries each key's device proof
 * (decided 2026-09-26), for a "proven" mark that is switched on together
 * with enforcement. Nothing here ever withholds a key the client holds.
 */
jest.mock('react-native-keychain', () => ({}));
import { readFileSync } from 'fs';
import { join } from 'path';
import { keyVerificationProof, parseKeyVerificationEntry } from '../keyVerification';
import type { KeyProofPolicy } from '../keyAttestation';
import type { AttestationPins } from '../keyAttestationPins';

const V = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'key-proof-vectors.talia.json'), 'utf8')) as {
  pins: AttestationPins;
  cases: { name: string; key: { fingerprint: string; origin_path: string; xpub: string }; proof: unknown }[];
};
const proven = V.cases.find((c) => c.name === 'n7: account 2003 proves') as (typeof V.cases)[number];

const raw = (over: Record<string, unknown> = {}) => ({
  xpub: proven.key.xpub,
  fingerprint: proven.key.fingerprint.toUpperCase(),
  origin_path: proven.key.origin_path,
  purpose: 'rescue',
  network: 'mainnet',
  is_archived: false,
  client_verified_at: null,
  staff_verified_at: null,
  vault: { vault_id: 'v', vault_number: 3, account: 2003, tested_at: null },
  proof: proven.proof,
  ...over,
});

const policy = (mode: 'off' | 'report' | 'enforce'): KeyProofPolicy => ({
  mode: { mainnet: mode, testnet4: 'off' },
  required: { mainnet: { cosigner: false, rescue: false }, testnet4: { cosigner: false, rescue: false } },
  pins: V.pins,
});

describe('parseKeyVerificationEntry', () => {
  it('keeps the proof raw, null when none was sent', () => {
    expect(parseKeyVerificationEntry(raw())?.proof).toEqual(proven.proof);
    expect(parseKeyVerificationEntry(raw({ proof: undefined }))?.proof).toBeNull();
    expect(parseKeyVerificationEntry(raw({ proof: 'junk' }))?.proof).toBe('junk');
  });
});

describe('keyVerificationProof', () => {
  const entry = parseKeyVerificationEntry(raw())!;

  it('says nothing until the mode is enforce', () => {
    expect(keyVerificationProof(entry, 'mainnet', policy('off'))).toBeNull();
    expect(keyVerificationProof(entry, 'mainnet', policy('report'))).toBeNull();
  });

  it('on enforce: proven, or why not', () => {
    expect(keyVerificationProof(entry, 'mainnet', policy('enforce'))).toEqual({ status: 'verified', code: null });
    const otherAccount = parseKeyVerificationEntry(raw({ vault: { vault_id: 'v', vault_number: 4, account: 2004, tested_at: null } }))!;
    expect(keyVerificationProof(otherAccount, 'mainnet', policy('enforce'))).toEqual({ status: 'invalid', code: 'PROOF_KEY_SHAPE' });
    const asCosigner = parseKeyVerificationEntry(raw({ purpose: 'cosigner' }))!;
    expect(keyVerificationProof(asCosigner, 'mainnet', policy('enforce'))).toEqual({ status: 'invalid', code: 'PROOF_PURPOSE' });
    const none = parseKeyVerificationEntry(raw({ proof: null }))!;
    expect(keyVerificationProof(none, 'mainnet', policy('enforce'))).toEqual({ status: 'missing', code: null });
  });

  it('a key the backend cannot place in a vault is judged by its own origin path', () => {
    const unplaced = parseKeyVerificationEntry(raw({ vault: null }))!;
    expect(keyVerificationProof(unplaced, 'mainnet', policy('enforce'))).toEqual({ status: 'verified', code: null });
  });
});
