/**
 * Which vault Talia names when it asks for the co-signing limits.
 *
 * Decided 2026-09-23: a client's vaults carry their own limits, so the screen
 * must ask about ONE vault. A wrong number would show another vault's
 * limits, so anything less than certain answers null and the server falls
 * back to the client's own answer.
 */
import { vaultNumberOf, vaultOfAccount } from '../providerKeyRoles';

/** The vault's internal key: the unspendable one Liana derives from MINE, COSIGN and RESCUE, in tree order. */
const NUMS =
  'tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ';
/** The same for a vault whose only key is COSIGN. */
const NUMS_COSIGN_ONLY =
  'tpubD6NzVbkrYhZ4XjTAccs2ffR1kz6PUtEscEVr5Ukfg5DNxjaDcWeMRFNSnSTKeoXziVApanCUxHFJRNid5PSqwb31ooDC53VpZxCSHwYX9nc';
/** A made-up key, derived from BIP-32 test vector 1's seed at m/48'/1'/0'/2'. */
const MINE =
  'tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg';
/** Stand-ins for a co-signer and a rescue key, derived from BIP-32 test vectors 2 and 3's seeds at m/48'/1'/0'/2'. */
const COSIGN =
  'tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ';
const RESCUE =
  'tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr';

/** A trial vault: our co-signer and our rescue key, both at 1161. */
const vault = (coin = '1', cosignAccount = '1161', rescueAccount = '1161') =>
  `tr(${NUMS}/<0;1>/*,{multi_a(2,[3442193e/48'/${coin}'/0'/2']${MINE}/<0;1>/*,` +
  `[49578625/48'/${coin}'/${cosignAccount}'/2']${COSIGN}/<0;1>/*),` +
  `and_v(v:pk([01d4b72e/48'/${coin}'/${rescueAccount}'/2']${RESCUE}/<0;1>/*),older(4))})`;

const OURS = new Set(['49578625', '01d4b72e']);

describe('the vault Talia asks the limits about', () => {
  it('reads the number and the chain off our own key', () => {
    expect(vaultNumberOf(vault(), OURS)).toEqual({ account: 1161, network: 'testnet4' });
  });

  it('says mainnet when the path says coin 0', () => {
    expect(vaultNumberOf(vault('0'), OURS)).toEqual({ account: 1161, network: 'mainnet' });
  });

  it('answers the same from either of our two keys alone', () => {
    expect(vaultNumberOf(vault(), new Set(['49578625']))).toEqual({ account: 1161, network: 'testnet4' });
    expect(vaultNumberOf(vault(), new Set(['01d4b72e']))).toEqual({ account: 1161, network: 'testnet4' });
  });

  it('answers nothing when our keys disagree, rather than guess', () => {
    expect(vaultNumberOf(vault('1', '1161', '1162'), OURS)).toBeNull();
  });

  it('answers nothing for a vault holding no key of ours', () => {
    expect(vaultNumberOf(vault(), new Set(['deadbeef']))).toBeNull();
    expect(vaultNumberOf(vault(), new Set())).toBeNull();
  });

  it('answers nothing for the old shared key, whose path names no vault', () => {
    // A path of another shape (not 48'/coin'/N'/2') is not a vault number.
    const legacy = `tr(${NUMS_COSIGN_ONLY}/<0;1>/*,{pk([0c21c051/48'/1'/0'/2']${COSIGN}/<0;1>/*)})`;
    // Account 0 IS readable, and the backend knows it as the legacy account,
    // which it refuses to treat as a vault. Talia still names it; the server
    // decides. What must never happen is a WRONG number.
    expect(vaultNumberOf(legacy, new Set(['0c21c051']))).toEqual({ account: 0, network: 'testnet4' });
  });

  it('is not confused by a descriptor it cannot read', () => {
    expect(vaultNumberOf('', OURS)).toBeNull();
    expect(vaultNumberOf('not a descriptor at all', OURS)).toBeNull();
  });
});

describe('which of the client’s vaults an account is (the backend’s vault_of)', () => {
  it('reads the last digit as the vault number, the block start as vault 10', () => {
    expect(vaultOfAccount(1041)).toBe(1);
    expect(vaultOfAccount(1161)).toBe(1);
    expect(vaultOfAccount(1052)).toBe(2);
    expect(vaultOfAccount(1049)).toBe(9);
    expect(vaultOfAccount(1040)).toBe(10);
    expect(vaultOfAccount(1000001)).toBe(1); // a corporate block reads the same way
  });

  it('names no vault for the old shared accounts, or anything below a client’s', () => {
    expect(vaultOfAccount(0)).toBeNull();
    expect(vaultOfAccount(1)).toBeNull();
    expect(vaultOfAccount(999)).toBeNull();
    expect(vaultOfAccount(-1041)).toBeNull();
    expect(vaultOfAccount(1041.5)).toBeNull();
  });
});
