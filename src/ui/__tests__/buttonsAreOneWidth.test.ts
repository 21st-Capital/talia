/**
 * Buttons stacked one under another are the SAME width, on every screen.
 *
 * Found in a phone test (2026-09-23), on the Liana export sheet: "why are the bottons in
 * three different sizes? that looks really odd! please review the app and
 * make sure no screen shows bottons that are displayed below eachother are
 * not displayed in different sizes!"
 *
 * The cause was one line, not one screen: Button sized itself to its own
 * label, so wherever a container centred its children each button came out
 * the width of its own words. `alignSelf: 'stretch'` in the base style fixes
 * every screen at once, which is why this test guards THAT and not a list of
 * sheets somebody has to remember to extend.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const BUTTON = join(__dirname, '..', 'components', 'Button.tsx');

describe('the one button width', () => {
  const source = readFileSync(BUTTON, 'utf8');

  it('stretches to its container in the BASE style', () => {
    const base = source.slice(source.indexOf('base: {'), source.indexOf('primary: {'));
    expect(base).toContain("alignSelf: 'stretch'");
  });

  it('keeps one minimum height for every variant', () => {
    // Different heights read as different sizes just as much as different
    // widths do. The height lives on `base` and nowhere else.
    const variants = source.slice(source.indexOf('primary: {'));
    expect(variants).not.toMatch(/minHeight/);
    expect(variants).not.toMatch(/paddingVertical/);
  });
});
