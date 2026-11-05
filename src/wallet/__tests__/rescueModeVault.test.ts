/**
 * Rescue mode is switched on for ONE vault (decided 2026-09-26
 * and 2026-10-05). The server names it by the account number of our
 * key in the vault and the chain by the coin; Talia reads the same number
 * off the same key and offers the rescue for that vault alone.
 */
import {
  ourVaultNumbers,
  rescueModeCovers,
  rescueModeVaultFrom,
  rescueModeVaultName,
  rescueNetwork,
} from '../rescueModeVault';
import { rescueModeLapsed } from '../rescueReadiness';

/** The vault's internal key: the unspendable one Liana derives from MINE, COSIGN and RESCUE, in tree order. */
const NUMS =
  'tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ';
/** The same for a vault whose tree holds RESCUE first, then MINE and COSIGN. */
const NUMS_RESCUE_FIRST =
  'tpubD6NzVbkrYhZ4WXqxiVykrT1RH9b9BANTNVCLKUwbVhPy3R9br1WRAEECA62dj5Lw3wUDoRpbmnjkgPomUmBCnewzGRYZq3gbz7QPzfXbHfc';
/** A made-up key, derived from BIP-32 test vector 1's seed at m/48'/1'/0'/2'. */
const MINE =
  'tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg';
/** Stand-ins for a co-signer and a rescue key, derived from BIP-32 test vectors 2 and 3's seeds at m/48'/1'/0'/2'. */
const COSIGN =
  'tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ';
const RESCUE =
  'tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr';

/** A vault with our co-signer and our rescue key, by default both at 1161. */
const vault = (coin = '1', cosignAccount = '1161', rescueAccount = '1161') =>
  `tr(${NUMS}/<0;1>/*,{multi_a(2,[3442193e/48'/${coin}'/0'/2']${MINE}/<0;1>/*,` +
  `[49578625/48'/${coin}'/${cosignAccount}'/2']${COSIGN}/<0;1>/*),` +
  `and_v(v:pk([01d4b72e/48'/${coin}'/${rescueAccount}'/2']${RESCUE}/<0;1>/*),older(4))})`;

const OURS = new Set(['49578625', '01d4b72e']);
const bound = (account: number, network: 'mainnet' | 'testnet4' = 'testnet4') => ({ account, network, label: '' });

describe('which vault rescue mode is on for', () => {
  it('covers the vault whose key of ours sits at that account, on that chain', () => {
    expect(rescueModeCovers(bound(1161), vault(), OURS)).toBe(true);
    expect(rescueModeCovers(bound(1161, 'mainnet'), vault('0'), OURS)).toBe(true);
  });

  it('does not cover another vault of the same client', () => {
    expect(rescueModeCovers(bound(1162), vault(), OURS)).toBe(false);
  });

  it('does not cover the same number on the other chain', () => {
    // A rehearsal vault must never stand in for the real one.
    expect(rescueModeCovers(bound(1161, 'mainnet'), vault('1'), OURS)).toBe(false);
    expect(rescueModeCovers(bound(1161, 'testnet4'), vault('0'), OURS)).toBe(false);
  });

  it('does not cover a vault that holds no key of ours, or one it cannot read', () => {
    expect(rescueModeCovers(bound(1161), vault(), new Set(['deadbeef']))).toBe(false);
    expect(rescueModeCovers(bound(1161), 'not a descriptor', OURS)).toBe(false);
  });

  it('a vault whose keys of ours name two vaults is neither', () => {
    expect(rescueModeCovers(bound(1161), vault('1', '1161', '1162'), OURS)).toBe(false);
    expect(rescueModeCovers(bound(1162), vault('1', '1161', '1162'), OURS)).toBe(false);
  });

  it('the numbered key decides when an old shared key sits beside it, as on the server', () => {
    // Co-signer on the old shared account 0, rescue key numbered.
    const mixed = vault('1', '0', '1161');
    expect(rescueModeCovers(bound(1161), mixed, OURS)).toBe(true);
    expect(rescueModeCovers(bound(0), mixed, OURS)).toBe(false);
  });

  it('a vault of only the old shared keys is never offered, as on the server', () => {
    // Co-signer at the shared account 0, rescue key at 1. The old shared
    // keys name no single vault: the server cannot switch rescue mode on for
    // them (VAULT_NOT_BINDABLE) and refuses a request naming only them
    // (RESCUE_WRONG_VAULT), whatever number it is on for (cross-check
    // 2026-10-05).
    const legacy = vault('1', '0', '1');
    expect(rescueModeCovers(bound(0), legacy, OURS)).toBe(false);
    expect(rescueModeCovers(bound(1), legacy, OURS)).toBe(false);
    expect(rescueModeCovers(bound(1161), legacy, OURS)).toBe(false);
  });

  it('a vault of only the old shared keys is not offered in either key order', () => {
    // Rescue key written before the co-signer.
    const rescueFirst =
      `tr(${NUMS_RESCUE_FIRST}/<0;1>/*,{and_v(v:pk([01d4b72e/48'/1'/1'/2']${RESCUE}/<0;1>/*),older(4)),` +
      `multi_a(2,[3442193e/48'/1'/0'/2']${MINE}/<0;1>/*,[49578625/48'/1'/0'/2']${COSIGN}/<0;1>/*)})`;
    expect(rescueModeCovers(bound(1), rescueFirst, OURS)).toBe(false);
    expect(rescueModeCovers(bound(0), rescueFirst, OURS)).toBe(false);
  });

  it('a server that names no vault (older than the one-vault rule) decides for itself', () => {
    expect(rescueModeCovers(null, vault(), OURS)).toBe(true);
  });

  it('reads every distinct place our keys sit', () => {
    expect(ourVaultNumbers(vault(), OURS)).toEqual([{ account: 1161, network: 'testnet4' }]);
    expect(ourVaultNumbers(vault('0', '0', '1161'), OURS)).toEqual([
      { account: 0, network: 'mainnet' },
      { account: 1161, network: 'mainnet' },
    ]);
  });
});

