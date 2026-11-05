/**
 * A client never reads "UTXO": the word on a screen is "coins" (decided
 * 2026-07-19; the coin list's title and its row in the vault menu still said
 * it at a phone test on 2026-10-31). It stays welcome in comments, and
 * identifiers such as `Utxo` and `utxos` are not this spelling.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Strip comments: the word belongs in an explanation, never on a screen. */
const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no screen says UTXO', () => {
  it('is nowhere in the code of a screen', () => {
    const guilty = sources(UI)
      .filter((file) => withoutComments(readFileSync(file, 'utf8')).includes('UTXO'))
      .map((file) => file.slice(UI.length + 1));
    expect(guilty).toEqual([]);
  });
});
