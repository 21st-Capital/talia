/**
 * A vault name that is not already taken (decided 2026-09-09: a vault imported
 * from a device is named after the device instead of asking, "he can
 * always change that later"). Two vaults from one Ledger would otherwise
 * both be called the same thing, which is worse than a number.
 *
 * Pure, tested.
 */
/** The most characters a vault or portfolio name may have (decided 2026-09-16:
 *  raised from 13 to 16, then settled at 14 the same day, because 16 with a
 *  small balance beside it broke the home card's row: "My multitest2026" ran
 *  onto a second line next to 0.00 012 867). Names must never be shortened on
 *  the main screens. Where a name shares its row with a balance, the BALANCE
 *  gives way: see `balanceDecimalsFor`. Enforced at every naming field and on
 *  device-minted names. */
export const MAX_NAME_LENGTH = 14;

/** The name length a row's figures were laid out for. A longer name is not
 *  shrunk or cut; the balance beside it loses a decimal instead (decided
 *  2026-09-16: "if the name of the vault is more than 13, just round the BTC
 *  balance to lower digits so it doesnt break the name of the vault"). */
export const ROOMY_NAME_LENGTH = 13;

/** Decimals for a BTC figure sharing a row with `name`. */
export function balanceDecimalsFor(name: string | undefined): number {
  return (name ?? '').trim().length > ROOMY_NAME_LENGTH ? 3 : 4;
}

/** A name cut to the limit, whitespace trimmed. */
export function fitName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH).trim();
}

export function uniqueVaultName(base: string, taken: readonly string[]): string {
  const wanted = fitName(base) || 'Vault';
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  if (!used.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; n < 100; n += 1) {
    const suffix = ` ${n}`;
    const candidate = `${wanted.slice(0, MAX_NAME_LENGTH - suffix.length).trim()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return wanted;
}
