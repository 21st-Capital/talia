import { MAX_NAME_LENGTH, balanceDecimalsFor, fitName, uniqueVaultName } from '../vaultNames';

describe('uniqueVaultName', () => {
  it('keeps the device name when nothing else uses it', () => {
    expect(uniqueVaultName('Ledger', [])).toBe('Ledger');
    expect(uniqueVaultName('Toni’s BitBox', ['Savings'])).toBe('Toni’s BitBox');
  });

  it('numbers the next one, ignoring case and spacing', () => {
    expect(uniqueVaultName('Ledger', ['Ledger'])).toBe('Ledger 2');
    expect(uniqueVaultName('Ledger', ['ledger', 'Ledger 2'])).toBe('Ledger 3');
    expect(uniqueVaultName('Ledger', [' Ledger '])).toBe('Ledger 2');
  });

  it('never returns an empty name', () => {
    expect(uniqueVaultName('   ', [])).toBe('Vault');
  });

  it('keeps device-minted names inside the limit, number included', () => {
    expect(MAX_NAME_LENGTH).toBe(14);
    expect(fitName('  Foundation Passport Prime  ')).toBe('Foundation Pas');
    expect(fitName('Ledger')).toBe('Ledger');
    const long = 'Foundation Passport 2'; // 21 characters
    expect(uniqueVaultName(long, []).length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    const second = uniqueVaultName(long, [uniqueVaultName(long, [])]);
    expect(second.length).toBeLessThanOrEqual(MAX_NAME_LENGTH);
    expect(second.endsWith(' 2')).toBe(true);
  });

  it('gives a decimal back to a name that needs the room', () => {
    // A name up to the old limit keeps the four decimals the rows were laid
    // out for; a longer one buys its space from the balance, not from itself
    // (decided 2026-09-16).
    expect(balanceDecimalsFor('My multitest')).toBe(4);
    expect(balanceDecimalsFor('Familienverm.')).toBe(4);
    expect(balanceDecimalsFor('My multitest26')).toBe(3);
    expect(balanceDecimalsFor(undefined)).toBe(4);
    expect(balanceDecimalsFor('  Savings  ')).toBe(4);
  });
});
