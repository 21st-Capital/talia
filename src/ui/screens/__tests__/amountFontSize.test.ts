import { amountEms, amountFontSize, HERO_SIZE, MIN_AMOUNT_SIZE } from '../amountFontSize';

/** What the input really draws: the measured advances plus letter spacing. */
const drawnWidth = (text: string, size: number) => size * amountEms(text) + 0.2 * text.length;

/** The Send field takes at most 14 characters (SendScreen.onAmountChange). */
const MAX_ENTRY = 14;
/** The narrowest amount row on a phone the app supports (375pt wide screen). */
const NARROWEST_ROW = 190;

describe('amountFontSize', () => {
  it('stays at the hero size while the figure fits', () => {
    expect(amountFontSize('0', 200)).toBe(HERO_SIZE);
    expect(amountFontSize('0.0001', 200)).toBe(HERO_SIZE);
  });
  it('shrinks step by step as digits are added', () => {
    const a = amountFontSize('1000000', 180);
    const b = amountFontSize('10000000', 180);
    const c = amountFontSize('100000000', 180);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeLessThan(HERO_SIZE);
  });
  it('never drops below the readable floor', () => {
    expect(amountFontSize('1'.repeat(40), 200)).toBe(MIN_AMOUNT_SIZE);
  });
  it('before the row has a width it uses the hero size', () => {
    expect(amountFontSize('123456789', 0)).toBe(HERO_SIZE);
  });

  // A phone test's screenshot, 2026-09-20: 0.00084000 was drawn past the card's edge.
  it('keeps the figure the phone test saw cut inside the row', () => {
    const size = amountFontSize('0.00084000', 212);
    expect(drawnWidth('0.00084000', size)).toBeLessThanOrEqual(212);
    expect(size).toBeLessThan(HERO_SIZE);
  });

  it('draws no figure the field accepts wider than the row it sits in', () => {
    for (let width = NARROWEST_ROW; width <= 280; width += 2) {
      for (let chars = 1; chars <= MAX_ENTRY; chars++) {
        // Zeros are the widest digits, so this is the worst case of each length.
        const text = chars <= 2 ? '0'.repeat(chars) : `0.${'0'.repeat(chars - 2)}`;
        const size = amountFontSize(text, width);
        expect(drawnWidth(text, size)).toBeLessThanOrEqual(width);
        expect(size).toBeGreaterThanOrEqual(MIN_AMOUNT_SIZE);
      }
    }
  });

  it('gives a size that depends on the count, not on which digits', () => {
    expect(amountFontSize('11111111', 200)).toBe(amountFontSize('00000000', 200));
  });

  // The phone's text sizes, from Extra Small to the largest accessibility size.
  const TEXT_SIZES = [0.82, 0.88, 0.95, 1, 1.12, 1.23, 1.35, 1.64, 1.95, 2.35, 2.76, 3.12];
  /** What the input draws at a text size: React Native scales the font by it. */
  const drawnAt = (text: string, size: number, scale: number) =>
    size * scale * amountEms(text) + 0.2 * text.length * scale;

  // A phone test, 2026-11-04: at "extra large" text a payment request's
  // 0.00005107 read 0.0000510 in a 201pt row.
  it('keeps the request the phone test cut whole at its text size', () => {
    expect(drawnAt('0.00005107', amountFontSize('0.00005107', 201), 1.12)).toBeGreaterThan(201 * 0.97);
    expect(drawnAt('0.00005107', amountFontSize('0.00005107', 201, 1.12), 1.12)).toBeLessThanOrEqual(201);
  });

  it('draws no figure the field accepts wider than its row at any text size', () => {
    for (const scale of TEXT_SIZES) {
      for (let width = NARROWEST_ROW; width <= 280; width += 6) {
        for (let chars = 1; chars <= MAX_ENTRY; chars++) {
          const text = chars <= 2 ? '0'.repeat(chars) : `0.${'0'.repeat(chars - 2)}`;
          const size = amountFontSize(text, width, scale);
          expect(drawnAt(text, size, scale)).toBeLessThanOrEqual(width);
          expect(size * scale).toBeGreaterThanOrEqual(MIN_AMOUNT_SIZE);
        }
      }
    }
  });

  it('changes nothing at the standard text size', () => {
    for (const [text, width] of [['0', 200], ['0.00084000', 212], ['123456789', 180]] as const) {
      expect(amountFontSize(text, width, 1)).toBe(amountFontSize(text, width));
    }
  });

  it('still lets a short figure grow with the text size, as the hero does', () => {
    expect(amountFontSize('5', 200, 1.12) * 1.12).toBeCloseTo(HERO_SIZE * 1.12);
  });
});
