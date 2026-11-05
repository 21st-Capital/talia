/**
 * The copied flash's backdrop stays light (decided 2026-10-04, on the Receive
 * screen's "Address copied": "make the background behind it a little bit
 * more transparent. It looks too blurred.").
 *
 * The flash is used wherever a copy matters, so the recipe lives in one
 * module and the component is held to it: a literal typed back into
 * CopiedFlash.tsx would bypass this test, so the source is read too.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { COPIED_FLASH_BLUR, COPIED_FLASH_DIM_ALPHA, copiedFlashMaterial } from '../copiedFlashBackdrop';

/** What the flash shipped with before the change of 2026-10-04: blur 6, the ground at 40%. */
const OLD_BLUR = 6;
const OLD_DIM_ALPHA = 0x66;

describe('the copied flash backdrop', () => {
  it('lays the plain style over the page, in both schemes', () => {
    // Measured 2026-10-04: Apple's materials ignore the library's blurAmount
    // and blur at their own heavy radius (the QR code became a blob at blur
    // 2 and 12 alike). The plain styles are the only two that take it.
    expect(copiedFlashMaterial('dark')).toBe('dark');
    expect(copiedFlashMaterial('light')).toBe('light');
  });

  it('blurs the page one step less than before, and still blurs it', () => {
    expect(COPIED_FLASH_BLUR).toBe(2);
    expect(COPIED_FLASH_BLUR).toBeLessThan(OLD_BLUR);
    expect(COPIED_FLASH_BLUR).toBeGreaterThanOrEqual(2);
  });

  it('dims the page one step less than before, and still dims it', () => {
    expect(COPIED_FLASH_DIM_ALPHA).toBe('1A');
    // Two hex digits, so `hull + alpha` stays an 8-digit colour.
    expect(COPIED_FLASH_DIM_ALPHA).toMatch(/^[0-9A-F]{2}$/);
    const alpha = parseInt(COPIED_FLASH_DIM_ALPHA, 16);
    expect(alpha).toBeLessThan(OLD_DIM_ALPHA);
    // The style's own tint does most of the darkening, so the dim can be
    // thin; under 10% it is not there at all.
    expect(alpha).toBeGreaterThanOrEqual(0x1A);
  });
});

describe('CopiedFlash takes the whole recipe from the one module', () => {
  const source = readFileSync(join(__dirname, '..', 'CopiedFlash.tsx'), 'utf8');

  it('takes the material from the module, never a style of its own', () => {
    expect(source).toContain('blurType={copiedFlashMaterial(getColorScheme())}');
    expect(source).not.toMatch(/blurType=\{\s*['"]/);
    expect(source).not.toMatch(/blurType=\{\s*getColorScheme/);
  });

  it('blurs by the shared constant, never a literal', () => {
    expect(source).toContain('blurAmount={COPIED_FLASH_BLUR}');
    expect(source).not.toMatch(/blurAmount=\{\s*\d/);
  });

  it('dims by the shared alpha on the one opaque ground token', () => {
    expect(source).toContain('theme.colors.hull + COPIED_FLASH_DIM_ALPHA');
    // No second alpha suffix anywhere in the file: one dim, one source of truth.
    expect(source).not.toMatch(/hull \+ '/);
  });
});
