/**
 * The home screen refreshes the vaults by itself whenever the app is opened
 * (decided 2026-11-04 after a phone test: the balances changed only after a
 * pull-down). The rules of WHEN live in `screens/homeRefresh.ts` and are
 * tested there; this pins the screen to them.
 *
 * Structural, like logoutConfirm: the repo has no component tests, and each
 * rule below is a line a later edit could quietly drop.
 *
 *   - the screen keeps ONE `homeRefresh` scheduler and hands it every
 *     AppState change, so a return to the app refreshes;
 *   - the launch goes through it (`launch()`), and the pull too (`pull()`),
 *     so the three never run two loops beside each other;
 *   - the one-shot `startedRef` timer, which refreshed only at mount and was
 *     cancelled for good by a vault list that changed in its first seconds,
 *     does not come back.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const UI = join(__dirname, '..');
/** Comments out: the rules are about code, and the reasoning names them. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const screen = code(readFileSync(join(UI, 'screens/WalletListScreen.tsx'), 'utf8'));

describe('the home screen refreshes through homeRefresh', () => {
  it('keeps one scheduler and hands it every AppState change', () => {
    expect(screen).toMatch(/homeRefresh\(\s*\(\)\s*=>\s*backgroundSyncRef\.current\(\)\s*\)/);
    expect(screen).toMatch(/AppState\.addEventListener\(\s*'change',\s*\(next\)\s*=>\s*r\.appState\(next\)\s*\)/);
    expect(screen).toMatch(/r\.dispose\(\)/);
  });

  it('starts the launch and the pull through it', () => {
    expect(screen).toMatch(/refresher\.current\?\.launch\(\)/);
    expect(screen).toMatch(/refresher\.current\?\.pull\(\)/);
  });

  it('has no refresh timer of its own', () => {
    expect(screen).not.toMatch(/startedRef/);
    expect(screen).not.toMatch(/setTimeout\(\s*backgroundSync/);
  });

  // Decided 2026-11-04 after a phone test: with many vaults the 0.8 s
  // pauses between them added up while the client waited.
  it('does not pause between vaults', () => {
    const loop = screen.slice(screen.indexOf('const backgroundSync'), screen.indexOf('const backgroundSyncRef'));
    expect(loop.length).toBeGreaterThan(0);
    expect(loop).not.toMatch(/setTimeout/);
  });
});
