import { holdKeyboard, keyboardHeld, releaseKeyboardHold } from '../keyboardHold';

describe('the keyboard hold a unit switch asks for', () => {
  beforeEach(() => releaseKeyboardHold());

  it('is off until a control asks for it', () => {
    expect(keyboardHeld()).toBe(false);
  });

  it('holds the keyboard for the tap that follows the press', () => {
    holdKeyboard();
    expect(keyboardHeld()).toBe(true);
  });

  it('never outlives the touch it was asked for', () => {
    const now = Date.now();
    holdKeyboard();
    expect(keyboardHeld(now + 500)).toBe(true);
    expect(keyboardHeld(now + 1500)).toBe(false);
  });

  it('is spent once it has been read, so the next tap elsewhere puts the keyboard away', () => {
    holdKeyboard();
    expect(keyboardHeld()).toBe(true);
    releaseKeyboardHold();
    expect(keyboardHeld()).toBe(false);
  });
});
