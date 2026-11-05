/**
 * When an heir must give an email address (decided 2026-09-23).
 *
 * The address is optional (decided 2026-08-30: "I just want users to be able to
 * add their kids who are still too young to have an email") EXCEPT for an
 * heir who holds a key. A key holder will one day ask 21st Capital to
 * co-sign or to rescue, and the backend recognises an heir by their VERIFIED
 * email (apps/vaults/vault_access.py, live since 2026-09-22): with no
 * address on record that person is refused. An heir with no key never asks
 * us for anything, so a young child is still named without one.
 *
 * Both forms that file a plan use this same rule: the app's Estate Plan
 * flow and the website's. Nothing on either screen explains it; the field's
 * own label carries it (as decided: "I would not even explain this at all").
 */

/** The label the key chooser uses for an heir who holds no key. */
export const NO_KEY_ACCESS = 'No Key Access';

/** Does this heir hold one of the vault's keys? */
export function heirHoldsKey(keyLabel: string | null | undefined): boolean {
  const label = (keyLabel || '').trim();
  return label.length > 0 && label !== NO_KEY_ACCESS;
}

/** Must this heir give an email address? */
export function heirEmailRequired(keyLabel: string | null | undefined): boolean {
  return heirHoldsKey(keyLabel);
}

/** Is this heir's address acceptable, given the key they hold? */
export function heirEmailOk(email: string, keyLabel: string | null | undefined): boolean {
  const value = (email || '').trim();
  const shaped = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  return heirEmailRequired(keyLabel) ? shaped : value.length === 0 || shaped;
}
