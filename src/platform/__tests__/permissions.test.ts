/**
 * The one trap in reading iOS's camera answer (decided 2026-09-26): the library
 * types it `boolean` and returns -1 for "never asked", which is TRUTHY. Read
 * as a boolean, a phone that has never been asked reads as one that said yes,
 * the system is never asked, and the client gets the blank camera that started
 * all this.
 */
import { readIosAnswer } from '../permissionAnswer';

describe('the camera answer', () => {
  it('reads authorized', () => {
    expect(readIosAnswer(true)).toBe('granted');
  });

  it('reads NEVER ASKED, which is truthy, as undetermined', () => {
    expect(readIosAnswer(-1)).toBe('undetermined');
    // The bug this test exists for.
    expect(Boolean(-1)).toBe(true);
  });

  it('reads a refusal as denied', () => {
    expect(readIosAnswer(false)).toBe('denied');
    // Restricted, and anything else the module might answer.
    expect(readIosAnswer(0)).toBe('denied');
  });
});
