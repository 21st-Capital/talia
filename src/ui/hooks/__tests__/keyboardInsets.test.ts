import { FOOTED_INSET, keyboardInsets } from '../keyboardInsets';

/**
 * Found in a phone test on 2026-10-18: "The authenticator code request moves all the way up beyond
 * the screen when the key pad spaces are clicked." React Native kept the
 * keyboard inset its automatic mode had set when the authenticator step's
 * footer arrived with the keys up, because switching the mode off takes
 * nothing back, and it writes `contentInset` only when the PROP changes.
 */
describe('keyboardInsets', () => {
  it('a page without a footer keeps the automatic keyboard inset and asks for none of its own', () => {
    const props = keyboardInsets(false);
    expect(props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(props.contentInset).toEqual({ top: 0, left: 0, bottom: 0, right: 0 });
    expect(props.scrollIndicatorInsets).toEqual({ top: 0, left: 0, bottom: 0, right: 0 });
  });

  it('a page with a footer turns the automatic inset off: the footer rises with the keys', () => {
    expect(keyboardInsets(true).automaticallyAdjustKeyboardInsets).toBe(false);
  });

  it('a footer arriving CHANGES the inset prop, so the stale keyboard inset is written over', () => {
    // The emailed code (no footer) then the authenticator code (Back in the
    // footer), keys up throughout: the props of the two renders must differ,
    // or React Native leaves the 308pt keyboard inset of the first in place.
    const email = keyboardInsets(false);
    const authenticator = keyboardInsets(true);
    expect(authenticator.contentInset).not.toEqual(email.contentInset);
    expect(authenticator.scrollIndicatorInsets).not.toEqual(email.scrollIndicatorInsets);
    // ...and the way back changes it again.
    expect(keyboardInsets(false).contentInset).not.toEqual(authenticator.contentInset);
  });

  it('the footed inset is a point at the bottom and nothing else, never a keyboard of room', () => {
    expect(FOOTED_INSET).toBeGreaterThan(0);
    expect(FOOTED_INSET).toBeLessThanOrEqual(1);
    expect(keyboardInsets(true).contentInset).toEqual({ top: 0, left: 0, bottom: FOOTED_INSET, right: 0 });
  });

  it('the same answer for the same footer, render after render (no needless writes)', () => {
    expect(keyboardInsets(true)).toEqual(keyboardInsets(true));
    expect(keyboardInsets(false)).toEqual(keyboardInsets(false));
  });
});
