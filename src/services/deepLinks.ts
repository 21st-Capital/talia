/**
 * Every link that can open Talia, read in ONE place (decided
 * 2026-09-26). Pure, tested.
 *
 * `talia://` and `tiam://` are custom schemes: any app on the phone may
 * register them too, and any web page, QR code or message can fire them. So
 * a link is data from a stranger, and each handler used to trust it with a
 * loose pattern (`url.includes('checkout/complete')`, `invite/(.+)`). Now a
 * link is accepted only in the exact shape our own website writes, and
 * everything else is refused:
 *
 *   talia://invite/<code>  (tiam:// too)   an heir or portfolio invite code,
 *                                          and nothing after it
 *   tiam://checkout/complete[?quote_id=<uuid>]   the website after payment;
 *                                          it only makes the app ask our
 *                                          server, which is the truth
 *
 * NO link signs anyone in or changes the account on this phone. The old
 * magic-link sign-in (`tiam://auth/callback?token=...`) is refused here by
 * name, so it can never be wired back in by accident: a link to an
 * attacker's own account used to replace the owner's session silently.
 */
import { normalizeInviteCode } from '../crypto/envelope';
import { normalizePortfolioInviteCode } from '../crypto/sharedPortfolio';

export type DeepLink =
  | { kind: 'invite'; code: string }
  | { kind: 'checkoutComplete' }
  | { kind: 'refused' };

/** Longer than any link we write, by a wide margin. */
const MAX_LINK = 200;
const REFUSED: DeepLink = { kind: 'refused' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

export function parseDeepLink(url: string | null | undefined): DeepLink {
  if (typeof url !== 'string') return REFUSED;
  const text = url.trim();
  if (!text || text.length > MAX_LINK) return REFUSED;
  const m = /^(talia|tiam):\/\/([^?#]*)(\?[^#]*)?$/i.exec(text);
  if (!m) return REFUSED;
  const path = m[2];
  const query = m[3] ?? '';

  // talia://invite/CODE: one path segment, a real invite code, no query.
  const invite = /^invite\/([^/]+)\/?$/i.exec(path);
  if (invite) {
    if (query) return REFUSED;
    const code = decode(invite[1]);
    if (code == null) return REFUSED;
    if (normalizeInviteCode(code) == null && normalizePortfolioInviteCode(code) == null) return REFUSED;
    return { kind: 'invite', code: code.trim() };
  }

  // tiam://checkout/complete, optionally ?quote_id=<uuid> and nothing else.
  if (/^checkout\/complete\/?$/i.test(path)) {
    if (query) {
      const params = query.slice(1).split('&').filter(Boolean);
      for (const p of params) {
        const [name, value = ''] = p.split('=');
        if (name !== 'quote_id') return REFUSED;
        const v = decode(value);
        if (v == null || !UUID.test(v)) return REFUSED;
      }
    }
    return { kind: 'checkoutComplete' };
  }

  // Everything else, tiam://auth/callback included, opens nothing.
  return REFUSED;
}

/** The invite code a link carries, or null for any other or malformed link. */
export function inviteCodeFromUrl(url: string | null | undefined): string | null {
  const link = parseDeepLink(url);
  return link.kind === 'invite' ? link.code : null;
}

/** True only for the website's return from a finished checkout. */
export function isCheckoutReturnUrl(url: string | null | undefined): boolean {
  return parseDeepLink(url).kind === 'checkoutComplete';
}
