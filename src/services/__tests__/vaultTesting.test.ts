/**
 * Is this vault tested, and which vault is it (decided 2026-09-28)?
 *
 * A client imported their vault while signed in, staff marked it tested,
 * and the Receive warning never went away: an imported vault remembers no
 * vault number, so Talia never asked. Its number is on our own key, and the
 * server's answer counts only for the row holding that same account.
 */
// companyAuth touches the iOS Keychain natively; the package ships
// untranspiled ESM that Jest cannot load, and these tests never reach it.
jest.mock('react-native-keychain', () => ({}));

import { fetchVaultTesting } from '../billing';
import { checkVaultTested, testedPatch, vaultTestingQuery } from '../vaultTesting';
import type { TestedVault } from '../vaultTesting';
import type { CompanySession } from '../companyAuth';

/** The vault's internal key: the unspendable one Liana derives from MINE, COSIGN and RESCUE, in tree order. */
const NUMS =
  'tpubD6NzVbkrYhZ4Wu6ZAFhXi5AdQC3pLCzAX6b7Rt48i11CBAwzRWUaUpWC2v1wRL7d2La7U3ZVcxN3bFRAbAjDmoKVtfNDrGoP7PRaM6XEtfJ';
/** A made-up key, derived from BIP-32 test vector 1's seed at m/48'/1'/0'/2'. */
const MINE =
  'tpubDEC8p4skY4i7mNjxt9yF3u7my5T6KtGLcvEDcH5rKA6XVtJN4JV3SsHWoePTqsHNh47WBkQ79r77KsUYc2PAmaqqasBJMvidbxiupZpJexg';
/** Stand-ins for a co-signer and a rescue key, derived from BIP-32 test vectors 2 and 3's seeds at m/48'/1'/0'/2'. */
const COSIGN =
  'tpubDE5D8FnwpqS4CBcArpshds4FyP5GipL6RZCPqd4hyHbT6UCAZotECu3abj2YsvM8d8YQ71pAF32EQPD3D4Dwryu1WkfdMzRTLY5kvEKynNJ';
const RESCUE =
  'tpubDEDJXpGEiMSQCdbt9YYHMuWhzK594qCZB8XpzDGhPBDbWAmUPnXnswEJrNsvCD6dNZGCcnNZ9NmUf5KcS2VsunMzEQPn99bVHxqa5AdwWWr';

/** A 2-of-2 with our co-signer and our rescue key, both at `account`. */
const descriptor = (cosignAccount = '1052', rescueAccount = cosignAccount) =>
  `tr(${NUMS}/<0;1>/*,{multi_a(2,[3442193e/48'/1'/0'/2']${MINE}/<0;1>/*,` +
  `[49578625/48'/1'/${cosignAccount}'/2']${COSIGN}/<0;1>/*),` +
  `and_v(v:pk([01d4b72e/48'/1'/${rescueAccount}'/2']${RESCUE}/<0;1>/*),older(4))})`;

/** How the import saves a vault holding our keys: the tag, nothing else. */
const imported = (over: Partial<TestedVault> = {}): TestedVault => ({
  descriptor: descriptor(),
  providerKeyFingerprints: ['49578625', '01d4b72e'],
  ...over,
});

const session = { accessToken: 't', email: 'client@example.com' } as unknown as CompanySession;

/** The backend's testing-status answer, shaped as VaultTestingStatusView sends it. */
function serverSays(body: Record<string, unknown>): jest.Mock {
  const fn = jest.fn(async () => ({ ok: true, status: 200, json: async () => body }) as never);
  (globalThis as unknown as { fetch: unknown }).fetch = fn;
  return fn;
}
const TESTED = '2026-09-27T14:05:00+00:00';
const row = (account: number, testedAt: string | null, vaultNumber = 2) => ({
  portfolio_id: 'p-latest',
  vaults: [{ vault_index: 0, tested_at: TESTED }],
  vault: { vault_number: vaultNumber, account, tested_at: testedAt },
});

describe('which vault Talia asks about', () => {
  it('reads an imported vault’s number off our own key', () => {
    expect(vaultTestingQuery(imported())).toEqual({ vaultNumber: 2, account: 1052 });
    expect(vaultTestingQuery(imported({ descriptor: descriptor('1040') }))).toEqual({
      vaultNumber: 10,
      account: 1040,
    });
  });

  it('matches the tag whatever its case', () => {
    expect(vaultTestingQuery(imported({ providerKeyFingerprints: ['49578625'.toUpperCase()] }))).toEqual({
      vaultNumber: 2,
      account: 1052,
    });
  });

  it('keeps asking a vault Talia built by the number it remembers, as before', () => {
    expect(vaultTestingQuery(imported({ vaultNumber: 3, portfolioId: 'p1' }))).toEqual({
      portfolioId: 'p1',
      vaultNumber: 3,
    });
    expect(vaultTestingQuery(imported({ portfolioId: 'p1' }))).toEqual({ portfolioId: 'p1', vaultNumber: undefined });
    expect(vaultTestingQuery(imported({ vaultNumber: 1 }))).toEqual({ portfolioId: undefined, vaultNumber: 1 });
  });

  it('sends the account a built vault remembers beside its number', () => {
    // A family member's vault 2 of the payer's plan (block 1000), built on
    // a phone whose owner has a vault 2 of their own too.
    const built = imported({ portfolioId: 'payer-p', vaultNumber: 2, accountNumber: 1002 });
    expect(vaultTestingQuery(built)).toEqual({ portfolioId: 'payer-p', vaultNumber: 2, account: 1002 });
    // An older vault asked by its portfolio alone keeps the portfolio's
    // answer: no account, which that answer could never match.
    expect(vaultTestingQuery(imported({ portfolioId: 'p1', accountNumber: 1041 }))).toEqual({
      portfolioId: 'p1',
      vaultNumber: undefined,
    });
  });

  it('asks nothing about a vault with no key of ours, a locked vault or an heir’s copy', () => {
    expect(vaultTestingQuery(imported({ providerKeyFingerprints: undefined }))).toBeNull();
    expect(vaultTestingQuery(imported({ providerKeyFingerprints: [] }))).toBeNull();
    expect(vaultTestingQuery(imported({ locked: true }))).toBeNull();
    expect(vaultTestingQuery(imported({ heirVault: true }))).toBeNull();
  });

  it('never guesses: the old shared key names no vault, and disagreeing keys name none', () => {
    expect(vaultTestingQuery(imported({ descriptor: descriptor('0') }))).toBeNull();
    expect(vaultTestingQuery(imported({ descriptor: descriptor('1') }))).toBeNull();
    expect(vaultTestingQuery(imported({ descriptor: descriptor('1052', '1053') }))).toBeNull();
    expect(vaultTestingQuery(imported({ descriptor: 'not a descriptor' }))).toBeNull();
  });
});

