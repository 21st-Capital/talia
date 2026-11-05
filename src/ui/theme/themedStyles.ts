/**
 * Theme-aware StyleSheet wrapper. Components write
 * `const styles = themedStyles(() => StyleSheet.create({...}))` — the factory
 * runs lazily PER COLOR SCHEME (theme.colors is a live getter), and property
 * access resolves against the active scheme's cached sheet. Switching themes
 * remounts the app root; the next render sees the other variant.
 */
import { getColorScheme } from './colors';
import type { ColorSchemeName } from './colors';

/**
 * Brand-font injection (site parity): any text style that doesn't name a
 * fontFamily gets one — Bricolage Grotesque for display-ish text (≥17pt or
 * semibold+), Figtree otherwise — matching how 21stcapital.com uses them.
 * Explicit fontFamily (Menlo mono, the theme tokens) always wins. Styles
 * without text props pass through untouched.
 */
const DISPLAY_FONT = 'Bricolage Grotesque';
const BODY_FONT = 'Figtree';

function withBrandFonts<T extends object>(sheet: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sheet)) {
    const s = value as Record<string, unknown> | null;
    if (
      s &&
      typeof s === 'object' &&
      !('fontFamily' in s) &&
      ('fontSize' in s || 'fontWeight' in s)
    ) {
      const size = typeof s.fontSize === 'number' ? s.fontSize : 14;
      const weight = parseInt(String(s.fontWeight ?? '400'), 10) || 400;
      out[key] = { ...s, fontFamily: size >= 17 || weight >= 600 ? DISPLAY_FONT : BODY_FONT };
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export function themedStyles<T extends object>(factory: () => T): T {
  const cache = new Map<ColorSchemeName, T>();
  return new Proxy({} as T, {
    get(_target, prop) {
      const scheme = getColorScheme();
      let sheet = cache.get(scheme);
      if (!sheet) {
        sheet = withBrandFonts(factory());
        cache.set(scheme, sheet);
      }
      return (sheet as Record<string | symbol, unknown>)[prop];
    },
  });
}
