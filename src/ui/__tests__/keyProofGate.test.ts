/**
 * The ONE place a server-sent 21st Capital xpub enters a vault is the
 * builder's claim, and the ONE gate before it is issuedKeysProblem
 * (decided 2026-09-26). This keeps it that way: every caller of
 * fetchNextVaultKeys checks the keys in the same file, for the account the
 * backend named and under the build's own switches, and refuses with
 * today's title until the proof check is enforced.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the 21C key gate', () => {
  const callers = sources(SRC).filter(
    (f) => !f.endsWith(join('services', 'companyAuth.ts')) && /fetchNextVaultKeys\(/.test(withoutComments(readFileSync(f, 'utf8'))),
  );

  it('has exactly one caller, the vault builder', () => {
    expect(callers.map((f) => f.slice(SRC.length + 1))).toEqual([join('ui', 'screens', 'LayeredVaultScreen.tsx')]);
  });

  it('checks every key received, with its account and the build switches, before placing one', () => {
    for (const file of callers) {
      const code = withoutComments(readFileSync(file, 'utf8'));
      const calls = code.match(/issuedKeysProblem\(([\s\S]*?)\n\s*\);/g) ?? [];
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatch(/issued\.account/);
      expect(calls[0]).toMatch(/KEY_PROOF_POLICY/);
      const gate = code.indexOf('issuedKeysProblem(');
      expect(gate).toBeGreaterThan(0);
      expect(code.indexOf('setCoSignerKey(issued.coSigner)')).toBeGreaterThan(gate);
      expect(code.indexOf('setRescueKey(issued.rescue)')).toBeGreaterThan(gate);
      // Today's title until the proof check is enforced (keyCheckFailedTitle).
      expect(code).toMatch(/title: keyCheckFailedTitle\(claimNetwork, KEY_PROOF_POLICY\)/);
      expect(code).not.toMatch(/KEY_PROOF_COPY\.en\.checkFailedTitle/);
    }
  });
});
