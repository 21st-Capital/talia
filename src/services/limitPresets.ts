/**
 * Co-signing limits without typing (decided 2026-09-19): "give the user options
 * to select from and only if he insists on a custom number, let him type
 * one. I just want to be sure that the user does not make any mistakes
 * during typing."
 *
 * Two limits, monthly and yearly, both in BTC (decided 2026-09-21: "lets only
 * offer limits in BTC" and "remove the daily limit and only keep a monthly
 * and yearly limit"). The presets are the amounts a client would actually
 * pick; a limit outside them is typed in a field that opens only on
 * "Custom".
 *
 * The two limits must not contradict each other (decided 2026-09-19: "a yearly
 * limit should not be lower than a daily limit", now monthly <= yearly),
 * each only where it is set. Pure, so the form, the backend and a plain
 * Node test all say the same thing.
 */

/** The one unit a co-signing limit is set in. Every payload still names it,
 *  because the backend reads the field. */
export const LIMIT_UNIT = 'BTC';

/**
 * The amounts the dropdown offers, smallest first. 0.01 BTC leads (decided
 * 2026-10-05): the standard limit on every Elite and Elite Plus vault is
 * 0.01 BTC a month and 0.1 BTC a year, so the standard monthly amount is a
 * preset too and a vault on the standard shows it in the dropdown, never as
 * a typed custom amount.
 */
export const LIMIT_PRESETS: ReadonlyArray<number> = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

/** "0.25": the preset as the form stores and shows it. */
export function presetLabel(amount: number): string {
  return String(amount);
}

/** The number a limit field holds, or null for blank / not a number. */
export function limitAmount(text: string): number | null {
  const cleaned = text.replace(/[',\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * What the Custom field keeps of what was typed. A phone set to a German
 * region offers a comma as the decimal mark on its number pad, and "0,75"
 * must mean 0.75 BTC, never 75 (a comma would otherwise read as a thousands
 * separator, here and on the server).
 */
export function limitInput(typed: string): string {
  return typed.replace(/,/g, '.');
}

/**
 * The preset a stored limit IS, by value (decided 2026-09-21): the server may
 * keep "0.50" where the list reads "0.5", and comparing the two as text made
 * every saved preset look like a typed amount, so the form showed the
 * amount twice, once in the dropdown and again in an open typed field.
 */
export function matchingPreset(value: string): string | null {
  const n = limitAmount(value);
  if (n == null) return null;
  const hit = LIMIT_PRESETS.find((p) => Math.abs(p - n) < 1e-9);
  return hit == null ? null : presetLabel(hit);
}

/** "0.5 BTC", or "" for no limit: one way to write a limit. */
export function limitText(value: string): string {
  const n = limitAmount(value);
  return n == null ? '' : `${presetLabel(n)} ${LIMIT_UNIT}`;
}

/**
 * Why the two limits contradict each other, or null. A blank limit is
 * "no limit" and contradicts nothing.
 */
export function limitOrderProblem(monthly: string, yearly: string): string | null {
  const m = limitAmount(monthly);
  const y = limitAmount(yearly);
  if (m != null && y != null && y < m) return 'The yearly limit cannot be lower than the monthly limit.';
  return null;
}
