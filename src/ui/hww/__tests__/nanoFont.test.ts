/**
 * The Nano X's type as the device measures it: NBGL's Open Sans Regular
 * 11px advances less its kerning, a 114-pixel line, the character that
 * would overflow starting the next line, a word delimiter ending the line
 * where there is one. Checked against a video of a Nano X registering
 * a 2-of-3 (2026-10-04): the 16 lines of two of its keys and its "Spending
 * policy" sentence break where this says.
 */
import { NANO_KERNING, NANO_LINE_WIDTH, nanoCharWidth, nanoLines, nanoPages, nanoTextWidth } from '../nanoFont';
import { NANO_X_KEYS, NANO_X_LINES } from '../__fixtures__/nanoXRegistration';

describe('the advances', () => {
  it('are the font’s widths less its kerning of one, for every printable ASCII character, and nothing for any other', () => {
    expect(NANO_KERNING).toBe(1);
    expect(nanoCharWidth(' ')).toBe(3);
    expect(nanoCharWidth('M')).toBe(10);
    expect(nanoCharWidth('i')).toBe(3);
    expect(nanoCharWidth("'")).toBe(2);
    expect(nanoCharWidth('~')).toBe(6);
    for (let c = 0x20; c <= 0x7e; c++) expect(nanoCharWidth(String.fromCharCode(c))).toBeGreaterThan(0);
    expect(nanoCharWidth('\n')).toBe(0);
    expect(nanoCharWidth('é')).toBe(0);
    expect(nanoCharWidth('')).toBe(0);
    expect(nanoTextWidth('')).toBe(0);
    // The filmed origin line of key@0 sits at exactly the line's width.
    expect(nanoTextWidth("[4a290600/48'/1'/0'/2']")).toBe(114);
    expect(nanoTextWidth('Any 2 of @0, @1 and ')).toBe(111);
  });

  it('a line is 114 pixels: the 128 of the screen less seven at each edge', () => {
    expect(NANO_LINE_WIDTH).toBe(114);
  });
});

describe('the lines', () => {
  it('break the two filmed keys exactly where the Nano X broke them', () => {
    NANO_X_KEYS.forEach((key, i) => {
      expect(nanoLines(key)).toEqual([...NANO_X_LINES[i]]);
      expect(nanoLines(key).join('')).toBe(key);
    });
  });

  it('every line fits, and the next character would not have', () => {
    for (const key of NANO_X_KEYS) {
      const lines = nanoLines(key);
      let at = 0;
      lines.forEach((line, i) => {
        expect(nanoTextWidth(line)).toBeLessThanOrEqual(NANO_LINE_WIDTH);
        at += line.length;
        if (i < lines.length - 1) expect(nanoTextWidth(line) + nanoCharWidth(key[at])).toBeGreaterThan(NANO_LINE_WIDTH);
      });
    }
  });

  it('a sentence breaks after its last space that fits, as "Spending policy" did on the video', () => {
    expect(nanoLines('Any 2 of @0, @1 and @2 must sign')).toEqual(['Any 2 of @0, @1 and ', '@2 must sign']);
    // A dash and an underscore end a line the same way; a key has none of them.
    expect(nanoLines('abcdefghijklmnopqr-stuvwxyzabcdef')).toEqual(['abcdefghijklmnopqr-', 'stuvwxyzabcdef']);
    expect(nanoLines('abcdefghijklmnopqr_stuvwxyzabcdef')).toEqual(['abcdefghijklmnopqr_', 'stuvwxyzabcdef']);
  });

  it('a line feed ends a line; nothing is lost; an empty text has no line', () => {
    expect(nanoLines('Review account\nto register')).toEqual(['Review account\n', 'to register']);
    expect(nanoLines('')).toEqual([]);
    expect(nanoLines('a')).toEqual(['a']);
  });

  it('a narrower line breaks sooner', () => {
    expect(nanoLines(NANO_X_KEYS[0], 60).length).toBeGreaterThan(nanoLines(NANO_X_KEYS[0]).length);
  });
});

describe('the pages', () => {
  it('are so many lines each, in order, and make the text again', () => {
    for (const key of NANO_X_KEYS) {
      const pages = nanoPages(key, 3);
      expect(pages.join('')).toBe(key);
      expect(pages).toHaveLength(3);
      const lines = nanoLines(key);
      expect(pages[0]).toBe(lines.slice(0, 3).join(''));
      expect(pages[2]).toBe(lines.slice(6).join(''));
    }
    expect(nanoPages(NANO_X_KEYS[0], 8)).toEqual([NANO_X_KEYS[0]]);
    expect(nanoPages('', 3)).toEqual([]);
  });
});
