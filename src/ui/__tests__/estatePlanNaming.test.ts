/**
 * The feature is the Estate Plan. Nothing a client reads calls it a
 * "protocol" (renamed long ago; the app and the website both still had
 * it in places on 2026-09-24).
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

const withoutComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('what a client calls the document', () => {
  it('is never a "protocol" in a string the app renders', () => {
    const guilty: Array<[string, string]> = [];
    for (const file of sources(UI)) {
      const code = withoutComments(readFileSync(file, 'utf8'));
      // Identifiers keep their names (protocolName is the API's field); only
      // words on a screen count: a quoted phrase or JSX text.
      for (const line of code.split('\n')) {
        // Only WORDS ON A SCREEN: a quoted phrase with a space in it. An
        // identifier (protocolName, submitInheritanceProtocol) is the API's
        // own vocabulary and is nobody's reading.
        for (const m of line.matchAll(/["'`]([^"'`]*\b[Pp]rotocols?\b[^"'`]*)["'`]/g)) {
          const text = (m[1] ?? '').trim();
          if (!text.includes(' ') || text.includes('://')) continue;
          guilty.push([file.slice(UI.length + 1), text.slice(0, 70)]);
        }
      }
    }
    expect(guilty).toEqual([]);
  });
});
