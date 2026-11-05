import { FIELD_MARGIN, overlapsHost, revealFloor, revealOverlap, revealSpan } from '../revealOverlap';

describe('revealOverlap', () => {
  const hostTop = 100;
  const keyboardTop = 600;

  it('does nothing when the confirm already clears the keys', () => {
    expect(revealOverlap({ fieldTop: 300, wanted: 550, keyboardTop, hostTop })).toBe(0);
  });

  it('scrolls exactly enough to clear the keys when the field has room above it', () => {
    // field at 400, button ends at 700: needs 100, field can rise 276.
    expect(revealOverlap({ fieldTop: 400, wanted: 700, keyboardTop, hostTop })).toBe(100);
  });

  it('never pushes the field off the top to show a distant button', () => {
    // Found in a phone test (2026-09-19): the field sat 140pt below the top; Continue was 500pt
    // further down. Only the room above the field may be spent.
    const fieldTop = 240;
    const overlap = revealOverlap({ fieldTop, wanted: 1100, keyboardTop, hostTop });
    expect(overlap).toBe(fieldTop - (hostTop + FIELD_MARGIN));
    expect(fieldTop - overlap).toBe(hostTop + FIELD_MARGIN);
  });

  it('a field already at the top stays put', () => {
    expect(revealOverlap({ fieldTop: hostTop + 10, wanted: 900, keyboardTop, hostTop })).toBe(0);
  });
});

describe('revealFloor', () => {
  it('a scroll view that runs under the keys keeps the keys as the floor', () => {
    expect(revealFloor(600, 812)).toBe(600);
    expect(revealFloor(600, 600)).toBe(600);
  });

  it("a scroll area that ends above the keys (a sheet's foot, a risen footer) is the floor itself", () => {
    expect(revealFloor(600, 530)).toBe(530);
  });

  it("under a sheet's foot the confirm is scrolled clear of the scroll area, not of the keys", () => {
    // Decided 2026-10-05, the key sheet with a Back at its foot: the foot and
    // the keyboard padding end the scroll area 70pt above the keys. Measured
    // against the keys, Add key (ending 32pt above them) needed nothing and
    // sat 38pt under the foot's Back; against the area's own edge it rises.
    const a = { fieldTop: 400, wanted: 568, hostTop: 100 };
    expect(revealOverlap({ ...a, keyboardTop: 600 })).toBe(0);
    expect(revealOverlap({ ...a, keyboardTop: revealFloor(600, 530) })).toBe(38);
  });
});

describe('the code field above the keys (decided 2026-10-18)', () => {
  // Measured on the iPhone SE simulator, the authenticator step of the
  // co-signing request: the scroll area 70+287 above the risen footer, the
  // keys at 432, the boxes' input at 371+58, the whole field (label, boxes,
  // Paste) at 341+151.
  const host = { y: 70, h: 287 };
  const keyboardTop = 432;
  const input = { y: 371, h: 58 };
  const field = { y: 341, h: 151 };

  it('the old test took the boxes, scrolled under the footer, for another screen and left them there', () => {
    expect(overlapsHost(input, host)).toBe(false);
    // Inside and on screen, it says yes.
    expect(overlapsHost({ y: 200, h: 58 }, host)).toBe(true);
    expect(overlapsHost({ y: 340, h: 58 }, host)).toBe(true);
  });

  it("the field's extent counts below the input, and only below: the input's own top stays the bound", () => {
    expect(revealSpan(input, field)).toEqual({ top: 371, bottom: 492 });
    expect(revealSpan(input, null)).toEqual({ top: 371, bottom: 429 });
    // An extent that measures as nothing (unmounted) is ignored.
    expect(revealSpan(input, { y: 0, h: 0 })).toEqual({ top: 371, bottom: 429 });
    // An extent ending above the input's bottom never shortens it.
    expect(revealSpan(input, { y: 300, h: 40 })).toEqual({ top: 371, bottom: 429 });
  });

  it('lifts the boxes AND their Paste clear of the footer, never the boxes past the top', () => {
    const span = revealSpan(input, field);
    const floor = revealFloor(keyboardTop, host.y + host.h);
    const overlap = revealOverlap({ fieldTop: span.top, wanted: span.bottom + 28 + 4, keyboardTop: floor, hostTop: host.y });
    // 492 + 32 - 357: Paste and the fade's room above the footer.
    expect(overlap).toBe(167);
    expect(span.bottom - overlap + 28 + 4).toBeLessThanOrEqual(floor);
    expect(span.top - overlap).toBeGreaterThanOrEqual(host.y + FIELD_MARGIN);
  });

  it('on a scroll area too short for all of it, the boxes win over the Paste', () => {
    const short = { y: 70, h: 120 };
    const span = revealSpan(input, field);
    const floor = revealFloor(keyboardTop, short.y + short.h);
    const overlap = revealOverlap({ fieldTop: span.top, wanted: span.bottom + 32, keyboardTop: floor, hostTop: short.y });
    expect(span.top - overlap).toBe(short.y + FIELD_MARGIN);
  });
});
