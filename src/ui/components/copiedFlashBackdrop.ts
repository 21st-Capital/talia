/**
 * The copied flash's backdrop: which of Apple's blur styles lies over the
 * page, how far it blurs and how much the page dims under it. One place for
 * the recipe, so the three move together and a test can hold them.
 *
 * Decided 2026-09-14: "a little bit less blurry, or more transparent" gave blur 6
 * and the ground at 40%. Decided 2026-10-04, on the Receive screen: "make the
 * background behind 'Address copied' a little bit more transparent. It looks
 * too blurred."
 *
 * Measured on the simulator that day, before changing anything:
 *  - Apple's materials (ultraThin, thin, regular, prominent) IGNORE the
 *    library's `blurAmount` and blur at their own heavy radius: the QR code
 *    became a blob at blur 2 and at blur 12 alike. Only the plain `dark` and
 *    `light` styles take the radius.
 *  - Those plain styles carry their own tint, and it fixes most of the
 *    darkening: under `dark` a white QR tile fell to about 45% of its
 *    brightness before any dim was painted. The dim on top is a small lever
 *    (40% to 25% moved the tile by a few percent).
 * So: the plain styles stay, the radius is what "too blurred" answers to,
 * and the dim is thinned hard because thinning it a little changes nothing
 * visible. The card keeps its own frost (GlassPanel) and still reads over a
 * white QR code.
 */
import type { BlurViewProps } from '@react-native-community/blur';

/** Apple's style over the page, per colour scheme: the plain ones, the only
 *  two whose radius the library can set. */
export function copiedFlashMaterial(scheme: 'dark' | 'light'): NonNullable<BlurViewProps['blurType']> {
  return scheme === 'dark' ? 'dark' : 'light';
}

/** BlurView `blurAmount` over the page. Was 6. The first design pass picked 3; the choice was one
 *  step lighter from the side-by-side (2026-10-04: "pick one lighter version"). */
export const COPIED_FLASH_BLUR = 2;

/**
 * The dim over the page: the ground colour at this alpha (two hex digits).
 * Was '66' (40%); '1A' is 10% (the chosen one, one step under the first pass's '26', 15%). `hull` is the one opaque 6-digit ground
 * token, so an alpha suffix is safe on it (the translucent tokens must
 * never get one).
 */
export const COPIED_FLASH_DIM_ALPHA = '1A';
