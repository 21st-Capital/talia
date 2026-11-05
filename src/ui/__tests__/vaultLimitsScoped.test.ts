/**
 * Co-signing limits opened from a vault's own menu show that vault alone
 * (decided 2026-10-28: the vault menu opened the limits of every vault).
 * Structural, like the screens' other rules: the repo has no component
 * tests. The matching itself is tested in services/__tests__/cosignLimits.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const screens = join(__dirname, '..', 'screens');
const detail = readFileSync(join(screens, 'WalletDetailScreen.tsx'), 'utf8');
const limits = readFileSync(join(screens, 'CosignLimitsScreen.tsx'), 'utf8');

describe('the vault menu opens its own vault\'s limit', () => {
  it('passes the vault it was opened from', () => {
    expect(detail).toMatch(/navigation\.navigate\('CosignLimits', \{ walletId: wallet\.id \}\)/);
    expect(detail).not.toMatch(/navigation\.navigate\('CosignLimits'\)/);
  });

  it('lists only that vault, and waits for our fingerprints to tell which it is', () => {
    expect(limits).toMatch(/if \(!scopedId\) return vaults;/);
    expect(limits).toMatch(/if \(!settled\) return null;/);
    expect(limits).toMatch(/return limitsOfVault\(vaults, /);
    expect(limits).toMatch(/shown\.map\(\(vault\) =>/);
    expect(limits).not.toMatch(/vaults\.map\(/);
  });
});
