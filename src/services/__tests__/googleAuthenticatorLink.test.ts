import { googleAuthenticatorLink, parseTotpLink } from '../googleAuthenticatorLink';

const LINK = 'otpauth://totp/21st%20Capital:client%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=21st%20Capital';

describe('the link into Google Authenticator (decided 2026-09-21)', () => {
  it('reads the account, its name and the issuer', () => {
    const a = parseTotpLink(LINK);
    expect(a?.name).toBe('client@example.com');
    expect(a?.issuer).toBe('21st Capital');
    expect(a?.digits).toBe(6);
    // JBSWY3DPEHPK3PXP is "Hello!" followed by DE AD BE EF.
    expect(Array.from(a?.secret ?? [])).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, 0xde, 0xad, 0xbe, 0xef]);
  });

  it('takes the issuer from the label when the parameter is missing, and an unpadded key', () => {
    const a = parseTotpLink('otpauth://totp/21st%20Capital:a%40b.com?secret=jbswy3dpehpk3pxpgm');
    expect(a?.issuer).toBe('21st Capital');
    expect(a?.secret.length).toBe(11);
  });

  // A phone test, 2026-09-21: this form added the account as "TALIA: <email>".
  it('builds the link Google Authenticator added as TALIA: <email>', () => {
    expect(googleAuthenticatorLink(LINK, 'TALIA')).toBe('totp://TALIA%3A%20client@example.com#JBSWY3DPEHPK3PXP');
  });

  it('encodes what a URL user part cannot hold and keeps the key unpadded', () => {
    const link = 'otpauth://totp/X:first.last%2Btag%40mail.example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGE';
    expect(googleAuthenticatorLink(link, 'TALIA')).toBe(
      'totp://TALIA%3A%20first.last%2Btag@mail.example.com#GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGE',
    );
  });

  it('refuses what the old link form cannot carry', () => {
    expect(googleAuthenticatorLink(LINK + '&digits=8', 'TALIA')).toBeNull();
    expect(googleAuthenticatorLink(LINK + '&period=60', 'TALIA')).toBeNull();
    expect(googleAuthenticatorLink(LINK + '&algorithm=SHA256', 'TALIA')).toBeNull();
    expect(googleAuthenticatorLink('otpauth://totp/X:no-email?secret=JBSWY3DPEHPK3PXP', 'TALIA')).toBeNull();
    expect(googleAuthenticatorLink('otpauth://totp/x?secret=not-base32!', 'TALIA')).toBeNull();
    expect(googleAuthenticatorLink('', 'TALIA')).toBeNull();
  });
});
