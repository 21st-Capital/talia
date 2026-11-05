/**
 * Decided 2026-09-26: a talia:// or tiam://
 * link is data from a stranger. Only the exact shapes our website writes are
 * accepted, and no link can sign anyone in.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { inviteCodeFromUrl, isCheckoutReturnUrl, parseDeepLink } from '../deepLinks';

const HEIR = 'TALIA-ABCDE-FGH1J-K2MNP-QRSTV';
const PORTFOLIO = 'TALIA-P-ABCDE-FGH1J-K2MNP-QRSTV';

describe('invite links', () => {
  it('accepts an heir or a portfolio code, on either scheme', () => {
    expect(inviteCodeFromUrl(`talia://invite/${HEIR}`)).toBe(HEIR);
    expect(inviteCodeFromUrl(`tiam://invite/${HEIR}`)).toBe(HEIR);
    expect(inviteCodeFromUrl(`talia://invite/${PORTFOLIO}`)).toBe(PORTFOLIO);
    expect(inviteCodeFromUrl(`TALIA://invite/${encodeURIComponent(HEIR)}/`)).toBe(HEIR);
  });

  it('refuses anything that is not a real code', () => {
    for (const url of [
      'talia://invite/',
      'talia://invite/hello',
      'talia://invite/TALIA-ABCDE-FGH1J-K2MNP', // too short
      `talia://invite/${HEIR}/more`,
      `talia://invite/${HEIR}?next=tiam://auth/callback`,
      `talia://invite/${HEIR}#x`,
      'talia://invite/%E0%A4%A', // broken escape
      `https://21stcapital.com/invite/${HEIR}`,
      `evil://invite/${HEIR}`,
      `talia://invite/${'A'.repeat(300)}`,
      null,
      undefined,
      '',
    ]) {
      expect(inviteCodeFromUrl(url as string)).toBeNull();
    }
  });
});

describe('checkout return', () => {
  it('accepts the website return, with or without its quote id', () => {
    expect(isCheckoutReturnUrl('tiam://checkout/complete')).toBe(true);
    expect(isCheckoutReturnUrl('tiam://checkout/complete?quote_id=3f2b8c1e-8a3b-4b8e-9d7e-0c1a2b3c4d5e')).toBe(true);
    expect(isCheckoutReturnUrl('talia://checkout/complete/')).toBe(true);
  });

  it('refuses a look-alike that only CONTAINS the path, or carries anything else', () => {
    for (const url of [
      'https://evil.example/checkout/complete',
      `talia://invite/${HEIR}checkout/complete`,
      'tiam://auth/callback?token=abc&next=checkout/complete',
      'tiam://checkout/complete?quote_id=not-a-uuid',
      'tiam://checkout/complete?token=abc',
      'tiam://checkout/completed',
    ]) {
      expect(isCheckoutReturnUrl(url)).toBe(false);
    }
  });
});

describe('no link signs anyone in', () => {
  it('the old magic-link callback opens nothing', () => {
    expect(parseDeepLink('tiam://auth/callback?token=eyJhbGciOi.attacker.token')).toEqual({ kind: 'refused' });
    expect(parseDeepLink('talia://auth/callback?token=x')).toEqual({ kind: 'refused' });
  });

  const SRC = join(__dirname, '..', '..');
  const sources = (): string[] => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== '__tests__' && name !== 'node_modules') walk(full);
        } else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    };
    walk(SRC);
    return files;
  };

  it('nothing in the app handles a sign-in link or exchanges a link token', () => {
    const offenders = sources()
      .filter((f) => /api\/auth\/login\/verify-link|verifyMagicLink|tokenFromCallbackUrl|requestMagicLink/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('every place that receives a link reads it through deepLinks', () => {
    const receivers = sources().filter((f) =>
      /Linking\.addEventListener\(\s*'url'|getInitialURL\(/.test(readFileSync(f, 'utf8')),
    );
    expect(receivers.length).toBeGreaterThan(0);
    const offenders = receivers
      .filter((f) => {
        const text = readFileSync(f, 'utf8');
        return /url\.includes\(/.test(text) || !/inviteCodeFromUrl|isCheckoutReturnUrl|parseDeepLink/.test(text);
      })
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