describe('the vault field of GET rescue/mode/', () => {
  it('is read strictly', () => {
    expect(rescueModeVaultFrom({ account: 1161, network: 'testnet4', label: 'Vault 1' })).toEqual({
      account: 1161,
      network: 'testnet4',
      label: 'Vault 1',
    });
    expect(rescueModeVaultFrom({ account: 1042, network: 'mainnet' })).toEqual({
      account: 1042,
      network: 'mainnet',
      label: '',
    });
    expect(rescueModeVaultFrom(null)).toBeNull();
    expect(rescueModeVaultFrom({ account: '1161', network: 'testnet4' })).toBeNull();
    expect(rescueModeVaultFrom({ account: 1161, network: 'signet' })).toBeNull();
    expect(rescueModeVaultFrom({ account: -1, network: 'mainnet' })).toBeNull();
  });

  it('takes the chain as staff may type it', () => {
    expect(rescueNetwork('testnet')).toBe('testnet4');
    expect(rescueNetwork('TESTNET4')).toBe('testnet4');
    expect(rescueNetwork('mainnet')).toBe('mainnet');
    expect(rescueNetwork('bitcoin')).toBe('mainnet');
    expect(rescueNetwork('')).toBeNull();
  });
});

describe('what the vault rescue mode is on for is called', () => {
  const phone = [
    { label: 'Savings', descriptor: vault('0', '1161', '1161'), providerKeyFingerprints: ['49578625', '01D4B72E'] },
    { label: 'Family', descriptor: vault('0', '1162', '1162'), providerKeyFingerprints: ['49578625', '01d4b72e'] },
  ];

  it('by the client’s own name when this phone holds it', () => {
    expect(rescueModeVaultName({ account: 1162, network: 'mainnet', label: 'Vault 2' }, phone)).toBe('Family');
    const rehearsal = [{ label: 'Trial', descriptor: vault('1'), providerKeyFingerprints: ['49578625', '01d4b72e'] }];
    expect(rescueModeVaultName({ account: 1161, network: 'testnet4', label: 'Vault 1' }, rehearsal)).toBe(
      'Trial (test network)',
    );
  });

  it('by our name for it when it is not on this phone, marked on the test network', () => {
    expect(rescueModeVaultName({ account: 1163, network: 'mainnet', label: 'Vault 3' }, phone)).toBe('Vault 3');
    expect(rescueModeVaultName({ account: 1161, network: 'testnet4', label: 'Vault 1' }, phone)).toBe(
      'Vault 1 (test network)',
    );
  });

  it('by nothing when nobody can say', () => {
    expect(rescueModeVaultName({ account: 0, network: 'mainnet', label: '' }, phone)).toBeNull();
    expect(rescueModeVaultName(null, phone)).toBeNull();
  });
});

describe('the app resets rescue mode only on the vault it is for', () => {
  // The screen keeps the checks of the vaults rescue mode covers and asks
  // rescueModeLapsed of those alone.
  const ACTIVATED = '2026-10-05T10:00:00Z';
  const after = Date.parse(ACTIVATED) + 60_000;
  const ready = { state: 'ready' as const, sats: 1, coins: [] };
  const waiting = { state: 'waiting' as const, blocks: 10 };
  const lapsedFor = (
    checks: Array<{ descriptor: string; result: typeof ready | typeof waiting }>,
    on: { account: number; network: 'mainnet' | 'testnet4'; label: string } | null,
  ) =>
    rescueModeLapsed(
      checks
        .filter((c) => rescueModeCovers(on, c.descriptor, OURS))
        .map((c) => ({ result: c.result, oldestArrival: after })),
      ACTIVATED,
    );

  it('another vault refreshed says nothing about the one being rescued', () => {
    expect(lapsedFor([{ descriptor: vault('1', '1161', '1161'), result: ready }, { descriptor: vault('1', '1162', '1162'), result: waiting }], bound(1161))).toBe(false);
  });

  it('the vault being rescued refreshed ends it', () => {
    expect(lapsedFor([{ descriptor: vault('1', '1161', '1161'), result: waiting }, { descriptor: vault('1', '1162', '1162'), result: ready }], bound(1161))).toBe(true);
  });

  it('a phone that does not hold that vault judges nothing', () => {
    expect(lapsedFor([{ descriptor: vault('1', '1162', '1162'), result: waiting }], bound(1161))).toBe(false);
  });
});
