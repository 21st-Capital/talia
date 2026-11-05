import { twoFactorProof } from '../twoFactorProof';

describe('twoFactorProof', () => {
  it('reads six digits as an authenticator code', () => {
    expect(twoFactorProof(' 123 456 ')).toEqual({ otp_code: '123456' });
  });

  it('reads anything else as a recovery code, in capitals', () => {
    expect(twoFactorProof('ab12-cd34')).toEqual({ recovery_code: 'AB12CD34' });
    expect(twoFactorProof('12345678')).toEqual({ recovery_code: '12345678' });
  });

  it('gives nothing for an empty field', () => {
    expect(twoFactorProof('  ')).toBeNull();
  });
});
