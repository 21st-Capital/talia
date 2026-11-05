/**
 * Keel colour tokens — mapped to the 21st Capital design-system palette
 * (Figma "Base colors / Neutral / Semantic" sheet, received 2026-07-14).
 *
 * Official values used directly:
 *   Neutrals:  White #FFFFFF · N-1 #F8F9F9 · N-2 #E5E9E8 · N-3 #738983
 *              N-4 #556762 · N-5 #062B24 · N-6 #01120F
 *   Additional: amber #F2A900 (primary action) · blue #6FA1F6 · red #FF4005
 *               coral #FD663E · greens #B8E170 / #9FE870
 *   Semantic:  Positive #16C784 (border #109563) · Caution #FFC72C
 *              (border #CB9B1B) · Negative #FF4C4C (border #CC3C3B)
 *              Info #3A91FF (border #2679EB)
 *
 * Brand constants (logo/mark only): deep green #124A38, off-white #F4F1E8,
 * gold #E1A73C. The app UI reads the design-system tokens below; the mark
 * keeps its brand colours.
 *
 * The only non-official values are `surfaceRaised` and `hairline` — derived
 * green tones between N-5 and N-4 (the sheet has no raised-surface step);
 * replace when design adds official ones.
 */

export const brand = {
  green: '#124A38',
  offWhite: '#F4F1E8',
  gold: '#E1A73C',
} as const;

export const palette = {
  // Grounds (official neutrals)
  hull: '#01120F', // N-6 — app background
  /**
   * The dim behind every popup. Dark in BOTH palettes ON PURPOSE: a scrim
   * built from the ground token cannot dim, because it resolves to the very
   * colour it is painted over (found in light mode, 2026-09-14).
   */
  scrim: '#01120F99', // near-black at 60%
  /**
   * Glass (decided 2026-09-12, Revolut reference): every container is a
   * translucent lift of the off-white over whatever sits behind it, with a
   * light edge, so cards, rows, pills and fields read as frosted panes.
   * Sheets and dialogs add the blur material underneath (GlassPanel).
   */
  surface: '#F4F1E812', // cards: off-white at 7%
  surfaceRaised: '#F4F1E81F', // elevated surfaces / pills: off-white at 12%
  hairline: '#F4F1E824', // the light edge glass catches: off-white at 14%
  /** The old opaque card colour (N-5) for the few places that must not be see-through. */
  surfaceSolid: '#062B24',
  /** The tint over the blur material in the dock and the glass panels. */
  glassTint: '#0A3B3066',
  /** The soft glow at the top of a page that gives the glass something to show. */
  glow: '#124A38',

  // Brand + interactive greens
  green: brand.green,
  greenDark: '#062B24', // N-5
  /**
   * The vault overview graph's key card, in every drawing of it: this app,
   * the Estate Plan PDF and the staff dashboard, in both its palettes (decided
   * 2026-09-25: "perhaps we should turn it green just like the other
   * containers ... like we already do on the staff dashboard in dark
   * mode"). Pinned, not themed: the card is the document's ink and is this
   * green on paper and on glass alike. Change it in all three or in none.
   */
  greenCard: '#124A38',
  greenLight: '#109563', // semantic Positive Border — interactive green

  offWhite: brand.offWhite,
  gold: '#F2A900', // design-system amber — brand highlights & warnings
  goldDark: '#CB9B1B', // Caution Border

  /** Switch OFF track / thumb — must stay visible on BOTH grounds. */
  switchOff: '#0A3B30',
  switchThumb: '#F4F1E8',
  /** ONE green (decided 2026-09-12): the selection states, the LIVE dot and
   *  every gain share the money green; the website's lime is retired in
   *  the app so no page shows two greens. */
  accent: '#16C784',
  /** Text/icons sitting on `accent`. */
  accentInk: '#01120F',
  /** Accent used AS TEXT on the scheme's ground — lime is unreadable on the
   *  light paper ground (decided 2026-07-21), so light mode deepens it. */
  accentText: '#16C784',
  /** Buttons: white-on-dark / black-on-light (decided 2026-07-17). */
  action: '#FFFFFF',
  actionText: '#01120F',
  // A button that cannot be pressed, as a COLOUR rather than an opacity: it
  // is the same thing the eye saw before (the button at 45% over the page),
  // but it survives a re-render, which an opacity on a TouchableOpacity does
  // not (decided 2026-09-16: Continue stayed grey after it went live).
  actionMuted: '#737D7B',
  actionTextMuted: '#404D4A',

  // Text on dark (official neutrals)
  ink: '#F8F9F9', // N-1 — primary text
  slate: '#738983', // N-3 — secondary text
  faint: '#556762', // N-4 — tertiary/disabled text

  // Light surfaces (QR tiles must stay dark-on-light)
  paper: '#FFFFFF',
  inkOnPaper: '#01120F', // N-6

  // Semantic (official)
  /** Bitcoin brand orange (coin tiles, hex badge). */
  bitcoinOrange: '#F7931A',
  positive: '#16C784',
  negative: '#FF4C4C',
  warning: '#FFC72C',
  info: '#3A91FF',

  // Fixed
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
} as const;

/** Token names from the dark palette; values are plain colour strings so
 *  alternate schemes can supply their own. */
export type Palette = { [K in keyof typeof palette]: string };

/**
 * Light theme — same token names, values flipped for a warm paper ground.
 * `offWhite`/`ink` are TEXT tokens (primary text), so in light mode they
 * resolve to dark ink; `hull`/`surface` become light grounds.
 */
export const lightPalette: Palette = {
  ...palette,
  hull: '#F6F5F0',
  scrim: '#13251F80', // ink at 50% — still a DARK dim on the paper ground
  surface: '#FFFFFFB8', // white at 72% over the paper ground
  surfaceRaised: '#13251F0F', // ink at 6%
  hairline: '#13251F1A', // ink at 10%
  surfaceSolid: '#FFFFFF',
  glassTint: '#ECEAE080',
  glow: '#109563',
  greenLight: '#109563',
  offWhite: '#13251F', // primary text on light
  gold: '#C77F00', // brand highlight with contrast on light grounds
  ink: '#0B1F1A',
  slate: '#5C6B65',
  faint: '#8A9590',
  accent: '#109563', // the same green as `positive` on paper
  accentInk: '#FFFFFF', // white on the deep green
  accentText: '#109563',
  // Gains and losses on paper use the design system's darker pair (the
  // "Positive Border" and "Negative Border" tokens): the dark-ground pair
  // washes out on the light ground (decided 2026-09-12).
  positive: '#109563',
  negative: '#CC3C3B',
  action: '#0B1F1A',
  actionText: '#FFFFFF',
  actionMuted: '#8C9590',
  actionTextMuted: '#C0C5C2',
  switchOff: '#CBC6B8', // visibly darker than the white cards (decided 2026-07-19)
  switchThumb: '#FFFFFF',
};

export type ColorSchemeName = 'dark' | 'light';

let activeScheme: ColorSchemeName = 'dark';

export function setColorScheme(scheme: ColorSchemeName): void {
  activeScheme = scheme;
}

export function getColorScheme(): ColorSchemeName {
  return activeScheme;
}

export function activePalette(): Palette {
  return activeScheme === 'dark' ? palette : lightPalette;
}
