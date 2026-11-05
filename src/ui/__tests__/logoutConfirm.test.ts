/**
 * Log out asks first (decided 2026-10-05: "if a user clicks on logout, ask him to
 * confirm the logout instead of immediately logging him out").
 *
 * Structural, like pageFooter: the repo has no component tests, and each
 * rule below is a line a later edit could quietly drop.
 *
 *   - the one Log out row (Settings) opens an AppDialog and never signs out
 *     by itself;
 *   - the dialog is a title and its buttons, no paragraph (decided 2026-09-02):
 *     "Log out?", a destructive "Log out" that runs the sign-out, "Cancel";
 *   - nothing else in the app signs out, and no Alert.alert stands in.
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

describe('log out asks first', () => {
  const settings = code(read('screens/SettingsScreen.tsx'));

  it('the Log out row opens the dialog and never signs out by itself', () => {
    const row = settings.slice(settings.indexOf('label="Log out"'), settings.indexOf('/>', settings.indexOf('label="Log out"')));
    expect(row).toMatch(/onPress=\{\(\) => setLogoutAsk\(true\)\}/);
    expect(row).not.toMatch(/onLogout|signOut/);
    // The sign-out runs in exactly one place: the dialog's own button.
    expect(settings.match(/void onLogout\(\)/g)).toHaveLength(1);
    expect(settings).toMatch(/const \[logoutAsk, setLogoutAsk\] = useState\(false\)/);
  });

  it('the dialog is "Log out?" with a destructive Log out and Cancel, and no message', () => {
    expect(settings).toMatch(/\bAppDialog\b[^;]*from '\.\.\/components'/);
    const start = settings.indexOf('title="Log out?"');
    expect(start).toBeGreaterThan(0);
    const dialog = settings.slice(settings.lastIndexOf('<AppDialog', start), settings.indexOf('/>', start));
    expect(dialog).toMatch(/visible=\{logoutAsk\}/);
    expect(dialog).not.toMatch(/message=/);
    expect(dialog).not.toMatch(/children|input=/);
    expect(dialog).toMatch(/label: 'Log out',\s*destructive: true,\s*onPress: \(\) => \{\s*setLogoutAsk\(false\);\s*void onLogout\(\);\s*\}/);
    expect(dialog).toMatch(/\{ label: 'Cancel', variant: 'ghost', onPress: \(\) => setLogoutAsk\(false\) \}/);
    expect(dialog).toMatch(/onClose=\{\(\) => setLogoutAsk\(false\)\}/);
    // No em dash in anything the client reads here.
    expect(dialog).not.toMatch(/—/);
  });

  it('the sign-out itself still cancels pending co-signs and revokes the session', () => {
    const fn = settings.slice(settings.indexOf('const onLogout'), settings.indexOf('return (', settings.indexOf('const onLogout')));
    expect(fn).toMatch(/cancelAllPendingCosigns\(s\)/);
    expect(fn).toMatch(/await signOut\(s\)/);
    expect(fn).toMatch(/setSession\(null\)/);
  });

  it('nothing else in the app signs out, and no Alert stands in for the dialog', () => {
    const others = sources(UI).filter((path) => !path.endsWith('SettingsScreen.tsx') && /\bsignOut\(|label="Log out"/.test(code(readFileSync(path, 'utf8'))));
    expect(others).toEqual([]);
    expect(settings).not.toMatch(/Alert\.alert/);
  });
});
