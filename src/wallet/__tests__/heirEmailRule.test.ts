/**
 * An heir who holds a key must give an address; one who holds none need not
 * (decided 2026-09-23). The rule exists because the backend recognises an heir by
 * their verified email, so a key holder with no address would be refused the
 * day they ask us to co-sign or rescue.
 */
import { NO_KEY_ACCESS, heirEmailOk, heirEmailRequired, heirHoldsKey } from '../heirEmailRule';

describe('when an heir must give an email', () => {
  it('a key holder must', () => {
    expect(heirEmailRequired('Ledger (PPH: test1)')).toBe(true);
    expect(heirEmailOk('', 'Ledger (PPH: test1)')).toBe(false);
    expect(heirEmailOk('heir@example.com', 'Ledger (PPH: test1)')).toBe(true);
    expect(heirEmailOk('not-an-address', 'Ledger (PPH: test1)')).toBe(false);
  });

  it('a child with no key need not, which is why the field exists', () => {
    expect(heirEmailRequired(NO_KEY_ACCESS)).toBe(false);
    expect(heirEmailOk('', NO_KEY_ACCESS)).toBe(true);
    expect(heirEmailOk('  ', NO_KEY_ACCESS)).toBe(true);
  });

  it('a blank key is not a key: an unfinished row does not demand an address', () => {
    expect(heirHoldsKey('')).toBe(false);
    expect(heirHoldsKey(undefined)).toBe(false);
    expect(heirEmailOk('', '')).toBe(true);
  });

  it('a wrongly shaped address is refused whoever holds what', () => {
    expect(heirEmailOk('nope@', NO_KEY_ACCESS)).toBe(false);
    expect(heirEmailOk('a@b.c', NO_KEY_ACCESS)).toBe(true);
  });
});
