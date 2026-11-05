/**
 * A broadcast that reached no server reads as just that at every screen that
 * sends (decided 2026-10-30): the library's text used to reach the client as
 * a paragraph in a dialog, or as a coin's reason on the Sent page. The words
 * are `notReachedWords` (wallet/broadcastAnswer.ts, tested with the server
 * rule); Pending is also mounted (pendingCosignSent.test.tsx). Structural for
 * the others, like tooEarlyBeforeBroadcast: a later broadcast could quietly
 * skip it.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(UI, rel), 'utf8');

/** Comments out: the rules are about code, and the reasoning names them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('a broadcast that reached no server, on the screens that send', () => {
  it('every screen with an everyday broadcast asks for the plain words', () => {
    const screens = sources(UI).filter((p) => /broadcastThroughChainServers\(/.test(code(readFileSync(p, 'utf8'))));
    expect(screens.map((p) => p.slice(UI.length + 1)).sort()).toEqual([
      'screens/PendingCosignScreen.tsx',
      'screens/RefreshSessionScreen.tsx',
      'screens/SignPsbtScreen.tsx',
    ]);
    for (const p of screens) expect(code(readFileSync(p, 'utf8'))).toMatch(/notReachedWords\(e\)/);
  });

  it('the signing screen: a title and its button, the old dialog for anything a server answered', () => {
    const sign = code(read('screens/SignPsbtScreen.tsx'));
    expect(sign).toMatch(
      /const notReached = notReachedWords\(e\);\s*if \(notReached\) setDialog\(\{ title: notReached, message: '' \}\);\s*else fail\('Could not send', e\);/,
    );
    expect(sign.match(/fail\('Could not send', e\)/g)).toHaveLength(1);
  });

  it('Pending: the one spend as a title, a coin of a batch as its reason', () => {
    const pending = code(read('screens/PendingCosignScreen.tsx'));
    expect(pending).toMatch(
      /const notReached = notReachedWords\(e\);\s*setDialog\(notReached \? \{ title: notReached, message: '' \} : \{ title: 'Could not send', message: \(e as Error\)\.message \}\);/,
    );
    expect(pending).toMatch(/reason: notReachedWords\(e\) \?\? \(e as Error\)\.message/);
  });

  it('the refresh session: a coin\'s line, before anything reads the raw text', () => {
    const refresh = code(read('screens/RefreshSessionScreen.tsx'));
    expect(refresh).toMatch(
      /function plainError\(e: unknown\): string \{\s*const notReached = notReachedWords\(e\);\s*if \(notReached\) return notReached;/,
    );
  });
});
