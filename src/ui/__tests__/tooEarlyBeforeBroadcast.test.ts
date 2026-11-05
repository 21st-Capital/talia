/**
 * Decided 2026-10-07: BDK assembles a spend on a
 * timelocked path whatever the age of its coins, and the network then
 * refuses it. Every broadcast in the app asks `sendTooEarly` first and, when
 * it is too early, says the one sentence (`tooEarlyTitle`) instead of
 * sending. Structural, like speedUpAndCancel: the repo has no component
 * tests, and a later edit could quietly add a broadcast that skips it.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');

/** Comments out: the rules are about code, and the reasoning names them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const BROADCAST = /\.(broadcastPsbt|broadcastRawTx|broadcastRescue)\(/g;

describe('nothing goes out before its coins may move', () => {
  const sites: Array<{ file: string; at: number; asked: boolean; said: boolean }> = [];
  for (const p of sources(UI)) {
    const src = code(readFileSync(p, 'utf8'));
    for (const m of src.matchAll(BROADCAST)) {
      // The question, asked in the same stretch of code just before it.
      const before = src.slice(Math.max(0, m.index! - 2500), m.index);
      sites.push({
        file: p.slice(UI.length + 1),
        at: src.slice(0, m.index).split('\n').length,
        asked: /sendTooEarly\(/.test(before),
        said: /tooEarlyTitle\(/.test(before),
      });
    }
  }

  it('finds every broadcast: rescue, sign, pending co-signs (one and all), refresh', () => {
    expect(new Set(sites.map((s) => s.file))).toEqual(
      new Set([
        'screens/RescueScreen.tsx',
        'screens/SignPsbtScreen.tsx',
        'screens/PendingCosignScreen.tsx',
        'screens/RefreshSessionScreen.tsx',
      ]),
    );
  });

  it('every one asks first, and says the one sentence when it is too early', () => {
    expect(sites.filter((s) => !s.asked || !s.said).map((s) => `${s.file}:${s.at}`)).toEqual([]);
  });
});
