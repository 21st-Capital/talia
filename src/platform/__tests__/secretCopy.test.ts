/**
 * Decided 2026-09-26: the two-factor key, recovery codes,
 * invite codes and descriptors went to the general pasteboard with no expiry
 * and onto Universal Clipboard.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SECRET_COPY_POLICY } from '../secretCopy';

const SRC = join(__dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('secret copies', () => {
  it('every kind expires within two minutes', () => {
    for (const p of Object.values(SECRET_COPY_POLICY)) {
      expect(p.expiresInSeconds).toBeGreaterThan(0);
      expect(p.expiresInSeconds).toBeLessThanOrEqual(120);
    }
  });

  it('account secrets and invite codes never leave this phone', () => {
    expect(SECRET_COPY_POLICY.accountSecret.localOnly).toBe(true);
    expect(SECRET_COPY_POLICY.inviteCode.localOnly).toBe(true);
  });

  it('every screen that copies a secret uses copySecret, never the plain copy', () => {
    for (const rel of [
      'ui/screens/TwoFactorScreen.tsx',
      'ui/screens/InviteHeirScreen.tsx',
      'ui/screens/SharePortfolioScreen.tsx',
      'ui/components/AdvancedVaultDetails.tsx',
    ]) {
      const src = read(rel);
      expect(src).toMatch(/copySecret\(/);
      expect(src).not.toMatch(/copyToClipboard\(/);
    }
    // The vault page copies its account key as a secret.
    expect(read('ui/screens/WalletDetailScreen.tsx')).toMatch(/copySecret\(accountXpub \?\? qrPayload, 'vaultKeys'\)/);
  });

  it('a build without the native module still copies (never no copy)', () => {
    const src = read('platform/clipboard.ts');
    const body = src.slice(src.indexOf('export function copySecret'));
    expect(body.slice(0, body.indexOf('\n}\n'))).toMatch(/Clipboard\.setString\(text\)/);
  });
});
