/**
 * Every screen that can show a price, a renewal or a purchase link imports
 * PURCHASES_ENABLED from config.
 *
 * Apple questioned the watch-only build under guideline 2.1(b) (letter of
 * 2026-09-11) with a photograph of the Subscriptions screen: "$0 / year",
 * "renews: unknown", an Auto-renewal switch, a Cancel button and a 10%
 * penalty. Guideline 3.1.1 forbids buttons or links that send a customer to a
 * purchase outside Apple's. In the store builds (the watch-only App Store app
 * and the signing TestFlight app) the membership is shown, never sold.
 *
 * The flag removes nothing from the bundle. babel-plugin-talia-flags inlines
 * the environment into config.ts alone; every screen reads PURCHASES_ENABLED
 * through an import at run time, so the store builds ship every screen's
 * strings, prices included, and the check around them is the only thing that
 * keeps them off the screen. A screen that prints a price without the flag
 * prints it in every build.
 *
 * Structural, like routeReachability: the repo has no component tests, and this
 * is wiring a text scan can see. Each .tsx under src/ui is read with block
 * comments and whole-line // comments removed (the reasoning in comments names
 * prices on purpose), and wherever the sales wording is left the flag must be
 * imported and read. That proves the file was gated at all, not that every
 * string in it is; each branch still needs a reviewer's eye.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const UI = join(ROOT, 'src', 'ui');

/** Wording that prices, renews, cancels or sends the client off to buy. */
const SELLS =
  /\/ ?year|\$[0-9]|\$\$\{|per request|on the website|upgrade your plan|renew your plan|activate (my|your) plan|checkoutUrlWithLogin|penalty|Auto-renewal|Cancel subscription|pay securely/i;

/** `import { ..., PURCHASES_ENABLED, ... } from '../../config'`, on one line or several. */
const IMPORTS_FLAG = /import\s*\{[^}]*\bPURCHASES_ENABLED\b[^}]*\}\s*from\s*['"](?:\.\.\/)+config['"]/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : tsxFiles(path);
    return e.name.endsWith('.tsx') ? [path] : [];
  });
}

/** The source a client can meet: block comments and whole-line // comments removed. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** Imported AND read: an import nothing uses gates nothing. */
function gatesOnPurchases(src: string): boolean {
  const m = IMPORTS_FLAG.exec(src);
  if (!m) return false;
  const rest = src.slice(0, m.index) + src.slice(m.index + m[0].length);
  return /\bPURCHASES_ENABLED\b/.test(rest);
}

const FILES = tsxFiles(UI).map((path) => ({
  name: relative(ROOT, path),
  code: code(readFileSync(path, 'utf8')),
}));
const SELLING = FILES.filter((f) => SELLS.test(f.code));

describe('store purchase gate', () => {
  it('scans the screens it is meant to', () => {
    // Guard the guard: a moved folder or a broken pattern would turn the check
    // below into a vacuous pass. These two hold the full app's prices.
    expect(FILES.length).toBeGreaterThan(50);
    const names = SELLING.map((f) => f.name);
    expect(names).toContain(join('src', 'ui', 'screens', 'SubscriptionsScreen.tsx'));
    expect(names).toContain(join('src', 'ui', 'screens', 'LayeredVaultScreen.tsx'));
    // Comments are not what a client sees.
    expect(SELLS.test(code('/* $195/year */\n  // Cancel subscription\nconst a = 1;'))).toBe(false);
    expect(gatesOnPurchases("import {\n  APP_BUILD,\n  PURCHASES_ENABLED,\n} from '../../config';\nPURCHASES_ENABLED && x")).toBe(true);
    expect(gatesOnPurchases("import { PURCHASES_ENABLED } from '../../config';")).toBe(false);
  });

  it("PURCHASES_ENABLED is read at run time, so store builds ship every screen's sales strings and only that gate hides them: every screen with a price, renewal or purchase link imports and reads it", () => {
    const ungated = SELLING.filter((f) => !gatesOnPurchases(f.code)).map(
      (f) => `${f.name}: "${f.code.match(SELLS)?.[0]}"`,
    );
    expect(ungated).toEqual([]);
  });
});
