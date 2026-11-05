/**
 * The link that puts the account straight into Google Authenticator (decided
 * 2026-09-21 after a phone test: "test 3 is the right choice").
 *
 * Three links were tried on a phone the same day:
 * - otpauth-migration://offline?data=... (Google's "Transfer accounts"
 *   link): iOS offered to restore the deleted Passwords app. Since iOS 17
 *   Apple Passwords claims that scheme as well and marks itself the default,
 *   so it follows Settings > Apps > Default Apps > Passwords & Codes exactly
 *   like otpauth://.
 * - googleauthenticator://totp/...: opened Google Authenticator, added
 *   nothing (as every public report says).
 * - totp://account@host#KEY, Google Authenticator's original link form (its
 *   2011 open-source code: the name is the URL's user@host, the key follows
 *   '#'): ADDED THE ACCOUNT, labelled with the email alone, since that form
 *   has no issuer field.
 * A third round picked how the label travels ("test 1 shows TALIA: email
 * correctly"): inside the name, before the @, percent-encoded. The other two
 * tried an ?issuer= parameter and "TALIA:name" without the space.
 * Duo Mobile claims totp:// too, so the screen uses this link only when Duo
 * is not on the phone. Pure: tested in __tests__/googleAuthenticatorLink.test.ts.
 */
import { base32, base32nopad } from '@scure/base';

export interface TotpAccount {
  /** Raw secret bytes. */
  secret: Uint8Array;
  /** The account, e.g. the email address. */
  name: string;
  issuer: string;
  digits: 6 | 8;
}

/** Reads an otpauth://totp link. Null for anything a 30-second, six- or
 *  eight-digit SHA1 code cannot carry (HOTP, another algorithm or period). */
export function parseTotpLink(url: string): TotpAccount | null {
  const m = /^otpauth:\/\/totp\/([^?]*)\?(.*)$/i.exec(url.trim());
  if (!m) return null;
  const params = new Map<string, string>();
  for (const pair of m[2].split('&')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    try {
      params.set(pair.slice(0, i).toLowerCase(), decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')));
    } catch {
      return null;
    }
  }
  let label: string;
  try {
    label = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  const colon = label.indexOf(':');
  const labelIssuer = colon >= 0 ? label.slice(0, colon).trim() : '';
  const name = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const issuer = (params.get('issuer') ?? labelIssuer).trim();

  const algorithm = (params.get('algorithm') ?? 'SHA1').toUpperCase();
  const period = params.get('period') ?? '30';
  const digitsRaw = params.get('digits') ?? '6';
  if (algorithm !== 'SHA1' || period !== '30' || (digitsRaw !== '6' && digitsRaw !== '8')) return null;

  const raw = (params.get('secret') ?? '').replace(/[\s=]/g, '').toUpperCase();
  if (!raw || !/^[A-Z2-7]+$/.test(raw)) return null;
  let secret: Uint8Array;
  try {
    secret = base32.decode(raw.padEnd(Math.ceil(raw.length / 8) * 8, '='));
  } catch {
    return null;
  }
  if (secret.length === 0 || !name) return null;
  return { secret, name, issuer, digits: digitsRaw === '8' ? 8 : 6 };
}

/** The totp:// link that adds the backend's account to Google Authenticator
 *  as "<label>: <email>", or null when this account cannot travel that way
 *  (not an email, not a plain 30-second six-digit code: the old form carries
 *  no digits or period). */
export function googleAuthenticatorLink(otpauthUrl: string, label: string): string | null {
  const account = parseTotpLink(otpauthUrl);
  if (!account || account.digits !== 6) return null;
  const at = account.name.lastIndexOf('@');
  const local = at > 0 ? account.name.slice(0, at) : '';
  const host = at > 0 ? account.name.slice(at + 1) : '';
  if (!local || !/^[A-Za-z0-9.-]+$/.test(host)) return null;
  const key = base32nopad.encode(account.secret);
  return `totp://${encodeURIComponent(`${label}: ${local}`)}@${host}#${key}`;
}
