/**
 * The history rows' two numbers (decided 2026-10-22, from a client's phone
 * with larger text): where the first line sits beside the direction mark at
 * any text size, and when the figures have moved under the title.
 */
import { factsStacked, firstLineLift, morphCaptionWidth, textEnlarged } from '../ledgerRowLayout';

describe('the first line beside the mark', () => {
  it('sits on the mark’s centre at the standard size', () => {
    // A 38pt mark and a 20.4pt line: 8.8pt down.
    expect(firstLineLift(38, 20.4, 1)).toBeCloseTo(8.8);
  });

  it('comes up as the text grows, and starts at the top once the line is taller than the mark', () => {
    expect(firstLineLift(38, 20.4, 1.35)).toBeCloseTo((38 - 20.4 * 1.35) / 2);
    expect(firstLineLift(38, 20.4, 1.65)).toBeCloseTo((38 - 20.4 * 1.65) / 2);
    expect(firstLineLift(38, 20.4, 2)).toBe(0);
    expect(firstLineLift(38, 20.4, 3.12)).toBe(0);
  });

  it('reads a missing or damaged text size as the standard one', () => {
    expect(firstLineLift(38, 20.4, Number.NaN)).toBeCloseTo(8.8);
    expect(firstLineLift(38, 20.4, 0)).toBeCloseTo(8.8);
  });
});

describe('the docked "as of" line', () => {
  it('takes all the room between the header buttons, in the balance block\'s own points', () => {
    // 375pt wide, 64pt of button and margin each side, docked at 0.425.
    expect(morphCaptionWidth(375, 64, 0.425)).toBeCloseTo(247 / 0.425);
    // Visible width when docked: exactly the room between the buttons.
    expect(morphCaptionWidth(402, 64, 0.425) * 0.425).toBeCloseTo(274);
  });

  it('never goes below nothing, and survives a bad scale', () => {
    expect(morphCaptionWidth(100, 64, 0.425)).toBe(0);
    expect(morphCaptionWidth(375, 64, 0)).toBe(247);
  });
});

describe('a label and its value', () => {
  it('share a line up to the largest standard text size, and stack at the accessibility sizes', () => {
    for (const standard of [0.82, 1, 1.12, 1.24, 1.35]) expect(factsStacked(standard)).toBe(false);
    for (const accessibility of [1.64, 1.95, 2.35, 2.76, 3.12]) expect(factsStacked(accessibility)).toBe(true);
    expect(factsStacked(Number.NaN)).toBe(false);
  });
});

describe('larger text', () => {
  it('is any size above the standard one', () => {
    for (const size of [0.82, 0.94, 1]) expect(textEnlarged(size)).toBe(false);
    for (const size of [1.12, 1.35, 1.95, 3.12]) expect(textEnlarged(size)).toBe(true);
    expect(textEnlarged(Number.NaN)).toBe(false);
  });
});
