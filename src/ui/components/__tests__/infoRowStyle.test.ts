/**
 * Where the ⓘ sits (decided 2026-09-21): level with the first line of its text,
 * the way it sits beside "Invite an heir", on every screen.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { INFO_DOT, infoDotTop, lineHeightOf, splitInfoRowStyle } from '../infoRowStyle';

describe('the dot sits on the middle of the first line', () => {
  it('centres the 20pt dot on a line box', () => {
    expect(INFO_DOT).toBe(20);
    expect(infoDotTop(28)).toBe(4); // title, "Invite an heir"
    expect(infoDotTop(22)).toBe(1); // heading
    expect(infoDotTop(18)).toBe(-1); // label, "WHAT IT TAKES TO OPEN IT"
  });

  it('reads the line box from the style', () => {
    expect(lineHeightOf({ fontSize: 22, lineHeight: 28 })).toBe(28);
    expect(lineHeightOf({ fontSize: 20 })).toBe(26);
    expect(lineHeightOf({})).toBe(22);
  });
});

describe('spacing goes to the row, never to the text', () => {
  it('moves a bottom margin off the text ("Where is this key now?")', () => {
    const { row, text } = splitInfoRowStyle({ fontSize: 22, lineHeight: 28, marginBottom: 16 });
    expect(row).toEqual({ marginBottom: 16 });
    expect(text).toEqual({ fontSize: 22, lineHeight: 28 });
  });

  it('moves a top margin off the text ("WHAT IT TAKES TO OPEN IT")', () => {
    const { row, text } = splitInfoRowStyle({ fontSize: 13, lineHeight: 18, marginTop: 16, letterSpacing: 1 });
    expect(row).toEqual({ marginTop: 16 });
    expect(text).toEqual({ fontSize: 13, lineHeight: 18, letterSpacing: 1 });
  });

  it('moves vertical padding and placement too, and keeps a centred line centred', () => {
    const { row, text } = splitInfoRowStyle({
      paddingTop: 4,
      paddingVertical: 2,
      alignSelf: 'center',
      textAlign: 'center',
      color: 'x',
    });
    expect(row).toEqual({ paddingTop: 4, paddingVertical: 2, alignSelf: 'center', justifyContent: 'center' });
    expect(text).toEqual({ textAlign: 'center', color: 'x' });
  });
});

describe('every dot goes through InfoHeading', () => {
  const ui = join(__dirname, '..', '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== '__tests__') walk(p);
      } else if (p.endsWith('.tsx')) files.push(p);
    }
  };
  walk(ui);

  // A hand-built row put the dot wherever that screen's styles happened to
  // leave it. The Ledger pairing note is the one exception: a spinner, a
  // paragraph and the dot share a row, and it levels the dot with
  // infoDotTop itself.
  const ALLOWED = ['InfoDot.tsx', 'LedgerConnectFlow.tsx'];

  it('no screen places a bare InfoDot', () => {
    const offenders = files
      .filter((f) => !ALLOWED.some((a) => f.endsWith(a)))
      .filter((f) => /<InfoDot\b/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ui.length + 1));
    expect(offenders).toEqual([]);
  });
});
