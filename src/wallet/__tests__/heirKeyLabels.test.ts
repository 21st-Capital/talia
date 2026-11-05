import { hasOwnerSideLabels, heirSideKeyLabels } from '../heirKeyLabels';

describe("key names on an heir's phone (decided 2026-09-22)", () => {
  it("the builder's owner-side names read as the owner's", () => {
    expect(
      heirSideKeyLabels({
        aaaaaaaa: 'Your key',
        bbbbbbbb: 'Your key 2',
        cccccccc: 'Your co-signer key',
      }),
    ).toEqual({ aaaaaaaa: 'Owner key', bbbbbbbb: 'Owner key 2', cccccccc: 'Owner co-signer key' });
  });

  it("keeps every other name as the owner wrote it", () => {
    const names = { a: 'Office Ledger', b: 'Heir 1', c: '21st Capital rescue key', d: 'Your keys are safe' };
    expect(heirSideKeyLabels(names)).toEqual(names);
  });

  it('tells whether a copy still needs it', () => {
    expect(hasOwnerSideLabels({ a: 'Your key 3' })).toBe(true);
    expect(hasOwnerSideLabels({ a: 'Owner key 3', b: 'Heir 1' })).toBe(false);
    expect(hasOwnerSideLabels(undefined)).toBe(false);
    expect(heirSideKeyLabels(undefined)).toBeUndefined();
  });
});
