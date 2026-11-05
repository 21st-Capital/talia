/**
 * Which authenticator app the two-factor setup hands the account to (decided
 * 2026-09-21: "use Google Authenticator as the default; look for all
 * authenticator apps we support on the phone, show a list if more than one,
 * open it immediately if only one, and add the code with a name label"; and,
 * the same hour, "the Passwords app of Apple also offers 2-factor codes,
 * include it as one of the options").
 *
 * What iOS allows, from a researched and cross-checked pass (2026-09-21):
 * - The generic otpauth:// link is the only link that ADDS an account with
 *   its name, and iOS decides which app receives it: the one set under
 *   Settings > Apps > Default Apps > Passwords & Codes, usually Passwords.
 *   On a test phone that was a deleted Passwords app, so iOS offered to
 *   download it. Talia can neither read nor change that setting, so the
 *   generic link is never used to reach a chosen app.
 * - Apple Passwords has its own link, apple-otpauth://, with the same
 *   payload (Apple, WWDC21 session 10105): Passwords takes the code and asks
 *   which saved login it belongs to.
 * - Every other app is detected and opened by a scheme of its own (IPA
 *   dumps and open-source Info.plists). None of those schemes carries an
 *   account, so the setup key goes on the clipboard and the app opens,
 *   ready for "Enter a setup key".
 * Every probe scheme must be listed in Info.plist LSApplicationQueriesSchemes
 * or canOpenURL always answers false. Never probe otpauth or totp: several
 * apps claim them, which is how a deleted app looked installed.
 */

export interface AuthenticatorApp {
  key: string;
  name: string;
  /** Probes and opens the app (canOpenURL / openURL). */
  url: string;
}

/** The apps Talia looks for, in the order a chooser lists them. */
export const AUTHENTICATOR_APPS: readonly AuthenticatorApp[] = [
  { key: 'google', name: 'Google Authenticator', url: 'googleauthenticator://' },
  { key: 'microsoft', name: 'Microsoft Authenticator', url: 'microsoft-authenticator://' },
  { key: 'authy', name: 'Authy', url: 'authy://' },
  { key: '2fas', name: '2FAS', url: 'twofasauth://open' },
  { key: 'ente', name: 'Ente Auth', url: 'enteauth://' },
  { key: 'duo', name: 'Duo Mobile', url: 'duo://' },
  { key: '1password', name: '1Password', url: 'onepassword://' },
  { key: 'bitwarden', name: 'Bitwarden', url: 'bitwarden://' },
  { key: 'proton', name: 'Proton Pass', url: 'protonpass://' },
];

/** Apple Passwords: its own link carries the account and its name. */
export const APPLE_PASSWORDS: AuthenticatorApp = {
  key: 'apple',
  name: 'Apple Passwords',
  url: 'apple-otpauth://',
};

/** Where to get the default app when nothing is installed. */
export const GOOGLE_AUTHENTICATOR_STORE_URL = 'itms-apps://apps.apple.com/app/id388497605';

/** The download row: Google Authenticator stays the default even on a phone
 *  whose only code app is Passwords, which nearly every iPhone has. */
export const GET_GOOGLE_AUTHENTICATOR: AuthenticatorApp = {
  key: 'google-get',
  name: 'Get Google Authenticator',
  url: GOOGLE_AUTHENTICATOR_STORE_URL,
};

/** The name every authenticator shows before the email (reported 2026-09-21: "It
 *  should have added the label TALIA: emailaddress"). Every route that
 *  names the account takes it from here. */
export const AUTHENTICATOR_LABEL = 'TALIA';

/** The backend's otpauth://totp link with `label` as its issuer, in the
 *  label and the issuer= parameter alike (Google's Key Uri Format wants the
 *  two equal). Anything that is not a totp link comes back unchanged. */
export function relabelTotpLink(otpauthUrl: string, label: string = AUTHENTICATOR_LABEL): string {
  const m = /^otpauth:\/\/totp\/([^?]*)\?(.*)$/i.exec(otpauthUrl.trim());
  if (!m) return otpauthUrl;
  let path: string;
  try {
    path = decodeURIComponent(m[1]);
  } catch {
    return otpauthUrl;
  }
  const colon = path.indexOf(':');
  const account = (colon >= 0 ? path.slice(colon + 1) : path).trim();
  const params = m[2].split('&').filter((p) => p && !/^issuer=/i.test(p));
  params.push(`issuer=${encodeURIComponent(label)}`);
  return `otpauth://totp/${encodeURIComponent(label)}:${encodeURIComponent(account)}?${params.join('&')}`;
}

/** The backend's otpauth:// link, labelled and addressed to Apple Passwords. */
export function applePasswordsLink(otpauthUrl: string): string {
  return relabelTotpLink(otpauthUrl).replace(/^otpauth:/i, 'apple-otpauth:');
}

/** The rows to offer: the installed apps in the list's order (Google first),
 *  then Apple Passwords when the phone has it. With no authenticator app
 *  installed, the download of the default heads the list, above Passwords. */
export function authenticatorChoices(installedKeys: ReadonlySet<string>, hasApplePasswords: boolean): AuthenticatorApp[] {
  const installed = AUTHENTICATOR_APPS.filter((a) => installedKeys.has(a.key));
  if (!hasApplePasswords) return installed;
  return installed.length > 0 ? [...installed, APPLE_PASSWORDS] : [GET_GOOGLE_AUTHENTICATOR, APPLE_PASSWORDS];
}

/** What one tap on the button does, from the rows available. */
export type AuthenticatorStep =
  | { kind: 'store' }
  | { kind: 'open'; app: AuthenticatorApp }
  | { kind: 'choose'; apps: AuthenticatorApp[] };

export function authenticatorStep(choices: readonly AuthenticatorApp[]): AuthenticatorStep {
  if (choices.length === 0) return { kind: 'store' };
  if (choices.length === 1) return { kind: 'open', app: choices[0] };
  return { kind: 'choose', apps: [...choices] };
}
