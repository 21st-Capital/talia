import { focusedFieldExtent, registerFieldExtent } from '../fieldExtent';

/**
 * The keyboard scroller asks which registered field holds the keyboard and
 * keeps that field's whole extent clear (decided 2026-10-18: the code boxes AND
 * their Paste above the keys).
 */
describe('fieldExtent', () => {
  const view = (name: string) => ({ name, measureInWindow: () => undefined });

  it("answers with the FOCUSED field's extent, and nothing when no registered field is focused", () => {
    let focused = 'none';
    const email = view('email');
    const totp = view('totp');
    const offA = registerFieldExtent({ focused: () => focused === 'email', extent: () => email });
    const offB = registerFieldExtent({ focused: () => focused === 'totp', extent: () => totp });
    expect(focusedFieldExtent()).toBeNull();
    focused = 'totp';
    expect(focusedFieldExtent()).toBe(totp);
    focused = 'email';
    expect(focusedFieldExtent()).toBe(email);
    offA();
    offB();
  });

  it('an unmounted field is forgotten', () => {
    const totp = view('totp');
    const off = registerFieldExtent({ focused: () => true, extent: () => totp });
    expect(focusedFieldExtent()).toBe(totp);
    off();
    expect(focusedFieldExtent()).toBeNull();
  });
});