describe('the server’s answer for a vault named by the account on our key', () => {
  it('asks by the vault number and the account, never by the latest portfolio', async () => {
    const fn = serverSays(row(1052, TESTED));
    await fetchVaultTesting(session, undefined, 2, 1052);
    const url = String(fn.mock.calls[0][0]);
    expect(url).toContain('vault_number=2');
    expect(url).toContain('account=1052');
    expect(url).not.toContain('portfolio_id');
  });

  it('sends no account when none is given', async () => {
    const fn = serverSays(row(1052, TESTED));
    await fetchVaultTesting(session, 'p1', 2);
    expect(String(fn.mock.calls[0][0])).not.toContain('account=');
  });

  it('takes the answer of the row that holds the same account', async () => {
    serverSays(row(1052, TESTED));
    await expect(fetchVaultTesting(session, undefined, 2, 1052)).resolves.toEqual({
      testedAt: TESTED,
      known: true,
    });
    serverSays(row(1052, null));
    await expect(fetchVaultTesting(session, undefined, 2, 1052)).resolves.toEqual({
      testedAt: null,
      known: true,
    });
  });

  it('refuses another vault 2: a different account is not a verdict about this one', async () => {
    serverSays(row(1162, TESTED));
    await expect(fetchVaultTesting(session, undefined, 2, 1052)).resolves.toEqual({
      testedAt: null,
      known: false,
    });
  });

  it('knows nothing when no row answers', async () => {
    serverSays({ portfolio_id: null, vaults: [], vault: null });
    await expect(fetchVaultTesting(session, undefined, 2, 1052)).resolves.toEqual({
      testedAt: null,
      known: false,
    });
  });

  it('never borrows the portfolio-wide answer of an older server', async () => {
    serverSays({ portfolio_id: 'p-latest', vaults: [{ vault_index: 0, tested_at: TESTED }] });
    await expect(fetchVaultTesting(session, undefined, 2, 1052)).resolves.toEqual({
      testedAt: null,
      known: false,
    });
    // A vault Talia built still gets the old answer, exactly as before.
    serverSays({ portfolio_id: 'p1', vaults: [{ vault_index: 0, tested_at: TESTED }] });
    await expect(fetchVaultTesting(session, 'p1')).resolves.toEqual({ testedAt: TESTED, known: true });
  });
});

describe('what the answer changes on the vault', () => {
  it('stamps a newly tested vault', () => {
    expect(testedPatch(undefined, { testedAt: TESTED, known: true })).toEqual({
      vaultTestedAt: Date.parse(TESTED),
    });
  });

  it('leaves a vault that already knows alone', () => {
    expect(testedPatch(123, { testedAt: TESTED, known: true })).toBeNull();
    expect(testedPatch(undefined, { testedAt: null, known: true })).toBeNull();
  });

  it('clears the stamp only on a KNOWN "not tested" (staff set it back)', () => {
    expect(testedPatch(123, { testedAt: null, known: true })).toEqual({ vaultTestedAt: undefined });
    expect(testedPatch(123, { testedAt: null, known: false })).toBeNull();
  });
});

describe('a family member with a plan of their own (decided 2026-09-28)', () => {
  it('takes the payer’s vault 2, never their own vault 2', async () => {
    const vault = imported({ portfolioId: 'payer-p', vaultNumber: 2, accountNumber: 1002 });
    // A server that looks the row up by account answers for the right one.
    serverSays(row(1002, TESTED));
    await expect(checkVaultTested(session, vault)).resolves.toEqual({ vaultTestedAt: Date.parse(TESTED) });
    // One that answers for their own vault 2 is not believed.
    serverSays(row(1012, null));
    await expect(checkVaultTested(session, { ...vault, vaultTestedAt: 123 })).resolves.toBeNull();
  });
});

describe('Decided 2026-09-28: an imported vault that staff marked tested', () => {
  it('loses its warning once Talia asks', async () => {
    const fn = serverSays(row(1052, TESTED));
    await expect(checkVaultTested(session, imported())).resolves.toEqual({
      vaultTestedAt: Date.parse(TESTED),
    });
    expect(String(fn.mock.calls[0][0])).toContain('vault_number=2');
  });

  it('asks nothing for a vault Talia cannot name', async () => {
    const fn = serverSays(row(1052, TESTED));
    await expect(checkVaultTested(session, imported({ descriptor: descriptor('0') }))).resolves.toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });
});
