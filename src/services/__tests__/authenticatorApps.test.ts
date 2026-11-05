import {
  APPLE_PASSWORDS,
  AUTHENTICATOR_APPS,
  GET_GOOGLE_AUTHENTICATOR,
  applePasswordsLink,
  relabelTotpLink,
  authenticatorChoices,
  authenticatorStep,
} from '../authenticatorApps';

const LINK = 'otpauth://totp/21st%20Capital:user%40example.com?secret=ABC&issuer=21st%20Capital';

describe('authenticator apps (decided 2026-09-21)', () => {
  it('lists Google Authenticator first', () => {
    expect(AUTHENTICATOR_APPS[0].name).toBe('Google Authenticator');
  });

  it('never probes a scheme several apps share', () => {
    for (const app of [...AUTHENTICATOR_APPS, APPLE_PASSWORDS]) {
      expect(app.url).not.toMatch(/^(otpauth|totp):/);
    }
  });

  it('addresses the account to Apple Passwords under the TALIA label', () => {
    expect(applePasswordsLink(LINK)).toBe('apple-otpauth://totp/TALIA:user%40example.com?secret=ABC&issuer=TALIA');
  });

  it('relabels a link with no issuer and leaves anything else alone', () => {
    expect(relabelTotpLink('otpauth://totp/user%40example.com?secret=ABC&digits=6')).toBe(
      'otpauth://totp/TALIA:user%40example.com?secret=ABC&digits=6&issuer=TALIA',
    );
    expect(relabelTotpLink('https://example.com')).toBe('https://example.com');
  });

  it('offers the installed apps in order, then Apple Passwords', () => {
    const rows = authenticatorChoices(new Set(['authy', 'google']), true).map((a) => a.key);
    expect(rows).toEqual(['google', 'authy', 'apple']);
  });

  it('opens the only app at once, lists several, and offers the store for none', () => {
    const google = authenticatorChoices(new Set(['google']), false);
    expect(authenticatorStep(google)).toEqual({ kind: 'open', app: google[0] });
    expect(authenticatorStep(authenticatorChoices(new Set(['microsoft']), false)).kind).toBe('open');
    expect(authenticatorStep(authenticatorChoices(new Set(['google']), true)).kind).toBe('choose');
    expect(authenticatorStep([])).toEqual({ kind: 'store' });
  });

  it('keeps Google Authenticator on offer when Passwords is the only code app', () => {
    expect(authenticatorChoices(new Set(), true)).toEqual([GET_GOOGLE_AUTHENTICATOR, APPLE_PASSWORDS]);
    expect(authenticatorChoices(new Set(), false)).toEqual([]);
  });
});
