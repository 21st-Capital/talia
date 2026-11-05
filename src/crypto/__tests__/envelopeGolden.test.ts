/**
 * Golden vectors — the envelope is a CROSS-VERSION wire format: invites
 * sealed today must open in any future app version, and lookupHash must
 * equal what the DEPLOYED backend computes at claim (sha256 over the
 * token's BYTES — heir_views.py). These pins fail on any KDF/salt/layout/
 * JSON drift the round-trip suite cannot see. If one fails you broke
 * compatibility with every invite already stored in production: FIX THE
 * CODE, never the literals (regenerate them only for a deliberate,
 * versioned format change).
 */
import { sha256 } from '@noble/hashes/sha256';

import { lookupHash, lookupToken, openCard, openDescriptor } from '../envelope';

const CODE = 'TALIA-ABCDE-FGH1J-K2MNP-QRSTV';
const HEIR_TPUB =
  'tpubDDXRVY4eRY4p4iqLUQNQokx89YLZEpTyA8UdLVYRMV8HacVdwHRi1TWKMSY3kh8WpNBA4kB4Xet3hCxxVvSw83DZ5fhqiSysSsYCWJ7k79E';

const GOLDEN_TOKEN = '79a17df8107e4be39bfe46d47e28939c04b8f4653006bdff3468571752776e80';
const GOLDEN_HASH = '8b6995ede8c09e474908e3a15d0c7f7879e6cbc7e7cb57b54d877b8218129d94';
// The heir key is a published test key: BIP-32 test vector 1's seed at
// m/86'/1'/0' (master fingerprint 3442193e). Re-sealed on 2026-11-05 with the
// unchanged code, through its own sealing functions, only to replace an
// earlier test key; the format did not change. The card keeps the first wire
// form, with no `access` field, which opens as a keyed card.
const GOLDEN_DESCRIPTOR = "wpkh([3442193e/86h/1h/0h]tpubDDXRVY4eRY4p4iqLUQNQokx89YLZEpTyA8UdLVYRMV8HacVdwHRi1TWKMSY3kh8WpNBA4kB4Xet3hCxxVvSw83DZ5fhqiSysSsYCWJ7k79E/0/*)";

const GOLDEN_CARD_CT =
  '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';

const GOLDEN_DESC_CT =
  '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' +
  'i1GyJdxuFz0Ys4U=';

describe('golden vectors (wire compatibility)', () => {
  it('lookupToken and lookupHash match the pinned literals', () => {
    expect(lookupToken(CODE)).toBe(GOLDEN_TOKEN);
    expect(lookupHash(CODE)).toBe(GOLDEN_HASH);
  });

  it('lookupHash is sha256 over the TOKEN BYTES — the deployed backend contract', () => {
    // Explicit hex→bytes here pins bytes-not-hex-string semantics: the
    // backend computes hashlib.sha256(bytes.fromhex(token)).
    const tokenBytes = Uint8Array.from(
      (lookupToken(CODE).match(/../g) as string[]).map((h) => parseInt(h, 16)),
    );
    const digest = Array.from(sha256(tokenBytes), (x) => x.toString(16).padStart(2, '0')).join('');
    expect(lookupHash(CODE)).toBe(digest);
  });

  it('a card sealed by this exact format opens forever', () => {
    expect(openCard(CODE, GOLDEN_CARD_CT)).toMatchObject({
      v: 1,
      vaultLabel: 'Golden Vault',
      heirName: 'Vector',
      expectedFingerprint: '3442193e',
      heirOriginPath: "86'/1'/0'",
      network: 'testnet',
      mode: 'strict',
    });
  });

  it('a descriptor blob sealed by this exact format opens forever', () => {
    const card = openCard(CODE, GOLDEN_CARD_CT);
    const p = openDescriptor(CODE, card, HEIR_TPUB, GOLDEN_DESC_CT);
    expect(p.descriptor).toBe(GOLDEN_DESCRIPTOR);
    expect(p.vaultLabel).toBe('Golden Vault');
  });
});
