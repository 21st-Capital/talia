/**
 * Decided 2026-09-26: the inner layer of a keyed heir
 * invite is derived from the heir's xpub, which is PUBLIC. Opening it is not
 * proof that the heir holds the device, and no text may say it is.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]): string => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');

describe('no sentence claims the invite proves the heir holds the device', () => {
  it('the invite screen says what the second lock really is', () => {
    const src = read('ui', 'screens', 'InviteHeirScreen.tsx');
    expect(src).not.toMatch(/proof they hold the key|nothing has to be checked by us/);
    expect(src).toMatch(/not proof that \$\{who\} holds the device/);
  });

  it('the crypto module says so too', () => {
    const src = read('crypto', 'envelope.ts');
    expect(src).not.toMatch(/Decrypting IS the proof/);
    expect(src).toMatch(/THE XPUB IS PUBLIC MATERIAL/);
  });
});
