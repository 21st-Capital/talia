/**
 * One hero figure (decided 2026-10-03: the new vault's name "needs to also match
 * with the total balance font size from the home screen"). The size was
 * already the one 40pt hero everywhere; the colour was not: the Sent page's
 * amount and the new vault's name were drawn in `ink`, a cooler white beside
 * the warm off-white of every balance. Structural, like the other guards.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(UI, rel), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('one hero figure', () => {
  it('the centred hero blocks take the one token', () => {
    for (const rel of [
      'components/SentPage.tsx',
      'components/VaultBuiltPage.tsx',
      'screens/WalletListScreen.tsx',
      'screens/VirtualVaultsListScreen.tsx',
    ]) {
      expect(code(read(rel))).toMatch(/heroFigure\(\)/);
    }
  });

  it('no hero figure is drawn in ink', () => {
    const offenders = sources(UI).filter((p) =>
      /typography\.hero\s*,\s*color:\s*theme\.colors\.ink\b/.test(code(readFileSync(p, 'utf8'))),
    );
    expect(offenders.map((p) => p.slice(UI.length + 1))).toEqual([]);
    // The transaction page's amount: green when received, the balances' white when sent.
    expect(code(read('screens/TxDetailScreen.tsx'))).toMatch(
      /styles\.amount, \{ color: incoming \? theme\.colors\.positive : theme\.colors\.offWhite \}/,
    );
  });

  it('a hero amount carries its unit in its own size and colour, as every balance does', () => {
    // Found 2026-10-03: the Sent page drew "BTC" smaller and grey beside the
    // amount while every balance draws it as part of the figure.
    for (const rel of ['components/SentPage.tsx', 'screens/TxDetailScreen.tsx']) {
      expect(code(read(rel))).not.toMatch(/<Text style=\{styles\.(heroUnit|unit)\}>/);
    }
  });
});
