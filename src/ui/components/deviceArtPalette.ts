/**
 * The colours of the signing devices Talia draws, in ONE place (design A
 * "The courier", decided 2026-10-03).
 *
 * The sanctioned exception to "colours come from the theme", like the
 * exchange logos and the product tiles: these are the PRODUCTS' own colours,
 * read off photos of the devices and the makers' renders, and they do not change with
 * the app's palette. An E Ink screen is pale in dark mode too, a Nano X is
 * black glass on a paper page, and a BitBox Nova is Bitcoin Orange whatever
 * the theme. Everything else in the drawings (the lit outline, the drawn
 * phone, the plain slab of an unknown model) uses theme tokens, and a guard
 * test (`ui/__tests__/hwwSigning.test.ts`) refuses a colour literal anywhere
 * else in them.
 *
 * Bodies: a Ledger is drawn in the neutral dark finish, because a client's
 * colour is unknown (the photographed Gen5 is red; it is not assumed). The Nova is
 * drawn in Bitcoin Orange, the finish the photos show and the design drew.
 */

/** The white of every product sheen, drawn at the stop strengths below. */
export const SHEEN = '#FFFFFF';

/** The E Ink of the touchscreen Ledgers (Gen5, Flex, Stax) and the ink on it. */
export const EINK = {
  paper: '#D2DAD5',
  ink: '#1A1C1B',
  dots: '#5C6662',
} as const;

/** The Nano Gen5, from photos of the device. */
export const GEN5 = {
  body: ['#464B52', '#1D2023'],
  seam: '#101312',
  silver: ['#E2E2E2', '#A3A3A3'],
  silverEdge: '#8F8F8F',
  pixel: '#2A2A2A',
  /** The bracket mark's white is SHEEN at this strength. */
  markStrength: 0.22,
  sheen: [0.38, 0.06, 0.14],
} as const;

/** The Ledger Flex, from Ledger's render: graphite with the copper chin. */
export const FLEX = {
  body: ['#3A3D41', '#1C1E21'],
  bezel: '#0C0D0E',
  orange: ['#F0803A', '#C9551A'],
  markInk: '#3A1F0E',
  chinEdgeStrength: 0.18,
  sheen: [0.3, 0.05, 0.12],
} as const;

/** The Ledger Stax, from Ledger's render: a dark green-black frame, the E Ink
 *  curving round the right edge. */
export const STAX = {
  frame: ['#2C3B35', '#0B1512'],
  bezel: '#0A0D0C',
  spine: ['#9FA8A3', '#5E6964'],
  button: ['#5C6B65', '#2B3632'],
  sheen: [0.28, 0.05, 0.14],
} as const;

/** The Nano X, from photos of the device: black glass, brushed-metal swivel cover. */
export const NANO_X = {
  glass: ['#262729', '#09090A'],
  buttonFill: '#050505',
  buttonRim: '#303134',
  metal: ['#C9CACD', '#85878B'],
  metalEdge: '#DEDFE1',
  cap: '#9C9EA2',
  capRim: '#D4D5D8',
  capInner: '#8A8C90',
  /** The OLED's white. */
  pixel: '#FFFFFF',
  edgeStrength: 0.14,
  buttonRingStrength: 0.08,
  coverLineStrength: 0.35,
} as const;

/** The BitBox02 Nova, from photos of the device: Bitcoin Orange, black glass, pale cyan OLED. */
export const NOVA = {
  body: ['#F08A2A', '#C2621A'],
  glass: ['#141516', '#050506'],
  oled: '#CDEFEA',
  plug: ['#CFCFD1', '#8E8F93'],
  markStrength: 0.22,
  sheen: [0.16, 0.02, 0],
} as const;
