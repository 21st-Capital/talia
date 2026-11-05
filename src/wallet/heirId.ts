/**
 * Stable local id stamped on wallet.heirs entries (decided 2026-08-27): email is
 * no longer collected at vault creation, so keyless heirs need an identity of
 * their own for invites and the Estate Plan to match on. Minted at creation —
 * and lazily at invite time for heirs from older wallets that predate ids.
 *
 * crypto-random (64 bits), not Math.random(): two heirs of one vault fusing
 * on a collided id would silently merge them in EVERY matcher (decided
 * 2026-08-27).
 */
export function newHeirId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `h${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
