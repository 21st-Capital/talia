/**
 * Keel theme: colours, spacing, typography and radii used across the app.
 * Keep this small and declarative — components read from `theme`, never from
 * raw hex values, so a rebrand touches one file.
 */
import { activePalette } from './colors';
import type { Palette } from './colors';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

/**
 * Brand fonts — mirrors 21stcapital.com (extracted from the site 2026-07-17):
 * Bricolage Grotesque for display/headings/UI chrome, Figtree for body copy.
 * Static faces 400–800 are bundled in assets/fonts (OFL-licensed).
 */
export const fonts = {
  display: 'Bricolage Grotesque',
  body: 'Figtree',
} as const;

/**
 * Every token carries its own LINE HEIGHT (decided 2026-08-28).
 *
 * These are not new numbers: they are the values the app already used most
 * (21 on body, 18 on label, 17 on caption, 22 on heading), which had been
 * copied by hand into ~90 style blocks. Copied by hand means occasionally
 * mistyped, which is why 14, 15, 16, 19 and 20 also appeared and why two
 * screens could set the same text at different leading. Owning it here makes
 * the right leading the DEFAULT, and a style that genuinely needs its own can
 * still override it after the spread.
 *
 * `display` deliberately has none: it is the hero balance, which auto-scales,
 * and an explicit line height and shrink-to-fit cannot be combined. That is
 * FitText's job now: it strips the line height off whatever token it is given,
 * because a row a fraction shorter than a fixed line box makes iOS shrink the
 * figure to 4pt (decided 2026-09-26, a client's balance). Never ask for
 * `adjustsFontSizeToFit` by hand; a test refuses it.
 *
 * NEVER spread one of these straight onto a TextInput. iOS applies lineHeight
 * to the input's text box and crops the glyphs (2026-08-28: an email
 * address rendered cut off on the sign-up form). Spread it and then set
 * `lineHeight: undefined`, the way TextField does.
 */
export const typography = {
  /**
   * THE amount figure (decided 2026-09-12: one size on every page): the home
   * totals, a vault's or portfolio's balance, a transaction's amount, the
   * Send amount, the chart's price. Nothing larger anywhere.
   */
  hero: { fontSize: 40, lineHeight: 48, fontWeight: '700' as const, letterSpacing: 0.2, fontFamily: fonts.display },
  /** The unit beside a hero figure (BTC, sats). */
  heroUnit: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const, fontFamily: fonts.display },
  /**
   * The line under a hero figure (the fiat value, the sats): 17pt regular,
   * grey. The home, the portfolios, a vault and a portfolio each hand-set
   * this same pair over `body` (decided 2026-10-05); one token, like the unit.
   */
  heroCaption: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const, fontFamily: fonts.body },
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.2, fontFamily: fonts.display },
  /**
   * THE title in a screen's top bar (decided 2026-09-12, BlueWallet reference:
   * Apple's standard bar title, 17pt semibold). Every top bar, shared or
   * custom-drawn, uses this and nothing larger.
   */
  screenTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, fontFamily: fonts.display },
  /** The second line under a top-bar title (a date, a live price): 13pt regular, grey. */
  screenSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, fontFamily: fonts.body },
  /** Page, sheet and dialog titles inside the content. */
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, fontFamily: fonts.display },
  /** Section and card titles ("Details", "Transactions") and row headlines. */
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, fontFamily: fonts.display },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' as const, fontFamily: fonts.body },
  /**
   * A bold word or a bold row label in body copy, at the body's own size
   * and leading (decided 2026-10-05: twenty styles spread `body` and then
   * hand-set the weight). Never `...body, fontWeight: '600'` again.
   */
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' as const, fontFamily: fonts.body },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const, letterSpacing: 0.3, fontFamily: fonts.display },
  mono: { fontSize: 13, lineHeight: 18, fontFamily: 'Menlo' },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' as const, fontFamily: fonts.body },
} as const;

/**
 * THE quiet line over a hero (the rule: matching elements match through ONE
 * token): Home's "Total Balance", the Portfolio tab's "Portfolio Value", a
 * vault's name over its balance, and "Vault built" over the new vault's name.
 * Each sat in its own sheet as the same three properties, free to drift
 * apart. A function, so the colour is read inside each sheet's themedStyles
 * factory, once per scheme, and never captured at module scope.
 */
export function heroLabel(): {
  fontSize: number;
  lineHeight: number;
  fontWeight: '600';
  letterSpacing: number;
  fontFamily: string;
  color: string;
  textAlign: 'center';
} {
  return { ...typography.label, color: activePalette().slate, textAlign: 'center' };
}

/**
 * THE hero figure in a centred hero block (decided 2026-10-03: "It needs to also
 * match with the total balance font size from the home screen"): Home's
 * total, the Portfolio tab's value, the Sent page's amount and the new
 * vault's name. The 40pt hero in the warm off-white every balance uses; the
 * Sent and Vault built pages had drawn theirs in `ink`, a cooler white beside
 * the vault page's own number. A function for the same reason as `heroLabel`.
 */
export function heroFigure(): typeof typography.hero & { color: string; textAlign: 'center' } {
  return { ...typography.hero, color: activePalette().offWhite, textAlign: 'center' };
}

/**
 * The line box a Text gets when its style sets no lineHeight: both our faces
 * are drawn at 1.2 em of leading (Bricolage ascent 0.93 + descent 0.27,
 * Figtree 0.95 + 0.25, neither with a line gap), which is exactly what the
 * hero token spells out as 40/48. Use it where a layout has to line up with a
 * FitText figure, whose line height is stripped.
 */
export function naturalLineHeight(fontSize: number): number {
  return fontSize * 1.2;
}

export interface Theme {
  readonly colors: Palette;
  readonly spacing: typeof spacing;
  readonly radius: typeof radius;
  readonly typography: typeof typography;
}

/** `colors` is a LIVE getter — it resolves the active scheme at read time. */
export const theme: Theme = {
  get colors(): Palette {
    return activePalette();
  },
  spacing,
  radius,
  typography,
};

export { palette, brand, setColorScheme, getColorScheme } from './colors';
export type { ColorSchemeName } from './colors';
export { themedStyles } from './themedStyles';
