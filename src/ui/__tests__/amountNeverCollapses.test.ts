/**
 * A figure that shrinks to fit is drawn by FitText, and by nothing else.
 *
 * Found 2026-09-26, from a client's iPhone on build 16: the vault's balance was
 * drawn about 4pt tall beside a normal-size name and fiat figure. iOS shrinks
 * text to fit the box it is given in BOTH directions; a fixed `lineHeight`
 * holds the line box open however small the glyphs get, so a row that comes
 * out a fraction of a point shorter than that line height can never fit at
 * any size and the shrink loop ends at its 4pt floor. `minimumFontScale` does
 * not save it: iOS ignores that prop in React Native's current architecture.
 *
 * Nine screens asked for shrink-to-fit by hand, seven of them over a token
 * that carries a line height. FitText is the one way to ask, and it strips
 * the line height, so the failure cannot be written again.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { fitStyle } from '../components/fitStyle';

const UI = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** The file with its comments removed: the rule is about code, and the
 *  reasoning behind it is written out in several places. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('an amount never collapses', () => {
  it('is asked for in FitText and nowhere else', () => {
    const offenders = sources(UI).filter(
      (path) =>
        !path.endsWith(join('components', 'FitText.tsx')) &&
        code(path).includes('adjustsFontSizeToFit'),
    );
    expect(offenders.map((p) => p.slice(UI.length + 1))).toEqual([]);
  });

  it('drops the fixed line height that would collapse it', () => {
    expect(fitStyle({ fontSize: 17, lineHeight: 22, color: '#fff' })).toEqual({
      fontSize: 17,
      color: '#fff',
    });
  });

  it('keeps everything else, through a style array', () => {
    expect(fitStyle([{ fontSize: 40, lineHeight: 48 }, { maxWidth: 300 }])).toEqual({
      fontSize: 40,
      maxWidth: 300,
    });
  });

  it('survives no style at all', () => {
    expect(fitStyle(undefined)).toEqual({});
  });

  it('leaves a style that never had one alone', () => {
    expect(fitStyle({ fontSize: 13 })).toEqual({ fontSize: 13 });
  });
});
