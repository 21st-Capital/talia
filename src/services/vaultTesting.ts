/**
 * Is this vault tested? Staff mark a vault tested after the testing session
 * with the client (decided 2026-07-21). Until then the Receive screen warns that
 * the plan does not cover it, a co-sign request says so, and the key check
 * is offered. The vault caches the answer (`vaultTestedAt`) and asks the
 * server again whenever the vault or its Receive screen opens.
 *
 * Which vault to ask about is the hard part. A vault Talia BUILT remembers
 * its number (older ones their portfolio). An IMPORTED vault remembers
 * neither, so it was never asked at all and kept its warning after staff
 * had tested it (decided 2026-09-28). Its number is on our own key: the account
 * in the key's path is the client's block plus the vault's number, the same
 * way the backend reads a key back to its vault.
 */
import type { WalletMeta } from '../wallet/types';
import { vaultNumberOf, vaultOfAccount } from '../wallet/providerKeyRoles';
import { fetchVaultTesting } from './billing';
import type { VaultTestingStatus } from './billing';
import type { CompanySession } from './companyAuth';

export type TestedVault = Pick<
  WalletMeta,
  | 'descriptor'
  | 'providerKeyFingerprints'
  | 'portfolioId'
  | 'vaultNumber'
  | 'accountNumber'
  | 'vaultTestedAt'
  | 'locked'
  | 'heirVault'
>;

export interface VaultTestingQuery {
  portfolioId?: string;
  vaultNumber?: number;
  /** The account the answering row must hold: read off our key in an
   *  imported vault, remembered beside the number in a built one. */
  account?: number;
}

/**
 * What to ask the server about this vault, or null when there is nothing to
 * ask: no key of ours in it (a self-custodial vault is nobody's to test), a
 * locked vault, an heir's copy (the heir never bought it), or a vault that
 * cannot be named without a guess. Unnamed, the backend would answer for
 * the account's LATEST portfolio, which let unrelated vaults borrow its
 * tested badge (found in a phone test, 2026-07-26).
 */
export function vaultTestingQuery(w: TestedVault): VaultTestingQuery | null {
  const ours = (w.providerKeyFingerprints ?? []).map((f) => f.toLowerCase());
  if (ours.length === 0 || w.locked || w.heirVault) return null;
  // Remembered from building it: named by its number since 2026-09-03 (one
  // paid portfolio holds every vault the client builds), or by its
  // portfolio for older vaults. A number without a portfolio (Lifetime
  // Elite, a test account) is still asked. The account goes with the
  // number: a family member with a plan of their own holds a vault 2 of
  // their own AND the vault 2 of the payer's plan, and only the account
  // tells them apart (decided 2026-09-28). Never with a portfolio alone, whose
  // answer an older vault still takes as its own.
  if (w.portfolioId || w.vaultNumber != null) {
    return {
      portfolioId: w.portfolioId,
      vaultNumber: w.vaultNumber,
      account: w.vaultNumber != null ? w.accountNumber : undefined,
    };
  }
  const found = vaultNumberOf(w.descriptor, new Set(ours));
  const vaultNumber = found ? vaultOfAccount(found.account) : null;
  if (!found || vaultNumber == null) return null;
  return { vaultNumber, account: found.account };
}

/**
 * The change the server's answer makes to the cached state, or null for
 * none. Only a KNOWN answer clears a cached tested state: staff can set a
 * vault back to not tested (decided 2026-09-07), but a row the server cannot
 * find is not a verdict.
 */
export function testedPatch(
  cachedAt: number | undefined,
  status: VaultTestingStatus,
): { vaultTestedAt: number | undefined } | null {
  if (status.testedAt) {
    return cachedAt ? null : { vaultTestedAt: Date.parse(status.testedAt) || Date.now() };
  }
  return status.known && cachedAt ? { vaultTestedAt: undefined } : null;
}

/** Ask the server about this vault. Throws when it cannot be reached. */
export async function checkVaultTested(
  session: CompanySession,
  w: TestedVault,
): Promise<{ vaultTestedAt: number | undefined } | null> {
  const q = vaultTestingQuery(w);
  if (!q) return null;
  const status = await fetchVaultTesting(session, q.portfolioId, q.vaultNumber, q.account);
  return testedPatch(w.vaultTestedAt, status);
}
